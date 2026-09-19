"""Formatage monétaire français, repris de FormatKt (Android)."""
from __future__ import annotations


def _group_thousands(digits: str) -> str:
    parts = []
    while len(digits) > 3:
        parts.insert(0, digits[-3:])
        digits = digits[:-3]
    parts.insert(0, digits)
    return " ".join(parts)


def format_thousands(value: float) -> str:
    negative = value < 0
    rounded = round(abs(value), 2)
    int_part, _, dec_part = f"{rounded:.2f}".partition(".")
    grouped = _group_thousands(int_part)
    result = f"{grouped},{dec_part}"
    return f"-{result}" if negative else result


def fmt_money(value: float) -> str:
    return f"{format_thousands(value)} €"


def fmt_percent(numerator: float, denominator: float) -> str:
    if denominator == 0:
        return "0,0 %"
    pct = (numerator / denominator) * 100
    return f"{pct:.1f}".replace(".", ",") + " %"
