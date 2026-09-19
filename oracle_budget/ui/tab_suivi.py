from __future__ import annotations

from functools import partial

from PySide6.QtWidgets import (
    QCheckBox, QGroupBox, QHBoxLayout, QLabel, QLineEdit, QMessageBox,
    QPushButton, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)

from ..format_utils import fmt_money
from ..models import compute_month_financials
from ..repository import OracleRepository
from .widgets import ask_amount, ask_text, confirm, make_amount_spinbox, make_row_actions


class SuiviTab(QWidget):
    def __init__(self, repo: OracleRepository, get_month_key):
        super().__init__()
        self.repo = repo
        self.get_month_key = get_month_key

        root = QVBoxLayout(self)

        self.totals_label = QLabel()
        self.totals_label.setStyleSheet("font-size: 16px; font-weight: bold;")
        root.addWidget(self.totals_label)

        actions_row = QHBoxLayout()
        self.closed_checkbox = QCheckBox("Mois clos")
        self.closed_checkbox.stateChanged.connect(self._on_toggle_closed)
        actions_row.addWidget(self.closed_checkbox)
        dup_btn = QPushButton("Dupliquer vers le mois suivant")
        dup_btn.clicked.connect(self._on_duplicate_next)
        actions_row.addWidget(dup_btn)
        auto_btn = QPushButton("Appliquer l'épargne automatique")
        auto_btn.clicked.connect(self._on_apply_auto_savings)
        actions_row.addWidget(auto_btn)
        actions_row.addStretch(1)
        root.addLayout(actions_row)

        # --- Revenus ---
        revenus_box = QGroupBox("Revenus")
        revenus_layout = QVBoxLayout(revenus_box)
        self.revenus_table = QTableWidget(0, 3)
        self.revenus_table.setHorizontalHeaderLabels(["Libellé", "Montant", ""])
        self.revenus_table.horizontalHeader().setStretchLastSection(True)
        revenus_layout.addWidget(self.revenus_table)
        revenus_layout.addLayout(self._make_add_revenu_row())
        root.addWidget(revenus_box)

        # --- Charges ---
        charges_box = QGroupBox("Charges")
        charges_layout = QVBoxLayout(charges_box)
        self.charges_table = QTableWidget(0, 4)
        self.charges_table.setHorizontalHeaderLabels(["Libellé", "Prévu", "Payé", ""])
        self.charges_table.horizontalHeader().setStretchLastSection(True)
        charges_layout.addWidget(self.charges_table)
        charges_layout.addLayout(self._make_add_charge_row())
        root.addWidget(charges_box)

    # ------------------------------------------------------------------ #
    def _make_add_revenu_row(self) -> QHBoxLayout:
        row = QHBoxLayout()
        self.new_revenu_label = QLineEdit()
        self.new_revenu_label.setPlaceholderText("Nouveau revenu (libellé)")
        self.new_revenu_amount = make_amount_spinbox()
        add_btn = QPushButton("Ajouter")
        add_btn.clicked.connect(self._on_add_revenu)
        row.addWidget(self.new_revenu_label, 2)
        row.addWidget(self.new_revenu_amount, 1)
        row.addWidget(add_btn)
        return row

    def _make_add_charge_row(self) -> QHBoxLayout:
        row = QHBoxLayout()
        self.new_charge_label = QLineEdit()
        self.new_charge_label.setPlaceholderText("Nouvelle charge (libellé)")
        self.new_charge_amount = make_amount_spinbox()
        add_btn = QPushButton("Ajouter")
        add_btn.clicked.connect(self._on_add_charge)
        row.addWidget(self.new_charge_label, 2)
        row.addWidget(self.new_charge_amount, 1)
        row.addWidget(add_btn)
        return row

    # ------------------------------------------------------------------ #
    def refresh(self) -> None:
        key = self.get_month_key()
        month = self.repo.state.months.get(key)
        if month is None:
            self.totals_label.setText("Aucune donnée pour ce mois.")
            self.revenus_table.setRowCount(0)
            self.charges_table.setRowCount(0)
            return

        fin = compute_month_financials(month)
        self.totals_label.setText(
            f"Revenus : {fmt_money(fin.revenus)}    Charges : {fmt_money(fin.charges)}"
            f"    Solde : {fmt_money(fin.delta)}"
        )

        self.closed_checkbox.blockSignals(True)
        self.closed_checkbox.setChecked(key in self.repo.state.closedMonths)
        self.closed_checkbox.blockSignals(False)

        self.revenus_table.setRowCount(len(month.revenus))
        for row, revenu in enumerate(month.revenus):
            self.revenus_table.setItem(row, 0, QTableWidgetItem(revenu.label))
            self.revenus_table.setItem(row, 1, QTableWidgetItem(fmt_money(revenu.amount)))
            self.revenus_table.setCellWidget(
                row, 2,
                make_row_actions(
                    partial(self._on_edit_revenu, revenu.id),
                    partial(self._on_delete_revenu, revenu.id),
                ),
            )

        self.charges_table.setRowCount(len(month.charges))
        for row, charge in enumerate(month.charges):
            self.charges_table.setItem(row, 0, QTableWidgetItem(charge.label))
            self.charges_table.setItem(row, 1, QTableWidgetItem(fmt_money(charge.planned)))
            paid_box = QCheckBox()
            paid_box.setChecked(charge.paid)
            paid_box.stateChanged.connect(partial(self._on_toggle_paid, charge.id))
            self.charges_table.setCellWidget(row, 2, paid_box)
            self.charges_table.setCellWidget(
                row, 3,
                make_row_actions(
                    partial(self._on_edit_charge, charge.id),
                    partial(self._on_delete_charge, charge.id),
                ),
            )

    # ------------------------------------------------------------------ #
    def _on_add_revenu(self) -> None:
        label = self.new_revenu_label.text().strip()
        if not label:
            return
        self.repo.add_revenu(self.get_month_key(), label, self.new_revenu_amount.value())
        self.new_revenu_label.clear()
        self.new_revenu_amount.setValue(0.0)

    def _on_edit_revenu(self, revenu_id: str) -> None:
        month = self.repo.state.months.get(self.get_month_key())
        revenu = next((r for r in month.revenus if r.id == revenu_id), None) if month else None
        if revenu is None:
            return
        label, ok = ask_text(self, "Modifier le revenu", "Libellé", revenu.label)
        if not ok:
            return
        amount, ok = ask_amount(self, "Modifier le revenu", "Montant", revenu.amount)
        if not ok:
            return
        self.repo.update_revenu(self.get_month_key(), revenu_id, label, amount)

    def _on_delete_revenu(self, revenu_id: str) -> None:
        if confirm(self, "Supprimer ce revenu ?"):
            self.repo.delete_revenu(self.get_month_key(), revenu_id)

    def _on_add_charge(self) -> None:
        label = self.new_charge_label.text().strip()
        if not label:
            return
        self.repo.add_charge(self.get_month_key(), label, self.new_charge_amount.value())
        self.new_charge_label.clear()
        self.new_charge_amount.setValue(0.0)

    def _on_edit_charge(self, charge_id: str) -> None:
        month = self.repo.state.months.get(self.get_month_key())
        charge = next((c for c in month.charges if c.id == charge_id), None) if month else None
        if charge is None:
            return
        label, ok = ask_text(self, "Modifier la charge", "Libellé", charge.label)
        if not ok:
            return
        amount, ok = ask_amount(self, "Modifier la charge", "Montant prévu", charge.planned)
        if not ok:
            return
        self.repo.update_charge(self.get_month_key(), charge_id, label, amount, charge.paid)

    def _on_delete_charge(self, charge_id: str) -> None:
        if confirm(self, "Supprimer cette charge ?"):
            self.repo.delete_charge(self.get_month_key(), charge_id)

    def _on_toggle_paid(self, charge_id: str, _state: int) -> None:
        self.repo.toggle_charge_paid(self.get_month_key(), charge_id)

    def _on_toggle_closed(self, _state: int) -> None:
        self.repo.toggle_month_closed(self.get_month_key())

    def _on_duplicate_next(self) -> None:
        from ..dateutils import get_adjacent_month_key

        target = get_adjacent_month_key(self.get_month_key(), 1)
        self.repo.duplicate_month_to(self.get_month_key(), target)
        QMessageBox.information(self, "Oracle", "Mois dupliqué vers le mois suivant.")

    def _on_apply_auto_savings(self) -> None:
        self.repo.apply_auto_savings_for_month(self.get_month_key())
