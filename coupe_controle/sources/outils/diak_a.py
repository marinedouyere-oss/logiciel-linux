import sys, openpyxl, collections
def lire(p):
    wb = openpyxl.load_workbook(p, read_only=True, data_only=False)
    ws = wb.worksheets[0]; rows = list(ws.iter_rows(values_only=True))
    return wb.sheetnames, rows
for p in sys.argv[1:]:
    n, r = lire(p)
    print("==", p.split("/")[-1], n, len(r) - 1, "lignes,", len(r[0]), "colonnes")
    print("   entête:", [c for c in r[0]][:40])
    for x in r[1:4]: print("   ", x[:40])
