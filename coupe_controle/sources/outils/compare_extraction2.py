import sys, collections, re, openpyxl
def lire(p):
    ws = openpyxl.load_workbook(p, data_only=False).worksheets[0]
    rows = [[c.value for c in r] for r in ws.iter_rows()]
    while rows and all(v is None for v in rows[-1]): rows.pop()
    return rows
def s(v): return "" if v is None else re.sub(r"\.0$", "", str(v).strip())
ro, rc = lire(sys.argv[1]), lire(sys.argv[2]); e = ro[0]; I = {n: i for i, n in enumerate(e)}
def g(r, n): return s(r[I[n]])
print("--- CVC26100772 dans l'origine / le corrigé")
for nom, rows in (("orig", ro), ("corr", rc)):
    for i, r in enumerate(rows[1:], 2):
        if g(r, "conf_commande") == "CVC26100772": print(nom, i, g(r, "conf_ligne"), g(r, "commande+ligne"), g(r, "agglo"), g(r, "conf_longueur"), g(r, "conf_largeur"), g(r, "longueur"), g(r, "largeur"), g(r, "LongueurxLargeur debit"), g(r, "info atelier assemblage"), g(r, "commentaire"))
print("--- -PF : par clé, décor couleur orig -> corr, protection orig -> corr, commentaire")
def par_cle(rows):
    d = collections.defaultdict(dict)
    for r in rows[1:]:
        a = g(r, "agglo"); c = "décor" if a.startswith(("FENO", "COM")) else "protection" if a.startswith("PROTECTION") else "support"
        d[g(r, "commande+ligne")][c] = r
    return d
do, dc = par_cle(ro), par_cle(rc)
for k in sorted(set(do) | set(dc)):
    o, c = do.get(k, {}), dc.get(k, {})
    lo = [(x, g(o[x], "agglo"), g(o[x], "coloris"), g(o[x], "coloris_inf")) for x in sorted(o)]
    lc = [(x, g(c[x], "agglo"), g(c[x], "coloris"), g(c[x], "coloris_inf")) for x in sorted(c)]
    if lo != lc:
        com = g((c.get("décor") or c.get("support") or list(c.values())[0]), "commentaire") if c else ""
        print(k, "|", g((o.get("décor") or {}) and o["décor"], "info atelier assemblage") if o.get("décor") else "", "|", com.replace("\n", " ")[:20])
        print("    orig:", lo); print("    corr:", lc)
print("--- couleurs FENO8 1063 / 1136 dans le corrigé :", collections.Counter((g(r, "agglo"), g(r, "coloris")) for r in rc[1:] if g(r, "coloris").split("-")[0] in ("1063", "1136")))
print("--- ordre : origine trié par ?", [g(r, "agglo") for r in ro[1:15]])
print("    corrigé :", [g(r, "agglo") for r in rc[1:15]])
