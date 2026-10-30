// Configuração pública do site. Tudo aqui pode ficar no navegador:
// a chave "anon" do Supabase é pública por natureza e só faz o que as regras do banco (RLS) permitem.
// Chaves secretas, como a do Google Maps Platform, ficam só no servidor, como segredo da
// Edge Function "clinicas-proximas" (veja o README).
window.IMED_CONFIG = {
  supabaseUrl: 'https://pyoqiecupxhdzigjudyd.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5b3FpZWN1cHhoZHppZ2p1ZHlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxODMwNjAsImV4cCI6MjEwODc1OTA2MH0.a0tD8O7CASKLr50kEkEaBIHDSiuySqPNfyVvQ3fzq7Q',
  functionsUrl: 'https://pyoqiecupxhdzigjudyd.supabase.co/functions/v1',
  // Endereço público do site, usado nos links de login e nas páginas para o Google. Ao ligar o domínio
  // próprio (veja o README), troque aqui e rode de novo scripts/gerar-cidades.mjs.
  siteUrl: 'https://drrafaelpereirabarreto-code.github.io/testedoapp/',
  // WhatsApp do IMED, só dígitos com DDI e DDD (ex.: '5511987654321'). Vazio esconde os botões de WhatsApp.
  whatsapp: '',
  // Imagens do mapa. Ao trocar de provedor, atualize também a Content-Security-Policy de perto.html.
  map: {
    tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores do OpenStreetMap</a>',
    maxZoom: 19
  },
  // Servidores públicos do OpenStreetMap (Overpass) usados quando o Google Places não está ativo no servidor.
  overpass: ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
};

// iPhone com iOS 15 (e outros navegadores antigos) não tem AbortSignal.timeout, usado nas chamadas ao banco.
// Este arquivo carrega antes dos outros scripts em todas as páginas, então a troca vale para o site inteiro.
if (window.AbortSignal && typeof AbortSignal.timeout !== 'function' && typeof AbortController === 'function') {
  AbortSignal.timeout = (ms) => {
    const c = new AbortController();
    setTimeout(() => { try { c.abort(new DOMException('Tempo esgotado', 'TimeoutError')); } catch { c.abort(); } }, ms);
    return c.signal;
  };
}
