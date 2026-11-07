import json, sys, re, collections
exec(open(sys.argv[0].replace("feno_d.py", "feno_commun.py")).read())
fen = [d for d in L if "FENO" in d["_f"].upper()]
# Cote finale - fini, par type d'assemblage (L = latéral non étrier), couche, et fichier
c = collections.defaultdict(collections.Counter)
for d in fen:
    fl, fw, sp = num(d["conf_longueur"]), num(d["conf_largeur"]), num(d["surepaisseur"]) or 0
    gl, gw = val(d["longueur"], d), val(d["largeur"], d); el, ew = deb(d)
    if None in (fl, gl): continue
    asm = assemblages(d["info atelier assemblage"])
    nL = sum(1 for x in asm if x[0] == "L"); nF = sum(1 for x in asm if x[0] == "F"); nE = sum(1 for x in asm if x.startswith("ETR"))
    k = ("L%d F%d ETR%d" % (nL, nF, nE), couche(d))
    c[k]["fin%+g/gest%+g" % (gl - fl, el - fl)] += 1
for k in sorted(c): print(k, dict(c[k].most_common()))
