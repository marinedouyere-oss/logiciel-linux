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
    // Couleurs de Laisné plans de travail : rouge du logo, blanc, gris clair.
    private static final int ROUGE_LAISNE = 0xE3061C;
    private static final int TITRE = 0xB00415;
    private static final int GRIS_TEXTE = 0x555555;
    private static final int TEXTE = 0x2B2B2B;
    private static final int GRILLE = 0xD9D9D9;
    private static final int FOND_PAIR = 0xF5F5F5;
    private static final int FOND_TOTAL = 0xFDECEE;

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
        return base(s.lancement);
    }

    /** « LAN264601START.xlsx » → « LAN264601 ». */
    public static String base(String lancement) {
        String b = lancement.replaceAll("\\.[A-Za-z]+$", "").replaceAll("(STRAT|START)$", "");
        return b.isEmpty() ? "Sommaire" : b;
    }

    /**
     * Une partie de rapport : un tableau (avec, sauf exception, sa ligne de total : panneaux et restes dans
     * les deux dernières colonnes), une ligne d'état facultative au-dessus et des notes en dessous.
     */
    public static final class Partie {
        public String nom;
        public String titre;
        public String[] entete;
        public double[] largeursMm;
        /** Colonnes de texte (à gauche) ; les suivantes sont des nombres (à droite). */
        public int nbColonnesTexte;
        public boolean total = true;
        public String statut;
        public int couleurStatut = TEXTE;
        public final List<String[]> rangees = new ArrayList<>();
        public final List<String[]> notes = new ArrayList<>();
    }

    /** Les trois rapports, dans l'ordre : agglo, strats, couleurs de la feuille. */
    public static List<Partie> parties(SommaireCutRite s) {
        String base = base(s);
        List<Partie> parties = new ArrayList<>();

        Partie agglo = partie("Agglo", base + " — Agglo : panneaux et restes", new String[] {"Code", "Désignation", "Ép. (mm)", "Panneaux", "Restes"},
                new double[] {38, 86, 16, 22, 20}, 3);
        for (SommaireCutRite.Materiau m : s.agglo()) {
            Double e = m.epaisseur();
            agglo.rangees.add(new String[] {m.code, m.designation(), e == null ? "" : Js.nombre(e), String.valueOf(m.panneaux), String.valueOf(m.restes)});
        }
        parties.add(agglo);

        Partie strats = partie("Strats", base + " — Strats : panneaux et restes", new String[] {"Code", "Désignation", "Panneaux", "Restes"},
                new double[] {26, 114, 22, 20}, 2);
        for (SommaireCutRite.Materiau m : s.strats()) strats.rangees.add(new String[] {m.code, m.designation(), String.valueOf(m.panneaux), String.valueOf(m.restes)});
        parties.add(strats);

        Partie couleurs = partie("Couleurs", base + " — Couleurs de la feuille", new String[] {"Couleur", "Désignation", "Format", "Panneaux", "Restes"},
                new double[] {22, 90, 30, 22, 18}, 3);
        for (SommaireCutRite.Materiau m : s.couleursFeuille()) {
            couleurs.rangees.add(new String[] {m.code, m.designation(), m.format(), String.valueOf(m.panneaux), String.valueOf(m.restes)});
        }
        List<String> absentes = s.couleursAbsentes();
        if (!absentes.isEmpty()) couleurs.notes.add(new String[] {"Pas dans ce lancement : ", String.join(", ", absentes)});
        List<String> horsGamme = new ArrayList<>();
        for (SommaireCutRite.Materiau m : s.horsGamme()) horsGamme.add(m.code + " (" + m.panneaux + " panneau(x), " + m.restes + " reste(s))");
        couleurs.notes.add(new String[] {"Hors gamme : ", horsGamme.isEmpty() ? "aucune dans ce lancement" : String.join(", ", horsGamme)});
        parties.add(couleurs);
        return parties;
    }

    public static Partie partie(String nom, String titre, String[] entete, double[] largeursMm, int nbColonnesTexte) {
        Partie p = new Partie();
        p.nom = nom;
        p.titre = titre;
        p.entete = entete;
        p.largeursMm = largeursMm;
        p.nbColonnesTexte = nbColonnesTexte;
        return p;
    }

    /** Rangées de la partie suivies de la ligne de total. */
    public static List<String[]> avecTotal(Partie p) {
        int totalP = 0;
        int totalR = 0;
        for (String[] r : p.rangees) {
            totalP += Integer.parseInt(r[r.length - 2]);
            totalR += Integer.parseInt(r[r.length - 1]);
        }
        List<String[]> lignes = new ArrayList<>(p.rangees);
        String[] total = new String[p.entete.length];
        Arrays.fill(total, "");
        total[0] = "Total";
        total[total.length - 2] = String.valueOf(totalP);
        total[total.length - 1] = String.valueOf(totalR);
        lignes.add(total);
        return lignes;
    }

    public static String sousTitre(SommaireCutRite s) {
        return s.lancement + " · sommaire Cut Rite du " + s.date + " · Laisné Industrie";
    }

    /** Nom de fichier → contenu, dans l'ordre : agglo, strats, couleurs. */
    public static Map<String, byte[]> creer(SommaireCutRite s, String nbPieces, String couleurSemaine) {
        String base = base(s);
        Map<String, byte[]> pdf = new LinkedHashMap<>();
        for (Partie p : parties(s)) {
            PdfSimple seul = new PdfSimple(p.titre);
            dessiner(seul, sousTitre(s), p, nbPieces, couleurSemaine);
            pdf.put(base + "_" + p.nom + ".pdf", seul.octets());
        }
        return pdf;
    }

    /** Rapport d'un lancement : un seul PDF, chaque partie sur sa page (agglo, strats, couleurs, Diakonos…). */
    public static byte[] rapportLancement(String titre, String sousTitre, String nbPieces, String couleurSemaine, List<Partie> parties) {
        PdfSimple pdf = new PdfSimple(titre);
        for (int i = 0; i < parties.size(); i++) {
            if (i > 0) pdf.nouvellePage();
            dessiner(pdf, sousTitre, parties.get(i), nbPieces, couleurSemaine);
        }
        return pdf.octets();
    }

    /** Dessine une partie à partir du haut de la page courante. */
    private static void dessiner(PdfSimple pdf, String sousTitre, Partie p, String nbPieces, String couleurSemaine) {
        double y = MARGE + 16;
        pdf.texte(MARGE, y, p.titre, 16, true, TITRE);
        y += 13;
        pdf.texte(MARGE, y, sousTitre, 9, false, GRIS_TEXTE);
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
        if (p.statut != null) {
            y += 8;
            morceau(pdf, MARGE, y, p.statut, true, p.couleurStatut);
            y += 10;
        }

        double[] l = new double[p.largeursMm.length];
        for (int i = 0; i < l.length; i++) l[i] = p.largeursMm[i] * PdfSimple.MM;
        List<String[]> lignes = p.total ? avecTotal(p) : p.rangees;
        if (!lignes.isEmpty()) y = ligneTableau(pdf, y, p.entete, l, p.nbColonnesTexte, ROUGE_LAISNE, true, 0xFFFFFF);
        for (int i = 0; i < lignes.size(); i++) {
            boolean estTotal = p.total && i == lignes.size() - 1;
            double h = hauteur(lignes.get(i), l, estTotal);
            if (y + h > PdfSimple.HAUTEUR - MARGE) {
                pdf.nouvellePage();
                y = ligneTableau(pdf, MARGE, p.entete, l, p.nbColonnesTexte, ROUGE_LAISNE, true, 0xFFFFFF);
            }
            Integer fond = estTotal ? Integer.valueOf(FOND_TOTAL) : i % 2 == 1 ? Integer.valueOf(FOND_PAIR) : null;
            y = ligneTableau(pdf, y, lignes.get(i), l, p.nbColonnesTexte, fond, estTotal, 0x1F2933);
        }
        if (!p.notes.isEmpty()) {
            y += 18;
            for (String[] n : p.notes) {
                double xn = morceau(pdf, MARGE, y, n[0], true, TEXTE);
                morceau(pdf, xn, y, n[1], false, TEXTE);
                y += 14;
            }
        }
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
