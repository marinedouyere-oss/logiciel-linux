import openpyxl, sys, glob, os, re, collections, warnings
warnings.filterwarnings('ignore')
racine = sys.argv[1]
def T(v):
    return str(int(v)) if isinstance(v, float) and v.is_integer() else ('' if v is None else str(v).strip())
info = {}; cles = collections.defaultdict(set)
for f in sorted(glob.glob(racine + '/**/*.xlsx', recursive=True)):
    b = os.path.basename(f)
    if b.startswith('~$'): continue
    rows = list(openpyxl.load_workbook(f, read_only=True, data_only=True).worksheets[0].iter_rows(values_only=True))
    if not rows: continue
    I = {n: i for i, n in enumerate(rows[0]) if n is not None}
    if 'agglo' not in I: continue
    lan = collections.Counter(); n = 0; hy = 0; ks = set()
    for r in rows[1:]:
        r = tuple(r) + (None,) * 80
        k = T(r[I['commande+ligne']]) if 'commande+ligne' in I else ''
        if not k and not T(r[I['agglo']]): continue
        n += 1; ks.add(k)
        lan[T(r[I['comprod_lancement']]) if 'comprod_lancement' in I else '?'] += 1
        if T(r[I['agglo']]).upper() in ('SAG38HYBL', 'SAG28HYBL'): hy += 1
    d = os.path.dirname(f)
    racinenom = re.sub(r'\.xlsx$', '', b, flags=re.I)
    bkps = [os.path.basename(x) for x in glob.glob(d + '/*.bkp')]
    a_bkp = any(x.upper().replace(' ', '').startswith(racinenom.upper().replace(' ', '')) for x in bkps)
    rel = os.path.relpath(f, racine)
    info[rel] = (n, hy, dict(lan), a_bkp, ks)
    for k in ks: cles[k].add(rel)
for rel, (n, hy, lan, a_bkp, ks) in info.items():
    autres = collections.Counter()
    for k in ks:
        for o in cles[k]:
            if o != rel: autres[os.path.basename(o)] += 1
    top = autres.most_common(2)
    print(f"{rel[:60]:60} lignes={n:4} hybl={hy:4} bkp={'oui' if a_bkp else '-':3} lanc={lan}  communes={top}")
