"""Relit un .exe Windows : sous-système, ressources (icônes, version, manifeste)."""
import struct, sys
d = open(sys.argv[1], "rb").read()
pe = struct.unpack_from("<I", d, 0x3C)[0]
assert d[pe:pe + 4] == b"PE\0\0"
machine, nsec, _, _, _, taille_opt, _ = struct.unpack_from("<HHIIIHH", d, pe + 4)
opt = pe + 24
magic = struct.unpack_from("<H", d, opt)[0]
sous_systeme = struct.unpack_from("<H", d, opt + 68)[0]
print("machine", hex(machine), "PE32+" if magic == 0x20B else hex(magic), "sous-système", sous_systeme, "(2 = fenêtres, sans console)")
rsrc_rva = struct.unpack_from("<I", d, opt + 112 + 2 * 8)[0]  # répertoire de données n° 2 = ressources
sections = []
for i in range(nsec):
    o = opt + taille_opt + 40 * i
    nom, vsize, va, rsize, raw = struct.unpack_from("<8sIIII", d, o)
    sections.append((nom.rstrip(b"\0").decode(), va, vsize, raw, rsize))
def fichier(rva):
    for nom, va, vs, raw, rs in sections:
        if va <= rva < va + max(vs, rs):
            return raw + rva - va
    raise ValueError(hex(rva))
base = fichier(rsrc_rva)
print("sections", [s[0] for s in sections], "ressources à", hex(rsrc_rva))
def rep(o):
    nn, ni = struct.unpack_from("<HH", d, base + o + 12)
    return [struct.unpack_from("<II", d, base + o + 16 + 8 * k) for k in range(nn + ni)]
res = {}
for t, ot in rep(0):
    for i, oi in rep(ot & 0x7FFFFFFF):
        for lang, ol in rep(oi & 0x7FFFFFFF):
            rva, taille, _, _ = struct.unpack_from("<IIII", d, base + ol)
            res[(t, i)] = (lang, d[fichier(rva):fichier(rva) + taille])
for (t, i), (lang, b) in sorted(res.items()):
    print(f"type {t:2d} id {i} langue {lang:#06x} taille {len(b):6d} début {b[:12]!r}")
groupe = res[(14, 1)][1]
n = struct.unpack_from("<H", groupe, 4)[0]
for k in range(n):
    w, h, _, _, plans, bits, taille, nid = struct.unpack_from("<BBBBHHIH", groupe, 6 + 14 * k)
    assert len(res[(3, nid)][1]) == taille, "taille d'icône"
    print(f"icône {w or 256}×{h or 256} {bits} bits, {taille} octets")
assert res[(3, 1)][1][:8] == b"\x89PNG\r\n\x1a\n"
v = res[(16, 1)][1]
assert v[6:6 + 30].decode("utf-16-le") == "VS_VERSION_INFO"
texte = v.decode("utf-16-le", errors="replace")
for cle in ("CompanyName", "FileDescription", "FileVersion", "ProductName", "OriginalFilename"):
    i = texte.index(cle) + len(cle)
    valeur = texte[i:].lstrip("\0").split("\0")[0]
    print(f"{cle} = {valeur}")
sig = struct.unpack_from("<I", v, 40)[0]
print("signature fiche", hex(sig))
assert res[(24, 1)][1].startswith(b"<?xml")
print("TOUT EST BON")
