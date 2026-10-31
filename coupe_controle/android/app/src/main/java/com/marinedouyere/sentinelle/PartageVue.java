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
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;

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
 * Onglet « Partagé » : l'appli se branche sur le fichier partagé que Sentinelle (la page web, sur le PC)
 * écrit dans un dossier du Drive. Le fichier est choisi une fois avec le sélecteur d'Android (le Drive du
 * compte connecté sur l'appareil y apparaît) ; il est relu à chaque ouverture de l'onglet et sur « Actualiser ».
 * L'appli ne fait que lire : semaines, tableau des lancements, bilan des contrôles, problèmes pièce par pièce,
 * et recherche d'une pièce dans toutes les semaines.
 */
final class PartageVue {

    private static final String PREFERENCES = "sentinelle_partage";
    private static final String CLE_URI = "uri";
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

    PartageVue(MainActivity activite, Ui ui, SentinelleApp app) {
        this.activite = activite;
        this.ui = ui;
        this.app = app;
        racine = ui.colonne();
    }

    View vue() {
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

    /** Relit le fichier (en arrière-plan). */
    void actualiser() {
        final Uri uri = uri();
        if (uri == null) {
            construire();
            return;
        }
        final int numero = ++generation;
        enLecture = true;
        erreur = null;
        construire();
        app.annexe.execute(() -> {
            FichierPartage lu = null;
            String nom = null;
            String probleme = null;
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
            final FichierPartage resultat = lu;
            final String nomLu = nom;
            final String erreurLue = probleme;
            principal.post(() -> {
                if (numero != generation) return;
                enLecture = false;
                erreur = erreurLue;
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
        racine.addView(carteFichier());
        if (donnees == null) return;
        if (donnees.semaines.isEmpty()) {
            racine.addView(ui.texte("Le fichier ne contient encore aucune semaine.", 14, false, ui.couleur(R.color.gris_texte)), ui.marges(6, 6));
            return;
        }
        racine.addView(carteRecherche());
        if (!requete.isEmpty()) {
            racine.addView(carteResultats());
            return;
        }
        FichierPartage.Semaine s = semaine();
        racine.addView(choixSemaines(s));
        racine.addView(carteTableau(s));
        int numero = 1;
        for (FichierPartage.Lancement l : s.lancements) racine.addView(carteLancement(l, numero++));
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
        corps.addView(ui.titre("Fichier partagé", 17, Ui.BORDEAUX));
        corps.addView(ui.filetSaumon());
        Uri uri = uri();
        if (uri == null) {
            corps.addView(ui.texte("Choisissez le fichier « " + FichierPartage.NOM + " » que Sentinelle écrit sur le PC, dans le Drive. "
                    + "L'appli le relit à chaque ouverture de cet onglet.", 14, false, Ui.NOIR), ui.marges(0, 8));
        } else {
            corps.addView(ui.texte(nomFichier != null ? nomFichier : FichierPartage.NOM, 15, true, Ui.NOIR));
            if (donnees != null) {
                String quand = dateLisible(donnees.genere);
                corps.addView(ui.texte("Généré " + (quand.isEmpty() ? "" : "le " + quand + " ") + (donnees.par.isEmpty() ? "" : "par " + donnees.par)
                        + " · " + donnees.semaines.size() + " semaine(s)", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(2, 4));
            }
        }
        if (enLecture) corps.addView(ui.texte("Lecture du fichier…", 13, false, ui.couleur(R.color.gris_texte)), ui.marges(4, 4));
        if (erreur != null) corps.addView(ui.bandeau("❌ " + erreur, ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)), ui.marges(4, 6));
        LinearLayout boutons = ui.rangee();
        MaterialButton choisir = uri == null ? ui.bouton("Choisir le fichier") : ui.boutonContour("Changer de fichier");
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
        LinearLayout ligne = ui.rangee();
        EditText champ = new EditText(activite);
        champ.setHint("Pièce ou commande (CVC facultatif)");
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
        corps.addView(ui.texte("Cherche dans toutes les semaines du fichier partagé.", 12, false, ui.couleur(R.color.gris_texte)));
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
        corps.addView(ui.titre(res.isEmpty() ? "« " + requete + " » introuvable" : res.size() + " résultat(s) pour « " + requete + " »", 15, Ui.BORDEAUX));
        corps.addView(ui.filetSaumon());
        int n = 0;
        for (FichierPartage.Trouvaille t : res) {
            if (n++ >= MAX_RESULTATS) {
                corps.addView(ui.texte("… et " + (res.size() - MAX_RESULTATS) + " autre(s) : précisez la recherche.", 13, false, ui.couleur(R.color.gris_texte)));
                break;
            }
            String[] p = t.piece;
            SpannableStringBuilder sb = new SpannableStringBuilder();
            gras(sb, valeur(p, "cle"));
            String dims = dimensions(valeur(p, "longueur"), valeur(p, "largeur"), valeur(p, "epaisseur"));
            sb.append(joindre(" · ", valeur(p, "article"), dims, valeur(p, "coloris")));
            corps.addView(ui.texte(sb, 14, false, Ui.NOIR), ui.marges(6, 0));
            String quantite = valeur(p, "pieces");
            corps.addView(ui.texte(t.semaine.libelle() + " · " + t.lancement.nom + (t.lancement.poste.isEmpty() ? "" : " (" + t.lancement.poste + ")")
                    + (quantite.isEmpty() ? "" : " · " + nombre(quantite) + " pièce(s)"), 13, false, ui.couleur(R.color.gris_texte)));
            for (FichierPartage.Probleme pb : t.problemes) {
                int[] c = couleursNiveau(pb.niveau);
                corps.addView(ui.texte(symboleNiveau(pb.niveau) + " " + pb.type + " : " + pb.detail, 13, true, c[1]), ui.marges(2, 0));
            }
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

    private View choixSemaines(FichierPartage.Semaine choisie) {
        LinearLayout rangee = ui.rangee();
        for (FichierPartage.Semaine s : donnees.semaines) {
            MaterialButton b = s == choisie ? ui.bouton(s.libelle()) : ui.boutonContour(s.libelle());
            b.setContentDescription(s.libelle() + " " + s.annee);
            b.setOnClickListener(v -> {
                semaineChoisie = s.id;
                construire();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, 0, ui.dp(8), 0);
            rangee.addView(b, lp);
        }
        HorizontalScrollView defilement = new HorizontalScrollView(activite);
        defilement.setHorizontalScrollBarEnabled(false);
        defilement.addView(rangee);
        return defilement;
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
        return couleursStatut("corriger".equals(niveau) ? "alerte" : "verifier".equals(niveau) ? "attention" : "info");
    }

    private static String symboleStatut(String statut) {
        return "ok".equals(statut) ? "✔" : "alerte".equals(statut) || "attention".equals(statut) ? "⚠" : "—";
    }

    private static String symboleNiveau(String niveau) {
        return "corriger".equals(niveau) || "verifier".equals(niveau) ? "⚠" : "•";
    }

    /** « Agglo 1er tour », « Casse »… ; un chantier : « Chantier ». */
    private static String titrePoste(FichierPartage.Lancement l) {
        if (l.poste.isEmpty()) return l.nom;
        return "Chantiers".equals(l.poste) ? "Chantier" : l.poste;
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
        if (l.couleursPf != null && l.couleursPf > 0) return new String[] {"≈ " + l.couleursPf + " PF", "attention"};
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
        Map<String, List<FichierPartage.Probleme>> parType = new LinkedHashMap<>();
        for (FichierPartage.Probleme p : l.problemes) {
            if (!parType.containsKey(p.type)) parType.put(p.type, new ArrayList<>());
            parType.get(p.type).add(p);
        }
        for (Map.Entry<String, List<FichierPartage.Probleme>> e : parType.entrySet()) {
            List<FichierPartage.Probleme> liste = e.getValue();
            String niveau = "info";
            for (FichierPartage.Probleme p : liste) {
                if ("corriger".equals(p.niveau)) niveau = "corriger";
                else if ("verifier".equals(p.niveau) && !"corriger".equals(niveau)) niveau = "verifier";
            }
            int[] c = couleursNiveau(niveau);
            corps.addView(ui.bandeau(e.getKey() + " — " + liste.size() + " pièce(s)", c[0], c[1]), ui.marges(12, 2));
            String[] explication = donnees.explications.get(e.getKey());
            if (explication != null) {
                String texte = explication[0] + (explication[1].isEmpty() ? "" : " Que faire : " + explication[1]);
                corps.addView(ui.texte(texte, 12, false, ui.couleur(R.color.gris_texte)), ui.marges(2, 4));
            }
            int max = "info".equals(niveau) ? 10 : MAX_PAR_TYPE;
            int n = 0;
            for (FichierPartage.Probleme p : liste) {
                if (n++ >= max) {
                    corps.addView(ui.texte("… et " + (liste.size() - max) + " autre(s) (voir le rapport Excel sur le PC).", 12, false, ui.couleur(R.color.gris_texte)));
                    break;
                }
                SpannableStringBuilder sb = new SpannableStringBuilder();
                gras(sb, p.cle);
                sb.append(joindre(" · ", p.article, p.dimensions, p.coloris, p.quantite.isEmpty() ? "" : "qté " + p.quantite));
                corps.addView(ui.texte(sb, 13, false, Ui.NOIR), ui.marges(4, 0));
                corps.addView(ui.texte(p.detail + (p.lignes.isEmpty() || "hors lancement".equals(p.lignes) ? "" : " (ligne(s) " + p.lignes + ")"),
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
