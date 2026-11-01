import openpyxl, sys
for chemin in sys.argv[1:]:
    wb = openpyxl.load_workbook(chemin, read_only=True, data_only=True)
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        print('=====', chemin.split('/')[-1], '/', ws.title, len(rows), 'lignes')
        for r in rows[:3]:
            print('   ', list(r)[:70])
