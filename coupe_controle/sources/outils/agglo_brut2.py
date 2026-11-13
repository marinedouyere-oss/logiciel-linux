import json, sys, re, collections
exec(open(sys.argv[0].replace("agglo_brut2.py", "feno_commun.py")).read())
c = collections.defaultdict(collections.Counter); ex = {}
for d in L:
    f = d["_f"]
    if "FENO" in f.upper(): continue
    a = s(d["agglo"])
    if not (a.startswith("SAG10HYBR") or a.startswith("SAG12HYBR")): continue
    art = re.sub(r"\d+$", "", s(d["conf_article"])) + s(d["conf_epaisseur"])
    si = s(d["coloris_inf"]); col = s(d["coloris"])
    k = "vide" if not si else si if si.upper().startswith("RCB") else ("= dessus" if si == col else "autre couleur")
    c[(a, art)][k] += 1
    ex.setdefault((a, art, k), (f.split("/")[-1], s(d["commande+ligne"]), col, si, s(d["commentaire"])[:25]))
for k in sorted(c): print(k, sum(c[k].values()), dict(c[k].most_common()))
print()
for k, v in sorted(ex.items()):
    if k[2] in ("vide", "autre couleur", "= dessus"): print("  ex", k, v)
