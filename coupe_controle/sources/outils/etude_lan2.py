import sys, os, glob, collections, re
import openpyxl
racine = sys.argv[1]
fichiers = [f for f in sorted(glob.glob(os.path.join(racine, "**", "*.xlsx"), recursive=True))
            if os.path.basename(f).upper().startswith("LAN") and "DIAKONOS" not in f.upper() and "ANALYSE" not in f.upper()
            and not any(x in f for x in ("/s46d/", "/s46f/", "/s46/", "/s44c/"))]
L = []
for f in fichiers:
    wbf = openpyxl.load_workbook(f, read_only=True, data_only=False)
    wbv = openpyxl.load_workbook(f, read_only=True, data_only=True)
    rf = list(wbf.worksheets[0].iter_rows(values_only=True)); rv = list(wbv.worksheets[0].iter_rows(values_only=True))
    e = [str(c).strip() if c is not None else "" for c in rf[0]]
    for i in range(1, len(rf)):
        if not rf[i] or all(v is None for v in rf[i]): continue
        d = {n: rv[i][j] if j < len(rv[i]) else None for j, n in enumerate(e) if n}
        d["_formules"] = {n: rf[i][j] for j, n in enumerate(e) if n and isinstance(rf[i][j], str) and rf[i][j].startswith("=")}
        d["_fichier"] = os.path.basename(f); d["_ligne"] = i + 1
        L.append(d)
def num(v):
    try: return float(v)
    except: return None
print("LIGNES", len(L))
# 1. Débit = fini + surépaisseur ?
c = collections.Counter()
ex = collections.defaultdict(list)
for d in L:
    dl = (num(d["longueur"]) or 0) - (num(d["conf_longueur"]) or 0)
    dw = (num(d["largeur"]) or 0) - (num(d["conf_largeur"]) or 0)
    s = num(d["surepaisseur"])
    k = (d["agglo"] if d["agglo"] in ("PROTECTION", "PROTECTION-PF", "FENO8", "FENO8-PF") else "autre", s, dl, dw)
    c[k] += 1
    if len(ex[k]) < 2: ex[k].append((d["_fichier"], d["_ligne"], d["conf_article"], d["conf_longueur"], d["conf_largeur"], d["longueur"], d["largeur"], d["_formules"]))
print("\n1. (matière, surépaisseur, débit-fini longueur, débit-fini largeur) :")
for k, n in c.most_common(30): print("  ", k, n, ex[k][0])
# 2. Chaînes débit / fini
ok1 = ok2 = 0; ko = []
for d in L:
    s1 = f"{d['longueur']} X {d['largeur']}"; s2 = f"{d['conf_longueur']} X {d['conf_largeur']} X {d['conf_epaisseur']}"
    n = lambda t: re.sub(r"\.0\b", "", str(t))
    if n(d["LongueurxLargeur debit"]) == n(s1): ok1 += 1
    elif len(ko) < 5: ko.append(("debit", d["_fichier"], d["_ligne"], d["LongueurxLargeur debit"], s1))
    if n(d["LongueurxLargeurxEpaisseur fini"]) == n(s2): ok2 += 1
    elif len(ko) < 10: ko.append(("fini", d["_fichier"], d["_ligne"], d["LongueurxLargeurxEpaisseur fini"], s2))
print(f"\n2. 'LongueurxLargeur debit' = longueur X largeur : {ok1}/{len(L)} ; 'fini' = conf_longueur X conf_largeur X conf_epaisseur : {ok2}/{len(L)}")
for k in ko: print("   écart", k)
# 3. Clé
ok = 0; ko = []
for d in L:
    att = f"{d['conf_commande']}{int(num(d['conf_ligne'])):03d}" if num(d['conf_ligne']) is not None else None
    if d["commande+ligne"] == att: ok += 1
    elif len(ko) < 8: ko.append((d["_fichier"], d["_ligne"], d["commande+ligne"], att, d["agglo"]))
print(f"\n3. commande+ligne = conf_commande + conf_ligne sur 3 chiffres : {ok}/{len(L)}", ko)
# 4. Feuille = lancement
# 5. Plusieurs lignes par clé
parcle = collections.defaultdict(list)
for d in L: parcle[(d["_fichier"], d["commande+ligne"])].append(d)
multi = collections.Counter()
exm = {}
for (f, k), ds in parcle.items():
    if len(ds) > 1:
        sig = tuple(sorted(str(x["agglo"]) for x in ds))
        multi[sig] += 1; exm.setdefault(sig, (f, k, [(x["conf_article"], x["agglo"], x["coloris"], x["coloris_inf"], x["conf_epaisseur"], x["comdet_qte"]) for x in ds]))
print("\n5. Clés sur plusieurs lignes (matières des lignes) :")
for s, n in multi.most_common(15): print("  ", n, s, exm[s])
# 6. Protections
print("\n6. Lignes PROTECTION :")
pc = collections.Counter((d["conf_article"], d["coloris"], d["coloris_inf"], d["conf_epaisseur"]) for d in L if str(d["agglo"]).startswith("PROTECTION"))
for k, n in pc.most_common(8): print("  ", k, n)
seule = sum(1 for (f, k), ds in parcle.items() if all(str(x["agglo"]).startswith("PROTECTION") for x in ds))
print("   clés uniquement en protection :", seule)
# 7. agglo vs épaisseur
print("\n7. agglo -> épaisseurs finies :")
ae = collections.defaultdict(collections.Counter)
for d in L: ae[d["agglo"]][num(d["conf_epaisseur"])] += 1
for a, cc in sorted(ae.items(), key=lambda x: -sum(x[1].values())): print("  ", a, dict(cc.most_common(5)))
