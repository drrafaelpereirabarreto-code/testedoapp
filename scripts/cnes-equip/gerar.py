"""Aparelhos do CNES por estabelecimento, para o filtro de exame do site (dado público do DATASUS).

  python3 -I gerar.py baixar <pasta>          baixa do FTP do DATASUS o mês mais recente de EQ<UF><AAMM>.dbc
                                              das UFs das cidades de scripts/cidades.json
  python3 -I gerar.py gerar <pasta> <saida>   lê os arquivos e grava <saida>/equipamentos.csv e resumo.json

Saída (compacta): cnes (7 dígitos), exame do site, quantidade em uso, atende SUS (1/0) e o mês da fonte (AAAA-MM).
Só as cidades de scripts/cidades.json, só aparelhos em uso e só os códigos de CODIGOS. A coluna CPF_CNPJ (e
qualquer outra que não esteja em COLUNAS) é descartada na leitura: nenhum nome de pessoa nem CPF sai daqui.
Avisos viram anotações do GitHub (::notice::), porque o registro completo não abre para quem acompanha de fora.
"""

from __future__ import annotations

import csv
import ftplib
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FTP_HOST = 'ftp.datasus.gov.br'
PASTA_EQ = '/dissemin/publicos/CNES/200508_/Dados/EQ'
RE_EQ = re.compile(r'EQ([A-Z]{2})(\d{2})(\d{2})\.DBC', re.I)
COLUNAS = ('CNES', 'CODUFMUN', 'TIPEQUIP', 'CODEQUIP', 'QT_USO', 'IND_SUS', 'COMPETEN')
# (tipo, código) do CNES -> exame do site. Tipo 1 = diagnóstico por imagem; 4 = métodos gráficos.
# Pesquisa de 30/10/2026 (memória do projeto). Eco não tem aparelho próprio; laboratório não é aparelho.
CODIGOS: dict[tuple[str, str], str] = {}
for _ex, _tipo, _cods in [
    ('rm', '01', ['12', '32', '33', '34', '35']),
    ('tc', '01', ['11', '26', '27', '28', '29', '30']),
    ('mamo', '01', ['02', '03', '17', '19']),
    ('rx', '01', ['04', '05', '06', '08', '20', '21', '22']),
    ('dens', '01', ['09']),
    ('usg', '01', ['13', '14', '15']),
    ('ecg', '04', ['41']),
]:
    for _c in _cods:
        CODIGOS[(_tipo, _c)] = _ex
CAMPINAS, SAO_PAULO = 3509502, 3550308


def anotar(nivel: str, titulo: str, texto: str) -> None:
    t = texto.replace('%', '%25').replace('\r', '').replace('\n', '%0A')
    print(f'::{nivel} title={titulo}::{t}', flush=True)


def dois(v) -> str:
    s = str(v if v is not None else '').strip()
    return s.zfill(2) if s.isdigit() else s


def inteiro(v) -> int:
    try:
        return int(float(str(v).strip() or 0))
    except ValueError:
        return 0


def cidades() -> dict[str, int]:
    """{código de 6 dígitos: código IBGE de 7} e as UFs."""
    lst = json.loads((REPO / 'scripts' / 'cidades.json').read_text(encoding='utf-8'))
    return {str(c['ibge'])[:6]: int(c['ibge']) for c in lst}


def ufs() -> list[str]:
    lst = json.loads((REPO / 'scripts' / 'cidades.json').read_text(encoding='utf-8'))
    return sorted({c['uf'] for c in lst})


def linha_de(r: dict, mun: dict[str, int]):
    """Uma linha do DBF -> (cnes, exame, qt_uso, sus, competência) ou None. Só lê as COLUNAS."""
    r = {k: r.get(k) for k in COLUNAS}
    m = str(r['CODUFMUN'] or '').strip()[:6]
    if m not in mun:
        return None
    ex = CODIGOS.get((dois(r['TIPEQUIP']), dois(r['CODEQUIP'])))
    if not ex:
        return None
    uso = inteiro(r['QT_USO'])
    if uso <= 0:
        return None
    cnes = str(r['CNES'] or '').strip().zfill(7)
    if not re.fullmatch(r'\d{7}', cnes):
        return None
    comp = str(r['COMPETEN'] or '').strip()
    comp = f'{comp[:4]}-{comp[4:6]}' if re.fullmatch(r'\d{6}', comp) else ''
    return cnes, ex, uso, str(r['IND_SUS'] or '').strip() == '1', comp


def juntar(linhas, mun: dict[str, int]):
    """Soma por (cnes, exame): em uso, SUS se algum aparelho atende SUS, a competência mais nova."""
    por = {}
    cid = {}
    for r in linhas:
        x = linha_de(r, mun)
        if not x:
            continue
        cnes, ex, uso, sus, comp = x
        v = por.setdefault((cnes, ex), [0, False, ''])
        v[0] += uso
        v[1] = v[1] or sus
        v[2] = max(v[2], comp)
        cid[cnes] = mun[str(r.get('CODUFMUN')).strip()[:6]]
    return por, cid


def baixar(pasta: Path) -> None:
    pasta.mkdir(parents=True, exist_ok=True)
    f = ftplib.FTP(timeout=120)
    f.connect(FTP_HOST, 21)
    f.login()
    f.set_pasv(True)
    nomes = f.nlst(PASTA_EQ)
    arqs = {}
    for n in nomes:
        m = RE_EQ.fullmatch(Path(n).name)
        if m:
            arqs.setdefault(m[2] + m[3], {})[m[1].upper()] = Path(n).name
    precisa = ufs()
    # mês mais recente que tenha TODAS as UFs necessárias
    mes = next((a for a in sorted(arqs, reverse=True) if all(u in arqs[a] for u in precisa)), None)
    if not mes:
        anotar('error', 'Equipamentos: nenhum mês completo no FTP', ', '.join(sorted(arqs))[-300:])
        sys.exit(1)
    for u in precisa:
        nome = arqs[mes][u]
        with open(pasta / nome, 'wb') as out:
            f.retrbinary(f'RETR {PASTA_EQ}/{nome}', out.write, blocksize=1 << 16)
    f.quit()
    (pasta / 'mes.txt').write_text(mes)
    anotar('notice', f'Equipamentos: baixado o mês 20{mes[:2]}-{mes[2:]}', f'{len(precisa)} UFs: {", ".join(precisa)}')


def gerar(pasta: Path, saida: Path) -> None:
    from dbfread import DBF
    mun = cidades()
    total = {}
    cid_de = {}
    for dbc in sorted(pasta.glob('*.dbc')) + sorted(pasta.glob('*.DBC')):
        dbf = dbc.with_suffix('.dbf')
        subprocess.run([sys.executable, '-I', '-c', 'import sys, pyreaddbc; pyreaddbc.dbc2dbf(sys.argv[1], sys.argv[2])',
                        str(dbc), str(dbf)], check=True)
        t = DBF(str(dbf), encoding='latin-1', char_decode_errors='replace', load=False)
        faltam = [c for c in COLUNAS if c not in t.field_names]
        if faltam:
            anotar('error', f'Equipamentos: {dbc.name} sem colunas', ', '.join(faltam))
            sys.exit(1)
        por, cid = juntar(t, mun)
        for k, v in por.items():
            a = total.setdefault(k, [0, False, ''])
            a[0] += v[0]
            a[1] = a[1] or v[1]
            a[2] = max(a[2], v[2])
        cid_de.update(cid)
    saida.mkdir(parents=True, exist_ok=True)
    with open(saida / 'equipamentos.csv', 'w', newline='', encoding='utf-8') as out:
        w = csv.writer(out, lineterminator='\n')
        w.writerow(['cnes', 'exame', 'qt_uso', 'sus', 'competencia'])
        for (cnes, ex), (uso, sus, comp) in sorted(total.items()):
            w.writerow([cnes, ex, uso, 1 if sus else 0, comp])
    cont = defaultdict(lambda: defaultdict(int))
    for (cnes, ex) in total:
        cont[str(cid_de[cnes])][ex] += 1
    meses = sorted({v[2] for v in total.values()})
    resumo = {'fonte': 'CNES/DATASUS - Ministério da Saúde (FTP, arquivos EQ por UF)', 'competencia': meses[-1] if meses else None,
              'linhas': len(total), 'estabelecimentos': len({c for c, _ in total}),
              'por_exame': {e: sum(1 for (_, x) in total if x == e) for e in sorted(set(CODIGOS.values()))},
              'por_cidade': {k: dict(v) for k, v in sorted(cont.items())}}
    (saida / 'resumo.json').write_text(json.dumps(resumo, ensure_ascii=False, indent=1), encoding='utf-8')
    texto = (saida / 'equipamentos.csv').read_text(encoding='utf-8')
    assert 'CPF' not in texto.upper()
    anotar('notice', 'Equipamentos: arquivo gerado',
           f"competência {resumo['competencia']}; {resumo['linhas']} linhas; {resumo['estabelecimentos']} estabelecimentos; "
           f"por exame {resumo['por_exame']}\nCampinas: {resumo['por_cidade'].get(str(CAMPINAS))}\n"
           f"São Paulo: {resumo['por_cidade'].get(str(SAO_PAULO))}")


if __name__ == '__main__':
    if sys.argv[1] == 'baixar':
        baixar(Path(sys.argv[2]))
    elif sys.argv[1] == 'gerar':
        gerar(Path(sys.argv[2]), Path(sys.argv[3]))
