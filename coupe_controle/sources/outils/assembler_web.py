"""Assemble la page web Sentinelle : ancienne page (bibliothèques intégrées)
+ nouveau style, nouveau corps et nouveau script.

Usage : assembler_web.py ancienne_index.html dossier_src sortie.html
"""
import sys, glob, os

ancienne, src, sortie = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(ancienne, encoding="utf-8").read()

# Polices de la charte (Raleway, Lato) intégrées, puis le style.
style = open(os.path.join(src, "08a_polices.css"), encoding="utf-8").read() + open(os.path.join(src, "08_style.css"), encoding="utf-8").read()
corps = open(os.path.join(src, "09_body.html"), encoding="utf-8").read()
js = '\n"use strict";\n' + "\n".join(open(f, encoding="utf-8").read() for f in sorted(glob.glob(os.path.join(src, "0[1-7]*.js"))))

debut_style = s.index("<style>") + len("<style>")
fin_style = s.index("</style>")
premier_script = s.index("<script>", fin_style)
dernier_script = s.rindex("<script>")
fin_dernier = s.rindex("</script>")
assert "<script>" not in js and "</script>" not in js

import re
tete = re.sub(r"<title>Sentinelle V[\d.]+ — Contrôle de coupe</title>", "<title>Sentinelle V6.9.0 — Contrôle de coupe</title>", s[:debut_style])
assert "Sentinelle V6.9.0" in tete
# Charte Laisné Industrie : barre du navigateur bordeaux.
tete = re.sub(r'<meta name="theme-color" content="#[0-9a-fA-F]{6}">', '<meta name="theme-color" content="#78140c">', tete)
# Icône de l'onglet intégrée : la page seule (sans le dossier icons) montre le logo Laisné.
import base64
icone = base64.b64encode(open(os.path.join(os.path.dirname(os.path.abspath(ancienne)), "icons", "icon-192.png"), "rb").read()).decode()
tete = re.sub(r'<link rel="icon" href="[^"]*">', f'<link rel="icon" href="data:image/png;base64,{icone}">', tete)
page = (
    tete
    + style
    + "</style>\n</head>\n<body>\n"
    + corps
    + "\n"
    + s[premier_script:dernier_script]
    + "<script>"
    + js
    + "\n"
    + s[fin_dernier:]
)
open(sortie, "w", encoding="utf-8").write(page)
print(len(page), "octets")
