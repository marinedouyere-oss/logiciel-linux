package com.marinedouyere.sentinelle.moteur;

import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Vrai numéro de semaine affiché pour un onglet (au lieu de « Semaine
 * paire » / « Semaine impaire ») : celui des lancements chargés dans
 * l'onglet, sinon la semaine en cours ou la suivante selon la parité.
 */
public final class Semaines {

    private Semaines() {}

    public static boolean bonneParite(int semaine, String parite) {
        return (semaine % 2 == 0) == ScanDossier.PAIRE.equals(parite);
    }

    /** Semaine du calendrier (norme ISO, comme en France) : celle en cours si sa parité convient, sinon la suivante. */
    public static int semaineCalendrier(Calendar aujourdHui, String parite) {
        GregorianCalendar c = new GregorianCalendar(aujourdHui.getTimeZone());
        c.setFirstDayOfWeek(Calendar.MONDAY);
        c.setMinimalDaysInFirstWeek(4);
        c.setTimeInMillis(aujourdHui.getTimeInMillis());
        for (int i = 0; i < 3; i++) {
            int semaine = c.get(Calendar.WEEK_OF_YEAR);
            if (bonneParite(semaine, parite)) return semaine;
            c.add(Calendar.DATE, 7);
        }
        return c.get(Calendar.WEEK_OF_YEAR);
    }

    /**
     * Semaine d'un onglet : la plus fréquente parmi les semaines des
     * lancements chargés qui ont la bonne parité (à égalité, la plus
     * grande) ; sans lancement, celle du calendrier.
     */
    public static int semaineAffichee(List<String> semainesChargees, String parite, Calendar aujourdHui) {
        Map<Integer, Integer> nombre = new LinkedHashMap<>();
        for (String s : semainesChargees) {
            if (s == null) continue;
            int n;
            try {
                n = Integer.parseInt(s.trim());
            } catch (NumberFormatException e) {
                continue;
            }
            if (n < 1 || n > 53 || !bonneParite(n, parite)) continue;
            Integer avant = nombre.get(n);
            nombre.put(n, avant == null ? 1 : avant + 1);
        }
        int meilleure = -1;
        int meilleurNombre = 0;
        for (Map.Entry<Integer, Integer> e : nombre.entrySet()) {
            if (e.getValue() > meilleurNombre || (e.getValue() == meilleurNombre && e.getKey() > meilleure)) {
                meilleure = e.getKey();
                meilleurNombre = e.getValue();
            }
        }
        return meilleure > 0 ? meilleure : semaineCalendrier(aujourdHui, parite);
    }
}
