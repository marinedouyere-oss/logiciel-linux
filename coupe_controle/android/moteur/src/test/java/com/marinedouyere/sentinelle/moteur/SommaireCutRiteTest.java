package com.marinedouyere.sentinelle.moteur;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

public class SommaireCutRiteTest {

    private static int somme(List<SommaireCutRite.Materiau> l, boolean panneaux) {
        int t = 0;
        for (SommaireCutRite.Materiau m : l) t += panneaux ? m.panneaux : m.restes;
        return t;
    }

    @Test
    public void lignesDeuxPresentations() throws Exception {
        // PDFBox : « Paramètres » mêlé au code, quantités seules ; pdftotext : code + STRAT + quantités.
        SommaireCutRite s = SommaireCutRite.lire(Arrays.asList(
                "LAISNE Cut Rite Modulaire V12.00.4 Lundi 26 Octobre 2026 09:03",
                "Sommaire des matériaux... LAN264601START-Code m...",
                "Code matériau Panneaux Restes", "Qté Qté",
                "1047 STRAT H1180 ST37 CHÊNE HALIFAX NATUREL 4100*2060*0 Epaisseur 0.8 Pqt. 75 ...",
                "P10a4ra7mètres STRAT", "0 6",
                "1065 STRAT H1344 ST32 CHÊNE SHERMAN COGNAC FORMAT 4100* Epaisseur 0.1 Pqt. 60...",
                "1065 STRAT 2 0",
                "1136-PF STRAT H1385 ST40 CHENE CASELLA NATUREL 2790*2060 Epaisseur 0.8 Pqt. 75",
                "1136-PF 6 2",
                "RCB STRAT CONTREBALANCEMENT 0003 OSL BLANC 4200*1600*0 Epaisseur 0.8 Pqt. 75 ...", "9 2",
                "B125-FA STRAT FENIX BLU FA 4200*1300 Epaisseur 0.8 Pqt. 75", "B125-FA 1 0",
                "SAG38HYBLLINEX AGGLO 38MM HYDRO UNE FACE MELAMINE BLANC GIVRE 8 Epaisseu...",
                "38.0 Pqt. 1", "SAG38HYBLLINEX 12 2",
                "PROTECTION Martyr Epaisseur 19.0 Pqt. 3", "PROTECTION 1 0",
                "1", "31 12"));
        assertEquals("LAN264601START", s.lancement);
        assertEquals("26 Octobre 2026 09:03", s.date);
        assertEquals(7, s.materiaux.size());
        assertEquals(2, s.agglo().size());
        assertEquals(13, somme(s.agglo(), true));
        assertEquals(5, s.strats().size());
        assertEquals(3, s.couleursFeuille().size());
        assertEquals("1065", s.couleursFeuille().get(0).code);
        assertEquals("4100 × 2060", s.couleursFeuille().get(0).format());
        assertEquals("H1180 ST37 CHÊNE HALIFAX NATUREL 4100*2060*0", s.couleursFeuille().get(1).designation());
        assertEquals(1, s.horsGamme().size());
        assertEquals("B125-FA", s.horsGamme().get(0).code);
        assertEquals("LAN264601", RapportsSommaire.base(s));
    }

    @Test(expected = ErreurLecture.class)
    public void totalFaux() throws Exception {
        SommaireCutRite.lire(Arrays.asList("1047 STRAT H1180 Epaisseur 0.8 Pqt. 75", "0 6", "1 6"));
    }

    @Test
    public void couleurDeLaSemaine() {
        assertEquals("ROSE", SommaireCutRite.couleurSemaine(46, false));
        assertEquals("BLEU", SommaireCutRite.couleurSemaine(47, false));
        assertEquals("BLANC", SommaireCutRite.couleurSemaine(48, false));
        assertEquals("ROSE", SommaireCutRite.couleurSemaine(49, false));
        assertEquals("JAUNE", SommaireCutRite.couleurSemaine(46, true));
    }

    @Test
    public void vraiSommaire() throws Exception {
        String chemin = System.getenv("SENTINELLE_SOMMAIRE");
        if (chemin == null || chemin.isEmpty()) return;
        byte[] octets = Files.readAllBytes(new File(chemin).toPath());
        SommaireCutRite s = SommaireCutRite.lire(LecteurCoupePdf.lignesTexte(new ExtracteurPdfBox().elementsParPage(octets)));
        assertEquals(142, s.totalPanneaux);
        assertEquals(61, s.totalRestes);
        assertEquals(44, somme(s.agglo(), true));
        assertEquals(10, somme(s.agglo(), false));
        assertEquals(98, somme(s.strats(), true));
        assertEquals(8, s.couleursFeuille().size());
        assertEquals(15, somme(s.couleursFeuille(), true));
        assertEquals(10, somme(s.couleursFeuille(), false));
        assertEquals(Arrays.asList("1062", "1048", "1065-PF", "1062-PF", "1048-PF"), s.couleursAbsentes());
        assertTrue(s.horsGamme().isEmpty());
        Map<String, byte[]> pdf = RapportsSommaire.creer(s, "340", "ROSE");
        assertEquals(Arrays.asList("LAN264601_Agglo.pdf", "LAN264601_Strats.pdf", "LAN264601_Couleurs.pdf"), new java.util.ArrayList<>(pdf.keySet()));
        // Relu par PDFBox : le PDF est valide et contient les infos.
        List<String> relu = LecteurCoupePdf.lignesTexte(new ExtracteurPdfBox().elementsParPage(pdf.get("LAN264601_Couleurs.pdf")));
        String tout = String.join("\n", relu);
        String captures = System.getenv("SENTINELLE_CAPTURES");
        if (captures != null && !captures.isEmpty()) {
            for (Map.Entry<String, byte[]> e : pdf.entrySet()) Files.write(new File(captures, "java_" + e.getKey()).toPath(), e.getValue());
        }
        // Chiffres clés de la charte : valeur, puis sa légende.
        assertTrue(tout, tout.contains("340") && tout.contains("Nombre de pièces"));
        assertTrue(tout, tout.contains("ROSE") && tout.contains("Couleurs semaine"));
        assertTrue(tout, tout.contains("Semaine") && tout.contains("46"));
        assertTrue(tout, tout.contains("1136-PF"));
        assertTrue(tout, tout.contains("Document interne — LAISNÉ INDUSTRIE") && tout.contains("1 / 1"));
    }
}
