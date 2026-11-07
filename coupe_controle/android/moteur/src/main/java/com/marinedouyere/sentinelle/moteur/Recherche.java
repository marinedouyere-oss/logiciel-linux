package com.marinedouyere.sentinelle.moteur;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Recherche d'une clé (commande+ligne), d'une commande ou d'une
 * bande/modulo ("T9", "T9/1") dans tous les fichiers chargés — identique à
 * rechercherGrainMatchingGlobal() de l'appli web.
 */
public final class Recherche {

    private Recherche() {}

    /** Bases où chercher, au choix : fichier de lancement, liste de coupe, .bkp, fichier Diakonos. */
    public static final String BASE_LAN = "LAN";
    public static final String BASE_LISTE = "Liste";
    public static final String BASE_BKP = ".bkp";
    public static final String BASE_DIAKONOS = "Diakonos";
    /** Dans l'ordre de l'atelier : Diakonos, lancement, liste de coupe, .bkp. */
    public static final List<String> BASES = Arrays.asList(BASE_DIAKONOS, BASE_LAN, BASE_LISTE, BASE_BKP);

    private static final Pattern MOTIF_BANDE = Pattern.compile("^L?T\\s*(\\d+)(?:/\\d+)?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern MOTIF_PREFIXE = Pattern.compile("^[A-Z]+");
    private static final Pattern MOTIF_GRAIN_BKP = Pattern.compile("\\bT\\d+:[\\d\\s\\u00A0]*:\\d+\\b");

    // Champs du détail d'une pièce dans la liste de coupe PDF.
    private static final String[][] CHAMPS_DETAIL_PDF = {
        {"lancement", "1\\.Lancement\\s+([^,]+)"},
        {"epaisseur", "6\\.Epaisseur\\s+([^,]+)"},
        {"chantAV", "11\\.Chant AV\\s+([^,]+)"},
        {"chantAR", "12\\.Chant AR\\s+([^,]+)"},
        {"chantG", "13\\.Chant G\\s+([^,]+)"},
        {"chantD", "14\\.Chant D\\s+([^,]+)"},
        {"angleAVG", "20\\.Angle AV G\\s+([^,]+)"},
        {"angleAVD", "21\\.Angle AV D\\s+([^,]+)"},
        {"angleARG", "22\\.Angle AR G\\s+([^,]+)"},
        {"angleARD", "23\\.Angle AR D\\s+([^,]+)"},
        {"assemblage", "44\\.Assemblage\\s+([^,]+)"},
        {"typeChant", "48\\.Type chant\\s+([^,]+)"},
    };
    private static final Pattern MOTIF_DIMENSIONS_FINIES_PDF =
            Pattern.compile("52\\.L\\*l\\*ep fini\\s+([\\d.,]+)\\s*X\\s*([\\d.,]+)\\s*X\\s*([\\d.,]+)");

    /** Numéro de bande d'une recherche "T9" / "T9/1" / "LT9/1", sinon null. */
    public static String numeroBande(String requete) {
        Matcher m = MOTIF_BANDE.matcher(Js.trim(requete));
        return m.find() ? m.group(1) : null;
    }

    public static Set<String> clesDeLaBande(Map<String, List<String>> grainParCle, String numeroBande) {
        Pattern motif = Pattern.compile("^T" + numeroBande + ":", Pattern.CASE_INSENSITIVE);
        Set<String> cles = new LinkedHashSet<>();
        for (Map.Entry<String, List<String>> e : grainParCle.entrySet()) {
            for (String v : e.getValue()) {
                if (motif.matcher(v).find()) {
                    cles.add(e.getKey());
                    break;
                }
            }
        }
        return cles;
    }

    /** Grain matching par clé lu dans le texte du .ctt d'un .bkp (même format que la liste de coupe). */
    static Map<String, List<String>> grainMatchingCtt(String texte) {
        Map<String, List<String>> resultat = new LinkedHashMap<>();
        for (String ligne : texte.split("\\r?\\n", -1)) {
            if (!ligne.startsWith("PNL2,")) continue;
            String[] champs = ligne.split(",", -1);
            String cle = champs.length > 5 ? champs[5] : "";
            if (cle.isEmpty()) continue;
            Matcher m = MOTIF_GRAIN_BKP.matcher(ligne);
            List<String> valeurs = new ArrayList<>();
            while (m.find()) valeurs.add(m.group());
            if (valeurs.isEmpty()) continue;
            List<String> liste = resultat.get(cle);
            if (liste == null) {
                liste = new ArrayList<>();
                resultat.put(cle, liste);
            }
            for (String v : valeurs) if (!liste.contains(v)) liste.add(v);
        }
        return resultat;
    }

    /** Quantités et grain matching d'un .bkp. */
    public static final class DonneesBkp {
        public final Map<String, Double> qteParCle;
        public final Map<String, List<String>> grainParCle;

        DonneesBkp(Map<String, Double> qteParCle, Map<String, List<String>> grainParCle) {
            this.qteParCle = qteParCle;
            this.grainParCle = grainParCle;
        }
    }

    public static DonneesBkp lireBkp(byte[] octets, String nomFichier) throws ErreurLecture {
        List<LecteurBkp.EntreeZip> entrees = LecteurBkp.listerEntrees(octets);
        LecteurBkp.EntreeZip ctt = LecteurBkp.trouverCttMaitre(entrees, LecteurBkp.nomLancement(nomFichier));
        String texte = new String(LecteurBkp.extraire(octets, ctt), StandardCharsets.ISO_8859_1);
        return new DonneesBkp(LecteurBkp.quantitesCtt(texte, true), grainMatchingCtt(texte));
    }

    /** Ce qu'on sait d'une pièce pour la dessiner et l'afficher. */
    public static final class ChampsDetail {
        public final Map<String, String> pdf = new LinkedHashMap<>();
        public String lancement;
        public String assemblage;
        public Double longueurFinie;
        public Double largeurFinie;
        public Double epaisseurFinie;
        public Map<String, String> toutesDonnees;

        public String champ(String nom) {
            return pdf.get(nom);
        }
    }

    public static ChampsDetail champsDetailPdf(String detailTexte) {
        ChampsDetail c = new ChampsDetail();
        for (String[] def : CHAMPS_DETAIL_PDF) {
            Matcher m = Pattern.compile(def[1]).matcher(detailTexte);
            c.pdf.put(def[0], m.find() ? Js.trim(m.group(1)) : null);
        }
        c.lancement = c.pdf.get("lancement");
        c.assemblage = c.pdf.get("assemblage");
        Matcher dim = MOTIF_DIMENSIONS_FINIES_PDF.matcher(detailTexte);
        if (dim.find()) {
            c.longueurFinie = Js.nombreOuNull(dim.group(1));
            c.largeurFinie = Js.nombreOuNull(dim.group(2));
            c.epaisseurFinie = Js.nombreOuNull(dim.group(3));
        }
        return c;
    }

    private static String nonVide(String s) {
        return s == null || s.isEmpty() ? null : s;
    }

    static ChampsDetail depuisStrat(LecteurStrat.LigneStrat l, ChampsDetail base) {
        ChampsDetail c = base != null ? base : new ChampsDetail();
        String lancement = nonVide(l.lancement);
        String assemblage = nonVide(l.assemblage);
        c.lancement = lancement != null ? lancement : (base != null ? c.lancement : null);
        c.assemblage = assemblage != null ? assemblage : (base != null ? c.assemblage : null);
        if (l.longueurFinie != null) c.longueurFinie = l.longueurFinie;
        if (l.largeurFinie != null) c.largeurFinie = l.largeurFinie;
        if (l.epaisseurFinie != null) c.epaisseurFinie = l.epaisseurFinie;
        c.toutesDonnees = l.toutesDonnees;
        return c;
    }

    /** Liste de coupe déjà chargée : classeur Excel ou enregistrements PDF. */
    public static final class Coupe {
        public final Classeur classeur;
        public final List<LecteurCoupePdf.Enregistrement> records;

        public Coupe(Classeur classeur, List<LecteurCoupePdf.Enregistrement> records) {
            this.classeur = classeur;
            this.records = records;
        }

        boolean estPdf() {
            return records != null;
        }
    }

    /** Une case (poste ou chantier) dont les fichiers sont fouillés. */
    public interface Source {
        String nom();

        boolean aCoupe();

        boolean aBkp();

        boolean aStrat();

        /** Lignes du fichier de lancement (mises en cache par l'appelant). */
        List<LecteurStrat.LigneStrat> lignesStrat() throws Exception;

        Coupe coupe() throws Exception;

        DonneesBkp bkp() throws Exception;

        /** Case du fichier Diakonos (pièces commandées). */
        default boolean aDiakonos() {
            return false;
        }

        default List<LecteurDiakonos.Piece> piecesDiakonos() throws Exception {
            return Collections.emptyList();
        }
    }

    public static final class Trouvaille {
        public Source source;
        /** Base où la pièce a été trouvée (BASE_LAN, BASE_LISTE, BASE_BKP, BASE_DIAKONOS). */
        public String base;
        public String cle;
        /** null : grain matching sans objet (fichier de lancement seul). */
        public List<String> valeurs;
        public Double quantite;
        public ChampsDetail champs;
        public boolean sansCoupe;
        public boolean sourceBkp;
    }

    public static final class Resultat {
        public String requete;
        public String numeroBande;
        public int nbSources;
        public final List<Trouvaille> trouvailles = new ArrayList<>();
        public final List<String> erreurs = new ArrayList<>();
        /** Commande unique concernée (pour son schéma d'ensemble), sinon null. */
        public String commandeUnique;
    }

    private static String message(Exception e) {
        return e.getMessage() != null ? e.getMessage() : e.toString();
    }

    private static LecteurStrat.LigneStrat ligneDeCle(Source s, String cle) {
        try {
            for (LecteurStrat.LigneStrat l : s.lignesStrat()) if (l.cle.equals(cle)) return l;
        } catch (Exception ignoree) {
            // le fichier de lancement reste optionnel pour la recherche
        }
        return null;
    }

    /** Clé sans le préfixe de la commande : « CVC26100810001 » → « 26100810001 ». */
    static String sansPrefixe(String cle) {
        return MOTIF_PREFIXE.matcher(cle.toUpperCase(Locale.ROOT)).replaceFirst("");
    }

    /** Le « CVC » est facultatif : « 26100810 » trouve CVC26100810001, CVC26100810002… */
    public static boolean correspond(String cle, String requete, boolean exacte) {
        if (exacte ? cle.equals(requete) : cle.startsWith(requete)) return true;
        if (requete.isEmpty() || !Character.isDigit(requete.charAt(0))) return false;
        String chiffres = sansPrefixe(cle);
        return exacte ? chiffres.equals(requete) : chiffres.startsWith(requete);
    }

    private static Set<String> clesCibles(String requete, String numeroBande, Collection<String> toutesLesCles,
            Map<String, List<String>> grainParCle) {
        if (numeroBande != null) return clesDeLaBande(grainParCle, numeroBande);
        Set<String> exactes = new LinkedHashSet<>();
        for (String c : toutesLesCles) if (correspond(c, requete, true)) exactes.add(c);
        if (!exactes.isEmpty()) return exactes;
        Set<String> cles = new LinkedHashSet<>();
        for (String c : toutesLesCles) if (correspond(c, requete, false)) cles.add(c);
        return cles;
    }

    private static boolean aUneBase(Source s, Set<String> bases) {
        return (bases.contains(BASE_LISTE) && s.aCoupe()) || (bases.contains(BASE_BKP) && s.aBkp())
                || (bases.contains(BASE_LAN) && s.aStrat()) || (bases.contains(BASE_DIAKONOS) && s.aDiakonos());
    }

    /** Recherche dans toutes les bases ; renvoie null si la requête est vide. */
    public static Resultat rechercher(String requeteBrute, List<? extends Source> toutes) {
        return rechercher(requeteBrute, toutes, new HashSet<>(BASES));
    }

    /** Recherche dans les bases choisies de toutes les sources ; renvoie null si la requête est vide. */
    public static Resultat rechercher(String requeteBrute, List<? extends Source> toutes, Set<String> bases) {
        String requete = Js.trim(requeteBrute).toUpperCase(Locale.ROOT);
        if (requete.isEmpty()) return null;
        Resultat res = new Resultat();
        res.requete = requete;
        List<Source> sources = new ArrayList<>();
        for (Source s : toutes) if (aUneBase(s, bases)) sources.add(s);
        res.nbSources = sources.size();
        if (sources.isEmpty()) return res;

        String numeroBande = numeroBande(requete);
        res.numeroBande = numeroBande;

        for (Source s : sources) {
            if (bases.contains(BASE_LISTE) && s.aCoupe()) chercherDansLaListe(s, requete, numeroBande, res);
            if (bases.contains(BASE_BKP) && s.aBkp()) {
                try {
                    DonneesBkp bkp = s.bkp();
                    for (String cle : clesCibles(requete, numeroBande, bkp.qteParCle.keySet(), bkp.grainParCle)) {
                        Trouvaille t = new Trouvaille();
                        t.source = s;
                        t.base = BASE_BKP;
                        t.cle = cle;
                        List<String> v = bkp.grainParCle.get(cle);
                        t.valeurs = v != null ? v : new ArrayList<>();
                        t.quantite = bkp.qteParCle.get(cle);
                        if (s.aStrat()) {
                            LecteurStrat.LigneStrat l = ligneDeCle(s, cle);
                            if (l != null) t.champs = depuisStrat(l, null);
                        }
                        t.sansCoupe = true;
                        t.sourceBkp = true;
                        res.trouvailles.add(t);
                    }
                } catch (Exception e) {
                    res.erreurs.add(s.nom() + " : " + message(e));
                }
            }
            if (numeroBande != null) continue;
            if (bases.contains(BASE_LAN) && s.aStrat()) {
                try {
                    List<LecteurStrat.LigneStrat> lignes = s.lignesStrat();
                    Map<String, LecteurStrat.LigneStrat> parCle = new LinkedHashMap<>();
                    for (LecteurStrat.LigneStrat l : lignes) parCle.put(l.cle, l);
                    for (String cle : clesCibles(requete, null, parCle.keySet(), null)) {
                        LecteurStrat.LigneStrat l = parCle.get(cle);
                        Trouvaille t = new Trouvaille();
                        t.source = s;
                        t.base = BASE_LAN;
                        t.cle = l.cle;
                        t.valeurs = null;
                        t.quantite = l.qteAttendue;
                        t.champs = depuisStrat(l, null);
                        t.sansCoupe = true;
                        res.trouvailles.add(t);
                    }
                } catch (Exception e) {
                    res.erreurs.add(s.nom() + " : " + message(e));
                }
            }
            if (bases.contains(BASE_DIAKONOS) && s.aDiakonos()) {
                try {
                    Map<String, LecteurDiakonos.Piece> parCle = new LinkedHashMap<>();
                    for (LecteurDiakonos.Piece p : s.piecesDiakonos()) parCle.put(p.cle, p);
                    for (String cle : clesCibles(requete, null, parCle.keySet(), null)) {
                        Trouvaille t = new Trouvaille();
                        t.source = s;
                        t.base = BASE_DIAKONOS;
                        t.cle = cle;
                        t.valeurs = null;
                        t.champs = depuisDiakonos(parCle.get(cle));
                        t.sansCoupe = true;
                        res.trouvailles.add(t);
                    }
                } catch (Exception e) {
                    res.erreurs.add(s.nom() + " : " + message(e));
                }
            }
        }

        if (numeroBande == null) {
            Set<String> commandes = new LinkedHashSet<>();
            for (Trouvaille t : res.trouvailles) commandes.add(t.cle.length() >= 3 ? t.cle.substring(0, t.cle.length() - 3) : "");
            if (commandes.size() == 1) res.commandeUnique = commandes.iterator().next();
        }
        return res;
    }

    /** Ce que dit le fichier Diakonos d'une pièce commandée. */
    static ChampsDetail depuisDiakonos(LecteurDiakonos.Piece p) {
        ChampsDetail c = new ChampsDetail();
        c.longueurFinie = p.longueur;
        c.largeurFinie = p.largeur;
        c.epaisseurFinie = p.epaisseur;
        Map<String, String> donnees = new LinkedHashMap<>();
        donnees.put("Commande", p.commande);
        donnees.put("Ligne", p.ligne);
        if (!p.catalogue.isEmpty()) donnees.put("Catalogue", p.catalogue);
        if (!p.article.isEmpty()) donnees.put("Article", p.article);
        if (!p.designation.isEmpty()) donnees.put("Désignation", p.designation);
        if (!p.dimensions().isEmpty()) donnees.put("Dimensions", p.dimensions());
        if (!p.coloris.isEmpty()) donnees.put("Coloris", p.coloris);
        c.toutesDonnees = donnees;
        return c;
    }

    private static void chercherDansLaListe(Source s, String requete, String numeroBande, Resultat res) {
        try {
            Coupe coupe = s.coupe();
            Set<String> clesStrat = new LinkedHashSet<>();
            Map<String, Double> qteAttendue = new LinkedHashMap<>();
            if (s.aStrat()) {
                try {
                    for (LecteurStrat.LigneStrat l : s.lignesStrat()) {
                        clesStrat.add(l.cle);
                        qteAttendue.put(l.cle, l.qteAttendue);
                    }
                } catch (Exception ignoree) {
                    // sans fichier de lancement lisible : colonnes par défaut
                }
            }
            Map<String, List<String>> grainParCle = coupe.estPdf()
                    ? LecteurCoupePdf.grainMatching(coupe.records)
                    : LecteurCoupe.grainMatching(coupe.classeur, clesStrat);
            Set<String> cles = clesCibles(requete, numeroBande, grainParCle.keySet(), grainParCle);
            Map<String, Double> compteur = null;
            if (!cles.isEmpty()) {
                try {
                    compteur = coupe.estPdf()
                            ? LecteurCoupePdf.compter(coupe.records).compteur
                            : LecteurCoupe.lire(coupe.classeur, clesStrat, qteAttendue).compteur;
                } catch (Exception e) {
                    compteur = null; // le grain matching reste affiché même si le comptage échoue
                }
            }
            for (String cle : cles) {
                Trouvaille t = new Trouvaille();
                t.source = s;
                t.base = BASE_LISTE;
                t.cle = cle;
                List<String> v = grainParCle.get(cle);
                t.valeurs = v != null ? v : new ArrayList<>();
                t.quantite = compteur != null ? compteur.get(cle) : null;
                ChampsDetail champs = null;
                if (coupe.estPdf()) {
                    for (LecteurCoupePdf.Enregistrement r : coupe.records) {
                        if (cle.equals(r.cle) && LecteurCoupePdf.estPieceReelle(r)) {
                            champs = champsDetailPdf(r.detailTexte);
                            break;
                        }
                    }
                }
                if (s.aStrat()) {
                    LecteurStrat.LigneStrat l = ligneDeCle(s, cle);
                    if (l != null) champs = depuisStrat(l, champs);
                }
                t.champs = champs;
                res.trouvailles.add(t);
            }
        } catch (Exception e) {
            res.erreurs.add(s.nom() + " : " + message(e));
        }
    }

    /** Une pièce (une clé) et tout ce qu'en disent les différents fichiers où elle a été trouvée. */
    public static final class PieceTrouvee {
        public final String cle;
        public final List<Trouvaille> sources = new ArrayList<>();
        /** Grain matching, toutes sources confondues. */
        public final List<String> grains = new ArrayList<>();
        /** Détail le plus complet disponible (avec dimensions de préférence). */
        public ChampsDetail champs;

        PieceTrouvee(String cle) {
            this.cle = cle;
        }

        public String commande() {
            return cle.length() >= 3 ? cle.substring(0, cle.length() - 3) : "";
        }
    }

    /** Regroupe les trouvailles par clé, dans l'ordre des clés (commande puis ligne). */
    public static List<PieceTrouvee> regrouper(List<Trouvaille> trouvailles) {
        Map<String, PieceTrouvee> parCle = new java.util.TreeMap<>();
        for (Trouvaille t : trouvailles) {
            PieceTrouvee p = parCle.get(t.cle);
            if (p == null) {
                p = new PieceTrouvee(t.cle);
                parCle.put(t.cle, p);
            }
            p.sources.add(t);
            if (t.valeurs != null) for (String v : t.valeurs) if (!p.grains.contains(v)) p.grains.add(v);
            if (t.champs != null && (p.champs == null || (p.champs.longueurFinie == null && t.champs.longueurFinie != null))) {
                p.champs = t.champs;
            }
        }
        return new ArrayList<>(parCle.values());
    }

    /** Toutes les lignes d'une commande, tous fichiers de lancement chargés confondus (une par clé). */
    public static List<LecteurStrat.LigneStrat> lignesDeLaCommande(String commande, List<? extends Source> sources) {
        Map<String, LecteurStrat.LigneStrat> parCle = new LinkedHashMap<>();
        for (Source s : sources) {
            if (!s.aStrat()) continue;
            List<LecteurStrat.LigneStrat> lignes;
            try {
                lignes = s.lignesStrat();
            } catch (Exception e) {
                continue;
            }
            for (LecteurStrat.LigneStrat l : lignes) {
                if (commande.equals(l.commande) && !parCle.containsKey(l.cle)) parCle.put(l.cle, l);
            }
        }
        return new ArrayList<>(parCle.values());
    }
}
