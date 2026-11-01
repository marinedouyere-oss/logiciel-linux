import sys, glob, os, collections
src = open(os.path.join(os.path.dirname(__file__), 'enquete.py')).read()
exec(src.split("cles = sys.argv[3].split(',')")[0] + src.split("cles = sys.argv[3].split(',')")[1].split('lanc44 =')[0])
for D in sys.argv[1:]:
    par = collections.defaultdict(list)
    for f in sorted(glob.glob(D + '/LAN*.xlsx')):
        for c, d in lignes_lancement(f):
            if d.get('agglo') == 'PROTECTION': continue
            if os.path.basename(f) not in par[c]: par[c].append(os.path.basename(f))
    paires = collections.Counter(tuple(v) for v in par.values() if len(v) > 1)
    print('##', os.path.basename(D.rstrip('/')))
    for k, n in paires.most_common(): print('   ', n, 'pièce(s) dans', ' + '.join(k), '| ex.', [c for c, v in par.items() if tuple(v) == k][:6])
