"""Modèle de données, calqué sur les classes Kotlin @Serializable de
l'appli Android Oracle (package com.oracle2015.budget.data), pour rester
compatible avec le JSON stocké dans Firebase Realtime Database.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field, replace
from typing import Any


def new_id() -> str:
    return uuid.uuid4().hex[:8]


@dataclass
class Revenu:
    id: str
    label: str
    amount: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "label": self.label, "amount": self.amount}

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Revenu":
        return Revenu(id=d["id"], label=d["label"], amount=float(d.get("amount", 0.0)))


@dataclass
class Charge:
    id: str
    label: str
    planned: float = 0.0
    paid: bool = False
    manualOverride: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "planned": self.planned,
            "paid": self.paid,
            "manualOverride": self.manualOverride,
        }

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Charge":
        return Charge(
            id=d["id"],
            label=d["label"],
            planned=float(d.get("planned", 0.0)),
            paid=bool(d.get("paid", False)),
            manualOverride=bool(d.get("manualOverride", False)),
        )


@dataclass
class DeltaLine:
    id: str
    label: str
    amount: float = 0.0
    type: str = "minus"  # "minus" ou "plus"

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "label": self.label, "amount": self.amount, "type": self.type}

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "DeltaLine":
        return DeltaLine(
            id=d["id"],
            label=d["label"],
            amount=float(d.get("amount", 0.0)),
            type=d.get("type", "minus"),
        )


@dataclass
class Month:
    revenus: list[Revenu] = field(default_factory=list)
    charges: list[Charge] = field(default_factory=list)
    deltaLines: list[DeltaLine] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "revenus": [r.to_dict() for r in self.revenus],
            "charges": [c.to_dict() for c in self.charges],
            "deltaLines": [d.to_dict() for d in self.deltaLines],
        }

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Month":
        return Month(
            revenus=[Revenu.from_dict(x) for x in d.get("revenus", [])],
            charges=[Charge.from_dict(x) for x in d.get("charges", [])],
            deltaLines=[DeltaLine.from_dict(x) for x in d.get("deltaLines", [])],
        )


@dataclass
class MonthFinancials:
    revenus: float
    charges: float
    delta: float


def compute_month_financials(month: Month) -> MonthFinancials:
    total_revenus = sum(r.amount for r in month.revenus)
    total_charges = sum(c.planned for c in month.charges)
    return MonthFinancials(total_revenus, total_charges, total_revenus - total_charges)


@dataclass
class OracleData:
    months: dict[str, Month] = field(default_factory=dict)
    order: list[str] = field(default_factory=list)
    closedMonths: list[str] = field(default_factory=list)
    deltaCeiling: float = 0.0
    lastModified: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "months": {k: m.to_dict() for k, m in self.months.items()},
            "order": list(self.order),
            "closedMonths": list(self.closedMonths),
            "deltaCeiling": self.deltaCeiling,
            "lastModified": self.lastModified,
        }

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "OracleData":
        months_raw = d.get("months") or {}
        return OracleData(
            months={k: Month.from_dict(v) for k, v in months_raw.items() if v},
            order=list(d.get("order") or []),
            closedMonths=list(d.get("closedMonths") or []),
            deltaCeiling=float(d.get("deltaCeiling", 0.0)),
            lastModified=int(d.get("lastModified", 0)),
        )

    def touched(self) -> "OracleData":
        """Retourne une copie avec lastModified mis à jour (équivalent de
        OracleRepository.update() côté Android, qui tamponne chaque
        modification avec l'horodatage courant avant de synchroniser)."""
        return replace(self, lastModified=int(time.time() * 1000))
