// Rodapé do IMED: o mesmo em todas as páginas. Fonte única do HTML do rodapé.
// - As páginas fixas recebem o rodapé por: node scripts/aplicar-rodape.mjs (troca o trecho entre
//   <!-- rodape --> e <!-- /rodape --> e liga o assets/css/rodape.css no <head>).
// - As páginas das cidades usam rodapeHtml() direto em scripts/gerar-cidades.mjs.
// - tests/rodape.test.mjs confere que todas as páginas estão iguais a este modelo.
// Estilo: assets/css/rodape.css (não depende do CSS da página).
//
// `rel` é o caminho até a raiz do site: '' nas páginas da raiz, '../' em exames/, '../../../' nas cidades
// e o caminho absoluto ('/testedoapp/') na página 404, que pode abrir em qualquer endereço.

export const CFM_URL = 'https://portal.cfm.org.br/busca-medicos/';
export const MEDICO = 'Dr. Rafael Pereira Barreto Silva';
export const CRM = 'CRM-SP 266930';
export const FONTE = 'Dados de endereço: CNES/Ministério da Saúde. O IMED é um serviço privado, sem vínculo com o governo ou o SUS.';

// Links do rodapé: [texto, caminho a partir da raiz, ícone opcional]. '' = página inicial.
// Ordem dos grupos: no celular, Pacientes e IMED lado a lado e Clínicas e médicos embaixo, em duas colunas.
export const GRUPOS = [
  ['Pacientes', [
    ['Perto de mim', 'perto.html'],
    ['Clínicas por cidade', 'cidades/'],
    ['Guias de exames', 'exames/'],
    ['Teleconsulta', 'teleconsulta.html'],
    ['Meus pedidos', '#agenda'],
    ['Minha conta', 'conta.html'],
  ]],
  ['IMED', [
    ['Quem somos', 'sobre.html'],
    ['Como funciona', 'como-funciona.html'],
    ['Conferir documento', 'documento.html'],
    ['Termos de uso', 'termos.html'],
    ['Privacidade', 'privacidade.html'],
    ['Acessibilidade', 'acessibilidade.html', 'fa-universal-access'],
    ['Fale com o IMED', 'contato.html'],
  ]],
  ['Clínicas e médicos', [
    ['Para clínicas', 'parceiros.html'],
    ['Assumir o cadastro', 'reivindicar.html'],
    ['Área da clínica', 'painel.html'],
    ['Para médicos', 'para-medicos.html'],
  ]],
];

export const INICIO = '<!-- rodape -->';
export const FIM = '<!-- /rodape -->';

// Endereço de um link do rodapé visto de uma página com o `rel` dado.
export function rodapeHref(rel, path) {
  const root = rel || './';
  if (path === '') return root;
  if (path.startsWith('#')) return root + path; // âncora da página inicial (ex.: ./#agenda)
  return rel + path;
}

export function rodapeHtml(rel = '') {
  const href = (p) => rodapeHref(rel, p);
  const grupos = GRUPOS.map(([titulo, links], i) => `
      <div class="rd-col">
        <p class="rd-h" id="rd-g${i}">${titulo}</p>
        <ul aria-labelledby="rd-g${i}">
          ${links.map(([texto, path, icone]) => `<li><a href="${href(path)}"${icone ? ' class="rd-a11y"' : ''}>${icone ? `<i class="fa-solid ${icone}" aria-hidden="true"></i>` : ''}${texto}</a></li>`).join('\n          ')}
        </ul>
      </div>`).join('');
  return `${INICIO}
<footer class="rodape">
  <div class="rd-in">
    <div class="rd-sobre">
      <a class="rd-logo" href="${href('')}" aria-label="IMED, página inicial"><span class="rd-mk" aria-hidden="true"><i class="fa-solid fa-plus"></i></span>IMED</a>
      <p class="rd-med"><i class="fa-solid fa-user-doctor" aria-hidden="true"></i><span>Médico responsável: <b>${MEDICO}</b> — <span class="rd-nw">${CRM}</span> · <a href="${CFM_URL}" target="_blank" rel="noopener">conferir no CFM<span class="rd-sr"> (abre em outra aba)</span></a></span></p>
      <p class="rd-sos"><i class="fa-solid fa-truck-medical" aria-hidden="true"></i><span><b>Emergência? Ligue <a href="tel:192">192 (SAMU)</a></b> ou vá ao pronto-socorro mais próximo.</span></p>
    </div>
    <nav class="rd-nav" aria-label="Rodapé">${grupos}
    </nav>
  </div>
  <div class="rd-base">
    <p>${FONTE}</p>
    <p>© 2026 IMED</p>
  </div>
</footer>
${FIM}`;
}
