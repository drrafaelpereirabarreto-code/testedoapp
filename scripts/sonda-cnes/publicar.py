"""Mostra os avisos guardados pelos scripts da sonda como anotações do GitHub, 9 por passo.

  python3 -I publicar.py <lote> [--ultimo]

O lote 0 mostra os avisos 1 a 9, o lote 1 os 10 a 18 e assim por diante. No último lote, se sobrar aviso,
o último lugar vira um aviso dizendo quantos ficaram de fora.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comum import ANOT, esc_dado, esc_prop  # noqa: E402

POR_LOTE = 9


def main() -> None:
    lote = int(sys.argv[1])
    ultimo = '--ultimo' in sys.argv
    arqs = sorted(ANOT.glob('*.json')) if ANOT.exists() else []
    ini, fim = lote * POR_LOTE, (lote + 1) * POR_LOTE
    fatia = arqs[ini:fim]
    sobra = len(arqs) - fim if ultimo else 0
    if sobra > 0:
        fatia = fatia[:-1]
        sobra += 1
    for a in fatia:
        try:
            d = json.loads(a.read_text(encoding='utf-8'))
        except Exception as e:  # noqa: BLE001
            d = {'nivel': 'warning', 'titulo': 'Aviso ilegível', 'texto': f'{a.name}: {e}'}
        nivel = d.get('nivel') if d.get('nivel') in ('notice', 'warning', 'error') else 'notice'
        print(f"::{nivel} title={esc_prop(d.get('titulo') or 'Sonda')}::{esc_dado(d.get('texto') or '')}")
    if sobra > 0:
        print(f'::warning title=Avisos de fora::{sobra} aviso(s) não couberam nos passos Publicar deste job.')
    print(f'lote {lote}: {len(fatia)} aviso(s) de {len(arqs)}', file=sys.stderr)


if __name__ == '__main__':
    main()
