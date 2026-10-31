package com.marinedouyere.sentinelle;

import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.appbar.MaterialToolbar;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;
import com.google.android.material.tabs.TabLayout;
import com.marinedouyere.sentinelle.moteur.Comparateur;
import com.marinedouyere.sentinelle.moteur.ControleCouleurs;
import com.marinedouyere.sentinelle.moteur.ErreurLecture;
import com.marinedouyere.sentinelle.moteur.ExportRapport;
import com.marinedouyere.sentinelle.moteur.Js;
import com.marinedouyere.sentinelle.moteur.LecteurBkp;
import com.marinedouyere.sentinelle.moteur.LecteurDiakonos;
import com.marinedouyere.sentinelle.moteur.RapportsSommaire;
import com.marinedouyere.sentinelle.moteur.SommaireCutRite;
import com.marinedouyere.sentinelle.moteur.LecteurStrat;
import com.marinedouyere.sentinelle.moteur.ScanDossier;
import com.marinedouyere.sentinelle.moteur.Semaines;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public class MainActivity extends AppCompatActivity {

    static final String ONGLET_RECHERCHE = "recherche";
    /** Onglet du fichier partagé écrit par Sentinelle sur le PC (l'appli le lit). */
    static final String ONGLET_PARTAGE = "partage";
    private static final int LIMITE_LIGNES = 60;

    private SentinelleApp app;
    private Depot depot;
    private Controles controles;
    private Ui ui;
    private final Handler principal = new Handler(Looper.getMainLooper());

    private String onglet = Depot.PAIRE;
    private LinearLayout contenu;
    private ScrollView defilement;
    private TextView texteCompteur;
    private TabLayout onglets;
    private LinearLayout zoneRecap;
    private int generationRecap;
    /** Résultat Diakonos affiché dans la case Agglo de son tour (case Diakonos → zone). */
    /** Zones Diakonos affichées (zone → case Diakonos) et zones de chaque case de lancement. */
    private final Map<LinearLayout, Paire> zonesDiakonos = new LinkedHashMap<>();
    private final Map<Paire, List<LinearLayout>> zonesDiakonosParCase = new HashMap<>();
    private int generationDiakonos;
    /** Dernier résultat Diakonos de chaque case (affiché pendant le nouveau calcul). */
    private final Map<String, ControleDiakonos.Resultat> resultatsDiakonos = new HashMap<>();
    private final Map<Paire, LinearLayout> cartes = new HashMap<>();
    private final Set<Paire> listesDepliees = new HashSet<>();
    private RechercheVue recherche;
    private PartageVue partage;
    private ActivityResultLauncher<String[]> choixPartage;

    private ActivityResultLauncher<String[]> choixFichier;
    private String cleEnAttente;
    private String roleEnAttente;

    private ActivityResultLauncher<Uri> choixDossier;
    private String pariteDossierEnAttente;
    /** Compte rendu du dernier scan, par semaine (lignes, et s'il s'agit d'une erreur). */
    private final Map<String, List<String>> resultatsScan = new HashMap<>();
    private final Set<String> scanEnErreur = new HashSet<>();
    private final Set<String> scansEnCours = new HashSet<>();

    private ActivityResultLauncher<String> creationRapport;
    private String cleExport;

    /** Rapport du lancement (PDF : sommaire Cut Rite et Diakonos) : case en attente de l'emplacement. */
    private ActivityResultLauncher<String> creationRapportLancement;
    private String cleRapportLancement;

    /** Lancement corrigé (nouveau fichier, sans les doublons) : case en attente de l'emplacement. */
    private ActivityResultLauncher<String> creationCorrection;
    private String cleCorrection;

    /** Analyse de la casse (pièces déjà lancées la semaine d'avant), par case. */
    private final Map<String, ControleCasse.Resultat> resultatsCasse = new HashMap<>();
    private final Set<String> casseEnCours = new HashSet<>();
    private final Map<Paire, LinearLayout> zonesCasse = new HashMap<>();

    @Override
    protected void onCreate(Bundle etat) {
        super.onCreate(etat);
        app = (SentinelleApp) getApplication();
        depot = app.depot();
        controles = app.controles();
        ui = new Ui(this);
        if (etat != null) {
            onglet = etat.getString("onglet", Depot.PAIRE);
            cleEnAttente = etat.getString("cleEnAttente");
            roleEnAttente = etat.getString("roleEnAttente");
            pariteDossierEnAttente = etat.getString("pariteDossierEnAttente");
            cleExport = etat.getString("cleExport");
        }
        choixFichier = registerForActivityResult(new ActivityResultContracts.OpenDocument(), this::fichierChoisi);
        choixDossier = registerForActivityResult(new ActivityResultContracts.OpenDocumentTree(), this::dossierChoisi);
        choixPartage = registerForActivityResult(new ActivityResultContracts.OpenDocument(), uri -> partage().fichierChoisi(uri));
        creationRapport = registerForActivityResult(new ActivityResultContracts.CreateDocument(ExportRapport.TYPE_MIME),
                this::emplacementRapportChoisi);
        creationRapportLancement = registerForActivityResult(new ActivityResultContracts.CreateDocument("application/pdf"),
                this::emplacementRapportLancementChoisi);
        if (etat != null) cleRapportLancement = etat.getString("cleRapportLancement");
        creationCorrection = registerForActivityResult(new ActivityResultContracts.CreateDocument(ExportRapport.TYPE_MIME),
                this::emplacementCorrectionChoisi);
        if (etat != null) cleCorrection = etat.getString("cleCorrection");

        LinearLayout racine = ui.colonne();
        racine.setBackgroundColor(ui.couleur(R.color.fond));

        MaterialToolbar barre = new MaterialToolbar(this);
        barre.setTitle("Sentinelle");
        barre.setSubtitle("Contrôle de coupe");
        barre.setBackgroundColor(ui.couleur(R.color.marque));
        barre.setTitleTextColor(0xFFFFFFFF);
        barre.setSubtitleTextColor(0xDDFFFFFF);
        racine.addView(barre, ui.pleineLargeur());

        onglets = new TabLayout(this);
        onglets.setBackgroundColor(0xFFFFFFFF);
        onglets.setTabMode(TabLayout.MODE_FIXED);
        onglets.setTabGravity(TabLayout.GRAVITY_FILL);
        onglets.addTab(onglets.newTab().setText(libelleOnglet(Depot.PAIRE)).setTag(Depot.PAIRE));
        onglets.addTab(onglets.newTab().setText(libelleOnglet(Depot.IMPAIRE)).setTag(Depot.IMPAIRE));
        onglets.addTab(onglets.newTab().setText("Recherche").setTag(ONGLET_RECHERCHE));
        onglets.addTab(onglets.newTab().setText("Partagé").setTag(ONGLET_PARTAGE));
        racine.addView(onglets, ui.pleineLargeur());

        defilement = new ScrollView(this);
        defilement.setFillViewport(true);
        contenu = ui.colonne();
        contenu.setPadding(ui.dp(14), ui.dp(12), ui.dp(14), ui.dp(40));
        defilement.addView(contenu, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        racine.addView(defilement, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(racine);

        for (int i = 0; i < onglets.getTabCount(); i++) {
            TabLayout.Tab t = onglets.getTabAt(i);
            if (t != null && onglet.equals(t.getTag())) t.select();
        }
        onglets.addOnTabSelectedListener(new TabLayout.OnTabSelectedListener() {
            @Override
            public void onTabSelected(TabLayout.Tab tab) {
                onglet = (String) tab.getTag();
                afficher();
                defilement.scrollTo(0, 0);
                if (ONGLET_PARTAGE.equals(onglet)) partage().actualiser();
            }

            @Override
            public void onTabUnselected(TabLayout.Tab tab) {}

            @Override
            public void onTabReselected(TabLayout.Tab tab) {}
        });
        afficher();
    }

    @Override
    protected void onSaveInstanceState(Bundle etat) {
        super.onSaveInstanceState(etat);
        etat.putString("onglet", onglet);
        etat.putString("cleEnAttente", cleEnAttente);
        etat.putString("roleEnAttente", roleEnAttente);
        etat.putString("pariteDossierEnAttente", pariteDossierEnAttente);
        etat.putString("cleExport", cleExport);
        etat.putString("cleRapportLancement", cleRapportLancement);
        etat.putString("cleCorrection", cleCorrection);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Retour dans l'appli : le fichier partagé a pu changer sur le PC.
        if (ONGLET_PARTAGE.equals(onglet)) partage().actualiser();
    }

    /** Onglet du fichier partagé (créé à la première visite). */
    PartageVue partage() {
        if (partage == null) partage = new PartageVue(this, ui, app);
        return partage;
    }

    /** Sélecteur d'Android pour choisir le fichier partagé (le Drive du compte de l'appareil y apparaît). */
    void choisirFichierPartage() {
        choixPartage.launch(new String[] {"*/*"});
    }

    /** Onglet Recherche (créé à la première visite). */
    RechercheVue recherche() {
        if (recherche == null) recherche = new RechercheVue(this, ui, app);
        return recherche;
    }

    /** Vrai numéro de la semaine d'un onglet (celle des lancements chargés, sinon le calendrier). */
    int numeroSemaine(String parite) {
        List<String> semaines = new ArrayList<>();
        for (Paire p : depot.pairesDeLaSemaine(parite)) if (p.strat != null) semaines.add(p.semaine);
        return Semaines.semaineAffichee(semaines, parite, Calendar.getInstance());
    }

    /** « Semaine 41 » : nom de l'onglet, du compteur et des messages. */
    String libelleOnglet(String parite) {
        return "Semaine " + numeroSemaine(parite);
    }

    /** Met les vrais numéros de semaine sur les onglets ; vrai si celui de l'onglet affiché a changé. */
    private boolean majOnglets() {
        if (onglets == null) return false;
        boolean ongletAfficheChange = false;
        for (int i = 0; i < onglets.getTabCount(); i++) {
            TabLayout.Tab t = onglets.getTabAt(i);
            if (t == null || ONGLET_RECHERCHE.equals(t.getTag()) || ONGLET_PARTAGE.equals(t.getTag())) continue;
            String libelle = libelleOnglet((String) t.getTag());
            if (t.getText() == null || !libelle.contentEquals(t.getText())) {
                t.setText(libelle);
                if (t.getTag().equals(onglet)) ongletAfficheChange = true;
            }
        }
        return ongletAfficheChange;
    }

    /**
     * Un chantier va dans l'onglet de sa vraie semaine (celle du lancement
     * écrite dans le fichier), même si le nom du fichier en dit une autre ;
     * vrai s'il a changé d'onglet.
     */
    private static boolean ranger(Paire p) {
        String parite = Depot.pariteDuNumero(p.semaine);
        if (!p.estChantier() || parite == null || parite.equals(p.parite)) return false;
        p.parite = parite;
        return true;
    }

    /** Titre d'une case : le poste (la semaine est déjà sur l'onglet), ou le chantier. */
    private static String titreCase(Paire p) {
        return p.estChantier() ? p.titre() : p.poste;
    }

    private boolean ongletSemaine() {
        return Depot.PAIRE.equals(onglet) || Depot.IMPAIRE.equals(onglet);
    }

    // ---- construction de l'écran ----

    void afficher() {
        contenu.removeAllViews();
        cartes.clear();
        zonesCasse.clear();
        texteCompteur = null;
        zoneRecap = null;
        zonesDiakonos.clear();
        zonesDiakonosParCase.clear();
        majOnglets();
        if (ongletSemaine()) {
            construireSemaine(onglet);
        } else if (ONGLET_PARTAGE.equals(onglet)) {
            contenu.addView(partage().vue());
        } else {
            contenu.addView(recherche().vue());
        }
    }

    private void construireSemaine(String parite) {
        MaterialCardView carteCompteur = ui.carte();
        carteCompteur.setCardBackgroundColor(ui.couleur(R.color.marque_clair));
        carteCompteur.setStrokeColor(ui.couleur(R.color.marque_bord));
        texteCompteur = ui.texte("…", 16, true,
                ui.couleur(R.color.marque_fonce));
        texteCompteur.setGravity(Gravity.CENTER);
        texteCompteur.setPadding(ui.dp(12), ui.dp(14), ui.dp(12), ui.dp(14));
        carteCompteur.addView(texteCompteur);
        contenu.addView(carteCompteur);
        majCompteur();

        MaterialButton exporter = ui.bouton("Exporter le rapport de la semaine (.xlsx)");
        exporter.setOnClickListener(v -> exporterSemaine(parite));
        contenu.addView(exporter, ui.marges(0, 6));

        MaterialCardView carteRecap = ui.carte();
        LinearLayout corpsRecap = ui.colonne();
        corpsRecap.setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(12));
        carteRecap.addView(corpsRecap);
        corpsRecap.addView(ui.texte("📋 Lancements", 16, true, 0xFF263238), ui.marges(0, 6));
        zoneRecap = ui.colonne();
        corpsRecap.addView(zoneRecap, ui.pleineLargeur());
        contenu.addView(carteRecap);
        majRecap();

        contenu.addView(carteDossierPartage(parite));

        LinearLayout actions = ui.rangee();
        MaterialButton lancerTout = ui.bouton("Lancer le(s) contrôle(s)");
        lancerTout.setOnClickListener(v -> lancerTousLesControles());
        actions.addView(lancerTout, ui.poids(1));
        View espace = new View(this);
        actions.addView(espace, new LinearLayout.LayoutParams(ui.dp(8), 1));
        MaterialButton reinit = ui.boutonContour("↺ Réinitialiser la semaine");
        reinit.setOnClickListener(v -> reinitialiserSemaine());
        actions.addView(reinit, ui.poids(1));
        contenu.addView(actions, ui.marges(4, 8));

        for (String poste : Depot.POSTES_SEMAINE) contenu.addView(carteDe(depot.paireFixe(poste, parite)));

        contenu.addView(titrePoste(Depot.POSTE_CHANTIERS));
        for (Paire c : depot.chantiers(parite)) contenu.addView(carteDe(c));
        MaterialButton ajouter = ui.boutonContour("+ Ajouter un chantier");
        ajouter.setOnClickListener(v -> {
            depot.ajouterChantier(parite);
            afficher();
            defilement.post(() -> defilement.fullScroll(View.FOCUS_DOWN));
        });
        contenu.addView(ajouter, ui.marges(2, 0));
        majDiakonos();
    }

    private TextView titrePoste(String poste) {
        TextView t = ui.texte(poste, 17, true, 0xFF263238);
        t.setPadding(ui.dp(2), ui.dp(14), 0, ui.dp(2));
        return t;
    }

    private View carteDe(Paire p) {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = ui.colonne();
        corps.setPadding(ui.dp(14), ui.dp(10), ui.dp(14), ui.dp(12));
        carte.addView(corps);
        cartes.put(p, corps);
        remplirCarte(corps, p);
        return carte;
    }

    private void rafraichir(Paire p) {
        if (p.estDiakonos()) {
            // Le fichier Diakonos est affiché dans toutes les cases de son tour.
            for (Map.Entry<LinearLayout, Paire> e : zonesDiakonos.entrySet()) if (e.getValue() == p) remplirZoneDiakonos(p, e.getKey());
        } else {
            LinearLayout corps = cartes.get(p);
            if (corps != null) {
                corps.removeAllViews();
                remplirCarte(corps, p);
            }
        }
        // Nouvelle semaine pour l'onglet (premier fichier chargé...) : compteur, dossier et cases en dépendent.
        if (majOnglets()) afficher();
        else {
            majRecap();
            majDiakonos();
        }
    }

    // ---- récapitulatif des lancements ----

    private void majRecap() {
        if (!ongletSemaine() || zoneRecap == null) return;
        final String parite = onglet;
        final int numero = ++generationRecap;
        final String autre = Depot.PAIRE.equals(parite) ? Depot.IMPAIRE : Depot.PAIRE;
        final List<RecapLancements.Ligne> lignes = RecapLancements.lignes(depot.pairesDeLaSemaine(parite), controles);
        final List<RecapLancements.Ligne> autres = RecapLancements.lignes(depot.pairesDeLaSemaine(autre), controles);
        zoneRecap.removeAllViews();
        zoneRecap.addView(RecapLancements.tableau(this, ui, lignes, autres, libelleOnglet(autre), this::allerALaCase));
        if (!RecapLancements.incomplet(lignes) && !RecapLancements.incomplet(autres)) return;
        // Lecture des fichiers pour les totaux manquants, puis nouvel affichage.
        app.annexe.execute(() -> {
            for (RecapLancements.Ligne l : lignes) controles.resume(l.paire.strat, l.paire.bkp);
            for (RecapLancements.Ligne l : autres) controles.resume(l.paire.strat, l.paire.bkp);
            principal.post(() -> {
                if (numero == generationRecap && parite.equals(onglet)) majRecap();
            });
        });
    }

    // ---- Diakonos ----

    /** Recalcule les pièces Diakonos manquantes, affichées dans les cases Agglo. */
    private void majDiakonos() {
        if (!ongletSemaine()) return;
        final String parite = onglet;
        remplirDiakonos();
        final List<Paire> fichiers = new ArrayList<>();
        for (Paire p : depot.diakonos(parite)) if (p.strat != null) fichiers.add(p);
        if (fichiers.isEmpty()) return;
        final int numero = ++generationDiakonos;
        final String semaine = String.format(Locale.ROOT, "%02d", numeroSemaine(parite));
        final List<Paire> semaineListe = depot.pairesDeLaSemaine(parite);
        final List<Paire> toutes = new ArrayList<>(semaineListe);
        toutes.addAll(depot.pairesDeLaSemaine(Depot.PAIRE.equals(parite) ? Depot.IMPAIRE : Depot.PAIRE));
        app.annexe.execute(() -> {
            Map<String, ControleDiakonos.Resultat> calcules = new HashMap<>();
            for (Paire p : fichiers) calcules.put(p.cle(), ControleDiakonos.calculer(p, semaine, semaineListe, toutes, controles));
            principal.post(() -> {
                resultatsDiakonos.putAll(calcules);
                if (numero == generationDiakonos && parite.equals(onglet)) remplirDiakonos();
            });
        });
    }

    /** Remplit, dans chaque case affichée, les zones du contrôle Diakonos de son tour. */
    private void remplirDiakonos() {
        for (Map.Entry<LinearLayout, Paire> e : zonesDiakonos.entrySet()) remplirZoneDiakonos(e.getValue(), e.getKey());
    }

    private void remplirZoneDiakonos(Paire p, LinearLayout zone) {
        zone.removeAllViews();
        zone.addView(ligneFichier(p, Paire.STRAT, "Diakonos " + ControleDiakonos.libelleTour(ControleDiakonos.tour(p)) + " (.xlsx)"));
        if (p.etat != null) {
            zone.addView(ui.texte(p.etat, 13, false,
                    p.etatErreur ? ui.couleur(R.color.alerte_texte) : ui.couleur(R.color.gris_texte)), ui.marges(4, 0));
        }
        if (p.strat == null) return;
        ControleDiakonos.Resultat r = resultatsDiakonos.get(p.cle());
        if (r == null || !r.fichier.equals(p.strat.nom)) {
            zone.addView(ui.texte("…", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(4, 0));
            return;
        }
        afficherDiakonos(zone, r);
    }

    private void afficherDiakonos(LinearLayout zoneDiakonos, ControleDiakonos.Resultat r) {
        String tour = ControleDiakonos.libelleTour(r.tour);
        if (r.erreur != null) {
            zoneDiakonos.addView(ui.bandeau("❌ Diakonos illisible : " + r.erreur, ui.couleur(R.color.alerte_fond),
                    ui.couleur(R.color.alerte_texte)), ui.marges(6, 0));
            return;
        }
        if (r.lancements.isEmpty()) {
            zoneDiakonos.addView(ui.bandeau("⚠ Aucun lancement du " + tour + " (semaine " + r.semaine + ") chargé",
                    ui.couleur(R.color.attention_fond), ui.couleur(R.color.attention_texte)), ui.marges(6, 0));
            return;
        }
        if (r.manquantes.isEmpty()) {
            zoneDiakonos.addView(ui.bandeau("✔ Les " + r.nbPieces + " pièces Diakonos sont dans les lancements du " + tour,
                    ui.couleur(R.color.ok_fond), ui.couleur(R.color.ok_texte)), ui.marges(6, 0));
        } else {
            zoneDiakonos.addView(ui.bandeau("⚠ " + r.manquantes.size() + " pièce(s) Diakonos absente(s) des lancements du " + tour,
                    ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)), ui.marges(6, 0));
            int n = Math.min(r.manquantes.size(), LIMITE_LIGNES);
            for (int i = 0; i < n; i++) {
                LecteurDiakonos.Piece m = r.manquantes.get(i);
                StringBuilder sb = new StringBuilder(m.cle);
                if (!m.article.isEmpty()) sb.append(" · ").append(m.article);
                if (!m.dimensions().isEmpty()) sb.append(" · ").append(m.dimensions());
                if (!m.coloris.isEmpty()) sb.append(" · coloris ").append(m.coloris);
                String ailleurs = r.ailleurs.get(m.cle);
                if (ailleurs != null) sb.append(" — lancée dans ").append(ailleurs);
                TextView t = ui.texte(sb, 13, false, 0xFF3E4C59);
                t.setPadding(0, ui.dp(4), 0, 0);
                zoneDiakonos.addView(t);
            }
            if (r.manquantes.size() > n) {
                zoneDiakonos.addView(ui.texte("… et " + (r.manquantes.size() - n) + " autre(s) (voir le rapport exporté)", 13, false,
                        ui.couleur(R.color.gris_texte)));
            }
        }
        zoneDiakonos.addView(ui.texte("Comparé à : " + TextUtils.join(", ", r.lancements), 12, false,
                ui.couleur(R.color.gris_texte)), ui.marges(4, 0));
    }

    private void allerALaCase(Paire p) {
        LinearLayout corps = cartes.get(p);
        if (corps == null || !(corps.getParent() instanceof View)) return;
        View carte = (View) corps.getParent();
        defilement.smoothScrollTo(0, Math.max(0, carte.getTop() - ui.dp(40)));
    }

    private void remplirCarte(LinearLayout corps, Paire p) {
        LinearLayout entete = ui.rangee();
        TextView titre = ui.texte(titreCase(p), 16, true, 0xFF1F2933);
        entete.addView(titre, ui.poids(1));
        if (p.estChantier()) {
            MaterialButton retirer = ui.boutonTexte("✕ Retirer");
            retirer.setTextColor(ui.couleur(R.color.alerte_texte));
            retirer.setOnClickListener(v -> retirerChantier(p));
            entete.addView(retirer);
        }
        MaterialButton reinit = ui.boutonTexte("↺ Réinitialiser");
        reinit.setOnClickListener(v -> confirmer("Réinitialiser « " + titreCase(p) + " » ?",
                "Les fichiers et résultats de cette case seront effacés.", () -> {
                    depot.reinitialiser(p);
                    String tour = ControleDiakonos.tourDeLaCase(p);
                    if (tour != null) depot.reinitialiser(depot.paireDiakonos(tour, p.parite));
                    listesDepliees.remove(p);
                    rafraichir(p);
                    majCompteur();
                }));
        entete.addView(reinit);
        corps.addView(entete);

        // Dans l'ordre de l'atelier : Diakonos, lancement, liste de coupe, .bkp, sommaire.
        List<LinearLayout> anciennes = zonesDiakonosParCase.remove(p);
        if (anciennes != null) for (LinearLayout z : anciennes) zonesDiakonos.remove(z);
        if (ongletSemaine()) {
            List<LinearLayout> zones = new ArrayList<>();
            for (String tourDiakonos : ControleDiakonos.toursDeLaCase(p)) {
                Paire d = depot.paireDiakonos(tourDiakonos, p.parite);
                LinearLayout zone = ui.colonne();
                corps.addView(zone, ui.pleineLargeur());
                zonesDiakonos.put(zone, d);
                zones.add(zone);
                remplirZoneDiakonos(d, zone);
            }
            zonesDiakonosParCase.put(p, zones);
        }
        corps.addView(ligneFichier(p, Paire.STRAT, "Lancement"));
        corps.addView(ligneFichier(p, Paire.COUPE, "Liste de coupe"));
        corps.addView(ligneFichier(p, Paire.BKP, "Fichier .bkp"));
        corps.addView(ligneFichier(p, Paire.SOMMAIRE, "Sommaire Cut Rite (.pdf)"));

        LinearLayout boutons = ui.rangee();
        MaterialButton go = ui.bouton("GO");
        go.setEnabled(!p.enCours);
        go.setOnClickListener(v -> lancerUnePaire(p, null));
        boutons.addView(go, ui.poids(1));
        boutons.addView(new View(this), new LinearLayout.LayoutParams(ui.dp(8), 1));
        MaterialButton scies = ui.boutonContour("Vérifier Scies");
        scies.setEnabled(!p.enCours);
        scies.setOnClickListener(v -> lancerControleScies(p));
        boutons.addView(scies, ui.poids(1));
        corps.addView(boutons, ui.marges(8, 0));
        MaterialButton rapportLancement = ui.boutonContour("📄 Rapport du lancement (.pdf)");
        rapportLancement.setEnabled(!p.enCours);
        rapportLancement.setOnClickListener(v -> exporterLancement(p));
        corps.addView(rapportLancement, ui.marges(4, 0));

        if (p.etat != null) {
            TextView etat = ui.texte(p.etat, 14, false,
                    p.etatErreur ? ui.couleur(R.color.alerte_texte) : ui.couleur(R.color.gris_texte));
            corps.addView(etat, ui.marges(6, 0));
        }

        if (p.rapport != null) afficherRapport(corps, p);
        if (p.ecartsScies != null || p.erreurScies != null) afficherScies(corps, p);
        if ("Casse".equals(p.poste) && p.strat != null && ongletSemaine()) {
            LinearLayout zone = ui.colonne();
            corps.addView(zone, ui.pleineLargeur());
            zonesCasse.put(p, zone);
            remplirCasse(p, zone);
        }
    }

    // ---- casse : pièces déjà lancées la semaine d'avant ----

    private void remplirCasse(Paire p, LinearLayout zone) {
        zone.removeAllViews();
        final String parite = p.parite;
        final String autre = Depot.PAIRE.equals(parite) ? Depot.IMPAIRE : Depot.PAIRE;
        final List<Paire> autreSemaine = depot.pairesDeLaSemaine(autre);
        final int numeroAutre = numeroSemaine(autre);
        final String cle = ControleCasse.cle(p, autreSemaine, numeroAutre);
        ControleCasse.Resultat r = resultatsCasse.get(p.cle());
        if (r == null || !r.cle.equals(cle)) {
            zone.addView(ui.texte("…", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(6, 0));
            if (casseEnCours.add(cle)) {
                app.annexe.execute(() -> {
                    ControleCasse.Resultat calcule = ControleCasse.calculer(p, autreSemaine, numeroAutre, controles);
                    principal.post(() -> {
                        casseEnCours.remove(cle);
                        resultatsCasse.put(p.cle(), calcule);
                        LinearLayout z = zonesCasse.get(p);
                        if (z != null) remplirCasse(p, z);
                    });
                });
            }
            return;
        }
        zone.addView(ui.separateur());
        if (r.erreur != null) {
            zone.addView(ui.texte("Casse illisible : " + r.erreur, 13, false, ui.couleur(R.color.alerte_texte)), ui.marges(6, 0));
            return;
        }
        if (r.autreSemaineChargee != null) {
            zone.addView(ui.texte("Pour retrouver les pièces déjà lancées, chargez la semaine " + (r.semaineAvant == null ? "d'avant" : r.semaineAvant)
                    + " dans l'autre onglet.", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(6, 0));
            return;
        }
        if (r.dejaLancees.isEmpty()) {
            zone.addView(ui.bandeau("Casse : aucune pièce n'était lancée en semaine " + r.semaineAvant,
                    ui.couleur(R.color.ok_fond), ui.couleur(R.color.ok_texte)), ui.marges(6, 0));
            return;
        }
        zone.addView(ui.bandeau("🔁 " + r.dejaLancees.size() + " pièce(s) de la casse déjà lancée(s) en semaine " + r.semaineAvant,
                ui.couleur(R.color.attention_fond), ui.couleur(R.color.attention_texte)), ui.marges(6, 0));
        for (ControleCasse.Trouvee t : r.dejaLancees) {
            TextView l = ui.texte(ControleCasse.description(t.ligne, " · ") + " — " + t.lancement, 13, false, 0xFF3E4C59);
            l.setPadding(0, ui.dp(4), 0, 0);
            zone.addView(l);
        }
        if (r.nbAutres > 0) {
            zone.addView(ui.texte(r.nbAutres + " autre(s) pièce(s) pas lancée(s) en semaine " + r.semaineAvant, 12, false,
                    ui.couleur(R.color.gris_texte)), ui.marges(4, 0));
        }
    }

    // ---- lancement corrigé : un nouveau fichier, l'original n'est jamais modifié ----

    void creerSansDoublons(Paire p) {
        if (p.strat == null) return;
        cleCorrection = p.cle();
        try {
            creationCorrection.launch(com.marinedouyere.sentinelle.moteur.CorrectionLancement.nomCorrige(p.strat.nom));
        } catch (Exception e) {
            cleCorrection = null;
            alerte("Impossible d'enregistrer le lancement corrigé :\n" + e.getMessage());
        }
    }

    void emplacementCorrectionChoisi(Uri uri) {
        Paire p = cleCorrection == null ? null : paireParCle(cleCorrection);
        cleCorrection = null;
        if (uri == null || p == null) return;
        corrigerVers(p, uri);
    }

    void corrigerVers(Paire p, Uri uri) {
        final Paire.Fichier strat = p.strat;
        app.annexe.execute(() -> {
            String message;
            boolean erreur = false;
            try {
                com.marinedouyere.sentinelle.moteur.CorrectionLancement.Doublons d =
                        com.marinedouyere.sentinelle.moteur.CorrectionLancement.doublons(controles.classeur(strat));
                if (d.lignes.isEmpty()) {
                    message = "Aucune ligne en double dans " + strat.nom + " : rien à corriger.";
                } else {
                    byte[] octets = com.marinedouyere.sentinelle.moteur.CorrectionLancement.sansDoublons(Controles.lireOctets(strat.fichier()), d);
                    try (OutputStream sortie = "file".equals(uri.getScheme())
                            ? new FileOutputStream(new File(uri.getPath()))
                            : getContentResolver().openOutputStream(uri, "wt")) {
                        if (sortie == null) throw new IOException("emplacement inaccessible");
                        sortie.write(octets);
                    }
                    message = d.lignes.size() + " ligne(s) en double supprimée(s) (" + TextUtils.join(", ", d.cles) + ").\n"
                            + "Nouveau fichier : " + nomAffiche(this, uri) + "\nL'original " + strat.nom + " n'a pas changé.";
                }
            } catch (Exception e) {
                erreur = true;
                message = "Impossible de créer le lancement corrigé :\n" + (e.getMessage() != null ? e.getMessage() : e);
            }
            final String m = message;
            final boolean err = erreur;
            principal.post(() -> {
                p.etat = err ? "❌ " + m.replace('\n', ' ') : "✔ " + m.substring(0, m.indexOf('\n') > 0 ? m.indexOf('\n') : m.length());
                p.etatErreur = err;
                rafraichir(p);
                alerte(m);
            });
        });
    }

    // ---- rapport du lancement : sommaire Cut Rite (agglo, strats, couleurs) et Diakonos de son tour ----

    private boolean aDiakonos(Paire p) {
        String tour = ControleDiakonos.tourDeLaCase(p);
        return tour != null && depot.paireDiakonos(tour, p.parite).strat != null;
    }

    /** Casse (case Casse ou lancement « …CASSE ») : le rapport détaille les pièces relancées et les rajouts. */
    private static boolean estCasse(Paire p, String nomLancement) {
        return "Casse".equals(p.poste) || (nomLancement != null && nomLancement.toUpperCase(Locale.ROOT).contains("CASSE"));
    }

    void exporterLancement(Paire p) {
        if (p.sommaire == null && !aDiakonos(p) && !(p.strat != null && estCasse(p, p.strat.nom))) {
            alerte(titreCase(p) + " : ajoutez le sommaire Cut Rite" + (ControleDiakonos.tourDeLaCase(p) != null ? " (ou le fichier Diakonos)" : "")
                    + " pour faire le rapport du lancement.");
            return;
        }
        cleRapportLancement = p.cle();
        String base = RapportsSommaire.base(p.strat != null ? p.strat.nom : p.sommaire != null ? p.sommaire.nom : titreCase(p));
        try {
            creationRapportLancement.launch(base + "_rapport_lancement.pdf");
        } catch (Exception e) {
            cleRapportLancement = null;
            alerte("Impossible d'enregistrer le rapport :\n" + e.getMessage());
        }
    }

    void emplacementRapportLancementChoisi(Uri uri) {
        Paire p = cleRapportLancement == null ? null : paireParCle(cleRapportLancement);
        cleRapportLancement = null;
        if (uri == null || p == null) return;
        exporterLancementVers(p, uri);
    }

    void exporterLancementVers(Paire p, Uri uri) {
        final String autre = Depot.PAIRE.equals(p.parite) ? Depot.IMPAIRE : Depot.PAIRE;
        final List<Paire> semaine = depot.pairesDeLaSemaine(p.parite);
        final List<Paire> autreSemaine = depot.pairesDeLaSemaine(autre);
        final List<Paire> toutes = new ArrayList<>(semaine);
        toutes.addAll(autreSemaine);
        final String numero = String.format(Locale.ROOT, "%02d", numeroSemaine(p.parite));
        final int numeroAutre = numeroSemaine(autre);
        final String tour = ControleDiakonos.tourDeLaCase(p);
        final Paire diakonos = tour != null ? depot.paireDiakonos(tour, p.parite) : null;
        app.annexe.execute(() -> {
            String erreur = null;
            try {
                byte[] octets = rapportLancement(p, diakonos, numero, semaine, toutes, autreSemaine, numeroAutre);
                try (OutputStream sortie = "file".equals(uri.getScheme())
                        ? new FileOutputStream(new File(uri.getPath()))
                        : getContentResolver().openOutputStream(uri, "wt")) {
                    if (sortie == null) throw new IOException("emplacement inaccessible");
                    sortie.write(octets);
                }
            } catch (Exception e) {
                erreur = e.getMessage() != null ? e.getMessage() : e.toString();
            }
            final String err = erreur;
            principal.post(() -> {
                if (err != null) alerte("Impossible d'enregistrer le rapport du lancement :\n" + err);
                else android.widget.Toast.makeText(this, "Rapport enregistré : " + nomAffiche(this, uri), android.widget.Toast.LENGTH_LONG).show();
            });
        });
    }

    /**
     * Hors du fil d'affichage : une page par liste du sommaire (agglo, strats, couleurs), puis le Diakonos du tour
     * ou, pour la casse, les pièces relancées et les rajouts.
     */
    byte[] rapportLancement(Paire p, Paire diakonos, String numero, List<Paire> semaine, List<Paire> toutes, List<Paire> autreSemaine,
            int numeroAutre) throws Exception {
        List<RapportsSommaire.Partie> parties = new ArrayList<>();
        SommaireCutRite s = null;
        if (p.sommaire != null) {
            s = SommaireCutRite.lire(controles.lignesPdf(Controles.lireOctets(p.sommaire.fichier())));
            parties.addAll(RapportsSommaire.parties(s));
        }
        String nomLancement = p.strat != null ? p.strat.nom : s != null ? s.lancement : titreCase(p);
        String base = s != null ? RapportsSommaire.base(s) : RapportsSommaire.base(nomLancement);
        if (diakonos != null && diakonos.strat != null) {
            parties.add(ControleDiakonos.partie(ControleDiakonos.calculer(diakonos, numero, semaine, toutes, controles), base));
        }
        boolean casse = estCasse(p, nomLancement);
        if (casse && p.strat != null) parties.addAll(ControleCasse.parties(ControleCasse.calculer(p, autreSemaine, numeroAutre, controles), base));
        String nbPieces = null;
        if (p.strat != null) {
            double prevues = controles.resume(p.strat, p.bkp).prevues;
            if (!Double.isNaN(prevues)) nbPieces = Js.entierTronque(prevues);
        }
        String sem = p.semaine != null ? p.semaine : s != null ? LecteurStrat.extraireSemaine(s.lancement) : null;
        String couleur = SommaireCutRite.couleurSemaine(sem != null ? Integer.parseInt(sem) : Integer.parseInt(numero), casse);
        String enTete = titreCase(p);
        String sousTitre = s != null ? RapportsSommaire.sousTitre(s) : nomLancement.replaceAll("\\.[A-Za-z]+$", "");
        return RapportsSommaire.rapportLancement(base + " — Rapport du lancement", enTete, sousTitre, sem != null ? sem : numero, nbPieces, couleur,
                parties);
    }

    private View ligneFichier(Paire p, String role, String libelle) {
        LinearLayout ligne = ui.rangee();
        LinearLayout textes = ui.colonne();
        textes.addView(ui.texte(libelle, 12, false, ui.couleur(R.color.gris_texte)));
        Paire.Fichier f = p.fichier(role);
        TextView nom = ui.texte(f != null ? "✓ " + f.nom : "Aucun fichier", 14, f != null,
                f != null ? ui.couleur(R.color.ok_texte) : 0xFF9AA5B1);
        nom.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        nom.setSingleLine(true);
        textes.addView(nom);
        ligne.addView(textes, ui.poids(1));
        MaterialButton choisir = ui.boutonContour(f != null ? "Changer" : "Choisir");
        choisir.setOnClickListener(v -> demanderFichier(p, role));
        ligne.addView(choisir);
        ligne.setPadding(0, ui.dp(6), 0, 0);
        return ligne;
    }

    private void afficherRapport(LinearLayout corps, Paire p) {
        Comparateur.Rapport r = p.rapport;
        corps.addView(ui.separateur());
        // En pièces finies : une pièce assemblée (Feno : compact + support) compte une fois.
        boolean enPieces = r.piecesAttendues > 0 || r.piecesTrouvees > 0;
        String attendu = Js.entierTronque(enPieces ? r.piecesAttendues : r.totalAttendu);
        String trouve = Js.nombre(enPieces ? r.piecesTrouvees : r.totalTrouve);
        if (r.nbAnomalies == 0) {
            corps.addView(ui.bandeau("✔ Tout est correct — " + attendu + " pièces",
                    ui.couleur(R.color.ok_fond), ui.couleur(R.color.ok_texte)));
        } else {
            corps.addView(ui.bandeau("⚠ " + r.nbAnomalies + " anomalie(s) — " + attendu + " attendues, "
                    + trouve + " trouvées",
                    ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)));
        }
        List<String> details = new ArrayList<>();
        if ("bkp".equals(p.source)) details.add("Comparé au .bkp");
        if (p.nbUnitaires != null && p.nbPiecesTrouvees != null && p.nbPiecesTrouvees != 0) {
            double unitaire = p.nbUnitaires * 100.0 / p.nbPiecesTrouvees;
            double grain = (p.nbPiecesTrouvees - p.nbUnitaires) * 100.0 / p.nbPiecesTrouvees;
            details.add(pourcent(unitaire) + " % unitaire · " + pourcent(grain) + " % grain matching");
        }
        if (!details.isEmpty()) {
            corps.addView(ui.texte(TextUtils.join(" · ", details), 13, false, ui.couleur(R.color.gris_texte)), ui.marges(4, 0));
        }

        afficherSemainesLivraison(corps, p);

        if (!p.doublons.isEmpty()) {
            StringBuilder sb = new StringBuilder();
            sb.append("⚠ ").append(p.doublons.size()).append(" doublon(s) dans le lancement");
            for (LecteurStrat.Doublon d : p.doublons) {
                List<String> q = new ArrayList<>();
                for (Double v : d.quantites) q.add(Js.nombre(v));
                sb.append("\n• Commande ").append(d.commande).append(", ligne ").append(d.ligne).append(" (clé ")
                        .append(d.cle).append(") : ").append(d.nbLignes).append(" lignes — articles ")
                        .append(TextUtils.join(" / ", d.articles)).append(", quantités ").append(TextUtils.join(" + ", q))
                        .append(".");
            }
            TextView doublons = ui.bandeau(sb, ui.couleur(R.color.attention_fond), ui.couleur(R.color.attention_texte));
            doublons.setTypeface(null, android.graphics.Typeface.NORMAL);
            corps.addView(doublons, ui.marges(6, 0));
            MaterialButton corriger = ui.boutonContour("✂ Créer le lancement sans doublons (.xlsx)");
            corriger.setOnClickListener(v -> creerSansDoublons(p));
            corps.addView(corriger, ui.marges(4, 0));
        }

        List<Comparateur.LigneRapport> anomalies = r.anomalies();
        boolean tout = listesDepliees.contains(p) || anomalies.size() <= LIMITE_LIGNES;
        int n = tout ? anomalies.size() : LIMITE_LIGNES;
        for (int i = 0; i < n; i++) corps.addView(ligneAnomalie(anomalies.get(i)));
        if (!tout) {
            MaterialButton plus = ui.boutonTexte("Afficher les " + anomalies.size() + " anomalies");
            plus.setOnClickListener(v -> {
                listesDepliees.add(p);
                rafraichir(p);
            });
            corps.addView(plus);
        }
    }

    private static String pourcent(double v) {
        return String.format(Locale.ROOT, "%.1f", v).replace(".", ",");
    }

    private View ligneAnomalie(Comparateur.LigneRapport l) {
        LinearLayout ligne = ui.colonne();
        int fond;
        int texte;
        if (Comparateur.MANQUANT.equals(l.statut)) {
            fond = 0xFFFFE3E6;
            texte = ui.couleur(R.color.alerte_texte);
        } else {
            fond = 0xFFFFF4D6;
            texte = ui.couleur(R.color.attention_texte);
        }
        android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
        g.setColor(fond);
        g.setCornerRadius(ui.dp(6));
        ligne.setBackground(g);
        ligne.setPadding(ui.dp(10), ui.dp(6), ui.dp(10), ui.dp(6));
        LinearLayout haut = ui.rangee();
        haut.addView(ui.texte(l.commande + (l.ligne.isEmpty() ? "" : " · ligne " + l.ligne), 14, true, 0xFF1F2933),
                ui.poids(1));
        haut.addView(ui.texte(l.statut, 13, true, texte));
        ligne.addView(haut);
        StringBuilder detail = new StringBuilder();
        if (!l.article.isEmpty()) detail.append(l.article).append(" · ");
        if (!l.lancement.isEmpty()) detail.append(l.lancement).append(" · ");
        if (l.couches > 1) {
            // Pièce assemblée : les quantités comptent les couches (compact, support…).
            detail.append(Js.nombre(l.piecesAttendues)).append(" pièce(s) de ").append(l.couches).append(" couches : ")
                    .append(Js.nombre(l.qteAttendue)).append(" couches attendues, ").append(Js.nombre(l.qteTrouvee))
                    .append(" trouvée(s)");
        } else {
            detail.append("attendu ").append(Js.nombre(l.qteAttendue)).append(", trouvé ").append(Js.nombre(l.qteTrouvee))
                    .append(" (écart ").append(Js.nombre(l.ecart)).append(")");
        }
        ligne.addView(ui.texte(detail, 13, false, 0xFF3E4C59));
        LinearLayout.LayoutParams lp = ui.pleineLargeur();
        lp.setMargins(0, ui.dp(5), 0, 0);
        ligne.setLayoutParams(lp);
        return ligne;
    }

    private void afficherScies(LinearLayout corps, Paire p) {
        corps.addView(ui.separateur());
        if (p.erreurScies != null) {
            corps.addView(ui.bandeau("❌ Scies : " + p.erreurScies, ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)));
            return;
        }
        String panneaux = Js.nombre(p.totalScies == null ? 0 : p.totalScies) + " panneaux";
        if (p.ecartsScies.isEmpty()) {
            corps.addView(ui.bandeau("✔ Scies : tout correspond — " + panneaux, ui.couleur(R.color.ok_fond), ui.couleur(R.color.ok_texte)));
        } else {
            corps.addView(ui.bandeau("⚠ Scies : " + p.ecartsScies.size() + " écart(s) sur " + panneaux,
                    ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)));
            for (LecteurBkp.Ecart e : p.ecartsScies) {
                TextView t = ui.texte(e.cle + " — attendu " + Js.nombre(e.attendu) + ", .bkp " + Js.nombre(e.trouve)
                        + " — " + e.type(), 13, false, 0xFF3E4C59);
                t.setPadding(0, ui.dp(4), 0, 0);
                corps.addView(t);
            }
        }
        afficherCouleurs(corps, p.couleurs);
    }

    /** Pièces d'un lancement à livrer une autre semaine que les autres (en retard, le plus souvent). */
    private void afficherSemainesLivraison(LinearLayout corps, Paire p) {
        if (p.semainesLivraison.size() <= 1 || "Casse".equals(p.poste)) return;
        LecteurStrat.SemaineLivraison principale = p.semainesLivraison.get(0);
        for (LecteurStrat.SemaineLivraison s : p.semainesLivraison) if (s.nbPieces > principale.nbPieces) principale = s;
        StringBuilder sb = new StringBuilder("⚠ Livraison de plusieurs semaines (principale : semaine " + principale.semaine + ")");
        for (LecteurStrat.SemaineLivraison s : p.semainesLivraison) {
            if (s == principale) continue;
            int n = s.cles.size();
            sb.append("\nSemaine ").append(s.semaine).append(" : ").append(s.nbPieces).append(" pièce(s) — ")
                    .append(n <= 6 ? String.join(", ", s.cles) : String.join(", ", s.cles.subList(0, 6)) + "…");
        }
        TextView t = ui.bandeau(sb, ui.couleur(R.color.attention_fond), ui.couleur(R.color.attention_texte));
        t.setTypeface(null, android.graphics.Typeface.NORMAL);
        corps.addView(t, ui.marges(6, 0));
    }

    /** Contrôle des couleurs : chaque coloris du lancement doit avoir été optimisé dans le .bkp. */
    private void afficherCouleurs(LinearLayout corps, ControleCouleurs.Resultat c) {
        if (c == null) return;
        if (c.sansStratifie) {
            corps.addView(ui.texte("Couleurs : pas de stratifié dans ce .bkp", 13, false, ui.couleur(R.color.gris_texte)),
                    ui.marges(6, 0));
            return;
        }
        if (c.absentes.isEmpty()) {
            corps.addView(ui.bandeau("✔ Couleurs : les " + c.nbCouleurs + " couleurs sont dans le .bkp",
                    ui.couleur(R.color.ok_fond), ui.couleur(R.color.ok_texte)), ui.marges(6, 0));
            return;
        }
        corps.addView(ui.bandeau("⚠ Couleurs : " + c.absentes.size() + " absente(s) du .bkp",
                ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)), ui.marges(6, 0));
        for (ControleCouleurs.Absente a : c.absentes) {
            int n = a.cles.size();
            String pieces = n <= 4 ? String.join(", ", a.cles) : String.join(", ", a.cles.subList(0, 4)) + "… (" + n + ")";
            TextView t = ui.texte(a.couleur + " (" + a.face + ") — " + Js.nombre(a.nbPieces) + " pièce(s) : " + pieces,
                    13, false, 0xFF3E4C59);
            t.setPadding(0, ui.dp(4), 0, 0);
            corps.addView(t);
        }
    }

    // ---- compteur ----

    private void majCompteur() {
        if (!ongletSemaine()) return;
        final String parite = onglet;
        final List<Paire.Fichier[]> cases = new ArrayList<>();
        for (Paire p : depot.pairesDeLaSemaine(parite)) if (p.bkp != null) cases.add(new Paire.Fichier[] {p.strat, p.bkp});
        app.annexe.execute(() -> {
            double total = 0;
            for (Paire.Fichier[] f : cases) {
                Double b = controles.resume(f[0], f[1]).bkp;
                if (b != null && !b.isNaN()) total += b;
            }
            final double t = total;
            principal.post(() -> {
                if (texteCompteur != null && parite.equals(onglet)) {
                    texteCompteur.setText(Js.nombre(t) + " pièces dans les .bkp");
                }
            });
        });
    }

    // ---- fichiers ----

    void demanderFichier(Paire p, String role) {
        cleEnAttente = p.cle();
        roleEnAttente = role;
        String[] types;
        switch (role) {
            case Paire.STRAT:
                types = new String[] {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "application/vnd.ms-excel.sheet.macroEnabled.12", "application/vnd.ms-excel", "application/octet-stream"};
                break;
            case Paire.SOMMAIRE:
                types = new String[] {"application/pdf"};
                break;
            case Paire.COUPE:
                types = new String[] {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "application/vnd.ms-excel.sheet.macroEnabled.12", "application/vnd.ms-excel", "application/pdf",
                    "application/octet-stream"};
                break;
            default:
                types = new String[] {"*/*"};
                break;
        }
        try {
            choixFichier.launch(types);
        } catch (Exception e) {
            alerte("Impossible d'ouvrir le sélecteur de fichiers : " + e.getMessage());
        }
    }

    private Paire paireParCle(String cle) {
        for (Paire p : depot.paires) if (p.cle().equals(cle)) return p;
        return null;
    }

    static String nomAffiche(android.content.Context c, Uri uri) {
        try (Cursor curseur = c.getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (curseur != null && curseur.moveToFirst()) {
                String nom = curseur.getString(0);
                if (nom != null) return nom;
            }
        } catch (Exception ignoree) {
            // fournisseur sans nom affichable : on se rabat sur l'adresse
        }
        String chemin = uri.getLastPathSegment();
        return chemin == null ? "fichier" : chemin.substring(chemin.lastIndexOf('/') + 1);
    }

    void fichierChoisi(Uri uri) {
        final Paire p = cleEnAttente == null ? null : paireParCle(cleEnAttente);
        final String role = roleEnAttente;
        cleEnAttente = null;
        roleEnAttente = null;
        if (uri == null || p == null || role == null) return;
        final String nom = nomAffiche(this, uri);
        String motCle = p.estDiakonos() ? "Diakonos" : Paire.STRAT.equals(role) ? "LAN" : Paire.COUPE.equals(role) ? "coupe"
                : Paire.SOMMAIRE.equals(role) ? ".pdf" : ".bkp";
        String type = p.estDiakonos() ? "Diakonos" : Paire.STRAT.equals(role) ? "lancement"
                : Paire.COUPE.equals(role) ? "liste de coupe" : Paire.SOMMAIRE.equals(role) ? "sommaire Cut Rite" : "sauvegarde d'optimisation";
        if (!nom.toLowerCase(Locale.ROOT).contains(motCle.toLowerCase(Locale.ROOT))) {
            alerte("« " + nom + " » ne ressemble pas à un fichier " + type + " (le nom devrait contenir « " + motCle
                    + " »).\nSélection annulée.");
            return;
        }
        p.etat = "copie du fichier…";
        p.etatErreur = false;
        rafraichir(p);
        app.annexe.execute(() -> {
            String erreur = null;
            boolean deplace = false;
            try (InputStream entree = getContentResolver().openInputStream(uri)) {
                if (entree == null) throw new java.io.IOException("fichier inaccessible");
                depot.copierFichier(p, role, nom, entree);
                if (p.estDiakonos()) {
                    p.semaine = LecteurDiakonos.decoderNom(nom).semaine;
                    controles.diakonos(p.strat);
                } else if (Paire.STRAT.equals(role)) {
                    p.semaine = controles.detecterSemaine(p);
                    deplace = ranger(p);
                } else if (Paire.SOMMAIRE.equals(role)) {
                    try {
                        SommaireCutRite.lire(controles.lignesPdf(Controles.lireOctets(p.sommaire.fichier())));
                    } catch (Exception e) {
                        // Pas un sommaire des matériaux : on ne le garde pas.
                        p.sommaire = null;
                        throw e;
                    }
                }
                depot.enregistrer(p);
            } catch (Exception e) {
                erreur = e.getMessage();
                depot.enregistrer(p);
            }
            final String err = erreur;
            final boolean dansAutreOnglet = deplace;
            principal.post(() -> {
                p.etat = err != null ? "Impossible de lire « " + nom + " » : " + err : null;
                p.etatErreur = err != null;
                if (Paire.STRAT.equals(role) && p.estChantier()) afficher();
                else rafraichir(p);
                if (Paire.BKP.equals(role)) majCompteur();
                if (dansAutreOnglet) alerte(p.label + " : lancement de la semaine " + p.semaine + ", rangé dans l'onglet " + libelleOnglet(p.parite) + ".");
            });
        });
    }

    // ---- contrôles ----

    interface FinControle {
        void fini(String erreur, boolean resultat);
    }

    /** Contrôle principal d'une case (bouton GO), comme lancerControlePaire() de l'appli web. */
    void lancerUnePaire(Paire p, FinControle fin) {
        final boolean seul = fin == null;
        if (p.strat == null && p.coupe == null && p.bkp == null) {
            p.etat = null;
            p.etatErreur = false;
            rafraichir(p);
            if (fin != null) fin.fini(null, false);
            return;
        }
        if (p.strat == null) {
            String msg = p.nomComplet() + " : sélectionnez le fichier de lancement.";
            p.etat = "❌ fichier de lancement manquant";
            p.etatErreur = true;
            rafraichir(p);
            if (seul) alerte(msg);
            else fin.fini(msg, false);
            return;
        }
        if (p.coupe == null && p.bkp == null) {
            p.etat = "Il manque la liste de coupe ou le .bkp";
            p.etatErreur = false;
            rafraichir(p);
            if (fin != null) fin.fini(null, false);
            return;
        }
        p.enCours = true;
        p.etat = "⏳ lecture du fichier de lancement…";
        p.etatErreur = false;
        rafraichir(p);
        app.fond.execute(() -> {
            final Controles.Etape etape = new Controles.Etape();
            try {
                final LecteurStrat.Resultat strat = controles.lireStrat(p);
                // Une casse reprend par nature des pièces de plusieurs semaines : pas de confirmation.
                if (strat.semaines.size() > 1 && !"Casse".equals(p.poste)) {
                    StringBuilder detail = new StringBuilder();
                    for (LecteurStrat.SemaineLivraison s : strat.semaines) {
                        detail.append("— semaine ").append(s.semaine).append("/").append(s.annee).append(" : ")
                                .append(s.nbPieces).append(" pièce(s)\n");
                    }
                    principal.post(() -> {
                        p.etat = "⚠️ semaines de livraison différentes détectées — confirmation demandée…";
                        rafraichir(p);
                        new AlertDialog.Builder(this)
                                .setTitle("⚠ Semaines de livraison différentes")
                                .setMessage(p.nomComplet() + " : plusieurs semaines de livraison différentes trouvées dans le fichier de lancement :\n\n"
                                        + detail + "\nNormalement, un fichier de lancement ne contient qu'une seule semaine de livraison. "
                                        + "Continuer quand même ?")
                                .setCancelable(false)
                                .setPositiveButton("Continuer", (d, w) -> app.fond.execute(() -> finirControle(p, strat, etape, fin)))
                                .setNegativeButton("Annuler", (d, w) -> {
                                    p.enCours = false;
                                    p.etat = "❌ contrôle annulé (semaines de livraison différentes)";
                                    p.etatErreur = true;
                                    rafraichir(p);
                                    String msg = p.nomComplet() + " : contrôle annulé — semaines de livraison différentes non confirmées.";
                                    if (fin == null) alerte(msg);
                                    else fin.fini(msg, false);
                                })
                                .show();
                    });
                    return;
                }
                finirControle(p, strat, etape, fin);
            } catch (Exception e) {
                echecControle(p, etape, e, fin);
            }
        });
    }

    private void finirControle(Paire p, LecteurStrat.Resultat strat, Controles.Etape etape, FinControle fin) {
        try {
            principal.post(() -> {
                p.etat = p.coupe != null ? "⏳ lecture de la liste de coupe…" : "⏳ comparaison avec le .bkp…";
                rafraichir(p);
            });
            controles.comparer(p, strat, etape);
            depot.enregistrer(p);
            principal.post(() -> {
                p.enCours = false;
                p.etatErreur = false;
                p.etat = null;
                listesDepliees.remove(p);
                rafraichir(p);
                if (fin != null) fin.fini(null, true);
            });
        } catch (Exception e) {
            echecControle(p, etape, e, fin);
        }
    }

    private void echecControle(Paire p, Controles.Etape etape, Exception e, FinControle fin) {
        String brut = e instanceof ErreurLecture || e.getMessage() != null ? e.getMessage() : e.toString();
        String message = "échec à l'étape « " + etape.nom + " » : " + brut;
        principal.post(() -> {
            p.enCours = false;
            p.etat = "❌ " + message;
            p.etatErreur = true;
            rafraichir(p);
            String msg = p.nomComplet() + " : " + message;
            if (fin == null) alerte(msg);
            else fin.fini(msg, false);
        });
    }

    private void lancerTousLesControles() {
        final List<Paire> visibles = depot.pairesDeLaSemaine(onglet);
        final List<String> erreurs = new ArrayList<>();
        final boolean[] auMoinsUnResultat = {false};
        for (Paire p : visibles) if (p.rapport != null) auMoinsUnResultat[0] = true;
        enchainer(visibles, 0, erreurs, auMoinsUnResultat);
    }

    private void enchainer(List<Paire> liste, int i, List<String> erreurs, boolean[] auMoinsUnResultat) {
        if (i >= liste.size()) {
            if (!erreurs.isEmpty()) {
                alerte("Certaines cases n'ont pas pu être traitées :\n\n" + TextUtils.join("\n", erreurs));
            } else if (!auMoinsUnResultat[0]) {
                alerte("Sélectionnez au moins un fichier de lancement (avec, si possible, une liste de coupe ou un .bkp).");
            }
            return;
        }
        lancerUnePaire(liste.get(i), (erreur, resultat) -> {
            if (erreur != null) erreurs.add(erreur);
            if (resultat) auMoinsUnResultat[0] = true;
            enchainer(liste, i + 1, erreurs, auMoinsUnResultat);
        });
    }

    void lancerControleScies(Paire p) {
        lancerControleScies(p, null);
    }

    void lancerControleScies(Paire p, Runnable fin) {
        if (p.strat == null) {
            alerte(p.nomComplet() + " : sélectionnez d'abord le fichier de lancement.");
            if (fin != null) fin.run();
            return;
        }
        if (p.bkp == null) {
            alerte(p.nomComplet() + " : sélectionnez le fichier .bkp à vérifier.");
            if (fin != null) fin.run();
            return;
        }
        p.enCours = true;
        p.etat = "⏳ contrôle Scies…";
        p.etatErreur = false;
        rafraichir(p);
        app.fond.execute(() -> {
            Controles.Etape etape = new Controles.Etape();
            try {
                controles.controleScies(p, etape);
            } catch (Exception e) {
                p.ecartsScies = null;
                p.totalScies = null;
                p.erreurScies = "échec à l'étape « " + etape.nom + " » : " + (e.getMessage() != null ? e.getMessage() : e);
            }
            depot.enregistrer(p);
            principal.post(() -> {
                p.enCours = false;
                p.etat = null;
                rafraichir(p);
                majCompteur();
                if (fin != null) fin.run();
            });
        });
    }

    private void reinitialiserSemaine() {
        final String parite = onglet;
        confirmer("Réinitialiser « " + libelleOnglet(parite) + " » ?",
                "Toutes les cases de cette semaine (y compris Chantiers) seront vidées. Cette action est irréversible.", () -> {
                    for (Paire p : depot.pairesDeLaSemaine(parite)) depot.reinitialiser(p);
                    for (Paire p : depot.diakonos(parite)) depot.reinitialiser(p);
                    listesDepliees.clear();
                    afficher();
                });
    }

    private void retirerChantier(Paire p) {
        confirmer("Retirer définitivement « " + p.label + " » ?", "Ses fichiers et résultats seront effacés.", () -> {
            depot.retirerChantier(p);
            afficher();
            majCompteur();
        });
    }

    // ---- dossier partagé ----

    private View carteDossierPartage(String parite) {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = ui.colonne();
        corps.setPadding(ui.dp(14), ui.dp(10), ui.dp(14), ui.dp(12));
        carte.addView(corps);
        corps.addView(ui.texte("📂 Dossier partagé", 16, true, 0xFF263238));
        DossierPartage dossier = DossierPartage.memorise(this, parite);
        if (dossier != null) corps.addView(ui.texte(dossier.nom, 13, false, ui.couleur(R.color.gris_texte)), ui.marges(2, 0));
        corps.addView(ui.espace(6));

        LinearLayout boutons = ui.rangee();
        MaterialButton choisir = ui.boutonContour(dossier != null ? "Changer" : "Choisir le dossier");
        choisir.setOnClickListener(v -> choisirDossier(parite));
        boutons.addView(choisir, ui.poids(1));
        boutons.addView(new View(this), new LinearLayout.LayoutParams(ui.dp(8), 1));
        MaterialButton scanner = ui.bouton("Scanner");
        scanner.setEnabled(dossier != null && !scansEnCours.contains(parite));
        scanner.setOnClickListener(v -> scannerDossier(parite));
        boutons.addView(scanner, ui.poids(1));
        corps.addView(boutons);

        List<String> lignes = resultatsScan.get(parite);
        if (lignes != null) {
            TextView resultat = ui.texte(TextUtils.join("\n", lignes), 13, false,
                    scanEnErreur.contains(parite) ? ui.couleur(R.color.alerte_texte) : 0xFF263238);
            resultat.setLineSpacing(ui.dp(2), 1f);
            corps.addView(resultat, ui.marges(8, 0));
        }
        return carte;
    }

    void choisirDossier(String parite) {
        pariteDossierEnAttente = parite;
        try {
            choixDossier.launch(null);
        } catch (Exception e) {
            alerte("Impossible d'ouvrir le sélecteur de dossier : " + e.getMessage());
        }
    }

    void dossierChoisi(Uri uri) {
        String parite = pariteDossierEnAttente;
        pariteDossierEnAttente = null;
        if (uri == null || parite == null) return;
        DossierPartage.memoriser(this, parite, uri);
        resultatsScan.remove(parite);
        scanEnErreur.remove(parite);
        if (parite.equals(onglet)) afficher();
    }

    private void compteRendu(String parite, List<String> lignes, boolean erreur) {
        resultatsScan.put(parite, lignes);
        if (erreur) scanEnErreur.add(parite);
        else scanEnErreur.remove(parite);
        if (parite.equals(onglet)) afficher();
    }

    /** Une case à remplir par le scan : le lancement trouvé et la case qui le reçoit. */
    private static final class Affectation {
        final ScanDossier.Cible cible;
        final Paire paire;
        final String libelle;
        boolean copie;

        Affectation(ScanDossier.Cible cible, Paire paire, String libelle) {
            this.cible = cible;
            this.paire = paire;
            this.libelle = libelle;
        }
    }

    /** Scan du dossier partagé de la semaine, comme scannerDossierPartage() de l'appli web. */
    void scannerDossier(String parite) {
        final DossierPartage dossier = DossierPartage.memorise(this, parite);
        if (dossier == null) {
            compteRendu(parite, java.util.Collections.singletonList("Choisissez d'abord un dossier."), true);
            return;
        }
        if (!scansEnCours.add(parite)) return;
        compteRendu(parite, java.util.Collections.singletonList("Scan en cours…"), false);
        app.annexe.execute(() -> {
            List<ScanDossier.Fichier> fichiers;
            try {
                fichiers = dossier.lister(this);
            } catch (Exception e) {
                principal.post(() -> {
                    scansEnCours.remove(parite);
                    compteRendu(parite, java.util.Collections.singletonList("Dossier illisible : " + e.getMessage()
                            + ". Rechoisissez-le."), true);
                });
                return;
            }
            android.icu.text.Collator ordre = android.icu.text.Collator.getInstance(android.icu.util.ULocale.ROOT);
            ScanDossier.Resultat r = ScanDossier.scanner(fichiers, parite, ordre::compare);
            principal.post(() -> placerFichiersScannes(parite, r));
        });
    }

    private void placerFichiersScannes(String parite, ScanDossier.Resultat r) {
        if (r.aucunLancement && r.diakonos.isEmpty()) {
            scansEnCours.remove(parite);
            List<String> lignes = new ArrayList<>();
            lignes.add("Aucun lancement dans ce dossier.");
            compteRendu(parite, lignes, true);
            return;
        }
        final List<String> lignes = new ArrayList<>();
        final List<Affectation> affectations = new ArrayList<>();
        for (ScanDossier.Cible g : r.fixes) {
            Paire p = depot.paireFixe(g.poste, g.parite);
            if (p == null) {
                lignes.add("— " + g.poste + " : case introuvable");
                continue;
            }
            affectations.add(new Affectation(g, p, g.poste));
        }
        for (ScanDossier.Cible g : r.chantiers) {
            String identite = g.identiteChantier();
            Paire p = null;
            for (Paire c : depot.paires) if (c.estChantier() && identite.equals(c.codeLancement)) p = c;
            if (p == null) {
                p = depot.ajouterChantier(g.parite);
                p.codeLancement = identite;
                depot.enregistrer(p);
            }
            affectations.add(new Affectation(g, p, p.label));
        }
        for (Affectation a : affectations) {
            a.paire.etat = "⏳ fichiers du dossier partagé…";
            a.paire.etatErreur = false;
        }
        afficher();
        app.annexe.execute(() -> {
            for (Affectation a : affectations) {
                Paire p = a.paire;
                ScanDossier.Cible g = a.cible;
                try {
                    copierDepuisDossier(p, Paire.STRAT, g.strat);
                    p.semaine = controles.detecterSemaine(p);
                    boolean deplace = ranger(p);
                    String suffixe = "";
                    if (g.coupe != null) {
                        copierDepuisDossier(p, Paire.COUPE, g.coupe);
                        suffixe = " + coupe";
                    }
                    if (g.bkp != null) {
                        copierDepuisDossier(p, Paire.BKP, g.bkp);
                        suffixe += " + .bkp";
                    }
                    depot.enregistrer(p);
                    a.copie = true;
                    lignes.add("✔ " + a.libelle + " : " + g.strat.nom + suffixe + (deplace ? " → semaine " + p.semaine : ""));
                } catch (Exception e) {
                    depot.enregistrer(p);
                    lignes.add("❌ " + a.libelle + " : " + (e.getMessage() != null ? e.getMessage() : e));
                }
            }
            for (ScanDossier.Diakonos d : r.diakonos) {
                Paire p = depot.paireDiakonos(d.tour, parite);
                try {
                    copierDepuisDossier(p, Paire.STRAT, d.fichier);
                    p.semaine = d.semaine;
                    lignes.add("✔ " + p.poste + " : " + d.fichier.nom);
                } catch (Exception e) {
                    lignes.add("❌ " + p.poste + " : " + (e.getMessage() != null ? e.getMessage() : e));
                }
                depot.enregistrer(p);
            }
            principal.post(() -> {
                for (Affectation a : affectations) {
                    a.paire.etat = null;
                    a.paire.etatErreur = false;
                }
                List<String> compte = new ArrayList<>();
                if (lignes.isEmpty()) compte.add("Aucun lancement de cette semaine dans ce dossier.");
                compte.addAll(lignes);
                if (!r.nonReconnus.isEmpty()) compte.add("Non reconnu(s) : " + TextUtils.join(", ", r.nonReconnus));
                compteRendu(parite, compte, lignes.isEmpty());
                majCompteur();
                // Le scan sert à éviter les clics : les contrôles possibles partent tout seuls.
                lancerControlesScannes(parite, affectations, 0, compte);
            });
        });
    }

    private void copierDepuisDossier(Paire p, String role, ScanDossier.Fichier f) throws IOException {
        try (InputStream entree = DossierPartage.ouvrir(this, f)) {
            depot.copierFichier(p, role, f.nom, entree);
        }
    }

    private void lancerControlesScannes(String parite, List<Affectation> affectations, int i, List<String> compte) {
        if (i >= affectations.size()) {
            scansEnCours.remove(parite);
            if (parite.equals(onglet)) afficher();
            return;
        }
        Affectation a = affectations.get(i);
        Runnable suivant = () -> lancerControlesScannes(parite, affectations, i + 1, compte);
        if (!a.copie) {
            suivant.run();
            return;
        }
        Runnable scies = () -> {
            if (a.cible.bkp != null) lancerControleScies(a.paire, suivant);
            else suivant.run();
        };
        // GO avec la liste de coupe, ou à défaut avec le .bkp (semaines de livraison, pièces manquantes…).
        if (a.paire.coupe != null || a.paire.bkp != null) {
            lancerUnePaire(a.paire, (erreur, resultat) -> {
                if (erreur != null) {
                    compte.add("❌ " + erreur);
                    resultatsScan.put(parite, compte);
                }
                scies.run();
            });
        } else {
            scies.run();
        }
    }

    // ---- export du rapport ----

    /** Rapport Excel de toute la semaine (tableau des lancements, alertes, anomalies de chaque lancement). */
    void exporterSemaine(String parite) {
        cleExport = parite;
        try {
            creationRapport.launch(RapportSemaine.nomFichier(libelleOnglet(parite)));
        } catch (Exception e) {
            cleExport = null;
            alerte("Impossible d'enregistrer le rapport :\n" + e.getMessage());
        }
    }

    void emplacementRapportChoisi(Uri uri) {
        String parite = cleExport;
        cleExport = null;
        if (uri == null || parite == null) return;
        exporterSemaineVers(parite, uri);
    }

    void exporterSemaineVers(String parite, Uri uri) {
        final String autre = Depot.PAIRE.equals(parite) ? Depot.IMPAIRE : Depot.PAIRE;
        final String libelle = libelleOnglet(parite);
        final String libelleAutre = libelleOnglet(autre);
        final List<Paire> semaine = depot.pairesDeLaSemaine(parite);
        final List<Paire> autreSemaine = depot.pairesDeLaSemaine(autre);
        final Paire casse = depot.paireFixe("Casse", parite);
        final int numeroAutre = numeroSemaine(autre);
        app.annexe.execute(() -> {
            String erreur = null;
            try {
                for (Paire p : semaine) if (p.strat != null) controles.resume(p.strat, p.bkp);
                for (Paire p : autreSemaine) if (p.strat != null) controles.resume(p.strat, p.bkp);
                ControleCasse.Resultat analyseCasse = casse != null && casse.strat != null
                        ? ControleCasse.calculer(casse, autreSemaine, numeroAutre, controles) : null;
                byte[] octets = RapportSemaine.xlsx(libelle, RecapLancements.lignes(semaine, controles),
                        RecapLancements.lignes(autreSemaine, controles), libelleAutre, analyseCasse);
                try (OutputStream sortie = "file".equals(uri.getScheme())
                        ? new FileOutputStream(new File(uri.getPath()))
                        : getContentResolver().openOutputStream(uri, "wt")) {
                    if (sortie == null) throw new IOException("emplacement inaccessible");
                    sortie.write(octets);
                }
            } catch (Exception e) {
                erreur = e.getMessage() != null ? e.getMessage() : e.toString();
            }
            final String err = erreur;
            principal.post(() -> {
                if (err != null) alerte("Impossible d'enregistrer le rapport :\n" + err);
                else android.widget.Toast.makeText(this, "Rapport enregistré : " + nomAffiche(this, uri), android.widget.Toast.LENGTH_LONG).show();
            });
        });
    }

    // ---- boîtes de dialogue ----

    void alerte(String message) {
        if (isFinishing()) return;
        new AlertDialog.Builder(this).setMessage(message).setPositiveButton("OK", null).show();
    }

    void confirmer(String titre, String message, Runnable siOui) {
        new AlertDialog.Builder(this)
                .setTitle(titre)
                .setMessage(message)
                .setPositiveButton("Oui", (d, w) -> siOui.run())
                .setNegativeButton("Annuler", null)
                .show();
    }
}
