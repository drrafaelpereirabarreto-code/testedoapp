# Letras do site (Inter e Sora)

As mesmas letras que antes vinham do Google Fonts, agora guardadas no próprio site: a página abre mais rápido no
celular (sem esperar outro servidor) e o endereço de quem visita não vai para o Google.

- Origem: Google Fonts (fonts.gstatic.com), versões Inter v20 e Sora v17, recortes `latin` e `latin-ext`, sem mudança.
  - `inter-latin.woff2` — sha256 3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62
  - `inter-latin-ext.woff2` — sha256 34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956
  - `sora-latin.woff2` — sha256 811e11966d29f3a01fcb19b087b61ac067d380665a55aebb7fcdf2cda95e4a93
  - `sora-latin-ext.woff2` — sha256 08e1ba85bcb55277782f56766af09467dfe18cbeea49704203100c5797ac4cc5
- São fontes variáveis: um arquivo serve todos os pesos. O `latin-ext` só é baixado se a página tiver alguma letra dele.
- Quem declara as letras em cada página é `scripts/fontes.mjs` (bloco `<style data-fontes>` no `<head>`).
- Licença: SIL Open Font License 1.1 (`OFL-Inter.txt` e `OFL-Sora.txt`).
