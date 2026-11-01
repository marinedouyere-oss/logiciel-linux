import json, sys, re, collections
exec(open(sys.argv[0].replace("agglo_brut.py", "feno_commun.py")).read())
f0 = sys.argv[2]
lan = [d for d in L if d["_f"].endswith(f0)]
print(f0, len(lan), "lignes ; matières :", collections.Counter(s(d["agglo"]) for d in lan).most_common(12))
for mat in ("SAG10HYBR", "SAG12HYBR"):
    ds = [d for d in lan if s(d["agglo"]).startswith(mat)]
    print(f"\n===== {mat} : {len(ds)} lignes")
    for col in ("agglo", "conf_article", "conf_epaisseur", "coloris", "coloris_inf", "surepaisseur", "idPlan", "Type chant", "CBD", "info 2 atelier", "info 3 atelier", "commentaire"):
        print(f"  {col:22s}", collections.Counter(s(d[col])[:25] for d in ds).most_common(8))
    # couleur dessus / dessous
    print("  dessus=dessous ?", collections.Counter("même" if s(d["coloris"]) and s(d["coloris"]) == s(d["coloris_inf"]) else ("RCB*" if s(d["coloris_inf"]).startswith("RCB") else ("vide" if not s(d["coloris_inf"]) else "autre")) for d in ds))
    # débit : fini + sur ? retouches ?
    c = collections.Counter()
    for d in ds:
        fl, fw, sp = num(d["conf_longueur"]), num(d["conf_largeur"]), num(d["surepaisseur"]) or 0
        el, ew = deb(d); gl, gw = val(d["longueur"], d), val(d["largeur"], d)
        if None in (fl, fw, el, ew, gl, gw): c["illisible"] += 1; continue
        c[("L gest%+g final%+g" % (el - fl - sp, gl - el), "l gest%+g final%+g" % (ew - fw - sp, gw - ew))] += 1
    print("  dimensions :", c.most_common(8))
