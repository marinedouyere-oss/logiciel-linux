package com.marinedouyere.sentinelle;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * Les écrans de Sentinelle sur le téléphone, comme sur le PC : La semaine, Contrôler la coupe, Rechercher une
 * pièce, Bibliothèque des semaines. Tout vient du fichier partagé que Sentinelle (sur le PC) écrit dans un
 * dossier du Drive : il est choisi une fois avec le sélecteur d'Android (le Drive du compte connecté sur
 * l'appareil y apparaît) et relu à chaque retour dans l'appli et sur « Actualiser ». L'appli ne fait que lire.
 */
final class PartageVue {

    enum Ecran { SEMAINE, CONTROLE, RECHERCHE, BIBLIOTHEQUE }

    private static final String PREFERENCES = "sentinelle_partage";
    private static final String CLE_URI = "uri";
    /** Code de liaison avec le PC (lien sans Drive) et dernier envoi reçu (gardé pour lire sans réseau). */
    private static final String CLE_CODE = "code_lien";
    private static final String CLE_RECU = "recu_lien";
    private static final String CACHE_LIEN = "lien_partage.bin";
    private static final int MAX_PAR_TYPE = 40;
    private static final int MAX_RESULTATS = 60;

    private final MainActivity activite;
    private final Ui ui;
    private final SentinelleApp app;
    private final Handler principal = new Handler(Looper.getMainLooper());
    private final LinearLayout racine;

    private FichierPartage donnees;
    private String nomFichier;
    private String erreur;
    private boolean enLecture;
    private int generation;
    private String semaineChoisie;
    private String requete = "";
    private Ecran ecran = Ecran.SEMAINE;
    /** Pièce sans étiquette : longueur (sens du fil), largeur, couleur, semaine ; null : pas encore cherché. */
    private String[] sansEtiquette;
    /** Lancement à montrer dans Contrôler la coupe (bouton « Voir le contrôle »). */
    private String lancementAMontrer;
    private boolean pdfEnCours;
    /** Message sans gravité (pas de réseau : dernière version reçue). */
    private String avertissement;
    /** Clé tirée du code (calcul un peu long : gardée). */
    private String codeDeLaCle;
    private byte[] cleDuCode;

    PartageVue(MainActivity activite, Ui ui, SentinelleApp app) {
        this.activite = activite;
        this.ui = ui;
        this.app = app;
        racine = ui.colonne();
    }

    View vue(Ecran e) {
        ecran = e;
        if (racine.getParent() != null) ((ViewGroup) racine.getParent()).removeView(racine);
        construire();
        return racine;
    }

    private SharedPreferences preferences() {
        return activite.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    Uri uri() {
        String u = preferences().getString(CLE_URI, null);
        return u == null ? null : Uri.parse(u);
    }

    /** Le fichier choisi dans le sélecteur d'Android : gardé (l'autorisation de lecture aussi), puis lu. */
    void fichierChoisi(Uri uri) {
        if (uri == null) return;
        try {
            activite.getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException e) {
            // Fournisseur sans autorisation durable : le fichier reste lisible tant que l'appli est ouverte.
        }
        preferences().edit().putString(CLE_URI, uri.toString()).apply();
        donnees = null;
        semaineChoisie = null;
        actualiser();
    }

    /** Code de liaison avec le PC (null : pas relié). */
    String codeLien() {
        String c = preferences().getString(CLE_CODE, null);
        return c == null || c.isEmpty() ? null : c;
    }

    /** Relie l'appli au PC avec le code affiché par Sentinelle (Bibliothèque des semaines), puis lit les données. */
    void relier(String code) {
        if (!LienPc.codeValide(code)) {
            erreur = "Le code a 16 lettres et chiffres (ABCD-EFGH-JKLM-NPQR) : vérifiez-le sur le PC.";
            construire();
            return;
        }
        preferences().edit().putString(CLE_CODE, LienPc.formater(code)).remove(CLE_RECU).apply();
        //noinspection ResultOfMethodCallIgnored
        new java.io.File(activite.getFilesDir(), CACHE_LIEN).delete();
        donnees = null;
        semaineChoisie = null;
        actualiser();
    }

    private void delier() {
        new MaterialAlertDialogBuilder(activite)
                .setTitle("Délier du PC ?")
                .setMessage("L'appli ne recevra plus les données du PC. Il faudra retaper le code pour la relier.")
                .setNegativeButton("Annuler", null)
                .setPositiveButton("Délier", (d, k) -> {
                    preferences().edit().remove(CLE_CODE).remove(CLE_RECU).apply();
                    //noinspection ResultOfMethodCallIgnored
                    new java.io.File(activite.getFilesDir(), CACHE_LIEN).delete();
                    donnees = null;
                    app.partage = null;
                    avertissement = null;
                    erreur = null;
                    if (uri() != null) actualiser();
                    else construire();
                })
                .show();
    }

    private synchronized byte[] cleDe(String code) throws java.security.GeneralSecurityException {
        if (cleDuCode == null || !code.equals(codeDeLaCle)) {
            cleDuCode = LienPc.cle(code);
            codeDeLaCle = code;
        }
        return cleDuCode;
    }

    private static byte[] toutLire(java.io.File f) throws java.io.IOException {
        return java.nio.file.Files.readAllBytes(f.toPath());
    }

    /** Relit les données (en arrière-plan) : sur le site si l'appli est reliée au PC, sinon dans le fichier choisi. */
    void actualiser() {
        final String code = codeLien();
        final Uri uri = uri();
        if (code == null && uri == null) {
            construire();
            return;
        }
        final int numero = ++generation;
        enLecture = true;
        erreur = null;
        avertissement = null;
        construire();
        app.annexe.execute(() -> {
            FichierPartage lu = null;
            String nom = null;
            String probleme = null;
            String note = null;
            if (code != null) {
                java.io.File cache = new java.io.File(activite.getFilesDir(), CACHE_LIEN);
                try {
                    byte[] cle = cleDe(code);
                    LienPc.Recu r = LienPc.telecharger(code);
                    lu = FichierPartage.lire(new java.io.ByteArrayInputStream(LienPc.dechiffrer(r.paquet, cle)));
                    try (java.io.FileOutputStream sortie = new java.io.FileOutputStream(cache)) {
                        sortie.write(r.paquet);
                    }
                    preferences().edit().putString(CLE_RECU, new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT).format(new Date()) + "Z").apply();
                    nom = "Relié au PC";
                } catch (LienPc.CodeFaux e) {
                    probleme = "Code faux : vérifiez le code affiché sur le PC (Bibliothèque des semaines).";
                } catch (LienPc.RienPourCeCode e) {
                    probleme = "Rien sur le site pour ce code : sur le PC, activez l'envoi au téléphone et vérifiez le code.";
                } catch (Exception e) {
                    // Pas de réseau (ou site injoignable) : la dernière version reçue.
                    try {
                        if (cache.exists()) {
                            lu = FichierPartage.lire(new java.io.ByteArrayInputStream(LienPc.dechiffrer(toutLire(cache), cleDe(code))));
                            nom = "Relié au PC";
                            note = "Pas de connexion au site de Sentinelle : dernière version reçue.";
                        } else {
                            probleme = "Pas de connexion au site de Sentinelle (" + (e.getMessage() != null ? e.getMessage() : e.toString()) + ").";
                        }
                    } catch (Exception e2) {
                        probleme = "Données illisibles : " + (e2.getMessage() != null ? e2.getMessage() : e2.toString());
                    }
                }
            } else {
                try {
                    nom = nomAffiche(uri);
                    try (InputStream entree = activite.getContentResolver().openInputStream(uri)) {
                        if (entree == null) throw new java.io.FileNotFoundException("fichier introuvable");
                        lu = FichierPartage.lire(entree);
                    }
                } catch (SecurityException | java.io.FileNotFoundException e) {
                    probleme = "Fichier introuvable ou plus autorisé : choisissez-le à nouveau.";
                } catch (Exception e) {
                    probleme = "Fichier illisible : " + (e.getMessage() != null ? e.getMessage() : e.toString());
                }
            }
            final FichierPartage resultat = lu;
            final String nomLu = nom;
            final String erreurLue = probleme;
            final String noteLue = note;
            principal.post(() -> {
                if (numero != generation) return;
                enLecture = false;
                erreur = erreurLue;
                avertissement = noteLue;
                if (resultat != null) {
                    donnees = resultat;
                    nomFichier = nomLu;
                    app.partage = resultat;
                }
                construire();
                if (resultat != null) activite.partageCharge();
            });
        });
    }

    private String nomAffiche(Uri uri) {
        try (Cursor c = activite.getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (RuntimeException e) {
            // nom inconnu
        }
        String chemin = uri.getLastPathSegment();
        return chemin != null ? chemin : FichierPartage.NOM;
    }

    /** Pour les tests : données déjà lues. */
    void afficherDonnees(FichierPartage f, String nom) {
        donnees = f;
        nomFichier = nom;
        erreur = null;
        enLecture = false;
        construire();
    }

    // ---- écran ----

    private void construire() {
        racine.removeAllViews();
        switch (ecran) {
            case CONTROLE:
                ecranControle();
                break;
            case RECHERCHE:
                ecranRecherche();
                break;
            case BIBLIOTHEQUE:
                ecranBibliotheque();
                break;
            default:
                ecranSemaine();
        }
    }

    /** En-tête de page comme sur le PC : surtitre, titre, chapeau. */
    private void entete(String surtitre, String titre, String chapeau) {
        LinearLayout e = ui.colonne();
        e.setPadding(ui.dp(2), ui.dp(4), ui.dp(2), ui.dp(8));
        TextView sur = ui.texte(surtitre.toUpperCase(Locale.FRANCE), 11, true, Ui.GRIS);
        sur.setLetterSpacing(0.12f);
        e.addView(sur);
        e.addView(ui.titre(titre, 24, Ui.BORDEAUX), ui.marges(2, 2));
        if (chapeau != null && !chapeau.isEmpty()) e.addView(ui.texte(chapeau, 14, false, ui.couleur(R.color.gris_texte)));
        racine.addView(e, ui.pleineLargeur());
    }

    /** Sans fichier lu : la carte du fichier partagé (et rien d'autre à montrer). */
    private boolean sansDonnees() {
        if (donnees != null && !donnees.semaines.isEmpty()) return false;
        racine.addView(carteFichier());
        if (donnees != null) racine.addView(ui.texte("Le fichier ne contient encore aucune semaine.", 14, false, ui.couleur(R.color.gris_texte)), ui.marges(6, 6));
        return true;
    }

    private String titreSemaine(FichierPartage.Semaine s) {
        return "Semaine " + s.semaine + " · " + s.annee;
    }

    private static boolean semaineEnCours(FichierPartage.Semaine s) {
        java.util.Calendar maintenant = java.util.Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT);
        return s.semaine == CompteRendu.semaineIso(maintenant) && Math.abs(s.annee - maintenant.get(java.util.Calendar.YEAR)) <= 1;
    }

    // ---- La semaine ----

    /** Ce qu'il faut regarder dans un lancement (comme la page web : contrôle, doublons, Scies, couleurs). */
    private static List<String> aRegarder(FichierPartage.Lancement l) {
        List<String> res = new ArrayList<>();
        if (l.controle != null && l.controle > 0)
            res.add(l.controle + " pièce(s) à vérifier dans " + ("bkp".equals(l.source) ? "le .bkp" : "la liste de coupe"));
        for (FichierPartage.Bilan b : l.bilan)
            if ("Lignes en double".equals(b.controle) && "alerte".equals(b.statut)) res.add("pièce(s) en double dans le lancement");
        if (l.scies != null && l.scies < 0) res.add("Scies : contrôle impossible");
        else if (l.scies != null && l.scies > 0) {
            int hors = l.horsPlans == null ? 0 : l.horsPlans;
            int ecarts = l.scies - hors;
            if (ecarts > 0) res.add("Scies : " + ecarts + " pièce(s) différente(s)");
            if (hors > 0) res.add("Plans de coupe : " + hors + " pièce(s) dans aucun plan");
        }
        if (l.couleursAbsentes != null && l.couleursAbsentes > 0) res.add("Couleurs : " + l.couleursAbsentes + " couleur(s) absente(s) du .bkp");
        return res;
    }

    /** Pièces prévues d'un lancement (comme le tableau des lancements). */
    private static double piecesDe(FichierPartage.Lancement l) {
        return l.prevues != null ? Math.floor(l.prevues) : Math.floor(l.nbPieces);
    }

    private static boolean controle(FichierPartage.Lancement l) {
        return l.controle != null || l.scies != null || l.controleFait;
    }

    /** { texte, genre } : bon, souci, vide. */
    private static String[] etatControle(FichierPartage.Lancement l) {
        int n = aRegarder(l).size();
        if (n > 0) return new String[] {n + " à regarder", "souci"};
        if (!controle(l)) return new String[] {"Pas contrôlé", "vide"};
        return new String[] {"OK", "bon"};
    }

    private static String[] etatCoupe(FichierPartage.Lancement l) {
        boolean coupe = l.fichiers.containsKey("coupe");
        boolean bkp = l.fichiers.containsKey("bkp");
        if (coupe && bkp) return new String[] {"Liste + .bkp", "bon"};
        if (bkp) return new String[] {".bkp seul", "bon"};
        if (coupe) return new String[] {"Liste seule", "bon"};
        return new String[] {"—", "vide"};
    }

    private TextView etiquette(String[] e) {
        int fond;
        int texte;
        if ("bon".equals(e[1])) {
            fond = ui.couleur(R.color.ok_fond);
            texte = ui.couleur(R.color.ok_texte);
        } else if ("souci".equals(e[1])) {
            fond = ui.couleur(R.color.alerte_fond);
            texte = ui.couleur(R.color.alerte_texte);
        } else {
            fond = Ui.GRIS_CLAIR;
            texte = ui.couleur(R.color.gris_texte);
        }
        TextView v = ui.texte(e[0], 12, true, texte);
        v.setPadding(ui.dp(8), ui.dp(3), ui.dp(8), ui.dp(3));
        android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
        g.setColor(fond);
        g.setCornerRadius(ui.dp(10));
        v.setBackground(g);
        return v;
    }

    private View tuile(String valeur, String legende, boolean souci) {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = ui.colonne();
        corps.setPadding(ui.dp(10), ui.dp(8), ui.dp(10), ui.dp(10));
        carte.addView(corps);
        corps.addView(ui.texte(legende, 11, false, ui.couleur(R.color.gris_texte)));
        corps.addView(ui.titre(valeur, 20, souci ? ui.couleur(R.color.alerte_texte) : Ui.BORDEAUX));
        return carte;
    }

    private void ecranSemaine() {
        if (donnees == null || donnees.semaines.isEmpty()) {
            entete("La semaine", "Sentinelle", "Les résultats de Sentinelle sur le PC, lus dans le fichier partagé.");
            sansDonnees();
            return;
        }
        FichierPartage.Semaine s = semaine();
        entete(semaineEnCours(s) ? "Semaine en cours" : "Semaine", titreSemaine(s), CompteRendu.datesSemaine(s.annee, s.semaine));
        racine.addView(choixSemaines(s), ui.marges(0, 6));
        int controles = 0;
        int nbProblemes = 0;
        for (FichierPartage.Lancement l : s.lancements) {
            if (controle(l)) controles++;
            nbProblemes += aRegarder(l).size();
        }
        double pieces = 0;
        for (FichierPartage.Lancement l : s.lancements) pieces += piecesDe(l);
        // Comme sur le PC : lancements, pièces, contrôles faits, à regarder (deux par ligne).
        LinearLayout haut = ui.rangee();
        haut.addView(tuile(String.valueOf(s.lancements.size()), "Lancements", false), ui.poids(1));
        haut.addView(ui.espace(1), new LinearLayout.LayoutParams(ui.dp(8), 1));
        haut.addView(tuile(nombre(pieces), "Pièces", false), ui.poids(1));
        racine.addView(haut, ui.pleineLargeur());
        LinearLayout bas = ui.rangee();
        bas.addView(tuile(controles + " sur " + s.lancements.size(), "Contrôles faits", false), ui.poids(1));
        bas.addView(ui.espace(1), new LinearLayout.LayoutParams(ui.dp(8), 1));
        bas.addView(tuile(String.valueOf(nbProblemes), "À regarder", nbProblemes > 0), ui.poids(1));
        racine.addView(bas, ui.pleineLargeur());

        racine.addView(ui.titre("Les lancements de la semaine", 17, Ui.NOIR), ui.marges(10, 4));
        int numero = 1;
        for (FichierPartage.Lancement l : s.lancements) {
            MaterialCardView carte = ui.carte();
            LinearLayout corps = corpsDe(carte);
            LinearLayout tete = ui.rangee();
            tete.addView(ui.pastille(numero++));
            TextView titre = ui.titre(titrePoste(l), 16, Ui.NOIR);
            titre.setPadding(ui.dp(10), 0, 0, 0);
            tete.addView(titre, ui.poids(1));
            corps.addView(tete);
            corps.addView(ui.texte(l.fichier.isEmpty() ? l.nom : l.fichier, 13, false, ui.couleur(R.color.gris_texte)), ui.marges(6, 6));
            String[][] etats = {{"Lancement", "Chargé", "bon"}, {"Pièces", nombre(piecesDe(l)), null}, {"Coupe", etatCoupe(l)[0], etatCoupe(l)[1]},
                    {"Contrôle", etatControle(l)[0], etatControle(l)[1]}};
            for (String[] e : etats) {
                LinearLayout r = ui.rangee();
                r.addView(ui.texte(e[0], 13, false, ui.couleur(R.color.gris_texte)), ui.poids(1));
                if (e[2] == null) r.addView(ui.texte(e[1], 14, true, Ui.NOIR));
                else r.addView(etiquette(new String[] {e[1], e[2]}));
                corps.addView(r, ui.marges(2, 2));
            }
            MaterialButton voir = ui.boutonContour("Voir le contrôle");
            voir.setOnClickListener(v -> voirControle(l));
            corps.addView(voir, ui.marges(6, 0));
            racine.addView(carte);
        }

        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        corps.addView(ui.titre("À regarder", 16, Ui.BORDEAUX));
        corps.addView(ui.filetSaumon());
        boolean rien = true;
        for (FichierPartage.Lancement l : s.lancements)
            for (String t : aRegarder(l)) {
                rien = false;
                TextView ligne = ui.texte("●  " + titrePoste(l) + " — " + t, 14, false, Ui.NOIR);
                ligne.setPadding(0, ui.dp(5), 0, ui.dp(5));
                ligne.setOnClickListener(v -> voirControle(l));
                corps.addView(ligne);
            }
        if (rien) corps.addView(ui.texte("Rien à signaler pour l'instant.", 14, false, ui.couleur(R.color.gris_texte)));
        racine.addView(carte);
    }

    private void voirControle(FichierPartage.Lancement l) {
        lancementAMontrer = l.nom;
        activite.allerA(MainActivity.ONGLET_CONTROLE);
    }

    // ---- Contrôler la coupe ----

    private void ecranControle() {
        if (donnees == null || donnees.semaines.isEmpty()) {
            entete("Contrôler la coupe", "Contrôler la coupe", "Les contrôles faits par Sentinelle sur le PC.");
            sansDonnees();
            return;
        }
        FichierPartage.Semaine s = semaine();
        String quand = dateLisible(s.maj);
        entete("Contrôler la coupe", titreSemaine(s), "Les contrôles faits par Sentinelle sur le PC" + (quand.isEmpty() ? "." : ", mis à jour le " + quand + "."));
        racine.addView(choixSemaines(s), ui.marges(0, 6));
        MaterialButton compteRendu = ui.bouton(pdfEnCours ? "Compte rendu en cours…" : "Compte rendu de la semaine (.pdf)");
        compteRendu.setEnabled(!pdfEnCours);
        compteRendu.setOnClickListener(v -> compteRendu(s));
        racine.addView(compteRendu, ui.marges(0, 4));
        racine.addView(carteTableau(s));
        int numero = 1;
        View aMontrer = null;
        for (FichierPartage.Lancement l : s.lancements) {
            View carte = carteLancement(l, numero++);
            if (l.nom.equals(lancementAMontrer)) aMontrer = carte;
            racine.addView(carte);
        }
        lancementAMontrer = null;
        if (aMontrer != null) activite.montrer(aMontrer);
    }

    /** Compte rendu de la semaine (.pdf), fait en arrière-plan, puis enregistré où l'on veut. */
    private void compteRendu(FichierPartage.Semaine s) {
        if (pdfEnCours) return;
        pdfEnCours = true;
        construire();
        final FichierPartage f = donnees;
        app.annexe.execute(() -> {
            CompteRendu c = CompteRendu.de(f, s);
            byte[] octets = null;
            String probleme = null;
            try {
                octets = c.pdf(activite, ui);
            } catch (Exception e) {
                probleme = e.getMessage() != null ? e.getMessage() : e.toString();
            }
            final byte[] pdf = octets;
            final String erreurPdf = probleme;
            principal.post(() -> {
                pdfEnCours = false;
                construire();
                if (pdf != null) activite.enregistrerPdf(c.nomFichier(), pdf);
                else new MaterialAlertDialogBuilder(activite).setTitle("Compte rendu").setMessage("Impossible de faire le compte rendu : " + erreurPdf)
                        .setPositiveButton("OK", null).show();
            });
        });
    }

    // ---- Rechercher une pièce ----

    private void ecranRecherche() {
        entete("Outils", "Rechercher une pièce", "Dans toutes les semaines du fichier partagé.");
        if (sansDonnees()) return;
        racine.addView(carteRecherche());
        if (!requete.isEmpty()) racine.addView(carteResultats());
        racine.addView(carteSansEtiquette());
        if (sansEtiquette != null) racine.addView(carteResultatsSansEtiquette());
    }

    private EditText champ(String indice, int type, String valeur) {
        EditText e = new EditText(activite);
        e.setHint(indice);
        e.setSingleLine(true);
        e.setInputType(type);
        e.setText(valeur);
        e.setTypeface(ui.lato());
        return e;
    }

    private LinearLayout libelle(String texte, View champ) {
        LinearLayout c = ui.colonne();
        c.addView(ui.texte(texte, 12, true, 0xFF4A403D));
        c.addView(champ, ui.pleineLargeur());
        return c;
    }

    private MaterialCardView carteSansEtiquette() {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        corps.addView(ui.titre("Pièce sans étiquette", 17, Ui.BORDEAUX));
        corps.addView(ui.filetSaumon());
        corps.addView(ui.texte("Cote finie mesurée sur la pièce : la première mesure est le sens du fil. À 2 mm près.", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(0, 6));
        String[] v = sansEtiquette != null ? sansEtiquette : new String[] {"", "", "", ""};
        int nombre = InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL;
        EditText longueur = champ("mm", nombre, v[0]);
        EditText largeur = champ("mm", nombre, v[1]);
        EditText couleur = champ("facultatif", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, v[2]);
        EditText semaine = champ("n°", InputType.TYPE_CLASS_NUMBER, v[3]);
        LinearLayout cotes = ui.rangee();
        cotes.addView(libelle("Longueur (sens du fil)", longueur), ui.poids(1));
        cotes.addView(ui.espace(1), new LinearLayout.LayoutParams(ui.dp(10), 1));
        cotes.addView(libelle("Largeur", largeur), ui.poids(1));
        corps.addView(cotes, ui.pleineLargeur());
        LinearLayout autres = ui.rangee();
        autres.addView(libelle("Couleur", couleur), ui.poids(1));
        autres.addView(ui.espace(1), new LinearLayout.LayoutParams(ui.dp(10), 1));
        autres.addView(libelle("Semaine", semaine), ui.poids(1));
        corps.addView(autres, ui.marges(6, 0));
        MaterialButton chercher = ui.bouton("Chercher");
        chercher.setOnClickListener(x -> {
            sansEtiquette = new String[] {longueur.getText().toString().trim(), largeur.getText().toString().trim(),
                    couleur.getText().toString().trim(), semaine.getText().toString().trim()};
            construire();
        });
        semaine.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        semaine.setOnEditorActionListener((x, action, ev) -> {
            if (action == EditorInfo.IME_ACTION_SEARCH) {
                chercher.performClick();
                return true;
            }
            return false;
        });
        corps.addView(chercher, ui.marges(8, 0));
        return carte;
    }

    private static Double mm(String v) {
        if (v == null || v.isEmpty()) return null;
        try {
            return Double.parseDouble(v.replace(',', '.'));
        } catch (NumberFormatException e) {
            return Double.NaN;
        }
    }

    private MaterialCardView carteResultatsSansEtiquette() {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        String[] v = sansEtiquette;
        int semaine;
        try {
            semaine = Integer.parseInt(v[3]);
        } catch (NumberFormatException e) {
            semaine = 0;
        }
        Double longueur = mm(v[0]);
        Double largeur = mm(v[1]);
        String alerte = null;
        if (semaine < 1 || semaine > 53) alerte = "Tapez la semaine (obligatoire).";
        else if ((longueur != null && !(longueur > 0)) || (largeur != null && !(largeur > 0))) alerte = "Longueur et largeur : des mm (nombres).";
        else if (longueur == null && largeur == null && v[2].isEmpty()) alerte = "Tapez au moins une cote ou la couleur.";
        boolean semaineConnue = false;
        for (FichierPartage.Semaine s : donnees.semaines) semaineConnue |= s.semaine == semaine;
        if (alerte == null && !semaineConnue) alerte = "Semaine " + semaine + " : rien dans le fichier partagé. Ajoutez-la à la bibliothèque sur le PC.";
        if (alerte != null) {
            corps.addView(ui.texte(alerte, 14, true, ui.couleur(R.color.alerte_texte)));
            return carte;
        }
        List<FichierPartage.Trouvaille> res = donnees.chercherSansEtiquette(longueur, largeur, v[2], semaine);
        StringBuilder quoi = new StringBuilder();
        if (longueur != null) quoi.append("longueur ").append(CompteRendu.fmt(longueur));
        if (largeur != null) quoi.append(quoi.length() > 0 ? " · " : "").append("largeur ").append(CompteRendu.fmt(largeur));
        if (!v[2].isEmpty()) quoi.append(quoi.length() > 0 ? " · " : "").append("couleur ").append(v[2]);
        corps.addView(ui.titre(res.size() + " pièce(s) — " + quoi + " (± 2 mm), semaine " + semaine, 15, Ui.BORDEAUX));
        corps.addView(ui.filetSaumon());
        int n = 0;
        for (FichierPartage.Trouvaille t : res) {
            if (n++ >= MAX_RESULTATS) {
                corps.addView(ui.texte("… et " + (res.size() - MAX_RESULTATS) + " autre(s) : précisez la recherche.", 13, false, ui.couleur(R.color.gris_texte)));
                break;
            }
            ajouterPiece(corps, t);
        }
        return carte;
    }

    /** Une pièce trouvée : clé, article, cote finie, couleurs, matière ; semaine, lancement, quantité ; ses problèmes. */
    private void ajouterPiece(LinearLayout corps, FichierPartage.Trouvaille t) {
        String[] p = t.piece;
        SpannableStringBuilder sb = new SpannableStringBuilder();
        gras(sb, valeur(p, "cle"));
        String dims = dimensions(valeur(p, "longueur"), valeur(p, "largeur"), valeur(p, "epaisseur"));
        String sousFace = valeur(p, "coloris_inf");
        sb.append(joindre(" · ", valeur(p, "article"), dims, valeur(p, "coloris"), sousFace.isEmpty() ? "" : "sous-face " + sousFace, valeur(p, "matiere")));
        sb.append("  ▸");
        TextView titrePiece = ui.texte(sb, 14, false, Ui.NOIR);
        // Toucher une pièce ouvre sa fiche (avec ses plans de coupe).
        titrePiece.setOnClickListener(v -> {
            requete = valeur(p, "cle");
            construire();
        });
        corps.addView(titrePiece, ui.marges(6, 0));
        String quantite = valeur(p, "pieces");
        corps.addView(ui.texte(t.semaine.libelle() + " · " + t.semaine.annee + " · " + t.lancement.nom + (t.lancement.poste.isEmpty() ? "" : " (" + t.lancement.poste + ")")
                + (quantite.isEmpty() ? "" : " · " + nombre(quantite) + " pièce(s)"), 13, false, ui.couleur(R.color.gris_texte)));
        for (FichierPartage.Probleme pb : t.problemes) {
            int[] c = couleursNiveau(pb.niveau);
            String debut = "valide".equals(pb.niveau) ? "Validé OK (" + dateLisibleCourte(pb.valide) + ") · " : "";
            corps.addView(ui.texte(symboleNiveau(pb.niveau) + " " + debut + pb.type + " : " + pb.detail, 13, true, c[1]), ui.marges(2, 0));
        }
    }

    // ---- Bibliothèque des semaines ----

    private void ecranBibliotheque() {
        entete("Outils", "Bibliothèque des semaines", "Les semaines gardées par Sentinelle sur le PC, dans le fichier partagé.");
        racine.addView(carteFichier());
        if (donnees == null || donnees.semaines.isEmpty()) {
            if (donnees != null) racine.addView(ui.texte("Le fichier ne contient encore aucune semaine.", 14, false, ui.couleur(R.color.gris_texte)), ui.marges(6, 6));
            return;
        }
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        corps.addView(ui.titre(donnees.semaines.size() + " semaine(s)", 17, Ui.BORDEAUX));
        corps.addView(ui.filetSaumon());
        int i = 0;
        for (FichierPartage.Semaine s : donnees.semaines) {
            LinearLayout r = ui.colonne();
            r.setPadding(ui.dp(8), ui.dp(8), ui.dp(8), ui.dp(8));
            if (i++ % 2 == 1) r.setBackgroundColor(Ui.GRIS_CLAIR);
            double pieces = 0;
            List<String> noms = new ArrayList<>();
            for (FichierPartage.Lancement l : s.lancements) {
                pieces += Math.floor(l.nbPieces);
                noms.add(l.nom);
            }
            r.addView(ui.texte(titreSemaine(s), 15, true, Ui.NOIR));
            String quand = dateLisible(s.maj);
            r.addView(ui.texte(s.lancements.size() + " lancement(s) · " + nombre(pieces) + " pièces" + (quand.isEmpty() ? "" : " · mis à jour le " + quand),
                    13, false, ui.couleur(R.color.gris_texte)));
            r.addView(ui.texte(String.join(", ", noms), 12, false, ui.couleur(R.color.gris_texte)));
            r.setOnClickListener(v -> {
                semaineChoisie = s.id;
                activite.allerA(MainActivity.ONGLET_CONTROLE);
            });
            corps.addView(r, ui.pleineLargeur());
        }
        racine.addView(carte);
    }

    private LinearLayout corpsDe(MaterialCardView carte) {
        LinearLayout corps = ui.colonne();
        corps.setPadding(ui.dp(14), ui.dp(12), ui.dp(14), ui.dp(12));
        carte.addView(corps);
        return corps;
    }

    private MaterialCardView carteFichier() {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        corps.addView(ui.titre("Lien avec le PC", 17, Ui.BORDEAUX));
        corps.addView(ui.filetSaumon());
        String code = codeLien();
        if (code != null) {
            corps.addView(ui.texte("✔ Relié au PC", 15, true, ui.couleur(R.color.ok_texte)));
            corps.addView(ui.texte("Code " + code, 13, false, ui.couleur(R.color.gris_texte)), ui.marges(2, 2));
            if (donnees != null) {
                String quand = dateLisible(donnees.genere);
                corps.addView(ui.texte("Données du PC du " + (quand.isEmpty() ? "?" : quand) + (donnees.par.isEmpty() ? "" : " · " + donnees.par)
                        + " · " + donnees.semaines.size() + " semaine(s)", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(2, 4));
            }
            if (enLecture) corps.addView(ui.texte("Lecture des données du PC…", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(4, 4));
            if (avertissement != null) corps.addView(ui.bandeau("⚠ " + avertissement, ui.couleur(R.color.attention_fond), ui.couleur(R.color.attention_texte)), ui.marges(4, 6));
            if (erreur != null) corps.addView(ui.bandeau("❌ " + erreur, ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)), ui.marges(4, 6));
            LinearLayout boutons = ui.rangee();
            MaterialButton actualiser = ui.bouton("Actualiser");
            actualiser.setEnabled(!enLecture);
            actualiser.setOnClickListener(v -> actualiser());
            boutons.addView(actualiser, ui.poids(1));
            boutons.addView(ui.espace(1), new LinearLayout.LayoutParams(ui.dp(8), 1));
            MaterialButton delier = ui.boutonContour("Délier");
            delier.setOnClickListener(v -> delier());
            boutons.addView(delier, ui.poids(1));
            corps.addView(boutons, ui.marges(6, 0));
            return carte;
        }
        corps.addView(ui.texte("Sur le PC : Bibliothèque des semaines → « Activer l'envoi au téléphone », puis tapez ici le code affiché (une seule fois). "
                + "Les données arrivent ensuite toutes seules, chiffrées.", 14, false, Ui.NOIR), ui.marges(0, 6));
        EditText champCode = champ("ABCD-EFGH-JKLM-NPQR", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, "");
        champCode.setTypeface(android.graphics.Typeface.MONOSPACE);
        corps.addView(champCode, ui.pleineLargeur());
        MaterialButton relier = ui.bouton("Relier au PC");
        relier.setOnClickListener(v -> relier(champCode.getText().toString()));
        corps.addView(relier, ui.marges(4, 0));
        if (erreur != null && uri() == null) corps.addView(ui.bandeau("❌ " + erreur, ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)), ui.marges(6, 6));

        // Sinon : le fichier partagé mis sur le Drive.
        corps.addView(ui.separateur());
        Uri uri = uri();
        if (uri == null) {
            corps.addView(ui.texte("Ou avec le Drive : choisissez le fichier « " + FichierPartage.NOM + " » que Sentinelle écrit sur le PC. "
                    + "L'appli le relit à chaque retour dans l'appli.", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(0, 6));
        } else {
            corps.addView(ui.texte(nomFichier != null ? nomFichier : FichierPartage.NOM, 15, true, Ui.NOIR));
            if (donnees != null) {
                String quand = dateLisible(donnees.genere);
                corps.addView(ui.texte("Généré " + (quand.isEmpty() ? "" : "le " + quand + " ") + (donnees.par.isEmpty() ? "" : "par " + donnees.par)
                        + " · " + donnees.semaines.size() + " semaine(s)", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(2, 4));
            }
            if (enLecture) corps.addView(ui.texte("Lecture du fichier…", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(4, 4));
            if (erreur != null) corps.addView(ui.bandeau("❌ " + erreur, ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)), ui.marges(4, 6));
        }
        LinearLayout boutons = ui.rangee();
        MaterialButton choisir = ui.boutonContour(uri == null ? "Choisir le fichier" : "Changer de fichier");
        choisir.setOnClickListener(v -> activite.choisirFichierPartage());
        boutons.addView(choisir, ui.poids(1));
        if (uri != null) {
            boutons.addView(ui.espace(1), new LinearLayout.LayoutParams(ui.dp(8), 1));
            MaterialButton actualiser = ui.bouton("Actualiser");
            actualiser.setEnabled(!enLecture);
            actualiser.setOnClickListener(v -> actualiser());
            boutons.addView(actualiser, ui.poids(1));
        }
        corps.addView(boutons, ui.marges(6, 0));
        return carte;
    }

    static final String TYPE_VALIDES = "Validé OK (voulu)";

    /** « 2026-11-06T10:21:00.000Z » → « 06/11 » (jour de l'appareil). */
    static String dateLisibleCourte(String iso) {
        String d = dateLisible(iso);
        int a = d.indexOf(" à ");
        return a > 0 ? d.substring(0, a) : d;
    }

    /** « 2026-10-31T10:21:00Z » → « 31/10 à 11:21 » (heure de l'appareil). */
    static String dateLisible(String iso) {
        if (iso == null || iso.isEmpty()) return "";
        try {
            SimpleDateFormat lecture = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT);
            lecture.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date d = lecture.parse(iso.length() >= 19 ? iso.substring(0, 19) : iso);
            return d == null ? "" : new SimpleDateFormat("dd/MM 'à' HH:mm", Locale.FRANCE).format(d);
        } catch (java.text.ParseException e) {
            return "";
        }
    }

    // ---- recherche ----

    private MaterialCardView carteRecherche() {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        corps.addView(ui.titre("Recherche", 17, Ui.BORDEAUX));
        corps.addView(ui.filetSaumon());
        LinearLayout ligne = ui.rangee();
        EditText champ = new EditText(activite);
        champ.setHint("Pièce ou commande");
        champ.setSingleLine(true);
        champ.setText(requete);
        champ.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        champ.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        Runnable chercher = () -> {
            requete = champ.getText().toString().trim();
            construire();
        };
        champ.setOnEditorActionListener((v, action, ev) -> {
            boolean entree = ev != null && ev.getKeyCode() == KeyEvent.KEYCODE_ENTER && ev.getAction() == KeyEvent.ACTION_DOWN;
            if (action == EditorInfo.IME_ACTION_SEARCH || entree) {
                chercher.run();
                return true;
            }
            return false;
        });
        ligne.addView(champ, ui.poids(1));
        MaterialButton bouton = ui.bouton("Chercher");
        bouton.setOnClickListener(v -> chercher.run());
        ligne.addView(bouton);
        if (!requete.isEmpty()) {
            MaterialButton effacer = ui.boutonTexte("✕");
            effacer.setContentDescription("Effacer la recherche");
            effacer.setOnClickListener(v -> {
                requete = "";
                construire();
            });
            ligne.addView(effacer);
        }
        corps.addView(ligne);
        corps.addView(ui.texte("26090331003 ou 26090331 (CVC facultatif), dans toutes les semaines du fichier partagé.", 12, false, ui.couleur(R.color.gris_texte)));
        return carte;
    }

    private String valeur(String[] piece, String colonne) {
        int i = donnees.colonne(colonne);
        return i >= 0 && i < piece.length ? piece[i] : "";
    }

    private MaterialCardView carteResultats() {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        List<FichierPartage.Trouvaille> res = donnees.chercher(requete);
        // Une seule pièce, cherchée par sa clé : sa fiche simple (comme sur le PC), avec ses plans de coupe.
        java.util.Set<String> cles = new java.util.LinkedHashSet<>();
        for (FichierPartage.Trouvaille t : res) cles.add(valeur(t.piece, "cle"));
        if (cles.size() == 1 && FichierPartage.correspond(cles.iterator().next(), requete) && cles.iterator().next().replaceFirst("^[A-Z]+", "").length() >= requete.replaceFirst("^[A-Z]+", "").length()
                && requete.replaceFirst("^[A-Z]+", "").length() >= 11) {
            try {
                return new FichePiece(activite, ui, donnees).carte(res);
            } catch (RuntimeException e) {
                // fiche impossible : la liste simple ci-dessous
            }
        }
        corps.addView(ui.titre(res.isEmpty() ? "« " + requete + " » introuvable" : res.size() + " résultat(s) pour « " + requete + " »", 15, Ui.BORDEAUX));
        corps.addView(ui.filetSaumon());
        int n = 0;
        for (FichierPartage.Trouvaille t : res) {
            if (n++ >= MAX_RESULTATS) {
                corps.addView(ui.texte("… et " + (res.size() - MAX_RESULTATS) + " autre(s) : précisez la recherche.", 13, false, ui.couleur(R.color.gris_texte)));
                break;
            }
            ajouterPiece(corps, t);
        }
        return carte;
    }

    // ---- semaine ----

    private FichierPartage.Semaine semaine() {
        for (FichierPartage.Semaine s : donnees.semaines) if (s.id.equals(semaineChoisie)) return s;
        FichierPartage.Semaine s = donnees.semaines.get(0);
        semaineChoisie = s.id;
        return s;
    }

    /** Choix de la semaine : ‹ semaine d'avant, « Semaine 46 · 2026 ▾ » (liste de toutes les semaines), semaine d'après ›. */
    private View choixSemaines(FichierPartage.Semaine choisie) {
        List<FichierPartage.Semaine> liste = donnees.semaines; // la plus récente d'abord
        int i = liste.indexOf(choisie);
        LinearLayout rangee = ui.rangee();
        rangee.setGravity(Gravity.CENTER_VERTICAL);
        MaterialButton avant = ui.boutonContour("‹");
        avant.setContentDescription("Semaine d'avant");
        avant.setEnabled(i >= 0 && i < liste.size() - 1);
        avant.setOnClickListener(v -> choisirSemaine(liste.get(i + 1)));
        MaterialButton choix = ui.bouton(choisie.libelle() + " · " + choisie.annee + "  ▾");
        choix.setContentDescription("Choisir la semaine (" + choisie.libelle() + " " + choisie.annee + ")");
        choix.setOnClickListener(v -> listeDesSemaines());
        MaterialButton apres = ui.boutonContour("›");
        apres.setContentDescription("Semaine d'après");
        apres.setEnabled(i > 0);
        apres.setOnClickListener(v -> choisirSemaine(liste.get(i - 1)));
        LinearLayout.LayoutParams lpBord = new LinearLayout.LayoutParams(ui.dp(56), ViewGroup.LayoutParams.WRAP_CONTENT);
        LinearLayout.LayoutParams lpMilieu = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        lpMilieu.setMargins(ui.dp(8), 0, ui.dp(8), 0);
        rangee.addView(avant, lpBord);
        rangee.addView(choix, lpMilieu);
        rangee.addView(apres, new LinearLayout.LayoutParams(ui.dp(56), ViewGroup.LayoutParams.WRAP_CONTENT));
        return rangee;
    }

    private void choisirSemaine(FichierPartage.Semaine s) {
        semaineChoisie = s.id;
        construire();
    }

    /** Toutes les semaines du fichier partagé, la plus récente d'abord, avec leur nombre de lancements. */
    private void listeDesSemaines() {
        List<FichierPartage.Semaine> liste = donnees.semaines;
        String[] noms = new String[liste.size()];
        for (int k = 0; k < liste.size(); k++) {
            FichierPartage.Semaine s = liste.get(k);
            noms[k] = s.libelle() + " · " + s.annee + " — " + s.lancements.size() + " lancement(s)";
        }
        new MaterialAlertDialogBuilder(activite)
                .setTitle("Choisir la semaine")
                .setItems(noms, (d, k) -> choisirSemaine(liste.get(k)))
                .setNegativeButton("Annuler", null)
                .show();
    }

    private static String nombre(String v) {
        try {
            double d = Double.parseDouble(v);
            return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
        } catch (NumberFormatException e) {
            return v;
        }
    }

    private static String nombre(Double v) {
        if (v == null) return "—";
        return v == Math.rint(v) ? String.valueOf(v.longValue()) : String.valueOf(v);
    }

    private static String dimensions(String l, String w, String e) {
        if (l.isEmpty() || w.isEmpty()) return "";
        return nombre(l) + " × " + nombre(w) + (e.isEmpty() ? "" : " × " + nombre(e));
    }

    private static String joindre(String sep, String... morceaux) {
        StringBuilder sb = new StringBuilder();
        for (String m : morceaux) {
            if (m == null || m.isEmpty()) continue;
            sb.append(sep).append(m);
        }
        return sb.toString();
    }

    private static void gras(SpannableStringBuilder sb, String t) {
        int debut = sb.length();
        sb.append(t);
        sb.setSpan(new StyleSpan(android.graphics.Typeface.BOLD), debut, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }

    /** { fond, texte } d'un état : ok, alerte, attention, info. */
    private int[] couleursStatut(String statut) {
        switch (statut == null ? "" : statut) {
            case "ok":
                return new int[] {ui.couleur(R.color.ok_fond), ui.couleur(R.color.ok_texte)};
            case "alerte":
                return new int[] {ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)};
            case "attention":
                return new int[] {ui.couleur(R.color.attention_fond), ui.couleur(R.color.attention_texte)};
            default:
                return new int[] {Ui.GRIS_CLAIR, ui.couleur(R.color.gris_texte)};
        }
    }

    private int[] couleursNiveau(String niveau) {
        if ("valide".equals(niveau)) return couleursStatut("ok");
        return couleursStatut("corriger".equals(niveau) ? "alerte" : "verifier".equals(niveau) ? "attention" : "info");
    }

    private static String symboleStatut(String statut) {
        return "ok".equals(statut) ? "✔" : "alerte".equals(statut) || "attention".equals(statut) ? "⚠" : "—";
    }

    private static String symboleNiveau(String niveau) {
        if ("valide".equals(niveau)) return "✔";
        return "corriger".equals(niveau) || "verifier".equals(niveau) ? "⚠" : "•";
    }

    /** « Agglo 1er tour », « Casse »… ; un chantier : le nom de son lancement (« LAN2647AIRDESIGN » → « AIRDESIGN »). */
    static String titrePoste(FichierPartage.Lancement l) {
        if (l.poste.isEmpty()) return l.nom;
        return "Chantiers".equals(l.poste) ? CompteRendu.nomChantier(l.nom) : l.poste;
    }

    /** Une cellule du tableau des lancements : { texte, statut }. */
    private static String[] cellule(Integer n, String suffixe) {
        if (n == null) return new String[] {"—", "info"};
        if (n < 0) return new String[] {"❌", "alerte"};
        return n == 0 ? new String[] {"✔ OK", "ok"} : new String[] {"⚠ " + n + suffixe, "alerte"};
    }

    private static String[] celluleCouleurs(FichierPartage.Lancement l) {
        if (l.couleursAbsentes == null) return new String[] {"—", "info"};
        if (l.couleursAbsentes > 0) return new String[] {"⚠ " + l.couleursAbsentes, "alerte"};
        return new String[] {"✔ OK", "ok"};
    }

    private TextView celluleTexte(String[] c, boolean droite) {
        TextView v = ui.texte(c[0], 13, !"info".equals(c[1]), couleursStatut(c[1])[1]);
        if ("info".equals(c[1]) && !"—".equals(c[0])) v.setTextColor(Ui.NOIR);
        v.setGravity(droite ? Gravity.END : Gravity.CENTER_HORIZONTAL);
        return v;
    }

    private MaterialCardView carteTableau(FichierPartage.Semaine s) {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        corps.addView(ui.titre(s.libelle() + " — lancements", 17, Ui.BORDEAUX));
        String quand = dateLisible(s.maj);
        if (!quand.isEmpty()) corps.addView(ui.texte("Mise à jour le " + quand, 12, false, ui.couleur(R.color.gris_texte)));
        corps.addView(ui.filetSaumon());
        LinearLayout entete = ui.rangee();
        entete.setBackgroundColor(Ui.BORDEAUX);
        entete.setPadding(ui.dp(6), ui.dp(6), ui.dp(6), ui.dp(6));
        String[] titres = {"Poste", "Prévues", ".bkp", "Contrôle", "Scies", "Couleurs"};
        float[] poids = {2.3f, 1f, 1f, 1.35f, 1f, 1.25f};
        for (int i = 0; i < titres.length; i++) {
            TextView t = ui.texte(titres[i].toUpperCase(Locale.FRANCE), 9, true, 0xFFFFFFFF);
            t.setMaxLines(1);
            t.setGravity(i == 0 ? Gravity.START : i < 3 ? Gravity.END : Gravity.CENTER_HORIZONTAL);
            entete.addView(t, ui.poids(poids[i]));
        }
        corps.addView(entete);
        int i = 0;
        for (FichierPartage.Lancement l : s.lancements) {
            LinearLayout r = ui.rangee();
            r.setPadding(ui.dp(6), ui.dp(7), ui.dp(6), ui.dp(7));
            if (i++ % 2 == 1) r.setBackgroundColor(Ui.GRIS_CLAIR);
            LinearLayout nom = ui.colonne();
            nom.addView(ui.texte(titrePoste(l), 13, true, Ui.NOIR));
            nom.addView(ui.texte(l.nom, 11, false, ui.couleur(R.color.gris_texte)));
            r.addView(nom, ui.poids(poids[0]));
            r.addView(celluleTexte(new String[] {nombre(l.prevues), "info"}, true), ui.poids(poids[1]));
            r.addView(celluleTexte(new String[] {nombre(l.bkp), "info"}, true), ui.poids(poids[2]));
            r.addView(celluleTexte(cellule(l.controle, ""), false), ui.poids(poids[3]));
            r.addView(celluleTexte(cellule(l.scies, ""), false), ui.poids(poids[4]));
            r.addView(celluleTexte(celluleCouleurs(l), false), ui.poids(poids[5]));
            corps.addView(r);
        }
        // Total de la semaine.
        double prevues = 0;
        double bkp = 0;
        boolean avecBkp = false;
        for (FichierPartage.Lancement l : s.lancements) {
            if (l.prevues != null) prevues += Math.floor(l.prevues);
            if (l.bkp != null) {
                bkp += Math.floor(l.bkp);
                avecBkp = true;
            }
        }
        LinearLayout total = ui.rangee();
        total.setBackgroundColor(Ui.BORDEAUX);
        total.setPadding(ui.dp(6), ui.dp(7), ui.dp(6), ui.dp(7));
        TextView libelleTotal = ui.texte("Total", 13, true, 0xFFFFFFFF);
        total.addView(libelleTotal, ui.poids(poids[0]));
        TextView tPrevues = ui.texte(nombre(prevues), 13, true, 0xFFFFFFFF);
        tPrevues.setGravity(Gravity.END);
        total.addView(tPrevues, ui.poids(poids[1]));
        TextView tBkp = ui.texte(avecBkp ? nombre(bkp) : "—", 13, true, 0xFFFFFFFF);
        tBkp.setGravity(Gravity.END);
        total.addView(tBkp, ui.poids(poids[2]));
        total.addView(ui.espace(1), ui.poids(poids[3] + poids[4] + poids[5]));
        corps.addView(total);

        // Bilan de la semaine : pièces, pièces lancées deux fois, casse.
        corps.addView(ui.texte("Pièces : " + nombre(prevues) + " prévues dans " + s.lancements.size() + " lancement(s)"
                + (avecBkp ? ", " + nombre(bkp) + " dans les .bkp" : "") + ".", 14, true, Ui.NOIR), ui.marges(10, 4));
        Map<String, List<String>> deuxFois = FichierPartage.lanceesDeuxFois(s, donnees.colonne("cle"));
        if (deuxFois.isEmpty()) corps.addView(ui.bandeau("✔ Aucune pièce lancée deux fois", ui.couleur(R.color.ok_fond), ui.couleur(R.color.ok_texte)), ui.marges(2, 2));
        else corps.addView(ui.bandeau("⚠ " + deuxFois.size() + " pièce(s) lancée(s) deux fois : elles sont dans deux lancements",
                ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)), ui.marges(2, 2));
        for (FichierPartage.Lancement l : s.lancements) {
            View casse = bandeauCasse(l, true);
            if (casse != null) corps.addView(casse, ui.marges(2, 2));
        }
        return carte;
    }

    /** « Casse : 61 pièces — 13 déjà lancée(s) en semaine 44, 47 rajout(s) » (null si ce n'est pas une casse comptée). */
    private View bandeauCasse(FichierPartage.Lancement l, boolean avecNom) {
        if (!l.casse) return null;
        String debut = "Casse" + (avecNom ? " (" + l.nom + ")" : "") + " : " + nombre(l.prevues) + " pièce(s)";
        if (l.casseDejaLancees == null)
            return ui.bandeau(debut + " — pièces déjà lancées pas comptées (semaines d'avant absentes sur le PC)", Ui.GRIS_CLAIR, ui.couleur(R.color.gris_texte));
        if (l.casseDejaLancees == 0)
            return ui.bandeau(debut + " — aucune n'était déjà lancée " + l.cassePeriode + ", " + l.casseRajouts + " rajout(s)",
                    ui.couleur(R.color.ok_fond), ui.couleur(R.color.ok_texte));
        return ui.bandeau("🔁 " + debut + " — " + l.casseDejaLancees + " déjà lancée(s) " + l.casseOu + ", " + l.casseRajouts + " rajout(s)",
                ui.couleur(R.color.attention_fond), ui.couleur(R.color.attention_texte));
    }

    private MaterialCardView carteLancement(FichierPartage.Lancement l, int numero) {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        LinearLayout tete = ui.rangee();
        tete.addView(ui.pastille(numero));
        LinearLayout titres = ui.colonne();
        titres.setPadding(ui.dp(10), 0, 0, 0);
        titres.addView(ui.titre(titrePoste(l), 16, Ui.BORDEAUX));
        titres.addView(ui.texte(l.fichier.isEmpty() ? l.nom : l.fichier, 12, false, ui.couleur(R.color.gris_texte)));
        tete.addView(titres, ui.poids(1));
        corps.addView(tete);
        corps.addView(ui.filetSaumon());

        if (!l.controleFait) {
            corps.addView(ui.bandeau("Pas de bilan des contrôles pour ce lancement (semaine ajoutée depuis les archives).", Ui.GRIS_CLAIR, ui.couleur(R.color.gris_texte)));
        } else {
            int[] c = couleursStatut(l.nbCorriger > 0 ? "alerte" : l.nbVerifier > 0 ? "attention" : "ok");
            String resume = l.nbCorriger + l.nbVerifier == 0 ? "✔ Aucun problème"
                    : "⚠ " + (l.nbCorriger > 0 ? l.nbCorriger + " à corriger" : "") + (l.nbCorriger > 0 && l.nbVerifier > 0 ? " · " : "")
                    + (l.nbVerifier > 0 ? l.nbVerifier + " à vérifier" : "");
            corps.addView(ui.bandeau(resume, c[0], c[1]), ui.marges(0, 8));
            View casse = bandeauCasse(l, false);
            if (casse != null) corps.addView(casse, ui.marges(0, 8));
            for (FichierPartage.Bilan b : l.bilan) {
                SpannableStringBuilder sb = new SpannableStringBuilder();
                int debut = sb.length();
                sb.append(symboleStatut(b.statut)).append("  ");
                sb.setSpan(new ForegroundColorSpan(couleursStatut(b.statut)[1]), debut, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                gras(sb, b.controle);
                sb.append(" : ").append(b.texte);
                corps.addView(ui.texte(sb, 13, false, Ui.NOIR), ui.marges(2, 2));
            }
        }

        // Problèmes, regroupés par type (dans l'ordre du rapport : les plus graves d'abord).
        // Les problèmes validés « c'est voulu » sur le PC : à la fin, ils ne comptent plus.
        Map<String, List<FichierPartage.Probleme>> parType = new LinkedHashMap<>();
        List<FichierPartage.Probleme> valides = new ArrayList<>();
        for (FichierPartage.Probleme p : l.problemes) {
            if ("valide".equals(p.niveau)) {
                valides.add(p);
                continue;
            }
            if (!parType.containsKey(p.type)) parType.put(p.type, new ArrayList<>());
            parType.get(p.type).add(p);
        }
        if (!valides.isEmpty()) parType.put(TYPE_VALIDES, valides);
        for (Map.Entry<String, List<FichierPartage.Probleme>> e : parType.entrySet()) {
            List<FichierPartage.Probleme> liste = e.getValue();
            String niveau = "info";
            for (FichierPartage.Probleme p : liste) {
                if ("corriger".equals(p.niveau)) niveau = "corriger";
                else if ("verifier".equals(p.niveau) && !"corriger".equals(niveau)) niveau = "verifier";
            }
            boolean groupeValides = TYPE_VALIDES.equals(e.getKey());
            if (groupeValides) niveau = "valide";
            int[] c = couleursNiveau(niveau);
            corps.addView(ui.bandeau((groupeValides ? "✔ " : "") + e.getKey() + " — " + liste.size() + " pièce(s)", c[0], c[1]), ui.marges(12, 2));
            String[] explication = donnees.explications.get(e.getKey());
            if (explication != null) {
                String texte = explication[0] + (explication[1].isEmpty() ? "" : " Que faire : " + explication[1]);
                corps.addView(ui.texte(texte, 12, false, ui.couleur(R.color.gris_texte)), ui.marges(2, 4));
            }
            int max = "info".equals(niveau) ? 10 : MAX_PAR_TYPE;
            int n = 0;
            for (FichierPartage.Probleme p : liste) {
                if (n++ >= max) {
                    corps.addView(ui.texte("… et " + (liste.size() - max) + " autre(s) (voir sur le PC).", 12, false, ui.couleur(R.color.gris_texte)));
                    break;
                }
                SpannableStringBuilder sb = new SpannableStringBuilder();
                gras(sb, p.cle);
                // Comme sur le PC : « 3460 × 670 × 39 mm · dessus 1047 · dessous RCB ».
                String[] faces = p.coloris.split(" / ", 2);
                String couleurs = faces.length > 1 ? "dessus " + faces[0] + " · dessous " + faces[1] : p.coloris.isEmpty() ? "" : "couleur " + p.coloris;
                sb.append(joindre(" · ", p.article, p.dimensions.isEmpty() ? "" : p.dimensions + " mm", couleurs, p.quantite.isEmpty() ? "" : "qté " + p.quantite));
                corps.addView(ui.texte(sb, 13, false, Ui.NOIR), ui.marges(4, 0));
                String detail = groupeValides ? p.type + " : " + p.detail + " — validé le " + dateLisibleCourte(p.valide) : p.detail;
                corps.addView(ui.texte(detail + (p.lignes.isEmpty() || "hors lancement".equals(p.lignes) ? "" : " (ligne(s) " + p.lignes + ")"),
                        12, false, ui.couleur(R.color.gris_texte)));
            }
        }
        if (!l.fichiers.isEmpty()) {
            StringBuilder f = new StringBuilder("Comparé avec : ");
            boolean premier = true;
            for (String nom : l.fichiers.values()) {
                if (!premier) f.append(", ");
                f.append(nom);
                premier = false;
            }
            TextView t = ui.texte(f.toString(), 11, false, ui.couleur(R.color.gris_texte));
            t.setTypeface(ui.latoItalique());
            corps.addView(t, ui.marges(10, 0));
        }
        return carte;
    }
}
