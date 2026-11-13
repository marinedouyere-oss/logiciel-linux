import sys, glob, os, collections
src = open(os.path.join(os.path.dirname(__file__), 'enquete.py')).read()
exec(src.split("cles = sys.argv[3].split(',')")[0] + src.split("cles = sys.argv[3].split(',')")[1].split('lanc44 =')[0])
D45 = sys.argv[1]
cherche = sys.argv[2].split(',')
for f in sorted(glob.glob(D45 + '/LAN*.xlsx')):
    for c, d in lignes_lancement(f):
        for k in cherche:
            if c.startswith(k): print(os.path.basename(f), c, d.get('agglo'), d.get('coloris'), d.get('com_livsem'))
