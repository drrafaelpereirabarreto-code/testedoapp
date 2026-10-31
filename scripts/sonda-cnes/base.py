"""Sonda B: a base completa mensal do CNES (BASE_DE_DADOS_CNES_AAAAMM.ZIP, tabelas em CSV).

  python3 -I base.py descobrir   acha o mês mais recente (FTP /cnes e as páginas de download em HTTPS)
  python3 -I base.py baixar      baixa o ZIP (tempo e tamanho)
  python3 -I base.py analisar    tabelas do ZIP; códigos oficiais dos equipamentos; estabelecimento x equipamento;
                                 Campinas e São Paulo; serviços especializados (para lab, eco e ECG)
"""

from __future__ import annotations

import csv
import json
import io
import re
import sys
import time
import traceback
import urllib.parse
import zipfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comum import (CAMPINAS, DADOS, FTP_HOST, SAO_PAULO, TIPOS_IMED, anotar, erro_curto, ftp_abrir,  # noqa: E402
                   ftp_baixar, ftp_listar, http, inteiro, ler_json, mb, mun6, numero, resumo_http, salvar_json,
                   tabela, uma_linha, velocidade)
from exames import EXAMES, Analise, cidades_do_imed, codigos_por_exame, sem_acento, texto_mapa  # noqa: E402

RE_BASE = re.compile(r'BASE_DE_DADOS_CNES_(\d{6})\.ZIP', re.I)
ESCOLHA = DADOS / 'base-escolha.json'
BAIXADO = DADOS / 'base-baixado.json'
ZIP = DADOS / 'base' / 'BASE_DE_DADOS_CNES.ZIP'
LIMITE_DOWNLOAD_S = 40 * 60
REPO = Path(__file__).resolve().parents[2]


# ----------------------------------------------------------------------------------------------- descobrir

def meses_recentes(n: int = 4) -> list[str]:
    hoje = date.today()
    a, m = hoje.year, hoje.month
    out = []
    for _ in range(n):
        out.append(f'{a}{m:02d}')
        m -= 1
        if m == 0:
            a, m = a - 1, 12
    return out


def descobrir() -> None:
    meses: dict[str, dict] = {}
    linhas = []
    try:
        f = ftp_abrir()
        linhas.append(f'FTP {FTP_HOST}: conectou; saudação: {uma_linha(f.getwelcome(), 120)}')
        for pasta in ['/', '/cnes']:
            try:
                itens, cru = ftp_listar(f, pasta)
            except Exception as e:  # noqa: BLE001
                linhas.append(f'FTP {pasta}: falhou ({erro_curto(e)})')
                continue
            bases = [i for i in itens if RE_BASE.fullmatch(i['nome'])]
            linhas.append(f"FTP {pasta}: {len(itens)} itens, {len(bases)} BASE_DE_DADOS_CNES; 1ª linha: {uma_linha(cru[0] if cru else '', 90)}")
            if pasta == '/':
                linhas.append('  pastas: ' + ', '.join(sorted(i['nome'] for i in itens if i.get('dir') is not False))[:900])
            else:
                outros = [f"{i['nome']} ({mb(i['tamanho'])})" for i in itens if not RE_BASE.fullmatch(i['nome'])]
                linhas.append('  outros: ' + ', '.join(outros[:30]))
            for i in bases:
                mes = RE_BASE.fullmatch(i['nome']).group(1)
                meses.setdefault(mes, {})['ftp'] = {'caminho': f"{pasta.rstrip('/')}/{i['nome']}",
                                                    'tamanho': i['tamanho'], 'data': i['data']}
        f.quit()
    except Exception as e:  # noqa: BLE001
        linhas.append(f'FTP {FTP_HOST}: falhou ({erro_curto(e)})')
    ult = sorted(meses)[-8:]
    linhas.append('Últimos meses no FTP: ' + ('; '.join(
        f"{m} {mb(meses[m]['ftp']['tamanho'])} ({meses[m]['ftp']['data']})" for m in ult if 'ftp' in meses[m]) or 'nenhum'))
    anotar('notice', 'B01 Base completa: o que o FTP do DATASUS tem em /cnes', '\n'.join(linhas))

    # Páginas de download do site do CNES (HTTPS) e as rotas HTTP(S) do arquivo.
    linhas = []
    links: dict[str, set] = {}
    for p in ['https://cnes.datasus.gov.br/pages/downloads/arquivosBaseDados.jsp',
              'http://cnes.datasus.gov.br/pages/downloads/arquivosBaseDados.jsp',
              'https://cnes.datasus.gov.br/pages/downloads/arquivos.jsp']:
        r = http(p, timeout=45)
        texto = (r.get('corpo') or b'').decode('latin-1', 'replace')
        citados = sorted(set(RE_BASE.findall(texto)))
        hrefs = sorted(set(re.findall(r'''href=["']([^"']*BASE_DE_DADOS[^"']*)["']''', texto, re.I)))
        for h in hrefs:
            m = RE_BASE.search(h)
            if m:
                links.setdefault(m.group(1), set()).add(urllib.parse.urljoin(r.get('final') or p, h))
        for m in citados:
            meses.setdefault(m, {})
        linhas.append(f"{p}: {resumo_http(r)}; meses citados: {', '.join(citados[-6:]) or 'nenhum'}; links: {'; '.join(hrefs[:3]) or '-'}")
    candidatos = sorted(meses)[-2:] or meses_recentes(3)
    if not any('ftp' in meses.get(m, {}) for m in candidatos):
        candidatos = sorted(set(candidatos) | set(meses_recentes(3)))
    rotas = []
    for m in sorted(candidatos, reverse=True):
        urls = [f'https://cnes.datasus.gov.br/EstatisticasServlet?path=BASE_DE_DADOS_CNES_{m}.ZIP',
                f'http://cnes.datasus.gov.br/EstatisticasServlet?path=BASE_DE_DADOS_CNES_{m}.ZIP',
                f'https://ftp.datasus.gov.br/cnes/BASE_DE_DADOS_CNES_{m}.ZIP',
                f'http://ftp.datasus.gov.br/cnes/BASE_DE_DADOS_CNES_{m}.ZIP'] + sorted(links.get(m, []))
        for u in dict.fromkeys(urls):
            r = http(u, cab={'Range': 'bytes=0-3'}, timeout=45, max_corpo=4096)
            corpo = r.get('corpo') or b''
            zipado = corpo[:2] == b'PK'
            tam = r['cab'].get('content-range', '').split('/')[-1] if r['cab'].get('content-range') else r['cab'].get('content-length')
            linhas.append(f"{m} {u}: {resumo_http(r)}; tamanho {mb(inteiro(tam)) if tam else '?'}; começa com PK (zip): {'sim' if zipado else 'não'}"
                          f"; ranges: {r['cab'].get('accept-ranges', '-')}")
            if zipado and r.get('status') in (200, 206):
                rotas.append({'tipo': 'https', 'mes': m, 'url': u, 'tamanho': inteiro(tam) or None})
        if 'ftp' in meses.get(m, {}):
            rotas.append({'tipo': 'ftp', 'mes': m, **meses[m]['ftp']})
        if rotas:
            break
    escolha = {'rotas': rotas, 'mes': rotas[0]['mes'] if rotas else None}
    salvar_json(ESCOLHA, escolha)
    linhas.append('Escolha: ' + ('; '.join(f"{r['tipo']} {r.get('url') or r.get('caminho')}" for r in rotas) or 'NENHUMA rota funcionou'))
    anotar('notice' if rotas else 'error', 'B02 Base completa: páginas e rotas HTTP(S)', '\n'.join(linhas))


# ----------------------------------------------------------------------------------------------- baixar

def baixar() -> None:
    esc = ler_json(ESCOLHA, {}) or {}
    tentativas, ok = [], None
    for rota in esc.get('rotas') or []:
        ini = time.monotonic()
        try:
            if rota['tipo'] == 'https':
                r = http(rota['url'], destino=ZIP, timeout=120, limite_s=LIMITE_DOWNLOAD_S)
                res = {'bytes': r.get('bytes'), 'segundos': r.get('segundos'), 'sha256': r.get('sha256'),
                       'erro': r.get('erro') or ('cortado pelo limite de tempo' if r.get('cortado') else None),
                       'status': r.get('status')}
            else:
                f = ftp_abrir(timeout=120)
                res = ftp_baixar(f, rota['caminho'], ZIP, limite_s=LIMITE_DOWNLOAD_S)
                try:
                    f.quit()
                except Exception:  # noqa: BLE001
                    pass
        except Exception as e:  # noqa: BLE001
            res = {'erro': erro_curto(e), 'segundos': round(time.monotonic() - ini, 1),
                   'bytes': ZIP.stat().st_size if ZIP.exists() else 0}
        valido = ZIP.exists() and zipfile.is_zipfile(ZIP) and not res.get('erro')
        tentativas.append(f"{rota['tipo']} {rota.get('url') or rota.get('caminho')}: {mb(res.get('bytes'))} em "
                          f"{res.get('segundos')} s ({velocidade(res.get('bytes'), res.get('segundos'))}); "
                          f"esperado {mb(rota.get('tamanho'))}; zip válido: {'sim' if valido else 'não'}"
                          + (f"; erro: {res['erro']}" if res.get('erro') else '') +
                          (f"; sha256 {res['sha256'][:16]}" if res.get('sha256') else ''))
        if valido:
            ok = {**rota, **res}
            break
    salvar_json(BAIXADO, ok or {})
    anotar('notice' if ok else 'error', f"B03 Base completa: download {'OK' if ok else 'FALHOU'}",
           '\n'.join(tentativas) or 'Nenhuma rota para tentar (veja B01/B02).')


# ----------------------------------------------------------------------------------------------- leitura dos CSV

def detecta_codificacao(amostra: bytes) -> str:
    corte = amostra.rfind(b'\n')
    a = amostra[:corte] if corte > 0 else amostra
    try:
        a.decode('utf-8')
        return 'utf-8' if any(b > 127 for b in a) else 'ascii'
    except UnicodeDecodeError:
        return 'cp1252' if re.search(rb'[\x80-\x9f]', a) else 'latin-1'


class Csv:
    def __init__(self, z: zipfile.ZipFile, info: zipfile.ZipInfo):
        with z.open(info) as raw:
            amostra = raw.read(1 << 20)
        self.codificacao = detecta_codificacao(amostra)
        enc = {'utf-8': 'utf-8-sig', 'ascii': 'latin-1'}.get(self.codificacao, self.codificacao)
        primeira = amostra.split(b'\n', 1)[0].decode(enc, 'replace')
        self.delim = max([';', ',', '|', '\t'], key=primeira.count)
        self.raw = z.open(info)
        self.txt = io.TextIOWrapper(self.raw, encoding=enc, errors='replace', newline='')
        self.rd = csv.reader(self.txt, delimiter=self.delim, quotechar='"')
        self.cab = [c.strip().strip('"').strip().lstrip('﻿').upper() for c in next(self.rd)]
        self.nome = Path(info.filename).name

    def col(self, *padroes: str, evita: str | None = None) -> int | None:
        for p in padroes:
            for i, c in enumerate(self.cab):
                if re.fullmatch(p, c) and not (evita and re.search(evita, c)):
                    return i
        return None

    def __iter__(self):
        for linha in self.rd:
            if linha:
                yield linha

    def fechar(self) -> None:
        try:
            self.txt.close()
        except Exception:  # noqa: BLE001
            pass


def membro(z: zipfile.ZipFile, prefixo: str) -> zipfile.ZipInfo | None:
    cands = [i for i in z.infolist() if re.fullmatch(prefixo + r'[_\d]*\.csv', Path(i.filename).name, re.I)]
    return min(cands, key=lambda i: len(i.filename)) if cands else None


def campo(linha: list[str], i: int | None) -> str:
    return linha[i].strip() if i is not None and i < len(linha) else ''


SEGURAS = re.compile(r'^(CO_UNIDADE|CO_CNES|CO_EQUIPAMENTO|CO_TIPO_EQUIPAMENTO|QT_.*|TP_SUS|IND_.*|.*SUS.*|DT_.*|TO_CHAR.*'
                     r'|CO_SERVICO.*|CO_CLASSIFICACAO.*|TP_CARACTERISTICA|CO_AMBULATORIAL.*|CO_HOSPITALAR.*|DS_.*|TP_.*)$')
PESSOAIS = re.compile(r'CPF|USUARIO|EMAIL|NO_|NOME|PROFISSIONAL|CNPJ|TELEFONE|FAX')


def amostra_segura(cab: list[str], linha: list[str]) -> str:
    return '; '.join(f"{c}={linha[i] if i < len(linha) and SEGURAS.match(c) and not PESSOAIS.search(c) else '…'}"
                     for i, c in enumerate(cab))


# ----------------------------------------------------------------------------------------------- analisar

def analisar() -> None:
    info = ler_json(BAIXADO, {}) or {}
    if not info or not ZIP.exists():
        anotar('error', 'B04 Base completa: sem ZIP para analisar', 'O download falhou (veja B03).')
        return
    mes = info.get('mes')
    z = zipfile.ZipFile(ZIP)
    membros = sorted(z.infolist(), key=lambda i: -i.file_size)
    anotar('notice', f'B04 Base completa {mes}: {len(membros)} arquivos no ZIP ({mb(ZIP.stat().st_size)})',
           tabela([[Path(i.filename).name, mb(i.compress_size), mb(i.file_size)] for i in membros],
                  ['arquivo', 'compactado', 'aberto']))
    estado: dict = {'mes': mes}
    for nome, fn in [('equipamentos', secao_tabela_equip), ('estab x equip', secao_rl_equip),
                     ('estabelecimentos', secao_estab), ('cidades', secao_cidades), ('serviços', secao_servicos)]:
        ini = time.monotonic()
        try:
            fn(z, estado)
        except Exception as e:  # noqa: BLE001
            anotar('error', f'Base completa: a parte "{nome}" quebrou', erro_curto(e) + '\n' + traceback.format_exc()[-1500:])
        print(f'parte {nome}: {time.monotonic() - ini:.1f} s', flush=True)


def secao_tabela_equip(z: zipfile.ZipFile, estado: dict) -> None:
    descricoes: dict[tuple[str, str], str] = {}
    textos = []
    tipos = {}
    m = membro(z, 'tbTipoEquipamento')
    if m:
        c = Csv(z, m)
        ic, idd = c.col(r'CO_TIPO_EQUIPAMENTO', r'CO_.*'), c.col(r'DS_.*', r'NO_.*')
        for l in c:
            tipos[campo(l, ic)] = campo(l, idd)
        c.fechar()
        textos.append(f'{c.nome} ({c.codificacao}, separador {c.delim!r}) colunas: {", ".join(c.cab)}\n'
                      + '; '.join(f'{k} = {v}' for k, v in sorted(tipos.items())))
    else:
        textos.append('tbTipoEquipamento: não está no ZIP')
    m = membro(z, 'tbEquipamento')
    if m:
        c = Csv(z, m)
        ic = c.col(r'CO_EQUIPAMENTO', r'CO_EQUIP.*', evita='TIPO')
        it = c.col(r'CO_TIPO_EQUIPAMENTO', r'TP_EQUIPAMENTO', r'.*TIPO.*')
        idd = c.col(r'DS_EQUIPAMENTO', r'DS_.*', r'NO_.*')
        linhas = []
        for l in c:
            t, cod, d = campo(l, it), campo(l, ic), campo(l, idd)
            descricoes[(t.lstrip('0') or '0', cod.zfill(2))] = d
            linhas.append([t, cod, d, '; '.join(x for i, x in enumerate(l) if i not in (it, ic, idd))[:60]])
        c.fechar()
        textos.append(f'{c.nome} ({c.codificacao}, separador {c.delim!r}) colunas: {", ".join(c.cab)}; {len(linhas)} linhas\n'
                      + tabela(sorted(linhas, key=lambda x: (x[0], x[1])), ['tipo', 'código', 'descrição oficial', 'outras colunas']))
    else:
        textos.append('tbEquipamento: não está no ZIP')
    estado['descricoes'] = descricoes
    estado['tipos'] = tipos
    anotar('notice', 'B05 Base completa: tabela oficial de equipamentos (tipo, código, descrição)', '\n'.join(textos))
    mapa, origem = codigos_por_exame(descricoes)
    estado['mapa'] = mapa
    anotar('notice', 'B06 Base completa: exames do site x códigos de equipamento', texto_mapa(mapa, origem))


def secao_rl_equip(z: zipfile.ZipFile, estado: dict) -> None:
    m = membro(z, 'rlEstabEquipamento')
    if not m:
        anotar('error', 'B07 Base completa: rlEstabEquipamento não está no ZIP',
               'Arquivos com "equip": ' + ', '.join(i.filename for i in z.infolist() if 'equip' in i.filename.lower()))
        return
    c = Csv(z, m)
    iu = c.col(r'CO_UNIDADE')
    ic = c.col(r'CO_EQUIPAMENTO', evita='TIPO')
    it = c.col(r'CO_TIPO_EQUIPAMENTO', r'TP_EQUIPAMENTO')
    ie = c.col(r'QT_EXISTENTE', r'QT_EXIST.*')
    iuso = c.col(r'QT_USO', r'QT_.*USO.*')
    isus = c.col(r'TP_SUS', r'IND_SUS', r'.*SUS.*', evita='NSUS|NAO')
    chaves = {(t, cod) for lst in estado.get('mapa', {}).values() for t, cod, _ in lst}
    n = 0
    amostras = []
    unidades = set()
    por_cod = Counter()
    sus_val = Counter()
    aparelhos = []
    for l in c:
        n += 1
        if len(amostras) < 2:
            amostras.append(amostra_segura(c.cab, l))
        un = campo(l, iu)
        unidades.add(un)
        t, cod = campo(l, it).lstrip('0') or '0', campo(l, ic).zfill(2)
        por_cod[(t, cod)] += 1
        sus_val[campo(l, isus)] += 1
        if (t, cod) in chaves:
            aparelhos.append({'unidade': un, 'tipo': t, 'cod': cod, 'qt_exist': inteiro(campo(l, ie)),
                              'qt_uso': inteiro(campo(l, iuso)), 'sus': campo(l, isus).upper() in ('S', '1', 'SIM', 'T', 'TRUE')})
    c.fechar()
    estado['aparelhos'] = aparelhos
    desc = estado.get('descricoes') or {}
    top = ', '.join(f"{t}/{cod} {desc.get((t, cod), '?')[:22]}: {q}" for (t, cod), q in por_cod.most_common(12))
    anotar('notice', f'B07 Base completa: {c.nome} (estabelecimento x equipamento)',
           f'Codificação {c.codificacao}, separador {c.delim!r}; {n} linhas; {len(unidades)} unidades; {len(por_cod)} tipos/códigos\n'
           f'Colunas: {", ".join(c.cab)}\n'
           f'Colunas usadas: unidade={c.cab[iu] if iu is not None else "?"}, tipo={c.cab[it] if it is not None else "?"}, '
           f'código={c.cab[ic] if ic is not None else "?"}, existentes={c.cab[ie] if ie is not None else "?"}, '
           f'em uso={c.cab[iuso] if iuso is not None else "?"}, SUS={c.cab[isus] if isus is not None else "?"} '
           f'(valores: {dict(sus_val.most_common(5))})\n'
           f'Linhas de exemplo (campos pessoais/usuário ocultos):\n' + '\n'.join(amostras) +
           f'\nMais frequentes: {top}\nLinhas dos códigos dos exames: {len(aparelhos)}')


def secao_estab(z: zipfile.ZipFile, estado: dict) -> None:
    m = membro(z, 'tbEstabelecimento')
    if not m:
        anotar('error', 'B08 Base completa: tbEstabelecimento não está no ZIP', '')
        return
    cidades = {mun6(x) for x in cidades_do_imed(REPO)}
    com_aparelho = {a['unidade'] for a in estado.get('aparelhos', [])}
    c = Csv(z, m)
    iu, icn = c.col(r'CO_UNIDADE'), c.col(r'CO_CNES')
    imun = c.col(r'CO_MUNICIPIO_GESTOR', r'CO_MUNICIPIO.*', r'CODUFMUN')
    ifan, iraz = c.col(r'NO_FANTASIA'), c.col(r'NO_RAZAO_SOCIAL')
    itp = c.col(r'TP_UNIDADE', r'CO_TIPO_UNIDADE', r'TP_UNID')
    ipf = c.col(r'TP_PFPJ', r'PF_PJ')
    ilat, ilon = c.col(r'NU_LATITUDE', r'.*LATITUDE.*'), c.col(r'NU_LONGITUDE', r'.*LONGITUDE.*')
    idesab = c.col(r'CO_MOTIVO_DESAB.*', r'.*MOTIVO_DESAB.*')
    estab: dict[str, dict] = {}
    unid_cnes: dict[str, str] = {}
    n = 0
    ativos_tipo = Counter()
    pfpj = Counter()
    mun_difere = 0
    for l in c:
        n += 1
        un = campo(l, iu)
        mun = campo(l, imun)[:6]
        if un[:6] and mun and un[:6] != mun:
            mun_difere += 1
        if un not in com_aparelho and mun not in cidades:
            continue
        cn = campo(l, icn).zfill(7) if icn is not None else un[-7:]
        unid_cnes[un] = cn
        desab = campo(l, idesab)
        ativo = desab in ('', '0', '00', 'NULL')
        tp = inteiro(campo(l, itp)) if itp is not None else None
        pf = campo(l, ipf)
        pfpj[pf] += 1
        pj = True if pf == '3' else (False if pf == '1' else None)
        fan, raz = campo(l, ifan), campo(l, iraz)
        estab[cn] = {'mun': mun, 'tp': tp, 'pj': pj, 'ativo': ativo, 'busca': sem_acento(f'{fan} {raz}'),
                     'nome': (fan or raz) if pj else None, 'lat': numero(campo(l, ilat)), 'lon': numero(campo(l, ilon))}
        if ativo and mun in (mun6(CAMPINAS), mun6(SAO_PAULO)) and tp in TIPOS_IMED:
            ativos_tipo[mun] += 1
    c.fechar()
    estado['estab'] = estab
    estado['unid_cnes'] = unid_cnes
    try:
        no_imed = {int(x['ibge']): x.get('total') for x in json.loads((REPO / 'scripts' / 'cidades.json').read_text(encoding='utf-8'))}
    except Exception:  # noqa: BLE001
        no_imed = {}
    anotar('notice', f'B08 Base completa: {c.nome} (estabelecimentos)',
           f'Codificação {c.codificacao}, separador {c.delim!r}; {n} linhas no país; guardados {len(estab)} '
           f'(cidades do IMED ou com aparelho dos exames)\nColunas ({len(c.cab)}): {", ".join(c.cab)}\n'
           f'Valores de PF/PJ: {dict(pfpj.most_common(4))} (1 = pessoa física, 3 = jurídica)\n'
           f'Município: coluna {c.cab[imun] if imun is not None else "?"}; difere dos 6 primeiros dígitos de CO_UNIDADE em {mun_difere} linha(s)\n'
           f'Ativos de tipo que o IMED importa: Campinas {ativos_tipo[mun6(CAMPINAS)]}, São Paulo {ativos_tipo[mun6(SAO_PAULO)]} '
           f'(no banco do IMED, depois dos filtros de nome, scripts/cidades.json: Campinas {no_imed.get(CAMPINAS, "?")}, '
           f'São Paulo {no_imed.get(SAO_PAULO, "?")})')


def secao_cidades(z: zipfile.ZipFile, estado: dict) -> None:
    mapa = estado.get('mapa') or {}
    unid = estado.get('unid_cnes') or {}
    aparelhos = []
    for a in estado.get('aparelhos', []):
        cn = unid.get(a['unidade']) or a['unidade'][-7:]
        aparelhos.append({**a, 'cnes': cn, 'mun': a['unidade'][:6]})
    an = Analise(mapa, aparelhos, estado.get('estab') or {})
    estado['analise'] = an
    for ibge, cod in ((CAMPINAS, 'B09'), (SAO_PAULO, 'B10')):
        nome = 'Campinas' if ibge == CAMPINAS else 'São Paulo'
        anotar('notice', f'{cod} Base completa: {nome} ({ibge}) por exame',
               an.quadro_cidade(ibge, com_nome=True) + f'\nRessonância em uso por tipo de unidade: {an.tipos_rm([ibge])}'
               + '\n(tipos que o IMED importa: 39 apoio diagnóstico, 36 clínica, 4 policlínica, 5/7/62 hospitais; '
                 'o site hoje NÃO deduz exame de hospital)')
    for ibge, cod in ((CAMPINAS, 'B11'), (SAO_PAULO, 'B12')):
        nome = 'Campinas' if ibge == CAMPINAS else 'São Paulo'
        anotar('notice', f'{cod} Base completa: ressonância em uso em {nome} (exemplos)', an.exemplos('rm', ibge, 12))
    anotar('notice', 'B13 Base completa: ressonância em uso até 5 km (coordenadas do CNES)', an.perto('rm', 5.0))
    linhas = []
    for ibge in (CAMPINAS, SAO_PAULO):
        n, ex = an.falsos_pelo_nome('rm', ibge)
        linhas.append(f'{ibge}: {n} estabelecimento(s) que o site marca com ressonância pelo nome e SEM ressonância no CNES: ' + ', '.join(ex))
    for cn, i in (estado.get('estab') or {}).items():
        if 'THEMOTEO' in (i.get('busca') or ''):
            tem = {e: v for e, v in an.por.get(cn, {}).items()}
            linhas.append(f"'Themoteo': CNES {cn}, tipo {i.get('tp')}, ativo {i.get('ativo')}, aparelhos dos exames: {dict(tem) or 'nenhum'}")
    anotar('notice', 'B14 Base completa: falsos positivos do nome (ressonância)', '\n'.join(linhas))
    cidades = cidades_do_imed(REPO)
    anotar('notice', f'B15 Base completa: nas {len(cidades)} cidades do IMED', an.cobertura(cidades, com_nome=True))
    salvar_json(DADOS / 'base-resumo.json', an.resumo('Base completa', estado.get('mes')))


# Exame -> serviço especializado/classificação, pela descrição oficial (sem acento, maiúsculas). Laboratório é
# só o serviço 145 (diagnóstico de laboratório clínico); coleta (144) aparece à parte. Radiologia odontológica e
# intervencionista não contam como raio-X.
REGRA_SERV = {'lab': r'^145 ', 'coleta': r'^144 ', 'ecg': r'ELETROCARDIO', 'eco': r'ECOCARDIO',
              'rm': r'RESSON', 'tc': r'TOMOGRAF', 'mamo': r'MAMOGRAF', 'dens': r'DENSITOM',
              'usg': r'ULTRA.?SS?ON|ULTRA.?SOM|ECOGRAF', 'rx': r'^121 .*/ RADIOLOGIA( POR TELEMEDICINA)?$'}


def secao_servicos(z: zipfile.ZipFile, estado: dict) -> None:
    ms, mc, mr = membro(z, 'tbServicoEspecializado'), membro(z, 'tbClassificacaoServico'), membro(z, 'rlEstabServClass')
    if not (ms and mc and mr):
        anotar('warning', 'B16 Base completa: tabelas de serviço especializado não encontradas',
               'Arquivos com "serv": ' + ', '.join(i.filename for i in z.infolist() if 'serv' in i.filename.lower()))
        return
    serv = {}
    c = Csv(z, ms)
    ic, idd = c.col(r'CO_SERVICO.*', r'CO_.*'), c.col(r'DS_.*', r'NO_.*')
    for l in c:
        serv[campo(l, ic).zfill(3)] = campo(l, idd)
    c.fechar()
    clas = {}
    c = Csv(z, mc)
    isv = c.col(r'CO_SERVICO.*', evita='CLASS')
    icl = c.col(r'CO_CLASSIFICACAO.*', r'CO_CLASS.*')
    idd = c.col(r'DS_.*', r'NO_.*')
    cab_clas = c.cab
    for l in c:
        clas[(campo(l, isv).zfill(3), campo(l, icl).zfill(3))] = campo(l, idd)
    c.fechar()
    alvo: dict[tuple[str, str], list[str]] = defaultdict(list)
    for (s, k), d in clas.items():
        texto = sem_acento(f'{s} {serv.get(s, "")} / {d}')
        for e, rx in REGRA_SERV.items():
            if re.search(rx, texto):
                alvo[(s, k)].append(e)
    linhas = [[f'{s}/{k}', ','.join(alvo[(s, k)]), f'{serv.get(s, "?")} / {clas[(s, k)]}'[:110]] for s, k in sorted(alvo)]
    anotar('notice', 'B16 Base completa: serviços especializados ligados aos exames',
           f'Colunas da classificação: {", ".join(cab_clas)}\n' + tabela(linhas, ['serviço/classe', 'exame', 'descrição oficial']))
    c = Csv(z, mr)
    iu = c.col(r'CO_UNIDADE')
    isv = c.col(r'CO_SERVICO.*', evita='CLASS')
    icl = c.col(r'CO_CLASSIFICACAO.*', r'CO_CLASS.*')
    iat = c.col(r'ST_ATIVO.*')
    unid = estado.get('unid_cnes') or {}
    estab = estado.get('estab') or {}
    alvo_mun = {mun6(CAMPINAS), mun6(SAO_PAULO)}
    por_exame: dict[str, dict[str, set]] = {e: defaultdict(set) for e in REGRA_SERV}
    n = 0
    for l in c:
        n += 1
        un = campo(l, iu)
        if un[:6] not in alvo_mun or (iat is not None and campo(l, iat).upper() not in ('S', '')):
            continue
        chave = (campo(l, isv).zfill(3), campo(l, icl).zfill(3))
        for e in alvo.get(chave, []):
            cn = unid.get(un) or un[-7:]
            if estab.get(cn, {}).get('ativo', True) is not False:
                por_exame[e][un[:6]].add(cn)
    c.fechar()
    an: Analise | None = estado.get('analise')
    linhas = []
    for e in ['lab', 'coleta', 'ecg', 'eco'] + [x for x in EXAMES if x not in ('ecg', 'eco')]:
        lin = [e]
        for ibge in (CAMPINAS, SAO_PAULO):
            s = por_exame[e][mun6(ibge)]
            if an and an.mapa.get(e):
                eq = set(an.com(e, {mun6(ibge)}))
                lin.append(f'{len(s)} (aparelho em uso: {len(eq)}; nos dois: {len(s & eq)})')
            else:
                lin.append(str(len(s)))
        linhas.append(lin)
    anotar('notice', 'B17 Base completa: estabelecimentos com o serviço (Campinas e São Paulo)',
           f'{c.nome}: {n} linhas no país; colunas: {", ".join(c.cab)}\n'
           + tabela(linhas, ['exame', f'Campinas {CAMPINAS}', f'São Paulo {SAO_PAULO}'])
           + '\n(serviço = o estabelecimento declarou o serviço/classificação; para lab, eco e ECG não há "aparelho" na tabela)')


if __name__ == '__main__':
    {'descobrir': descobrir, 'baixar': baixar, 'analisar': analisar}[sys.argv[1]]()
