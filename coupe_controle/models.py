from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Statut(str, Enum):
    OK = "OK"
    MANQUANT = "Manquant"
    EN_TROP = "En trop"
    ECART_QTE = "Écart de quantité"


@dataclass(frozen=True)
class LigneStrat:
    """Une ligne de commande agrégée du fichier de lancement, pour une clé
    commande+ligne donnée (plusieurs lignes STRAT peuvent partager la même
    clé, par ex. une pièce accompagnée d'une protection)."""

    cle: str
    commande: str
    ligne: str
    article: str
    lancement: str
    qte_attendue: float


@dataclass(frozen=True)
class LigneComparaison:
    cle: str
    commande: str
    ligne: str
    article: str
    lancement: str
    qte_attendue: float
    qte_trouvee: int
    statut: Statut

    @property
    def ecart(self) -> float:
        return self.qte_trouvee - self.qte_attendue


@dataclass(frozen=True)
class RapportComparaison:
    lignes: list[LigneComparaison]

    @property
    def total_attendu(self) -> float:
        return sum(l.qte_attendue for l in self.lignes)

    @property
    def total_trouve(self) -> int:
        return sum(l.qte_trouvee for l in self.lignes)

    @property
    def nb_ok(self) -> int:
        return sum(1 for l in self.lignes if l.statut == Statut.OK)

    @property
    def nb_anomalies(self) -> int:
        return sum(1 for l in self.lignes if l.statut != Statut.OK)

    def anomalies(self) -> list[LigneComparaison]:
        return [l for l in self.lignes if l.statut != Statut.OK]
