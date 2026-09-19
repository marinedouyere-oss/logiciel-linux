from __future__ import annotations

import datetime

from PySide6.QtWidgets import (
    QHBoxLayout, QLabel, QPushButton, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)

from ..dateutils import year_month_keys
from ..format_utils import fmt_money
from ..models import Month, compute_month_financials
from ..repository import OracleRepository


class MensuelTab(QWidget):
    def __init__(self, repo: OracleRepository):
        super().__init__()
        self.repo = repo
        self.year = datetime.date.today().year

        root = QVBoxLayout(self)

        nav = QHBoxLayout()
        prev_btn = QPushButton("◀ Année précédente")
        prev_btn.clicked.connect(lambda: self._change_year(-1))
        self.year_label = QLabel()
        self.year_label.setStyleSheet("font-size: 16px; font-weight: bold;")
        next_btn = QPushButton("Année suivante ▶")
        next_btn.clicked.connect(lambda: self._change_year(1))
        nav.addWidget(prev_btn)
        nav.addWidget(self.year_label)
        nav.addWidget(next_btn)
        nav.addStretch(1)
        root.addLayout(nav)

        self.table = QTableWidget(12, 4)
        self.table.setHorizontalHeaderLabels(["Mois", "Revenus", "Charges", "Solde"])
        self.table.horizontalHeader().setStretchLastSection(True)
        root.addWidget(self.table)

        self.total_label = QLabel()
        self.total_label.setStyleSheet("font-size: 15px; font-weight: bold;")
        root.addWidget(self.total_label)

    def _change_year(self, offset: int) -> None:
        self.year += offset
        self.refresh()

    def refresh(self) -> None:
        self.year_label.setText(str(self.year))
        keys = year_month_keys(self.year)
        total_rev = total_charges = 0.0
        self.table.setRowCount(len(keys))
        for row, (key, short_label) in enumerate(keys):
            month = self.repo.state.months.get(key, Month())
            fin = compute_month_financials(month)
            total_rev += fin.revenus
            total_charges += fin.charges
            self.table.setItem(row, 0, QTableWidgetItem(f"{short_label} {self.year}"))
            self.table.setItem(row, 1, QTableWidgetItem(fmt_money(fin.revenus)))
            self.table.setItem(row, 2, QTableWidgetItem(fmt_money(fin.charges)))
            self.table.setItem(row, 3, QTableWidgetItem(fmt_money(fin.delta)))

        self.total_label.setText(
            f"Total {self.year} — Revenus : {fmt_money(total_rev)}    "
            f"Charges : {fmt_money(total_charges)}    Solde : {fmt_money(total_rev - total_charges)}"
        )
