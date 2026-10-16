package com.marinedouyere.sentinelle.moteur;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Élément d'un schéma (rectangle, trait, texte...), décrit comme dans le
 * dessin SVG de l'appli web : les attributs servent à vérifier que le
 * dessin est identique, les valeurs numériques à le tracer à l'écran.
 */
public final class ElementSvg {

    /** "rect", "line", "text", "ellipse", "polygon", "path", "circle". */
    public final String tag;
    public final String classe;
    /** Attributs tels que l'appli web les écrit (nombres au format JavaScript). */
    public final Map<String, String> attributs = new LinkedHashMap<>();
    /** Mêmes valeurs, en nombres, pour le tracé. */
    public final Map<String, Double> valeurs = new LinkedHashMap<>();
    /** Sommets d'un polygone. */
    public List<double[]> points;
    /** Contour d'un plan (tracé avec arcs). */
    public SchemaCommande.Contour contour;
    /** Texte affiché (élément "text"). */
    public String texte;
    /** Info-bulle de l'élément. */
    public String titre;

    ElementSvg(String tag, String classe) {
        this.tag = tag;
        this.classe = classe;
    }

    ElementSvg nombre(String nom, double v, String ecrit) {
        valeurs.put(nom, v);
        attributs.put(nom, ecrit);
        return this;
    }

    ElementSvg nombreJs(String nom, double v) {
        return nombre(nom, v, Js.nombre(v));
    }

    ElementSvg nombre1(String nom, double v) {
        return nombre(nom, v, Js.toFixed(v, 1));
    }

    public double v(String nom) {
        Double d = valeurs.get(nom);
        return d == null ? 0 : d;
    }

    /** Points d'un polygone au format de l'attribut SVG "points". */
    static String listePoints(List<double[]> pts) {
        StringBuilder sb = new StringBuilder();
        for (double[] p : pts) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(Js.toFixed(p[0], 1)).append(',').append(Js.toFixed(p[1], 1));
        }
        return sb.toString();
    }

    ElementSvg polygone(List<double[]> pts) {
        points = new ArrayList<>(pts);
        attributs.put("points", listePoints(pts));
        return this;
    }

    /** Géométrie résumée (d, points, ou coordonnées), comme la relève la vérification. */
    public String geometrie() {
        if (attributs.containsKey("d")) return attributs.get("d");
        if (attributs.containsKey("points")) return attributs.get("points");
        StringBuilder sb = new StringBuilder();
        for (String nom : new String[] {"x1", "y1", "x2", "y2", "cx", "cy", "r", "x", "y", "font-size"}) {
            String v = attributs.get(nom);
            if (v == null) continue;
            if (sb.length() > 0) sb.append(' ');
            sb.append(v);
        }
        return sb.toString();
    }
}
