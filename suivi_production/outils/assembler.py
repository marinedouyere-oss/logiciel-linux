"""Assemble la maquette « Suivi de production » en une seule page HTML (hors ligne).

Usage : python3 -I outils/assembler.py [sortie.html]
Reprend les polices et le logo de la charte Laisné depuis les sources de Sentinelle.
"""
import os
import re
import sys

ici = os.path.dirname(os.path.abspath(__file__))
racine = os.path.dirname(ici)
sentinelle = os.path.join(os.path.dirname(racine), "coupe_controle", "sources", "web_src")
sortie = sys.argv[1] if len(sys.argv) > 1 else os.path.join(racine, "Suivi_production.html")


def lire(*chemin):
    with open(os.path.join(*chemin), encoding="utf-8") as f:
        return f.read()


page = lire(racine, "sources", "page.html")
polices = lire(sentinelle, "08a_polices.css")
actifs = lire(sentinelle, "02b_actifs_charte.js")
logo = re.search(r'const LOGO_BLANC_PNG = "(data:image/png;base64,[A-Za-z0-9+/=]+)"', actifs).group(1)
page = page.replace("/*POLICES*/", polices).replace("/*STYLE*/", lire(racine, "sources", "style.css"))
page = page.replace("%LOGO_BLANC%", logo).replace("/*SCRIPT*/", lire(racine, "sources", "app.js"))
with open(sortie, "w", encoding="utf-8") as f:
    f.write(page)
print(sortie, len(page.encode("utf-8")), "octets")
