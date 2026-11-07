"""Fabrique une pseudo-extraction agglo à partir d'un LAN fait à la main (pour tester la réécriture) :
largeur de débit = largeur du logiciel de gestion (colonne AI), BAZ seul en commentaire retiré,
RCB-CRED14 sous le 10 / 12 brut remplacé par RCB, couleurs de remplissage retirées."""
import sys, re, openpyxl
from openpyxl.styles import PatternFill
src, dst = sys.argv[1:3]
wb = openpyxl.load_workbook(src); ws = wb.worksheets[0]
e = [c.value for c in ws[1]]; I = {n: i + 1 for i, n in enumerate(e)}
n = {"largeur": 0, "baz": 0, "rcb": 0}
for r in range(2, ws.max_row + 1):
    deb = str(ws.cell(r, I["LongueurxLargeur debit"]).value or "")
    m = re.match(r"\s*(\d+)\s*X\s*(\d+)", deb)
    h = ws.cell(r, I["largeur"])
    if m and h.value is not None and float(h.value) != float(m.group(2)): h.value = int(m.group(2)); n["largeur"] += 1
    c = ws.cell(r, I["commentaire"])
    if str(c.value or "").strip().upper() == "BAZ": c.value = None; n["baz"] += 1
    a = str(ws.cell(r, I["agglo"]).value or "")
    sf = ws.cell(r, I["coloris_inf"])
    if a in ("SAG10HYBR", "SAG12HYBR") and sf.value == "RCB-CRED14": sf.value = "RCB"; n["rcb"] += 1
    for col in range(1, len(e) + 1): ws.cell(r, col).fill = PatternFill(fill_type=None)
wb.save(dst); print(dst.split("/")[-1], n)
