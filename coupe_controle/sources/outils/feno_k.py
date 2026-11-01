import json, sys, re, collections
exec(open(sys.argv[0].replace("feno_k.py", "feno_commun.py")).read())
fen = [d for d in L if "FENO" in d["_f"].upper()]
cles = collections.defaultdict(list)
for d in fen: cles[(d["_f"].split("/")[-1], s(d["commande+ligne"]))].append(d)
bilan = collections.defaultdict(collections.Counter); details = []
for (f, k), ds in sorted(cles.items()):
    asm = assemblages(ds[0]["info atelier assemblage"]); nL = sum(1 for x in asm if x[0] == "L")
    if not nL: continue
    etat = []
    for d in sorted(ds, key=couche):
        sp = num(d["surepaisseur"]) or 0; el, ew = deb(d); E = num(d["conf_longueur"]); G = val(d["longueur"], d)
        if el is None or E is None or G is None: etat.append("illisible"); continue
        orig = el - sp
        eE = orig + 10 * nL
        eG = eE if couche(d) == "protection" else eE + sp + 25
        okE = abs(E - eE) < .1; okG = abs(G - eG) < .1
        etat.append((couche(d), s(d["agglo"]), orig, E, eE, G, eG, okE, okG))
    tout = all(isinstance(e, tuple) and e[7] and e[8] for e in etat)
    sansE = all(isinstance(e, tuple) and abs(e[3] - e[2]) < .1 for e in etat)
    cat = "conforme" if tout else "fini non corrigé (+10 oublié)" if sansE else "écart"
    bilan[f][cat] += 1
    if not tout: details.append((f, k, s(ds[0]["info atelier assemblage"]), cat, etat))
for f in sorted(bilan, key=lambda x: re.sub(r"\D", "", x)[:4]): print(f, dict(bilan[f]))
print()
for f, k, a, cat, etat in details:
    if re.sub(r"\D", "", f)[2:4] in ("31", "44", "45", "46"):
        print(f, k, a, "->", cat)
        for e in etat:
            if isinstance(e, tuple): print("     %-10s %-13s orig %g | fini %g (attendu %g) | débit %g (attendu %g)" % e[:7])
