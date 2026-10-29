// Edge Function "clinicas-proximas": busca clínicas, laboratórios e centros de diagnóstico
// perto de um ponto e converte CEP, cidade ou endereço em coordenadas.
//
// Ações (POST, JSON):
//   search   { lat, lng, radius_m, include_demo }  clínicas IMED do banco, ordenadas por distância,
//            e, com a chave do Google, os estabelecimentos do Google Places. Sem a chave, o site
//            busca os estabelecimentos direto no OpenStreetMap, que não aceita pedidos de servidores em nuvem.
//   geocode  { q }  CEP (ViaCEP/BrasilAPI), cidade ou endereço (Google Geocoding ou Photon) para coordenadas.
//   status   informa qual serviço de mapas está ativo.
//
// Variáveis de ambiente (segredos da função, nunca vão para o navegador):
//   GOOGLE_MAPS_API_KEY  chave do Google Maps Platform (Places API New + Geocoding API). Opcional.
//   ALLOWED_ORIGINS      sites que podem chamar a função, separados por vírgula.
//   NOMINATIM_CONTACT    e-mail de contato enviado aos serviços do OpenStreetMap no User-Agent.
// SUPABASE_URL e SUPABASE_ANON_KEY são preenchidas automaticamente pelo Supabase.
//
// Privacidade: as coordenadas recebidas são arredondadas (~11 m), usadas só para a
// busca e nunca são gravadas nem enviadas aos logs.

import { clampRadius, geocode, isValidCoord, roundCoord, searchGoogle, type GeoResult, type MapPlace } from './lib.ts';

const GOOGLE_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ??
  'https://drrafaelpereirabarreto-code.github.io,http://localhost:8765,http://127.0.0.1:8765')
  .split(',').map((s) => s.trim()).filter(Boolean);
const CONTACT = Deno.env.get('NOMINATIM_CONTACT') ?? 'contato@imed.com.br';
const USER_AGENT = `IMED/1.0 (+https://drrafaelpereirabarreto-code.github.io/testedoapp/; ${CONTACT})`;
const PROVIDER = GOOGLE_KEY ? 'google' : 'osm';

const cache = new Map<string, { exp: number; value: unknown }>();
const hits = new Map<string, { n: number; reset: number }>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit.value as T;
  const value = await load();
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  cache.set(key, { exp: now + ttlMs, value });
  return value;
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { n: 1, reset: now + 60_000 });
    return false;
  }
  h.n += 1;
  return h.n > 40;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Clínicas IMED publicadas dentro do raio, já ordenadas por distância pelo banco (PostGIS).
async function imedNearby(auth: string, apikey: string, params: Record<string, unknown>): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/nearby_clinics`, {
    method: 'POST',
    headers: { apikey, Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`banco ${res.status}`);
  return await res.json() as unknown[];
}

async function handleSearch(body: Record<string, unknown>, auth: string, apikey: string, h: Record<string, string>) {
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!isValidCoord(lat, lng)) return json({ ok: false, error: 'invalid_coordinates' }, 400, h);
  const radius = clampRadius(body.radius_m);
  const origin = { lat: roundCoord(lat, 4), lng: roundCoord(lng, 4) };
  const includeDemo = body.include_demo === true;

  const [imedRes, placesRes] = await Promise.allSettled([
    imedNearby(auth, apikey, { p_lat: origin.lat, p_lng: origin.lng, p_radius_m: radius, p_include_demo: includeDemo, p_limit: 100 }),
    GOOGLE_KEY
      ? cached(`google:${origin.lat.toFixed(3)}:${origin.lng.toFixed(3)}:${radius}`, 10 * 60_000, () => searchGoogle(fetch, GOOGLE_KEY, origin, radius))
      : Promise.resolve([] as MapPlace[]),
  ]);

  const warnings: string[] = [];
  if (imedRes.status === 'rejected') { warnings.push('imed_unavailable'); console.error('busca IMED falhou:', String(imedRes.reason)); }
  if (placesRes.status === 'rejected') { warnings.push('places_unavailable'); console.error('busca no Google falhou:', String(placesRes.reason)); }
  if (imedRes.status === 'rejected' && (placesRes.status === 'rejected' || !GOOGLE_KEY)) {
    return json({ ok: false, error: 'unavailable', warnings }, 502, h);
  }
  return json({
    ok: true, provider: PROVIDER, radius_m: radius, warnings,
    imed: imedRes.status === 'fulfilled' ? imedRes.value : [],
    places: placesRes.status === 'fulfilled' ? placesRes.value.slice(0, 120) : [],
  }, 200, h);
}

async function handleGeocode(body: Record<string, unknown>, h: Record<string, string>) {
  const q = String(body.q ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (q.length < 3) return json({ ok: false, error: 'query_too_short' }, 400, h);
  let result: GeoResult | null;
  try {
    result = await cached(`geo:${PROVIDER}:${q.toLowerCase()}`, 60 * 60_000, () => geocode(fetch, q, GOOGLE_KEY, USER_AGENT));
  } catch (err) {
    console.error('geocodificação falhou:', String(err));
    return json({ ok: false, error: 'geocoder_unavailable' }, 502, h);
  }
  if (!result) return json({ ok: false, error: 'not_found' }, 404, h);
  return json({ ok: true, ...result }, 200, h);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const h = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: 'origin_not_allowed' }, 403, h);
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, h);

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'desconhecido';
  if (rateLimited(ip)) return json({ ok: false, error: 'rate_limited' }, 429, { ...h, 'Retry-After': '60' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400, h);
  }
  const apikey = req.headers.get('apikey') ?? ANON_KEY;
  const auth = req.headers.get('authorization') ?? `Bearer ${ANON_KEY}`;

  try {
    if (body?.action === 'search') return await handleSearch(body, auth, apikey, h);
    if (body?.action === 'geocode') return await handleGeocode(body, h);
    if (body?.action === 'status') return json({ ok: true, provider: PROVIDER }, 200, h);
    return json({ ok: false, error: 'unknown_action' }, 400, h);
  } catch (err) {
    console.error('erro inesperado:', err instanceof Error ? err.message : 'desconhecido');
    return json({ ok: false, error: 'internal' }, 500, h);
  }
});
