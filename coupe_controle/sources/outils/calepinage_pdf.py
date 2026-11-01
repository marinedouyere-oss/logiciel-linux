"""PDF des modèles de bande (calepinage) à partir du JSON de calepinage.py.

Usage : calepinage_pdf.py calepinage.json sortie.pdf [lancement.xlsx « 1er tour »]
Les bandes sont optimisées par lancement : un PDF par lancement.
"""
import sys, json, hashlib, datetime, colorsys
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont('DV', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DVB', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))

d = json.load(open(sys.argv[1])); sortie = sys.argv[2]
LANCEMENT, TOUR = (sys.argv[3], sys.argv[4]) if len(sys.argv) > 4 else (None, None)
if LANCEMENT: d['plan'] = [l for l in d['plan'] if l['fichier'] == LANCEMENT]
R = d['regles']; LONG, REC, PERTE, TRAIT, UTILE = R['longueur'], R['recoupe'], R['perte'], R['trait'], R['utile']
PW, PH = landscape(A4); M = 12 * mm
NOM_AGGLO = {'SAG38HYBL': 'SAG38HYBL + LINEX', 'SAG28HYBL': 'SAG28HYBL'}
BLEU = colors.HexColor('#1565C0'); FONCE = colors.HexColor('#0D2B5C'); GRIS = colors.HexColor('#9AA5B1')
ORANGE = colors.HexColor('#E65100'); CLAIR = colors.HexColor('#F3F5F8')
SEUIL = 0.5  # bande remplie à moins de 50 % : signalée

def teinte(code):
    """Couleur pastel stable pour un code coloris (le vrai décor n'est pas connu)."""
    h = int(hashlib.md5(str(code).encode()).hexdigest()[:6], 16)
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360, 0.82, 0.55)
    return colors.Color(r, g, b)

def txt(c, x, y, s, taille=8, gras=False, couleur=colors.black, align='l'):
    c.setFont('DVB' if gras else 'DV', taille); c.setFillColor(couleur)
    {'l': c.drawString, 'r': c.drawRightString, 'c': c.drawCentredString}[align](x, y, str(s))

def coupe(s, largeur, taille, gras=False):
    """Raccourcit un texte pour qu'il tienne dans la largeur."""
    s = str(s); f = 'DVB' if gras else 'DV'
    while s and pdfmetrics.stringWidth(s, f, taille) > largeur: s = s[:-1]
    return s

def nb(x): return f'{x:g}'.replace('.', ',')

def pied(c, page, titre):
    txt(c, PW - M, 7 * mm, f'{titre} — page {page}', 7, couleur=GRIS, align='r')

titre_doc = (f"Calepinage bandes 38 et 28 HYBL — {LANCEMENT.replace('.xlsx', '')} ({TOUR}) — semaine {d['semaine']}" if LANCEMENT
             else f"Calepinage bandes 38 et 28 HYBL — semaine {d['semaine']}")
c = canvas.Canvas(sortie, pagesize=(PW, PH)); c.setTitle(titre_doc); c.setAuthor('Sentinelle — Laisné Industrie')
page = 1

# ---------- Page 1 : règles, repères, résumé ----------
y = PH - M - 6 * mm
txt(c, M, y, titre_doc, 17, True, FONCE); y -= 6 * mm
txt(c, M, y, f'Modèles de bande à partir des vraies pièces du lancement · {datetime.date.today():%d/%m/%Y}', 9, couleur=colors.HexColor('#555555'))
y -= 11 * mm
txt(c, M, y, 'Les codes d’appairage', 11, True, FONCE); y -= 6 * mm
ex = next(b['pieces'] for l in d['plan'] for g in l['groupes'] for b in g['bandes'] if len(b['pieces']) == 2)
for l in [f'Les deux pièces d’une même bande ont le même code, écrit après le CVC : « {ex[0]["cle"]} {ex[0]["code"]} » va avec « {ex[1]["cle"]} {ex[1]["code"]} ».',
          'Une bande = un code : A1, A2 … A9, puis B1 … B9, etc. Le code est à écrire sur le stratifié dessus et dessous de la pièce.',
          'Les deux pièces d’une bande peuvent être de couleurs différentes. Le dessin montre laquelle va au départ de la bande.']:
    txt(c, M + 3 * mm, y, '• ' + l, 9); y -= 5 * mm
y -= 4 * mm
txt(c, M, y, 'Les règles', 11, True, FONCE); y -= 6 * mm
for l in [f'Bandes de {LONG} × 658 (pièces de 598 à 660 de large) et {LONG} × 510 (pièces de 450 à 510). Cotes avec sur-cote.',
          'Règle des 6 cm : la pièce est au plus 60 mm plus étroite que la bande, et les deux pièces d’une bande ont au plus 60 mm d’écart de largeur.',
          f'Longueur utile : {LONG} − 2 × {REC} de recoupe − {PERTE} obligatoires = {UTILE} mm. Trait de scie {nb(TRAIT)} mm entre les pièces.',
          f'Deux pièces au plus par bande. La pièce peut tourner (agglo brut). Bande remplie à moins de {SEUIL:.0%} : signalée en orange.'.replace('%', ' %')]:
    txt(c, M + 3 * mm, y, '• ' + l, 9); y -= 5 * mm
y -= 6 * mm
txt(c, M, y, 'Résumé', 11, True, FONCE); y -= 7 * mm
cols = [('Lancement', 0), ('Agglo', 52), ('Bande', 92), ('Bandes', 112), ('Pièces en bandes', 130), ('Remplissage moyen', 162),
        (f'Bandes < {SEUIL:.0%}'.replace('%', ' %'), 196), ('Pièces hors bandes', 224)]
c.setFillColor(BLEU); c.rect(M, y - 2 * mm, 255 * mm, 6.5 * mm, stroke=0, fill=1)
for t, x in cols: txt(c, M + 2 * mm + x * mm, y, t, 8, True, colors.white)
y -= 7 * mm
tot = [0, 0, 0, 0]
for l in d['plan']:
    lignes = [(NOM_AGGLO[g['agglo']], g['largeur'], len(g['bandes']), sum(len(b['pieces']) for b in g['bandes']),
               sum(b['remplissage'] for b in g['bandes']) / len(g['bandes']), sum(b['remplissage'] < SEUIL for b in g['bandes'])) for g in l['groupes']]
    for k, (ag, W, n, np_, r, faibles) in enumerate(lignes):
        vals = [l['fichier'].replace('.xlsx', '') if k == 0 else '', ag, W, n, np_, f'{r:.0%}'.replace('%', ' %'), faibles, len(l['hors']) if k == 0 else '']
        for (t, x), v in zip(cols, vals): txt(c, M + 2 * mm + x * mm, y, v, 8.5, couleur=ORANGE if (t.startswith('Bandes <') and v) else colors.black)
        tot[0] += n; tot[1] += np_; tot[2] += faibles
        y -= 5 * mm
    tot[3] += len(l['hors'])
    c.setStrokeColor(colors.HexColor('#C9D2DE')); c.line(M, y + 3 * mm, M + 255 * mm, y + 3 * mm)
for (t, x), v in zip(cols, ['Total', '', '', tot[0], tot[1], '', tot[2], tot[3]]): txt(c, M + 2 * mm + x * mm, y, v, 8.5, True)
pied(c, page, titre_doc); c.showPage(); page += 1

# ---------- Pages des bandes ----------
X0 = M + 12 * mm; LB = 248 * mm; ECH = LB / LONG; HB = 17 * mm
BLOC = 45 * mm

def bande(c, y, b, g, fichier):
    """Dessine une bande dont le haut du bloc est en y."""
    faible = b['remplissage'] < SEUIL
    entete = (f"Bande {b['code']}   ·   {NOM_AGGLO[g['agglo']]}   ·   {LONG} × {g['largeur']}   ·   {len(b['pieces'])} pièce(s)   ·   "
              f"remplissage {b['remplissage']:.0%}").replace('%', ' %')
    txt(c, M, y - 4 * mm, entete, 10, True, ORANGE if faible else FONCE)
    if faible: txt(c, M + 255 * mm, y - 4 * mm, 'peu remplie : mieux en panneau ?', 8, True, ORANGE, 'r')
    yb = y - 6 * mm - HB
    txt(c, M, yb + HB / 2 - 1.2 * mm, 'départ', 6.5, True, GRIS)
    # fond de bande + recoupes + 50 obligatoires
    c.setStrokeColor(colors.HexColor('#5F6B7A')); c.setLineWidth(0.6)
    c.setFillColor(colors.white); c.rect(X0, yb, LB, HB, stroke=1, fill=1)
    def zone(debut, long, coul, lib):
        c.setFillColor(coul); c.rect(X0 + debut * ECH, yb, long * ECH, HB, stroke=0, fill=1)
        if lib: txt(c, X0 + (debut + long / 2) * ECH, yb + HB / 2 - 1 * mm, lib, 5.5, couleur=colors.HexColor('#444444'), align='c')
    zone(0, REC, colors.HexColor('#CFD6DE'), '')
    zone(LONG - REC, REC, colors.HexColor('#CFD6DE'), '')
    zone(LONG - REC - PERTE, PERTE, colors.HexColor('#E3E8EE'), '')
    txt(c, X0 + (LONG - REC - PERTE / 2) * ECH, yb - 3 * mm, f'{PERTE}+{REC}', 5.5, couleur=GRIS, align='c')
    txt(c, X0 + REC / 2 * ECH, yb - 3 * mm, f'{REC}', 5.5, couleur=GRIS, align='c')
    x = REC; positions = []
    for k, u in enumerate(b['pieces']):
        if k: x += TRAIT
        c.setFillColor(teinte(u['dessus']) if u['dessus'] else colors.HexColor('#E0E0E0')); c.setStrokeColor(colors.HexColor('#37474F')); c.setLineWidth(0.8)
        c.rect(X0 + x * ECH, yb, u['long'] * ECH, HB, stroke=1, fill=1)
        lw = u['long'] * ECH - 2 * mm; cx = X0 + x * ECH + 1.5 * mm
        txt(c, cx, yb + HB - 6 * mm, u['code'], 13, True, FONCE)
        txt(c, cx, yb + HB - 10 * mm, coupe(f"{u['long']} × {u['travers']}", lw, 7.5), 7.5, True)
        txt(c, cx, yb + HB - 13.5 * mm, coupe(f"{u['dessus'] or '—'} / {u['dessous'] or '—'}", lw, 7), 7)
        txt(c, cx, yb + 1.3 * mm, coupe(f"{u['cle']} {u['code']}", lw, 6, True), 6, True, colors.HexColor('#37474F'))
        positions.append((x, x + u['long']))
        x += u['long']
    reste = LONG - REC - PERTE - x
    if reste > 120:
        txt(c, X0 + (x + reste / 2) * ECH, yb + HB / 2 - 1 * mm, f'chute {round(reste)}', 7, couleur=GRIS, align='c')
    # tableau des pièces
    yt = yb - 6.5 * mm
    tcols = [('Commande + ligne + code', 0), ('Client', 46), ('Référence', 72), ('Article', 110), ('Dessus', 136),
             ('Dessous', 156), ('Sur-cote L × l', 176), ('Fini L × l', 205), ('Place sur la bande', 228)]
    for t, xx in tcols: txt(c, M + xx * mm, yt, t, 6.5, True, GRIS)
    for (u, (a, z)) in zip(b['pieces'], positions):
        yt -= 3.6 * mm
        vals = [f"{u['cle']} {u['code']}" + (f" ({u['unite']}/{u['qte']})" if u['qte'] > 1 else ''), u['client'], u['ref'], u['article'],
                u['dessus'] or '—', u['dessous'] or '—', f"{u['Ld']} × {u['Wd']}", f"{u['Lf']} × {u['Wf']}", f'{nb(round(a, 1))} → {nb(round(z, 1))}']
        largeurs = [x2 - x1 for (_, x1), (_, x2) in zip(tcols, tcols[1:] + [('', 258)])]
        for (t, xx), v, w in zip(tcols, vals, largeurs):
            txt(c, M + xx * mm, yt, coupe(v if v is not None else '', (w - 1.5) * mm, 7, t.startswith('Commande')), 7, t.startswith('Commande'))

for l in d['plan']:
    toutes = [(b, g) for g in l['groupes'] for b in g['bandes']]
    nom = l['fichier'].replace('.xlsx', '')
    for i in range(0, len(toutes), 4):
        y = PH - M
        txt(c, M, y - 3 * mm, f"{nom} — semaine {d['semaine']}", 12, True, BLEU)
        txt(c, M + 255 * mm, y - 3 * mm, f'bandes {toutes[i][0]["code"]} à {toutes[min(i + 3, len(toutes) - 1)][0]["code"]}', 9, couleur=GRIS, align='r')
        y -= 8 * mm
        for b, g in toutes[i:i + 4]:
            bande(c, y, b, g, l['fichier']); y -= BLOC
        pied(c, page, titre_doc); c.showPage(); page += 1

# ---------- Pièces hors bandes ----------
hors = [(l['fichier'], h) for l in d['plan'] for h in l['hors']]
if hors:
    def entete_hors():
        txt(c, M, PH - M - 3 * mm, 'Pièces hors bandes (à couper dans les panneaux)', 12, True, BLEU)
        y = PH - M - 11 * mm
        for t, xx in hcols: txt(c, M + xx * mm, y, t, 7.5, True, GRIS)
        return y - 4.5 * mm
    hcols = [('Lancement', 0), ('Commande + ligne', 32), ('Agglo', 68), ('Client', 92), ('Sur-cote L × l', 120), ('Fini L × l', 150), ('Pourquoi', 178)]
    y = entete_hors()
    for f, h in hors:
        if y < M + 8 * mm:
            pied(c, page, titre_doc); c.showPage(); page += 1; y = entete_hors()
        vals = [f.replace('.xlsx', ''), h['cle'] + (f" ({h['unite']}/{h['qte']})" if h['qte'] > 1 else ''), h['agglo'], h['client'],
                f"{h['Ld']} × {h['Wd']}", f"{h['Lf']} × {h['Wf']}", h['raison']]
        for (t, xx), v in zip(hcols, vals): txt(c, M + xx * mm, y, v if v is not None else '', 7.5)
        y -= 4.2 * mm
    pied(c, page, titre_doc); c.showPage()
c.save()
print('pages', page)
