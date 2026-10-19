package com.marinedouyere.sentinelle.moteur;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.text.Collator;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;

/**
 * Lecture d'un fichier .bkp (sauvegarde ZIP du logiciel d'optimisation V12)
 * pour le Contrôle Scies : quantités réellement optimisées par clé, lues
 * dans le fichier .ctt maître du lancement.
 */
public final class LecteurBkp {

    private LecteurBkp() {}

    private static final Pattern MOTIF_BANDE_MODULO = Pattern.compile("^L?T\\d+/\\d+$");
    private static final Pattern MOTIF_PNL3 = Pattern.compile("^PNL3,([A-Z]+\\d+):(T[A-Z0-9]+):");
    private static final Pattern MOTIF_DATE_SAUVEGARDE = Pattern.compile("_\\d{4}-\\d{2}-\\d{2}.*$", Pattern.CASE_INSENSITIVE);

    static final class EntreeZip {
        String nom;
        int methode;
        long tailleCompressee;
        long tailleReelle;
        long offsetEnTeteLocal;
    }

    /** Nom du lancement d'après le nom du .bkp ("LAN264101STRAT_2026-09-22_0923_v12backup.bkp" -> "LAN264101STRAT"). */
    public static String nomLancement(String nomFichier) {
        String sansDate = MOTIF_DATE_SAUVEGARDE.matcher(nomFichier).replaceFirst("");
        return sansDate.replaceFirst("(?i)\\.bkp$", "");
    }

    static List<EntreeZip> listerEntrees(byte[] octets) throws ErreurLecture {
        ByteBuffer vue = ByteBuffer.wrap(octets).order(ByteOrder.LITTLE_ENDIAN);
        int taille = octets.length;
        int finPos = -1;
        int debutRecherche = Math.max(0, taille - 22 - 65536);
        for (int i = taille - 22; i >= debutRecherche; i--) {
            if (vue.getInt(i) == 0x06054b50) {
                finPos = i;
                break;
            }
        }
        if (finPos == -1) throw new ErreurLecture("Archive .bkp invalide (fin de répertoire central introuvable).");
        int nbEntrees = vue.getShort(finPos + 10) & 0xFFFF;
        long offsetCentral = vue.getInt(finPos + 16) & 0xFFFFFFFFL;

        List<EntreeZip> entrees = new ArrayList<>();
        for (int i = 0; i < nbEntrees; i++) {
            int o = (int) offsetCentral;
            if (o + 46 > taille || vue.getInt(o) != 0x02014b50) break;
            EntreeZip e = new EntreeZip();
            e.methode = vue.getShort(o + 10) & 0xFFFF;
            e.tailleCompressee = vue.getInt(o + 20) & 0xFFFFFFFFL;
            e.tailleReelle = vue.getInt(o + 24) & 0xFFFFFFFFL;
            int longueurNom = vue.getShort(o + 28) & 0xFFFF;
            int longueurExtra = vue.getShort(o + 30) & 0xFFFF;
            int longueurCommentaire = vue.getShort(o + 32) & 0xFFFF;
            e.offsetEnTeteLocal = vue.getInt(o + 42) & 0xFFFFFFFFL;
            e.nom = new String(octets, o + 46, longueurNom, StandardCharsets.UTF_8);
            entrees.add(e);
            offsetCentral += 46 + longueurNom + longueurExtra + longueurCommentaire;
        }
        return entrees;
    }

    static byte[] extraire(byte[] octets, EntreeZip entree) throws ErreurLecture {
        ByteBuffer vue = ByteBuffer.wrap(octets).order(ByteOrder.LITTLE_ENDIAN);
        int base = (int) entree.offsetEnTeteLocal;
        if (vue.getInt(base) != 0x04034b50) throw new ErreurLecture("En-tête local ZIP invalide.");
        int longueurNom = vue.getShort(base + 26) & 0xFFFF;
        int longueurExtra = vue.getShort(base + 28) & 0xFFFF;
        int debut = base + 30 + longueurNom + longueurExtra;
        int longueur = (int) entree.tailleCompressee;
        if (entree.methode == 0) {
            byte[] copie = new byte[longueur];
            System.arraycopy(octets, debut, copie, 0, longueur);
            return copie;
        }
        if (entree.methode != 8) throw new ErreurLecture("Méthode de compression ZIP non supportée (code " + entree.methode + ").");
        Inflater inflater = new Inflater(true);
        try {
            inflater.setInput(octets, debut, longueur);
            byte[] sortie = new byte[(int) entree.tailleReelle];
            int lus = 0;
            while (lus < sortie.length && !inflater.finished()) {
                int n = inflater.inflate(sortie, lus, sortie.length - lus);
                if (n == 0 && (inflater.needsInput() || inflater.needsDictionary())) break;
                lus += n;
            }
            return sortie;
        } catch (DataFormatException e) {
            throw new ErreurLecture("Archive .bkp corrompue : " + e.getMessage());
        } finally {
            inflater.end();
        }
    }

    private static String nomCourt(String nom) {
        String[] morceaux = nom.split("[/\\\\]");
        return morceaux.length == 0 ? nom : morceaux[morceaux.length - 1];
    }

    static EntreeZip trouverCttMaitre(List<EntreeZip> entrees, String nomLancement) throws ErreurLecture {
        List<EntreeZip> candidats = new ArrayList<>();
        for (EntreeZip e : entrees) if (e.nom.toLowerCase(Locale.ROOT).endsWith(".ctt")) candidats.add(e);
        if (candidats.isEmpty()) throw new ErreurLecture("Aucun fichier .ctt trouvé dans l'archive .bkp.");
        if (nomLancement != null && !nomLancement.isEmpty()) {
            String cible = nomLancement.toLowerCase(Locale.ROOT) + ".ctt";
            for (EntreeZip e : candidats) if (nomCourt(e.nom).toLowerCase(Locale.ROOT).equals(cible)) return e;
        }
        EntreeZip meilleur = null;
        for (EntreeZip e : candidats) {
            if (nomCourt(e.nom).contains("_")) continue;
            if (meilleur == null || e.tailleReelle > meilleur.tailleReelle) meilleur = e;
        }
        if (meilleur != null) return meilleur;
        throw new ErreurLecture("Fichier .ctt maître introuvable dans l'archive .bkp (tous les .ctt trouvés ont un suffixe).");
    }

    private static String champ(String[] c, int i) {
        return i < c.length ? c[i] : null;
    }

    /** Quantités réellement optimisées par clé, d'après le texte du .ctt maître. */
    static Map<String, Double> quantitesCtt(String texte) {
        String[] lignes = texte.split("\\r?\\n", -1);
        String[] pnl1Nom = null;
        int pnl1Qte = 0;
        String pnl2Cle = null;
        boolean pnl1 = false;
        boolean pnl2 = false;
        Map<String, List<Object[]>> pieces = new LinkedHashMap<>(); // id -> {nom, qte, cle}
        for (String ligne : lignes) {
            if (ligne.startsWith("PNL1,")) {
                String[] c = ligne.split(",", -1);
                pnl1Nom = new String[] {champ(c, 1)};
                pnl1Qte = Js.parseIntOuZero(champ(c, 5));
                pnl1 = true;
            } else if (ligne.startsWith("PNL2,")) {
                String[] c = ligne.split(",", -1);
                String cle = champ(c, 5);
                pnl2Cle = cle == null || cle.isEmpty() ? "" : cle;
                pnl2 = true;
            } else if (ligne.startsWith("PNL3,")) {
                Matcher m = MOTIF_PNL3.matcher(ligne);
                if (m.find() && pnl1 && pnl2) {
                    if (!m.group(2).equals("TC")) continue;
                    String id = m.group(1);
                    List<Object[]> liste = pieces.get(id);
                    if (liste == null) {
                        liste = new ArrayList<>();
                        pieces.put(id, liste);
                    }
                    liste.add(new Object[] {pnl1Nom[0], pnl1Qte, pnl2Cle});
                }
            }
        }

        Map<String, Double> qteParCle = new LinkedHashMap<>();
        for (Map.Entry<String, List<Object[]>> e : pieces.entrySet()) {
            if (!e.getKey().startsWith("P")) continue; // "C<n>" = bandes/chutes
            List<Object[]> reelles = new ArrayList<>();
            for (Object[] tc : e.getValue()) {
                String nom = (String) tc[0];
                if (nom == null || !MOTIF_BANDE_MODULO.matcher(nom).find()) reelles.add(tc);
            }
            if (reelles.isEmpty()) continue;
            String cle = (String) reelles.get(0)[2];
            if (cle == null || cle.isEmpty()) continue;
            double qte = 0;
            for (Object[] tc : reelles) qte += (Integer) tc[1];
            Double avant = qteParCle.get(cle);
            qteParCle.put(cle, (avant == null ? 0 : avant) + qte);
        }
        return qteParCle;
    }

    /** Lit un .bkp et renvoie les quantités réellement optimisées par clé. */
    public static Map<String, Double> lire(byte[] octets, String nomFichier) throws ErreurLecture {
        List<EntreeZip> entrees = listerEntrees(octets);
        EntreeZip ctt = trouverCttMaitre(entrees, nomLancement(nomFichier));
        String texte = new String(extraire(octets, ctt), StandardCharsets.ISO_8859_1);
        return quantitesCtt(texte);
    }

    public static final class Ecart {
        public String cle;
        public double attendu;
        public double trouve;

        public String type() {
            if (attendu == 0) return "en trop (absente du lancement)";
            if (trouve == 0) return "absente du .bkp";
            return "quantité différente";
        }
    }

    /** Écarts entre quantités attendues (lancement) et optimisées (.bkp), triés par clé. */
    public static List<Ecart> comparerScies(Map<String, Double> attendues, Map<String, Double> bkp) {
        Set<String> cles = new LinkedHashSet<>(attendues.keySet());
        cles.addAll(bkp.keySet());
        List<Ecart> ecarts = new ArrayList<>();
        for (String cle : cles) {
            Double a = attendues.get(cle);
            Double t = bkp.get(cle);
            double attendu = a == null ? 0 : a;
            double trouve = t == null ? 0 : t;
            if (attendu != trouve) {
                Ecart e = new Ecart();
                e.cle = cle;
                e.attendu = attendu;
                e.trouve = trouve;
                ecarts.add(e);
            }
        }
        final Collator collator = Collator.getInstance(Locale.ROOT);
        Collections.sort(ecarts, (x, y) -> collator.compare(x.cle, y.cle));
        return ecarts;
    }

    public static double somme(Map<String, Double> m) {
        double total = 0;
        for (double v : m.values()) total += v;
        return total;
    }
}
