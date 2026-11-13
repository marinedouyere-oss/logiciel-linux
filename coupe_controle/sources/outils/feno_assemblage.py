"""Feno : lien entre les cotes retouchées (longueur/largeur) et la colonne « info atelier assemblage »."""
import sys, os, glob, collections, re, json
import openpyxl
fichiers = []
for r in sys.argv[1:]:
    fichiers += [f for f in sorted(glob.glob(os.path.join(r, "**", "*.xlsx"), recursive=True))
                 if os.path.basename(f).upper().startswith("LAN") and "DIAKONOS" not in f.upper() and "ANALYSE" not in f.upper()
                 and not any(x in f for x in ("/s46d/", "/s46f/", "/s46/", "/s44c/", "(2)"))]
L = []
for f in fichiers:
    wb = openpyxl.load_workbook(f, read_only=True, data_only=False)
    rf = list(wb.worksheets[0].iter_rows(values_only=True))
    e = [str(c).strip() if c is not None else "" for c in rf[0]]
    for i in range(1, len(rf)):
        if not rf[i] or all(v is None for v in rf[i]): continue
        d = {n: rf[i][j] if j < len(rf[i]) else None for j, n in enumerate(e) if n}
        d["_f"] = os.path.relpath(f, os.path.dirname(f.rstrip("/")) if False else f.split("/scratchpad/")[0] + "/scratchpad"); d["_r"] = i + 1
        L.append(d)
def num(v):
    try: return float(v)
    except: return None
def s(v): return "" if v is None else re.sub(r"\.0$", "", str(v).strip())
json.dump([{k: (v if isinstance(v, (int, float, str)) or v is None else str(v)) for k, v in d.items()} for d in L],
          open(sys.argv[0].replace("outils/feno_assemblage.py", "etude_feno/lignes.json"), "w"), ensure_ascii=False)
print(len(fichiers), "fichiers", len(L), "lignes")
