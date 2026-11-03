"""Testes do gerar.py (sem internet): python3 -I scripts/cid10/test_gerar.py"""
import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gerar  # noqa: E402

CAPS = 'NUMCAP;CATINIC;CATFIM;DESCRICAO;DESCRABREV;\n10;J00;J99;Capítulo X - Doenças do aparelho respiratório;X. Doenças do aparelho respiratório;\n14;N00;N99;Capítulo XIV;XIV;\n'
CATS = 'CAT;CLASSIF;DESCRICAO;DESCRABREV;REFER;EXCLUIDOS;\nJ06;;Infecções agudas das vias aéreas superiores de localizações múltiplas e não especificadas;J06 Infec ag vias aer sup;;;\nN40;;Hiperplasia da próstata;N40 Hiperplasia da prostata;;;\nX9;;inválida;;;;\n'
SUBS = ('SUBCAT;CLASSIF;RESTRSEXO;CAUSAOBITO;DESCRICAO;DESCRABREV;REFER;EXCLUIDOS;\n'
        'J060;;;;Laringofaringite aguda;J06.0 Laringofaringite aguda;;;\n'
        'J069;;;;Infecção aguda das vias aéreas superiores não especificada;J06.9 Infec aguda vias aereas super NE;;;\n'
        'N40;;;;não é subcategoria;;;;\n')
SUBS_N = 'N400;;1;;Teste masculino\tcom tab;Abrev;;;\n'


def zip_de(caps=CAPS, cats=CATS, subs=SUBS + SUBS_N, enc='latin-1'):
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w') as z:
        z.writestr('CID-10-CAPITULOS.CSV', caps.encode(enc))
        z.writestr('CID-10-CATEGORIAS.CSV', cats.encode(enc))
        z.writestr('CID-10-SUBCATEGORIAS.CSV', subs.encode(enc))
        z.writestr('CID-O-CATEGORIAS.CSV', 'CAT;DESCRICAO\nM800;Neoplasia\n'.encode(enc))
    return b.getvalue()


class T(unittest.TestCase):
    def linhas(self, **k):
        with zipfile.ZipFile(io.BytesIO(zip_de(**k))) as z:
            return gerar.montar(gerar.ler_csv(z, 'CAPITULOS.CSV'), gerar.ler_csv(z, '-CATEGORIAS.CSV'), gerar.ler_csv(z, 'SUBCATEGORIAS.CSV'))

    def test_codigos_capitulo_e_acentos(self):
        por = {l[0]: l for l in self.linhas()}
        self.assertEqual(sorted(por), ['J06', 'J060', 'J069', 'N40', 'N400'])
        self.assertEqual(por['J069'], ('J069', 10, '', 'Infecção aguda das vias aéreas superiores não especificada', 'J06.9 Infec aguda vias aereas super NE'))
        self.assertEqual(por['J06'][1], 10)
        self.assertEqual(por['N400'][1], 14)

    def test_sexo_e_tab(self):
        por = {l[0]: l for l in self.linhas()}
        self.assertEqual(por['N400'][2], 'M')
        self.assertEqual(por['N40'][2], 'M', 'categoria herda quando todas as subcategorias têm a mesma restrição')
        self.assertEqual(por['J06'][2], '')
        self.assertNotIn('\t', por['N400'][3])

    def test_utf8_tambem(self):
        por = {l[0]: l for l in self.linhas(enc='utf-8')}
        self.assertEqual(por['N40'][3], 'Hiperplasia da próstata')

    def test_tsv_bate_com_o_banco(self):
        # mesmo padrão de private.cid10_linhas (supabase/migrations/*_prontuario.sql)
        import re
        pad = re.compile(r'^([A-Z][0-9]{2}[0-9X]?)\t([0-9]{0,2})\t([FM]?)\t([^\t]+)\t([^\t]*)$')
        texto = gerar.tsv(self.linhas())
        corpo = texto.splitlines()[1:]
        self.assertEqual(texto.splitlines()[0], 'codigo\tcapitulo\trestr_sexo\tdescricao\tdescricao_abrev')
        self.assertTrue(all(pad.match(l) for l in corpo), corpo)

    def test_minimo_de_linhas(self):
        with tempfile.TemporaryDirectory() as d:
            z = Path(d) / 'c.zip'
            z.write_bytes(zip_de())
            with self.assertRaises(SystemExit):
                gerar.gerar(z, Path(d) / 'saida')


if __name__ == '__main__':
    unittest.main()
