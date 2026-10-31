// Regras da importação de estabelecimentos reais do CNES (Cadastro Nacional de Estabelecimentos
// de Saúde, do Ministério da Saúde) para o banco do IMED. Não usa APIs do Deno, então também
// roda (e é testada) no Node.

export type Kind = 'imagem' | 'laboratorio' | 'clinica' | 'hospital';

// Linha da API de dados abertos do CNES (apidadosabertos.saude.gov.br/cnes/estabelecimentos).
export interface CnesRow {
  codigo_cnes: number | string;
  nome_fantasia?: string | null;
  nome_razao_social?: string | null;
  codigo_tipo_unidade: number;
  endereco_estabelecimento?: string | null;
  numero_estabelecimento?: string | null;
  bairro_estabelecimento?: string | null;
  codigo_cep_estabelecimento?: string | null;
  numero_telefone_estabelecimento?: string | null;
  latitude_estabelecimento_decimo_grau?: number | null;
  longitude_estabelecimento_decimo_grau?: number | null;
  descricao_turno_atendimento?: string | null;
  estabelecimento_faz_atendimento_ambulatorial_sus?: string | null;
  codigo_motivo_desabilitacao_estabelecimento?: string | null;
  data_atualizacao?: string | null;
}

// Linha no formato da função upsert_establishments do banco.
export interface EstablishmentRow {
  cnes: string;
  name: string;
  legal_name: string | null;
  kind: Kind;
  cnes_type: number;
  address_line: string | null;
  neighborhood: string | null;
  cep: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  shift: string | null;
  open_24h: boolean;
  sus: boolean | null;
  services: string[];
  specialties: string[];
  cnes_updated_at: string | null;
}

// Tipos de unidade do CNES que interessam ao paciente do IMED:
// 39 serviço de apoio diagnóstico e terapêutico (laboratórios, imagem), 36 clínica ou centro de
// especialidade, 4 policlínica, 5 hospital geral, 7 hospital especializado, 62 hospital-dia.
export const CNES_TYPES = [39, 36, 4, 5, 7, 62];
const HOSPITAL_TYPES = new Set([5, 7, 62]);

const IMAGING_RE = /imagem|radiolog|diagn[oó]st|tomogra|resson|ultra[\s-]?s|ultrass|mamogra|raio[\s-]?x|\brx\b|densitom|medicina nuclear|pet[\s-]?ct|ecograf|doppler|\bcdi\b/i;
const LAB_RE = /laborat|an[aá]lises|\bcoleta|patolog|gen[eé]tic|hematol|citolog|\blabs?\b|exames/i;
const THERAPY_RE = /di[aá]lise|nefro|quimio|radioterap|hiperb|reabilit|hemoter|vacina|terapia/i;
const EXCLUDE_RE = /odonto|dent[aá]ri|dentista|ortodont|implant|veterin|est[eé]tica|farm[aá]cia|drogaria|\b[oó]tica\b|optica/i;
// Fora do foco do IMED (exames e consultas médicas): terapias sem médico.
const NON_MEDICAL_RE = /fisio|pilates|psicol|psican|fonoaud|nutri|acupunt|terapia ocupacional|quiropr|osteopat|podolog|massoter|hol[ií]stic|terap[eê]ut|reiki|yoga|coaching/i;

const EXAM_PATTERNS: [string, RegExp][] = [
  ['rm', /resson[aâ]ncia|\brmn?\b|magn[eé]tica/i],
  ['tc', /tomogra|\btc\b/i],
  ['usg', /ultra-?s(?:som|onografia)|ultrass|ecografia|\busg\b|doppler/i],
  ['mamo', /mamogra/i],
  ['dens', /densitometr/i],
  ['rx', /raio[\s-]?x|radiograf|\brx\b/i],
  ['eco', /ecocardio/i],
  ['ecg', /eletrocardio|\becg\b/i],
  ['lab', /laborat|an[aá]lises cl[ií]nicas|exames laboratoriais/i],
];
const SPECIALTY_BY_NAME: [string, RegExp][] = [
  ['Cardiologia', /cardio/i], ['Ortopedia', /ortoped|\bortop/i], ['Ginecologia', /gineco|sa[uú]de da mulher/i],
  ['Pediatria', /pediatr|infantil/i], ['Dermatologia', /dermat/i], ['Oftalmologia', /oftalm|\bolhos\b/i],
  ['Otorrinolaringologia', /otorrino/i], ['Urologia', /urolog/i], ['Neurologia', /neuro/i], ['Oncologia', /oncolog/i],
  ['Radiologia', /radiolog|diagn[oó]stico por imagem/i], ['Mastologia', /mastolog/i],
];

const LOWER_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'as', 'os', 'para', 'com', 'na', 'no', 'nas', 'nos', 'por', 'ao', 'aos']);
const UPPER_WORDS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
  'HC', 'AMA', 'UBS', 'UPA', 'SUS', 'USP', 'FMUSP', 'UNIFESP', 'UNICAMP', 'UFRJ', 'UFMG', 'AACD', 'CDI', 'LTDA', 'ME', 'EPP', 'EIRELI', 'S/A', 'SA',
  'PS', 'PA', 'CEMA', 'HSPM', 'BP', 'ICESP', 'INCOR', 'IAMSPE', 'HCOR', 'NAE', 'CAPS', 'CEO', 'CER', 'APAE', 'RX', 'TC', 'RM', 'ECG', 'USG',
  'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII', 'CEU', 'AME', 'CRS', 'STS', 'SMS', 'HU', 'HM', 'IML', 'CTI', 'UTI',
]);

// O CNES não tem acentos. Palavras comuns sem ambiguidade voltam a ter acento na tela.
const ACCENTS: Record<string, string> = Object.fromEntries(([
  'clínica', 'clínicas', 'clínico', 'clínicos', 'policlínica', 'médica', 'médicas', 'médico', 'médicos', 'saúde', 'são',
  'laboratório', 'laboratórios', 'análises', 'diagnóstico', 'diagnósticos', 'diagnóstica', 'serviço', 'serviços',
  'associação', 'fundação', 'instituição', 'reabilitação', 'atenção', 'coração', 'assistência', 'emergência', 'urgência',
  'urgências', 'ambulatório', 'consultório', 'consultórios', 'cirúrgica', 'cirúrgico', 'cardiológica', 'cardiológico',
  'pediátrica', 'psiquiátrica', 'neurológica', 'ortopédica', 'oncológica', 'ginecológica', 'oftalmológica', 'oftalmológico',
  'dermatológica', 'urológica', 'radiológica', 'hematológica', 'ressonância', 'beneficência', 'sírio', 'libanês', 'japonês',
  'alemão', 'josé', 'joão', 'antônio', 'conceição', 'sebastião', 'luís', 'sérgio', 'ovídio', 'paraíso', 'butantã', 'tatuapé',
  'cecília', 'consolação', 'república', 'brás', 'belém', 'jaçanã', 'limão', 'aclimação', 'grajaú', 'angélica', 'eugênio',
  'vitória', 'glória', 'praça', 'estação', 'previdência', 'sanitária', 'imunização', 'vacinação', 'reprodução', 'família',
  'criança', 'crianças', 'mãe', 'único', 'básica', 'básico', 'técnica', 'técnico', 'especialização', 'prevenção', 'avaliação',
  'integração', 'núcleo', 'perícia', 'audição', 'visão', 'brasilândia', 'tremembé', 'sacomã', 'higienópolis', 'jaraguá',
  'sumaré', 'água', 'águas', 'mauá', 'andré', 'lúcia', 'mônica', 'patrícia', 'fátima', 'inês', 'cristóvão', 'mário', 'márcio',
  'flávio', 'fábio', 'cássio', 'vinícius', 'júlio', 'césar', 'otávio', 'gonçalves', 'araújo', 'simões', 'guimarães',
  'magalhães', 'assunção', 'graça', 'graças', 'pública', 'públicas', 'santíssima', 'doença', 'doenças',
  'ortopédico', 'neurológico', 'psiquiátrico', 'pediátrico', 'oncológico', 'ginecológico', 'urológico', 'dermatológico',
  'radiológico', 'hematológico', 'endócrino', 'cirúrgicos', 'pulmões', 'odontológico', 'médico-hospitalar',
] as string[]).map((w) => [w.normalize('NFD').replace(/[\u0300-\u036f]/g, ''), w]));

const cap = (w: string) => w.replace(/(^|[-'(/])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase());

// O CNES guarda os nomes em MAIÚSCULAS e sem acento. Para a tela, vira "Hospital Samaritano Paulista".
export function titleCase(s: string | null | undefined): string | null {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.split(' ').map((w, i) => {
    const up = w.toUpperCase();
    if (UPPER_WORDS.has(up)) return up;
    if (/\d/.test(w)) return up;
    const low = w.toLowerCase().replace(/\p{L}+/u, (core) => ACCENTS[core] ?? core);
    if (i > 0 && LOWER_WORDS.has(low)) return low;
    return cap(low);
  }).join(' ');
}

export function classify(type: number, text: string): Kind | null {
  if (EXCLUDE_RE.test(text)) return null;
  if (HOSPITAL_TYPES.has(type)) return 'hospital';
  if (NON_MEDICAL_RE.test(text)) return null;
  if (IMAGING_RE.test(text)) return 'imagem';
  if (LAB_RE.test(text)) return 'laboratorio';
  if (type === 39 && !THERAPY_RE.test(text)) return 'laboratorio';
  return 'clinica';
}

export function examsFromText(text: string, kind: Kind): string[] {
  if (kind === 'hospital') return [];
  const out = EXAM_PATTERNS.filter(([, re]) => re.test(text)).map(([code]) => code);
  if (kind === 'laboratorio' && !out.includes('lab')) out.push('lab');
  return out;
}

export const specialtiesFromText = (text: string): string[] =>
  SPECIALTY_BY_NAME.filter(([, re]) => re.test(text)).map(([label]) => label);

// "ATENDIMENTOS NOS TURNOS DA MANHA E A TARDE" vira "Manhã e tarde". É o turno informado ao CNES,
// não um horário exato.
export function shiftInfo(desc: string | null | undefined): { shift: string | null; open_24h: boolean } {
  const d = String(desc ?? '').toUpperCase();
  if (!d.trim()) return { shift: null, open_24h: false };
  if (d.includes('24 HORAS')) return { shift: 'Aberto 24 horas', open_24h: true };
  if (d.includes('INTERMITENTE')) return { shift: 'Turnos intermitentes', open_24h: false };
  const parts = [d.includes('MANHA') && 'manhã', d.includes('TARDE') && 'tarde', d.includes('NOITE') && 'noite'].filter(Boolean) as string[];
  if (!parts.length) return { shift: titleCase(desc), open_24h: false };
  const text = parts.length === 1 ? `somente ${parts[0]}` : `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
  return { shift: text[0].toUpperCase() + text.slice(1), open_24h: false };
}

export function cleanPhone(v: unknown): string | null {
  let d = String(v ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length < 8 || d.length > 11 || /^(\d)\1+$/.test(d)) return null;
  if (/^0[358]00/.test(d)) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (d.startsWith('0') && d.length >= 11) d = d.slice(1);
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`;
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return null;
}

export interface LatLng { lat: number; lng: number }

export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const decimals = (v: number): number => {
  const s = String(v);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Decide quais coordenadas do CNES são confiáveis para um município. Descarta:
// fora do Brasil, com 2 casas decimais ou menos, "de enfeite" (a mesma coordenada imprecisa
// repetida em vários estabelecimentos, em geral o centro da cidade) e as muito longe das demais.
export function validLocations(points: { lat?: number | null; lng?: number | null }[]): { ok: boolean[]; center: LatLng | null; limit: number } {
  const key = (p: { lat?: number | null; lng?: number | null }) => `${p.lat},${p.lng}`;
  let ok = points.map((p) => typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && p.lat >= -34 && p.lat <= 5.5 && p.lng >= -74.5 && p.lng <= -32
    && !(decimals(p.lat) <= 2 && decimals(p.lng) <= 2));
  const count = new Map<string, number>();
  points.forEach((p, i) => { if (ok[i]) count.set(key(p), (count.get(key(p)) ?? 0) + 1); });
  ok = ok.map((v, i) => {
    if (!v) return false;
    const n = count.get(key(points[i])) ?? 0;
    const p = points[i] as LatLng;
    const coarse = decimals(p.lat) <= 4 && decimals(p.lng) <= 4;
    return coarse ? n < 3 : n < 8;
  });
  const good = points.filter((_, i) => ok[i]) as LatLng[];
  if (!good.length) return { ok, center: null, limit: 0 };
  const center = { lat: median(good.map((p) => p.lat)), lng: median(good.map((p) => p.lng)) };
  const d = good.map((p) => haversine(center, p)).sort((a, b) => a - b);
  const p90 = d[Math.floor(0.9 * (d.length - 1))];
  const limit = good.length >= 5 ? Math.max(20000, 2.5 * p90) : 30000;
  ok = ok.map((v, i) => v && haversine(center, points[i] as LatLng) <= limit);
  return { ok, center, limit };
}

// Converte as linhas do CNES de um município. Fica de fora quem está desativado no CNES
// (tem motivo de desabilitação) e quem não é do interesse do IMED (odontologia, veterinária etc.).
export function mapCnesRows(rows: CnesRow[]): { rows: EstablishmentRow[]; center: LatLng | null; limit: number } {
  const seen = new Set<string>();
  const active = rows.filter((r) => {
    const id = String(r.codigo_cnes ?? '').padStart(7, '0');
    if (r.codigo_motivo_desabilitacao_estabelecimento != null || !/^\d{7}$/.test(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const loc = validLocations(active.map((r) => ({ lat: r.latitude_estabelecimento_decimo_grau, lng: r.longitude_estabelecimento_decimo_grau })));
  const out: EstablishmentRow[] = [];
  active.forEach((r, i) => {
    const fantasy = String(r.nome_fantasia ?? '').trim();
    const legal = String(r.nome_razao_social ?? '').trim();
    const rawName = fantasy || legal;
    if (rawName.length < 2) return;
    const text = `${fantasy} ${legal}`;
    const kind = classify(Number(r.codigo_tipo_unidade), text);
    if (!kind) return;
    const street = titleCase(r.endereco_estabelecimento);
    const num = String(r.numero_estabelecimento ?? '').trim();
    const hasNum = num && !/^(s\/?n|sn|0+|-)$/i.test(num);
    const cep = String(r.codigo_cep_estabelecimento ?? '').replace(/\D/g, '');
    const { shift, open_24h } = shiftInfo(r.descricao_turno_atendimento);
    const sus = r.estabelecimento_faz_atendimento_ambulatorial_sus;
    out.push({
      cnes: String(r.codigo_cnes).padStart(7, '0'),
      name: titleCase(rawName)!.slice(0, 200),
      legal_name: legal ? titleCase(legal) : null,
      kind,
      cnes_type: Number(r.codigo_tipo_unidade),
      address_line: street ? (hasNum ? `${street}, ${num.toUpperCase()}` : street) : null,
      neighborhood: titleCase(r.bairro_estabelecimento),
      cep: cep.length === 8 ? cep : null,
      lat: loc.ok[i] ? Number(r.latitude_estabelecimento_decimo_grau) : null,
      lng: loc.ok[i] ? Number(r.longitude_estabelecimento_decimo_grau) : null,
      phone: cleanPhone(r.numero_telefone_estabelecimento),
      shift,
      open_24h,
      sus: sus === 'SIM' ? true : sus === 'NAO' ? false : null,
      services: examsFromText(text, kind),
      specialties: specialtiesFromText(text),
      cnes_updated_at: /^\d{4}-\d{2}-\d{2}$/.test(String(r.data_atualizacao ?? '')) ? String(r.data_atualizacao) : null,
    });
  });
  return { rows: out, center: loc.center, limit: loc.limit };
}

export const nameKey = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const UF_BY_STATE: Record<string, string> = {
  'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM', 'bahia': 'BA', 'ceara': 'CE', 'distrito federal': 'DF',
  'espirito santo': 'ES', 'goias': 'GO', 'maranhao': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
  'minas gerais': 'MG', 'para': 'PA', 'paraiba': 'PB', 'parana': 'PR', 'pernambuco': 'PE', 'piaui': 'PI',
  'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR',
  'santa catarina': 'SC', 'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO',
};

interface PhotonFeature { geometry?: { coordinates?: [number, number] }; properties?: Record<string, string | undefined> }

// Cidade e estado de um ponto, pela busca reversa do Photon (OpenStreetMap).
export function cityFromReverse(json: { features?: PhotonFeature[] }): { city: string; uf: string } | null {
  for (const f of json?.features ?? []) {
    const p = f.properties ?? {};
    if (p.countrycode !== 'BR') continue;
    const uf = UF_BY_STATE[nameKey(p.state ?? '')];
    const city = p.city ?? p.county ?? (p.type === 'city' ? p.name : undefined);
    if (uf && city) return { city, uf };
  }
  return null;
}

// Ponto de um endereço pelo Photon, aceito só se cair no município certo.
export function pickAddressResult(json: { features?: PhotonFeature[] }, cityKey: string, uf: string): LatLng | null {
  for (const f of json?.features ?? []) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    if (p.countrycode !== 'BR' || !Array.isArray(c)) continue;
    if (UF_BY_STATE[nameKey(p.state ?? '')] !== uf) continue;
    const city = nameKey(p.city ?? p.county ?? '');
    if (city !== cityKey) continue;
    if (!['house', 'street'].includes(String(p.type))) continue;
    const [lng, lat] = c;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

export function addressQuery(e: { address_line: string | null; neighborhood: string | null }, city: string, uf: string): string | null {
  if (!e.address_line) return null;
  return [e.address_line, e.neighborhood, city, uf].filter(Boolean).join(', ');
}

/* ===== Chaves do Supabase: início (bloco igual em clinicas-proximas/lib.ts e importar-clinicas/lib.ts) ===== */
// O Supabase põe as chaves do projeto nas variáveis de ambiente de toda Edge Function:
// - novas: SUPABASE_PUBLISHABLE_KEYS e SUPABASE_SECRET_KEYS, um JSON com as chaves por nome
//   ({"default":"sb_publishable_..."}). Vão SÓ no cabeçalho "apikey": em "Authorization: Bearer" o Supabase tenta
//   ler a chave como token (JWT) e recusa ("Invalid JWT").
// - antigas (tokens JWT, que param de funcionar no fim de 2026): SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.
//   Só são usadas se a nova faltar, e vão como sempre foram (apikey e Authorization: Bearer).
// Nada aqui usa APIs do Deno: quem chama passa a leitura do ambiente (env), e os testes rodam no Node.
export type EnvGet = (name: string) => string | undefined;
export interface ProjectKey { key: string; legacy: boolean }
export const PUBLISHABLE_VARS = { novas: 'SUPABASE_PUBLISHABLE_KEYS', antiga: 'SUPABASE_ANON_KEY' } as const;
export const SECRET_VARS = { novas: 'SUPABASE_SECRET_KEYS', antiga: 'SUPABASE_SERVICE_ROLE_KEY' } as const;
type KeyVars = typeof PUBLISHABLE_VARS | typeof SECRET_VARS;

// Chaves de um JSON por nome. Faltando, vazio, quebrado ou fora do formato: nenhuma (nunca derruba a função).
export function namedKeys(raw: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== 'string' || !raw.trim()) return out;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return out; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [name, key] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof key === 'string' && key.trim()) out[name] = key.trim();
  }
  return out;
}

// A chave nova de nome `name` ("default"; sem ela, a primeira da lista) ou, sem nenhuma nova, a antiga.
function pickKey(env: EnvGet, vars: KeyVars, name: string): ProjectKey | null {
  const list = namedKeys(env(vars.novas));
  const nova = list[name] ?? Object.values(list)[0];
  if (nova) return { key: nova, legacy: false };
  const antiga = (env(vars.antiga) ?? '').trim();
  return antiga ? { key: antiga, legacy: true } : null;
}
// Chave publishable: consulta o banco como visitante (o papel "anon"), sujeita às regras (RLS).
export const publishableKey = (env: EnvGet, name = 'default'): ProjectKey | null => pickKey(env, PUBLISHABLE_VARS, name);
// Chave secreta: acesso total ao banco. Só para chamadas do próprio servidor; nunca vai para resposta ou log.
export const secretKey = (env: EnvGet, name = 'default'): ProjectKey | null => pickKey(env, SECRET_VARS, name);

// Qual chave está em uso, sem mostrar a chave: "nova", "antiga" ou "ausente" (para a conferência depois do deploy).
export const keyKind = (k: ProjectKey | null): 'nova' | 'antiga' | 'ausente' => (k ? (k.legacy ? 'antiga' : 'nova') : 'ausente');

// Cabeçalhos para chamar a API do Supabase (banco ou outra função) com uma chave do servidor: a nova só em "apikey";
// a antiga (JWT) em "apikey" e em "Authorization: Bearer", como sempre foi. Uma chave "sb_" nunca vai em Bearer.
export function keyHeaders(k: ProjectKey | null): Record<string, string> {
  if (!k) return {};
  return k.legacy && !k.key.startsWith('sb_') ? { apikey: k.key, Authorization: `Bearer ${k.key}` } : { apikey: k.key };
}

// Todas as chaves aceitas de quem chama (função publicada com verify_jwt=false confere no código): as novas, de
// qualquer nome, e a antiga enquanto existir.
export function acceptedKeys(env: EnvGet, vars: KeyVars): string[] {
  const out = Object.values(namedKeys(env(vars.novas)));
  const antiga = (env(vars.antiga) ?? '').trim();
  if (antiga) out.push(antiga);
  return [...new Set(out)];
}

// Comparação que leva o mesmo tempo acertando ou errando cada letra (não entrega a chave aos poucos).
export function sameKey(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

// A chamada traz uma destas chaves? No "apikey" vale qualquer uma; em "Authorization: Bearer", só as antigas (JWT),
// como mandam os chamadores antigos.
export function hasKey(headers: { get(name: string): string | null }, keys: string[]): boolean {
  const apikey = headers.get('apikey') ?? '';
  const bearer = (headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return keys.some((k) => sameKey(apikey, k) || (!k.startsWith('sb_') && sameKey(bearer, k)));
}
/* ===== Chaves do Supabase: fim ===== */
