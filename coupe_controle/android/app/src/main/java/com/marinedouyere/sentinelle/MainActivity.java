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
import com.marinedouyere.sentinelle.moteur.ErreurLecture;
import com.marinedouyere.sentinelle.moteur.Js;
import com.marinedouyere.sentinelle.moteur.LecteurBkp;
import com.marinedouyere.sentinelle.moteur.LecteurStrat;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public class MainActivity extends AppCompatActivity {

    static final String ONGLET_RECHERCHE = "recherche";
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
    private final Map<Paire, LinearLayout> cartes = new HashMap<>();
    private final Set<Paire> listesDepliees = new HashSet<>();
    private RechercheVue recherche;

    private ActivityResultLauncher<String[]> choixFichier;
    private String cleEnAttente;
    private String roleEnAttente;

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
        }
        choixFichier = registerForActivityResult(new ActivityResultContracts.OpenDocument(), this::fichierChoisi);

        LinearLayout racine = ui.colonne();
        racine.setBackgroundColor(ui.couleur(R.color.fond));

        MaterialToolbar barre = new MaterialToolbar(this);
        barre.setTitle("Sentinelle");
        barre.setSubtitle("Contrôle de coupe");
        barre.setBackgroundColor(ui.couleur(R.color.bleu));
        barre.setTitleTextColor(0xFFFFFFFF);
        barre.setSubtitleTextColor(0xDDFFFFFF);
        racine.addView(barre, ui.pleineLargeur());

        TabLayout onglets = new TabLayout(this);
        onglets.setBackgroundColor(0xFFFFFFFF);
        onglets.setTabMode(TabLayout.MODE_FIXED);
        onglets.setTabGravity(TabLayout.GRAVITY_FILL);
        onglets.addTab(onglets.newTab().setText("Semaine paire").setTag(Depot.PAIRE));
        onglets.addTab(onglets.newTab().setText("Semaine impaire").setTag(Depot.IMPAIRE));
        onglets.addTab(onglets.newTab().setText("Recherche").setTag(ONGLET_RECHERCHE));
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
    }

    private boolean ongletSemaine() {
        return Depot.PAIRE.equals(onglet) || Depot.IMPAIRE.equals(onglet);
    }

    // ---- construction de l'écran ----

    void afficher() {
        contenu.removeAllViews();
        cartes.clear();
        texteCompteur = null;
        if (ongletSemaine()) {
            construireSemaine(onglet);
        } else {
            if (recherche == null) recherche = new RechercheVue(this, ui, app);
            contenu.addView(recherche.vue());
        }
    }

    private void construireSemaine(String parite) {
        MaterialCardView carteCompteur = ui.carte();
        carteCompteur.setCardBackgroundColor(0xFFE3F2FD);
        carteCompteur.setStrokeColor(0xFF90CAF9);
        texteCompteur = ui.texte(Depot.libelleSemaine(parite) + " — calcul du nombre de pièces…", 16, true,
                ui.couleur(R.color.bleu_fonce));
        texteCompteur.setGravity(Gravity.CENTER);
        texteCompteur.setPadding(ui.dp(12), ui.dp(14), ui.dp(12), ui.dp(14));
        carteCompteur.addView(texteCompteur);
        contenu.addView(carteCompteur);
        majCompteur();

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

        for (String poste : Depot.POSTES_SEMAINE) {
            contenu.addView(titrePoste(poste));
            contenu.addView(carteDe(depot.paireFixe(poste, parite)));
        }

        contenu.addView(titrePoste(Depot.POSTE_CHANTIERS));
        for (Paire c : depot.chantiers(parite)) contenu.addView(carteDe(c));
        MaterialButton ajouter = ui.boutonContour("+ Ajouter un chantier");
        ajouter.setOnClickListener(v -> {
            depot.ajouterChantier(parite);
            afficher();
            defilement.post(() -> defilement.fullScroll(View.FOCUS_DOWN));
        });
        contenu.addView(ajouter, ui.marges(2, 0));
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
        LinearLayout corps = cartes.get(p);
        if (corps != null) {
            corps.removeAllViews();
            remplirCarte(corps, p);
        }
    }

    private void remplirCarte(LinearLayout corps, Paire p) {
        LinearLayout entete = ui.rangee();
        TextView titre = ui.texte(p.titre(), 16, true, 0xFF1F2933);
        entete.addView(titre, ui.poids(1));
        if (p.estChantier()) {
            MaterialButton retirer = ui.boutonTexte("✕ Retirer");
            retirer.setTextColor(ui.couleur(R.color.alerte_texte));
            retirer.setOnClickListener(v -> retirerChantier(p));
            entete.addView(retirer);
        }
        MaterialButton reinit = ui.boutonTexte("↺ Réinitialiser");
        reinit.setOnClickListener(v -> confirmer("Réinitialiser « " + p.titre() + " » ?",
                "Les fichiers et résultats de cette case seront effacés.", () -> {
                    depot.reinitialiser(p);
                    listesDepliees.remove(p);
                    rafraichir(p);
                    majCompteur();
                }));
        entete.addView(reinit);
        corps.addView(entete);

        corps.addView(ligneFichier(p, Paire.STRAT, "Fichier de lancement"));
        corps.addView(ligneFichier(p, Paire.COUPE, "Liste de coupe (Cutrite)"));
        corps.addView(ligneFichier(p, Paire.BKP, "Contrôle Scies — fichier .bkp"));

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

        if (p.etat != null) {
            TextView etat = ui.texte(p.etat, 14, false,
                    p.etatErreur ? ui.couleur(R.color.alerte_texte) : ui.couleur(R.color.gris_texte));
            corps.addView(etat, ui.marges(6, 0));
        }

        if (p.rapport != null) afficherRapport(corps, p);
        if (p.ecartsScies != null || p.erreurScies != null) afficherScies(corps, p);
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
        String suffixe = "";
        if (p.nbUnitaires != null && p.nbPiecesTrouvees != null && p.nbPiecesTrouvees != 0) {
            double unitaire = p.nbUnitaires * 100.0 / p.nbPiecesTrouvees;
            double grain = (p.nbPiecesTrouvees - p.nbUnitaires) * 100.0 / p.nbPiecesTrouvees;
            suffixe = ", dont " + pourcent(unitaire) + " % unitaire / " + pourcent(grain) + " % grain matching";
        }
        String attendu = Js.entierTronque(r.totalAttendu);
        if (r.nbAnomalies == 0) {
            corps.addView(ui.bandeau("✔ Tout est correct — " + attendu + " pièces attendues, "
                    + Js.nombre(r.totalTrouve) + " trouvées" + suffixe + ".",
                    ui.couleur(R.color.ok_fond), ui.couleur(R.color.ok_texte)));
        } else {
            corps.addView(ui.bandeau("⚠ " + r.nbAnomalies + " anomalie(s) — " + attendu + " pièces attendues, "
                    + Js.nombre(r.totalTrouve) + " trouvées (" + r.nbOk + " OK)" + suffixe + ".",
                    ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)));
        }
        if ("bkp".equals(p.source)) {
            corps.addView(ui.texte("Pas de liste de coupe : comparaison avec le .bkp (quantités réellement optimisées).",
                    13, false, ui.couleur(R.color.gris_texte)), ui.marges(4, 0));
        }

        if (!p.doublons.isEmpty()) {
            StringBuilder sb = new StringBuilder();
            sb.append("⚠ ").append(p.doublons.size()).append(" doublon(s) dans le fichier de lancement\n");
            sb.append("Une même clé commande+ligne apparaît sur plusieurs lignes du fichier de lancement (hors panneaux de protection) — vérifiez qu'il ne s'agit pas d'une pièce lancée deux fois par erreur.");
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
        }

        List<Comparateur.LigneRapport> anomalies = r.anomalies();
        if (anomalies.isEmpty()) return;
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
        detail.append("attendu ").append(Js.nombre(l.qteAttendue)).append(", trouvé ").append(Js.nombre(l.qteTrouvee))
                .append(" (écart ").append(Js.nombre(l.ecart)).append(")");
        ligne.addView(ui.texte(detail, 13, false, 0xFF3E4C59));
        LinearLayout.LayoutParams lp = ui.pleineLargeur();
        lp.setMargins(0, ui.dp(5), 0, 0);
        ligne.setLayoutParams(lp);
        return ligne;
    }

    private void afficherScies(LinearLayout corps, Paire p) {
        corps.addView(ui.separateur());
        if (p.erreurScies != null) {
            corps.addView(ui.bandeau("❌ " + p.erreurScies, ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)));
            return;
        }
        String bilan = Js.nombre(p.totalScies == null ? 0 : p.totalScies) + " pièce(s) au total (protections comprises)";
        if (p.ecartsScies.isEmpty()) {
            corps.addView(ui.bandeau("✔ Contrôle Scies : tout correspond — " + bilan
                    + ", toutes retrouvées à l'identique dans le .bkp.", ui.couleur(R.color.ok_fond), ui.couleur(R.color.ok_texte)));
            return;
        }
        corps.addView(ui.bandeau("⚠ Contrôle Scies : " + p.ecartsScies.size() + " écart(s) sur " + bilan,
                ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)));
        corps.addView(ui.texte("Comparaison entre le fichier de lancement et ce qui a été réellement optimisé (.bkp) — une pièce en écart peut signaler un oubli lors de l'optimisation.",
                13, false, ui.couleur(R.color.gris_texte)), ui.marges(4, 0));
        for (LecteurBkp.Ecart e : p.ecartsScies) {
            TextView t = ui.texte(e.cle + " — attendu " + Js.nombre(e.attendu) + ", trouvé (.bkp) " + Js.nombre(e.trouve)
                    + " — " + e.type(), 13, false, 0xFF3E4C59);
            t.setPadding(0, ui.dp(4), 0, 0);
            corps.addView(t);
        }
    }

    // ---- compteur ----

    private void majCompteur() {
        if (!ongletSemaine()) return;
        final String parite = onglet;
        final List<Paire.Fichier> bkps = new ArrayList<>();
        for (Paire p : depot.pairesDeLaSemaine(parite)) if (p.bkp != null) bkps.add(p.bkp);
        app.annexe.execute(() -> {
            double total = 0;
            for (Paire.Fichier f : bkps) total += controles.totalBkp(f);
            final double t = total;
            principal.post(() -> {
                if (texteCompteur != null && parite.equals(onglet)) {
                    texteCompteur.setText(Depot.libelleSemaine(parite) + " — " + Js.nombre(t) + " pièce(s) au total dans les .bkp");
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
        String motCle = Paire.STRAT.equals(role) ? "LAN" : Paire.COUPE.equals(role) ? "coupe" : ".bkp";
        String type = Paire.STRAT.equals(role) ? "lancement" : Paire.COUPE.equals(role) ? "liste de coupe" : "sauvegarde d'optimisation";
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
            try (InputStream entree = getContentResolver().openInputStream(uri)) {
                if (entree == null) throw new java.io.IOException("fichier inaccessible");
                depot.copierFichier(p, role, nom, entree);
                if (Paire.STRAT.equals(role)) p.semaine = controles.detecterSemaine(p);
                depot.enregistrer(p);
            } catch (Exception e) {
                erreur = e.getMessage();
            }
            final String err = erreur;
            principal.post(() -> {
                p.etat = err != null ? "Impossible de lire « " + nom + " » : " + err : null;
                p.etatErreur = err != null;
                if (Paire.STRAT.equals(role) && p.estChantier()) afficher();
                else rafraichir(p);
                if (Paire.BKP.equals(role)) majCompteur();
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
            p.etat = "— vide (ignorée)";
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
            p.etat = "— en attente de la liste de coupe ou du .bkp";
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
                if (strat.semaines.size() > 1) {
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
                p.etat = p.coupe != null ? "⏳ lecture de la liste de coupe (Cutrite)…" : "⏳ pas de liste de coupe — comparaison avec le .bkp…";
                rafraichir(p);
            });
            controles.comparer(p, strat, etape);
            depot.enregistrer(p);
            principal.post(() -> {
                p.enCours = false;
                p.etatErreur = false;
                p.etat = p.rapport.nbAnomalies == 0
                        ? "✅ terminé — tout est correct (" + p.rapport.lignes.size() + " pièce(s))"
                        : "⚠️ terminé — " + p.rapport.nbAnomalies + " anomalie(s)";
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
        if (p.strat == null) {
            alerte(p.nomComplet() + " : sélectionnez d'abord le fichier de lancement.");
            return;
        }
        if (p.bkp == null) {
            alerte(p.nomComplet() + " : sélectionnez le fichier .bkp à vérifier.");
            return;
        }
        p.enCours = true;
        p.etat = "⏳ Contrôle Scies : lecture des fichiers…";
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
            });
        });
    }

    private void reinitialiserSemaine() {
        final String parite = onglet;
        confirmer("Réinitialiser « " + Depot.libelleSemaine(parite) + " » ?",
                "Toutes les cases de cette semaine (y compris Chantiers) seront vidées. Cette action est irréversible.", () -> {
                    for (Paire p : depot.pairesDeLaSemaine(parite)) depot.reinitialiser(p);
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
