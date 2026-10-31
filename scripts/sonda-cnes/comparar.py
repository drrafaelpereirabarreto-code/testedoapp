"""Sonda C: as duas fontes oficiais (FTP EQ por UF e base completa) dão os mesmos estabelecimentos com ressonância?

  RM_FTP='<json>' RM_ZIP='<json>' python3 -I comparar.py      (as listas vêm das saídas dos jobs F e Z)
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comum import CAMPINAS, SAO_PAULO, anotar  # noqa: E402


def ler(nome: str) -> dict:
    try:
        return json.loads(os.environ.get(nome) or '{}')
    except Exception:  # noqa: BLE001
        return {}


def main() -> None:
    a, b = ler('RM_FTP'), ler('RM_ZIP')
    if not (a.get('rm') and b.get('rm')):
        anotar('warning', 'C01 Comparação FTP EQ x base completa: falta uma das listas',
               f"FTP EQ: {'ok' if a.get('rm') else 'sem lista'}; base completa: {'ok' if b.get('rm') else 'sem lista'}")
        return
    linhas = [f"FTP EQ competência {a.get('mes')}; base completa {b.get('mes')}"]
    for ibge in (CAMPINAS, SAO_PAULO):
        x, y = set(a['rm'].get(str(ibge), [])), set(b['rm'].get(str(ibge), []))
        ux, uy = a.get('uso', {}), b.get('uso', {})
        nome = 'Campinas' if ibge == CAMPINAS else 'São Paulo'
        linhas.append(f'{nome}: FTP EQ {len(x)} estabelecimentos ({sum(ux.get(c, 0) for c in x)} aparelhos em uso); '
                      f'base completa {len(y)} ({sum(uy.get(c, 0) for c in y)}); nos dois {len(x & y)}; '
                      f'diferença de quantidade em uso nos comuns: {sum(1 for c in x & y if ux.get(c) != uy.get(c))}')
        if x - y:
            linhas.append('  só no FTP EQ: ' + ', '.join(f'{c} ({ux.get(c)})' for c in sorted(x - y)[:15]))
        if y - x:
            linhas.append('  só na base completa: ' + ', '.join(f'{c} ({uy.get(c)})' for c in sorted(y - x)[:15]))
    anotar('notice', 'C01 Comparação: ressonância em uso, FTP EQ x base completa', '\n'.join(linhas))


if __name__ == '__main__':
    main()
