// Service worker do IMED: deixa o site abrir rápido e funcionar sem internet.
// Ao mudar arquivos do site, aumente a versão para os celulares baixarem a nova.
const VERSION = 'imed-v2';
const CORE = [
  './', './index.html', './perto.html', './parceiros.html', './privacidade.html', './exames/',
  './manifest.webmanifest',
  './assets/js/config.js', './assets/js/aviso.js', './assets/js/data.js', './assets/js/db.js', './assets/js/hero3d.js',
  './assets/js/geo-core.js', './assets/js/perto.js', './assets/css/perto.css',
  './assets/vendor/three.module.min.js', './assets/vendor/fa/css/all.min.css',
  './assets/vendor/leaflet/leaflet.js', './assets/vendor/leaflet/leaflet.css',
  './assets/vendor/fa/webfonts/fa-solid-900.woff2', './assets/vendor/fa/webfonts/fa-regular-400.woff2', './assets/vendor/fa/webfonts/fa-brands-400.woff2',
  './assets/icons/icon-192.png',
  './assets/img/ico-rx.webp', './assets/img/ico-usg.webp', './assets/img/ico-tc.webp', './assets/img/ico-rm.webp',
  './assets/img/ico-mamo.webp', './assets/img/ico-dens.webp', './assets/img/ico-ecg.webp', './assets/img/ico-eco.webp'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fontes do Google: guarda depois do primeiro uso.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(VERSION).then(c => c.match(req).then(hit => hit || fetch(req).then(res => { c.put(req, res.clone()); return res; }))));
    return;
  }
  // Outros sites (banco de dados, mapas): sempre pela internet.
  if (url.origin !== self.location.origin) return;

  // Páginas: tenta a internet primeiro para mostrar a versão mais nova.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))));
    return;
  }
  // Arquivos (imagens, scripts): responde do cache e atualiza em segundo plano.
  e.respondWith(caches.open(VERSION).then(c => c.match(req).then(hit => {
    const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  })));
});
