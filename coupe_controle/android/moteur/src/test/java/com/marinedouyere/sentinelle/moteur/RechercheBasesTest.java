package com.marinedouyere.sentinelle.moteur;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;

public class RechercheBasesTest {

    /** Une case avec un fichier de lancement et un fichier Diakonos. */
    private static final class Fausse implements Recherche.Source {
        final List<LecteurStrat.LigneStrat> lignes = new ArrayList<>();
        final List<LecteurDiakonos.Piece> diakonos = new ArrayList<>();

        @Override
        public String nom() {
            return "Agglo 1er tour";
        }

        @Override
        public boolean aCoupe() {
            return false;
        }

        @Override
        public boolean aBkp() {
            return false;
        }

        @Override
        public boolean aStrat() {
            return !lignes.isEmpty();
        }

        @Override
        public boolean aDiakonos() {
            return !diakonos.isEmpty();
        }

        @Override
        public List<LecteurStrat.LigneStrat> lignesStrat() {
            return lignes;
        }

        @Override
        public List<LecteurDiakonos.Piece> piecesDiakonos() {
            return diakonos;
        }

        @Override
        public Recherche.Coupe coupe() {
            return null;
        }

        @Override
        public Recherche.DonneesBkp bkp() {
            return null;
        }
    }

    private static Fausse source() {
        Fausse s = new Fausse();
        for (String cle : new String[] {"CVC26100810001", "CVC26100810002"}) {
            LecteurStrat.LigneStrat l = new LecteurStrat.LigneStrat();
            l.cle = cle;
            l.commande = "CVC26100810";
            l.qteAttendue = 1;
            s.lignes.add(l);
        }
        LecteurDiakonos.Piece p = new LecteurDiakonos.Piece();
        p.cle = "CVC26100810003";
        p.commande = "CVC26100810";
        p.ligne = "3";
        p.article = "ILOT39801PVC";
        p.longueur = 2070.0;
        p.largeur = 1000.0;
        s.diakonos.add(p);
        return s;
    }

    private static HashSet<String> bases(String... b) {
        return new HashSet<>(Arrays.asList(b));
    }

    @Test
    public void leCvcEstFacultatif() {
        assertTrue(Recherche.correspond("CVC26100810001", "26100810001", true));
        assertTrue(Recherche.correspond("CVC26100810001", "26100810", false));
        assertTrue(Recherche.correspond("CVC26100810001", "CVC26100810", false));
        assertFalse(Recherche.correspond("CVC26100810001", "100810", false));
        Recherche.Resultat r = Recherche.rechercher("26100810001", Collections.singletonList(source()), bases(Recherche.BASE_LAN));
        assertEquals(1, r.trouvailles.size());
        assertEquals("CVC26100810001", r.trouvailles.get(0).cle);
        assertEquals(Recherche.BASE_LAN, r.trouvailles.get(0).base);
    }

    @Test
    public void seulementLesBasesChoisies() {
        Fausse s = source();
        Recherche.Resultat tout = Recherche.rechercher("26100810", Collections.singletonList(s), bases(Recherche.BASE_LAN, Recherche.BASE_DIAKONOS));
        assertEquals(3, tout.trouvailles.size());
        assertEquals("CVC26100810", tout.commandeUnique);
        Recherche.Resultat diakonos = Recherche.rechercher("26100810", Collections.singletonList(s), bases(Recherche.BASE_DIAKONOS));
        assertEquals(1, diakonos.trouvailles.size());
        assertEquals(Recherche.BASE_DIAKONOS, diakonos.trouvailles.get(0).base);
        assertEquals(2070.0, diakonos.trouvailles.get(0).champs.longueurFinie, 0);
        assertEquals("ILOT39801PVC", diakonos.trouvailles.get(0).champs.toutesDonnees.get("Article"));
        Recherche.Resultat liste = Recherche.rechercher("26100810", Collections.singletonList(s), bases(Recherche.BASE_LISTE));
        assertEquals(0, liste.nbSources);
    }
}
