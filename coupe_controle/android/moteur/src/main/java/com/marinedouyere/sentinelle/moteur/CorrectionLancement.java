package com.marinedouyere.sentinelle.moteur;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Corrections du fichier de lancement : Sentinelle écrit un NOUVEAU classeur
 * (l'original n'est jamais modifié) où seules les lignes concernées changent ;
 * tout le reste (mise en forme, autres colonnes, autres feuilles) est recopié
 * tel quel.
 */
public final class CorrectionLancement {

    private CorrectionLancement() {}

    /** Lignes à supprimer et clés concernées. */
    public static final class Doublons {
        /** Numéros de ligne Excel (à partir de 1), la première ligne de chaque groupe étant gardée. */
        public final TreeSet<Integer> lignes = new TreeSet<>();
        public final List<String> cles = new ArrayList<>();
        public String feuille;
    }

    /** « LAN264601START.xlsx » → « LAN264601START_corrige.xlsx ». */
    public static String nomCorrige(String nomFichier) {
        int point = nomFichier.lastIndexOf('.');
        String base = point > 0 ? nomFichier.substring(0, point) : nomFichier;
        return base.replaceAll("_corrige$", "") + "_corrige.xlsx";
    }

    private static String texte(Feuille f, int r, Integer c) {
        return Js.trim(brut(f, r, c));
    }

    private static String brut(Feuille f, int r, Integer c) {
        if (c == null) return "";
        Object v = f.valeur(r, c);
        return Js.estVide(v) ? "" : Js.texte(v);
    }

    /**
     * Lignes parfaitement identiques (même commande, ligne, article, quantité, lancement, agglo, semaine
     * de livraison), comme les doublons signalés par le contrôle (LecteurStrat) ; protections exclues.
     */
    public static Doublons doublons(Classeur classeur) throws ErreurLecture {
        LecteurStrat.FeuilleEtEntetes fe = LecteurStrat.trouverFeuilleEtEntetes(classeur);
        Feuille f = fe.feuille;
        Map<String, Integer> e = fe.entetes;
        Doublons d = new Doublons();
        d.feuille = f.nom;
        Map<String, Integer> premiere = new HashMap<>();
        Map<String, String> clesParSignature = new LinkedHashMap<>();
        for (int r = 2; r <= f.nbLignes(); r++) {
            if (f.ligneVide(r)) continue;
            String commande = texte(f, r, e.get(LecteurStrat.COL_COMMANDE));
            if (commande.isEmpty()) continue;
            Integer colAgglo = e.get(LecteurStrat.COL_AGGLO);
            if (colAgglo != null && LecteurStrat.estProtection(f.valeur(r, colAgglo))) continue;
            Object ligne = e.get(LecteurStrat.COL_LIGNE) == null ? null : f.valeur(r, e.get(LecteurStrat.COL_LIGNE));
            Double qte = Js.nombreOuNull(e.get(LecteurStrat.COL_QTE) == null ? null : f.valeur(r, e.get(LecteurStrat.COL_QTE)));
            // Même signature que les doublons du contrôle (article et lancement non rognés, comme LecteurStrat).
            String signature = String.join("\u0001", commande, ligne == null ? "" : Js.texte(ligne),
                    brut(f, r, e.get(LecteurStrat.COL_ARTICLE)), Js.nombre(qte == null ? 0 : qte), brut(f, r, e.get(LecteurStrat.COL_LANCEMENT)),
                    texte(f, r, e.get(LecteurStrat.COL_AGGLO)), texte(f, r, e.get(LecteurStrat.COL_LIVSEM)), texte(f, r, e.get(LecteurStrat.COL_LIVAN)));
            if (!premiere.containsKey(signature)) {
                premiere.put(signature, r);
                continue;
            }
            d.lignes.add(r);
            String cle = LecteurStrat.cleLigne(commande, ligne);
            if (!d.cles.contains(cle)) d.cles.add(cle);
        }
        return d;
    }

    /** Nouveau classeur sans les lignes en double. */
    public static byte[] sansDoublons(byte[] xlsx, Doublons d) throws IOException {
        return supprimerLignes(xlsx, d.feuille, d.lignes);
    }

    // ---- suppression de lignes au niveau des fichiers XML du classeur ----

    private static final Pattern MOTIF_FEUILLE = Pattern.compile("<sheet\\b[^>]*\\bname=\"([^\"]*)\"[^>]*\\br:id=\"([^\"]*)\"");
    private static final Pattern MOTIF_RELATION = Pattern.compile("<Relationship\\b[^>]*>");
    private static final Pattern MOTIF_LIGNE = Pattern.compile("<row\\b([^>]*?)(/>|>(.*?)</row>)", Pattern.DOTALL);
    private static final Pattern MOTIF_R = Pattern.compile("\\br=\"(\\d+)\"");
    private static final Pattern MOTIF_CELLULE = Pattern.compile("(<c\\b[^>]*?\\br=\")([A-Z]{1,3})(\\d+)(\")");
    private static final Pattern MOTIF_FORMULE = Pattern.compile("(<f\\b)([^>]*?)(/>|>(.*?)</f>)", Pattern.DOTALL);
    private static final Pattern MOTIF_REF_CELLULE =
            // Pas un nom de feuille (« LAN264601!A1 ») ni une fonction (« LOG10( »).
            Pattern.compile("(?<![A-Za-z0-9_.$'])(\\$?)([A-Z]{1,3})(\\$?)(\\d+)(?![A-Za-z0-9_(!'])");
    private static final Pattern MOTIF_ATTRIBUT_REF =
            Pattern.compile("\\b(ref|sqref|activeCell|topLeftCell)=\"([^\"]*)\"");

    private static String attribut(String balise, String nom) {
        Matcher m = Pattern.compile("\\b" + nom + "=\"([^\"]*)\"").matcher(balise);
        return m.find() ? m.group(1) : null;
    }

    /** Nouvelle position d'une ligne une fois les lignes supprimées (une ligne supprimée renvoie à celle d'avant). */
    static int decaler(int ligne, TreeSet<Integer> supprimees) {
        int avant = supprimees.headSet(ligne, false).size();
        return ligne - avant - (supprimees.contains(ligne) ? 1 : 0);
    }

    /** Décale les références A1 d'un texte (formule, plage « A1:AK319 », liste « A1 B2:C3 »). */
    static String decalerReferences(String texte, TreeSet<Integer> supprimees) {
        Matcher m = MOTIF_REF_CELLULE.matcher(texte);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            int ligne = Integer.parseInt(m.group(4));
            m.appendReplacement(sb, Matcher.quoteReplacement(m.group(1) + m.group(2) + m.group(3) + decaler(ligne, supprimees)));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static String decalerAttributs(String xml, TreeSet<Integer> supprimees) {
        Matcher m = MOTIF_ATTRIBUT_REF.matcher(xml);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            m.appendReplacement(sb, Matcher.quoteReplacement(m.group(1) + "=\"" + decalerReferences(m.group(2), supprimees) + "\""));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static String decalerFormules(String xml, TreeSet<Integer> supprimees) {
        Matcher m = MOTIF_FORMULE.matcher(xml);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String fin = m.group(4) == null ? m.group(3) : ">" + decalerReferences(m.group(4), supprimees) + "</f>";
            m.appendReplacement(sb, Matcher.quoteReplacement(m.group(1) + decalerAttributs(m.group(2), supprimees) + fin));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    /** Feuille sans les lignes données ; les lignes suivantes remontent (références et plages suivent). */
    static String supprimerLignesFeuille(String xml, TreeSet<Integer> supprimees) throws IOException {
        int debut = xml.indexOf("<sheetData");
        int fin = xml.indexOf("</sheetData>");
        if (debut < 0) throw new IOException("Feuille sans données.");
        if (fin < 0) return xml; // <sheetData/> : rien à supprimer
        StringBuilder donnees = new StringBuilder();
        Matcher m = MOTIF_LIGNE.matcher(xml.substring(debut, fin));
        int position = 0;
        String bloc = xml.substring(debut, fin);
        while (m.find()) {
            donnees.append(bloc, position, m.start());
            position = m.end();
            Matcher r = MOTIF_R.matcher(m.group(1));
            if (!r.find()) throw new IOException("Ligne sans numéro dans la feuille : format non pris en charge.");
            int numero = Integer.parseInt(r.group(1));
            if (supprimees.contains(numero)) continue;
            int nouveau = decaler(numero, supprimees);
            String attributs = m.group(1).substring(0, r.start()) + "r=\"" + nouveau + "\"" + m.group(1).substring(r.end());
            if (m.group(3) == null) {
                donnees.append("<row").append(attributs).append("/>");
                continue;
            }
            Matcher c = MOTIF_CELLULE.matcher(m.group(3));
            StringBuffer cellules = new StringBuffer();
            while (c.find()) c.appendReplacement(cellules, Matcher.quoteReplacement(c.group(1) + c.group(2) + nouveau + c.group(4)));
            c.appendTail(cellules);
            donnees.append("<row").append(attributs).append('>').append(decalerFormules(cellules.toString(), supprimees)).append("</row>");
        }
        donnees.append(bloc.substring(position));
        // Hors des lignes : dimension, filtre, fusions, mises en forme conditionnelles, sélection…
        return decalerAttributs(xml.substring(0, debut), supprimees) + donnees + decalerAttributs(xml.substring(fin), supprimees);
    }

    /** Recopie le classeur en supprimant des lignes d'une feuille. */
    public static byte[] supprimerLignes(byte[] xlsx, String nomFeuille, TreeSet<Integer> supprimees) throws IOException {
        Map<String, byte[]> parties = new LinkedHashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(xlsx))) {
            ZipEntry entree;
            while ((entree = zip.getNextEntry()) != null) {
                if (entree.isDirectory()) continue;
                ByteArrayOutputStream tampon = new ByteArrayOutputStream();
                byte[] bloc = new byte[16 * 1024];
                int lu;
                while ((lu = zip.read(bloc)) != -1) tampon.write(bloc, 0, lu);
                parties.put(entree.getName(), tampon.toByteArray());
            }
        }
        String workbook = new String(parties.get("xl/workbook.xml"), StandardCharsets.UTF_8);
        String rels = new String(parties.get("xl/_rels/workbook.xml.rels"), StandardCharsets.UTF_8);
        String idFeuille = null;
        Matcher f = MOTIF_FEUILLE.matcher(workbook);
        while (f.find()) if (f.group(1).equals(nomFeuille)) idFeuille = f.group(2);
        String chemin = null;
        Matcher r = MOTIF_RELATION.matcher(rels);
        while (r.find()) {
            if (idFeuille != null && idFeuille.equals(attribut(r.group(), "Id"))) {
                String cible = attribut(r.group(), "Target");
                chemin = cible.startsWith("/") ? cible.substring(1) : "xl/" + cible;
            }
        }
        if (chemin == null || !parties.containsKey(chemin)) throw new IOException("Feuille « " + nomFeuille + " » introuvable dans le classeur.");
        parties.put(chemin, supprimerLignesFeuille(new String(parties.get(chemin), StandardCharsets.UTF_8), supprimees).getBytes(StandardCharsets.UTF_8));

        // Noms définis (zone de filtre, zone d'impression…) de cette feuille.
        Matcher n = Pattern.compile("(<definedName\\b[^>]*>)([^<]*)(</definedName>)").matcher(workbook);
        StringBuffer sb = new StringBuffer();
        while (n.find()) {
            String contenu = n.group(2).contains(nomFeuille + "!") || n.group(2).contains("'" + nomFeuille + "'!")
                    ? decalerReferences(n.group(2), supprimees) : n.group(2);
            n.appendReplacement(sb, Matcher.quoteReplacement(n.group(1) + contenu + n.group(3)));
        }
        n.appendTail(sb);
        parties.put("xl/workbook.xml", sb.toString().getBytes(StandardCharsets.UTF_8));

        // La chaîne de calcul cite des cellules : Excel la reconstruit si elle manque.
        if (parties.remove("xl/calcChain.xml") != null) {
            parties.put("xl/_rels/workbook.xml.rels", rels.replaceAll("<Relationship\\b[^>]*calcChain[^>]*/>", "").getBytes(StandardCharsets.UTF_8));
            String types = new String(parties.get("[Content_Types].xml"), StandardCharsets.UTF_8);
            parties.put("[Content_Types].xml", types.replaceAll("<Override\\b[^>]*calcChain[^>]*/>", "").getBytes(StandardCharsets.UTF_8));
        }

        ByteArrayOutputStream sortie = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(sortie)) {
            for (Map.Entry<String, byte[]> p : parties.entrySet()) {
                zip.putNextEntry(new ZipEntry(p.getKey()));
                zip.write(p.getValue());
                zip.closeEntry();
            }
        }
        return sortie.toByteArray();
    }
}
