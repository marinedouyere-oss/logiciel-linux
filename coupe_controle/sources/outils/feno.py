import sys, os, collections
src = open(os.path.join(os.path.dirname(__file__), 'enquete.py')).read()
exec(src.split("cles = sys.argv[3].split(',')")[0] + src.split("cles = sys.argv[3].split(',')")[1].split('lanc44 =')[0])
L = lignes_lancement(sys.argv[1]); R = bkp_records(sys.argv[2])
par = collections.OrderedDict()
for c, d in L: par.setdefault(c, []).append(d)
rb = collections.defaultdict(list)
for r in R: rb[r[7]].append(r)
nb_lignes = collections.Counter(len(v) for v in par.values())
print('clés:', len(par), '| lignes par clé:', dict(nb_lignes))
combos = collections.Counter(tuple(sorted(d.get('agglo') for d in v)) for v in par.values())
for k, n in combos.most_common(15): print('   ', n, k)
n = 0
for c, v in par.items():
    if len(v) < 2: continue
    print('\n##', c)
    for d in v: print('   L', {k: d.get(k) for k in ('conf_article','agglo','coloris','coloris_inf','comdet_qte','conf_epaisseur','conf_longueur','conf_largeur','commentaire') if d.get(k)})
    for r in rb.get(c, []): print('   B', r[:7])
    n += 1
    if n >= 5: break
