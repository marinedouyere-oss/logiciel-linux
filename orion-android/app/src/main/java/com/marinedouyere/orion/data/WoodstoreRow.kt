package com.marinedouyere.orion.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * One Woodstore stock reference. Mirrors the row shape of WOODSTORE_BASE /
 * WOODSTORE in orion.html: {id, mat, L, W, ep, cat, fil, grp, desc, type, flag, fam}.
 */
data class WoodstoreRow(
    val id: String,
    val mat: String,
    val L: Double,
    val W: Double,
    val ep: Double?,
    val cat: String,
    val fil: String,
    val grp: String,
    val desc: String,
    val type: String,
    val flag: String,
    val fam: String,
)

private fun JSONObject.optNullableDouble(key: String): Double? =
    if (isNull(key) || !has(key)) null else optDouble(key).takeUnless { it.isNaN() }

private fun JSONObject.optStringOrBlank(key: String): String = optString(key, "")

fun woodstoreRowFromJson(o: JSONObject): WoodstoreRow = WoodstoreRow(
    id = o.optStringOrBlank("id"),
    mat = o.optStringOrBlank("mat"),
    L = o.optDouble("L", 0.0),
    W = o.optDouble("W", 0.0),
    ep = o.optNullableDouble("ep"),
    cat = o.optStringOrBlank("cat"),
    fil = o.optStringOrBlank("fil"),
    grp = o.optStringOrBlank("grp"),
    desc = o.optStringOrBlank("desc"),
    type = o.optStringOrBlank("type"),
    flag = o.optStringOrBlank("flag"),
    fam = o.optStringOrBlank("fam"),
)

fun woodstoreRowToJson(r: WoodstoreRow): JSONObject = JSONObject().apply {
    put("id", r.id)
    put("mat", r.mat)
    put("L", r.L)
    put("W", r.W)
    put("ep", r.ep ?: JSONObject.NULL)
    put("cat", r.cat)
    put("fil", r.fil)
    put("grp", r.grp)
    put("desc", r.desc)
    put("type", r.type)
    put("flag", r.flag)
    put("fam", r.fam)
}

/** Parses a JSON array of row objects (the bundled asset or a saved snapshot). */
fun parseWoodstoreRows(json: String): List<WoodstoreRow> {
    val array = JSONArray(json)
    return (0 until array.length()).map { i -> woodstoreRowFromJson(array.getJSONObject(i)) }
}

fun woodstoreRowsToJson(rows: List<WoodstoreRow>): String {
    val array = JSONArray()
    rows.forEach { array.put(woodstoreRowToJson(it)) }
    return array.toString()
}
