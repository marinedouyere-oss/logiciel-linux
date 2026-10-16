package com.marinedouyere.sentinelle.moteur;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Lecture de la liste de coupe Cutrite au format Excel, comme lireCoupe() de l'appli web. */
public final class LecteurCoupe {

    private LecteurCoupe() {}

    private static final int COLONNE_CLE_PAR_DEFAUT = 15; // colonne P
    private static final int COLONNE_MATERIAU_PAR_DEFAUT = 1; // colonne B
    private static final int COLONNE_GRAIN_MATCHING_PAR_DEFAUT = 27; // colonne AB
    private static final Pattern MOTIF_GRAIN_MATCHING = Pattern.compile("^[A-Za-z]*\\d+:\\d+:\\d+$");
    /** "P1:TC:..." : la lettre après T vaut C pour la vraie pièce, autre chose pour une ligne technique. */
    private static final Pattern MOTIF_TYPE_TRACE = Pattern.compile("^([A-Za-z0-9]+):T([A-Z]):");
    private static final String TYPE_TRACE_PIECE = "C";
    /** Un modulo/bande ("T9/1") n'est jamais une pièce. */
    private static final Pattern MOTIF_DESCRIPTION_MODULE = Pattern.compile("^T\\d+/\\d+$");
    private static final double SEUIL_CONFIANCE_COLONNE_QUANTITE = 0.5;

    public static final class Resultat {
        public final Map<String, Double> compteur;
        public final Integer nbUnitaires;
        public final int nbPiecesTrouvees;

        public Resultat(Map<String, Double> compteur, Integer nbUnitaires) {
            this.compteur = compteur;
            this.nbUnitaires = nbUnitaires;
            this.nbPiecesTrouvees = compteur.size();
        }
    }

    private interface ScoreLigne {
        int score(Object[] ligne, int col);
    }

    private static final class Exclusion {
        final int col;
        final String valeur;

        Exclusion(int col, String valeur) {
            this.col = col;
            this.valeur = valeur;
        }
    }

    private static final class Piece {
        final String cle;
        final Object[] ligne;

        Piece(String cle, Object[] ligne) {
            this.cle = cle;
            this.ligne = ligne;
        }
    }

    private static Feuille feuillePrincipale(Classeur classeur) {
        Feuille meilleure = null;
        int meilleurNb = -1;
        for (Feuille f : classeur.feuilles) {
            if (f.nbLignes() > meilleurNb) {
                meilleure = f;
                meilleurNb = f.nbLignes();
            }
        }
        return meilleure;
    }

    /** Toutes les lignes sauf la première (en-têtes), chacune de la largeur de la feuille. */
    static List<Object[]> chargerLignes(Classeur classeur) throws ErreurLecture {
        Feuille f = feuillePrincipale(classeur);
        if (f == null || f.nbLignes() == 0) throw new ErreurLecture("Le fichier de la liste de coupe est vide.");
        int largeur = f.nbColonnes();
        List<Object[]> lignes = new ArrayList<>();
        for (int r = 2; r <= f.nbLignes(); r++) {
            Object[] arr = new Object[largeur];
            for (int c = 1; c <= largeur; c++) arr[c - 1] = f.valeur(r, c);
            lignes.add(arr);
        }
        return lignes;
    }

    private static Integer detecterColonne(List<Object[]> lignes, ScoreLigne scoreLigne) {
        int nbColonnes = 0;
        for (Object[] l : lignes) nbColonnes = Math.max(nbColonnes, l.length);
        Integer meilleurIndex = null;
        int meilleurScore = 0;
        for (int col = 0; col < nbColonnes; col++) {
            int score = 0;
            for (Object[] l : lignes) score += scoreLigne.score(l, col);
            if (score > meilleurScore) {
                meilleurIndex = col;
                meilleurScore = score;
            }
        }
        return meilleurIndex;
    }

    private static Object valeurA(Object[] ligne, int col) {
        return col < ligne.length ? ligne[col] : null;
    }

    private static String texteTrim(Object v) {
        return Js.trim(Js.texte(v));
    }

    static Integer detecterColonneCle(List<Object[]> lignes, Set<String> clesStrat) {
        if (clesStrat == null || clesStrat.isEmpty()) return null;
        return detecterColonne(lignes, (l, col) -> {
            Object v = valeurA(l, col);
            return v != null && clesStrat.contains(texteTrim(v)) ? 1 : 0;
        });
    }

    static Integer detecterColonneMateriau(List<Object[]> lignes) {
        return detecterColonne(lignes, (l, col) -> {
            Object v = valeurA(l, col);
            return v != null && texteTrim(v).toUpperCase(Locale.ROOT).equals("PROTECTION") ? 1 : 0;
        });
    }

    static Integer detecterColonneGrainMatching(List<Object[]> lignes) {
        return detecterColonne(lignes, (l, col) -> {
            Object v = valeurA(l, col);
            return v != null && MOTIF_GRAIN_MATCHING.matcher(texteTrim(v)).find() ? 1 : 0;
        });
    }

    static Integer detecterColonneTypeTrace(List<Object[]> lignes) {
        return detecterColonne(lignes, (l, col) -> {
            Object v = valeurA(l, col);
            return v != null && MOTIF_TYPE_TRACE.matcher(texteTrim(v)).find() ? 1 : 0;
        });
    }

    private static boolean estLignePiece(Object[] ligne, Integer colTypeTrace) {
        if (ligne.length > 0 && ligne[0] != null
                && MOTIF_DESCRIPTION_MODULE.matcher(texteTrim(ligne[0]).toUpperCase(Locale.ROOT)).find()) {
            return false;
        }
        if (colTypeTrace == null || colTypeTrace >= ligne.length) return true;
        Object valeur = ligne[colTypeTrace];
        if (valeur == null) return true;
        Matcher m = MOTIF_TYPE_TRACE.matcher(texteTrim(valeur));
        if (!m.find()) return true;
        return m.group(2).equals(TYPE_TRACE_PIECE);
    }

    private static List<Piece> lignesPieces(List<Object[]> lignes, int colCle, int colMateriau, Integer colTypeTrace,
            Exclusion exclusion) {
        List<Piece> resultat = new ArrayList<>();
        for (Object[] ligne : lignes) {
            if (colCle >= ligne.length || ligne[colCle] == null) continue;
            String cle = texteTrim(ligne[colCle]);
            Object materiau = valeurA(ligne, colMateriau);
            if (materiau != null && LecteurStrat.MATERIAUX_EXCLUS.contains(texteTrim(materiau).toUpperCase(Locale.ROOT))) continue;
            if (!estLignePiece(ligne, colTypeTrace)) continue;
            if (exclusion != null) {
                Object v = valeurA(ligne, exclusion.col);
                if (v != null && texteTrim(v).toUpperCase(Locale.ROOT).equals(exclusion.valeur)) continue;
            }
            resultat.add(new Piece(cle, ligne));
        }
        return resultat;
    }

    private static boolean egal(Integer a, int b) {
        return a != null && a == b;
    }

    private static Map<String, Double> sommeParCle(List<Piece> pieces, Integer colQuantite) {
        Map<String, Double> sommes = new LinkedHashMap<>();
        for (Piece p : pieces) {
            Object valeur = colQuantite != null ? valeurA(p.ligne, colQuantite) : null;
            Double n = Js.nombreOuNull(valeur);
            double quantite = n == null ? 1 : n;
            Double avant = sommes.get(p.cle);
            sommes.put(p.cle, (avant == null ? 0 : avant) + quantite);
        }
        return sommes;
    }

    private static int scoreCorrespondance(Map<String, Double> sommes, Map<String, Double> qteAttendueParCle) {
        int score = 0;
        for (Map.Entry<String, Double> s : sommes.entrySet()) {
            Double attendu = qteAttendueParCle.get(s.getKey());
            if (attendu != null && Math.abs(s.getValue() - attendu) < 1e-6) score++;
        }
        return score;
    }

    private static Exclusion detecterExclusionSupplementaire(List<Object[]> lignes, int colCle, int colMateriau,
            Integer colTypeTrace, Integer colQuantite, Map<String, Double> qteAttendueParCle) {
        if (qteAttendueParCle == null || qteAttendueParCle.isEmpty()) return null;
        List<Piece> pieces = lignesPieces(lignes, colCle, colMateriau, colTypeTrace, null);
        int scoreBase = scoreCorrespondance(sommeParCle(pieces, colQuantite), qteAttendueParCle);
        int nbColonnes = 0;
        for (Piece p : pieces) nbColonnes = Math.max(nbColonnes, p.ligne.length);

        Exclusion meilleur = null;
        int meilleurScore = scoreBase;
        for (int col = 0; col < nbColonnes; col++) {
            if (col == colCle || col == colMateriau || egal(colTypeTrace, col) || egal(colQuantite, col)) continue;
            Set<String> valeurs = new LinkedHashSet<>();
            for (Piece p : pieces) {
                Object v = valeurA(p.ligne, col);
                if (v != null) {
                    String t = texteTrim(v).toUpperCase(Locale.ROOT);
                    if (!t.isEmpty()) valeurs.add(t);
                }
            }
            if (valeurs.size() < 2 || valeurs.size() > 6) continue;
            for (String valeur : valeurs) {
                List<Piece> filtrees = new ArrayList<>();
                for (Piece p : pieces) {
                    Object v = valeurA(p.ligne, col);
                    if (v == null || !texteTrim(v).toUpperCase(Locale.ROOT).equals(valeur)) filtrees.add(p);
                }
                int score = scoreCorrespondance(sommeParCle(filtrees, colQuantite), qteAttendueParCle);
                if (score > meilleurScore) {
                    meilleur = new Exclusion(col, valeur);
                    meilleurScore = score;
                }
            }
        }
        double seuil = SEUIL_CONFIANCE_COLONNE_QUANTITE * qteAttendueParCle.size();
        return meilleur != null && meilleurScore >= seuil ? meilleur : null;
    }

    private static Integer detecterColonneQuantite(List<Object[]> lignes, int colCle, int colMateriau,
            Integer colTypeTrace, Map<String, Double> qteAttendueParCle) {
        if (qteAttendueParCle == null || qteAttendueParCle.isEmpty()) return null;
        List<Piece> pieces = lignesPieces(lignes, colCle, colMateriau, colTypeTrace, null);
        int nbColonnes = 0;
        for (Object[] l : lignes) nbColonnes = Math.max(nbColonnes, l.length);
        Integer meilleurIndex = null;
        int meilleurScore = 0;
        for (int col = 0; col < nbColonnes; col++) {
            if (col == colCle || col == colMateriau || egal(colTypeTrace, col)) continue;
            Map<String, Double> sommes = new LinkedHashMap<>();
            for (Piece p : pieces) {
                Double n = Js.nombreOuNull(valeurA(p.ligne, col));
                if (n == null) continue;
                Double avant = sommes.get(p.cle);
                sommes.put(p.cle, (avant == null ? 0 : avant) + n);
            }
            int score = scoreCorrespondance(sommes, qteAttendueParCle);
            if (score > meilleurScore) {
                meilleurIndex = col;
                meilleurScore = score;
            }
        }
        double seuil = SEUIL_CONFIANCE_COLONNE_QUANTITE * qteAttendueParCle.size();
        return meilleurScore >= seuil ? meilleurIndex : null;
    }

    /** Nombre de clés trouvées sans aucun grain matching ("unitaires"), null si la colonne est introuvable. */
    static Integer compterUnitaires(List<String[]> clesEtGrains, Map<String, Double> compteur) {
        Set<String> aGrain = new LinkedHashSet<>();
        for (String[] cg : clesEtGrains) {
            if (cg[1] != null && !Js.trim(cg[1]).isEmpty()) aGrain.add(cg[0]);
        }
        int nb = 0;
        for (String cle : compteur.keySet()) if (!aGrain.contains(cle)) nb++;
        return nb;
    }

    public static Resultat lire(Classeur classeur, Set<String> clesStrat, Map<String, Double> qteAttendueParCle)
            throws ErreurLecture {
        List<Object[]> lignes = chargerLignes(classeur);
        Map<String, Double> attendues = qteAttendueParCle == null ? new LinkedHashMap<String, Double>() : qteAttendueParCle;

        Integer colCleDetectee = detecterColonneCle(lignes, clesStrat);
        int colCle = colCleDetectee == null ? COLONNE_CLE_PAR_DEFAUT : colCleDetectee;
        Integer colMateriauDetectee = detecterColonneMateriau(lignes);
        int colMateriau = colMateriauDetectee == null ? COLONNE_MATERIAU_PAR_DEFAUT : colMateriauDetectee;
        Integer colTypeTrace = detecterColonneTypeTrace(lignes);
        Integer colQuantite = detecterColonneQuantite(lignes, colCle, colMateriau, colTypeTrace, attendues);
        Integer colGrain = detecterColonneGrainMatching(lignes);
        Exclusion exclusion = detecterExclusionSupplementaire(lignes, colCle, colMateriau, colTypeTrace, colQuantite, attendues);

        List<Piece> pieces = lignesPieces(lignes, colCle, colMateriau, colTypeTrace, exclusion);
        Map<String, Double> compteur = new LinkedHashMap<>();
        for (Piece p : pieces) {
            double quantite = 1;
            if (colQuantite != null && colQuantite < p.ligne.length) {
                Double n = Js.nombreOuNull(p.ligne[colQuantite]);
                if (n != null) quantite = n;
            }
            Double avant = compteur.get(p.cle);
            compteur.put(p.cle, (avant == null ? 0 : avant) + quantite);
        }
        double total = 0;
        for (double v : compteur.values()) total += v;
        if (total == 0) {
            throw new ErreurLecture("Aucune pièce n'a été reconnue dans la liste de coupe : le format du fichier semble différent de celui attendu.");
        }

        Integer nbUnitaires = null;
        if (colGrain != null) {
            List<String[]> clesEtGrains = new ArrayList<>();
            for (Piece p : pieces) {
                Object g = valeurA(p.ligne, colGrain);
                clesEtGrains.add(new String[] {p.cle, g == null ? null : Js.texte(g)});
            }
            nbUnitaires = compterUnitaires(clesEtGrains, compteur);
        }
        return new Resultat(compteur, nbUnitaires);
    }

    /** Valeurs de grain matching par clé (pour la recherche par bande/modulo). */
    public static Map<String, List<String>> grainMatching(Classeur classeur, Set<String> clesStrat) throws ErreurLecture {
        List<Object[]> lignes = chargerLignes(classeur);
        Integer colCleDetectee = detecterColonneCle(lignes, clesStrat);
        int colCle = colCleDetectee == null ? COLONNE_CLE_PAR_DEFAUT : colCleDetectee;
        Integer colMateriauDetectee = detecterColonneMateriau(lignes);
        int colMateriau = colMateriauDetectee == null ? COLONNE_MATERIAU_PAR_DEFAUT : colMateriauDetectee;
        Integer colGrainDetectee = detecterColonneGrainMatching(lignes);
        int colGrain = colGrainDetectee == null ? COLONNE_GRAIN_MATCHING_PAR_DEFAUT : colGrainDetectee;
        Integer colTypeTrace = detecterColonneTypeTrace(lignes);

        Map<String, List<String>> resultat = new LinkedHashMap<>();
        for (Piece p : lignesPieces(lignes, colCle, colMateriau, colTypeTrace, null)) {
            List<String> valeurs = resultat.get(p.cle);
            if (valeurs == null) {
                valeurs = new ArrayList<>();
                resultat.put(p.cle, valeurs);
            }
            Object brut = valeurA(p.ligne, colGrain);
            if (brut == null) continue;
            String valeur = texteTrim(brut);
            if (!valeur.isEmpty() && !valeurs.contains(valeur)) valeurs.add(valeur);
        }
        return resultat;
    }
}
