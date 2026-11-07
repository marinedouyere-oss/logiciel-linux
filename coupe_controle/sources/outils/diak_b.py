import sys, re, json, glob, os, collections, openpyxl
exec(open(os.path.join(os.path.dirname(sys.argv[0]), "feno_commun.py")).read().replace("L = json.load(open(sys.argv[1]))", ""))
def n(v):
    if v is None: return None
    try: return float(str(v).replace("\xa0", "").replace(" ", "").replace(",", "."))
    except: return None
# Diakonos : toutes les pièces commandées connues
diak = {}
for p in sys.argv[2:]:
    wb = openpyxl.load_workbook(p, read_only=True); r = list(wb.worksheets[0].iter_rows(values_only=True))
    for x in r[1:]:
        if not x or not x[0]: continue
        k = "%s%03d" % (str(x[0]).strip(), int(n(x[1]) or 0))
        diak.setdefault(k, (n(x[5]), n(x[6]), str(x[3]), os.path.basename(p)))
print(len(diak), "pièces Diakonos")
L = json.load(open(sys.argv[1]))
c = collections.defaultdict(collections.Counter); ex = {}
for d in L:
    if "46" not in d["_f"] or "s46g" not in d["_f"]: continue
    k = s(d["commande+ligne"]); 
    if k not in diak: continue
    dl, dw = diak[k][0], diak[k][1]; fl, fw = num(d["conf_longueur"]), num(d["conf_largeur"])
    if None in (dl, dw, fl, fw): continue
    asm = assemblages(d["info atelier assemblage"])
    nL = sum(1 for x in asm if x[0] == "L"); nLe = sum(1 for x in asm if x.startswith("ETRL")); nF = sum(1 for x in asm if "F" in x[:4])
    fam = "FENO" if "FENO" in d["_f"].upper() else "agglo"
    kk = (fam, "L%d ETRL%d F%d" % (nL, nLe, nF), couche(d) if fam == "FENO" else "")
    v = "long%+g larg%+g" % (fl - dl, fw - dw)
    c[kk][v] += 1; ex.setdefault((kk, v), (d["_f"].split("/")[-1], d["_r"], k, s(d["agglo"]), dl, fl, s(d["info atelier assemblage"])))
for kk in sorted(c):
    print(kk, sum(c[kk].values()))
    for v, m in c[kk].most_common(6): print("     ", m, v, ex[(kk, v)])
