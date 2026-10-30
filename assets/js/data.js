// Listas fixas da página inicial: nomes dos exames (com o código usado na busca e o endereço do guia) e o exemplo
// da Av. Paulista, usado no topo (3D e lista leve) enquanto não há localização nem cidade escolhida, sempre marcado
// como exemplo. As cidades vêm do banco (imported_cities). Nada aqui é preço, nota ou horário: esses dados só
// aparecem quando vêm do banco do IMED ou do cadastro oficial (CNES).
const EXAMS = {
  rx:   {slug:'raio-x',                n:'Raio-X',         full:'Raio-X (radiografia)'},
  usg:  {slug:'ultrassom',             n:'Ultrassom',      full:'Ultrassom'},
  tc:   {slug:'tomografia',            n:'Tomografia',     full:'Tomografia computadorizada'},
  rm:   {slug:'ressonancia-magnetica', n:'Ressonância',    full:'Ressonância magnética'},
  mamo: {slug:'mamografia',            n:'Mamografia',     full:'Mamografia'},
  dens: {slug:'densitometria-ossea',   n:'Densitometria',  full:'Densitometria óssea'},
  ecg:  {slug:'eletrocardiograma',     n:'Eletro',         full:'Eletrocardiograma'},
  eco:  {slug:'ecocardiograma',        n:'Ecocardiograma', full:'Ecocardiograma'},
  lab:  {slug:null,                    n:'Laboratório',    full:'Exames de laboratório (sangue, urina)'}
};
// de: o nome com a preposição certa ("da Av. Paulista").
const PLACES = {
  paulista:{n:'Av. Paulista, Bela Vista', s:'Av. Paulista', de:'da Av. Paulista', lat:-23.5650, lng:-46.6520}
};
