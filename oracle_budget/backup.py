"""Export CSV, repris de BackupKt.exportCsv (Android)."""
from __future__ import annotations

from .categories import CHARGE_CATEGORIES, is_loan_label
from .dateutils import month_label
from .models import OracleData


def _csv_escape(value: str) -> str:
    if ";" in value or '"' in value:
        return '"' + value.replace('"', '""') + '"'
    return value


def _csv_number(value: float) -> str:
    return f"{value:.2f}".replace(".", ",")


def _category_for_charge(label: str) -> str:
    if is_loan_label(label):
        return "Prêt"
    for category in CHARGE_CATEGORIES:
        if category.matcher(label):
            return category.title
    return "Autre"


def export_csv(data: OracleData) -> str:
    lines = ["Mois;Type;Libellé;Catégorie;Montant;Payé"]
    for key in sorted(data.order):
        month = data.months.get(key)
        if month is None:
            continue
        label = month_label(key)
        for revenu in month.revenus:
            lines.append(
                f"{label};Revenu;{_csv_escape(revenu.label)};;{_csv_number(revenu.amount)};"
            )
        for charge in month.charges:
            category = _category_for_charge(charge.label)
            paid = "Oui" if charge.paid else "Non"
            lines.append(
                f"{label};Charge;{_csv_escape(charge.label)};{_csv_escape(category)};"
                f"{_csv_number(charge.planned)};{paid}"
            )
    return "\n".join(lines) + "\n"


__all__ = ["export_csv"]
