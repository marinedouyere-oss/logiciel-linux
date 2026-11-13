package com.marinedouyere.sentinelle.moteur;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.GregorianCalendar;
import java.util.TimeZone;

public class SemainesTest {

    private static Calendar jour(int annee, int mois, int jour) {
        GregorianCalendar c = new GregorianCalendar(TimeZone.getTimeZone("Europe/Paris"));
        c.clear();
        c.set(annee, mois - 1, jour, 10, 0);
        return c;
    }

    @Test
    public void semaineDuCalendrier() {
        Calendar vendredi16octobre2026 = jour(2026, 10, 16); // semaine 42
        assertEquals(42, Semaines.semaineCalendrier(vendredi16octobre2026, "paire"));
        assertEquals(43, Semaines.semaineCalendrier(vendredi16octobre2026, "impaire"));
        // Dimanche : encore la semaine 42 (la semaine commence le lundi).
        assertEquals(42, Semaines.semaineCalendrier(jour(2026, 10, 18), "paire"));
        assertEquals(43, Semaines.semaineCalendrier(jour(2026, 10, 19), "impaire"));
        // Changement d'année : le 31 décembre 2026 est en semaine 53, le 4 janvier 2027 en semaine 1.
        assertEquals(53, Semaines.semaineCalendrier(jour(2026, 12, 31), "impaire"));
        assertEquals(2, Semaines.semaineCalendrier(jour(2026, 12, 31), "paire"));
    }

    @Test
    public void semaineDesLancementsCharges() {
        Calendar c = jour(2026, 10, 16);
        assertEquals(40, Semaines.semaineAffichee(Arrays.asList("40", null, "40", "42"), "paire", c));
        assertEquals(42, Semaines.semaineAffichee(Arrays.asList("40", "42"), "paire", c));
        // Un lancement de l'autre parité ne change pas le nom de l'onglet.
        assertEquals(41, Semaines.semaineAffichee(Arrays.asList("40", "41"), "impaire", c));
        assertEquals(43, Semaines.semaineAffichee(Collections.singletonList("40"), "impaire", c));
        assertEquals(42, Semaines.semaineAffichee(Collections.<String>emptyList(), "paire", c));
    }
}
