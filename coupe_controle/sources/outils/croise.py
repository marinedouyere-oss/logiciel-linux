import sys, glob, os, collections
src = open(os.path.join(os.path.dirname(__file__), 'enquete.py')).read()
exec(src.split("cles = sys.argv[3].split(',')")[0] + src.split("cles = sys.argv[3].split(',')")[1].split('lanc44 =')[0])
D44, D45 = sys.argv[1], sys.argv[2]
def cles(D):
    par = collections.defaultdict(dict)
    for f in sorted(glob.glob(D + '/LAN*.xlsx')):
        for c, d in lignes_lancement(f):
            if d.get('agglo', '').upper().startswith('PROTECTION') or not c[:-3].strip('0'): continue
            par[os.path.basename(f)][c] = d
    return par
k44, k45 = cles(D44), cles(D45)
toutes44 = {}
for f, m in k44.items():
    for c in m: toutes44.setdefault(c, []).append(f)
print('### Pièces des lancements S45 déjà présentes dans un lancement S44')
for f, m in k45.items():
    communs = [c for c in m if c in toutes44]
    if communs:
        print(' ', f, ':', len(communs), 'pièce(s)')
        for c in communs[:12]: print('     ', c, m[c].get('conf_article'), 'livsem', m[c].get('com_livsem'), '| S44 :', toutes44[c])
print('\n### Semaines de livraison dans les lancements S45')
for f, m in k45.items():
    print(' ', f, dict(collections.Counter(d.get('com_livsem') for d in m.values())))
