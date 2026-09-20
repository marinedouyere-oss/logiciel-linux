from __future__ import annotations

from collections import defaultdict
from pathlib import Path

import openpyxl

from .models import LigneStrat

# En-têtes attendus dans le fichier de lancement (export STRAT). Les noms de
# colonnes sont stables d'une semaine à l'autre car ils viennent de l'ERP.
COL_COMMANDE = "conf_commande"
COL_LIGNE = "conf_ligne"
COL_ARTICLE = "conf_article"
COL_QTE = "comdet_qte"
COL_LANCEMENT = "comprod_lancement"
COL_CLE = "commande+ligne"

REQUIRED_HEADERS = (COL_COMMANDE, COL_LIGNE, COL_ARTICLE, COL_QTE)


class StratFormatError(ValueError):
    pass


def _trouver_feuille_et_entetes(chemin: Path):
    classeur = openpyxl.load_workbook(chemin, data_only=True, read_only=True)
    try:
        for feuille in classeur.worksheets:
            ligne_entetes = next(feuille.iter_rows(min_row=1, max_row=1), None)
            if ligne_entetes is None:
                continue
            entetes = {
                str(cellule.value).strip(): index
                for index, cellule in enumerate(ligne_entetes, start=1)
                if cellule.value is not None
            }
            if all(entete in entetes for entete in REQUIRED_HEADERS):
                return feuille, entetes
        raise StratFormatError(
            "Aucune feuille du fichier de lancement ne contient les colonnes "
            f"attendues ({', '.join(REQUIRED_HEADERS)})."
        )
    finally:
        pass


def _cle_ligne(commande: str, ligne) -> str:
    try:
        numero = int(float(ligne))
    except (TypeError, ValueError):
        return f"{commande}{ligne}"
    return f"{commande}{numero:03d}"


def _fmt_ligne(ligne) -> str:
    if ligne is None:
        return ""
    try:
        return str(int(float(ligne)))
    except (TypeError, ValueError):
        return str(ligne)


def lire_strat(chemin: str | Path) -> list[LigneStrat]:
    """Lit le fichier de lancement et agrège les lignes par clé
    commande+ligne (une clé peut apparaître plusieurs fois dans le fichier,
    par ex. pièce + protection : les quantités sont alors additionnées)."""

    chemin = Path(chemin)
    feuille, entetes = _trouver_feuille_et_entetes(chemin)

    idx_commande = entetes[COL_COMMANDE]
    idx_ligne = entetes[COL_LIGNE]
    idx_article = entetes[COL_ARTICLE]
    idx_qte = entetes[COL_QTE]
    idx_lancement = entetes.get(COL_LANCEMENT)
    idx_cle = entetes.get(COL_CLE)

    qte_par_cle: dict[str, float] = defaultdict(float)
    infos_par_cle: dict[str, tuple[str, str, str, str]] = {}

    nb_colonnes = feuille.max_column

    def valeur(ligne_donnees, index: int | None):
        if not index or index > len(ligne_donnees):
            return None
        return ligne_donnees[index - 1].value

    for ligne_donnees in feuille.iter_rows(min_row=2, max_col=nb_colonnes):
        commande = valeur(ligne_donnees, idx_commande)
        if commande is None:
            continue
        commande = str(commande).strip()
        numero_ligne = valeur(ligne_donnees, idx_ligne)
        article = valeur(ligne_donnees, idx_article) or ""
        qte = valeur(ligne_donnees, idx_qte) or 0
        lancement = valeur(ligne_donnees, idx_lancement) or ""

        cle = valeur(ligne_donnees, idx_cle)
        cle = str(cle).strip() if cle else _cle_ligne(commande, numero_ligne)

        qte_par_cle[cle] += float(qte)
        infos_par_cle[cle] = (
            commande,
            _fmt_ligne(numero_ligne),
            str(article),
            str(lancement) if lancement else "",
        )

    resultat = []
    for cle, qte in qte_par_cle.items():
        commande, numero_ligne, article, lancement = infos_par_cle[cle]
        resultat.append(
            LigneStrat(
                cle=cle,
                commande=commande,
                ligne=numero_ligne,
                article=article,
                lancement=lancement,
                qte_attendue=qte,
            )
        )
    return resultat
