import json, sys, re, collections
L = json.load(open(sys.argv[1]))
def s(v): return "" if v is None else re.sub(r"\.0$", "", str(v).strip())
f0 = sys.argv[2]
lan = [d for d in L if d["_f"].endswith(f0)]
agglo = [d for d in L if "FENO" not in d["_f"].upper()]
cols = ["commentaire", "info atelier assemblage", "Type chant", "CBD", "info 2 atelier", "info 3 atelier",
        "Usinage angle avant gauche", "Usinage angle avant droit", "Usinage angle arrière gauche", "Usinage angle arrière droit"]
print(f0, len(lan), "lignes")
for c in cols:
    print(f"== {c}\n   S46 T1 : {collections.Counter(s(d[c]).replace(chr(10),' ')[:28] for d in lan).most_common(14)}")
    print(f"   tous agglo ({len(agglo)}) : {collections.Counter(s(d[c]).replace(chr(10),' ')[:28] for d in agglo).most_common(18)}")
