import json, sys, re, collections
exec(open(sys.argv[0].replace("feno_i.py", "feno_commun.py")).read())
fen = [d for d in L if "FENO" in d["_f"].upper()]
c = collections.defaultdict(collections.Counter); cw = collections.defaultdict(collections.Counter)
for d in fen:
    asm = assemblages(d["info atelier assemblage"]); nL = sum(1 for x in asm if x[0] == "L")
    fl, fw, sp = num(d["conf_longueur"]), num(d["conf_largeur"]), num(d["surepaisseur"]) or 0
    gl, gw = val(d["longueur"], d), val(d["largeur"], d)
    if gl is None or couche(d) == "protection": continue
    f = d["_f"].split("/")[-1].replace(".xlsx", "")
    c[(f, "L%d" % nL)]["%+g" % (gl - fl - sp)] += 1
    if gw is not None: cw[(f, "L%d" % nL)]["%+g" % (gw - fw - sp)] += 1
for k in sorted(c, key=lambda k: (k[1], re.sub(r"\D", "", k[0])[:4])):
    if k[1] != "L0": print(k, "longueur:", dict(c[k].most_common(5)), " largeur:", dict(cw[k].most_common(3)))
print(); [print(k, "longueur:", dict(c[k].most_common(4)), " largeur:", dict(cw[k].most_common(4))) for k in sorted(c) if k[1] == "L0"]
