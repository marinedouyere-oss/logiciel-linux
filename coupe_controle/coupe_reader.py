from __future__ import annotations

from collections import Counter
from pathlib import Path

import openpyxl

# La liste de coupe générée par Cutrite (Homag) n'a pas d'en-têtes de colonnes
# exploitables : sa mise en page peut légèrement varier d'une semaine à
# l'autre selon les options d'export (protection, chants, etc.). On détecte
# donc les colonnes utiles par leur contenu plutôt que par leur position :
#   - la colonne "clé" contient des valeurs identiques aux clés
#     commande+ligne du fichier de lancement (ex. "CVC26070953004") ;
#   - la colonne "indicateur chute" ne contient que les valeurs 'O' (chute)
#     et 'N' (pièce réelle).
# Ces positions par défaut (0-based) correspondent au format observé et
# servent de repli si la détection automatique échoue.
COLONNE_CLE_PAR_DEFAUT = 15  # colonne P
COLONNE_INDICATEUR_PAR_DEFAUT = 9  # colonne J


class CoupeFormatError(ValueError):
    pass


def _feuille_principale(classeur):
    return max(classeur.worksheets, key=lambda f: f.max_row or 0)


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


def _detecter_colonne_indicateur(lignes: list[tuple]) -> int | None:
    nb_colonnes = max((len(ligne) for ligne in lignes), default=0)
    meilleur_index, meilleur_score = None, 0
    for col in range(nb_colonnes):
        valeurs = [
            str(ligne[col]).strip().upper()
            for ligne in lignes
            if col < len(ligne) and ligne[col] is not None
        ]
        if not valeurs:
            continue
        score = sum(1 for v in valeurs if v in ("O", "N"))
        if score > meilleur_score and score >= 0.9 * len(valeurs):
            meilleur_index, meilleur_score = col, score
    return meilleur_index


def lire_coupe(chemin: str | Path, cles_strat: set[str]) -> Counter:
    """Compte, pour chaque clé commande+ligne, le nombre de pièces réellement
    débitées (chutes/déchets exclus) dans la liste de coupe Cutrite."""

    chemin = Path(chemin)
    classeur = openpyxl.load_workbook(chemin, data_only=True, read_only=True)
    feuille = _feuille_principale(classeur)

    lignes = list(feuille.iter_rows(min_row=1, values_only=True))
    if not lignes:
        raise CoupeFormatError("Le fichier de la liste de coupe est vide.")

    col_cle = _detecter_colonne_cle(lignes, cles_strat)
    if col_cle is None:
        col_cle = COLONNE_CLE_PAR_DEFAUT

    col_indicateur = _detecter_colonne_indicateur(lignes)
    if col_indicateur is None:
        col_indicateur = COLONNE_INDICATEUR_PAR_DEFAUT

    compteur: Counter = Counter()
    for ligne in lignes[1:]:
        if col_indicateur >= len(ligne) or col_cle >= len(ligne):
            continue
        indicateur = ligne[col_indicateur]
        cle = ligne[col_cle]
        if indicateur is None or cle is None:
            continue
        if str(indicateur).strip().upper() != "N":
            continue
        compteur[str(cle).strip()] += 1

    if sum(compteur.values()) == 0:
        raise CoupeFormatError(
            "Aucune pièce n'a été reconnue dans la liste de coupe : le format "
            "du fichier semble différent de celui attendu."
        )

    return compteur
