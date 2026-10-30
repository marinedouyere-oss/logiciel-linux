package com.marinedouyere.sentinelle;

import com.marinedouyere.sentinelle.moteur.Js;
import com.marinedouyere.sentinelle.moteur.LecteurStrat;
import com.marinedouyere.sentinelle.moteur.RapportsSommaire;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Casse : les pièces qui étaient déjà lancées la semaine d'avant, retrouvées
 * dans les fichiers de lancement Excel de cette semaine-là (l'autre onglet).
 */
final class ControleCasse {

    private ControleCasse() {}

    static final class Trouvee {
        LecteurStrat.LigneStrat ligne;
        String lancement;
    }

    static final class Resultat {
        /** Fichier de casse et fichiers comparés : le résultat est à refaire s'ils changent. */
        String cle;
        String semaineAvant;
        /** Semaine chargée dans l'autre onglet (null si c'est la bonne). */
        String autreSemaineChargee;
        int nbPieces;
        /** Pièces relancées : déjà lancées la semaine d'avant. */
        final List<Trouvee> dejaLancees = new ArrayList<>();
        /** Rajouts : pièces qui n'étaient pas lancées la semaine d'avant. */
        final List<LecteurStrat.LigneStrat> rajouts = new ArrayList<>();
        int nbAutres;
        /** Lancements de la semaine d'avant comparés. */
        final List<String> lancements = new ArrayList<>();
        String erreur;
    }

    /** Semaine d'avant celle où la casse est fabriquée (la casse 44 se fabrique en 45 : semaine d'avant 44). */
    static String semaineAvant(Paire casse) {
        if (casse.semaine == null) return null;
        try {
            int n = Integer.parseInt(casse.semaine.trim());
            return String.format(Locale.ROOT, "%02d", n <= 1 ? 52 : n - 1);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    static String cle(Paire casse, List<Paire> autreSemaine, int numeroAutre) {
        StringBuilder sb = new StringBuilder(casse.strat.chemin).append('|').append(casse.semaine).append('|').append(numeroAutre);
        for (Paire p : autreSemaine) if (p.strat != null) sb.append('|').append(p.strat.chemin);
        return sb.toString();
    }

    /** Hors du fil d'affichage. */
    static Resultat calculer(Paire casse, List<Paire> autreSemaine, int numeroAutre, Controles controles) {
        Resultat r = new Resultat();
        r.cle = cle(casse, autreSemaine, numeroAutre);
        r.semaineAvant = semaineAvant(casse);
        String autre = String.format(Locale.ROOT, "%02d", numeroAutre);
        if (r.semaineAvant == null || !r.semaineAvant.equals(autre)) {
            r.autreSemaineChargee = autre;
            return r;
        }
        List<LecteurStrat.LigneStrat> lignes;
        try {
            lignes = controles.lireStrat(casse).lignes;
        } catch (Exception e) {
            r.erreur = e.getMessage() != null ? e.getMessage() : e.toString();
            return r;
        }
        r.nbPieces = lignes.size();
        for (Paire p : autreSemaine) if (p.strat != null) r.lancements.add(p.strat.nom);
        for (LecteurStrat.LigneStrat l : lignes) {
            String origine = null;
            for (Paire p : autreSemaine) {
                if (p.strat != null && controles.resume(p.strat, p.bkp).cles.contains(l.cle)) {
                    origine = p.strat.nom;
                    break;
                }
            }
            if (origine == null) {
                r.rajouts.add(l);
                r.nbAutres++;
                continue;
            }
            Trouvee t = new Trouvee();
            t.ligne = l;
            t.lancement = origine;
            r.dejaLancees.add(t);
        }
        return r;
    }

    /** « CVC26100337006 · CRED14 · 955 × 270 · coloris 975 » */
    static String description(LecteurStrat.LigneStrat l, String separateur) {
        List<String> morceaux = new ArrayList<>();
        morceaux.add(l.cle);
        if (l.article != null && !l.article.isEmpty()) morceaux.add(l.article);
        String dimensions = dimensions(l);
        if (!dimensions.isEmpty()) morceaux.add(dimensions);
        String coloris = coloris(l);
        if (!coloris.isEmpty()) morceaux.add("coloris " + coloris);
        return String.join(separateur, morceaux);
    }

    private static String dimensions(LecteurStrat.LigneStrat l) {
        return l.longueurFinie != null && l.largeurFinie != null ? Js.dimension(l.longueurFinie) + " × " + Js.dimension(l.largeurFinie) : "";
    }

    private static String article(LecteurStrat.LigneStrat l) {
        return l.article == null ? "" : l.article;
    }

    private static String coloris(LecteurStrat.LigneStrat l) {
        String coloris = l.toutesDonnees == null ? null : l.toutesDonnees.get("coloris");
        return coloris == null ? "" : coloris;
    }

    /** Pages du rapport du lancement : pièces relancées, puis rajouts. */
    static List<RapportsSommaire.Partie> parties(Resultat r, String base) {
        List<RapportsSommaire.Partie> parties = new ArrayList<>();
        RapportsSommaire.Partie relancees = RapportsSommaire.partie("Relancées", base + " — Casse : pièces relancées",
                new String[] {"Commande + ligne", "Article", "Dimensions", "Coloris", "Lancée dans", "Qté"}, new double[] {34, 34, 26, 18, 58, 12}, 5);
        relancees.total = false;
        parties.add(relancees);
        if (r.erreur != null) {
            relancees.statut = "Casse illisible : " + r.erreur;
            relancees.couleurStatut = RapportsSommaire.STATUT_ALERTE;
            return parties;
        }
        if (r.autreSemaineChargee != null) {
            relancees.statut = "Chargez la semaine " + (r.semaineAvant == null ? "d'avant" : r.semaineAvant)
                    + " dans l'autre onglet pour séparer les pièces relancées et les rajouts";
            relancees.couleurStatut = RapportsSommaire.STATUT_ATTENTION;
            return parties;
        }
        if (r.dejaLancees.isEmpty()) {
            relancees.statut = "Aucune pièce de la casse n'était lancée en semaine " + r.semaineAvant;
            relancees.couleurStatut = RapportsSommaire.STATUT_OK;
        } else {
            relancees.statut = r.dejaLancees.size() + " pièce(s) relancée(s) : déjà lancée(s) en semaine " + r.semaineAvant;
            relancees.couleurStatut = RapportsSommaire.STATUT_ATTENTION;
        }
        for (Trouvee t : r.dejaLancees) {
            LecteurStrat.LigneStrat l = t.ligne;
            relancees.rangees.add(new String[] {l.cle, article(l), dimensions(l), coloris(l), t.lancement, Js.nombre(l.pieces)});
        }
        if (!r.lancements.isEmpty()) relancees.notes.add(new String[] {"Comparé à : ", String.join(", ", r.lancements)});

        RapportsSommaire.Partie rajouts = RapportsSommaire.partie("Rajouts", base + " — Casse : rajouts",
                new String[] {"Commande + ligne", "Article", "Dimensions", "Coloris", "Qté"}, new double[] {40, 52, 36, 36, 18}, 4);
        rajouts.total = false;
        rajouts.statut = r.rajouts.isEmpty() ? "Aucun rajout : toutes les pièces étaient lancées en semaine " + r.semaineAvant
                : r.rajouts.size() + " rajout(s) : pièce(s) pas lancée(s) en semaine " + r.semaineAvant;
        for (LecteurStrat.LigneStrat l : r.rajouts) rajouts.rangees.add(new String[] {l.cle, article(l), dimensions(l), coloris(l), Js.nombre(l.pieces)});
        parties.add(rajouts);
        return parties;
    }
}
