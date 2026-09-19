"""Catégorisation des charges par préfixe de libellé, repris de
CategoriesKt (Android). Les correspondances sont insensibles à la casse.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .models import Month


@dataclass
class LabelTotal:
    label: str
    amount: float


@dataclass
class CategoryDef:
    title: str
    description: str
    matcher: Callable[[str], bool]


@dataclass
class CategoryResult:
    category: CategoryDef
    items: list[LabelTotal]
    total: float


def _starts_with_any(label: str, *prefixes: str) -> bool:
    lowered = label.lower()
    return any(lowered.startswith(p.lower()) for p in prefixes)


def _match_energie(label: str) -> bool:
    return _starts_with_any(label, "Électricité", "Eau", "Gaz")


def _match_telecom(label: str) -> bool:
    return _starts_with_any(label, "Internet", "Fibre", "Mobile", "Téléphone", "Portable")


def _match_impot(label: str) -> bool:
    return _starts_with_any(label, "Impôt", "Taxe", "SMICTOM")


def _match_assurance(label: str) -> bool:
    starts_assurance = label.lower().startswith("assurance")
    starts_assurance_pret = label.lower().startswith("assurance prêt")
    return (starts_assurance and not starts_assurance_pret) or _starts_with_any(
        label, "Suravenir", "Mutuelle"
    )


def _match_enfants(label: str) -> bool:
    return _starts_with_any(label, "Périscolaire", "Cantine", "Crèche", "Nounou", "Garde")


CHARGE_CATEGORIES: list[CategoryDef] = [
    CategoryDef(
        "Courses, épargne & essence",
        "Charges du quotidien isolées des autres postes : libellés commençant par"
        " « Courses », « Épargne » ou « Essence ».",
        lambda label: _starts_with_any(label, "Courses", "Épargne", "Essence"),
    ),
    CategoryDef(
        "Énergie & eau",
        "Libellés commençant par « Électricité », « Eau » ou « Gaz ».",
        _match_energie,
    ),
    CategoryDef(
        "Télécommunications",
        "Libellés commençant par « Internet », « Fibre », « Mobile », « Téléphone »"
        " ou « Portable ».",
        _match_telecom,
    ),
    CategoryDef(
        "Impôt",
        "Libellés commençant par « Impôt », « Taxe » (taxe foncière, taxe"
        " d'habitation…) ou « SMICTOM ».",
        _match_impot,
    ),
    CategoryDef(
        "Assurances & épargne financière",
        "Libellés commençant par « Assurance » (hors assurance de prêt, déjà"
        " classée dans Prêts), « Suravenir » ou « Mutuelle ».",
        _match_assurance,
    ),
    CategoryDef(
        "Enfants & scolarité",
        "Libellés commençant par « Périscolaire », « Cantine », « Crèche »,"
        " « Nounou » ou « Garde ».",
        _match_enfants,
    ),
]


def is_loan_label(label: str) -> bool:
    return _starts_with_any(label, "Prêt", "Assurance prêt", "Action logement")


def aggregate_charges_by_label(months: list[Month]) -> list[LabelTotal]:
    totals: dict[str, float] = {}
    for month in months:
        for charge in month.charges:
            totals[charge.label] = totals.get(charge.label, 0.0) + charge.planned
    return [LabelTotal(label, amount) for label, amount in totals.items()]


def loan_totals(months: list[Month]) -> list[LabelTotal]:
    totals = [lt for lt in aggregate_charges_by_label(months) if is_loan_label(lt.label)]
    return sorted(totals, key=lambda lt: lt.amount, reverse=True)


def categorize_non_loan_charges(months: list[Month]) -> list[CategoryResult]:
    non_loan = [lt for lt in aggregate_charges_by_label(months) if not is_loan_label(lt.label)]
    already_matched: set[str] = set()
    results: list[CategoryResult] = []
    for category in CHARGE_CATEGORIES:
        items = [
            lt
            for lt in non_loan
            if category.matcher(lt.label) and lt.label not in already_matched
        ]
        for lt in items:
            already_matched.add(lt.label)
        results.append(CategoryResult(category, items, sum(lt.amount for lt in items)))

    other_items = [lt for lt in non_loan if lt.label not in already_matched]
    other_category = CategoryDef(
        "Étude des autres charges",
        "Répartition des charges qui ne correspondent à aucune des catégories"
        " ci-dessus, en % des revenus.",
        lambda label: True,
    )
    results.append(
        CategoryResult(other_category, other_items, sum(lt.amount for lt in other_items))
    )
    return results
