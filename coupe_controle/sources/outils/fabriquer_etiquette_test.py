"""Fabrique une fausse étiquette Zebra (ZPL ^GFA) pour tester la lecture du CVC, SANS donnée client.
La mise en page imite l'étiquette Diakonos : un gros titre, un trait, puis « CVC######## lig. N ».
L'image est tournée de 90° comme à l'impression (la page la remet droite).

Usage : python3 -I fabriquer_etiquette_test.py <CVC> <ligne> <sortie.spl>
Il faut Pillow.
"""
import sys
import zlib
from PIL import Image, ImageDraw, ImageFont

POLICE = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"


def dessiner(cvc, ligne):
    # Image droite (comme on la lit), fond blanc.
    larg, haut = 416, 640
    im = Image.new("1", (larg, haut), 1)  # 1 = blanc
    d = ImageDraw.Draw(im)
    titre = ImageFont.truetype(POLICE, 40)
    corps = ImageFont.truetype(POLICE, 34)
    petit = ImageFont.truetype(POLICE, 25)
    d.text((40, 52), "LOG 5 T1 TEST   29", font=titre, fill=0)
    d.line((40, 104, 400, 104), fill=0, width=2)  # le trait de séparation
    d.text((40, 110), f"{cvc} lig. {ligne}", font=corps, fill=0)
    d.text((40, 151), "TPTEST00000   978", font=petit, fill=0)
    d.text((40, 218), "CLIENT TEST", font=titre, fill=0)
    return im


def en_gfa(brut):
    # brut : image mode "1" (0 = noir). ^GFA : 1 = noir, 8 pixels/octet, bit de poids fort à gauche.
    w, h = brut.size
    octets_ligne = (w + 7) // 8
    px = brut.load()
    data = bytearray(octets_ligne * h)
    for y in range(h):
        for x in range(w):
            if px[x, y] == 0:  # noir
                data[y * octets_ligne + (x >> 3)] |= 0x80 >> (x & 7)
    comp = zlib.compress(bytes(data), 9)
    import base64
    b64 = base64.b64encode(comp).decode()
    total = octets_ligne * h
    return f"^GFA,{total},{total},{octets_ligne},:Z64:{b64}:0000", w, h


def main():
    cvc, ligne, sortie = sys.argv[1], sys.argv[2], sys.argv[3]
    droite = dessiner(cvc, ligne)
    # À l'impression, l'étiquette est tournée de 90° ; la page fait l'inverse pour la lire.
    brut = droite.rotate(90, expand=True)
    gfa, w, h = en_gfa(brut)
    zpl = (
        "CT~~CD,~CC^~CT~\n^XA~TA000~JSN^LT0^MNW^MTD^PON^PMN^LH0,0^JMA^PR5,5~SD15^JUS^LRN^CI0^XZ\n"
        f"^XA\n^MMT\n^PW{w}\n^LL{h:04d}\n^LS0\n^FO0,0{gfa}\n^PQ1,0,1,Y^XZ\n"
    )
    with open(sortie, "wb") as f:
        f.write(zpl.encode("latin1"))
    print(sortie, "écrit :", cvc, "lig.", ligne)


if __name__ == "__main__":
    main()
