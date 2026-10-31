"""Sonda O: outras fontes oficiais e abertas com equipamentos por estabelecimento.

1. Portais de dados abertos do Ministério (CKAN: opendatasus e dadosabertos.saude) e o dados.gov.br.
2. O serviço que o próprio site do CNES (cnes.datasus.gov.br) usa para mostrar a ficha de equipamentos.
3. O TabNet do DATASUS (equipamentos por município): confere a soma de aparelhos de ressonância em uso.

  python3 -I outras.py [CNES de Campinas separados por vírgula, para a ficha do site do CNES]
"""

from __future__ import annotations

import html
import json
import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comum import (CAMPINAS, SAO_PAULO, anotar, http, json_de, mb, mun6, resumo_http,  # noqa: E402
                   uma_linha)


def ckan() -> None:
    linhas, achados = [], []
    for host in ['https://opendatasus.saude.gov.br', 'https://dadosabertos.saude.gov.br']:
        for q in ['cnes', 'equipamento', 'equipamentos estabelecimento']:
            r = http(f'{host}/api/3/action/package_search?q={urllib.parse.quote(q)}&rows=60', timeout=45)
            j = json_de(r) or {}
            res = (j.get('result') or {}) if isinstance(j, dict) else {}
            pacotes = res.get('results') or []
            linhas.append(f"{host} q={q!r}: {resumo_http(r)}; {res.get('count', '?')} conjunto(s)")
            for p in pacotes:
                recursos = p.get('resources') or []
                texto = json.dumps({k: p.get(k) for k in ('name', 'title', 'notes')}, ensure_ascii=False).lower()
                rec_eq = [x for x in recursos if 'equip' in json.dumps(x, ensure_ascii=False).lower()]
                if q == 'cnes' or 'equip' in texto or rec_eq:
                    linhas.append(f"  - {p.get('name')}: {uma_linha(p.get('title'), 70)} ({len(recursos)} recursos: "
                                  f"{', '.join(sorted({str(x.get('format') or '?') for x in recursos}))})")
                if 'equip' in texto or rec_eq:
                    for x in (rec_eq or recursos)[:6]:
                        achados.append((p.get('name'), x.get('name'), x.get('format'), x.get('url')))
    dg = http('https://dados.gov.br/dados/api/publico/conjuntos-dados?isPrivado=false&nomeConjuntoDados=cnes&pagina=1', timeout=45)
    linhas.append(f'dados.gov.br API pública: {resumo_http(dg)}; {uma_linha(dg.get("corpo"), 120)}')
    anotar('notice', 'O01 Portais de dados abertos: conjuntos do CNES', '\n'.join(linhas))
    if achados:
        out = []
        for pac, nome, fmt, url in achados[:12]:
            r = http(url, cab={'Range': 'bytes=0-2047'}, timeout=45, max_corpo=4096) if url else {}
            tam = (r.get('cab') or {}).get('content-range', '').split('/')[-1] or (r.get('cab') or {}).get('content-length')
            out.append(f'{pac} / {nome} ({fmt}): {url}\n    {resumo_http(r) if r else "-"}; tamanho {mb(int(tam)) if tam and tam.isdigit() else "?"}; '
                       f'começo: {uma_linha(r.get("corpo") if r else "", 160)}')
        anotar('notice', 'O02 Portais: recursos que falam de equipamento', '\n'.join(out))
    else:
        anotar('notice', 'O02 Portais: nenhum conjunto/recurso fala de equipamento', 'Busca por "equip" nos títulos, notas e recursos.')


def site_cnes(cnes_lista: list[str]) -> None:
    if not cnes_lista:
        r = http(f'https://apidadosabertos.saude.gov.br/cnes/estabelecimentos?codigo_municipio={mun6(CAMPINAS)}&codigo_tipo_unidade=5&limit=5&offset=0', timeout=60)
        cnes_lista = [str(e.get('codigo_cnes')).zfill(7) for e in ((json_de(r) or {}).get('estabelecimentos') or [])][:3]
    linhas = []
    cab = {'Accept': 'application/json, text/plain, */*', 'Referer': 'https://cnes.datasus.gov.br/pages/estabelecimentos/consulta.jsp'}
    for cn in cnes_lista[:3]:
        uid = mun6(CAMPINAS) + cn
        for u in [f'https://cnes.datasus.gov.br/services/estabelecimentos/{uid}',
                  f'https://cnes.datasus.gov.br/services/estabelecimentos-equipamento/{uid}',
                  f'https://cnes.datasus.gov.br/services/estabelecimentos/equipamentos/{uid}']:
            r = http(u, cab=cab, timeout=45)
            j = json_de(r)
            desc = ''
            if isinstance(j, list) and j and isinstance(j[0], dict):
                desc = f'lista de {len(j)}; campos: {", ".join(j[0].keys())}'
                if 'equipamento' in u:
                    itens = []
                    for x in j:
                        vals = [str(v) for k, v in x.items() if not re.search(r'cpf|usuario|nome_?prof|email', k, re.I)]
                        itens.append('/'.join(vals)[:80])
                    desc += '\n      ' + '\n      '.join(itens[:14])
            elif isinstance(j, dict):
                desc = f'objeto; campos: {", ".join(list(j.keys())[:40])}'
            else:
                desc = uma_linha(r.get('corpo'), 100)
            linhas.append(f'{u.replace("https://cnes.datasus.gov.br", "")}: {resumo_http(r)}; {desc}')
    anotar('notice', 'O03 Site do CNES: serviço da ficha de equipamentos (cnes.datasus.gov.br/services)',
           '\n'.join(linhas) or 'Sem CNES para testar.')


def tabnet() -> None:
    defu = 'http://tabnet.datasus.gov.br/cgi/deftohtm.exe?cnes/cnv/equipobr.def'
    r = http(defu, timeout=60)
    texto = (r.get('corpo') or b'').decode('latin-1', 'replace')
    form = re.search(r'<form[^>]*action="([^"]+)"', texto, re.I)
    selects = {}
    for m in re.finditer(r'<select[^>]*name="([^"]+)"[^>]*>(.*?)</select>', texto, re.I | re.S):
        selects[m.group(1)] = [(v, html.unescape(re.sub(r'\s+', ' ', t)).strip())
                               for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>([^<]*)', m.group(2), re.I)]
    linhas = [f'{defu}: {resumo_http(r)}; formulário: {form.group(1) if form else "?"}',
              'Campos: ' + '; '.join(f'{k} ({len(v)} opções: {", ".join(t for _, t in v[:3])}...)' for k, v in selects.items())[:1500]]
    if form and selects:
        try:
            linhas += consulta_tabnet(urllib.parse.urljoin(defu, form.group(1)), selects)
        except Exception as e:  # noqa: BLE001
            linhas.append(f'consulta falhou: {type(e).__name__}: {e}')
    anotar('notice', 'O04 TabNet (equipamentos por município): ressonância em uso em Campinas e São Paulo', '\n'.join(linhas))


def consulta_tabnet(acao: str, selects: dict) -> list[str]:
    def escolhe(nome_rx, texto_rx):
        for k, ops in selects.items():
            if re.search(nome_rx, k, re.I):
                for v, t in ops:
                    if re.search(texto_rx, t, re.I):
                        return k, v, t
        return None
    linha = escolhe(r'^Linha$', r'Munic')
    coluna = escolhe(r'^Coluna$', r'N.o.Ativa')
    incr = escolhe(r'^Incremento$', r'uso')
    arq = next(((k, v[0][0], v[0][1]) for k, v in selects.items() if re.search(r'^Arquivos$', k, re.I) and v), None)
    equip = escolhe(r'^S.*Equip', r'Resson')
    munis = [x for x in (escolhe(r'^S.*Munic', mun6(CAMPINAS)), escolhe(r'^S.*Munic', mun6(SAO_PAULO))) if x]
    out = [f'escolhas: linha={linha and linha[2]}, coluna={coluna and coluna[2]}, incremento={incr and incr[2]}, '
           f'arquivo={arq and arq[2]}, equipamento={equip and equip[2]}, municípios={[m[2] for m in munis]}']
    if not (linha and incr and arq and equip and munis):
        return out + ['faltou algum campo; consulta não enviada']
    pares = [(linha[0], linha[1]), ('Coluna', coluna[1] if coluna else '--N\xe3o-Ativa--'), (incr[0], incr[1]),
             (arq[0], arq[1])]
    for k, ops in selects.items():
        if k.startswith('S'):
            if k == equip[0]:
                pares.append((k, equip[1]))
            elif munis and k == munis[0][0]:
                pares += [(k, m[1]) for m in munis]
            else:
                pares.append((k, 'TODAS_AS_CATEGORIAS__'))
    pares += [('formato', 'prn'), ('mostre', 'Mostra')]
    corpo = urllib.parse.urlencode(pares, encoding='latin-1').encode('ascii')
    r = http(acao, metodo='POST', corpo=corpo, cab={'Content-Type': 'application/x-www-form-urlencoded'}, timeout=90)
    texto = (r.get('corpo') or b'').decode('latin-1', 'replace')
    pre = re.search(r'<pre>(.*?)</pre>', texto, re.I | re.S)
    corpo_txt = html.unescape(re.sub(r'<[^>]+>', '', pre.group(1) if pre else texto))
    uteis = [l.strip() for l in corpo_txt.splitlines() if re.search(r'\d', l) and len(l.strip()) < 200][:12]
    return out + [f'POST {acao}: {resumo_http(r)}'] + uteis


def main() -> None:
    cnes_lista = [c for c in (sys.argv[1] if len(sys.argv) > 1 else '').split(',') if re.fullmatch(r'\d{7}', c)]
    for parte in (ckan, lambda: site_cnes(cnes_lista), tabnet):
        try:
            parte()
        except Exception as e:  # noqa: BLE001
            anotar('error', 'Outras fontes: uma parte quebrou', f'{type(e).__name__}: {e}')


if __name__ == '__main__':
    main()
