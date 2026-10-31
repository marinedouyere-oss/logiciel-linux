package com.marinedouyere.sentinelle;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ScrollView;
import android.widget.TextView;

import com.google.android.material.tabs.TabLayout;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.shadows.ShadowLooper;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.zip.GZIPOutputStream;

/** L'appli branchée sur le fichier partagé écrit par Sentinelle (page web). */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, qualifiers = "w411dp-h891dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class PartageTest {

    private static final String EXEMPLE = "{\"format\":\"sentinelle-partage-1\",\"genere\":\"2026-10-31T10:21:00.000Z\",\"par\":\"Sentinelle V5.3 (page web)\","
            + "\"colonnesPieces\":[\"cle\",\"commande\",\"ligne\",\"article\",\"pieces\",\"longueur\",\"largeur\",\"epaisseur\",\"coloris\",\"coloris_inf\",\"matiere\",\"livraison\"],"
            + "\"explications\":{\"Lancée deux fois\":{\"sens\":\"La même pièce est aussi dans un autre lancement.\",\"queFaire\":\"la retirer d'un des deux.\"}},"
            + "\"semaines\":["
            + "{\"id\":\"2026-44\",\"annee\":2026,\"semaine\":44,\"maj\":\"x\",\"supprimeeLe\":\"y\",\"lancements\":[]},"
            + "{\"id\":\"2026-45\",\"annee\":2026,\"semaine\":45,\"maj\":\"2026-10-30T08:00:00.000Z\",\"lancements\":[{\"nom\":\"LAN264501STRAT\",\"poste\":\"Agglo 1er tour\","
            + "\"pieces\":[[\"CVC26100982004\",\"CVC26100982\",\"4\",\"ART1\",2,1200,600,19,\"1136\",\"\",\"SAG19\",\"2026-45\"]]}]},"
            + "{\"id\":\"2026-46\",\"annee\":2026,\"semaine\":46,\"maj\":\"2026-10-31T10:21:00.000Z\",\"lancements\":[{\"nom\":\"LAN264602START\",\"fichier\":\"LAN264602START.xlsx\","
            + "\"poste\":\"Agglo 2ème tour\",\"recap\":{\"prevues\":340,\"bkp\":341,\"controle\":1,\"scies\":1,\"couleursAbsentes\":0,\"couleursPf\":1},"
            + "\"controle\":{\"nbCorriger\":1,\"nbVerifier\":0,\"bilan\":[{\"statut\":\"alerte\",\"controle\":\"Autres lancements de la semaine\",\"texte\":\"1 dans Recyclage.\"}]},"
            + "\"problemes\":[{\"niveau\":\"corriger\",\"type\":\"Lancée deux fois\",\"cle\":\"CVC26100982004\",\"detail\":\"Aussi dans Recyclage\"}],"
            + "\"pieces\":[[\"CVC26100982004\",\"CVC26100982\",\"4\",\"ART1\",2,1200,600,19,\"1136\",\"\",\"SAG19\",\"2026-46\"]]}]}]}";

    private static byte[] gzip(String texte) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        try (GZIPOutputStream z = new GZIPOutputStream(b)) {
            z.write(texte.getBytes(StandardCharsets.UTF_8));
        }
        return b.toByteArray();
    }

    @Test
    public void litLeFichierPartage() throws Exception {
        FichierPartage f = FichierPartage.lire(new ByteArrayInputStream(gzip(EXEMPLE)));
        assertEquals("semaine retirée ignorée, la plus récente d'abord", 2, f.semaines.size());
        assertEquals(46, f.semaines.get(0).semaine);
        FichierPartage.Lancement l = f.semaines.get(0).lancements.get(0);
        assertEquals("Agglo 2ème tour", l.poste);
        assertEquals(Integer.valueOf(1), l.controle);
        assertEquals(Double.valueOf(340), l.prevues);
        assertTrue(l.controleFait);
        assertEquals(1, l.nbCorriger);
        assertEquals("Lancée deux fois", l.problemes.get(0).type);
        assertEquals("la retirer d'un des deux.", f.explications.get("Lancée deux fois")[1]);
        // Aussi en JSON non compressé.
        assertEquals(2, FichierPartage.lire(new ByteArrayInputStream(EXEMPLE.getBytes(StandardCharsets.UTF_8))).semaines.size());
        // Recherche dans toutes les semaines, CVC facultatif.
        List<FichierPartage.Trouvaille> t = f.chercher("26100982004");
        assertEquals(2, t.size());
        assertEquals(46, t.get(0).semaine.semaine);
        assertEquals(1, t.get(0).problemes.size());
        assertEquals(2, f.chercher("CVC26100982").size());
        assertTrue(f.chercher("CVC999").isEmpty());
    }

    @Test(expected = java.io.IOException.class)
    public void refuseUnAutreFichier() throws Exception {
        FichierPartage.lire(new ByteArrayInputStream("{\"format\":\"autre\"}".getBytes(StandardCharsets.UTF_8)));
    }

    private static void attendre(java.util.concurrent.Callable<Boolean> condition) throws Exception {
        long fin = System.currentTimeMillis() + 120_000;
        while (!condition.call()) {
            ShadowLooper.idleMainLooper();
            if (System.currentTimeMillis() > fin) throw new AssertionError("délai dépassé");
            Thread.sleep(20);
        }
        ShadowLooper.idleMainLooper();
    }

    private static <T extends View> T chercherVue(View v, Class<T> type) {
        if (type.isInstance(v)) return type.cast(v);
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) {
                T t = chercherVue(g.getChildAt(i), type);
                if (t != null) return t;
            }
        }
        return null;
    }

    private static void textes(View v, StringBuilder sb) {
        if (v instanceof TextView) sb.append(((TextView) v).getText()).append('\n');
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) textes(g.getChildAt(i), sb);
        }
    }

    private static void capturer(MainActivity a, File sortie) throws Exception {
        View racine = a.getWindow().getDecorView();
        ScrollView defilement = chercherVue(racine, ScrollView.class);
        View contenu = defilement.getChildAt(0);
        int largeur = racine.getWidth();
        int hauteurAvant = defilement.getTop();
        int hauteur = Math.min(hauteurAvant + contenu.getHeight(), 9000);
        Bitmap image = Bitmap.createBitmap(largeur, hauteur, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(image);
        c.drawColor(0xFFF4F3F1);
        int s = c.save();
        c.clipRect(0, 0, largeur, hauteurAvant);
        racine.draw(c);
        c.restoreToCount(s);
        c.translate(0, hauteurAvant);
        contenu.draw(c);
        try (OutputStream out = new FileOutputStream(sortie)) {
            image.compress(Bitmap.CompressFormat.PNG, 100, out);
        }
    }

    /** Le vrai fichier écrit par la page web (semaines 44 à 46) : l'onglet Partagé l'affiche. */
    @Test
    public void ongletPartageSurLeVraiFichier() throws Exception {
        String chemin = System.getProperty("sentinelle.partage", "");
        assumeTrue(!chemin.isEmpty());
        File source = new File(chemin);
        FichierPartage f;
        try (FileInputStream in = new FileInputStream(source)) {
            f = FichierPartage.lire(in);
        }
        assertTrue(f.semaines.size() >= 3);
        assertEquals(46, f.semaines.get(0).semaine);
        boolean avecProblemes = false;
        for (FichierPartage.Lancement l : f.semaines.get(0).lancements) avecProblemes |= !l.problemes.isEmpty();
        assertTrue(avecProblemes);

        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().visible().get();
        ShadowLooper.idleMainLooper();
        TabLayout onglets = chercherVue(a.getWindow().getDecorView(), TabLayout.class);
        assertNotNull(onglets);
        TabLayout.Tab partage = null;
        for (int i = 0; i < onglets.getTabCount(); i++) if (MainActivity.ONGLET_PARTAGE.equals(onglets.getTabAt(i).getTag())) partage = onglets.getTabAt(i);
        assertNotNull("onglet Partagé", partage);
        partage.select();
        ShadowLooper.idleMainLooper();
        StringBuilder vide = new StringBuilder();
        textes(a.getWindow().getDecorView(), vide);
        assertTrue(vide.toString().contains("Choisissez le fichier"));

        // Le fichier choisi dans le sélecteur d'Android (ici, une copie locale).
        File copie = new File(a.getCacheDir(), FichierPartage.NOM);
        java.nio.file.Files.copy(source.toPath(), copie.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        a.partage().fichierChoisi(Uri.fromFile(copie));
        attendre(() -> {
            StringBuilder sb = new StringBuilder();
            textes(a.getWindow().getDecorView(), sb);
            return sb.toString().contains("Semaine 46 — lancements");
        });
        StringBuilder ecran = new StringBuilder();
        textes(a.getWindow().getDecorView(), ecran);
        String texte = ecran.toString();
        assertTrue(texte.contains("Agglo 2ème tour"));
        assertTrue(texte.contains("à corriger"));
        assertFalse(texte.contains("illisible"));
        String captures = System.getProperty("sentinelle.captures", "");
        if (!captures.isEmpty()) {
            File dossier = new File(captures);
            //noinspection ResultOfMethodCallIgnored
            dossier.mkdirs();
            capturer(a, new File(dossier, "appli_partage.png"));
        }
        // Le choix est gardé : un nouvel écran relit le même fichier.
        assertEquals(Uri.fromFile(copie), a.partage().uri());
    }
}
