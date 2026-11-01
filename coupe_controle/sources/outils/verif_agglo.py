import sys, re, collections, openpyxl
ext, sen, main = sys.argv[1:4]
def lire(p):
    ws = openpyxl.load_workbook(p).worksheets[0]
    e = [c.value for c in ws[1]]; I = {n: i + 1 for i, n in enumerate(e)}
    rows = []
    for r in range(2, ws.max_row + 1):
        if ws.cell(r, I["commande+ligne"]).value is None: continue
        f = ws.cell(r, 1).fill
        rows.append({n: ws.cell(r, I[n]).value for n in e if n} | {"_r": r, "_fill": f.fgColor.rgb if f.fill_type == "solid" else None})
    return rows
def s(v): return "" if v is None else re.sub(r"\.0$", "", str(v).strip())
X, S, M = lire(ext), lire(sen), lire(main)
assert len(X) == len(S) == len(M)
c = collections.Counter(); diff = collections.defaultdict(list)
for x, y, m in zip(X, S, M):
    assert s(x["commande+ligne"]) == s(y["commande+ligne"]) == s(m["commande+ligne"])
    for col in ("largeur", "commentaire", "coloris_inf"):
        if s(y[col]) == s(m[col]): c[(col, "identique")] += 1
        else: c[(col, "différent")] += 1; diff[col].append((s(y["commande+ligne"]), s(y["agglo"]), s(y["coloris"]), s(y["idPlan"]), "extraction", s(x[col]), "Sentinelle", s(y[col]), "main", s(m[col])))
    # jaune = largeur changée par Sentinelle
    c[("jaune ok", (y["_fill"] == "FFFFFF00") == (s(x["largeur"]) != s(y["largeur"])))] += 1
    if s(x["largeur"]) != s(y["largeur"]): c[("élargie de", float(y["largeur"]) - float(x["largeur"]) <= 60)] += 1
for k, v in sorted(c.items(), key=str): print(v, k)
for col, l in diff.items():
    print("==", col, len(l))
    for d in l[:40]: print("   ", d)
# règle des 6 cm : dans chaque groupe, toutes les pièces d'une même largeur finale viennent de largeurs à 60 mm ou moins
g = collections.defaultdict(lambda: collections.defaultdict(list))
for x, y in zip(X, S):
    if s(y["idPlan"]) == "ban" and re.match(r"SAG(2[8-9]|[3-9]\d)", s(y["agglo"])):
        g[(s(y["agglo"]), s(y["coloris"]), s(y["coloris_inf"]))][float(y["largeur"])].append(float(x["largeur"]))
viol = [(k, w, v) for k, d in g.items() for w, v in d.items() if w - min(v) > 60]
print("règle des 6 cm respectée :", not viol, viol[:3])
