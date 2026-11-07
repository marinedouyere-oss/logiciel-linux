"""Vérifie le LAN réécrit par Sentinelle : 1) par rapport à l'extraction d'origine (seules les cellules prévues changent),
2) par rapport au LAN retouché à la main (mêmes valeurs sur les cellules corrigées)."""
import sys, re, collections, zipfile, openpyxl
orig, sortie, main = sys.argv[1:4]
def lire(p):
    ws = openpyxl.load_workbook(p, data_only=False).worksheets[0]
    return ws.title, {(c.row, c.column): c.value for r in ws.iter_rows() for c in r if c.value is not None}, [[c.value for c in r] for r in ws.iter_rows(min_row=1, max_row=1)][0]
def s(v): return "" if v is None else re.sub(r"\.0$", "", str(v).strip())
to, vo, eo = lire(orig); ts, vs, es = lire(sortie)
print("onglet :", to, "->", ts, "| identique :", to == ts)
print("entêtes identiques :", eo == es)
diff = sorted(k for k in set(vo) | set(vs) if s(vo.get(k)) != s(vs.get(k)))
cols = collections.Counter(eo[c - 1] for _, c in diff)
print("cellules changées :", len(diff), dict(cols))
print("lignes : origine", max(r for r, _ in vo), "sortie", max(r for r, _ in vs))
# parties de l'archive
zo, zs = zipfile.ZipFile(orig), zipfile.ZipFile(sortie)
print("parties identiques (noms) :", zo.namelist() == zs.namelist())
for n in zo.namelist():
    if zo.read(n) != zs.read(n): print("   partie changée :", n)
# comparaison avec le fichier retouché à la main
tm, vm, em = lire(main)
I = {n: i + 1 for i, n in enumerate(eo)}
def cle(v, r): return (s(v.get((r, I["commande+ligne"]))), s(v.get((r, I["agglo"]))))
lm = collections.defaultdict(list)
for r in sorted({r for r, _ in vm}):
    if r > 1: lm[cle(vm, r)].append(r)
ok = 0; ecarts = []
for (r, c) in diff:
    k = cle(vs, r)
    rm = lm.get(k) or lm.get((k[0], k[1] + "-PF")) or lm.get((k[0], k[1].replace("HYBL", "HYBR")))
    vmain = vm.get((rm[0], c)) if rm else None
    if isinstance(vmain, str) and vmain.startswith("="):
        m = re.match(r"=E(\d+)\+(\d+)$", vmain); vmain = (vm.get((int(m.group(1)), I["conf_longueur"])) or 0) + int(m.group(2)) if m else vmain
    if s(vmain) == s(vs.get((r, c))): ok += 1
    else: ecarts.append((k, eo[c - 1], s(vo.get((r, c))), "Sentinelle", s(vs.get((r, c))), "à la main", s(vmain)))
print(f"\nmême valeur que le fichier fait à la main : {ok} / {len(diff)}")
for e in ecarts: print("   écart :", e)
