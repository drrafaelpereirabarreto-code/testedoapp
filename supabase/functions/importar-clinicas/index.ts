// Edge Function "importar-clinicas": traz para o banco do IMED as clínicas, laboratórios, centros de
// diagnóstico e hospitais reais de um município, a partir do CNES (Cadastro Nacional de
// Estabelecimentos de Saúde, do Ministério da Saúde).
//
// Só o próprio servidor chama esta função, com a chave de serviço. A busca "clinicas-proximas" manda
// os pontos onde o paciente está procurando; aqui se descobre o município de cada ponto (Photon +
// IBGE) e, se ele ainda não foi importado (ou se a importação tem mais de 30 dias), a importação roda
// em segundo plano. Estabelecimentos sem coordenada confiável no CNES são localizados pelo endereço
// aos poucos, um por segundo, para respeitar o serviço público do Photon.
//
// Ações (POST, JSON, Authorization: Bearer <chave de serviço>):
//   garantir   { pontos: [{ lat, lng }] }  situação do município de cada ponto (e começa a importação)
//   localizar  { ibge }                   localiza pelo endereço mais um lote de estabelecimentos

import { addressQuery, CNES_TYPES, cityFromReverse, mapCnesRows, nameKey, pickAddressResult, type CnesRow } from './lib.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CONTACT = Deno.env.get('NOMINATIM_CONTACT') ?? 'contato@imed.com.br';
const UA = `IMED/1.0 (+https://drrafaelpereirabarreto-code.github.io/testedoapp/; ${CONTACT})`;
const CNES_API = 'https://apidadosabertos.saude.gov.br/cnes/estabelecimentos';

interface Municipality { ibge: number; cnes_code: number; name: string; name_key: string; uf: string }
interface CityStatus { ibge: number; city: string; uf: string; status: string }

const background = (p: Promise<unknown>) => {
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
  else p.catch(() => {});
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function db(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> ?? {}) },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`banco ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const rpc = (fn: string, args: unknown) => db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });

async function getJson(url: string, ms = 20000): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

/* ---------------- municípios ---------------- */
const ufLoaded = new Set<string>();
async function ensureUf(uf: string) {
  if (ufLoaded.has(uf)) return;
  const have = await db(`municipalities?select=ibge&uf=eq.${uf}&limit=1`) as unknown[];
  if (!have.length) {
    const list = await getJson(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`) as { id: number; nome: string }[];
    const rows = list.map((m) => ({ ibge: m.id, cnes_code: Math.floor(m.id / 10), name: m.nome, name_key: nameKey(m.nome), uf }));
    await db('municipalities?on_conflict=ibge', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
  }
  ufLoaded.add(uf);
}

const reverseCache = new Map<string, Municipality | null>();
async function municipalityAt(lat: number, lng: number): Promise<Municipality | null> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (reverseCache.has(key)) return reverseCache.get(key) ?? null;
  const place = cityFromReverse(await getJson(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`, 8000));
  let m: Municipality | null = null;
  if (place) {
    await ensureUf(place.uf);
    const rows = await db(`municipalities?select=ibge,cnes_code,name,name_key,uf&uf=eq.${place.uf}&name_key=eq.${encodeURIComponent(nameKey(place.city))}`) as Municipality[];
    m = rows[0] ?? null;
  }
  if (reverseCache.size > 2000) reverseCache.clear();
  reverseCache.set(key, m);
  return m;
}

/* ---------------- importação ---------------- */
async function fetchType(code: number, type: number): Promise<CnesRow[]> {
  const page = async (offset: number): Promise<CnesRow[]> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const j = await getJson(`${CNES_API}?codigo_municipio=${code}&codigo_tipo_unidade=${type}&limit=20&offset=${offset}`, 30000);
        return (j.estabelecimentos ?? []) as CnesRow[];
      } catch (err) {
        if (attempt >= 2) throw err;
        await sleep(800 * (attempt + 1));
      }
    }
  };
  const out: CnesRow[] = [];
  for (let p = 0; p < 1500; p += 6) {
    const batch = await Promise.all(Array.from({ length: 6 }, (_, k) => page((p + k) * 20)));
    for (const b of batch) out.push(...b);
    if (batch.some((b) => b.length < 20)) break;
  }
  return out;
}

async function runImport(m: Municipality) {
  const run = new Date().toISOString();
  const t0 = Date.now();
  try {
    const raw: CnesRow[] = [];
    for (const t of CNES_TYPES) raw.push(...await fetchType(m.cnes_code, t));
    const { rows } = mapCnesRows(raw);
    for (let i = 0; i < rows.length; i += 400) {
      await rpc('upsert_establishments', { p_city: m.ibge, p_run: run, p_rows: rows.slice(i, i + 400) });
    }
    await rpc('finish_establishment_import', { p_city: m.ibge, p_run: run, p_found: raw.length });
    console.log(`importação ${m.name}/${m.uf}: ${raw.length} no CNES, ${rows.length} gravados em ${Math.round((Date.now() - t0) / 1000)} s`);
    await geocodeBatch(m, 25);
  } catch (err) {
    console.error(`importação ${m.name}/${m.uf} falhou:`, String(err));
    await rpc('finish_establishment_import', { p_city: m.ibge, p_run: run, p_found: null, p_error: String(err).slice(0, 300) }).catch(() => {});
  }
}

/* ---------------- localização pelo endereço ---------------- */
const geocoding = new Set<number>();
async function geocodeBatch(m: Municipality, n: number) {
  if (geocoding.has(m.ibge)) return;
  geocoding.add(m.ibge);
  try {
    const pending = await db(`establishments?select=cnes,address_line,neighborhood&city_ibge=eq.${m.ibge}&location=is.null&geocode_tried_at=is.null&limit=${n}`) as { cnes: string; address_line: string | null; neighborhood: string | null }[];
    const out: { cnes: string; lat: number | null; lng: number | null }[] = [];
    for (const e of pending) {
      const q = addressQuery(e, m.name, m.uf);
      let pt: { lat: number; lng: number } | null = null;
      if (q) {
        try {
          pt = pickAddressResult(await getJson(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&bbox=-74.1,-33.9,-34.7,5.4`, 8000), m.name_key, m.uf);
        } catch {
          continue; // serviço fora do ar: tenta de novo num próximo lote
        }
        await sleep(1000);
      }
      out.push({ cnes: e.cnes, lat: pt?.lat ?? null, lng: pt?.lng ?? null });
    }
    if (out.length) await rpc('save_establishment_geocodes', { p_city: m.ibge, p_rows: out });
  } catch (err) {
    console.error(`localização pelo endereço em ${m.name}/${m.uf} falhou:`, String(err));
  } finally {
    geocoding.delete(m.ibge);
  }
}

async function maybeGeocode(m: Municipality) {
  const rows = await db(`establishment_imports?select=pending_geocode,last_geocode_at&city_ibge=eq.${m.ibge}`) as { pending_geocode: number | null; last_geocode_at: string | null }[];
  const r = rows[0];
  if (r?.pending_geocode && (!r.last_geocode_at || Date.now() - Date.parse(r.last_geocode_at) > 120_000)) background(geocodeBatch(m, 45));
}

// Situação do município de cada ponto, na mesma ordem dos pontos (null quando não deu para saber).
async function ensure(points: { lat: number; lng: number }[]): Promise<(CityStatus | null)[]> {
  const cities = await Promise.all(points.slice(0, 5).map((p) => municipalityAt(p.lat, p.lng).catch((err) => {
    console.error('município do ponto não encontrado:', String(err));
    return null;
  })));
  const done = new Map<number, CityStatus>();
  const out: (CityStatus | null)[] = [];
  for (const m of cities) {
    if (!m) { out.push(null); continue; }
    if (!done.has(m.ibge)) {
      const status = await rpc('start_establishment_import', { p_city: m.ibge }) as string;
      if (status === 'started') background(runImport(m));
      else if (status === 'done') await maybeGeocode(m).catch(() => {});
      done.set(m.ibge, { ibge: m.ibge, city: m.name, uf: m.uf, status: status === 'started' ? 'running' : status });
    }
    out.push(done.get(m.ibge)!);
  }
  return out;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  if (!SERVICE_KEY || req.headers.get('authorization') !== `Bearer ${SERVICE_KEY}`) return json({ ok: false, error: 'forbidden' }, 403);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }
  try {
    if (body.action === 'garantir') {
      const pts = (Array.isArray(body.pontos) ? body.pontos : [])
        .map((p: { lat?: unknown; lng?: unknown }) => ({ lat: Number(p?.lat), lng: Number(p?.lng) }))
        .filter((p: { lat: number; lng: number }) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
      return json({ ok: true, cidades: await ensure(pts) });
    }
    if (body.action === 'localizar') {
      const rows = await db(`municipalities?select=ibge,cnes_code,name,name_key,uf&ibge=eq.${Number(body.ibge)}`) as Municipality[];
      if (!rows[0]) return json({ ok: false, error: 'not_found' }, 404);
      background(geocodeBatch(rows[0], 45));
      return json({ ok: true }, 202);
    }
    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (err) {
    console.error('erro inesperado:', err instanceof Error ? err.message : 'desconhecido');
    return json({ ok: false, error: 'internal' }, 500);
  }
});
