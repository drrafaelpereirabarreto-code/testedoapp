"""Sonda Z: lê a base completa do CNES (BASE_DE_DADOS_CNES_AAAAMM.ZIP) SEM baixar o arquivo inteiro.

O ZIP tem o índice no fim. Um "arquivo remoto" pede só os pedaços que o zipfile do Python precisar (HTTP Range ou
FTP REST): o índice, as tabelas de equipamentos (pequenas) e a tabela estabelecimento x equipamento. Mostra
quantos bytes precisou baixar, as colunas e as contas de Campinas e São Paulo (o tipo de unidade e o nome ficam de
fora: a tabela de estabelecimentos é grande e não é lida aqui).

  python3 -I base_parcial.py      (depois de base.py descobrir, que deixa base-escolha.json)
"""

from __future__ import annotations

import io
import sys
import time
import traceback
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comum import (CAMPINAS, DADOS, SAO_PAULO, anotar, erro_curto, ftp_abrir, http, ler_json, mb,  # noqa: E402
                   salvar_json, tabela)
import base  # noqa: E402
from exames import Analise  # noqa: E402


class Remoto(io.RawIOBase):
    """Arquivo só de leitura cujos bytes vêm de uma função faixa(início, fim) -> bytes, em blocos guardados."""

    def __init__(self, faixa, tamanho: int, bloco: int):
        self.faixa, self.tamanho, self.bloco = faixa, tamanho, bloco
        self.pos, self.cache, self.pedidos, self.baixado = 0, {}, 0, 0

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def seek(self, off: int, whence: int = 0) -> int:
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.tamanho + off)
        return self.pos

    def tell(self) -> int:
        return self.pos

    def readinto(self, b) -> int:
        n = min(len(b), max(0, self.tamanho - self.pos))
        out = bytearray()
        while len(out) < n:
            i = (self.pos + len(out)) // self.bloco
            if i not in self.cache:
                if len(self.cache) > 16:
                    self.cache.clear()
                ini = i * self.bloco
                dados = self.faixa(ini, min(ini + self.bloco, self.tamanho) - 1)
                self.pedidos += 1
                self.baixado += len(dados)
                self.cache[i] = dados
            blk = self.cache[i]
            off = self.pos + len(out) - i * self.bloco
            pedaco = blk[off: off + (n - len(out))]
            if not pedaco:
                break
            out += pedaco
        b[:len(out)] = out
        self.pos += len(out)
        return len(out)


def faixa_http(url: str):
    def f(ini: int, fim: int) -> bytes:
        for _ in range(3):
            r = http(url, cab={'Range': f'bytes={ini}-{fim}'}, timeout=120, max_corpo=fim - ini + 2)
            if r.get('status') == 206:
                return r['corpo']
        raise OSError(f'faixa {ini}-{fim}: {r.get("status")} {r.get("erro")}')
    return f


def faixa_ftp(caminho: str):
    def f(ini: int, fim: int) -> bytes:
        ftp = ftp_abrir(timeout=120)
        try:
            ftp.voidcmd('TYPE I')
            conn = ftp.transfercmd(f'RETR {caminho}', rest=ini)
            falta = fim - ini + 1
            buf = bytearray()
            while len(buf) < falta:
                pedaco = conn.recv(min(1 << 16, falta - len(buf)))
                if not pedaco:
                    break
                buf += pedaco
            conn.close()
        finally:
            try:
                ftp.close()
            except Exception:  # noqa: BLE001
                pass
        return bytes(buf)
    return f


def main() -> None:
    esc = ler_json(base.ESCOLHA, {}) or {}
    rotas = esc.get('rotas') or []
    if not rotas:
        anotar('error', 'Z01 Base completa (leitura parcial): nenhuma rota', 'base.py descobrir não achou o arquivo.')
        return
    linhas = []
    for rota in rotas:
        tam = rota.get('tamanho')
        if not tam and rota['tipo'] == 'ftp':
            try:
                f = ftp_abrir()
                f.voidcmd('TYPE I')
                tam = f.size(rota['caminho'])
                f.close()
            except Exception as e:  # noqa: BLE001
                linhas.append(f'tamanho por FTP falhou: {erro_curto(e)}')
        if not tam:
            continue
        faixa = faixa_http(rota['url']) if rota['tipo'] == 'https' else faixa_ftp(rota['caminho'])
        bloco = (2 if rota['tipo'] == 'https' else 8) << 20
        rem = Remoto(faixa, int(tam), bloco)
        ini = time.monotonic()
        try:
            z = zipfile.ZipFile(io.BufferedReader(rem, buffer_size=1 << 20))
            membros = sorted(z.infolist(), key=lambda i: -i.file_size)
            linhas.append(f"{rota['tipo']} {rota.get('url') or rota.get('caminho')}: ZIP de {mb(tam)}, {len(membros)} arquivos; "
                          f'índice lido com {rem.pedidos} pedido(s), {mb(rem.baixado)} em {time.monotonic() - ini:.1f} s')
            anotar('notice', f"Z01 Base completa {esc.get('mes')} (leitura parcial): arquivos do ZIP",
                   '\n'.join(linhas) + '\n' + tabela([[Path(i.filename).name, mb(i.compress_size), mb(i.file_size)] for i in membros],
                                                    ['arquivo', 'compactado', 'aberto']))
            estado: dict = {'mes': esc.get('mes')}
            base.secao_tabela_equip(z, estado)
            antes = (rem.pedidos, rem.baixado, time.monotonic())
            base.secao_rl_equip(z, estado)
            anotar('notice', 'Z02 Base completa (leitura parcial): o que precisou baixar',
                   f'Tabelas de equipamentos + estabelecimento x equipamento: {rem.pedidos - antes[0]} pedido(s), '
                   f'{mb(rem.baixado - antes[1])} em {time.monotonic() - antes[2]:.1f} s; total da leitura parcial: '
                   f'{rem.pedidos} pedido(s), {mb(rem.baixado)} de {mb(tam)} em {time.monotonic() - ini:.1f} s')
            aparelhos = [{**a, 'cnes': a['unidade'][-7:], 'mun': a['unidade'][:6]} for a in estado.get('aparelhos', [])]
            an = Analise(estado.get('mapa') or {}, aparelhos, {})
            for ibge, cod in ((CAMPINAS, 'Z03'), (SAO_PAULO, 'Z04')):
                nome = 'Campinas' if ibge == CAMPINAS else 'São Paulo'
                anotar('notice', f'{cod} Base completa (leitura parcial): {nome} ({ibge})',
                       an.quadro_cidade(ibge, com_nome=False) + '\n' + an.exemplos('rm', ibge, 12)
                       + '\n(sem a tabela de estabelecimentos: sem tipo de unidade e sem nome)')
            salvar_json(DADOS / 'base-resumo.json', an.resumo('Base completa (leitura parcial)', esc.get('mes')))
            return
        except Exception as e:  # noqa: BLE001
            linhas.append(f"{rota['tipo']}: falhou ({erro_curto(e)}) depois de {rem.pedidos} pedido(s), {mb(rem.baixado)}")
            print(traceback.format_exc(), flush=True)
    anotar('error', 'Z01 Base completa (leitura parcial): não deu', '\n'.join(linhas) or 'sem tamanho do arquivo')


if __name__ == '__main__':
    main()
