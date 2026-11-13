import sys, os, glob, collections, re, json
import openpyxl
fichiers = []
for r in sys.argv[2:]:
    fichiers += [f for f in sorted(glob.glob(os.path.join(r, "**", "*.xlsx"), recursive=True))
                 if os.path.basename(f).upper().startswith("LAN") and "DIAKONOS" not in f.upper() and "ANALYSE" not in f.upper()
                 and not any(x in f for x in ("/s46d/", "/s46f/", "/s46/", "/s44c/", "(2)"))]
ordre = None; vals = collections.defaultdict(list); n = 0
articles = collections.defaultdict(lambda: {"n": 0, "ep": collections.Counter(), "agglo": collections.Counter(), "larg": [], "sur": collections.Counter(), "plan": collections.Counter(), "chant": collections.Counter()})
for f in fichiers:
    rows = list(openpyxl.load_workbook(f, read_only=True, data_only=True).worksheets[0].iter_rows(values_only=True))
    e = [str(c).strip() if c is not None else "" for c in rows[0]]
    ordre = ordre or e
    for r in rows[1:]:
        if not r or all(v is None for v in r): continue
        n += 1
        d = {nm: r[j] if j < len(r) else None for j, nm in enumerate(e) if nm}
        for nm, v in d.items(): vals[nm].append(v)
        s = lambda v: "" if v is None else re.sub(r"\.0$", "", str(v).strip())
        fam = re.sub(r"\d.*$", "", s(d["conf_article"])) or s(d["conf_article"])
        a = articles[fam]; a["n"] += 1; a["ep"][s(d["conf_epaisseur"])] += 1; a["agglo"][s(d["agglo"])] += 1
        a["sur"][s(d["surepaisseur"])] += 1; a["plan"][s(d["idPlan"])] += 1; a["chant"][s(d["Type chant"])] += 1
        try: a["larg"].append(float(d["conf_largeur"]))
        except: pass
out = {"n": n, "fichiers": len(fichiers), "colonnes": []}
for nm in [x for x in ordre if x]:
    vs = [re.sub(r"\.0$", "", str(v).strip()) for v in vals[nm] if v is not None and str(v).strip() != ""]
    c = collections.Counter(vs)
    out["colonnes"].append({"nom": nm, "rempli": round(100 * len(vs) / n), "distinctes": len(c), "exemples": [k for k, _ in c.most_common(4)]})
out["articles"] = sorted([{"famille": k, "n": v["n"], "ep": [x for x, _ in v["ep"].most_common(4)], "agglo": [x for x, _ in v["agglo"].most_common(3)],
    "larg": [min(v["larg"]) if v["larg"] else None, max(v["larg"]) if v["larg"] else None], "sur": [x for x, _ in v["sur"].most_common(2)],
    "plan": [x for x, _ in v["plan"].most_common(2)], "chant": [x for x, _ in v["chant"].most_common(2)]} for k, v in articles.items()], key=lambda x: -x["n"])
json.dump(out, open(sys.argv[1], "w"), ensure_ascii=False, indent=1)
print(n, len(fichiers))
for a in out["articles"][:40]: print(a)
