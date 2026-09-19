"""Dépôt de données : cache local + synchronisation Firebase.

Reprend le fonctionnement de OracleRepository côté Android : toute
modification passe par update(transform), qui met à jour l'état en
mémoire, l'horodate, le sauvegarde localement puis le pousse vers
Firebase (la base entière est réécrite à chaque update, comme le fait
`DatabaseReference.setValue` côté Android).
"""
from __future__ import annotations

import datetime
import json
import time
from typing import Callable, Optional

from . import config
from .dateutils import oracle_month_key
from .firebase_client import FirebaseAuth, FirebaseError, RealtimeDatabase, Session
from .models import Charge, DeltaLine, Month, OracleData, Revenu, new_id

AUTO_SAVINGS_LABEL = "Épargne automatique"


def default_month() -> Month:
    return Month(
        revenus=[
            Revenu(new_id(), "Salaire MSA", 0.0),
            Revenu(new_id(), "Salaire Laisne", 0.0),
            Revenu(new_id(), "Prestation familiale", 0.0),
        ]
    )


def apply_auto_savings(month: Month, delta_ceiling: float) -> Optional[Month]:
    """Ajoute, met à jour ou retire automatiquement une charge "Épargne
    automatique" pour ramener le solde du mois au plafond fixé, sauf si
    l'utilisateur a marqué la ligne comme modifiée manuellement.
    Reprend OracleDataKt.applyAutoSavings.
    """
    existing = next(
        (c for c in month.charges if c.label.strip().lower() == AUTO_SAVINGS_LABEL.lower()),
        None,
    )
    if existing is not None and existing.manualOverride:
        return None

    other_charges = [
        c for c in month.charges if c.label.strip().lower() != AUTO_SAVINGS_LABEL.lower()
    ]
    total_revenus = sum(r.amount for r in month.revenus)
    total_other_charges = sum(c.planned for c in other_charges)

    if delta_ceiling <= 0:
        target = 0.0
    else:
        target = max(0.0, round((total_revenus - total_other_charges) - delta_ceiling, 2))

    if existing is not None and abs(existing.planned - target) <= 0.005:
        return None

    if target <= 0:
        if existing is None:
            return None
        new_charges = [c for c in month.charges if c.id != existing.id]
        return Month(month.revenus, new_charges, month.deltaLines)

    if existing is None:
        new_charge = Charge(new_id(), AUTO_SAVINGS_LABEL, target, False, False)
        return Month(month.revenus, month.charges + [new_charge], month.deltaLines)

    new_charges = [
        Charge(c.id, c.label, target, c.paid, c.manualOverride) if c.id == existing.id else c
        for c in month.charges
    ]
    return Month(month.revenus, new_charges, month.deltaLines)


class OracleRepository:
    def __init__(self) -> None:
        config.ensure_dirs()
        self.auth = FirebaseAuth()
        self.db = RealtimeDatabase()
        self.state: OracleData = self._load_local()
        self.session: Optional[Session] = self._load_session()
        self.sync_status: str = "non connectée"
        self._listeners: list[Callable[[], None]] = []

    # ------------------------------------------------------------------ #
    # Observation
    # ------------------------------------------------------------------ #
    def on_change(self, callback: Callable[[], None]) -> None:
        self._listeners.append(callback)

    def _notify(self) -> None:
        for cb in list(self._listeners):
            cb()

    # ------------------------------------------------------------------ #
    # Stockage local
    # ------------------------------------------------------------------ #
    def _load_local(self) -> OracleData:
        if config.LOCAL_DATA_FILE.exists():
            try:
                raw = json.loads(config.LOCAL_DATA_FILE.read_text(encoding="utf-8"))
                return OracleData.from_dict(raw)
            except (ValueError, KeyError):
                pass
        return self._seed_initial_data()

    def _save_local(self) -> None:
        config.LOCAL_DATA_FILE.write_text(
            json.dumps(self.state.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def _seed_initial_data(self) -> OracleData:
        key = oracle_month_key(datetime.date.today())
        return OracleData(months={key: default_month()}, order=[key]).touched()

    def _load_session(self) -> Optional[Session]:
        if config.SESSION_FILE.exists():
            try:
                return Session.from_dict(json.loads(config.SESSION_FILE.read_text(encoding="utf-8")))
            except (ValueError, KeyError):
                return None
        return None

    def _save_session(self) -> None:
        if self.session is None:
            if config.SESSION_FILE.exists():
                config.SESSION_FILE.unlink()
            return
        config.SESSION_FILE.write_text(
            json.dumps(self.session.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
        )
        try:
            config.SESSION_FILE.chmod(0o600)
        except OSError:
            pass

    # ------------------------------------------------------------------ #
    # Authentification
    # ------------------------------------------------------------------ #
    def sign_in(self, email: str, password: str) -> None:
        self.session = self.auth.sign_in(email, password)
        self._save_session()
        self.sync_status = "connectée"

    def sign_up(self, email: str, password: str) -> None:
        self.session = self.auth.sign_up(email, password)
        self._save_session()
        self.sync_status = "connectée"

    def sign_out(self) -> None:
        self.session = None
        self._save_session()
        self.sync_status = "non connectée"
        self._notify()

    def try_resume_session(self) -> bool:
        """Tente de rafraîchir la session sauvegardée au démarrage."""
        if self.session is None:
            return False
        try:
            self.session = self.auth.refresh(self.session)
            self._save_session()
            self.sync_status = "connectée"
            return True
        except FirebaseError:
            self.session = None
            self._save_session()
            return False

    def _ensure_fresh_token(self) -> str:
        if self.session is None:
            raise FirebaseError("Non connecté.")
        if time.time() >= self.session.expires_at:
            self.session = self.auth.refresh(self.session)
            self._save_session()
        return self.session.id_token

    # ------------------------------------------------------------------ #
    # Synchronisation
    # ------------------------------------------------------------------ #
    def pull_remote(self) -> None:
        token = self._ensure_fresh_token()
        raw = self.db.get(token)
        if not raw:
            return
        remote = OracleData.from_dict(raw)
        if remote.lastModified >= self.state.lastModified:
            self.state = remote
            self._save_local()
            self._notify()

    def push_remote(self) -> None:
        token = self._ensure_fresh_token()
        self.db.put(token, self.state.to_dict())

    def sync(self) -> None:
        """Synchronisation manuelle complète : tire puis pousse si besoin."""
        if self.session is None:
            raise FirebaseError("Connectez-vous pour synchroniser.")
        try:
            self.pull_remote()
            self.sync_status = "connectée"
        except FirebaseError as exc:
            self.sync_status = "erreur de synchronisation"
            raise exc

    # ------------------------------------------------------------------ #
    # Mutation générique (équivalent de OracleRepository.update)
    # ------------------------------------------------------------------ #
    def update(self, transform: Callable[[OracleData], OracleData]) -> None:
        self.state = transform(self.state).touched()
        self._save_local()
        self._notify()
        if self.session is not None:
            try:
                self.push_remote()
                self.sync_status = "connectée"
            except FirebaseError:
                self.sync_status = "échec de l'envoi"

    def ensure_month_exists(self, key: str) -> None:
        if key not in self.state.months:
            def _add(data: OracleData) -> OracleData:
                months = dict(data.months)
                months[key] = default_month()
                order = list(data.order)
                if key not in order:
                    order.append(key)
                return OracleData(months, order, data.closedMonths, data.deltaCeiling, data.lastModified)

            self.update(_add)

    # ------------------------------------------------------------------ #
    # Opérations métier (équivalent de OracleViewModel)
    # ------------------------------------------------------------------ #
    def add_revenu(self, month_key: str, label: str, amount: float) -> None:
        self._mutate_month(month_key, lambda m: Month(
            m.revenus + [Revenu(new_id(), label, amount)], m.charges, m.deltaLines
        ))

    def update_revenu(self, month_key: str, revenu_id: str, label: str, amount: float) -> None:
        self._mutate_month(month_key, lambda m: Month(
            [Revenu(r.id, label, amount) if r.id == revenu_id else r for r in m.revenus],
            m.charges, m.deltaLines,
        ))

    def delete_revenu(self, month_key: str, revenu_id: str) -> None:
        self._mutate_month(month_key, lambda m: Month(
            [r for r in m.revenus if r.id != revenu_id], m.charges, m.deltaLines
        ))

    def add_charge(self, month_key: str, label: str, planned: float, paid: bool = False) -> None:
        self._mutate_month(month_key, lambda m: Month(
            m.revenus, m.charges + [Charge(new_id(), label, round(planned, 2), paid, False)], m.deltaLines
        ))

    def update_charge(self, month_key: str, charge_id: str, label: str, planned: float, paid: bool) -> None:
        self._mutate_month(month_key, lambda m: Month(
            m.revenus,
            [
                Charge(c.id, label, round(planned, 2), paid, True) if c.id == charge_id else c
                for c in m.charges
            ],
            m.deltaLines,
        ))

    def toggle_charge_paid(self, month_key: str, charge_id: str) -> None:
        self._mutate_month(month_key, lambda m: Month(
            m.revenus,
            [
                Charge(c.id, c.label, c.planned, not c.paid, c.manualOverride)
                if c.id == charge_id else c
                for c in m.charges
            ],
            m.deltaLines,
        ))

    def delete_charge(self, month_key: str, charge_id: str) -> None:
        self._mutate_month(month_key, lambda m: Month(
            m.revenus, [c for c in m.charges if c.id != charge_id], m.deltaLines
        ))

    def add_delta_line(self, month_key: str, label: str, amount: float, type_: str) -> None:
        self._mutate_month(month_key, lambda m: Month(
            m.revenus, m.charges, m.deltaLines + [DeltaLine(new_id(), label, amount, type_)]
        ))

    def update_delta_line(self, month_key: str, line_id: str, label: str, amount: float, type_: str) -> None:
        self._mutate_month(month_key, lambda m: Month(
            m.revenus, m.charges,
            [
                DeltaLine(d.id, label, amount, type_) if d.id == line_id else d
                for d in m.deltaLines
            ],
        ))

    def delete_delta_line(self, month_key: str, line_id: str) -> None:
        self._mutate_month(month_key, lambda m: Month(
            m.revenus, m.charges, [d for d in m.deltaLines if d.id != line_id]
        ))

    def toggle_month_closed(self, month_key: str) -> None:
        def _toggle(data: OracleData) -> OracleData:
            closed = list(data.closedMonths)
            if month_key in closed:
                closed.remove(month_key)
            else:
                closed.append(month_key)
            return OracleData(data.months, data.order, closed, data.deltaCeiling, data.lastModified)

        self.update(_toggle)

    def set_delta_ceiling(self, value: float) -> None:
        self.update(lambda data: OracleData(
            data.months, data.order, data.closedMonths, value, data.lastModified
        ))

    def apply_auto_savings_for_month(self, month_key: str) -> None:
        month = self.state.months.get(month_key)
        if month is None:
            return
        updated = apply_auto_savings(month, self.state.deltaCeiling)
        if updated is not None:
            self._mutate_month(month_key, lambda m: updated)

    def duplicate_month_to(self, source_key: str, target_key: str) -> None:
        source = self.state.months.get(source_key)
        if source is None:
            return

        def _dup(data: OracleData) -> OracleData:
            months = dict(data.months)
            months[target_key] = Month(
                revenus=[Revenu(new_id(), r.label, r.amount) for r in source.revenus],
                charges=[Charge(new_id(), c.label, c.planned, False, False) for c in source.charges],
                deltaLines=[],
            )
            order = list(data.order)
            if target_key not in order:
                order.append(target_key)
            return OracleData(months, order, data.closedMonths, data.deltaCeiling, data.lastModified)

        self.update(_dup)

    def restore_data(self, new_data: OracleData) -> None:
        self.update(lambda _old: new_data)

    def _mutate_month(self, month_key: str, transform: Callable[[Month], Month]) -> None:
        def _apply(data: OracleData) -> OracleData:
            month = data.months.get(month_key, Month())
            months = dict(data.months)
            months[month_key] = transform(month)
            order = list(data.order)
            if month_key not in order:
                order.append(month_key)
            return OracleData(months, order, data.closedMonths, data.deltaCeiling, data.lastModified)

        self.update(_apply)
