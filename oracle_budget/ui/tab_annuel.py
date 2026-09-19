from __future__ import annotations

import datetime

from PySide6.QtWidgets import (
    QHBoxLayout, QLabel, QPushButton, QTreeWidget, QTreeWidgetItem, QVBoxLayout, QWidget,
)

from ..categories import categorize_non_loan_charges, loan_totals
from ..dateutils import year_month_keys
from ..format_utils import fmt_money, fmt_percent
from ..models import Month, compute_month_financials
from ..repository import OracleRepository


class AnnuelTab(QWidget):
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

        root.addWidget(QLabel("Charges par catégorie (% des revenus annuels)"))
        self.category_tree = QTreeWidget()
        self.category_tree.setHeaderLabels(["Catégorie / libellé", "Montant annuel", "% des revenus"])
        root.addWidget(self.category_tree)

        root.addWidget(QLabel("Prêts et charges assimilées"))
        self.loan_tree = QTreeWidget()
        self.loan_tree.setHeaderLabels(["Libellé", "Montant annuel", "% des revenus"])
        root.addWidget(self.loan_tree)

    def _change_year(self, offset: int) -> None:
        self.year += offset
        self.refresh()

    def refresh(self) -> None:
        self.year_label.setText(str(self.year))
        keys = [k for k, _ in year_month_keys(self.year)]
        months = [self.repo.state.months.get(k, Month()) for k in keys]
        total_revenus = sum(compute_month_financials(m).revenus for m in months)

        self.category_tree.clear()
        for result in categorize_non_loan_charges(months):
            parent = QTreeWidgetItem([
                result.category.title,
                fmt_money(result.total),
                fmt_percent(result.total, total_revenus),
            ])
            parent.setToolTip(0, result.category.description)
            for item in result.items:
                parent.addChild(QTreeWidgetItem([
                    item.label,
                    fmt_money(item.amount),
                    fmt_percent(item.amount, total_revenus),
                ]))
            self.category_tree.addTopLevelItem(parent)
        self.category_tree.expandAll()
        for i in range(3):
            self.category_tree.resizeColumnToContents(i)

        self.loan_tree.clear()
        for loan in loan_totals(months):
            self.loan_tree.addTopLevelItem(QTreeWidgetItem([
                loan.label,
                fmt_money(loan.amount),
                fmt_percent(loan.amount, total_revenus),
            ]))
        for i in range(3):
            self.loan_tree.resizeColumnToContents(i)
