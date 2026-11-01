"""Étude bandes d'agglo 38/28 HYBL.

Usage : etude_bandes.py source.xlsx sortie.xlsx [écart maxi en largeur, mm]
Sans écart : une pièce va dans une bande dès qu'elle y tient en largeur.
Avec écart : la largeur de la pièce (sur-cote) doit être à moins de l'écart de la largeur de bande.
"""
import openpyxl, sys, collections
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter as L
source, sortie = sys.argv[1], sys.argv[2]
ECART = float(sys.argv[3]) if len(sys.argv) > 3 else None

# Réglages (Cutrite agglo.prm de l'atelier : OPKERF 4.4, OPCROSSTRIM 25, OPROTATE 1)
LONG_BANDE, TRAIT, RECOUPE, PERTE = 4200, 4.4, 25, 50
LU = LONG_BANDE - 2 * RECOUPE - PERTE
# Largeur de bande -> plus grande pièce (sur-cote) acceptée dedans : 660 (650 + 10) se coupe dans 658.
ACCEPTE = {658: 660, 510: 510}

wb0 = openpyxl.load_workbook(source, data_only=True)
rows = list(wb0['Pièces'].iter_rows(values_only=True)); h = rows[0]; ix = {n: i for i, n in enumerate(h)}
pieces = []
for r in rows[1:]:
    pieces.append(dict(sem=r[ix['Semaine']], fic=r[ix['Fichier de lancement']], cle=r[ix['Commande + ligne']],
                       client=r[ix['Client']], ref=r[ix['Référence']], ag=r[ix['Agglo']], q=int(r[ix['Qté']] or 0),
                       Lf=r[ix['Longueur finie']], Wf=r[ix['Largeur finie']], Ld=r[ix['Longueur sur-cote']], Wd=r[ix['Largeur sur-cote']],
                       c1=r[ix['Coloris dessus']], c2=r[ix['Coloris dessous']]))
assert min(min(p['Ld'] - p['Lf'], p['Wd'] - p['Wf']) for p in pieces) >= 5

# ---------- optimisation : bandes coupées en tronçons (en travers), tronçons refendus (en long) ----------
def orientation(a, b, Ws):
    """(long sur la bande, en travers) qui remplit le mieux la largeur de bande, ou None."""
    best = None
    for along, across in ((max(a, b), min(a, b)), (min(a, b), max(a, b))):
        if across <= ACCEPTE[Ws] and along <= LU and (ECART is None or across >= Ws - ECART):
            across = min(across, Ws)
            n = int((Ws + TRAIT) // (across + TRAIT))
            cle = (round(n * across / Ws, 6), along)
            if best is None or cle > best[0]: best = (cle, along, across)
    return None if best is None else best[1:]

def ranger(items, Ws):
    """items : [(along, across)] -> nombre de bandes, surface pièces."""
    items = sorted(items, key=lambda t: (-t[0], -t[1]))
    troncons = []  # [longueur, largeur utilisée]
    for along, across in items:
        for t in troncons:
            if t[1] + TRAIT + across <= Ws: t[1] += TRAIT + across; break
        else: troncons.append([along, across])
    bandes = []
    for t in sorted(troncons, key=lambda t: -t[0]):
        for i, used in enumerate(bandes):
            if used + TRAIT + t[0] <= LU: bandes[i] += TRAIT + t[0]; break
        else: bandes.append(t[0])
    return len(bandes), sum(a * b for a, b in items)

def scenario(largeurs):
    """Par semaine et agglo : {Ws: (nb bandes, nb pièces, surface)} + pièces hors bandes."""
    res = collections.defaultdict(dict); hors = collections.Counter()
    groupes = collections.defaultdict(lambda: collections.defaultdict(list))
    for p in pieces:
        choix = None
        for Ws in largeurs:
            o = orientation(p['Ld'], p['Wd'], Ws)
            if o:
                n = int((Ws + TRAIT) // (o[1] + TRAIT)); rempl = n * o[1] / Ws
                if choix is None or rempl > choix[0] + 1e-9: choix = (rempl, Ws, o)
        if choix is None: hors[(p['sem'], p['ag'])] += p['q']; continue
        groupes[(p['sem'], p['ag'])][choix[1]].extend([choix[2]] * p['q'])
    for g, parW in groupes.items():
        for Ws, items in parW.items():
            nb, surf = ranger(items, Ws)
            res[g][Ws] = (nb, len(items), surf)
    return res, hors

SCENARIOS = [(658,), (658, 510)]
resultats = {w: scenario(w) for w in SCENARIOS}

# ---------- classeur ----------
wb = openpyxl.Workbook()
A = 'Arial'
f = Font(name=A, size=10); fb = Font(name=A, size=10, bold=True); ft = Font(name=A, size=13, bold=True)
fh = Font(name=A, size=10, bold=True, color='FFFFFF'); fn = Font(name=A, size=9, italic=True, color='555555')
fill_h = PatternFill('solid', fgColor='1565C0'); fill_in = PatternFill('solid', fgColor='FFF59D')
bleu = Font(name=A, size=10, color='0000FF', bold=True)
def entete(ws, r, vals, c0=1):
    for i, v in enumerate(vals):
        c = ws.cell(r, c0 + i, v); c.font = fh; c.fill = fill_h; c.alignment = Alignment(wrap_text=True, vertical='center', horizontal='center')

# Cases de réglage de la Synthèse
params = [('long', 'Longueur de bande (mm)', LONG_BANDE, ''),
          ('b1', 'Largeur bande 1 (mm)', 658, ''),
          ('acc1', 'Pièces acceptées dans la bande 1 jusqu’à (mm)', ACCEPTE[658], '660 = 650 + 10 de sur-cote : se coupe dans la bande de 658'),
          ('b2', 'Largeur bande 2 (mm)', 510, '')]
if ECART is not None:
    params.append(('ecart', 'Écart maxi en largeur pièce / bande (mm)', ECART, 'Règle : la pièce (sur-cote) ne doit pas être plus étroite que la bande de plus de cet écart'))
params += [('rec', 'Recoupe à chaque bout (mm)', RECOUPE, 'Réglage Cutrite agglo de l’atelier (OPCROSSTRIM)'),
           ('perte', 'Perte obligatoire en plus par bande (mm)', PERTE, f'{LONG_BANDE} − 2 × {RECOUPE} − {PERTE} = {LU} mm utiles par bande'),
           ('trait', 'Trait de scie (mm)', TRAIT, 'Réglage Cutrite agglo de l’atelier (OPKERF) — sert au calcul des bandes')]
P = {k: f'$C${i}' for i, (k, *_ ) in enumerate(params, 4)}
UTILE = f"{P['long']}-2*{P['rec']}-{P['perte']}"

def passe(i, larg, acc, prefixe):
    """Formule « oui/non » : la pièce de la ligne i passe dans la bande."""
    q = lambda k: prefixe + P[k]
    utile = f"{q('long')}-2*{q('rec')}-{q('perte')}"
    if ECART is None:
        return f'=IF(AND(L{i}<={q(acc)},M{i}<={utile}),"oui","non")'
    mini = f"{q(larg)}-{q('ecart')}"
    return (f'=IF(AND(M{i}<={utile},OR(AND(L{i}>={mini},L{i}<={q(acc)}),AND(M{i}>={mini},M{i}<={q(acc)}))),"oui","non")')

# Feuille Pièces
wp = wb.active; wp.title = 'Pièces'
cols = ['Semaine', 'Fichier de lancement', 'Commande + ligne', 'Client', 'Référence', 'Agglo', 'Qté',
        'Longueur finie', 'Largeur finie', 'Longueur sur-cote', 'Largeur sur-cote',
        'Petit côté sur-cote', 'Grand côté sur-cote', 'Passe en 510', 'Passe en 658', 'Coloris dessus', 'Coloris dessous']
entete(wp, 1, cols)
for i, p in enumerate(sorted(pieces, key=lambda p: (p['sem'], p['ag'], p['fic'], p['cle'])), 2):
    vals = [p['sem'], p['fic'], p['cle'], p['client'], p['ref'], p['ag'], p['q'], p['Lf'], p['Wf'], p['Ld'], p['Wd'],
            f'=MIN(J{i},K{i})', f'=MAX(J{i},K{i})', passe(i, 'b2', 'b2', 'Synthèse!'), passe(i, 'b1', 'acc1', 'Synthèse!'),
            p['c1'], p['c2']]
    for j, v in enumerate(vals, 1): wp.cell(i, j, v).font = f
N = len(pieces) + 1
for j, w in enumerate([8, 26, 16, 13, 20, 12, 6, 9, 9, 10, 10, 10, 10, 9, 9, 10, 10], 1): wp.column_dimensions[L(j)].width = w
wp.freeze_panes = 'A2'; wp.auto_filter.ref = f'A1:Q{N}'
rng = lambda c: f"Pièces!${c}$2:${c}${N}"

# Feuille Synthèse
ws = wb.create_sheet('Synthèse', 0)
titre = 'Étude bandes d’agglo 38 HYBL et 28 HYBL — semaines 35 à 45'
if ECART is not None: titre += f' — écart en largeur ≤ {ECART / 10:g} cm'
ws['A1'] = titre; ws['A1'].font = ft
ws['A3'] = 'Réglages (cases jaunes modifiables)'; ws['A3'].font = fb
for k, (_, lib, v, note) in enumerate(params, 4):
    ws.cell(k, 2, lib).font = f; c = ws.cell(k, 3, v); c.font = bleu; c.fill = fill_in
    if note: ws.cell(k, 4, note).font = fn

r = 4 + len(params) + 1
n_sec = 1
ws.cell(r, 1, f'{n_sec}. Combien de pièces passent dans les bandes, avec la sur-cote actuelle').font = fb
entete(ws, r + 1, ['Agglo', 'Pièces', 'Passent en 510', 'Passent en 658 (pas en 510)', 'Ne passent pas', '% en 510', '% en 658 ou 510'], 2)
ligne_ag = {}
for k, ag in enumerate(('SAG38HYBL', 'SAG28HYBL', 'Total')):
    rr = r + 2 + k; ligne_ag[ag] = rr
    ws.cell(rr, 2, ag).font = fb if ag == 'Total' else f
    if ag == 'Total':
        for c in 'CDEF': ws[f'{c}{rr}'] = f'=SUM({c}{r+2}:{c}{r+3})'
    else:
        cond = f'({rng("F")}="{ag}")'
        ws[f'C{rr}'] = f'=SUMPRODUCT({cond}*{rng("G")})'
        ws[f'D{rr}'] = f'=SUMPRODUCT({cond}*({rng("N")}="oui")*{rng("G")})'
        ws[f'E{rr}'] = f'=SUMPRODUCT({cond}*({rng("O")}="oui")*({rng("N")}="non")*{rng("G")})'
        ws[f'F{rr}'] = f'=C{rr}-D{rr}-E{rr}'
    ws[f'G{rr}'] = f'=IF(C{rr}=0,0,D{rr}/C{rr})'; ws[f'H{rr}'] = f'=IF(C{rr}=0,0,(D{rr}+E{rr})/C{rr})'
    for c in 'CDEFGH': ws[f'{c}{rr}'].font = fb if ag == 'Total' else f
    ws[f'G{rr}'].number_format = ws[f'H{rr}'].number_format = '0%'
r += 6

if ECART is None:
    n_sec += 1
    ws.cell(r, 1, f'{n_sec}. En fonction de la sur-cote (toutes les sur-cotes baissées d’autant)').font = fb
    entete(ws, r + 1, ['Sur-cote (mm)', '38 HYBL en 658', '% 38 HYBL', '28 HYBL en 658', '% 28 HYBL', '38 HYBL en 510', '28 HYBL en 510'], 2)
    for k, s in enumerate((10, 9, 8, 7, 6, 5)):
        rr = r + 2 + k
        c = ws.cell(rr, 2, s); c.font = bleu if k else fb
        for col, ag, larg in (('C', 'SAG38HYBL', P['acc1']), ('E', 'SAG28HYBL', P['acc1']), ('G', 'SAG38HYBL', P['b2']), ('H', 'SAG28HYBL', P['b2'])):
            ws[f'{col}{rr}'] = (f'=SUMPRODUCT(({rng("F")}="{ag}")*({rng("L")}-(10-$B{rr})<={larg})'
                                f'*({rng("M")}-(10-$B{rr})<={UTILE})*{rng("G")})')
        ws[f'D{rr}'] = f'=IF($C${ligne_ag["SAG38HYBL"]}=0,0,C{rr}/$C${ligne_ag["SAG38HYBL"]})'
        ws[f'F{rr}'] = f'=IF($C${ligne_ag["SAG28HYBL"]}=0,0,E{rr}/$C${ligne_ag["SAG28HYBL"]})'
        for c in 'CDEFGH': ws[f'{c}{rr}'].font = f
        ws[f'D{rr}'].number_format = ws[f'F{rr}'].number_format = '0%'
    ws.cell(r + 8, 2, '10 = sur-cote actuelle. Les pièces de 660 (650 + 10) sont comptées dans la bande de 658.').font = fn
    r += 11

n_sec += 1
ws.cell(r, 1, f'{n_sec}. Bandes nécessaires (optimisation par semaine, toutes couleurs mélangées sur une bande)').font = fb
entete(ws, r + 1, ['Bandes utilisées', 'Agglo', 'Pièces en bandes', 'Bandes 658', 'Bandes 510', 'Remplissage des bandes', 'Pièces hors bandes'], 2)
rr = r + 2
for larg in SCENARIOS:
    res, hors = resultats[larg]
    for ag in ('SAG38HYBL', 'SAG28HYBL'):
        nb = {W: sum(v[W][0] for g, v in res.items() if g[1] == ag and W in v) for W in (658, 510)}
        np_ = sum(v[W][1] for g, v in res.items() if g[1] == ag for W in v)
        surf = sum(v[W][2] for g, v in res.items() if g[1] == ag for W in v)
        surf_b = sum(nb[W] * LONG_BANDE * W for W in nb)
        vals = [' + '.join(str(w) for w in larg), ag, np_, nb[658], nb[510] if 510 in larg else '—',
                surf / surf_b if surf_b else 0, sum(v for g, v in hors.items() if g[1] == ag)]
        for j, v in enumerate(vals, 2): ws.cell(rr, j, v).font = f
        ws.cell(rr, 7).number_format = '0%'
        rr += 1
ws.cell(rr, 2, 'Calculé par Claude (bandes coupées en tronçons puis refendues, trait de scie, recoupes et 50 mm ci-dessus). Valeurs fixes : ne bougent pas si on change les réglages.').font = fn
ws.cell(rr + 1, 2, 'Remplissage = surface des pièces (sur-cote) / surface des bandes achetées (4200 × largeur). Une bande entamée compte comme une bande entière.').font = fn

r = rr + 3
ws.cell(r, 1, 'Ce qui a été pris').font = fb
regle = ('Une pièce passe si son petit côté ≤ largeur de bande (660 accepté en 658)' if ECART is None else
         f'Une pièce passe si sa largeur (sur-cote) est entre la largeur de bande − {ECART:g} mm et la largeur de bande (660 accepté en 658) : '
         f'658 → de {658 - ECART:g} à 660, 510 → de {510 - ECART:g} à 510')
notes = ['Pièces : les 2 029 pièces 38 HYBL et 28 HYBL du fichier Pieces_38_28_HYBL (lancements stratifiés, Trigano, AIRDESIGN, SIBYLLE, EQUI76, LAN264301CASSE).',
         f'Cotes avec sur-cote. {regle}, et son grand côté ≤ {LU} mm. La pièce peut tourner (agglo brut, Cutrite OPROTATE 1).'
         + ('' if ECART is None else ' Pas de pièces côte à côte dans une bande.'),
         'La largeur de bande n’est pas recoupée : une pièce de 658 ou 660 de large se coupe dans une bande de 658 sans refendre.',
         'Les couleurs ne comptent pas : l’agglo est coupé avant le placage, des pièces de couleurs différentes peuvent être dans la même bande.']
for k, n in enumerate(notes, 1): ws.cell(r + k, 2, n).font = f
ws.column_dimensions['A'].width = 3; ws.column_dimensions['B'].width = 30
for c, w in zip('CDEFGHI', (16, 16, 16, 14, 14, 14, 14)): ws.column_dimensions[c].width = w

# Feuille Bandes par semaine
wbs = wb.create_sheet('Bandes par semaine', 1)
entete(wbs, 1, ['Semaine', 'Agglo', 'Pièces', 'Hors bandes (658 seules)', 'Bandes 658 seules', '658 + 510 : bandes 658', '658 + 510 : bandes 510', 'Hors bandes (658 + 510)'])
tot = collections.Counter()
for p in pieces: tot[(p['sem'], p['ag'])] += p['q']
rr = 2
for (sem, ag) in sorted(tot):
    a = resultats[(658,)][0].get((sem, ag), {}); b = resultats[(658, 510)][0].get((sem, ag), {})
    v = [sem, ag, tot[(sem, ag)], resultats[(658,)][1][(sem, ag)], a.get(658, (0,))[0], b.get(658, (0,))[0], b.get(510, (0,))[0],
         resultats[(658, 510)][1][(sem, ag)]]
    for j, x in enumerate(v, 1): wbs.cell(rr, j, x).font = f
    rr += 1
wbs.cell(rr, 1, 'Total').font = fb
for j in range(3, 9):
    c = wbs.cell(rr, j, '=SUM({0}2:{0}{1})'.format(L(j), rr - 1)); c.font = fb
for j, w in enumerate([9, 12, 8, 11, 12, 12, 12, 11], 1): wbs.column_dimensions[L(j)].width = w
wbs.row_dimensions[1].height = 32; wbs.freeze_panes = 'C2'
wb.active = 0
wb.save(sortie)
