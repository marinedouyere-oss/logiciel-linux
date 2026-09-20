from __future__ import annotations

import re
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl

# La liste de coupe générée par Cutrite (Homag) n'a pas d'en-têtes de colonnes
# exploitables : sa mise en page peut légèrement varier d'une semaine à
# l'autre selon les options d'export. On détecte donc les colonnes utiles par
# leur contenu plutôt que par leur position :
#   - la colonne "clé" (num commande+ligne) contient les mêmes clés que le
#     fichier de lancement (ex. "CVC26070953004") ;
#   - la colonne "matériau" (codes matériaux) contient le code du support
#     (ex. "SAG10HYBR"), ou "PROTECTION" pour les panneaux de protection, qui
#     ne sont pas des pièces client et doivent être exclus, comme dans le
#     fichier de lancement ;
#   - la colonne "grain matching" contient un code de type "T33:2:1" ;
#   - la colonne "type de trace" contient un code de type "P1:TC:..." ou
#     "L0392:TF:...", qui distingue la pièce réellement débitée ("TC") des
#     lignes techniques que Cutrite ajoute pour la même clé commande+ligne
#     (talon/chute "TF", bande de chant "TB", etc.) : ces dernières ne sont
#     pas des pièces et doublonnent le compte si on ne les exclut pas ;
#   - la colonne "quantité" indique combien de pièces identiques une ligne
#     "TC" représente (une même clé peut être débitée en plusieurs fois,
#     avec un nombre de pièces différent à chaque fois selon le nesting) :
#     compter "1 par ligne" est donc faux dès qu'une pièce est nestée en
#     plusieurs lots ; il faut sommer cette colonne, pas les lignes.
# Une pièce est comptée dès que sa clé commande+ligne est renseignée, que
# son matériau n'est pas "PROTECTION", et que sa ligne est bien une trace
# de type "TC" (quand cette information est disponible dans le fichier) ;
# sa quantité est celle de la colonne "quantité" si elle a pu être détectée
# avec confiance, sinon 1 par ligne (comportement précédent).
COLONNE_CLE_PAR_DEFAUT = 15  # colonne P
COLONNE_MATERIAU_PAR_DEFAUT = 1  # colonne B
COLONNE_GRAIN_MATCHING_PAR_DEFAUT = 27  # colonne AB

MATERIAUX_EXCLUS = {"PROTECTION"}

MOTIF_GRAIN_MATCHING = re.compile(r"^[A-Za-z]*\d+:\d+:\d+$")
MOTIF_TYPE_TRACE = re.compile(r"^[A-Za-z0-9]+:T([A-Z]):")
TYPE_TRACE_PIECE = "C"

# La colonne quantité n'est adoptée que si elle explique au moins cette
# proportion des clés du fichier de lancement (sinon, un faux positif sur
# un fichier sans cette colonne compterait n'importe quoi) : mieux vaut
# retomber sur "1 par ligne" que de faire confiance à une colonne qui ne
# correspond pas vraiment aux quantités.
SEUIL_CONFIANCE_COLONNE_QUANTITE = 0.5


class CoupeFormatError(ValueError):
    pass


def _feuille_principale(classeur):
    return max(classeur.worksheets, key=lambda f: f.max_row or 0)


def _charger_lignes(chemin: str | Path) -> list[tuple]:
    chemin = Path(chemin)
    classeur = openpyxl.load_workbook(chemin, data_only=True, read_only=True)
    feuille = _feuille_principale(classeur)
    lignes = list(feuille.iter_rows(min_row=1, values_only=True))
    if not lignes:
        raise CoupeFormatError("Le fichier de la liste de coupe est vide.")
    return lignes[1:]


def _detecter_colonne_cle(lignes: list[tuple], cles_strat: set[str]) -> int | None:
    if not cles_strat:
        return None
    nb_colonnes = max((len(ligne) for ligne in lignes), default=0)
    meilleur_index, meilleur_score = None, 0
    for col in range(nb_colonnes):
        score = 0
        for ligne in lignes:
            if col < len(ligne) and ligne[col] is not None and str(ligne[col]).strip() in cles_strat:
                score += 1
        if score > meilleur_score:
            meilleur_index, meilleur_score = col, score
    return meilleur_index


def _detecter_colonne_materiau(lignes: list[tuple]) -> int | None:
    """La colonne matériau est celle qui contient le plus souvent la valeur
    "PROTECTION" (marqueur fiable, présent dans le fichier de lancement comme
    dans la liste de coupe)."""
    nb_colonnes = max((len(ligne) for ligne in lignes), default=0)
    meilleur_index, meilleur_score = None, 0
    for col in range(nb_colonnes):
        score = sum(
            1
            for ligne in lignes
            if col < len(ligne) and ligne[col] is not None and str(ligne[col]).strip().upper() == "PROTECTION"
        )
        if score > meilleur_score:
            meilleur_index, meilleur_score = col, score
    return meilleur_index


def _detecter_colonne_grain_matching(lignes: list[tuple]) -> int | None:
    """La colonne grain matching contient un code du type "T33:2:1"."""
    nb_colonnes = max((len(ligne) for ligne in lignes), default=0)
    meilleur_index, meilleur_score = None, 0
    for col in range(nb_colonnes):
        score = sum(
            1
            for ligne in lignes
            if col < len(ligne) and ligne[col] is not None and MOTIF_GRAIN_MATCHING.match(str(ligne[col]).strip())
        )
        if score > meilleur_score:
            meilleur_index, meilleur_score = col, score
    return meilleur_index


def _detecter_colonne_type_trace(lignes: list[tuple]) -> int | None:
    """La colonne type de trace contient un code du type "P1:TC:..." : la
    lettre après "T" distingue la pièce ("C") des lignes techniques liées
    (talon/chute "F", bande de chant "B"...)."""
    nb_colonnes = max((len(ligne) for ligne in lignes), default=0)
    meilleur_index, meilleur_score = None, 0
    for col in range(nb_colonnes):
        score = sum(
            1
            for ligne in lignes
            if col < len(ligne) and ligne[col] is not None and MOTIF_TYPE_TRACE.match(str(ligne[col]).strip())
        )
        if score > meilleur_score:
            meilleur_index, meilleur_score = col, score
    return meilleur_index


def _est_ligne_piece(ligne: tuple, col_type_trace: int | None) -> bool:
    """Renvoie False pour une ligne technique (talon/chute, bande de chant...)
    identifiée par la colonne type de trace, quand cette colonne est
    disponible. Si elle n'a pas pu être détectée, toutes les lignes sont
    considérées comme des pièces (comportement inchangé)."""
    if col_type_trace is None or col_type_trace >= len(ligne):
        return True
    valeur = ligne[col_type_trace]
    if valeur is None:
        return True
    correspondance = MOTIF_TYPE_TRACE.match(str(valeur).strip())
    if not correspondance:
        return True
    return correspondance.group(1) == TYPE_TRACE_PIECE


def _lignes_pieces(lignes, col_cle, col_materiau, col_type_trace):
    """Générateur des (clé, ligne) pour les lignes qui représentent une
    pièce réelle : clé renseignée, matériau pas "PROTECTION", et ligne de
    type "TC" (quand détectée)."""
    for ligne in lignes:
        if col_cle >= len(ligne) or ligne[col_cle] is None:
            continue
        cle = str(ligne[col_cle]).strip()

        materiau = ligne[col_materiau] if col_materiau < len(ligne) else None
        if materiau is not None and str(materiau).strip().upper() in MATERIAUX_EXCLUS:
            continue

        if not _est_ligne_piece(ligne, col_type_trace):
            continue

        yield cle, ligne


def _detecter_colonne_quantite(
    lignes: list[tuple],
    col_cle: int,
    col_materiau: int,
    col_type_trace: int | None,
    qte_attendue_par_cle: dict[str, float],
) -> int | None:
    """La colonne quantité est celle dont la somme par clé (sur les lignes
    pièce) reproduit le plus souvent, exactement, la quantité attendue du
    fichier de lancement."""
    if not qte_attendue_par_cle:
        return None
    nb_colonnes = max((len(ligne) for ligne in lignes), default=0)
    meilleur_index, meilleur_score = None, 0
    for col in range(nb_colonnes):
        if col in (col_cle, col_materiau, col_type_trace):
            continue
        sommes: dict[str, float] = defaultdict(float)
        for cle, ligne in _lignes_pieces(lignes, col_cle, col_materiau, col_type_trace):
            valeur = ligne[col] if col < len(ligne) else None
            if valeur is None:
                continue
            try:
                valeur = float(valeur)
            except (TypeError, ValueError):
                continue
            sommes[cle] += valeur
        score = sum(
            1
            for cle, total in sommes.items()
            if cle in qte_attendue_par_cle and abs(total - qte_attendue_par_cle[cle]) < 1e-6
        )
        if score > meilleur_score:
            meilleur_index, meilleur_score = col, score

    seuil = SEUIL_CONFIANCE_COLONNE_QUANTITE * len(qte_attendue_par_cle)
    return meilleur_index if meilleur_score >= seuil else None


def lire_coupe(chemin: str | Path, cles_strat: set[str], qte_attendue_par_cle: dict[str, float] | None = None) -> Counter:
    """Compte, pour chaque clé commande+ligne, le nombre de pièces dans la
    liste de coupe Cutrite (panneaux de protection et lignes techniques
    exclus). Si la colonne "quantité" par ligne peut être détectée avec
    confiance (via `qte_attendue_par_cle`), une même clé nestée en
    plusieurs lots est comptée correctement au lieu d'être sous-évaluée
    (1 par ligne, quel que soit le nombre de pièces qu'elle représente)."""

    donnees = _charger_lignes(chemin)

    col_cle = _detecter_colonne_cle(donnees, cles_strat)
    if col_cle is None:
        col_cle = COLONNE_CLE_PAR_DEFAUT

    col_materiau = _detecter_colonne_materiau(donnees)
    if col_materiau is None:
        col_materiau = COLONNE_MATERIAU_PAR_DEFAUT

    col_type_trace = _detecter_colonne_type_trace(donnees)

    col_quantite = _detecter_colonne_quantite(
        donnees, col_cle, col_materiau, col_type_trace, qte_attendue_par_cle or {}
    )

    compteur: Counter = Counter()
    for cle, ligne in _lignes_pieces(donnees, col_cle, col_materiau, col_type_trace):
        quantite = 1.0
        if col_quantite is not None and col_quantite < len(ligne) and ligne[col_quantite] is not None:
            try:
                quantite = float(ligne[col_quantite])
            except (TypeError, ValueError):
                quantite = 1.0
        compteur[cle] += quantite

    if sum(compteur.values()) == 0:
        raise CoupeFormatError(
            "Aucune pièce n'a été reconnue dans la liste de coupe : le format "
            "du fichier semble différent de celui attendu."
        )

    return compteur


def lire_grain_matching(chemin: str | Path, cles_strat: set[str] | None = None) -> dict[str, list[str]]:
    """Renvoie, pour chaque clé commande+ligne trouvée dans la liste de
    coupe, la ou les valeurs de grain matching associées (ex. "T33:2:1")."""

    donnees = _charger_lignes(chemin)

    col_cle = _detecter_colonne_cle(donnees, cles_strat or set())
    if col_cle is None:
        col_cle = COLONNE_CLE_PAR_DEFAUT

    col_grain = _detecter_colonne_grain_matching(donnees)
    if col_grain is None:
        col_grain = COLONNE_GRAIN_MATCHING_PAR_DEFAUT

    col_type_trace = _detecter_colonne_type_trace(donnees)
    col_materiau = _detecter_colonne_materiau(donnees)
    if col_materiau is None:
        col_materiau = COLONNE_MATERIAU_PAR_DEFAUT

    resultat: dict[str, list[str]] = defaultdict(list)
    for cle, ligne in _lignes_pieces(donnees, col_cle, col_materiau, col_type_trace):
        # On enregistre la clé même sans grain matching, pour distinguer une
        # pièce unitaire (clé trouvée, pas de grain matching) d'une clé
        # absente de la liste de coupe.
        resultat.setdefault(cle, [])

        valeur = ligne[col_grain] if col_grain < len(ligne) else None
        if valeur is None:
            continue
        valeur = str(valeur).strip()
        if valeur and valeur not in resultat[cle]:
            resultat[cle].append(valeur)

    return dict(resultat)
