"""Ce que l'atelier change à la main entre l'extraction brute et le LAN lancé (27 lancements agglo)."""
import sys, os, json, re, collections, openpyxl
sp = sys.argv[1]
paires = {b: c for b, c in json.load(open(os.path.join(sp, "paires.json"))).items() if c}
def s(v):
    if v is None: return ""
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return str(v).strip()
def lire(p):
    ws = openpyxl.load_workbook(p).worksheets[0]
    rows = [[c.value for c in r] for r in ws.iter_rows()]
    rows = [r for r in rows if any(v is not None for v in r)]
    e = [s(x) for x in rows[0]]
    out = collections.defaultdict(list)
    for r in rows[1:]:
        d = {e[i]: r[i] if i < len(r) else None for i in range(len(e)) if e[i]}
        out[(s(d.get("commande+ligne")), s(d.get("agglo")).upper().replace("-PF", "").replace("HYBL", "HYBR"))].append(d)
    return e, out, len(rows) - 1
tot = collections.Counter(); ex = collections.defaultdict(list); lignes = collections.Counter()
stats_sf = collections.Counter(); stats_com = collections.Counter(); stats_larg = collections.Counter()
for b, c in sorted(paires.items()):
    eb, B, nb = lire(os.path.join(sp, "bruts", b)); ec, C, nc = lire(os.path.join(sp, "corriges", c))
    lignes["brut"] += nb; lignes["corrigé"] += nc
    lignes["clés seulement brut"] += sum(len(v) for k, v in B.items() if k not in C)
    lignes["clés seulement corrigé"] += sum(len(v) for k, v in C.items() if k not in B)
    for k in B:
        if k not in C: continue
        for x, y in zip(B[k], C[k]):
            for col in eb:
                if not col or col not in y: continue
                vx, vy = s(x.get(col)), s(y.get(col))
                if vx != vy:
                    tot[col] += 1
                    if len(ex[col]) < 6: ex[col].append((b, k[0], s(x.get("agglo")), s(x.get("conf_article")), vx, "->", vy))
            a = s(x.get("agglo")).upper(); art = s(x.get("conf_article")).upper()
            if a.startswith(("SAG10HYBR", "SAG12HYBR")) and art.startswith("CRED"):
                stats_sf[(art[:6], "CBD" if s(x.get("CBD")) else "-", "brut=" + (s(x.get("coloris_inf")) or "vide"), "main=" + (s(y.get("coloris_inf")) or "vide"))] += 1
            usinage = s(x.get("info 3 atelier")) or any(s(x.get(n)) for n in ("Usinage angle avant gauche", "Usinage angle avant droit", "Usinage angle arrière gauche", "Usinage angle arrière droit"))
            stats_com[("usinage" if usinage else "-", "brut=" + (s(x.get("commentaire"))[:12] or "vide"), "main=" + (s(y.get("commentaire"))[:12] or "vide"))] += 1
            if s(x.get("largeur")) != s(y.get("largeur")):
                try: d = float(s(y.get("largeur"))) - float(s(x.get("largeur")))
                except: d = None
                stats_larg[(s(x.get("idPlan")) or "-", re.sub(r"\d.*", "", art), "%+g" % d if d is not None else "?")] += 1
print("LIGNES", dict(lignes))
print("\nCOLONNES CHANGÉES À LA MAIN (nombre de cellules) :")
for col, n in tot.most_common(): print(f"  {n:5d}  {col}   ex: {ex[col][:3]}")
print("\nSOUS-FACE DES CRÉDENCES (brut -> main) :")
for k, v in stats_sf.most_common(15): print("  ", v, k)
print("\nCOMMENTAIRE (brut -> main) :")
for k, v in stats_com.most_common(15): print("  ", v, k)
print("\nLARGEURS CHANGÉES (idPlan, famille, écart) :")
for k, v in stats_larg.most_common(25): print("  ", v, k)
