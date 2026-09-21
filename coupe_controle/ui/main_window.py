from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from ..comparator import comparer
from ..coupe_reader import CoupeFormatError, lire_coupe, lire_grain_matching
from ..models import RapportComparaison, Statut
from ..report_export import exporter_rapport
from ..strat_reader import StratFormatError, lire_strat

COULEUR_PAR_STATUT = {
    Statut.OK: QColor("#C6EFCE"),
    Statut.MANQUANT: QColor("#FFC7CE"),
    Statut.EN_TROP: QColor("#FFEB9C"),
    Statut.ECART_QTE: QColor("#FFEB9C"),
}

EN_TETES = [
    "Commande",
    "Ligne",
    "Article",
    "Lancement",
    "Qté attendue",
    "Qté trouvée",
    "Écart",
    "Statut",
]


def _selecteur_fichier(titre: str, champ: QLineEdit, parent: QWidget) -> None:
    chemin, _ = QFileDialog.getOpenFileName(parent, titre, "", "Fichiers Excel (*.xlsx *.xlsm)")
    if chemin:
        champ.setText(chemin)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Contrôle de coupe — lancement / Cutrite")
        self.resize(1100, 700)

        self.rapport: RapportComparaison | None = None
        self.nb_unitaires: int | None = None
        self.nb_pieces_trouvees: int = 0
        self.cles_strat: set[str] = set()

        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)

        root.addLayout(self._ligne_fichier("Fichier de lancement (STRAT) :", "champ_strat"))
        root.addLayout(self._ligne_fichier("Liste de coupe (Cutrite) :", "champ_coupe"))

        lancer_row = QHBoxLayout()
        self.bouton_lancer = QPushButton("Lancer le contrôle")
        self.bouton_lancer.clicked.connect(self._lancer_controle)
        lancer_row.addWidget(self.bouton_lancer)
        lancer_row.addStretch(1)
        root.addLayout(lancer_row)

        self.label_resume = QLabel("Sélectionnez les deux fichiers puis lancez le contrôle.")
        self.label_resume.setStyleSheet("font-weight: bold; padding: 6px;")
        root.addWidget(self.label_resume)

        self.table = QTableWidget(0, len(EN_TETES))
        self.table.setHorizontalHeaderLabels(EN_TETES)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setSortingEnabled(True)
        root.addWidget(self.table)

        export_row = QHBoxLayout()
        self.bouton_export = QPushButton("Exporter le rapport (.xlsx)")
        self.bouton_export.setEnabled(False)
        self.bouton_export.clicked.connect(self._exporter)
        export_row.addStretch(1)
        export_row.addWidget(self.bouton_export)
        root.addLayout(export_row)

        recherche_row = QHBoxLayout()
        recherche_row.addWidget(QLabel("Grain matching pour commande+ligne :"))
        self.champ_recherche = QLineEdit()
        self.champ_recherche.setPlaceholderText("ex. CVC26090331003")
        self.champ_recherche.returnPressed.connect(self._rechercher_grain_matching)
        recherche_row.addWidget(self.champ_recherche, 1)
        bouton_rechercher = QPushButton("Rechercher")
        bouton_rechercher.clicked.connect(self._rechercher_grain_matching)
        recherche_row.addWidget(bouton_rechercher)
        root.addLayout(recherche_row)

        self.label_recherche = QLabel("")
        self.label_recherche.setStyleSheet("padding: 4px;")
        root.addWidget(self.label_recherche)

    def _ligne_fichier(self, libelle: str, nom_champ: str) -> QHBoxLayout:
        ligne = QHBoxLayout()
        ligne.addWidget(QLabel(libelle))
        champ = QLineEdit()
        champ.setReadOnly(True)
        setattr(self, nom_champ, champ)
        ligne.addWidget(champ, 1)
        bouton = QPushButton("Parcourir…")
        bouton.clicked.connect(lambda: _selecteur_fichier(libelle, champ, self))
        ligne.addWidget(bouton)
        return ligne

    def _lancer_controle(self) -> None:
        chemin_strat = self.champ_strat.text().strip()
        chemin_coupe = self.champ_coupe.text().strip()
        if not chemin_strat or not chemin_coupe:
            QMessageBox.warning(self, "Fichiers manquants", "Sélectionnez le fichier de lancement et la liste de coupe.")
            return

        try:
            lignes_strat, doublons_strat, semaines_strat = lire_strat(chemin_strat)
        except StratFormatError as erreur:
            QMessageBox.critical(self, "Erreur de lecture", str(erreur))
            return
        except Exception as erreur:  # noqa: BLE001 - remonter toute erreur de lecture à l'utilisateur
            QMessageBox.critical(self, "Erreur de lecture", f"Impossible de lire le fichier de lancement :\n{erreur}")
            return

        if len(semaines_strat) > 1:
            details_semaines = "\n".join(
                f"— semaine {s['semaine']}/{s['annee']} : {s['nb_pieces']} pièce(s)" for s in semaines_strat
            )
            reponse = QMessageBox.question(
                self,
                "Semaines de livraison différentes",
                "Plusieurs semaines de livraison différentes trouvées dans le fichier de "
                f"lancement :\n\n{details_semaines}\n\n"
                "Normalement, un fichier de lancement ne contient qu'une seule semaine de "
                "livraison. Continuer quand même ?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No,
            )
            if reponse != QMessageBox.StandardButton.Yes:
                return

        cles_strat = {l.cle for l in lignes_strat}
        self.cles_strat = cles_strat
        qte_attendue_par_cle = {l.cle: l.qte_attendue for l in lignes_strat}

        try:
            trouve_par_cle, nb_unitaires = lire_coupe(chemin_coupe, cles_strat, qte_attendue_par_cle)
            self.nb_unitaires = nb_unitaires
            self.nb_pieces_trouvees = len(trouve_par_cle)
        except CoupeFormatError as erreur:
            QMessageBox.critical(self, "Erreur de lecture", str(erreur))
            return
        except Exception as erreur:  # noqa: BLE001 - remonter toute erreur de lecture à l'utilisateur
            QMessageBox.critical(self, "Erreur de lecture", f"Impossible de lire la liste de coupe :\n{erreur}")
            return

        if doublons_strat:
            details_doublons = "\n".join(
                f"— Commande {d['commande']}, ligne {d['ligne']} (clé {d['cle']}) : "
                f"{d['nb_lignes']} lignes — articles {', '.join(d['articles'])}, "
                f"quantités {', '.join(str(q) for q in d['quantites'])}"
                for d in doublons_strat
            )
            QMessageBox.warning(
                self,
                "Doublons dans le fichier de lancement",
                "Une même clé commande+ligne apparaît sur plusieurs lignes du fichier de "
                "lancement (hors panneaux de protection) — vérifiez qu'il ne s'agit pas "
                f"d'une pièce lancée deux fois par erreur :\n\n{details_doublons}",
            )

        self.rapport = comparer(lignes_strat, trouve_par_cle)
        self._afficher_rapport(self.rapport)
        self.bouton_export.setEnabled(True)

    def _afficher_rapport(self, rapport: RapportComparaison) -> None:
        suffixe_unitaires = ""
        if self.nb_unitaires is not None and self.nb_pieces_trouvees:
            pourcentage = self.nb_unitaires / self.nb_pieces_trouvees * 100
            nb_grain_matching = self.nb_pieces_trouvees - self.nb_unitaires
            pourcentage_grain = nb_grain_matching / self.nb_pieces_trouvees * 100
            suffixe_unitaires = (
                f", dont {self.nb_unitaires} unitaire(s) sans grain matching ({pourcentage:.1f} %) / "
                f"{nb_grain_matching} avec grain matching ({pourcentage_grain:.1f} %)"
            )
        if rapport.nb_anomalies == 0:
            self.label_resume.setStyleSheet("font-weight: bold; padding: 6px; color: #2e7d32;")
            self.label_resume.setText(
                f"✔ Tout est correct — {int(rapport.total_attendu)} pièces attendues, "
                f"{int(rapport.total_trouve)} trouvées{suffixe_unitaires}."
            )
        else:
            self.label_resume.setStyleSheet("font-weight: bold; padding: 6px; color: #c62828;")
            self.label_resume.setText(
                f"⚠ {rapport.nb_anomalies} anomalie(s) — "
                f"{int(rapport.total_attendu)} pièces attendues, {int(rapport.total_trouve)} trouvées "
                f"({rapport.nb_ok} OK){suffixe_unitaires}."
            )

        # Seules les anomalies sont affichées dans le tableau (les pièces OK
        # ne le sont pas) : le résumé ci-dessus donne déjà les totaux et le
        # nombre OK.
        lignes_anomalies = rapport.anomalies()
        self.table.setSortingEnabled(False)
        self.table.setRowCount(len(lignes_anomalies))
        for row, ligne in enumerate(lignes_anomalies):
            valeurs = [
                ligne.commande,
                ligne.ligne,
                ligne.article,
                ligne.lancement,
                _fmt_qte(ligne.qte_attendue),
                _fmt_qte(ligne.qte_trouvee),
                _fmt_qte(ligne.ecart),
                ligne.statut.value,
            ]
            couleur = COULEUR_PAR_STATUT.get(ligne.statut)
            for col, valeur in enumerate(valeurs):
                item = QTableWidgetItem(valeur)
                item.setTextAlignment(Qt.AlignCenter)
                if couleur is not None:
                    item.setBackground(couleur)
                self.table.setItem(row, col, item)
        self.table.setSortingEnabled(True)

    def _rechercher_grain_matching(self) -> None:
        cle = self.champ_recherche.text().strip().upper()
        chemin_coupe = self.champ_coupe.text().strip()
        if not cle:
            return
        if not chemin_coupe:
            QMessageBox.warning(self, "Fichier manquant", "Sélectionnez la liste de coupe.")
            return

        try:
            grain_par_cle = lire_grain_matching(chemin_coupe, self.cles_strat)
        except CoupeFormatError as erreur:
            QMessageBox.critical(self, "Erreur de lecture", str(erreur))
            return
        except Exception as erreur:  # noqa: BLE001
            QMessageBox.critical(self, "Erreur de lecture", f"Impossible de lire la liste de coupe :\n{erreur}")
            return

        if cle not in grain_par_cle:
            self.label_recherche.setStyleSheet("padding: 4px; color: #c62828;")
            self.label_recherche.setText(f"Clé {cle} introuvable dans la liste de coupe.")
            return

        valeurs = grain_par_cle[cle]
        self.label_recherche.setStyleSheet("padding: 4px; font-weight: bold; color: #2e7d32;")
        if not valeurs:
            self.label_recherche.setText(f"{cle} → Unitaire (pas de grain matching)")
        else:
            self.label_recherche.setText(f"{cle} → grain matching : {', '.join(valeurs)}")

    def _exporter(self) -> None:
        if self.rapport is None:
            return
        chemin, _ = QFileDialog.getSaveFileName(
            self, "Exporter le rapport", "rapport_controle_coupe.xlsx", "Classeur Excel (*.xlsx)"
        )
        if not chemin:
            return
        if not chemin.lower().endswith(".xlsx"):
            chemin += ".xlsx"
        try:
            exporter_rapport(self.rapport, Path(chemin))
        except Exception as erreur:  # noqa: BLE001
            QMessageBox.critical(self, "Erreur d'export", f"Impossible d'enregistrer le rapport :\n{erreur}")
            return
        QMessageBox.information(self, "Export réussi", f"Rapport enregistré :\n{chemin}")


def _fmt_qte(valeur: float) -> str:
    if float(valeur).is_integer():
        return str(int(valeur))
    return str(valeur)
