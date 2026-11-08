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

import com.google.android.material.bottomnavigation.BottomNavigationView;

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
        capturerRacine(a.getWindow().getDecorView(), sortie);
    }

    /** Une fenêtre (le plan en grand) : sa barre du haut, puis tout son contenu. */
    private static void capturerFenetre(android.app.Dialog d, String nom) throws Exception {
        String captures = System.getProperty("sentinelle.captures", "");
        if (captures.isEmpty()) return;
        View v = d.getWindow().getDecorView();
        v.measure(View.MeasureSpec.makeMeasureSpec(1233, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(2670, View.MeasureSpec.EXACTLY));
        v.layout(0, 0, 1233, 2670);
        capturerRacine(v, new File(captures, nom));
    }

    private static void capturerRacine(View racine, File sortie) throws Exception {
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
        BottomNavigationView menu = chercherVue(racine, BottomNavigationView.class);
        if (menu != null && hauteur + menu.getHeight() <= 9000) {
            Bitmap avecMenu = Bitmap.createBitmap(largeur, hauteur + menu.getHeight(), Bitmap.Config.ARGB_8888);
            Canvas c2 = new Canvas(avecMenu);
            c2.drawBitmap(image, 0, 0, null);
            c2.translate(0, hauteur);
            menu.draw(c2);
            image = avecMenu;
        }
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
        BottomNavigationView menu = chercherVue(a.getWindow().getDecorView(), BottomNavigationView.class);
        boolean dansLeMenu = false;
        for (int i = 0; i < MainActivity.MENU.length; i++)
            if (tag.equals(MainActivity.MENU[i][0])) {
                menu.setSelectedItemId(menu.getMenu().getItem(i).getItemId());
                dansLeMenu = true;
            }
        // La Bibliothèque : l'icône du livre, en haut.
        if (!dansLeMenu) a.allerA(tag);
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
        // V6.2.1 : le menu est en bas de l'écran, avec les icônes du PC.
        BottomNavigationView menu = chercherVue(a.getWindow().getDecorView(), BottomNavigationView.class);
        assertNotNull(menu);
        assertEquals(5, menu.getMenu().size());
        String[] attendus = {"Semaine", "Contrôle", "Plans", "Recherche", "Suivi"};
        for (int i = 0; i < attendus.length; i++) {
            assertEquals(attendus[i], String.valueOf(menu.getMenu().getItem(i).getTitle()));
            assertNotNull(menu.getMenu().getItem(i).getIcon());
        }
        String texte = ecran(a);
        assertTrue(texte, texte.contains("Contrôle de coupe · V"));
        assertTrue("sans données : relier au PC (code), ou choisir le fichier du Drive", texte.contains("Relier au PC") && texte.contains("choisissez le fichier"));
        for (String tag : new String[] {MainActivity.ONGLET_CONTROLE, MainActivity.ONGLET_RECHERCHE, MainActivity.ONGLET_BIBLIOTHEQUE, MainActivity.ONGLET_SUIVI}) {
            onglet(a, tag);
            String t = ecran(a);
            assertFalse(t, t.contains(".xlsx)"));
            assertFalse(t, t.replace("Scanner le QR code du PC", "").contains("Scanner")); // lecteur seulement : pas de scan de dossier
        }
    }

    /** Choix de la semaine : « Semaine 46 · 2026 ▾ » au milieu, ‹ semaine d'avant, › semaine d'après. */
    @Test
    public void choixDeLaSemaine() throws Exception {
        MainActivity a = avecFichier(gzip(EXEMPLE));
        onglet(a, MainActivity.ONGLET_CONTROLE);
        View racine = a.getWindow().getDecorView();
        attendre(() -> ecran(a).contains("Semaine 46 · 2026"));
        assertTrue("‹ S45 actif sur la semaine la plus récente", bouton(racine, "‹ S45").isEnabled());
        assertFalse("› inactif sur la semaine la plus récente", bouton(racine, "›").isEnabled());
        assertNotNull("liste de toutes les semaines", bouton(racine, "Choisir la semaine"));
        bouton(racine, "‹ S45").performClick();
        ShadowLooper.idleMainLooper();
        assertTrue("semaine 45 choisie", ecran(a).contains("Semaine 45 · 2026"));
        assertTrue(ecran(a).contains("Semaine 45 — lancements"));
        assertTrue("S46 › actif sur la semaine 45", bouton(racine, "S46 ›").isEnabled());
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

    /** V6.1 : fichier partagé avec les plans de coupe (48 01) — la recherche d'une pièce montre sa fiche et ses plans. */
    @Test
    public void rechercheAvecPlans() throws Exception {
        String chemin = System.getProperty("sentinelle.partage_plans", "");
        assumeTrue(!chemin.isEmpty());
        MainActivity a = avecFichier(java.nio.file.Files.readAllBytes(new File(chemin).toPath()));
        FichierPartage f = ((SentinelleApp) a.getApplication()).partage;
        PlansLancement.Piece p = PlansLancement.piece(f.semaines.get(0).lancements.get(0).plans, "CVC26110064003");
        assertEquals("T73", p.groupe);
        assertEquals(4, p.plans.size());
        assertEquals(40, p.plans.get(0).plan.pdc);
        assertEquals(12, p.plans.get(1).plan.pdc);
        assertEquals("SAG10HYBR", p.plans.get(1).plan.matiere);
        onglet(a, MainActivity.ONGLET_RECHERCHE);
        android.widget.EditText champ = chercherVue(a.getWindow().getDecorView(), android.widget.EditText.class);
        champ.setText("26110064003");
        bouton(a.getWindow().getDecorView(), "Chercher").performClick();
        ShadowLooper.idleMainLooper();
        String ecran = ecran(a);
        assertTrue(ecran, ecran.contains("Crédence 3592 × 161 × 14 mm"));
        assertTrue(ecran.contains("Lancée et placée — Agglo 1er tour, semaine 48"));
        assertTrue(ecran.contains("Dans le module T73"));
        assertTrue(ecran.contains("Pdc 40"));
        assertTrue(ecran.contains("Agglo SAG10HYBR"));
        assertTrue(ecran.contains("Stratifié dessus 997"));
        assertTrue(ecran.contains("✔ placée · Pdc 40 (module T73)"));
        capturerSiDemande(a, "appli_recherche_plans.png");
    }

    /** Un plan modifié dans Sentinelle sur le PC : l'appli le lit et le dessine modifié (elle ne modifie rien). */
    @Test
    public void planModifieSurLePc() throws Exception {
        String json = "{\"lancement\":\"LAN264801START\",\"noms\":[\"CVC26110041005\",\"CRED12\",\"modifiée : cote finie 480 × 192 → 380 × 192\","
                + "\"CVC26110064004\",\"retirée — ne pas couper\",\"CVC26119999001\",\"ESSAI\",\"posée dans Sentinelle\"],"
                + "\"plans\":[[\"SAG10HYBR\",40,1,\"T73\",\"module\",4050,1018,1,\"AGGLO\",[[0,0,425,217,0,1,380,192,\"m\",2],"
                + "[525,0,675,186,3,1,650,161,\"r\",4],[525,0,500,100,5,6,500,100,\"a\",7],[0,800,300,200,-1]],1]],"
                + "\"pieces\":{\"CVC26110041005\":{\"g\":\"T73\",\"t\":\"m\",\"d\":\"\",\"s\":\"\",\"n\":1,\"p\":[[0,0,[0]]]}}}";
        PlansLancement.Piece p = PlansLancement.piece(new org.json.JSONObject(json), "CVC26110041005");
        PlansLancement.Plan plan = p.plans.get(0).plan;
        assertTrue(plan.modifie);
        assertEquals("m", plan.morceaux.get(0).etat);
        assertEquals("modifiée : cote finie 480 × 192 → 380 × 192", plan.morceaux.get(0).marque);
        assertEquals("r", plan.morceaux.get(1).etat);
        assertEquals("a", plan.morceaux.get(2).etat);
        assertEquals("ESSAI", plan.morceaux.get(2).article);
        assertTrue(plan.morceaux.get(3).chute);
        // Le dessin passe (sans erreur) avec les trois états.
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().get();
        PlanVue v = new PlanVue(a, plan, p.plans.get(0).visees, true);
        v.measure(View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
        v.layout(0, 0, v.getMeasuredWidth(), v.getMeasuredHeight());
        Bitmap b = Bitmap.createBitmap(v.getMeasuredWidth(), Math.max(1, v.getMeasuredHeight()), Bitmap.Config.ARGB_8888);
        v.draw(new Canvas(b));
        assertEquals(800, b.getWidth());
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
        assertTrue("nombre de pièces du lancement", semaine.contains("340 pièces"));
        assertFalse("plus de gros bouton par lancement", semaine.contains("Voir le contrôle"));
        assertTrue(semaine.contains("Les lancements de la semaine"));
        assertTrue(semaine.contains("À regarder"));
        capturerSiDemande(a, "appli_semaine.png");

        // Un toucher sur un lancement : Contrôler la coupe, sur ce lancement (ouvert).
        View ligneLancement = vueAvecTexte(a.getWindow().getDecorView(), "Agglo 2ème tour");
        while (ligneLancement != null && !ligneLancement.isClickable()) ligneLancement = (View) ligneLancement.getParent();
        assertNotNull(ligneLancement);
        ligneLancement.performClick();
        ShadowLooper.idleMainLooper();
        String controle = ecran(a);
        assertTrue(controle, controle.contains("Semaine 46 — lancements"));
        assertTrue(controle.contains("Compte rendu de la semaine (.pdf)"));
        assertTrue(controle.contains("Pièces : 951 prévues dans 6 lancement(s), 952 dans les .bkp."));
        assertTrue(controle.contains("à corriger"));
        assertTrue("le lancement touché est ouvert (son bilan)", controle.contains("Scies (.bkp)"));
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

    /** Paquet chiffré par le PC (WebCrypto : PBKDF2 + AES-GCM) avec le code TEST-TEST-TEST-TEST, sur un petit fichier d'essai. */
    private static final String PAQUET_PC = "U05UMZzoTZBkl4QqOJMG8pusOC8NJwam7CwHmLOurc3KlPpSR0D9P7TdDyqrPivJF2vd6jxODYSu/0j7ztpgB1+vQfvNDrs2dUx2Yd9Za3rzk1EKwZw3GefPUIjSplxcibDm3yM7B5MMLa+TOCprmihBWG4kJXLOi+j32EQCT1oNIzx9FBp3KJeuML7LK0bv6ZLE4Y5V9dzXArTorzdbafcNQTShbes9px7kEKm/k42F/pSeJkDH1LU5fL8jscIW8QAeauCe/0OnB3HbBPDlDZOrPrblaPJK0EARO4EMEsx67Qs7DS1FgagWn7vtAPDegb/ZJ0nu9uxUyz86dIzrCHllva8mJ2mej4N95uDsnT4cfS6OC9eL3pIBM4p1X9n5eZW47chpRPbeOPMh1SCUug7raB2gVUTg58ydxkbdMqlcw1ilVHVjAXlJnyKo1kCIDVLqTmDp0hPQvTzUsDO9g5MxjUqG00wEFPHNeoSR4iQ7LdQ=";

    /** Lien avec le PC : même canal et même clé que le PC ; le paquet du PC se déchiffre ; un autre code est refusé. */
    /** Le QR code du PC : « SENTINELLE:ABCD-EFGH-JKLM-NPQR » ; un autre QR code est refusé avec un message clair. */
    @Test
    public void qrCodeDuPc() throws Exception {
        assertEquals("ABCD-EFGH-JKLM-NPQR", LienPc.codeDuQr("SENTINELLE:ABCD-EFGH-JKLM-NPQR"));
        assertEquals("ABCD-EFGH-JKLM-NPQR", LienPc.codeDuQr(" sentinelle:abcdefghjklmnpqr\n"));
        assertEquals(null, LienPc.codeDuQr("ABCD-EFGH-JKLM-NPQR"));
        assertEquals(null, LienPc.codeDuQr("https://exemple.fr/SENTINELLE:ABCD-EFGH-JKLM-NPQR"));
        assertEquals(null, LienPc.codeDuQr("SENTINELLE:ABCD-EFGH"));
        assertEquals(null, LienPc.codeDuQr("SENTINELLE:ABCD-EFGH-JKLM-NPQ0"));
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().visible().get();
        onglet(a, MainActivity.ONGLET_BIBLIOTHEQUE);
        assertTrue(ecran(a).contains("Scanner le QR code du PC"));
        a.partage().qrScanne("https://www.laisne.fr");
        ShadowLooper.idleMainLooper();
        assertTrue(ecran(a), ecran(a).contains("Ce QR code n'est pas celui de Sentinelle"));
        // Le QR code dessiné par Sentinelle sur le PC (capture de l'écran) se lit avec le lecteur de l'appli (ZXing).
        String png = System.getProperty("sentinelle.qr_png", "");
        if (!png.isEmpty()) {
            Bitmap img = android.graphics.BitmapFactory.decodeFile(png);
            int[] px = new int[img.getWidth() * img.getHeight()];
            img.getPixels(px, 0, img.getWidth(), 0, 0, img.getWidth(), img.getHeight());
            com.google.zxing.BinaryBitmap bb = new com.google.zxing.BinaryBitmap(new com.google.zxing.common.HybridBinarizer(
                    new com.google.zxing.RGBLuminanceSource(img.getWidth(), img.getHeight(), px)));
            String lu = new com.google.zxing.qrcode.QRCodeReader().decode(bb).getText();
            assertTrue(lu, LienPc.codeDuQr(lu) != null);
            System.out.println("QR du PC lu par ZXing : " + lu);
        }
    }

    @Test
    public void lienDechiffreLePaquetDuPc() throws Exception {
        assertEquals("TESTTESTTESTTEST", LienPc.normaliser("test-test test-test"));
        assertTrue(LienPc.codeValide("TEST-TEST-TEST-TEST"));
        assertFalse(LienPc.codeValide("TEST-TEST"));
        assertEquals("ABCD-EFGH-JKLM-NPQR", LienPc.formater("abcdefghjklmnpqr"));
        assertEquals("b6f360a2db7496fba521876907f782da", LienPc.canal("TEST-TEST-TEST-TEST"));
        byte[] paquet = java.util.Base64.getDecoder().decode(PAQUET_PC);
        byte[] clair = LienPc.dechiffrer(paquet, LienPc.cle("TEST-TEST-TEST-TEST"));
        FichierPartage f = FichierPartage.lire(new ByteArrayInputStream(clair));
        assertEquals(1, f.semaines.size());
        assertEquals(46, f.semaines.get(0).semaine);
        assertEquals("LAN264601START", f.semaines.get(0).lancements.get(0).nom);
        try {
            LienPc.dechiffrer(paquet, LienPc.cle("AAAA-AAAA-AAAA-AAAA"));
            throw new AssertionError("un autre code ne doit pas déchiffrer");
        } catch (LienPc.CodeFaux attendu) {
            // bien refusé
        }
    }

    /** Sur le vrai site : l'appli reliée avec le code affiché par le PC reçoit ses semaines. */
    @Test
    public void lienSurLeVraiSite() throws Exception {
        String code = System.getProperty("sentinelle.lien_code", "");
        assumeTrue(!code.isEmpty());
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().visible().get();
        ShadowLooper.idleMainLooper();
        onglet(a, MainActivity.ONGLET_BIBLIOTHEQUE);
        assertTrue(ecran(a).contains("Relier au PC"));
        a.partage().relier(code);
        attendre(() -> !ecran(a).contains("Lecture des données du PC"));
        String texte = ecran(a);
        assertTrue(texte, texte.contains("Relié au PC"));
        assertTrue(texte, texte.contains("semaine(s)"));
        assertFalse(texte, texte.contains("❌"));
        assertNotNull(((SentinelleApp) a.getApplication()).partage);
        capturerSiDemande(a, "appli_lien.png");
        // Sans réseau, la dernière version reçue reste lisible (gardée chiffrée sur le téléphone).
        assertTrue(new File(a.getFilesDir(), "lien_partage.bin").exists());
    }

    /** V6.2 : Suivi de production, lu dans le fichier partagé (résumé calculé par le PC). */
    private static final String SUIVI = "{\"format\":\"sentinelle-partage-1\",\"colonnesPieces\":[\"cle\"],\"semaines\":["
            + "{\"id\":\"2026-47\",\"annee\":2026,\"semaine\":47,\"lancements\":[{\"nom\":\"LAN264702START\",\"poste\":\"Agglo 2ème tour\",\"pieces\":[[\"CVC26119999001\"]]}]}],"
            + "\"suiviProduction\":{\"version\":1,\"jour\":\"2026-11-10\",\"semaine\":46,\"annee\":2026,\"fichiers\":[\"suivi_production_10112026.xlsx\"],"
            + "\"precedente\":\"2026-11-07\",\"nbExtractions\":2,\"totaux\":{\"lancements\":2,\"faites\":101,\"restantes\":64,\"retard\":0,\"depuis\":101},"
            + "\"semaineMax\":47,\"semaines\":[{\"id\":\"2026-47\",\"annee\":2026,\"semaine\":47,\"f\":101,\"r\":64,\"h\":0,\"e\":\"en_cours\",\"lancements\":["
            + "{\"cle\":\"LAN264702START\",\"nom\":\"LAN264702START\",\"poste\":\"Agglo 2ème tour\",\"f\":101,\"r\":64,\"h\":0,\"e\":\"en_cours\",\"d\":101,"
            + "\"p\":[[\"2026-11-07\",0],[\"2026-11-10\",61]],\"c\":[[\"CVC26119999\",\"TRANSPORTEUR A\",\"VILLE A\",2,\"S47\"]]}]},"
            + "{\"id\":\"2026-48\",\"annee\":2026,\"semaine\":48,\"f\":0,\"r\":0,\"h\":492,\"e\":\"hors_extraction\",\"lancements\":["
            + "{\"cle\":\"LAN264801START\",\"nom\":\"LAN264801START\",\"poste\":\"Agglo 1er tour\",\"f\":0,\"r\":0,\"h\":492,\"e\":\"hors_extraction\",\"d\":null,\"p\":[],\"c\":[]}]}],"
            + "\"anciennes\":1,\"hors\":[[\"En retard\",45.93,70,26]],\"tableau\":{\"colonnes\":[\"En retard\",\"S46\",\"Total\"],\"lignes\":[[\"TRANSPORTEUR B\",1.51,3,4.51]]}}}";

    @Test
    public void suiviDeProduction() throws Exception {
        FichierPartage f = FichierPartage.lire(new ByteArrayInputStream(gzip(SUIVI)));
        assertNotNull(f.suivi);
        assertEquals("2026-11-10", f.suivi.jour);
        assertEquals(2, f.suivi.semaines.size());
        FichierPartage.LancementSuivi l = f.suivi.semaines.get(0).lancements.get(0);
        assertEquals(101, l.f, 0);
        assertEquals(64, l.r, 0);
        assertEquals(Double.valueOf(101), l.d);
        assertEquals(Integer.valueOf(61), PartageVue.pctSuivi(l.f, l.r));
        assertEquals("+101 pièces depuis le 07/11", PartageVue.evolutionSuivi(l, f.suivi.precedente));
        assertEquals("Pas dans cette extraction", PartageVue.libelleEtatSuivi("hors_extraction", 0));
        assertEquals(47, f.suivi.semaineMax);
        assertTrue(PartageVue.ageExtraction("2026-11-10", java.util.Date.UTC(126, 10, 25, 12, 0, 0)).contains("il y a 15 jours"));
        assertEquals("", PartageVue.ageExtraction("2026-11-10", java.util.Date.UTC(126, 10, 10, 18, 0, 0)));
        assertEquals(null, f.suivi.semaines.get(1).lancements.get(0).d);
        // Sans résumé : pas de suivi (fichier d'une version d'avant).
        assertEquals(null, FichierPartage.lire(new ByteArrayInputStream(gzip(EXEMPLE))).suivi);

        MainActivity a = avecFichier(gzip(SUIVI));
        onglet(a, MainActivity.ONGLET_SUIVI);
        String texte = ecran(a);
        assertTrue(texte, texte.contains("Dernière extraction : 10/11/2026 (semaine 46)"));
        assertTrue(texte, texte.contains("Semaine 47"));
        assertTrue(texte, texte.contains("Du lundi 16 au vendredi 20 novembre"));
        assertTrue(texte, texte.contains("61 %"));
        assertTrue(texte, texte.contains("101 faites · 64 à faire"));
        assertTrue(texte, texte.contains("+101 pièces depuis le 07/11"));
        assertTrue(texte, texte.contains("Pas dans cette extraction"));
        assertTrue(texte, texte.contains("elle va jusqu'à la semaine 47"));
        assertTrue(texte, texte.contains("Dans Diakonos, dans aucun lancement"));
        assertTrue(texte, texte.contains("Pièces à faire par transporteur et par semaine"));
        assertTrue(texte, texte.contains("1 semaine plus ancienne : finie."));
        assertFalse("commandes cachées avant le clic", texte.contains("CVC26119999"));
        // Un appui sur le lancement : ses commandes encore à faire.
        View bloc = vueAvecTexte(a.getWindow().getDecorView(), "LAN264702START");
        while (bloc != null && !bloc.isClickable()) bloc = (View) bloc.getParent();
        assertNotNull(bloc);
        bloc.performClick();
        ShadowLooper.idleMainLooper();
        texte = ecran(a);
        assertTrue(texte, texte.contains("CVC26119999"));
        assertTrue(texte, texte.contains("TRANSPORTEUR A · VILLE A · S47"));
        capturerSiDemande(a, "appli_suivi.png");
    }

    /** Le vrai fichier écrit par la page web après la lecture de deux extractions Diakonos (test_web_suivi.js). */
    @Test
    public void suiviSurLeVraiFichier() throws Exception {
        String chemin = System.getProperty("sentinelle.partage_suivi", "");
        assumeTrue(!chemin.isEmpty());
        byte[] json = java.nio.file.Files.readAllBytes(new File(chemin).toPath());
        FichierPartage f = FichierPartage.lire(new ByteArrayInputStream(json));
        assertNotNull(f.suivi);
        FichierPartage.LancementSuivi lan = null;
        for (FichierPartage.SemaineSuivi s : f.suivi.semaines)
            for (FichierPartage.LancementSuivi l : s.lancements) if ("LAN264702START".equals(l.nom)) lan = l;
        assertNotNull(lan);
        assertEquals(101, lan.f, 0);
        assertEquals(64, lan.r, 0);
        MainActivity a = avecFichier(gzip(new String(json, StandardCharsets.UTF_8)));
        onglet(a, MainActivity.ONGLET_SUIVI);
        String texte = ecran(a);
        assertTrue(texte, texte.contains("Dernière extraction : 10/11/2026 (semaine 46)"));
        assertTrue(texte, texte.contains("LAN264702START"));
        assertTrue(texte, texte.contains("61 %"));
        assertTrue(texte, texte.contains("LAN264801START"));
        capturerSiDemande(a, "appli_suivi_vrai.png");
    }

    private static View vueAvecTexte(View v, String texte) {
        if (v instanceof TextView && texte.contentEquals(((TextView) v).getText())) return v;
        if (v instanceof ViewGroup)
            for (int i = 0; i < ((ViewGroup) v).getChildCount(); i++) {
                View t = vueAvecTexte(((ViewGroup) v).getChildAt(i), texte);
                if (t != null) return t;
            }
        return null;
    }

    /** V6.3 : les demandes pour le PC, chiffrées comme le fichier du PC ; les réponses du PC les retirent de la file. */
    @Test
    public void demandesPourLePc() throws Exception {
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().get();
        DemandesPc d = new DemandesPc(a);
        org.json.JSONObject v = new org.json.JSONObject().put("type", "validation").put("titre", "Essai").put("lancement", "LAN264801START").put("cle", "CVC1").put("probleme", "Essai");
        org.json.JSONObject x = d.ajouter(v);
        assertTrue(x.optString("id").startsWith(d.appareil() + "-"));
        assertTrue(d.validationEnAttente("LAN264801START", "CVC1", "Essai"));
        assertTrue(d.aEnvoyer());
        // Le paquet : « SNT1 » + vecteur + contenu chiffré, relu avec la même clé.
        byte[] cle = LienPc.cle("TEST-TEST-TEST-TEST");
        byte[] paquet = LienPc.chiffrer(d.contenu(null), cle);
        assertEquals('S', paquet[0]);
        org.json.JSONArray autres = DemandesPc.autres(LienPc.dechiffrer(paquet, cle), "autre-telephone", null);
        assertEquals("les demandes d'un autre téléphone sont gardées", 1, autres.length());
        assertEquals(0, DemandesPc.autres(LienPc.dechiffrer(paquet, cle), d.appareil(), null).length());
        assertEquals("b6f360a2db7496fba521876907f782da", LienPc.canal("TEST-TEST-TEST-TEST"));
        assertEquals(32, LienPc.canalRetour("TEST-TEST-TEST-TEST").length());
        assertFalse(LienPc.canalRetour("TEST-TEST-TEST-TEST").equals(LienPc.canal("TEST-TEST-TEST-TEST")));
        // Le PC répond : la demande sort de la file et va dans les résultats.
        java.util.Map<String, String[]> rep = new java.util.HashMap<>();
        rep.put(x.optString("id"), new String[] {"true", "Validé OK : Essai — CVC1", "2026-11-08T08:00:00Z"});
        assertEquals(1, d.reponses(rep));
        assertTrue(d.enAttente().isEmpty());
        assertEquals("Validé OK : Essai — CVC1", d.resultats().get(0).optString("texte"));
    }

    private static androidx.appcompat.app.AlertDialog dernierAlerte() {
        android.app.Dialog dl = org.robolectric.shadows.ShadowDialog.getLatestDialog();
        return dl instanceof androidx.appcompat.app.AlertDialog ? (androidx.appcompat.app.AlertDialog) dl : null;
    }

    /** V6.3 : l'écran Plans de coupe sur le vrai fichier du PC ; un plan modifié et un problème validé OK partent au PC. */
    @Test
    public void plansModifiesEtValidationsPourLePc() throws Exception {
        String chemin = System.getProperty("sentinelle.partage_retour", "");
        assumeTrue(!chemin.isEmpty());
        byte[] json = java.nio.file.Files.readAllBytes(new File(chemin).toPath());
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().visible().get();
        ShadowLooper.idleMainLooper();
        // Relié au PC (code de l'essai), données déjà lues.
        a.getSharedPreferences("sentinelle_partage", android.content.Context.MODE_PRIVATE).edit().putString("code_lien", "TEST-TEST-TEST-TEST").commit();
        FichierPartage f = FichierPartage.lire(new ByteArrayInputStream(json));
        a.partage().afficherDonnees(f, "essai");
        onglet(a, MainActivity.ONGLET_PLANS);
        String texte = ecran(a);
        assertTrue(texte, texte.contains("Plans de coupe"));
        assertTrue(texte, texte.contains("LAN264801START"));
        assertTrue(texte, texte.contains("SAG10HYBR"));
        capturerSiDemande(a, "appli_plans.png");
        // Ouvrir la matière SAG10HYBR, puis le plan Pdc 12.
        View matiere = vueAvecTexte(a.getWindow().getDecorView(), "SAG10HYBR");
        while (matiere != null && !matiere.isClickable()) matiere = (View) matiere.getParent();
        matiere.performClick();
        ShadowLooper.idleMainLooper();
        assertTrue(ecran(a).contains("Pdc 12 · SAG10HYBR"));
        EcranPlans.Source src = a.partage().plans().sources().get(0);
        PlansLancement.Plan plan = null;
        for (PlansLancement.Plan p : PlansLancement.tous(src.lancement.plans)) if (!p.module && p.pdc == 12 && "SAG10HYBR".equals(p.matiere)) plan = p;
        assertNotNull(plan);
        assertTrue("empreinte du plan reçue du PC", plan.empreinte.matches("#[0-9a-f]{8}"));
        View bloc = vueAvecTexte(a.getWindow().getDecorView(), "Pdc 12 · SAG10HYBR");
        while (bloc != null && !bloc.isClickable()) bloc = (View) bloc.getParent();
        bloc.performClick();
        ShadowLooper.idleMainLooper();
        android.app.Dialog fenetre = org.robolectric.shadows.ShadowDialog.getLatestDialog();
        assertNotNull(fenetre);
        View dans = fenetre.getWindow().getDecorView();
        capturerFenetre(fenetre, "appli_plan_grand.png");
        assertNotNull("Modifier le plan", bouton(dans, "Modifier le plan"));
        assertNotNull("Imprimer le plan (PDF)", bouton(dans, "Imprimer le plan"));
        bouton(dans, "Modifier le plan").performClick();
        ShadowLooper.idleMainLooper();
        dans = fenetre.getWindow().getDecorView();
        // Toucher « module T73 » (la 2e pièce du plan), puis « Retirer du plan ».
        View piece = vueAvecTexte(dans, "module T73");
        while (piece != null && !piece.isClickable()) piece = (View) piece.getParent();
        assertNotNull(piece);
        piece.performClick();
        ShadowLooper.idleMainLooper();
        androidx.appcompat.app.AlertDialog choix = dernierAlerte();
        assertNotNull(choix);
        choix.getButton(android.content.DialogInterface.BUTTON_NEUTRAL).performClick();
        ShadowLooper.idleMainLooper();
        dans = fenetre.getWindow().getDecorView();
        StringBuilder sb = new StringBuilder();
        textes(dans, sb);
        assertTrue(sb.toString(), sb.toString().contains("Changements à envoyer au PC"));
        assertTrue(sb.toString(), sb.toString().contains("module T73") && sb.toString().contains("retirée du plan — ne pas la couper"));
        capturerFenetre(fenetre, "appli_plan_modifie.png");
        bouton(dans, "Envoyer au PC").performClick();
        ShadowLooper.idleMainLooper();
        List<org.json.JSONObject> attente = a.partage().demandes().enAttente();
        assertEquals(1, attente.size());
        org.json.JSONObject d = attente.get(0);
        assertEquals("plan", d.optString("type"));
        assertEquals("LAN264801START", d.optString("lancement"));
        assertEquals(plan.empreinte, d.optString("empreinte"));
        assertEquals(12, d.optInt("pdc"));
        assertTrue(d.optJSONObject("rt").optJSONObject("morceaux").optJSONObject("1").optBoolean("retire"));
        // L'écran dit que la modification attend le PC.
        assertTrue(ecran(a), ecran(a).contains("envoyée(s) au PC"));

        // Valider OK un problème (Contrôler la coupe, lancement LAN264801START).
        onglet(a, MainActivity.ONGLET_CONTROLE);
        View tete = vueAvecTexte(a.getWindow().getDecorView(), "LAN264801START.xlsx");
        while (tete != null && !tete.isClickable()) tete = (View) tete.getParent();
        assertNotNull(tete);
        tete.performClick();
        ShadowLooper.idleMainLooper();
        com.google.android.material.button.MaterialButton valider = bouton(a.getWindow().getDecorView(), "✔ Valider OK");
        assertNotNull("bouton Valider OK", valider);
        valider.performClick();
        ShadowLooper.idleMainLooper();
        dernierAlerte().getButton(android.content.DialogInterface.BUTTON_POSITIVE).performClick();
        ShadowLooper.idleMainLooper();
        assertTrue(a.partage().demandes().validationEnAttente("LAN264801START", "CVC26110064003", "Essai téléphone"));
        assertTrue(ecran(a), ecran(a).contains("Validation OK envoyée au PC"));
        capturerSiDemande(a, "appli_valider.png");
        // Une validation de plus pour l'essai avec le PC, puis le paquet chiffré que le PC lira.
        a.partage().demandes().ajouter(new org.json.JSONObject().put("type", "validation").put("titre", "Essai Android").put("lancement", "LAN264801START").put("cle", "CVC26110064004").put("probleme", "Essai Android"));
        String sortie = System.getProperty("sentinelle.retour_bin", "");
        if (!sortie.isEmpty()) {
            byte[] paquet = LienPc.chiffrer(a.partage().demandes().contenu(null), LienPc.cle("TEST-TEST-TEST-TEST"));
            try (OutputStream out = new FileOutputStream(sortie)) {
                out.write(paquet);
            }
        }
        // Bibliothèque : « Envoyé au PC ».
        onglet(a, MainActivity.ONGLET_BIBLIOTHEQUE);
        assertTrue(ecran(a), ecran(a).contains("Envoyé au PC"));
        capturerSiDemande(a, "appli_envois.png");
    }

    /** V6.3, sur le vrai site : l'appli reliée au PC y dépose une demande (chiffrée) ; le PC la relira (test PC). */
    @Test
    public void retourSurLeVraiSite() throws Exception {
        String code = System.getProperty("sentinelle.lien_code", "");
        assumeTrue(!code.isEmpty());
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().visible().get();
        ShadowLooper.idleMainLooper();
        a.partage().relier(code);
        attendre(() -> ((SentinelleApp) a.getApplication()).partage != null);
        org.json.JSONObject d = new org.json.JSONObject().put("type", "validation").put("titre", "Essai vrai site").put("lancement", "LAN-ESSAI").put("cle", "CVC00000000001").put("probleme", "Essai vrai site");
        a.partage().envoyerDemande(d);
        attendre(() -> !a.partage().demandes().aEnvoyer() || a.partage().demandes().erreur() != null);
        assertEquals("envoi au PC sans erreur", null, a.partage().demandes().erreur());
        assertFalse(a.partage().demandes().aEnvoyer());
        System.out.println("DEMANDE DEPOSEE SUR LE SITE : " + a.partage().demandes().enAttente().get(0).optString("id"));
    }
}
