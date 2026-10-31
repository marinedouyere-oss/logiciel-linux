package com.marinedouyere.sentinelle;

import com.marinedouyere.sentinelle.moteur.Js;
import com.marinedouyere.sentinelle.moteur.LecteurStrat;
import com.marinedouyere.sentinelle.moteur.RapportsSommaire;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Casse : les pièces qui étaient déjà lancées une semaine d'avant, retrouvées dans les fichiers de
 * lancement de l'autre onglet (la semaine d'avant) et dans le fichier partagé écrit par Sentinelle sur le PC
 * (toutes les semaines gardées), comme la page web.
 */
final class ControleCasse {

    private ControleCasse() {}

    static final class Trouvee {
        LecteurStrat.LigneStrat ligne;
        String lancement;
        /** Semaine où elle était lancée (« 44 »). */
        String semaine;
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
        /** Lancements de la semaine d'avant comparés (et la bibliothèque du fichier partagé). */
        final List<String> lancements = new ArrayList<>();
        /** Semaines où l'on a cherché : « en semaine 44 », « en semaines 44 et 45 », « dans les semaines 40 à 45 ». */
        String periode = "";
        String erreur;

        /** « en semaine 44 », « en semaines 43 et 44 » : où étaient les pièces relancées. */
        String ouDejaLancees() {
            java.util.TreeSet<String> u = new java.util.TreeSet<>();
            for (Trouvee t : dejaLancees) u.add(t.semaine);
            return libelleSemaines(new ArrayList<>(u));
        }
    }

    static String libelleSemaines(List<String> semaines) {
        if (semaines.isEmpty()) return "en semaine ?";
        if (semaines.size() == 1) return "en semaine " + semaines.get(0);
        return "en semaines " + String.join(", ", semaines.subList(0, semaines.size() - 1)) + " et " + semaines.get(semaines.size() - 1);
    }

    static String periode(List<String> semaines) {
        if (semaines.size() <= 2) return libelleSemaines(semaines);
        return "dans les semaines " + semaines.get(0) + " à " + semaines.get(semaines.size() - 1);
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

    static String cle(Paire casse, List<Paire> autreSemaine, int numeroAutre, FichierPartage biblio) {
        StringBuilder sb = new StringBuilder(casse.strat.chemin).append('|').append(casse.semaine).append('|').append(numeroAutre)
                .append('|').append(System.identityHashCode(biblio));
        for (Paire p : autreSemaine) if (p.strat != null) sb.append('|').append(p.strat.chemin);
        return sb.toString();
    }

    /** Rang de la semaine de fabrication de la casse (année × 100 + semaine), -1 si inconnu. */
    static int rangFabrication(Paire casse, List<LecteurStrat.LigneStrat> lignes) {
        int fabrication;
        try {
            fabrication = Integer.parseInt(casse.semaine == null ? "" : casse.semaine.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
        // Année et semaine du code de la colonne lancement (« LAN264508 » : 2026, semaine 45).
        for (LecteurStrat.LigneStrat l : lignes) {
            String chiffres = l.lancement == null ? "" : l.lancement.replaceAll("\\D", "");
            if (chiffres.length() < 4) continue;
            int annee = 2000 + Integer.parseInt(chiffres.substring(0, 2));
            String s = LecteurStrat.extraireSemaine(l.lancement);
            int code = s == null ? fabrication : Integer.parseInt(s);
            return (annee + (fabrication < code ? 1 : 0)) * 100 + fabrication;
        }
        return -1;
    }

    /** Hors du fil d'affichage. biblio : le fichier partagé (null s'il n'est pas branché). */
    static Resultat calculer(Paire casse, List<Paire> autreSemaine, int numeroAutre, Controles controles, FichierPartage biblio) {
        Resultat r = new Resultat();
        r.cle = cle(casse, autreSemaine, numeroAutre, biblio);
        r.semaineAvant = semaineAvant(casse);
        String autre = String.format(Locale.ROOT, "%02d", numeroAutre);
        boolean autreChargee = false;
        for (Paire p : autreSemaine) autreChargee |= p.strat != null;
        boolean autreUtile = r.semaineAvant != null && r.semaineAvant.equals(autre) && autreChargee;
        List<LecteurStrat.LigneStrat> lignes;
        try {
            lignes = controles.lireStrat(casse).lignes;
        } catch (Exception e) {
            r.erreur = e.getMessage() != null ? e.getMessage() : e.toString();
            return r;
        }
        int avant = rangFabrication(casse, lignes);
        List<String> connues = biblio != null && avant > 0 ? biblio.semainesAvant(avant) : new ArrayList<>();
        // Ni la semaine d'avant dans l'autre onglet, ni de semaine d'avant dans le fichier partagé : impossible de séparer.
        if (!autreUtile && connues.isEmpty()) {
            r.autreSemaineChargee = autre;
            return r;
        }
        java.util.TreeSet<String> cherchees = new java.util.TreeSet<>(connues);
        if (autreUtile) cherchees.add(r.semaineAvant);
        r.periode = periode(new ArrayList<>(cherchees));
        r.nbPieces = lignes.size();
        if (autreUtile) for (Paire p : autreSemaine) if (p.strat != null) r.lancements.add(p.strat.nom);
        if (!connues.isEmpty())
            r.lancements.add("fichier partagé (" + (connues.size() == 1 ? "semaine " + connues.get(0) : "semaines " + connues.get(0) + " à " + connues.get(connues.size() - 1)) + ")");
        for (LecteurStrat.LigneStrat l : lignes) {
            Trouvee t = null;
            if (autreUtile)
                for (Paire p : autreSemaine) {
                    if (p.strat != null && controles.resume(p.strat, p.bkp).cles.contains(l.cle)) {
                        t = new Trouvee();
                        t.lancement = p.strat.nom;
                        t.semaine = r.semaineAvant;
                        break;
                    }
                }
            if (t == null && biblio != null && avant > 0) {
                FichierPartage.Vu vu = biblio.derniereFoisLancee(l.cle, avant);
                if (vu != null) {
                    t = new Trouvee();
                    t.lancement = vu.lancement;
                    t.semaine = String.format(Locale.ROOT, "%02d", vu.semaine);
                }
            }
            if (t == null) {
                r.rajouts.add(l);
                r.nbAutres++;
                continue;
            }
            t.ligne = l;
            r.dejaLancees.add(t);
        }
        return r;
    }

    /** Ce qu'il manque pour compter les pièces déjà lancées. */
    static String messageCharger(Resultat r) {
        return "chargez la semaine " + (r.semaineAvant == null ? "d'avant" : r.semaineAvant)
                + " dans l'autre onglet, ou branchez l'appli sur le fichier partagé (onglet Partagé)";
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
            relancees.statut = "Pour séparer les pièces relancées et les rajouts, " + messageCharger(r);
            relancees.couleurStatut = RapportsSommaire.STATUT_ATTENTION;
            return parties;
        }
        if (r.dejaLancees.isEmpty()) {
            relancees.statut = "Aucune pièce de la casse n'était lancée " + r.periode;
            relancees.couleurStatut = RapportsSommaire.STATUT_OK;
        } else {
            relancees.statut = r.dejaLancees.size() + " pièce(s) relancée(s) : déjà lancée(s) " + r.ouDejaLancees();
            relancees.couleurStatut = RapportsSommaire.STATUT_ATTENTION;
        }
        for (Trouvee t : r.dejaLancees) {
            LecteurStrat.LigneStrat l = t.ligne;
            relancees.rangees.add(new String[] {l.cle, article(l), dimensions(l), coloris(l), t.lancement + " (sem. " + t.semaine + ")", Js.nombre(l.pieces)});
        }
        if (!r.lancements.isEmpty()) relancees.notes.add(new String[] {"Comparé à : ", String.join(", ", r.lancements)});

        RapportsSommaire.Partie rajouts = RapportsSommaire.partie("Rajouts", base + " — Casse : rajouts",
                new String[] {"Commande + ligne", "Article", "Dimensions", "Coloris", "Qté"}, new double[] {40, 52, 36, 36, 18}, 4);
        rajouts.total = false;
        rajouts.statut = r.rajouts.isEmpty() ? "Aucun rajout : toutes les pièces étaient déjà lancées " + r.periode
                : r.rajouts.size() + " rajout(s) : pièce(s) pas lancée(s) " + r.periode;
        for (LecteurStrat.LigneStrat l : r.rajouts) rajouts.rangees.add(new String[] {l.cle, article(l), dimensions(l), coloris(l), Js.nombre(l.pieces)});
        parties.add(rajouts);
        return parties;
    }
}
