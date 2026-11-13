import openpyxl, sys
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
rows = list(wb.worksheets[0].iter_rows(values_only=True)); h = rows[0]
for r in rows[1:]:
    if any(str(v) == sys.argv[2] for v in r if v is not None):
        print({h[i]: v for i, v in enumerate(r) if v is not None and h[i] in ('commande+ligne','conf_article','agglo','coloris','coloris_inf','comdet_qte','comprod_lancement','commentaire','LongueurxLargeurxEpaisseur fini')})
