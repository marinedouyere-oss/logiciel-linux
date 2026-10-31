package com.marinedouyere.sentinelle.moteur;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class RegroupementTest {

    private static Recherche.Trouvaille t(String cle, Double longueur, String... grains) {
        Recherche.Trouvaille t = new Recherche.Trouvaille();
        t.cle = cle;
        t.valeurs = new ArrayList<>(Arrays.asList(grains));
        if (longueur != null) {
            t.champs = new Recherche.ChampsDetail();
            t.champs.longueurFinie = longueur;
        }
        return t;
    }

    @Test
    public void unePieceParCleToutesSourcesConfondues() {
        Recherche.Trouvaille sansDimensions = t("CVC26090464001", null, "T73:2:1");
        sansDimensions.champs = new Recherche.ChampsDetail();
        Recherche.Trouvaille avecDimensions = t("CVC26090464001", 1120.0, "T73:2:1", "T74:1:1");
        List<Recherche.PieceTrouvee> pieces = Recherche.regrouper(Arrays.asList(
                t("CVC26090464002", null), sansDimensions, avecDimensions, t("CVC26080300001", null)));
        assertEquals(3, pieces.size());
        assertEquals("CVC26080300001", pieces.get(0).cle);
        Recherche.PieceTrouvee p = pieces.get(1);
        assertEquals("CVC26090464001", p.cle);
        assertEquals("CVC26090464", p.commande());
        assertEquals(2, p.sources.size());
        assertEquals(Arrays.asList("T73:2:1", "T74:1:1"), p.grains);
        assertSame(avecDimensions.champs, p.champs);
    }
}
