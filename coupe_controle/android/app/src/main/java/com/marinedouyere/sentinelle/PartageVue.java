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
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONObject;

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

    enum Ecran { SEMAINE, CONTROLE, RECHERCHE, BIBLIOTHEQUE, SUIVI, PLANS, STOCK, CLAUSTRAS }

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
    // Clavier choisi (chiffres par défaut, « ABC » pour les lettres), gardé tant que l'appli est ouverte.
    private boolean lettresRecherche = false;
    private boolean lettresCouleur = false;
    private boolean lettresColoris = false;
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

    /** V6.3 : ce que le téléphone demande au PC (plans modifiés, problèmes validés OK), en attente de réponse. */
    private final DemandesPc demandes;
    private final EcranPlans plans;
    /** V6.5.1 : le stock des panneaux (envoyé par le PC dans le fichier partagé). */
    private final EcranStock stockEcran;
    /** V6.8 : photo du plan d'un claustra pour le PC. */
    private final EcranClaustras claustrasEcran;

    PartageVue(MainActivity activite, Ui ui, SentinelleApp app) {
        this.activite = activite;
        this.ui = ui;
        this.app = app;
        racine = ui.colonne();
        demandes = new DemandesPc(activite);
        stockEcran = new EcranStock(activite, ui, this);
        claustrasEcran = new EcranClaustras(activite, ui, new EcranClaustras.Hote() {
            @Override
            public FichierPartage donnees() {
                return donnees;
            }

            @Override
            public DemandesPc demandes() {
                return demandes;
            }

            @Override
            public boolean relie() {
                return codeLien() != null;
            }

            @Override
            public void prendrePhoto(String commande) {
                activite.prendrePhotoPlan(commande);
            }

            @Override
            public void choisirPhoto(String commande) {
                activite.choisirPhotoPlan(commande);
            }
        });
        plans = new EcranPlans(activite, ui, new EcranPlans.Hote() {
            @Override
            public FichierPartage donnees() {
                return donnees;
            }

            @Override
            public void reconstruire() {
                construire();
            }

            @Override
            public boolean relie() {
                return codeLien() != null;
            }

            @Override
            public DemandesPc demandes() {
                return demandes;
            }

            @Override
            public void envoyerDemande(JSONObject d) {
                PartageVue.this.envoyerDemande(d);
            }
        });
    }

    DemandesPc demandes() {
        return demandes;
    }

    EcranPlans plans() {
        return plans;
    }

    /** Une demande pour le PC : en file d'attente, puis envoyée (chiffrée) ; le PC répond dans le fichier partagé. */
    void envoyerDemande(JSONObject d) {
        try {
            demandes.ajouter(d);
        } catch (org.json.JSONException e) {
            return;
        }
        android.widget.Toast.makeText(activite, "Envoyé au PC : il le reprendra tout seul.", android.widget.Toast.LENGTH_LONG).show();
        envoyerAuPc();
        construire();
    }

    /** Dépose les demandes en attente sur le site (canal retour), sans effacer celles d'un autre téléphone. */
    void envoyerAuPc() {
        final String code = codeLien();
        // V6.5.1 : on dépose aussi pour dire au PC quelle version on a lue (il voit si le téléphone est à jour).
        if (code == null || (demandes.enAttente().isEmpty() && !demandes.accuseAEnvoyer())) return;
        final java.util.Map<String, String[]> reponses = donnees != null ? new java.util.HashMap<>(donnees.reponsesPc) : null;
        app.annexe.execute(() -> {
            final boolean avecDemandes = !demandes.enAttente().isEmpty();
            try {
                byte[] cle = cleDe(code);
                String canal = LienPc.canalRetour(code);
                org.json.JSONArray autres = new org.json.JSONArray();
                JSONObject lecturesAutres = null;
                try {
                    LienPc.Recu r = LienPc.telechargerCanal(canal);
                    byte[] clair = LienPc.dechiffrer(r.paquet, cle);
                    autres = DemandesPc.autres(clair, demandes.appareil(), reponses);
                    lecturesAutres = DemandesPc.lecturesDuPaquet(clair);
                } catch (LienPc.RienPourCeCode e) {
                    // rien encore sur le site
                } catch (Exception e) {
                    // paquet illisible : il est remplacé
                }
                java.util.Set<String> ids = new java.util.HashSet<>();
                for (JSONObject d : demandes.enAttente()) ids.add(d.optString("id"));
                String versionLue = demandes.versionLue();
                LienPc.deposer(canal, LienPc.jetonRetour(code), LienPc.chiffrer(demandes.contenu(autres, lecturesAutres), cle));
                demandes.envoyees(ids);
                demandes.accuseEnvoye(versionLue);
            } catch (Exception e) {
                // L'accusé de lecture seul : rien à signaler (il repartira à la prochaine lecture).
                if (avecDemandes) demandes.erreurEnvoi(e.getMessage() != null ? e.getMessage() : e.toString());
            }
            principal.post(this::construire);
        });
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

    /** QR code scanné (lecteur de l'appareil photo) : relie l'appli au PC s'il vient bien de Sentinelle. */
    void qrScanne(String texte) {
        String code = LienPc.codeDuQr(texte);
        if (code == null) {
            erreur = "Ce QR code n'est pas celui de Sentinelle : sur le PC, ouvrez Bibliothèque des semaines → Téléphone, et scannez le QR code affiché.";
            construire();
            return;
        }
        erreur = null;
        relier(code);
    }

    private void delier() {
        new MaterialAlertDialogBuilder(activite)
                .setTitle("Délier du PC ?")
                .setMessage("L'appli ne recevra plus les données du PC. Il faudra rescanner le QR code (ou retaper le code) pour la relier.")
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
                    demandes.lu(r.version, r.genere);
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
                if (resultat != null) {
                    // Les réponses du PC : les demandes reprises sortent de la file ; les autres repartent si besoin.
                    if (demandes.reponses(resultat.reponsesPc) > 0) construire();
                    if (demandes.aEnvoyer() || demandes.erreur() != null || demandes.accuseAEnvoyer()) envoyerAuPc();
                    activite.partageCharge();
                }
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

    void reconstruire() {
        construire();
    }

    private void construire() {
        racine.removeAllViews();
        avisDuPc();
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
            case SUIVI:
                ecranSuivi();
                break;
            case PLANS:
                ecranPlans();
                break;
            case STOCK:
                ecranStock();
                break;
            case CLAUSTRAS:
                ecranClaustras();
                break;
            default:
                ecranSemaine();
        }
    }

    /** En-tête de page comme sur le PC : surtitre, titre, une info courte (dates…). */
    private void entete(String surtitre, String titre, String chapeau) {
        entete(surtitre, titre, chapeau, null);
    }

    /** V6.9 : l'explication de l'écran est derrière le « ? » à côté du titre (moins de texte en haut). */
    private void entete(String surtitre, String titre, String chapeau, String aide) {
        LinearLayout e = ui.colonne();
        e.setPadding(ui.dp(2), ui.dp(2), ui.dp(2), ui.dp(6));
        TextView sur = ui.texte(surtitre.toUpperCase(Locale.FRANCE), 10.5f, true, Ui.GRIS);
        sur.setLetterSpacing(0.12f);
        e.addView(sur);
        TextView t = ui.titre(titre, 22, Ui.BORDEAUX);
        if (aide != null && !aide.isEmpty()) {
            TextView explication = ui.texteAide(aide);
            e.addView(ui.titreEtAide(t, explication), ui.marges(1, 1));
            if (chapeau != null && !chapeau.isEmpty()) e.addView(ui.texte(chapeau, 13, false, ui.couleur(R.color.gris_texte)));
            e.addView(explication, ui.marges(4, 0));
        } else {
            e.addView(t, ui.marges(1, 1));
            if (chapeau != null && !chapeau.isEmpty()) e.addView(ui.texte(chapeau, 13, false, ui.couleur(R.color.gris_texte)));
        }
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

    /** Les chiffres clés dans une seule carte : { valeur, légende, "souci" ou null } par colonne. */
    View bandeChiffres(String[]... chiffres) {
        MaterialCardView carte = ui.carte();
        LinearLayout r = ui.rangee();
        r.setPadding(ui.dp(4), ui.dp(10), ui.dp(4), ui.dp(10));
        r.setGravity(Gravity.TOP);
        for (int i = 0; i < chiffres.length; i++) {
            if (i > 0) {
                View f = new View(activite);
                f.setBackgroundColor(ui.couleur(R.color.bordure));
                r.addView(f, new LinearLayout.LayoutParams(Math.max(1, ui.dp(1)), ViewGroup.LayoutParams.MATCH_PARENT));
            }
            LinearLayout c = ui.colonne();
            c.setGravity(Gravity.CENTER_HORIZONTAL);
            c.setPadding(ui.dp(4), 0, ui.dp(4), 0);
            TextView legende = ui.texte(chiffres[i][1], 11, false, ui.couleur(R.color.gris_texte));
            legende.setGravity(Gravity.CENTER_HORIZONTAL);
            c.addView(legende);
            boolean souci = chiffres[i].length > 2 && chiffres[i][2] != null;
            TextView valeur = ui.titre(chiffres[i][0], 19, souci ? ui.couleur(R.color.alerte_texte) : Ui.NOIR);
            valeur.setGravity(Gravity.CENTER_HORIZONTAL);
            c.addView(valeur);
            if (chiffres[i].length > 3 && chiffres[i][3] != null) {
                TextView plus = ui.texte(chiffres[i][3], 10.5f, true, ui.couleur(R.color.ok_texte));
                plus.setGravity(Gravity.CENTER_HORIZONTAL);
                c.addView(plus);
            }
            r.addView(c, ui.poids(1));
        }
        carte.addView(r);
        return carte;
    }

    private void ecranSemaine() {
        if (donnees == null || donnees.semaines.isEmpty()) {
            entete("La semaine", "Sentinelle", null, "Les résultats de Sentinelle sur le PC, lus dans le fichier partagé.");
            sansDonnees();
            return;
        }
        FichierPartage.Semaine s = semaine();
        entete(semaineEnCours(s) ? "Semaine en cours" : "Semaine", titreSemaine(s), CompteRendu.datesSemaine(s.annee, s.semaine));
        ligneDonneesDuPc();
        racine.addView(choixSemaines(s), ui.marges(2, 4));
        int controles = 0;
        int nbProblemes = 0;
        double pieces = 0;
        for (FichierPartage.Lancement l : s.lancements) {
            if (controle(l)) controles++;
            nbProblemes += aRegarder(l).size();
            pieces += piecesDe(l);
        }
        // Comme sur le PC : lancements, pièces, contrôles faits, à regarder.
        racine.addView(bandeChiffres(new String[] {String.valueOf(s.lancements.size()), "Lancements"}, new String[] {nombre(pieces), "Pièces"},
                new String[] {controles + " sur " + s.lancements.size(), "Contrôles faits"},
                new String[] {String.valueOf(nbProblemes), "À regarder", nbProblemes > 0 ? "souci" : null}));

        // Ce qu'il faut regarder d'abord.
        if (nbProblemes > 0) {
            MaterialCardView carte = ui.carte();
            carte.setStrokeColor(Ui.SAUMON);
            LinearLayout corps = corpsDe(carte);
            corps.addView(ui.titreCarte("À regarder"));
            for (FichierPartage.Lancement l : s.lancements)
                for (String t : aRegarder(l)) {
                    corps.addView(ui.filet());
                    TextView pt = ui.texte("●", 12, false, ui.couleur(R.color.alerte_texte));
                    corps.addView(ui.ligne(pt, titrePoste(l), t, null, "›", v -> voirControle(l)));
                }
            racine.addView(carte);
        }

        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        corps.addView(ui.titreCarte("Les lancements de la semaine"));
        int numero = 1;
        for (FichierPartage.Lancement l : s.lancements) {
            corps.addView(ui.filet(8, 0));
            LinearLayout droite = ui.colonne();
            droite.setGravity(Gravity.END);
            droite.addView(ui.texte(nombre(piecesDe(l)) + " pièces", 13, true, Ui.NOIR));
            String[] e = etatControle(l);
            droite.addView(etiquette(e), ui.marges(3, 0));
            String coupe = etatCoupe(l)[0];
            corps.addView(ui.ligne(ui.pastille(numero++), titrePoste(l), (l.fichier.isEmpty() ? l.nom : l.fichier) + ("—".equals(coupe) ? "" : " · " + coupe), droite, "›",
                    v -> voirControle(l)));
        }
        racine.addView(carte);
    }

    private void voirControle(FichierPartage.Lancement l) {
        lancementAMontrer = l.nom;
        activite.allerA(MainActivity.ONGLET_CONTROLE);
    }

    // ---- Contrôler la coupe ----

    private void ecranControle() {
        if (donnees == null || donnees.semaines.isEmpty()) {
            entete("Contrôler la coupe", "Contrôler la coupe", null, "Les contrôles faits par Sentinelle sur le PC.");
            sansDonnees();
            return;
        }
        FichierPartage.Semaine s = semaine();
        String quand = dateLisible(s.maj);
        entete("Contrôler la coupe", titreSemaine(s), quand.isEmpty() ? null : "Mis à jour le " + quand + ".", "Les contrôles faits par Sentinelle sur le PC. Touchez un lancement pour ouvrir son bilan et ses pièces.");
        racine.addView(choixSemaines(s), ui.marges(2, 4));
        MaterialButton compteRendu = ui.boutonContour(pdfEnCours ? "Compte rendu en cours…" : "Compte rendu de la semaine (.pdf)");
        compteRendu.setEnabled(!pdfEnCours);
        compteRendu.setOnClickListener(v -> compteRendu(s));
        racine.addView(compteRendu, ui.marges(0, 2));
        if (lancementAMontrer != null) controlesOuverts.add(lancementAMontrer);
        racine.addView(carteTableau(s));
        racine.addView(ui.texte("Détail par lancement", 15, true, Ui.NOIR), ui.marges(8, 0));
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
        entete("Outils", "Rechercher une pièce", null, "Dans toutes les semaines du fichier partagé.");
        if (sansDonnees()) return;
        racine.addView(carteRecherche());
        if (!requete.isEmpty()) racine.addView(carteResultats());
        racine.addView(carteSansEtiquette());
        if (sansEtiquette != null) racine.addView(carteResultatsSansEtiquette());
    }

    EditText champ(String indice, int type, String valeur) {
        EditText e = new EditText(activite);
        e.setHint(indice);
        e.setSingleLine(true);
        e.setInputType(type);
        e.setText(valeur);
        e.setTypeface(ui.lato());
        e.setTextSize(15);
        android.graphics.drawable.GradientDrawable fond = ui.fondRond(0xFFFFFFFF, 10);
        fond.setStroke(Math.max(1, ui.dp(1)), 0xFFD9D4CF);
        e.setBackground(fond);
        e.setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(10));
        return e;
    }

    // ---- Clavier : chiffres par défaut (CVC, commandes, couleurs), « ABC » pour passer aux lettres ----
    static final int CLAVIER_CHIFFRES = InputType.TYPE_CLASS_NUMBER;
    static final int CLAVIER_LETTRES = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;

    interface ChoixClavier {
        void garder(boolean lettres);
    }

    MaterialButton boutonClavier(EditText champ, boolean lettres, ChoixClavier choix) {
        final boolean[] etat = {lettres};
        MaterialButton b = ui.boutonTexte(lettres ? "123" : "ABC");
        b.setContentDescription(lettres ? "Clavier chiffres" : "Clavier lettres");
        b.setOnClickListener(v -> {
            etat[0] = !etat[0];
            choix.garder(etat[0]);
            int pos = champ.getSelectionEnd();
            champ.setInputType(etat[0] ? CLAVIER_LETTRES : CLAVIER_CHIFFRES);
            champ.setSelection(Math.max(0, Math.min(pos < 0 ? champ.length() : pos, champ.length())));
            b.setText(etat[0] ? "123" : "ABC");
            b.setContentDescription(etat[0] ? "Clavier chiffres" : "Clavier lettres");
            champ.requestFocus();
            InputMethodManager imm = (InputMethodManager) activite.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) {
                imm.restartInput(champ);
                imm.showSoftInput(champ, InputMethodManager.SHOW_IMPLICIT);
            }
        });
        return b;
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
        corps.addView(ui.titreCarte("Pièce sans étiquette"));
        corps.addView(ui.texte("Cote finie mesurée sur la pièce : la première mesure est le sens du fil. À 2 mm près.", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(0, 6));
        String[] v = sansEtiquette != null ? sansEtiquette : new String[] {"", "", "", ""};
        int nombre = InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL;
        EditText longueur = champ("mm", nombre, v[0]);
        EditText largeur = champ("mm", nombre, v[1]);
        EditText couleur = champ("facultatif", lettresCouleur ? CLAVIER_LETTRES : CLAVIER_CHIFFRES, v[2]);
        EditText semaine = champ("n°", InputType.TYPE_CLASS_NUMBER, v[3]);
        LinearLayout cotes = ui.rangee();
        cotes.addView(libelle("Longueur (sens du fil)", longueur), ui.poids(1));
        cotes.addView(ui.espace(1), new LinearLayout.LayoutParams(ui.dp(10), 1));
        cotes.addView(libelle("Largeur", largeur), ui.poids(1));
        corps.addView(cotes, ui.pleineLargeur());
        LinearLayout autres = ui.rangee();
        LinearLayout ligneCouleur = ui.rangee();
        ligneCouleur.addView(couleur, ui.poids(1));
        ligneCouleur.addView(boutonClavier(couleur, lettresCouleur, l -> lettresCouleur = l));
        autres.addView(libelle("Couleur", ligneCouleur), ui.poids(1));
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
        corps.addView(ui.titreCarte(res.size() + " pièce(s) — " + quoi + " (± 2 mm), semaine " + semaine));
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
        entete("Outils", "Bibliothèque des semaines", null, "Les semaines gardées par Sentinelle sur le PC, dans le fichier partagé.");
        racine.addView(carteFichier());
        View envois = carteEnvoisPc();
        if (envois != null) racine.addView(envois);
        if (donnees == null || donnees.semaines.isEmpty()) {
            if (donnees != null) racine.addView(ui.texte("Le fichier ne contient encore aucune semaine.", 14, false, ui.couleur(R.color.gris_texte)), ui.marges(6, 6));
            return;
        }
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        corps.addView(ui.titreCarte(donnees.semaines.size() + " semaine(s)"));
        for (FichierPartage.Semaine s : donnees.semaines) {
            double pieces = 0;
            List<String> noms = new ArrayList<>();
            for (FichierPartage.Lancement l : s.lancements) {
                pieces += Math.floor(l.nbPieces);
                noms.add(l.nom);
            }
            String quand = dateLisible(s.maj);
            corps.addView(ui.filet(8, 0));
            LinearLayout r = ui.ligne(null, titreSemaine(s), s.lancements.size() + " lancement(s) · " + nombre(pieces) + " pièces" + (quand.isEmpty() ? "" : " · mis à jour le " + quand),
                    null, "›", v -> {
                        semaineChoisie = s.id;
                        activite.allerA(MainActivity.ONGLET_CONTROLE);
                    });
            TextView lances = ui.texte(String.join(", ", noms), 11.5f, false, ui.couleur(R.color.gris_texte));
            // V6.5.4 : tous les noms (avant : 2 lignes, la suite coupée par « … »).
            ((LinearLayout) r.getChildAt(0)).addView(lances);
            corps.addView(r);
        }
        racine.addView(carte);
    }

    /** V6.3 : ce qui est parti au PC (plans modifiés, validations) : en attente de sa réponse, et ses dernières réponses. */
    private View carteEnvoisPc() {
        List<JSONObject> attente = demandes.enAttente();
        List<JSONObject> res = demandes.resultats();
        if (attente.isEmpty() && res.isEmpty()) return null;
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        corps.addView(ui.titreCarte("Envoyé au PC"));
        corps.addView(ui.note("Plans modifiés et problèmes validés OK depuis le téléphone : le PC les reprend tout seul et répond ici."));
        for (JSONObject d : attente) {
            corps.addView(ui.filet(6, 0));
            String etat = d.optBoolean("envoyee") ? "envoyé, pas encore repris par le PC" : "pas encore envoyé";
            corps.addView(ui.ligne(ui.texte("⏳", 14, false, ui.couleur(R.color.attention_texte)), d.optString("titre"), d.optString("lancement") + " · " + etat, null, null, null));
        }
        int n = 0;
        for (JSONObject r : res) {
            if (n++ >= 5) break;
            corps.addView(ui.filet(6, 0));
            boolean ok = r.optBoolean("ok");
            corps.addView(ui.ligne(ui.texte(ok ? "✔" : "⚠", 14, true, ok ? ui.couleur(R.color.ok_texte) : ui.couleur(R.color.attention_texte)), r.optString("titre"),
                    (ok ? "Repris par le PC : " : "Pas repris : ") + r.optString("texte"), null, null, null));
        }
        if (demandes.erreur() != null && !attente.isEmpty()) {
            corps.addView(ui.bandeau("⚠ Envoi au PC : " + demandes.erreur(), ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)), ui.marges(6, 4));
            MaterialButton renvoyer = ui.bouton("Renvoyer au PC");
            renvoyer.setOnClickListener(v -> envoyerAuPc());
            corps.addView(renvoyer, ui.marges(4, 0));
        }
        return carte;
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
        corps.addView(ui.titreCarte("Lien avec le PC"));
        String code = codeLien();
        if (code != null) {
            TextView point = ui.texte("●", 14, false, enLecture ? Ui.GRIS : erreur != null ? ui.couleur(R.color.alerte_texte) : ui.couleur(R.color.ok_texte));
            String sous = "Code " + code;
            if (donnees != null) {
                String quand = dateLisible(donnees.genere);
                sous = "Données du PC" + (donnees.poste.isEmpty() ? "" : " « " + donnees.poste + " »") + " du " + (quand.isEmpty() ? "?" : quand) + " · " + donnees.semaines.size() + " semaine(s)\n" + sous
                        + (donnees.par.isEmpty() ? "" : " · " + donnees.par);
            }
            LinearLayout etat = ui.ligne(point, enLecture ? "Lecture des données du PC…" : "✔ Relié au PC", sous, null, null, null);
            etat.setPadding(0, ui.dp(4), 0, ui.dp(4));
            corps.addView(etat);
            // V6.5.2 : le code en gros : si le PC l'a perdu, on le retape sur le PC (Bibliothèque → Téléphone →
            // « Reprenez son code ») ; rien à refaire ici.
            TextView codeGros = ui.texte(code, 20, true, Ui.BORDEAUX);
            codeGros.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD);
            codeGros.setTextIsSelectable(true);
            corps.addView(codeGros, ui.marges(2, 0));
            corps.addView(ui.note("Code de ce téléphone. Si le PC ne l'a plus : sur le PC, Bibliothèque des semaines → Téléphone → « Reprenez son code », et tapez-le. Rien à refaire ici."), ui.marges(0, 6));
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
            corps.addView(boutons, ui.marges(4, 0));
            return carte;
        }
        corps.addView(ui.texte("Sur le PC : Bibliothèque des semaines → « Activer l'envoi au téléphone », puis scannez le QR code affiché (une seule fois). "
                + "Les données arrivent ensuite toutes seules, chiffrées.", 14, false, Ui.NOIR), ui.marges(0, 6));
        MaterialButton scanner = ui.bouton("Scanner le QR code du PC");
        scanner.setOnClickListener(v -> activite.scannerQrDuPc());
        corps.addView(scanner, ui.pleineLargeur());
        corps.addView(ui.texte("Ou tapez le code affiché sous le QR code :", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(10, 4));
        EditText champCode = champ("ABCD-EFGH-JKLM-NPQR", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, "");
        champCode.setTypeface(android.graphics.Typeface.MONOSPACE);
        corps.addView(champCode, ui.pleineLargeur());
        MaterialButton relier = ui.boutonContour("Relier au PC avec ce code");
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

    // ---- Plans de coupe (V6.3) : comme l'onglet du PC ; un plan modifié ici part au PC ----

    // ---- Stock des panneaux (V6.5.1) : comme la page du PC, lu dans le fichier partagé ----

    // ---- V6.8 : Claustras — photo du plan, envoyée au PC ----

    private void ecranClaustras() {
        entete("Préparer un lancement", "Claustras : photo du plan", null, "Prenez le plan du claustra en photo : il part sur le PC, dans Claustras, à côté de la commande, pour y lire la largeur de chaque lame.");
        claustrasEcran.construire(racine);
    }

    /** La photo prise (fichier) : préparée, gardée, puis envoyée au PC. */
    void photoDuPlan(String commande, java.io.File source) {
        app.annexe.execute(() -> preparerEtEnvoyer(commande, source));
    }

    /** La photo choisie dans la galerie : copiée, préparée, gardée, puis envoyée au PC. */
    void photoDuPlan(String commande, Uri uri) {
        app.annexe.execute(() -> {
            java.io.File d = new java.io.File(activite.getCacheDir(), "photos");
            if (!d.isDirectory()) d.mkdirs();
            java.io.File copie = new java.io.File(d, "plan_choisie.jpg");
            try (java.io.InputStream in = activite.getContentResolver().openInputStream(uri); java.io.FileOutputStream out = new java.io.FileOutputStream(copie)) {
                if (in == null) throw new java.io.IOException("photo introuvable");
                byte[] t = new byte[65536];
                for (int n; (n = in.read(t)) > 0; ) out.write(t, 0, n);
            } catch (Exception e) {
                principal.post(() -> android.widget.Toast.makeText(activite, "Photo illisible : " + e.getMessage(), android.widget.Toast.LENGTH_LONG).show());
                return;
            }
            preparerEtEnvoyer(commande, copie);
        });
    }

    private void preparerEtEnvoyer(String commande, java.io.File source) {
        try {
            byte[] jpeg = PhotoPlan.preparer(source);
            String nom = "plan_" + System.currentTimeMillis() + ".jpg";
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(new java.io.File(demandes.dossierPhotos(), nom))) {
                out.write(jpeg);
            }
            JSONObject d = new JSONObject();
            d.put("type", "photoClaustra");
            d.put("commande", commande);
            d.put("titre", "Photo du plan " + commande);
            d.put("fichierPhoto", nom);
            d.put("taille", jpeg.length);
            principal.post(() -> envoyerDemande(d));
        } catch (Exception e) {
            principal.post(() -> android.widget.Toast.makeText(activite, "Photo impossible : " + (e.getMessage() != null ? e.getMessage() : e), android.widget.Toast.LENGTH_LONG).show());
        } finally {
            source.delete();
        }
    }

    private void ecranStock() {
        entete("Outils", "Stock des panneaux", null, "Le stock woodStore chargé sur le PC : panneaux entiers, chutes disponibles, chutes réservées, cases.");
        stockEcran.construire(racine, donnees);
    }

    /**
     * V6.5.1 : le PC a changé de code de liaison (ou arrêté l'envoi) : ce téléphone ne reçoit plus rien. Avant, il gardait
     * l'ancienne version sans rien dire. Bandeau rouge sur tous les écrans, avec le bouton pour rescanner le QR code.
     */
    private void avisDuPc() {
        if (donnees == null || codeLien() == null || donnees.lien == null || donnees.lien.isEmpty()) return;
        MaterialCardView carte = ui.carte();
        carte.setStrokeColor(ui.couleur(R.color.alerte_texte));
        LinearLayout corps = corpsDe(carte);
        boolean remplace = "remplace".equals(donnees.lien);
        corps.addView(ui.titreCarte(remplace ? "Le PC a changé de code" : "Le PC a arrêté l'envoi"));
        corps.addView(ui.texte(remplace
                ? "Ce téléphone ne reçoit plus les nouveautés du PC (données du " + dateLisible(donnees.genere) + "). Sur le PC : Bibliothèque des semaines → Téléphone, puis scannez le nouveau QR code."
                : "Le PC n'envoie plus rien à ce téléphone : ces données (du " + dateLisible(donnees.genere) + ") ne sont plus mises à jour.", 14, false, ui.couleur(R.color.alerte_texte)), ui.marges(2, 6));
        if (remplace) {
            MaterialButton scanner = ui.bouton("Scanner le nouveau QR code du PC");
            scanner.setOnClickListener(v -> activite.scannerQrDuPc());
            corps.addView(scanner, ui.pleineLargeur());
        }
        racine.addView(carte);
    }

    /** V6.5.1 : de quand datent les données du PC (on voit tout de suite si le téléphone n'a pas les nouveautés). */
    private void ligneDonneesDuPc() {
        if (donnees == null || codeLien() == null) return;
        String quand = dateLisible(donnees.genere);
        TextView t = ui.texte("Données du PC" + (donnees.poste.isEmpty() ? "" : " « " + donnees.poste + " »") + " du " + (quand.isEmpty() ? "?" : quand)
                + (avertissement != null ? " · pas de connexion au site" : ""), 12, false, ui.couleur(R.color.gris_texte));
        racine.addView(t, ui.marges(0, 4));
    }

    private void ecranPlans() {
        entete("Outils", "Plans de coupe", null, "Les plans de l'optimisation Cut Rite, lus par le PC dans la sauvegarde .bkp, avec les mêmes numéros « Pdc ». Un plan modifié ici part au PC.");
        if (sansDonnees()) return;
        plans.construire(racine);
    }

    // ---- Suivi de production (V6.2) : comme l'onglet du PC, lu dans le fichier partagé ----

    private final java.util.Set<String> suiviOuverts = new java.util.HashSet<>();
    /** V6.3.3 : suivi par semaine, transporteur, coloris ou client (comme sur le PC). */
    private String vueSuivi = "semaine";
    /** V6.9 : l'onglet du suivi affiché (lancements, vues, hors, tableau). */
    private String panneauSuivi = "lancements";

    private static final String[][] PANNEAUX_SUIVI = {{"lancements", "Lancements"}, {"vues", "Par semaine…"}, {"hors", "Hors lancement"}, {"tableau", "Tableau"}};

    /** Les onglets du suivi : une rangée de boutons, celui choisi en bordeaux. */
    private View ongletsSuivi(FichierPartage.Suivi s) {
        android.widget.HorizontalScrollView defile = new android.widget.HorizontalScrollView(activite);
        defile.setHorizontalScrollBarEnabled(false);
        LinearLayout r = ui.rangee();
        for (String[] x : PANNEAUX_SUIVI) {
            boolean actif = x[0].equals(panneauSuivi);
            String libelle = x[1];
            if ("hors".equals(x[0]) && !s.hors.isEmpty()) {
                double n = 0;
                for (String[] h : s.hors) if (h.length > 1) n += nombreSuivi(h[1]);
                libelle += " · " + fmtSuivi(Math.round(n));
            }
            TextView b = ui.texte(libelle, 13, true, actif ? 0xFFFFFFFF : Ui.NOIR);
            b.setGravity(Gravity.CENTER);
            b.setMinHeight(ui.dp(40));
            b.setPadding(ui.dp(14), 0, ui.dp(14), 0);
            b.setMaxLines(1);
            android.graphics.drawable.GradientDrawable fond = ui.fondRond(actif ? Ui.BORDEAUX : 0xFFFFFFFF, 20);
            if (!actif) fond.setStroke(Math.max(1, ui.dp(1)), 0xFFD9D4CF);
            b.setBackground(fond);
            b.setContentDescription("Suivi : " + x[1] + (actif ? " (choisi)" : ""));
            b.setSelected(actif);
            if (!actif)
                b.setOnClickListener(w -> {
                    panneauSuivi = x[0];
                    construire();
                });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.rightMargin = ui.dp(6);
            r.addView(b, lp);
        }
        defile.addView(r);
        return defile;
    }

    private static double nombreSuivi(String t) {
        try {
            return Double.parseDouble(t);
        } catch (RuntimeException e) {
            return 0;
        }
    }
    private String filtreVueSuivi = "";
    private final java.util.Set<String> groupesOuverts = new java.util.HashSet<>();
    /** Vue, nom affiché, détail d'une ligne. */
    static final String[][] VUES_SUIVI = {{"semaine", "Semaine", "transporteur"}, {"transporteur", "Transporteur", "semaine"}, {"coloris", "Coloris", "semaine"}, {"client", "Client", "semaine"}};
    static final String TRANSPORTEUR_INCONNU = "Transporteur inconnu";
    /** Lancements ouverts dans Contrôler la coupe (les autres : seulement leur titre et leur état). */
    private final java.util.Set<String> controlesOuverts = new java.util.HashSet<>();
    private static final int BLEU = 0xFF2A78D6;
    private static final int BLEU_TEXTE = 0xFF1B5FAE;
    private static final int VERT = 0xFF2E7D32;
    private static final int VERT_PALE = 0xFFA5D6A7;
    private static final int GRIS_BARRE = 0xFFE9E7E3;

    /** Le libellé de l'état, comme sur le PC. */
    static String libelleEtatSuivi(String e, double faites) {
        switch (e == null ? "" : e) {
            case "termine":
                return "Terminé";
            case "absent":
                return "Rien à suivre";
            case "attente":
                return "Pas encore dans Diakonos";
            case "hors_extraction":
                return "Pas dans cette extraction";
            case "casse":
                return "Casse : pas suivie dans Diakonos";
            case "retard":
                return "En retard";
            default:
                return faites > 0 ? "En cours" : "À faire";
        }
    }

    private static int couleurBarre(String e) {
        if ("termine".equals(e)) return VERT;
        if ("absent".equals(e)) return VERT_PALE;
        if ("retard".equals(e)) return Ui.BORDEAUX;
        return BLEU;
    }

    private static int couleurTexteEtat(String e) {
        if ("termine".equals(e) || "absent".equals(e)) return VERT;
        if ("retard".equals(e)) return Ui.BORDEAUX;
        if ("attente".equals(e) || "hors_extraction".equals(e) || "casse".equals(e)) return Ui.GRIS;
        return BLEU_TEXTE;
    }

    static Integer pctSuivi(double f, double r) {
        return f + r > 0 ? (int) Math.round(100 * f / (f + r)) : null;
    }

    /** Nombre écrit comme la page web (« 1 234 », « 45,93 »). */
    static String fmtSuivi(double v) {
        java.text.NumberFormat n = java.text.NumberFormat.getInstance(Locale.FRANCE);
        n.setMaximumFractionDigits(2);
        return n.format(v);
    }

    private static String fmtSuivi(String v) {
        try {
            return fmtSuivi(Double.parseDouble(v));
        } catch (NumberFormatException e) {
            return v;
        }
    }

    /** « 2026-11-10 » → « 10/11/2026 ». */
    static String jourLisible(String jour) {
        return jour == null || jour.length() < 10 ? "" : jour.substring(8, 10) + "/" + jour.substring(5, 7) + "/" + jour.substring(0, 4);
    }

    /** « 2026-11-10 » → « 10/11 ». */
    static String jourCourt(String jour) {
        return jour == null || jour.length() < 10 ? "" : jour.substring(8, 10) + "/" + jour.substring(5, 7);
    }

    private View barreSuivi(double f, double r, String e) {
        LinearLayout b = new LinearLayout(activite);
        b.setOrientation(LinearLayout.HORIZONTAL);
        android.graphics.drawable.GradientDrawable fond = new android.graphics.drawable.GradientDrawable();
        fond.setColor(GRIS_BARRE);
        fond.setCornerRadius(ui.dp(5));
        b.setBackground(fond);
        Integer p = pctSuivi(f, r);
        int largeur = "absent".equals(e) ? 100 : p == null ? 0 : p;
        View plein = new View(activite);
        android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
        g.setColor(couleurBarre(e));
        g.setCornerRadius(ui.dp(5));
        plein.setBackground(g);
        b.addView(plein, new LinearLayout.LayoutParams(0, ui.dp(10), largeur));
        b.addView(new View(activite), new LinearLayout.LayoutParams(0, ui.dp(10), 100 - largeur));
        b.setContentDescription("Avancement " + (p == null ? 0 : p) + " %");
        return b;
    }

    private static String chiffresSuivi(FichierPartage.LancementSuivi l, FichierPartage.Suivi s) {
        String pieces = fmtSuivi(l.h) + (l.h > 1 ? " pièces" : " pièce");
        if ("hors_extraction".equals(l.e))
            return pieces + " · sa semaine n'est pas dans l'extraction du " + jourCourt(s.jour) + (s.semaineMax > 0 ? " (elle va jusqu'à la semaine " + s.semaineMax + ")" : "");
        if ("attente".equals(l.e)) return pieces + " · pas encore dans l'extraction";
        String relancees = l.x > 0 ? " · " + fmtSuivi(l.x) + (l.x > 1 ? " pièces relancées dans " : " pièce relancée dans ") + l.xd + (l.x > 1 ? " (comptées là-bas)" : " (comptée là-bas)") : "";
        if (l.f + l.r == 0) return "rien à suivre" + relancees;
        return fmtSuivi(l.f) + (l.f > 1 ? " faites" : " faite") + " · " + fmtSuivi(l.r) + " à faire" + relancees;
    }

    /** L'avancement est celui du jour de l'extraction : si elle date, on le dit. */
    static String ageExtraction(String jour, long maintenant) {
        if (jour == null || jour.length() < 10) return "";
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.clear();
        c.set(Integer.parseInt(jour.substring(0, 4)), Integer.parseInt(jour.substring(5, 7)) - 1, Integer.parseInt(jour.substring(8, 10)));
        long jours = (maintenant - c.getTimeInMillis()) / 86400000L;
        if (jours < 2) return "";
        return "⚠ Cette extraction date du " + jourLisible(jour) + " (il y a " + jours + " jours) : l'avancement montré est celui de ce jour-là. Sur le PC, mettez la dernière extraction de Diakonos dans le dossier du Suivi de production.";
    }

    /** « +101 pièces depuis le 07/11 » (vide sans extraction d'avant). */
    static String evolutionSuivi(FichierPartage.LancementSuivi l, String precedente) {
        if (l.d == null || precedente == null || precedente.isEmpty()) return "";
        if (l.d == 0) return "= depuis le " + jourCourt(precedente);
        double a = Math.abs(l.d);
        return (l.d > 0 ? "+" : "−") + fmtSuivi(a) + (a > 1 ? " pièces" : " pièce") + " depuis le " + jourCourt(precedente);
    }

    private void ecranSuivi() {
        entete("Outils", "Suivi de production", null, "L'avancement de chaque lancement, d'après l'extraction « Suivi production » de Diakonos.");
        if (donnees == null) {
            sansDonnees();
            return;
        }
        FichierPartage.Suivi s = donnees.suivi;
        if (s == null) {
            MaterialCardView carte = ui.carte();
            LinearLayout corps = corpsDe(carte);
            corps.addView(ui.titreCarte("Extraction Diakonos"));
            corps.addView(ui.texte("Aucune extraction Diakonos lue sur le PC pour l'instant. Sur le PC : Suivi de production → « Choisir le dossier des extractions… ».", 14, false, Ui.NOIR));
            racine.addView(carte);
            return;
        }
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        corps.addView(ui.titreCarte("Extraction Diakonos"));
        corps.addView(ui.texte("Dernière extraction : " + jourLisible(s.jour) + " (semaine " + s.semaine + ")", 14, true, Ui.NOIR));
        corps.addView(ui.texte(android.text.TextUtils.join(" + ", s.fichiers) + (s.semaineMax > 0 ? " · semaines jusqu'à la " + s.semaineMax : "")
                + (s.nbExtractions > 1 ? " · " + s.nbExtractions + " extractions gardées pour l'évolution" : ""), 13, false, ui.couleur(R.color.gris_texte)), ui.marges(2, 0));
        String age = ageExtraction(s.jour, System.currentTimeMillis());
        if (!age.isEmpty()) corps.addView(ui.bandeau(age, ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)), ui.marges(6, 0));
        racine.addView(carte);

        String depuis = s.depuis != null && !s.precedente.isEmpty() ? (s.depuis >= 0 ? "+" : "−") + fmtSuivi(Math.abs(s.depuis)) + " depuis le " + jourCourt(s.precedente) : null;
        racine.addView(bandeChiffres(new String[] {fmtSuivi(s.lancements), "Lancements"}, new String[] {fmtSuivi(s.faites), "Pièces faites", null, depuis},
                new String[] {fmtSuivi(s.restantes), "Pièces à faire"}, new String[] {fmtSuivi(s.retard), "En retard", s.retard > 0 ? "souci" : null}));

        // V6.9 : des onglets comme sur le PC (un contenu à la fois) au lieu d'un écran sans fin.
        racine.addView(ongletsSuivi(s), ui.marges(8, 4));
        if ("vues".equals(panneauSuivi)) {
            if (!s.vues.isEmpty()) racine.addView(carteVuesSuivi(s));
            else racine.addView(ui.note("Pas de vue pour cette extraction."), ui.marges(4, 4));
        } else if ("hors".equals(panneauSuivi)) {
            if (!s.hors.isEmpty()) {
                MaterialCardView ch = ui.carte();
                LinearLayout c = corpsDe(ch);
                TextView aideHors = ui.texteAide("Pièces de l'extraction qui ne sont dans aucun lancement de la bibliothèque (pas encore lancées, ou lancement pas scanné).");
                c.addView(ui.titreEtAide(ui.titreCarte("Dans Diakonos, dans aucun lancement"), aideHors));
                c.addView(aideHors, ui.marges(4, 4));
                for (String[] h : s.hors) {
                    if (h.length < 4) continue;
                    LinearLayout r = ui.rangee();
                    r.addView(ui.texte(h[0], 14, true, Ui.NOIR), ui.poids(1));
                    r.addView(ui.texte(fmtSuivi(h[1]) + " à faire · " + fmtSuivi(h[2]) + " lignes · " + fmtSuivi(h[3]) + " commandes", 13, false, Ui.NOIR));
                    c.addView(r, ui.marges(3, 3));
                }
                racine.addView(ch);
            } else racine.addView(ui.bandeau("✔ Toutes les pièces de l'extraction sont dans un lancement.", ui.couleur(R.color.ok_fond), ui.couleur(R.color.ok_texte)), ui.marges(4, 4));
        } else if ("tableau".equals(panneauSuivi)) {
            if (!s.tableau.isEmpty()) racine.addView(carteTableauSuivi(s));
            else racine.addView(ui.note("Pas de tableau pour cette extraction."), ui.marges(4, 4));
        } else {
            TextView aideAvancement = ui.texteAide("L'extraction donne les pièces qui restent à valider. Comparée au lancement : un CVC qui n'y est plus = pièce faite ; un CVC encore là = « Qte en cours » à faire, le reste est fait (lancée 10, en cours 8 : 8 à faire, 2 faites). Une pièce relancée (casse, retard) compte dans le lancement le plus récent, et elle est déduite du lancement d'origine. Touchez un lancement : les commandes encore à faire.");
            racine.addView(ui.titreEtAide(ui.texte("Avancement par lancement", 15, true, Ui.NOIR), aideAvancement), ui.marges(4, 0));
            racine.addView(aideAvancement, ui.marges(4, 4));
            if (s.semaines.isEmpty())
                racine.addView(ui.texte("Aucun lancement dans la bibliothèque des semaines autour de cette extraction.", 14, false, ui.couleur(R.color.gris_texte)), ui.marges(4, 4));
            for (FichierPartage.SemaineSuivi sem : s.semaines) racine.addView(carteSemaineSuivi(sem, s));
            if (s.anciennes > 0)
                racine.addView(ui.texte(s.anciennes + (s.anciennes > 1 ? " semaines plus anciennes : finies." : " semaine plus ancienne : finie."), 13, false, ui.couleur(R.color.gris_texte)), ui.marges(2, 6));
        }
    }

    private View carteSemaineSuivi(FichierPartage.SemaineSuivi sem, FichierPartage.Suivi s) {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        // V6.5.6 : semaines de livraison ; celle en fabrication = semaine du calendrier + 1.
        boolean courante = s.semaineFab > 0 ? sem.annee == s.anneeFab && sem.semaine == s.semaineFab : sem.annee == s.annee && sem.semaine == s.semaine;
        corps.addView(ui.titreCarte("Semaine " + sem.semaine + (courante ? (s.semaineFab > 0 ? " · en fabrication" : " · en cours") : "")));
        corps.addView(ui.texte(CompteRendu.datesSemaine(sem.annee, sem.semaine), 13, false, ui.couleur(R.color.gris_texte)));
        LinearLayout tete = ui.rangee();
        tete.addView(barreSuivi(sem.f, sem.r, sem.e), new LinearLayout.LayoutParams(0, ui.dp(10), 1));
        Integer p = pctSuivi(sem.f, sem.r);
        TextView pct = ui.titre(p == null ? libelleEtatSuivi(sem.e, sem.f) : p + " %", p == null ? 12 : 16, couleurTexteEtat(sem.e));
        pct.setPadding(ui.dp(10), 0, 0, 0);
        tete.addView(pct);
        corps.addView(tete, ui.marges(6, 4));
        corps.addView(ui.filet(4, 0));
        for (FichierPartage.LancementSuivi l : sem.lancements) corps.addView(blocLancementSuivi(l, s));
        return carte;
    }

    private View blocLancementSuivi(FichierPartage.LancementSuivi l, FichierPartage.Suivi s) {
        LinearLayout bloc = ui.colonne();
        bloc.setPadding(0, ui.dp(8), 0, ui.dp(8));
        LinearLayout tete = ui.rangee();
        LinearLayout noms = ui.colonne();
        noms.addView(ui.texte(l.poste.isEmpty() ? "Lancement" : l.poste, 15, true, Ui.NOIR));
        noms.addView(ui.texte(l.nom, 12, false, ui.couleur(R.color.gris_texte)));
        tete.addView(noms, ui.poids(1));
        Integer p = pctSuivi(l.f, l.r);
        LinearLayout droite = ui.colonne();
        droite.setGravity(Gravity.END);
        droite.addView(ui.titre(p == null ? libelleEtatSuivi(l.e, l.f) : p + " %", p == null ? 12 : 17, couleurTexteEtat(l.e)));
        if (p != null) droite.addView(ui.texte(libelleEtatSuivi(l.e, l.f).toUpperCase(Locale.FRANCE), 10, true, couleurTexteEtat(l.e)));
        tete.addView(droite);
        bloc.addView(tete);
        bloc.addView(barreSuivi(l.f, l.r, l.e), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ui.dp(10)));
        ((LinearLayout.LayoutParams) bloc.getChildAt(1).getLayoutParams()).setMargins(0, ui.dp(6), 0, ui.dp(4));
        bloc.addView(ui.texte(chiffresSuivi(l, s), 13, false, Ui.NOIR));
        String evo = evolutionSuivi(l, s.precedente);
        if (!evo.isEmpty()) bloc.addView(ui.texte(evo, 12, l.d != null && l.d != 0, l.d != null && l.d > 0 ? VERT : l.d != null && l.d < 0 ? Ui.BORDEAUX : Ui.GRIS));
        if (suiviOuverts.contains(l.cle)) {
            if (l.commandes.isEmpty())
                bloc.addView(ui.texte("Plus aucune pièce de ce lancement dans l'extraction du " + jourLisible(s.jour) + ".", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(6, 0));
            else {
                bloc.addView(ui.texte("Commandes encore à faire", 13, true, Ui.BORDEAUX), ui.marges(8, 2));
                for (String[] c : l.commandes) {
                    if (c.length < 5) continue;
                    LinearLayout r = ui.rangee();
                    LinearLayout g = ui.colonne();
                    g.addView(ui.texte(c[0], 13, true, Ui.NOIR));
                    g.addView(ui.texte(joindre(" · ", c[1], c[2], c[4]).replaceFirst("^ · ", ""), 12, false, ui.couleur(R.color.gris_texte)));
                    r.addView(g, ui.poids(1));
                    r.addView(ui.texte(fmtSuivi(c[3]) + " à faire", 13, true, Ui.NOIR));
                    r.setPadding(0, ui.dp(3), 0, ui.dp(3));
                    bloc.addView(r);
                }
            }

        }
        bloc.setOnClickListener(v -> {
            if (!suiviOuverts.remove(l.cle)) suiviOuverts.add(l.cle);
            construire();
        });
        bloc.setClickable(true);
        LinearLayout avecFilet = ui.colonne();
        avecFilet.addView(bloc);
        avecFilet.addView(ui.separateur());
        return avecFilet;
    }

    /** « 18 faites · 3 à faire » (comme le PC). */
    static String chiffresGroupe(double f, double r, String e, String jour) {
        if ("hors_extraction".equals(e)) return "pas dans l'extraction du " + jourCourt(jour);
        if (f + r == 0) return "rien à suivre";
        return fmtSuivi(f) + (f > 1 ? " faites" : " faite") + " · " + fmtSuivi(r) + " à faire";
    }

    /** Pour chercher : sans accents ni espaces, en minuscules (comme le PC). */
    static String sansAccents(String t) {
        return java.text.Normalizer.normalize(t == null ? "" : t, java.text.Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    /** Suivi par semaine, par transporteur, par coloris, par client : une barre par ligne, le même calcul que les lancements. */
    private View carteVuesSuivi(FichierPartage.Suivi s) {
        String[] v = VUES_SUIVI[0];
        for (String[] x : VUES_SUIVI) if (x[0].equals(vueSuivi)) v = x;
        final String vue = v[0];
        List<FichierPartage.GroupeSuivi> lignes = s.vues.get(vue);
        if (lignes == null) lignes = new ArrayList<>();
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        corps.addView(ui.titreCarte("Suivi par " + v[1].toLowerCase(Locale.FRANCE)));
        // Le choix de la vue : Semaine | Transporteur | Coloris | Client.
        LinearLayout choix = ui.rangee();
        android.graphics.drawable.GradientDrawable fond = ui.fondRond(0xFFFFFFFF, 10);
        fond.setStroke(Math.max(1, ui.dp(1)), 0xFFD9D4CF);
        choix.setBackground(fond);
        choix.setClipToOutline(true);
        for (String[] x : VUES_SUIVI) {
            boolean actif = x[0].equals(vue);
            TextView b = ui.texte(x[1], 13, true, actif ? 0xFFFFFFFF : Ui.NOIR);
            b.setGravity(Gravity.CENTER);
            b.setMinHeight(ui.dp(44));
            b.setPadding(ui.dp(4), 0, ui.dp(4), 0);
            b.setMaxLines(1);
            if (actif) b.setBackground(ui.fondRond(Ui.BORDEAUX, 9));
            else
                ui.cliquable(b, w -> {
                    vueSuivi = x[0];
                    filtreVueSuivi = "";
                    construire();
                });
            b.setContentDescription("Suivi par " + x[1].toLowerCase(Locale.FRANCE) + (actif ? " (choisi)" : ""));
            b.setSelected(actif);
            choix.addView(b, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        }
        corps.addView(choix, ui.marges(4, 6));
        TextView aideVues = ui.texteAide("Les pièces des lancements, comptées comme les barres : faites = lancées − « Qte en cours » (CVC plus dans l'extraction = faite). Touchez une ligne : le détail par " + v[2] + ".");
        corps.addView(ui.titreEtAide(ui.note("Comment c'est compté"), aideVues), ui.marges(0, 2));
        corps.addView(aideVues, ui.marges(0, 4));
        if ("transporteur".equals(vue))
            for (FichierPartage.GroupeSuivi g : lignes)
                if (TRANSPORTEUR_INCONNU.equals(g.nom)) {
                    corps.addView(ui.bandeau("« " + TRANSPORTEUR_INCONNU + " » : pièces de lancements rangés dans la bibliothèque avant la version 6.3.3, déjà faites (plus dans l'extraction). Sur le PC, scannez de nouveau leur semaine dans « Contrôler la coupe » : le transporteur sera pris dans le fichier de lancement.",
                            ui.couleur(R.color.fond), Ui.NOIR), ui.marges(2, 4));
                    break;
                }
        final List<View> blocs = new ArrayList<>();
        final List<String> noms = new ArrayList<>();
        if (!"semaine".equals(vue)) {
            boolean coloris = "coloris".equals(vue);
            EditText champ = champ("Chercher un " + v[1].toLowerCase(Locale.FRANCE) + "…",
                    coloris && !lettresColoris ? CLAVIER_CHIFFRES : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, filtreVueSuivi);
            champ.setContentDescription("Chercher");
            champ.addTextChangedListener(new android.text.TextWatcher() {
                @Override
                public void beforeTextChanged(CharSequence t, int a, int b, int c) {}

                @Override
                public void onTextChanged(CharSequence t, int a, int b, int c) {}

                @Override
                public void afterTextChanged(android.text.Editable t) {
                    filtreVueSuivi = t.toString();
                    String f = sansAccents(filtreVueSuivi);
                    for (int i = 0; i < blocs.size(); i++) blocs.get(i).setVisibility(f.isEmpty() || noms.get(i).contains(f) ? View.VISIBLE : View.GONE);
                }
            });
            if (coloris) {
                LinearLayout ligneFiltre = ui.rangee();
                ligneFiltre.addView(champ, ui.poids(1));
                ligneFiltre.addView(boutonClavier(champ, lettresColoris, l -> lettresColoris = l));
                corps.addView(ligneFiltre, ui.marges(2, 6));
            } else corps.addView(champ, ui.marges(2, 6));
        }
        if (lignes.isEmpty()) corps.addView(ui.texte("Aucune pièce suivie.", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(4, 4));
        String filtre = sansAccents(filtreVueSuivi);
        for (FichierPartage.GroupeSuivi g : lignes) {
            View b = blocGroupeSuivi(g, vue, s);
            String n = sansAccents(g.nom);
            if (!filtre.isEmpty() && !n.contains(filtre)) b.setVisibility(View.GONE);
            blocs.add(b);
            noms.add(n);
            corps.addView(b);
        }
        return carte;
    }

    private View blocGroupeSuivi(FichierPartage.GroupeSuivi g, String vue, FichierPartage.Suivi s) {
        final String cle = vue + "|" + g.nom;
        LinearLayout bloc = ui.colonne();
        bloc.setPadding(0, ui.dp(8), 0, ui.dp(8));
        LinearLayout tete = ui.rangee();
        tete.addView(ui.texte(g.nom, 15, true, Ui.NOIR), ui.poids(1));
        Integer p = pctSuivi(g.f, g.r);
        LinearLayout droite = ui.colonne();
        droite.setGravity(Gravity.END);
        droite.addView(ui.titre(p == null ? libelleEtatSuivi(g.e, g.f) : p + " %", p == null ? 12 : 17, couleurTexteEtat(g.e)));
        if (p != null) droite.addView(ui.texte(libelleEtatSuivi(g.e, g.f).toUpperCase(Locale.FRANCE), 10, true, couleurTexteEtat(g.e)));
        tete.addView(droite);
        bloc.addView(tete);
        View barre = barreSuivi(g.f, g.r, g.e);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ui.dp(10));
        lp.setMargins(0, ui.dp(6), 0, ui.dp(4));
        bloc.addView(barre, lp);
        bloc.addView(ui.texte(chiffresGroupe(g.f, g.r, g.e, s.jour), 13, false, Ui.NOIR));
        if (groupesOuverts.contains(cle)) {
            if (g.sous.isEmpty()) bloc.addView(ui.texte("Aucune pièce suivie.", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(6, 0));
            for (FichierPartage.GroupeSuivi x : g.sous) {
                LinearLayout r = ui.colonne();
                r.setPadding(ui.dp(14), ui.dp(6), 0, ui.dp(4));
                LinearLayout t = ui.rangee();
                t.addView(ui.texte(x.nom, 13, true, Ui.NOIR), ui.poids(1));
                Integer px = pctSuivi(x.f, x.r);
                t.addView(ui.texte(px == null ? libelleEtatSuivi(x.e, x.f) : px + " % · " + libelleEtatSuivi(x.e, x.f).toUpperCase(Locale.FRANCE), 11, true, couleurTexteEtat(x.e)));
                r.addView(t);
                View bx = barreSuivi(x.f, x.r, x.e);
                LinearLayout.LayoutParams lx = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ui.dp(8));
                lx.setMargins(0, ui.dp(4), 0, ui.dp(2));
                r.addView(bx, lx);
                r.addView(ui.texte(chiffresGroupe(x.f, x.r, x.e, s.jour), 12, false, Ui.NOIR));
                bloc.addView(r);
            }
        }
        bloc.setOnClickListener(w -> {
            if (!groupesOuverts.remove(cle)) groupesOuverts.add(cle);
            construire();
        });
        bloc.setClickable(true);
        LinearLayout avecFilet = ui.colonne();
        avecFilet.addView(bloc);
        avecFilet.addView(ui.separateur());
        return avecFilet;
    }

    private View carteTableauSuivi(FichierPartage.Suivi s) {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        corps.addView(ui.titreCarte("Qté en cours par transporteur et par semaine (comme dans Excel)"));
        android.widget.HorizontalScrollView defile = new android.widget.HorizontalScrollView(activite);
        android.widget.TableLayout t = new android.widget.TableLayout(activite);
        android.widget.TableRow tete = new android.widget.TableRow(activite);
        tete.addView(celluleSuivi("Transporteur", true, false));
        for (String c : s.colonnes) tete.addView(celluleSuivi(c, true, true));
        t.addView(tete);
        double[] totaux = new double[s.colonnes.size()];
        for (String[] l : s.tableau) {
            android.widget.TableRow r = new android.widget.TableRow(activite);
            r.addView(celluleSuivi(l.length > 0 ? l[0] : "", false, false));
            for (int i = 1; i < l.length && i - 1 < totaux.length; i++) {
                double v;
                try {
                    v = Double.parseDouble(l[i]);
                } catch (NumberFormatException e) {
                    v = 0;
                }
                totaux[i - 1] += v;
                r.addView(celluleSuivi(v == 0 ? "" : fmtSuivi(v), i == l.length - 1, true));
            }
            t.addView(r);
        }
        android.widget.TableRow total = new android.widget.TableRow(activite);
        total.addView(celluleSuivi("Total", true, false));
        for (double v : totaux) total.addView(celluleSuivi(fmtSuivi(v), true, true));
        t.addView(total);
        defile.addView(t);
        corps.addView(defile);
        corps.addView(ui.texte("Somme de « Qté en cours » de toute l'extraction du " + jourLisible(s.jour) + " (lancements ou pas), comme dans Excel : pour contrôler avec Diakonos.", 12, false, ui.couleur(R.color.gris_texte)), ui.marges(6, 0));
        return carte;
    }

    private TextView celluleSuivi(String texte, boolean gras, boolean nombre) {
        TextView v = ui.texte(texte, 12, gras, Ui.NOIR);
        v.setPadding(ui.dp(6), ui.dp(4), ui.dp(6), ui.dp(4));
        if (nombre) v.setGravity(Gravity.END);
        return v;
    }

    // ---- recherche ----

    private MaterialCardView carteRecherche() {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corpsDe(carte);
        corps.addView(ui.titreCarte("Recherche"));
        LinearLayout ligne = ui.rangee();
        EditText champ = champ("Pièce ou commande", lettresRecherche ? CLAVIER_LETTRES : CLAVIER_CHIFFRES, requete);
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
        ligne.addView(boutonClavier(champ, lettresRecherche, l -> lettresRecherche = l));
        ligne.addView(ui.espace(1), new LinearLayout.LayoutParams(ui.dp(4), 1));
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
        corps.addView(ui.note("26090331003 ou 26090331 (CVC facultatif), dans toutes les semaines du fichier partagé."), ui.marges(6, 0));
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
        corps.addView(ui.titreCarte(res.isEmpty() ? "« " + requete + " » introuvable" : res.size() + " résultat(s) pour « " + requete + " »"));
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

    /** Choix de la semaine : « ‹ S45 » semaine d'avant, « Choisir la semaine ▾ » (toutes les semaines), « S47 › » semaine d'après. */
    private View choixSemaines(FichierPartage.Semaine choisie) {
        List<FichierPartage.Semaine> liste = donnees.semaines; // la plus récente d'abord
        int i = liste.indexOf(choisie);
        FichierPartage.Semaine precedente = i >= 0 && i < liste.size() - 1 ? liste.get(i + 1) : null;
        FichierPartage.Semaine suivante = i > 0 ? liste.get(i - 1) : null;
        LinearLayout rangee = ui.rangee();
        android.graphics.drawable.GradientDrawable fond = ui.fondRond(0xFFFFFFFF, 14);
        fond.setStroke(Math.max(1, ui.dp(1)), ui.couleur(R.color.bordure));
        rangee.setBackground(fond);
        rangee.setPadding(ui.dp(2), 0, ui.dp(2), 0);
        android.content.res.ColorStateList couleurs = new android.content.res.ColorStateList(new int[][] {{-android.R.attr.state_enabled}, {}}, new int[] {Ui.GRIS_FILET, Ui.BORDEAUX});
        MaterialButton avant = ui.boutonTexte(precedente == null ? "‹" : "‹ S" + precedente.semaine);
        avant.setTextColor(couleurs);
        avant.setContentDescription("Semaine d'avant");
        avant.setEnabled(precedente != null);
        avant.setOnClickListener(v -> choisirSemaine(precedente));
        MaterialButton choix = ui.boutonTexte("Choisir la semaine  ▾");
        choix.setTextColor(Ui.NOIR);
        choix.setContentDescription("Choisir la semaine (" + choisie.libelle() + " " + choisie.annee + ")");
        choix.setOnClickListener(v -> listeDesSemaines());
        MaterialButton apres = ui.boutonTexte(suivante == null ? "›" : "S" + suivante.semaine + " ›");
        apres.setTextColor(couleurs);
        apres.setContentDescription("Semaine d'après");
        apres.setEnabled(suivante != null);
        apres.setOnClickListener(v -> choisirSemaine(suivante));
        LinearLayout.LayoutParams bord = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        avant.setMinWidth(ui.dp(64));
        apres.setMinWidth(ui.dp(64));
        rangee.addView(avant, bord);
        rangee.addView(choix, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        rangee.addView(apres, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
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
        corps.addView(ui.titreCarte(s.libelle() + " — lancements"));
        String quand = dateLisible(s.maj);
        if (!quand.isEmpty()) corps.addView(ui.note("Mise à jour le " + quand));
        for (FichierPartage.Lancement l : s.lancements) {
            corps.addView(ui.filet(8, 0));
            LinearLayout bloc = ui.colonne();
            bloc.setPadding(ui.dp(4), ui.dp(8), ui.dp(4), ui.dp(8));
            LinearLayout tete = ui.rangee();
            LinearLayout nom = ui.colonne();
            nom.addView(ui.texte(titrePoste(l), 14, true, Ui.NOIR));
            nom.addView(ui.note(l.nom));
            tete.addView(nom, ui.poids(1));
            LinearLayout chiffres = ui.colonne();
            chiffres.setGravity(Gravity.END);
            chiffres.addView(ui.texte(nombre(l.prevues) + " prévues", 13, true, Ui.NOIR));
            chiffres.addView(ui.note(nombre(l.bkp) + " dans le .bkp"));
            tete.addView(chiffres);
            bloc.addView(tete);
            LinearLayout pastilles = ui.rangee();
            pastilles.addView(pastilleControle("Contrôle", cellule(l.controle, "")));
            pastilles.addView(ui.espace(1), new LinearLayout.LayoutParams(ui.dp(6), 1));
            pastilles.addView(pastilleControle("Scies", cellule(l.scies, "")));
            pastilles.addView(ui.espace(1), new LinearLayout.LayoutParams(ui.dp(6), 1));
            pastilles.addView(pastilleControle("Couleurs", celluleCouleurs(l)));
            bloc.addView(pastilles, ui.marges(6, 0));
            ui.cliquable(bloc, v -> {
                controlesOuverts.add(l.nom);
                lancementAMontrer = l.nom;
                construire();
            });
            corps.addView(bloc);
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
        corps.addView(ui.filet(8, 0));
        TextView total = ui.texte("Pièces : " + nombre(prevues) + " prévues dans " + s.lancements.size() + " lancement(s)"
                + (avecBkp ? ", " + nombre(bkp) + " dans les .bkp" : "") + ".", 14, true, Ui.BORDEAUX);
        total.setPadding(ui.dp(4), ui.dp(10), ui.dp(4), ui.dp(6));
        corps.addView(total);
        // Pièces lancées deux fois, casse.
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

    /** « Scies ⚠ 2 » : une pastille de l'état d'un contrôle (vert, bordeaux, gris). */
    private TextView pastilleControle(String nom, String[] cellule) {
        int[] c = couleursStatut(cellule[1]);
        String valeur = cellule[0].replace("✔ OK", "✔");
        return ui.pilule(nom + " " + valeur, c[0], "info".equals(cellule[1]) ? ui.couleur(R.color.gris_texte) : c[1]);
    }

    /** Valider un problème comme voulu : demandé au PC (il le reprend tout seul, comme son bouton « Valider »). */
    private void validerOk(FichierPartage.Lancement l, FichierPartage.Probleme p) {
        if (codeLien() == null) {
            new MaterialAlertDialogBuilder(activite).setTitle("Valider OK")
                    .setMessage("Pour envoyer une validation au PC, reliez l'appli au PC : icône du livre en haut → « Scanner le QR code du PC ».")
                    .setPositiveButton("OK", null).show();
            return;
        }
        new MaterialAlertDialogBuilder(activite).setTitle("Valider OK ?")
                .setMessage(p.type + " — " + p.cle + "\n\nC'est voulu : le PC le reprendra et le problème ne comptera plus (comme « Valider » sur le PC).")
                .setPositiveButton("Valider OK", (d, k) -> {
                    try {
                        JSONObject x = new JSONObject();
                        x.put("type", "validation");
                        x.put("titre", p.type + " — " + p.cle);
                        x.put("lancement", l.nom);
                        x.put("cle", p.cle);
                        x.put("probleme", p.type);
                        x.put("detail", p.detail);
                        envoyerDemande(x);
                    } catch (org.json.JSONException e) {
                        // ne peut pas arriver
                    }
                })
                .setNegativeButton("Annuler", null).show();
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
        boolean ouvert = controlesOuverts.contains(l.nom);
        // Titre : numéro, poste, fichier ; à droite l'état du contrôle ; un toucher ouvre ou ferme le détail.
        String[] etat;
        if (!l.controleFait) etat = new String[] {"Pas de bilan", "info"};
        else if (l.nbCorriger > 0) etat = new String[] {l.nbCorriger + " à corriger", "alerte"};
        else if (l.nbVerifier > 0) etat = new String[] {l.nbVerifier + " à vérifier", "attention"};
        else etat = new String[] {"✔ OK", "ok"};
        int[] ce = couleursStatut(etat[1]);
        LinearLayout tete = ui.ligne(ui.pastille(numero), titrePoste(l), l.fichier.isEmpty() ? l.nom : l.fichier, ui.pilule(etat[0], ce[0], ce[1]), ouvert ? "˄" : "˅", v -> {
            if (!controlesOuverts.remove(l.nom)) controlesOuverts.add(l.nom);
            construire();
        });
        tete.setPadding(0, 0, 0, 0);
        corps.addView(tete);
        if (!ouvert) return carte;
        corps.addView(ui.filet(8, 8));

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
                // V6.3 : « Valider OK » depuis le téléphone (comme sur le PC) : la validation part au PC.
                if (!groupeValides && ("corriger".equals(p.niveau) || "verifier".equals(p.niveau))) {
                    if (demandes.validationEnAttente(l.nom, p.cle, p.type)) {
                        corps.addView(ui.texte("⏳ Validation OK envoyée au PC, pas encore reprise", 12, true, ui.couleur(R.color.attention_texte)), ui.marges(2, 2));
                    } else {
                        MaterialButton valider = ui.boutonTexte("✔ Valider OK (c'est voulu)");
                        valider.setTextColor(ui.couleur(R.color.ok_texte));
                        valider.setTextSize(12.5f);
                        valider.setOnClickListener(v -> validerOk(l, p));
                        LinearLayout ligneValider = ui.rangee();
                        ligneValider.setGravity(Gravity.END);
                        ligneValider.addView(valider);
                        corps.addView(ligneValider, ui.pleineLargeur());
                    }
                }
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
