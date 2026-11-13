import zipfile, sys, re, collections, openpyxl
strat_path, bkp_path = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(strat_path, read_only=True, data_only=True)
rows = list(wb.worksheets[0].iter_rows(values_only=True))
h = list(rows[0]); I = {n: i for i, n in enumerate(h)}
attendu = {}
for r in rows[1:]:
    if r[I['commande+ligne']] is None: continue
    attendu.setdefault(str(r[I['commande+ligne']]), []).append((r[I['conf_article']], r[I['agglo']], r[I['coloris']], r[I['coloris_inf']], r[I['comdet_qte']]))
z = zipfile.ZipFile(bkp_path)
nom = [n for n in z.namelist() if n.lower().endswith('.ctt') and '_' not in n.rsplit('/',1)[-1]][0]
t = z.read(nom).decode('latin-1').splitlines()
recs = []; p1 = p2 = None
for l in t:
    if l.startswith('PNL1,'): p1 = l.split(',')
    elif l.startswith('PNL2,'): p2 = l.split(',')
    elif l.startswith('PNL3,'):
        m = re.match(r'^PNL3,([A-Z]+\d+):(T[A-Z0-9]+):', l)
        if m and p1 and p2: recs.append((m.group(1), m.group(2), p1[1], p1[2], int(p1[5] or 0), p2[5] if len(p2) > 5 else '', p2[9] if len(p2) > 9 else '', p2[16] if len(p2)>16 else '', p2[17] if len(p2)>17 else ''))
print('types x matériau (exemples) :')
c = collections.Counter((r[1], r[0][0]) for r in recs); print('  ', dict(c))
# par clé
parcle = collections.defaultdict(list)
for r in recs: parcle[r[5]].append(r)
ex = 0
for cle, lignes in list(attendu.items()):
    for (art, agglo, col, colinf, q) in lignes:
        if agglo == 'PROTECTION': continue
        tf = [(r[3], r[4], r[2]) for r in parcle.get(cle, []) if r[1] == 'TF']
        tb = [(r[3], r[4], r[2]) for r in parcle.get(cle, []) if r[1] == 'TB']
        tc = [(r[3], r[4], r[2]) for r in parcle.get(cle, []) if r[1] == 'TC']
        if ex < 25:
            print(cle, art, 'agglo', agglo, 'coloris', col, 'inf', colinf, 'qte', q, '| TC', tc[:3], '| TF', tf[:3], '| TB', tb[:3]); ex += 1
