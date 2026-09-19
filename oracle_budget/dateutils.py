"""Clés de mois "cycle budgétaire" (25 du mois -> 24 du mois suivant),
repris tel quel de OracleDataKt côté Android.
"""
from __future__ import annotations

import datetime

MOIS_LONGS = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]
MOIS_COURTS = [
    "Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin",
    "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc.",
]


def oracle_month_key(date: datetime.date) -> str:
    year, month = date.year, date.month
    if date.day >= 25:
        month += 1
        if month > 12:
            month = 1
            year += 1
    return f"{year}-{month:02d}"


def get_adjacent_month_key(key: str, offset: int) -> str:
    year_s, month_s = key.split("-")
    year, month = int(year_s), int(month_s) + offset
    while month > 12:
        month -= 12
        year += 1
    while month < 1:
        month += 12
        year -= 1
    return f"{year}-{month:02d}"


def month_label(key: str) -> str:
    year_s, month_s = key.split("-")
    return f"{MOIS_LONGS[int(month_s) - 1]} {year_s}"


def cycle_label(key: str) -> str:
    year_s, month_s = key.split("-")
    prev_key = get_adjacent_month_key(key, -1)
    _, prev_month_s = prev_key.split("-")
    return (
        f"Cycle : 25 {MOIS_LONGS[int(prev_month_s) - 1]}"
        f" – 24 {MOIS_LONGS[int(month_s) - 1]} {year_s}"
    )


def today_label() -> str:
    now = datetime.date.today()
    return f"{now.day} {MOIS_COURTS[now.month - 1].lower()} {now.year}"


def year_month_keys(year: int) -> list[tuple[str, str]]:
    return [(f"{year}-{m:02d}", MOIS_COURTS[m - 1]) for m in range(1, 13)]
