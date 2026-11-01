"""Associe chaque extraction brute (LANxxxxxx) à son LAN corrigé : même nom d'onglet (numéro du logiciel
de gestion), sinon le plus de clés communes."""
import sys, os, glob, json, re, collections, openpyxl
bruts, corr = sys.argv[1:3]
def info(p):
    wb = openpyxl.load_workbook(p, read_only=True); ws = wb.worksheets[0]
    rows = [r for r in ws.iter_rows(values_only=True) if r and any(v is not None for v in r)]
    e = list(rows[0]); I = {n: i for i, n in enumerate(e)}
    cles = set(str(r[I["commande+ligne"]]).strip() for r in rows[1:] if "commande+ligne" in I and r[I["commande+ligne"]])
    lan = collections.Counter(str(r[I["comprod_lancement"]]) for r in rows[1:] if "comprod_lancement" in I)
    return wb.sheetnames[0], cles, lan.most_common(1)[0][0] if lan else None, len(rows) - 1
B = {os.path.basename(p): info(p) for p in sorted(glob.glob(os.path.join(bruts, "*.xlsx")))}
C = {os.path.basename(p): info(p) for p in sorted(glob.glob(os.path.join(corr, "*.xlsx")))}
paires = {}
for b, (fb, kb, lb, nb) in B.items():
    meilleur = max(C.items(), key=lambda kv: (kv[1][0] == fb, len(kb & kv[1][1])))
    c, (fc, kc, lc, nc) = meilleur
    commun = len(kb & kc)
    paires[b] = c if commun >= 0.5 * len(kb) else None
    print(f"{b} ({fb}, {nb} l.) -> {c} (onglet {fc}, {nc} l.) clés communes {commun}/{len(kb)}")
json.dump(paires, open(os.path.join(os.path.dirname(bruts.rstrip('/')), "paires.json"), "w"), indent=0)
