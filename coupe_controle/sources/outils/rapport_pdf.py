"""PDF d'une étude bandes, construit à partir du classeur recalculé (mêmes chiffres que l'Excel).

Usage : rapport_pdf.py etude.xlsx sortie.pdf
"""
import sys, datetime, openpyxl
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont('DV', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DVB', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
from reportlab.lib.fonts import addMapping
addMapping('DV', 0, 0, 'DV'); addMapping('DV', 1, 0, 'DVB'); addMapping('DV', 0, 1, 'DV'); addMapping('DV', 1, 1, 'DVB')

source, sortie = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(source, data_only=True)
BLEU = colors.HexColor('#1565C0'); GRIS = colors.HexColor('#F3F5F8'); JAUNE = colors.HexColor('#FFF59D')
st_titre = ParagraphStyle('t', fontName='DVB', fontSize=15, leading=19, textColor=colors.HexColor('#0D2B5C'))
st_sous = ParagraphStyle('s', fontName='DV', fontSize=9, leading=12, textColor=colors.HexColor('#555555'))
st_h = ParagraphStyle('h', fontName='DVB', fontSize=11, leading=14, spaceBefore=10, spaceAfter=5, textColor=colors.HexColor('#0D2B5C'))
st_p = ParagraphStyle('p', fontName='DV', fontSize=8.5, leading=11.5)
st_note = ParagraphStyle('n', fontName='DV', fontSize=7.5, leading=10, textColor=colors.HexColor('#555555'))
st_th = ParagraphStyle('th', fontName='DVB', fontSize=7.5, leading=9.5, textColor=colors.white, alignment=1)
st_td = ParagraphStyle('td', fontName='DV', fontSize=8, leading=10)

def texte(c):
    v = c.value
    if v is None: return ''
    if isinstance(v, str): return v
    if '%' in (c.number_format or ''): return f'{v:.0%}'.replace('%', ' %')
    if isinstance(v, float) and not v.is_integer(): return f'{v:.1f}'.replace('.', ',')
    return f'{int(v):,}'.replace(',', ' ')

def tableau(lignes, largeurs, entete=True, total=False, gauche=1):
    data = [[Paragraph(x, st_th) for x in lignes[0]]] + [[Paragraph(x, st_td) for x in l] for l in lignes[1:]] if entete else \
           [[Paragraph(x, st_td) for x in l] for l in lignes]
    t = Table(data, colWidths=largeurs, repeatRows=1 if entete else 0)
    s = [('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#C9D2DE')), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
         ('TOPPADDING', (0, 0), (-1, -1), 2.5), ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5)]
    if entete:
        s.append(('BACKGROUND', (0, 0), (-1, 0), BLEU))
        for i in range(2, len(data), 2): s.append(('BACKGROUND', (0, i), (-1, i), GRIS))
    if total: s.append(('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#E3F2FD')))
    t.setStyle(TableStyle(s))
    if total:
        for c in t._cellvalues[-1]: c.style = ParagraphStyle('tt', parent=st_td, fontName='DVB')
    for row in t._cellvalues[1 if entete else 0:]:
        for j, c in enumerate(row):
            if j >= gauche: c.style = ParagraphStyle('r', parent=c.style, alignment=2)
    return t

ws = wb['Synthèse']
story = [Paragraph(ws['A1'].value, st_titre),
         Paragraph(f'Laisné Industrie — atelier plans de travail · {datetime.date.today():%d/%m/%Y} · '
                   'le détail pièce par pièce est dans le fichier Excel du même nom.', st_sous), Spacer(1, 6)]

# Découpe de la feuille Synthèse en blocs : titres (colonne A), tableaux (lignes B..I), notes
def est_entete(r): return ws.cell(r, 2).fill.fgColor.rgb in ('FF1565C0', '001565C0')
r, fin = 3, ws.max_row
while r <= fin:
    a = ws.cell(r, 1).value
    if a:
        titre = a; r += 1
        bloc = []
        if titre.startswith('Réglages'):
            lignes = []
            while r <= fin and ws.cell(r, 2).value and not ws.cell(r, 1).value:
                lignes.append([ws.cell(r, 2).value, texte(ws.cell(r, 3)), ws.cell(r, 4).value or '']); r += 1
            t = tableau(lignes, [62 * mm, 18 * mm, 98 * mm], entete=False, gauche=9)
            t.setStyle(TableStyle([('BACKGROUND', (1, 0), (1, -1), JAUNE)]))
            story.append(KeepTogether([Paragraph('Réglages', st_h), t]))
            continue
        if titre.startswith('Ce qui'):
            bloc.append(Paragraph(titre, st_h))
            while r <= fin:
                if ws.cell(r, 2).value: bloc.append(Paragraph('• ' + ws.cell(r, 2).value, st_p))
                r += 1
            story.append(KeepTogether(bloc)); continue
        bloc.append(Paragraph(titre, st_h))
        lignes, notes = [], []
        while r <= fin and not ws.cell(r, 1).value:
            vals = [ws.cell(r, c) for c in range(2, 10)]
            if any(c.value is not None for c in vals):
                if ws.cell(r, 2).font.i: notes.append(ws.cell(r, 2).value)
                else: lignes.append([texte(c) for c in vals])
            r += 1
        n = max(len([x for x in l if x != '']) for l in lignes)
        lignes = [l[:n] for l in lignes]
        total = lignes[-1][0] == 'Total'
        largeur = 178 * mm
        cols = [largeur / n] * n
        bloc.append(tableau(lignes, cols, total=total, gauche=1 if not lignes[0][0].startswith('Bandes') else 2))
        for nt in notes: bloc += [Spacer(1, 2), Paragraph(nt, st_note)]
        story.append(KeepTogether(bloc))
    else:
        r += 1

# Bandes par semaine
wbs = wb['Bandes par semaine']
lignes = [[texte(c) for c in row] for row in wbs.iter_rows()]
story += [PageBreak(), Paragraph('Bandes par semaine', st_h)]
n = len(lignes[0])
story.append(tableau(lignes, [20 * mm, 22 * mm] + [136 * mm / (n - 2)] * (n - 2), total=True, gauche=2))

def pied(c, doc):
    c.saveState(); c.setFont('DV', 7); c.setFillColor(colors.HexColor('#888888'))
    c.drawRightString(A4[0] - 16 * mm, 10 * mm, f'{doc.title} — page {doc.page}')
    c.restoreState()
doc = SimpleDocTemplate(sortie, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=16 * mm,
                        title=ws['A1'].value, author='Sentinelle — Laisné Industrie')
doc.build(story, onFirstPage=pied, onLaterPages=pied)
