"""Testes do gerar.py (sem internet): python3 -I scripts/cnes-equip/test_gerar.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gerar  # noqa: E402

MUN = {'350950': 3509502}


def linha(**k):
    base = {'CNES': '2345', 'CODUFMUN': '350950', 'TIPEQUIP': '1', 'CODEQUIP': '12', 'QT_EXIST': 1, 'QT_USO': 1,
            'IND_SUS': '1', 'COMPETEN': '202609', 'CPF_CNPJ': '12345678901'}
    base.update(k)
    return base


class T(unittest.TestCase):
    def test_zero_a_esquerda_e_sem_cpf(self):
        x = gerar.linha_de(linha(), MUN)
        self.assertEqual(x, ('0002345', 'rm', 1, True, '2026-09'))
        self.assertNotIn('12345678901', repr(x))

    def test_par_tipo_codigo(self):
        self.assertIsNone(gerar.linha_de(linha(TIPEQUIP='9', CODEQUIP='12'), MUN))
        for c in ('31', '07', '16'):
            self.assertIsNone(gerar.linha_de(linha(CODEQUIP=c), MUN))
        self.assertEqual(gerar.linha_de(linha(TIPEQUIP='4', CODEQUIP='41'), MUN)[1], 'ecg')

    def test_sem_uso_e_fora_da_cidade(self):
        self.assertIsNone(gerar.linha_de(linha(QT_USO=0), MUN))
        self.assertIsNone(gerar.linha_de(linha(CODUFMUN='355030'), MUN))

    def test_eco_e_lab_nunca(self):
        self.assertFalse({'eco', 'lab'} & set(gerar.CODIGOS.values()))

    def test_juntar(self):
        por, _ = gerar.juntar([linha(), linha(CODEQUIP='32', QT_USO=2, IND_SUS='0')], MUN)
        self.assertEqual(por[('0002345', 'rm')], [3, True, '2026-09'])


if __name__ == '__main__':
    unittest.main()
