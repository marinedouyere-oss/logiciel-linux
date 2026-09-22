package com.marinedouyere.orion.xlsx

import java.io.OutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Minimal, dependency-free .xlsx writer producing a single-sheet workbook
 * that Excel/LibreOffice/Google Sheets/this app's own XlsxReader can all
 * open. Text cells use inline strings, so no shared-string table is needed.
 */
object XlsxWriter {

    fun writeSheet(output: OutputStream, headers: List<String>, rows: List<List<Any?>>, sheetName: String = "Sheet1") {
        ZipOutputStream(output).use { zos ->
            writeEntry(zos, "[Content_Types].xml", CONTENT_TYPES)
            writeEntry(zos, "_rels/.rels", RELS)
            writeEntry(zos, "xl/workbook.xml", workbookXml(sheetName))
            writeEntry(zos, "xl/_rels/workbook.xml.rels", WORKBOOK_RELS)
            writeEntry(zos, "xl/worksheets/sheet1.xml", sheetXml(headers, rows))
        }
    }

    private fun writeEntry(zos: ZipOutputStream, name: String, content: String) {
        zos.putNextEntry(ZipEntry(name))
        zos.write(content.toByteArray(Charsets.UTF_8))
        zos.closeEntry()
    }

    private fun escapeXml(s: String): String = s
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        .replace("\"", "&quot;").replace("'", "&apos;")

    private fun columnRef(colIdx0: Int): String {
        var n = colIdx0
        val sb = StringBuilder()
        do {
            sb.insert(0, 'A' + (n % 26))
            n = n / 26 - 1
        } while (n >= 0)
        return sb.toString()
    }

    private fun cellXml(colIdx0: Int, rowIdx1: Int, value: Any?): String {
        if (value == null || value == "") return ""
        val ref = "${columnRef(colIdx0)}$rowIdx1"
        return if (value is Number) {
            val d = value.toDouble()
            val text = if (d == Math.floor(d) && !d.isInfinite()) d.toLong().toString() else d.toString()
            "<c r=\"$ref\"><v>$text</v></c>"
        } else {
            val s = escapeXml(value.toString())
            "<c r=\"$ref\" t=\"inlineStr\"><is><t xml:space=\"preserve\">$s</t></is></c>"
        }
    }

    private fun sheetXml(headers: List<String>, rows: List<List<Any?>>): String {
        val sb = StringBuilder()
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n")
        sb.append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>\n")
        var r = 1
        sb.append("<row r=\"$r\">")
        headers.forEachIndexed { i, h -> sb.append(cellXml(i, r, h)) }
        sb.append("</row>\n")
        r++
        rows.forEach { row ->
            sb.append("<row r=\"$r\">")
            row.forEachIndexed { i, v -> sb.append(cellXml(i, r, v)) }
            sb.append("</row>\n")
            r++
        }
        sb.append("</sheetData></worksheet>")
        return sb.toString()
    }

    private fun workbookXml(sheetName: String) = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>"""

    private const val CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"""

    private const val RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"""

    private const val WORKBOOK_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"""
}
