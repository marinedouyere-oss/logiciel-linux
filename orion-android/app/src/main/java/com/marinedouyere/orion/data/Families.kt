package com.marinedouyere.orion.data

/** Human-readable label per Woodstore family (FAM_LABELS in the original app). */
val FAM_LABELS: Map<String, String> = mapOf(
    "strat" to "Stratifié",
    "compact" to "Compact",
    "agglo" to "Agglo",
    "meganite" to "Meganite",
    "protection" to "Protection",
    "melamine" to "Mélaminé",
    "mdf" to "MDF",
    "caisse" to "Caisse",
    "fibre" to "Fibre",
    "contreplaque" to "Contreplaqué",
    "autre" to "Autre",
)

fun famLabel(fam: String?): String = FAM_LABELS[fam] ?: fam.takeUnless { it.isNullOrBlank() } ?: "Autre"

/** Distinct families present in the library, sorted by their display label (fillFamSelects in orion.html). */
fun famList(woodstore: List<WoodstoreRow>): List<String> =
    woodstore.mapNotNull { it.fam.takeUnless { f -> f.isBlank() } }.distinct().sortedBy { famLabel(it) }

/**
 * Machine settings profile applied per family (FAM_PROFILE): only strat and agglo
 * have real Cut Rite parameter sheets, so every other family borrows the closest one.
 */
val FAM_PROFILE: Map<String, String> = mapOf(
    "strat" to "strat",
    "compact" to "strat",
    "meganite" to "strat",
    "fibre" to "strat",
    "contreplaque" to "strat",
    "agglo" to "agglo",
    "melamine" to "agglo",
    "mdf" to "agglo",
    "protection" to "agglo",
    "caisse" to "agglo",
    "autre" to "strat",
)
