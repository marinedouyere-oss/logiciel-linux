import json, sys, re, collections
L = json.load(open(sys.argv[1]))
def s(v): return "" if v is None else re.sub(r"\.0$", "", str(v).strip())
def num(v):
    try: return float(v)
    except: return None
# quels fichiers sont Feno, et quelles matières y trouve-t-on ?
fen = [d for d in L if "FENO" in d["_f"].upper()]
print("lignes dans fichiers FENO:", len(fen), collections.Counter(d["_f"] for d in fen))
print("agglo:", collections.Counter(s(d["agglo"]) for d in fen).most_common(20))
print("articles:", collections.Counter(s(d["conf_article"]) for d in fen).most_common(25))
print("idPlan:", collections.Counter(s(d["idPlan"]) for d in fen))
print("FENO hors fichiers FENO:", collections.Counter(d["_f"] for d in L if "FENO" in s(d["agglo"]).upper() and "FENO" not in d["_f"].upper()))
