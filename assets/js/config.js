// Configuração pública do site. Tudo aqui pode ficar no navegador:
// a chave "anon" do Supabase é pública por natureza e só faz o que as regras do banco (RLS) permitem.
// Chaves secretas, como a do Google Maps Platform, ficam só no servidor, como segredo da
// Edge Function "clinicas-proximas" (veja o README).
window.IMED_CONFIG = {
  supabaseUrl: 'https://pyoqiecupxhdzigjudyd.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5b3FpZWN1cHhoZHppZ2p1ZHlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxODMwNjAsImV4cCI6MjEwODc1OTA2MH0.a0tD8O7CASKLr50kEkEaBIHDSiuySqPNfyVvQ3fzq7Q',
  functionsUrl: 'https://pyoqiecupxhdzigjudyd.supabase.co/functions/v1',
  // Imagens do mapa. Ao trocar de provedor, atualize também a Content-Security-Policy de perto.html.
  map: {
    tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores do OpenStreetMap</a>',
    maxZoom: 19
  },
  // Servidores públicos do OpenStreetMap (Overpass) usados quando o Google Places não está ativo no servidor.
  overpass: ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
};
