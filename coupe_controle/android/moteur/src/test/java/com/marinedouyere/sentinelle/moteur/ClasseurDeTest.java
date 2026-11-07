package com.marinedouyere.sentinelle.moteur;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** Petit classeur .xlsx fabriqué pour les tests (une feuille, textes et nombres). */
final class ClasseurDeTest {

    private ClasseurDeTest() {}

    private static void entree(ZipOutputStream zip, String nom, String contenu) throws IOException {
        zip.putNextEntry(new ZipEntry(nom));
        zip.write(contenu.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    static byte[] xlsx(Object[][] lignes) throws IOException {
        StringBuilder feuille = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                + "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>");
        for (int r = 0; r < lignes.length; r++) {
            feuille.append("<row r=\"").append(r + 1).append("\">");
            for (int c = 0; c < lignes[r].length; c++) {
                Object v = lignes[r][c];
                if (v == null) continue;
                String ref = String.valueOf((char) ('A' + c)) + (r + 1); // 26 colonnes au plus
                if (v instanceof Number) {
                    feuille.append("<c r=\"").append(ref).append("\"><v>").append(v).append("</v></c>");
                } else {
                    feuille.append("<c r=\"").append(ref).append("\" t=\"inlineStr\"><is><t>").append(v).append("</t></is></c>");
                }
            }
            feuille.append("</row>");
        }
        feuille.append("</sheetData></worksheet>");
        ByteArrayOutputStream sortie = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(sortie)) {
            entree(zip, "[Content_Types].xml", "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                    + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                    + "<Default Extension=\"xml\" ContentType=\"application/xml\"/></Types>");
            entree(zip, "_rels/.rels", "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                    + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
            entree(zip, "xl/workbook.xml", "<?xml version=\"1.0\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
                    + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>"
                    + "<sheet name=\"LAN\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
            entree(zip, "xl/_rels/workbook.xml.rels", "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                    + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>");
            entree(zip, "xl/worksheets/sheet1.xml", feuille.toString());
        }
        return sortie.toByteArray();
    }
}
