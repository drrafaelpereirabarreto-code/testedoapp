"""CID-10 do DATASUS (arquivo CID10CSV.zip, versão 2008) -> cid10.tsv para o banco (private.cid10_carregar).

Uso (no GitHub Actions, que alcança o DATASUS; esta máquina não):
    python3 -I scripts/cid10/gerar.py baixar <pasta>          baixa o zip para <pasta>/CID10CSV.zip
    python3 -I scripts/cid10/gerar.py gerar <zip> <saida>     grava <saida>/cid10.tsv, resumo.json e LEIAME.txt

Saída: UTF-8, separada por TAB, com cabeçalho
    codigo  capitulo  restr_sexo  descricao  descricao_abrev
- codigo sem ponto (A00 = categoria; A000 = subcategoria, mostrada como A00.0);
- capitulo pelo intervalo CATINIC..CATFIM de CID-10-CAPITULOS.CSV;
- restr_sexo (F ou M) das subcategorias (RESTRSEXO; 1 = masculino, 3 = feminino, como no arquivo do DATASUS);
  categorias: F/M só quando todas as subcategorias têm a mesma restrição.
Nada é inventado: só o que está no arquivo oficial. Sem rede nos testes (test_gerar.py).
"""
import csv
import hashlib
import io
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

URLS = [
    'https://www2.datasus.gov.br/cid10/V2008/downloads/CID10CSV.zip',
    'http://www2.datasus.gov.br/cid10/V2008/downloads/CID10CSV.zip',
]
COD = re.compile(r'^[A-Z][0-9]{2}[0-9X]?$')
MIN_CATEGORIAS = 2000
MIN_SUBCATEGORIAS = 10000


def baixar(pasta):
    pasta = Path(pasta)
    pasta.mkdir(parents=True, exist_ok=True)
    erro = None
    for url in URLS:
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                dados = r.read()
            if not dados.startswith(b'PK'):
                raise ValueError(f'{url}: não é um zip')
            (pasta / 'CID10CSV.zip').write_bytes(dados)
            print(f'baixado {url} ({len(dados)} bytes)')
            return url
        except Exception as e:  # noqa: BLE001 - tenta o próximo endereço
            erro = e
            print(f'falhou {url}: {e}', file=sys.stderr)
    raise SystemExit(f'não foi possível baixar o CID10CSV.zip: {erro}')


def ler_csv(zf, parte):
    """Acha no zip o CSV cujo nome termina em <parte> (sem CID-O) e devolve as linhas como dicionários."""
    nomes = [n for n in zf.namelist() if n.upper().endswith(parte) and 'CID-O' not in n.upper()]
    if len(nomes) != 1:
        raise SystemExit(f'esperava 1 arquivo terminado em {parte}, achei {nomes}')
    bruto = zf.read(nomes[0])
    try:
        texto = bruto.decode('utf-8')
    except UnicodeDecodeError:
        texto = bruto.decode('latin-1')
    leitor = csv.DictReader(io.StringIO(texto), delimiter=';')
    leitor.fieldnames = [(f or '').strip().upper() for f in leitor.fieldnames]
    return [{k: (v or '').strip() for k, v in linha.items() if k} for linha in leitor]


def limpa(t):
    return re.sub(r'\s+', ' ', (t or '').replace('\t', ' ')).strip()


def sexo(v):
    v = (v or '').strip().upper()
    return {'1': 'M', 'M': 'M', '3': 'F', 'F': 'F'}.get(v, '')


def capitulo_de(cat3, capitulos):
    for num, ini, fim in capitulos:
        if ini <= cat3 <= fim:
            return num
    return ''


def montar(caps, cats, subs):
    capitulos = []
    for c in caps:
        try:
            num = int(c.get('NUMCAP', ''))
        except ValueError:
            continue
        ini, fim = c.get('CATINIC', '').upper(), c.get('CATFIM', '').upper()
        if 1 <= num <= 22 and COD.match(ini) and COD.match(fim):
            capitulos.append((num, ini, fim))
    linhas = {}
    sexos_por_cat = {}
    for s in subs:
        cod = s.get('SUBCAT', '').upper().replace('.', '')
        desc = limpa(s.get('DESCRICAO'))
        if not COD.match(cod) or len(cod) != 4 or len(desc) < 2:
            continue
        sx = sexo(s.get('RESTRSEXO'))
        sexos_por_cat.setdefault(cod[:3], set()).add(sx)
        linhas[cod] = (cod, capitulo_de(cod[:3], capitulos), sx, desc[:400], limpa(s.get('DESCRABREV'))[:200])
    for c in cats:
        cod = c.get('CAT', '').upper().replace('.', '')
        desc = limpa(c.get('DESCRICAO'))
        if not COD.match(cod) or len(cod) != 3 or len(desc) < 2:
            continue
        sx = sexos_por_cat.get(cod, {''})
        linhas[cod] = (cod, capitulo_de(cod, capitulos), sx.pop() if len(sx) == 1 else '', desc[:400],
                       limpa(c.get('DESCRABREV'))[:200])
    return [linhas[k] for k in sorted(linhas)]


def tsv(linhas):
    out = ['codigo\tcapitulo\trestr_sexo\tdescricao\tdescricao_abrev']
    out += ['\t'.join(str(x) for x in l) for l in linhas]
    return '\n'.join(out) + '\n'


def gerar(zip_path, saida):
    dados = Path(zip_path).read_bytes()
    with zipfile.ZipFile(io.BytesIO(dados)) as zf:
        caps = ler_csv(zf, 'CAPITULOS.CSV')
        cats = ler_csv(zf, '-CATEGORIAS.CSV')
        subs = ler_csv(zf, 'SUBCATEGORIAS.CSV')
    linhas = montar(caps, cats, subs)
    n_cat = sum(1 for l in linhas if len(l[0]) == 3)
    n_sub = len(linhas) - n_cat
    if n_cat < MIN_CATEGORIAS or n_sub < MIN_SUBCATEGORIAS:
        raise SystemExit(f'poucas linhas: {n_cat} categorias e {n_sub} subcategorias (o arquivo mudou?)')
    saida = Path(saida)
    saida.mkdir(parents=True, exist_ok=True)
    texto = tsv(linhas)
    (saida / 'cid10.tsv').write_text(texto, encoding='utf-8')
    resumo = {'categorias': n_cat, 'subcategorias': n_sub, 'total': len(linhas),
              'sem_capitulo': sum(1 for l in linhas if l[1] == ''),
              'zip_sha256': hashlib.sha256(dados).hexdigest(),
              'tsv_sha256': hashlib.sha256(texto.encode('utf-8')).hexdigest()}
    (saida / 'resumo.json').write_text(json.dumps(resumo, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(resumo, ensure_ascii=False))
    return resumo


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == 'baixar':
        baixar(sys.argv[2])
    elif len(sys.argv) == 4 and sys.argv[1] == 'gerar':
        gerar(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit(__doc__)
