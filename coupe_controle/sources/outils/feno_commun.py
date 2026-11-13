L = json.load(open(sys.argv[1]))
def s(v): return "" if v is None else re.sub(r"\.0$", "", str(v).strip())
def num(v):
    try: return float(v)
    except: return None
def val(v, d):
    if isinstance(v, str) and v.startswith("="):
        m = re.match(r"=([EF])(\d+)([+-])(\d+)$", v.replace(" ", ""))
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
        if m: out.append(("ETR" if m.group(1) else "") + m.group(2) + m.group(3) + (m.group(4) or ""))
        elif t: out.append("?" + t)
    return out
def couche(d):
    a = s(d["agglo"]).upper()
    if a.startswith("PROTECTION"): return "protection"
    if a.startswith("FENO") or a.startswith("COM"): return "décor"
    return "support"
