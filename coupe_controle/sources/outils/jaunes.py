import openpyxl, sys, glob, os, collections, warnings
warnings.filterwarnings('ignore')
for f in sorted(glob.glob(sys.argv[1] + '/**/*.xlsx', recursive=True)):
    if os.path.basename(f).startswith('~$'): continue
    wb = openpyxl.load_workbook(f, data_only=True)
    ws = wb.worksheets[0]
    couleurs = collections.Counter(); lignes = collections.defaultdict(set)
    for row in ws.iter_rows(min_row=2):
        for c in row:
            fl = c.fill
            if fl is None or fl.fill_type in (None, 'none'): continue
            col = fl.fgColor
            v = col.rgb if col.type == 'rgb' else f'{col.type}:{col.theme if col.type=="theme" else col.indexed}:{col.tint:.2f}' if col.type == 'theme' else f'{col.type}:{col.indexed}'
            couleurs[v] += 1; lignes[v].add(c.row)
    if couleurs:
        print(os.path.relpath(f, sys.argv[1]), {k: (n, len(lignes[k])) for k, n in couleurs.items()}, 'feuilles', [w.title for w in wb.worksheets])
