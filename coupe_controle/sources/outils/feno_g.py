import json, sys, re, collections
exec(open(sys.argv[0].replace("feno_g.py", "feno_commun.py")).read())
# 520 pour sur10
print(collections.Counter((s(d["conf_article"])[:6], s(d["agglo"])[:8], d["_f"].split("/")[-1]) for d in L if deb(d)[0] == 520 and num(d["surepaisseur"]) == 10 and (num(d["conf_longueur"]) or 0) + 10 < 520).most_common(8))
fen = [d for d in L if "FENO" in d["_f"].upper()]
# chants des pièces F (décor) : quel bord est sans chant ?
c = collections.Counter()
for d in fen:
    asm = assemblages(d["info atelier assemblage"])
    if len(asm) == 1 and couche(d) == "décor":
        a = asm[0].replace("ETR", "")
        ch = "".join(x if s(d[c2]) else "-" for x, c2 in zip("AvArGD", ["conf_chantavant", "conf_chantarriere", "conf_chantgauche", "conf_chantdroit"]))
        ch = ("av" if s(d["conf_chantavant"]) else "--") + ("ar" if s(d["conf_chantarriere"]) else "--") + ("G" if s(d["conf_chantgauche"]) else "-") + ("D" if s(d["conf_chantdroit"]) else "-")
        nb = re.sub(r"\D", "", a); w = num(d["conf_largeur"])
        c[(asm[0].startswith("ETR"), a[:2], ch, "n°=largeur" if nb and float(nb) == w else "n°≠largeur")] += 1
for k, v in sorted(c.items(), key=lambda kv: -kv[1])[:30]: print(v, k)
# protection : fini différent du décor ?
grp = collections.defaultdict(dict)
for d in fen: grp[(d["_f"], s(d["commande+ligne"]))].setdefault(couche(d), d)
p = collections.Counter(); ex = {}
for k, g in grp.items():
    if "protection" in g and "décor" in g:
        pr, de = g["protection"], g["décor"]
        dl = num(pr["conf_longueur"]) - num(de["conf_longueur"]); dw = num(pr["conf_largeur"]) - num(de["conf_largeur"])
        kk = (k[0].split("/")[-1], "%+g x %+g" % (dl, dw)); p[kk] += 1; ex.setdefault(kk, (k[1], s(de["info atelier assemblage"]), s(de["agglo"])))
for k, v in sorted(p.items()): print(v, k, ex[k])
