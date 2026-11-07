package com.marinedouyere.sentinelle.moteur;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Lecture de la liste de coupe Cutrite exportée en PDF : une ligne d'en-tête
 * par pièce ("N°. Description Matériau Long Largeur Qté") suivie de champs
 * numérotés ("5.num commande+ligne ...", "18.Grain matching ...").
 */
public final class LecteurCoupePdf {

    private LecteurCoupePdf() {}

    /** Morceau de texte positionné sur une page (y mesuré depuis le bas, comme dans le PDF). */
    public static final class ElementTexte {
        public final double x;
        public final double y;
        public final String texte;

        public ElementTexte(double x, double y, String texte) {
            this.x = x;
            this.y = y;
            this.texte = texte;
        }
    }

    /** Extraction du texte brut d'un PDF, fournie par la plateforme (PDFBox Android ou PDFBox). */
    public interface ExtracteurTexte {
        List<List<ElementTexte>> elementsParPage(byte[] pdf) throws Exception;
    }

    public static final class Enregistrement {
        public String desc;
        public String materiau;
        public int qte;
        public String detailTexte = "";
        public String cle;
        public String grain;
    }

    private static final Pattern MOTIF_ENTETE_PIECE =
            Pattern.compile("^(\\d+)\\.\\s*(\\S+)\\s+(\\S+)\\s+([\\d.,]+)\\s+([\\d.,]+)\\s+(\\d+)(?![A-Za-z0-9_])");
    private static final Pattern MOTIF_CLE_DETAIL = Pattern.compile("5\\.num commande\\+ligne\\s+([^,\\s]+)");
    private static final Pattern MOTIF_GRAIN_DETAIL = Pattern.compile("18\\.Grain matching\\s+([^,]+)");
    private static final Pattern MOTIF_RESERVE_NUE = Pattern.compile("^T\\d+/\\d+$", Pattern.CASE_INSENSITIVE);

    /** Reconstitue le texte ligne par ligne : mots regroupés par position verticale, triés de gauche à droite. */
    public static List<String> lignesTexte(List<List<ElementTexte>> pages) {
        List<String> toutes = new ArrayList<>();
        for (List<ElementTexte> page : pages) {
            Map<Long, List<ElementTexte>> parLigne = new TreeMap<>(Collections.<Long>reverseOrder());
            for (ElementTexte e : page) {
                if (e.texte == null || Js.trim(e.texte).isEmpty()) continue;
                long y = Math.round(e.y);
                List<ElementTexte> l = parLigne.get(y);
                if (l == null) {
                    l = new ArrayList<>();
                    parLigne.put(y, l);
                }
                l.add(e);
            }
            for (List<ElementTexte> l : parLigne.values()) {
                List<ElementTexte> triee = new ArrayList<>(l);
                Collections.sort(triee, new Comparator<ElementTexte>() {
                    @Override
                    public int compare(ElementTexte a, ElementTexte b) {
                        return Double.compare(a.x, b.x);
                    }
                });
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < triee.size(); i++) {
                    if (i > 0) sb.append(' ');
                    sb.append(triee.get(i).texte);
                }
                String ligne = Js.normaliserEspaces(sb.toString());
                if (!ligne.isEmpty()) toutes.add(ligne);
            }
        }
        return toutes;
    }

    public static List<Enregistrement> enregistrements(List<String> lignesTexte) {
        List<Enregistrement> records = new ArrayList<>();
        Enregistrement courant = null;
        for (String ligne : lignesTexte) {
            Matcher m = MOTIF_ENTETE_PIECE.matcher(ligne);
            if (m.find()) {
                if (courant != null) records.add(courant);
                courant = new Enregistrement();
                courant.desc = m.group(2);
                courant.materiau = m.group(3);
                courant.qte = Integer.parseInt(m.group(6));
            } else if (courant != null) {
                courant.detailTexte += " " + ligne;
            }
        }
        if (courant != null) records.add(courant);
        for (Enregistrement r : records) {
            Matcher cle = MOTIF_CLE_DETAIL.matcher(r.detailTexte);
            r.cle = cle.find() ? cle.group(1) : null;
            Matcher grain = MOTIF_GRAIN_DETAIL.matcher(r.detailTexte);
            r.grain = grain.find() ? Js.trim(grain.group(1)) : null;
        }
        return records;
    }

    public static List<Enregistrement> lire(byte[] pdf, ExtracteurTexte extracteur) throws ErreurLecture {
        try {
            return enregistrements(lignesTexte(extracteur.elementsParPage(pdf)));
        } catch (ErreurLecture e) {
            throw e;
        } catch (Exception e) {
            throw new ErreurLecture("PDF illisible : " + e.getMessage());
        }
    }

    static boolean estDescriptionPieceReelle(String desc) {
        if (desc == null || desc.isEmpty()) return false;
        String d = desc.toUpperCase(Locale.ROOT);
        if (d.startsWith("L")) return false; // décor/sous-face (L0001, LT1/1...)
        if (MOTIF_RESERVE_NUE.matcher(d).find()) return false; // réserve technique nue
        return !d.equals("GABARIT");
    }

    public static boolean estPieceReelle(Enregistrement r) {
        if (!estDescriptionPieceReelle(r.desc)) return false;
        return r.materiau == null || r.materiau.isEmpty()
                || !LecteurStrat.estProtection(r.materiau);
    }

    public static LecteurCoupe.Resultat compter(List<Enregistrement> records) throws ErreurLecture {
        List<Enregistrement> pieces = new ArrayList<>();
        for (Enregistrement r : records) if (r.cle != null && !r.cle.isEmpty() && estPieceReelle(r)) pieces.add(r);
        Map<String, Double> compteur = new LinkedHashMap<>();
        for (Enregistrement p : pieces) {
            Double avant = compteur.get(p.cle);
            compteur.put(p.cle, (avant == null ? 0 : avant) + p.qte);
        }
        double total = 0;
        for (double v : compteur.values()) total += v;
        if (total == 0) {
            throw new ErreurLecture("Aucune pièce n'a été reconnue dans le PDF de la liste de coupe : le format du fichier semble différent de celui attendu.");
        }
        List<String[]> clesEtGrains = new ArrayList<>();
        for (Enregistrement p : pieces) clesEtGrains.add(new String[] {p.cle, p.grain});
        return new LecteurCoupe.Resultat(compteur, LecteurCoupe.compterUnitaires(clesEtGrains, compteur));
    }

    public static Map<String, List<String>> grainMatching(List<Enregistrement> records) {
        Map<String, List<String>> resultat = new LinkedHashMap<>();
        for (Enregistrement r : records) {
            if (r.cle == null || r.cle.isEmpty() || !estPieceReelle(r)) continue;
            List<String> valeurs = resultat.get(r.cle);
            if (valeurs == null) {
                valeurs = new ArrayList<>();
                resultat.put(r.cle, valeurs);
            }
            if (r.grain != null && !r.grain.isEmpty() && !valeurs.contains(r.grain)) valeurs.add(r.grain);
        }
        return resultat;
    }
}
