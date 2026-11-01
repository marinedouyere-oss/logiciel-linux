import openpyxl, sys, glob, os, collections, warnings
warnings.filterwarnings('ignore')
def garde(u):
    u = u.upper(); return ('STRAT' in u and 'RECYCLAGE' not in u) or u == 'LAN264301AGGLO.XLSX'
def couleur(c):
    fl = c.fill
    if fl is None or fl.fill_type in (None, 'none'): return None
    col = fl.fgColor
    if col.type == 'rgb': return col.rgb
    if col.type == 'theme': return f'theme{col.theme}/{col.tint:.1f}'
    return f'idx{col.indexed}'
for f in sorted(glob.glob(sys.argv[1] + '/**/*.xlsx', recursive=True)):
    b = os.path.basename(f)
    if b.startswith('~$') or not garde(b): continue
    ws = openpyxl.load_workbook(f, data_only=True).worksheets[0]
    h = [c.value for c in ws[1]]; I = {n: i for i, n in enumerate(h) if n}
    for row in ws.iter_rows(min_row=2):
        cs = collections.Counter(couleur(c) for c in row[:len(h)])
        cs.pop(None, None); cs.pop('theme0/0.0', None)
        if not cs: continue
        v = [c.value for c in row]
        print(f"{b:24} l{row[0].row:<4} {dict(cs)} {v[I['commande+ligne']]} {v[I['agglo']]} qte={v[I['comdet_qte']]} {v[I['conf_longueur']]}x{v[I['conf_largeur']]} {v[I.get('commentaire')] if 'commentaire' in I else ''}")
