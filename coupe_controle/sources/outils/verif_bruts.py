import sys, os, glob, re, collections, openpyxl
bruts, sorties = sys.argv[1:3]
def lire(p):
    wb = openpyxl.load_workbook(p); ws = wb.worksheets[0]
    cells = {}; fills = {}
    for row in ws.iter_rows():
        for c in row:
            if c.value is not None: cells[(c.row, c.column)] = c.value
            if c.fill and c.fill.fill_type == "solid": fills[(c.row, c.column)] = c.fill.fgColor.rgb
    return ws.title, ws.max_row, cells, fills, [ws.cell(1, j).value for j in range(1, ws.max_column + 1)]
def s(v):
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return "" if v is None else str(v).strip()
tot = collections.Counter(); pb = []
for p in sorted(glob.glob(os.path.join(bruts, "*.xlsx"))):
    q = os.path.join(sorties, os.path.basename(p).replace(".xlsx", "_sentinelle.xlsx"))
    ta, ra, ca, fa, e = lire(p); tb, rb, cb, fb, _ = lire(q)
    I = {n: i + 1 for i, n in enumerate(e)}
    if ta != tb or ra != rb: pb.append((p, "onglet/lignes"))
    chg = [k for k in set(ca) | set(cb) if s(ca.get(k)) != s(cb.get(k))]
    cols = collections.Counter(e[c - 1] for _, c in chg)
    autres = [c for c in cols if c not in ("largeur", "coloris_inf", "commentaire")]
    if autres: pb.append((p, "colonnes inattendues", autres))
    tot.update(cols)
    jaunes = {r for (r, c), v in fb.items() if v == "FFFFFF00"} - {r for (r, c), v in fa.items() if v == "FFFFFF00"}
    larg = {r for (r, c) in chg if c == I["largeur"]}
    if jaunes != larg: pb.append((p, "jaunes ≠ élargies", len(jaunes), len(larg)))
    for r in larg:
        d = float(s(cb[(r, I["largeur"])])) - float(s(ca[(r, I["largeur"])]))
        if not (0 < d <= 60): pb.append((p, "élargissement hors 0–60", r, d))
        tot["mm"] += d
    tot["lignes jaunes"] += len(jaunes)
    for (r, c) in chg:
        if c == I["coloris_inf"]:
            if s(cb[(r, c)]) != "RCB-CRED14" or s(ca.get((r, c))) not in ("", "RCB") or s(ca.get((r, I["CBD"]))): pb.append((p, "sous-face", r, s(ca.get((r, c))), s(cb[(r, c)])))
        if c == I["commentaire"] and (s(cb[(r, c)]) != "BAZ" or s(ca.get((r, c)))): pb.append((p, "commentaire", r))
print("fichiers :", len(glob.glob(os.path.join(bruts, "*.xlsx"))), "| cellules changées par colonne :", dict(tot))
print("problèmes :", len(pb)); [print("  ", x) for x in pb[:15]]
