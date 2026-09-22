package com.marinedouyere.orion.xlsx

import org.w3c.dom.Document
import org.w3c.dom.Element
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.util.zip.ZipInputStream
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Minimal, dependency-free .xlsx reader (no Apache POI, which has a history of
 * missing-class issues on Android). Reads the first worksheet of a standard
 * OOXML spreadsheet into raw string rows — column/header interpretation is
 * left to the caller, exactly like `XLSX.utils.sheet_to_json(sheet,{header:1})`
 * feeding rowsToPieces()/parseLancement() in the original orion.html.
 *
 * Supports what real-world exports (Excel, LibreOffice, Google Sheets, and
 * this app's own XlsxWriter) actually produce: shared strings, inline
 * strings, and plain numeric cells. Formulas, styles and merged cells are
 * not needed for flat tabular import/export and are ignored.
 */
object XlsxReader {

    fun readFirstSheet(input: InputStream): List<List<String>> {
        val entries = HashMap<String, ByteArray>()
        ZipInputStream(input).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                if (!entry.isDirectory) entries[entry.name] = zis.readBytes()
                entry = zis.nextEntry
            }
        }
        val sharedStrings = entries["xl/sharedStrings.xml"]?.let { parseSharedStrings(it) } ?: emptyList()
        val sheetBytes = entries["xl/worksheets/sheet1.xml"]
            ?: entries.entries.firstOrNull { it.key.startsWith("xl/worksheets/") && it.key.endsWith(".xml") }?.value
            ?: return emptyList()
        return parseSheet(sheetBytes, sharedStrings)
    }

    private fun parseSharedStrings(bytes: ByteArray): List<String> {
        val doc = parseXml(bytes)
        val siNodes = doc.getElementsByTagName("si")
        return (0 until siNodes.length).map { i ->
            val si = siNodes.item(i) as Element
            val tNodes = si.getElementsByTagName("t")
            (0 until tNodes.length).joinToString("") { j -> tNodes.item(j).textContent ?: "" }
        }
    }

    private fun parseSheet(bytes: ByteArray, sharedStrings: List<String>): List<List<String>> {
        val doc = parseXml(bytes)
        val rowNodes = doc.getElementsByTagName("row")
        val rows = mutableListOf<List<String>>()
        for (i in 0 until rowNodes.length) {
            val rowEl = rowNodes.item(i) as Element
            val cellNodes = rowEl.getElementsByTagName("c")
            val cellsByCol = HashMap<Int, String>()
            var maxCol = -1
            for (j in 0 until cellNodes.length) {
                val c = cellNodes.item(j) as Element
                val ref = c.getAttribute("r")
                val colIdx = if (ref.isNotEmpty()) columnIndexFromRef(ref) else j
                val type = c.getAttribute("t")
                val value = when (type) {
                    "s" -> {
                        val rawV = firstChildText(c, "v")
                        sharedStrings.getOrElse(rawV?.toIntOrNull() ?: -1) { "" }
                    }
                    "inlineStr" -> firstChildText(c, "t") ?: ""
                    "str", "" -> firstChildText(c, "v") ?: ""
                    else -> firstChildText(c, "v") ?: ""
                }
                cellsByCol[colIdx] = value
                if (colIdx > maxCol) maxCol = colIdx
            }
            rows.add(if (maxCol < 0) emptyList() else (0..maxCol).map { cellsByCol[it] ?: "" })
        }
        return rows
    }

    private fun firstChildText(parent: Element, tag: String): String? {
        val nodes = parent.getElementsByTagName(tag)
        return if (nodes.length > 0) nodes.item(0).textContent else null
    }

    private fun columnIndexFromRef(ref: String): Int {
        var idx = 0
        for (ch in ref) {
            if (ch.isLetter()) idx = idx * 26 + (ch.uppercaseChar() - 'A' + 1) else break
        }
        return idx - 1
    }

    private fun parseXml(bytes: ByteArray): Document {
        val factory = DocumentBuilderFactory.newInstance()
        factory.isNamespaceAware = false
        return factory.newDocumentBuilder().parse(ByteArrayInputStream(bytes))
    }
}
