"""Étude des fichiers de lancement (LAN) : colonnes, remplissage, valeurs, exemples."""
import sys, os, glob, collections, json, re
import openpyxl

racine = sys.argv[1]
fichiers = []
for f in sorted(glob.glob(os.path.join(racine, "**", "*.xlsx"), recursive=True)):
    nom = os.path.basename(f)
    if not nom.upper().startswith("LAN") or "DIAKONOS" in nom.upper() or "ANALYSE" in nom.upper() or "_corrige" in nom: continue
    if "/s46d/" in f or "/s46f/" in f or "/s46/" in f or "/s44c/" in f: continue  # doublons des mêmes semaines
    fichiers.append(f)

entetes_par_fichier = {}
valeurs = collections.defaultdict(list)  # colonne -> [(fichier, ligne, valeur)]
lignes_total = 0
for f in fichiers:
    wb = openpyxl.load_workbook(f, read_only=True, data_only=False)
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    if not rows: continue
    e = [str(c).strip() if c is not None else "" for c in rows[0]]
    entetes_par_fichier[os.path.relpath(f, racine)] = (e, len(rows) - 1, wb.sheetnames)
    for i, r in enumerate(rows[1:], start=2):
        if not r or all(v is None for v in r): continue
        lignes_total += 1
        for j, nom in enumerate(e):
            if not nom: continue
            v = r[j] if j < len(r) else None
            valeurs[nom].append((os.path.basename(f), i, v))

print("FICHIERS", len(fichiers), "LIGNES", lignes_total)
ordres = collections.Counter(tuple(e) for e, n, s in entetes_par_fichier.values())
for o, n in ordres.most_common():
    print(f"\nORDRE DES COLONNES ({n} fichier(s)) :", list(o))
for f, (e, n, s) in entetes_par_fichier.items():
    print(f"  {f}: {n} lignes, feuilles {s}, {len([x for x in e if x])} colonnes")

print()
for nom in [x for x in ordres.most_common(1)[0][0] if x] + sorted(set(valeurs) - set(ordres.most_common(1)[0][0])):
    vs = valeurs[nom]
    remplies = [v for _, _, v in vs if v is not None and str(v).strip() != ""]
    types = collections.Counter(type(v).__name__ for v in remplies)
    distinctes = collections.Counter(str(v).strip() for v in remplies)
    print(f"=== {nom} : {len(remplies)}/{len(vs)} remplies, {len(distinctes)} valeurs distinctes, types {dict(types)}")
    print("    plus fréquentes :", [(k[:40], c) for k, c in distinctes.most_common(12)])
    nums = [float(v) for v in remplies if isinstance(v, (int, float))]
    if nums: print(f"    min {min(nums)} max {max(nums)}")
    formules = [str(v) for v in remplies if isinstance(v, str) and v.startswith("=")]
    if formules: print("    FORMULES :", formules[:5])
