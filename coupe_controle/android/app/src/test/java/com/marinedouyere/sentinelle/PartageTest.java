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

    private static com.google.android.material.button.MaterialButton bouton(View v, String debut) {
        if (v instanceof com.google.android.material.button.MaterialButton && ((TextView) v).getText().toString().startsWith(debut))
            return (com.google.android.material.button.MaterialButton) v;
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) {
                com.google.android.material.button.MaterialButton t = bouton(g.getChildAt(i), debut);
                if (t != null) return t;
            }
        }
        return null;
    }

    private static String ecran(MainActivity a) {
        StringBuilder sb = new StringBuilder();
        textes(a.getWindow().getDecorView(), sb);
        return sb.toString();
    }

    private static void onglet(MainActivity a, String tag) {
        TabLayout onglets = chercherVue(a.getWindow().getDecorView(), TabLayout.class);
        for (int i = 0; i < onglets.getTabCount(); i++) if (tag.equals(onglets.getTabAt(i).getTag())) onglets.getTabAt(i).select();
        ShadowLooper.idleMainLooper();
    }

    private static MainActivity avecFichier(byte[] contenu) throws Exception {
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().visible().get();
        ShadowLooper.idleMainLooper();
        File copie = new File(a.getCacheDir(), FichierPartage.NOM);
        try (OutputStream out = new FileOutputStream(copie)) {
            out.write(contenu);
        }
        a.partage().fichierChoisi(Uri.fromFile(copie));
        attendre(() -> ((SentinelleApp) a.getApplication()).partage != null && !ecran(a).contains("Lecture du fichier"));
        return a;
    }

    /** Le même menu que Sentinelle sur le PC ; plus d'anciens onglets de contrôle ni de rapport Excel. */
    @Test
    public void menuCommeLePc() throws Exception {
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().visible().get();
        ShadowLooper.idleMainLooper();
        TabLayout onglets = chercherVue(a.getWindow().getDecorView(), TabLayout.class);
        assertEquals(4, onglets.getTabCount());
        String[] attendus = {"La semaine", "Contrôler la coupe", "Rechercher une pièce", "Bibliothèque des semaines"};
        for (int i = 0; i < attendus.length; i++) assertEquals(attendus[i], String.valueOf(onglets.getTabAt(i).getText()));
        String texte = ecran(a);
        assertTrue(texte, texte.contains("Contrôle de coupe · V"));
        assertTrue("sans fichier : on demande de le choisir", texte.contains("Choisissez le fichier"));
        for (String tag : new String[] {MainActivity.ONGLET_CONTROLE, MainActivity.ONGLET_RECHERCHE, MainActivity.ONGLET_BIBLIOTHEQUE}) {
            onglet(a, tag);
            String t = ecran(a);
            assertFalse(t, t.contains(".xlsx)"));
            assertFalse(t, t.contains("Scanner"));
        }
    }

    /** Choix de la semaine : « Semaine 46 · 2026 ▾ » au milieu, ‹ semaine d'avant, › semaine d'après. */
    @Test
    public void choixDeLaSemaine() throws Exception {
        MainActivity a = avecFichier(gzip(EXEMPLE));
        onglet(a, MainActivity.ONGLET_CONTROLE);
        View racine = a.getWindow().getDecorView();
        attendre(() -> bouton(racine, "Semaine 46 · 2026") != null);
        assertTrue("‹ actif sur la semaine la plus récente", bouton(racine, "‹").isEnabled());
        assertFalse("› inactif sur la semaine la plus récente", bouton(racine, "›").isEnabled());
        bouton(racine, "‹").performClick();
        ShadowLooper.idleMainLooper();
        assertNotNull("semaine 45 choisie", bouton(racine, "Semaine 45 · 2026"));
        assertTrue(ecran(a).contains("Semaine 45 — lancements"));
        assertTrue("› actif sur la semaine 45", bouton(racine, "›").isEnabled());
        assertFalse("‹ inactif sur la plus ancienne", bouton(racine, "‹").isEnabled());
        // La semaine choisie est la même dans La semaine.
        onglet(a, MainActivity.ONGLET_SEMAINE);
        assertTrue(ecran(a).contains("Semaine 45 · 2026"));
    }

    /** Le compte rendu de la semaine : mêmes lignes que sur le PC, casse de la semaine d'avant. */
    @Test
    public void compteRenduDeLaSemaine() throws Exception {
        FichierPartage f = FichierPartage.lire(new ByteArrayInputStream(gzip(EXEMPLE)));
        CompteRendu c = CompteRendu.de(f, f.semaines.get(0));
        assertEquals(46, c.numero);
        assertEquals("45", c.semaineCasse);
        assertEquals(1, c.lancements.size());
        assertEquals("Agglo 2ème tour", c.lancements.get(0).libelle);
        assertEquals("rapport_lancements_semaine_46.pdf", c.nomFichier());
        assertEquals("TRIGANO BIS", CompteRendu.nomChantier("LAN2644TRIGANObis"));
        assertEquals("COMMANDE TARDIVE", CompteRendu.nomChantier("LAN264301COMMANDE TARDIVE"));
        assertEquals(53, CompteRendu.semaineAvant(2027, 1));
        assertEquals(43, CompteRendu.semaineAvant(2026, 44));
        assertEquals("Du lundi 9 au vendredi 13 novembre", CompteRendu.datesSemaine(2026, 46));
        assertEquals("Du lundi 26 au vendredi 30 octobre", CompteRendu.datesSemaine(2026, 44));
    }

    /** Pièce sans étiquette : cote finie (sens du fil puis largeur) à 2 mm près, couleur facultative, semaine. */
    @Test
    public void pieceSansEtiquette() throws Exception {
        FichierPartage f = FichierPartage.lire(new ByteArrayInputStream(gzip(EXEMPLE)));
        assertEquals(1, f.chercherSansEtiquette(1201.0, 598.0, "", 46).size());
        assertEquals("3 mm : rien", 0, f.chercherSansEtiquette(1203.0, 600.0, "", 46).size());
        assertEquals("sens du fil inversé : rien", 0, f.chercherSansEtiquette(600.0, 1200.0, "", 46).size());
        assertEquals(1, f.chercherSansEtiquette(1200.0, null, "1136", 46).size());
        assertEquals(0, f.chercherSansEtiquette(1200.0, 600.0, "999", 46).size());
        assertEquals("autre semaine", 1, f.chercherSansEtiquette(1200.0, 600.0, "", 45).size());
    }

    private static void capturerSiDemande(MainActivity a, String nom) throws Exception {
        String captures = System.getProperty("sentinelle.captures", "");
        if (captures.isEmpty()) return;
        File dossier = new File(captures);
        //noinspection ResultOfMethodCallIgnored
        dossier.mkdirs();
        capturer(a, new File(dossier, nom));
    }

    /** Le vrai fichier écrit par la page web (semaines 44 à 46) : les quatre écrans, comme sur le PC. */
    @Test
    public void ecransSurLeVraiFichier() throws Exception {
        String chemin = System.getProperty("sentinelle.partage", "");
        assumeTrue(!chemin.isEmpty());
        File source = new File(chemin);
        MainActivity a = avecFichier(java.nio.file.Files.readAllBytes(source.toPath()));
        FichierPartage f = ((SentinelleApp) a.getApplication()).partage;
        assertEquals(46, f.semaines.get(0).semaine);

        // La semaine.
        String semaine = ecran(a);
        assertTrue(semaine, semaine.contains("Semaine 46 · 2026"));
        assertTrue(semaine.contains("Du lundi 9 au vendredi 13 novembre"));
        assertTrue(semaine.contains("Contrôles faits"));
        assertTrue("nombre de pièces de la semaine", semaine.contains("Pièces\n951"));
        assertTrue("nombre de pièces du lancement", semaine.contains("Pièces\n340"));
        assertTrue(semaine.contains("Les lancements de la semaine"));
        assertTrue(semaine.contains("À regarder"));
        capturerSiDemande(a, "appli_semaine.png");

        // « Voir le contrôle » : Contrôler la coupe, sur ce lancement.
        bouton(a.getWindow().getDecorView(), "Voir le contrôle").performClick();
        ShadowLooper.idleMainLooper();
        String controle = ecran(a);
        assertTrue(controle, controle.contains("Semaine 46 — lancements"));
        assertTrue(controle.contains("Compte rendu de la semaine (.pdf)"));
        assertTrue(controle.contains("Pièces : 951 prévues dans 6 lancement(s), 952 dans les .bkp."));
        assertTrue(controle.contains("à corriger"));
        assertFalse(controle.contains("illisible"));
        capturerSiDemande(a, "appli_controle.png");

        // Compte rendu : mêmes chiffres que le PC (hors casse 876, casse 75 de la semaine 45).
        CompteRendu c = CompteRendu.de(f, f.semaines.get(0));
        assertEquals("45", c.semaineCasse);
        assertEquals(876.0, CompteRendu.total(c.lancements), 0.001);
        assertEquals(75.0, CompteRendu.total(c.casse), 0.001);
        assertEquals("Casse", c.casse.get(0).libelle);
        assertEquals("RAJOUT", c.casse.get(1).libelle);
        assertEquals("Agglo 1er tour", c.lancements.get(0).libelle);
        assertEquals("Recyclage Agglo 1er tour", c.lancements.get(1).libelle);
        System.out.println("COMPTE RENDU casse " + c.casse.get(0).pieces + " rajout " + c.casse.get(1).pieces);
        String captures = System.getProperty("sentinelle.captures", "");
        if (!captures.isEmpty()) {
            // La page du compte rendu, dessinée comme dans le PDF (×2), pour la vérifier à l'œil.
            Ui ui = new Ui(a);
            Bitmap image = Bitmap.createBitmap(CompteRendu.LARGEUR * 2, CompteRendu.HAUTEUR * 2, Bitmap.Config.ARGB_8888);
            Canvas toile = new Canvas(image);
            toile.drawColor(0xFFFFFFFF);
            toile.scale(2, 2);
            c.dessiner(a, ui, () -> toile, 1);
            try (OutputStream out = new FileOutputStream(new File(captures, "appli_compte_rendu.png"))) {
                image.compress(Bitmap.CompressFormat.PNG, 100, out);
            }
            try {
                byte[] pdf = c.pdf(a, ui);
                try (OutputStream out = new FileOutputStream(new File(captures, "appli_compte_rendu.pdf"))) {
                    out.write(pdf);
                }
            } catch (Throwable e) {
                System.out.println("PDF pas fabriqué dans le test (Robolectric) : " + e);
            }
        }

        // Rechercher : une vraie pièce de la semaine 46, sans étiquette.
        int iL = f.colonne("longueur");
        int il = f.colonne("largeur");
        String[] piece = null;
        for (String[] p : f.semaines.get(0).lancements.get(0).pieces)
            if (!p[iL].isEmpty() && !p[il].isEmpty() && !p[iL].equals(p[il])) {
                piece = p;
                break;
            }
        assertNotNull(piece);
        double L = Double.parseDouble(piece[iL]);
        double l = Double.parseDouble(piece[il]);
        String cle = piece[f.colonne("cle")];
        boolean trouvee = false;
        for (FichierPartage.Trouvaille t : f.chercherSansEtiquette(L + 1, l - 2, "", 46)) trouvee |= cle.equals(t.piece[f.colonne("cle")]);
        assertTrue(cle, trouvee);
        onglet(a, MainActivity.ONGLET_RECHERCHE);
        String recherche = ecran(a);
        assertTrue(recherche.contains("Pièce sans étiquette"));
        assertTrue(recherche.contains("Longueur (sens du fil)"));
        capturerSiDemande(a, "appli_recherche.png");

        // Bibliothèque : les semaines du fichier ; un clic ouvre la semaine dans Contrôler la coupe.
        onglet(a, MainActivity.ONGLET_BIBLIOTHEQUE);
        String bibliotheque = ecran(a);
        assertTrue(bibliotheque, bibliotheque.contains(f.semaines.size() + " semaine(s)"));
        assertTrue(bibliotheque.contains("Semaine 45 · 2026"));
        assertTrue(bibliotheque.contains("Changer de fichier"));
        capturerSiDemande(a, "appli_bibliotheque.png");
        // Le choix est gardé : un nouvel écran relit le même fichier.
        assertNotNull(a.partage().uri());
    }
}
