import sys, re, collections, openpyxl
def lire(p):
    ws = openpyxl.load_workbook(p).worksheets[0]
    rows = [[c.value for c in r] for r in ws.iter_rows()]
    while rows and all(v is None for v in rows[-1]): rows.pop()
    return rows
def s(v): return "" if v is None else re.sub(r"\.0$", "", str(v).strip())
a, m = lire(sys.argv[1]), lire(sys.argv[2])
e = a[0]; I = {n: i for i, n in enumerate(e)}
def norm_agglo(x): return s(x).upper().replace("-PF", "").replace("HYBL", "HYBR")
def cle(r): return (s(r[I["commande+ligne"]]), norm_agglo(r[I["agglo"]]))
da = collections.defaultdict(list); dm = collections.defaultdict(list)
for r in a[1:]: da[cle(r)].append(r)
for r in m[1:]: dm[cle(r)].append(r)
print("lignes Sentinelle", len(a) - 1, "| à la main", len(m) - 1)
print("seulement Sentinelle :", [k for k in da if k not in dm])
print("seulement à la main :", [k for k in dm if k not in da])
c = collections.Counter(); det = collections.defaultdict(list)
for k in da:
    if k not in dm: continue
    ra, rm = da[k][0], dm[k][0]
    for j, n in enumerate(e):
        va, vm = s(ra[j]), s(rm[j])
        if isinstance(rm[j], str) and rm[j].startswith("="):
            mm = re.match(r"=E(\d+)\+(\d+)$", rm[j]); vm = s((rm[I["conf_longueur"]] or 0) + int(mm.group(2))) if mm else vm
        if va != vm:
            c[n] += 1; det[n].append((k, va, vm, s(ra[I["info atelier assemblage"]]), s(ra[I["commentaire"]])[:20]))
print("écarts par colonne :", dict(c))
for n, l in det.items():
    print("==", n)
    for x in l: print("    ", x)
