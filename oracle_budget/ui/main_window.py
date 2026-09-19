from __future__ import annotations

import datetime

from PySide6.QtWidgets import QHBoxLayout, QLabel, QMainWindow, QPushButton, QTabWidget, QVBoxLayout, QWidget

from ..dateutils import cycle_label, get_adjacent_month_key, month_label, oracle_month_key
from ..repository import OracleRepository
from .tab_annuel import AnnuelTab
from .tab_delta import DeltaTab
from .tab_mensuel import MensuelTab
from .tab_options import OptionsTab
from .tab_suivi import SuiviTab


class MainWindow(QMainWindow):
    def __init__(self, repo: OracleRepository):
        super().__init__()
        self.repo = repo
        self.setWindowTitle("Oracle — Budget")
        self.resize(1000, 720)

        self.selected_month_key = oracle_month_key(datetime.date.today())
        self.repo.ensure_month_exists(self.selected_month_key)

        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)

        nav = QHBoxLayout()
        prev_btn = QPushButton("◀")
        prev_btn.clicked.connect(lambda: self._change_month(-1))
        self.month_label = QLabel()
        self.month_label.setStyleSheet("font-size: 18px; font-weight: bold;")
        next_btn = QPushButton("▶")
        next_btn.clicked.connect(lambda: self._change_month(1))
        self.cycle_label = QLabel()
        self.cycle_label.setStyleSheet("color: gray;")
        nav.addWidget(prev_btn)
        nav.addWidget(self.month_label)
        nav.addWidget(next_btn)
        nav.addSpacing(20)
        nav.addWidget(self.cycle_label)
        nav.addStretch(1)
        root.addLayout(nav)

        self.tabs = QTabWidget()
        self.suivi_tab = SuiviTab(repo, lambda: self.selected_month_key)
        self.delta_tab = DeltaTab(repo, lambda: self.selected_month_key)
        self.mensuel_tab = MensuelTab(repo)
        self.annuel_tab = AnnuelTab(repo)
        self.options_tab = OptionsTab(repo)

        self.tabs.addTab(self.suivi_tab, "🏠 Suivi")
        self.tabs.addTab(self.delta_tab, "🎯 Delta")
        self.tabs.addTab(self.mensuel_tab, "📊 Mensuel")
        self.tabs.addTab(self.annuel_tab, "📈 Annuel")
        self.tabs.addTab(self.options_tab, "⚙️ Options")
        root.addWidget(self.tabs)

        self.repo.on_change(self.refresh_all)
        self.refresh_all()

    def _change_month(self, offset: int) -> None:
        self.selected_month_key = get_adjacent_month_key(self.selected_month_key, offset)
        self.repo.ensure_month_exists(self.selected_month_key)
        self.refresh_all()

    def refresh_all(self) -> None:
        self.month_label.setText(month_label(self.selected_month_key).capitalize())
        self.cycle_label.setText(cycle_label(self.selected_month_key))
        self.suivi_tab.refresh()
        self.delta_tab.refresh()
        self.mensuel_tab.refresh()
        self.annuel_tab.refresh()
        self.options_tab.refresh()
