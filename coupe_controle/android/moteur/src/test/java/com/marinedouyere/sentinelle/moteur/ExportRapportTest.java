package com.marinedouyere.sentinelle.moteur;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

import java.io.File;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class ExportRapportTest {

    @Test
    public void rapportRelisibleCommeUnVraiFichierExcel() throws Exception {
        LecteurStrat.LigneStrat a = new LecteurStrat.LigneStrat();
        a.cle = "CVC26090247001";
        a.commande = "CVC26090247";
        a.ligne = "1";
        a.article = "TPPVC <38> & \"chant\"";
        a.lancement = "LAN264101STRAT";
        a.qteAttendue = 4;
        LecteurStrat.LigneStrat b = new LecteurStrat.LigneStrat();
        b.cle = "CVC26090248002";
        b.commande = "CVC26090248";
        b.ligne = "2";
        b.article = "CRÉDENCE";
        b.lancement = "LAN264101STRAT";
        b.qteAttendue = 1;
        Map<String, Double> trouve = new LinkedHashMap<>();
        trouve.put("CVC26090247001", 2.0);
        trouve.put("CVC26090248002", 1.0);
        trouve.put("CVC26090999003", 1.5);
        Comparateur.Rapport r = Comparateur.comparer(java.util.Arrays.asList(a, b), trouve);

        byte[] xlsx = ExportRapport.xlsx(r);
        String sortie = System.getProperty("sentinelle.captures", "");
        if (!sortie.isEmpty()) Files.write(new File(sortie, "export_test.xlsx").toPath(), xlsx);

        Classeur c = Classeur.lire(xlsx);
        assertEquals("Contrôle coupe", c.feuilles.get(0).nom);
        Feuille f = c.feuilles.get(0);
        assertEquals("Total attendu", f.valeur(1, 1));
        assertEquals(5.0, f.valeur(1, 2));
        assertEquals("Anomalies", f.valeur(1, 5));
        assertEquals((double) r.nbAnomalies, f.valeur(1, 6));
        assertNull(f.valeur(2, 1));
        assertEquals("Qté trouvée (coupe)", f.valeur(3, 6));
        List<Comparateur.LigneRapport> lignes = r.lignes;
        for (int i = 0; i < lignes.size(); i++) {
            assertEquals(lignes.get(i).commande, f.valeur(4 + i, 1));
            assertEquals(lignes.get(i).article, f.valeur(4 + i, 3));
            assertEquals(lignes.get(i).qteTrouvee, f.valeur(4 + i, 6));
            assertEquals(lignes.get(i).statut, f.valeur(4 + i, 8));
        }
        assertEquals("rapport_controle_coupe_agglo_2eme_tour_semaine_paire.xlsx",
                ExportRapport.nomFichier("Agglo 2ème tour — Semaine paire"));
    }
}
