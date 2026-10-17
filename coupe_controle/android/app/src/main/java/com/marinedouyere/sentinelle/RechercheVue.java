package com.marinedouyere.sentinelle;

import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
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
import com.marinedouyere.sentinelle.moteur.ElementSvg;
import com.marinedouyere.sentinelle.moteur.Js;
import com.marinedouyere.sentinelle.moteur.LecteurStrat;
import com.marinedouyere.sentinelle.moteur.Recherche;
import com.marinedouyere.sentinelle.moteur.SchemaCommande;
import com.marinedouyere.sentinelle.moteur.SchemaPiece;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Onglet Recherche : une clé (commande+ligne), une commande ou une
 * bande/modulo ("T9", "T9/1"), cherchée dans tous les fichiers chargés des
 * deux semaines — liste de coupe, à défaut .bkp, à défaut fichier de
 * lancement — avec le schéma de la pièce et celui de toute la commande.
 */
final class RechercheVue {

    private static final int PAR_PAGE = 60;

    private final MainActivity activite;
    private final Ui ui;
    private final SentinelleApp app;
    private final Handler principal = new Handler(Looper.getMainLooper());
    private final LinearLayout racine;
    private final EditText champ;
    private final MaterialButton bouton;
    private final LinearLayout zone;
    private int generation;
    boolean enCours;

    // Fichiers déjà lus, réutilisés d'une recherche à l'autre (une lecture de PDF est longue).
    private final Map<String, Object> cache = new HashMap<>();

    RechercheVue(MainActivity activite, Ui ui, SentinelleApp app) {
        this.activite = activite;
        this.ui = ui;
        this.app = app;
        racine = ui.colonne();

        MaterialCardView carte = ui.carte();
        LinearLayout corps = ui.colonne();
        corps.setPadding(ui.dp(14), ui.dp(12), ui.dp(14), ui.dp(12));
        carte.addView(corps);
        corps.addView(ui.texte("🔍 Recherche", 16, true, 0xFF263238), ui.marges(0, 4));
        LinearLayout ligne = ui.rangee();
        champ = new EditText(activite);
        champ.setHint("CVC26090331003, CVC26090331 ou T9");
        champ.setSingleLine(true);
        champ.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        champ.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        champ.setOnEditorActionListener((v, action, ev) -> {
            boolean entree = ev != null && ev.getKeyCode() == KeyEvent.KEYCODE_ENTER && ev.getAction() == KeyEvent.ACTION_DOWN;
            if (action == EditorInfo.IME_ACTION_SEARCH || entree) {
                rechercher();
                return true;
            }
            return false;
        });
        ligne.addView(champ, ui.poids(1));
        bouton = ui.bouton("Rechercher");
        bouton.setOnClickListener(v -> rechercher());
        ligne.addView(bouton);
        corps.addView(ligne);
        racine.addView(carte);

        zone = ui.colonne();
        racine.addView(zone, ui.pleineLargeur());
    }

    View vue() {
        if (racine.getParent() != null) ((ViewGroup) racine.getParent()).removeView(racine);
        return racine;
    }

    void rechercher(String requete) {
        champ.setText(requete);
        rechercher();
    }

    // ---- sources : une par case, dans l'ordre de l'appli web ----

    private final class SourceCase implements Recherche.Source {
        final Paire p;
        final Paire.Fichier strat;
        final Paire.Fichier coupe;
        final Paire.Fichier bkp;

        SourceCase(Paire p) {
            this.p = p;
            strat = p.strat;
            coupe = p.coupe;
            bkp = p.bkp;
        }

        @Override
        public String nom() {
            return p.nomComplet();
        }

        @Override
        public boolean aCoupe() {
            return coupe != null;
        }

        @Override
        public boolean aBkp() {
            return bkp != null;
        }

        @Override
        public boolean aStrat() {
            return strat != null;
        }

        private String cle(String quoi, Paire.Fichier f) {
            return quoi + "|" + f.chemin + "|" + f.fichier().lastModified() + "|" + f.fichier().length();
        }

        @SuppressWarnings("unchecked")
        @Override
        public List<LecteurStrat.LigneStrat> lignesStrat() throws Exception {
            String k = cle("strat", strat);
            Object o = cache.get(k);
            if (o == null) {
                o = LecteurStrat.lire(app.controles().classeur(strat)).lignes;
                cache.put(k, o);
            }
            return (List<LecteurStrat.LigneStrat>) o;
        }

        @Override
        public Recherche.Coupe coupe() throws Exception {
            String k = cle("coupe", coupe);
            Object o = cache.get(k);
            if (o == null) {
                o = Controles.estPdf(coupe)
                        ? new Recherche.Coupe(null, app.controles().enregistrementsPdf(coupe))
                        : new Recherche.Coupe(app.controles().classeur(coupe), null);
                cache.put(k, o);
            }
            return (Recherche.Coupe) o;
        }

        @Override
        public Recherche.DonneesBkp bkp() throws Exception {
            String k = cle("bkp", bkp);
            Object o = cache.get(k);
            if (o == null) {
                o = Recherche.lireBkp(Controles.lireOctets(bkp.fichier()), bkp.nom);
                cache.put(k, o);
            }
            return (Recherche.DonneesBkp) o;
        }
    }

    private void rechercher() {
        final String requete = champ.getText().toString();
        InputMethodManager clavier = (InputMethodManager) activite.getSystemService(android.content.Context.INPUT_METHOD_SERVICE);
        if (clavier != null) clavier.hideSoftInputFromWindow(champ.getWindowToken(), 0);
        zone.removeAllViews();
        if (Js.trim(requete).isEmpty()) return;
        final List<SourceCase> sources = new ArrayList<>();
        for (Paire p : app.depot().paires) sources.add(new SourceCase(p));
        final int numero = ++generation;
        enCours = true;
        bouton.setEnabled(false);
        zone.addView(ui.texte("Recherche en cours…", 14, false, ui.couleur(R.color.gris_texte)), ui.marges(4, 4));
        app.annexe.execute(() -> {
            Recherche.Resultat r;
            SchemaCommande.Schema schema = null;
            String erreurSchema = null;
            synchronized (cache) {
                garderSeulement(sources);
                r = Recherche.rechercher(requete, sources);
                if (r != null && r.commandeUnique != null) {
                    try {
                        List<LecteurStrat.LigneStrat> lignes = Recherche.lignesDeLaCommande(r.commandeUnique, sources);
                        if (!lignes.isEmpty()) schema = SchemaCommande.construire(r.commandeUnique, lignes);
                    } catch (Exception e) {
                        erreurSchema = "Schéma de la commande : " + (e.getMessage() != null ? e.getMessage() : e);
                    }
                }
            }
            final Recherche.Resultat res = r;
            final SchemaCommande.Schema sch = schema;
            final String errSch = erreurSchema;
            principal.post(() -> {
                if (numero != generation) return;
                enCours = false;
                bouton.setEnabled(true);
                afficher(res, sch, errSch);
            });
        });
    }

    /** Oublie les fichiers qui ne sont plus chargés dans aucune case. */
    private void garderSeulement(List<SourceCase> sources) {
        List<String> chemins = new ArrayList<>();
        for (SourceCase s : sources) {
            for (Paire.Fichier f : new Paire.Fichier[] {s.strat, s.coupe, s.bkp}) if (f != null) chemins.add(f.chemin);
        }
        List<String> aRetirer = new ArrayList<>();
        for (String k : cache.keySet()) {
            String chemin = k.split("\\|")[1];
            if (!chemins.contains(chemin)) aRetirer.add(k);
        }
        for (String k : aRetirer) cache.remove(k);
    }

    // ---- affichage ----

    private void afficher(Recherche.Resultat r, SchemaCommande.Schema schema, String erreurSchema) {
        zone.removeAllViews();
        if (r == null) return;
        if (r.nbSources == 0) {
            zone.addView(ui.texte("Aucun fichier chargé.", 14, false, ui.couleur(R.color.alerte_texte)), ui.marges(6, 0));
            return;
        }
        List<String> erreurs = new ArrayList<>(r.erreurs);
        if (erreurSchema != null) erreurs.add(erreurSchema);
        if (r.trouvailles.isEmpty()) {
            zone.addView(ui.texte("« " + r.requete + " » introuvable.", 14, false, ui.couleur(R.color.alerte_texte)), ui.marges(6, 0));
        } else {
            TextView bilan = ui.texte(r.trouvailles.size() + " résultat(s)", 14, true, ui.couleur(R.color.ok_texte));
            zone.addView(bilan, ui.marges(6, 2));
            if (schema != null) zone.addView(carteSchemaCommande(schema, r.requete));
            LinearLayout liste = ui.colonne();
            zone.addView(liste, ui.pleineLargeur());
            afficherPage(liste, r, 0);
        }
        if (!erreurs.isEmpty()) {
            zone.addView(ui.texte("Illisibles : " + String.join(" · ", erreurs), 13, false, ui.couleur(R.color.alerte_texte)),
                    ui.marges(4, 0));
        }
    }

    private void afficherPage(LinearLayout liste, Recherche.Resultat r, int debut) {
        int fin = Math.min(r.trouvailles.size(), debut + PAR_PAGE);
        for (int i = debut; i < fin; i++) liste.addView(carteTrouvaille(r.trouvailles.get(i)));
        if (fin < r.trouvailles.size()) {
            MaterialButton plus = ui.boutonContour("Afficher la suite (" + (r.trouvailles.size() - fin) + " de plus)");
            plus.setOnClickListener(v -> {
                liste.removeView(plus);
                afficherPage(liste, r, fin);
            });
            liste.addView(plus, ui.marges(4, 4));
        }
    }

    private View carteTrouvaille(Recherche.Trouvaille t) {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = ui.colonne();
        corps.setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(12));
        carte.addView(corps);

        LinearLayout entete = ui.rangee();
        TextView cle = ui.texte(t.cle, 16, true, 0xFF1565C0);
        cle.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        entete.addView(cle, ui.poids(1));
        TextView poste = ui.texte(t.source.nom(), 12, false, ui.couleur(R.color.gris_texte));
        poste.setGravity(Gravity.END);
        entete.addView(poste, ui.poids(1));
        corps.addView(entete);

        if (t.champs != null) {
            List<ElementSvg> schema = SchemaPiece.construire(t.champs);
            if (schema != null) {
                SchemaVue vue = SchemaVue.piece(activite, schema);
                vue.setContentDescription(SchemaPiece.libelle(t.champs));
                corps.addView(vue, ui.marges(6, 8));
            }
        }
        if (t.sourceBkp || t.sansCoupe) {
            corps.addView(ui.texte(t.sourceBkp ? "Source : .bkp" : "Source : lancement", 13, false, ui.couleur(R.color.gris_texte)),
                    ui.marges(2, 4));
        }

        corps.addView(champ(Recherche.libelleQuantite(t), t.quantite != null ? Js.nombre(t.quantite) : "?"));
        if (t.valeurs != null) corps.addView(champGrain(t.valeurs));
        Recherche.ChampsDetail d = t.champs;
        if (d != null && d.lancement != null) corps.addView(champ("Lancement", d.lancement));
        if (d != null && d.epaisseurFinie != null) corps.addView(champ("Épaisseur", Js.dimension(d.epaisseurFinie) + " mm"));
        if (d != null && d.assemblage != null) corps.addView(champ("Assemblage", d.assemblage));
        if (d != null && d.toutesDonnees != null && !d.toutesDonnees.isEmpty()) corps.addView(donneesLancement(d.toutesDonnees));
        return carte;
    }

    private View champ(String libelle, CharSequence valeur) {
        LinearLayout c = ui.colonne();
        c.setPadding(0, ui.dp(6), 0, 0);
        c.addView(ui.texte(libelle.toUpperCase(java.util.Locale.FRENCH), 11, false, 0xFF888888));
        c.addView(ui.texte(valeur, 15, true, 0xFF222222));
        return c;
    }

    private View champGrain(List<String> valeurs) {
        if (valeurs.isEmpty()) {
            LinearLayout c = (LinearLayout) champ("Grain matching", "");
            TextView v = (TextView) c.getChildAt(1);
            v.setText("Unitaire (pas de grain matching)");
            v.setTypeface(Typeface.DEFAULT);
            v.setTextColor(0xFF888888);
            return c;
        }
        SpannableStringBuilder sb = new SpannableStringBuilder();
        for (String v : valeurs) {
            if (sb.length() > 0) sb.append("   ");
            sb.append(v);
        }
        LinearLayout c = (LinearLayout) champ("Grain matching", sb);
        TextView v = (TextView) c.getChildAt(1);
        v.setTextColor(0xFF6A1B9A);
        return c;
    }

    private View donneesLancement(Map<String, String> donnees) {
        LinearLayout bloc = ui.colonne();
        MaterialButton titre = ui.boutonTexte("▸ Toutes les données (" + donnees.size() + ")");
        titre.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        LinearLayout table = ui.colonne();
        table.setVisibility(View.GONE);
        int i = 0;
        for (Map.Entry<String, String> e : donnees.entrySet()) {
            LinearLayout ligne = ui.rangee();
            ligne.setGravity(Gravity.TOP);
            ligne.setPadding(ui.dp(6), ui.dp(3), ui.dp(6), ui.dp(3));
            if (i++ % 2 == 0) ligne.setBackgroundColor(0xFFF5F7FA);
            TextView k = ui.texte(e.getKey(), 13, true, 0xFF555555);
            ligne.addView(k, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            TextView v = ui.texte(e.getValue(), 13, false, 0xFF222222);
            ligne.addView(v, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.3f));
            table.addView(ligne, ui.pleineLargeur());
        }
        titre.setOnClickListener(v -> {
            boolean ouvrir = table.getVisibility() != View.VISIBLE;
            table.setVisibility(ouvrir ? View.VISIBLE : View.GONE);
            titre.setText((ouvrir ? "▾" : "▸") + " Toutes les données (" + donnees.size() + ")");
        });
        bloc.addView(titre, ui.marges(4, 0));
        bloc.addView(table, ui.pleineLargeur());
        return bloc;
    }

    // ---- schéma de la commande ----

    private View carteSchemaCommande(SchemaCommande.Schema s, String cleSurlignee) {
        MaterialCardView carte = ui.carte();
        carte.setStrokeColor(0xFF1565C0);
        carte.setStrokeWidth(ui.dp(2));
        LinearLayout corps = ui.colonne();
        corps.setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(12));
        carte.addView(corps);

        LinearLayout contenu = ui.colonne();
        MaterialButton titre = ui.boutonTexte("▾ " + SchemaCommande.titre(s));
        titre.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        titre.setTextSize(15);
        titre.setTypeface(Typeface.DEFAULT_BOLD);
        titre.setOnClickListener(v -> {
            boolean ouvrir = contenu.getVisibility() != View.VISIBLE;
            contenu.setVisibility(ouvrir ? View.VISIBLE : View.GONE);
            titre.setText((ouvrir ? "▾ " : "▸ ") + SchemaCommande.titre(s));
        });
        corps.addView(titre, ui.pleineLargeur());

        for (SchemaCommande.Bloc bloc : SchemaCommande.blocs(s, cleSurlignee)) {
            LinearLayout b = ui.colonne();
            b.setPadding(ui.dp(10), ui.dp(8), ui.dp(10), ui.dp(8));
            GradientDrawable cadre = new GradientDrawable();
            cadre.setColor(0xFFFFFFFF);
            cadre.setStroke(ui.dp(1), 0xFFE0E6EC);
            cadre.setCornerRadius(ui.dp(8));
            b.setBackground(cadre);
            b.addView(ui.texte(bloc.titre, 14, true, 0xFF263238), ui.marges(0, 6));
            if (bloc.ensemble != null) {
                SchemaCommande.Dessin dessin = SchemaCommande.dessiner(s, bloc.ensemble);
                SchemaVue vue = SchemaVue.ensemble(activite, dessin, SchemaCommande.elements(dessin, cleSurlignee));
                vue.setContentDescription("Schéma de l'ensemble");
                b.addView(vue, ui.pleineLargeur());
            }
            b.addView(detailPieces(bloc, cleSurlignee));
            contenu.addView(b, ui.marges(4, 6));
        }
        corps.addView(contenu, ui.pleineLargeur());
        return carte;
    }

    private View detailPieces(SchemaCommande.Bloc bloc, String cleSurlignee) {
        LinearLayout conteneur = ui.colonne();
        LinearLayout liste = ui.colonne();
        boolean repliable = bloc.ensemble != null;
        if (repliable) {
            String libelle = "Détail des pièces (" + bloc.lignes.size() + ")";
            MaterialButton titre = ui.boutonTexte((bloc.ouvert ? "▾ " : "▸ ") + libelle);
            titre.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
            liste.setVisibility(bloc.ouvert ? View.VISIBLE : View.GONE);
            titre.setOnClickListener(v -> {
                boolean ouvrir = liste.getVisibility() != View.VISIBLE;
                liste.setVisibility(ouvrir ? View.VISIBLE : View.GONE);
                titre.setText((ouvrir ? "▾ " : "▸ ") + libelle);
            });
            conteneur.addView(titre, ui.marges(2, 0));
        }
        for (SchemaCommande.LignePiece lp : bloc.lignes) liste.addView(lignePiece(lp, cleSurlignee));
        conteneur.addView(liste, ui.pleineLargeur());
        return conteneur;
    }

    private View lignePiece(SchemaCommande.LignePiece lp, String cleSurlignee) {
        SchemaCommande.Piece p = lp.piece;
        LinearLayout ligne = ui.rangee();
        ligne.setGravity(Gravity.TOP);
        ligne.setPadding(ui.dp(2), ui.dp(5), ui.dp(2), ui.dp(5));
        if (p.cle != null && p.cle.equals(cleSurlignee)) ligne.setBackgroundColor(0xFFFFF59D);

        TextView num = ui.texte(p.ligneTexte(), 12, true, p.type.equals("credence") ? 0xFF00695C : 0xFF0D47A1);
        num.setGravity(Gravity.CENTER);
        num.setMinWidth(ui.dp(28));
        num.setPadding(ui.dp(4), ui.dp(1), ui.dp(4), ui.dp(1));
        GradientDrawable bulle = new GradientDrawable();
        bulle.setColor(p.type.equals("credence") ? 0xFFE0F2F1 : 0xFFE3F2FD);
        bulle.setCornerRadius(ui.dp(11));
        num.setBackground(bulle);
        LinearLayout.LayoutParams lpNum = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        lpNum.setMargins(0, 0, ui.dp(8), 0);
        ligne.addView(num, lpNum);

        SpannableStringBuilder sb = new SpannableStringBuilder();
        int debut = sb.length();
        sb.append(SchemaCommande.libelleType(p.type));
        sb.setSpan(new StyleSpan(Typeface.BOLD), debut, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        sb.append(' ');
        debut = sb.length();
        sb.append(String.valueOf(p.article));
        sb.setSpan(new ForegroundColorSpan(0xFF78909C), debut, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        sb.setSpan(new RelativeSizeSpan(0.92f), debut, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        sb.append(" · ").append(SchemaCommande.dims(p));
        for (SchemaCommande.Info info : lp.infos) {
            sb.append('\n');
            debut = sb.length();
            sb.append(info.texte);
            sb.setSpan(new ForegroundColorSpan(info.alerte ? 0xFFC62828 : 0xFF555555), debut, sb.length(),
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sb.setSpan(new RelativeSizeSpan(0.93f), debut, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            if (info.alerte) sb.setSpan(new StyleSpan(Typeface.BOLD), debut, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            if (info.commentaire) sb.setSpan(new StyleSpan(Typeface.ITALIC), debut, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        ligne.addView(ui.texte(sb, 13, false, 0xFF222222), ui.poids(1));
        return ligne;
    }
}
