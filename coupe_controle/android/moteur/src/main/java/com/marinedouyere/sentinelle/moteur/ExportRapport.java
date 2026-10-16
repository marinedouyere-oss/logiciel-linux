package com.marinedouyere.sentinelle.moteur;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Rapport de contrôle au format Excel (.xlsx), même contenu et mêmes
 * couleurs que exporterRapport() de l'appli web : totaux, en-têtes, puis
 * une ligne par pièce colorée selon son statut.
 */
public final class ExportRapport {

    private ExportRapport() {}

    public static final String TYPE_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private static final String[] ENTETES = {
        "Commande", "Ligne", "Article", "Lancement", "Qté attendue", "Qté trouvée (coupe)", "Écart", "Statut",
    };
    private static final int[] LARGEURS = {16, 8, 22, 14, 20, 20, 8, 20};

    // Styles (index dans cellXfs) : 0 normal, 1 gras, 2 gras centré, puis un par statut.
    private static final int STYLE_GRAS = 1;
    private static final int STYLE_ENTETE = 2;

    private static int styleStatut(String statut) {
        if (Comparateur.OK.equals(statut)) return 3;
        if (Comparateur.MANQUANT.equals(statut)) return 4;
        if (Comparateur.EN_TROP.equals(statut) || Comparateur.ECART.equals(statut)) return 5;
        return 0;
    }

    /** Nom de fichier proposé : "rapport_controle_coupe_agglo_1er_tour_semaine_paire.xlsx". */
    public static String nomFichier(String nomCase) {
        String s = Normalizer.normalize(nomCase, Normalizer.Form.NFD).replaceAll("[̀-ͯ]", "");
        s = s.replaceAll("[^A-Za-z0-9]+", "_").replaceAll("^_+|_+$", "").toLowerCase(Locale.ROOT);
        return "rapport_controle_coupe_" + s + ".xlsx";
    }

    private static String xml(String s) {
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '&':
                    sb.append("&amp;");
                    break;
                case '<':
                    sb.append("&lt;");
                    break;
                case '>':
                    sb.append("&gt;");
                    break;
                case '"':
                    sb.append("&quot;");
                    break;
                default:
                    if (c < 0x20 && c != '\t' && c != '\n' && c != '\r') continue; // interdit en XML
                    sb.append(c);
            }
        }
        return sb.toString();
    }

    private static String colonne(int i) {
        return String.valueOf((char) ('A' + i));
    }

    private static void cellule(StringBuilder sb, int ligne, int col, Object valeur, int style) {
        String ref = colonne(col) + ligne;
        String s = style != 0 ? " s=\"" + style + "\"" : "";
        if (valeur instanceof Number) {
            sb.append("<c r=\"").append(ref).append('"').append(s).append("><v>")
                    .append(Js.nombre(((Number) valeur).doubleValue())).append("</v></c>");
        } else {
            sb.append("<c r=\"").append(ref).append('"').append(s).append(" t=\"inlineStr\"><is><t xml:space=\"preserve\">")
                    .append(xml(valeur == null ? "" : valeur.toString())).append("</t></is></c>");
        }
    }

    private static void ligne(StringBuilder sb, int numero, Object[] valeurs, int style) {
        sb.append("<row r=\"").append(numero).append("\">");
        for (int i = 0; i < valeurs.length; i++) cellule(sb, numero, i, valeurs[i], style);
        sb.append("</row>");
    }

    private static String feuille(Comparateur.Rapport rapport) {
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>")
                .append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">")
                .append("<cols>");
        for (int i = 0; i < LARGEURS.length; i++) {
            sb.append("<col min=\"").append(i + 1).append("\" max=\"").append(i + 1).append("\" width=\"").append(LARGEURS[i])
                    .append("\" customWidth=\"1\"/>");
        }
        sb.append("</cols><sheetData>");
        ligne(sb, 1, new Object[] {"Total attendu", rapport.totalAttendu, "Total trouvé", rapport.totalTrouve, "Anomalies",
            rapport.nbAnomalies}, STYLE_GRAS);
        ligne(sb, 3, ENTETES, STYLE_ENTETE);
        int n = 4;
        for (Comparateur.LigneRapport l : rapport.lignes) {
            ligne(sb, n++, new Object[] {l.commande, l.ligne, l.article, l.lancement, l.qteAttendue, l.qteTrouvee, l.ecart, l.statut},
                    styleStatut(l.statut));
        }
        sb.append("</sheetData></worksheet>");
        return sb.toString();
    }

    private static final String STYLES = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
            + "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
            + "<fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font>"
            + "<font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>"
            + "<fills count=\"5\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill>"
            + "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFC6EFCE\"/><bgColor indexed=\"64\"/></patternFill></fill>"
            + "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFFFC7CE\"/><bgColor indexed=\"64\"/></patternFill></fill>"
            + "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFFFEB9C\"/><bgColor indexed=\"64\"/></patternFill></fill>"
            + "</fills>"
            + "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>"
            + "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>"
            + "<cellXfs count=\"6\">"
            + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>"
            + "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>"
            + "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyAlignment=\"1\">"
            + "<alignment horizontal=\"center\"/></xf>"
            + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"2\" borderId=\"0\" xfId=\"0\" applyFill=\"1\"/>"
            + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"3\" borderId=\"0\" xfId=\"0\" applyFill=\"1\"/>"
            + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"4\" borderId=\"0\" xfId=\"0\" applyFill=\"1\"/>"
            + "</cellXfs>"
            + "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>"
            + "</styleSheet>";

    private static void entree(ZipOutputStream zip, String nom, String contenu) throws IOException {
        zip.putNextEntry(new ZipEntry(nom));
        zip.write(contenu.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    public static byte[] xlsx(Comparateur.Rapport rapport) throws IOException {
        ByteArrayOutputStream sortie = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(sortie)) {
            entree(zip, "[Content_Types].xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                    + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                    + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                    + "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>"
                    + "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
                    + "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>"
                    + "</Types>");
            entree(zip, "_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                    + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>"
                    + "</Relationships>");
            entree(zip, "xl/workbook.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
                    + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
                    + "<sheets><sheet name=\"Contrôle coupe\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
            entree(zip, "xl/_rels/workbook.xml.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                    + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>"
                    + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>"
                    + "</Relationships>");
            entree(zip, "xl/styles.xml", STYLES);
            entree(zip, "xl/worksheets/sheet1.xml", feuille(rapport));
        }
        return sortie.toByteArray();
    }
}
