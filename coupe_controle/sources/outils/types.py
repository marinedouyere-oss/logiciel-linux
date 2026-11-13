import zipfile, sys, re, collections
for chemin in sys.argv[1:]:
    z = zipfile.ZipFile(chemin)
    ctts = [n for n in z.namelist() if n.lower().endswith('.ctt') and '_' not in n.rsplit('/',1)[-1]]
    for nom in ctts:
        t = z.read(nom).decode('latin-1')
        types = collections.Counter(m.group(2) for m in re.finditer(r'^PNL3,([A-Z]+\d+):(T[A-Z0-9]+):', t, re.M))
        print(chemin.split('/')[-1], '|', nom.rsplit('/',1)[-1], '|', dict(types))
