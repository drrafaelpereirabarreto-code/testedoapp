"""Sonda F: os arquivos mensais de equipamentos por UF do FTP do DATASUS (CNES/200508_/Dados/EQ/EQ<UF><AAMM>.dbc).

  python3 -I ftp_eq.py descobrir   lista a pasta EQ (mês mais recente, as 27 UFs, tamanhos) e as pastas vizinhas
  python3 -I ftp_eq.py baixar      baixa os 27 arquivos do mês mais recente e a tabela auxiliar TAB_CNES.zip
  python3 -I ftp_eq.py analisar    descompacta o DBC (pyreaddbc e datasus-dbc, comparando), lê com dbfread, acha a
                                   descrição oficial dos códigos e faz as contas de Campinas e São Paulo
"""

from __future__ import annotations

import hashlib
import re
import subprocess
import sys
import time
import traceback
import zipfile
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comum import (CAMPINAS, DADOS, SAO_PAULO, anotar, erro_curto, ftp_abrir, ftp_baixar, ftp_listar,  # noqa: E402
                   http, inteiro, json_de, ler_json, mb, mun6, salvar_json, tabela, uma_linha, velocidade)
from exames import Analise, cidades_do_imed, codigos_por_exame, sem_acento, texto_mapa  # noqa: E402

RAIZ_CNES = '/dissemin/publicos/CNES/200508_'
PASTA_EQ = f'{RAIZ_CNES}/Dados/EQ'
RE_EQ = re.compile(r'EQ([A-Z]{2})(\d{2})(\d{2})\.DBC', re.I)
ESCOLHA = DADOS / 'eq-escolha.json'
BAIXADO = DADOS / 'eq-baixado.json'
PASTA = DADOS / 'eq'
LIMITE_S = 20 * 60
REPO = Path(__file__).resolve().parents[2]
SEGUROS = {'CNES', 'CODUFMUN', 'TP_UNID', 'TIPEQUIP', 'CODEQUIP', 'QT_EXIST', 'QT_USO', 'IND_SUS', 'IND_NSUS',
           'COMPETEN', 'PF_PJ', 'NIV_DEP', 'ESFERA_A', 'NAT_JUR', 'TPGESTAO', 'REGSAUDE', 'NIV_HIER', 'TURNO_AT'}


def descobrir() -> None:
    linhas, escolha = [], {}
    try:
        f = ftp_abrir()
        try:
            itens, cru = ftp_listar(f, PASTA_EQ)
        except Exception as e:  # noqa: BLE001
            linhas.append(f'{PASTA_EQ}: falhou ({erro_curto(e)})')
            itens, cru = [], []
            try:
                vizinhos, _ = ftp_listar(f, '/dissemin/publicos/CNES')
                linhas.append('/dissemin/publicos/CNES: ' + ', '.join(i['nome'] for i in vizinhos)[:600])
            except Exception as e2:  # noqa: BLE001
                linhas.append(f'/dissemin/publicos/CNES: falhou ({erro_curto(e2)})')
        arqs = []
        for i in itens:
            m = RE_EQ.fullmatch(i['nome'])
            if m:
                arqs.append({'uf': m[1].upper(), 'aamm': m[2] + m[3], 'nome': i['nome'], 'tamanho': i['tamanho'], 'data': i['data']})
        if arqs:
            meses = sorted({a['aamm'] for a in arqs})
            ult = meses[-1]
            do_mes = sorted((a for a in arqs if a['aamm'] == ult), key=lambda a: a['uf'])
            ufs = {a['uf'] for a in do_mes}
            faltam = sorted({a['uf'] for a in arqs} - ufs)
            sp = sorted((a for a in arqs if a['uf'] == 'SP'), key=lambda a: a['aamm'])[-4:]
            linhas.append(f'{PASTA_EQ}: {len(itens)} itens, {len(arqs)} arquivos EQ, de {meses[0]} a {ult} (AAMM); '
                          f'formato da listagem: {uma_linha(cru[0] if cru else "", 80)}')
            linhas.append(f'Mês mais recente 20{ult[:2]}-{ult[2:]}: {len(do_mes)} UFs, {mb(sum(a["tamanho"] or 0 for a in do_mes))} '
                          f'no total; faltam: {", ".join(faltam) or "nenhuma"}')
            linhas.append('SP, últimos meses: ' + '; '.join(f"{a['nome']} {mb(a['tamanho'])} ({a['data']})" for a in sp))
            linhas.append('Tamanhos do mês: ' + ', '.join(f"{a['uf']} {mb(a['tamanho'])}" for a in do_mes))
            escolha = {'aamm': ult, 'arquivos': do_mes}
        for p in [f'{RAIZ_CNES}/Dados', f'{RAIZ_CNES}/Auxiliar', f'{RAIZ_CNES}/Doc']:
            try:
                its, _ = ftp_listar(f, p)
                linhas.append(f'{p}: ' + ', '.join(f"{i['nome']}{'' if i.get('dir') else ' ' + mb(i['tamanho'])}" for i in its)[:700])
                if p.endswith('Auxiliar'):
                    zips = [i for i in its if i['nome'].upper().endswith('.ZIP')]
                    tab = [i for i in zips if 'TAB' in i['nome'].upper()] or zips
                    if tab:
                        escolha['auxiliar'] = f"{p}/{tab[0]['nome']}"
            except Exception as e:  # noqa: BLE001
                linhas.append(f'{p}: falhou ({erro_curto(e)})')
        f.quit()
    except Exception as e:  # noqa: BLE001
        linhas.append(f'FTP: falhou ({erro_curto(e)})')
    salvar_json(ESCOLHA, escolha)
    anotar('notice' if escolha.get('arquivos') else 'error', 'F01 FTP EQ: o que há na pasta de equipamentos', '\n'.join(linhas))


def baixar() -> None:
    esc = ler_json(ESCOLHA, {}) or {}
    arqs = sorted(esc.get('arquivos') or [], key=lambda a: (a['uf'] != 'SP', a['uf']))
    if not arqs:
        anotar('error', 'F02 FTP EQ: nada para baixar', 'Veja F01.')
        salvar_json(BAIXADO, {})
        return
    ini = time.monotonic()
    feitos, linhas = [], []
    f = None
    for a in arqs:
        if time.monotonic() - ini > LIMITE_S:
            linhas.append(f"{a['uf']}: pulado (limite de tempo)")
            continue
        try:
            f = f or ftp_abrir(timeout=120)
            res = ftp_baixar(f, f"{PASTA_EQ}/{a['nome']}", PASTA / a['nome'], limite_s=600)
            feitos.append({**a, **res, 'arquivo': str(PASTA / a['nome'])})
            linhas.append(f"{a['uf']} {mb(res['bytes'])} {res['segundos']} s")
        except Exception as e:  # noqa: BLE001
            linhas.append(f"{a['uf']}: falhou ({erro_curto(e)})")
            try:
                f.close()
            except Exception:  # noqa: BLE001
                pass
            f = None
    total_s = round(time.monotonic() - ini, 1)
    total_b = sum(x['bytes'] for x in feitos)
    aux = None
    if esc.get('auxiliar'):
        try:
            f = f or ftp_abrir(timeout=120)
            destino = DADOS / 'aux' / Path(esc['auxiliar']).name
            res = ftp_baixar(f, esc['auxiliar'], destino, limite_s=300)
            aux = {**res, 'arquivo': str(destino), 'caminho': esc['auxiliar']}
        except Exception as e:  # noqa: BLE001
            aux = {'erro': erro_curto(e), 'caminho': esc['auxiliar']}
    try:
        if f:
            f.quit()
    except Exception:  # noqa: BLE001
        pass
    salvar_json(BAIXADO, {'aamm': esc.get('aamm'), 'arquivos': feitos, 'auxiliar': aux})
    sp = next((x for x in feitos if x['uf'] == 'SP'), None)
    anotar('notice' if feitos else 'error', f"F02 FTP EQ: download do mês {esc.get('aamm')} ({len(feitos)}/{len(arqs)} UFs)",
           (f"SP: {mb(sp['bytes'])} em {sp['segundos']} s ({velocidade(sp['bytes'], sp['segundos'])}); " if sp else 'SP: não baixou; ')
           + f'todas as UFs: {mb(total_b)} em {total_s} s ({velocidade(total_b, total_s)})\n'
           + '; '.join(linhas)
           + (f"\nTabela auxiliar {aux.get('caminho')}: " + (f"{mb(aux.get('bytes'))} em {aux.get('segundos')} s" if aux and not aux.get('erro') else f"falhou ({aux.get('erro') if aux else '-'})") if aux else '\nTabela auxiliar: não achada'))


# ----------------------------------------------------------------------------------------------- analisar

def descompactar(dbc: Path) -> tuple[Path | None, list[str]]:
    """Tenta as duas bibliotecas (cada uma num processo separado) e confere se dão o mesmo DBF."""
    saidas, notas = {}, []
    for nome, codigo in [('pyreaddbc', 'import sys, pyreaddbc; pyreaddbc.dbc2dbf(sys.argv[1], sys.argv[2])'),
                         ('datasus-dbc', 'import sys, datasus_dbc; datasus_dbc.decompress(sys.argv[1], sys.argv[2])')]:
        out = dbc.with_suffix(f'.{nome}.dbf')
        ini = time.monotonic()
        try:
            p = subprocess.run([sys.executable, '-I', '-c', codigo, str(dbc), str(out)], capture_output=True, text=True, timeout=600)
            seg = round(time.monotonic() - ini, 2)
            if p.returncode == 0 and out.exists() and out.stat().st_size > 0:
                saidas[nome] = out
                h = hashlib.sha256(out.read_bytes()).hexdigest()[:16]
                notas.append(f'{nome}: ok em {seg} s, DBF {mb(out.stat().st_size)}, sha256 {h}')
            else:
                notas.append(f'{nome}: falhou (código {p.returncode}) {uma_linha(p.stderr, 200)}')
        except Exception as e:  # noqa: BLE001
            notas.append(f'{nome}: falhou ({erro_curto(e)})')
    if len(saidas) == 2:
        a, b = (x.read_bytes() for x in saidas.values())
        notas.append('as duas dão o MESMO arquivo' if a == b else 'ATENÇÃO: as duas dão arquivos DIFERENTES')
    return (next(iter(saidas.values())) if saidas else None), notas


def ler_dbf(caminho: Path):
    from dbfread import DBF
    return DBF(str(caminho), encoding='latin-1', char_decode_errors='replace', load=False)


def descricoes_auxiliar(aux: dict | None) -> tuple[dict, dict, str]:
    """Procura nos .CNV da TAB_CNES.zip a tabela de equipamentos: {código: descrição} e {(tipo, código): descrição}."""
    if not aux or aux.get('erro') or not aux.get('arquivo'):
        return {}, {}, 'TAB_CNES.zip não baixou'
    z = zipfile.ZipFile(aux['arquivo'])
    cnvs = [i for i in z.infolist() if i.filename.upper().endswith('.CNV')]
    cands = []
    for i in cnvs:
        t = z.read(i).decode('latin-1', 'replace')
        n = len(re.findall(r'RESSON|TOMOGRAF|MAMOGRAF|ELETROCARDIOGRAF', sem_acento(t)))
        if n:
            cands.append((('EQUIP' in i.filename.upper()), n, i.filename, t))
    if not cands:
        return {}, {}, f'nenhum dos {len(cnvs)} .CNV fala de ressonância/tomógrafo'
    cands.sort(key=lambda c: (c[0], c[1]), reverse=True)
    resumo = 'CNV candidatos: ' + ', '.join(f'{c[2]} ({c[1]})' for c in cands[:8])
    _, _, nome, texto = cands[0]
    por2, por3 = {}, {}
    linhas_cnv = texto.splitlines()
    tabela_cnv = []
    for l in linhas_cnv[1:]:
        m = re.match(r'^\s*\d+\s+(.*\S)\s+(\d{2,4}(?:,\d{2,4})*)\s*$', l)
        if not m:
            continue
        desc = re.sub(r'^\d{3,4}\s*-\s*', '', m.group(1).strip())
        for cod in m.group(2).split(','):
            if len(cod) == 4:
                par = (cod[:2].lstrip('0') or '0', cod[2:])
            elif len(cod) == 3:
                par = (cod[0], cod[1:])
            else:
                por2[cod] = desc
                continue
            por3[par] = desc
            tabela_cnv.append(f'{par[0]}/{par[1]} {desc}')
    # Tabela completa dos tipos 1 (imagem) e 4 (métodos gráficos), mais o que falar de ecocardiograma.
    escolhidos = [x for x in tabela_cnv if x.split('/')[0] in ('1', '4') or 'ECOC' in sem_acento(x)]
    tipos_txt = ''
    for i in z.infolist():
        if re.search(r'equip_?tp|tp_?equip', i.filename, re.I):
            tipos_txt = f"\n{i.filename}: " + '; '.join(re.sub(r'\s+', ' ', x).strip() for x in z.read(i).decode('latin-1', 'replace').splitlines()[1:30])
    return por2, por3, (f'{resumo}\nUsado: {nome} ({len(linhas_cnv)} linhas; {len(por3)} códigos tipo+código, {len(por2)} de 2 dígitos)'
                        f'{tipos_txt}\nTipos 1 (imagem) e 4 (gráficos), código e descrição oficial:\n' + '\n'.join(escolhidos))


def analisar() -> None:
    b = ler_json(BAIXADO, {}) or {}
    arqs = b.get('arquivos') or []
    if not arqs:
        anotar('error', 'F03 FTP EQ: nada para analisar', 'O download falhou (veja F02).')
        return
    try:
        _analisar(b, arqs)
    except Exception as e:  # noqa: BLE001
        anotar('error', 'FTP EQ: a análise quebrou', erro_curto(e) + '\n' + traceback.format_exc()[-1500:])


def _analisar(b: dict, arqs: list[dict]) -> None:
    sp = next((a for a in arqs if a['uf'] == 'SP'), arqs[0])
    dbf_sp, notas = descompactar(Path(sp['arquivo']))
    anotar('notice' if dbf_sp else 'error', f"F03 FTP EQ: descompactar o DBC ({Path(sp['arquivo']).name})", '\n'.join(notas))
    if not dbf_sp:
        return
    t = ler_dbf(dbf_sp)
    campos = [[fl.name, fl.type, fl.length, fl.decimal_count] for fl in t.fields]
    n = 0
    amostra = []
    competencias, ind_sus, ind_nsus, pfpj = Counter(), Counter(), Counter(), Counter()
    for r in t:
        n += 1
        if len(amostra) < 2:
            amostra.append('; '.join(f"{k}={v if k in SEGUROS else '…'}" for k, v in r.items()))
        competencias[r.get('COMPETEN')] += 1
        ind_sus[r.get('IND_SUS')] += 1
        ind_nsus[r.get('IND_NSUS')] += 1
        pfpj[r.get('PF_PJ')] += 1
    anotar('notice', f'F04 FTP EQ: colunas do arquivo de SP ({n} linhas)',
           tabela(campos, ['coluna', 'tipo', 'tamanho', 'decimais']) +
           f"\nCompetência: {dict(competencias.most_common(3))}; IND_SUS: {dict(ind_sus.most_common(4))}; "
           f"IND_NSUS: {dict(ind_nsus.most_common(4))}; PF_PJ: {dict(pfpj.most_common(3))}\n"
           f'Exemplo (campos fora da lista segura ocultos, ex.: CPF_CNPJ):\n' + '\n'.join(amostra))

    # Todas as UFs: cada linha (só os campos usados) e os estabelecimentos (tipo, PF/PJ) do próprio arquivo.
    linhas_eq, estab, pares = [], {}, Counter()
    notas_uf = []
    for a in arqs:
        caminho = dbf_sp if a is sp else None
        if caminho is None:
            caminho, nt = descompactar(Path(a['arquivo']))
            if not caminho:
                notas_uf.append(f"{a['uf']}: {'; '.join(nt)}")
                continue
        for r in ler_dbf(caminho):
            tp, cod = str(r.get('TIPEQUIP')).lstrip('0') or '0', str(r.get('CODEQUIP')).zfill(2)
            cn = str(r.get('CNES')).zfill(7)
            mun = str(r.get('CODUFMUN'))[:6]
            pf = str(r.get('PF_PJ'))
            estab.setdefault(cn, {'mun': mun, 'tp': inteiro(r.get('TP_UNID')), 'pj': True if pf == '3' else (False if pf == '1' else None)})
            pares[(tp, cod)] += 1
            linhas_eq.append((cn, mun, tp, cod, inteiro(r.get('QT_EXIST')), inteiro(r.get('QT_USO')), str(r.get('IND_SUS')) == '1'))
    if notas_uf:
        anotar('warning', 'FTP EQ: UFs que não abriram', '\n'.join(notas_uf))

    por2, por3, nota_aux = descricoes_auxiliar(b.get('auxiliar'))
    descricoes = {}
    for (tp, cod) in pares:
        d = por3.get((tp, cod)) or por2.get(cod)
        if d:
            descricoes[(tp, cod)] = d
    anotar('notice', 'F05 FTP EQ: descrição oficial dos códigos (tabela auxiliar do TabWin)',
           nota_aux + f'\nPares tipo/código no país ({len(linhas_eq)} linhas de {len(arqs) - len(notas_uf)} UFs): ' +
           ', '.join(f'{tp}/{cod}={q}' for (tp, cod), q in sorted(pares.items())) +
           '\nSem descrição na tabela auxiliar: ' + (', '.join(f'{tp}/{cod}' for tp, cod in sorted(set(pares) - set(descricoes))) or 'nenhum'))
    mapa, origem = codigos_por_exame(descricoes)
    anotar('notice', 'F06 FTP EQ: exames do site x códigos de equipamento', texto_mapa(mapa, origem))
    chaves = {(tp, cod) for lst in mapa.values() for tp, cod, _ in lst}
    aparelhos = [{'cnes': cn, 'mun': mun, 'tipo': tp, 'cod': cod, 'qt_exist': ex, 'qt_uso': us, 'sus': sus}
                 for cn, mun, tp, cod, ex, us, sus in linhas_eq if (tp, cod) in chaves]
    an = Analise(mapa, aparelhos, estab)
    # Nomes dos exemplos: da API de dados abertos (só pessoa jurídica).
    nomes = {}
    for ibge in (CAMPINAS, SAO_PAULO):
        for cn in sorted(an.com('rm', {mun6(ibge)}), key=lambda c: -an.por[c]['rm'][1])[:12]:
            if estab.get(cn, {}).get('pj'):
                j = json_de(http(f'https://apidadosabertos.saude.gov.br/cnes/estabelecimentos/{cn}', timeout=30)) or {}
                if j.get('nome_fantasia') or j.get('nome_razao_social'):
                    nomes[cn] = str(j.get('nome_fantasia') or j.get('nome_razao_social'))
    for ibge, cod in ((CAMPINAS, 'F07'), (SAO_PAULO, 'F08')):
        nome = 'Campinas' if ibge == CAMPINAS else 'São Paulo'
        anotar('notice', f'{cod} FTP EQ: {nome} ({ibge}) por exame e ressonância em uso',
               an.quadro_cidade(ibge, com_nome=False) + f'\nRessonância em uso por tipo de unidade: {an.tipos_rm([ibge])}\n'
               + an.exemplos('rm', ibge, 12, nomes) + '\n(nomes pela API de dados abertos; "site acha hoje" não se calcula aqui)')
    cidades = cidades_do_imed(REPO)
    anotar('notice', f'F09 FTP EQ: nas {len(cidades)} cidades do IMED', an.cobertura(cidades, com_nome=False))
    salvar_json(DADOS / 'eq-resumo.json', an.resumo('FTP EQ', b.get('aamm')))


if __name__ == '__main__':
    {'descobrir': descobrir, 'baixar': baixar, 'analisar': analisar}[sys.argv[1]]()
