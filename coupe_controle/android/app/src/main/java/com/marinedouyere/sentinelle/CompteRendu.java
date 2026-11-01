package com.marinedouyere.sentinelle;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Picture;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Compte rendu de la semaine (modèle de l'atelier, comme sur le PC) : une ligne par lancement (TOURS,
 * Lancement, Pièces, Remarque), le total hors casse, puis la casse de la semaine d'avant : « Casse » (pièces
 * déjà lancées avant) et « RAJOUT » (les autres), et son total. Fait à partir du fichier partagé ; le PDF a la
 * même mise en page que celui de la page web (bandeau, logo, chiffres clés, tableaux, pied de page).
 */
final class CompteRendu {

    static final class Ligne {
        String libelle;
        String base;
        Double pieces; // null : inconnu
        String remarque = "";
    }

    int numero;
    int annee;
    String semaineCasse;
    final List<Ligne> lancements = new ArrayList<>();
    final List<Ligne> casse = new ArrayList<>();

    private static final List<String> ORDRE = Arrays.asList("Agglo 1er tour", "Recyclage", "Feno", "Agglo 2ème tour");

    /** « LAN2644TRIGANObis » → « TRIGANO BIS » ; « LAN264301COMMANDE TARDIVE » → « COMMANDE TARDIVE ». */
    static String nomChantier(String base) {
        String s = base.replaceFirst("(?i)^LAN\\d{4,6}", "").trim().toUpperCase(Locale.FRANCE);
        return s.isEmpty() ? base.toUpperCase(Locale.FRANCE) : s.replaceFirst("([A-Z])(BIS|TER)$", "$1 $2");
    }

    static boolean estCasse(FichierPartage.Lancement l) {
        return l.casse || "Casse".equals(l.poste) || l.nom.toUpperCase(Locale.ROOT).contains("CASSE");
    }

    private static boolean estChantier(FichierPartage.Lancement l) {
        return "Chantiers".equals(l.poste) || l.poste.isEmpty();
    }

    private static Double nombre(String v) {
        try {
            return v == null || v.isEmpty() ? null : Double.parseDouble(v);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    static CompteRendu de(FichierPartage f, FichierPartage.Semaine s) {
        CompteRendu c = new CompteRendu();
        c.numero = s.semaine;
        c.annee = s.annee;
        c.semaineCasse = String.format(Locale.ROOT, "%02d", semaineAvant(s.annee, s.semaine));
        List<Ligne> chantiers = new ArrayList<>();
        List<Ligne> fixes = new ArrayList<>();
        List<FichierPartage.Lancement> casses = new ArrayList<>();
        for (FichierPartage.Lancement l : s.lancements) {
            if (estCasse(l)) {
                casses.add(l);
                continue;
            }
            Ligne x = new Ligne();
            x.base = l.nom;
            x.pieces = l.nbPieces > 0 ? Double.valueOf(l.nbPieces) : l.prevues;
            if (estChantier(l)) {
                x.libelle = nomChantier(l.nom);
                chantiers.add(x);
            } else {
                x.libelle = "Recyclage".equals(l.poste) ? "Recyclage Agglo 1er tour" : l.poste;
                fixes.add(x);
            }
        }
        // Agglo 1er tour, Recyclage, Feno, Agglo 2ème tour, puis les chantiers (ordre du PC).
        Collections.sort(fixes, (a, b) -> Integer.compare(rang(a), rang(b)));
        c.lancements.addAll(fixes);
        c.lancements.addAll(chantiers);
        // Casse : la case Casse d'abord (pièces déjà lancées avant / rajouts), puis les autres fichiers de casse.
        Collections.sort(casses, (a, b) -> Integer.compare("Casse".equals(a.poste) ? 0 : 1, "Casse".equals(b.poste) ? 0 : 1));
        int avant = s.annee * 100 + s.semaine;
        int iCle = Math.max(0, f.colonne("cle"));
        int iPieces = f.colonne("pieces");
        for (FichierPartage.Lancement l : casses) {
            Double total = l.nbPieces > 0 ? Double.valueOf(l.nbPieces) : l.prevues;
            if (!"Casse".equals(l.poste)) {
                Ligne x = new Ligne();
                x.libelle = l.nom.toUpperCase(Locale.ROOT).contains("RECYCLAGE") ? "Recyclage casse" : "Casse";
                x.base = l.nom;
                x.pieces = total;
                c.casse.add(x);
                continue;
            }
            if (f.semainesAvant(avant).isEmpty()) {
                Ligne x = new Ligne();
                x.libelle = "Casse";
                x.base = l.nom;
                x.pieces = total;
                x.remarque = "déjà lancées / rajouts pas séparés : semaines d'avant absentes";
                c.casse.add(x);
                continue;
            }
            double dejaLancees = 0;
            double rajouts = 0;
            for (String[] p : l.pieces) {
                String cle = iCle < p.length ? p[iCle] : "";
                Double q = iPieces >= 0 && iPieces < p.length ? nombre(p[iPieces]) : null;
                double qte = q == null ? 0 : q;
                if (f.derniereFoisLancee(cle, avant) != null) dejaLancees += qte;
                else rajouts += qte;
            }
            Ligne deja = new Ligne();
            deja.libelle = "Casse";
            deja.base = l.nom;
            deja.pieces = dejaLancees;
            c.casse.add(deja);
            Ligne rajout = new Ligne();
            rajout.libelle = "RAJOUT";
            rajout.base = l.nom;
            rajout.pieces = rajouts;
            c.casse.add(rajout);
        }
        return c;
    }

    private static int rang(Ligne l) {
        String poste = "Recyclage Agglo 1er tour".equals(l.libelle) ? "Recyclage" : l.libelle;
        return Math.max(0, ORDRE.indexOf(poste));
    }

    static double total(List<Ligne> lignes) {
        double t = 0;
        for (Ligne l : lignes) if (l.pieces != null) t += l.pieces;
        return t;
    }

    // ---- semaines ISO ----

    /** Lundi de la semaine ISO (UTC). */
    static Calendar lundi(int annee, int semaine) {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT);
        c.clear();
        c.set(annee, Calendar.JANUARY, 4);
        int jour = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7; // lundi = 0
        c.add(Calendar.DAY_OF_MONTH, -jour + (semaine - 1) * 7);
        return c;
    }

    /** Numéro de semaine ISO d'une date (UTC). */
    static int semaineIso(Calendar date) {
        Calendar d = (Calendar) date.clone();
        int jour = (d.get(Calendar.DAY_OF_WEEK) + 5) % 7 + 1; // lundi = 1 … dimanche = 7
        d.add(Calendar.DAY_OF_MONTH, 4 - jour); // jeudi de la même semaine
        return (d.get(Calendar.DAY_OF_YEAR) - 1) / 7 + 1;
    }

    /** La casse lancée en semaine N est la casse de la semaine d'avant (N − 1, l'année d'avant pour la semaine 1). */
    static int semaineAvant(int annee, int semaine) {
        Calendar c = lundi(annee, semaine);
        c.add(Calendar.DAY_OF_MONTH, -7);
        return semaineIso(c);
    }

    private static final String[] MOIS = {"janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"};

    /** « Du lundi 9 au vendredi 13 novembre » (comme la page web). */
    static String datesSemaine(int annee, int semaine) {
        Calendar lundi = lundi(annee, semaine);
        Calendar vendredi = (Calendar) lundi.clone();
        vendredi.add(Calendar.DAY_OF_MONTH, 4);
        String fin = vendredi.get(Calendar.DAY_OF_MONTH) + " " + MOIS[vendredi.get(Calendar.MONTH)];
        String debut = lundi.get(Calendar.MONTH) == vendredi.get(Calendar.MONTH)
                ? String.valueOf(lundi.get(Calendar.DAY_OF_MONTH))
                : lundi.get(Calendar.DAY_OF_MONTH) + " " + MOIS[lundi.get(Calendar.MONTH)];
        return "Du lundi " + debut + " au vendredi " + fin;
    }

    /** Nombre écrit comme la page web (« 884 », « 1.5 »). */
    static String fmt(double v) {
        return v == Math.rint(v) ? String.valueOf((long) v) : String.valueOf(v);
    }

    String nomFichier() {
        return "rapport_lancements_semaine_" + numero + ".pdf";
    }

    String titre() {
        return "Rapport des lancements — Semaine " + numero;
    }

    // ---- dessin (points PDF, A4 ; mêmes mesures que la page web) ----

    private static final float MM = 72f / 25.4f;
    static final int LARGEUR = 595;
    static final int HAUTEUR = 842;
    private static final float MARGE = 18 * MM;
    private static final float UTILE = LARGEUR - 2 * MARGE;
    private static final float BANDEAU = 7 * MM;
    private static final float LOGO = 38 * MM;
    private static final float BAS = HAUTEUR - 20 * MM;
    private static final float TAILLE = 8.8f;
    private static final float TAILLE_ENTETE = 8f;
    private static final float INTERLIGNE = 11f;
    private static final float REMPLISSAGE = 4.5f;
    private static final int BORDEAUX = 0xFF78140C;
    private static final int SAUMON = 0xFFEAC2B7;
    private static final int SAUMON_PALE = 0xFFFAF0EC;
    private static final int GRIS = 0xFF797978;
    private static final int GRIS_CLAIR = 0xFFF4F3F1;
    private static final int GRIS_FILET = 0xFFE9E7E3;
    private static final int NOIR = 0xFF22231D;
    private static final String[] COLONNES = {"Tours", "Lancement", "Pièces", "Remarque"};
    private static final float[] LARGEURS_MM = {44, 62, 22, 46};

    /** Pages du document : la première, puis une nouvelle à chaque saut de page. */
    interface Pages {
        Canvas nouvelle();
    }

    private final class Dessin {
        final Pages pages;
        final Typeface titre;
        final Typeface texte;
        final Typeface gras;
        final Typeface italique;
        final Bitmap logo;
        final int total;
        int page;
        Canvas c;
        final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);

        Dessin(Pages pages, Ui ui, Bitmap logo, int total) {
            this.pages = pages;
            this.total = total;
            titre = ui.raleway();
            texte = ui.lato();
            gras = ui.latoGras();
            italique = ui.latoItalique();
            this.logo = logo;
        }

        void nouvellePage() {
            if (c != null) piedDePage();
            c = pages.nouvelle();
            page++;
            rectangle(0, 0, LARGEUR, BANDEAU, BORDEAUX);
        }

        void rectangle(float x, float y, float l, float h, int couleur) {
            p.setStyle(Paint.Style.FILL);
            p.setColor(couleur);
            c.drawRect(x, y, x + l, y + h, p);
        }

        void filet(float x1, float x2, float y, int couleur, float epaisseur) {
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(epaisseur);
            p.setColor(couleur);
            c.drawLine(x1, y, x2, y, p);
            p.setStyle(Paint.Style.FILL);
        }

        float largeurTexte(String t, float taille, Typeface police, float espacement) {
            p.setTypeface(police);
            p.setTextSize(taille);
            p.setLetterSpacing(espacement / taille);
            float l = p.measureText(t);
            p.setLetterSpacing(0);
            return l;
        }

        void texte(float x, float y, String t, float taille, Typeface police, int couleur, float espacement) {
            p.setStyle(Paint.Style.FILL);
            p.setTypeface(police);
            p.setTextSize(taille);
            p.setColor(couleur);
            p.setLetterSpacing(espacement / taille);
            c.drawText(t, x, y, p);
            p.setLetterSpacing(0);
        }

        void texte(float x, float y, String t, float taille, Typeface police, int couleur) {
            texte(x, y, t, taille, police, couleur, 0);
        }

        /** Coupe un texte en lignes qui tiennent dans la largeur donnée. */
        List<String> couper(String t, float largeur, float taille, Typeface police) {
            List<String> lignes = new ArrayList<>();
            StringBuilder ligne = new StringBuilder();
            for (String mot : t.split(" ")) {
                String essai = ligne.length() == 0 ? mot : ligne + " " + mot;
                if (ligne.length() > 0 && largeurTexte(essai, taille, police, 0) > largeur) {
                    lignes.add(ligne.toString());
                    ligne = new StringBuilder(mot);
                } else {
                    ligne = new StringBuilder(essai);
                }
            }
            lignes.add(ligne.toString());
            return lignes;
        }

        float[] largeurs() {
            float somme = 0;
            for (float v : LARGEURS_MM) somme += v;
            float[] l = new float[LARGEURS_MM.length];
            for (int i = 0; i < l.length; i++) l[i] = LARGEURS_MM[i] * UTILE / somme;
            return l;
        }

        /** Chiffre clé : valeur en Raleway bordeaux, légende en Lato gris, fond saumon pâle et barre bordeaux. */
        float chiffreCle(float x, float y, String valeur, String legende) {
            float l = 54 * MM;
            float h = 15 * MM;
            rectangle(x, y, l, h, SAUMON_PALE);
            rectangle(x, y, 3, h, BORDEAUX);
            texte(x + 12, y + 21, valeur, 17, titre, BORDEAUX);
            texte(x + 12, y + h - 7, legende, 7.8f, texte, GRIS);
            return x + l + 5 * MM;
        }

        /** Titre de partie : pastille numérotée et titre bordeaux ; renvoie le haut du tableau. */
        float titrePartie(float y, int numero, String t) {
            if (y + 80 > BAS) {
                nouvellePage();
                y = BANDEAU + 12 * MM;
            }
            y += 14;
            float r = 3 * MM;
            p.setStyle(Paint.Style.FILL);
            p.setColor(SAUMON);
            c.drawCircle(MARGE + r, y - 4, r, p);
            String n = String.format(Locale.ROOT, "%02d", numero);
            texte(MARGE + r - largeurTexte(n, 8, titre, 0) / 2, y - 1.2f, n, 8, titre, BORDEAUX);
            texte(MARGE + 2 * r + 8, y, t, 11.5f, titre, BORDEAUX);
            return y + 10;
        }

        float entete(float y, float[] l) {
            float h = 22;
            rectangle(MARGE, y, UTILE, h, BORDEAUX);
            float x = MARGE;
            for (int j = 0; j < COLONNES.length; j++) {
                String t = COLONNES[j].toUpperCase(Locale.FRANCE);
                float lt = largeurTexte(t, TAILLE_ENTETE, gras, 0.6f);
                float xt = j == 2 ? x + l[j] - REMPLISSAGE - lt : x + REMPLISSAGE;
                texte(xt, y + (h - 10) / 2 + 7.5f, t, TAILLE_ENTETE, gras, 0xFFFFFFFF, 0.6f);
                x += l[j];
            }
            return y + h;
        }

        Typeface policeCellule(boolean total, int j) {
            return total || j == 0 ? gras : texte;
        }

        float hauteurRangee(String[] cellules, float[] l, boolean total) {
            int n = 1;
            for (int j = 0; j < cellules.length; j++) n = Math.max(n, couper(cellules[j], l[j] - 2 * REMPLISSAGE, TAILLE, policeCellule(total, j)).size());
            return n * INTERLIGNE + 2 * REMPLISSAGE;
        }

        float rangee(float y, String[] cellules, float[] l, boolean total, int fond) {
            float h = hauteurRangee(cellules, l, total);
            if (fond != 0) rectangle(MARGE, y, UTILE, h, fond);
            float x = MARGE;
            for (int j = 0; j < cellules.length; j++) {
                Typeface police = policeCellule(total, j);
                List<String> morceaux = couper(cellules[j], l[j] - 2 * REMPLISSAGE, TAILLE, police);
                float haut = y + (h - morceaux.size() * INTERLIGNE) / 2 + INTERLIGNE - 2.5f;
                for (int k = 0; k < morceaux.size(); k++) {
                    String t = morceaux.get(k);
                    float xt = j == 2 ? x + l[j] - REMPLISSAGE - largeurTexte(t, TAILLE, police, 0) : x + REMPLISSAGE;
                    texte(xt, haut + k * INTERLIGNE, t, TAILLE, police, total ? 0xFFFFFFFF : NOIR);
                }
                x += l[j];
            }
            if (!total) filet(MARGE, MARGE + UTILE, y + h, GRIS_FILET, 0.5f);
            return y + h;
        }

        float tableau(float y, List<Ligne> lignes, String libelleTotal) {
            float[] l = largeurs();
            y = entete(y, l);
            List<String[]> rangees = new ArrayList<>();
            for (Ligne x : lignes) rangees.add(new String[] {x.libelle, x.base, x.pieces == null ? "—" : fmt(x.pieces), x.remarque});
            rangees.add(new String[] {libelleTotal, "", fmt(total(lignes)), ""});
            for (int i = 0; i < rangees.size(); i++) {
                boolean estTotal = i == rangees.size() - 1;
                if (y + hauteurRangee(rangees.get(i), l, estTotal) > BAS) {
                    nouvellePage();
                    y = entete(BANDEAU + 12 * MM, l);
                }
                int fond = estTotal ? BORDEAUX : i % 2 == 1 ? GRIS_CLAIR : 0;
                y = rangee(y, rangees.get(i), l, estTotal, fond);
            }
            return y;
        }

        /** Confidentialité à gauche, nom du document au centre, pagination à droite (7,5 pt, gris). */
        void piedDePage() {
            float y = HAUTEUR - 12 * MM;
            String nom = titre();
            texte(MARGE, y, "Document interne — LAISNÉ INDUSTRIE", 7.5f, texte, GRIS);
            texte(LARGEUR / 2f - largeurTexte(nom, 7.5f, texte, 0) / 2, y, nom, 7.5f, texte, GRIS);
            String numeroPage = page + " / " + Math.max(total, page);
            texte(LARGEUR - MARGE - largeurTexte(numeroPage, 7.5f, texte, 0), y, numeroPage, 7.5f, texte, GRIS);
        }

        void tout() {
            nouvellePage();
            float hLogo = 0;
            if (logo != null) {
                hLogo = LOGO * logo.getHeight() / logo.getWidth();
                Paint lisse = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
                float x = LARGEUR - MARGE - LOGO;
                float y = BANDEAU + 7 * MM;
                c.drawBitmap(logo, null, new RectF(x, y, x + LOGO, y + hLogo), lisse);
            }
            float y = BANDEAU + 7 * MM - 8;
            for (String ligne : couper("Rapport des lancements", UTILE - LOGO - 8 * MM, 26, titre)) {
                y += 30;
                texte(MARGE, y, ligne, 26, titre, GRIS);
            }
            y += 16;
            texte(MARGE, y, "Semaine " + numero + " · " + datesSemaine(annee, numero) + " " + annee, 11.5f, titre, BORDEAUX);
            y = Math.max(y + 10, BANDEAU + 7 * MM + hLogo + 8);
            filet(MARGE, LARGEUR - MARGE, y, SAUMON, 1);
            y += 12;
            float x = chiffreCle(MARGE, y, String.valueOf(numero), "Semaine");
            x = chiffreCle(x, y, fmt(total(lancements)), "Pièces (hors casse)");
            if (!casse.isEmpty()) chiffreCle(x, y, fmt(total(casse)), "Pièces de casse");
            y += 15 * MM + 14;
            y = titrePartie(y, 1, "Lancements de la semaine " + numero);
            if (!lancements.isEmpty()) y = tableau(y, lancements, "Total pièces (hors casse)");
            else texte(MARGE, y + 12, "Aucun lancement pour cette semaine.", 9.5f, gras, BORDEAUX);
            if (!casse.isEmpty()) {
                y = titrePartie(y + 10, 2, "Casse — SEMAINE " + semaineCasse);
                y = tableau(y, casse, "Total casse");
                texte(MARGE, y + 14, "Casse : pièces déjà lancées une semaine d'avant. RAJOUT : les autres pièces de la casse.", 7.8f, italique, GRIS);
            }
            piedDePage();
        }
    }

    private static Bitmap logo(Context contexte) {
        try {
            return BitmapFactory.decodeResource(contexte.getResources(), R.drawable.logo_laisne);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** Dessine le compte rendu sur des pages données (PDF, ou image pour vérifier la mise en page). */
    void dessiner(Context contexte, Ui ui, Pages pages, int totalPages) {
        new Dessin(pages, ui, logo(contexte), totalPages).tout();
    }

    /** Nombre de pages (dessin à blanc), pour écrire « 1 / 2 » dès la première page. */
    int nombrePages(Context contexte, Ui ui) {
        final List<Picture> brouillons = new ArrayList<>();
        dessiner(contexte, ui, () -> {
            Picture p = new Picture();
            brouillons.add(p);
            return p.beginRecording(LARGEUR, HAUTEUR);
        }, 0);
        for (Picture p : brouillons) p.endRecording();
        return brouillons.size();
    }

    /** Le PDF (A4). */
    byte[] pdf(Context contexte, Ui ui) throws IOException {
        int total = nombrePages(contexte, ui);
        PdfDocument document = new PdfDocument();
        final PdfDocument.Page[] courante = new PdfDocument.Page[1];
        final int[] numeroPage = {0};
        try {
            dessiner(contexte, ui, () -> {
                if (courante[0] != null) document.finishPage(courante[0]);
                courante[0] = document.startPage(new PdfDocument.PageInfo.Builder(LARGEUR, HAUTEUR, ++numeroPage[0]).create());
                return courante[0].getCanvas();
            }, total);
            if (courante[0] != null) document.finishPage(courante[0]);
            ByteArrayOutputStream sortie = new ByteArrayOutputStream();
            document.writeTo(sortie);
            return sortie.toByteArray();
        } finally {
            document.close();
        }
    }
}
