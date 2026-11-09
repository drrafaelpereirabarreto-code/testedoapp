// Tabelas do banco. Funcionam igual no SQLite e no Postgres.
// Datas ficam como texto (AAAA-MM-DD ou data e hora ISO); listas ficam como JSON em texto.

export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS anuncios (
    id TEXT PRIMARY KEY,
    fonte TEXT NOT NULL DEFAULT 'apify',
    pagina_id TEXT,
    pagina_nome TEXT,
    pagina_foto TEXT,
    texto TEXT,
    titulo TEXT,
    descricao TEXT,
    cta TEXT,
    link_destino TEXT,
    dominio TEXT,
    imagem_url TEXT,
    video_url TEXT,
    video_capa TEXT,
    formato TEXT,
    plataformas TEXT,
    pais TEXT,
    palavra_chave TEXT,
    data_inicio TEXT,
    data_fim TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    colacao_id TEXT,
    colacao_qtd INTEGER NOT NULL DEFAULT 1,
    criativo_chave TEXT,
    biblioteca_url TEXT,
    primeira_vez TEXT,
    ultima_vez TEXT,
    dias_no_ar INTEGER NOT NULL DEFAULT 0,
    anunciante_ativos INTEGER NOT NULL DEFAULT 1,
    dominio_ativos INTEGER NOT NULL DEFAULT 1,
    duplicacoes INTEGER NOT NULL DEFAULT 1,
    crescimento REAL NOT NULL DEFAULT 0,
    pontuacao INTEGER NOT NULL DEFAULT 0,
    escalando INTEGER NOT NULL DEFAULT 0,
    detalhes_pontuacao TEXT,
    categoria TEXT,
    produto_id TEXT,
    bruto TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS anuncios_ultima_vez ON anuncios (ultima_vez, pontuacao)`,
  `CREATE INDEX IF NOT EXISTS anuncios_pagina ON anuncios (pagina_id)`,
  `CREATE INDEX IF NOT EXISTS anuncios_produto ON anuncios (produto_id)`,
  `CREATE INDEX IF NOT EXISTS anuncios_criativo ON anuncios (criativo_chave)`,

  `CREATE TABLE IF NOT EXISTS historico_anuncio (
    anuncio_id TEXT NOT NULL,
    dia TEXT NOT NULL,
    pontuacao INTEGER NOT NULL DEFAULT 0,
    anunciante_ativos INTEGER NOT NULL DEFAULT 0,
    duplicacoes INTEGER NOT NULL DEFAULT 0,
    escalando INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (anuncio_id, dia)
  )`,
  `CREATE TABLE IF NOT EXISTS historico_anunciante (
    pagina_id TEXT NOT NULL,
    dia TEXT NOT NULL,
    anuncios_ativos INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (pagina_id, dia)
  )`,
  `CREATE TABLE IF NOT EXISTS historico_produto (
    produto_id TEXT NOT NULL,
    dia TEXT NOT NULL,
    anuncios_ativos INTEGER NOT NULL DEFAULT 0,
    anunciantes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (produto_id, dia)
  )`,

  `CREATE TABLE IF NOT EXISTS produtos (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    categoria TEXT,
    primeira_vez TEXT,
    ultima_vez TEXT,
    anuncios_ativos INTEGER NOT NULL DEFAULT 0,
    anunciantes INTEGER NOT NULL DEFAULT 0,
    dias_max INTEGER NOT NULL DEFAULT 0,
    pontuacao_max INTEGER NOT NULL DEFAULT 0,
    tendencia REAL NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS analises (
    anuncio_id TEXT PRIMARY KEY,
    categoria TEXT,
    produto_nome TEXT,
    produto_id TEXT,
    promessa TEXT,
    gancho TEXT,
    oferta TEXT,
    chamada TEXT,
    publico TEXT,
    por_que_funciona TEXT,
    ideias TEXT,
    modelo TEXT,
    criado_em TEXT,
    erro TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS favoritos (
    anuncio_id TEXT PRIMARY KEY,
    nota TEXT,
    criado_em TEXT,
    atualizado_em TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS coletas (
    id TEXT PRIMARY KEY,
    dia TEXT NOT NULL,
    inicio TEXT NOT NULL,
    fim TEXT,
    status TEXT NOT NULL,
    fonte TEXT,
    execucao_id TEXT,
    total INTEGER NOT NULL DEFAULT 0,
    novos INTEGER NOT NULL DEFAULT 0,
    analisados INTEGER NOT NULL DEFAULT 0,
    mensagem TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY,
    valor TEXT
  )`,
];
