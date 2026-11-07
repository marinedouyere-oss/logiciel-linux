"""Vérifie l'harmonisation des bandes (règles de l'atelier) : brut → sortie Sentinelle.
- seules les largeurs bougent (et les autres corrections agglo connues) ;
- une pièce modifiée prend la largeur d'une autre pièce du groupe : +60 mm au plus, -2 mm au plus ;
- une pièce modifiée peut se coupler avec une autre pièce de même largeur finale (longueurs ≤ 4060) ;
- pas plus de bandes après qu'avant (3 pièces et 4060 mm au plus par bande) ; lignes modifiées en jaune.
Usage : verif_bandes4.py <dossier bruts> <dossier sorties>"""
import sys, os, glob, re, collections, openpyxl
bruts, sorties = sys.argv[1:3]
def s(v):
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return "" if v is None else str(v).strip()
def num(v):
    try: return float(v)
    except: return None
def lire(p):
    ws = openpyxl.load_workbook(p).worksheets[0]
    e = [s(c.value) for c in ws[1]]; I = {k: i + 1 for i, k in enumerate(e)}
    rows = {}
    for r in range(2, ws.max_row + 1):
        if ws.cell(r, I["commande+ligne"]).value is None: continue
        f = ws.cell(r, 1).fill
        rows[r] = {k: s(ws.cell(r, I[k]).value) for k in e if k} | {"_jaune": f.fill_type == "solid" and f.fgColor.rgb == "FFFFFF00", "_orange": f.fill_type == "solid" and f.fgColor.rgb == "FFFFC000", "_rouge": f.fill_type == "solid" and f.fgColor.rgb == "FFFF0000"}
    return e, rows
def bandes(longueurs):
    b = []
    for L in sorted(longueurs, reverse=True):
        for x in b:
            if x[0] < 3 and x[1] + L <= 4060: x[0] += 1; x[1] += L; break
        else: b.append([1, L])
    return len(b)
def total_bandes(pieces, cle):
    par = collections.defaultdict(list)
    for p in pieces: par[p[cle]] += [p["L"] if p["L"] is not None else 4060] * p["q"]
    return sum(bandes(v) for v in par.values())
T = collections.Counter(); pb = []
for p in sorted(glob.glob(os.path.join(bruts, "*.xlsx"))):
    q = os.path.join(sorties, os.path.basename(p).replace(".xlsx", "_sentinelle.xlsx"))
    if not os.path.exists(q): pb.append((os.path.basename(p), "pas de sortie")); continue
    e, A = lire(p); _, B = lire(q); nom = os.path.basename(p)
    for r in A:
        for k in e:
            if k and A[r][k] != B[r][k]:
                if k == "largeur": pass
                elif k == "coloris" and A[r][k].upper() == "BRUT" and B[r][k] == "": pass
                elif k == "coloris_inf" and B[r][k] == "RCB-CRED14": pass
                elif k == "coloris_inf" and A[r][k].upper() == "RCB_B999_PORTES" and B[r][k] == "RCB_0003_PORTES": T["portes B999 → 0003"] += 1
                elif k == "commentaire" and B[r][k] == "BAZ" and A[r][k] == "": pass
                else: pb.append((nom, r, k, A[r][k], B[r][k]))
        jaune = A[r]["_jaune"] or A[r]["largeur"] != B[r]["largeur"] or A[r]["coloris"].upper() == "BRUT" or A[r]["Type chant"].upper() == "BRUT" or bool(re.search(r"CHANTS?\s+BRUTS?", A[r]["commentaire"], re.I))
        porte = A[r]["coloris_inf"].upper() == "RCB_B999_PORTES"
        if B[r]["_rouge"]: continue  # erreur (surcote > 61 mm, belle face vide) : le rouge passe avant tout (verif_rouges.py)
        if porte and not B[r]["_orange"]: pb.append((nom, r, "porte pas en orange"))
        if not porte and B[r]["_jaune"] != jaune: pb.append((nom, r, "jaune", B[r]["_jaune"], jaune))
    g = collections.defaultdict(list)
    for r in A:
        a = A[r]["agglo"].upper(); m = re.match(r"SAG(\d+)", a)
        if m and int(m.group(1)) >= 28 and A[r]["idPlan"].lower() == "ban" and num(A[r]["largeur"]) is not None:
            g[(a, A[r]["coloris"], A[r]["coloris_inf"])].append({"r": r, "x": num(A[r]["largeur"]), "y": num(B[r]["largeur"]), "L": num(A[r]["longueur"]), "q": max(1, round(num(A[r]["comdet_qte"]) or 1))})
    for k, ps in g.items():
        largeurs = {p["x"] for p in ps}
        av, ap = total_bandes(ps, "x"), total_bandes(ps, "y")
        T["pièces"] += len(ps); T["bandes avant"] += av; T["bandes après"] += ap
        if ap > av: pb.append((nom, k, "plus de bandes", av, ap))
        for p in ps:
            if p["y"] == p["x"]: continue
            T["modifiées"] += 1
            if p["y"] < p["x"]: T["baissées (tolérance)"] += 1
            if p["y"] not in largeurs or p["y"] - p["x"] > 60 or p["x"] - p["y"] > 2: pb.append((nom, p["r"], "largeur hors règle", p["x"], p["y"]))
            if p["L"] is None or not any(o is not p and o["y"] == p["y"] and o["L"] is not None and p["L"] + o["L"] <= 4060 for o in ps):
                pb.append((nom, p["r"], "modifiée sans pouvoir se coupler", p["x"], p["y"], p["L"]))
        if any(p["y"] != p["x"] for p in ps) and ap == av: T["groupes modifiés sans bande gagnée"] += 1
print(dict(T)); print("problèmes :", len(pb)); [print("  ", x) for x in pb[:15]]
