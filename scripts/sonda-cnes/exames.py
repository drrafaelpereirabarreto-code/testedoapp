"""Exames da busca do site (assets/js/data.js) x aparelhos do CNES, e as contas por cidade.

Os códigos dos aparelhos NÃO são supostos: cada fonte traz a sua tabela oficial (descrição) e a regra abaixo
escolhe os códigos pela descrição. CODIGOS_PADRAO só entra se a fonte não trouxer a tabela (e o aviso diz isso).
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from comum import (CAMPINAS, PONTOS, SAO_PAULO, TIPOS_HOSPITAL, TIPOS_IMED, distancia_km, mun6, tabela)

EXAMES = ['rm', 'tc', 'mamo', 'rx', 'dens', 'usg', 'ecg', 'eco']
NOMES = {'rm': 'Ressonância', 'tc': 'Tomografia', 'mamo': 'Mamografia', 'rx': 'Raio-X', 'dens': 'Densitometria',
         'usg': 'Ultrassom', 'ecg': 'Eletro (ECG)', 'eco': 'Ecocardiograma'}
# Regra pela descrição oficial do aparelho (sem acento, maiúsculas) e pelo tipo de equipamento do CNES
# (1 = diagnóstico por imagem, 4 = métodos gráficos): (inclui, exclui, tipos aceitos ou None = qualquer tipo).
REGRA = {
    'rm': (r'RESSON', None, {'1'}),
    'tc': (r'TOMOGRAF', r'COERENCIA|OPTIC', {'1'}),
    'mamo': (r'MAMOGRAF', r'PROCESSADORA', {'1'}),
    'rx': (r'RAIO.?X', r'ODONTO|DENT|PANORAM|INTRAORAL|DENSITOM|HEMODIN|MAMOGRAF|MOVEL|ARCO', {'1'}),
    'dens': (r'DENSITOM', None, {'1'}),
    'usg': (r'ULTRA.?SS?OM|ECOGRAF|ULTRASSONOGRAF', r'OFTALM|TERAP', {'1'}),
    'ecg': (r'ELETROCARDIOGRAF', None, {'4'}),
    'eco': (r'ECOCARDIOGRAF', None, None),
}
# Tabela de equipamentos do CNES como costuma ser (tipo 1 = diagnóstico por imagem, 4 = métodos gráficos).
CODIGOS_PADRAO = {'rm': [('1', '12')], 'tc': [('1', '11')], 'mamo': [('1', '02'), ('1', '03'), ('1', '17')],
                  'rx': [('1', '04'), ('1', '05'), ('1', '06')], 'dens': [('1', '09')],
                  'usg': [('1', '13'), ('1', '14'), ('1', '15')], 'ecg': [('4', '41')], 'eco': []}
# Regras que o site usa HOJE para deduzir o exame pelo nome (supabase/functions/importar-clinicas/lib.ts).
REGRA_NOME = {
    'rm': r'resson[aâ]ncia|\brmn?\b|magn[eé]tica', 'tc': r'tomogra|\btc\b',
    'usg': r'ultra-?s(?:som|onografia)|ultrass|ecografia|\busg\b|doppler', 'mamo': r'mamogra',
    'dens': r'densitometr', 'rx': r'raio[\s-]?x|radiograf|\brx\b', 'eco': r'ecocardio', 'ecg': r'eletrocardio|\becg\b',
}


def sem_acento(s: str) -> str:
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', str(s)) if unicodedata.category(c) != 'Mn').upper()


def codigos_por_exame(descricoes: dict[tuple[str, str], str]) -> tuple[dict, str]:
    """descricoes: {(tipo, código): descrição oficial}. Devolve {exame: [(tipo, código, descrição)]} e a origem."""
    if not descricoes:
        return ({e: [(t, c, '(sem descrição nesta fonte)') for t, c in CODIGOS_PADRAO[e]] for e in EXAMES},
                'PADRÃO (a fonte não trouxe a tabela de códigos)')
    out = {}
    for e in EXAMES:
        inc, exc, tipos = REGRA[e]
        out[e] = sorted((t, c, d) for (t, c), d in descricoes.items()
                        if (tipos is None or t in tipos) and re.search(inc, sem_acento(d))
                        and not (exc and re.search(exc, sem_acento(d))))
    return out, 'descrição oficial da própria fonte'


def texto_mapa(mapa: dict, origem: str) -> str:
    linhas = [[e, NOMES[e], '; '.join(f'{t}/{c} {d}' for t, c, d in mapa[e]) or '(nenhum aparelho com esse nome)']
              for e in EXAMES]
    return f'Códigos escolhidos pela {origem}:\n' + tabela(linhas, ['exame', 'nome', 'tipo/código e descrição'])


class Analise:
    """Junta aparelhos (linhas normalizadas) e estabelecimentos e faz as contas da prova."""

    def __init__(self, mapa: dict, aparelhos: list[dict], estab: dict[str, dict]):
        self.mapa = mapa
        self.estab = estab
        self.chave = {}
        for e, lst in mapa.items():
            for t, c, _ in lst:
                self.chave.setdefault((t, c), []).append(e)
        # por estabelecimento: exame -> [existentes, em uso, sus?]
        self.por = defaultdict(lambda: defaultdict(lambda: [0, 0, False]))
        self.mun = {}
        for a in aparelhos:
            for e in self.chave.get((a['tipo'], a['cod']), []):
                v = self.por[a['cnes']][e]
                v[0] += a['qt_exist']
                v[1] += a['qt_uso']
                v[2] = v[2] or bool(a.get('sus'))
            self.mun.setdefault(a['cnes'], a.get('mun'))
        self.re_nome = {e: re.compile(p, re.I) for e, p in REGRA_NOME.items()}

    def info(self, cnes: str) -> dict:
        return self.estab.get(cnes) or {}

    def ativo(self, cnes: str) -> bool:
        return self.info(cnes).get('ativo', True) is not False

    def municipio(self, cnes: str) -> str | None:
        return self.info(cnes).get('mun') or self.mun.get(cnes)

    def tipo(self, cnes: str) -> int | None:
        return self.info(cnes).get('tp')

    def site_acha_hoje(self, cnes: str, exame: str) -> bool:
        i = self.info(cnes)
        tp = i.get('tp')
        if tp not in TIPOS_IMED or tp in TIPOS_HOSPITAL:
            return False
        return bool(self.re_nome[exame].search(i.get('busca') or ''))

    def com(self, exame: str, municipios: set[str] | None, em_uso: bool = True) -> list[str]:
        k = 1 if em_uso else 0
        return sorted(c for c, ex in self.por.items()
                      if ex.get(exame) and ex[exame][k] > 0 and self.ativo(c)
                      and (municipios is None or self.municipio(c) in municipios))

    def quadro_cidade(self, ibge: int, com_nome: bool) -> str:
        m = {mun6(ibge)}
        linhas = []
        for e in EXAMES:
            if not self.mapa.get(e):
                linhas.append([e, '-', '-', '-', '-', '-', '-', '(sem código)'])
                continue
            uso = self.com(e, m)
            exist = self.com(e, m, em_uso=False)
            sus = [c for c in uso if self.por[c][e][2]]
            sabe_tipo = any(self.tipo(c) is not None for c in uso) or not uso
            imed = len([c for c in uso if self.tipo(c) in TIPOS_IMED]) if sabe_tipo else '?'
            hosp = len([c for c in uso if self.tipo(c) in TIPOS_HOSPITAL]) if sabe_tipo else '?'
            aparelhos = sum(self.por[c][e][1] for c in uso)
            hoje = sum(1 for c in uso if self.site_acha_hoje(c, e)) if com_nome else '-'
            linhas.append([e, len(exist), len(uso), aparelhos, len(sus), imed, hosp, hoje])
        return tabela(linhas, ['exame', 'estab c/ aparelho', 'em uso', 'aparelhos em uso', 'em uso+SUS',
                               'tipo que o IMED importa', 'hospitais', 'o site acha hoje pelo nome'])

    def exemplos(self, exame: str, ibge: int, n: int = 10, nomes: dict | None = None) -> str:
        uso = self.com(exame, {mun6(ibge)})
        uso.sort(key=lambda c: (-self.por[c][exame][1], c))
        linhas = []
        for c in uso[:n]:
            i = self.info(c)
            nome = (nomes or {}).get(c) or (i.get('nome') if i.get('pj') else None)
            if not nome:
                nome = '(pessoa física: nome omitido)' if i.get('pj') is False else '(sem nome nesta fonte)'
            ex, us, sus = self.por[c][exame]
            linhas.append([c, nome[:48], i.get('tp', '?'), ex, us, 'sim' if sus else 'não',
                           'sim' if self.site_acha_hoje(c, exame) else 'não'])
        return tabela(linhas, ['CNES', 'estabelecimento', 'tipo', 'existentes', 'em uso', 'SUS', 'site acha hoje'])

    def falsos_pelo_nome(self, exame: str, ibge: int) -> tuple[int, list[str]]:
        """Estabelecimentos que o site marca com o exame pelo nome, mas sem nenhum aparelho do exame no CNES."""
        m = mun6(ibge)
        out = [c for c, i in self.estab.items() if i.get('mun') == m and i.get('ativo', True) is not False
               and self.site_acha_hoje(c, exame) and not (self.por.get(c, {}).get(exame, [0])[0] > 0)]
        return len(out), out[:15]

    def perto(self, exame: str, raio_km: float = 5.0) -> str:
        blocos = []
        for nome, (lat, lon, ibge) in PONTOS.items():
            achados = []
            for c in self.com(exame, None):
                i = self.info(c)
                if i.get('lat') is None or i.get('lon') is None:
                    continue
                d = distancia_km(lat, lon, i['lat'], i['lon'])
                if d <= raio_km:
                    achados.append((d, c))
            achados.sort()
            sem_coord = sum(1 for c in self.com(exame, {mun6(ibge)}) if self.info(c).get('lat') is None)
            linhas = [[f'{d:.1f} km', c, ((self.info(c).get('nome') if self.info(c).get('pj') else None) or '(nome omitido)')[:44],
                       self.info(c).get('tp'), self.por[c][exame][1], 'sim' if self.site_acha_hoje(c, exame) else 'não']
                      for d, c in achados[:10]]
            blocos.append(f'{nome}: {len(achados)} estabelecimento(s) com {NOMES[exame]} em uso até {raio_km:.0f} km '
                          f'(o site acha hoje {sum(1 for _, c in achados if self.site_acha_hoje(c, exame))}; '
                          f'{sem_coord} da cidade sem coordenada no CNES)\n'
                          + tabela(linhas, ['dist', 'CNES', 'estabelecimento', 'tipo', 'em uso', 'site acha hoje']))
        return '\n'.join(blocos)

    def cobertura(self, cidades: list[int], com_nome: bool) -> str:
        m = {mun6(c) for c in cidades}
        linhas = []
        for e in EXAMES:
            if not self.mapa.get(e):
                continue
            uso = self.com(e, m)
            cid = {self.municipio(c) for c in uso}
            imed = [c for c in uso if self.tipo(c) in TIPOS_IMED]
            hoje = sum(1 for c in uso if self.site_acha_hoje(c, e)) if com_nome else '-'
            linhas.append([e, len(uso), len(imed), hoje, f'{len(cid)}/{len(m)}'])
        return tabela(linhas, ['exame', 'estab c/ aparelho em uso', 'de tipo que o IMED importa',
                               'o site acha hoje pelo nome', 'cidades com pelo menos 1'])

    def tipos_rm(self, ibge_lista: list[int], exame: str = 'rm') -> str:
        m = {mun6(c) for c in ibge_lista}
        cont = Counter(self.tipo(c) for c in self.com(exame, m))
        return ', '.join(f'tipo {t}: {n}' for t, n in cont.most_common())

    def resumo(self, fonte: str, mes) -> dict:
        """Listas de CNES com o aparelho em uso em Campinas e São Paulo (para conferir com o banco do IMED)."""
        out = {'fonte': fonte, 'mes': mes, 'exames': {}, 'em_uso': {}}
        for e in EXAMES:
            if not self.mapa.get(e):
                continue
            out['exames'][e] = {str(c): self.com(e, {mun6(c)}) for c in (CAMPINAS, SAO_PAULO)}
            out['em_uso'][e] = {cn: self.por[cn][e][1] for lst in out['exames'][e].values() for cn in lst}
        return out


def cidades_do_imed(raiz_repo: Path) -> list[int]:
    try:
        return [int(c['ibge']) for c in json.loads((raiz_repo / 'scripts' / 'cidades.json').read_text(encoding='utf-8'))]
    except Exception:  # noqa: BLE001
        return [SAO_PAULO, CAMPINAS]
