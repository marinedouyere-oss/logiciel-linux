package com.marinedouyere.sentinelle.moteur;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
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

    private static final Pattern MOTIF_BANDE = Pattern.compile("^L?T\\s*(\\d+)(?:/\\d+)?$", Pattern.CASE_INSENSITIVE);
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
        return new DonneesBkp(LecteurBkp.quantitesCtt(texte), grainMatchingCtt(texte));
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
    }

    public static final class Trouvaille {
        public Source source;
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

    private static Set<String> clesCibles(String requete, String numeroBande, Map<String, ?> parCle,
            Map<String, List<String>> grainParCle) {
        if (numeroBande != null) return clesDeLaBande(grainParCle, numeroBande);
        Set<String> cles = new LinkedHashSet<>();
        if (parCle.containsKey(requete)) {
            cles.add(requete);
            return cles;
        }
        for (String c : parCle.keySet()) if (c.startsWith(requete)) cles.add(c);
        return cles;
    }

    /** Recherche dans toutes les sources ; renvoie null si la requête est vide. */
    public static Resultat rechercher(String requeteBrute, List<? extends Source> toutes) {
        String requete = Js.trim(requeteBrute).toUpperCase(Locale.ROOT);
        if (requete.isEmpty()) return null;
        Resultat res = new Resultat();
        res.requete = requete;
        List<Source> sources = new ArrayList<>();
        for (Source s : toutes) if (s.aCoupe() || s.aBkp() || s.aStrat()) sources.add(s);
        res.nbSources = sources.size();
        if (sources.isEmpty()) return res;

        String numeroBande = numeroBande(requete);
        res.numeroBande = numeroBande;

        for (Source s : sources) {
            if (!s.aCoupe()) {
                if (s.aBkp()) {
                    try {
                        DonneesBkp bkp = s.bkp();
                        for (String cle : clesCibles(requete, numeroBande, bkp.qteParCle, bkp.grainParCle)) {
                            Trouvaille t = new Trouvaille();
                            t.source = s;
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
                    continue;
                }
                if (numeroBande != null || !s.aStrat()) continue;
                try {
                    for (LecteurStrat.LigneStrat l : s.lignesStrat()) {
                        if (!l.cle.equals(requete) && !l.cle.startsWith(requete)) continue;
                        Trouvaille t = new Trouvaille();
                        t.source = s;
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
                continue;
            }

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
                Set<String> cles = clesCibles(requete, numeroBande, grainParCle, grainParCle);
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

        if (numeroBande == null) {
            Set<String> commandes = new LinkedHashSet<>();
            for (Trouvaille t : res.trouvailles) commandes.add(t.cle.length() >= 3 ? t.cle.substring(0, t.cle.length() - 3) : "");
            if (commandes.size() == 1) res.commandeUnique = commandes.iterator().next();
        }
        return res;
    }

    public static final String MESSAGE_AUCUNE_SOURCE = "Sélectionnez au moins un fichier de lancement ou une liste de coupe.";

    /** Message quand rien n'est trouvé. */
    public static String messageIntrouvable(Resultat r) {
        String quoi = r.numeroBande != null ? "bande/modulo T" + r.numeroBande : "clé ou commande " + r.requete;
        return quoi + " introuvable dans les " + r.nbSources
                + " poste(s)/lancement(s) sélectionné(s) (liste de coupe, .bkp et/ou fichier de lancement).";
    }

    /** Libellé de la quantité affichée pour une trouvaille. */
    public static String libelleQuantite(Trouvaille t) {
        return t.sourceBkp ? "Quantité trouvée (.bkp)" : t.sansCoupe ? "Quantité attendue (fichier de lancement)" : "Quantité trouvée";
    }

    /** Note sous l'en-tête d'une trouvaille (null si la liste de coupe a servi). */
    public static String noteSource(Trouvaille t) {
        if (t.sourceBkp) return "Pas de liste de coupe pour ce poste — données du .bkp (réellement optimisé).";
        if (t.sansCoupe) return "Pas de liste de coupe ni de .bkp pour ce poste — données du fichier de lancement uniquement.";
        return null;
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
