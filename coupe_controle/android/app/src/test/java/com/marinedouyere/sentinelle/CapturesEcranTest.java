package com.marinedouyere.sentinelle;

import static org.junit.Assume.assumeTrue;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ScrollView;

import androidx.appcompat.app.AlertDialog;
import androidx.test.core.app.ApplicationProvider;

import com.google.android.material.tabs.TabLayout;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.shadows.ShadowDialog;
import org.robolectric.shadows.ShadowLooper;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.Callable;

/** Captures de l'écran natif réel (format téléphone), pour vérification visuelle. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, qualifiers = "w411dp-h891dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class CapturesEcranTest {

    private static void attendre(Callable<Boolean> condition) throws Exception {
        long fin = System.currentTimeMillis() + 180_000;
        while (!condition.call()) {
            ShadowLooper.idleMainLooper();
            if (System.currentTimeMillis() > fin) throw new AssertionError("délai dépassé");
            Thread.sleep(20);
        }
        ShadowLooper.idleMainLooper();
    }

    private static Uri original(File dossier, String fixture, String nomReel) throws Exception {
        File copies = new File(ApplicationProvider.getApplicationContext().getCacheDir(), "originaux");
        //noinspection ResultOfMethodCallIgnored
        copies.mkdirs();
        File cible = new File(copies, nomReel);
        try (InputStream in = new FileInputStream(new File(dossier, fixture)); OutputStream out = new FileOutputStream(cible)) {
            byte[] b = new byte[65536];
            int n;
            while ((n = in.read(b)) != -1) out.write(b, 0, n);
        }
        return Uri.fromFile(cible);
    }

    private static void choisir(MainActivity a, Paire p, String role, Uri uri) throws Exception {
        a.demanderFichier(p, role);
        a.fichierChoisi(uri);
        attendre(() -> p.fichier(role) != null && p.etat == null);
    }

    /** Dessine tout le contenu défilant (pas seulement la partie visible) dans une image. */
    private static void capturer(MainActivity a, File sortie, int hauteurMax) throws Exception {
        View racine = a.getWindow().getDecorView();
        ScrollView defilement = trouver(racine);
        View contenu = defilement.getChildAt(0);
        int largeur = racine.getWidth();
        int hauteurAvant = defilement.getTop();
        int hauteur = Math.min(hauteurAvant + contenu.getHeight(), hauteurMax);
        Bitmap image = Bitmap.createBitmap(largeur, hauteur, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(image);
        c.drawColor(0xFFF3F5F8);
        int sauvegarde = c.save();
        c.clipRect(0, 0, largeur, hauteurAvant);
        racine.draw(c);
        c.restoreToCount(sauvegarde);
        c.translate(0, hauteurAvant);
        contenu.draw(c);
        try (OutputStream out = new FileOutputStream(sortie)) {
            image.compress(Bitmap.CompressFormat.PNG, 100, out);
        }
    }

    private static ScrollView trouver(View v) {
        if (v instanceof ScrollView) return (ScrollView) v;
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) {
                ScrollView s = trouver(g.getChildAt(i));
                if (s != null) return s;
            }
        }
        return null;
    }

    private static TabLayout onglets(View v) {
        if (v instanceof TabLayout) return (TabLayout) v;
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) {
                TabLayout t = onglets(g.getChildAt(i));
                if (t != null) return t;
            }
        }
        return null;
    }

    @Test
    public void capturesEcranPrincipal() throws Exception {
        String f = System.getProperty("sentinelle.fixtures", "");
        String captures = System.getProperty("sentinelle.captures", "");
        assumeTrue(!f.isEmpty() && !captures.isEmpty());
        File dossier = new File(f);
        File sortie = new File(captures);
        //noinspection ResultOfMethodCallIgnored
        sortie.mkdirs();

        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().visible().get();
        ShadowLooper.idleMainLooper();
        capturer(a, new File(sortie, "1_accueil.png"), 6000);

        SentinelleApp app = (SentinelleApp) a.getApplication();
        Paire p = app.depot().paireFixe("Agglo 1er tour", Depot.PAIRE);
        choisir(a, p, Paire.STRAT, original(dossier, "strat_264101.xlsx", "LAN264101STRAT.xlsx"));
        choisir(a, p, Paire.COUPE, original(dossier, "coupe_41_01.xlsx", "Liste_de_coupe_41.01.xlsx"));
        String nomBkp = "LAN264101STRAT_2026-09-22_0923_v12backup.bkp";
        choisir(a, p, Paire.BKP, original(dossier, nomBkp, nomBkp));
        a.lancerUnePaire(p, null);
        attendre(() -> !p.enCours && p.rapport != null);
        a.lancerControleScies(p);
        attendre(() -> !p.enCours && p.ecartsScies != null);
        Paire feno = app.depot().paireFixe("Feno", Depot.PAIRE);
        choisir(a, feno, Paire.STRAT, original(dossier, "strat_264001.xlsx", "LAN264001STRAT.xlsx"));
        a.lancerUnePaire(feno, null);
        attendre(() -> ShadowDialog.getLatestDialog() != null && ShadowDialog.getLatestDialog().isShowing()
                || feno.etat != null && !feno.enCours);
        ShadowLooper.idleMainLooper();
        Thread.sleep(500);
        ShadowLooper.idleMainLooper();
        capturer(a, new File(sortie, "2_resultats.png"), 6000);

        onglets(a.getWindow().getDecorView()).getTabAt(1).select();
        ShadowLooper.idleMainLooper();
        capturer(a, new File(sortie, "3_semaine_impaire.png"), 6000);
        if (ShadowDialog.getLatestDialog() instanceof AlertDialog) ShadowDialog.getLatestDialog().dismiss();
    }
}
