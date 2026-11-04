# MapLibre GL JS 6.16.0

Desenha o mapa 3D do topo da página inicial (assets/js/hero3d.js): os prédios de verdade da região (OpenStreetMap,
pelos ladrilhos gratuitos do OpenFreeMap), com luz, sombras e os estabelecimentos reais. Baixado só em aparelho
capaz (WebGL 2, sem "reduzir movimento" e sem economia de dados), depois que o conteúdo da página aparece.

- Origem: pacote npm `maplibre-gl@6.16.0` (`npm pack maplibre-gl@6.16.0`; integridade conferida pelo npm:
  sha512-gApO66EMtoDZuio680RUBvskR7ahFd/NNhLN4tBAs+Y7FeT4gQV8zVFgYVMRmFxQznOEzecW19w6xOd9XjZjiA==).
- Arquivos: `dist/maplibre-gl.mjs` → `maplibre-gl.js` e `dist/maplibre-gl-worker.mjs` → `maplibre-gl-worker.js`
  (módulos ES; com `.js` o service worker os trata como scripts, sempre pela internet primeiro). Única mudança:
  tirada a última linha (`//# sourceMappingURL=...`), porque os arquivos .map não estão no repositório.
  Como o nome mudou, hero3d.js chama `setWorkerUrl()` com o endereço do trabalhador (mesmo site: a CSP não precisa
  de `blob:`).
- SHA-256 dos arquivos daqui:
  - maplibre-gl.js: 253426af6c21e5f0bc242fbe0706538b66ae5e2f94341ce31b7048a833a326bb
  - maplibre-gl-worker.js: f4650f17aa791e15a800278c1e8499d913ff802907a5ad2eb4b8c3cefe68b7ed
- SHA-256 dos originais do pacote: maplibre-gl.mjs fbbdf8ddd9a48e49059a4be6795a4f214a711314bb5809f72d3730b48e7897e3,
  maplibre-gl-worker.mjs 0bf06492bdb7ba3d4132b78e435621bfba60d5250967991c02b1a73affea8cd5.
- Licença: BSD-3-Clause (LICENSE.txt, com os avisos do código herdado do mapbox-gl-js 1.13 e de outras partes).
- Sem o CSS da biblioteca: o pouco que o mapa precisa está no `<style>` do index.html (.h3d-map); os controles da
  MapLibre (zoom, créditos) não são usados — os créditos do mapa ficam em #heroAttrib.
