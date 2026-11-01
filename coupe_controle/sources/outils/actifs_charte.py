"""Prépare les actifs de la charte Laisné Industrie : polices (Android, web, PDF) et logo.

Usage : actifs_charte.py dossier_polices dossier_logo sortie
"""
import base64, io, json, os, sys
from fontTools.ttLib import TTFont
from fontTools import subset
from PIL import Image

polices, logos, sortie = sys.argv[1:4]
for d in ("android/font", "android/drawable-nodpi", "pdf", "web"):
    os.makedirs(os.path.join(sortie, d), exist_ok=True)

FICHIERS = {
    "raleway_bold": ("raleway/package/files/raleway-latin-700-normal.woff2", "Raleway-Bold", False),
    "lato_regular": ("lato/package/files/lato-latin-400-normal.woff2", "Lato-Regular", False),
    "lato_bold": ("lato/package/files/lato-latin-700-normal.woff2", "Lato-Bold", False),
    "lato_italic": ("lato/package/files/lato-latin-400-italic.woff2", "Lato-Italic", True),
}
# Codes WinAnsi 32..255 → Unicode (0x80..0x9F : table cp1252 ; trous → None).
def unicode_winansi(code):
    try:
        return ord(bytes([code]).decode("cp1252"))
    except UnicodeDecodeError:
        return None

def chiffres_alignes(f):
    """Raleway : chiffres alignés (fonction lnum) à la place des chiffres elzéviriens."""
    if "GSUB" not in f:
        return
    g = f["GSUB"].table
    cmap = dict(f.getBestCmap())
    remplacements = {}
    for fr in g.FeatureList.FeatureRecord:
        if fr.FeatureTag != "lnum":
            continue
        for li in fr.Feature.LookupListIndex:
            for st in g.LookupList.Lookup[li].SubTable:
                m = getattr(st, "mapping", None) or {}
                for u in range(0x30, 0x3A):
                    if cmap.get(u) in m:
                        remplacements[u] = m[cmap[u]]
    for table in f["cmap"].tables:
        for u, glyphe in remplacements.items():
            if u in table.cmap:
                table.cmap[u] = glyphe

def charger(brut):
    f = TTFont(io.BytesIO(brut))
    chiffres_alignes(f)
    return f

css = []
metriques = {}
for cle, (chemin, nom_pdf, italique) in FICHIERS.items():
    brut = open(os.path.join(polices, chemin), "rb").read()
    w2 = charger(brut)
    t = io.BytesIO(); w2.save(t)
    css.append((cle, base64.b64encode(t.getvalue()).decode()))
    f = charger(brut)
    f.flavor = None
    assert "glyf" in f, cle
    f.save(os.path.join(sortie, "android/font", cle + ".ttf"))
    # PDF : seulement les caractères WinAnsi, sans hinting.
    opts = subset.Options()
    opts.hinting = False
    opts.layout_features = []
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    sous = charger(brut)
    sous.flavor = None
    s = subset.Subsetter(opts)
    unis = [u for u in (unicode_winansi(c) for c in range(32, 256)) if u is not None] + [0xA0]
    s.populate(unicodes=unis)
    s.subset(sous)
    tampon = io.BytesIO()
    sous.save(tampon)
    open(os.path.join(sortie, "pdf", cle + ".ttf"), "wb").write(tampon.getvalue())
    upem = sous["head"].unitsPerEm
    cmap = sous.getBestCmap()
    hmtx = sous["hmtx"]
    largeurs = []
    for code in range(32, 256):
        u = unicode_winansi(code)
        g = cmap.get(u) if u is not None else None
        largeurs.append(round(hmtx[g][0] * 1000 / upem) if g else 0)
    head, os2, post = sous["head"], sous["OS/2"], sous["post"]
    k = 1000 / upem
    metriques[cle] = {
        "nom": nom_pdf,
        "largeurs": largeurs,
        "bbox": [round(head.xMin * k), round(head.yMin * k), round(head.xMax * k), round(head.yMax * k)],
        "ascent": round(os2.sTypoAscender * k), "descent": round(os2.sTypoDescender * k),
        "capHeight": round(getattr(os2, "sCapHeight", 700) * k), "italicAngle": post.italicAngle,
        "italique": italique, "taille": len(tampon.getvalue()),
    }
    print(cle, "ttf", os.path.getsize(os.path.join(sortie, "android/font", cle + ".ttf")), "pdf", len(tampon.getvalue()))
json.dump(metriques, open(os.path.join(sortie, "pdf", "metriques.json"), "w"), indent=1)

# Polices de la page web, intégrées (la page marche hors ligne).
familles = {"raleway_bold": ("Raleway", 700, "normal"), "lato_regular": ("Lato", 400, "normal"),
            "lato_bold": ("Lato", 700, "normal"), "lato_italic": ("Lato", 400, "italic")}
with open(os.path.join(sortie, "web", "polices.css"), "w") as w:
    for cle, b64 in css:
        fam, poids, style = familles[cle]
        w.write(f'@font-face {{ font-family: "{fam}"; font-weight: {poids}; font-style: {style}; font-display: swap; '
                f'src: url(data:font/woff2;base64,{b64}) format("woff2"); }}\n')

# Logo : Android (PNG transparent), web (PNG transparent), PDF (JPEG sur fond blanc).
for version in ("couleur", "blanc"):
    im = Image.open(os.path.join(logos, f"logo_{version}_3000.png")).convert("RGBA")
    a = im.resize((720, round(im.height * 720 / im.width)), Image.LANCZOS)
    a.save(os.path.join(sortie, "android/drawable-nodpi", "logo_laisne" + ("" if version == "couleur" else "_blanc") + ".png"), optimize=True)
    w = im.resize((480, round(im.height * 480 / im.width)), Image.LANCZOS)
    t = io.BytesIO(); w.save(t, "PNG", optimize=True)
    open(os.path.join(sortie, "web", f"logo_{version}.b64"), "w").write(base64.b64encode(t.getvalue()).decode())
    print(version, "android", a.size, "web", len(t.getvalue()))
im = Image.open(os.path.join(logos, "logo_couleur_3000.png")).convert("RGBA")
p = im.resize((900, round(im.height * 900 / im.width)), Image.LANCZOS)
blanc = Image.new("RGB", p.size, (255, 255, 255)); blanc.paste(p, (0, 0), p)
blanc.save(os.path.join(sortie, "pdf", "logo.jpg"), quality=92, optimize=True)
json.dump({"largeur": p.width, "hauteur": p.height}, open(os.path.join(sortie, "pdf", "logo.json"), "w"))
print("pdf logo", p.size, os.path.getsize(os.path.join(sortie, "pdf", "logo.jpg")))
