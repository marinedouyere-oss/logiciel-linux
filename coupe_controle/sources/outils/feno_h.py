import json, sys, re, collections
exec(open(sys.argv[0].replace("feno_h.py", "feno_commun.py")).read())
fen = [d for d in L if "FENO" in d["_f"].upper()]
ok = collections.Counter(); ko = []
for d in fen:
    asm = assemblages(d["info atelier assemblage"])
    nL = sum(1 for x in asm if x[0] == "L")
    fl, fw, sp = num(d["conf_longueur"]), num(d["conf_largeur"]), num(d["surepaisseur"]) or 0
    gl, gw = val(d["longueur"], d), val(d["largeur"], d)
    if gl is None: ko.append((d, "longueur illisible: %r" % d["longueur"])); continue
    if couche(d) == "protection": attendu = fl
    else: attendu = fl + sp + (25 if nL else 0)
    k = ("L%d" % nL, couche(d))
    if abs(gl - attendu) < .1: ok[k] += 1
    else: ko.append((d, "attendu %g, trouvé %g (%+g)" % (attendu, gl, gl - attendu))); ok[k + ("écart",)] += 1
for k in sorted(ok): print(k, ok[k])
print()
for d, m in ko:
    print(d["_f"].split("/")[-1], "ligne", d["_r"], s(d["commande+ligne"]), s(d["agglo"]), s(d["info atelier assemblage"]), "|", m, "|", s(d["commentaire"]).replace("\n", " ")[:35])
