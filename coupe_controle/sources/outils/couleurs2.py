import zipfile, sys, re, collections, openpyxl
def T(v):
    return str(int(v)) if isinstance(v, float) and v.is_integer() else str(v).strip()
strat_path, bkp_path = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(strat_path, read_only=True, data_only=True)
rows = [tuple(r) + (None,) * 60 for r in wb.worksheets[0].iter_rows(values_only=True)]
h = list(rows[0]); I = {n: i for i, n in enumerate(h) if n is not None}
dessus = collections.Counter(); dessous = collections.Counter(); agglos = collections.Counter()
for r in rows[1:]:
    if r[I['commande+ligne']] is None or r[I['agglo']] == 'PROTECTION': continue
    q = r[I['comdet_qte']] or 0
    if r[I['coloris']] is not None: dessus[T(r[I['coloris']])] += q
    if r[I['coloris_inf']] is not None: dessous[T(r[I['coloris_inf']])] += q
    agglos[str(r[I['agglo']])] += q
z = zipfile.ZipFile(bkp_path)
noms = z.namelist()
maitre = [n for n in noms if n.lower().endswith('.ctt') and '_' not in n.rsplit('/',1)[-1]][0]
base = maitre.rsplit('/',1)[-1][:-4]
sous = sorted(n.rsplit('/',1)[-1][len(base)+1:-4] for n in noms if n.lower().endswith('.ctt') and n.rsplit('/',1)[-1].startswith(base + '_'))
t = z.read(maitre).decode('latin-1').splitlines()
mat = collections.defaultdict(collections.Counter); p1 = None
for l in t:
    if l.startswith('PNL1,'): p1 = l.split(',')
    elif l.startswith('PNL3,'):
        m = re.match(r'^PNL3,([A-Z]+\d+):(T[A-Z0-9]+):', l)
        if m and p1: mat[m.group(2)][p1[2]] += int(p1[5] or 0)
print('##', strat_path, '+', bkp_path)
print('  couleurs dessus (lancement):', dict(dessus))
print('  couleurs dessous (lancement):', dict(dessous))
print('  sous-fichiers .ctt du bkp   :', sous)
print('  matières TF du bkp :', dict(mat['TF']))
print('  matières TB du bkp :', dict(mat['TB']))
print('  matières TC du bkp :', dict(mat['TC']))
print('  agglos lancement   :', dict(agglos))
tf = set(mat['TF']); tb = set(mat['TB'])
print('  >> dessus absents des TF :', sorted(set(dessus) - tf), ' | absents des sous-fichiers :', sorted(set(dessus) - set(sous)))
print('  >> dessous absents des TB :', sorted(set(dessous) - tb))
