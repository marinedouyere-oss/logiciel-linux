package com.marinedouyere.sentinelle.moteur;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Conversions identiques à celles de l'appli web (JavaScript), pour que le
 * moteur natif produise exactement les mêmes clés, libellés et quantités.
 */
public final class Js {

    private Js() {}

    /** Espaces au sens JavaScript (\s), Unicode compris. */
    public static final String CLASSE_ESPACES = "[\\p{IsWhite_Space}\\uFEFF]";
    private static final Pattern ESPACES = Pattern.compile(CLASSE_ESPACES + "+");
    private static final Pattern DEBUT_ESPACES = Pattern.compile("^" + CLASSE_ESPACES + "+");
    private static final Pattern FIN_ESPACES = Pattern.compile(CLASSE_ESPACES + "+$");
    private static final Pattern NOMBRE_EN_TETE =
            Pattern.compile("^[+-]?(Infinity|(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?)");
    private static final Pattern ENTIER_EN_TETE = Pattern.compile("^[+-]?\\d+");

    /** Équivalent de String(v) en JavaScript. */
    public static String texte(Object v) {
        if (v == null) return "null";
        if (v instanceof Double) return nombre((Double) v);
        if (v instanceof Number) return nombre(((Number) v).doubleValue());
        return v.toString();
    }

    /** Équivalent de String(n) pour un nombre JavaScript. */
    public static String nombre(double d) {
        if (Double.isNaN(d)) return "NaN";
        if (Double.isInfinite(d)) return d > 0 ? "Infinity" : "-Infinity";
        if (d == 0) return "0";
        double abs = Math.abs(d);
        if (abs >= 1e21 || abs < 1e-6) {
            String s = Double.toString(d).replace("E", "e");
            if (s.contains("e") && !s.contains("e-")) s = s.replace("e", "e+");
            return s.replace(".0e", "e");
        }
        if (d == Math.rint(d)) return new BigDecimal(d).toPlainString();
        return new BigDecimal(Double.toString(d)).stripTrailingZeros().toPlainString();
    }

    /** Équivalent de String.prototype.trim() (espaces Unicode compris). */
    public static String trim(String s) {
        if (s == null) return null;
        return FIN_ESPACES.matcher(DEBUT_ESPACES.matcher(s).replaceFirst("")).replaceFirst("");
    }

    /** Équivalent de .replace(/\s+/g, " ").trim(). */
    public static String normaliserEspaces(String s) {
        return trim(ESPACES.matcher(s).replaceAll(" "));
    }

    public static boolean estVide(Object v) {
        return v == null || (v instanceof String && ((String) v).isEmpty());
    }

    /**
     * Équivalent de toFloatOrNull() de l'appli web : nombre tel quel, sinon
     * parseFloat du texte (virgule décimale acceptée), null si illisible.
     */
    public static Double nombreOuNull(Object v) {
        if (v == null) return null;
        if (v instanceof Number) {
            double d = ((Number) v).doubleValue();
            return Double.isNaN(d) ? null : d;
        }
        String s = texte(v);
        if (s.isEmpty()) return null;
        return parseFloat(s.replaceFirst(",", "."));
    }

    /** Équivalent de parseFloat(texte), null pour NaN. */
    public static Double parseFloat(String s) {
        String t = DEBUT_ESPACES.matcher(s).replaceFirst("");
        Matcher m = NOMBRE_EN_TETE.matcher(t);
        if (!m.find()) return null;
        String n = m.group();
        if (n.endsWith("Infinity")) return n.startsWith("-") ? Double.NEGATIVE_INFINITY : Double.POSITIVE_INFINITY;
        return Double.parseDouble(n);
    }

    /** Équivalent de parseInt(texte, 10) || 0. */
    public static int parseIntOuZero(String s) {
        if (s == null) return 0;
        Matcher m = ENTIER_EN_TETE.matcher(DEBUT_ESPACES.matcher(s).replaceFirst(""));
        if (!m.find()) return 0;
        try {
            return Integer.parseInt(m.group().startsWith("+") ? m.group().substring(1) : m.group());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** Équivalent de Math.trunc() puis String(). */
    public static String entierTronque(double d) {
        return nombre(d < 0 ? Math.ceil(d) : Math.floor(d));
    }

    /** Équivalent de Number.prototype.toFixed(). */
    public static String toFixed(double x, int chiffres) {
        if (Double.isNaN(x)) return "NaN";
        if (Double.isInfinite(x) || Math.abs(x) >= 1e21) return nombre(x);
        boolean negatif = x < 0;
        String corps = new BigDecimal(Math.abs(x)).setScale(chiffres, RoundingMode.HALF_UP).toPlainString();
        return negatif ? "-" + corps : corps;
    }

    /** Équivalent de Number(texte) (NaN si le texte n'est pas un nombre). */
    public static double nombreStrict(String s) {
        if (s == null) return 0;
        String t = trim(s);
        if (t.isEmpty()) return 0;
        if (!t.matches("[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?")) return Double.NaN;
        return Double.parseDouble(t);
    }

    /** Équivalent de Number.isInteger(v) ? String(v) : v.toFixed(1) (fmtDim de l'appli web). */
    public static String dimension(double v) {
        return v == Math.rint(v) && !Double.isInfinite(v) ? nombre(v) : toFixed(v, 1);
    }
}
