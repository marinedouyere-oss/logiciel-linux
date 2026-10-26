package com.marinedouyere.sentinelle;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.content.DialogInterface;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;

import com.marinedouyere.sentinelle.moteur.ControleCouleurs;
import com.marinedouyere.sentinelle.moteur.LecteurBkp;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.shadows.ShadowDialog;
import org.robolectric.shadows.ShadowLooper;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * La vraie appli sur un vrai dossier partagé de l'atelier (semaine 44,
 * fourni par SENTINELLE_SEMAINE44, jamais versionné) : scan, contrôles
 * lancés tout seuls, couleurs, pièces assemblées, pièces lancées deux fois.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, qualifiers = "w411dp-h891dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class DossierReelTest {

    private static void textes(View v, List<String> sortie) {
        if (v.getVisibility() != View.VISIBLE) return;
        if (v instanceof TextView) sortie.add(((TextView) v).getText().toString());
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) textes(g.getChildAt(i), sortie);
        }
    }

    private static String ecran(MainActivity a) {
        List<String> t = new ArrayList<>();
        textes(a.getWindow().getDecorView(), t);
        return String.join("\n", t);
    }

    private static ScrollView defilement(View v) {
        if (v instanceof ScrollView) return (ScrollView) v;
        if (v instanceof ViewGroup) {
            for (int i = 0; i < ((ViewGroup) v).getChildCount(); i++) {
                ScrollView s = defilement(((ViewGroup) v).getChildAt(i));
                if (s != null) return s;
            }
        }
        return null;
    }

    private static void capturer(MainActivity a, File sortie, int hauteurMax) throws Exception {
        View racine = a.getWindow().getDecorView();
        ScrollView d = defilement(racine);
        View contenu = d.getChildAt(0);
        int hauteurAvant = d.getTop();
        int hauteur = Math.min(hauteurAvant + contenu.getHeight(), hauteurMax);
        Bitmap image = Bitmap.createBitmap(racine.getWidth(), hauteur, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(image);
        c.drawColor(0xFFF3F5F8);
        int s = c.save();
        c.clipRect(0, 0, racine.getWidth(), hauteurAvant);
        racine.draw(c);
        c.restoreToCount(s);
        c.translate(0, hauteurAvant);
        contenu.draw(c);
        try (OutputStream out = new FileOutputStream(sortie)) {
            image.compress(Bitmap.CompressFormat.PNG, 100, out);
        }
    }

    private static boolean toutTermine(MainActivity a, List<Paire> cases) {
        for (Paire p : cases) {
            if (p.enCours) return false;
            if ((p.coupe != null || p.bkp != null) && p.rapport == null && p.etat == null) return false;
            if (p.bkp != null && p.couleurs == null && p.erreurScies == null) return false;
        }
        String e = ecran(a);
        return !e.contains("⏳") && !e.contains("Scan en cours");
    }

    /** Scanne un dossier dans un onglet et attend la fin des contrôles (en confirmant les semaines mélangées). */
    private static void scanner(MainActivity a, String parite, File dossier) throws Exception {
        SentinelleApp app = (SentinelleApp) a.getApplication();
        a.choisirDossier(parite);
        a.dossierChoisi(Uri.fromFile(dossier));
        a.scannerDossier(parite);
        long fin = System.currentTimeMillis() + 600_000;
        Thread.sleep(200);
        while (!toutTermine(a, app.depot().pairesDeLaSemaine(parite))) {
            ShadowLooper.idleMainLooper();
            if (ShadowDialog.getLatestDialog() instanceof AlertDialog && ShadowDialog.getLatestDialog().isShowing()) {
                ((AlertDialog) ShadowDialog.getLatestDialog()).getButton(DialogInterface.BUTTON_POSITIVE).performClick();
            }
            if (System.currentTimeMillis() > fin) throw new AssertionError("délai dépassé\n" + ecran(a));
            Thread.sleep(50);
        }
        ShadowLooper.idleMainLooper();
        Thread.sleep(300);
        ShadowLooper.idleMainLooper();
    }

    private static List<android.widget.CheckBox> casesBases(View v) {
        List<android.widget.CheckBox> l = new ArrayList<>();
        if (v instanceof android.widget.CheckBox) l.add((android.widget.CheckBox) v);
        if (v instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) v).getChildCount(); i++) l.addAll(casesBases(((ViewGroup) v).getChildAt(i)));
        return l;
    }

    /** Lance une recherche dans l'onglet Recherche et renvoie le texte affiché une fois finie. */
    private static String chercher(MainActivity a, String requete) throws Exception {
        a.recherche().rechercher(requete);
        long fin = System.currentTimeMillis() + 120_000;
        Thread.sleep(100);
        while (a.recherche().enCours && System.currentTimeMillis() < fin) {
            ShadowLooper.idleMainLooper();
            Thread.sleep(50);
        }
        ShadowLooper.idleMainLooper();
        return ecran(a);
    }

    private static com.google.android.material.tabs.TabLayout onglets(View v) {
        if (v instanceof com.google.android.material.tabs.TabLayout) return (com.google.android.material.tabs.TabLayout) v;
        if (v instanceof ViewGroup) {
            for (int i = 0; i < ((ViewGroup) v).getChildCount(); i++) {
                com.google.android.material.tabs.TabLayout t = onglets(((ViewGroup) v).getChildAt(i));
                if (t != null) return t;
            }
        }
        return null;
    }

    @Test
    public void semaines44Et45() throws Exception {
        String s44 = System.getProperty("sentinelle.semaine44", "");
        String s45 = System.getProperty("sentinelle.semaine45", "");
        assumeTrue("dossiers des semaines 44 et 45 non fournis", !s44.isEmpty() && !s45.isEmpty() && new File(s44).isDirectory());
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().visible().get();
        SentinelleApp app = (SentinelleApp) a.getApplication();
        com.google.android.material.tabs.TabLayout t = onglets(a.getWindow().getDecorView());

        // ---- semaine 44 (onglet pair) ----
        scanner(a, Depot.PAIRE, new File(s44));
        Paire agglo1 = app.depot().paireFixe("Agglo 1er tour", Depot.PAIRE);
        Paire agglo2 = app.depot().paireFixe("Agglo 2ème tour", Depot.PAIRE);
        Paire feno = app.depot().paireFixe("Feno", Depot.PAIRE);
        Paire casse = app.depot().paireFixe("Casse", Depot.PAIRE);
        assertEquals("LAN264401STRATbackup.bkp", agglo1.bkp.nom);
        assertEquals("LAN264402STRATbackup.bkp", agglo2.bkp.nom);
        // La casse 43 se fabrique en semaine 44.
        assertEquals("LAN264301CASSE.xlsx", casse.strat.nom);
        assertEquals("LAN264301CASSEbackup.bkp", casse.bkp.nom);
        assertEquals("44", casse.semaine);
        assertEquals(69.0, casse.rapport.piecesAttendues, 0);
        assertEquals("Semaine 44", t.getTabAt(0).getText().toString());
        ControleCouleurs.Absente b125 = agglo1.couleurs.absentes.get(0);
        assertEquals("B125-FA", b125.couleur);
        assertTrue(b125.cles.contains("CVC26100069001"));
        boolean absente = false;
        for (LecteurBkp.Ecart e : agglo1.ecartsScies) if (e.cle.equals("CVC26090772001")) absente = true;
        assertTrue(absente);
        assertEquals(101.0, feno.rapport.piecesAttendues, 0);
        assertEquals(0, feno.rapport.nbAnomalies);
        assertTrue(agglo2.couleurs.absentes.isEmpty());
        String e = ecran(a);
        assertTrue(e, e.contains("⚠ Pièces lancées deux fois"));
        assertTrue(e, e.contains("CVC26100163003"));
        assertTrue(e, e.contains("B125-FA (dessus)"));
        assertTrue(e, e.contains("✔ Tout est correct — 101 pièces"));
        // Un seul export, pour toute la semaine, en haut de l'onglet.
        assertTrue(e, e.contains("Exporter le rapport de la semaine (.xlsx)"));
        assertTrue(e, !e.contains("Exporter le rapport (.xlsx)"));
        // LAN2644TRIGANO est un lancement de la semaine 45 (LAN264503) : rangé dans l'onglet impair.
        Paire trigano = null;
        for (Paire c : app.depot().paires) if (c.estChantier() && c.strat != null && c.strat.nom.equals("LAN2644TRIGANO.xlsx")) trigano = c;
        assertNotNull(trigano);
        assertEquals(Depot.IMPAIRE, trigano.parite);
        assertTrue(e, e.contains("LAN2644TRIGANO.xlsx → semaine 45"));
        String captures = System.getProperty("sentinelle.captures", "");
        if (!captures.isEmpty()) {
            new File(captures).mkdirs();
            capturer(a, new File(captures, "s44.png"), 12000);
        }

        // ---- semaine 45 (onglet impair) ----
        t.getTabAt(1).select();
        ShadowLooper.idleMainLooper();
        scanner(a, Depot.IMPAIRE, new File(s45));
        Paire casse45 = app.depot().paireFixe("Casse", Depot.IMPAIRE);
        Paire feno45 = app.depot().paireFixe("Feno", Depot.IMPAIRE);
        Paire agglo2_45 = app.depot().paireFixe("Agglo 2ème tour", Depot.IMPAIRE);
        assertEquals("LAN2644CASSE.xlsx", casse45.strat.nom);
        assertEquals("LAN264502STRA backup.bkp", agglo2_45.bkp.nom);
        assertEquals("1063", feno45.couleurs.absentes.get(0).couleur);
        assertEquals(116.0, feno45.rapport.piecesAttendues, 0);
        assertEquals(0, agglo2_45.rapport.nbAnomalies);
        long finCasse = System.currentTimeMillis() + 60_000;
        while (!ecran(a).contains("de la casse déjà lancée(s)") && System.currentTimeMillis() < finCasse) {
            ShadowLooper.idleMainLooper();
            Thread.sleep(50);
        }
        e = ecran(a);
        assertTrue(e, e.contains("CVC26100043001"));
        assertTrue(e, e.contains("CVC26100043002"));
        // Casse 44 : les pièces déjà lancées en semaine 44, avec leur lancement ; plus dans l'alerte générale.
        assertTrue(e, e.contains("🔁 13 pièce(s) de la casse déjà lancée(s) en semaine 44"));
        assertTrue(e, e.contains("CVC26100337006 · CRED14 · 955 × 270 · coloris 975 — LAN264401STRAT.xlsx")
                || e.contains("— LAN264401STRAT.xlsx"));
        assertTrue(e, e.contains("47 autre(s) pièce(s) pas lancée(s) en semaine 44"));
        assertTrue(e, !e.contains("⚠ Pièces déjà lancées en Semaine 44"));
        assertTrue(e, e.contains("⚠ Pièces d'une autre semaine de livraison"));
        assertTrue(e, e.contains("à livrer semaine 44"));
        if (!captures.isEmpty()) capturer(a, new File(captures, "s45.png"), 12000);

        // Rapport Excel de toute la semaine 45.
        File xlsx = new File(a.getCacheDir(), "rapport_semaine.xlsx");
        a.exporterSemaineVers(Depot.IMPAIRE, android.net.Uri.fromFile(xlsx));
        long finExport = System.currentTimeMillis() + 60_000;
        while (!(xlsx.exists() && xlsx.length() > 0) && System.currentTimeMillis() < finExport) {
            ShadowLooper.idleMainLooper();
            Thread.sleep(50);
        }
        Thread.sleep(200);
        com.marinedouyere.sentinelle.moteur.Classeur relu = com.marinedouyere.sentinelle.moteur.Classeur.lire(Controles.lireOctets(xlsx));
        assertEquals("Semaine 45", relu.feuilles.get(0).nom);
        assertEquals("Anomalies", relu.feuilles.get(1).nom);
        if (!captures.isEmpty()) java.nio.file.Files.copy(xlsx.toPath(), new File(captures, "rapport_semaine_45.xlsx").toPath(),
                java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        assertNotNull(a);
    }

    /** Diakonos de la semaine 46, 1er tour : les pièces commandées absentes du STRAT et du recyclage. */
    @Test
    public void diakonosSemaine46() throws Exception {
        String s46 = System.getProperty("sentinelle.semaine46", "");
        assumeTrue("dossier de la semaine 46 non fourni", !s46.isEmpty() && new File(s46).isDirectory());
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().visible().get();
        scanner(a, Depot.PAIRE, new File(s46));
        long fin = System.currentTimeMillis() + 120_000;
        while (!ecran(a).contains("Comparé à") && System.currentTimeMillis() < fin) {
            ShadowLooper.idleMainLooper();
            Thread.sleep(50);
        }
        String e = ecran(a);
        System.out.println(e);
        assertTrue(e, e.contains("✔ Diakonos 1er tour : diakonos46t1.xlsx"));
        assertTrue(e, e.contains("⚠ 3 pièce(s) Diakonos absente(s) des lancements du 1er tour"));
        assertTrue(e, e.contains("CVC26100810001 · TPPVC39551 · 2200 × 600 · coloris 896"));
        assertTrue(e, e.contains("CVC26100810002"));
        assertTrue(e, e.contains("CVC26100810003 · ILOT39801PVC · 2070 × 1000 · coloris 896"));
        assertTrue(e, !e.contains("CVC26100557001"));
        assertTrue(e, e.contains("LAN264601START.xlsx") && e.contains("LAN264601RECYCLAGE.xlsx"));
        String captures = System.getProperty("sentinelle.captures", "");
        if (!captures.isEmpty()) {
            new File(captures).mkdirs();
            capturer(a, new File(captures, "diakonos_46.png"), 6000);
        }

        // Recherche sans « CVC », dans les bases choisies (lancement, liste, .bkp, Diakonos).
        onglets(a.getWindow().getDecorView()).getTabAt(2).select();
        ShadowLooper.idleMainLooper();
        String rech = chercher(a, "26100810001");
        assertTrue(rech, rech.contains("Diakonos 1er tour (commandée)"));
        assertTrue(rech, !rech.contains("introuvable"));
        rech = chercher(a, "26100557001");
        assertTrue(rech, rech.contains("Chantier 2 LAN ×1") && rech.contains("Diakonos 1er tour (commandée)"));
        for (android.widget.CheckBox c : casesBases(a.getWindow().getDecorView())) c.setChecked("Diakonos".equals(c.getTag()));
        rech = chercher(a, "26100557001");
        assertTrue(rech, rech.contains("Diakonos 1er tour (commandée)") && !rech.contains("Chantier 2 LAN"));
        for (android.widget.CheckBox c : casesBases(a.getWindow().getDecorView())) c.setChecked("LAN".equals(c.getTag()));
        rech = chercher(a, "26100810001");
        assertTrue(rech, rech.contains("introuvable"));
        for (android.widget.CheckBox c : casesBases(a.getWindow().getDecorView())) c.setChecked(true);
        onglets(a.getWindow().getDecorView()).getTabAt(0).select();
        ShadowLooper.idleMainLooper();

        File xlsx = new File(a.getCacheDir(), "rapport_semaine_46.xlsx");
        a.exporterSemaineVers(Depot.PAIRE, android.net.Uri.fromFile(xlsx));
        long finExport = System.currentTimeMillis() + 60_000;
        while (!(xlsx.exists() && xlsx.length() > 0) && System.currentTimeMillis() < finExport) {
            ShadowLooper.idleMainLooper();
            Thread.sleep(50);
        }
        Thread.sleep(200);
        com.marinedouyere.sentinelle.moteur.Classeur relu = com.marinedouyere.sentinelle.moteur.Classeur.lire(Controles.lireOctets(xlsx));
        assertEquals("Semaine 46", relu.feuilles.get(0).nom);
        if (!captures.isEmpty()) java.nio.file.Files.copy(xlsx.toPath(), new File(captures, "rapport_semaine_46.xlsx").toPath(),
                java.nio.file.StandardCopyOption.REPLACE_EXISTING);

        // Le Diakonos n'est plus dans le rapport de la semaine : il est dans celui de son lancement.
        StringBuilder feuille1 = new StringBuilder();
        com.marinedouyere.sentinelle.moteur.Feuille f1 = relu.feuilles.get(0);
        for (int r = 1; r <= f1.nbLignes(); r++) for (Object v : f1.cellulesDeLaLigne(r).values()) feuille1.append(v).append(' ');
        assertTrue(feuille1.toString(), !feuille1.toString().contains("Diakonos"));

        // Rapport du lancement : sommaire Cut Rite (agglo, strats, couleurs) et Diakonos du 1er tour, dans un PDF.
        String sommaire = System.getProperty("sentinelle.sommaire", "");
        if (sommaire.isEmpty()) return;
        SentinelleApp app = (SentinelleApp) a.getApplication();
        Paire agglo1 = app.depot().paireFixe("Agglo 1er tour", Depot.PAIRE);
        File copieSommaire = new File(a.getCacheDir(), "LAN264601START.pdf");
        java.nio.file.Files.copy(new File(sommaire).toPath(), copieSommaire.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        a.demanderFichier(agglo1, Paire.SOMMAIRE);
        a.fichierChoisi(Uri.fromFile(copieSommaire));
        long finSommaire = System.currentTimeMillis() + 120_000;
        while ((agglo1.sommaire == null || agglo1.etat != null) && System.currentTimeMillis() < finSommaire) {
            ShadowLooper.idleMainLooper();
            Thread.sleep(50);
        }
        assertNotNull(agglo1.etat, agglo1.sommaire);
        e = ecran(a);
        assertTrue(e, e.contains("Sommaire Cut Rite (.pdf)\n✓ LAN264601START.pdf"));
        assertTrue(e, e.contains("Diakonos 1er tour (.xlsx)\n✓ diakonos46t1.xlsx"));
        // Ordre de la case : Diakonos, lancement, liste de coupe, .bkp, sommaire.
        int[] positions = {e.indexOf("Diakonos 1er tour (.xlsx)"), e.indexOf("Lancement\n✓ LAN264601START.xlsx"), e.indexOf("Liste de coupe\n"),
            e.indexOf("Fichier .bkp\n"), e.indexOf("Sommaire Cut Rite (.pdf)\n")};
        for (int i = 1; i < positions.length; i++) assertTrue(e, positions[i - 1] >= 0 && positions[i - 1] < positions[i]);
        assertTrue(e, e.contains("📄 Rapport du lancement (.pdf)"));
        File pdf = new File(a.getCacheDir(), "LAN264601_rapport_lancement.pdf");
        a.exporterLancementVers(agglo1, Uri.fromFile(pdf));
        while (!(pdf.exists() && pdf.length() > 0) && System.currentTimeMillis() < finSommaire) {
            ShadowLooper.idleMainLooper();
            Thread.sleep(50);
        }
        Thread.sleep(300);
        String contenuPdf = new String(java.nio.file.Files.readAllBytes(pdf.toPath()), java.nio.charset.StandardCharsets.ISO_8859_1);
        assertTrue(contenuPdf.contains("/Count 5"));
        for (String attendu : new String[] {"Agglo : panneaux et restes", "Strats : panneaux et restes", "Couleurs de la feuille",
                "Diakonos 1er tour", "3 pi\\350ce\\(s\\) Diakonos absente\\(s\\) des lancements du 1er tour", "CVC26100810001", "SAG38HYBLLINEX",
                "Couleurs semaine : ", "ROSE", "(340)"}) {
            assertTrue(attendu, contenuPdf.contains(attendu));
        }
        if (!captures.isEmpty()) {
            java.nio.file.Files.copy(pdf.toPath(), new File(captures, "appli_LAN264601_rapport_lancement.pdf").toPath(),
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            capturer(a, new File(captures, "lancement_46.png"), 7000);
        }
    }
}
