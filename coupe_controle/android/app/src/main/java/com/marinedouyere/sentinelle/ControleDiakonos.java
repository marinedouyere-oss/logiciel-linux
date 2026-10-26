package com.marinedouyere.sentinelle;

import com.marinedouyere.sentinelle.moteur.LecteurDiakonos;
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
