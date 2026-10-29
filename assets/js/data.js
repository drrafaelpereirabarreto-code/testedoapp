// Dados de exemplo do protótipo IMED: exames, bairros, clínicas e médicos.
// Usado pela página inicial e pelos guias de exames.
const EXAMS = {
  rx:   {slug:'raio-x', n:'Raio-X',         full:'Raio-X de tórax',                 d:'Ossos, tórax e articulações. Resultado em poucas horas.', p:90},
  usg:  {slug:'ultrassom', n:'Ultrassom',      full:'Ultrassom de abdome total',       d:'Órgãos internos e gestação, sem radiação.',               p:150},
  tc:   {slug:'tomografia', n:'Tomografia',     full:'Tomografia de crânio',            d:'Imagens em cortes, alta precisão. Com ou sem contraste.', p:360},
  rm:   {slug:'ressonancia-magnetica', n:'Ressonância',    full:'Ressonância magnética de joelho', d:'Tecidos moles, coluna e articulações em detalhe.',       p:450},
  mamo: {slug:'mamografia', n:'Mamografia',     full:'Mamografia digital bilateral',    d:'Prevenção e diagnóstico precoce do câncer de mama.',     p:170},
  dens: {slug:'densitometria-ossea', n:'Densitometria',  full:'Densitometria óssea',             d:'Avalia a densidade dos ossos e o risco de osteoporose.', p:200},
  ecg:  {slug:'eletrocardiograma', n:'Eletro',         full:'Eletrocardiograma',               d:'Ritmo do coração em 10 minutos, com laudo.',             p:70},
  eco:  {slug:'ecocardiograma', n:'Ecocardiograma', full:'Ecocardiograma transtorácico',    d:'Ultrassom do coração: estrutura e funcionamento.',       p:260}
};
const GRP = {rx:'img',usg:'img',tc:'img',rm:'img',mamo:'img',dens:'img',ecg:'card',eco:'card'};
const PLACES = {
  paulista:{n:'Av. Paulista, Bela Vista', s:'Av. Paulista', lat:-23.5650, lng:-46.6520},
  pinheiros:{n:'Pinheiros', s:'Pinheiros', lat:-23.5667, lng:-46.6930},
  vilamariana:{n:'Vila Mariana', s:'Vila Mariana', lat:-23.5890, lng:-46.6340},
  moema:{n:'Moema', s:'Moema', lat:-23.6010, lng:-46.6640},
  centro:{n:'Centro', s:'Centro', lat:-23.5455, lng:-46.6390},
  tatuape:{n:'Tatuapé', s:'Tatuapé', lat:-23.5400, lng:-46.5760},
  santana:{n:'Santana', s:'Santana', lat:-23.5020, lng:-46.6250}
};
// f = fator de preço por exame (1 = preço médio da região); img/pos = foto de capa
const CLINICS = [
  {id:'dcp', n:'DiagnoCenter Paulista', ini:'DC', c:'#0E7C9C', b:'Bela Vista', lat:-23.5614,lng:-46.6559, r:4.9, rv:2140, laudo:'24h', next:[0,'14:30'], open:true, sup:true, conv:true, pix:10, f:{rx:1.05,usg:1.05,tc:1.05,rm:.95,mamo:1,dens:1,ecg:1}, top:['rm','tc'], img:'rm', pos:'55% 50%'},
  {id:'cvi', n:'Clínica Visão Imagem', ini:'VI', c:'#6C4BD8', b:'Pinheiros', lat:-23.5667,lng:-46.6930, r:4.6, rv:860, laudo:'48h', next:[0,'16:00'], open:true, sup:false, conv:true, pix:5, f:{rx:1.2,usg:1,tc:.97,rm:1.05,mamo:.95}, top:['tc','usg'], img:'tc', pos:'40% 50%'},
  {id:'cdi', n:'CDI Vila Mariana', ini:'CD', c:'#16A6A6', b:'Vila Mariana', lat:-23.5890,lng:-46.6340, r:4.8, rv:1530, laudo:'24h', next:[0,'17:30'], open:true, sup:true, conv:true, pix:0, f:{rx:1,usg:.93,tc:1.1,rm:1,mamo:1.05,dens:.9,eco:1}, top:['usg','dens'], img:'usg', pos:'45% 50%'},
  {id:'ims', n:'Imagem+ Saúde', ini:'I+', c:'#FF6B4A', b:'Moema', lat:-23.6010,lng:-46.6640, r:4.5, rv:410, laudo:'72h', next:[0,'18:00'], open:true, sup:false, conv:false, pix:15, f:{rx:1,usg:1,tc:1.02,rm:1.02}, top:['rx','rm'], promo:'Ressonância com 15% off no Pix', img:'rx', pos:'50% 50%'},
  {id:'rvc', n:'RadioVida Centro', ini:'RV', c:'#2C7BE5', b:'Centro', lat:-23.5455,lng:-46.6390, r:4.4, rv:690, laudo:'48h', next:[0,'13:15'], open:true, sup:false, conv:true, pix:10, f:{rx:.85,usg:.9,tc:.92,dens:.95}, top:['rx','tc'], img:'recepcao', pos:'30% 50%'},
  {id:'eco', n:'Ecocor Cardiologia', ini:'EC', c:'#D63A5A', b:'Jardins', lat:-23.5700,lng:-46.6620, r:4.9, rv:1220, laudo:'Na hora', next:[0,'15:00'], open:true, sup:true, conv:true, pix:0, f:{ecg:1,eco:.95,usg:1.1}, top:['eco','ecg'], img:'eco', pos:'35% 50%'},
  {id:'lum', n:'Lumina Diagnósticos', ini:'LU', c:'#F5A524', b:'Itaim Bibi', lat:-23.5850,lng:-46.6800, r:4.7, rv:980, laudo:'24h', next:[1,'08:00'], open:true, sup:true, conv:true, pix:5, f:{rx:1.15,usg:1.15,tc:1.15,rm:1.15,mamo:1.1,dens:1.1,ecg:1.1,eco:1.1}, top:['rm','mamo'], promo:'Check-up da mulher: mamografia + densitometria', img:'mamo', pos:'60% 50%'},
  {id:'son', n:'Sonar Ultrassom', ini:'SO', c:'#1E9E5A', b:'Tatuapé', lat:-23.5400,lng:-46.5760, r:4.6, rv:540, laudo:'Na hora', next:[0,'11:40'], open:true, sup:false, conv:false, pix:10, f:{usg:.82,eco:.9}, top:['usg'], img:'fachada', pos:'40% 50%'},
  {id:'hor', n:'Clínica Horizonte', ini:'HZ', c:'#0A5C76', b:'Santana', lat:-23.5020,lng:-46.6250, r:4.3, rv:320, laudo:'48h', next:[1,'09:30'], open:true, sup:false, conv:true, pix:0, f:{rx:.9,usg:.95,mamo:.9,dens:.88,ecg:.9}, top:['mamo','rx'], img:'recepcao', pos:'78% 50%'},
  {id:'msb', n:'MedScan Butantã', ini:'MS', c:'#5A6B78', b:'Butantã', lat:-23.5710,lng:-46.7080, r:4.5, rv:470, laudo:'24h', next:[0,'19:00'], open:true, sup:false, conv:true, pix:5, f:{rx:.95,tc:.9,rm:.88}, top:['rm','tc'], img:'tc', pos:'78% 50%'},
  {id:'pri', n:'Prime Imagem Brooklin', ini:'PI', c:'#111827', b:'Brooklin', lat:-23.6150,lng:-46.6920, r:4.8, rv:760, laudo:'24h', next:[2,'10:00'], open:true, sup:true, conv:false, pix:0, f:{tc:1.2,rm:1.25,mamo:1.2,usg:1.2}, top:['rm','tc'], img:'rm', pos:'82% 50%'},
  {id:'nov', n:'Nova Diagnose Lapa', ini:'ND', c:'#8B5E3C', b:'Lapa', lat:-23.5270,lng:-46.7050, r:4.2, rv:210, laudo:'72h', next:[1,'07:00'], open:false, sup:false, conv:true, pix:10, f:{rx:.88,usg:.88,ecg:.85}, top:['rx'], img:'rx', pos:'25% 50%'}
];
const REVIEWS = ['Atendimento pontual e equipe muito educada.','Agendei pelo app em 1 minuto, sem fila na recepção.','Laudo saiu antes do prazo. Recomendo!','Lugar limpo, moderno e fácil de chegar.','Preço bem melhor do que no meu bairro.'];
const SPECS = [['todas','Todas'],['clinico','Clínico geral'],['cardio','Cardiologia'],['derma','Dermatologia'],['pedi','Pediatria'],['gine','Ginecologia'],['psiq','Psiquiatria'],['orto','Ortopedia']];
const DOCS = [
  {id:'d1', n:'Dra. Camila Ruiz', s:'cardio', sn:'Cardiologia', p:120, r:4.9, rv:312, wait:'Agora', c:'#D63A5A', on:true, img:'assets/img/av-camila.webp'},
  {id:'d2', n:'Dr. Marcos Lima', s:'clinico', sn:'Clínico geral', p:80, r:4.8, rv:540, wait:'Em 10 min', c:'#0E7C9C', on:true, img:'assets/img/av-marcos.webp'},
  {id:'d3', n:'Dra. Beatriz Nunes', s:'derma', sn:'Dermatologia', p:100, r:4.9, rv:205, wait:'Em 30 min', c:'#6C4BD8', on:true, img:'assets/img/av-beatriz.webp'},
  {id:'d4', n:'Dr. Paulo Mendes', s:'orto', sn:'Ortopedia', p:120, r:4.7, rv:188, wait:'Hoje 17:00', c:'#2C7BE5', on:false, img:'assets/img/av-paulo.webp'},
  {id:'d5', n:'Dra. Lúcia Ferraz', s:'pedi', sn:'Pediatria', p:90, r:5.0, rv:421, wait:'Agora', c:'#1E9E5A', on:true, img:'assets/img/av-lucia.webp'},
  {id:'d6', n:'Dra. Renata Alves', s:'gine', sn:'Ginecologia', p:110, r:4.8, rv:276, wait:'Em 20 min', c:'#FF6B4A', on:true, img:'assets/img/av-renata.webp'},
  {id:'d7', n:'Dr. Felipe Rocha', s:'psiq', sn:'Psiquiatria', p:150, r:4.9, rv:164, wait:'Amanhã 09:00', c:'#0A5C76', on:false, img:'assets/img/av-felipe.webp'},
  {id:'d8', n:'Dr. André Souza', s:'clinico', sn:'Clínico geral', p:80, r:4.6, rv:390, wait:'Agora', c:'#F5A524', on:true, img:'assets/img/av-andre.webp'}
];
const COUPONS = {IMED10:.10};
const r5 = n=>Math.round(n/5)*5;
const price = (c,ex)=>c.f[ex]!=null ? r5(EXAMS[ex].p*c.f[ex]) : null;
