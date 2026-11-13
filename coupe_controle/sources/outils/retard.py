import sys, os
src = open(os.path.join(os.path.dirname(__file__), 'enquete.py')).read()
exec(src.split("cles = sys.argv[3].split(',')")[0] + src.split("cles = sys.argv[3].split(',')")[1].split('lanc44 =')[0])
for c, d in lignes_lancement(sys.argv[1]):
    if d.get('com_livsem') == sys.argv[2] and not d.get('agglo','').upper().startswith('PROTECTION'):
        print(c, d.get('conf_article'), d.get('agglo'), d.get('comprod_lancement'), d.get('commentaire'))
