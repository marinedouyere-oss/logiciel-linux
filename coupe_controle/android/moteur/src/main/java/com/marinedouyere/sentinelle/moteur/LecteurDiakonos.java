package com.marinedouyere.sentinelle.moteur;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Fichier de contrôle Diakonos (ex. « diakonos46t1.xlsx » : semaine 46,
 * 1er tour) : les pièces commandées, une ligne par commande + ligne. Chaque
 * pièce doit se trouver dans un lancement du même tour.
 */
public final class LecteurDiakonos {

    private LecteurDiakonos() {}

    private static final Pattern MOTIF_NOM =
            Pattern.compile("DIAKONOS\\D*?(\\d{1,4})(?:\\D*?T(?:OUR)?\\D{0,3}?0?([12])(?!\\d))?", Pattern.CASE_INSENSITIVE);
    private static final Pattern MOTIF_CHIFFRES = Pattern.compile("\\d+");

    /** Une pièce commandée. */
    public static final class Piece {
        public String cle;
        public String commande;
        public String ligne;
        public String catalogue = "";
        public String article = "";
        public String designation = "";
        public Double longueur;
        public Double largeur;
        public Double epaisseur;
        public String coloris = "";

        /** « 2200 × 600 » */
        public String dimensions() {
            if (longueur == null || largeur == null) return "";
            return Js.dimension(longueur) + " × " + Js.dimension(largeur);
        }
    }

    /** Semaine et tour lus dans le nom du fichier (null s'ils n'y sont pas). */
    public static final class Nom {
        public String semaine;
        public String tour;
    }

    public static boolean estDiakonos(String nomFichier) {
        return nomFichier != null && nomFichier.toUpperCase(Locale.ROOT).contains("DIAKONOS");
    }

    /** « diakonos46t1.xlsx » → semaine « 46 », tour « 1 » ; null si le nom ne parle pas de Diakonos. */
    public static Nom decoderNom(String nomFichier) {
        if (!estDiakonos(nomFichier)) return null;
        Nom n = new Nom();
        Matcher m = MOTIF_NOM.matcher(nomFichier);
        if (m.find()) {
            String s = m.group(1);
            // « diakonos2646t1 » : année + semaine.
            n.semaine = String.format(Locale.ROOT, "%02d", Integer.parseInt(s.length() > 2 ? s.substring(s.length() - 2) : s));
            n.tour = m.group(2);
        }
        return n;
    }

    /**
     * Semaine et tour d'un code de lancement : « LAN264601 » → {« 46 », « 1 »},
     * « LAN2646TRIGANO » → {« 46 », null} ; null si le code n'a pas de semaine.
     */
    public static String[] semaineEtTour(String codeLancement) {
        if (codeLancement == null) return null;
        Matcher m = MOTIF_CHIFFRES.matcher(codeLancement);
        while (m.find()) {
            String c = m.group();
            if (c.length() >= 6) return new String[] {c.substring(2, 4), String.valueOf(Integer.parseInt(c.substring(4, 6)))};
            if (c.length() == 4) return new String[] {c.substring(2, 4), null};
        }
        return null;
    }

    private static String normaliser(Object entete) {
        if (entete == null) return "";
        String s = Normalizer.normalize(Js.trim(Js.texte(entete)), Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        return s.toLowerCase(Locale.ROOT);
    }

    private static Double dimension(Object v) {
        if (v == null) return null;
        if (v instanceof Number) return Js.nombreOuNull(v);
        return Js.nombreOuNull(Js.texte(v).replaceAll(Js.CLASSE_ESPACES, ""));
    }

    private static String texte(Feuille f, int r, Integer c) {
        if (c == null) return "";
        Object v = f.valeur(r, c);
        return v == null ? "" : Js.trim(Js.texte(v));
    }

    public static List<Piece> lire(Classeur classeur) throws ErreurLecture {
        for (Feuille f : classeur.feuilles) {
            Map<String, Integer> col = new LinkedHashMap<>();
            for (Map.Entry<Integer, Object> e : f.cellulesDeLaLigne(1).entrySet()) {
                String nom = normaliser(e.getValue());
                if (!col.containsKey(nom)) col.put(nom, e.getKey());
            }
            Integer commande = col.get("commande");
            Integer ligne = col.get("ligne");
            if (commande == null || ligne == null) continue;
            Integer longueur = col.containsKey("longueur") ? col.get("longueur") : col.get("longeur");
            Map<String, Piece> pieces = new LinkedHashMap<>();
            for (int r = 2; r <= f.nbLignes(); r++) {
                String cmd = texte(f, r, commande);
                Object lig = f.valeur(r, ligne);
                if (cmd.isEmpty() || lig == null) continue;
                Piece p = new Piece();
                p.commande = cmd;
                p.ligne = LecteurStrat.fmtLigne(lig);
                p.cle = LecteurStrat.cleLigne(cmd, lig);
                p.catalogue = texte(f, r, col.get("catalogue"));
                p.article = texte(f, r, col.get("article"));
                p.designation = texte(f, r, col.get("designation"));
                p.longueur = longueur == null ? null : dimension(f.valeur(r, longueur));
                p.largeur = col.get("largeur") == null ? null : dimension(f.valeur(r, col.get("largeur")));
                p.epaisseur = col.get("epaisseur") == null ? null : dimension(f.valeur(r, col.get("epaisseur")));
                p.coloris = texte(f, r, col.containsKey("code coloris") ? col.get("code coloris") : col.get("coloris"));
                if (!pieces.containsKey(p.cle)) pieces.put(p.cle, p);
            }
            return new ArrayList<>(pieces.values());
        }
        throw new ErreurLecture("Aucune feuille du fichier Diakonos ne contient les colonnes « Commande » et « Ligne ».");
    }

    /** Pièces commandées qui ne sont dans aucun des lancements (clés commande + ligne). */
    public static List<Piece> manquantes(Collection<Piece> pieces, Set<String> clesLancees) {
        List<Piece> manquantes = new ArrayList<>();
        for (Piece p : pieces) if (!clesLancees.contains(p.cle)) manquantes.add(p);
        return manquantes;
    }
}
