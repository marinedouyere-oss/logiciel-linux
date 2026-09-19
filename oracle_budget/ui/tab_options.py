from __future__ import annotations

import json

from PySide6.QtWidgets import (
    QFileDialog, QGroupBox, QHBoxLayout, QLabel, QLineEdit, QMessageBox,
    QPushButton, QVBoxLayout, QWidget,
)

from .. import config
from ..firebase_client import FirebaseError
from ..models import OracleData
from ..repository import OracleRepository


class OptionsTab(QWidget):
    def __init__(self, repo: OracleRepository):
        super().__init__()
        self.repo = repo

        root = QVBoxLayout(self)

        # --- Compte / synchronisation ---
        auth_box = QGroupBox("Compte et synchronisation")
        auth_layout = QVBoxLayout(auth_box)

        self.status_label = QLabel()
        auth_layout.addWidget(self.status_label)

        form_row = QHBoxLayout()
        self.email_edit = QLineEdit()
        self.email_edit.setPlaceholderText("E-mail")
        self.password_edit = QLineEdit()
        self.password_edit.setPlaceholderText("Mot de passe")
        self.password_edit.setEchoMode(QLineEdit.EchoMode.Password)
        form_row.addWidget(self.email_edit, 2)
        form_row.addWidget(self.password_edit, 1)
        auth_layout.addLayout(form_row)

        btn_row = QHBoxLayout()
        signin_btn = QPushButton("Se connecter")
        signin_btn.clicked.connect(self._on_sign_in)
        signup_btn = QPushButton("Créer un compte")
        signup_btn.clicked.connect(self._on_sign_up)
        signout_btn = QPushButton("Se déconnecter")
        signout_btn.clicked.connect(self._on_sign_out)
        sync_btn = QPushButton("Synchroniser maintenant")
        sync_btn.clicked.connect(self._on_sync)
        btn_row.addWidget(signin_btn)
        btn_row.addWidget(signup_btn)
        btn_row.addWidget(signout_btn)
        btn_row.addWidget(sync_btn)
        auth_layout.addLayout(btn_row)

        info = QLabel(
            f"Base Firebase : {config.FIREBASE_DATABASE_URL}\n"
            f"Cache local : {config.LOCAL_DATA_FILE}"
        )
        info.setStyleSheet("color: gray;")
        auth_layout.addWidget(info)

        root.addWidget(auth_box)

        # --- Sauvegarde / restauration ---
        backup_box = QGroupBox("Sauvegarde")
        backup_layout = QHBoxLayout(backup_box)
        export_json_btn = QPushButton("Exporter en JSON…")
        export_json_btn.clicked.connect(self._on_export_json)
        export_csv_btn = QPushButton("Exporter en CSV…")
        export_csv_btn.clicked.connect(self._on_export_csv)
        import_json_btn = QPushButton("Importer un JSON…")
        import_json_btn.clicked.connect(self._on_import_json)
        backup_layout.addWidget(export_json_btn)
        backup_layout.addWidget(export_csv_btn)
        backup_layout.addWidget(import_json_btn)
        root.addWidget(backup_box)

        root.addStretch(1)

    def refresh(self) -> None:
        if self.repo.session is not None:
            self.status_label.setText(
                f"Connecté en tant que {self.repo.session.email} — synchronisation : {self.repo.sync_status}"
            )
        else:
            self.status_label.setText(f"Non connecté — synchronisation : {self.repo.sync_status}")

    def _on_sign_in(self) -> None:
        try:
            self.repo.sign_in(self.email_edit.text().strip(), self.password_edit.text())
            self.repo.sync()
        except FirebaseError as exc:
            QMessageBox.warning(self, "Connexion impossible", str(exc))
        self.refresh()

    def _on_sign_up(self) -> None:
        try:
            self.repo.sign_up(self.email_edit.text().strip(), self.password_edit.text())
        except FirebaseError as exc:
            QMessageBox.warning(self, "Création de compte impossible", str(exc))
        self.refresh()

    def _on_sign_out(self) -> None:
        self.repo.sign_out()
        self.refresh()

    def _on_sync(self) -> None:
        try:
            self.repo.sync()
            QMessageBox.information(self, "Oracle", "Synchronisation terminée.")
        except FirebaseError as exc:
            QMessageBox.warning(self, "Erreur de synchronisation", str(exc))
        self.refresh()

    def _on_export_json(self) -> None:
        path, _ = QFileDialog.getSaveFileName(self, "Exporter en JSON", "oracle-budget.json", "JSON (*.json)")
        if not path:
            return
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.repo.state.to_dict(), f, ensure_ascii=False, indent=2)
        QMessageBox.information(self, "Oracle", "Export JSON terminé.")

    def _on_export_csv(self) -> None:
        path, _ = QFileDialog.getSaveFileName(self, "Exporter en CSV", "oracle-budget.csv", "CSV (*.csv)")
        if not path:
            return
        from ..backup import export_csv

        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(export_csv(self.repo.state))
        QMessageBox.information(self, "Oracle", "Export CSV terminé.")

    def _on_import_json(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Importer un JSON", "", "JSON (*.json)")
        if not path:
            return
        if QMessageBox.question(
            self, "Confirmation", "Remplacer toutes les données actuelles par ce fichier ?"
        ) != QMessageBox.StandardButton.Yes:
            return
        try:
            with open(path, encoding="utf-8") as f:
                raw = json.load(f)
            new_data = OracleData.from_dict(raw)
        except (ValueError, KeyError, OSError) as exc:
            QMessageBox.warning(self, "Import impossible", str(exc))
            return
        self.repo.restore_data(new_data)
        QMessageBox.information(self, "Oracle", "Import terminé.")
