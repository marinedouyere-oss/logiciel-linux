import sys, os, glob, re, math, collections, openpyxl
bruts, sorties = sys.argv[1:3]
def s(v):
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return "" if v is None else str(v).strip()
def lire(p):
    ws = openpyxl.load_workbook(p).worksheets[0]
    e = [s(c.value) for c in ws[1]]; I = {k: i + 1 for i, k in enumerate(e)}
    rows = {}
    for r in range(2, ws.max_row + 1):
        if ws.cell(r, I["commande+ligne"]).value is None: continue
        f = ws.cell(r, 1).fill
        rows[r] = {k: s(ws.cell(r, I[k]).value) for k in e if k} | {"_jaune": f.fill_type == "solid" and f.fgColor.rgb == "FFFFFF00"}
    return e, rows
T = collections.Counter(); pb = []
for p in sorted(glob.glob(os.path.join(bruts, "*.xlsx"))):
    q = os.path.join(sorties, os.path.basename(p).replace(".xlsx", "_sentinelle.xlsx"))
    e, A = lire(p); _, B = lire(q)
    # colonnes changées
    for r in A:
        for k in e:
            if k and A[r][k] != B[r][k]:
                if k == "largeur": pass
                elif k == "coloris" and A[r][k].upper() == "BRUT" and B[r][k] == "": T["BRUT retiré"] += 1
                elif k == "coloris_inf" and B[r][k] == "RCB-CRED14": pass
                elif k == "commentaire" and B[r][k] == "BAZ" and A[r][k] == "": pass
                else: pb.append((os.path.basename(p), r, k, A[r][k], B[r][k]))
        jaune_attendu = A[r]["largeur"] != B[r]["largeur"] or A[r]["coloris"].upper() == "BRUT" or A[r]["Type chant"].upper() == "BRUT" or bool(re.search(r"CHANTS?\s+BRUTS?", A[r]["commentaire"], re.I))
        if B[r]["_jaune"] != jaune_attendu: pb.append((os.path.basename(p), r, "jaune", B[r]["_jaune"], jaune_attendu))
    # bandes par groupe
    g = collections.defaultdict(list)
    for r in A:
        a = A[r]["agglo"].upper(); m = re.match(r"SAG(\d+)", a)
        if m and int(m.group(1)) >= 28 and A[r]["idPlan"].lower() == "ban" and A[r]["largeur"]:
            g[(a, A[r]["coloris"], A[r]["coloris_inf"])].append((float(A[r]["largeur"]), float(B[r]["largeur"])))
    for k, xs in g.items():
        avant = sum(math.ceil(n / 3) for n in collections.Counter(x for x, _ in xs).values())
        apres = sum(math.ceil(n / 3) for n in collections.Counter(y for _, y in xs).values())
        mod = sum(1 for x, y in xs if y != x)
        T["pièces"] += len(xs); T["bandes avant"] += avant; T["bandes après"] += apres; T["modifiées"] += mod
        if apres > avant: pb.append((os.path.basename(p), k, "plus de bandes", avant, apres))
        if mod and apres == avant: pb.append((os.path.basename(p), k, "modifiées sans bande gagnée", sorted(xs)))
        for x, y in xs:
            if y != x and (y - x > 60 or y < x or y not in {a for a, _ in xs}): pb.append((os.path.basename(p), k, "élargissement", x, y))
print(dict(T)); print("problèmes :", len(pb)); [print("  ", x) for x in pb[:12]]
