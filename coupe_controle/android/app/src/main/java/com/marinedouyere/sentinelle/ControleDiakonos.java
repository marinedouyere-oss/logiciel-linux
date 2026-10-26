package com.marinedouyere.sentinelle;

import com.marinedouyere.sentinelle.moteur.LecteurDiakonos;
import com.marinedouyere.sentinelle.moteur.RapportsSommaire;
import com.marinedouyere.sentinelle.moteur.ScanDossier;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Contrôle Diakonos d'un tour : chaque pièce commandée (fichier Diakonos)
 * doit se trouver dans un lancement de la même semaine et du même tour
 * (STRAT, Feno, recyclage, chantiers…).
 */
final class ControleDiakonos {

    private ControleDiakonos() {}

    static final class Resultat {
        String fichier;
        String semaine;
        String tour;
        int nbPieces;
        /** Fichiers de lancement comparés. */
        final List<String> lancements = new ArrayList<>();
        final List<LecteurDiakonos.Piece> manquantes = new ArrayList<>();
        /** Pièce manquante retrouvée dans un autre lancement (autre tour, autre semaine) : nom du fichier. */
        final Map<String, String> ailleurs = new HashMap<>();
        String erreur;
    }

    static String tour(Paire diakonos) {
        return Depot.POSTES_DIAKONOS.get(1).equals(diakonos.poste) ? "2" : "1";
    }

    /** Case Agglo du même tour, où le contrôle Diakonos est affiché. */
    static String posteAgglo(Paire diakonos) {
        return "2".equals(tour(diakonos)) ? "Agglo 2ème tour" : "Agglo 1er tour";
    }

    /** Tour du Diakonos rattaché à une case (« 1 », « 2 »), null si la case n'en a pas. */
    static String tourDeLaCase(Paire p) {
        if ("Agglo 1er tour".equals(p.poste)) return "1";
        if ("Agglo 2ème tour".equals(p.poste)) return "2";
        return null;
    }

    static String libelleTour(String tour) {
        return "2".equals(tour) ? "2ème tour" : "1er tour";
    }

    /** Hors du fil d'affichage : lit les fichiers (résumés mis en cache). */
    static Resultat calculer(Paire diakonos, String semaineOnglet, List<Paire> semaine, List<Paire> toutes, Controles controles) {
        Resultat r = new Resultat();
        r.fichier = diakonos.strat.nom;
        r.semaine = diakonos.semaine != null ? diakonos.semaine : semaineOnglet;
        r.tour = tour(diakonos);
        List<LecteurDiakonos.Piece> pieces;
        try {
            pieces = controles.diakonos(diakonos.strat);
        } catch (Exception e) {
            r.erreur = e.getMessage() != null ? e.getMessage() : e.toString();
            return r;
        }
        r.nbPieces = pieces.size();
        Set<String> lancees = new HashSet<>();
        for (Paire p : semaine) {
            if (p.strat == null) continue;
            Controles.Resume res = controles.resume(p.strat, p.bkp);
            if (!duTour(p, res, r.semaine, r.tour)) continue;
            lancees.addAll(res.cles);
            r.lancements.add(p.strat.nom);
        }
        r.manquantes.addAll(LecteurDiakonos.manquantes(pieces, lancees));
        for (LecteurDiakonos.Piece m : r.manquantes) {
            for (Paire p : toutes) {
                if (p.strat != null && controles.resume(p.strat, p.bkp).cles.contains(m.cle)) {
                    r.ailleurs.put(m.cle, p.strat.nom);
                    break;
                }
            }
        }
        return r;
    }

    /** Page Diakonos du rapport du lancement. */
    static RapportsSommaire.Partie partie(Resultat r, String base) {
        String tour = libelleTour(r.tour);
        RapportsSommaire.Partie p = RapportsSommaire.partie("Diakonos", base + " — Diakonos " + tour,
                new String[] {"Commande + ligne", "Article", "Dimensions", "Coloris", "Lancée ailleurs"}, new double[] {36, 34, 28, 20, 64}, 5);
        p.total = false;
        if (r.erreur != null) {
            p.statut = "Diakonos illisible : " + r.erreur;
            p.couleurStatut = 0xC62828;
        } else if (r.lancements.isEmpty()) {
            p.statut = "Aucun lancement du " + tour + " (semaine " + r.semaine + ") chargé";
            p.couleurStatut = 0xE65100;
        } else if (r.manquantes.isEmpty()) {
            p.statut = "Les " + r.nbPieces + " pièces Diakonos sont dans les lancements du " + tour;
            p.couleurStatut = 0x2E7D32;
        } else {
            p.statut = r.manquantes.size() + " pièce(s) Diakonos absente(s) des lancements du " + tour;
            p.couleurStatut = 0xC62828;
        }
        for (LecteurDiakonos.Piece m : r.manquantes) {
            String ailleurs = r.ailleurs.get(m.cle);
            p.rangees.add(new String[] {m.cle, m.article, m.dimensions(), m.coloris, ailleurs == null ? "" : ailleurs});
        }
        p.notes.add(new String[] {"Fichier Diakonos : ", r.fichier});
        if (!r.lancements.isEmpty()) p.notes.add(new String[] {"Comparé à : ", String.join(", ", r.lancements)});
        return p;
    }

    /** Lancement de la semaine et du tour (un code sans tour, ex. LAN2646TRIGANO, vaut pour les deux tours). */
    static boolean duTour(Paire p, Controles.Resume res, String semaine, String tour) {
        Set<String> codes = new LinkedHashSet<>(res.lancements);
        if (codes.isEmpty()) {
            String code = ScanDossier.trouverCodeLancement(p.strat.nom);
            if (code != null) codes.add(code);
        }
        for (String code : codes) {
            String[] st = LecteurDiakonos.semaineEtTour(code);
            if (st == null || !st[0].equals(semaine)) continue;
            if (st[1] == null || st[1].equals(tour)) return true;
        }
        return false;
    }
}
