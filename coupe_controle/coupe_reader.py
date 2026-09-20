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
#   - la colonne "grain matching" contient un code de type "T33:2:1".
# Une pièce est comptée dès que sa clé commande+ligne est renseignée et que
# son matériau n'est pas "PROTECTION".
COLONNE_CLE_PAR_DEFAUT = 15  # colonne P
COLONNE_MATERIAU_PAR_DEFAUT = 1  # colonne B
COLONNE_GRAIN_MATCHING_PAR_DEFAUT = 27  # colonne AB

MATERIAUX_EXCLUS = {"PROTECTION"}

MOTIF_GRAIN_MATCHING = re.compile(r"^[A-Za-z]*\d+:\d+:\d+$")


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


def lire_coupe(chemin: str | Path, cles_strat: set[str]) -> Counter:
    """Compte, pour chaque clé commande+ligne, le nombre de pièces dans la
    liste de coupe Cutrite (panneaux de protection exclus)."""

    donnees = _charger_lignes(chemin)

    col_cle = _detecter_colonne_cle(donnees, cles_strat)
    if col_cle is None:
        col_cle = COLONNE_CLE_PAR_DEFAUT

    col_materiau = _detecter_colonne_materiau(donnees)
    if col_materiau is None:
        col_materiau = COLONNE_MATERIAU_PAR_DEFAUT

    compteur: Counter = Counter()
    for ligne in donnees:
        if col_cle >= len(ligne):
            continue
        cle = ligne[col_cle]
        if cle is None:
            continue
        cle = str(cle).strip()

        materiau = ligne[col_materiau] if col_materiau < len(ligne) else None
        if materiau is not None and str(materiau).strip().upper() in MATERIAUX_EXCLUS:
            continue

        compteur[cle] += 1

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

    resultat: dict[str, list[str]] = defaultdict(list)
    for ligne in donnees:
        if col_cle >= len(ligne):
            continue
        cle = ligne[col_cle]
        if cle is None:
            continue
        cle = str(cle).strip()
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
