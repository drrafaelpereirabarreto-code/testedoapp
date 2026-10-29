// Regras da busca de clínicas do IMED que rodam no navegador: classificação dos estabelecimentos,
// distância, junção das fontes, filtros, ordenação e validação do pedido de agendamento.
// Não mexe na página, então também é testado no Node (tests/geo-core.test.mjs).

export const EXAMS = {
  rx: { n: 'Raio-X', slug: 'raio-x' },
  usg: { n: 'Ultrassom', slug: 'ultrassom' },
  tc: { n: 'Tomografia', slug: 'tomografia' },
  rm: { n: 'Ressonância', slug: 'ressonancia-magnetica' },
  mamo: { n: 'Mamografia', slug: 'mamografia' },
  dens: { n: 'Densitometria', slug: 'densitometria-ossea' },
  ecg: { n: 'Eletrocardiograma', slug: 'eletrocardiograma' },
  eco: { n: 'Ecocardiograma', slug: 'ecocardiograma' },
  lab: { n: 'Exames de laboratório', slug: null },
};

export const KINDS = {
  imagem: { n: 'Diagnóstico por imagem', icon: 'fa-x-ray' },
  laboratorio: { n: 'Laboratório', icon: 'fa-flask' },
  clinica: { n: 'Clínica', icon: 'fa-stethoscope' },
  hospital: { n: 'Hospital', icon: 'fa-hospital' },
};

export const RADII = [1000, 2000, 5000, 10000, 20000];

// Faixas de preço em centavos: [mínimo, máximo]. Só valem para preços informados pelas clínicas.
export const PRICE_RANGES = {
  ate100: [null, 10000],
  '100a300': [10000, 30000],
  '300a600': [30000, 60000],
  acima600: [60000, null],
};

const EXAM_PATTERNS = [
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
const IMAGING_RE = /imagem|radiolog|diagn[oó]stic|tomogra|resson|ultrass|ultra-s|mamogra|raio[\s-]?x|radiograf|densitom|medicina nuclear|pet[\s-]?ct/i;
const LAB_RE = /laborat|an[aá]lises cl[ií]nicas|patologia cl[ií]nica|\blab\b/i;
const EXCLUDE_RE = /odonto|dent[aá]ri|dentista|veterin|est[eé]tica|farm[aá]cia|drogaria/i;
const GOOGLE_EXCLUDE = ['dentist', 'dental_clinic', 'veterinary_care', 'pharmacy', 'drugstore', 'beauty_salon', 'spa'];

const SPECIALTY_PT = {
  general: 'Clínico geral', family_medicine: 'Medicina de família', internal: 'Clínica médica',
  cardiology: 'Cardiologia', radiology: 'Radiologia', diagnostic_radiology: 'Radiologia', nuclear: 'Medicina nuclear',
  orthopaedics: 'Ortopedia', gynaecology: 'Ginecologia', obstetrics: 'Obstetrícia', paediatrics: 'Pediatria',
  dermatology: 'Dermatologia', ophthalmology: 'Oftalmologia', otolaryngology: 'Otorrinolaringologia',
  urology: 'Urologia', neurology: 'Neurologia', psychiatry: 'Psiquiatria', endocrinology: 'Endocrinologia',
  gastroenterology: 'Gastroenterologia', oncology: 'Oncologia', pulmonology: 'Pneumologia', nephrology: 'Nefrologia',
  rheumatology: 'Reumatologia', angiology: 'Angiologia', vascular_surgery: 'Cirurgia vascular', surgery: 'Cirurgia',
  emergency: 'Pronto atendimento', mastology: 'Mastologia', physiotherapy: 'Fisioterapia', psychology: 'Psicologia',
};
const SPECIALTY_BY_NAME = [
  ['Cardiologia', /cardio/i], ['Ortopedia', /ortoped|\bortop/i], ['Ginecologia', /gineco|sa[uú]de da mulher/i],
  ['Pediatria', /pediatr|infantil/i], ['Dermatologia', /dermat/i], ['Oftalmologia', /oftalm|\bolhos\b/i],
  ['Otorrinolaringologia', /otorrino/i], ['Urologia', /urolog/i], ['Neurologia', /neuro/i], ['Oncologia', /oncolog/i],
  ['Radiologia', /radiolog|diagn[oó]stico por imagem/i], ['Mastologia', /mastolog/i],
];
const DAY_PT = { Mo: 'seg', Tu: 'ter', We: 'qua', Th: 'qui', Fr: 'sex', Sa: 'sáb', Su: 'dom', PH: 'feriados' };
const DAY_LABEL = { seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado', dom: 'Domingo', feriados: 'Feriados' };

export function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Três casas decimais: cerca de 110 m. É a precisão usada para buscar, sem guardar onde a pessoa está.
export const roundCoord = (v, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;

export function normName(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(clinica|centro|de|da|do|das|dos|e|ltda|me|eireli|s\/?a|unidade)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function examsFromText(text, kind) {
  const out = EXAM_PATTERNS.filter(([, re]) => re.test(text)).map(([code]) => code);
  if (kind === 'laboratorio' && !out.includes('lab')) out.push('lab');
  return out;
}

const specialtiesFromName = (name) => SPECIALTY_BY_NAME.filter(([, re]) => re.test(name)).map(([label]) => label);

export function classifyOsm(tags) {
  const name = tags.name ?? '';
  const spec = (tags['healthcare:speciality'] ?? '').toLowerCase();
  if (EXCLUDE_RE.test(name) || /dentist|orthodontics|veterinary/.test(spec) || tags.healthcare === 'dentist') return null;
  let kind;
  if (tags.amenity === 'hospital' || tags.healthcare === 'hospital') kind = 'hospital';
  else if (['laboratory', 'sample_collection'].includes(tags.healthcare) || LAB_RE.test(name) || /biology|blood_check|clinical_pathology/.test(spec)) kind = 'laboratorio';
  else if (tags.healthcare === 'radiology' || /radiology|nuclear/.test(spec) || IMAGING_RE.test(name)) kind = 'imagem';
  else kind = 'clinica';
  const services = examsFromText(`${name} ${tags.description ?? ''} ${spec.replace(/_/g, ' ')}`, kind);
  const fromTags = spec.split(/[;,]/).map((s) => SPECIALTY_PT[s.trim()]).filter(Boolean);
  const specialties = [...new Set([...fromTags, ...specialtiesFromName(name)])];
  return { kind, services, specialties };
}

export function formatOsmHours(raw) {
  if (raw.trim() === '24/7') return 'Aberto 24 horas';
  return raw
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => DAY_PT[d] ?? d)
    .replace(/\boff\b/g, 'fechado')
    .replace(/(\d{2}:\d{2})-(\d{2}:\d{2})/g, '$1–$2')
    .replace(/([a-zá]{3})-([a-zá]{3})/g, '$1–$2')
    .replace(/;\s*/g, ' · ');
}

export function formatClinicHours(h) {
  if (!h) return null;
  if (Array.isArray(h)) return h.map(String).filter(Boolean);
  if (typeof h === 'object') {
    const lines = Object.entries(h).map(([d, v]) => `${DAY_LABEL[d] ?? d}: ${String(v)}`);
    return lines.length ? lines : null;
  }
  return null;
}

export function safeUrl(v) {
  if (!v) return null;
  const s = String(v).split(';')[0].trim();
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

const firstOf = (v) => (v ? String(v).split(';')[0].trim() || null : null);

function whatsappDigits(v) {
  const d = (firstOf(v) ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

function osmAddress(t) {
  const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ');
  const parts = [street, t['addr:suburb'] ?? t['addr:neighbourhood'], t['addr:city']].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

// Retângulo que contém o círculo de busca. Consultas por retângulo são bem mais leves no Overpass.
export function bboxAround(o, radius) {
  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.cos((o.lat * Math.PI) / 180));
  return [o.lat - dLat, o.lng - dLng, o.lat + dLat, o.lng + dLng].map((v) => v.toFixed(5));
}

// ".{1,2}" no lugar da letra acentuada funciona tanto em servidores que comparam por caractere quanto por byte.
const NAME_HINT = '["name"~"cl.{1,2}nica|diagn.{1,2}st|imagem|laborat|radiolog|tomogra|resson|ultrass|centro m.{1,2}dico|policl.{1,2}nica|cardio",i]';

export function overpassQuery(o, radius) {
  const [s, w, n, e] = bboxAround(o, radius);
  return `[out:json][timeout:25][bbox:${s},${w},${n},${e}];(`
    + 'nwr["amenity"~"^(clinic|hospital)$"];'
    + 'nwr["healthcare"~"^(laboratory|sample_collection|radiology|clinic|centre|hospital)$"];'
    + `nwr["amenity"="doctors"]${NAME_HINT};`
    + `nwr["healthcare"="doctor"]${NAME_HINT};`
    + ');out center tags 1000;';
}

export function parseOverpass(json, origin, radius = Infinity) {
  const seen = new Set();
  const out = [];
  for (const e of json?.elements ?? []) {
    const t = e.tags ?? {};
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    if (!t.name || typeof lat !== 'number' || typeof lng !== 'number') continue;
    const cls = classifyOsm(t);
    if (!cls) continue;
    const distance = Math.round(haversine(origin, { lat, lng }));
    if (distance > radius) continue;
    const key = `${normName(t.name)}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `osm:${e.type[0]}${e.id}`, clinic_id: null, source: 'osm', name: t.name.trim(), kind: cls.kind,
      address: osmAddress(t), cep: t['addr:postcode'] ?? null, lat, lng, distance_m: distance,
      phone: firstOf(t.phone ?? t['contact:phone']), whatsapp: whatsappDigits(t['contact:whatsapp']),
      email: firstOf(t.email ?? t['contact:email']), website: safeUrl(t.website ?? t['contact:website']),
      maps_url: `https://www.openstreetmap.org/${e.type}/${e.id}`, description: null,
      services: cls.services, services_source: cls.services.length ? 'mapa' : null, specialties: cls.specialties,
      hours: t.opening_hours ? [formatOsmHours(t.opening_hours)] : null, hours_source: t.opening_hours ? 'osm' : null,
      prices: null, accepts_online_booking: false, is_demo: false,
    });
  }
  return out.sort((a, b) => a.distance_m - b.distance_m).slice(0, 200);
}

// Estabelecimento do Google Places vindo do servidor (a chave nunca chega ao navegador).
export function normalizeGoogle(raw, origin) {
  const types = raw.types ?? [];
  if (types.some((t) => GOOGLE_EXCLUDE.includes(t)) || EXCLUDE_RE.test(raw.name)) return null;
  let kind;
  if (types.includes('hospital')) kind = 'hospital';
  else if (types.includes('medical_lab') || LAB_RE.test(raw.name)) kind = 'laboratorio';
  else if (raw.hint === 'imagem' || IMAGING_RE.test(raw.name)) kind = 'imagem';
  else kind = 'clinica';
  const services = examsFromText(raw.name, kind);
  const hours = raw.hours?.length ? raw.hours : null;
  return {
    id: raw.id, clinic_id: null, source: 'google', name: raw.name, kind, address: raw.address ?? null, cep: null,
    lat: raw.lat, lng: raw.lng, distance_m: Math.round(haversine(origin, raw)),
    phone: raw.phone ?? null, whatsapp: null, email: null, website: safeUrl(raw.website), maps_url: safeUrl(raw.maps_url),
    description: null, services, services_source: services.length ? 'mapa' : null, specialties: specialtiesFromName(raw.name),
    hours, hours_source: hours ? 'google' : null, prices: null, accepts_online_booking: false, is_demo: false,
  };
}

// Clínica cadastrada no IMED, como vem da função nearby_clinics do banco.
// Preço e horário só aparecem quando a clínica informou; nada é estimado.
export function normalizeImedRow(r, origin) {
  const prices = {};
  for (const e of r.exams ?? []) prices[e.code] = e.price_cents ?? null;
  const street = r.neighborhood && r.address_line.includes(r.neighborhood)
    ? r.address_line : [r.address_line, r.neighborhood].filter(Boolean).join(' · ');
  const hours = formatClinicHours(r.opening_hours);
  return {
    id: `imed:${r.id}`, clinic_id: r.id, source: 'imed', name: r.name, kind: KINDS[r.kind] ? r.kind : 'clinica',
    address: `${street} · ${r.city} - ${r.state}`, cep: r.cep ?? null, lat: r.lat, lng: r.lng,
    distance_m: Math.round(haversine(origin, r)),
    phone: r.phone ?? null, whatsapp: r.whatsapp ?? null, email: r.email ?? null, website: safeUrl(r.website),
    maps_url: null, description: r.description ?? null,
    services: Object.keys(prices), services_source: 'clinica', specialties: r.specialties ?? [],
    hours, hours_source: hours ? 'clinica' : null, prices,
    accepts_online_booking: !!r.accepts_online_booking, is_demo: !!r.is_demo,
  };
}

// Junta parceiros IMED e estabelecimentos do mapa, tirando do mapa quem já é parceiro.
export function mergePlaces(imed, others) {
  const kept = others.filter((p) => !imed.some((c) => {
    if (haversine(c, p) > 200) return false;
    const a = normName(c.name), b = normName(p.name);
    return a === b || (a.length > 3 && b.includes(a)) || (b.length > 3 && a.includes(b));
  }));
  return [...imed, ...kept];
}

export const priceFor = (p, exam) => p.prices?.[exam] ?? null;

export function minPrice(p) {
  const vals = Object.values(p.prices ?? {}).filter((v) => v != null);
  return vals.length ? Math.min(...vals) : null;
}

export const DEFAULT_FILTERS = { kind: '', exam: '', specialty: '', radius: 5000, price: '', sort: 'dist', onlyImed: false };

export function activeFilterCount(f) {
  return ['kind', 'exam', 'specialty', 'price'].filter((k) => f[k]).length + (f.onlyImed ? 1 : 0);
}

export function filterPlaces(list, f) {
  const range = f.price ? PRICE_RANGES[f.price] : null;
  return list.filter((p) => {
    if (p.distance_m > f.radius) return false;
    if (f.onlyImed && p.source !== 'imed') return false;
    if (f.kind && p.kind !== f.kind) return false;
    if (f.exam && !p.services.includes(f.exam)) return false;
    if (f.specialty && !p.specialties.includes(f.specialty)) return false;
    if (range) {
      const vals = f.exam ? [priceFor(p, f.exam)] : Object.values(p.prices ?? {});
      const ok = vals.some((v) => v != null && (range[0] == null || v >= range[0]) && (range[1] == null || v <= range[1]));
      if (!ok) return false;
    }
    return true;
  });
}

export function sortPlaces(list, sort, exam) {
  const arr = [...list];
  const byDist = (a, b) => a.distance_m - b.distance_m;
  if (sort === 'name') {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || byDist(a, b));
  } else if (sort === 'price') {
    const pr = (p) => (exam ? priceFor(p, exam) : minPrice(p));
    arr.sort((a, b) => {
      const pa = pr(a), pb = pr(b);
      if (pa == null && pb == null) return byDist(a, b);
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pa - pb || byDist(a, b);
    });
  } else {
    arr.sort(byDist);
  }
  return arr;
}

export function specialtyOptions(list) {
  return [...new Set(list.flatMap((p) => p.specialties))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export function formatDistance(m) {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

export function formatPrice(cents) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2,
  }).format(cents / 100);
}

export const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');
export const isValidPhone = (digits) => /^[1-9]{2}(9\d{8}|[2-8]\d{7})$/.test(digits);
export const isValidEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v).trim()) && String(v).trim().length <= 254;
export const isCep = (v) => /^\s*\d{5}-?\d{3}\s*$/.test(v);

export function maskPhone(v) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function telHref(phone) {
  const raw = String(phone ?? '').trim();
  let d = raw.replace(/[^\d+]/g, '');
  if (!d.replace('+', '')) return null;
  if (!d.startsWith('+') && /^0(300|500|800|900)/.test(d)) return `tel:${d}`;
  if (!d.startsWith('+')) d = d.replace(/^0/, '');
  if (!d.startsWith('+') && (d.length === 10 || d.length === 11)) d = `+55${d}`;
  return `tel:${d}`;
}

export const whatsappHref = (digits, text) => `https://wa.me/${onlyDigits(digits)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const directionsUrl = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;

// Datas no fuso de São Paulo, o mesmo que o banco usa para validar o pedido.
export function spDate(offsetDays = 0, now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(now + offsetDays * 86400000));
}

export function formatDateLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

export const protocolFromId = (id) => `IMED-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export const PERIODS = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite', qualquer: 'Qualquer horário' };
export const BOOKING_DAYS = 90;

export function validateBooking(v, today = spDate(0), maxDate = spDate(BOOKING_DAYS)) {
  const err = {};
  if (!v.exam) err.exam = 'Escolha o exame ou o tipo de atendimento.';
  if (!v.date) err.date = 'Escolha a data que prefere.';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || v.date < today || v.date > maxDate) err.date = `Escolha uma data entre hoje e os próximos ${BOOKING_DAYS} dias.`;
  if (!PERIODS[v.period]) err.period = 'Escolha um período.';
  if (String(v.name ?? '').trim().length < 2) err.name = 'Digite seu nome.';
  if (!isValidPhone(onlyDigits(v.phone))) err.phone = 'Digite um celular com DDD, por exemplo (11) 98765-4321.';
  if (v.email && !isValidEmail(v.email)) err.email = 'Confira o e-mail ou deixe em branco.';
  if (String(v.notes ?? '').length > 500) err.notes = 'Use até 500 caracteres.';
  if (!v.consent) err.consent = 'Para enviar, autorize o uso dos dados para o agendamento.';
  return err;
}

export function bookingRow(place, v, id) {
  const imed = place.source === 'imed';
  const notes = String(v.notes ?? '').trim();
  const email = String(v.email ?? '').trim().toLowerCase();
  return {
    id,
    clinic_id: imed ? place.clinic_id : null,
    place_source: place.source,
    place_ref: imed ? null : place.id.slice(0, 200),
    place_name: place.name.slice(0, 200),
    place_address: place.address ? place.address.slice(0, 300) : null,
    place_phone: place.phone ? place.phone.slice(0, 30) : null,
    exam_code: v.exam,
    preferred_date: v.date,
    preferred_period: v.period,
    patient_name: String(v.name).trim().replace(/\s+/g, ' ').slice(0, 120),
    patient_phone: onlyDigits(v.phone),
    patient_email: email || null,
    notes: notes ? notes.slice(0, 500) : null,
    consent: true,
  };
}
