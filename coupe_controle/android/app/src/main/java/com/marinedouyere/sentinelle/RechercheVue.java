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
            Affichage a;
            synchronized (cache) {
                garderSeulement(sources);
                a = preparer(requete, sources);
            }
            principal.post(() -> {
                if (numero != generation) return;
                enCours = false;
                bouton.setEnabled(true);
                afficher(a);
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

    // ---- résultat : une fiche par commande, une ligne par pièce ----

    /** Une pièce affichée : ce qu'en dit le fichier de lancement (schéma) et ce qu'on a trouvé. */
    private static final class Ligne {
        String cle;
        SchemaCommande.Piece piece;
        Recherche.PieceTrouvee trouvee;
        List<SchemaCommande.Info> infos = new ArrayList<>();
    }

    /** Une commande : son schéma (si on l'a) et ses pièces. */
    private static final class Fiche {
        String commande;
        SchemaCommande.Schema schema;
        List<SchemaCommande.Bloc> blocs;
        final List<Ligne> lignes = new ArrayList<>();
    }

    private static final class Affichage {
        Recherche.Resultat r;
        String cleCherchee;
        final List<Fiche> fiches = new ArrayList<>();
        final List<String> erreurs = new ArrayList<>();
        int nbPieces;
    }

    /** Recherche et mise en forme, hors du fil d'affichage. */
    private static Affichage preparer(String requete, List<SourceCase> sources) {
        Affichage a = new Affichage();
        a.r = Recherche.rechercher(requete, sources);
        if (a.r == null || a.r.nbSources == 0 || a.r.trouvailles.isEmpty()) {
            if (a.r != null) a.erreurs.addAll(a.r.erreurs);
            return a;
        }
        a.erreurs.addAll(a.r.erreurs);
        String commande = a.r.commandeUnique;
        Recherche.Resultat r = a.r;
        // Une seule commande concernée : on montre toute la commande, la pièce cherchée en surbrillance.
        if (commande != null && !commande.equals(a.r.requete)) {
            Recherche.Resultat toute = Recherche.rechercher(commande, sources);
            if (toute != null && !toute.trouvailles.isEmpty()) {
                r = toute;
                for (String e : toute.erreurs) if (!a.erreurs.contains(e)) a.erreurs.add(e);
            }
        }
        List<Recherche.PieceTrouvee> pieces = Recherche.regrouper(r.trouvailles);
        for (Recherche.PieceTrouvee p : pieces) if (p.cle.equals(a.r.requete)) a.cleCherchee = p.cle;

        if (commande != null) {
            Fiche f = new Fiche();
            f.commande = commande;
            try {
                List<LecteurStrat.LigneStrat> lignes = Recherche.lignesDeLaCommande(commande, sources);
                if (!lignes.isEmpty()) {
                    f.schema = SchemaCommande.construire(commande, lignes);
                    f.blocs = SchemaCommande.blocs(f.schema, a.cleCherchee);
                }
            } catch (Exception e) {
                a.erreurs.add("Schéma de la commande : " + (e.getMessage() != null ? e.getMessage() : e));
            }
            Map<String, Recherche.PieceTrouvee> parCle = new HashMap<>();
            for (Recherche.PieceTrouvee p : pieces) parCle.put(p.cle, p);
            if (f.schema != null) {
                Map<String, List<SchemaCommande.Info>> infos = new HashMap<>();
                for (SchemaCommande.Bloc b : f.blocs) {
                    for (SchemaCommande.LignePiece lp : b.lignes) {
                        if (lp.piece.cle != null && !infos.containsKey(lp.piece.cle)) infos.put(lp.piece.cle, lp.infos);
                    }
                }
                for (SchemaCommande.Piece piece : f.schema.pieces) {
                    Ligne l = new Ligne();
                    l.cle = piece.cle;
                    l.piece = piece;
                    l.trouvee = parCle.remove(piece.cle);
                    List<SchemaCommande.Info> i = infos.get(piece.cle);
                    if (i != null) l.infos.addAll(i);
                    f.lignes.add(l);
                }
            }
            for (Recherche.PieceTrouvee p : parCle.values()) f.lignes.add(ligneSansSchema(p));
            a.fiches.add(f);
        } else {
            Fiche f = null;
            for (Recherche.PieceTrouvee p : pieces) {
                if (f == null || !f.commande.equals(p.commande())) {
                    f = new Fiche();
                    f.commande = p.commande();
                    a.fiches.add(f);
                }
                f.lignes.add(ligneSansSchema(p));
            }
        }
        for (Fiche f : a.fiches) a.nbPieces += f.lignes.size();
        return a;
    }

    private static Ligne ligneSansSchema(Recherche.PieceTrouvee p) {
        Ligne l = new Ligne();
        l.cle = p.cle;
        l.trouvee = p;
        return l;
    }

    private void afficher(Affichage a) {
        zone.removeAllViews();
        Recherche.Resultat r = a.r;
        if (r == null) return;
        if (r.nbSources == 0) {
            zone.addView(ui.texte("Aucun fichier chargé.", 14, false, ui.couleur(R.color.alerte_texte)), ui.marges(6, 0));
            return;
        }
        if (a.fiches.isEmpty()) {
            zone.addView(ui.texte("« " + r.requete + " » introuvable.", 14, false, ui.couleur(R.color.alerte_texte)), ui.marges(6, 0));
        } else {
            if (a.fiches.size() > 1 || r.numeroBande != null) {
                String quoi = r.numeroBande != null ? "Bande T" + r.numeroBande + " : " : "";
                zone.addView(ui.texte(quoi + a.nbPieces + " pièce(s) dans " + a.fiches.size() + " commande(s)", 14, true,
                        0xFF263238), ui.marges(6, 2));
            }
            LinearLayout liste = ui.colonne();
            zone.addView(liste, ui.pleineLargeur());
            afficherFiches(liste, a, 0);
        }
        if (!a.erreurs.isEmpty()) {
            zone.addView(ui.texte("Illisibles : " + String.join(" · ", a.erreurs), 13, false, ui.couleur(R.color.alerte_texte)),
                    ui.marges(4, 0));
        }
    }

    /** Affiche les fiches par paquets (une recherche large peut en donner des centaines). */
    private void afficherFiches(LinearLayout liste, Affichage a, int debut) {
        int i = debut;
        int lignes = 0;
        while (i < a.fiches.size() && (lignes < PAR_PAGE || i == debut)) {
            lignes += a.fiches.get(i).lignes.size();
            liste.addView(fiche(a.fiches.get(i), a.cleCherchee));
            i++;
        }
        if (i < a.fiches.size()) {
            final int suite = i;
            MaterialButton plus = ui.boutonContour("Afficher la suite (" + (a.fiches.size() - suite) + " commande(s))");
            plus.setOnClickListener(v -> {
                liste.removeView(plus);
                afficherFiches(liste, a, suite);
            });
            liste.addView(plus, ui.marges(4, 4));
        }
    }

    private View fiche(Fiche f, String cleCherchee) {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = ui.colonne();
        corps.setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(8));
        carte.addView(corps);

        LinearLayout entete = ui.rangee();
        entete.addView(ui.texte("Commande " + f.commande, 16, true, 0xFF1565C0), ui.poids(1));
        if (f.schema == null) {
            MaterialButton voir = ui.boutonTexte("Voir la commande");
            voir.setOnClickListener(v -> rechercher(f.commande));
            entete.addView(voir);
        } else {
            entete.addView(ui.texte(f.lignes.size() + " pièce(s)", 13, false, ui.couleur(R.color.gris_texte)));
        }
        corps.addView(entete);

        if (f.schema != null) {
            // Dessin seulement pour ce qui est assemblé (L, U, plans aboutés) ou porte des crédences.
            for (SchemaCommande.Bloc b : f.blocs) {
                if (b.ensemble == null || !aDessiner(f.schema, b.ensemble)) continue;
                String legende = b.titre.replaceFirst("^Ensemble \\d+ · ", "");
                corps.addView(ui.texte(Character.toUpperCase(legende.charAt(0)) + legende.substring(1), 13, true, 0xFF455A64),
                        ui.marges(8, 4));
                SchemaCommande.Dessin dessin = SchemaCommande.dessiner(f.schema, b.ensemble);
                SchemaVue vue = SchemaVue.ensemble(activite, dessin, SchemaCommande.elements(dessin, cleCherchee));
                vue.setContentDescription("Schéma : " + legende);
                corps.addView(vue, ui.pleineLargeur());
            }
        }
        corps.addView(ui.separateur());
        for (Ligne l : f.lignes) corps.addView(lignePiece(f, l, cleCherchee));
        return carte;
    }

    private static boolean aDessiner(SchemaCommande.Schema s, SchemaCommande.Ensemble e) {
        if (e.pieces.size() > 1) return true;
        SchemaCommande.Place place = s.placement.get(e.pieces.get(0));
        return place != null && (!place.fond.isEmpty() || place.retourGauche != null || place.retourDroite != null);
    }

    private String nomSource(Recherche.Trouvaille t) {
        if (t.source instanceof SourceCase) {
            Paire p = ((SourceCase) t.source).p;
            return p.estChantier() ? p.label : p.poste;
        }
        return t.source.nom();
    }

    private View lignePiece(Fiche f, Ligne l, String cleCherchee) {
        boolean cherchee = l.cle != null && l.cle.equals(cleCherchee);
        LinearLayout bloc = ui.colonne();
        if (cherchee) bloc.setBackgroundColor(0xFFFFF59D);

        LinearLayout haut = ui.rangee();
        haut.setGravity(Gravity.TOP);
        haut.setPadding(ui.dp(2), ui.dp(7), ui.dp(2), ui.dp(7));

        String numero = l.piece != null ? l.piece.ligneTexte() : String.valueOf(Js.parseIntOuZero(l.cle.substring(Math.max(0, l.cle.length() - 3))));
        boolean credence = l.piece != null && l.piece.type.equals("credence");
        TextView num = ui.texte(numero, 12, true, credence ? 0xFF00695C : 0xFF0D47A1);
        num.setGravity(Gravity.CENTER);
        num.setMinWidth(ui.dp(28));
        num.setPadding(ui.dp(4), ui.dp(1), ui.dp(4), ui.dp(1));
        GradientDrawable bulle = new GradientDrawable();
        bulle.setColor(credence ? 0xFFE0F2F1 : 0xFFE3F2FD);
        bulle.setCornerRadius(ui.dp(11));
        num.setBackground(bulle);
        LinearLayout.LayoutParams lpNum = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        lpNum.setMargins(0, 0, ui.dp(8), 0);
        haut.addView(num, lpNum);

        LinearLayout textes = ui.colonne();
        textes.addView(ui.texte(description(l), 14, false, 0xFF222222));
        textes.addView(ui.texte(etat(l), 12, false, l.trouvee == null ? ui.couleur(R.color.alerte_texte) : 0xFF607D8B),
                ui.marges(1, 0));
        haut.addView(textes, ui.poids(1));
        TextView chevron = ui.texte(cherchee ? "▾" : "▸", 16, false, 0xFF90A4AE);
        chevron.setPadding(ui.dp(6), 0, 0, 0);
        haut.addView(chevron);
        bloc.addView(haut, ui.pleineLargeur());

        LinearLayout details = ui.colonne();
        details.setPadding(ui.dp(38), 0, ui.dp(4), ui.dp(8));
        remplirDetails(details, f, l);
        details.setVisibility(cherchee ? View.VISIBLE : View.GONE);
        bloc.addView(details, ui.pleineLargeur());

        haut.setOnClickListener(v -> {
            boolean ouvrir = details.getVisibility() != View.VISIBLE;
            details.setVisibility(ouvrir ? View.VISIBLE : View.GONE);
            chevron.setText(ouvrir ? "▾" : "▸");
        });

        View trait = new View(activite);
        trait.setBackgroundColor(0xFFECEFF1);
        bloc.addView(trait, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, ui.dp(1) / 2 + 1)));
        return bloc;
    }

    /** « Plan TPPVC29551 · 1120 × 600 × 29 mm » (ou la clé si le fichier de lancement n'est pas chargé). */
    private CharSequence description(Ligne l) {
        SpannableStringBuilder sb = new SpannableStringBuilder();
        if (l.piece != null) {
            sb.append(SchemaCommande.libelleType(l.piece.type));
            sb.setSpan(new StyleSpan(Typeface.BOLD), 0, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            if (l.piece.article != null) {
                sb.append(' ');
                int d = sb.length();
                sb.append(l.piece.article);
                sb.setSpan(new ForegroundColorSpan(0xFF78909C), d, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                sb.setSpan(new RelativeSizeSpan(0.9f), d, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
            if (l.piece.L != null && l.piece.W != null) sb.append(" · ").append(SchemaCommande.dims(l.piece));
            return sb;
        }
        sb.append(l.cle);
        sb.setSpan(new StyleSpan(Typeface.BOLD), 0, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        Recherche.ChampsDetail c = l.trouvee != null ? l.trouvee.champs : null;
        if (c != null && c.longueurFinie != null && c.largeurFinie != null) {
            sb.append(" · ").append(Js.dimension(c.longueurFinie)).append(" × ").append(Js.dimension(c.largeurFinie));
            if (c.epaisseurFinie != null) sb.append(" × ").append(Js.dimension(c.epaisseurFinie));
            sb.append(" mm");
        }
        return sb;
    }

    /** « Feno ×1 · T73:2:1 » : où la pièce a été trouvée, combien, et son grain matching. */
    private String etat(Ligne l) {
        if (l.trouvee == null) return "Non trouvée dans les fichiers chargés";
        List<String> morceaux = new ArrayList<>();
        for (Recherche.Trouvaille t : l.trouvee.sources) {
            String qte = t.quantite != null ? Js.nombre(t.quantite) : "?";
            morceaux.add(nomSource(t) + " ×" + qte + (t.sourceBkp ? " (.bkp)" : t.sansCoupe ? " (prévu)" : ""));
        }
        String texte = String.join(" · ", morceaux);
        if (!l.trouvee.grains.isEmpty()) texte += " · " + String.join(" ", l.trouvee.grains);
        return texte;
    }

    private void remplirDetails(LinearLayout details, Fiche f, Ligne l) {
        TextView cle = ui.texte(l.cle, 12, false, 0xFF78909C);
        cle.setTypeface(Typeface.MONOSPACE);
        details.addView(cle);
        Recherche.ChampsDetail c = l.trouvee != null ? l.trouvee.champs : null;
        if (c != null) {
            List<ElementSvg> dessin = SchemaPiece.construire(c);
            if (dessin != null) {
                SchemaVue vue = SchemaVue.piece(activite, dessin);
                vue.setContentDescription(SchemaPiece.libelle(c));
                details.addView(vue, ui.marges(4, 4));
            }
            if (c.lancement != null) details.addView(info("Lancement " + c.lancement, false, false));
            if (l.piece == null && c.assemblage != null) details.addView(info("Assemblage " + c.assemblage, false, false));
        }
        for (SchemaCommande.Info i : l.infos) details.addView(info(i.texte, i.alerte, i.commentaire));
        if (f.schema != null && l.piece != null && f.schema.nonPlacees.contains(l.piece)) {
            details.addView(info("Position à lire sur le plan client", false, false));
        }
        if (c != null && c.toutesDonnees != null && !c.toutesDonnees.isEmpty()) details.addView(donneesLancement(c.toutesDonnees));
    }

    private TextView info(String texte, boolean alerte, boolean commentaire) {
        TextView t = ui.texte(texte, 13, alerte, alerte ? 0xFFC62828 : 0xFF455A64);
        if (commentaire) t.setTypeface(Typeface.DEFAULT, Typeface.ITALIC);
        t.setPadding(0, ui.dp(2), 0, 0);
        return t;
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
}
