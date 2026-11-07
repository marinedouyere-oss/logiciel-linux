import json, sys, re, collections
exec(open(sys.argv[0].replace("feno_j.py", "feno_commun.py")).read())
fen = [d for d in L if "FENO" in d["_f"].upper()]
print("lignes", len(fen), "fichiers", len({d["_f"] for d in fen}))
cles = collections.defaultdict(list)
for d in fen: cles[(d["_f"], s(d["commande+ligne"]))].append(d)
cat = collections.Counter(); modif = collections.Counter()
for k, ds in cles.items():
    asm = assemblages(ds[0]["info atelier assemblage"])
    t = "L" if any(x[0] == "L" for x in asm) else "ETR" if asm and all(x.startswith("ETR") for x in asm) else "F" if asm else "aucun"
    cat[t] += 1
    ch = any((val(d["longueur"], d) or 0) - num(d["conf_longueur"]) - (num(d["surepaisseur"]) or 0) > 0.1 and couche(d) != "protection" for d in ds)
    modif[(t, ch)] += 1
print("pièces (clés):", sum(cat.values()), dict(cat)); print("rallongées:", dict(modif))
