package com.marinedouyere.sentinelle;

import com.marinedouyere.sentinelle.moteur.Js;
import com.marinedouyere.sentinelle.moteur.LecteurStrat;

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
        final List<Trouvee> dejaLancees = new ArrayList<>();
        int nbAutres;
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
        for (LecteurStrat.LigneStrat l : lignes) {
            String origine = null;
            for (Paire p : autreSemaine) {
                if (p.strat != null && controles.resume(p.strat, p.bkp).cles.contains(l.cle)) {
                    origine = p.strat.nom;
                    break;
                }
            }
            if (origine == null) {
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
        if (l.longueurFinie != null && l.largeurFinie != null) morceaux.add(Js.dimension(l.longueurFinie) + " × " + Js.dimension(l.largeurFinie));
        String coloris = l.toutesDonnees == null ? null : l.toutesDonnees.get("coloris");
        if (coloris != null && !coloris.isEmpty()) morceaux.add("coloris " + coloris);
        return String.join(separateur, morceaux);
    }
}
