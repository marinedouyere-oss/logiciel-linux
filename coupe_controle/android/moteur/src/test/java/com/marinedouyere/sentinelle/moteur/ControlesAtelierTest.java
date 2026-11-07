package com.marinedouyere.sentinelle.moteur;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.text.Collator;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Cas rencontrés sur les vrais dossiers de l'atelier (semaines 44 et 45) :
 * noms de .bkp, PDF qui ne sont pas des listes de coupe, protections,
 * pièces assemblées, couleurs absentes du .bkp, pièces lancées deux fois.
 */
public class ControlesAtelierTest {

    // ---- scan du dossier partagé ----

    private static ScanDossier.Resultat scanner(String parite, String... noms) {
        List<ScanDossier.Fichier> fichiers = new ArrayList<>();
        for (String n : noms) fichiers.add(new ScanDossier.Fichier(n, 1000, null));
        Collator c = Collator.getInstance(Locale.FRENCH);
        return ScanDossier.scanner(fichiers, parite, c::compare);
    }

    private static ScanDossier.Cible cible(ScanDossier.Resultat r, String poste) {
        for (ScanDossier.Cible g : r.fixes) if (g.poste.equals(poste)) return g;
        return null;
    }

    private static ScanDossier.Cible chantier(ScanDossier.Resultat r, String identite) {
        for (ScanDossier.Cible g : r.chantiers) if (g.identiteChantier().equals(identite)) return g;
        return null;
    }

    private static String nom(ScanDossier.Fichier f) {
        return f == null ? null : f.nom;
    }

    @Test
    public void scanSemaine44() {
        ScanDossier.Resultat r = scanner("paire", "Classeur3.xlsx", "LAN264301CASSE.xlsx", "LAN264301CASSEANALYSE.xlsx",
                "LAN264301CASSEbackup.bkp", "LAN264301COMMANDE TARDIVE.xlsx", "LAN264401FENO bbackup.bkp", "LAN264401FENO.xlsx",
                "LAN264401STRAT.xlsx", "LAN264401STRATRECYCLAGE.xlsx", "LAN264401STRATbackup.bkp", "LAN264402STRAT.pdf",
                "LAN264402STRAT.xlsx", "LAN264402STRATbackup.bkp", "LAN2644TRIGANO.xlsx", "LAN2644TRIGANObis backup.bkp",
                "LAN2644TRIGANObis.xlsx", "LISTE DE COUPE LAN264401STRAT.pdf", "LISTE DE COUPE LAN264402STRAT.pdf", "S.44.xlsx",
                "rapport_lancements semaine 44.xlsx");
        ScanDossier.Cible agglo1 = cible(r, "Agglo 1er tour");
        assertEquals("LAN264401STRAT.xlsx", nom(agglo1.strat));
        assertEquals("LISTE DE COUPE LAN264401STRAT.pdf", nom(agglo1.coupe));
        assertEquals("LAN264401STRATbackup.bkp", nom(agglo1.bkp));
        ScanDossier.Cible agglo2 = cible(r, "Agglo 2ème tour");
        assertEquals("LISTE DE COUPE LAN264402STRAT.pdf", nom(agglo2.coupe));
        assertEquals("LAN264402STRATbackup.bkp", nom(agglo2.bkp));
        assertEquals("LAN264401FENO bbackup.bkp", nom(cible(r, "Feno").bkp));
        assertEquals("LAN2644TRIGANObis backup.bkp", nom(chantier(r, "2644|TRIGANOBIS").bkp));
        assertNull(chantier(r, "264401|STRATRECYCLAGE").bkp);
        // Le récapitulatif PDF des couleurs n'est pas une liste de coupe.
        assertTrue(r.nonReconnus.contains("LAN264402STRAT.pdf"));

        // La casse porte le numéro de la semaine précédente : LAN264301CASSE va avec la semaine 44.
        assertEquals("LAN264301CASSE.xlsx", nom(cible(r, "Casse").strat));
        assertEquals("LAN264301CASSEbackup.bkp", nom(cible(r, "Casse").bkp));
        ScanDossier.Resultat impaire = scanner("impaire", "LAN264301CASSE.xlsx", "LAN264301CASSEANALYSE.xlsx",
                "LAN264301CASSEbackup.bkp");
        assertNull(cible(impaire, "Casse"));
        assertNull(chantier(impaire, "264301|CASSEANALYSE").bkp);
    }

    @Test
    public void scanSemaine45() {
        ScanDossier.Resultat r = scanner("impaire", "FOURNITURE CHANT.xlsx", "LAN2644CASSE backup.bkp", "LAN2644CASSE.xlsx",
                "LAN264501FENO backup.bkp", "LAN264501FENO.xlsx",
                "LAN264501STRAT v12backup.bkp", "LAN264501STRAT.pdf", "LAN264501STRAT.xlsx", "LAN264502STRA backup.bkp",
                "LAN264502STRAT.xlsx", "LAN2645RECYCLAGE backup.bkp", "LAN2645RECYCLAGE.xlsx", "~$LAN264501FENO.xlsx",
                "LAN264501STRAT.xlsx.bak");
        assertEquals("LAN264501STRAT v12backup.bkp", nom(cible(r, "Agglo 1er tour").bkp));
        assertNull("un PDF sans « coupe » dans le nom n'est pas une liste de coupe", cible(r, "Agglo 1er tour").coupe);
        assertEquals("LAN264501STRAT.xlsx", nom(cible(r, "Agglo 1er tour").strat));
        // Faute de frappe « STRA » : rattaché quand même au 2e tour.
        assertEquals("LAN264502STRA backup.bkp", nom(cible(r, "Agglo 2ème tour").bkp));
        assertEquals("LAN264501FENO backup.bkp", nom(cible(r, "Feno").bkp));
        assertEquals("LAN2645RECYCLAGE backup.bkp", nom(chantier(r, "2645|RECYCLAGE").bkp));
        assertEquals("LAN2644CASSE backup.bkp", nom(cible(r, "Casse").bkp));
        assertEquals("impaire", ScanDossier.pariteCasse("2644"));
        assertEquals("paire", ScanDossier.pariteCasse("264301"));
        assertTrue(r.nonReconnus.containsAll(Arrays.asList("LAN264501STRAT.pdf", "~$LAN264501FENO.xlsx", "LAN264501STRAT.xlsx.bak")));
    }

    @Test
    public void unNomExactLEmporteSurUnNomApprochant() {
        ScanDossier.Resultat r = scanner("paire", "LAN264003FENO.xlsx", "LAN264003FENOG-F.xlsx", "CUTRITE_LAN264003FENOG-F.xlsx",
                "CUTRITE_LAN264003FENO.xlsx", "LAN264001STRAT.xlsx", "CUTRITE_LAN264001STRAT.xlsx", "LAN264001START coupe.pdf");
        assertEquals("CUTRITE_LAN264003FENO.xlsx", nom(cible(r, "Feno").coupe));
        assertEquals("CUTRITE_LAN264003FENOG-F.xlsx", nom(chantier(r, "264003|FENOG-F").coupe));
        assertEquals("CUTRITE_LAN264001STRAT.xlsx", nom(cible(r, "Agglo 1er tour").coupe));
        assertEquals("STRAT", ScanDossier.suffixeSansSauvegarde("STRATBACKUP"));
        assertEquals("CASSE", ScanDossier.suffixeSansSauvegarde("CASSEV12BACKUP"));
    }

    // ---- .bkp : protections et couleurs ----

    private static final String CTT = String.join("\n",
            "VER,LAISNE V12.00.4S-04,1.00",
            "PNL1,COMCNPVC29,FENO8-PF,2600.00,680.00,1,0,0,0,0000,0,0,1",
            "PNL2,LAN264403,CVC1,1,COMCNPVC29,CVC1001,29,,,FENO8-PF,,,,,,,1133,RCB",
            "PNL3,P89:TC:NLAN_FENO8-PF,0,,0,0,0,\",59,\"",
            "PNL1,L0089,1133,2610.00,690.00,1,0,0,1,0000,0,0,2",
            "PNL2,LAN264403,CVC1,1,COMCNPVC29,CVC1001,29,,,FENO8-PF,,,,,,,1133,RCB",
            "PNL3,P89:TF:NLAN_1133,0,,0,0,0,\",59,\"",
            "PNL1,L0089,RCB,2610.00,690.00,1,0,0,1,0000,0,0,3",
            "PNL2,LAN264403,CVC1,1,COMCNPVC29,CVC1001,29,,,FENO8-PF,,,,,,,1133,RCB",
            "PNL3,P89:TB:NLAN_RCB,0,,0,0,0,\",59,\"",
            "PNL1,COMCNPVC29,SMELBLALIS19,2605.00,675.00,1,0,0,0,0000,0,0,4",
            "PNL2,LAN264403,CVC1,1,COMCNPVC29,CVC1001,29,,,SMELBLALIS19",
            "PNL3,P96:TC:NLAN_SMELBLALIS19,0,,0,0,0,\",59,\"",
            "PNL1,COMCNPVC29,PROTECTION,2560.00,650.00,1,0,0,0,0000,0,0,5",
            "PNL2,LAN264403,CVC1,1,COMCNPVC29,CVC1001,29,,,PROTECTION",
            "PNL3,P90:TC:NLAN_PROTECTION,0,,0,0,0,\",59,\"",
            "PNL1,TPPVC21000,PROTECTION-PF,650.00,300.00,1,0,0,0,0000,0,0,6",
            "PNL2,LAN264506,CVC2,1,TPPVC21000,CVC2001,21,,,PROTECTION",
            "PNL3,P7:TC:NLAN_PROTECTION-PF,0,,0,0,0,\",59,\"",
            "PNL1,TPPVC21000,SAG19HYBR,660.00,310.00,1,0,0,0,0000,0,0,7",
            "PNL2,LAN264506,CVC2,1,TPPVC21000,CVC2001,21,,,SAG19HYBR,,,,,,,1047,1047",
            "PNL3,P42:TC:NLAN_SAG19HYBR,0,,0,0,0,\",59,\"");

    @Test
    public void protectionsHorsDuControleEtCouleursDuBkp() {
        Map<String, Double> tout = LecteurBkp.quantitesCtt(CTT);
        assertEquals(3.0, tout.get("CVC1001"), 0); // compact + support + protection
        assertEquals(2.0, tout.get("CVC2001"), 0); // pièce + protection « PROTECTION-PF »
        Map<String, Double> sansProtections = LecteurBkp.quantitesCtt(CTT, true);
        assertEquals(2.0, sansProtections.get("CVC1001"), 0);
        assertEquals(1.0, sansProtections.get("CVC2001"), 0);

        LecteurBkp.Couleurs c = LecteurBkp.couleursCtt(CTT);
        assertEquals(Collections.singleton("1133"), c.dessus.keySet());
        assertEquals(Collections.singleton("RCB"), c.dessous.keySet());
        assertFalse(c.sansStratifie());
        assertTrue(LecteurBkp.couleursCtt("PNL1,X,SAG12HYBR,1,1,1\nPNL3,P1:TC:N\n").sansStratifie());
        assertTrue(LecteurStrat.estProtection("PROTECTION-PF"));
        assertTrue(LecteurStrat.estProtection(" protection "));
        assertFalse(LecteurStrat.estProtection("SAG19HYBR"));
    }

    // ---- fichier de lancement : pièces assemblées, couleurs ----

    private static final Object[] ENTETES = {"conf_commande", "conf_ligne", "conf_article", "coloris", "agglo", "coloris_inf",
        "comdet_qte", "com_livsem", "com_livan", "comprod_lancement", "commande+ligne"};

    private static Object[] ligne(String commande, int ligne, String article, Object coloris, String agglo, Object colorisInf, int qte) {
        return new Object[] {commande, ligne, article, coloris, agglo, colorisInf, qte, 44, 2026, "LAN264403",
            commande + String.format(Locale.ROOT, "%03d", ligne)};
    }

    private static LecteurStrat.Resultat lancement() throws Exception {
        return LecteurStrat.lire(Classeur.lire(ClasseurDeTest.xlsx(new Object[][] {
            ENTETES,
            // Feno : compact décor + support collés = une seule pièce, plus sa protection.
            ligne("CVC1", 1, "COMCNPVC29", 1133, "FENO8-PF", "RCB", 1),
            ligne("CVC1", 1, "COMCNPVC29", null, "PROTECTION", null, 1),
            ligne("CVC1", 1, "COMCNPVC29", null, "SMELBLALIS19", null, 1),
            // Pièce simple, deux exemplaires, couleur absente du .bkp.
            ligne("CVC3", 2, "CRED21", "B125-FA", "SAG19HYBR", "RCB", 2),
            // Couleur codée en nombre dans Excel : 1047.0 doit se lire 1047.
            ligne("CVC4", 1, "TPPVC21000", 1047.0, "SAG19HYBR", 1047.0, 1),
        })));
    }

    @Test
    public void unePieceAssembleeNeCompteQuUneFois() throws Exception {
        LecteurStrat.Resultat strat = lancement();
        LecteurStrat.LigneStrat feno = null;
        for (LecteurStrat.LigneStrat l : strat.lignes) if (l.cle.equals("CVC1001")) feno = l;
        assertEquals(2.0, feno.qteAttendue, 0); // deux couches
        assertEquals(1.0, feno.pieces, 0); // une pièce
        assertEquals(2, feno.couches);

        Map<String, Double> trouve = new LinkedHashMap<>();
        trouve.put("CVC1001", 2.0);
        trouve.put("CVC3002", 2.0);
        trouve.put("CVC4001", 1.0);
        Comparateur.Rapport complet = Comparateur.comparer(strat.lignes, trouve);
        assertEquals(0, complet.nbAnomalies);
        assertEquals(4.0, complet.piecesAttendues, 0);
        assertEquals(4.0, complet.piecesTrouvees, 0);
        assertEquals(5.0, complet.totalAttendu, 0); // en couches

        // Le support a été oublié : la couche manquante est signalée, la pièce n'est pas complète.
        trouve.put("CVC1001", 1.0);
        Comparateur.Rapport incomplet = Comparateur.comparer(strat.lignes, trouve);
        assertEquals(1, incomplet.nbAnomalies);
        assertEquals(3.0, incomplet.piecesTrouvees, 0);
        assertEquals(3.0, Comparateur.pieces(strat.lignes, trouve), 0);
    }

    @Test
    public void couleursDuLancementAbsentesDuBkp() throws Exception {
        LecteurStrat.Resultat strat = lancement();
        LecteurBkp.Couleurs bkp = new LecteurBkp.Couleurs();
        bkp.dessus.put("1133", 1);
        bkp.dessus.put("1047", 1);
        bkp.dessous.put("RCB", 2);
        bkp.dessous.put("1047", 1);
        ControleCouleurs.Resultat r = ControleCouleurs.controler(strat.lignes, bkp);
        assertFalse(r.sansStratifie);
        assertEquals(4, r.nbCouleurs); // 1133, RCB, B125-FA, 1047
        assertEquals(1, r.absentes.size());
        ControleCouleurs.Absente a = r.absentes.get(0);
        assertEquals("B125-FA", a.couleur);
        assertEquals(ControleCouleurs.DESSUS, a.face);
        assertEquals(2.0, a.nbPieces, 0);
        assertEquals(Collections.singletonList("CVC3002"), a.cles);

        // Recyclage : le .bkp ne contient que de l'agglo, les couleurs ne sont pas contrôlées.
        assertTrue(ControleCouleurs.controler(strat.lignes, new LecteurBkp.Couleurs()).sansStratifie);
    }

    // ---- pièces lancées deux fois ----

    @Test
    public void pieceDansDeuxLancementsDeLaSemaine() {
        Map<String, List<String>> cles = new LinkedHashMap<>();
        cles.put("Agglo 1er tour", Arrays.asList("CVC26100163003", "CVC26100043001", "CVC1001"));
        cles.put("Agglo 2ème tour", Arrays.asList("CVC26100163003", "CVC26100043001", "CVC26100043002"));
        cles.put("Recyclage", Arrays.asList("CVC26100043002", "000"));
        cles.put("Chantier", Arrays.asList("000"));
        List<DoublonsEntreLancements.Groupe> g = DoublonsEntreLancements.trouver(cles);
        assertEquals(2, g.size());
        assertEquals(Arrays.asList("Agglo 1er tour", "Agglo 2ème tour"), g.get(0).lancements);
        assertEquals(Arrays.asList("CVC26100163003", "CVC26100043001"), g.get(0).cles);
        assertEquals(Arrays.asList("Agglo 2ème tour", "Recyclage"), g.get(1).lancements);
    }
}
