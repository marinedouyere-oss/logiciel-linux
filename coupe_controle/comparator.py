from __future__ import annotations

import re
from collections import Counter

from .models import LigneComparaison, LigneStrat, RapportComparaison, Statut

# Pièce "En trop" : trouvée dans la liste de coupe mais absente du fichier de
# lancement, donc pas de LigneStrat pour retrouver sa commande/ligne. On les
# déduit directement de la clé commande+ligne (mêmes conventions que
# strat_reader._cle_ligne : les 3 derniers chiffres sont le numéro de
# ligne) pour rester identifiable même sans correspondance STRAT — même
# logique que côté web (template.html/comparer()).
MOTIF_CLE_EN_TROP = re.compile(r"^(.+?)(\d{3})$")


def comparer(lignes_strat: list[LigneStrat], trouve_par_cle: Counter) -> RapportComparaison:
    strat_par_cle = {l.cle: l for l in lignes_strat}
    toutes_les_cles = set(strat_par_cle) | set(trouve_par_cle)

    lignes: list[LigneComparaison] = []
    for cle in toutes_les_cles:
        strat = strat_par_cle.get(cle)
        qte_attendue = strat.qte_attendue if strat else 0.0
        qte_trouvee = trouve_par_cle.get(cle, 0)

        if strat is None:
            correspondance = MOTIF_CLE_EN_TROP.match(cle)
            if correspondance:
                commande, ligne_num = correspondance.group(1), str(int(correspondance.group(2)))
            else:
                commande, ligne_num = cle, ""
            article, lancement = "", ""
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
