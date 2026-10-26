package com.marinedouyere.sentinelle.moteur;

import java.io.ByteArrayOutputStream;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Petit générateur de PDF (pages A4, polices Helvetica standard, texte et
 * rectangles) : suffisant pour un rapport en tableau, sans bibliothèque.
 * Les coordonnées partent du haut de la page, en points (1 mm = 2,835 pt).
 */
public final class PdfSimple {

    public static final double LARGEUR = 595.28;
    public static final double HAUTEUR = 841.89;
    public static final double MM = 72 / 25.4;

    private static final Charset WINANSI = Charset.forName("windows-1252");

    /** Largeurs des caractères 32 à 255 (codage WinAnsi), en millièmes de la taille. */
    private static final int[] LARGEURS_NORMAL = {278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500,
        667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
        556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
        350, 556, 350, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350, 350, 222, 222, 333, 333, 350, 556, 1000,
        333, 1000, 500, 333, 944, 350, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584,
        333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667,
        278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556,
        889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500};
    private static final int[] LARGEURS_GRAS = {278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556,
        722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611,
        556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
        350, 556, 350, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350, 350, 278, 278, 500, 500, 350, 556, 1000,
        333, 1000, 556, 333, 944, 350, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584,
        333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667,
        278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556,
        889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556};

    private final String titre;
    private final List<StringBuilder> pages = new ArrayList<>();
    private StringBuilder page;

    public PdfSimple(String titre) {
        this.titre = titre;
        nouvellePage();
    }

    public void nouvellePage() {
        page = new StringBuilder();
        pages.add(page);
    }

    private static byte[] coder(String texte) {
        return texte.getBytes(WINANSI);
    }

    /** Largeur du texte en points. */
    public static double largeur(String texte, double taille, boolean gras) {
        int[] l = gras ? LARGEURS_GRAS : LARGEURS_NORMAL;
        double total = 0;
        for (byte b : coder(texte)) {
            int c = b & 0xFF;
            total += c >= 32 ? l[c - 32] : 0;
        }
        return total * taille / 1000;
    }

    private static String n(double v) {
        String s = String.format(Locale.ROOT, "%.2f", v);
        return s.endsWith(".00") ? s.substring(0, s.length() - 3) : s;
    }

    private static String couleur(int rgb) {
        return n(((rgb >> 16) & 0xFF) / 255.0) + " " + n(((rgb >> 8) & 0xFF) / 255.0) + " " + n((rgb & 0xFF) / 255.0);
    }

    /** Texte dont la ligne de base est à {@code y} points du haut de la page. */
    public void texte(double x, double y, String texte, double taille, boolean gras, int rgb) {
        StringBuilder chaine = new StringBuilder();
        for (byte b : coder(texte)) {
            int c = b & 0xFF;
            if (c == '(' || c == ')' || c == '\\') chaine.append('\\').append((char) c);
            else if (c < 32 || c > 126) chaine.append('\\').append(String.format(Locale.ROOT, "%03o", c));
            else chaine.append((char) c);
        }
        page.append("BT /").append(gras ? "F2" : "F1").append(' ').append(n(taille)).append(" Tf ").append(couleur(rgb))
                .append(" rg ").append(n(x)).append(' ').append(n(HAUTEUR - y)).append(" Td (").append(chaine).append(") Tj ET\n");
    }

    /** Rectangle dont le coin haut gauche est en (x, y) ; fond et trait facultatifs (null). */
    public void rectangle(double x, double y, double l, double h, Integer fond, Integer trait, double epaisseur) {
        String r = n(x) + " " + n(HAUTEUR - y - h) + " " + n(l) + " " + n(h) + " re ";
        if (fond != null) page.append(couleur(fond)).append(" rg ").append(r).append("f\n");
        if (trait != null) page.append(couleur(trait)).append(" RG ").append(n(epaisseur)).append(" w ").append(r).append("S\n");
    }

    public byte[] octets() {
        ByteArrayOutputStream sortie = new ByteArrayOutputStream();
        List<Integer> positions = new ArrayList<>();
        StringBuilder enTete = new StringBuilder("%PDF-1.4\n%âãÏÓ\n");
        ecrire(sortie, enTete.toString());
        int nbPages = pages.size();
        // 1 catalogue, 2 pages, 3 et 4 polices, 5 informations, puis page + contenu pour chaque page.
        List<String> objets = new ArrayList<>();
        objets.add("<< /Type /Catalog /Pages 2 0 R >>");
        StringBuilder kids = new StringBuilder();
        for (int i = 0; i < nbPages; i++) kids.append(6 + 2 * i).append(" 0 R ");
        objets.add("<< /Type /Pages /Kids [" + kids.toString().trim() + "] /Count " + nbPages + " >>");
        objets.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
        objets.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
        objets.add(null); // informations : écrites à part (titre codé)
        for (int i = 0; i < nbPages; i++) {
            objets.add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + n(LARGEUR) + " " + n(HAUTEUR) + "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents "
                    + (7 + 2 * i) + " 0 R >>");
            objets.add(null); // contenu
        }
        for (int i = 0; i < objets.size(); i++) {
            positions.add(sortie.size());
            ecrire(sortie, (i + 1) + " 0 obj\n");
            if (i == 4) {
                // Titre en UTF-16 (les informations du PDF ne sont pas en WinAnsi).
                StringBuilder hex = new StringBuilder("FEFF");
                for (char c : titre.toCharArray()) hex.append(String.format(Locale.ROOT, "%04X", (int) c));
                ecrire(sortie, "<< /Producer (Sentinelle) /Title <" + hex + "> >>");
            } else if (objets.get(i) != null) {
                ecrire(sortie, objets.get(i));
            } else {
                byte[] contenu = coder(pages.get((i - 6) / 2).toString());
                ecrire(sortie, "<< /Length " + contenu.length + " >>\nstream\n");
                sortie.write(contenu, 0, contenu.length);
                ecrire(sortie, "endstream");
            }
            ecrire(sortie, "\nendobj\n");
        }
        int xref = sortie.size();
        StringBuilder x = new StringBuilder("xref\n0 " + (objets.size() + 1) + "\n0000000000 65535 f \n");
        for (int p : positions) x.append(String.format(Locale.ROOT, "%010d 00000 n \n", p));
        x.append("trailer\n<< /Size ").append(objets.size() + 1).append(" /Root 1 0 R /Info 5 0 R >>\nstartxref\n").append(xref).append("\n%%EOF\n");
        ecrire(sortie, x.toString());
        return sortie.toByteArray();
    }

    private static void ecrire(ByteArrayOutputStream sortie, String s) {
        byte[] b = s.getBytes(WINANSI);
        sortie.write(b, 0, b.length);
    }

    /** Coupe un texte en lignes qui tiennent dans {@code largeurMax} (mot à mot, mot trop long coupé). */
    public static List<String> couper(String texte, double largeurMax, double taille, boolean gras) {
        List<String> lignes = new ArrayList<>();
        StringBuilder courante = new StringBuilder();
        for (String mot : texte.split(" ")) {
            if (mot.isEmpty()) continue;
            String essai = courante.length() == 0 ? mot : courante + " " + mot;
            if (largeur(essai, taille, gras) <= largeurMax) {
                courante.setLength(0);
                courante.append(essai);
                continue;
            }
            if (courante.length() > 0) lignes.add(courante.toString());
            courante.setLength(0);
            while (largeur(mot, taille, gras) > largeurMax && mot.length() > 1) {
                int k = mot.length() - 1;
                while (k > 1 && largeur(mot.substring(0, k), taille, gras) > largeurMax) k--;
                lignes.add(mot.substring(0, k));
                mot = mot.substring(k);
            }
            courante.append(mot);
        }
        if (courante.length() > 0 || lignes.isEmpty()) lignes.add(courante.toString());
        return lignes;
    }
}
