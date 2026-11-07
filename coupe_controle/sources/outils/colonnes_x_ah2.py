import json, sys, re, collections
exec(open(sys.argv[0].replace("colonnes_x_ah2.py", "feno_commun.py")).read())
A = [d for d in L if "FENO" not in d["_f"].upper()]
ang = ["Usinage angle avant gauche", "Usinage angle avant droit", "Usinage angle arrière gauche", "Usinage angle arrière droit"]
fam = lambda d: re.sub(r"\d.*$", "", s(d["conf_article"]))
def angles(d): return [s(d[c]) for c in ang if s(d[c])]
print("1) info 2 = BAZ : familles", collections.Counter(fam(d) for d in A if s(d["info 2 atelier"]) == "BAZ").most_common(8))
print("   BAZ <-> angles EP :", collections.Counter((s(d["info 2 atelier"]) or "-", "angles" if angles(d) else "sans angle") for d in A if s(d["info 2 atelier"]) in ("BAZ", "") ))
print("   BAZ <-> info 3 :", collections.Counter(s(d["info 3 atelier"]) or "-" for d in A if s(d["info 2 atelier"]) == "BAZ").most_common(10))
print("   commentaire BAZ <-> info 2 :", collections.Counter((("BAZ" in s(d["commentaire"]).upper()), s(d["info 2 atelier"]) or "-") for d in A if "BAZ" in s(d["commentaire"]).upper() or s(d["info 2 atelier"]) == "BAZ"))
print("2) EP selon épaisseur :", sorted(collections.Counter((a, s(d["conf_epaisseur"])) for d in A for a in angles(d)).items()))
print("   EP selon famille :", collections.Counter((fam(d), tuple(sorted(set(angles(d))))) for d in A if angles(d)).most_common(10))
print("3) info 3 selon info 2 :", collections.Counter((s(d["info 2 atelier"]) or "-", s(d["info 3 atelier"])) for d in A if s(d["info 3 atelier"])).most_common(20))
print("   info 3 selon famille :", collections.Counter((s(d["info 3 atelier"])[:8], fam(d)) for d in A if s(d["info 3 atelier"])).most_common(20))
print("4) Type chant x CBD :", collections.Counter((s(d["Type chant"]) or "-", s(d["CBD"]) or "-") for d in A))
print("   CBD selon famille :", collections.Counter(fam(d) for d in A if s(d["CBD"])).most_common(8))
print("   Type chant BRUT : chants remplis ?", collections.Counter(bool(s(d["conf_chantavant"]) or s(d["conf_chantgauche"])) for d in A if s(d["Type chant"]) == "BRUT"), " STRAT :", collections.Counter((s(d["conf_chantavant"]) or "-")[:12] for d in A if s(d["Type chant"]) == "STRAT").most_common(5))
print("5) EMP : ", collections.Counter((s(d["info 3 atelier"]) or "-", s(d["CBD"]) or "-", s(d["Type chant"]), fam(d)) for d in A if s(d["info 2 atelier"]) == "EMP").most_common(8))
cp = [d for d in A if "COTES PRECISES" in s(d["commentaire"]).upper()]
c = collections.Counter()
for d in cp:
    fl, sp = num(d["conf_longueur"]), num(d["surepaisseur"]); el, ew = deb(d); gl = val(d["longueur"], d)
    if None in (fl, el, gl): continue
    c[("sur%g" % (sp or 0), "gest%+g" % (el - fl), "final%+g" % (gl - fl))] += 1
print("6) COTES PRECISES : surépaisseur / débit", c.most_common(8))
c2 = collections.Counter()
for d in A:
    if "COTES PRECISES" in s(d["commentaire"]).upper(): continue
    sp = num(d["surepaisseur"]); c2["sur%g" % (sp or 0)] += 1
print("   autres lignes : surépaisseur", c2.most_common(6))
