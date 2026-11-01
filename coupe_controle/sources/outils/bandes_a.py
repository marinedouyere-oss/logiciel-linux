import json, sys, re, collections
exec(open(sys.argv[0].replace("bandes_a.py", "feno_commun.py")).read())
f0 = sys.argv[2]
lan = [d for d in L if d["_f"].endswith(f0)]
ep = lambda d: num(d["conf_epaisseur"]) or 0
cand = [d for d in lan if ep(d) >= 28 and not s(d["agglo"]).startswith("PROTECTION")]
print(f0, len(lan), "lignes ;", len(cand), "en 28 et plus ; idPlan :", collections.Counter(s(d["idPlan"]) for d in cand))
grp = collections.defaultdict(list)
for d in cand: grp[(s(d["agglo"]), s(d["coloris"]), s(d["coloris_inf"]), s(d["idPlan"]))].append(d)
for k, ds in sorted(grp.items(), key=lambda kv: (-len(kv[1]), kv[0])):
    rows = []
    for d in ds:
        el, ew = deb(d); gw = val(d["largeur"], d); fw = num(d["conf_largeur"])
        rows.append((ew, gw, fw, s(d["commande+ligne"])[-9:], s(d["conf_article"]), s(d["surepaisseur"])))
    rows.sort()
    larg = sorted({r[1] for r in rows})
    print(f"{k} n={len(ds)} largeurs finales={larg}")
    print("     (débit gestion -> final) :", [f"{r[0]:g}->{r[1]:g}" for r in rows])
