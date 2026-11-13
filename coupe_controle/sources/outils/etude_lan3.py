import sys, os, glob, collections, re
import openpyxl
racine = sys.argv[1]
fichiers = [f for f in sorted(glob.glob(os.path.join(racine, "**", "*.xlsx"), recursive=True))
            if os.path.basename(f).upper().startswith("LAN") and "DIAKONOS" not in f.upper() and "ANALYSE" not in f.upper()
            and not any(x in f for x in ("/s46d/", "/s46f/", "/s46/", "/s44c/"))]
L = []
for f in fichiers:
    wbf = openpyxl.load_workbook(f, read_only=True, data_only=False)
    wbv = openpyxl.load_workbook(f, read_only=True, data_only=True)
    rf = list(wbf.worksheets[0].iter_rows(values_only=True)); rv = list(wbv.worksheets[0].iter_rows(values_only=True))
    e = [str(c).strip() if c is not None else "" for c in rf[0]]
    for i in range(1, len(rf)):
        if not rf[i] or all(v is None for v in rf[i]): continue
        d = {n: rv[i][j] if j < len(rv[i]) else None for j, n in enumerate(e) if n}
        d["_f"] = {n: rf[i][j] for j, n in enumerate(e) if n and isinstance(rf[i][j], str) and rf[i][j].startswith("=")}
        d["_fichier"] = os.path.basename(f); d["_ligne"] = i + 1
        L.append(d)
def num(v):
    try: return float(v)
    except: return None
def s(v): return "" if v is None else re.sub(r"\.0$", "", str(v).strip())
print("a) idPlan par article :")
c = collections.defaultdict(collections.Counter)
for d in L: c[s(d["idPlan"]) or "(vide)"][s(d["conf_article"])] += 1
for k, cc in c.items(): print("  ", k, cc.most_common(10))
print("\nb) surépaisseur par article (et agglo) :")
c = collections.defaultdict(collections.Counter)
for d in L: c[s(d["surepaisseur"]) or "(vide)"][s(d["conf_article"])[:6]] += 1
for k, cc in c.items(): print("  ", k, cc.most_common(10))
print("\nb2) largeur de débit > fini + surépaisseur (avec assemblage / commentaire / chants) :")
n = 0
for d in L:
    if str(d["agglo"]).startswith("PROTECTION"): continue
    sp = num(d["surepaisseur"]) or 0
    dw = (num(d["largeur"]) or 0) - (num(d["conf_largeur"]) or 0)
    if dw > sp and n < 14:
        n += 1
        print("  ", d["_fichier"][:22], d["conf_article"], f"fini {s(d['conf_longueur'])}x{s(d['conf_largeur'])} debit {s(d['longueur'])}x{s(d['largeur'])} sur {s(sp)}",
              "| ass", s(d["info atelier assemblage"]), "| com", s(d["commentaire"]), "| chants", s(d["conf_chantavant"]), s(d["conf_chantarriere"]), s(d["conf_chantgauche"]), s(d["conf_chantdroit"]), "| i3", s(d["info 3 atelier"]), d["_f"])
print("\nb3) longueur de débit > fini + surépaisseur :")
c = collections.Counter(); ex = {}
for d in L:
    sp = num(d["surepaisseur"]) or 0
    dl = (num(d["longueur"]) or 0) - (num(d["conf_longueur"]) or 0)
    if dl > sp + 0.1:
        k = (s(d["conf_article"])[:6], s(d["longueur"]) if (num(d["longueur"]) or 0) in (510, 525) else "fini+%d" % dl, bool(d["_f"]))
        c[k] += 1; ex.setdefault(k, (d["_fichier"], d["_ligne"], s(d["info atelier assemblage"]), s(d["commentaire"]), d["_f"]))
for k, v in c.most_common(20): print("  ", k, v, ex[k])
print("\nc) formules :")
c = collections.Counter((d["_fichier"], tuple(sorted(d["_f"]))) for d in L if d["_f"])
for k, v in c.most_common(): print("  ", k, v)
print("\ne) Type chant par article :")
c = collections.defaultdict(collections.Counter)
for d in L: c[s(d["Type chant"])][s(d["conf_article"])] += 1
for k, cc in c.items(): print("  ", k, cc.most_common(8))
print("\nf) articles :")
c = collections.defaultdict(list)
for d in L: c[s(d["conf_article"])].append(d)
for a, ds in sorted(c.items(), key=lambda x: -len(x[1]))[:45]:
    ep = collections.Counter(s(d["conf_epaisseur"]) for d in ds).most_common(2)
    ag = collections.Counter(s(d["agglo"]) for d in ds).most_common(3)
    larg = collections.Counter(s(d["conf_largeur"]) for d in ds).most_common(3)
    print(f"   {a:16} {len(ds):4}  ép {ep}  agglo {ag}  largeurs {larg}")
print("\ng) CBD :", collections.Counter(s(d["conf_article"]) for d in L if s(d["CBD"])).most_common(8),
      collections.Counter((s(d["Type chant"]), bool(s(d['conf_chantavant']))) for d in L if s(d["CBD"])).most_common(4))
print("\nh) info 3 atelier :", collections.Counter((s(d["info 3 atelier"]), s(d["conf_article"])[:6]) for d in L if s(d["info 3 atelier"])).most_common(25))
print("\ni) info 2 atelier :", collections.Counter((s(d["info 2 atelier"]), s(d["commentaire"])) for d in L if s(d["info 2 atelier"])).most_common(10))
print("\nj) commentaire :", collections.Counter(s(d["commentaire"]) for d in L if s(d["commentaire"])).most_common(40))
print("\nk) usinage angles par article :", collections.Counter((s(d["Usinage angle avant gauche"]) or s(d["Usinage angle avant droit"]), s(d["conf_article"])[:8]) for d in L if s(d["Usinage angle avant gauche"]) or s(d["Usinage angle avant droit"])).most_common(12))
print("\np) agglo vide :", [(d["_fichier"], d["_ligne"], s(d["conf_article"]), s(d["conf_epaisseur"]), s(d["coloris"]), s(d["commande+ligne"])) for d in L if not s(d["agglo"])])
print("\nq) chants non numériques :", collections.Counter(s(d[c2]) for d in L for c2 in ("conf_chantavant","conf_chantarriere","conf_chantgauche","conf_chantdroit") if s(d[c2]) and not re.match(r"^\d+(-PF)?$", s(d[c2]))).most_common(20))
print("\nr) coloris non numériques :", collections.Counter(s(d["coloris"]) for d in L if s(d["coloris"]) and not re.match(r"^\d+(-PF)?$", s(d["coloris"]))).most_common(20))
print("\ns) coloris vide par agglo :", collections.Counter(s(d["agglo"]) for d in L if not s(d["coloris"])).most_common(10))
print("\nt) assemblage :", collections.Counter(re.sub(r"\d+", "#", s(d["info atelier assemblage"])) for d in L if s(d["info atelier assemblage"])).most_common(25))
print("\nu) chant vs coloris (chant avant = coloris ?) :", collections.Counter((s(d["conf_chantavant"]) == s(d["coloris"]).replace("-PF", "")) for d in L if s(d["conf_chantavant"]) and s(d["coloris"])).most_common())
print("\nv) qte > 1 :", collections.Counter((s(d["comdet_qte"]), s(d["conf_article"])[:6]) for d in L if (num(d["comdet_qte"]) or 1) > 1).most_common(10))

print("\nw) Débit différent de fini+surépaisseur : la chaîne 'LongueurxLargeur debit' (ERP) dit-elle pareil ?")
c = collections.Counter(); ex = {}
for d in L:
    sp = num(d["surepaisseur"]) or 0
    if str(d["agglo"]).startswith("PROTECTION"): continue
    dl = (num(d["longueur"]) or 0) - (num(d["conf_longueur"]) or 0); dw = (num(d["largeur"]) or 0) - (num(d["conf_largeur"]) or 0)
    if abs(dl - sp) < .1 and abs(dw - sp) < .1: continue
    chaine = s(d["LongueurxLargeur debit"]).replace(" ", "")
    meme = chaine == f"{s(d['longueur'])}X{s(d['largeur'])}"
    k = (d["_fichier"][:18], meme, bool(d["_f"]))
    c[k] += 1; ex.setdefault(k, (d["_ligne"], s(d["conf_article"]), s(d["conf_longueur"]), s(d["conf_largeur"]), s(d["longueur"]), s(d["largeur"]), chaine))
for k, v in sorted(c.items()): print("  ", k, v, ex[k])
print("\nx) épaisseur finie par agglo + coloris dessus/dessous présents :")
c = collections.Counter((s(d["agglo"]), s(d["conf_epaisseur"]), bool(s(d["coloris"])), bool(s(d["coloris_inf"]))) for d in L)
for k, v in c.most_common(18): print("  ", k, v)
print("\ny) LAN264601FENO ligne 14/55 (clé fausse ?) :")
for d in L:
    if d["_fichier"] == "LAN264601FENO.xlsx" and s(d["conf_commande"]) == "CVC26100772": print("  ", d["_ligne"], s(d["conf_ligne"]), s(d["commande+ligne"]), s(d["agglo"]), s(d["conf_longueur"]), s(d["conf_largeur"]))
print("\nz) feuille vs comprod_lancement vs nom du fichier :")
