"""Calepinage des bandes d'agglo 38/28 HYBL : deux pièces (couleurs mélangées) par bande, repères A1, A2...

Usage : calepinage.py Pieces_38_28_HYBL.xlsx semaine sortie.json
Règles :
  - bandes 4200 × 658 (pièces de 598 à 660 de large) et 4200 × 510 (pièces de 450 à 510), cotes sur-cote ;
  - règle des 6 cm : pièce au plus 60 mm plus étroite que la bande, et au plus 60 mm d'écart entre les deux pièces d'une bande ;
  - longueur utile 4200 − 2 × 25 (recoupes) − 50 (obligatoire) = 4100, trait de scie 4,4 entre les pièces ;
  - au plus deux pièces par bande ; la pièce peut tourner (agglo brut).
"""
import openpyxl, sys, json, collections, string
import networkx as nx

LONG, RECOUPE, PERTE, TRAIT, ECART, MAXI = 4200, 25, 50, 4.4, 60, 2
UTILE = LONG - 2 * RECOUPE - PERTE
BANDES = {658: 660, 510: 510}  # largeur -> plus large pièce acceptée

source, semaine, sortie = sys.argv[1], int(sys.argv[2]), sys.argv[3]
rows = list(openpyxl.load_workbook(source, data_only=True)['Pièces'].iter_rows(values_only=True))
ix = {n: i for i, n in enumerate(rows[0])}
v = lambda r, k: r[ix[k]]

def placement(Ld, Wd):
    """(largeur de bande, long sur la bande, en travers) le plus rempli, ou None."""
    best = None
    for W, acc in BANDES.items():
        for along, across in ((max(Ld, Wd), min(Ld, Wd)), (min(Ld, Wd), max(Ld, Wd))):
            if W - ECART <= across <= acc and along <= UTILE:
                cle = (min(across, W) / W, along)
                if best is None or cle > best[0]: best = (cle, W, along, across)
    return None if best is None else best[1:]

def famille(agglo):
    """Le LINEX va dans les mêmes bandes que le 38 HYBL."""
    return 'SAG38HYBL' if agglo == 'SAG38HYBLLINEX' else agglo

def raison(Ld, Wd):
    petit, grand = min(Ld, Wd), max(Ld, Wd)
    if grand > UTILE and petit > max(BANDES.values()): return 'trop large et trop longue'
    if petit > max(BANDES.values()): return 'trop large (plus de 660)'
    if grand > UTILE: return f'trop longue (plus de {UTILE})'
    return 'règle des 6 cm (trop étroite pour 658 et pour 510)'

unites = collections.defaultdict(list); hors = collections.defaultdict(list)
for r in rows[1:]:
    if v(r, 'Semaine') != semaine: continue
    q = int(v(r, 'Qté') or 0)
    p = dict(fichier=v(r, 'Fichier de lancement'), lancement=v(r, 'Lancement'), cle=v(r, 'Commande + ligne'),
             client=v(r, 'Client'), ref=v(r, 'Référence'), article=v(r, 'Article'), agglo=v(r, 'Agglo'),
             Lf=v(r, 'Longueur finie'), Wf=v(r, 'Largeur finie'), Ld=v(r, 'Longueur sur-cote'), Wd=v(r, 'Largeur sur-cote'),
             dessus=v(r, 'Coloris dessus'), dessous=v(r, 'Coloris dessous'), qte=q)
    pl = placement(p['Ld'], p['Wd'])
    for n in range(1, q + 1):
        u = dict(p, unite=n)
        if pl is None: hors[p['fichier']].append(dict(u, raison=raison(p['Ld'], p['Wd']))); continue
        u['bande'], u['long'], u['travers'] = pl
        unites[(p['fichier'], famille(p['agglo']), pl[0])].append(u)

def associer(us):
    """Paires (au plus 2 pièces par bande) : le plus de paires possible, puis les bandes les plus remplies."""
    G = nx.Graph(); G.add_nodes_from(range(len(us)))
    for i in range(len(us)):
        for j in range(i + 1, len(us)):
            a, b = us[i], us[j]
            if abs(a['travers'] - b['travers']) <= ECART and a['long'] + TRAIT + b['long'] <= UTILE:
                G.add_edge(i, j, weight=a['long'] + b['long'])
    m = nx.max_weight_matching(G, maxcardinality=True)
    pris = set(); bandes = []
    for i, j in m:
        pris |= {i, j}; bandes.append(sorted([us[i], us[j]], key=lambda u: -u['long']))
    bandes += [[us[i]] for i in range(len(us)) if i not in pris]
    return bandes

def code(n):
    """Code d'appairage de la n-ième bande : A1 … A9, B1 … B9, …"""
    lettre, chiffre = divmod(n, 9)
    s = ''
    lettre += 1
    while lettre: lettre, k = divmod(lettre - 1, 26); s = string.ascii_uppercase[k] + s
    return f'{s}{chiffre + 1}'

plan = []
for fichier in sorted({k[0] for k in unites} | set(hors)):
    groupes = []
    for agglo in ('SAG38HYBL', 'SAG28HYBL'):
        for W in (658, 510):
            us = unites.get((fichier, agglo, W))
            if not us: continue
            bandes = associer(us)
            bandes.sort(key=lambda b: -sum(u['long'] for u in b))
            groupes.append(dict(agglo=agglo, largeur=W, bandes=bandes))
    n = 0
    for g in groupes:
        for b in g['bandes']:
            c = code(n); n += 1
            # Même code pour les pièces d'une même bande, écrit après le CVC : CVC… A1 va avec CVC… A1.
            for u in b: u['code'] = c
            b[:] = [dict(code=c, pieces=list(b))]
        g['bandes'] = [b[0] for b in g['bandes']]
        for b in g['bandes']:
            occupe = sum(u['long'] for u in b['pieces']) + TRAIT * (len(b['pieces']) - 1)
            b['occupe'] = occupe
            b['remplissage'] = sum(u['long'] * min(u['travers'], g['largeur']) for u in b['pieces']) / (LONG * g['largeur'])
    plan.append(dict(fichier=fichier, groupes=groupes, hors=hors.get(fichier, [])))

json.dump(dict(semaine=semaine, regles=dict(longueur=LONG, recoupe=RECOUPE, perte=PERTE, trait=TRAIT, ecart=ECART, utile=UTILE,
                                             bandes=BANDES, maxi=MAXI), plan=plan),
          open(sortie, 'w'), ensure_ascii=False, indent=1)
for l in plan:
    print(l['fichier'], [(g['agglo'], g['largeur'], len(g['bandes']), sum(len(b['pieces']) for b in g['bandes']),
                          round(sum(b['remplissage'] for b in g['bandes']) / len(g['bandes']), 3)) for g in l['groupes']], 'hors', len(l['hors']))
