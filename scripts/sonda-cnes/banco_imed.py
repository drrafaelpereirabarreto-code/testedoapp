"""Confere os estabelecimentos com aparelho (de uma fonte da sonda) com o que o site do IMED mostra hoje.

  python3 -I banco_imed.py base|eq|api

Só LÊ, pela mesma API pública que o site usa (a chave pública de assets/js/config.js, que qualquer visitante
recebe; o banco só mostra o que as regras de acesso deixam): estabelecimentos de Campinas e de São Paulo,
com o tipo e os exames que o site deduziu pelo nome. Não grava nada.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comum import CAMPINAS, DADOS, PONTOS, SAO_PAULO, anotar, http, json_de, ler_json, resumo_http, tabela  # noqa: E402
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


def rpc(url: str, chave: str, funcao: str, args: dict) -> tuple[list, str]:
    r = http(f'{url}/rest/v1/rpc/{funcao}', metodo='POST', corpo=json.dumps(args).encode(),
             cab={'apikey': chave, 'Authorization': f'Bearer {chave}', 'Content-Type': 'application/json',
                  'Accept': 'application/json'}, timeout=60)
    j = json_de(r)
    return (j if isinstance(j, list) else []), resumo_http(r)


def perto(url: str, chave: str, res: dict, exame: str = 'rm', raio_m: int = 5000) -> str:
    """O mesmo raio de 5 km que o site usa: o que o site acha hoje x o que teria com o aparelho do CNES."""
    blocos = []
    for nome, (lat, lon, ibge) in PONTOS.items():
        base_args = {'p_lat': lat, 'p_lng': lon, 'p_radius_m': raio_m, 'p_limit': 5000}
        todos, nota = rpc(url, chave, 'establishment_points', base_args)
        hoje, _ = rpc(url, chave, 'establishment_points', {**base_args, 'p_exam': exame})
        eq = set(res.get('exames', {}).get(exame, {}).get(str(ibge), []))
        no_raio = {str(x.get('cnes')): x for x in todos}
        com = sorted((no_raio[c] for c in eq & set(no_raio)), key=lambda x: x.get('distance_m') or 0)
        uso = res.get('em_uso', {}).get(exame, {})
        blocos.append(f"{nome}, até {raio_m // 1000} km: {len(no_raio)} estabelecimentos do CNES no banco do IMED ({nota}); "
                      f"o site acha HOJE com o exame: {len(hoje)} ({'; '.join(str(x.get('name')) for x in hoje[:5])}); "
                      f"com o aparelho em uso no CNES: {len(com)}\n"
                      + '\n'.join(f"  {x.get('distance_m')} m  {x.get('cnes')}  {x.get('name')} ({x.get('kind')}), {uso.get(str(x.get('cnes')), '?')} em uso"
                                   for x in com[:10]))
    return '\n'.join(blocos)


def main() -> None:
    fonte = sys.argv[1]
    res = ler_json(DADOS / f'{fonte}-resumo.json')
    titulo, cod = {'base': ('Base completa', 'B18'), 'eq': ('FTP EQ', 'F10'), 'api': ('API dados abertos', 'A12')}[fonte]
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
    if res.get('exames', {}).get('rm'):
        anotar('notice', f"{cod}b {titulo}: ressonância até 5 km, como na busca do site (só leitura)", perto(url, chave, res))


if __name__ == '__main__':
    main()
