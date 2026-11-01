"""Vérifie les lignes rouges du fichier final : rouge <=> surcote > 61 mm (longueur ou largeur, avec
conf_longueur / conf_largeur) ou belle face (coloris) vide hors exceptions (protection, bois d'une pièce Feno,
lancement Feno hors FENO, BRUT retiré). Les largeurs harmonisées ne dépassent jamais conf_largeur + 61.
Usage : verif_rouges.py <brut> <sortie> <feno 0|1>"""
import sys, openpyxl
brut, sortie, feno = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
def lire(p):
    ws = openpyxl.load_workbook(p).worksheets[0]
    h = [str(c.value).strip() if c.value is not None else "" for c in ws[1]]
    I = {k: i + 1 for i, k in enumerate(h) if k}
    rows = {}
    for r in range(2, ws.max_row + 1):
        v = {k: ws.cell(r, i).value for k, i in I.items()}
        f = ws.cell(r, 1).fill
        v["_rgb"] = f.fgColor.rgb if f.fill_type == "solid" else None
        rows[r] = v
    return rows
def num(x):
    try: return float(str(x).replace(",", "."))
    except: return None
def t(x): return "" if x is None else str(x).strip()
A, B = lire(brut), lire(sortie)
fenoCles = {t(v["commande+ligne"]) for v in B.values() if t(v.get("agglo")).upper().startswith("FENO")}
err = 0; rouges = 0
for r, v in B.items():
    cle = t(v.get("commande+ligne"))
    if not cle: continue
    agglo = t(v.get("agglo")).upper()
    sc = any((num(d) is not None and num(f) is not None and num(d) - num(f) > 61) for d, f in ((v.get("longueur"), v.get("conf_longueur")), (v.get("largeur"), v.get("conf_largeur"))))
    brutRetire = t(A[r].get("coloris")).upper() == "BRUT"
    exception = (not agglo) or agglo.startswith("PROTECTION") or brutRetire or (not agglo.startswith("FENO") and (feno or cle in fenoCles))
    couleur = "coloris" in v and t(v.get("coloris")) == "" and not exception
    attendu = sc or couleur
    rouge = v["_rgb"] == "FFFF0000"
    rouges += rouge
    if attendu != rouge: err += 1; print("ÉCART ligne", r, cle, agglo, "attendu rouge" if attendu else "pas rouge", "| surcote" if sc else "", "| couleur" if couleur else "")
    if num(v.get("largeur")) != num(A[r].get("largeur")) and num(v.get("conf_largeur")) is not None and num(v.get("largeur")) - num(v.get("conf_largeur")) > 61:
        err += 1; print("ÉCART harmonisation au-delà de 61 mm ligne", r, cle)
print(f"{sortie.split('/')[-1]} : {rouges} ligne(s) rouge(s), {err} écart(s)")
sys.exit(1 if err else 0)
