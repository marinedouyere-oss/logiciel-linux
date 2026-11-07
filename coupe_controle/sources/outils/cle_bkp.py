import sys, os
src = open(os.path.join(os.path.dirname(__file__), 'enquete.py')).read()
exec(src.split("cles = sys.argv[3].split(',')")[0] + src.split("cles = sys.argv[3].split(',')")[1].split('lanc44 =')[0])
strat, bkp, cles = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
L = lignes_lancement(strat); R = bkp_records(bkp)
for cle in cles:
    print('##', cle)
    for c, d in L:
        if c == cle: print('   lancement', {k: d.get(k) for k in ('conf_article','agglo','coloris','comdet_qte','conf_longueur','conf_largeur')})
    for r in R:
        if r[7] == cle: print('   bkp', r[:7])
