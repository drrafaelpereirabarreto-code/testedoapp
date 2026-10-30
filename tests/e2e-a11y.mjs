// Acessibilidade das páginas principais num navegador de verdade (Playwright), com o banco simulado.
// Pensado para idosos e para quem usa leitor de tela ou só o teclado:
//  - axe-core (regras WCAG 2.0, 2.1 e 2.2, níveis A e AA, e boas práticas) no computador e no celular (390 px);
//    falha com violação "serious" ou "critical";
//  - checagens próprias: idioma pt-BR; no celular, alvos de toque com pelo menos 44 px e campos com letra de
//    16 px ou mais (o iPhone não dá zoom); foco visível e não escondido atrás do topo ou do menu de baixo;
//  - "reduzir movimento": nenhuma animação sem fim e rolagem sem efeito;
//  - fluxos só com o teclado: buscar, abrir um local, pedir agendamento e Meus pedidos; as janelas (diálogos)
//    prendem o foco, fecham com Esc e devolvem o foco para onde estava.
// O axe-core não faz parte do site. O teste procura em AXE_PATH (o arquivo axe.js/axe.min.js, a pasta do pacote
// ou uma pasta com node_modules/axe-core) e no node_modules; sem ele, avisa e pula os cenários do axe.
// Rodar: AXE_PATH=/caminho/node_modules/axe-core node tests/e2e-a11y.mjs
// Opcional: E2E_PORT=8788 (outra porta), ONLY="texto" (só as páginas/cenários com esse texto),
//           A11Y_JSON=arquivo.json (salva tudo o que o axe achou, também "moderate" e "minor").
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
const PORT = Number(process.env.E2E_PORT) || 8788; // E2E_PORT: outra porta para rodar em paralelo
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/+F9PQAJYwN6V0E0WwAAAABJRU5ErkJggg==', 'base64');

/* ======================= axe-core (fora do site) ======================= */
function findAxe() {
  const tries = [];
  if (process.env.AXE_PATH) {
    const p = resolve(process.env.AXE_PATH);
    tries.push(() => require.resolve(p)); // arquivo axe.js / axe.min.js ou a pasta do pacote
    tries.push(() => createRequire(join(p, 'noop.js')).resolve('axe-core')); // pasta com node_modules/axe-core
  }
  tries.push(() => require.resolve('axe-core')); // node_modules do projeto (ou NODE_PATH)
  for (const t of tries) {
    try {
      const f = t();
      if (f && existsSync(f)) {
        const min = join(dirname(f), 'axe.min.js');
        return existsSync(min) ? min : f;
      }
    } catch { /* tenta o próximo */ }
  }
  return null;
}
const AXE = findAxe();
if (!AXE) console.log('aviso - axe-core não encontrado: os cenários do axe foram pulados. Instale fora do site (npm i axe-core@4) e rode com AXE_PATH=<pasta>/node_modules/axe-core.');
// Regras: WCAG 2.0/2.1/2.2 A e AA e as boas práticas do axe.
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const GRAVE = new Set(['serious', 'critical']);

/* ======================= servidor (como o GitHub Pages) ======================= */
// O site mora em /testedoapp/ (a página 404 usa esse caminho) e o que não existe recebe o 404.html.
const server = http.createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.startsWith('/testedoapp/')) path = path.slice('/testedoapp'.length);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  let body;
  try { body = await readFile(file); } catch { body = null; }
  if (body) res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  else res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(await readFile(join(ROOT, '404.html')));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;

/* ======================= dados simulados ======================= */
const USER_ID = 'uuuuuuuu-0000-4000-8000-0000000000a1';
const C1 = 'cccccccc-0000-4000-8000-000000000001';
const PARTNER_ID = 'bbbbbbbb-0000-4000-8000-000000000011';
const CITIES = [
  { ibge: 3550308, name: 'São Paulo', uf: 'SP', total: 6548, imagem: 574, laboratorio: 524, clinica: 5161, hospital: 289 },
  { ibge: 3106200, name: 'Belo Horizonte', uf: 'MG', total: 2284, imagem: 191, laboratorio: 206, clinica: 1794, hospital: 93 },
  { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', total: 3000, imagem: 300, laboratorio: 200, clinica: 2300, hospital: 200 },
];
const MUNICIPALITIES = [{ ibge: 3550308, name: 'São Paulo', uf: 'SP', cnes_code: 355030 }, { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', cnes_code: 330455 }];
// Parceiros (nearby_clinics / busca): um verificado com preços e convênios.
const PARTNER_ROWS = [
  { id: PARTNER_ID, name: 'Imagem Paulista Verificada', kind: 'imagem', description: 'Centro de imagem.', address_line: 'Av. Paulista, 1500', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: '01310-200', lat: -23.5625, lng: -46.6565, distance_m: 300, phone: '(11) 3222-1000', whatsapp: null, email: null, website: null, specialties: ['Radiologia'], opening_hours: { seg: '07:00–19:00' }, accepts_online_booking: true, is_demo: false, exams: [{ code: 'rm', price_cents: 45000 }, { code: 'tc', price_cents: 30000 }, { code: 'rx', price_cents: null }], insurances: ['Bradesco Saúde', 'SulAmérica'], cnes: '7654321' },
];
// Estabelecimentos do cadastro oficial (nearby_establishments).
const CNES_ROWS = [
  { cnes: '2077485', name: 'Hospital Santa Exemplo', kind: 'hospital', cnes_type: 5, address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César', cep: '01409001', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5598, lng: -46.6602, distance_m: 420, location_source: 'cnes', phone: '(11) 3141-1000', shift: null, open_24h: true, sus: false, services: ['rm', 'tc', 'rx'], specialties: ['Cardiologia'], cnes_updated_at: '2026-09-15' },
  { cnes: '6543210', name: 'Laboratório Análise Paulista', kind: 'laboratorio', cnes_type: 39, address_line: 'Alameda Santos, 200', neighborhood: 'Bela Vista', cep: '01418000', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5655, lng: -46.6520, distance_m: 640, location_source: 'endereco', phone: '(11) 3000-2000', shift: 'Manhã e tarde', open_24h: false, sus: true, services: ['lab'], specialties: [], cnes_updated_at: '2026-08-02' },
  { cnes: '7000001', name: 'Centro de Imagem Augusta', kind: 'imagem', cnes_type: 39, address_line: 'Rua Augusta, 1000', neighborhood: 'Consolação', cep: '01304001', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.556, lng: -46.657, distance_m: 900, location_source: 'cnes', phone: null, shift: null, open_24h: false, sus: false, services: ['rx'], specialties: [], cnes_updated_at: '2026-09-01' },
  { cnes: '7000002', name: 'Clínica Bela Vista', kind: 'clinica', cnes_type: 36, address_line: 'Rua Treze de Maio, 50', neighborhood: 'Bela Vista', cep: '01327000', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5635, lng: -46.6450, distance_m: 1200, location_source: 'cnes', phone: '(11) 3100-0000', shift: 'Manhã', open_24h: false, sus: true, services: [], specialties: ['Clínica geral'], cnes_updated_at: '2026-09-01' },
];
const POINTS = CNES_ROWS.map(({ cnes, name, kind, lat, lng, distance_m }) => ({ cnes, name, kind, lat, lng, distance_m, total: CNES_ROWS.length }));
// Linhas das tabelas (REST): estabelecimentos (ficha do local, reivindicar, painel) e clínicas (ficha do parceiro, painel).
const ESTABLISHMENTS = [
  { cnes: '2077485', name: 'Hospital Santa Exemplo', legal_name: 'Associação Santa Exemplo', kind: 'hospital', address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César', cep: '01409001', phone: '(11) 3141-1000', shift: 'Manhã, tarde e noite', open_24h: false, sus: true, services: ['rm', 'tc'], specialties: ['Cardiologia', 'Ortopedia'], cnes_updated_at: '2026-09-15', location_source: 'cnes', location: { type: 'Point', coordinates: [-46.6602, -23.5598] }, city_ibge: 3550308, municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 } },
  { cnes: '6543210', name: 'Laboratório Análise Paulista', legal_name: null, kind: 'laboratorio', address_line: 'Alameda Santos, 200', neighborhood: 'Bela Vista', cep: '01418000', phone: null, shift: null, open_24h: false, sus: null, services: ['lab'], specialties: [], cnes_updated_at: null, location_source: null, location: null, city_ibge: 3550308, municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 } },
];
const CLINIC = {
  id: C1, name: 'Imagem Paulista', kind: 'imagem', description: null, address_line: 'Av. Paulista, 1500', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: '01310-200',
  location: { type: 'Point', coordinates: [-46.6565, -23.5625] }, phone: '(11) 3222-1000', whatsapp: null, email: null, website: null, specialties: ['Radiologia'], opening_hours: null,
  accepts_online_booking: true, status: 'published', is_demo: false, insurances: ['Amil'], cnes: '7654321', verified_at: '2026-10-01T02:30:00+00:00',
  clinic_exams: [{ exam_code: 'rm', price_cents: 45000, price_updated_at: '2026-10-01T10:00:00Z' }, { exam_code: 'tc', price_cents: null, price_updated_at: null }],
};
const PARTNER_CLINIC = {
  ...CLINIC, id: PARTNER_ID, name: 'Imagem Paulista Verificada', description: 'Centro de diagnóstico por imagem na Paulista.', whatsapp: '5511988887777', website: 'https://imagempaulista.com.br',
  opening_hours: { seg: '07:00–19:00', sab: '08:00–12:00' }, insurances: ['Bradesco Saúde', 'SulAmérica'], cnes: null,
  clinic_exams: [{ exam_code: 'tc', price_cents: 30000, price_updated_at: '2026-10-01T10:00:00Z' }, { exam_code: 'rm', price_cents: 45000, price_updated_at: '2026-10-01T01:30:00+00:00' }, { exam_code: 'rx', price_cents: null, price_updated_at: null }],
};
const CLINIC_EXAMS = [{ clinic_id: C1, exam_code: 'rm', price_cents: 45000 }, { clinic_id: C1, exam_code: 'tc', price_cents: null }];
const RATINGS = { 'cnes:2077485': { rating: 4.6, reviews: 12 } };
const REVIEWS = { 'cnes:2077485': [
  { rating: 5, comment: 'Atendimento rápido.', author_name: 'Maria Silva', created_at: '2026-10-20T13:00:00Z' },
  { rating: 4, comment: null, author_name: 'João', created_at: '2026-10-01T12:00:00Z' },
] };
// Horários livres do parceiro com agenda (amanhã e depois de amanhã, em São Paulo).
const spDay = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const SLOTS = [`${spDay(1)}T09:00:00-03:00`, `${spDay(1)}T09:30:00-03:00`, `${spDay(1)}T14:00:00-03:00`, `${spDay(2)}T08:00:00-03:00`].map((s) => new Date(s).toISOString());
// Pedidos guardados neste aparelho (Meus pedidos e Minha conta).
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const APPTS = [
  { type: 'pedido', code: 'IMED-11111111', id: ID1, token: 'a'.repeat(64), place_key: 'cnes:2077485', name: 'Hospital Santa Exemplo', exam: 'rm', items: ['Ressonância'], date: spDay(6), period: 'manha', status: 'pendente', created: '2026-10-29T12:00:00.000Z' },
  { type: 'pedido', code: 'IMED-22222222', id: ID2, token: 'b'.repeat(64), place_key: 'cnes:6543210', name: 'Laboratório Análise Paulista', exam: 'lab', items: ['Exames de laboratório'], date: spDay(-3), period: 'qualquer', status: 'pendente', created: '2026-10-15T12:00:00.000Z' },
];
const LIVE = { [ID1]: { status: 'confirmed', reviewed: false }, [ID2]: { status: 'completed', reviewed: false } };
// Pedidos no banco: da conta (Minha conta), da clínica e ao IMED (painel).
const REQUESTS = [
  { id: '55555555-5555-4555-8555-555555555555', user_id: USER_ID, clinic_id: null, created_at: '2026-10-29T15:00:00Z', place_name: 'Centro de Imagem Conta', place_source: 'cnes', place_ref: 'cnes:7000001', exam_code: 'usg', preferred_date: spDay(4), preferred_period: 'manha', slot_start: null, status: 'pending', patient_name: 'Ana Prado', patient_phone: '21998887777', patient_email: null, notes: null, place_address: 'Rua Augusta, 1000', place_phone: null, for_other: false },
  { id: 'rrrrrrrr-0000-4000-8000-000000000001', user_id: 'user-maria', clinic_id: C1, created_at: '2026-10-29T13:05:00Z', place_name: 'Imagem Paulista', place_source: 'imed', place_ref: null, exam_code: 'rm', preferred_date: spDay(5), preferred_period: 'manha', slot_start: null, status: 'pending', patient_name: 'Maria Souza', patient_phone: '11987654321', patient_email: 'maria@exemplo.com', notes: 'Tenho claustrofobia', for_other: false },
  { id: 'rrrrrrrr-0000-4000-8000-000000000002', user_id: null, clinic_id: C1, created_at: '2026-10-28T18:00:00Z', place_name: 'Imagem Paulista', place_source: 'imed', place_ref: null, exam_code: 'tc', preferred_date: spDay(3), preferred_period: 'qualquer', slot_start: `${spDay(3)}T12:00:00.000Z`, status: 'confirmed', patient_name: 'João Lima', patient_phone: '1133334444', patient_email: null, notes: null, for_other: true, other_name: 'Pedro Lima', relationship: 'filho', other_minor: true, guardian_consent: true },
];
const CLAIMS = [
  { id: 'kkkkkkkk-0000-4000-8000-000000000001', created_at: '2026-10-29T10:00:00Z', cnes: '2077485', user_id: 'x', email: 'dono@hospital.com.br', claimant_name: 'Carlos Dono', role: 'proprietario', document: '52998224725', crm: '123456-SP', phone: '11987650000', message: 'Sou o dono do hospital.', status: 'pending', decided_at: null, decision_note: null, clinic_id: null },
  { id: 'kkkkkkkk-0000-4000-8000-000000000002', created_at: '2026-10-20T11:00:00Z', cnes: '6543210', user_id: USER_ID, email: 'equipe@imed.com.br', claimant_name: 'Velho Pedido', role: 'gestor', document: '11222333000181', crm: null, phone: '1130002000', message: null, status: 'rejected', decided_at: '2026-10-21T11:00:00Z', decision_note: 'Sem vínculo', clinic_id: null },
];
const MESSAGES = [
  { id: 'mmmmmmmm-0000-4000-8000-000000000001', protocol: 'IMED-20261030-AB2C', created_at: '2026-10-30T13:00:00Z', subject: 'dados_exclusao', name: 'Maria Souza', reply_email: 'maria@exemplo.com', reply_phone: null, message: 'Quero apagar meus dados.', request_code: null, user_id: null, account_email: null, status: 'open', answered_at: null },
  { id: 'mmmmmmmm-0000-4000-8000-000000000002', protocol: 'IMED-20261029-ZZ34', created_at: '2026-10-29T18:00:00Z', subject: 'cancelamento', name: 'João Lima', reply_email: null, reply_phone: '11987654321', message: 'Quero cancelar o exame de amanhã.', request_code: 'IMED-ABC123', user_id: null, account_email: null, status: 'open', answered_at: null },
];
const REPORTS = [
  { id: 'pppppppp-0000-4000-8000-000000000001', created_at: '2026-10-30T12:00:00Z', cnes: '2077485', clinic_id: null, kind: 'telefone', note: 'Ninguém atende.', user_id: null, status: 'open', resolved_at: null,
    establishments: { name: 'Hospital Santa Exemplo', address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César', phone: '(11) 3141-1000', municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 } }, clinics: null },
];
const STATS = {
  dias: 7, de: '2026-10-24', ate: '2026-10-30', visitas: 1260,
  por_dia: [
    { dia: '2026-10-24', visitas: 0 }, { dia: '2026-10-25', visitas: 200 }, { dia: '2026-10-26', visitas: 0 }, { dia: '2026-10-27', visitas: 1000 },
    { dia: '2026-10-28', visitas: 0 }, { dia: '2026-10-29', visitas: 0 }, { dia: '2026-10-30', visitas: 60 },
  ],
  paginas: [{ pagina: '/perto.html', visitas: 700 }, { pagina: '/', visitas: 400 }],
  exames: [{ exame: 'rm', total: 12 }], tipos: [{ tipo: 'imagem', total: 4 }], cidades: [{ cidade: 'SP/São Paulo', total: 9 }], pedidos: [{ exame: 'rm', total: 2 }],
  eventos: { busca_exame: 15, busca_tipo: 4, busca_cidade: 10, pedido_enviado: 3 },
};
const SCHEDULES = [
  { id: 's1', clinic_id: C1, weekday: 1, start_time: '08:00:00', end_time: '12:00:00', slot_minutes: 30, exam_codes: [] },
  { id: 's2', clinic_id: C1, weekday: 3, start_time: '13:00:00', end_time: '17:00:00', slot_minutes: 20, exam_codes: ['rm'] },
];
const BLOCKS = [{ id: 'bbbbbbbb-0000-4000-8000-000000000001', clinic_id: C1, starts_at: `${spDay(10)}T03:00:00+00:00`, ends_at: `${spDay(11)}T03:00:00+00:00`, reason: 'Feriado' }];
// 130 estabelecimentos de São Paulo para as páginas da cidade.
const KINDS = ['clinica', 'laboratorio', 'imagem', 'hospital'];
const CITY_ROWS = Array.from({ length: 130 }, (_, i) => ({
  cnes: String(2000000 + i), name: `Estabelecimento ${String(i + 1).padStart(3, '0')}`, kind: KINDS[i % 4], address_line: `Rua Exemplo, ${i + 10}`, neighborhood: 'Bela Vista', cep: '01310100',
  phone: i % 3 === 0 ? '(11) 3141-1000' : null, shift: i % 5 === 0 ? 'Manhã e tarde' : null, open_24h: i % 4 === 3, sus: i % 2 === 0, services: [], lat: -23.56 + i / 10000, lng: -46.65,
}));

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });
// Filtros do PostgREST usados pelas páginas: eq, neq, in, is.null, gte, lte, ilike.
function applyFilters(rows, q) {
  let out = rows;
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'offset'].includes(k) || k.includes('.')) continue;
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    if (op === 'eq') out = out.filter((r) => String(r[k]) === val);
    else if (op === 'neq') out = out.filter((r) => String(r[k]) !== val);
    else if (op === 'is' && val === 'null') out = out.filter((r) => r[k] == null);
    else if (op === 'gte') out = out.filter((r) => r[k] == null || String(r[k]) >= val);
    else if (op === 'lte') out = out.filter((r) => r[k] == null || String(r[k]) <= val);
    else if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(','); out = out.filter((r) => set.includes(String(r[k]))); }
    else if (op === 'ilike') { const t = val.replace(/^\*|\*$/g, '').toLowerCase(); out = out.filter((r) => String(r[k]).toLowerCase().includes(t)); }
  }
  const lim = Number(q.get('limit') || 0);
  return lim ? out.slice(0, lim) : out;
}

// Banco, login e funções simulados (tudo o que as páginas pedem ao Supabase).
async function mockSupabase(context, { admin = false, member = false } = {}) {
  const log = [];
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const path = url.pathname;
    const q = url.searchParams;
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }
    log.push({ method: req.method(), path, q: url.search, body });
    const logged = /^Bearer tok-/.test(req.headers().authorization || '');
    if (path === '/auth/v1/otp') return json(route, {});
    if (path === '/auth/v1/user') return logged ? json(route, { id: USER_ID, email: 'equipe@imed.com.br' }) : json(route, { msg: 'invalid' }, 401);
    if (path === '/auth/v1/token') return json(route, { access_token: 'tok-novo', refresh_token: 'ref2', expires_in: 3600, user: { id: USER_ID, email: 'equipe@imed.com.br' } });
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });
    if (path === '/functions/v1/clinicas-proximas') {
      if (body?.action === 'search') return json(route, { ok: true, provider: 'osm', radius_m: body.radius_m, warnings: [], imed: PARTNER_ROWS, cnes: CNES_ROWS, places: [], coverage: { status: 'done', city: 'São Paulo', uf: 'SP' } });
      if (body?.action === 'geocode') return json(route, { ok: true, lat: -23.5617698, lng: -46.6553299, label: 'Avenida Paulista, Bela Vista, São Paulo - SP', precision: 'cep', provider: 'osm' });
      return json(route, { ok: true, provider: 'osm' });
    }
    const rest = path.replace('/rest/v1/', '');
    if (req.method() === 'POST' && !rest.startsWith('rpc/')) return route.fulfill({ status: 201, body: '', headers: CORS });
    switch (rest) {
      case 'rpc/imported_cities': return json(route, CITIES);
      case 'rpc/nearby_establishments': return json(route, (body?.p_offset ? [] : CNES_ROWS).map((r) => ({ ...r, total: CNES_ROWS.length })));
      case 'rpc/establishment_points': return json(route, POINTS);
      case 'rpc/nearby_clinics': return json(route, PARTNER_ROWS);
      case 'rpc/request_status': return json(route, (body?.p_ids ?? []).filter((id) => LIVE[id]).map((id) => ({ id, ...LIVE[id] })));
      case 'rpc/tele_doctors_online': return json(route, []);
      case 'rpc/cnes_last_update': return json(route, '2026-10-30');
      case 'rpc/track': return json(route, true);
      case 'rpc/place_ratings': return json(route, (body?.p_keys ?? []).filter((k) => RATINGS[k]).map((k) => ({ place_key: k, ...RATINGS[k] })));
      case 'rpc/place_reviews': return json(route, (REVIEWS[body?.p_key] ?? []).slice(0, body?.p_limit ?? 10));
      case 'rpc/clinics_with_schedule': return json(route, (body?.p_ids ?? []).filter((id) => id === PARTNER_ID).map((id) => ({ clinic_id: id })));
      case 'rpc/available_slots': return json(route, SLOTS.map((s) => ({ slot_start: s })));
      case 'rpc/city_establishments': {
        const all = CITY_ROWS.filter((e) => !body?.p_kind || e.kind === body.p_kind);
        return json(route, all.slice(body?.p_offset ?? 0, (body?.p_offset ?? 0) + (body?.p_limit ?? 50)).map((e) => ({ ...e, total: all.length })));
      }
      case 'rpc/is_imed_admin': return json(route, admin);
      case 'rpc/admin_stats': return admin ? json(route, STATS) : json(route, { code: '42501', message: 'forbidden' }, 403);
      case 'rpc/send_contact': return json(route, 'IMED-20261030-AB2C');
      case 'clinic_members': return json(route, member && logged ? [{ clinic_id: C1, role: 'owner' }] : []);
      case 'clinics': return json(route, applyFilters([CLINIC, PARTNER_CLINIC], q));
      case 'clinic_exams': return json(route, applyFilters(CLINIC_EXAMS, q));
      case 'establishments': return json(route, applyFilters(ESTABLISHMENTS, q));
      case 'municipalities': return json(route, applyFilters(MUNICIPALITIES, q));
      case 'appointment_requests': return json(route, logged ? applyFilters(REQUESTS, q) : []);
      case 'establishment_claims': return json(route, logged ? applyFilters(CLAIMS, q) : []);
      case 'claim_checks': return json(route, []);
      case 'contact_messages': return json(route, admin ? applyFilters(MESSAGES, q) : []);
      case 'place_reports': return json(route, admin ? applyFilters(REPORTS, q) : []);
      case 'clinic_schedules': return json(route, applyFilters(SCHEDULES, q));
      case 'clinic_blocks': return json(route, applyFilters(BLOCKS, q));
      default:
        if (rest.startsWith('rpc/')) return json(route, 'ok');
        return json(route, []);
    }
  });
  return log;
}

// mobile: celular de 390 px com toque. motion: 'reduce' liga o "reduzir movimento" do aparelho.
// session: entra na conta (equipe do IMED); admin/member: o que essa conta é no banco. appts: pedidos do aparelho.
async function newPage(browser, { mobile = false, motion = 'no-preference', session = false, admin = false, member = false, appts = APPTS, geo = true } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 860 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block', reducedMotion: motion, bypassCSP: true, acceptDownloads: true,
    ...(geo ? { geolocation: { latitude: -23.561234, longitude: -46.656789, accuracy: 30 }, permissions: ['geolocation'] } : {}),
  });
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await context.route(/overpass/, (r) => json(r, { elements: [] }));
  await context.addInitScript(([s, list]) => {
    try {
      localStorage.setItem('imed_lgpd', '1');
      if (sessionStorage.getItem('__a11y')) return;
      sessionStorage.setItem('__a11y', '1');
      if (s) localStorage.setItem('imed_session', JSON.stringify(s));
      if (list) localStorage.setItem('imed_appts', JSON.stringify(list));
    } catch { /* sem armazenamento */ }
  }, [session ? { access_token: 'tok-a11y', refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: USER_ID, email: 'equipe@imed.com.br' } } : null, appts]);
  const log = await mockSupabase(context, { admin, member });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, log, errors };
}

/* ======================= páginas ======================= */
// open: o que fazer depois de abrir (esperar os dados, abrir a ficha, trocar de aba...).
const waitIdle = (page) => page.waitForLoadState('networkidle').catch(() => {});
// Página inicial: o mapa de clínicas reais só carrega quando chega perto da tela.
async function openHome(page) {
  await page.locator('#reais').scrollIntoViewIfNeeded();
  await page.waitForSelector('#realList li b');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
}
const PAINEL_TABS = ['pedidos', 'agenda', 'dados', 'exames', 'cadastros', 'concierge', 'mensagens', 'avisos', 'visitas'];
const PAGES = [
  { name: 'Início', url: 'index.html', open: openHome },
  { name: 'Início (modo leve)', url: 'index.html', motion: 'reduce', open: async (p) => { await p.waitForSelector('#heroLite li a'); await openHome(p); } },
  { name: 'Início · Meus pedidos', url: 'index.html#agenda', open: async (p) => { await p.waitForSelector('.appt'); } },
  { name: 'Perto de mim', url: 'perto.html?usar=localizacao', open: async (p) => { await p.waitForSelector('.pc'); await p.waitForFunction(() => !document.querySelector('.pt-more')); } },
  { name: 'Perto · ficha', url: 'perto.html?usar=localizacao', open: async (p) => { await p.waitForSelector('.pc'); await p.click('.pc[data-id] >> nth=0'); await p.waitForSelector('.sh-ov.open'); await p.waitForTimeout(300); } },
  { name: 'Perto · pedido', url: 'perto.html?usar=localizacao', open: async (p) => { await p.waitForSelector('.pc:not(.imed)'); await p.click('.pc:not(.imed) >> nth=0'); await p.waitForSelector('.sh-ov.open [data-book]'); await p.click('.sh-ov.open [data-book]'); await p.waitForSelector('#bookForm'); await p.waitForTimeout(300); } },
  { name: 'Local (cadastro oficial)', url: 'local.html?cnes=2077485', open: async (p) => { await p.waitForSelector('#app[aria-busy="false"] h1'); await waitIdle(p); } },
  { name: 'Local (parceiro com agenda)', url: `local.html?id=${PARTNER_ID}`, open: async (p) => { await p.waitForSelector('.sl-day'); await waitIdle(p); } },
  { name: 'Minha conta', url: 'conta.html', open: async (p) => { await p.waitForSelector('.ct-order'); await waitIdle(p); } },
  { name: 'Minha conta (com login)', url: 'conta.html', session: true, open: async (p) => { await p.waitForSelector('#signedIn:not([hidden])'); await p.waitForSelector('.ct-order'); await waitIdle(p); } },
  { name: 'Área da clínica', url: 'painel.html', open: async (p) => { await p.waitForSelector('#authBox input'); } },
  ...PAINEL_TABS.map((tab) => ({
    name: `Área da clínica · ${tab}`, url: 'painel.html', session: true, admin: true, member: true,
    open: async (p) => { await p.waitForSelector(`#tab-${tab}`); await p.click(`#tab-${tab}`); await waitIdle(p); await p.waitForTimeout(250); },
  })),
  { name: 'Reivindicar', url: 'reivindicar.html?cnes=2077485', open: async (p) => { await p.waitForSelector('.cl-place h3'); } },
  { name: 'Reivindicar (com login)', url: 'reivindicar.html?cnes=2077485', session: true, open: async (p) => { await p.waitForSelector('#s3:not([hidden])'); await waitIdle(p); } },
  { name: 'Quem somos', url: 'sobre.html' },
  { name: 'Termos', url: 'termos.html' },
  { name: 'Privacidade', url: 'privacidade.html' },
  { name: 'Para clínicas', url: 'parceiros.html', open: async (p) => { await p.waitForSelector('#numeros:not([hidden])'); } },
  { name: 'Como funciona', url: 'como-funciona.html' },
  { name: 'Acessibilidade', url: 'acessibilidade.html' },
  { name: 'Fale com o IMED', url: 'contato.html' },
  { name: 'Página 404', url: 'testedoapp/nao-existe' },
  { name: 'Guias de exames', url: 'exames/' },
  { name: 'Guia: Raio-X', url: 'exames/raio-x.html' },
  { name: 'Cidades', url: 'cidades/' },
  { name: 'Cidade: São Paulo', url: 'cidades/sp/sao-paulo/', open: async (p) => { await waitIdle(p); } },
  { name: 'Tipo: Clínicas em São Paulo', url: 'cidades/sp/sao-paulo/clinicas.html', open: async (p) => { await waitIdle(p); } },
];

/* ======================= checagens ======================= */
async function runAxe(page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (tags) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] });
    const pick = (list) => list.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 220), why: (n.failureSummary || n.any?.[0]?.message || '').replace(/\s+/g, ' ').trim().slice(0, 300) })) }));
    return { violations: pick(r.violations), incomplete: pick(r.incomplete) };
  }, AXE_TAGS);
}

// Texto sobre fundo em degradê (o axe não consegue medir e deixa "para revisar"): o contraste do texto com
// cada cor do degradê precisa ser de 4,5:1 (3:1 para letra grande). Cor com transparência é misturada
// com o fundo de baixo.
async function gradientContrast(page) {
  return page.evaluate(() => {
    const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [r, g, b, a]; };
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const mix = (top, under) => top.slice(0, 3).map((c, i) => c * (top[3] ?? 1) + under[i] * (1 - (top[3] ?? 1)));
    // Camadas de um background-image (separadas pelas vírgulas de fora dos parênteses), de baixo para cima.
    const layersOf = (img) => {
      const out = [];
      let depth = 0, cur = '';
      for (const ch of img) {
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
      }
      out.push(cur);
      return out.reverse();
    };
    // Cores possíveis do fundo em um elemento (só os extremos: o mais claro e o mais escuro), somando as camadas
    // de degradê, a cor de fundo e o que está embaixo (os pais). null = foto de fundo (não dá para medir).
    const bgAt = (node) => {
      if (!node || node === document.documentElement) return [[255, 255, 255]];
      const cs = getComputedStyle(node);
      if (/url\(/.test(cs.backgroundImage)) return null;
      const own = parse(cs.backgroundColor);
      let colors;
      if (own && own[3] > 0.95) colors = [own.slice(0, 3)];
      else {
        colors = bgAt(node.parentElement);
        if (!colors) return null;
        if (own && own[3] > 0) colors = colors.map((b) => mix(own, b));
      }
      if (/gradient/.test(cs.backgroundImage)) {
        for (const layer of layersOf(cs.backgroundImage)) {
          const stops = [...layer.matchAll(/rgba?\([^)]+\)/g)].map((m) => parse(m[0]));
          if (!stops.length) continue;
          colors = colors.flatMap((b) => stops.map((st) => mix(st, b)));
        }
      }
      colors.sort((a, b) => lum(a) - lum(b));
      return [colors[0], colors[colors.length - 1]];
    };
    const out = [];
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent.trim()) continue;
      const el = t.parentElement;
      if (!el || seen.has(el) || el.closest('[aria-hidden="true"], .sr, .rd-sr, .skip')) continue;
      seen.add(el);
      if (!(el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ?? true)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // Só quando há degradê no caminho até o primeiro fundo sólido (o resto o axe já mede).
      let grad = false;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (/gradient/.test(cs.backgroundImage)) { grad = true; break; }
        const bg = parse(cs.backgroundColor);
        if (bg && bg[3] > 0.95) break;
      }
      if (!grad) continue;
      const colors = bgAt(el);
      if (!colors) continue;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      if (!fg || fg[3] < 0.1) continue; // texto transparente (letra com degradê): fora desta conta
      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const min = Math.min(...colors.map((bg) => ratio(fg[3] < 1 ? mix(fg, bg) : fg, bg)));
      if (min < (large ? 3 : 4.5) - 0.01) {
        const name = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/)[0]}` : ''}`;
        out.push(`${name} "${t.textContent.trim().slice(0, 30)}" ${min.toFixed(2)}:1`);
      }
    }
    return out;
  });
}

// Alvos de toque (celular): pelo menos 44 x 44 px. Não vale para link no meio de uma frase (exceção da WCAG),
// para os pontos do mapa (a lista ao lado faz o mesmo) e para o que está escondido.
// Caixas de marcar e opções contam junto com o texto (o rótulo também recebe o toque).
async function smallTargets(page) {
  return page.evaluate(() => {
    const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [role=checkbox], [role=radio], [role=switch], [tabindex]:not([tabindex="-1"])';
    const out = [];
    const seen = new Set();
    const vis = (el) => el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ?? true;
    const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.name || el.id || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const isInline = (el) => {
      if (el.tagName !== 'A' || getComputedStyle(el).display !== 'inline') return false;
      let b = el.parentElement;
      while (b && getComputedStyle(b).display === 'inline') b = b.parentElement;
      if (!b) return false;
      const own = (el.textContent || '').trim().length;
      return (b.textContent || '').replace(/\s+/g, ' ').trim().length > own + 3;
    };
    for (const el of document.querySelectorAll(SEL)) {
      if (seen.has(el) || el.closest('[aria-hidden="true"], [inert], .leaflet-marker-pane, .leaflet-control-attribution, .skip')) continue;
      seen.add(el);
      if (el.tabIndex < 0 && !el.matches('a[href], button, input, select, textarea, summary')) continue;
      if (!vis(el)) continue;
      let r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right < 0 || r.bottom < -5000) continue;
      if (isInline(el)) continue;
      if (el.matches('input[type=checkbox], input[type=radio]')) {
        const lab = el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
        if (lab) { const l = lab.getBoundingClientRect(); r = { width: Math.max(r.width, l.width), height: Math.max(r.height, l.height) }; }
      }
      if (r.width < 43.5 || r.height < 43.5) {
        const cls = (el.className && typeof el.className === 'string') ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
        out.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls} "${name(el)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  });
}

// Campos com letra menor que 16 px (o iPhone dá zoom ao tocar).
async function smallInputs(page) {
  return page.evaluate(() => [...document.querySelectorAll('input, select, textarea')]
    .filter((el) => !/^(checkbox|radio|hidden|range|button|submit|reset|image|file|color)$/.test(el.type))
    .filter((el) => (el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ?? true) && el.getBoundingClientRect().width > 0 && !el.closest('[aria-hidden="true"]'))
    .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
    .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.name ? `[name=${el.name}]` : ''} ${getComputedStyle(el).fontSize}`));
}

// Percorre a página com Tab e confere que cada parada tem foco visível e não fica atrás do topo/menu fixo.
async function focusWalk(page, max = 160) {
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  const stops = [];
  const problems = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate((i) => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { end: true };
      if (el.dataset.a11yStop) return { again: true, id: el.dataset.a11yStop };
      el.dataset.a11yStop = String(i);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(el.getAttribute('aria-label') || el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
      const focused = { outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0, shadow: cs.boxShadow, bg: cs.backgroundColor, border: cs.borderColor, deco: cs.textDecorationLine, color: cs.color };
      // Escondido atrás de algo fixo (topo, menu de baixo, aviso)?
      let covered = null;
      if (r.width > 0 && r.height > 0) {
        const pts = [[r.left + r.width / 2, r.top + Math.min(r.height / 2, 10)], [r.left + r.width / 2, r.bottom - Math.min(r.height / 2, 10)]];
        for (const [x, y] of pts) {
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
          const top = document.elementFromPoint(x, y);
          if (top && !el.contains(top) && !top.contains(el) && !(top.closest('label') && top.closest('label').contains(el)) && !(el.id && top.closest(`label[for="${CSS.escape(el.id)}"]`))) {
            const fixed = (() => { for (let n = top; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return n; } return null; })();
            if (fixed) { covered = `${fixed.tagName.toLowerCase()}${fixed.className && typeof fixed.className === 'string' ? `.${fixed.className.trim().split(/\s+/)[0]}` : ''}`; break; }
          }
        }
      }
      const off = r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth;
      return { label, focused, covered, off, w: r.width, h: r.height };
    }, i);
    if (info.end || info.again) break;
    stops.push(info);
  }
  // Compara com o mesmo elemento sem foco: o foco precisa mudar algo visível (contorno, sombra, fundo, borda).
  const plain = await page.evaluate(() => {
    document.activeElement?.blur?.();
    return [...document.querySelectorAll('[data-a11y-stop]')].map((el) => {
      const cs = getComputedStyle(el);
      return { i: Number(el.dataset.a11yStop), shadow: cs.boxShadow, bg: cs.backgroundColor, border: cs.borderColor, deco: cs.textDecorationLine, color: cs.color };
    });
  });
  const byI = new Map(plain.map((p) => [p.i, p]));
  stops.forEach((s, i) => {
    const p = byI.get(i);
    const f = s.focused;
    const changed = f.outline || (f.shadow !== 'none' && f.shadow !== p?.shadow) || f.bg !== p?.bg || f.border !== p?.border || f.deco !== p?.deco;
    if (!changed && s.w > 0) problems.push(`sem foco visível: ${s.label}`);
    if (s.covered) problems.push(`foco escondido atrás de ${s.covered}: ${s.label}`);
    if (s.off && s.w > 0) problems.push(`foco fora da tela: ${s.label}`);
  });
  await page.evaluate(() => document.querySelectorAll('[data-a11y-stop]').forEach((el) => el.removeAttribute('data-a11y-stop')));
  return { count: stops.length, problems };
}

/* ======================= execução ======================= */
const results = [];
async function scenario(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  try { await fn(); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 6).join('\n  ')}`); }
}

const browser = await chromium.launch();
const audit = []; // { page, device, axe: [...], targets: [...], inputs: [...], focus: {...}, lang }

async function auditPage(def, mobile) {
  const { context, page, errors } = await newPage(browser, { mobile, motion: def.motion, session: def.session, admin: def.admin, member: def.member });
  try {
    await page.goto(BASE + def.url);
    if (def.open) await def.open(page); else await waitIdle(page);
    const row = { page: def.name, device: mobile ? 'celular' : 'computador', errors };
    row.lang = await page.evaluate(() => document.documentElement.lang);
    const ax = AXE ? await runAxe(page) : null;
    row.axe = ax?.violations ?? null;
    row.incomplete = ax?.incomplete ?? null;
    row.gradient = await gradientContrast(page);
    row.targets = mobile ? await smallTargets(page) : [];
    row.inputs = mobile ? await smallInputs(page) : [];
    // A ficha e o pedido são janelas: o foco fica preso nelas, então o percurso com Tab é o de dentro da janela.
    row.focus = await focusWalk(page);
    audit.push(row);
  } finally {
    await context.close();
  }
}

// Duas páginas por vez (A11Y_PAR muda isso); a ordem do relatório segue a lista.
const jobs = PAGES.filter((def) => !ONLY || ONLY.test(def.name) || ONLY.test('auditoria')).flatMap((def) => [[def, false], [def, true]]);
const PAR = Math.max(1, Number(process.env.A11Y_PAR) || 2);
let next = 0;
await Promise.all(Array.from({ length: PAR }, async () => {
  while (next < jobs.length) {
    const [def, mobile] = jobs[next++];
    try { await auditPage(def, mobile); }
    catch (err) { audit.push({ page: def.name, device: mobile ? 'celular' : 'computador', fail: err.message.split('\n')[0] }); }
  }
}));
const order = (r) => PAGES.findIndex((d) => d.name === r.page) * 2 + (r.device === 'celular' ? 1 : 0);
audit.sort((a, b) => order(a) - order(b));

// Resumo por página (para o relatório): violações do axe por gravidade e problemas das checagens próprias.
const count = (row, impacts) => (row.axe ?? []).filter((v) => impacts.includes(v.impact)).reduce((s, v) => s + v.nodes.length, 0);
console.log('\npágina | aparelho | axe graves | axe outros | degradê | alvos <44 | campos <16 | foco');
for (const r of audit) {
  if (r.fail) { console.log(`${r.page} | ${r.device} | ERRO: ${r.fail}`); continue; }
  console.log(`${r.page} | ${r.device} | ${count(r, ['serious', 'critical'])} | ${count(r, ['moderate', 'minor'])} | ${r.gradient.length} | ${r.targets.length} | ${r.inputs.length} | ${r.focus.problems.length} (${r.focus.count} paradas)`);
}
if (process.env.A11Y_JSON) await writeFile(process.env.A11Y_JSON, JSON.stringify(audit, null, 1));

await scenario('auditoria: todas as páginas abriram sem erro', async () => {
  const bad = audit.filter((r) => r.fail || r.errors?.length).map((r) => `${r.page} (${r.device}): ${r.fail || r.errors.join(' | ')}`);
  assert.deepEqual(bad, []);
});

await scenario('auditoria: idioma pt-BR em todas as páginas', async () => {
  const bad = audit.filter((r) => !r.fail && r.lang !== 'pt-BR').map((r) => `${r.page}: lang="${r.lang}"`);
  assert.deepEqual(bad, []);
});

if (AXE) {
  await scenario('auditoria: axe sem violação grave ou crítica (computador e celular)', async () => {
    const bad = [];
    for (const r of audit.filter((x) => !x.fail)) {
      for (const v of r.axe.filter((x) => GRAVE.has(x.impact))) bad.push(`${r.page} (${r.device}) ${v.impact} ${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target).join(', ')}`);
    }
    assert.deepEqual(bad, []);
  });
} else {
  console.log('pulado - auditoria: axe sem violação grave ou crítica (axe-core não encontrado)');
}

await scenario('auditoria: texto sobre degradê (botões) com contraste de 4,5:1', async () => {
  const bad = audit.filter((r) => !r.fail && r.gradient.length).map((r) => `${r.page} (${r.device}): ${r.gradient.join('; ')}`);
  assert.deepEqual(bad, []);
});

await scenario('auditoria: celular com alvos de toque de 44 px e campos com letra de 16 px', async () => {
  const bad = audit.filter((r) => !r.fail && (r.targets.length || r.inputs.length)).map((r) => `${r.page}: ${[...r.targets, ...r.inputs].join('; ')}`);
  assert.deepEqual(bad, []);
});

await scenario('auditoria: foco visível e não escondido em todas as paradas do Tab', async () => {
  const bad = audit.filter((r) => !r.fail && r.focus.problems.length).map((r) => `${r.page} (${r.device}): ${r.focus.problems.join('; ')}`);
  assert.deepEqual(bad, []);
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
