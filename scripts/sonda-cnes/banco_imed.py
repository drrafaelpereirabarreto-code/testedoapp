"""Confere os estabelecimentos com aparelho (de uma fonte da sonda) com o que o site do IMED mostra hoje.

  python3 -I banco_imed.py base|eq

Só LÊ, pela mesma API pública que o site usa (a chave pública de assets/js/config.js, que qualquer visitante
recebe; o banco só mostra o que as regras de acesso deixam): estabelecimentos de Campinas e de São Paulo,
com o tipo e os exames que o site deduziu pelo nome. Não grava nada.
"""

from __future__ import annotations

import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comum import CAMPINAS, DADOS, SAO_PAULO, anotar, http, json_de, ler_json, resumo_http, tabela  # noqa: E402
from exames import NOMES  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


def config_site() -> tuple[str | None, str | None]:
    js = (REPO / 'assets' / 'js' / 'config.js').read_text(encoding='utf-8')
    url = re.search(r"supabaseUrl:\s*'([^']+)'", js)
    chave = re.search(r"supabase(?:Publishable|Anon)Key:\s*'([^']+)'", js)
    return (url.group(1) if url else None), (chave.group(1) if chave else None)


def do_banco(url: str, chave: str, ibge: int) -> tuple[dict, str]:
    out, pagina, notas = {}, 0, []
    while pagina < 20:
        q = urllib.parse.urlencode({'select': 'cnes,name,kind,cnes_type,services', 'city_ibge': f'eq.{ibge}',
                                    'order': 'cnes', 'limit': 1000, 'offset': pagina * 1000})
        r = http(f'{url}/rest/v1/establishments?{q}', cab={'apikey': chave, 'Authorization': f'Bearer {chave}',
                                                          'Accept': 'application/json'}, timeout=60)
        j = json_de(r)
        if not isinstance(j, list):
            notas.append(f'página {pagina}: {resumo_http(r)}')
            break
        for x in j:
            out[str(x.get('cnes'))] = x
        if len(j) < 1000:
            break
        pagina += 1
    return out, '; '.join(notas)


def main() -> None:
    fonte = sys.argv[1]
    res = ler_json(DADOS / f'{fonte}-resumo.json')
    titulo = 'Base completa' if fonte == 'base' else 'FTP EQ'
    cod = 'B18' if fonte == 'base' else 'F10'
    if not res:
        anotar('warning', f'{cod} {titulo} x banco do IMED: sem resumo da fonte', 'A análise da fonte não terminou.')
        return
    url, chave = config_site()
    if not (url and chave):
        anotar('warning', f'{cod} {titulo} x banco do IMED: sem endereço/chave pública em config.js', '')
        return
    blocos = []
    for ibge in (CAMPINAS, SAO_PAULO):
        banco, nota = do_banco(url, chave, ibge)
        nome = 'Campinas' if ibge == CAMPINAS else 'São Paulo'
        linhas = []
        exemplos = []
        for e, por_cidade in res.get('exames', {}).items():
            eq = set(por_cidade.get(str(ibge), []))
            marcados = {c for c, x in banco.items() if e in (x.get('services') or [])}
            no_banco = eq & set(banco)
            linhas.append([e, len(eq), len(no_banco), len(eq & marcados), len(marcados), len(marcados - eq)])
            if e == 'rm':
                novos = sorted(no_banco - marcados, key=lambda c: -res.get('em_uso', {}).get(e, {}).get(c, 0))
                for c in novos[:8]:
                    x = banco[c]
                    exemplos.append(f"  ganharia: {c} {x.get('name')} ({x.get('kind')}, tipo {x.get('cnes_type')}), "
                                    f"{res.get('em_uso', {}).get(e, {}).get(c, '?')} em uso")
                for c in sorted(marcados - eq)[:8]:
                    x = banco[c]
                    exemplos.append(f"  marcado só pelo nome, sem ressonância no CNES: {c} {x.get('name')} ({x.get('kind')})")
        blocos.append(f'{nome} ({ibge}): {len(banco)} estabelecimentos visíveis no banco do IMED {nota}\n'
                      + tabela(linhas, ['exame', f'com aparelho em uso ({titulo})', 'estão no banco do IMED',
                                        'o site já marca o exame', 'o site marca hoje', 'marcados sem aparelho'])
                      + '\nRessonância:\n' + ('\n'.join(exemplos) or '  (nada)'))
    anotar('notice', f"{cod} {titulo} ({res.get('mes')}) x banco do IMED (só leitura, chave pública do site)",
           '\n'.join(blocos) + '\nExames: ' + ', '.join(f'{k} = {v}' for k, v in NOMES.items()))


if __name__ == '__main__':
    main()
