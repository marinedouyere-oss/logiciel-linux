import sys, glob, os, collections
sys.path.insert(0, os.path.dirname(__file__))
exec(open(os.path.join(os.path.dirname(__file__), 'enquete.py')).read().split('lanc44 =')[0].split("cles = sys.argv[3].split(',')")[0] + open(os.path.join(os.path.dirname(__file__), 'enquete.py')).read().split("cles = sys.argv[3].split(',')")[1].split('lanc44 =')[0])
D44, D45 = sys.argv[1], sys.argv[2]
casse = lignes_lancement(os.path.join(D45, 'LAN2644CASSE.xlsx'))
l44 = {}
for f in glob.glob(D44 + '/LAN*.xlsx'):
    for c, d in lignes_lancement(f):
        if d.get('agglo') == 'PROTECTION': continue
        l44.setdefault(c, []).append((os.path.basename(f), d))
bk = {}
for f in glob.glob(D44 + '/*.bkp'):
    for r in bkp_records(f): bk.setdefault(r[7], []).append((os.path.basename(f),) + r)
champs = ['conf_article','agglo','coloris','coloris_inf','conf_longueur','conf_largeur','conf_epaisseur','conf_chantavant','conf_chantarriere','conf_chantgauche','conf_chantdroit','info atelier assemblage','info 3 atelier','Usinage angle avant gauche','Usinage angle avant droit','Usinage angle arrière gauche','Usinage angle arrière droit']
stats = collections.Counter()
for c, d in casse:
    if d.get('agglo') == 'PROTECTION': continue
    avant = l44.get(c)
    if not avant:
        print(c, d.get('conf_article'), 'livsem', d.get('com_livsem'), '-> absente des lancements S44', d.get('commentaire')); stats['absente S44'] += 1; continue
    f, a = avant[0]
    diff = {k: (a.get(k), d.get(k)) for k in champs if a.get(k) != d.get(k)}
    nb = len([r for r in bk.get(c, []) if r[2] == 'TC'])
    print(c, d.get('conf_article'), 'S44:', f, '| bkp44 TC:', nb, '| diff:', diff if diff else 'aucune', '| comm:', d.get('commentaire') or '')
    stats['diff' if diff else 'identique'] += 1
print(stats)
