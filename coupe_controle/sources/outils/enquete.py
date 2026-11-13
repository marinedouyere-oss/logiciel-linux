import openpyxl, zipfile, re, sys, glob, os
D44, D45 = sys.argv[1], sys.argv[2]
cles = sys.argv[3].split(',')
def T(v):
    return str(int(v)) if isinstance(v, float) and v.is_integer() else ('' if v is None else str(v).strip())
def lignes_lancement(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows = [tuple(r) + (None,) * 60 for r in wb.worksheets[0].iter_rows(values_only=True)]
    h = rows[0]; I = {n: i for i, n in enumerate(h) if n is not None}
    if 'commande+ligne' not in I: return []
    out = []
    for r in rows[1:]:
        cle = T(r[I['commande+ligne']]) or (T(r[I['conf_commande']]) + T(r[I['conf_ligne']]).zfill(3))
        out.append((cle, {k: T(r[i]) for k, i in I.items()}))
    return out
def bkp_records(path):
    z = zipfile.ZipFile(path)
    nom = [n for n in z.namelist() if n.lower().endswith('.ctt') and '_' not in n.rsplit('/', 1)[-1]][0]
    recs = []; p1 = p2 = None
    for l in z.read(nom).decode('latin-1').splitlines():
        if l.startswith('PNL1,'): p1 = l.split(',')
        elif l.startswith('PNL2,'): p2 = l.split(',')
        elif l.startswith('PNL3,'):
            m = re.match(r'^PNL3,([A-Z]+\d+):(T[A-Z0-9]+):', l)
            if m and p1 and p2: recs.append((m.group(1), m.group(2), p1[1], p1[2], p1[3], p1[4], p1[5], p2[5] if len(p2) > 5 else ''))
    return recs
lanc44 = {f: lignes_lancement(f) for f in glob.glob(D44 + '/LAN*.xlsx')}
lanc45 = {f: lignes_lancement(f) for f in glob.glob(D45 + '/LAN*.xlsx')}
bkp44 = {f: bkp_records(f) for f in glob.glob(D44 + '/*.bkp')}
champs = ['conf_article', 'agglo', 'coloris', 'coloris_inf', 'comdet_qte', 'conf_longueur', 'conf_largeur', 'conf_epaisseur', 'conf_chantavant', 'conf_chantarriere', 'conf_chantgauche', 'conf_chantdroit', 'commentaire', 'info atelier assemblage', 'info 3 atelier', 'com_livsem', 'comprod_lancement']
for cle in cles:
    print('\n########', cle)
    for nomdossier, lanc in (('S44', lanc44), ('S45', lanc45)):
        for f, ls in lanc.items():
            for c, d in ls:
                if c == cle: print('  ', nomdossier, os.path.basename(f), {k: d.get(k) for k in champs if d.get(k)})
    for f, recs in bkp44.items():
        for r in recs:
            if r[7] == cle: print('   bkp44', os.path.basename(f), r[:7])
