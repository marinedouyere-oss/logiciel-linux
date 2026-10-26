package com.marinedouyere.sentinelle.moteur;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Les trois rapports PDF d'un sommaire Cut Rite : agglo (panneaux et
 * restes), strats, et couleurs de la feuille de réception (+ hors gamme),
 * avec le nombre de pièces du lancement et la couleur de la semaine.
 */
public final class RapportsSommaire {

    private RapportsSommaire() {}

    private static final double MARGE = 14 * PdfSimple.MM;
    private static final double TAILLE = 9;
    private static final double INTERLIGNE = 11.5;
    private static final double REMPLISSAGE = 3.5;
    private static final int BLEU = 0x1565C0;
    private static final int TITRE = 0x0D2B5C;
    private static final int GRIS_TEXTE = 0x555555;
    private static final int TEXTE = 0x263238;
    private static final int GRILLE = 0xC9D2DE;
    private static final int FOND_PAIR = 0xF3F5F8;
    private static final int FOND_TOTAL = 0xE3F2FD;

    static int couleurDuNom(String couleur) {
        switch (couleur == null ? "" : couleur) {
            case "ROSE":
                return 0xD81B60;
            case "BLEU":
                return 0x1565C0;
            case "JAUNE":
                return 0xF9A825;
            default:
                return 0x607D8B;
        }
    }

    /** « LAN264601START » → « LAN264601 ». */
    public static String base(SommaireCutRite s) {
        String b = s.lancement.replaceAll("(STRAT|START)$", "");
        return b.isEmpty() ? "Sommaire" : b;
    }

    /** Nom de fichier → contenu, dans l'ordre : agglo, strats, couleurs. */
    public static Map<String, byte[]> creer(SommaireCutRite s, String nbPieces, String couleurSemaine) {
        String base = base(s);
        Map<String, byte[]> pdf = new LinkedHashMap<>();

        List<String[]> agglo = new ArrayList<>();
        for (SommaireCutRite.Materiau m : s.agglo()) {
            Double e = m.epaisseur();
            agglo.add(new String[] {m.code, m.designation(), e == null ? "" : Js.nombre(e), String.valueOf(m.panneaux), String.valueOf(m.restes)});
        }
        pdf.put(base + "_Agglo.pdf", rapport(s, base + " — Agglo : panneaux et restes", nbPieces, couleurSemaine,
                new String[] {"Code", "Désignation", "Ép. (mm)", "Panneaux", "Restes"}, new double[] {38, 86, 16, 22, 20}, 3, agglo, null));

        List<String[]> strats = new ArrayList<>();
        for (SommaireCutRite.Materiau m : s.strats()) strats.add(new String[] {m.code, m.designation(), String.valueOf(m.panneaux), String.valueOf(m.restes)});
        pdf.put(base + "_Strats.pdf", rapport(s, base + " — Strats : panneaux et restes", nbPieces, couleurSemaine,
                new String[] {"Code", "Désignation", "Panneaux", "Restes"}, new double[] {26, 114, 22, 20}, 2, strats, null));

        List<String[]> couleurs = new ArrayList<>();
        for (SommaireCutRite.Materiau m : s.couleursFeuille()) {
            couleurs.add(new String[] {m.code, m.designation(), m.format(), String.valueOf(m.panneaux), String.valueOf(m.restes)});
        }
        List<String[]> notes = new ArrayList<>();
        List<String> absentes = s.couleursAbsentes();
        if (!absentes.isEmpty()) notes.add(new String[] {"Pas dans ce lancement : ", String.join(", ", absentes)});
        List<String> horsGamme = new ArrayList<>();
        for (SommaireCutRite.Materiau m : s.horsGamme()) horsGamme.add(m.code + " (" + m.panneaux + " panneau(x), " + m.restes + " reste(s))");
        notes.add(new String[] {"Hors gamme : ", horsGamme.isEmpty() ? "aucune dans ce lancement" : String.join(", ", horsGamme)});
        pdf.put(base + "_Couleurs.pdf", rapport(s, base + " — Couleurs de la feuille", nbPieces, couleurSemaine,
                new String[] {"Couleur", "Désignation", "Format", "Panneaux", "Restes"}, new double[] {22, 90, 30, 22, 18}, 3, couleurs, notes));
        return pdf;
    }

    private static byte[] rapport(SommaireCutRite s, String titre, String nbPieces, String couleurSemaine, String[] entete,
            double[] largeursMm, int nbColonnesTexte, List<String[]> rangees, List<String[]> notes) {
        PdfSimple pdf = new PdfSimple(titre);
        double y = MARGE + 16;
        pdf.texte(MARGE, y, titre, 16, true, TITRE);
        y += 13;
        pdf.texte(MARGE, y, s.lancement + " · sommaire Cut Rite du " + s.date + " · Laisné Industrie", 9, false, GRIS_TEXTE);
        y += 19;
        double x = MARGE;
        if (nbPieces != null) {
            x = morceau(pdf, x, y, "Nombre de pièces : ", false, TEXTE);
            x = morceau(pdf, x, y, nbPieces, true, TEXTE);
        }
        if (couleurSemaine != null) {
            if (nbPieces != null) x = morceau(pdf, x, y, "     ·     ", false, TEXTE);
            x = morceau(pdf, x, y, "Couleurs semaine : ", false, TEXTE);
            morceau(pdf, x, y, couleurSemaine, true, couleurDuNom(couleurSemaine));
        }
        if (nbPieces != null || couleurSemaine != null) y += 12;

        double[] l = new double[largeursMm.length];
        for (int i = 0; i < l.length; i++) l[i] = largeursMm[i] * PdfSimple.MM;
        int totalP = 0;
        int totalR = 0;
        for (String[] r : rangees) {
            totalP += Integer.parseInt(r[r.length - 2]);
            totalR += Integer.parseInt(r[r.length - 1]);
        }
        List<String[]> lignes = new ArrayList<>(rangees);
        String[] total = new String[entete.length];
        Arrays.fill(total, "");
        total[0] = "Total";
        total[total.length - 2] = String.valueOf(totalP);
        total[total.length - 1] = String.valueOf(totalR);
        lignes.add(total);

        y = ligneTableau(pdf, y, entete, l, nbColonnesTexte, BLEU, true, 0xFFFFFF);
        for (int i = 0; i < lignes.size(); i++) {
            boolean estTotal = i == lignes.size() - 1;
            double h = hauteur(lignes.get(i), l, estTotal);
            if (y + h > PdfSimple.HAUTEUR - MARGE) {
                pdf.nouvellePage();
                y = ligneTableau(pdf, MARGE, entete, l, nbColonnesTexte, BLEU, true, 0xFFFFFF);
            }
            Integer fond = estTotal ? Integer.valueOf(FOND_TOTAL) : i % 2 == 1 ? Integer.valueOf(FOND_PAIR) : null;
            y = ligneTableau(pdf, y, lignes.get(i), l, nbColonnesTexte, fond, estTotal, 0x1F2933);
        }
        if (notes != null) {
            y += 18;
            for (String[] n : notes) {
                double xn = morceau(pdf, MARGE, y, n[0], true, TEXTE);
                morceau(pdf, xn, y, n[1], false, TEXTE);
                y += 14;
            }
        }
        return pdf.octets();
    }

    private static double morceau(PdfSimple pdf, double x, double y, String texte, boolean gras, int rgb) {
        double taille = 12;
        pdf.texte(x, y, texte, taille, gras, rgb);
        return x + PdfSimple.largeur(texte, taille, gras);
    }

    private static double hauteur(String[] cellules, double[] l, boolean gras) {
        int n = 1;
        for (int j = 0; j < cellules.length; j++) {
            n = Math.max(n, PdfSimple.couper(cellules[j], l[j] - 2 * REMPLISSAGE, TAILLE, gras || j == 0).size());
        }
        return n * INTERLIGNE + 2 * REMPLISSAGE;
    }

    /** Dessine une rangée (cellules à gauche, nombres à droite) et renvoie le bas de la rangée. */
    private static double ligneTableau(PdfSimple pdf, double y, String[] cellules, double[] l, int nbColonnesTexte, Integer fond,
            boolean gras, int rgb) {
        double h = hauteur(cellules, l, gras);
        double x = MARGE;
        for (int j = 0; j < cellules.length; j++) {
            pdf.rectangle(x, y, l[j], h, fond, GRILLE, 0.4);
            boolean g = gras || j == 0;
            List<String> morceaux = PdfSimple.couper(cellules[j], l[j] - 2 * REMPLISSAGE, TAILLE, g);
            double haut = y + (h - morceaux.size() * INTERLIGNE) / 2 + INTERLIGNE - 2.5;
            for (int k = 0; k < morceaux.size(); k++) {
                String t = morceaux.get(k);
                double xt = j >= nbColonnesTexte ? x + l[j] - REMPLISSAGE - PdfSimple.largeur(t, TAILLE, g) : x + REMPLISSAGE;
                pdf.texte(xt, haut + k * INTERLIGNE, t, TAILLE, g, rgb);
            }
            x += l[j];
        }
        return y + h;
    }
}
