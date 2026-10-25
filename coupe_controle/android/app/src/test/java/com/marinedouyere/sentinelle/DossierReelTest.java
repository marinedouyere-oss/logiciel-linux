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
        e = ecran(a);
        assertTrue(e, e.contains("CVC26100043001"));
        assertTrue(e, e.contains("CVC26100043002"));
        // Pièces de la 44 : relancées en casse, et pièces à livrer semaine 44 dans un lancement de la 45.
        assertTrue(e, e.contains("⚠ Pièces déjà lancées en Semaine 44"));
        assertTrue(e, e.contains("⚠ Pièces d'une autre semaine de livraison"));
        assertTrue(e, e.contains("à livrer semaine 44"));
        if (!captures.isEmpty()) capturer(a, new File(captures, "s45.png"), 12000);
        assertNotNull(a);
    }
}
