import json, sys, re, collections
L = json.load(open(sys.argv[1]))
def s(v): return "" if v is None else re.sub(r"\.0$", "", str(v).strip())
def num(v):
    try: return float(v)
    except: return None
fen = [d for d in L if "FENO" in d["_f"].upper()]
def deb(d):
    m = re.match(r"\s*(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)", s(d["LongueurxLargeur debit"]))
    return (float(m.group(1)), float(m.group(2))) if m else (None, None)
# Exemple brut de lignes
cols = ["conf_commande","conf_ligne","conf_article","agglo","conf_longueur","conf_largeur","longueur","largeur","surepaisseur","LongueurxLargeur debit","info atelier assemblage","commentaire","info 2 atelier","info 3 atelier","Usinage angle avant gauche","Usinage angle avant droit","Usinage angle arrière gauche","Usinage angle arrière droit","CBD"]
f0 = "webtest/s46g/Semaine 46/FENO/LAN264601FENO.xlsx"
for d in [x for x in fen if x["_f"] == f0][:40]:
    print(d["_r"], " | ".join(s(d[c]) if not isinstance(d[c], str) or not d[c].startswith("=") else d[c] for c in cols))
