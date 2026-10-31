"""Sonda A: a API de dados abertos do Ministério da Saúde (apidadosabertos.saude.gov.br) traz equipamentos?

1. Acha a documentação (Swagger/OpenAPI) e lista todas as rotas; procura "equip" no documento inteiro.
2. Busca estabelecimentos reais de Campinas e abre a ficha de 3 deles: lista os campos (só os nomes).
3. Tenta rotas prováveis de equipamentos e mostra o que cada uma responde.
"""

import json
import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comum import CAMPINAS, DADOS, anotar, http, json_de, mun6, resumo_http, salvar_json, tabela, uma_linha  # noqa: E402

BASE = 'https://apidadosabertos.saude.gov.br'
CANDIDATAS = ['/', '/v1', '/v1/', '/docs', '/docs/', '/swagger', '/swagger/', '/swagger-ui', '/swagger-ui/',
              '/swagger-ui.html', '/swagger.json', '/openapi.json', '/v1/swagger.json', '/v1/openapi.json',
              '/v1/swagger-ui-init.js', '/swagger-ui-init.js', '/docs/swagger-ui-init.js', '/api-docs',
              '/api-docs.json', '/v2/api-docs', '/v3/api-docs', '/docs-json', '/v1/docs-json', '/api', '/redoc']
JS_URL = [re.compile(p, re.I) for p in (
    r'''url\s*:\s*["']([^"']+)["']''',
    r'''["']([^"'\s]*(?:swagger|openapi|api-docs)[^"'\s]*\.json)["']''',
    r'''src=["']([^"']*swagger-ui-init\.js)["']''',
    r'''spec-url=["']([^"']+)["']''',
    r'''["']([^"'\s]*/v\d+/api-docs[^"'\s]*)["']''',
)]


def acha_especificacao():
    vistos, fila, tentativas, espec = set(), [BASE + c for c in CANDIDATAS], [], None
    while fila and len(vistos) < 45:
        url = fila.pop(0)
        if url in vistos:
            continue
        vistos.add(url)
        r = http(url, timeout=30, max_corpo=15_000_000)
        corpo = r.get('corpo') or b''
        texto = corpo.decode('utf-8', 'replace')
        achou = ''
        j = json_de(r)
        if isinstance(j, dict) and ('paths' in j or 'swagger' in j or 'openapi' in j):
            espec, achou = (espec or (url, j)), 'ESPECIFICAÇÃO'
        elif 'swaggerDoc' in texto:
            i = texto.find('{', texto.find('swaggerDoc'))
            try:
                obj, _ = json.JSONDecoder().raw_decode(texto, i)
                if isinstance(obj, dict) and 'paths' in obj:
                    espec, achou = (espec or (url, obj)), 'ESPECIFICAÇÃO (swaggerDoc)'
            except Exception:  # noqa: BLE001
                pass
        if r.get('status') == 200 and not achou and texto:
            for rx in JS_URL:
                for m in rx.findall(texto):
                    if m.startswith(('data:', 'javascript:')) or m in ('/', '#'):
                        continue
                    nova = urllib.parse.urljoin(r.get('final') or url, m)
                    if nova.startswith(BASE) and nova not in vistos:
                        fila.append(nova)
        tentativas.append([url.replace(BASE, '') or '/', resumo_http(r), achou or uma_linha(corpo, 70)])
    return espec, tentativas


def rotas(espec: dict) -> list[list]:
    out = []
    for caminho, ops in sorted((espec.get('paths') or {}).items()):
        for metodo, op in (ops or {}).items():
            if not isinstance(op, dict):
                continue
            params = [p.get('name') for p in op.get('parameters', []) if isinstance(p, dict) and p.get('name')]
            out.append([metodo.upper(), caminho, ','.join(params)[:400]])
    return out


def contexto_equip(espec: dict) -> list[str]:
    texto = json.dumps(espec, ensure_ascii=False)
    achados = []
    for m in re.finditer(r'equip', texto, re.I):
        achados.append(uma_linha(texto[max(0, m.start() - 70): m.end() + 70], 160))
    return achados


def main() -> None:
    espec, tentativas = acha_especificacao()
    anotar('notice', 'A01 API: onde está a documentação (Swagger/OpenAPI)',
           tabela(tentativas, ['caminho', 'resposta', 'achado / começo']))
    resumo = {'documentacao': None, 'rotas_cnes': [], 'equip_no_documento': None}
    if espec:
        url, doc = espec
        todas = rotas(doc)
        cnes = [r for r in todas if '/cnes' in r[1].lower()]
        resumo.update({'documentacao': url, 'rotas_cnes': cnes})
        info = doc.get('info') or {}
        anotar('notice', f'A02 API: {len(todas)} rotas no documento ({len(cnes)} do CNES)',
               f"Documento: {url} (título: {info.get('title')}, versão: {info.get('version')})\n"
               'Rotas do CNES (método, caminho, parâmetros):\n' + tabela(cnes) +
               '\nOutros grupos: ' + ', '.join(sorted({r[1].strip('/').split('/')[0] for r in todas})))
        eq = contexto_equip(doc)
        resumo['equip_no_documento'] = len(eq)
        anotar('notice' if not eq else 'warning', f'A03 API: "equip" aparece {len(eq)} vez(es) no documento',
               '\n'.join(eq[:25]) if eq else 'Nenhuma rota, parâmetro, campo ou descrição fala de equipamento.')
    else:
        anotar('warning', 'A02 API: documentação não encontrada', 'Nenhuma das URLs devolveu Swagger/OpenAPI.')

    # Estabelecimentos reais de Campinas: lista (como o importador do IMED faz) e a ficha de 3 deles.
    amostra = []
    linhas = []
    for tipo in (39, 5):
        url = f'{BASE}/cnes/estabelecimentos?codigo_municipio={mun6(CAMPINAS)}&codigo_tipo_unidade={tipo}&limit=20&offset=0'
        r = http(url, timeout=60)
        j = json_de(r) or {}
        lista = j.get('estabelecimentos') or []
        linhas.append(f'lista tipo {tipo}: {resumo_http(r)}; {len(lista)} estabelecimentos')
        amostra += [e for e in lista if isinstance(e, dict)][:2]
    chaves_lista = sorted({k for e in amostra for k in e})
    fichas = []
    for e in amostra[:3]:
        cod = str(e.get('codigo_cnes', '')).zfill(7)
        r = http(f'{BASE}/cnes/estabelecimentos/{cod}', timeout=60)
        j = json_de(r)
        fichas.append((cod, e, r, j))
        linhas.append(f'ficha {cod} (tipo {e.get("codigo_tipo_unidade")}): {resumo_http(r)}')
    chaves_ficha = sorted({k for _, _, _, j in fichas if isinstance(j, dict) for k in j})
    texto_fichas = json.dumps([j for *_, j in fichas], ensure_ascii=False).lower()
    possui = sorted({k for k in chaves_ficha + chaves_lista if 'possui' in k or 'equip' in k or 'servi' in k})
    valores = []
    for cod, _, _, j in fichas:
        if isinstance(j, dict):
            valores.append(f"{cod}: " + ', '.join(f'{k}={j.get(k)}' for k in possui if isinstance(j.get(k), (int, float, str, bool)) or j.get(k) is None)[:600])
    anotar('notice', 'A04 API: estabelecimentos reais de Campinas (lista e ficha)',
           '\n'.join(linhas) +
           f'\nCampos da lista ({len(chaves_lista)}): ' + ', '.join(chaves_lista) +
           f'\nCampos da ficha ({len(chaves_ficha)}): ' + ', '.join(chaves_ficha) +
           f"\n'equip' na ficha: {'SIM' if 'equip' in texto_fichas else 'não'}; 'resson' na ficha: {'SIM' if 'resson' in texto_fichas else 'não'}"
           '\nCampos "possui/serviço/equip" e valores:\n' + '\n'.join(valores))

    # Rotas prováveis de equipamentos (nenhuma está documentada, até onde se sabe).
    cod = str((amostra[0] if amostra else {}).get('codigo_cnes', '2079798')).zfill(7)
    palpites = ['/cnes/equipamentos', '/cnes/equipamento', '/cnes/tipoequipamento', '/cnes/tipoequipamentos',
                '/cnes/tiposequipamentos', f'/cnes/estabelecimentos/{cod}/equipamentos', f'/cnes/equipamentos/{cod}',
                f'/cnes/estabelecimentos-equipamentos/{cod}', f'/cnes/equipamentos?codigo_cnes={cod}',
                '/cnes/servicos', '/cnes/servicosespecializados', '/cnes/leitos', '/cnes/tipounidades',
                f'/cnes/estabelecimentos?codigo_municipio={mun6(CAMPINAS)}&codigo_equipamento=12&limit=5']
    out = []
    for p in palpites:
        r = http(BASE + p, timeout=40, max_corpo=400_000)
        out.append([p, resumo_http(r), uma_linha(r.get('corpo'), 90)])
    anotar('notice', 'A05 API: rotas prováveis de equipamentos', tabela(out, ['rota', 'resposta', 'começo']))
    resumo['palpites'] = out
    salvar_json(DADOS / 'api-doc.json', resumo)


if __name__ == '__main__':
    main()
