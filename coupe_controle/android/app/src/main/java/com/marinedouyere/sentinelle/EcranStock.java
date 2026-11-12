package com.marinedouyere.sentinelle;

import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.android.material.card.MaterialCardView;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;

/**
 * V6.5.1 : l'écran Stock des panneaux, comme la page du PC. Le PC lit le fichier woodStore (brdlib.bdx) et l'envoie
 * déjà lu dans le fichier partagé ; ici on l'affiche seulement. Stock réel = stock − réservé : les chutes réservées
 * (pour un lancement à débiter) sont comptées et montrées à part. Limite woodStore : 0 = limité au stock, 9 = dépassement
 * autorisé. Tri par appui sur les en-têtes de colonnes.
 */
final class EcranStock {

    static final long JOUR = 86_400_000L;
    static final int STOCK_VIEUX_JOURS = 7;
    static final int CHUTE_DORT_JOURS = 120;

    /** Un matériau du stock (tous ses formats). */
    static final class Materiau {
        String mat = "";
        String desc = "";
        String famille = "";
        double ep;
        int entiers; // disponibles (sans les panneaux réservés de la case 302)
        int entiersReserves;
        int chutes; // disponibles seulement
        int reservees;
        final TreeSet<Integer> limites = new TreeSet<>();
        final List<FichierPartage.FormatStock> lesEntiers = new ArrayList<>();
        final List<FichierPartage.FormatStock> lesChutes = new ArrayList<>();
    }

    /** Regroupe les formats par matériau (mêmes règles que le PC). */
    static List<Materiau> materiaux(FichierPartage.Stock s) {
        Map<String, Materiau> par = new LinkedHashMap<>();
        for (FichierPartage.FormatStock f : s.formats) {
            Materiau m = par.get(f.mat);
            if (m == null) {
                m = new Materiau();
                m.mat = f.mat;
                m.famille = f.famille;
                m.ep = f.ep;
                par.put(f.mat, m);
            }
            if (f.chute()) {
                if (f.qte > 0) {
                    m.lesChutes.add(f);
                    if (f.reservee) m.reservees += f.qte;
                    else m.chutes += f.qte;
                }
            } else {
                m.lesEntiers.add(f);
                m.entiers += f.dispo();
                m.entiersReserves += f.reserve();
                m.limites.add(f.limite);
                if (m.desc.isEmpty() && !f.desc.isEmpty()) m.desc = f.desc;
                m.famille = f.famille;
            }
        }
        for (Materiau m : par.values()) {
            if (m.desc.isEmpty())
                for (FichierPartage.FormatStock f : m.lesChutes)
                    if (!f.desc.isEmpty()) {
                        m.desc = f.desc;
                        break;
                    }
            Collections.sort(m.lesEntiers, (a, b) -> a.dispo() != b.dispo() ? Integer.compare(b.dispo(), a.dispo()) : Double.compare(b.L * b.W, a.L * a.W));
            // Les disponibles d'abord, puis les plus grandes.
            Collections.sort(m.lesChutes, (a, b) -> a.reservee != b.reservee ? (a.reservee ? 1 : -1) : Double.compare(b.L * b.W, a.L * a.W));
            if (!m.lesEntiers.isEmpty()) m.ep = m.lesEntiers.get(0).ep;
        }
        return new ArrayList<>(par.values());
    }

    private static final String[][] FAMILLES = {
            {"tous", "Tous"}, {"strat", "Stratifiés"}, {"compact", "Compacts"}, {"agglo", "Agglos"}, {"protection", "Protections"}, {"autre", "Autres"},
    };

    private final MainActivity activite;
    private final Ui ui;
    private final PartageVue vue;

    private String recherche = "";
    private boolean lettres = false;
    /** Comme sur le PC : « avec du stock seulement » (cochée au départ). */
    private boolean avecStock = true;
    private String famille = "tous";
    private String tri = "entiers";
    private int sens = -1;
    private String ouvert;
    private LinearLayout liste;
    private List<Materiau> tous;
    private FichierPartage.Stock lu;

    EcranStock(MainActivity activite, Ui ui, PartageVue vue) {
        this.activite = activite;
        this.ui = ui;
        this.vue = vue;
    }

    private static String mm(double v) {
        return v == Math.rint(v) ? String.valueOf((long) v) : String.format(Locale.FRANCE, "%.1f", v);
    }

    private static String jour(long ms) {
        return ms <= 0 ? "?" : new SimpleDateFormat("dd/MM/yyyy", Locale.FRANCE).format(new Date(ms));
    }

    private static String cases(String c) {
        return c == null ? "" : c.trim().replaceAll("\\((\\d+)\\)?", " · $1").replaceAll("\\s+(?=\\S+ · )", ", ");
    }

    /** L'écran entier (l'en-tête de page est déjà posé). */
    void construire(LinearLayout racine, FichierPartage donnees) {
        FichierPartage.Stock s = donnees == null ? null : donnees.stock;
        if (s == null || s.formats.isEmpty()) {
            MaterialCardView carte = ui.carte();
            LinearLayout corps = corps(carte);
            corps.addView(ui.titreCarte("Pas encore de stock"));
            corps.addView(ui.texte("Sur le PC : page « Stock des panneaux », chargez le fichier brdlib.bdx extrait de woodStore. "
                    + "Il arrive ensuite ici tout seul, avec les autres données du PC.", 14, false, Ui.NOIR), ui.marges(4, 0));
            racine.addView(carte);
            return;
        }
        if (s != lu) {
            lu = s;
            tous = materiaux(s);
        }
        racine.addView(carteFichier(s));
        int entiers = 0;
        int chutes = 0;
        int reservees = 0;
        for (Materiau m : tous) {
            entiers += m.entiers;
            chutes += m.chutes;
            reservees += m.reservees;
        }
        racine.addView(vue.bandeChiffres(new String[] {String.valueOf(tous.size()), "Matériaux"}, new String[] {String.valueOf(entiers), "Panneaux entiers"},
                new String[] {String.valueOf(chutes), "Chutes dispo."}, new String[] {String.valueOf(reservees), "Chutes réservées"}));

        // Recherche (chiffres par défaut, « ABC » pour les lettres) : seule la liste se refait, le champ garde la main.
        LinearLayout ligne = ui.rangee();
        ligne.setGravity(Gravity.CENTER_VERTICAL);
        EditText champ = vue.champ("Matériau ou couleur (ex. 1114)", lettres ? PartageVue.CLAVIER_LETTRES : PartageVue.CLAVIER_CHIFFRES, recherche);
        champ.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence t, int a, int b, int c) {}

            @Override
            public void onTextChanged(CharSequence t, int a, int b, int c) {}

            @Override
            public void afterTextChanged(Editable e) {
                recherche = e.toString();
                remplirListe();
            }
        });
        ligne.addView(champ, ui.poids(1));
        ligne.addView(vue.boutonClavier(champ, lettres, l -> lettres = l));
        racine.addView(ligne, ui.marges(8, 4));

        // Familles.
        HorizontalScrollView defile = new HorizontalScrollView(activite);
        defile.setHorizontalScrollBarEnabled(false);
        LinearLayout puces = ui.rangee();
        for (String[] f : FAMILLES) {
            boolean actif = f[0].equals(famille);
            TextView p = ui.pilule(f[1], actif ? Ui.SAUMON_PALE : 0xFFFFFFFF, actif ? Ui.BORDEAUX : Ui.GRIS);
            p.setTextSize(13);
            p.setPadding(ui.dp(12), ui.dp(6), ui.dp(12), ui.dp(6));
            ui.cliquable(p, v -> {
                famille = f[0];
                vue.reconstruire();
            });
            p.setBackground(ui.fondRond(actif ? Ui.SAUMON_PALE : 0xFFFFFFFF, 14));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, 0, ui.dp(6), 0);
            puces.addView(p, lp);
        }
        defile.addView(puces);
        racine.addView(defile, ui.marges(2, 2));
        android.widget.CheckBox caseStock = new android.widget.CheckBox(activite);
        caseStock.setText("Avec du stock seulement");
        caseStock.setTextSize(14);
        caseStock.setTypeface(ui.lato());
        caseStock.setChecked(avecStock);
        caseStock.setOnCheckedChangeListener((b, coche) -> {
            avecStock = coche;
            remplirListe();
        });
        racine.addView(caseStock, ui.marges(0, 4));

        MaterialCardView carte = ui.carte();
        LinearLayout c = corps(carte);
        c.addView(entete());
        liste = ui.colonne();
        c.addView(liste, ui.pleineLargeur());
        racine.addView(carte);
        remplirListe();
        racine.addView(carteChutesQuiDorment());
    }

    private LinearLayout corps(MaterialCardView carte) {
        LinearLayout corps = ui.colonne();
        corps.setPadding(ui.dp(14), ui.dp(12), ui.dp(14), ui.dp(12));
        carte.addView(corps);
        return corps;
    }

    private MaterialCardView carteFichier(FichierPartage.Stock s) {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corps(carte);
        corps.addView(ui.titreCarte("Fichier woodStore"));
        long donneesDu = s.jusquau > 0 ? s.jusquau : s.modifie;
        corps.addView(ui.texte((s.nom.isEmpty() ? "brdlib.bdx" : s.nom) + " · données du " + jour(donneesDu) + " · chargé sur le PC le " + jour(s.charge), 13, false,
                ui.couleur(R.color.gris_texte)), ui.marges(2, 2));
        long age = donneesDu > 0 ? (System.currentTimeMillis() - donneesDu) / JOUR : -1;
        if (age > STOCK_VIEUX_JOURS)
            corps.addView(ui.bandeau("⚠ Données de " + age + " jours : extrayez un fichier neuf de woodStore et chargez-le sur le PC (page Stock).",
                    ui.couleur(R.color.attention_fond), ui.couleur(R.color.attention_texte)), ui.marges(6, 2));
        int panneauxReserves = 0;
        for (FichierPartage.FormatStock f : s.formats) panneauxReserves += f.reserve();
        corps.addView(ui.note("Stock réel = stock − réservé : les chutes réservées pour un lancement à débiter et les panneaux entiers de la case 302"
                + (panneauxReserves > 0 ? " (" + panneauxReserves + " aujourd'hui)" : "") + " sont comptés à part."), ui.marges(4, 0));
        return carte;
    }

    // ---- la liste des matériaux, triée par les en-têtes ----

    private static final String[][] COLONNES = {{"mat", "Matériau"}, {"entiers", "Entiers"}, {"chutes", "Chutes"}, {"reservees", "Rés."}};

    private View entete() {
        LinearLayout r = ui.rangee();
        r.setPadding(ui.dp(2), 0, ui.dp(2), ui.dp(6));
        for (String[] col : COLONNES) {
            boolean actif = col[0].equals(tri);
            TextView t = ui.texte(col[1] + (actif ? (sens > 0 ? " ▲" : " ▼") : ""), 12, true, actif ? Ui.BORDEAUX : Ui.GRIS);
            t.setGravity(col[0].equals("mat") ? Gravity.START : Gravity.END);
            t.setPadding(0, ui.dp(4), 0, ui.dp(4));
            ui.cliquable(t, v -> {
                if (col[0].equals(tri)) sens = -sens;
                else {
                    tri = col[0];
                    sens = col[0].equals("mat") ? 1 : -1;
                }
                vue.reconstruire();
            });
            r.addView(t, col[0].equals("mat") ? ui.poids(1) : new LinearLayout.LayoutParams(ui.dp(col[0].equals("reservees") ? 46 : 62), LinearLayout.LayoutParams.WRAP_CONTENT));
        }
        return r;
    }

    private List<Materiau> filtres() {
        String q = recherche.trim().toUpperCase(Locale.FRANCE);
        List<Materiau> res = new ArrayList<>();
        for (Materiau m : tous) {
            if (!"tous".equals(famille) && !famille.equals(m.famille)) continue;
            if (avecStock && m.entiers + m.entiersReserves + m.chutes + m.reservees == 0) continue;
            if (!q.isEmpty() && !m.mat.toUpperCase(Locale.FRANCE).contains(q) && !m.desc.toUpperCase(Locale.FRANCE).contains(q)) continue;
            res.add(m);
        }
        Comparator<Materiau> cmp;
        switch (tri) {
            case "mat":
                cmp = (a, b) -> a.mat.compareToIgnoreCase(b.mat);
                break;
            case "chutes":
                cmp = (a, b) -> Integer.compare(a.chutes, b.chutes);
                break;
            case "reservees":
                cmp = (a, b) -> Integer.compare(a.reservees, b.reservees);
                break;
            default:
                cmp = (a, b) -> Integer.compare(a.entiers, b.entiers);
        }
        final Comparator<Materiau> c = cmp;
        Collections.sort(res, (a, b) -> {
            // Le matériau tapé tel quel en premier.
            boolean ea = !q.isEmpty() && a.mat.equalsIgnoreCase(q);
            boolean eb = !q.isEmpty() && b.mat.equalsIgnoreCase(q);
            if (ea != eb) return ea ? -1 : 1;
            int r = sens * c.compare(a, b);
            return r != 0 ? r : a.mat.compareToIgnoreCase(b.mat);
        });
        return res;
    }

    private void remplirListe() {
        if (liste == null) return;
        liste.removeAllViews();
        List<Materiau> res = filtres();
        if (res.isEmpty()) {
            liste.addView(ui.note(recherche.trim().isEmpty() ? "Aucun matériau dans cette famille." : "Aucun matériau ne correspond à « " + recherche.trim() + " »."), ui.marges(6, 4));
            return;
        }
        // Tous les matériaux, sans limite : la liste défile.
        liste.addView(ui.note(res.size() + " matériau" + (res.size() > 1 ? "x" : "") + ", tous affichés · touchez une ligne pour le détail."), ui.marges(0, 4));
        for (Materiau m : res) {
            liste.addView(ui.filet());
            liste.addView(ligneMateriau(m));
            if (m.mat.equals(ouvert)) liste.addView(detail(m));
        }
    }

    private View ligneMateriau(Materiau m) {
        LinearLayout r = ui.rangee();
        r.setPadding(ui.dp(2), ui.dp(9), ui.dp(2), ui.dp(9));
        r.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout textes = ui.colonne();
        textes.addView(ui.texte(m.mat, 15, true, Ui.NOIR));
        String sous = (m.desc.isEmpty() ? "" : m.desc) + (m.ep > 0 ? (m.desc.isEmpty() ? "" : " · ") + mm(m.ep) + " mm" : "");
        if (!sous.isEmpty()) {
            TextView t = ui.note(sous);
            t.setMaxLines(2);
            textes.addView(t);
        }
        r.addView(textes, ui.poids(1));
        r.addView(chiffre(String.valueOf(m.entiers), m.entiers == 0 ? Ui.GRIS : Ui.NOIR), new LinearLayout.LayoutParams(ui.dp(62), LinearLayout.LayoutParams.WRAP_CONTENT));
        r.addView(chiffre(String.valueOf(m.chutes), m.chutes == 0 ? Ui.GRIS : Ui.NOIR), new LinearLayout.LayoutParams(ui.dp(62), LinearLayout.LayoutParams.WRAP_CONTENT));
        r.addView(chiffre(String.valueOf(m.reservees), m.reservees == 0 ? Ui.GRIS : ui.couleur(R.color.attention_texte)), new LinearLayout.LayoutParams(ui.dp(46), LinearLayout.LayoutParams.WRAP_CONTENT));
        ui.cliquable(r, v -> {
            ouvert = m.mat.equals(ouvert) ? null : m.mat;
            remplirListe();
        });
        return r;
    }

    private TextView chiffre(String t, int couleur) {
        TextView v = ui.texte(t, 15, true, couleur);
        v.setGravity(Gravity.END);
        return v;
    }

    private View detail(Materiau m) {
        LinearLayout d = ui.colonne();
        d.setPadding(ui.dp(10), ui.dp(4), ui.dp(6), ui.dp(10));
        d.setBackground(ui.fondRond(0xFFFAF7F4, 10));
        // Panneaux entiers : format, quantité, Limite woodStore, cases.
        d.addView(ui.texte("Panneaux entiers (" + m.entiers + " disponible" + (m.entiers > 1 ? "s" : "")
                + (m.entiersReserves > 0 ? ", " + m.entiersReserves + " réservé" + (m.entiersReserves > 1 ? "s" : "") + " case 302" : "") + ")", 13, true, Ui.BORDEAUX), ui.marges(4, 2));
        if (m.lesEntiers.isEmpty()) d.addView(ui.note("Aucun format de panneau entier."));
        for (FichierPartage.FormatStock f : m.lesEntiers) {
            String lim = f.limite == 9 ? "Limite 9 : dépassement autorisé" : "Limite 0 : limité au stock";
            int res = f.reserve();
            String sous = lim + (f.fil ? " · fil" : "") + (f.cases.isEmpty() ? "" : "\nCases : " + cases(f.cases))
                    + (res > 0 ? "\n+ " + res + " réservé" + (res > 1 ? "s" : "") + " pour un lancement (case 302)" : "");
            TextView qte = ui.texte(f.dispo() + " pann.", 14, true, f.dispo() == 0 ? Ui.GRIS : Ui.NOIR);
            d.addView(ui.ligne(null, mm(f.L) + " × " + mm(f.W) + " · " + mm(f.ep) + " mm", sous, qte, null, null));
        }
        // Chutes : disponibles, puis réservées.
        int dispo = 0;
        int res = 0;
        for (FichierPartage.FormatStock f : m.lesChutes) {
            if (f.reservee) res++;
            else dispo++;
        }
        d.addView(ui.texte("Chutes disponibles (" + m.chutes + ")", 13, true, Ui.BORDEAUX), ui.marges(10, 2));
        if (dispo == 0) d.addView(ui.note("Aucune chute disponible."));
        ajouterChutes(d, m, false);
        if (res > 0) {
            d.addView(ui.texte("Chutes réservées (" + m.reservees + ") — prises pour un lancement à débiter", 13, true, ui.couleur(R.color.attention_texte)), ui.marges(10, 2));
            ajouterChutes(d, m, true);
        }
        return d;
    }

    private void ajouterChutes(LinearLayout d, Materiau m, boolean reservees) {
        for (FichierPartage.FormatStock f : m.lesChutes) {
            if (f.reservee != reservees) continue;
            long jours = f.depuis > 0 ? (System.currentTimeMillis() - f.depuis) / JOUR : -1;
            String sous = (f.cases.isEmpty() ? "Case ?" : "Case " + cases(f.cases)) + (f.origine.isEmpty() ? "" : " · " + f.origine)
                    + (jours > CHUTE_DORT_JOURS && !f.reservee ? " · dort depuis " + jours + " j" : "");
            View droite = f.reservee ? ui.pilule("réservée", ui.couleur(R.color.attention_fond), ui.couleur(R.color.attention_texte))
                    : ui.texte("× " + f.qte, 14, true, Ui.NOIR);
            d.addView(ui.ligne(null, mm(f.L) + " × " + mm(f.W), sous, droite, null, null));
        }
    }

    // ---- les chutes qui dorment (en stock depuis plus de 4 mois) ----

    private View carteChutesQuiDorment() {
        List<Object[]> vieilles = new ArrayList<>();
        long maintenant = System.currentTimeMillis();
        for (Materiau m : tous)
            for (FichierPartage.FormatStock f : m.lesChutes)
                if (!f.reservee && f.depuis > 0 && (maintenant - f.depuis) / JOUR > CHUTE_DORT_JOURS) vieilles.add(new Object[] {m, f});
        if (vieilles.isEmpty()) return ui.espace(1);
        Collections.sort(vieilles, (a, b) -> Long.compare(((FichierPartage.FormatStock) a[1]).depuis, ((FichierPartage.FormatStock) b[1]).depuis));
        MaterialCardView carte = ui.carte();
        LinearLayout c = corps(carte);
        c.addView(ui.titreCarte("Chutes qui dorment (" + vieilles.size() + ")"));
        c.addView(ui.note("En stock depuis plus de 4 mois : à utiliser en priorité, ou à sortir."));
        for (Object[] x : vieilles) {
            Materiau m = (Materiau) x[0];
            FichierPartage.FormatStock f = (FichierPartage.FormatStock) x[1];
            long jours = (maintenant - f.depuis) / JOUR;
            c.addView(ui.filet());
            c.addView(ui.ligne(null, m.mat + " · " + mm(f.L) + " × " + mm(f.W), (f.cases.isEmpty() ? "Case ?" : "Case " + cases(f.cases)) + " · " + jours + " jours",
                    ui.texte("× " + f.qte, 14, true, Ui.NOIR), null, null));
        }
        return carte;
    }
}
