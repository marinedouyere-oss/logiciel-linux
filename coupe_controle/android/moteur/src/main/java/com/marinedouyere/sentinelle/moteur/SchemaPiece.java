package com.marinedouyere.sentinelle.moteur;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Schéma vue de dessus d'une pièce (onglet Recherche) : dimensions finies à
 * l'échelle, chants, découpe évier/cuisson et chapelles d'assemblage —
 * identique à construireSchemaPieceSvg() de l'appli web (dessin de 320 × 190).
 */
public final class SchemaPiece {

    private SchemaPiece() {}

    public static final double LARGEUR = 320;
    public static final double HAUTEUR = 190;
    private static final Pattern MOTIF_DVR = Pattern.compile("DVR", Pattern.CASE_INSENSITIVE);

    /** Éléments du dessin, ou null si les dimensions finies sont inconnues. */
    public static List<ElementSvg> construire(Recherche.ChampsDetail champs) {
        Double longueur = champs.longueurFinie;
        Double largeur = champs.largeurFinie;
        if (longueur == null || largeur == null || longueur == 0 || largeur == 0 || longueur.isNaN() || largeur.isNaN()) return null;

        double margeG = 46;
        double margeD = 26;
        double margeH = 30;
        double margeB = 26;
        double availW = LARGEUR - margeG - margeD;
        double availH = HAUTEUR - margeH - margeB;
        double echelle = Math.min(availW / longueur, availH / largeur);
        double rectW = longueur * echelle;
        double rectH = largeur * echelle;
        if (rectH < 8) rectH = 8;
        if (rectW < 8) rectW = 8;
        double x0 = margeG + (availW - rectW) / 2;
        double y0 = margeH + (availH - rectH) / 2;

        List<ElementSvg> el = new ArrayList<>();
        el.add(new ElementSvg("line", "schema-cote").nombreJs("x1", x0).nombreJs("y1", y0 - 10).nombreJs("x2", x0 + rectW)
                .nombreJs("y2", y0 - 10));
        ElementSvg coteL = new ElementSvg("text", "schema-cote-label").nombreJs("x", x0 + rectW / 2).nombreJs("y", y0 - 14);
        coteL.texte = Js.dimension(longueur) + " mm";
        el.add(coteL);
        el.add(new ElementSvg("line", "schema-cote").nombreJs("x1", x0 - 10).nombreJs("y1", y0).nombreJs("x2", x0 - 10)
                .nombreJs("y2", y0 + rectH));
        ElementSvg coteW = new ElementSvg("text", "schema-cote-label").nombreJs("x", x0 - 14).nombreJs("y", y0 + rectH / 2);
        coteW.attributs.put("transform", "rotate(-90 " + Js.nombre(x0 - 14) + " " + Js.nombre(y0 + rectH / 2) + ")");
        coteW.valeurs.put("rotation", -90.0);
        coteW.texte = Js.dimension(largeur) + " mm";
        el.add(coteW);
        el.add(new ElementSvg("rect", "schema-rect").nombreJs("x", x0).nombreJs("y", y0).nombreJs("width", rectW)
                .nombreJs("height", rectH));

        Object[][] chants = {
            {"AV", champs.champ("chantAV"), x0, y0 + rectH, x0 + rectW, y0 + rectH, x0 + rectW / 2, y0 + rectH + 14},
            {"AR", champs.champ("chantAR"), x0, y0, x0 + rectW, y0, x0 + rectW / 2, y0 - 6},
            {"G", champs.champ("chantG"), x0, y0, x0, y0 + rectH, x0 - 8, y0 + rectH / 2},
            {"D", champs.champ("chantD"), x0 + rectW, y0, x0 + rectW, y0 + rectH, x0 + rectW + 8, y0 + rectH / 2},
        };
        for (Object[] c : chants) {
            String val = (String) c[1];
            if (val == null || val.isEmpty()) continue;
            ElementSvg ligne = new ElementSvg("line", "schema-chant").nombreJs("x1", (Double) c[2]).nombreJs("y1", (Double) c[3])
                    .nombreJs("x2", (Double) c[4]).nombreJs("y2", (Double) c[5]);
            ligne.titre = "Chant " + c[0] + " : " + val;
            el.add(ligne);
            ElementSvg t = new ElementSvg("text", "schema-chant-label").nombreJs("x", (Double) c[6]).nombreJs("y", (Double) c[7]);
            t.texte = (String) c[0];
            el.add(t);
        }

        String info3 = champs.toutesDonnees != null ? champs.toutesDonnees.get("info 3 atelier") : null;
        String codesDecoupe = info3 != null && !info3.isEmpty() ? info3
                : (champs.assemblage != null && !champs.assemblage.isEmpty() ? champs.assemblage : "");
        int nbDvr = 0;
        Matcher m = MOTIF_DVR.matcher(codesDecoupe);
        while (m.find()) nbDvr++;
        if (nbDvr > 0) {
            double cy = y0 + rectH / 2;
            double rw = Math.min(rectW / (nbDvr + 0.5), 70);
            double rh = Math.min(rectH * 0.5, 46);
            for (int i = 0; i < nbDvr; i++) {
                double cx = x0 + rectW * (i + 1) / (nbDvr + 1);
                ElementSvg r = new ElementSvg("rect", "schema-dvr").nombreJs("x", cx - rw / 2).nombreJs("y", cy - rh / 2)
                        .nombreJs("width", rw).nombreJs("height", rh).nombre("rx", 6, "6");
                r.titre = "Défonçage évier/plaque de cuisson (DVR)" + (nbDvr > 1 ? ", " + (i + 1) + "/" + nbDvr : ", centré");
                el.add(r);
                ElementSvg t = new ElementSvg("text", "schema-dvr-label").nombreJs("x", cx).nombreJs("y", cy + 3);
                t.texte = "DVR";
                el.add(t);
            }
        }

        Map<String, Boolean> sansRetourParCote = new LinkedHashMap<>();
        if (champs.assemblage != null && !champs.assemblage.isEmpty()) {
            for (SchemaCommande.Assemblage a : SchemaCommande.assemblagesDe(champs.assemblage)) {
                sansRetourParCote.put(a.cote, a.sansRetour);
            }
        }
        for (String cote : sansRetourParCote.keySet()) {
            double xBord = cote.equals("gauche") ? x0 : x0 + rectW;
            double decalage = cote.equals("gauche") ? 9 : -9;
            for (int i = 0; i < 3; i++) {
                double y = y0 + rectH * (i + 1) / 4;
                ElementSvg e = new ElementSvg("ellipse", "schema-chapelle").nombreJs("cx", xBord + decalage).nombreJs("cy", y)
                        .nombre("rx", 7, "7").nombre("ry", 3, "3");
                e.titre = "Chapelle d'assemblage, côté " + cote;
                el.add(e);
            }
        }
        return el;
    }

    /** Texte accessible du schéma ("Schéma de la pièce, 2400 x 650 mm"). */
    public static String libelle(Recherche.ChampsDetail champs) {
        return "Schéma de la pièce, " + Js.dimension(champs.longueurFinie) + " x " + Js.dimension(champs.largeurFinie) + " mm";
    }
}
