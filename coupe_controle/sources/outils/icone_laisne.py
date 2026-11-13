"""Passe l'icône de Sentinelle du bleu aux couleurs de Laisné plans de travail
(rouge du logo #E3061C, gris clair #F5F5F5, blanc), en gardant les dégradés des bords.

Usage : icone_laisne.py fichier.png [fichier.png ...]   (modifiés sur place)
"""
import sys
from PIL import Image

BLEU = (21, 101, 192)
ROUGE = (227, 6, 28)
GRIS = (245, 245, 245)
BLANC = (255, 255, 255)
T_GRIS = 0.835  # position du bleu clair du bâtiment entre le bleu et le blanc


def melange(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def recolorer(p):
    # Part de blanc dans le pixel (0 = bleu du fond, 1 = blanc), moyenne des trois canaux.
    t = sum((p[i] - BLEU[i]) / (255 - BLEU[i]) for i in range(3)) / 3
    t = min(1.0, max(0.0, t))
    if t <= T_GRIS:
        return melange(ROUGE, GRIS, t / T_GRIS)
    return melange(GRIS, BLANC, (t - T_GRIS) / (1 - T_GRIS))


for chemin in sys.argv[1:]:
    im = Image.open(chemin)
    alpha = im.getchannel("A") if im.mode == "RGBA" else None
    rgb = im.convert("RGB")
    rgb.putdata([recolorer(p) for p in rgb.getdata()])
    if alpha is not None:
        rgb.putalpha(alpha)
    rgb.save(chemin)
    print(chemin)
