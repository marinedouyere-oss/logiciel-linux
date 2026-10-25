package com.marinedouyere.sentinelle.moteur;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Pièces présentes dans plusieurs fichiers de lancement d'une même semaine
 * (ex. une pièce à la fois dans le 1er et le 2e tour, ou dans le recyclage
 * et un tour) : elle risque d'être fabriquée deux fois.
 */
public final class DoublonsEntreLancements {

    private DoublonsEntreLancements() {}

    /** Des pièces communes à un même ensemble de lancements. */
    public static final class Groupe {
        public final List<String> lancements;
        public final List<String> cles = new ArrayList<>();

        Groupe(List<String> lancements) {
            this.lancements = lancements;
        }
    }

    /** Une clé valable : une commande suivie de son numéro de ligne (pas « 000 » d'une ligne sans commande). */
    private static boolean cleValable(String cle) {
        return cle != null && cle.length() > 3 && cle.substring(0, cle.length() - 3).matches(".*[A-Za-z].*");
    }

    /**
     * {@code clesParLancement} : pour chaque lancement (nom affiché), les clés
     * de ses pièces (hors protections). Renvoie les groupes de lancements qui
     * partagent des pièces, dans l'ordre des lancements.
     */
    public static List<Groupe> trouver(Map<String, ? extends Collection<String>> clesParLancement) {
        Map<String, List<String>> lancementsParCle = new LinkedHashMap<>();
        for (Map.Entry<String, ? extends Collection<String>> e : clesParLancement.entrySet()) {
            for (String cle : e.getValue()) {
                if (!cleValable(cle)) continue;
                List<String> l = lancementsParCle.get(cle);
                if (l == null) {
                    l = new ArrayList<>();
                    lancementsParCle.put(cle, l);
                }
                if (!l.contains(e.getKey())) l.add(e.getKey());
            }
        }
        Map<List<String>, Groupe> groupes = new LinkedHashMap<>();
        for (Map.Entry<String, List<String>> e : lancementsParCle.entrySet()) {
            if (e.getValue().size() < 2) continue;
            Groupe g = groupes.get(e.getValue());
            if (g == null) {
                g = new Groupe(e.getValue());
                groupes.put(e.getValue(), g);
            }
            g.cles.add(e.getKey());
        }
        return new ArrayList<>(groupes.values());
    }
}
