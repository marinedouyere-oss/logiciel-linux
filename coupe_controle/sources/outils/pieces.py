import sys, os, collections
src = open(os.path.join(os.path.dirname(__file__), 'enquete.py')).read()
exec(src.split("cles = sys.argv[3].split(',')")[0] + src.split("cles = sys.argv[3].split(',')")[1].split('lanc44 =')[0])
for f in sys.argv[1:]:
    L = lignes_lancement(f)
    par = collections.OrderedDict()
    for c, d in L:
        if d.get('agglo','').upper().startswith('PROTECTION'): continue
        par.setdefault(c, collections.Counter())[d.get('agglo')] += float(d.get('comdet_qte') or 0)
    lignes = sum(sum(v.values()) for v in par.values())
    pieces = sum(max(v.values()) for v in par.values())
    couches = collections.Counter(len(v) for v in par.values())
    print(os.path.basename(f), '| clés', len(par), '| couches (somme des lignes)', lignes, '| pièces', pieces, '| clés par nb de couches', dict(couches))
