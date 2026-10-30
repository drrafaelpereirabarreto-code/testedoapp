# Perto de você: tela de aplicativo na página inicial, com pedido de localização ao abrir e seletor de cidade

## Julgamento

JULGAMENTO (0 a 10; em "risco", nota alta = risco baixo)

Critério                              | P1 Tela "Perto de você" | P2 Mapa primeiro | P3 Menor mudança
Cumpre o pedido do dono               | 9 | 7 | 6
Experiência no celular                | 8 | 5 | 7
Experiência no computador             | 9 | 8 | 5
Honestidade / LGPD / acessibilidade   | 9 | 7 | 8
Risco técnico e de quebrar testes     | 5 | 3 | 8
Velocidade                            | 8 | 6 | 7
Média                                 | 8,0 | 6,0 | 6,8

P1 (vencedora). Só ela muda de fato o layout ("tipo uma página") nos dois aparelhos sem tirar nada que o dono já tinha pedido. Tem:
- pedido ao abrir com aviso do motivo e plano B forte;
- seletor em tela cheia no celular;
- lista e mapa lado a lado no computador;
- distância até a pessoa;
- nenhuma função nova no banco, regras puras testáveis e simulador de localização para os testes.
Pontos fracos, corrigidos na especificação:
- escopo grande;
- "Você está em" afirma a cidade; virou "Sua região";
- textos "A partir do centro…": o teste "só dados reais" proíbe "a partir de"; trocados por "Distâncias medidas do centro de…";
- aviso fixo com role=status que nasce escondido (o leitor de tela pode não anunciar); virou uma região, com um status escondido separado;
- cortados para caber nas próximas horas: o cache do imported_cities no sessionStorage, as mudanças opcionais no perto.js e o pedido "adiado" ao sair de #agenda.

P2. É a mais "app" (a lista acompanha o mapa), mas:
- tira o 3D do celular (o dono mandou refazer o 3D, não pediu para tirar);
- no celular, põe os locais em cartões num carrossel lateral, parecido com o carrossel que o dono quer tirar;
- o mapa de 48svh prende o dedo, e o campo da cidade fica no meio da página, embaixo do teclado;
- consulta o banco a cada movimento, e a lista muda sozinha (ruim para leitor de tela);
- é a de maior risco e a que mais quebra testes.

P3. É a mais segura e a única que põe os 3 mais perto na primeira tela do celular. Porém:
- muda pouco o layout;
- mantém a janela antiga com o select e os bairros de SP (duas formas de escolher a cidade);
- numa visita nova, a localização passa por cima da cidade escolhida (surpresa);
- ordena a cidade escolhida pela distância até a pessoa mesmo a centenas de km.

CONFERIDO NO CÓDIGO E NO AMBIENTE
- Chromium sem tela (Playwright 1.63 desta máquina):
  - sem permissão: permissions.query dá "prompt", getCurrentPosition falha em ~6 ms com código 1 e o estado continua "prompt";
  - com permissions:['geolocation']: "granted", com a posição;
  - "granted" sem posição: código 3 no tempo-limite.
  - Consequências: o e2e-velocidade (sem localização) cai em "naoapareceu" e continua com o exemplo da Paulista e "dados de São Paulo"; o e2e-a11y (localização permitida por padrão) cai no "silencioso"; o e2e-inicio precisa do simulador. O padrão "permitida na Paulista" arredonda para -23.565,-46.652, os números que os cenários do 3D já conferem.
- Funções do banco (migrações 20261030021903, 20261030043843, 20261030143738 e 20261030143839):
  - nearby_establishments(p_lat, p_lng, p_radius_m ≤50000, p_limit ≤300, p_kind, p_exam, p_sus, p_offset) devolve city, uf, city_code, location_source e total. O city_code é floor(ibge/10): 3550308 → 355030.
  - establishment_points(…, p_kind, p_exam, p_sus, p_limit ≤5000) devolve total.
  - nearby_clinics aceita p_kind, p_include_demo e p_limit ≤100.
  - imported_cities() devolve ibge, name, uf, total, imagem, laboratorio, clinica, hospital.
  - Também existem cnes_last_update(p_city) e track (aceita busca_cidade e busca_tipo).
  - A Edge Function guarda a geocodificação por 60 min.
- Ids atuais do index.html conferidos; os ids novos não colidem.
- Contas: Paulista → centro do Rio = "363 km" (geo-core). Contraste do número branco: #0E7C9C 4,79; #6C4BD8 5,78; #137A44 5,39; #BF3B20 5,44. As cores de hoje #1E9E5A (3,45) e #E8512F (3,72) não passam.
- Armadilhas achadas:
  - O .sheet-top tem position:relative e z-index:4. Um mapa fixo em tela cheia dentro dele ficaria atrás do cabeçalho (50), do menu de baixo (45) e do aviso LGPD (55).
  - O .rv usa transform: a seção nova não pode tê-lo.
  - O links.test só aceita #agenda como rota do index.html.
  - A primeira tela do celular precisa de alturas fixas, senão dá CLS.
  - Há mudanças sem commit de outra frente (para-médicos/gestão) em index.html, privacidade.html, sw.js (já em imed-v15), CLAUDE.md, arquitetura.md e cidades/**.

## Escolha

Base: proposta 1, a "Tela 'Perto de você' com jeito de aplicativo".

Enxertos:
- Da proposta 2:
  - aviso aos 8 s "Não apareceu a pergunta?";
  - esperar a aba ficar visível antes de pedir;
  - "~" na distância de local com posição pelo endereço (como na busca completa);
  - selos "Aberto 24 horas" e "Atende SUS";
  - mapa só no toque com economia de dados ou 2G;
  - rpc com AbortSignal;
  - busca_tipo no contador;
  - a palavra "região" no lugar de "você está em".
- Da proposta 3:
  - nenhum texto com "a partir de";
  - HEAD antes de mostrar o link da página da cidade;
  - distância até a pessoa calculada no aparelho;
  - 3D sem mudança.

Cortes na proposta 1:
- cache do imported_cities no sessionStorage;
- mudanças no perto.js;
- pedido "adiado" ao voltar de #agenda;
- role=status no aviso escondido.

Correções técnicas: elevar o .sheet-top enquanto o mapa está em tela cheia e tirar o .rv da seção.

## Ideia central

Logo abaixo do topo 3D, a página inicial ganha a tela “Clínicas perto de você”, com cara de aplicativo. Ela entra no lugar do mapa atual (#reais, que sobe e é refeito) e do carrossel “Clínicas por cidade” (#cidades, que sai).

Pedido de localização:
- Ao abrir o site, o navegador pede a localização uma vez.
- Junto aparece, no alto, um aviso com o motivo.
- Permitiu: a tela mostra os 10 locais reais mais perto (CNES e parceiros), com abas por tipo e a região da pessoa (“Sua região: São Paulo - SP”).
- Não permitiu: plano B claro, com a busca da cidade (funciona com teclado e leitor de tela), atalhos das cidades com mais locais e um botão para tentar a localização de novo. Nada de pedir em loop.

Escolha da cidade:
- O paciente troca a cidade quando quiser.
- No celular, o seletor ocupa a tela toda, como uma página; no computador, abre numa janela.
- Com a localização ligada, ele vê a que distância a cidade escolhida fica dele.

Mapa:
- No computador, lista e mapa ficam lado a lado. O mapa fica preso ao rolar e tem pinos numerados iguais aos da lista.
- No celular, a lista vem primeiro e o mapa abre em tela cheia com um toque. O Leaflet só é baixado nessa hora.

O que não muda:
- Nenhuma função nova no banco.
- A posição é arredondada (round3) e nunca gravada. No aparelho fica só a cidade escolhida.
- O 3D, a busca completa e as 318 páginas de cidade continuam como estão.

## Fluxo ao abrir

Regras que valem sempre:
- A posição é arredondada (round3, cerca de 110 m) assim que chega e fica só na memória da página (S.here).
- Ela nunca vai para localStorage, sessionStorage, o endereço da página, o contador de visitas ou um cache.
- A região descoberta pela localização também não é guardada.
- A decisão ao abrir sai de uma função pura testada: inicio-core.geoPlan.

0) Primeira pintura (HTML, antes do JS)
- A tela #reais já vem montada: cabeçalho, linha da cidade, abas e 6 linhas de espera do tamanho das de verdade, para nada pular.
- O #addrBtn mostra “Onde você está? / Escolher cidade”.
- Ainda não há pedido.

1) O que o inicio.js lê, sem pedir nada
- imed_cidade. Vale só com nome, UF de 2 letras e lat/lng finitos.
- sessionStorage imed_geo_pedido.
- localStorage imed_geo_recusas (0 a 2).
- Suporte: 'geolocation' in navigator e isSecureContext.
- O # do endereço.
- A permissão, por navigator.permissions.query({name:'geolocation'}). Sem a função ou com erro, vale 'unknown', tratado como 'prompt'.

O inicio.js também apaga imed_place, pede imported_cities (para a pílula, o seletor e os atalhos) e calcula o plano. Os planos são:

A) Cidade escolhida antes (imed_cidade válida), com qualquer permissão: plano 'cidade'
- Abre direto na cidade, pelo centro guardado. Não geocodifica, não mostra o aviso e não pede a localização.
- Lista, 3D, topo e fonte usam o centro da cidade.
- Se a permissão for 'granted', pega a posição em silêncio. Ela serve só para escrever “Campinas fica a 84 km de você” e, se o centro ficar a até 50 km, “a X km de você” em cada item.
- O botão #useGeoBtn (“Usar minha localização”) fica na linha da cidade. Ao tocar, localiza, passa para perto de você e apaga imed_cidade. As recentes continuam.

B) Permissão 'granted' e nenhuma cidade: plano 'silencioso'
- Nenhum aviso. A tela mostra “Buscando sua localização…” (data-estado=buscando).
- Chama getCurrentPosition({enableHighAccuracy:false, timeout:15000, maximumAge:300000}).
- Se a posição chega: modo 'perto' (data-estado=lista). Mostra a lista, a região quando ela é afirmada, e 3D e fonte na mesma origem. imed_geo_recusas volta a 0.
- Erro 3: 'demorou'. Erro 2: 'indisponivel'. Nos dois aparecem “Tentar de novo” e a escolha da cidade.
- Erro 1: 'negada'.
- Enquanto espera a posição, o 3D aguarda até 3 s; depois usa o exemplo.

C) Plano 'pedir'. Vale quando tudo isto acontece junto:
- permissão 'prompt' ou 'unknown';
- nenhuma cidade guardada;
- endereço sem # (ou com #reais, #lojas, #pedido ou #clinica-…);
- nenhum pedido nesta aba;
- menos de 2 recusas neste aparelho.

Como pedir:
1. Se a aba abriu em segundo plano, espera ela ficar visível (visibilitychange).
2. Mostra o aviso #geoAviso sem tirar o foco de onde está. O #geoStatus fala o motivo para o leitor de tela.
3. Grava imed_geo_pedido='1'.
4. Espera dois requestAnimationFrame e chama getCurrentPosition uma única vez, com as mesmas opções.

Enquanto espera a resposta:
- A tela mostra “Aguardando sua permissão…” (data-estado=aguardando) e o botão “Prefiro escolher a cidade”.
- O 3D mostra só a cidade, sem rótulos, e a lista leve mostra linhas de espera, por até 8 s. Depois disso, os dois usam o exemplo da Av. Paulista, marcado como exemplo.
- Aos 8 s sem resposta, o aviso e a tela acrescentam “Não apareceu a pergunta?…”. O Chrome pode mostrar o pedido só como um ícone na barra de endereço.

Respostas:
- C1) Permitiu: o aviso some, o #geoStatus diz “Pronto! Mostrando as clínicas perto de você.” e as recusas voltam a 0. Segue como em B.
- C2) Erro 1: recusas + 1 (no máximo 2) e o aviso some. Se a permissão virou 'denied', vai para 'negada'. Se continua 'prompt' e a resposta veio em menos de 800 ms, vai para 'naoapareceu' (o navegador bloqueou sem mostrar o pedido; é o que o Chromium dos testes faz). Senão, vai para 'fechou'. O site nunca pede de novo sozinho.
- C3) Erro 3 ou 2: 'demorou' ou 'indisponivel'. Não conta como recusa.
- C4) A pessoa escolheu uma cidade com o pedido ainda aberto: vale a cidade e o aviso some. Se a permissão chegar depois, a posição serve só para “fica a X km de você”.

D) Plano 'esperar': permissão 'prompt'/'unknown', mas o pedido não sai sozinho
Vale quando:
- já houve pedido nesta aba; ou
- já são 2 recusas neste aparelho; ou
- a página abriu em #agenda, #tele, #lista, #cidade ou #cidades.

O que aparece:
- “Onde você está?” (data-estado=onde), com “Usar minha localização” (pede com o toque), “Escolher minha cidade” e os atalhos.
- O 3D usa o exemplo na hora.
- #cidade e #cidades abrem o seletor.

E) Permissão 'denied': plano 'bloqueada'
- Não chama o navegador.
- A tela mostra 'negada': como liberar, “Escolher minha cidade” e os atalhos. O 3D usa o exemplo.
- Com a página aberta, a mudança da permissão é acompanhada pelo PermissionStatus change:
  - virou 'granted' e não há cidade escolhida: localiza em silêncio e passa para a lista;
  - virou 'denied' no modo 'perto': apaga a posição da memória e mostra 'negada'.

F) Sem suporte (sem navigator.geolocation ou página sem https): plano 'sem-suporte'
- A tela mostra só a escolha da cidade e os atalhos, sem botão de localização.
- O 3D usa o exemplo.

Toques depois de abrir (“Usar minha localização”, “Tentar de novo”, #nearCta sem origem):
- Com 'denied', só mostram a ajuda e não chamam o navegador.
- Nos outros casos, cada toque faz uma chamada.
- Com um pedido aberto, os botões mostram “Aguardando permissão…” e não chamam de novo.
- Erro 1 em menos de 800 ms leva a 'naoapareceu', com a explicação do cadeado.

## Computador

Vale a partir de 900 px (lista e mapa lado a lado). O topo 3D (980 px ou mais) fica igual.

Ordem da página:
- topo 3D;
- tela “Clínicas perto de você” (#reais): primeira seção do <main>, antes de “O que você precisa?”, sem a classe .rv;
- Exames;
- Como funciona;
- Teleconsulta;
- Para clínicas;
- Perguntas.
A seção “Clínicas por cidade” sai.

A tela é um cartão dentro do .wrap (1240 px): cantos de 28 px, borda var(--line), sombra var(--sh1) e padding de 24 px. De cima para baixo:

1) Cabeçalho
- À esquerda: kicker, título #reaisTitle e subtítulo. O título tem tabindex=-1 para receber o foco do #nearCta.
- À direita: link “Busca completa” (perto.html).

2) Linha da cidade
- Rótulo pequeno: Sua região / Perto de você / Cidade escolhida / Onde você está?
- Botão grande #cityBtn: pino, nome da cidade com 20 px e reticências, “Trocar” e seta; no mínimo 52 px de altura. Abre o seletor.
- Abaixo, a situação (#cityLine). No modo cidade, também o botão #useGeoBtn.

3) Abas #pvTabs
- Numa linha: botões de 44 px com aria-pressed.
- Ordem: Todos, Imagem, Laboratórios, Clínicas, Hospitais.

4) Corpo em grid minmax(0,420px) minmax(0,1fr), com gap de 20 px
- Coluna da lista, de cima para baixo:
  - #pvSum (role=status);
  - #realList (10 itens);
  - #pvAll;
  - link fixo “Todas as cidades” (cidades/);
  - nota da fonte (.rm-src, com o texto de hoje).
- Coluna do mapa (.pv-mapa):
  - position:sticky; top:96px; altura clamp(460px,70vh,640px); cantos de 22 px;
  - #realMap ocupa a coluna;
  - a legenda #realStats (.rm-stats/.rm-stat de hoje) fica embaixo do mapa.

Interações
- Mouse ou foco num item acende o pino do mesmo número (.pv-pin.on: maior e na frente).
- O mapa só se move se o pino estiver fora da vista (panTo, sem animação com “reduzir movimento”).
- Clique no pino: abre o balão de hoje (realPopup) e marca o item com .on.
- Trocar de aba refaz a lista e troca os pinos. Os pontos são filtrados no aparelho, sem nova chamada.
- O item inteiro é um link para local.html, onde se pede o agendamento.
- Os pinos ficam fora do Tab (keyboard:false).
- A roda do mouse não aproxima o mapa (scrollWheelZoom:false).

Estados sem lista
São eles: aguardando, buscando, onde, negada, fechou, naoapareceu, demorou, indisponivel, sem-suporte, vazio e erro.
- O cartão do estado ocupa a coluna da lista.
- A coluna do mapa mostra o mesmo desenho SVG do .hero-3d::before, sobre fundo escuro, com a frase “O mapa aparece quando você permite a localização ou escolhe a cidade.”
- Nada do Leaflet é baixado.
- O estado fica em #reais[data-estado].

Carregamento
- A lista é pedida assim que existe uma origem, sem esperar a rolagem.
- Leaflet, imagens do mapa e establishment_points só vêm quando a tela chega a 100 px da vista e depois da 1ª lista.
- Com economia de dados ou 2G, aparece o botão “Mostrar o mapa”.

Topo do site
- #addrBtn e #heroLoc mostram a origem e abrem o seletor.
- #nearCta (href '#reais'):
  - rola até a tela sem mudar o endereço e põe o foco no #reaisTitle;
  - se não há origem e a permissão não está negada, pede a localização com esse toque;
  - o texto pequeno mostra o local mais perto, em 1 linha com reticências.
- Aviso #geoAviso:
  - cartão branco fixo logo abaixo do cabeçalho (top 80 px), centralizado, até 560 px, z-index 49;
  - fica legível sobre o 3D escuro e sobre a parte branca;
  - enquanto aparece, html.style.scrollPaddingTop = fim do aviso + 16 px (WCAG 2.4.11);
  - some quando a pessoa responde, escolhe a cidade ou fecha o aviso.

## Celular

Vale de 360 a 899 px. Testar em 360, 390 e 412.

Topo fixo do site
- O #addrBtn fica no meio (“Sua região ▾ São Paulo - SP”) e abre o seletor em tela cheia.
- Enquanto o pedido está aberto, o aviso #geoAviso fica fixo logo abaixo do cabeçalho (top 72 px, 12 px de cada lado).
- O pedido do Android aparece embaixo e o do iPhone no meio, então o aviso no alto continua visível.

Primeira tela (sem rolar)
- Título e busca do exame.
- #nearCta com o texto pequeno do local mais perto: “Mais perto: Clínica Parceira Paulista, a 300 m”. Esse texto tem 2 linhas reservadas, com line-clamp, para o botão não mudar de altura.
- Atalhos e emergência.
- O começo do 3D, com rótulos de locais reais, ou a lista leve, com 4 locais.

Tela “Clínicas perto de você”, logo depois do 3D, em largura cheia (sem borda de cartão; padding de 16 px)
- Linha da cidade: #cityBtn com no mínimo 52 px e nome com reticências. Embaixo, #cityLine e, quando couber, #useGeoBtn.
- Abas de 44 px que quebram em 2 linhas. Nenhum tipo fica escondido e não há rolagem lateral.
- #pvSum e o botão #mapOpen “Ver no mapa” (44 px) na mesma linha; quebram se faltar espaço.
- Lista com 6 itens. Cada um tem número colorido, nome em 1 linha com reticências, “tipo · bairro”, selos e a distância em negrito à direita.
- #pvMore “Mostrar mais 4” mostra o resto sem nova busca e leva o foco ao 7º item.
- Por fim: #pvAll, “Todas as cidades” e a fonte.

Mapa
- Não aparece durante a rolagem.
- leaflet.js, as imagens do mapa e establishment_points só são baixados no toque em “Ver no mapa”.
- O toque abre o mapa em tela cheia, como uma janela:
  - .pv-mapa ganha a classe .cheio: position:fixed; inset:0; fundo branco; flex em coluna;
  - role=dialog, aria-modal=true e aria-labelledby apontando para o título;
  - body.mapa-cheio eleva o .sheet-top para z-index 75 e trava a rolagem do fundo. Sem isso, o mapa ficaria atrás do cabeçalho, do menu de baixo e do aviso LGPD, porque o .sheet-top tem z-index 4.
- Dentro da janela:
  - barra no alto com “Voltar para a lista” (#mapClose, 44 px) e o título “Mapa · São Paulo - SP · Laboratórios”;
  - o mapa ocupa o resto da tela;
  - legenda #realStats embaixo;
  - pinos numerados iguais aos da lista;
  - balão com o link da página do local;
  - botões + e − de 44 px (o CSS de hoje já faz isso).
- Como fecha: pelo botão, pelo Esc ou pelo “voltar” do Android.
  - Ao abrir: history.pushState({imedMapa:1}, ''), sem mudar o endereço.
  - O evento popstate fecha a janela.
  - Fechar pelo botão ou pelo Esc chama history.back().
- Foco preso na janela. Ao fechar, volta para #mapOpen.
- map.invalidateSize() ao abrir.
- Se a tela passar para 900 px ou mais com o mapa aberto, a janela fecha.

Estados
- Cartões de largura cheia, com botões empilhados de 44 px.
- Atalhos das cidades em grade de 2 colunas (minmax(0,1fr)), com o nome e o número real de locais.

360 px sem rolagem lateral, medido contra 360 e não contra innerWidth
- grid com minmax(0,…);
- nomes com reticências;
- abas e atalhos que quebram linha;
- mapa e seletor com inset 0;
- letra de 16 px no campo de busca;
- alvos de toque de 44 px.

Com “reduzir movimento”
- mapa e seletor abrem sem animação;
- as linhas de espera não brilham;
- no Leaflet, zoomAnimation, fadeAnimation e markerZoomAnimation ficam desligados.

## Seletor de cidade

É um seletor só. Usa a janela que já existe (#ov/#sheet, classe .cid): o foco fica preso, o Esc fecha e o foco volta para quem abriu.

Onde abre:
- #addrBtn e #heroLoc;
- #cityBtn;
- “Prefiro escolher a cidade” (no aviso e no estado aguardando);
- “Escolher minha cidade” e “Escolher outra cidade”;
- “Escolher uma cidade” do Como funciona (vira <button data-city-open>);
- endereço com #cidade ou #cidades.

Tamanho:
- Computador: janela central de 540 px (.sheet.sm).
- Celular (até 860 px): tela cheia (height 100dvh, max-height none, sem cantos), com cabeçalho fixo “Escolha a cidade” e o X.
- O openSheet ganha a opção de escolher onde pôr o foco: ele vai para #cityQ.

Conteúdo, de cima para baixo:

1) Botão #cityGeo “Usar minha localização atual” (48 px), com o estado em #cityGeoState:
- “Ativa · São Paulo - SP” ou só “Ativa”;
- “Toque para permitir”;
- “Aguardando permissão…”;
- “Bloqueada no navegador: veja como liberar”: abre a ajuda #cityGeoHelp sem chamar o navegador;
- “Não disponível neste navegador”: botão desabilitado.
Com a posição conseguida, passa para o modo perto e fecha a janela.

2) Campo da cidade
- Rótulo: <label for=cityQ>Cidade</label>.
- Campo: <input id=cityQ type=text role=combobox aria-autocomplete=list aria-controls=cityList aria-expanded aria-describedby=cityDica autocomplete=off autocapitalize=off spellcheck=false enterkeyhint=search placeholder='Digite o nome da cidade'>, com letra de 16 px.
- #cityDica (visível): a dica de uso das setas.
- #cityHint (role=status, visível): quantas cidades foram achadas.

3) Com o campo vazio (lista de resultados escondida, aria-expanded=false):
- “Sua região: São Paulo - SP”, só se a região foi afirmada. Escolher passa para o modo perto, sem geocodificar.
- “Recentes”: até 3 botões. Com a posição conhecida, cada um mostra “fica a X km de você”.
- “Cidades com mais locais”: 12 botões, ordenados no aparelho pelo total, com “N locais no cadastro oficial”.
- Grade auto-fill minmax(150px,1fr), botões de 48 px.

4) Digitando: lista <ul id=cityList role=listbox aria-label='Cidades com o cadastro oficial no IMED'>
- Até 50 opções <li role=option id=cityOpt-<ibge> aria-selected>.
- Cada uma: “Campinas - SP” e, menor, “1.120 locais no cadastro oficial” (número real).
- O <ul> já existe no HTML, escondido.

Busca (inicio-core.matchCities)
- Ignora acento, maiúscula, apóstrofo, hífen e pontuação.
- “Campinas - SP” e “campinas sp” filtram pela UF: vale o último pedaço de 2 letras que for UF da lista.
- Ordem: nome que começa com o texto; depois, palavra que começa com o texto; depois, nome que contém o texto.
- Empate: mais locais primeiro, depois o nome (pt-BR).
- Entram só cidades com total > 0 e UF válida. No máximo 50.
- O #cityHint atualiza 300 ms depois da última tecla.

Teclado e toque
- ↓ e ↑ andam pelas opções, dando a volta (aria-activedescendant, aria-selected e scrollIntoView nearest).
- Enter escolhe a opção ativa; sem nenhuma ativa, a primeira.
- Esc com texto limpa o campo (stopPropagation, para a janela não fechar). Esc com o campo vazio fecha a janela.
- Tab segue para o próximo controle.
- Toque ou clique escolhe. O mousedown usa preventDefault, para o campo não perder o foco.

Depois de escolher
- É a cidade da região (mesmo ibge) e a posição é conhecida: passa para o modo perto, sem geocodificar.
- Está nas recentes ou é a imed_cidade: usa o centro guardado.
- Nos outros casos:
  - o campo fica desabilitado e o #cityHint diz “Procurando o centro de Campinas…”;
  - chama a geocodificação de hoje: Edge Function clinicas-proximas, {action:'geocode', q:'Campinas, SP'}.
- Se falhar: a janela fica aberta, o campo é liberado, aparece a mensagem de erro e nada é guardado.
- Se der certo:
  - S.city = {ibge, name, uf, lat: round3, lng: round3};
  - modo cidade; a aba volta para Todos;
  - grava imed_cidade (no formato de hoje) e imed_cidades_recentes (até 3, sem repetir);
  - IMED_TRACK('busca_cidade','UF/Nome');
  - faz um HEAD em cidades/<uf>/<slug>/ para decidir se o link da página da cidade aparece;
  - fecha a janela; o foco volta para quem abriu, já com o nome novo;
  - mostra o aviso curto (toast);
  - tela, 3D, topo e fonte mudam juntos.

Distância até a localização atual
- Calculada no aparelho (haversine), com a posição arredondada. Nada é enviado.
- Aparece na linha da cidade e nas recentes.
- Nos itens da lista, só quando o centro da cidade fica a até 50 km da pessoa.

Rodapé da janela
- “Não achou sua cidade? Busque pelo CEP ou endereço” (perto.html, onde o IMED começa a importar a cidade).
- “Todas as cidades” (cidades/).

Se o imported_cities estiver fora do ar
- Aparecem a mensagem de erro e “Tentar de novo”, que zera a promessa e chama o banco de novo.
- O botão de localização e o rodapé continuam funcionando.

## Lista e mapa

Item da lista
Só dado real do CNES ou de clínica parceira publicada. Cada item é um <li><a href=local.html?…> dentro de <ol id=realList>, com:
- Número de 1 a 10 num círculo (aria-hidden). Cores escuras, com contraste de pelo menos 4,5:1 para o número branco: imagem #0E7C9C, laboratório #6C4BD8, clínica #137A44, hospital #BF3B20.
- Nome em <b>, como texto puro, em 1 linha com reticências.
- <small>: “Parceiro do IMED · ” (só parceiro) + tipo + “ · ” + bairro.
- Selos, só quando o dado existe: “Aberto 24 horas” (open_24h) e “Atende SUS” (sus, só CNES).
- Distância à direita, na regra do geo-core.formatDistance:
  - com “~” quando location_source = 'endereco';
  - texto escondido “ de você” ou “ do centro de Campinas”;
  - no modo cidade, com a pessoa a até 50 km, uma linha a mais: “a 9 km de você”.
- O link leva a local.html?id= (parceiro) ou a local.html?cnes= (CNES).
- Sem preço, nota, horário de funcionamento ou contagem inventada. Nenhum “R$” na página.

Ordem
- Só pela distância da origem.
- Parceiros entram misturados pela distância.

Quantidade
- 10 por aba.
- O celular mostra 6 e o botão “Mostrar mais 4”.

Link “Ver todos” (#pvAll)
- Modo perto: “Ver todos os N locais em até 2 km, com filtros”, para perto.html?usar=localizacao. N = total da nearby_establishments + parceiros do mesmo raio e tipo. Sem total, o texto sai sem o número.
- Modo cidade: “Ver todos os locais de Campinas, por tipo”, para cidades/<uf>/<slug>/, só se o HEAD deu 200. Senão, “Todas as cidades”.

Abas (#pvTabs)
- role=group, aria-label “Tipo de local”, botões com aria-pressed: Todos, Imagem, Laboratórios, Clínicas, Hospitais.
- Tab passa pelas abas; Enter ou Espaço escolhem; o foco fica na aba.
- A aba vale para a lista e para os pontos do mapa.
- Volta para Todos quando a origem muda.
- Cada troca conta busca_tipo no contador.

Distância da busca
- Começa em 2 km.
- Com menos de 3 locais na aba (CNES + parceiros), busca em 10 km e depois em 50 km (inicio-core.proximoRaio).

Resumo (#pvSum, role=status)
- Só a frase, gerada por inicio-core.textoResumo, com gênero e número certos.
- Sem nada em 50 km:
  - numa aba: frase de “nenhum” e botão “Ver todos os tipos”;
  - em Todos: estado 'vazio'.

Mapa (#realMap, Leaflet, preferCanvas, scrollWheelZoom false)
- Círculo tracejado do raio dos pontos.
- Ponto da origem: “Você (aproximado)” ou “Centro de Campinas”.
- Pontos coloridos de todos os locais da área (establishment_points, em canvas, até 3.000).
- Parceiros maiores, com borda coral. Continuam como L.circleMarker.
- Pinos numerados de 1 a 10, iguais aos da lista: L.marker com L.divIcon .pv-pin, keyboard:false, zIndexOffset alto e o mesmo balão (realPopup).
- Legenda #realStats com os 4 números reais por tipo, na ordem Imagem, Laboratórios, Clínicas, Hospitais. Soma os parceiros e mostra “+” quando o total passa dos pontos recebidos.
- Descrição escondida ligada ao mapa por aria-describedby.

Enquadramento
- O mapa enquadra o círculo.
- Se a aba precisou ir além do círculo, enquadra a origem e os 10 pinos (padding de 24 px).

Ligação entre lista e mapa
- Computador: mouse ou foco no item acende o pino. O mapa só se move se o pino estiver fora da vista. Clique no pino abre o balão e marca o item (.on + scrollIntoView nearest).
- Celular: o mapa em tela cheia mostra os mesmos pinos, e o balão leva à página do local.
- Trocar de aba troca os pinos e filtra os pontos no aparelho, sem nova chamada.

## Dados e RPCs

Nada muda no banco: nenhuma função nova, nenhuma migração, nenhuma Edge Function nova. As funções abaixo foram conferidas nas migrações.

imported_cities()
- Devolve ibge, name, uf, total e o total por tipo.
- Uma chamada por página (promessa loadCities em memória, como hoje). Atende a pílula, o seletor, os atalhos e a ligação com a região (Math.floor(ibge/10) === city_code).
- Não guardar no aparelho.

nearby_establishments, para a lista
- Parâmetros: p_lat e p_lng arredondados, p_radius_m 2000, p_limit 10, p_kind só quando há aba.
- Com menos de 3 locais, repete com 10000 e depois com 50000. No máximo 3 chamadas por aba e origem.
- O total da 1ª linha alimenta o “Ver todos os N”.
- city, uf e city_code alimentam o cityOfRows.
- location_source define o “~”.

nearby_clinics, para os parceiros
- Mesmo ponto e mesmo raio da lista; p_include_demo false; p_limit 100.
- Uma chamada por origem e raio. A aba filtra no aparelho.
- Se falhar, a lista mostra só o CNES.

establishment_points, para os pontos do mapa
- ?select=cnes,name,kind,lat,lng,distance_m,total; mesmo ponto; p_radius_m igual ao raio da lista Todos (2000 na maioria); p_limit 3000.
- Uma chamada por origem.
- Computador: só quando a tela chega a 100 px da vista e depois da 1ª lista.
- Celular: só ao abrir o mapa.
- Com economia de dados ou 2G: só no toque.

cnes_last_update, para a linha da fonte
- p_city = ibge da cidade escolhida.
- Exemplo: 3550308 (São Paulo).
- Modo perto: ibge da região, se ela foi afirmada; senão, sem p_city.
- No modo perto, é chamada depois da 1ª lista.

Edge Function clinicas-proximas
- {action:'geocode', q:'Campinas, SP'}, só ao escolher uma cidade sem centro guardado.
- O servidor já guarda o resultado por 60 min. O centro é arredondado (round3).

Contador (track)
- busca_cidade 'UF/Nome' ao escolher a cidade.
- busca_tipo ao trocar de aba.
- Nunca a posição.

Outras chamadas
- 3D: continua com nearbyAll(origem, 3000, 80).
- HEAD em cidades/<uf>/<slug>/ (no próprio site), ao escolher a cidade.

Cache e respostas velhas
- Só em memória:
  - listas por 'lat,lng|tipo|raio';
  - parceiros por 'lat,lng|raio';
  - pontos por 'lat,lng|raio'.
- Limpo ao trocar de origem. Nunca vai para o armazenamento do aparelho, porque revelaria a região.
- rpc(fn, args, {signal}) aceita AbortSignal e mantém o limite de 15 s.
- Um número de sequência descarta respostas velhas.
- O service worker continua sem guardar respostas do banco.

Chamadas ao abrir
- Celular, com permissão: imported_cities, 2 da lista, 2 do 3D e cnes_last_update. Sem Leaflet e sem pontos.
- Computador: as mesmas, mais Leaflet, imagens do mapa e pontos quando a tela chega à vista.

No aparelho
- localStorage:
  - imed_cidade {ibge, name, uf, lat, lng}, no formato de hoje;
  - imed_cidades_recentes (até 3);
  - imed_geo_recusas (0 a 2).
- sessionStorage: imed_geo_pedido='1'.
- Apagar imed_place.
- Nunca: posição, região ou lista.

## O que sai ou muda

#cidades sai da página inicial
- Saem a seção, o #cities, o renderCities e o CSS .cities, .city e .cities-empty.
- citySlug vai para inicio-core.js.
- Não mudam: as 318 páginas cidades/**, o índice cidades/, o sitemap e o scripts/gerar-cidades.mjs.
- A página inicial continua ligando para as páginas de cidade por:
  - “Todas as cidades” (no HTML da tela e no seletor);
  - “Ver todos os locais de <cidade>, por tipo”;
  - rodapé;
  - guias de exames.

#reais vira a tela “Clínicas perto de você”
- Passa a ser a primeira seção do <main> e fica sem a classe .rv.
- Ficam os ids reais, reaisTitle, realMap, realList e realStats.
- Saem #realExample, #realWhere, #realPlace, #realChoose, o botão “Por cidade” e o CSS .rm, .rm-side, .rm-ex, .rm-where, .rm-list e .rm-more.
- Ficam .rm-map, .rm-wait, .rm-spin, .rm-stats, .rm-stat, .rm-src e .rm-pop.
- Entra o CSS .pv-*.

A janela “Ponto de partida do mapa” sai
- Saem openPlace, fillCities, #citySel, #cityMsg, #geo e os 7 bairros de São Paulo.
- O data.js fica só com PLACES.paulista.
- A chave imed_place é apagada.

Topo 3D e lista leve
- #hero3d, #heroLite e o botão “Pausar animação” ficam. hero3d.js não muda.
- A origem do 3D segue a tela, com espera de 8 s (pedido) ou 3 s (silencioso). Sem origem, usa o exemplo marcado.
- O título da lista leve fica em 1 linha.

#nearCta
- href muda de perto.html?usar=localizacao para #reais.
- Rola até a tela e pede a localização com o toque quando falta origem.
- O texto pequeno passa a mostrar o local mais perto real.

Outros elementos do topo
- #addrBtn e #heroLoc mostram a origem e abrem o seletor.
- A pílula fica igual. #heroSrc segue a cidade em uso.

Rotas por #
- #cidade e #cidades abrem o seletor (sem pedido automático).
- #lojas, #pedido e #clinica- continuam levando a #reais.
- Nenhum link do HTML aponta para #cidade.

Textos e páginas
- Em Como funciona, “Escolher uma cidade” vira um botão que abre o seletor.
- A pergunta frequente sobre localização é atualizada.
- Em privacidade.html, a linha “Localização” ganha id=localizacao, e a lista do que fica no aparelho é atualizada.

Código do inicio.js
- closeSheet: se quem abriu a janela sumiu, o foco vai para #cityBtn.
- rpc() aceita signal.

Busca completa
- perto.html e perto.js não mudam: continuam pedindo a localização só com toque.
- Anotar em arquitetura.md que isso é decisão do Dr. Rafael.

Arquivos novos
- inicio-core.js e inicio-perto.js. Entram no CORE do sw.js, com VERSION nova.

## Textos

- Seção (#reais):
- kicker “Cadastro oficial · Ministério da Saúde”;
- título “Clínicas perto de você”;
- subtítulo “Clínicas, laboratórios, centros de imagem e hospitais do cadastro oficial (CNES) e as clínicas parceiras do IMED, do mais perto para o mais longe.”;
- link “Busca completa”.
- Linha da cidade:
- rótulo “Sua região” (localização com cidade afirmada), “Perto de você” (localização sem cidade), “Cidade escolhida” ou “Onde você está?”;
- botão #cityBtn: “São Paulo - SP” + “Trocar” (leitor de tela: “: trocar a cidade”);
- sem origem: “Escolher cidade”.
- Situação (#cityLine):
- “Distâncias medidas da sua localização aproximada.”
- “Distâncias medidas do centro de Campinas.”
- com a posição conhecida: “Campinas fica a 84 km de você.”
- botão “Usar minha localização”; se bloqueada: “Localização bloqueada: como liberar”.
- Aviso no alto (#geoAviso):
- texto: “Para mostrar as clínicas mais perto, o IMED pede a sua localização. Usamos só a região aproximada, sem o ponto exato, e não gravamos.”
- botões: “Prefiro escolher a cidade”, “Saiba mais” (privacidade.html#localizacao) e o X “Fechar aviso”;
- depois de 8 s sem resposta, acrescenta: “Não apareceu a pergunta? Toque no ícone de localização ao lado do endereço do site ou escolha a cidade.”
- Leitor de tela (#geoStatus):
- “O IMED pediu sua localização para mostrar as clínicas mais perto.”
- “Pronto! Mostrando as clínicas perto de você.”
- “Sem a sua localização. Escolha a cidade para ver os locais.”
- Aguardando:
- “Aguardando sua permissão…”
- “Se o navegador perguntar, toque em Permitir.”
- botão “Prefiro escolher a cidade”.
Buscando: “Buscando sua localização…”
- Negou ou bloqueada:
- título “A localização está desligada para o IMED”;
- texto “Tudo bem: escolha a sua cidade. Para usar a localização depois, toque no cadeado ao lado do endereço do site e permita a localização.”;
- botão “Escolher minha cidade” e os atalhos.
- Fechou sem responder:
- título “Sem a localização, escolha a cidade”;
- texto “Você pode permitir a localização quando quiser.”;
- botões “Usar minha localização” e “Escolher minha cidade”.
- Não apareceu:
- título “O navegador não mostrou o pedido de localização”;
- texto “Para liberar, toque no cadeado ao lado do endereço do site e permita a localização. Ou escolha a cidade.”;
- botões “Usar minha localização” e “Escolher minha cidade”.
- Demorou ou indisponível:
- títulos “A localização demorou para responder” ou “Não conseguimos descobrir onde você está”;
- texto “Veja se a localização do aparelho está ligada e tente de novo, ou escolha a cidade.”;
- botões “Tentar de novo” e “Escolher minha cidade”.
- Sem suporte: “Seu navegador não informa a localização. Escolha a cidade para ver os locais.”
- Sem pedido automático:
- título “Onde você está?”;
- texto “Use sua localização ou escolha a cidade para ver as clínicas mais perto.”;
- botões “Usar minha localização” e “Escolher minha cidade”;
- título dos atalhos: “Cidades com mais locais”.
Cada atalho: “São Paulo - SP” + “6.548 locais” (número real do imported_cities).
- Resumo (#pvSum):
- “Os 10 mais perto de você”
- “Os 10 mais perto do centro de Campinas”
- “Os 10 laboratórios mais perto de você”
- “O hospital mais perto de você”
- “Nenhum hospital em até 2 km. Os mais perto, em até 10 km:”
- “Poucas clínicas em até 2 km. As mais perto, em até 10 km:”
- “Nenhum local de diagnóstico por imagem do cadastro oficial em até 50 km daqui.” + botão “Ver todos os tipos”
- Abas (grupo “Tipo de local”): “Todos”, “Imagem”, “Laboratórios”, “Clínicas”, “Hospitais”.
- Item da lista:
- “Parceiro do IMED · Diagnóstico por imagem · Bela Vista”;
- selos “Aberto 24 horas” e “Atende SUS”;
- distância “420 m”, “~640 m”, “1,2 km” ou “12 km” (leitor de tela: “ de você” ou “ do centro de Campinas”);
- linha extra no modo cidade: “a 9 km de você”.
- Botões e links:
- “Ver no mapa” e “Voltar para a lista”;
- “Mostrar mais 4”;
- “Ver todos os 1.024 locais em até 2 km, com filtros”;
- “Ver todos os locais de Campinas, por tipo”;
- “Todas as cidades” e “Busca completa”;
- “Mostrar o mapa” e “Tentar de novo”.
- Mapa:
- título da janela no celular: “Mapa · São Paulo - SP · Laboratórios”;
- legenda: “Em até 2 km” + os 4 números;
- ponto da origem: “Você (aproximado)” ou “Centro de Campinas”;
- descrição escondida: “Mapa com os locais do cadastro oficial perto do ponto escolhido. Os números são os mesmos da lista; pelo teclado ou leitor de tela, use a lista.”;
- sem origem (computador): “O mapa aparece quando você permite a localização ou escolhe a cidade.”;
- se falhar: “O mapa não carregou. A lista continua funcionando.” + “Tentar de novo”;
- economia de dados: “Para gastar menos internet, o mapa não abre sozinho.” + “Mostrar o mapa”.
- Sem cadastro:
- título “Ainda não temos o cadastro oficial desta região”;
- texto “Na busca completa, o IMED começa a trazer os dados do CNES da sua cidade e mostra o mapa público.”;
- botões “Abrir a busca completa” e “Escolher outra cidade”.
- Erro do banco:
- “Não foi possível carregar os locais agora.”
- “Verifique sua internet e tente de novo.”
- botão “Tentar de novo”.
- Seletor, título e localização:
- título “Escolha a cidade”;
- botão “Usar minha localização atual”, com o estado “Ativa · São Paulo - SP”, “Ativa”, “Toque para permitir”, “Aguardando permissão…”, “Bloqueada no navegador: veja como liberar” ou “Não disponível neste navegador”;
- ajuda: “Para liberar: no computador, clique no cadeado ao lado do endereço do site e permita a Localização. No Android, toque no cadeado > Permissões > Localização. No iPhone, toque em aA ao lado do endereço > Ajustes do Site > Localização > Permitir. Depois, toque em Usar minha localização.”
- Seletor, campo e listas:
- rótulo “Cidade”, com o texto de exemplo “Digite o nome da cidade”;
- dica “Use as setas para escolher e Enter para confirmar.”;
- “Sua região: São Paulo - SP”, “Recentes” e “Cidades com mais locais”;
- opção “Campinas - SP” + “1.120 locais no cadastro oficial”;
- distância “fica a 84 km de você”;
- contagem: “12 cidades encontradas”, “1 cidade encontrada”, “Mostrando 50 de 120. Continue digitando.” ou “Nenhuma cidade com esse nome no IMED ainda.”;
- rodapé: “Não achou sua cidade? Busque pelo CEP ou endereço” · “Todas as cidades”.
- Seletor, espera e erros:
- “Carregando as cidades…”
- “Não foi possível carregar a lista de cidades agora.” + “Tentar de novo”
- “Procurando o centro de Campinas…”
- “Não foi possível achar o centro desta cidade agora. Tente de novo ou use a busca completa.”
- aviso curto depois de escolher: “Mostrando os locais perto do centro de Campinas”
- Topo do site (#addrSmall / #addrTxt):
- “Sua região” / “São Paulo - SP”
- “Perto de você” / “Sua localização”
- “Cidade escolhida” / “Campinas - SP”
- “Sua localização” / “Procurando…”
- “Onde você está?” / “Escolher cidade”
Texto escondido: “: trocar a cidade”.
Busca do topo (#heroAddr): “São Paulo”, “Sua localização”, “Campinas” ou “Escolher cidade”.
- #nearCta: “Encontrar clínicas perto de mim”. Texto pequeno:
- padrão: “Clínicas, laboratórios e hospitais reais, no mapa”;
- perto: “Mais perto: Clínica Parceira Paulista, a 300 m”;
- cidade: “Mais perto do centro de Campinas: Hospital X, a 1,2 km”.
- Lista leve do 3D (#heroLite), título em 1 linha:
- “Perto de você” (esperando; status “Aguardando sua localização…”);
- “Perto da sua localização” (status “4 locais perto da sua localização”);
- “Perto do centro de Campinas”;
- “Exemplo: perto da Av. Paulista” (status “4 locais perto da Av. Paulista, em São Paulo (exemplo)”).
- Fonte, igual à de hoje: “Endereços do CNES, base pública do Ministério da Saúde. O IMED é um serviço privado, sem vínculo com o governo ou o SUS. Valores e horários são confirmados com o local.”
- Pergunta frequente da localização, novo começo: “Ao abrir o IMED, o navegador pergunta se você permite usar a localização, para mostrar os locais perto de você. Ela sai do aparelho de forma aproximada, sem o ponto exato onde você está, e não guardamos sua posição. Se preferir, escolha a cidade: você vê os locais perto do centro dela.” O resto do texto de hoje continua.
- Privacidade:
- linha “Localização” da tabela, que ganha id=localizacao: acrescentar “Na página inicial, o pedido aparece assim que você abre o site, no máximo uma vez por aba, e não aparece mais sozinho depois de duas recusas. Se você não permitir, escolha a cidade.”;
- item dos dados no aparelho: trocar “a cidade ou o bairro escolhido no mapa” por “a cidade escolhida e as 3 últimas cidades escolhidas (nome, estado e o centro da cidade), quantas vezes o pedido de localização não foi aceito (até 2, para não perguntar sem parar) e, até fechar a aba, um aviso de que a localização já foi pedida (sem a posição)”.
- Nenhum texto da página, nem dos avisos, usa “a partir de”: o teste “só dados reais” proíbe essa expressão.

## Arquivos

- /home/user/testedoapp/index.html — tela nova #reais logo depois do topo (sem .rv); #geoAviso e #geoStatus logo depois do <header>; #nearCta com href #reais; botão data-city-open no Como funciona; sai a seção #cidades e o CSS antigo. CSS novo: .pv-*, .geo-aviso, .pv-pin, .sheet.cid (tela cheia no celular), body.mapa-cheio .sheet-top{z-index:75}, altura fixa do texto pequeno do #nearCta e do título da lista leve. Também a pergunta frequente da localização e os textos do #addrBtn.
- /home/user/testedoapp/assets/js/inicio.js — origem lida do estado da tela; espera do 3D e da lista leve; rótulos do topo; fonte da cidade; openSheet com foco escolhido; rotas #cidade e #cidades; rpc com signal; apaga imed_place. Saem openPlace, fillCities, chooseCity antigo, renderCities, areaPlaces, renderRealMap e o observador antigo do #reais.
- /home/user/testedoapp/assets/js/inicio-perto.js (novo) — iniciarPerto(ctx) com um estado só (modo, geo, here, hereCity, city, tipo, raio): pedido e acompanhamento da permissão, aviso, estados, lista, abas, mapa (Leaflet, pontos, pinos, tela cheia com pushState) e seletor (combobox, recentes, atalhos, geocode, HEAD). O inicio.js passa rpc, geocode, toast, openSheet/closeSheet/head, loadLeaflet, loadCities e store, e recebe aoMudarOrigem().
- /home/user/testedoapp/assets/js/inicio-core.js (novo) — regras puras testadas no Node: geoPlan, geoErro, matchCities, cityOfRows, kmEntre, fmtDist (igual ao geo-core.formatDistance), proximoRaio, deCidade, citySlug e textoResumo.
- /home/user/testedoapp/assets/js/data.js — PLACES fica só com paulista; comentário atualizado.
- /home/user/testedoapp/privacidade.html — linha Localização com id=localizacao e o pedido ao abrir; lista do que fica no aparelho. Manter as linhas da outra frente (Cadastro de médico, Cobranças).
- /home/user/testedoapp/sw.js — VERSION no número seguinte ao da main na hora do commit (o arquivo local já está em imed-v15); CORE com ./assets/js/inicio-core.js e ./assets/js/inicio-perto.js.
- /home/user/testedoapp/tests/geo-simulado.mjs (novo) — simulador da permissão e da localização, usado no e2e-inicio, no e2e-a11y e no e2e-velocidade.
- /home/user/testedoapp/tests/inicio-core.test.mjs (novo)
- /home/user/testedoapp/tests/e2e-inicio.mjs
- /home/user/testedoapp/tests/e2e-a11y.mjs
- /home/user/testedoapp/tests/e2e-velocidade.mjs
- /home/user/testedoapp/scripts/gravar-video.mjs — no celular, abrir e fechar o mapa em tela cheia na cena do mapa.
- /home/user/testedoapp/memory/context/arquitetura.md — tela nova, arquivos novos e a decisão do dono: a página inicial pede ao abrir, a busca completa só com toque, e o aviso do Lighthouse é esperado.
- /home/user/testedoapp/CLAUDE.md — Estado atual.
- Sem mudança: perto.html, assets/js/perto.js, local.html, assets/js/hero3d.js, assets/js/aviso.js, cidades/**, scripts/gerar-cidades.mjs e supabase/**. O recorte de ícones só muda se entrar ícone novo; nesse caso, rodar node scripts/fontes.mjs.

## Testes

- Novo tests/inicio-core.test.mjs, função geoPlan:
- cidade salva → 'cidade' (com 'granted', também a posição em silêncio);
- 'granted' → 'silencioso';
- 'denied' → 'bloqueada';
- 'prompt' na 1ª vez → 'pedir'; 'unknown' vale como 'prompt';
- pedido já feito na aba ou 2 recusas → 'esperar';
- #agenda, #tele, #lista, #cidade ou #cidades → 'esperar';
- #lojas ou #clinica-x → 'pedir';
- sem suporte → 'sem-suporte'.
- inicio-core, função geoErro:
- código 1 com 'denied' → 'negada';
- código 1 com 'prompt' em 300 ms → 'naoapareceu';
- código 1 com 'prompt' em 2 s → 'fechou';
- código 2 → 'indisponivel';
- código 3 → 'demorou'.
- inicio-core, função matchCities:
- 'sao' traz São Paulo primeiro;
- 'barbara d oeste' e 'santa barb' acham Santa Bárbara d'Oeste;
- 'campinas sp' e 'Campinas - SP' filtram pela UF;
- ordem: começo do nome, depois começo de palavra, depois contém; no empate, o total maior;
- no máximo 50, com o total encontrado;
- ignora UF inválida e total 0;
- campo vazio → [].
- inicio-core, função cityOfRows:
- 355030, número ou texto, ↔ 3550308;
- só afirma com o mais perto a até 3 km e 3 dos 5 mais perto da mesma cidade;
- menos de 3 linhas → null;
- ignora parceiros.
- inicio-core, contas e textos:
- kmEntre da Paulista ao centro do Rio, com fmtDist → '363 km';
- fmtDist igual ao geo-core.formatDistance para 5, 15, 420, 999, 1000, 1234, 9999, 10000, 12345 e 50000;
- proximoRaio: 2000 → 10000 → 50000 → null;
- deCidade igual ao confianca.deCidade;
- citySlug igual ao slugify do gerar-cidades.mjs para as 318 cidades do scripts/cidades.json;
- textoResumo com gênero e número certos;
- nenhum texto com 'a partir de'.
- Novo tests/geo-simulado.mjs com simularGeo(context, opções):
- opções: estado 'granted'/'prompt'/'denied'; resposta 'permitir', 'negar', 'fechar', 'demorar', 'indisponivel' ou 'nunca'; atraso; pos; suporte; semPermissionsApi;
- por addInitScript, troca permissions.query({name:'geolocation'}) (com state, onchange e addEventListener) e getCurrentPosition;
- conta window.__geo.chamadas e window.__geo.pedidos (chamadas com o estado em 'prompt');
- permitir e negar mudam o estado e disparam change;
- estado e contadores ficam no sessionStorage da aba;
- window.__geoMudar(estado) simula a mudança nas configurações do navegador.
- e2e-inicio, newPage ganha a opção geo:
- padrão {estado:'granted', pos:{lat:-23.56512, lng:-46.65234}} → -23.565,-46.652, os números que os cenários do 3D já conferem;
- geo:null deixa o Chromium sem permissão.
- e2e-inicio, mudar 'só dados reais':
- sai a checagem de #cities e do slugify;
- a lista pede p_limit 10 e p_radius_m 2000;
- #realList tem os 4 nomes na ordem, com '~640 m' no laboratório, e os links local.html;
- continuam: nenhum R$, ★ ou 'a partir de'; pontos de 2 km no mesmo ponto; #realStats ['2','1','0','1']; 1 chamada a imported_cities;
- #nearCta com href '#reais';
- link 'Todas as cidades' na tela.
- e2e-inicio, mudar 'mapa 2 km': continuam 402 circleMarkers e 1 círculo, mais 4 L.Marker numerados, iguais à lista. Mudar 'sem dado do banco': sem #cities; pílula sem número; seletor com erro e 'Tentar de novo' (que chama de novo); atalhos escondidos.
- Novo cenário '1ª visita' (prompt → permitir):
- exatamente 1 pedido;
- #geoAviso visível, com 'região aproximada' e 'não gravamos', sem mover o foco;
- depois de permitir: aviso escondido, data-estado=lista, #addrSmall 'Sua região', #addrTxt 'São Paulo - SP', 4 itens;
- chamadas ao banco com no máximo 3 casas decimais;
- nenhum '-23.56' ou '-46.65' no localStorage, no sessionStorage, no endereço da página ou no contador;
- recarregar na mesma aba: nenhum pedido novo e nenhum aviso.
- Novo cenário 'negou':
- o estado vira 'denied'; data-estado=negada, com o texto do cadeado;
- atalhos ordenados pelo total, com os números reais;
- 3 s depois, nenhuma chamada nova;
- no seletor, a localização só abre a ajuda (0 chamadas);
- atalho do Rio → geocode 'Rio de Janeiro, RJ' → lista em (-22.907, -43.173);
- imed_cidade = {ibge:3304557, name:'Rio de Janeiro', uf:'RJ', lat:-22.907, lng:-43.173}; recentes com o Rio; imed_geo_recusas = 1.
- Novo cenário 'fechou e não apareceu':
- 'fechar' com 1.500 ms → data-estado=fechou; 'Usar minha localização' pede de novo só com o clique;
- outra página na mesma aba não pede sozinha;
- 'fechar' com 0 ms → data-estado=naoapareceu;
- contexto novo com imed_geo_recusas=2 → 0 pedidos e data-estado=onde.
- Novos cenários 'bloqueada desde antes', 'sem suporte' e 'demorou/indisponível':
- nenhuma chamada automática onde não deve;
- textos e botões certos;
- 'Tentar de novo' faz 1 chamada por clique;
- __geoMudar('granted') com a página aberta passa para a lista sozinho;
- nenhum erro no console.
- Novo cenário 'cidade escolhida antes':
- imed_cidade do Rio com 'prompt' → 0 pedidos e 0 geocodificações; lista do Rio; #heroSrc '…dados do Rio de Janeiro…';
- com 'granted' → 1 chamada silenciosa e 'Rio de Janeiro fica a 363 km de você', sem a distância nos itens;
- imed_cidade de São Paulo (centro -23.550, -46.633) e a pessoa na Paulista → itens com 'a … de você', iguais à conta do geo-core;
- #useGeoBtn → lista perto da pessoa e imed_cidade apagada.
- Novo cenário 'seletor', no computador e no celular de 390 px:
- abre por #addrBtn e por #cityBtn; foco no #cityQ; no celular, ocupa a tela toda;
- atributos aria-expanded, aria-controls, aria-activedescendant e aria-selected certos;
- 'barbara' mostra Santa Bárbara d'Oeste com '150 locais no cadastro oficial';
- Enter nela → geocode falha → mensagem, janela aberta e nada guardado;
- 'rio' + ↓ + Enter → janela fecha e o foco volta para quem abriu, com 'Rio de Janeiro - RJ';
- Esc com texto limpa; Esc com o campo vazio fecha;
- 'campinas sp' → 'Nenhuma cidade…';
- escolher a própria região → modo perto, sem geocodificar.
- Novo cenário 'abas' (o banco simulado respeita p_kind):
- 'Laboratórios' → aria-pressed; chamadas com p_kind 'laboratorio' e p_limit 10, em 2000, 10000 e 50000 m;
- só laboratórios na lista;
- busca_tipo contado (com ?visitas=teste);
- no computador, os pontos são filtrados sem nova chamada de establishment_points;
- voltar a Todos usa o cache.
- Novo cenário 'região sem cadastro': listas vazias em 2000, 10000 e 50000 m → data-estado=vazio, com o link perto.html?usar=localizacao. Novo cenário 'banco fora do ar' (erro 500): data-estado=erro; 'Tentar de novo' refaz e mostra a lista.
- Novo cenário 'celular: lista e mapa em tela cheia':
- 6 itens + 'Mostrar mais 4', que leva o foco ao 7º;
- nenhum leaflet.js nem establishment_points antes do toque;
- 'Ver no mapa' abre a janela (role=dialog) do tamanho da tela, por cima do cabeçalho e do menu de baixo (elementFromPoint nos cantos), com o foco em 'Voltar para a lista' e a legenda com números;
- Esc, o botão e page.goBack() fecham sem sair da página;
- o foco volta para 'Ver no mapa'.
- Novo cenário 'computador: lista e mapa lado a lado' (spyMap):
- número de L.Marker = número de itens;
- mouse e foco no item deixam o pino com .on;
- clique no pino abre o balão e marca o item;
- depois de rolar 300 px, o topo do mapa fica em ~96 px (sticky).
- Novo cenário 'o 3D espera a resposta' (modo leve):
- 'prompt', permitir com 3.000 ms de atraso e a pessoa em Recife → nenhuma busca de 3 km na Paulista antes da resposta; depois, a busca em Recife, arredondada;
- com 'nunca' e page.clock: aos 8 s, a busca de exemplo na Paulista, o título 'Exemplo: perto da Av. Paulista' e o aviso 'Não apareceu a pergunta?'.
- Novo cenário '#nearCta':
- o clique rola até a tela sem mudar o endereço;
- com 2 recusas, o clique faz 1 pedido;
- com 'granted', o texto pequeno vira 'Mais perto: Clínica Parceira Paulista, a 300 m' sem mudar a altura do botão.
- e2e-inicio, mudar outros cenários:
- 'contador': escolher o Rio pelo seletor; só {p_path:'/'} e busca_cidade 'RJ/Rio de Janeiro', sem coordenadas;
- '360 px': medir contra 360 a tela, as abas, a lista, o seletor e o mapa abertos;
- '390 px': sem a checagem do #cities e sem o .cities nas exceções; altura < 7.200 px;
- 'aparelho fraco': '4 locais perto da sua localização';
- 'ponto de partida' e 'Escolha sua cidade' viram os cenários novos (exemplo → São Paulo; região → cidade da região; cidade escolhida → ela).
- e2e-a11y:
- newPage ganha geoSim (simularGeo no lugar da permissão do Playwright);
- 'Início · janela da cidade' abre pelo #cityBtn e espera o #cityQ;
- novas páginas para axe, foco e alvos de toque: 'Início · aguardando a permissão', 'Início · localização bloqueada' e 'Início · mapa' (celular: abre a janela);
- os dois cenários 'janelas' passam a usar #cityBtn;
- novo cenário de teclado: abas com Tab e Enter, 'Mostrar mais 4' e o combobox (↓, Enter, Esc).
- e2e-velocidade:
- o caso de hoje continua igual: sem localização → naoapareceu, exemplo da Paulista e 'dados de São Paulo';
- novo caso a 390 e 412 px com 'granted': CLS < 0,005 enquanto o #nearCta e o #addrBtn mudam de texto;
- sem leaflet.js no celular sem o toque.
- scripts/gravar-video.mjs, no formato vertical: tocar em 'Ver no mapa', esperar .leaflet-tile-loaded, mostrar a legenda e depois 'Voltar para a lista'.
- Antes de publicar, rodar tudo:
- node --test tests/*.test.mjs (o links.test confere #reais e privacidade.html#localizacao);
- todos os tests/e2e-*.mjs (E2E_PORT para rodar em paralelo; AXE_PATH no a11y);
- node scripts/fontes.mjs --check.
Usar só ícones que já estão no recorte: location-dot, location-crosshairs, xmark, arrow-right, arrow-left, map, list, lock, rotate-right, circle-info, chevron-down, magnifying-glass e map-location-dot.

## Riscos

- Pedir ao abrir: o Lighthouse dá nota menor em Boas práticas, e quem nega não é perguntado de novo pelo navegador. É decisão do dono e vai anotada em arquitetura.md. Redução: aviso com o motivo, 1 pedido por aba, nenhum depois de 2 recusas, plano B forte e o botão de localização sempre à mão.
- Chrome: o pedido feito sem toque pode aparecer só como um ícone na barra de endereço. Depois de 3 fechamentos, o site fica bloqueado por um tempo. O aviso dos 8 s e a ajuda do cadeado cobrem esse caso. O limite de 2 recusas evita causar o bloqueio com o pedido automático.
- iPhone: o Safari pergunta de novo nas visitas novas. Toda recusa conta, inclusive “Não permitir”. Depois de 2, o site para de perguntar sozinho.
- Na 1ª visita aparecem juntos o pedido do navegador, o aviso no alto e o aviso LGPD embaixo. Conferir num Android e num iPhone de verdade antes de publicar.
- “Sua região” vem do local mais perto do cadastro e pode errar na divisa entre cidades. Só é afirmada com a regra do cityOfRows; nos outros casos aparece “Sua localização”. O “Trocar” fica sempre à vista.
- Camadas da tela: o .sheet-top tem z-index 4. Sem elevar o .sheet-top para 75, o mapa em tela cheia fica atrás do cabeçalho, do menu de baixo e do aviso LGPD. A seção não pode ter .rv, porque o transform quebra o position:fixed.
- “Voltar” do Android: usar pushState sem # e popstate; ao fechar pelo botão ou pelo Esc, chamar history.back(). Errar isso deixa uma entrada sobrando no histórico ou faz sair da página. Um teste cobre com page.goBack().
- Caixa de busca com lista (combobox) com o VoiceOver do iPhone: seguir o padrão da busca de exames e deixar as opções também tocáveis. Os atalhos são botões simples. Conferir com VoiceOver e TalkBack de verdade.
- Muitos testes mudam: cerca de 12 cenários do e2e-inicio, 4 do e2e-a11y, 1 do e2e-velocidade e o vídeo, e entram uns 15 novos. Sem o simulador, o Chromium dos testes cai sempre em “naoapareceu”.
- Velocidade no computador: o Leaflet e até ~270 KB de pontos chegam junto com o 3D. Por isso só depois da lista e com margem de 100 px; com economia de dados, só no toque.
- Cidade fora da lista de importadas: aparece o aviso de sem cadastro e o link para a busca completa. Cidade importada depois da última geração das páginas: o HEAD evita link quebrado.
- Google: a página inicial perde 24 links para páginas de cidade. Ficam “Todas as cidades” no HTML, o rodapé, os guias e o sitemap.
- Quem tinha um bairro de São Paulo salvo perde a escolha e passa a ver o pedido. O site é novo, então são poucas pessoas.
- Regras diferentes: a página inicial pede ao abrir, e o perto.html continua pedindo só com toque. Anotar em arquitetura.md para ninguém “corrigir”.
- Outra frente tem mudanças sem commit em index.html, privacidade.html, sw.js, CLAUDE.md, arquitetura.md e cidades/**. Trabalhar numa git worktree a partir da main mais nova. Não apagar o link “É médico? Atenda pelo IMED” nem as linhas novas da privacidade. Subir o VERSION para o número seguinte ao da main e commitar só os arquivos desta mudança.
- Alturas fixas na primeira tela (texto pequeno do #nearCta, título da lista leve, botões do topo): se alguma quebrar linha a mais, o teste de CLS falha.