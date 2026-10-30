// Listas fixas da página inicial: nomes dos exames (com o código usado na busca e o endereço do guia)
// e bairros de São Paulo para escolher o ponto de partida do mapa. Nada aqui é preço, nota ou horário:
// esses dados só aparecem quando vêm do banco do IMED ou do cadastro oficial (CNES).
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
const PLACES = {
  paulista:{n:'Av. Paulista, Bela Vista', s:'Av. Paulista', lat:-23.5650, lng:-46.6520},
  pinheiros:{n:'Pinheiros', s:'Pinheiros', lat:-23.5667, lng:-46.6930},
  vilamariana:{n:'Vila Mariana', s:'Vila Mariana', lat:-23.5890, lng:-46.6340},
  moema:{n:'Moema', s:'Moema', lat:-23.6010, lng:-46.6640},
  centro:{n:'Centro', s:'Centro', lat:-23.5455, lng:-46.6390},
  tatuape:{n:'Tatuapé', s:'Tatuapé', lat:-23.5400, lng:-46.5760},
  santana:{n:'Santana', s:'Santana', lat:-23.5020, lng:-46.6250}
};
