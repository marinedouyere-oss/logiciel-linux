import openpyxl, sys, glob, os, re, collections, warnings
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
warnings.filterwarnings('ignore')
racine, sortie = sys.argv[1], sys.argv[2]
CIBLES = ('SAG38HYBL', 'SAG28HYBL') + (('SAG38HYBLLINEX',) if 'linex' in sys.argv[3:] else ())
EXCLUS = {
    'LAN264201ESSAIS BANDE.xlsx': 'Essais : copie de 96 pièces de LAN264201STRAT',
    'LAN264301CASSEANALYSE.xlsx': 'Analyse : copie de LAN264301CASSE',
    'LAN2638COMPACT.xlsx': 'Feno (même lancement LAN263805 que LAN2638FENO)',
    'LAN2645en atttente.xlsx': 'Pièces en attente, pas lancées',
    'LAN263801CRED.xlsx': 'Extrait de LAN263801STRAT (4 pièces déjà dedans)',
    'LAN2641com062FA.xlsx': 'Extrait de LAN2641FENO (2 pièces déjà dedans)',
    'LAN26CLAUSTRA.xlsx': 'Pas de code de lancement (nom de client à la place)',
    'LAN26CLAUSTRAbis.xlsx': 'Pas de code de lancement (nom de client à la place)',
    'LAN2645FIBREETBOIS.xlsx': 'Pas de code de lancement',
}
retires = []
REMIS = {'LAN2639AIRDESIGN.XLSX', 'LAN26360SIBYLLE.XLSX', 'LAN2643EQUI76.XLSX', 'LAN264301CASSE.XLSX'}
def raison(nom):
    u = nom.upper()
    # Lancements stratifiés : LAN26xx01STRAT / LAN26xx02STRAT (en semaine 43, le 1er tour s'appelle LAN264301AGGLO).
    if ('STRAT' in u and 'RECYCLAGE' not in u) or u == 'LAN264301AGGLO.XLSX': return None
    # Remis à la demande : les Trigano et les lancements surlignés en jaune.
    if 'TRIGANO' in u or u in REMIS: return None
    if 'FENO' in u: return 'Feno'
    return EXCLUS.get(nom) or 'Pas un lancement stratifié'
feno_ailleurs = []
def T(v):
    return int(v) if isinstance(v, float) and v.is_integer() else (None if v is None else (v.strip() if isinstance(v, str) else v))
def semaine(chemin):
    m = re.search(r'Semaine (\d+)', chemin)
    return int(m.group(1)) if m else None
champs = [('conf_commande+ligne', 'Commande + ligne'), ('com_clientcom', 'Client'), ('com_reference', 'Référence'),
          ('conf_article', 'Article'), ('agglo', 'Agglo'), ('conf_epaisseur', 'Épaisseur finie'),
          ('conf_longueur', 'Longueur finie'), ('conf_largeur', 'Largeur finie'),
          ('longueur', 'Longueur sur-cote'), ('largeur', 'Largeur sur-cote'), ('comdet_qte', 'Qté'),
          ('coloris', 'Coloris dessus'), ('coloris_inf', 'Coloris dessous'), ('com_livsem', 'Semaine livraison'),
          ('commentaire', 'Commentaire')]
lignes = []
for f in sorted(glob.glob(racine + '/**/*.xlsx', recursive=True)):
    if os.path.basename(f).startswith('~$'): continue
    wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    if not rows: continue
    I = {n: i for i, n in enumerate(rows[0]) if n is not None}
    if 'agglo' not in I: continue
    rel = os.path.relpath(f, racine)
    if raison(os.path.basename(f)):
        n38 = n28 = 0
        for r in rows[1:]:
            r = tuple(r) + (None,) * 80
            a = T(r[I['agglo']]); q = T(r[I['comdet_qte']]) or 0
            if isinstance(a, str) and a.upper() == 'SAG38HYBL': n38 += q
            if isinstance(a, str) and a.upper() == 'SAG28HYBL': n28 += q
        retires.append((semaine(rel), os.path.basename(f), raison(os.path.basename(f)), n38, n28))
        continue
    # Pièces Feno dans un autre lancement (casse...) : support d'un compact FENO.
    cles_feno = set()
    for r in rows[1:]:
        r = tuple(r) + (None,) * 80
        a = T(r[I['agglo']])
        if isinstance(a, str) and a.upper().startswith('FENO'): cles_feno.add(T(r[I['commande+ligne']]))
    for r in rows[1:]:
        r = tuple(r) + (None,) * 80
        a = T(r[I['agglo']])
        if not isinstance(a, str) or a.upper() not in CIBLES: continue
        if T(r[I['commande+ligne']]) in cles_feno:
            feno_ailleurs.append((os.path.basename(f), T(r[I['commande+ligne']]), a, T(r[I['comdet_qte']])))
            continue
        d = {k: T(r[i]) for k, i in I.items()}
        cle = d.get('commande+ligne') or ((d.get('conf_commande') or '') + str(d.get('conf_ligne') or '').zfill(3))
        d['conf_commande+ligne'] = cle
        d['agglo'] = a.upper()
        lignes.append((semaine(rel), os.path.basename(f), d.get('comprod_lancement'), d))
lignes.sort(key=lambda x: (x[0] or 0, x[1], x[3]['conf_commande+ligne']))
fichiers_par_cle = collections.defaultdict(list)
for s, fic, lan, d in lignes:
    if fic not in fichiers_par_cle[d['conf_commande+ligne']]: fichiers_par_cle[d['conf_commande+ligne']].append(fic)

wb = openpyxl.Workbook()
police = Font(name='Arial', size=10); gras = Font(name='Arial', size=10, bold=True, color='FFFFFF')
fond = PatternFill('solid', fgColor='1565C0')
ws = wb.active; ws.title = 'Pièces'
entetes = ['Semaine', 'Fichier de lancement', 'Lancement'] + [t for _, t in champs] + ['Aussi dans']
ws.append(entetes)
for s, fic, lan, d in lignes:
    autres = [x for x in fichiers_par_cle[d['conf_commande+ligne']] if x != fic]
    ws.append([s, fic, lan] + [d.get(k) for k, _ in champs] + [', '.join(autres) or None])
for c in ws[1]: c.font = gras; c.fill = fond; c.alignment = Alignment(vertical='center', wrap_text=True)
for row in ws.iter_rows(min_row=2):
    for c in row: c.font = police
largeurs = [9, 30, 12, 17, 14, 22, 18, 13, 9, 9, 9, 10, 10, 6, 10, 10, 10, 22, 34]
for i, w in enumerate(largeurs, 1): ws.column_dimensions[get_column_letter(i)].width = w
ws.freeze_panes = 'A2'; ws.auto_filter.ref = ws.dimensions
n = len(lignes) + 1
colQ = get_column_letter(entetes.index('Qté') + 1); colA = get_column_letter(entetes.index('Agglo') + 1)

r = wb.create_sheet('Résumé')
r.append(['Semaine', 'SAG38HYBL (pièces)', 'SAG28HYBL (pièces)', 'Total'])
semaines = sorted({s for s, *_ in lignes if s is not None})
for i, s in enumerate(semaines, 2):
    r.append([s,
              f"=SUMIFS(Pièces!${colQ}$2:${colQ}${n},Pièces!$A$2:$A${n},A{i},Pièces!${colA}$2:${colA}${n},\"SAG38HYBL\")",
              f"=SUMIFS(Pièces!${colQ}$2:${colQ}${n},Pièces!$A$2:$A${n},A{i},Pièces!${colA}$2:${colA}${n},\"SAG28HYBL\")",
              f"=B{i}+C{i}"])
t = len(semaines) + 2
r.append(['Total', f'=SUM(B2:B{t-1})', f'=SUM(C2:C{t-1})', f'=SUM(D2:D{t-1})'])
for c in r[1]: c.font = gras; c.fill = fond; c.alignment = Alignment(wrap_text=True, vertical='center')
for row in r.iter_rows(min_row=2):
    for c in row: c.font = police
for c in r[t]: c.font = Font(name='Arial', size=10, bold=True)
for col, w in zip('ABCD', (10, 18, 18, 10)): r.column_dimensions[col].width = w
r.append([])
r.append(['Pièces = somme des quantités, lancements stratifiés (1er et 2ème tour), Trigano, AIRDESIGN, SIBYLLE, EQUI76 et LAN264301CASSE (les fichiers retirés sont dans l’onglet « Fichiers retirés »). Une pièce de casse recoupée compte à chaque lancement : voir « Aussi dans ».'])
r.cell(r.max_row, 1).font = Font(name='Arial', size=9, italic=True)
x = wb.create_sheet('Fichiers retirés')
x.append(['Semaine', 'Fichier', 'Pourquoi', '38 HYBL', '28 HYBL'])
for ligne in sorted(retires, key=lambda v: (v[0] or 0, v[1])): x.append(list(ligne))
for c in x[1]: c.font = gras; c.fill = fond
for row in x.iter_rows(min_row=2):
    for c in row: c.font = police
for col, w in zip('ABCDE', (9, 30, 50, 9, 9)): x.column_dimensions[col].width = w
wb.move_sheet('Résumé', offset=-1); wb.active = 0
wb.save(sortie)
print(len(lignes), 'lignes', len(fichiers_par_cle), 'commandes+lignes différentes', 'doublons', sum(1 for v in fichiers_par_cle.values() if len(v) > 1))
print('retirés', [(a, b, d, e) for a, b, c, d, e in retires])
print('feno dans autres fichiers', feno_ailleurs)
