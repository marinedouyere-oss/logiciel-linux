import zipfile, sys, collections
z = zipfile.ZipFile(sys.argv[1])
noms = z.namelist()
print(len(noms), 'entrées ; extensions :', collections.Counter(n.rsplit('.',1)[-1].lower() for n in noms))
ctt = [n for n in noms if n.lower().endswith('.ctt')]
print('ctt :', ctt[:20])
for n in noms[:40]: print('   ', n, z.getinfo(n).file_size)
