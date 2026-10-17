package com.marinedouyere.sentinelle;

import android.content.Context;
import android.graphics.Typeface;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.StyleSpan;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TableLayout;
import android.widget.TableRow;
import android.widget.TextView;

import com.marinedouyere.sentinelle.moteur.Js;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Tableau récapitulatif des lancements d'un onglet semaine : une ligne par
 * case qui a un fichier de lancement, classée par semaine, avec les pièces
 * prévues, les pièces du .bkp et le résultat des deux contrôles.
 */
final class RecapLancements {

    private RecapLancements() {}

    interface SurClic {
        void ouvrir(Paire p);
    }

    static final class Ligne {
        Paire paire;
        String semaine;
        String nom;
        String lancement;
        /** Pièces prévues par le fichier de lancement (null : en cours de calcul, NaN : illisible). */
        Double prevues;
        /** Pièces du .bkp (null : en cours de calcul) ; sans objet si la case n'a pas de .bkp. */
        Double bkp;
    }

    private static int semaine(Ligne l) {
        try {
            return l.semaine == null ? Integer.MAX_VALUE : Integer.parseInt(l.semaine);
        } catch (NumberFormatException e) {
            return Integer.MAX_VALUE;
        }
    }

    /** Lignes du tableau, avec les totaux déjà connus (les autres restent à calculer). */
    static List<Ligne> lignes(List<Paire> pairesDeLaSemaine, Controles controles) {
        List<Ligne> lignes = new ArrayList<>();
        for (Paire p : pairesDeLaSemaine) {
            if (p.strat == null) continue;
            Ligne l = new Ligne();
            l.paire = p;
            l.semaine = p.semaine;
            l.nom = p.estChantier() ? p.label : p.poste;
            String nom = p.strat.nom;
            l.lancement = nom.contains(".") ? nom.substring(0, nom.lastIndexOf('.')) : nom;
            l.prevues = controles.totalEnCache("strat", p.strat);
            l.bkp = p.bkp != null ? controles.totalEnCache("bkp", p.bkp) : null;
            lignes.add(l);
        }
        Collections.sort(lignes, (a, b) -> Integer.compare(semaine(a), semaine(b)));
        return lignes;
    }

    /** Vrai s'il reste des totaux à calculer (lecture des fichiers). */
    static boolean incomplet(List<Ligne> lignes) {
        for (Ligne l : lignes) if (l.prevues == null || (l.paire.bkp != null && l.bkp == null)) return true;
        return false;
    }

    private static String nombre(Double v) {
        if (v == null) return "…";
        if (v.isNaN()) return "?";
        return Js.nombre(v);
    }

    private static TextView cellule(Context c, Ui ui, CharSequence texte, boolean gras, int couleur, int gravite) {
        TextView t = ui.texte(texte, 13, gras, couleur);
        t.setPadding(ui.dp(5), ui.dp(6), ui.dp(5), ui.dp(6));
        t.setGravity(gravite | Gravity.CENTER_VERTICAL);
        return t;
    }

    private static final String[] TITRES = {"Poste", "Prévues", ".bkp", "Contrôle", "Scies"};

    private static TableRow ligneTitreSemaine(Context c, Ui ui, String semaine) {
        TableRow r = new TableRow(c);
        TextView t = cellule(c, ui, "Semaine " + (semaine != null ? semaine : "?"), true, 0xFF0D47A1, Gravity.START);
        t.setTextSize(14);
        t.setPadding(ui.dp(5), ui.dp(10), ui.dp(5), ui.dp(4));
        TableRow.LayoutParams lp = new TableRow.LayoutParams();
        lp.span = TITRES.length;
        r.addView(t, lp);
        return r;
    }

    /** Totaux d'un groupe de lignes (une semaine, ou tout l'onglet). */
    private static final class Totaux {
        double prevues;
        double bkp;
        boolean prevuesConnues = true;
        boolean bkpConnus = true;
        boolean auMoinsUnBkp;
        int anomalies;
        int ecarts;

        void ajouter(Ligne l) {
            if (l.prevues == null || l.prevues.isNaN()) prevuesConnues = false;
            else prevues += l.prevues;
            if (l.paire.bkp != null) {
                auMoinsUnBkp = true;
                if (l.bkp == null) bkpConnus = false;
                else bkp += l.bkp;
            }
            if (l.paire.rapport != null) anomalies += l.paire.rapport.nbAnomalies;
            if (l.paire.ecartsScies != null) ecarts += l.paire.ecartsScies.size();
        }
    }

    private static TableRow ligneTotal(Context c, Ui ui, String libelle, Totaux t) {
        TableRow r = new TableRow(c);
        r.setBackgroundColor(0xFFECEFF1);
        r.addView(cellule(c, ui, libelle, true, 0xFF263238, Gravity.START));
        r.addView(cellule(c, ui, t.prevuesConnues ? Js.nombre(t.prevues) : "…", true, 0xFF263238, Gravity.END));
        r.addView(cellule(c, ui, !t.auMoinsUnBkp ? "—" : t.bkpConnus ? Js.nombre(t.bkp) : "…", true, 0xFF263238, Gravity.END));
        r.addView(cellule(c, ui, t.anomalies > 0 ? "⚠ " + t.anomalies : "", true, ui.couleur(R.color.alerte_texte), Gravity.CENTER_HORIZONTAL));
        r.addView(cellule(c, ui, t.ecarts > 0 ? "⚠ " + t.ecarts : "", true, ui.couleur(R.color.alerte_texte), Gravity.CENTER_HORIZONTAL));
        return r;
    }

    static View tableau(Context c, Ui ui, List<Ligne> lignes, SurClic surClic) {
        LinearLayout bloc = ui.colonne();
        if (lignes.isEmpty()) {
            bloc.addView(ui.texte("Aucun lancement.", 14, false, ui.couleur(R.color.gris_texte)));
            return bloc;
        }
        TableLayout table = new TableLayout(c);
        table.setColumnShrinkable(0, true);
        table.setColumnStretchable(0, true);

        TableRow entete = new TableRow(c);
        entete.setBackgroundColor(0xFFE3F2FD);
        for (int i = 0; i < TITRES.length; i++) {
            entete.addView(cellule(c, ui, TITRES[i], true, 0xFF0D47A1,
                    i == 1 || i == 2 ? Gravity.END : i >= 3 ? Gravity.CENTER_HORIZONTAL : Gravity.START));
        }
        table.addView(entete);

        // Sous-titres et sous-totaux par semaine seulement si l'onglet en mélange plusieurs.
        java.util.Set<String> semaines = new java.util.HashSet<>();
        for (Ligne l : lignes) semaines.add(l.semaine);
        boolean plusieurs = semaines.size() > 1;
        Totaux general = new Totaux();
        int i = 0;
        while (i < lignes.size()) {
            String semaine = lignes.get(i).semaine;
            if (plusieurs) table.addView(ligneTitreSemaine(c, ui, semaine));
            Totaux totalSemaine = new Totaux();
            int n = 0;
            for (; i < lignes.size() && java.util.Objects.equals(lignes.get(i).semaine, semaine); i++) {
                Ligne l = lignes.get(i);
                Paire p = l.paire;
                totalSemaine.ajouter(l);
                general.ajouter(l);
                TableRow ligne = new TableRow(c);
                ligne.setBackgroundColor(n++ % 2 == 0 ? 0xFFFFFFFF : 0xFFF5F7FA);
                ligne.setClickable(true);
                ligne.setOnClickListener(v -> surClic.ouvrir(p));

                SpannableStringBuilder nom = new SpannableStringBuilder(l.nom);
                nom.setSpan(new StyleSpan(Typeface.BOLD), 0, nom.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                int debut = nom.length();
                nom.append('\n').append(l.lancement);
                nom.setSpan(new ForegroundColorSpan(0xFF78909C), debut, nom.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                nom.setSpan(new RelativeSizeSpan(0.85f), debut, nom.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                ligne.addView(cellule(c, ui, nom, false, 0xFF263238, Gravity.START));

                ligne.addView(cellule(c, ui, nombre(l.prevues), false, 0xFF263238, Gravity.END));
                ligne.addView(p.bkp == null
                        ? cellule(c, ui, "—", false, 0xFF9AA5B1, Gravity.END)
                        : cellule(c, ui, nombre(l.bkp), false, 0xFF263238, Gravity.END));

                if (p.enCours) {
                    ligne.addView(cellule(c, ui, "⏳", false, ui.couleur(R.color.gris_texte), Gravity.CENTER_HORIZONTAL));
                } else if (p.rapport == null) {
                    ligne.addView(cellule(c, ui, "—", false, 0xFF9AA5B1, Gravity.CENTER_HORIZONTAL));
                } else if (p.rapport.nbAnomalies == 0) {
                    ligne.addView(cellule(c, ui, "✔ OK", true, ui.couleur(R.color.ok_texte), Gravity.CENTER_HORIZONTAL));
                } else {
                    ligne.addView(cellule(c, ui, "⚠ " + p.rapport.nbAnomalies, true, ui.couleur(R.color.alerte_texte),
                            Gravity.CENTER_HORIZONTAL));
                }

                if (p.erreurScies != null) {
                    ligne.addView(cellule(c, ui, "❌", true, ui.couleur(R.color.alerte_texte), Gravity.CENTER_HORIZONTAL));
                } else if (p.ecartsScies == null) {
                    ligne.addView(cellule(c, ui, "—", false, 0xFF9AA5B1, Gravity.CENTER_HORIZONTAL));
                } else if (p.ecartsScies.isEmpty()) {
                    ligne.addView(cellule(c, ui, "✔ OK", true, ui.couleur(R.color.ok_texte), Gravity.CENTER_HORIZONTAL));
                } else {
                    ligne.addView(cellule(c, ui, "⚠ " + p.ecartsScies.size(), true, ui.couleur(R.color.alerte_texte),
                            Gravity.CENTER_HORIZONTAL));
                }
                table.addView(ligne);
            }
            if (plusieurs) table.addView(ligneTotal(c, ui, "Total sem. " + (semaine != null ? semaine : "?"), totalSemaine));
        }
        table.addView(ligneTotal(c, ui, "Total", general));

        bloc.addView(table, ui.pleineLargeur());
        return bloc;
    }
}
