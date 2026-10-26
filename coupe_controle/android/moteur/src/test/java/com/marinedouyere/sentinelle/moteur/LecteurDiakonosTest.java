package com.marinedouyere.sentinelle.moteur;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.text.Collator;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

public class LecteurDiakonosTest {

    @Test
    public void semaineEtTourDansLeNom() {
        LecteurDiakonos.Nom n = LecteurDiakonos.decoderNom("diakonos46t1.xlsx");
        assertEquals("46", n.semaine);
        assertEquals("1", n.tour);
        n = LecteurDiakonos.decoderNom("Diakonos S47 T2.xlsx");
        assertEquals("47", n.semaine);
        assertEquals("2", n.tour);
        n = LecteurDiakonos.decoderNom("DIAKONOS_2646_tour_2.xlsx");
        assertEquals("46", n.semaine);
        assertEquals("2", n.tour);
        n = LecteurDiakonos.decoderNom("Controle_Diakonos.xlsx");
        assertNull(n.semaine);
        assertNull(n.tour);
        assertNull(LecteurDiakonos.decoderNom("LAN264601STRAT.xlsx"));
    }

    @Test
    public void semaineEtTourDuLancement() {
        assertArrayEquals(new String[] {"46", "1"}, LecteurDiakonos.semaineEtTour("LAN264601"));
        assertArrayEquals(new String[] {"46", "2"}, LecteurDiakonos.semaineEtTour("264602"));
        assertArrayEquals(new String[] {"44", null}, LecteurDiakonos.semaineEtTour("LAN2644TRIGANO"));
        assertNull(LecteurDiakonos.semaineEtTour("LAN26CLAUSTRA"));
    }

    @Test
    public void leScanPrendLeLancementCorrige() {
        List<ScanDossier.Fichier> fichiers = new ArrayList<>();
        fichiers.add(new ScanDossier.Fichier("LAN264601START.xlsx", 1000, null));
        fichiers.add(new ScanDossier.Fichier("LAN264601START_corrige.xlsx", 2000, null));
        Collator c = Collator.getInstance(Locale.ROOT);
        ScanDossier.Resultat r = ScanDossier.scanner(fichiers, ScanDossier.PAIRE, c::compare);
        assertEquals(1, r.fixes.size());
        assertEquals("LAN264601START_corrige.xlsx", r.fixes.get(0).strat.nom);
        assertTrue(r.chantiers.isEmpty());
    }

    @Test
    public void leScanRangeLeDiakonosDansSonTour() {
        List<ScanDossier.Fichier> fichiers = new ArrayList<>();
        for (String nom : Arrays.asList("LAN264601STRAT.xlsx", "diakonos46t1.xlsx", "diakonos46t2.xlsx", "diakonos47t1.xlsx",
                "Controle_Diakonos.xlsx")) {
            fichiers.add(new ScanDossier.Fichier(nom, 1000, null));
        }
        Collator c = Collator.getInstance(Locale.ROOT);
        ScanDossier.Resultat r = ScanDossier.scanner(fichiers, ScanDossier.PAIRE, c::compare);
        assertEquals(2, r.diakonos.size());
        assertEquals("1", r.diakonos.get(0).tour);
        assertEquals("diakonos46t1.xlsx", r.diakonos.get(0).fichier.nom);
        assertEquals("2", r.diakonos.get(1).tour);
        assertEquals(1, r.fixes.size());
        assertTrue(r.nonReconnus.contains("Controle_Diakonos.xlsx"));
        assertEquals(1, r.ignoresAutreSemaine);
    }
}
