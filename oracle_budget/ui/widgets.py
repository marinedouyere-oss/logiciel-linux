"""Petits widgets/utilitaires réutilisés par les onglets."""
from __future__ import annotations

from PySide6.QtWidgets import (
    QDoubleSpinBox, QHBoxLayout, QInputDialog, QMessageBox, QPushButton, QWidget,
)


def make_amount_spinbox(value: float = 0.0) -> QDoubleSpinBox:
    box = QDoubleSpinBox()
    box.setRange(-1_000_000.0, 1_000_000.0)
    box.setDecimals(2)
    box.setSingleStep(1.0)
    box.setSuffix(" €")
    box.setValue(value)
    return box


def make_row_actions(on_edit, on_delete) -> QWidget:
    container = QWidget()
    layout = QHBoxLayout(container)
    layout.setContentsMargins(0, 0, 0, 0)
    edit_btn = QPushButton("Modifier")
    edit_btn.clicked.connect(on_edit)
    delete_btn = QPushButton("Supprimer")
    delete_btn.clicked.connect(on_delete)
    layout.addWidget(edit_btn)
    layout.addWidget(delete_btn)
    return container


def ask_text(parent, title: str, label: str, default: str):
    return QInputDialog.getText(parent, title, label, text=default)


def ask_amount(parent, title: str, label: str, default: float):
    return QInputDialog.getDouble(
        parent, title, label, value=default, min=-1_000_000, max=1_000_000, decimals=2
    )


def confirm(parent, question: str) -> bool:
    return (
        QMessageBox.question(parent, "Confirmation", question)
        == QMessageBox.StandardButton.Yes
    )
