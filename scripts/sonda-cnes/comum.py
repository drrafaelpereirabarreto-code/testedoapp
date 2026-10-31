"""Peças comuns da sonda do CNES (aparelhos por estabelecimento).

A sonda roda no GitHub Actions (a máquina do Claude não alcança os servidores do governo). O registro e os
artifacts das execuções não abrem daqui: o que volta são só as anotações (avisos) de cada job. Por isso cada
script guarda os seus avisos em arquivos (anotar) e os passos "Publicar" do workflow os mostram em lotes de 9
(o GitHub aceita uns 10 avisos por passo e 50 por job).

Regras: só fonte pública oficial; nada de dado pessoal nos avisos (CPF, e-mail, nome de pessoa, usuário do
sistema); nome do estabelecimento só quando é pessoa jurídica.
"""

from __future__ import annotations

import ftplib
import hashlib
import json
import math
import os
import re
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

UA = 'IMED-sonda/1.0 (+https://drrafaelpereirabarreto-code.github.io/testedoapp/)'
RAIZ = Path(os.environ.get('SONDA_RAIZ') or (Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'sonda'))
ANOT = RAIZ / 'anot'
DADOS = RAIZ / 'dados'
MAX_BYTES = 3300  # por aviso (o GitHub corta mensagens longas; ~3,8 KB já funcionou em banco.yml)
FTP_HOST = 'ftp.datasus.gov.br'

# Cidades da prova (código IBGE de 7 dígitos; o CNES usa os 6 primeiros).
CAMPINAS = 3509502
SAO_PAULO = 3550308
# Pontos da busca do site: Av. Paulista (assets/js/data.js) e o centro de Campinas (Catedral Metropolitana).
PONTOS = {
    'Av. Paulista (SP)': (-23.5650, -46.6520, SAO_PAULO),
    'Centro de Campinas': (-22.9056, -47.0608, CAMPINAS),
}
# Tipos de unidade do CNES que o IMED importa (supabase/functions/importar-clinicas/lib.ts, CNES_TYPES).
TIPOS_IMED = {39, 36, 4, 5, 7, 62}
TIPOS_HOSPITAL = {5, 7, 62}


def mun6(ibge7: int | str) -> str:
    return str(ibge7)[:6]


# ----------------------------------------------------------------------------------------------- avisos

def cortar(texto: str, max_bytes: int) -> str:
    t = str(texto)
    if len(t.encode('utf-8')) <= max_bytes:
        return t
    fim = min(len(t), max_bytes)
    while fim > 0 and len(t[:fim].encode('utf-8')) > max_bytes - 12:
        fim -= 1
    return t[:fim] + ' …(cortado)'


def dividir(texto: str, max_bytes: int = MAX_BYTES) -> list[str]:
    partes: list[str] = []
    atual: list[str] = []
    tam = 0
    for linha in str(texto).replace('\r', '').split('\n'):
        linha = linha.rstrip()
        if len(linha.encode('utf-8')) + 1 > max_bytes:
            linha = cortar(linha, max_bytes - 20)
        b = len(linha.encode('utf-8')) + 1
        if atual and tam + b > max_bytes:
            partes.append('\n'.join(atual))
            atual, tam = [], 0
        atual.append(linha)
        tam += b
    if atual:
        partes.append('\n'.join(atual))
    return [p for p in partes if p.strip()] or ['(vazio)']


def anotar(nivel: str, titulo: str, texto: str = '') -> None:
    """Guarda um aviso (notice, warning ou error) para os passos "Publicar"; texto longo vira (1/n), (2/n)..."""
    ANOT.mkdir(parents=True, exist_ok=True)
    partes = dividir(texto or titulo)
    for k, parte in enumerate(partes):
        t = titulo if len(partes) == 1 else f'{titulo} ({k + 1}/{len(partes)})'
        nome = f'{time.time_ns():020d}-{os.getpid()}-{k:03d}.json'
        (ANOT / nome).write_text(json.dumps({'nivel': nivel, 'titulo': t, 'texto': parte}, ensure_ascii=False),
                                 encoding='utf-8')
    print(f'\n[{nivel}] {titulo}\n{texto}\n', flush=True)


def esc_dado(s: str) -> str:
    return s.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')


def esc_prop(s: str) -> str:
    return esc_dado(s).replace(':', '%3A').replace(',', '%2C')


# ----------------------------------------------------------------------------------------------- formatação

def mb(n: int | float | None) -> str:
    if n is None:
        return '?'
    if n >= 1e9:
        return f'{n / 1e9:.2f} GB'
    if n >= 1e6:
        return f'{n / 1e6:.1f} MB'
    if n >= 1e3:
        return f'{n / 1e3:.1f} kB'
    return f'{int(n)} B'


def velocidade(nbytes: int | None, segundos: float | None) -> str:
    if not nbytes or not segundos:
        return '?'
    return f'{nbytes / segundos / 1e6:.2f} MB/s'


def tabela(linhas: list[list], cab: list[str] | None = None, sep: str = ' | ') -> str:
    todas = ([cab] if cab else []) + [[('' if c is None else str(c)) for c in l] for l in linhas]
    if not todas:
        return '(nada)'
    larg = [max(len(str(l[i])) if i < len(l) else 0 for l in todas) for i in range(max(len(l) for l in todas))]
    out = []
    for j, l in enumerate(todas):
        out.append(sep.join(str(c).ljust(larg[i]) for i, c in enumerate(l)).rstrip())
        if cab and j == 0:
            out.append('-+-'.join('-' * w for w in larg))
    return '\n'.join(out)


def uma_linha(b: bytes | str | None, n: int = 160) -> str:
    if b is None:
        return ''
    s = b.decode('utf-8', 'replace') if isinstance(b, bytes) else str(b)
    s = re.sub(r'\s+', ' ', s).strip()
    return s[:n] + ('…' if len(s) > n else '')


def distancia_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def numero(v) -> float | None:
    if v is None:
        return None
    s = str(v).strip().replace(',', '.')
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def inteiro(v) -> int:
    n = numero(v)
    return int(n) if n is not None else 0


# ----------------------------------------------------------------------------------------------- HTTP

def http(url: str, *, metodo: str = 'GET', cab: dict | None = None, corpo: bytes | None = None,
         timeout: float = 60, destino: Path | None = None, limite_s: float | None = None,
         max_corpo: int = 20_000_000) -> dict:
    """Pedido HTTP(S) que nunca levanta erro: devolve status, tempo, bytes, tipo, URL final, corpo (ou arquivo)."""
    ini = time.monotonic()
    r: dict = {'url': url, 'status': None, 'erro': None, 'bytes': 0, 'segundos': None, 'tipo': None,
               'final': None, 'cab': {}, 'corpo': b''}
    h = {'User-Agent': UA, 'Accept': '*/*', **(cab or {})}
    req = urllib.request.Request(url, data=corpo, method=metodo, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            r['status'] = resp.status
            r['final'] = resp.geturl()
            r['tipo'] = resp.headers.get('Content-Type')
            r['cab'] = {k.lower(): v for k, v in resp.headers.items()}
            if metodo != 'HEAD':
                r.update(_ler(resp, destino, limite_s, max_corpo, ini))
    except urllib.error.HTTPError as e:
        r['status'] = e.code
        r['final'] = e.geturl()
        r['erro'] = f'HTTP {e.code} {e.reason}'
        try:
            r['tipo'] = e.headers.get('Content-Type') if e.headers else None
            r['cab'] = {k.lower(): v for k, v in (e.headers.items() if e.headers else [])}
            r['corpo'] = e.read(200_000)
            r['bytes'] = len(r['corpo'])
        except Exception:  # noqa: BLE001
            pass
    except Exception as e:  # noqa: BLE001
        motivo = getattr(e, 'reason', None)
        r['erro'] = f'{type(e).__name__}: {motivo if motivo is not None else e}'
    r['segundos'] = round(time.monotonic() - ini, 2)
    return r


def _ler(resp, destino: Path | None, limite_s: float | None, max_corpo: int, ini: float) -> dict:
    if destino is None:
        corpo = resp.read(max_corpo + 1)
        return {'bytes': len(corpo), 'corpo': corpo[:max_corpo], 'cortado': len(corpo) > max_corpo}
    n = 0
    sha = hashlib.sha256()
    ultimo = time.monotonic()
    destino.parent.mkdir(parents=True, exist_ok=True)
    with open(destino, 'wb') as f:
        while True:
            b = resp.read(1 << 20)
            if not b:
                break
            f.write(b)
            sha.update(b)
            n += len(b)
            agora = time.monotonic()
            if agora - ultimo > 20:
                print(f'  ... {mb(n)} em {agora - ini:.0f} s', flush=True)
                ultimo = agora
            if limite_s and agora - ini > limite_s:
                return {'bytes': n, 'cortado': True, 'sha256': sha.hexdigest()}
    return {'bytes': n, 'cortado': False, 'sha256': sha.hexdigest()}


def json_de(r: dict):
    try:
        return json.loads(r.get('corpo') or b'')
    except Exception:  # noqa: BLE001
        return None


def resumo_http(r: dict) -> str:
    if r.get('status') is None:
        return f"FALHOU ({r.get('erro')}) em {r.get('segundos')} s"
    partes = [f"HTTP {r['status']}", f"{r.get('segundos')} s", mb(r.get('bytes'))]
    if r.get('tipo'):
        partes.append(str(r['tipo']).split(';')[0])
    if r.get('final') and r['final'] != r['url']:
        partes.append(f"-> {r['final']}")
    return ', '.join(partes)


# ----------------------------------------------------------------------------------------------- FTP

LIST_DOS = re.compile(r'^(\d\d-\d\d-\d\d)\s+(\d\d:\d\d\s*[AP]M)\s+(<DIR>|\d+)\s+(.+)$', re.I)
LIST_UNIX = re.compile(r'^([\-dl])\S{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w{3}\s+\d+\s+[\d:]+)\s+(.+)$')


def ftp_abrir(timeout: float = 60) -> ftplib.FTP:
    f = ftplib.FTP(timeout=timeout)
    f.connect(FTP_HOST, 21)
    f.login()  # anônimo
    f.set_pasv(True)
    return f


def ftp_listar(f: ftplib.FTP, caminho: str) -> tuple[list[dict], list[str]]:
    """LIST de uma pasta: [{'nome','dir','tamanho','data'}] e as 3 primeiras linhas cruas (para conferir o formato)."""
    f.cwd(caminho)
    linhas: list[str] = []
    f.retrlines('LIST', linhas.append)
    itens = []
    for l in linhas:
        m = LIST_DOS.match(l.strip())
        if m:
            d = m[3].upper() == '<DIR>'
            itens.append({'nome': m[4].strip(), 'dir': d, 'tamanho': None if d else int(m[3]), 'data': f'{m[1]} {m[2]}'})
            continue
        m = LIST_UNIX.match(l.strip())
        if m:
            itens.append({'nome': m[4].strip(), 'dir': m[1] == 'd', 'tamanho': int(m[2]), 'data': m[3]})
            continue
        if l.strip():
            itens.append({'nome': l.strip().split()[-1], 'dir': None, 'tamanho': None, 'data': None, 'cru': l})
    return itens, linhas[:3]


def ftp_baixar(f: ftplib.FTP, caminho: str, destino: Path, limite_s: float | None = None) -> dict:
    ini = time.monotonic()
    n = 0
    sha = hashlib.sha256()
    ultimo = [ini]
    destino.parent.mkdir(parents=True, exist_ok=True)
    with open(destino, 'wb') as out:
        def cb(b: bytes) -> None:
            nonlocal n
            out.write(b)
            sha.update(b)
            n += len(b)
            agora = time.monotonic()
            if agora - ultimo[0] > 20:
                print(f'  ... {mb(n)} em {agora - ini:.0f} s', flush=True)
                ultimo[0] = agora
            if limite_s and agora - ini > limite_s:
                raise TimeoutError(f'passou do limite de {limite_s:.0f} s com {mb(n)}')
        f.retrbinary(f'RETR {caminho}', cb, blocksize=1 << 16)
    return {'bytes': n, 'segundos': round(time.monotonic() - ini, 2), 'sha256': sha.hexdigest()}


def tcp(host: str, porta: int, timeout: float = 10) -> str:
    ini = time.monotonic()
    try:
        with socket.create_connection((host, porta), timeout=timeout):
            return f'ok {1000 * (time.monotonic() - ini):.0f} ms'
    except Exception as e:  # noqa: BLE001
        return f'falhou ({type(e).__name__}: {e})'[:90]


def erro_curto(e: BaseException) -> str:
    return f'{type(e).__name__}: {e}'[:400]


def salvar_json(caminho: Path, dados) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding='utf-8')


def ler_json(caminho: Path, padrao=None):
    try:
        return json.loads(caminho.read_text(encoding='utf-8'))
    except Exception:  # noqa: BLE001
        return padrao
