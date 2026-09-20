from __future__ import annotations

from collections import Counter

from .models import LigneComparaison, LigneStrat, RapportComparaison, Statut


def comparer(lignes_strat: list[LigneStrat], trouve_par_cle: Counter) -> RapportComparaison:
    strat_par_cle = {l.cle: l for l in lignes_strat}
    toutes_les_cles = set(strat_par_cle) | set(trouve_par_cle)

    lignes: list[LigneComparaison] = []
    for cle in toutes_les_cles:
        strat = strat_par_cle.get(cle)
        qte_attendue = strat.qte_attendue if strat else 0.0
        qte_trouvee = trouve_par_cle.get(cle, 0)

        if strat is None:
            commande, ligne_num, article, lancement = "", "", "", ""
            statut = Statut.EN_TROP
        else:
            commande, ligne_num, article, lancement = (
                strat.commande,
                strat.ligne,
                strat.article,
                strat.lancement,
            )
            if qte_trouvee == 0:
                statut = Statut.MANQUANT
            elif qte_trouvee == qte_attendue:
                statut = Statut.OK
            else:
                statut = Statut.ECART_QTE

        lignes.append(
            LigneComparaison(
                cle=cle,
                commande=commande,
                ligne=ligne_num,
                article=article,
                lancement=lancement,
                qte_attendue=qte_attendue,
                qte_trouvee=qte_trouvee,
                statut=statut,
            )
        )

    lignes.sort(key=lambda l: (l.statut == Statut.OK, l.commande, l.ligne))
    return RapportComparaison(lignes=lignes)
