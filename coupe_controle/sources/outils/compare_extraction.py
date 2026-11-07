"""Compare le fichier d'extraction d'origine et le LAN retouché à la main : lignes, ordre, cellules changées."""
import sys, collections, re, openpyxl
def lire(p):
    wb = openpyxl.load_workbook(p, data_only=False)
    ws = wb.worksheets[0]
    rows = [[c.value for c in r] for r in ws.iter_rows()]
    while rows and all(v is None for v in rows[-1]): rows.pop()
    return wb.sheetnames, ws.max_row, ws.max_column, rows
def s(v): return "" if v is None else re.sub(r"\.0$", "", str(v).strip())
no, mo, co, ro = lire(sys.argv[1]); nc, mc, cc, rc = lire(sys.argv[2])
print("origine :", no, "lignes non vides", len(ro), "max_row", mo, "colonnes", co)
print("corrigé :", nc, "lignes non vides", len(rc), "max_row", mc, "colonnes", cc)
eo, ec = ro[0], rc[0]
print("entêtes identiques :", eo[:37] == ec[:37]);
if eo[:37] != ec[:37]: print([(i, a, b) for i, (a, b) in enumerate(zip(eo, ec)) if a != b])
iK = eo.index("agglo"); iC = eo.index("commande+ligne")
def cle(r): return (s(r[iC]), s(r[iK]))
do = collections.defaultdict(list); dc = collections.defaultdict(list)
for i, r in enumerate(ro[1:], 2): do[cle(r)].append((i, r))
for i, r in enumerate(rc[1:], 2): dc[cle(r)].append((i, r))
print("clés seulement dans l'origine :", [k for k in do if k not in dc])
print("clés seulement dans le corrigé :", [k for k in dc if k not in do])
print("doublons origine :", [k for k, v in do.items() if len(v) > 1], " corrigé :", [k for k, v in dc.items() if len(v) > 1])
# ordre
ordre_o = [cle(r) for r in ro[1:]]; ordre_c = [cle(r) for r in rc[1:]]
print("même ordre :", ordre_o == ordre_c, "| corrigé trié par agglo :", [s(r[iK]) for r in rc[1:]] == sorted([s(r[iK]) for r in rc[1:]]))
# cellules changées
chg = collections.Counter(); det = []
for k in do:
    if k not in dc: continue
    a = do[k][0][1]; b = dc[k][0][1]
    for j in range(37):
        va, vb = a[j] if j < len(a) else None, b[j] if j < len(b) else None
        if s(va) != s(vb):
            chg[eo[j]] += 1; det.append((k, eo[j], va, vb))
        elif type(va) != type(vb) and not (va is None or vb is None):
            chg["(type seul) " + str(eo[j])] += 1
print("\ncolonnes changées :", dict(chg))
for x in det: print("  ", x)
