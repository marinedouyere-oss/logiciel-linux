"""Trois rapports PDF à partir du « Sommaire des matériaux » Cut Rite d'un lancement :
agglo (panneaux et restes), strats, et couleurs de la feuille de réception (+ hors gamme).

Usage : sommaire_pdf.py sommaire.pdf dossier_sortie [nombre_de_pieces] [couleur_semaine]
"""
import sys, os, re, subprocess, datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont('DV', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DVB', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))

source, dossier = sys.argv[1], sys.argv[2]
nb_pieces = sys.argv[3] if len(sys.argv) > 3 else None
couleur_semaine = sys.argv[4] if len(sys.argv) > 4 else None
texte = subprocess.run(['pdftotext', '-layout', source, '-'], capture_output=True, text=True, check=True).stdout
lignes = texte.splitlines()

# Couleurs de la feuille « réception la Chapelle », dans son ordre, avec le format noté dessus.
FEUILLE = ['1136', '1132', '1109', '1065', '1062', '1048', '1047',
           '1136-PF', '1132-PF', '1065-PF', '1062-PF', '1048-PF', '1047-PF']
LARGEUR_FEUILLE = '2060'

lancement = re.search(r'(LAN\d{6}\w*?)-Code', texte)
lancement = lancement.group(1) if lancement else os.path.splitext(os.path.basename(source))[0]
date = re.search(r'(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche) (\d+ \w+ \d{4}) (\d\d:\d\d)', texte)
date = f'{date.group(2)} {date.group(3)}' if date else ''

# Une matière : ligne de description « CODE DESCRIPTION… Epaisseur x Pqt. n », puis « CODE [STRAT] panneaux restes ».
materiaux = []
descriptions = {}
for i, l in enumerate(lignes):
    m = re.match(r'^(\S+)\s+(?:STRAT\s+)?(\d+)\s+(\d+)\s*$', l)
    if m and m.group(1) in descriptions:
        code = m.group(1)
        materiaux.append(dict(code=code, desc=descriptions[code], panneaux=int(m.group(2)), restes=int(m.group(3))))
        continue
    m = re.match(r'^(\S+) (.+)$', l)
    if m and not l.startswith(' ') and m.group(1) not in ('Code', 'Paramètres', 'Sommaire', 'LAISNE', 'STRAT', 'Pqt.'):
        descriptions.setdefault(m.group(1), m.group(2))
total = re.findall(r'^\s+(\d+)\s+(\d+)\s*$', texte, re.M)
total = tuple(int(x) for x in total[-1])
assert (sum(x['panneaux'] for x in materiaux), sum(x['restes'] for x in materiaux)) == total, 'sommaire mal lu'


def epaisseur(m):
    e = re.search(r'Epaisseur\s+(\d+(?:\.\d+)?)', m['desc']) or re.search(r'(\d+)\s*MM\b', m['desc'])
    return float(e.group(1)) if e else None


def est_agglo(m):
    return (epaisseur(m) or 0) >= 2 or re.match(r'^(SAG|SMEL|PROTECTION)', m['code']) is not None


def designation(m):
    d = re.sub(r'\s*Epaiss.*$', '', m['desc'])
    d = re.sub(r'^STRAT\s+', '', d)
    return d.replace('...', '').strip()


def fmt_format(m):
    f = re.search(r'(\d{4})\*(\d*)', m['desc'])
    if not f: return '—'
    largeur = f.group(2) if len(f.group(2)) == 4 else LARGEUR_FEUILLE
    return f'{f.group(1)} × {largeur}'


agglo = [m for m in materiaux if est_agglo(m)]
strats = [m for m in materiaux if not est_agglo(m)]
parcode = {m['code']: m for m in materiaux}
couleurs = [parcode[c] for c in FEUILLE if c in parcode]
absentes = [c for c in FEUILLE if c not in parcode]
# Hors gamme : couleur dont le code commence par une lettre (le contrebalancement RCB n'en est pas une).
hors_gamme = [m for m in strats if re.match(r'^[A-Za-z]', m['code']) and not m['code'].startswith('RCB')]

BLEU = colors.HexColor('#1565C0'); GRIS = colors.HexColor('#F3F5F8')
st_titre = ParagraphStyle('t', fontName='DVB', fontSize=16, leading=20, textColor=colors.HexColor('#0D2B5C'))
st_sous = ParagraphStyle('s', fontName='DV', fontSize=9, leading=12, textColor=colors.HexColor('#555555'))
st_p = ParagraphStyle('p', fontName='DV', fontSize=9.5, leading=13)
st_info = ParagraphStyle('i', fontName='DV', fontSize=12, leading=16, textColor=colors.HexColor('#263238'))
st_th = ParagraphStyle('th', fontName='DVB', fontSize=9, leading=11, textColor=colors.white)
st_td = ParagraphStyle('td', fontName='DV', fontSize=9, leading=11.5)
st_tdb = ParagraphStyle('tdb', parent=st_td, fontName='DVB')


def tableau(entete, rangees, largeurs, nb_texte):
    tot_p = sum(r[-2] for r in rangees); tot_r = sum(r[-1] for r in rangees)
    data = [[Paragraph(x, ParagraphStyle('h', parent=st_th, alignment=2 if j >= nb_texte else 0)) for j, x in enumerate(entete)]]
    for r in rangees:
        data.append([Paragraph(str(x), ParagraphStyle('c', parent=st_tdb if j == 0 else st_td, alignment=2 if j >= nb_texte else 0))
                     for j, x in enumerate(r)])
    data.append([Paragraph('Total', st_tdb)] + [Paragraph('', st_td)] * (nb_texte - 1)
                + [Paragraph(str(tot_p), ParagraphStyle('t', parent=st_tdb, alignment=2)),
                   Paragraph(str(tot_r), ParagraphStyle('t', parent=st_tdb, alignment=2))])
    t = Table(data, colWidths=largeurs, repeatRows=1)
    s = [('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#C9D2DE')), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
         ('TOPPADDING', (0, 0), (-1, -1), 3.5), ('BOTTOMPADDING', (0, 0), (-1, -1), 3.5),
         ('BACKGROUND', (0, 0), (-1, 0), BLEU), ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#E3F2FD'))]
    for i in range(2, len(data) - 1, 2): s.append(('BACKGROUND', (0, i), (-1, i), GRIS))
    t.setStyle(TableStyle(s))
    return t


def ecrire(nom, titre, elements):
    chemin = os.path.join(dossier, nom)
    doc = SimpleDocTemplate(chemin, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                            title=titre, author='Sentinelle')
    entete = [Paragraph(titre, st_titre),
              Paragraph(f'{lancement} · sommaire Cut Rite du {date} · Laisné Industrie', st_sous), Spacer(1, 6)]
    infos = []
    if nb_pieces: infos.append(f'Nombre de pièces : <b>{nb_pieces}</b>')
    if couleur_semaine: infos.append(f'Couleurs semaine : <b><font color="#D81B60">{couleur_semaine}</font></b>')
    if infos: entete += [Paragraph('&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;'.join(infos), st_info), Spacer(1, 8)]
    doc.build(entete + elements)
    print(chemin)


base = lancement[:9]
ecrire(f'{base}_Agglo.pdf', f'{base} — Agglo : panneaux et restes',
       [tableau(['Code', 'Désignation', 'Ép. (mm)', 'Panneaux', 'Restes'],
                [[m['code'], designation(m), f"{epaisseur(m):g}" if epaisseur(m) else '', m['panneaux'], m['restes']] for m in agglo],
                [38 * mm, 86 * mm, 16 * mm, 22 * mm, 20 * mm], 3)])
ecrire(f'{base}_Strats.pdf', f'{base} — Strats : panneaux et restes',
       [tableau(['Code', 'Désignation', 'Panneaux', 'Restes'],
                [[m['code'], designation(m), m['panneaux'], m['restes']] for m in strats],
                [26 * mm, 114 * mm, 22 * mm, 20 * mm], 2)])
elements = [tableau(['Couleur', 'Désignation', 'Format', 'Panneaux', 'Restes'],
                    [[m['code'], designation(m), fmt_format(m), m['panneaux'], m['restes']] for m in couleurs],
                    [22 * mm, 90 * mm, 30 * mm, 22 * mm, 18 * mm], 3), Spacer(1, 10)]
if absentes: elements.append(Paragraph('<b>Pas dans ce lancement :</b> ' + ', '.join(absentes), st_p))
elements.append(Paragraph('<b>Hors gamme :</b> ' + (', '.join(m['code'] for m in hors_gamme) if hors_gamme else 'aucune dans ce lancement'), st_p))
ecrire(f'{base}_Couleurs.pdf', f'{base} — Couleurs de la feuille', elements)
print('agglo', [(m['code'], m['panneaux'], m['restes']) for m in agglo])
print('strats', len(strats), sum(m['panneaux'] for m in strats), sum(m['restes'] for m in strats))
print('couleurs', [(m['code'], fmt_format(m), m['panneaux'], m['restes']) for m in couleurs], 'absentes', absentes, 'hors gamme', hors_gamme)
