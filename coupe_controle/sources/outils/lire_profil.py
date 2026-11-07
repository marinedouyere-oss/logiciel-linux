# Temps propre (self) et cumulé par fonction d'un profil CPU Chrome.
import sys, json, collections
p = json.load(open(sys.argv[1]))
nodes = {n["id"]: n for n in p["nodes"]}
dt = collections.Counter()
for i, s in enumerate(p["samples"]):
    dt[s] += p["timeDeltas"][i] if i < len(p["timeDeltas"]) else 0
parent = {}
for n in p["nodes"]:
    for c in n.get("children", []): parent[c] = n["id"]
nom = lambda n: f'{n["callFrame"]["functionName"] or "(anonyme)"}:{n["callFrame"]["lineNumber"]}'
propre = collections.Counter(); cumul = collections.Counter()
for nid, t in dt.items():
    propre[nom(nodes[nid])] += t
    vus = set(); x = nid
    while x is not None:
        k = nom(nodes[x])
        if k not in vus: cumul[k] += t; vus.add(k)
        x = parent.get(x)
total = sum(dt.values())
print(f"total {total/1e6:.1f} s")
print("== propre"); [print(f"{t/1e6:7.2f} s  {k}") for k, t in propre.most_common(25)]
print("== cumulé"); [print(f"{t/1e6:7.2f} s  {k}") for k, t in cumul.most_common(45)]
