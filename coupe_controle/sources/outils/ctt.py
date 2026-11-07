import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
nom = [n for n in z.namelist() if n.lower().endswith(sys.argv[2].lower())][0]
t = z.read(nom).decode('latin-1')
lignes = t.splitlines()
print(nom, len(lignes), 'lignes')
debut = int(sys.argv[3]) if len(sys.argv) > 3 else 0
for l in lignes[debut:debut+int(sys.argv[4]) if len(sys.argv) > 4 else 40]: print('   ', l[:300])
