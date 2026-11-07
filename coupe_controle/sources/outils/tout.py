import openpyxl, sys
for chemin in sys.argv[1:]:
    wb = openpyxl.load_workbook(chemin, read_only=True, data_only=True)
    for ws in wb.worksheets:
        print('=====', chemin.split('/')[-1], '/', ws.title)
        for r in ws.iter_rows(values_only=True):
            r = [c for c in r]
            while r and r[-1] is None: r.pop()
            if r: print('   ', r)
