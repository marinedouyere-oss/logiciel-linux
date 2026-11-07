"""Copie un classeur en ajoutant une copie exacte de sa dernière ligne (test des doublons).

Usage : dupliquer_derniere_ligne.py source.xlsx sortie.xlsx
"""
import re, sys, zipfile

source, sortie = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(source) as z:
    parties = [(i, z.read(i.filename)) for i in z.infolist()]
nom = "xl/worksheets/sheet1.xml"
for k, (info, octets) in enumerate(parties):
    if info.filename != nom:
        continue
    xml = octets.decode("utf-8")
    lignes = list(re.finditer(r"<row\b[^>]*?(?:/>|>.*?</row>)", xml, re.S))
    derniere = lignes[-1]
    n = int(re.search(r'\br="(\d+)"', derniere.group(0)).group(1))
    copie = re.sub(r'\br="(\d+)"', f'r="{n + 1}"', derniere.group(0), count=1)
    copie = re.sub(r'(<c\b[^>]*?\br="[A-Z]{1,3})' + str(n) + '"', lambda m: f'{m.group(1)}{n + 1}"', copie)
    xml = xml[: derniere.end()] + copie + xml[derniere.end():]
    xml = re.sub(r'(<dimension ref="[A-Z]+\d+:[A-Z]+)\d+"', lambda m: f'{m.group(1)}{n + 1}"', xml)
    parties[k] = (info, xml.encode("utf-8"))
    print("ligne", n, "dupliquée en", n + 1)
with zipfile.ZipFile(sortie, "w", zipfile.ZIP_DEFLATED) as z:
    for info, octets in parties:
        z.writestr(info, octets)
