"""Simulation : harmoniser les largeurs de débit (surcotes) des pièces en 28, 38 et plus.
Groupes : même agglo (épaisseur) + même couleur dessus + même couleur dessous. Dans un groupe, les pièces
dont les largeurs sont à 60 mm ou moins les unes des autres prennent la plus grande largeur.
Découpage optimal : le moins de largeurs différentes possible, puis le moins de mm ajoutés."""
import json, sys, re, collections
exec(open(sys.argv[0].replace("bandes_b.py", "feno_commun.py")).read())
f0 = sys.argv[2]; ECART = 60
lan = [d for d in L if d["_f"].endswith(f0)]
def epais_agglo(a):
    m = re.match(r"SAG(\d+)", a); return int(m.group(1)) if m else 0
def partition(ws):
    u = sorted(set(ws)); n = len(u)
    best = [(0, 0, None)] + [None] * n  # (nb groupes, mm ajoutés, début)
    for j in range(1, n + 1):
        for i in range(j):
            if u[j - 1] - u[i] > ECART: continue
            add = sum((u[j - 1] - w) * ws.count(w) for w in u[i:j])
            cand = (best[i][0] + 1, best[i][1] + add, i)
            if best[j] is None or cand[:2] < best[j][:2]: best[j] = cand
    groupes = []; j = n
    while j > 0:
        i = best[j][2]; groupes.append(u[i:j]); j = i
    return {w: g[-1] for g in groupes for w in g}
for filtre in ("ban", "tous"):
    grp = collections.defaultdict(list)
    for d in lan:
        a = s(d["agglo"])
        if epais_agglo(a) < 28: continue
        if filtre == "ban" and s(d["idPlan"]) != "ban": continue
        el, ew = deb(d)
        if ew is None: continue
        grp[(a, s(d["coloris"]), s(d["coloris_inf"]))].append((ew, val(d["largeur"], d), d))
    tot = collections.Counter()
    print(f"===== {f0} — pièces : {'idPlan ban seulement' if filtre == 'ban' else 'toutes'}")
    for k, xs in sorted(grp.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        ws = [x[0] for x in xs]; cible = partition(ws)
        chg = [(w, cible[w]) for w in ws if cible[w] != w]
        main = [(x[0], x[1]) for x in xs if x[0] != x[1]]
        tot["pièces"] += len(ws); tot["élargies Sentinelle"] += len(chg); tot["mm ajoutés"] += sum(b - a for a, b in chg)
        tot["largeurs avant"] += len(set(ws)); tot["largeurs après"] += len(set(cible.values()))
        tot["élargies à la main"] += len(main); tot["largeurs à la main"] += len({x[1] for x in xs})
        if chg or main:
            print(f"  {k}: avant {sorted(ws)}")
            print(f"      Sentinelle -> {sorted(cible[w] for w in ws)}   | à la main -> {sorted(x[1] for x in xs)}")
    print("  TOTAL", dict(tot))
