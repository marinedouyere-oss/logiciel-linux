import openpyxl, sys, glob, os, collections
def T(v):
    return str(int(v)) if isinstance(v, float) and v.is_integer() else ('' if v is None else str(v).strip())
racine = sys.argv[1]
agglos = collections.Counter(); entetes = collections.Counter(); sans = []
for f in sorted(glob.glob(racine + '/**/*.xlsx', recursive=True)):
    if os.path.basename(f).startswith('~$'): continue
    try:
        wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
        rows = list(wb.worksheets[0].iter_rows(values_only=True))
    except Exception as e:
        print('ERREUR', f, e); continue
    if not rows: continue
    h = rows[0]; I = {n: i for i, n in enumerate(h) if n is not None}
    if 'agglo' not in I: sans.append(os.path.relpath(f, racine)); continue
    entetes[tuple(sorted(k for k in I if k in ('conf_epaisseur','epaisseur','agglo','comdet_qte','commande+ligne')))] += 1
    for r in rows[1:]:
        r = tuple(r) + (None,) * 80
        a = T(r[I['agglo']]); e = T(r[I['conf_epaisseur']]) if 'conf_epaisseur' in I else '?'
        if 'HYB' in a.upper(): agglos[(a, e)] += 1
print('Fichiers sans colonne agglo :', sans)
print(entetes)
for (a, e), n in sorted(agglos.items()): print(f'{a:30} ep={e:5} lignes={n}')
