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

    // Charte graphique Laisné Industrie : A4, marges de 18 mm, bandeau bordeaux de 7 mm, pied de page à 12 mm du bord.
    private static final double MM = PdfSimple.MM;
    private static final double MARGE = 18 * MM;
    private static final double UTILE = PdfSimple.LARGEUR - 2 * MARGE;
    private static final double BANDEAU = 7 * MM;
    private static final double LOGO = 38 * MM;
    private static final double BAS = PdfSimple.HAUTEUR - 20 * MM;
    private static final double TAILLE = 8.8;
    private static final double TAILLE_ENTETE = 8;
    private static final double INTERLIGNE = 11;
    private static final double REMPLISSAGE = 4.5;

    public static final int BORDEAUX = 0x78140C;
    public static final int SAUMON = 0xEAC2B7;
    public static final int SAUMON_PALE = 0xFAF0EC;
    public static final int GRIS = 0x797978;
    public static final int GRIS_CLAIR = 0xF4F3F1;
    public static final int GRIS_FILET = 0xE9E7E3;
    public static final int NOIR = 0x22231D;
    private static final int GRIS_FONCE = 0x4D4D4B;
    private static final int BLANC = 0xFFFFFF;

    /** État d'une partie : tout va bien (encadré gris) ; les autres états sont mis en avant (encadré bordeaux). */
    public static final int STATUT_OK = 0x2E7D32;
    public static final int STATUT_ATTENTION = 0xE65100;
    public static final int STATUT_ALERTE = 0xC62828;
    private static final int TEXTE = NOIR;

    /** Pastille de la couleur de la semaine (étiquettes de l'atelier). */
    static int couleurDuNom(String couleur) {
        switch (couleur == null ? "" : couleur) {
            case "ROSE":
                return 0xE58FB0;
            case "BLEU":
                return 0x3D7CC9;
            case "JAUNE":
                return 0xF2C230;
            default:
                return BLANC;
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
        return s.lancement + " · sommaire Cut Rite du " + s.date;
    }

    /** En-tête : la case du lancement (« Agglo 1er tour », « Feno », « Casse »…), sinon le lancement. */
    static String caseDuLancement(String lancement) {
        ScanDossier.InfoNom info = ScanDossier.decoderNom(lancement);
        return info != null && info.poste != null ? info.poste : lancement;
    }

    /** Nom de fichier → contenu, dans l'ordre : agglo, strats, couleurs. */
    public static Map<String, byte[]> creer(SommaireCutRite s, String nbPieces, String couleurSemaine) {
        String base = base(s);
        String semaine = LecteurStrat.extraireSemaine(s.lancement);
        Map<String, byte[]> pdf = new LinkedHashMap<>();
        List<Partie> parties = parties(s);
        for (int i = 0; i < parties.size(); i++) {
            Partie p = parties.get(i);
            PdfSimple seul = new PdfSimple(p.titre);
            dessiner(seul, caseDuLancement(s.lancement), sousTitre(s), p, i + 1, semaine, nbPieces, couleurSemaine);
            piedsDePage(seul, p.titre);
            pdf.put(base + "_" + p.nom + ".pdf", seul.octets());
        }
        return pdf;
    }

    /**
     * Rapport d'un lancement : un seul PDF, chaque partie sur sa page (agglo, strats, couleurs, Diakonos…),
     * avec en en-tête la case du lancement (« Agglo 1er tour », « Casse », « Feno », le chantier…).
     */
    public static byte[] rapportLancement(String titre, String enTete, String sousTitre, String semaine, String nbPieces,
            String couleurSemaine, List<Partie> parties) {
        PdfSimple pdf = new PdfSimple(titre);
        for (int i = 0; i < parties.size(); i++) {
            if (i > 0) pdf.nouvellePage();
            dessiner(pdf, enTete, sousTitre, parties.get(i), i + 1, semaine, nbPieces, couleurSemaine);
        }
        piedsDePage(pdf, titre);
        return pdf.octets();
    }

    /** Bandeau bordeaux pleine largeur en tête de page, sans texte. */
    private static void bandeau(PdfSimple pdf) {
        pdf.rectangle(0, 0, PdfSimple.LARGEUR, BANDEAU, BORDEAUX, null, 0);
    }

    /** Confidentialité à gauche, nom du document au centre, pagination à droite (7,5 pt, gris). */
    private static void piedsDePage(PdfSimple pdf, String nomDocument) {
        double y = PdfSimple.HAUTEUR - 12 * MM;
        int n = pdf.nbPages();
        for (int i = 0; i < n; i++) {
            pdf.allerPage(i);
            pdf.texte(MARGE, y, "Document interne — LAISNÉ INDUSTRIE", 7.5, PdfSimple.Police.TEXTE, GRIS);
            String nom = PdfSimple.couper(nomDocument, UTILE / 2, 7.5, PdfSimple.Police.TEXTE).get(0);
            pdf.texte(PdfSimple.LARGEUR / 2 - PdfSimple.largeur(nom, 7.5, PdfSimple.Police.TEXTE) / 2, y, nom, 7.5, PdfSimple.Police.TEXTE, GRIS);
            String page = (i + 1) + " / " + n;
            pdf.texte(PdfSimple.LARGEUR - MARGE - PdfSimple.largeur(page, 7.5, PdfSimple.Police.TEXTE), y, page, 7.5, PdfSimple.Police.TEXTE, GRIS);
        }
    }

    /** Chiffre clé : valeur en Raleway bordeaux, légende en Lato gris, fond saumon pâle et barre bordeaux à gauche. */
    private static double chiffreCle(PdfSimple pdf, double x, double y, String valeur, String legende, Integer pastille) {
        double l = 54 * MM;
        double h = 15 * MM;
        pdf.rectangle(x, y, l, h, SAUMON_PALE, null, 0);
        pdf.rectangle(x, y, 3, h, BORDEAUX, null, 0);
        double xv = x + 12;
        if (pastille != null) {
            pdf.rectangle(xv, y + 9, 13, 13, pastille, GRIS_FILET, 0.8);
            xv += 19;
        }
        pdf.texte(xv, y + 21, valeur, 17, PdfSimple.Police.TITRE, BORDEAUX);
        pdf.texte(x + 12, y + h - 7, legende, 7.8, PdfSimple.Police.TEXTE, GRIS);
        return x + l + 5 * MM;
    }

    /** Pastille numérotée (cercle saumon de 6 mm, chiffre bordeaux à deux chiffres) ; renvoie la fin de la pastille. */
    private static double pastille(PdfSimple pdf, double x, double yBase, int numero) {
        double r = 3 * MM;
        String n = String.format(java.util.Locale.ROOT, "%02d", numero);
        pdf.disque(x + r, yBase - 4, r, SAUMON);
        pdf.texte(x + r - PdfSimple.largeur(n, 8, PdfSimple.Police.TITRE) / 2, yBase - 1.2, n, 8, PdfSimple.Police.TITRE, BORDEAUX);
        return x + 2 * r;
    }

    /** Dessine une partie à partir du haut de la page courante. */
    private static void dessiner(PdfSimple pdf, String enTete, String sousTitre, Partie p, int numero, String semaine, String nbPieces,
            String couleurSemaine) {
        bandeau(pdf);
        double hLogo = pdf.logo(PdfSimple.LARGEUR - MARGE - LOGO, BANDEAU + 7 * MM, LOGO);
        double largeurTitres = UTILE - LOGO - 8 * MM;
        double y = BANDEAU + 7 * MM - 8;
        for (String ligne : PdfSimple.couper(enTete, largeurTitres, 26, PdfSimple.Police.TITRE)) {
            y += 30;
            pdf.texte(MARGE, y, ligne, 26, PdfSimple.Police.TITRE, GRIS);
        }
        for (String ligne : PdfSimple.couper(sousTitre, largeurTitres, 11.5, PdfSimple.Police.TITRE)) {
            y += 16;
            pdf.texte(MARGE, y, ligne, 11.5, PdfSimple.Police.TITRE, BORDEAUX);
        }
        y = Math.max(y + 10, BANDEAU + 7 * MM + hLogo + 8);
        pdf.filet(MARGE, PdfSimple.LARGEUR - MARGE, y, SAUMON, 1);
        y += 12;

        if (semaine != null || nbPieces != null || couleurSemaine != null) {
            double x = MARGE;
            if (semaine != null) x = chiffreCle(pdf, x, y, semaine, "Semaine", null);
            if (nbPieces != null) x = chiffreCle(pdf, x, y, nbPieces, "Nombre de pièces", null);
            if (couleurSemaine != null) chiffreCle(pdf, x, y, couleurSemaine, "Couleurs semaine", couleurDuNom(couleurSemaine));
            y += 15 * MM + 14;
        }

        y += 14;
        double xTitre = pastille(pdf, MARGE, y, numero) + 8;
        for (String ligne : PdfSimple.couper(p.titre, PdfSimple.LARGEUR - MARGE - xTitre, 11.5, PdfSimple.Police.TITRE)) {
            pdf.texte(xTitre, y, ligne, 11.5, PdfSimple.Police.TITRE, BORDEAUX);
            y += 15;
        }
        y += 2;

        if (p.statut != null) y = encadre(pdf, y, p.statut, p.couleurStatut != STATUT_OK && p.couleurStatut != TEXTE) + 10;
        else y += 4;

        double[] l = largeurs(p);
        List<String[]> lignes = p.total ? avecTotal(p) : p.rangees;
        if (!lignes.isEmpty()) y = enteteTableau(pdf, y, p.entete, l, p.nbColonnesTexte);
        for (int i = 0; i < lignes.size(); i++) {
            boolean estTotal = p.total && i == lignes.size() - 1;
            PdfSimple.Police police = estTotal ? PdfSimple.Police.GRAS : PdfSimple.Police.TEXTE;
            double h = hauteur(lignes.get(i), l, police);
            if (y + h > BAS) {
                pdf.nouvellePage();
                bandeau(pdf);
                y = enteteTableau(pdf, BANDEAU + 12 * MM, p.entete, l, p.nbColonnesTexte);
            }
            Integer fond = estTotal ? Integer.valueOf(BORDEAUX) : i % 2 == 1 ? Integer.valueOf(GRIS_CLAIR) : null;
            y = ligneTableau(pdf, y, lignes.get(i), l, p.nbColonnesTexte, fond, police, estTotal ? BLANC : NOIR, !estTotal);
        }
        if (!p.notes.isEmpty()) {
            y += 14;
            for (String[] n : p.notes) {
                for (String ligne : PdfSimple.couper(n[0] + n[1], UTILE, 7.8, PdfSimple.Police.ITALIQUE)) {
                    if (y > BAS + 10) {
                        pdf.nouvellePage();
                        bandeau(pdf);
                        y = BANDEAU + 12 * MM;
                    }
                    pdf.texte(MARGE, y, ligne, 7.8, PdfSimple.Police.ITALIQUE, GRIS);
                    y += 11;
                }
            }
        }
    }

    /** Encadré de mise en avant : fond saumon pâle, barre bordeaux à gauche, texte bordeaux gras (gris pour un état normal). */
    private static double encadre(PdfSimple pdf, double y, String texte, boolean enAvant) {
        List<String> lignes = PdfSimple.couper(texte, UTILE - 24, 9.5, PdfSimple.Police.GRAS);
        double h = lignes.size() * 13 + 14;
        pdf.rectangle(MARGE, y, UTILE, h, enAvant ? SAUMON_PALE : GRIS_CLAIR, null, 0);
        pdf.rectangle(MARGE, y, 3, h, enAvant ? BORDEAUX : GRIS, null, 0);
        double yl = y + 7 + 9.5;
        for (String ligne : lignes) {
            pdf.texte(MARGE + 12, yl, ligne, 9.5, PdfSimple.Police.GRAS, enAvant ? BORDEAUX : NOIR);
            yl += 13;
        }
        return y + h;
    }

    /** Largeurs des colonnes, ramenées à la largeur utile de la page. */
    private static double[] largeurs(Partie p) {
        double somme = 0;
        for (double v : p.largeursMm) somme += v;
        double[] l = new double[p.largeursMm.length];
        for (int i = 0; i < l.length; i++) l[i] = p.largeursMm[i] * UTILE / somme;
        return l;
    }

    /** En-tête de tableau : fond bordeaux, texte blanc en capitales espacées. */
    private static double enteteTableau(PdfSimple pdf, double y, String[] entete, double[] l, int nbColonnesTexte) {
        String[] capitales = new String[entete.length];
        for (int j = 0; j < entete.length; j++) capitales[j] = entete[j].toUpperCase(java.util.Locale.FRENCH);
        int n = 1;
        for (int j = 0; j < capitales.length; j++) {
            n = Math.max(n, PdfSimple.couper(capitales[j], l[j] - 2 * REMPLISSAGE - 6, TAILLE_ENTETE, PdfSimple.Police.GRAS).size());
        }
        double h = n * 10 + 12;
        pdf.rectangle(MARGE, y, UTILE, h, BORDEAUX, null, 0);
        double x = MARGE;
        for (int j = 0; j < capitales.length; j++) {
            List<String> morceaux = PdfSimple.couper(capitales[j], l[j] - 2 * REMPLISSAGE - 6, TAILLE_ENTETE, PdfSimple.Police.GRAS);
            double haut = y + (h - morceaux.size() * 10) / 2 + 7.5;
            for (int k = 0; k < morceaux.size(); k++) {
                String t = morceaux.get(k);
                double lt = PdfSimple.largeur(t, TAILLE_ENTETE, PdfSimple.Police.GRAS, 0.6);
                double xt = j >= nbColonnesTexte ? x + l[j] - REMPLISSAGE - lt : x + REMPLISSAGE;
                pdf.texte(xt, haut + k * 10, t, TAILLE_ENTETE, PdfSimple.Police.GRAS, BLANC, 0.6);
            }
            x += l[j];
        }
        return y + h;
    }

    private static PdfSimple.Police policeCellule(PdfSimple.Police police, int colonne) {
        return colonne == 0 ? PdfSimple.Police.GRAS : police;
    }

    private static double hauteur(String[] cellules, double[] l, PdfSimple.Police police) {
        int n = 1;
        for (int j = 0; j < cellules.length; j++) {
            n = Math.max(n, PdfSimple.couper(cellules[j], l[j] - 2 * REMPLISSAGE, TAILLE, policeCellule(police, j)).size());
        }
        return n * INTERLIGNE + 2 * REMPLISSAGE;
    }

    /** Dessine une rangée (texte à gauche, nombres à droite, sans filets verticaux) et renvoie le bas de la rangée. */
    private static double ligneTableau(PdfSimple pdf, double y, String[] cellules, double[] l, int nbColonnesTexte, Integer fond,
            PdfSimple.Police police, int rgb, boolean filet) {
        double h = hauteur(cellules, l, police);
        if (fond != null) pdf.rectangle(MARGE, y, UTILE, h, fond, null, 0);
        double x = MARGE;
        for (int j = 0; j < cellules.length; j++) {
            PdfSimple.Police pj = policeCellule(police, j);
            List<String> morceaux = PdfSimple.couper(cellules[j], l[j] - 2 * REMPLISSAGE, TAILLE, pj);
            double haut = y + (h - morceaux.size() * INTERLIGNE) / 2 + INTERLIGNE - 2.5;
            for (int k = 0; k < morceaux.size(); k++) {
                String t = morceaux.get(k);
                double xt = j >= nbColonnesTexte ? x + l[j] - REMPLISSAGE - PdfSimple.largeur(t, TAILLE, pj) : x + REMPLISSAGE;
                pdf.texte(xt, haut + k * INTERLIGNE, t, TAILLE, pj, rgb);
            }
            x += l[j];
        }
        if (filet) pdf.filet(MARGE, MARGE + UTILE, y + h, GRIS_FILET, 0.5);
        return y + h;
    }
}
