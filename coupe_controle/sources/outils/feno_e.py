import json, sys, re, collections
exec(open(sys.argv[0].replace("feno_e.py", "feno_commun.py")).read())
fen = [d for d in L if "FENO" in d["_f"].upper()]
grp = collections.defaultdict(list)
for d in fen:
    asm = assemblages(d["info atelier assemblage"])
    if any(x[0] == "L" for x in asm): grp[(d["_f"].split("/")[-1], s(d["commande+ligne"]))].append(d)
for k, ds in sorted(grp.items()):
    print(k, s(ds[0]["info atelier assemblage"]), "|", s(ds[0]["commentaire"]).replace("\n", " ")[:40])
    for d in sorted(ds, key=couche):
        fl, fw = num(d["conf_longueur"]), num(d["conf_largeur"]); el, ew = deb(d); gl, gw = val(d["longueur"], d), val(d["largeur"], d)
        print("    %-10s %-14s fini %gx%g  sur %s  gestion %+g  final %+g   chants av/ar/g/d: %s/%s/%s/%s  angles: %s" % (couche(d), s(d["agglo"]), fl, fw, s(d["surepaisseur"]), (el - fl) if el is not None else -9999, (gl - fl) if gl is not None else -9999,
              s(d["conf_chantavant"]), s(d["conf_chantarriere"]), s(d["conf_chantgauche"]), s(d["conf_chantdroit"]),
              ",".join(s(d[c]) for c in ("Usinage angle avant gauche","Usinage angle avant droit","Usinage angle arrière gauche","Usinage angle arrière droit"))))
