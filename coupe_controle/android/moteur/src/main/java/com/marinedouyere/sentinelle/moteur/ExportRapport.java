package com.marinedouyere.sentinelle.moteur;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
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

    // Styles (index dans cellXfs) : 0 normal, 1 gras, 2 gras centré, 3 vert, 4 rouge, 5 jaune,
    // 6 en-tête (gras sur fond bleu), 7 total (gras sur fond gris), 8 titre d'alerte (gras rouge), 9 grand titre.
    private static final int STYLE_GRAS = 1;
    private static final int STYLE_ENTETE = 2;
    public static final int NORMAL = 0;
    public static final int VERT = 3;
    public static final int ROUGE = 4;
    public static final int JAUNE = 5;
    public static final int ENTETE = 6;
    public static final int TOTAL = 7;
    public static final int TITRE_ALERTE = 8;
    public static final int TITRE = 9;

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
            + "<fonts count=\"4\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font>"
            + "<font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font>"
            + "<font><b/><sz val=\"11\"/><color rgb=\"FFC62828\"/><name val=\"Calibri\"/></font>"
            + "<font><b/><sz val=\"14\"/><name val=\"Calibri\"/></font></fonts>"
            + "<fills count=\"7\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill>"
            + "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFC6EFCE\"/><bgColor indexed=\"64\"/></patternFill></fill>"
            + "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFFFC7CE\"/><bgColor indexed=\"64\"/></patternFill></fill>"
            + "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFFFEB9C\"/><bgColor indexed=\"64\"/></patternFill></fill>"
            + "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFE3F2FD\"/><bgColor indexed=\"64\"/></patternFill></fill>"
            + "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFECEFF1\"/><bgColor indexed=\"64\"/></patternFill></fill>"
            + "</fills>"
            + "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>"
            + "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>"
            + "<cellXfs count=\"10\">"
            + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>"
            + "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>"
            + "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyAlignment=\"1\">"
            + "<alignment horizontal=\"center\"/></xf>"
            + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"2\" borderId=\"0\" xfId=\"0\" applyFill=\"1\"/>"
            + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"3\" borderId=\"0\" xfId=\"0\" applyFill=\"1\"/>"
            + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"4\" borderId=\"0\" xfId=\"0\" applyFill=\"1\"/>"
            + "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"5\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\"/>"
            + "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"6\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\"/>"
            + "<xf numFmtId=\"0\" fontId=\"2\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>"
            + "<xf numFmtId=\"0\" fontId=\"3\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>"
            + "</cellXfs>"
            + "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>"
            + "</styleSheet>";

    private static void entree(ZipOutputStream zip, String nom, String contenu) throws IOException {
        zip.putNextEntry(new ZipEntry(nom));
        zip.write(contenu.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    /** Une feuille d'un classeur : lignes de valeurs (texte ou nombre), chacune avec un style. */
    public static final class Feuille {
        public final String nom;
        public final int[] largeurs;
        final List<Object[]> lignes = new ArrayList<>();
        final List<Integer> styles = new ArrayList<>();

        public Feuille(String nom, int... largeurs) {
            this.nom = nom;
            this.largeurs = largeurs;
        }

        public void ligne(int style, Object... valeurs) {
            lignes.add(valeurs);
            styles.add(style);
        }

        public void vide() {
            ligne(NORMAL);
        }

        String xmlFeuille() {
            StringBuilder sb = new StringBuilder();
            sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>")
                    .append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><cols>");
            for (int i = 0; i < largeurs.length; i++) {
                sb.append("<col min=\"").append(i + 1).append("\" max=\"").append(i + 1).append("\" width=\"").append(largeurs[i])
                        .append("\" customWidth=\"1\"/>");
            }
            sb.append("</cols><sheetData>");
            for (int i = 0; i < lignes.size(); i++) ExportRapport.ligne(sb, i + 1, lignes.get(i), styles.get(i));
            sb.append("</sheetData></worksheet>");
            return sb.toString();
        }
    }

    /** Classeur de plusieurs feuilles. */
    public static byte[] classeur(List<Feuille> feuilles) throws IOException {
        ByteArrayOutputStream sortie = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(sortie)) {
            StringBuilder types = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                    + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                    + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                    + "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>"
                    + "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>");
            StringBuilder sheets = new StringBuilder();
            StringBuilder rels = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
            for (int i = 1; i <= feuilles.size(); i++) {
                types.append("<Override PartName=\"/xl/worksheets/sheet").append(i)
                        .append(".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>");
                String nom = feuilles.get(i - 1).nom.replaceAll("[\\\\/?*\\[\\]:]", " ");
                sheets.append("<sheet name=\"").append(xml(nom.length() > 31 ? nom.substring(0, 31) : nom)).append("\" sheetId=\"").append(i)
                        .append("\" r:id=\"rId").append(i).append("\"/>");
                rels.append("<Relationship Id=\"rId").append(i)
                        .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet")
                        .append(i).append(".xml\"/>");
            }
            rels.append("<Relationship Id=\"rId").append(feuilles.size() + 1)
                    .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>")
                    .append("</Relationships>");
            types.append("</Types>");
            entree(zip, "[Content_Types].xml", types.toString());
            entree(zip, "_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                    + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>"
                    + "</Relationships>");
            entree(zip, "xl/workbook.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
                    + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>" + sheets + "</sheets></workbook>");
            entree(zip, "xl/_rels/workbook.xml.rels", rels.toString());
            entree(zip, "xl/styles.xml", STYLES);
            for (int i = 1; i <= feuilles.size(); i++) entree(zip, "xl/worksheets/sheet" + i + ".xml", feuilles.get(i - 1).xmlFeuille());
        }
        return sortie.toByteArray();
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
