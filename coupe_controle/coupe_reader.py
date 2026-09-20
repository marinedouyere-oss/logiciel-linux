from __future__ import annotations

from collections import Counter
from pathlib import Path

import openpyxl

# La liste de coupe générée par Cutrite (Homag) n'a pas d'en-têtes de colonnes
# exploitables : sa mise en page peut légèrement varier d'une semaine à
# l'autre selon les options d'export. On détecte donc les colonnes utiles par
# leur contenu plutôt que par leur position :
#   - la colonne "clé" contient les mêmes clés commande+ligne que le fichier
#     de lancement (ex. "CVC26070953004") ;
#   - la colonne "matériau" contient le code du support (ex. "SAG10HYBR"), ou
#     "PROTECTION" pour les panneaux de protection, qui ne sont pas des
#     pièces client et doivent être exclus, comme dans le fichier de
#     lancement ;
#   - la colonne "désignation" contient le code article pour une vraie pièce
#     client, mais un nom généré par Cutrite (ex. "L0433", "T1/1") pour une
#     chute réutilisable de panneau : celle-ci reprend pourtant la clé
#     commande+ligne de la pièce dont elle provient (pour la traçabilité), ce
#     qui la rendrait faussement comptée si on ne se fiait qu'à la clé. On ne
#     compte donc une ligne que si sa désignation correspond à l'article
#     attendu pour cette clé dans le fichier de lancement.
COLONNE_CLE_PAR_DEFAUT = 15  # colonne P
COLONNE_MATERIAU_PAR_DEFAUT = 1  # colonne B
COLONNE_DESIGNATION_PAR_DEFAUT = 0  # colonne A

MATERIAUX_EXCLUS = {"PROTECTION"}

# Une colonne n'est retenue comme candidate "désignation/article" que si elle
# correspond à l'article attendu sur une part significative des lignes ayant
# une clé connue (sinon c'est une colonne sans rapport).
SEUIL_CANDIDAT_DESIGNATION = 0.3


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


def _detecter_colonne_designation(lignes: list[tuple], col_cle: int, article_par_cle: dict[str, str]) -> int | None:
    if not article_par_cle:
        return None

    nb_colonnes = max((len(ligne) for ligne in lignes), default=0)
    correspondances: Counter = Counter()
    total_avec_cle = 0

    for ligne in lignes:
        if col_cle >= len(ligne) or ligne[col_cle] is None:
            continue
        article_attendu = article_par_cle.get(str(ligne[col_cle]).strip())
        if article_attendu is None:
            continue
        total_avec_cle += 1
        for col in range(nb_colonnes):
            if col < len(ligne) and ligne[col] is not None and str(ligne[col]).strip().upper() == article_attendu:
                correspondances[col] += 1

    if total_avec_cle == 0:
        return None

    candidats = [
        col for col, score in correspondances.items() if score >= SEUIL_CANDIDAT_DESIGNATION * total_avec_cle
    ]
    if not candidats:
        return None

    # La colonne "désignation" est celle qui correspond le moins souvent à
    # l'article attendu : la colonne de référence (toujours recopiée, même
    # sur une chute) obtient le score le plus haut, tandis que la
    # désignation réelle diverge sur les chutes portant la clé d'une pièce.
    return min(candidats, key=lambda col: correspondances[col])


def lire_coupe(chemin: str | Path, article_par_cle: dict[str, str]) -> Counter:
    """Compte, pour chaque clé commande+ligne, le nombre de pièces client
    réellement débitées dans la liste de coupe Cutrite. Sont exclus : les
    chutes/restes de panneau sans référence client, les panneaux de
    protection, et les chutes réutilisables qui reprennent la clé d'une
    pièce sans être elles-mêmes cette pièce."""

    chemin = Path(chemin)
    classeur = openpyxl.load_workbook(chemin, data_only=True, read_only=True)
    feuille = _feuille_principale(classeur)

    lignes = list(feuille.iter_rows(min_row=1, values_only=True))
    if not lignes:
        raise CoupeFormatError("Le fichier de la liste de coupe est vide.")

    cles_strat = set(article_par_cle)
    donnees = lignes[1:]

    col_cle = _detecter_colonne_cle(donnees, cles_strat)
    if col_cle is None:
        col_cle = COLONNE_CLE_PAR_DEFAUT

    col_materiau = _detecter_colonne_materiau(donnees)
    if col_materiau is None:
        col_materiau = COLONNE_MATERIAU_PAR_DEFAUT

    article_par_cle_normalise = {cle: article.strip().upper() for cle, article in article_par_cle.items()}
    col_designation = _detecter_colonne_designation(donnees, col_cle, article_par_cle_normalise)
    if col_designation is None:
        col_designation = COLONNE_DESIGNATION_PAR_DEFAUT

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

        article_attendu = article_par_cle_normalise.get(cle)
        if article_attendu is not None:
            designation = ligne[col_designation] if col_designation < len(ligne) else None
            if designation is None or str(designation).strip().upper() != article_attendu:
                continue

        compteur[cle] += 1

    if sum(compteur.values()) == 0:
        raise CoupeFormatError(
            "Aucune pièce n'a été reconnue dans la liste de coupe : le format "
            "du fichier semble différent de celui attendu."
        )

    return compteur
