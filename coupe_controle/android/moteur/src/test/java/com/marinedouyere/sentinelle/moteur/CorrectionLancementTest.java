package com.marinedouyere.sentinelle.moteur;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.TreeSet;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public class CorrectionLancementTest {

    private static String ligne(int r, String... valeurs) {
        StringBuilder sb = new StringBuilder("<row r=\"" + r + "\" spans=\"1:6\">");
        for (int i = 0; i < valeurs.length; i++) {
            String ref = (char) ('A' + i) + String.valueOf(r);
            String v = valeurs[i];
            if (v.startsWith("=")) sb.append("<c r=\"").append(ref).append("\"><f>").append(v.substring(1)).append("</f><v>0</v></c>");
            else if (v.matches("\\d+")) sb.append("<c r=\"").append(ref).append("\"><v>").append(v).append("</v></c>");
            else sb.append("<c r=\"").append(ref).append("\" t=\"inlineStr\"><is><t>").append(v).append("</t></is></c>");
        }
        return sb.append("</row>").toString();
    }

    /** Petit lancement : la ligne 3 est en double de la 2, la ligne 5 en double de la 4 ; la protection n'est pas un doublon. */
    private static byte[] lancement() throws Exception {
        String feuille = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                + "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
                + "<dimension ref=\"A1:F8\"/><sheetViews><sheetView workbookViewId=\"0\"><selection activeCell=\"F8\" sqref=\"F8\"/></sheetView></sheetViews>"
                + "<sheetData>"
                + ligne(1, "conf_commande", "conf_ligne", "conf_article", "comdet_qte", "agglo", "calcul")
                + ligne(2, "CVC26100810", "1", "TPPVC39551", "1", "SAG38HYBL", "=D2+50")
                + ligne(3, "CVC26100810", "1", "TPPVC39551", "1", "SAG38HYBL", "=D3+50")
                + ligne(4, "CVC26100810", "2", "TPPVC39551", "2", "SAG38HYBL", "=D4+50")
                + ligne(5, "CVC26100810", "2", "TPPVC39551", "2", "SAG38HYBL", "=D5+50")
                + ligne(6, "CVC26100810", "3", "PROT", "1", "PROTECTION", "=SUM(D2:D6)")
                + ligne(7, "CVC26100810", "3", "PROT", "1", "PROTECTION", "=D7+50")
                + ligne(8, "CVC26100810", "4", "ILOT39801PVC", "1", "SAG38HYBL", "=D8+50")
                + "</sheetData><autoFilter ref=\"A1:F8\"/></worksheet>";
        String[][] parties = {
            {"[Content_Types].xml", "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                + "<Override PartName=\"/xl/calcChain.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml\"/></Types>"},
            {"xl/workbook.xml", "<?xml version=\"1.0\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
                + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"LAN264601\" sheetId=\"1\" r:id=\"rId1\"/></sheets>"
                + "<definedNames><definedName name=\"_xlnm._FilterDatabase\" localSheetId=\"0\" hidden=\"1\">LAN264601!$A$1:$F$8</definedName></definedNames></workbook>"},
            {"xl/_rels/workbook.xml.rels", "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>"
                + "<Relationship Id=\"rId9\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain\" Target=\"calcChain.xml\"/></Relationships>"},
            {"xl/worksheets/sheet1.xml", feuille},
            {"xl/calcChain.xml", "<?xml version=\"1.0\"?><calcChain xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><c r=\"F2\" i=\"1\"/></calcChain>"},
        };
        ByteArrayOutputStream sortie = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(sortie)) {
            for (String[] p : parties) {
                zip.putNextEntry(new ZipEntry(p[0]));
                zip.write(p[1].getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
            }
        }
        return sortie.toByteArray();
    }

    @Test
    public void lesDoublonsPartentDansUnNouveauFichier() throws Exception {
        byte[] original = lancement();
        Classeur avant = Classeur.lire(original);
        CorrectionLancement.Doublons d = CorrectionLancement.doublons(avant);
        assertEquals(new TreeSet<>(Arrays.asList(3, 5)), d.lignes);
        assertEquals(Arrays.asList("CVC26100810001", "CVC26100810002"), d.cles);
        assertEquals(2, LecteurStrat.lire(avant).doublons.size());

        byte[] corrige = CorrectionLancement.sansDoublons(original, d);
        Classeur apres = Classeur.lire(corrige);
        Feuille f = apres.feuilles.get(0);
        assertEquals(6, f.nbLignes());
        assertEquals(0, LecteurStrat.lire(apres).doublons.size());
        assertEquals("ILOT39801PVC", f.valeur(6, 3));
        assertEquals(3, LecteurStrat.lire(apres).lignes.size()); // 001, 002, 004 (protections à part)
        StringBuilder tout = new StringBuilder();
        try (java.util.zip.ZipInputStream zip = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(corrige))) {
            for (ZipEntry e = zip.getNextEntry(); e != null; e = zip.getNextEntry()) {
                tout.append(e.getName()).append('\n');
                ByteArrayOutputStream b = new ByteArrayOutputStream();
                byte[] bloc = new byte[4096];
                for (int n = zip.read(bloc); n != -1; n = zip.read(bloc)) b.write(bloc, 0, n);
                tout.append(new String(b.toByteArray(), StandardCharsets.UTF_8)).append('\n');
            }
        }
        String xml = tout.toString();
        assertTrue(xml, xml.contains("<f>D3+50</f>") && xml.contains("<f>SUM(D2:D4)</f>") && xml.contains("<f>D6+50</f>"));
        assertTrue(xml.contains("<dimension ref=\"A1:F6\"/>") && xml.contains("<autoFilter ref=\"A1:F6\"/>"));
        assertTrue(xml.contains("LAN264601!$A$1:$F$6"));
        assertTrue(xml.contains("activeCell=\"F6\""));
        assertTrue(!xml.contains("calcChain"));
        assertEquals("LAN264601START_corrige.xlsx", CorrectionLancement.nomCorrige("LAN264601START.xlsx"));
        assertEquals("LAN264601START_corrige.xlsx", CorrectionLancement.nomCorrige("LAN264601START_corrige.xlsx"));
    }

    @Test
    public void decalageDesReferences() {
        TreeSet<Integer> s = new TreeSet<>(Arrays.asList(3, 5));
        assertEquals(2, CorrectionLancement.decaler(2, s));
        assertEquals(2, CorrectionLancement.decaler(3, s));
        assertEquals(3, CorrectionLancement.decaler(4, s));
        assertEquals(4, CorrectionLancement.decaler(6, s));
        assertEquals("$A$1:AK8", CorrectionLancement.decalerReferences("$A$1:AK10", s));
        assertEquals("LOG10(E4)+A1", CorrectionLancement.decalerReferences("LOG10(E6)+A1", s));
    }

    /** Vrai lancement (avec formules) : suppression de deux lignes, tout le reste intact. */
    @Test
    public void vraiFichier() throws Exception {
        String dossier = System.getenv("SENTINELLE_SEMAINE45");
        if (dossier == null || dossier.isEmpty()) return;
        byte[] original = Files.readAllBytes(new File(dossier, "LAN264501FENO.xlsx").toPath());
        Classeur avant = Classeur.lire(original);
        Feuille fa = avant.feuilles.get(0);
        byte[] corrige = CorrectionLancement.supprimerLignes(original, fa.nom, new TreeSet<>(Arrays.asList(3, 10)));
        Feuille fb = Classeur.lire(corrige).feuilles.get(0);
        assertEquals(fa.nbLignes() - 2, fb.nbLignes());
        for (int r = 1; r <= fa.nbLignes(); r++) {
            if (r == 3 || r == 10) continue;
            int n = r < 3 ? r : r < 10 ? r - 1 : r - 2;
            assertEquals("ligne " + r, fa.cellulesDeLaLigne(r), fb.cellulesDeLaLigne(n));
        }
        String captures = System.getenv("SENTINELLE_CAPTURES");
        if (captures != null && !captures.isEmpty()) Files.write(new File(captures, "LAN264501FENO_sans_lignes_3_10.xlsx").toPath(), corrige);
    }
}
