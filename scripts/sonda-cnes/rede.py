"""Sonda R: de onde a máquina do GitHub sai e quais servidores do governo ela alcança (DNS, TCP e HTTP)."""

import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comum import anotar, http, json_de, resumo_http, tcp, uma_linha  # noqa: E402

HOSTS = [
    ('apidadosabertos.saude.gov.br', [443], 'https://apidadosabertos.saude.gov.br/'),
    ('cnes.datasus.gov.br', [443, 80], 'https://cnes.datasus.gov.br/'),
    ('ftp.datasus.gov.br', [21, 80, 443], 'http://ftp.datasus.gov.br/'),
    ('datasus.saude.gov.br', [443], 'https://datasus.saude.gov.br/'),
    ('tabnet.datasus.gov.br', [80, 443], 'http://tabnet.datasus.gov.br/'),
    ('opendatasus.saude.gov.br', [443], 'https://opendatasus.saude.gov.br/'),
    ('dadosabertos.saude.gov.br', [443], 'https://dadosabertos.saude.gov.br/'),
    ('dados.gov.br', [443], 'https://dados.gov.br/'),
    ('s3.sa-east-1.amazonaws.com', [443], None),
]


def main() -> None:
    linhas = []
    info = http('https://ipinfo.io/json', timeout=20)
    j = json_de(info) or {}
    origem = f"país {j.get('country', '?')}, região {j.get('region', '?')}, rede {j.get('org', '?')}" if j else resumo_http(info)
    for host, portas, url in HOSTS:
        try:
            ips = sorted({a[4][0] for a in socket.getaddrinfo(host, None, socket.AF_INET)})
            dns = ','.join(ips[:2]) + (f' (+{len(ips) - 2})' if len(ips) > 2 else '')
        except Exception as e:  # noqa: BLE001
            dns = f'DNS falhou ({type(e).__name__})'
        tcps = '; '.join(f'{p}: {tcp(host, p)}' for p in portas)
        web = ''
        if url:
            r = http(url, timeout=25, max_corpo=300_000)
            web = f" | GET / -> {resumo_http(r)}; servidor {r['cab'].get('server', '?')}"
        linhas.append(f'{host}: {dns} | {tcps}{web}')
    anotar('notice', 'R01 Rede: de onde o GitHub sai e o que alcança',
           f'Máquina do GitHub: {origem}.\n' + '\n'.join(linhas))
    # O FTP às vezes responde só a quem está no Brasil: a saudação do servidor (porta 21) ajuda a ver isso.
    try:
        with socket.create_connection(('ftp.datasus.gov.br', 21), timeout=20) as s:
            s.settimeout(20)
            ola = s.recv(400)
        anotar('notice', 'R02 Saudação do FTP do DATASUS (porta 21)', uma_linha(ola, 300) or '(vazia)')
    except Exception as e:  # noqa: BLE001
        anotar('warning', 'R02 FTP do DATASUS não respondeu na porta 21', f'{type(e).__name__}: {e}')


if __name__ == '__main__':
    main()
