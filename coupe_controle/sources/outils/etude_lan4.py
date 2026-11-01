"""Règles du débit, vérifiées sur tous les fichiers LAN : débit = fini + surépaisseur, débit minimum, retouches."""
import sys, os, glob, collections, re
import openpyxl
fichiers = []
for r in sys.argv[1:]:
    fichiers += [f for f in sorted(glob.glob(os.path.join(r, "**", "*.xlsx"), recursive=True))
                 if os.path.basename(f).upper().startswith("LAN") and "DIAKONOS" not in f.upper() and "ANALYSE" not in f.upper()
                 and not any(x in f for x in ("/s46d/", "/s46f/", "/s46/", "/s44c/", "(2)"))]
L = []
feuilles = []
for f in fichiers:
    wbf = openpyxl.load_workbook(f, read_only=True, data_only=False)
    rf = list(wbf.worksheets[0].iter_rows(values_only=True))
    e = [str(c).strip() if c is not None else "" for c in rf[0]]
    lancements = collections.Counter()
    for i in range(1, len(rf)):
        if not rf[i] or all(v is None for v in rf[i]): continue
        d = {n: rf[i][j] if j < len(rf[i]) else None for j, n in enumerate(e) if n}
        d["_formule"] = any(isinstance(v, str) and v.startswith("=") for v in rf[i])
        d["_fichier"] = os.path.basename(f)
        L.append(d); lancements[str(d["comprod_lancement"])] += 1
    feuilles.append((os.path.basename(f), wbf.sheetnames[0], lancements.most_common(2)))
def num(v):
    try: return float(v)
    except: return None
def s(v): return "" if v is None else re.sub(r"\.0$", "", str(v).strip())
print(len(fichiers), "fichiers,", len(L), "lignes")
print("\n1) Nom de la feuille = n° de lancement de la colonne comprod_lancement :",
      sum(1 for f, fe, l in feuilles if l and fe == l[0][0]), "/", len(feuilles), [x for x in feuilles if not (x[2] and x[1] == x[2][0][0])][:6])
# 2) Débit ERP (chaîne) = fini + surépaisseur ? et minimum
c = collections.Counter(); ex = {}
for d in L:
    if str(d["agglo"]).startswith("PROTECTION"): continue
    sp = num(d["surepaisseur"]) or 0
    m = re.match(r"\s*(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)", s(d["LongueurxLargeur debit"]))
    if not m: continue
    el, ew = float(m.group(1)), float(m.group(2))
    fl, fw = num(d["conf_longueur"]) or 0, num(d["conf_largeur"]) or 0
    kl = "fini+sur" if abs(el - (fl + sp)) < .1 else f"={el:g}" if el in (510, 525) else f"autre({el - fl:+g})"
    kw = "fini+sur" if abs(ew - (fw + sp)) < .1 else f"autre({ew - fw:+g})"
    k = (s(d["conf_article"])[:5], kl if not kl.startswith("autre") else "autre", kw if not kw.startswith("autre") else "autre")
    c[k] += 1; ex.setdefault(k, (d["_fichier"], s(d["conf_article"]), fl, fw, sp, el, ew))
print("\n2) Débit de l'ERP (colonne 'LongueurxLargeur debit') :")
for k, v in c.most_common(40): print("  ", k, v, ex[k])
# 2b) longueur mini : quelle longueur finie passe au minimum ?
mini = collections.defaultdict(list)
for d in L:
    m = re.match(r"\s*(\d+)\s*X", s(d["LongueurxLargeur debit"]))
    if m and int(m.group(1)) in (510, 525) and (num(d["conf_longueur"]) or 0) + (num(d["surepaisseur"]) or 0) < int(m.group(1)):
        mini[(int(m.group(1)), s(d["conf_article"])[:4])].append(num(d["conf_longueur"]))
print("\n2b) Débit minimum :", {k: (len(v), min(v), max(v)) for k, v in mini.items()})
# 3) Colonnes longueur / largeur retouchées par rapport à l'ERP
c = collections.Counter(); ex = {}
for d in L:
    m = re.match(r"\s*(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)", s(d["LongueurxLargeur debit"]))
    if not m: continue
    dl = (num(d["longueur"]) or 0) - float(m.group(1)); dw = (num(d["largeur"]) or 0) - float(m.group(2))
    if abs(dl) < .1 and abs(dw) < .1: continue
    k = (s(d["conf_article"])[:5], "L%+g" % dl if dl else "", "l%+g" % dw if dw else "", d["_formule"])
    c[k] += 1; ex.setdefault(k, (d["_fichier"], s(d["conf_longueur"]), s(d["conf_largeur"]), s(d["LongueurxLargeur debit"]), s(d["longueur"]), s(d["largeur"]), s(d["idPlan"]), s(d["info atelier assemblage"])))
tot = sum(c.values())
print(f"\n3) Lignes où longueur/largeur (colonnes G/H) ≠ débit de l'ERP : {tot} / {len(L)}")
for k, v in c.most_common(30): print("  ", k, v, ex[k])
par_fichier = collections.Counter(d["_fichier"] for d in L if (lambda m: m and (abs((num(d["longueur"]) or 0) - float(m.group(1))) > .1 or abs((num(d["largeur"]) or 0) - float(m.group(2))) > .1))(re.match(r"\s*(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)", s(d["LongueurxLargeur debit"]))))
print("   par fichier :", par_fichier.most_common(12))
