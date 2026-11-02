"""Ressources Windows du .exe de Sentinelle : icône Laisné, fiche « Propriétés »
(version, nom, société) et manifeste. Écrit rsrc_windows_amd64.syso, un fichier
objet COFF que « go build » ajoute tout seul au .exe.

Usage : python3 -I ressources.py <icone.png> <version> <sortie.syso>
Il faut Pillow (PIL) pour redimensionner l'icône.
"""
import io
import struct
import sys

from PIL import Image

RT_ICON, RT_GROUP_ICON, RT_VERSION, RT_MANIFEST = 3, 14, 16, 24
LANGUE = 0x040C  # français (France)
PAGE_CODE = 1200  # Unicode

MANIFESTE = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity type="win32" name="LaisneIndustrie.Sentinelle" version="{v4}" processorArchitecture="amd64"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application><supportedOS Id="{{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}}"/></application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>
</assembly>
"""


def aligner(b, n=4):
    return b + b"\0" * (-len(b) % n)


# ---- Icône : 256 px en PNG, 48 / 32 / 16 px en DIB 32 bits ----

def image_dib(img):
    """Image BGRA de bas en haut + masque ET vide, comme dans un .ico."""
    w, h = img.size
    entete = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    px = img.convert("RGBA").tobytes()
    lignes = []
    for y in range(h - 1, -1, -1):
        ligne = px[y * w * 4:(y + 1) * w * 4]
        lignes.append(b"".join(bytes((ligne[i + 2], ligne[i + 1], ligne[i], ligne[i + 3])) for i in range(0, len(ligne), 4)))
    masque = b"\0" * (((w + 31) // 32) * 4 * h)
    return entete + b"".join(lignes) + masque


def icones(chemin):
    source = Image.open(chemin).convert("RGBA")
    images = []
    for taille in (256, 48, 32, 16):
        img = source.resize((taille, taille), Image.LANCZOS)
        if taille == 256:
            tampon = io.BytesIO()
            img.save(tampon, format="PNG")
            images.append((taille, tampon.getvalue()))
        else:
            images.append((taille, image_dib(img)))
    groupe = struct.pack("<HHH", 0, 1, len(images))
    for n, (taille, octets) in enumerate(images, 1):
        groupe += struct.pack("<BBBBHHIH", taille % 256, taille % 256, 0, 0, 1, 32, len(octets), n)
    return [octets for _, octets in images], groupe


# ---- Fiche de version (VS_VERSIONINFO) ----

def bloc(cle, valeur=b"", texte=False, enfants=(), longueur_valeur=None):
    """Un bloc de la fiche de version : longueur, longueur de la valeur, type, clé, valeur, puis les blocs enfants."""
    b = bytearray(6) + (cle + "\0").encode("utf-16-le")
    b += b"\0" * (-len(b) % 4)
    b += valeur
    for enfant in enfants:
        b += b"\0" * (-len(b) % 4)
        b += enfant
    if longueur_valeur is None:
        longueur_valeur = len(valeur) // 2 if texte else len(valeur)
    struct.pack_into("<HHH", b, 0, len(b), longueur_valeur, 1 if texte else 0)
    return bytes(b)


def fiche_version(version, textes):
    parties = [int(x) for x in version.split(".")] + [0, 0, 0, 0]
    ms = (parties[0] << 16) | parties[1]
    ls = (parties[2] << 16) | parties[3]
    fixe = struct.pack("<13I", 0xFEEF04BD, 0x00010000, ms, ls, ms, ls, 0x3F, 0, 0x00040004, 1, 0, 0, 0)
    chaines = [bloc(k, (v + "\0").encode("utf-16-le"), texte=True) for k, v in textes.items()]
    table = bloc(f"{LANGUE:04X}{PAGE_CODE:04X}", texte=True, enfants=chaines, longueur_valeur=0)
    infos_texte = bloc("StringFileInfo", texte=True, enfants=[table], longueur_valeur=0)
    traduction = bloc("Translation", struct.pack("<HH", LANGUE, PAGE_CODE))
    infos_var = bloc("VarFileInfo", texte=True, enfants=[traduction], longueur_valeur=0)
    return bloc("VS_VERSION_INFO", fixe, enfants=[infos_texte, infos_var])


# ---- Arbre des ressources et fichier COFF ----

def section_rsrc(ressources):
    """ressources : {type: {id: octets}} → (octets de la section, positions des adresses à reloger)."""
    types = sorted(ressources)
    # Taille des répertoires : racine + un répertoire par type + un répertoire de langue par ressource.
    taille_rep = lambda n: 16 + 8 * n
    pos = taille_rep(len(types))
    pos_type = {}
    for t in types:
        pos_type[t] = pos
        pos += taille_rep(len(ressources[t]))
    pos_langue = {}
    for t in types:
        for i in sorted(ressources[t]):
            pos_langue[(t, i)] = pos
            pos += taille_rep(1)
    pos_entree = {}
    for t in types:
        for i in sorted(ressources[t]):
            pos_entree[(t, i)] = pos
            pos += 16
    pos_donnees = {}
    for t in types:
        for i in sorted(ressources[t]):
            pos = (pos + 7) & ~7
            pos_donnees[(t, i)] = pos
            pos += len(ressources[t][i])
    section = bytearray(pos)
    rep = lambda n: struct.pack("<IIHHHH", 0, 0, 0, 0, 0, n)
    o = 0
    section[o:o + 16] = rep(len(types))
    for k, t in enumerate(types):
        section[16 + 8 * k:24 + 8 * k] = struct.pack("<II", t, 0x80000000 | pos_type[t])
    relocations = []
    for t in types:
        ids = sorted(ressources[t])
        b = pos_type[t]
        section[b:b + 16] = rep(len(ids))
        for k, i in enumerate(ids):
            section[b + 16 + 8 * k:b + 24 + 8 * k] = struct.pack("<II", i, 0x80000000 | pos_langue[(t, i)])
            l = pos_langue[(t, i)]
            section[l:l + 16] = rep(1)
            section[l + 16:l + 24] = struct.pack("<II", LANGUE, pos_entree[(t, i)])
            e = pos_entree[(t, i)]
            section[e:e + 16] = struct.pack("<IIII", pos_donnees[(t, i)], len(ressources[t][i]), 0, 0)
            relocations.append(e)
            d = pos_donnees[(t, i)]
            section[d:d + len(ressources[t][i])] = ressources[t][i]
    return bytes(aligner(bytes(section), 8)), relocations


def coff(section, relocations):
    IMAGE_REL_AMD64_ADDR32NB = 3
    debut_section = 20 + 40
    debut_reloc = debut_section + len(section)
    debut_symboles = debut_reloc + 10 * len(relocations)
    entete = struct.pack("<HHIIIHH", 0x8664, 1, 0, debut_symboles, 1, 0, 0)
    entete_section = struct.pack("<8sIIIIIIHHI", b".rsrc", 0, 0, len(section), debut_section, debut_reloc, 0, len(relocations), 0, 0x40000040)
    relocs = b"".join(struct.pack("<IIH", r, 0, IMAGE_REL_AMD64_ADDR32NB) for r in relocations)
    symbole = struct.pack("<8sIhHBB", b".rsrc", 0, 1, 0, 3, 0)
    chaines = struct.pack("<I", 4)
    return entete + entete_section + section + relocs + symbole + chaines


def main():
    icone, version, sortie = sys.argv[1:4]
    # Nom du logiciel et ce qu'il fait (Sentinelle par défaut ; « Claustra » pour le logiciel à part).
    nom = sys.argv[4] if len(sys.argv) > 4 else "Sentinelle"
    role = sys.argv[5] if len(sys.argv) > 5 else "Contrôle de coupe"
    v4 = ".".join((version.split(".") + ["0", "0", "0"])[:4])
    images, groupe = icones(icone)
    textes = {
        "CompanyName": "LAISNÉ INDUSTRIE",
        "FileDescription": f"{nom} V{version} — {role}",
        "FileVersion": version,
        "InternalName": nom,
        "LegalCopyright": "LAISNÉ INDUSTRIE",
        "OriginalFilename": f"{nom} V{version}.exe",
        "ProductName": nom,
        "ProductVersion": version,
    }
    ressources = {
        RT_ICON: {n: octets for n, octets in enumerate(images, 1)},
        RT_GROUP_ICON: {1: groupe},
        RT_VERSION: {1: fiche_version(version, textes)},
        RT_MANIFEST: {1: MANIFESTE.format(v4=v4).replace("LaisneIndustrie.Sentinelle", f"LaisneIndustrie.{nom}").encode("utf-8")},
    }
    section, relocations = section_rsrc(ressources)
    with open(sortie, "wb") as f:
        f.write(coff(section, relocations))
    print(sortie, len(section), "octets de ressources")


if __name__ == "__main__":
    main()
