import openpyxl, sys, glob, os, re, collections, warnings
warnings.filterwarnings('ignore')
def garde(u):
    u = u.upper(); return ('STRAT' in u and 'RECYCLAGE' not in u) or u == 'LAN264301AGGLO.XLSX'
tot = collections.Counter()
for f in sorted(glob.glob(sys.argv[1] + '/**/*.xlsx', recursive=True)):
    b = os.path.basename(f)
    if b.startswith('~$'): continue
    ws = openpyxl.load_workbook(f, data_only=True).worksheets[0]
    h = [c.value for c in ws[1]]; I = {n: i for i, n in enumerate(h) if n}
    if 'agglo' not in I: continue
    jaunes = 0; hybl = []
    for row in ws.iter_rows(min_row=2):
        if not any(c.fill is not None and c.fill.fill_type == 'solid' and c.fill.fgColor.type == 'rgb' and c.fill.fgColor.rgb == 'FFFFFF00' for c in row): continue
        jaunes += 1
        v = [c.value for c in row]
        a = str(v[I['agglo']] or '').upper()
        if a in ('SAG38HYBL', 'SAG28HYBL'): hybl.append((v[I['commande+ligne']], a[3:], v[I['comdet_qte']]))
    if jaunes:
        s = re.search(r'Semaine (\d+)', f).group(1)
        q = sum(int(x[2] or 0) for x in hybl)
        tot['garde' if garde(b) else 'exclu'] += q
        print(f"S{s} {'GARDÉ' if garde(b) else 'exclu'} {b:30} lignes jaunes={jaunes:3}  dont 38/28 HYBL: {len(hybl)} lignes, {q} pièces {[x[0] for x in hybl] if garde(b) else ''}")
print(tot)
