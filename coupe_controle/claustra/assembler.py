"""Assemble la page de Claustra (un seul fichier) : polices et logo de la charte Laisné (repris des sources de
Sentinelle), style, corps, écriture du .zip (Sentinelle) et logique de Claustra.
Usage : python3 -I assembler.py <version> <sortie.html>"""
import base64, os, re, sys

version, sortie = sys.argv[1], sys.argv[2]
ici = os.path.dirname(os.path.abspath(__file__))
sources = os.path.join(ici, "..", "sources", "web_src")
lire = lambda *p: open(os.path.join(*p), encoding="utf-8").read()

polices = lire(sources, "08a_polices.css")
charte = lire(sources, "02b_actifs_charte.js")
logo = re.search(r'^const LOGO_BLANC_PNG = ".*?";$', charte, re.M).group(0)
correction = lire(sources, "04e_correction.js")
debut = correction.index("const TABLE_CRC32")
fin = correction.index("// Recopie le classeur en supprimant des lignes d'une feuille.")
zip_js = correction[debut:fin]
icone = base64.b64encode(open(os.path.join(ici, "..", "web", "icons", "icon-192.png"), "rb").read()).decode()
corps = lire(ici, "src", "corps.html").replace("__VERSION__", version)
js = lire(ici, "src", "claustra.js")
assert "</script>" not in js + zip_js + logo
page = f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#78140c">
<title>Claustra V{version} — Fichier de lancement des claustras</title>
<link rel="icon" href="data:image/png;base64,{icone}">
<style>
{polices}
{lire(ici, "src", "claustra.css")}
</style>
</head>
<body>
{corps}
<script>
"use strict";
{logo}
{zip_js}
{js}
</script>
</body>
</html>
"""
open(sortie, "w", encoding="utf-8").write(page)
print(sortie, len(page), "octets")
