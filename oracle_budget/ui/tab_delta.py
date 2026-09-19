from __future__ import annotations

from functools import partial

from PySide6.QtWidgets import (
    QComboBox, QGroupBox, QHBoxLayout, QLabel, QLineEdit, QPushButton,
    QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)

from ..format_utils import fmt_money
from ..models import compute_month_financials
from ..repository import OracleRepository
from .widgets import ask_amount, ask_text, confirm, make_amount_spinbox, make_row_actions


class DeltaTab(QWidget):
    def __init__(self, repo: OracleRepository, get_month_key):
        super().__init__()
        self.repo = repo
        self.get_month_key = get_month_key

        root = QVBoxLayout(self)

        ceiling_row = QHBoxLayout()
        ceiling_row.addWidget(QLabel("Plafond de solde visé (épargne automatique) :"))
        self.ceiling_box = make_amount_spinbox()
        ceiling_row.addWidget(self.ceiling_box)
        save_btn = QPushButton("Enregistrer")
        save_btn.clicked.connect(self._on_save_ceiling)
        ceiling_row.addWidget(save_btn)
        ceiling_row.addStretch(1)
        root.addLayout(ceiling_row)

        self.summary_label = QLabel()
        self.summary_label.setStyleSheet("font-size: 16px; font-weight: bold;")
        root.addWidget(self.summary_label)

        lines_box = QGroupBox("Lignes de delta (ajustements ponctuels du mois)")
        lines_layout = QVBoxLayout(lines_box)
        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["Libellé", "Montant", "Type", ""])
        self.table.horizontalHeader().setStretchLastSection(True)
        lines_layout.addWidget(self.table)

        add_row = QHBoxLayout()
        self.new_label = QLineEdit()
        self.new_label.setPlaceholderText("Nouvelle ligne (libellé)")
        self.new_amount = make_amount_spinbox()
        self.new_type = QComboBox()
        self.new_type.addItems(["minus", "plus"])
        add_btn = QPushButton("Ajouter")
        add_btn.clicked.connect(self._on_add)
        add_row.addWidget(self.new_label, 2)
        add_row.addWidget(self.new_amount, 1)
        add_row.addWidget(self.new_type)
        add_row.addWidget(add_btn)
        lines_layout.addLayout(add_row)

        root.addWidget(lines_box)

    def refresh(self) -> None:
        self.ceiling_box.blockSignals(True)
        self.ceiling_box.setValue(self.repo.state.deltaCeiling)
        self.ceiling_box.blockSignals(False)

        key = self.get_month_key()
        month = self.repo.state.months.get(key)
        if month is None:
            self.table.setRowCount(0)
            self.summary_label.setText("Aucune donnée pour ce mois.")
            return

        fin = compute_month_financials(month)
        plus_total = sum(d.amount for d in month.deltaLines if d.type == "plus")
        minus_total = sum(d.amount for d in month.deltaLines if d.type != "plus")
        net = fin.delta + plus_total - minus_total
        self.summary_label.setText(
            f"Solde du mois : {fmt_money(fin.delta)}    Ajustements : "
            f"+{fmt_money(plus_total)} / -{fmt_money(minus_total)}    Delta net : {fmt_money(net)}"
        )

        self.table.setRowCount(len(month.deltaLines))
        for row, line in enumerate(month.deltaLines):
            self.table.setItem(row, 0, QTableWidgetItem(line.label))
            self.table.setItem(row, 1, QTableWidgetItem(fmt_money(line.amount)))
            self.table.setItem(row, 2, QTableWidgetItem(line.type))
            self.table.setCellWidget(
                row, 3,
                make_row_actions(
                    partial(self._on_edit, line.id),
                    partial(self._on_delete, line.id),
                ),
            )

    def _on_save_ceiling(self) -> None:
        self.repo.set_delta_ceiling(self.ceiling_box.value())

    def _on_add(self) -> None:
        label = self.new_label.text().strip()
        if not label:
            return
        self.repo.add_delta_line(
            self.get_month_key(), label, self.new_amount.value(), self.new_type.currentText()
        )
        self.new_label.clear()
        self.new_amount.setValue(0.0)

    def _on_edit(self, line_id: str) -> None:
        month = self.repo.state.months.get(self.get_month_key())
        line = next((d for d in month.deltaLines if d.id == line_id), None) if month else None
        if line is None:
            return
        label, ok = ask_text(self, "Modifier la ligne", "Libellé", line.label)
        if not ok:
            return
        amount, ok = ask_amount(self, "Modifier la ligne", "Montant", line.amount)
        if not ok:
            return
        self.repo.update_delta_line(self.get_month_key(), line_id, label, amount, line.type)

    def _on_delete(self, line_id: str) -> None:
        if confirm(self, "Supprimer cette ligne ?"):
            self.repo.delete_delta_line(self.get_month_key(), line_id)
