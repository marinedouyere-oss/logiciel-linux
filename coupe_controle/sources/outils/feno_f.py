import json, sys, re, collections
exec(open(sys.argv[0].replace("feno_f.py", "feno_commun.py")).read())
# 1) Toutes les familles : effet des assemblages L sur gestion et final (hors FENO)
c = collections.defaultdict(collections.Counter)
for d in L:
    fl, sp = num(d["conf_longueur"]), num(d["surepaisseur"]) or 0
    el, ew = deb(d); gl = val(d["longueur"], d)
    if None in (fl, el, gl): continue
    asm = assemblages(d["info atelier assemblage"])
    if not asm: continue
    nL = sum(1 for x in asm if x[0] == "L"); nF = sum(1 for x in asm if x[0] == "F"); nE = sum(1 for x in asm if x.startswith("ETR"))
    fam = "FENO" if "FENO" in d["_f"].upper() else "autres"
    c[(fam, "L%d F%d ETR%d" % (nL, nF, nE))]["gest=fini+sur%+g / final=gest%+g" % (el - fl - sp, gl - el)] += 1
for k in sorted(c): print(k, dict(c[k].most_common(8)))
# 2) Longueur minimum : débit gestion quand fini+sur est petit
m = collections.Counter()
for d in L:
    fl, sp = num(d["conf_longueur"]), num(d["surepaisseur"]); el, ew = deb(d)
    if None in (fl, sp, el) or str(d["agglo"]).startswith("PROTECTION"): continue
    if fl + sp < 540: m[("fini+sur<540", "sur%g" % sp, "gest=%g" % el if el >= fl + sp + .1 else "gest=fini+sur")] += 1
print("\nLongueur mini :"); [print("  ", k, v) for k, v in sorted(m.items())]
# 3) Largeur : pièces étroites
w = collections.Counter(); ex = {}
for d in L:
    fw, sp = num(d["conf_largeur"]), num(d["surepaisseur"]) or 0; el, ew = deb(d); gw = val(d["largeur"], d)
    if None in (fw, ew, gw): continue
    if fw + sp < 230 or gw != ew:
        k = ("FENO" if "FENO" in d["_f"].upper() else "autres", "étroite" if fw + sp < 230 else "large", "gest=fini+sur" if abs(ew - fw - sp) < .1 else "gest%+g" % (ew - fw - sp), "final=%g" % gw if gw != ew else "final=gest", s(d["idPlan"]))
        w[k] += 1; ex.setdefault(k, (d["_f"].split("/")[-1], d["_r"], s(d["conf_article"]), fw, ew, gw))
print("\nLargeurs :"); [print("  ", v, k, ex[k]) for k, v in sorted(w.items(), key=lambda kv: -kv[1])[:40]]
