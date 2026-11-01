import json, sys, re, collections
L = json.load(open(sys.argv[1]))
def s(v): return "" if v is None else re.sub(r"\.0$", "", str(v).strip())
def num(v):
    try: return float(v)
    except: return None
def val(v, d):
    if isinstance(v, str) and v.startswith("="):
        m = re.match(r"=([EF])(\d+)\s*([+-])\s*(\d+)$", v.replace(" ", ""))
        if m:
            base = num(d["conf_longueur"] if m.group(1) == "E" else d["conf_largeur"])
            return base + (int(m.group(4)) if m.group(3) == "+" else -int(m.group(4)))
        return None
    return num(v)
def deb(d):
    m = re.match(r"\s*(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)", s(d["LongueurxLargeur debit"]))
    return (float(m.group(1)), float(m.group(2))) if m else (None, None)
def assemblages(a):
    out = []
    for t in re.split(r"\s*-\s*|\s+", s(a).upper()):
        m = re.match(r"(ETR)?([FL])([GD])(\d+)?$", t)
        if m: out.append((("ETR" if m.group(1) else "") + m.group(2) + m.group(3)))
        elif t: out.append("?" + t)
    return out
fen = [d for d in L if "FENO" in d["_f"].upper()]
print("valeurs d'assemblage :", collections.Counter(s(d["info atelier assemblage"]) for d in fen).most_common(60))
c = collections.Counter(); ex = collections.defaultdict(list)
for d in fen:
    fl, fw = num(d["conf_longueur"]), num(d["conf_largeur"]); sp = num(d["surepaisseur"]) or 0
    el, ew = deb(d); gl, gw = val(d["longueur"], d), val(d["largeur"], d)
    if None in (fl, fw, el, gl, gw): c[("illisible",)] += 1; continue
    asm = assemblages(d["info atelier assemblage"])
    typ = "+".join(sorted(x[:-1] if not x.startswith("?") else x for x in asm)) or "aucun"
    nl = sum(1 for x in asm if x.startswith("L") or x.startswith("ETRL"))
    k = (typ, "erpL%+g" % (el - fl - sp), "L%+g" % (gl - el), "l%+g" % (gw - ew), "sur%g" % sp)
    c[k] += 1; ex[k].append((d["_f"].split("/")[-1], d["_r"], s(d["agglo"]), fl, fw, el, ew, s(d["longueur"]), gw, s(d["info atelier assemblage"]), s(d["commentaire"])[:30]))
for k, v in sorted(c.items(), key=lambda kv: (kv[0][0], -kv[1])):
    print(v, k, ex[k][:2] if k != ("illisible",) else "")
