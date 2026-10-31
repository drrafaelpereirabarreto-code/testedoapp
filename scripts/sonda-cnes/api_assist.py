"""Sonda A (parte 2): as rotas novas da API de dados abertos, grupo "Assistência à Saúde" (DEMAS):
/assistencia-a-saude/cnes-equipamentos, cnes-estabelecimentos e cnes-servicos-especializados.

1. O que o documento (swagger) diz de cada uma: parâmetros, formatos e campos.
2. Chamadas reais: Campinas e São Paulo, com o maior "limit" que a API aceitar (tempo e tamanho).
3. Ressonância (e os outros exames) em uso por estabelecimento, com exemplos, e o resumo para conferir com o
   banco do IMED (banco_imed.py api).
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comum import (CAMPINAS, DADOS, SAO_PAULO, anotar, http, inteiro, json_de, mb, mun6, resumo_http,  # noqa: E402
                   salvar_json, uma_linha)
from exames import Analise, codigos_por_exame, texto_mapa  # noqa: E402

BASE = 'https://apidadosabertos.saude.gov.br'
ROTAS = ['/assistencia-a-saude/cnes-equipamentos', '/assistencia-a-saude/cnes-estabelecimentos',
         '/assistencia-a-saude/cnes-servicos-especializados']
PESSOAL = re.compile(r'cpf|email|telefone|fone|usuario|razao|nome_?prof|no_prof|cns', re.I)
LIMITE_PAGINAS_S = 9 * 60


def registros(j) -> list[dict]:
    if isinstance(j, list):
        return [x for x in j if isinstance(x, dict)]
    if isinstance(j, dict):
        for v in j.values():
            if isinstance(v, list) and (not v or isinstance(v[0], dict)):
                return v
    return []


def seguro(rec: dict) -> str:
    return '; '.join(f"{k}={'…' if PESSOAL.search(k) else uma_linha(str(v), 60)}" for k, v in rec.items())


def documento() -> None:
    r = http(f'{BASE}/static/swagger.json', timeout=60)
    doc = json_de(r) or {}
    partes = []
    for rota in ROTAS:
        op = ((doc.get('paths') or {}).get(rota) or {}).get('get') or {}
        if not op:
            partes.append(f'{rota}: não está no documento')
            continue
        ps = []
        for p in op.get('parameters') or []:
            sch = p.get('schema') or {}
            ps.append(f"  {p.get('name')} ({p.get('in')}, {'obrigatório' if p.get('required') else 'opcional'}, "
                      f"{sch.get('type') or p.get('type')}{', padrão ' + str(sch.get('default')) if sch.get('default') is not None else ''}"
                      f"{', máx ' + str(sch.get('maximum')) if sch.get('maximum') is not None else ''}): {uma_linha(p.get('description'), 160)}")
        resp = []
        for cod, rr in (op.get('responses') or {}).items():
            tipos = list((rr.get('content') or {}).keys())
            props = []
            for t in tipos:
                sch = ((rr.get('content') or {}).get(t) or {}).get('schema') or {}
                props += list((sch.get('properties') or {}).keys())
                if sch.get('$ref'):
                    props.append(sch['$ref'])
            resp.append(f"  {cod}: {', '.join(tipos)} {('campos: ' + ', '.join(props[:40])) if props else ''} {uma_linha(rr.get('description'), 80)}")
        partes.append(f"{rota}\n  resumo: {uma_linha(op.get('summary'), 300)}\n  descrição: {uma_linha(op.get('description'), 400)}\n"
                      + '\n'.join(ps) + '\n' + '\n'.join(resp))
    anotar('notice', 'A06 API "Assistência à Saúde": o que o documento diz das rotas do CNES', '\n'.join(partes))


def chamar(rota: str, params: dict, timeout: float = 90, cab: dict | None = None) -> tuple[dict, list[dict], object]:
    url = f'{BASE}{rota}?{urllib.parse.urlencode(params)}'
    r = http(url, timeout=timeout, cab=cab, max_corpo=200_000_000)
    j = json_de(r)
    return r, registros(j), j


def testes_formato() -> dict:
    """Qual código de município a rota aceita, qual o maior limit, se aceita CSV e qual a competência."""
    rota = ROTAS[0]
    linhas, info = [], {'ibge_param': None, 'limit': 20}
    for ibge in (mun6(CAMPINAS), str(CAMPINAS)):
        r, recs, j = chamar(rota, {'co_ibge': ibge, 'limit': 5, 'offset': 0})
        chaves = list(j.keys()) if isinstance(j, dict) else type(j).__name__
        linhas.append(f'co_ibge={ibge}: {resumo_http(r)}; {len(recs)} registros; topo: {chaves}; começo: {uma_linha(r.get("corpo"), 120)}')
        if recs and not info['ibge_param']:
            info['ibge_param'] = ibge
            info['exemplo'] = recs[:2]
    if info.get('exemplo'):
        linhas.append('Campos do registro: ' + ', '.join(info['exemplo'][0].keys()))
        linhas += ['Exemplo: ' + seguro(x) for x in info['exemplo']]
    ibge = info['ibge_param'] or mun6(CAMPINAS)
    ibge_sp = str(SAO_PAULO) if len(ibge) == 7 else mun6(SAO_PAULO)
    # O maior limit aceito, medido em São Paulo (cidade com mais registros).
    for lim in (100, 1000, 5000, 20000):
        r, recs, _ = chamar(rota, {'co_ibge': ibge_sp, 'limit': lim, 'offset': 0}, timeout=180)
        linhas.append(f'São Paulo, limit={lim}: {resumo_http(r)}; {len(recs)} registros')
        if r.get('status') == 200 and len(recs) == lim:
            info['limit'] = lim
            continue
        if r.get('status') == 200 and recs and len(recs) < lim:
            info['limit'] = max(info['limit'], len(recs)) if len(recs) >= 100 else info['limit']
        break
    r, recs, _ = chamar(rota, {'co_ibge': ibge, 'limit': 3, 'offset': 0}, cab={'Accept': 'text/csv'})
    linhas.append(f"Accept: text/csv -> {resumo_http(r)}; começo: {uma_linha(r.get('corpo'), 160)}")
    for comp in ('202609', '202608', '202610'):
        r, recs, _ = chamar(rota, {'co_ibge': ibge, 'nu_comp': comp, 'limit': 3, 'offset': 0})
        linhas.append(f'nu_comp={comp}: {resumo_http(r)}; {len(recs)} registros')
    anotar('notice', 'A07 API cnes-equipamentos: formato, município, limit, CSV e competência', '\n'.join(linhas))
    return info


def todas(rota: str, params: dict, por_pagina: int, limite_s: float) -> tuple[list[dict], str]:
    ini = time.monotonic()
    out, pag, nbytes, notas = [], 0, 0, ''
    while True:
        r, recs, _ = chamar(rota, {**params, 'limit': por_pagina, 'offset': pag * por_pagina}, timeout=180)
        nbytes += r.get('bytes') or 0
        if r.get('status') != 200:
            notas = f'parou na página {pag}: {resumo_http(r)}'
            break
        out += recs
        pag += 1
        if len(recs) < por_pagina:
            break
        if time.monotonic() - ini > limite_s:
            notas = f'parou por tempo na página {pag}'
            break
    seg = round(time.monotonic() - ini, 1)
    return out, f'{len(out)} registros em {pag} página(s) de {por_pagina}, {mb(nbytes)}, {seg} s {notas}'.strip()


def campo(chaves: list[str], *padroes: str, evita: str | None = None) -> str | None:
    for p in padroes:
        for k in chaves:
            if re.search(p, k, re.I) and not (evita and re.search(evita, k, re.I)):
                return k
    return None


def equipamentos(info: dict) -> None:
    rota = ROTAS[0]
    ibge_param = info.get('ibge_param')
    if not ibge_param:
        anotar('error', 'A08 API cnes-equipamentos: nenhuma chamada trouxe registros', 'Veja A07.')
        return
    usar7 = len(ibge_param) == 7
    por_pag = info.get('limit') or 20
    dados, notas = {}, []
    for ibge in (CAMPINAS, SAO_PAULO):
        recs, nota = todas(rota, {'co_ibge': str(ibge) if usar7 else mun6(ibge)}, por_pag, LIMITE_PAGINAS_S / 2)
        dados[ibge] = recs
        notas.append(f"{'Campinas' if ibge == CAMPINAS else 'São Paulo'}: {nota}")
    todos = dados[CAMPINAS] + dados[SAO_PAULO]
    if not todos:
        anotar('error', 'A08 API cnes-equipamentos: sem registros', '\n'.join(notas))
        return
    ks = list(todos[0].keys())
    k_cnes = campo(ks, r'^co_cnes$', r'cnes')
    k_tipo = campo(ks, r'co_tipo_equip', r'tp_equip', r'tipo_equip')
    k_cod = campo(ks, r'^co_equip', r'cod.*equip', evita='tipo')
    k_desc = campo(ks, r'^ds_equip', r'no_equip', r'equipamento$', evita='tipo|co_|qt_')
    k_desc_tipo = campo(ks, r'ds_tipo_equip', r'no_tipo_equip')
    k_ex = campo(ks, r'qt_exist', r'exist')
    k_uso = campo(ks, r'qt_.*uso', r'uso')
    k_sus = campo(ks, r'sus', evita='nao|nsus')
    k_comp = campo(ks, r'nu_comp', r'compet')
    k_ibge = campo(ks, r'co_ibge', r'munic')
    k_nome = campo(ks, r'no_fantasia', r'nome_fantasia', r'fantasia')
    k_nat = campo(ks, r'nat_jur')
    k_tp = campo(ks, r'tp_unid', r'tipo_unid', r'co_tipo_unid')
    usados = {'cnes': k_cnes, 'tipo': k_tipo, 'código': k_cod, 'descrição': k_desc, 'tipo (descrição)': k_desc_tipo,
              'existentes': k_ex, 'em uso': k_uso, 'SUS': k_sus, 'competência': k_comp, 'município': k_ibge,
              'nome': k_nome, 'natureza': k_nat, 'tipo de unidade': k_tp}
    descricoes = {}
    pares = Counter()
    for x in todos:
        t = str(x.get(k_tipo, '')).lstrip('0') or '0'
        c = str(x.get(k_cod, '')).zfill(2)
        pares[(t, c)] += 1
        if k_desc and x.get(k_desc):
            descricoes[(t, c)] = str(x.get(k_desc))
    mapa, origem = codigos_por_exame(descricoes)
    comps = Counter(str(x.get(k_comp)) for x in todos) if k_comp else Counter()
    sus_val = Counter(str(x.get(k_sus)) for x in todos) if k_sus else Counter()
    anotar('notice', 'A08 API cnes-equipamentos: Campinas e São Paulo inteiras',
           '\n'.join(notas) + f'\nCampos usados: {usados}\nCompetências: {dict(comps.most_common(4))}; valores de SUS: {dict(sus_val.most_common(5))}\n'
           + texto_mapa(mapa, origem) + '\nPares tipo/código (registros): '
           + ', '.join(f"{t}/{c} {descricoes.get((t, c), '?')[:24]}={q}" for (t, c), q in sorted(pares.items())))

    estab, aparelhos = {}, []
    for x in todos:
        cn = str(x.get(k_cnes, '')).zfill(7)
        mun = str(x.get(k_ibge, ''))[:6]
        nat = str(x.get(k_nat, '') or '')
        pj = None if not k_nat else ('FISIC' not in nat.upper())
        estab.setdefault(cn, {'mun': mun, 'tp': inteiro(x.get(k_tp)) if k_tp else None, 'pj': pj,
                              'nome': (str(x.get(k_nome)) if k_nome and x.get(k_nome) else None)})
        sus = str(x.get(k_sus, '')).strip().upper()
        aparelhos.append({'cnes': cn, 'mun': mun, 'tipo': str(x.get(k_tipo, '')).lstrip('0') or '0',
                          'cod': str(x.get(k_cod, '')).zfill(2), 'qt_exist': inteiro(x.get(k_ex)),
                          'qt_uso': inteiro(x.get(k_uso)), 'sus': sus in ('S', 'SIM', '1', 'TRUE', 'T')})
    nota_est = completar_estab(estab, info, usar7, por_pag)
    an = Analise(mapa, aparelhos, estab)
    for ibge, cod in ((CAMPINAS, 'A09'), (SAO_PAULO, 'A10')):
        nome = 'Campinas' if ibge == CAMPINAS else 'São Paulo'
        anotar('notice', f'{cod} API cnes-equipamentos: {nome} ({ibge}) por exame e ressonância em uso',
               an.quadro_cidade(ibge, com_nome=False) + f'\nRessonância em uso por tipo de unidade: {an.tipos_rm([ibge])}\n'
               + an.exemplos('rm', ibge, 12) + f'\n(nome só quando a natureza jurídica não é pessoa física; tipo de unidade: {nota_est})')
    salvar_json(DADOS / 'api-resumo.json', an.resumo('API dados abertos', ','.join(sorted(comps)) if comps else None))


def completar_estab(estab: dict, info: dict, usar7: bool, por_pag: int) -> str:
    """Tipo de unidade, natureza e nome pela rota cnes-estabelecimentos da mesma API (Campinas e São Paulo)."""
    notas, achou = [], 0
    for ibge in (CAMPINAS, SAO_PAULO):
        recs, nota = todas(ROTAS[1], {'co_ibge': str(ibge) if usar7 else mun6(ibge)}, por_pag, LIMITE_PAGINAS_S / 4)
        notas.append(f"{'Campinas' if ibge == CAMPINAS else 'São Paulo'}: {nota}")
        if not recs:
            continue
        ks = list(recs[0].keys())
        k_cnes = campo(ks, r'^co_cnes$', r'cnes')
        k_tp = campo(ks, r'tp_unid', r'tipo_unid', r'co_tipo_unid', r'tp_estab')
        k_nome = campo(ks, r'no_fantasia', r'nome_fantasia', r'fantasia')
        k_nat = campo(ks, r'nat_jur')
        notas.append(f'campos usados: cnes={k_cnes}, tipo={k_tp}, nome={k_nome}, natureza={k_nat}')
        for x in recs:
            cn = str(x.get(k_cnes, '')).zfill(7)
            if cn in estab:
                e = estab[cn]
                if k_tp and e.get('tp') is None and str(x.get(k_tp, '')).strip().isdigit():
                    e['tp'] = int(x.get(k_tp))
                    achou += 1
                if k_nat and e.get('pj') is None and x.get(k_nat):
                    e['pj'] = 'FISIC' not in str(x.get(k_nat)).upper()
                if k_nome and not e.get('nome') and x.get(k_nome):
                    e['nome'] = str(x.get(k_nome))
    return f"{achou} completados pela rota cnes-estabelecimentos ({'; '.join(notas)})"


def outras_rotas(info: dict) -> None:
    ibge = info.get('ibge_param') or mun6(CAMPINAS)
    linhas = []
    for rota in ROTAS[1:]:
        r, recs, j = chamar(rota, {'co_ibge': ibge, 'limit': 5, 'offset': 0})
        linhas.append(f'{rota}: {resumo_http(r)}; {len(recs)} registros' +
                      (f"\n  campos: {', '.join(recs[0].keys())}\n  exemplo: {seguro(recs[0])}" if recs else f'; começo: {uma_linha(r.get("corpo"), 120)}'))
    # Serviços ligados a laboratório, eco e ECG em Campinas (página única com o maior limit aceito).
    r, recs, _ = chamar(ROTAS[2], {'co_ibge': ibge, 'limit': info.get('limit') or 20, 'offset': 0}, timeout=180)
    if recs:
        ks = list(recs[0].keys())
        k_ds = [k for k in ks if re.search(r'^ds_|^no_', k, re.I) and not PESSOAL.search(k)]
        cont = Counter()
        for x in recs:
            texto = ' / '.join(str(x.get(k, '')) for k in k_ds)
            for e, rx in (('lab', r'LABORAT|AN[AÁ]LISES CL[IÍ]N'), ('ecg', r'ELETROCARDIO'), ('eco', r'ECOCARDIO'), ('rm', r'RESSON')):
                if re.search(rx, texto.upper()):
                    cont[e] += 1
        linhas.append(f'Serviços em Campinas (1 página, {len(recs)} registros): linhas com lab/ECG/eco/ressonância: {dict(cont)}')
    anotar('notice', 'A11 API: cnes-estabelecimentos e cnes-servicos-especializados', '\n'.join(linhas))


def main() -> None:
    for parte in (documento,):
        try:
            parte()
        except Exception as e:  # noqa: BLE001
            anotar('error', 'API assistência: o documento quebrou', f'{type(e).__name__}: {e}')
    info = {}
    try:
        info = testes_formato()
    except Exception as e:  # noqa: BLE001
        anotar('error', 'API assistência: testes de formato quebraram', f'{type(e).__name__}: {e}')
    for parte in (equipamentos, outras_rotas):
        try:
            parte(info)
        except Exception as e:  # noqa: BLE001
            import traceback
            anotar('error', f'API assistência: {parte.__name__} quebrou', f'{type(e).__name__}: {e}\n' + traceback.format_exc()[-1200:])
    salvar_json(DADOS / 'api-assist-info.json', {k: v for k, v in info.items() if k != 'exemplo'})
    print(json.dumps({k: v for k, v in info.items() if k != 'exemplo'}))


if __name__ == '__main__':
    main()
