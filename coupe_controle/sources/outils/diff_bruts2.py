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
    return [{e[i]: r[i] if i < len(r) else None for i in range(len(e)) if e[i]} for r in rows[1:]]
retirees = collections.Counter(); ajoutees = collections.Counter(); ex_r = []; ex_a = []
idplan = []; qte = []
for b, c in sorted(paires.items()):
    B, C = lire(os.path.join(sp, "bruts", b)), lire(os.path.join(sp, "corriges", c))
    kb = collections.Counter((s(d["commande+ligne"]), s(d["agglo"])) for d in B)
    kc = collections.Counter((s(d["commande+ligne"]), s(d["agglo"]).replace("-PF", "").replace("HYBL", "HYBR")) for d in C)
    kb2 = collections.Counter((k, a.replace("-PF", "").replace("HYBL", "HYBR")) for (k, a) in kb.elements())
    for (k, a), n in kb2.items():
        m = kc.get((k, a), 0)
        if n > m:
            d = next(x for x in B if s(x["commande+ligne"]) == k)
            doublon = n > 1 and m >= 1
            cat = "doublon retiré" if doublon else "pièce retirée"
            retirees[(cat, re.sub(r"\d.*", "", s(d["conf_article"])), s(d["comprod_lancement"]) == b[:-5])] += n - m
            if len(ex_r) < 12: ex_r.append((b, k, a, s(d["conf_article"]), n, "->", m, s(d["commentaire"])[:20], s(d["comprod_lancement"])))
    for (k, a), m in kc.items():
        n = kb2.get((k, a), 0)
        if m > n:
            ajoutees[re.sub(r"\d.*", "", s(next(x for x in C if s(x["commande+ligne"]) == k)["conf_article"]))] += m - n
            if len(ex_a) < 6: ex_a.append((b, c, k, a, n, "->", m))
    db = {(s(d["commande+ligne"]), s(d["agglo"])): d for d in B}
    for d in C:
        x = db.get((s(d["commande+ligne"]), s(d["agglo"])))
        if not x: continue
        if s(x.get("idPlan")) != s(d.get("idPlan")): idplan.append((b, s(d["conf_article"]), s(x.get("idPlan")) or "vide", s(d.get("idPlan")) or "vide", s(d.get("conf_largeur")), s(d.get("largeur"))))
        if s(x.get("comdet_qte")) != s(d.get("comdet_qte")): qte.append((b, s(d["commande+ligne"]), s(d["conf_article"]), s(x.get("comdet_qte")), s(d.get("comdet_qte"))))
print("LIGNES RETIRÉES À LA MAIN :", sum(retirees.values()))
for k, v in retirees.most_common(12): print("  ", v, k)
for e in ex_r: print("   ex", e)
print("LIGNES AJOUTÉES À LA MAIN :", sum(ajoutees.values()), dict(ajoutees.most_common(8))); [print("   ex", e) for e in ex_a]
print("IDPLAN CHANGÉ :", len(idplan)); [print("   ", e) for e in idplan[:16]]
print("QUANTITÉ CHANGÉE :", len(qte)); [print("   ", e) for e in qte[:10]]
