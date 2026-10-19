package com.marinedouyere.sentinelle;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import androidx.appcompat.app.AlertDialog;
import android.content.DialogInterface;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.test.core.app.ApplicationProvider;

import com.google.android.material.tabs.TabLayout;
import com.marinedouyere.sentinelle.moteur.Classeur;
import com.marinedouyere.sentinelle.moteur.Comparateur;
import com.marinedouyere.sentinelle.moteur.Feuille;
import com.marinedouyere.sentinelle.moteur.LecteurBkp;
import com.marinedouyere.sentinelle.moteur.LecteurStrat;
import com.marinedouyere.sentinelle.moteur.Js;
import com.marinedouyere.sentinelle.moteur.Semaines;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowDialog;
import org.robolectric.shadows.ShadowLooper;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.concurrent.Callable;

/**
 * Fait tourner la vraie appli (écran, fichiers, contrôles) dans un Android
 * simulé, avec de vrais fichiers de l'atelier : démarrage, choix des
 * fichiers, GO avec confirmation des semaines, PDF, Contrôle Scies,
 * compteur, chantiers, mémorisation après redémarrage.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class AppliNativeTest {

    private File dossier;
    private File copies;

    @Before
    public void preparer() throws IOException {
        String f = System.getProperty("sentinelle.fixtures", "");
        assumeTrue("fichiers de test non fournis", !f.isEmpty() && new File(f).isDirectory());
        dossier = new File(f);
        copies = new File(ApplicationProvider.getApplicationContext().getCacheDir(), "originaux");
        //noinspection ResultOfMethodCallIgnored
        copies.mkdirs();
    }

    /** Copie un fichier de test sous le nom qu'il porterait réellement à l'atelier. */
    private Uri original(String fixture, String nomReel) throws IOException {
        File cible = new File(copies, nomReel);
        try (InputStream in = new FileInputStream(new File(dossier, fixture)); OutputStream out = new FileOutputStream(cible)) {
            byte[] b = new byte[65536];
            int n;
            while ((n = in.read(b)) != -1) out.write(b, 0, n);
        }
        return Uri.fromFile(cible);
    }

    private static void attendre(String quoi, Callable<Boolean> condition) throws Exception {
        long fin = System.currentTimeMillis() + 180_000;
        while (!condition.call()) {
            ShadowLooper.idleMainLooper();
            if (System.currentTimeMillis() > fin) throw new AssertionError("délai dépassé : " + quoi);
            Thread.sleep(20);
        }
        ShadowLooper.idleMainLooper();
    }

    private static void textes(View v, List<String> sortie) {
        if (v instanceof TextView) sortie.add(((TextView) v).getText().toString());
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) textes(g.getChildAt(i), sortie);
        }
    }

    private static String texteEcran(MainActivity a) {
        List<String> t = new ArrayList<>();
        textes(a.getWindow().getDecorView(), t);
        return String.join("\n", t);
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

    private static AlertDialog dialogue() {
        return (AlertDialog) ShadowDialog.getLatestDialog();
    }

    private void choisir(MainActivity a, Paire p, String role, Uri uri) throws Exception {
        a.demanderFichier(p, role);
        a.fichierChoisi(uri);
        attendre("copie du fichier", () -> p.fichier(role) != null && p.etat == null);
    }

    @Test
    public void controlePrincipalExcelAvecConfirmationEtMemorisation() throws Exception {
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().get();
        assertTrue(texteEcran(a).contains("Agglo 1er tour"));
        assertTrue(texteEcran(a).contains("Chantier 1"));

        SentinelleApp app = (SentinelleApp) a.getApplication();
        Paire p = app.depot().paireFixe("Agglo 1er tour", Depot.PAIRE);

        // Un fichier dont le nom ne correspond pas au rôle est refusé.
        a.demanderFichier(p, Paire.COUPE);
        a.fichierChoisi(original("strat_264001.xlsx", "LAN264001STRAT.xlsx"));
        ShadowLooper.idleMainLooper();
        assertNull(p.coupe);
        assertTrue(dialogue().isShowing());
        dialogue().dismiss();

        choisir(a, p, Paire.STRAT, original("strat_264001.xlsx", "LAN264001STRAT.xlsx"));
        assertEquals("40", p.semaine);
        // L'onglet et la case prennent le vrai numéro de la semaine du lancement.
        assertEquals("Semaine 40", onglets(a.getWindow().getDecorView()).getTabAt(0).getText().toString());
        assertFalse(texteEcran(a).contains("Semaine paire"));
        choisir(a, p, Paire.COUPE, original("coupe_40_01.xlsx", "Liste_de_coupe_sem_40.01.xlsx"));

        a.lancerUnePaire(p, null);
        // Ce lancement contient deux semaines de livraison : confirmation demandée.
        attendre("confirmation des semaines", () -> ShadowDialog.getLatestDialog() != null && dialogue().isShowing());
        dialogue().getButton(DialogInterface.BUTTON_POSITIVE).performClick();
        attendre("fin du contrôle", () -> !p.enCours && p.rapport != null);

        assertEquals(0, p.rapport.nbAnomalies);
        assertEquals(519, p.rapport.lignes.size());
        // Récapitulatif des lancements de la semaine.
        String prevues = Js.nombre(p.rapport.totalAttendu);
        attendre("récapitulatif", () -> texteEcran(a).contains("Total") && texteEcran(a).contains(prevues));
        String ecran = texteEcran(a);
        assertTrue(ecran, ecran.contains("📋 Lancements"));
        assertTrue(ecran, ecran.contains("Agglo 1er tour\nLAN264001STRAT"));
        assertTrue(ecran, ecran.contains("✔ OK"));
        assertTrue(ecran, ecran.contains("✔ Tout est correct — " + Js.entierTronque(p.rapport.totalAttendu) + " pièces"));
        assertTrue(ecran.contains("% grain matching"));

        // Redémarrage de l'appli : tout est relu depuis la mémoire.
        Depot relu = new Depot(a);
        Paire q = relu.paireFixe("Agglo 1er tour", Depot.PAIRE);
        assertNotNull(q.rapport);
        assertEquals(519, q.rapport.lignes.size());
        assertEquals("40", q.semaine);
        assertNotNull(q.strat);
        assertTrue(q.strat.fichier().exists());
        assertEquals("Liste_de_coupe_sem_40.01.xlsx", q.coupe.nom);
    }

    @Test
    public void listeDeCoupePdf() throws Exception {
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().get();
        Paire p = ((SentinelleApp) a.getApplication()).depot().paireFixe("Feno", Depot.PAIRE);
        choisir(a, p, Paire.STRAT, original("strat_264001.xlsx", "LAN264001STRAT.xlsx"));
        choisir(a, p, Paire.COUPE, original("coupe_40_01.pdf", "Liste_de_coupe_40.01.pdf"));
        a.lancerUnePaire(p, null);
        attendre("confirmation", () -> ShadowDialog.getLatestDialog() != null && dialogue().isShowing());
        dialogue().getButton(DialogInterface.BUTTON_POSITIVE).performClick();
        attendre("fin du contrôle PDF", () -> !p.enCours && (p.rapport != null || p.etatErreur));
        assertFalse(p.etat, p.etatErreur);
        assertEquals(0, p.rapport.nbAnomalies);
        assertEquals(519, p.rapport.lignes.size());
        assertEquals("coupe", p.source);
    }

    @Test
    public void controleSciesSansListeDeCoupeEtCompteur() throws Exception {
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().get();
        SentinelleApp app = (SentinelleApp) a.getApplication();
        TabLayout t = onglets(a.getWindow().getDecorView());
        t.getTabAt(1).select();
        ShadowLooper.idleMainLooper();

        Paire p = app.depot().paireFixe("Casse", Depot.IMPAIRE);
        String nomBkp = "LAN264101STRAT_2026-09-22_0923_v12backup.bkp";
        choisir(a, p, Paire.STRAT, original("strat_264101.xlsx", "LAN264101STRAT.xlsx"));
        choisir(a, p, Paire.BKP, original(nomBkp, nomBkp));

        a.lancerControleScies(p);
        attendre("Contrôle Scies", () -> !p.enCours && (p.ecartsScies != null || p.erreurScies != null));
        assertNull(p.erreurScies);
        Classeur strat = Classeur.lire(Controles.lireOctets(new File(dossier, "strat_264101.xlsx")));
        java.util.Map<String, Double> bkp = LecteurBkp.lire(Controles.lireOctets(new File(dossier, nomBkp)), nomBkp);
        assertEquals(LecteurBkp.comparerScies(LecteurStrat.quantitesAttenduesScies(strat), bkp).size(), p.ecartsScies.size());
        assertTrue(texteEcran(a).contains("Scies : " + p.ecartsScies.size() + " écart(s)"));

        // Sans liste de coupe, GO compare avec le .bkp (aucune confirmation : une seule semaine).
        a.lancerUnePaire(p, null);
        attendre("contrôle avec le .bkp", () -> !p.enCours && p.rapport != null);
        Comparateur.Rapport attendu = Comparateur.comparer(LecteurStrat.lire(strat).lignes, bkp);
        assertEquals(attendu.nbAnomalies, p.rapport.nbAnomalies);
        assertEquals("bkp", p.source);

        assertEquals("Semaine 41", t.getTabAt(1).getText().toString());
        String compteur = Js.nombre(LecteurBkp.somme(bkp)) + " pièces dans les .bkp";
        attendre("compteur", () -> texteEcran(a).contains(compteur));

        // L'autre semaine reste étanche : aucune pièce comptée.
        t.getTabAt(0).select();
        // Onglet sans lancement : semaine du calendrier ayant la bonne parité.
        String semainePaire = "Semaine " + Semaines.semaineCalendrier(Calendar.getInstance(), Depot.PAIRE);
        assertEquals(semainePaire, t.getTabAt(0).getText().toString());
        attendre("compteur semaine paire", () -> texteEcran(a).contains("0 pièces dans les .bkp"));
        assertTrue(texteEcran(a).contains("Aucun lancement."));
    }

    @Test
    public void chantiersEtancheesEtRecherche() throws Exception {
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().get();
        SentinelleApp app = (SentinelleApp) a.getApplication();
        TabLayout t = onglets(a.getWindow().getDecorView());
        t.getTabAt(1).select();
        ShadowLooper.idleMainLooper();
        Paire c = app.depot().ajouterChantier(Depot.IMPAIRE);
        a.afficher();
        assertTrue(texteEcran(a).contains(c.label));
        t.getTabAt(0).select();
        ShadowLooper.idleMainLooper();
        assertFalse(texteEcran(a).contains(c.label));
        assertTrue(app.depot().chantiers(Depot.IMPAIRE).contains(c));
        assertFalse(app.depot().chantiers(Depot.PAIRE).contains(c));
        t.getTabAt(2).select();
        ShadowLooper.idleMainLooper();
        assertTrue(texteEcran(a).contains("Recherche"));
    }
    /** Dossier partagé simulé, rempli de fichiers aux noms réels de l'atelier. */
    private File dossierPartage(String... fixturesEtNoms) throws IOException {
        File d = new File(ApplicationProvider.getApplicationContext().getCacheDir(), "partage" + System.nanoTime());
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        for (int i = 0; i < fixturesEtNoms.length; i += 2) {
            File cible = new File(d, fixturesEtNoms[i + 1]);
            if (fixturesEtNoms[i] == null) {
                java.nio.file.Files.write(cible.toPath(), "notes".getBytes());
                continue;
            }
            try (InputStream in = new FileInputStream(new File(dossier, fixturesEtNoms[i])); OutputStream out = new FileOutputStream(cible)) {
                byte[] b = new byte[65536];
                int n;
                while ((n = in.read(b)) != -1) out.write(b, 0, n);
            }
        }
        return d;
    }

    @Test
    public void scanDuDossierPartageRangeEtLanceLesControles() throws Exception {
        String bkp = "LAN264101STRAT_2026-09-22_0923_v12backup.bkp";
        File partage = dossierPartage(
                "strat_264101.xlsx", "LAN264101STRAT.xlsx",
                "coupe_41_01.xlsx", "CUTRITE_LAN264101STRAT.xlsx",
                bkp, bkp,
                "strat_264101.xlsx", "LAN2641TRIGANO.xlsx",
                "strat_264001.xlsx", "LAN264001STRAT.xlsx",
                null, "notes.txt");
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().get();
        SentinelleApp app = (SentinelleApp) a.getApplication();
        TabLayout t = onglets(a.getWindow().getDecorView());
        t.getTabAt(1).select();
        ShadowLooper.idleMainLooper();
        assertTrue(texteEcran(a).contains("📂 Dossier partagé"));

        a.choisirDossier(Depot.IMPAIRE);
        a.dossierChoisi(Uri.fromFile(partage));
        assertTrue(texteEcran(a).contains(partage.getName()));
        // Chaque semaine a son propre dossier.
        assertNull(DossierPartage.memorise(a, Depot.PAIRE));

        a.scannerDossier(Depot.IMPAIRE);
        Paire agglo = app.depot().paireFixe("Agglo 1er tour", Depot.IMPAIRE);
        attendre("scan et contrôles", () -> agglo.rapport != null && agglo.ecartsScies != null && !agglo.enCours
                && texteEcran(a).contains("Non reconnu(s)"));
        attendre("fin des contrôles", () -> !texteEcran(a).contains("⏳"));
        assertEquals("LAN264101STRAT.xlsx", agglo.strat.nom);
        assertEquals("CUTRITE_LAN264101STRAT.xlsx", agglo.coupe.nom);
        assertEquals(bkp, agglo.bkp.nom);
        assertEquals("41", agglo.semaine);
        assertEquals("coupe", agglo.source);
        String ecran = texteEcran(a);
        assertTrue(ecran, ecran.contains("✔ Agglo 1er tour : LAN264101STRAT.xlsx + coupe + .bkp"));
        assertEquals("Semaine 41", t.getTabAt(1).getText().toString());
        assertTrue(ecran, ecran.contains("Non reconnu(s) : notes.txt"));
        assertTrue(ecran, ecran.contains("Scies : "));

        // Le lancement TRIGANO devient un chantier de la semaine impaire.
        Paire trigano = null;
        for (Paire c : app.depot().chantiers(Depot.IMPAIRE)) if ("2641|TRIGANO".equals(c.codeLancement)) trigano = c;
        assertNotNull(trigano);
        assertEquals("LAN2641TRIGANO.xlsx", trigano.strat.nom);
        assertTrue(ecran, ecran.contains("✔ " + trigano.label + " : LAN2641TRIGANO.xlsx"));
        int nbChantiers = app.depot().chantiers(Depot.IMPAIRE).size();
        attendre("récapitulatif", () -> texteEcran(a).contains("LAN2641TRIGANO") && !texteEcran(a).contains("…"));
        ecran = texteEcran(a);
        assertTrue(ecran, ecran.contains("Agglo 1er tour\nLAN264101STRAT"));
        assertTrue(ecran, ecran.contains(trigano.label + "\nLAN2641TRIGANO"));

        // L'autre semaine n'a rien reçu.
        assertNull(app.depot().paireFixe("Agglo 1er tour", Depot.PAIRE).strat);

        // Un second scan retrouve le même chantier au lieu d'en créer un autre.
        a.scannerDossier(Depot.IMPAIRE);
        attendre("second scan", () -> !texteEcran(a).contains("Scan en cours") && !texteEcran(a).contains("⏳"));
        attendre("contrôles du second scan", () -> !agglo.enCours && !texteEcran(a).contains("⏳"));
        assertEquals(nbChantiers, app.depot().chantiers(Depot.IMPAIRE).size());

        // Export du rapport en Excel.
        File xlsx = new File(ApplicationProvider.getApplicationContext().getCacheDir(), "rapport.xlsx");
        a.exporterVers(agglo, Uri.fromFile(xlsx));
        attendre("export", () -> xlsx.exists() && xlsx.length() > 0);
        Thread.sleep(200);
        Classeur relu = Classeur.lire(Controles.lireOctets(xlsx));
        Feuille f = relu.feuilles.get(0);
        assertEquals("Contrôle coupe", f.nom);
        assertEquals("Total attendu", f.valeur(1, 1));
        assertEquals(agglo.rapport.lignes.size() + 3, f.nbLignes());
    }

    @Test
    public void rechercheAvecSchemaDeLaCommande() throws Exception {
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().get();
        SentinelleApp app = (SentinelleApp) a.getApplication();
        Paire p = app.depot().paireFixe("Feno", Depot.IMPAIRE);
        choisir(a, p, Paire.STRAT, original("strat_264101.xlsx", "LAN264101STRAT.xlsx"));
        choisir(a, p, Paire.COUPE, original("coupe_41_01.xlsx", "Liste_de_coupe_41.01.xlsx"));

        TabLayout t = onglets(a.getWindow().getDecorView());
        t.getTabAt(2).select();
        ShadowLooper.idleMainLooper();
        RechercheVue r = a.recherche();
        r.rechercher("cvc26090464001");
        attendre("recherche", () -> !r.enCours);
        String ecran = texteEcran(a);
        // Une fiche pour la commande : son schéma, puis une ligne par pièce, la pièce cherchée ouverte.
        assertTrue(ecran, ecran.contains("Commande CVC26090464"));
        assertTrue(ecran, ecran.contains("6 pièce(s)"));
        assertTrue(ecran, ecran.contains("plan en L"));
        assertTrue(ecran, ecran.contains("CVC26090464001"));
        assertTrue(ecran, ecran.contains("Plan TPPVC29551 · 1120 × 600 × 29 mm"));
        assertTrue(ecran, ecran.contains("Feno ×1"));
        assertTrue(ecran, ecran.contains("S'assemble sur la ligne 2 (LD600)"));
        // Un dessin pour l'ensemble en L + le dessin de la pièce cherchée, pas un par pièce.
        assertEquals(2, compterVisibles(a.getWindow().getDecorView(), SchemaVue.class));

        r.rechercher("ZZZ");
        attendre("recherche vide", () -> !r.enCours);
        assertTrue(texteEcran(a).contains("« ZZZ » introuvable."));

        r.rechercher("T9");
        attendre("bande", () -> !r.enCours);
        assertTrue(texteEcran(a), texteEcran(a).contains("Bande T9 : "));
        assertTrue(texteEcran(a), texteEcran(a).contains("Voir la commande"));
    }

    private static int compterVisibles(View v, Class<?> type) {
        if (v.getVisibility() != View.VISIBLE) return 0;
        int n = type.isInstance(v) ? 1 : 0;
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) n += compterVisibles(g.getChildAt(i), type);
        }
        return n;
    }
}
