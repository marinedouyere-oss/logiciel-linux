package com.marinedouyere.orion.data

private val LEADING_FLOAT = Regex("""^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?""")
private val LEADING_INT = Regex("""^[+-]?\d+""")

/**
 * JS `parseFloat` semantics: parses a leading numeric prefix and ignores any
 * trailing garbage (e.g. "4200 mm" -> 4200.0), unlike Kotlin's strict
 * `String.toDoubleOrNull()`. Real-world spreadsheet exports/hand edits can
 * carry units or stray text in numeric-looking cells, so import parsing
 * needs this leniency to match the original app's behavior.
 */
fun jsParseFloat(raw: String?): Double? {
    if (raw == null) return null
    val s = raw.trim()
    val m = LEADING_FLOAT.find(s) ?: return null
    if (m.value.isEmpty() || m.value == "+" || m.value == "-") return null
    return m.value.toDoubleOrNull()
}

/** JS `parseInt` (base 10) semantics: leading integer prefix only, decimals truncated. */
fun jsParseInt(raw: String?): Int? {
    if (raw == null) return null
    val s = raw.trim()
    val m = LEADING_INT.find(s) ?: return null
    return m.value.toIntOrNull()
}
