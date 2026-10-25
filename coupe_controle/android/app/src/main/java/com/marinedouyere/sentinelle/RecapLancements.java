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

import com.marinedouyere.sentinelle.moteur.DoublonsEntreLancements;
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
        /** Clés des pièces du lancement (null : en cours de lecture). */
        java.util.Set<String> cles;
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
            Controles.Resume r = controles.resumeEnCache(p.strat, p.bkp);
            if (r != null) {
                l.prevues = r.prevues;
                l.bkp = r.bkp;
                l.cles = r.cles;
            }
            lignes.add(l);
        }
        Collections.sort(lignes, (a, b) -> Integer.compare(semaine(a), semaine(b)));
        return lignes;
    }

    /** Vrai s'il reste des totaux à calculer (lecture des fichiers). */
    static boolean incomplet(List<Ligne> lignes) {
        for (Ligne l : lignes) if (l.cles == null) return true;
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

    private static final String[] TITRES = {"Poste", "Prévues", ".bkp", "Contrôle", "Scies", "Couleurs"};

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
        int couleurs;

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
            if (l.paire.couleurs != null) couleurs += l.paire.couleurs.absentes.size();
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
        r.addView(cellule(c, ui, t.couleurs > 0 ? "⚠ " + t.couleurs : "", true, ui.couleur(R.color.alerte_texte), Gravity.CENTER_HORIZONTAL));
        return r;
    }

    static View tableau(Context c, Ui ui, List<Ligne> lignes, List<Ligne> autreSemaine, String libelleAutre, SurClic surClic) {
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

                if (p.couleurs == null || p.couleurs.sansStratifie) {
                    ligne.addView(cellule(c, ui, "—", false, 0xFF9AA5B1, Gravity.CENTER_HORIZONTAL));
                } else if (p.couleurs.absentes.isEmpty()) {
                    ligne.addView(cellule(c, ui, "✔ OK", true, ui.couleur(R.color.ok_texte), Gravity.CENTER_HORIZONTAL));
                } else {
                    ligne.addView(cellule(c, ui, "⚠ " + p.couleurs.absentes.size(), true, ui.couleur(R.color.alerte_texte),
                            Gravity.CENTER_HORIZONTAL));
                }
                table.addView(ligne);
            }
            if (plusieurs) table.addView(ligneTotal(c, ui, "Total sem. " + (semaine != null ? semaine : "?"), totalSemaine));
        }
        table.addView(ligneTotal(c, ui, "Total", general));

        bloc.addView(table, ui.pleineLargeur());
        View doublons = doublons(c, ui, lignes, surClic);
        if (doublons != null) bloc.addView(doublons, ui.marges(8, 0));
        View dejaLancees = dejaLancees(c, ui, lignes, autreSemaine, libelleAutre, surClic);
        if (dejaLancees != null) bloc.addView(dejaLancees, ui.marges(8, 0));
        View livraison = autresSemainesDeLivraison(c, ui, lignes, surClic);
        if (livraison != null) bloc.addView(livraison, ui.marges(8, 0));
        return bloc;
    }

    private static String nomLancement(Ligne l) {
        return l.nom + " (" + l.lancement + ")";
    }

    private static String listeCles(List<String> cles) {
        int n = cles.size();
        if (n <= 3) return String.join(", ", cles);
        return n + " pièces (" + String.join(", ", cles.subList(0, 3)) + "…)";
    }

    private static TextView ligneAlerte(Ui ui, CharSequence texte, Paire p, SurClic surClic) {
        TextView t = ui.texte(texte, 13, false, 0xFF3E4C59);
        t.setPadding(0, ui.dp(3), 0, 0);
        if (p != null) t.setOnClickListener(v -> surClic.ouvrir(p));
        return t;
    }

    /** Pièces déjà présentes dans un lancement de l'autre onglet semaine (relancées, ou lancées en double). */
    private static View dejaLancees(Context c, Ui ui, List<Ligne> lignes, List<Ligne> autres, String libelleAutre, SurClic surClic) {
        LinearLayout bloc = null;
        for (Ligne l : lignes) {
            if (l.cles == null) return null;
            for (Ligne o : autres) {
                if (o.cles == null) return null;
                List<String> communes = new ArrayList<>();
                for (String cle : l.cles) if (o.cles.contains(cle) && cle.length() > 3) communes.add(cle);
                if (communes.isEmpty()) continue;
                Collections.sort(communes);
                if (bloc == null) {
                    bloc = ui.colonne();
                    bloc.addView(ui.texte("⚠ Pièces déjà lancées en " + libelleAutre, 14, true, ui.couleur(R.color.alerte_texte)));
                }
                bloc.addView(ligneAlerte(ui, listeCles(communes) + " — " + nomLancement(l) + " et " + nomLancement(o), l.paire, surClic));
            }
        }
        return bloc;
    }

    /** Pièces à livrer une autre semaine que le reste de leur lancement (hors casse, qui en reprend toujours). */
    private static View autresSemainesDeLivraison(Context c, Ui ui, List<Ligne> lignes, SurClic surClic) {
        LinearLayout bloc = null;
        for (Ligne l : lignes) {
            Paire p = l.paire;
            if (p.semainesLivraison.size() <= 1 || "Casse".equals(p.poste)) continue;
            com.marinedouyere.sentinelle.moteur.LecteurStrat.SemaineLivraison principale = p.semainesLivraison.get(0);
            for (com.marinedouyere.sentinelle.moteur.LecteurStrat.SemaineLivraison s : p.semainesLivraison) {
                if (s.nbPieces > principale.nbPieces) principale = s;
            }
            for (com.marinedouyere.sentinelle.moteur.LecteurStrat.SemaineLivraison s : p.semainesLivraison) {
                if (s == principale) continue;
                if (bloc == null) {
                    bloc = ui.colonne();
                    bloc.addView(ui.texte("⚠ Pièces d'une autre semaine de livraison", 14, true, ui.couleur(R.color.attention_texte)));
                }
                bloc.addView(ligneAlerte(ui, listeCles(s.cles) + " à livrer semaine " + s.semaine + " — " + nomLancement(l), p, surClic));
            }
        }
        return bloc;
    }

    /** Pièces présentes dans plusieurs lancements de l'onglet : risque de les fabriquer deux fois. */
    private static View doublons(Context c, Ui ui, List<Ligne> lignes, SurClic surClic) {
        java.util.Map<String, java.util.Set<String>> clesParLancement = new java.util.LinkedHashMap<>();
        java.util.Map<String, Paire> paireParNom = new java.util.HashMap<>();
        for (Ligne l : lignes) {
            if (l.cles == null) return null;
            String nom = l.nom + " (" + l.lancement + ")";
            clesParLancement.put(nom, l.cles);
            paireParNom.put(nom, l.paire);
        }
        List<DoublonsEntreLancements.Groupe> groupes = DoublonsEntreLancements.trouver(clesParLancement);
        if (groupes.isEmpty()) return null;
        LinearLayout bloc = ui.colonne();
        bloc.addView(ui.texte("⚠ Pièces lancées deux fois", 14, true, ui.couleur(R.color.alerte_texte)));
        for (DoublonsEntreLancements.Groupe g : groupes) {
            StringBuilder sb = new StringBuilder();
            int n = g.cles.size();
            if (n <= 3) sb.append(String.join(", ", g.cles));
            else sb.append(n).append(" pièces (").append(String.join(", ", g.cles.subList(0, 3))).append("…)");
            sb.append(" — ").append(String.join(" + ", g.lancements));
            TextView t = ui.texte(sb, 13, false, 0xFF3E4C59);
            t.setPadding(0, ui.dp(3), 0, 0);
            Paire p = paireParNom.get(g.lancements.get(0));
            if (p != null) t.setOnClickListener(v -> surClic.ouvrir(p));
            bloc.addView(t);
        }
        return bloc;
    }
}
