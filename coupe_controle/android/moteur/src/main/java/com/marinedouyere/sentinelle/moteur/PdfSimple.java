package com.marinedouyere.sentinelle.moteur;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.zip.Deflater;

/**
 * Petit générateur de PDF (pages A4, polices de la charte Laisné Industrie
 * intégrées — Raleway pour les titres, Lato pour le texte —, texte,
 * rectangles, filets, pastilles et logo) : suffisant pour un rapport en
 * tableau, sans bibliothèque. Les coordonnées partent du haut de la page,
 * en points (1 mm = 2,835 pt).
 */
public final class PdfSimple {

    public static final double LARGEUR = 595.28;
    public static final double HAUTEUR = 841.89;
    public static final double MM = 72 / 25.4;

    private static final Charset WINANSI = Charset.forName("windows-1252");

    /** Polices de la charte, dans l'ordre de {@link PolicesPdf}. */
    public enum Police {
        TITRE, TEXTE, GRAS, ITALIQUE
    }

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

    public int nbPages() {
        return pages.size();
    }

    /** Reprend l'écriture sur une page déjà créée (pieds de page, une fois le nombre de pages connu). */
    public void allerPage(int index) {
        page = pages.get(index);
    }

    private static byte[] coder(String texte) {
        return texte.getBytes(WINANSI);
    }

    /** Largeur du texte en points ({@code espacement} : espace ajouté après chaque lettre). */
    public static double largeur(String texte, double taille, Police police, double espacement) {
        int[] l = PolicesPdf.LARGEURS[police.ordinal()];
        double total = 0;
        byte[] octets = coder(texte);
        for (byte b : octets) {
            int c = b & 0xFF;
            total += c >= 32 ? l[c - 32] : 0;
        }
        return total * taille / 1000 + espacement * octets.length;
    }

    public static double largeur(String texte, double taille, Police police) {
        return largeur(texte, taille, police, 0);
    }

    private static String n(double v) {
        String s = String.format(Locale.ROOT, "%.2f", v);
        return s.endsWith(".00") ? s.substring(0, s.length() - 3) : s;
    }

    private static String couleur(int rgb) {
        return n(((rgb >> 16) & 0xFF) / 255.0) + " " + n(((rgb >> 8) & 0xFF) / 255.0) + " " + n((rgb & 0xFF) / 255.0);
    }

    /** Texte dont la ligne de base est à {@code y} points du haut de la page. */
    public void texte(double x, double y, String texte, double taille, Police police, int rgb, double espacement) {
        StringBuilder chaine = new StringBuilder();
        for (byte b : coder(texte)) {
            int c = b & 0xFF;
            if (c == '(' || c == ')' || c == '\\') chaine.append('\\').append((char) c);
            else if (c < 32 || c > 126) chaine.append('\\').append(String.format(Locale.ROOT, "%03o", c));
            else chaine.append((char) c);
        }
        page.append("BT /F").append(police.ordinal() + 1).append(' ').append(n(taille)).append(" Tf ")
                .append(n(espacement)).append(" Tc ").append(couleur(rgb))
                .append(" rg ").append(n(x)).append(' ').append(n(HAUTEUR - y)).append(" Td (").append(chaine).append(") Tj ET\n");
    }

    public void texte(double x, double y, String texte, double taille, Police police, int rgb) {
        texte(x, y, texte, taille, police, rgb, 0);
    }

    /** Rectangle dont le coin haut gauche est en (x, y) ; fond et trait facultatifs (null). */
    public void rectangle(double x, double y, double l, double h, Integer fond, Integer trait, double epaisseur) {
        String r = n(x) + " " + n(HAUTEUR - y - h) + " " + n(l) + " " + n(h) + " re ";
        if (fond != null) page.append(couleur(fond)).append(" rg ").append(r).append("f\n");
        if (trait != null) page.append(couleur(trait)).append(" RG ").append(n(epaisseur)).append(" w ").append(r).append("S\n");
    }

    /** Filet horizontal à {@code y} points du haut, de {@code x1} à {@code x2}. */
    public void filet(double x1, double x2, double y, int rgb, double epaisseur) {
        page.append(couleur(rgb)).append(" RG ").append(n(epaisseur)).append(" w ").append(n(x1)).append(' ').append(n(HAUTEUR - y))
                .append(" m ").append(n(x2)).append(' ').append(n(HAUTEUR - y)).append(" l S\n");
    }

    /** Disque plein de centre (cx, cy) (quatre arcs de Bézier). */
    public void disque(double cx, double cy, double r, int fond) {
        double k = 0.5523 * r;
        double y = HAUTEUR - cy;
        page.append(couleur(fond)).append(" rg ")
                .append(n(cx + r)).append(' ').append(n(y)).append(" m ")
                .append(n(cx + r)).append(' ').append(n(y + k)).append(' ').append(n(cx + k)).append(' ').append(n(y + r)).append(' ')
                .append(n(cx)).append(' ').append(n(y + r)).append(" c ")
                .append(n(cx - k)).append(' ').append(n(y + r)).append(' ').append(n(cx - r)).append(' ').append(n(y + k)).append(' ')
                .append(n(cx - r)).append(' ').append(n(y)).append(" c ")
                .append(n(cx - r)).append(' ').append(n(y - k)).append(' ').append(n(cx - k)).append(' ').append(n(y - r)).append(' ')
                .append(n(cx)).append(' ').append(n(y - r)).append(" c ")
                .append(n(cx + k)).append(' ').append(n(y - r)).append(' ').append(n(cx + r)).append(' ').append(n(y - k)).append(' ')
                .append(n(cx + r)).append(' ').append(n(y)).append(" c f\n");
    }

    /** Logo Laisné Industrie (version couleur, fond blanc) : coin haut gauche en (x, y), largeur donnée ; renvoie sa hauteur. */
    public double logo(double x, double y, double largeur) {
        double h = largeur * PolicesPdf.LOGO_HAUTEUR / PolicesPdf.LOGO_LARGEUR;
        page.append("q ").append(n(largeur)).append(" 0 0 ").append(n(h)).append(' ').append(n(x)).append(' ').append(n(HAUTEUR - y - h))
                .append(" cm /Logo Do Q\n");
        return h;
    }

    private static byte[] ressource(String nom) {
        try (InputStream entree = PdfSimple.class.getResourceAsStream("charte/" + nom)) {
            if (entree == null) throw new IllegalStateException("ressource absente : " + nom);
            ByteArrayOutputStream sortie = new ByteArrayOutputStream();
            byte[] tampon = new byte[8192];
            int lu;
            while ((lu = entree.read(tampon)) > 0) sortie.write(tampon, 0, lu);
            return sortie.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("ressource illisible : " + nom, e);
        }
    }

    private static byte[] compresser(byte[] octets) {
        Deflater d = new Deflater(Deflater.BEST_COMPRESSION);
        d.setInput(octets);
        d.finish();
        ByteArrayOutputStream sortie = new ByteArrayOutputStream();
        byte[] tampon = new byte[8192];
        while (!d.finished()) sortie.write(tampon, 0, d.deflate(tampon));
        d.end();
        return sortie.toByteArray();
    }

    /** Objet du PDF : dictionnaire, suivi d'un flux s'il y en a un. */
    private static final class Objet {
        final String dictionnaire;
        final byte[] flux;

        Objet(String dictionnaire, byte[] flux) {
            this.dictionnaire = dictionnaire;
            this.flux = flux;
        }
    }

    public byte[] octets() {
        int nbPolices = PolicesPdf.FICHIERS.length;
        // 1 catalogue, 2 pages, 3 informations, 4 logo, puis 3 objets par police (police, descripteur, fichier),
        // puis page + contenu pour chaque page.
        List<Objet> objets = new ArrayList<>();
        objets.add(new Objet("<< /Type /Catalog /Pages 2 0 R >>", null));
        int premierePage = 5 + 3 * nbPolices;
        StringBuilder kids = new StringBuilder();
        for (int i = 0; i < pages.size(); i++) kids.append(premierePage + 2 * i).append(" 0 R ");
        objets.add(new Objet("<< /Type /Pages /Kids [" + kids.toString().trim() + "] /Count " + pages.size() + " >>", null));
        // Titre en UTF-16 (les informations du PDF ne sont pas en WinAnsi).
        StringBuilder hex = new StringBuilder("FEFF");
        for (char c : titre.toCharArray()) hex.append(String.format(Locale.ROOT, "%04X", (int) c));
        objets.add(new Objet("<< /Producer (Sentinelle) /Author (LAISNE INDUSTRIE) /Title <" + hex + "> >>", null));
        byte[] logo = ressource("logo.jpg");
        objets.add(new Objet("<< /Type /XObject /Subtype /Image /Width " + PolicesPdf.LOGO_LARGEUR + " /Height " + PolicesPdf.LOGO_HAUTEUR
                + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + logo.length + " >>", logo));
        StringBuilder polices = new StringBuilder();
        for (int i = 0; i < nbPolices; i++) {
            int num = 5 + 3 * i;
            StringBuilder largeurs = new StringBuilder();
            for (int l : PolicesPdf.LARGEURS[i]) largeurs.append(l).append(' ');
            objets.add(new Objet("<< /Type /Font /Subtype /TrueType /BaseFont /" + PolicesPdf.NOMS[i]
                    + " /FirstChar 32 /LastChar 255 /Widths [" + largeurs.toString().trim() + "] /Encoding /WinAnsiEncoding /FontDescriptor "
                    + (num + 1) + " 0 R >>", null));
            int[] bb = PolicesPdf.BBOX[i];
            int[] m = PolicesPdf.METRIQUES[i];
            objets.add(new Objet("<< /Type /FontDescriptor /FontName /" + PolicesPdf.NOMS[i] + " /Flags " + (PolicesPdf.ITALIQUE[i] ? 96 : 32)
                    + " /FontBBox [" + bb[0] + " " + bb[1] + " " + bb[2] + " " + bb[3] + "] /ItalicAngle " + m[3] + " /Ascent " + m[0]
                    + " /Descent " + m[1] + " /CapHeight " + m[2] + " /StemV " + (i == 1 || i == 3 ? 80 : 140) + " /FontFile2 " + (num + 2)
                    + " 0 R >>", null));
            byte[] ttf = ressource(PolicesPdf.FICHIERS[i]);
            byte[] z = compresser(ttf);
            objets.add(new Objet("<< /Length " + z.length + " /Length1 " + ttf.length + " /Filter /FlateDecode >>", z));
            polices.append("/F").append(i + 1).append(' ').append(num).append(" 0 R ");
        }
        for (int i = 0; i < pages.size(); i++) {
            objets.add(new Objet("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + n(LARGEUR) + " " + n(HAUTEUR) + "] /Resources << /Font << "
                    + polices.toString().trim() + " >> /XObject << /Logo 4 0 R >> >> /Contents " + (premierePage + 2 * i + 1) + " 0 R >>", null));
            byte[] contenu = coder(pages.get(i).toString());
            objets.add(new Objet("<< /Length " + contenu.length + " >>", contenu));
        }

        ByteArrayOutputStream sortie = new ByteArrayOutputStream();
        ecrire(sortie, "%PDF-1.4\n%âãÏÓ\n");
        List<Integer> positions = new ArrayList<>();
        for (int i = 0; i < objets.size(); i++) {
            positions.add(sortie.size());
            Objet o = objets.get(i);
            ecrire(sortie, (i + 1) + " 0 obj\n" + o.dictionnaire);
            if (o.flux != null) {
                ecrire(sortie, "\nstream\n");
                sortie.write(o.flux, 0, o.flux.length);
                ecrire(sortie, "\nendstream");
            }
            ecrire(sortie, "\nendobj\n");
        }
        int xref = sortie.size();
        StringBuilder x = new StringBuilder("xref\n0 " + (objets.size() + 1) + "\n0000000000 65535 f \n");
        for (int p : positions) x.append(String.format(Locale.ROOT, "%010d 00000 n \n", p));
        x.append("trailer\n<< /Size ").append(objets.size() + 1).append(" /Root 1 0 R /Info 3 0 R >>\nstartxref\n").append(xref).append("\n%%EOF\n");
        ecrire(sortie, x.toString());
        return sortie.toByteArray();
    }

    private static void ecrire(ByteArrayOutputStream sortie, String s) {
        byte[] b = s.getBytes(WINANSI);
        sortie.write(b, 0, b.length);
    }

    /** Coupe un texte en lignes qui tiennent dans {@code largeurMax} (mot à mot, mot trop long coupé). */
    public static List<String> couper(String texte, double largeurMax, double taille, Police police) {
        List<String> lignes = new ArrayList<>();
        StringBuilder courante = new StringBuilder();
        for (String mot : texte.split(" ")) {
            if (mot.isEmpty()) continue;
            String essai = courante.length() == 0 ? mot : courante + " " + mot;
            if (largeur(essai, taille, police) <= largeurMax) {
                courante.setLength(0);
                courante.append(essai);
                continue;
            }
            if (courante.length() > 0) lignes.add(courante.toString());
            courante.setLength(0);
            while (largeur(mot, taille, police) > largeurMax && mot.length() > 1) {
                int k = mot.length() - 1;
                while (k > 1 && largeur(mot.substring(0, k), taille, police) > largeurMax) k--;
                lignes.add(mot.substring(0, k));
                mot = mot.substring(k);
            }
            courante.append(mot);
        }
        if (courante.length() > 0 || lignes.isEmpty()) lignes.add(courante.toString());
        return lignes;
    }
}
