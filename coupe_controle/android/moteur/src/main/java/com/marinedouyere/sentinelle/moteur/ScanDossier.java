package com.marinedouyere.sentinelle.moteur;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Scan du dossier partagé : reconnaît dans le nom de chaque fichier à quel
 * poste, quelle semaine et quel lancement il appartient, puis répartit les
 * fichiers dans les cases — identique à scannerDossierPartage() de l'appli
 * web (convention "LAN&lt;AA&gt;&lt;SS&gt;&lt;TT&gt;&lt;suffixe&gt;", ex. "LAN264101STRAT.xlsx").
 */
public final class ScanDossier {

    private ScanDossier() {}

    public static final String POSTE_CHANTIERS = "Chantiers";
    public static final String PAIRE = "paire";
    public static final String IMPAIRE = "impaire";

    private static final Pattern MOTIF_DATE_SAUVEGARDE =
            Pattern.compile("_\\d{4}-\\d{2}-\\d{2}_\\d{3,4}.*$", Pattern.CASE_INSENSITIVE);
    private static final Pattern MOTIF_CODE_MOT_CLE =
            Pattern.compile("\\d{4,6}(?=(STRAT|START|FENO|CASSE))", Pattern.CASE_INSENSITIVE);
    private static final Pattern MOTIF_6_CHIFFRES = Pattern.compile("\\d{6}");
    private static final Pattern MOTIF_4_CHIFFRES = Pattern.compile("\\d{4}");
    private static final Pattern MOTIF_STRAT = Pattern.compile("STRAT|START");
    private static final Pattern MOTIF_SUFFIXE = Pattern.compile("^[A-Za-zÀ-ÖØ-öø-ÿ0-9-]+");
    private static final Pattern MOTIF_CHIFFRES = Pattern.compile("\\d+");

    /** Fichier présent dans le dossier : nom et date de dernière modification (ms). */
    public static final class Fichier {
        public final String nom;
        public final long dateModification;
        /** Référence propre à la plateforme (adresse du document Android...). */
        public final Object reference;

        public Fichier(String nom, long dateModification, Object reference) {
            this.nom = nom;
            this.dateModification = dateModification;
            this.reference = reference;
        }
    }

    /** Ce que le nom d'un fichier révèle (decoderNomFichierPartage). */
    public static final class InfoNom {
        public String code;
        public String poste;
        public String suffixe;
        public String parite;
        public boolean estCutrite;
        public boolean estBkp;
    }

    /** Un lancement retrouvé, avec ses fichiers, à placer dans une case. */
    public static final class Cible {
        public String poste;
        public String code;
        public String suffixe;
        public String parite;
        public Fichier strat;
        public Fichier coupe;
        public Fichier bkp;

        /** Identité d'un chantier ("code|suffixe"), mémorisée dans sa case. */
        public String identiteChantier() {
            return code + "|" + suffixe;
        }

        Cible copie() {
            Cible c = new Cible();
            c.poste = poste;
            c.code = code;
            c.suffixe = suffixe;
            c.parite = parite;
            c.strat = strat;
            c.coupe = coupe;
            c.bkp = bkp;
            return c;
        }
    }

    /** Résultat du scan pour l'onglet semaine depuis lequel il a été lancé. */
    public static final class Resultat {
        public int nbFichiers;
        public final List<String> nonReconnus = new ArrayList<>();
        /** Aucun fichier de lancement reconnu dans tout le dossier. */
        public boolean aucunLancement;
        public int ignoresAutreSemaine;
        /** Un lancement par poste fixe (le plus récent), dans l'ordre de l'appli web. */
        public final List<Cible> fixes = new ArrayList<>();
        /** Un lancement par chantier ("code|suffixe"). */
        public final List<Cible> chantiers = new ArrayList<>();
    }

    private static String sansDateSauvegarde(String nom) {
        return MOTIF_DATE_SAUVEGARDE.matcher(nom).replaceFirst("");
    }

    public static String trouverCodeLancement(String nomBrut) {
        String nom = sansDateSauvegarde(nomBrut);
        Matcher m = MOTIF_CODE_MOT_CLE.matcher(nom);
        if (m.find()) return m.group();
        m = MOTIF_6_CHIFFRES.matcher(nom);
        if (m.find()) return m.group();
        m = MOTIF_4_CHIFFRES.matcher(nom);
        if (m.find()) return m.group();
        return null;
    }

    public static String pariteDeSemaine(String code) {
        if (code.length() < 3) return null;
        String deux = code.substring(2, Math.min(4, code.length()));
        int semaine;
        try {
            semaine = Integer.parseInt(deux);
        } catch (NumberFormatException e) {
            return null;
        }
        return semaine % 2 == 0 ? PAIRE : IMPAIRE;
    }

    public static String extraireSuffixeLancement(String nomBrut, String code) {
        String nom = sansDateSauvegarde(nomBrut);
        int pos = nom.indexOf(code);
        if (pos == -1) return "";
        Matcher m = MOTIF_SUFFIXE.matcher(nom.substring(pos + code.length()));
        return m.find() ? m.group().toUpperCase(Locale.ROOT) : "";
    }

    private static boolean contientI(String texte, String motif) {
        return texte.toUpperCase(Locale.ROOT).contains(motif);
    }

    public static InfoNom decoderNom(String nom) {
        String code = trouverCodeLancement(nom);
        if (code == null) return null;
        String tour = code.length() == 6 ? code.substring(4, 6) : null;
        String nomMaj = nom.toUpperCase(Locale.ROOT);

        String poste = null;
        boolean strat = MOTIF_STRAT.matcher(nomMaj).find();
        if (nomMaj.contains("FENO")) poste = "Feno";
        else if (nomMaj.contains("CASSE")) poste = "Casse";
        else if (strat && "01".equals(tour)) poste = "Agglo 1er tour";
        else if (strat && "02".equals(tour)) poste = "Agglo 2ème tour";

        InfoNom info = new InfoNom();
        info.code = code;
        info.poste = poste;
        info.suffixe = extraireSuffixeLancement(nom, code);
        info.parite = pariteDeSemaine(code);
        String min = nom.toLowerCase(Locale.ROOT);
        info.estCutrite = contientI(nom, "CUTRITE") || contientI(nom, "COUPE") || min.endsWith(".pdf");
        info.estBkp = min.endsWith(".bkp");
        return info;
    }

    static List<String> extraireGroupesChiffres(String nom) {
        List<String> groupes = new ArrayList<>();
        Matcher m = MOTIF_CHIFFRES.matcher(nom);
        while (m.find()) groupes.add(m.group());
        return groupes;
    }

    static String motCleFenoCasse(String nom) {
        String nomMaj = nom.toUpperCase(Locale.ROOT);
        if (nomMaj.contains("FENO")) return "Feno";
        if (nomMaj.contains("CASSE")) return "Casse";
        return null;
    }

    static final class Ancrage {
        String poste;
        String code;
        String semaine;
        String tour;
    }

    private static String tranche(String s, int debut, int fin) {
        if (debut >= s.length()) return "";
        return s.substring(debut, Math.min(fin, s.length()));
    }

    static Ancrage associerFichierSansCode(String nom, List<Ancrage> ancrages) {
        List<String> groupes = extraireGroupesChiffres(nom);
        if (groupes.isEmpty()) return null;
        String motCle = motCleFenoCasse(nom);

        List<Ancrage> candidats = new ArrayList<>();
        for (Ancrage a : ancrages) if (groupes.contains(a.semaine)) candidats.add(a);
        if (candidats.isEmpty()) return null;
        if (candidats.size() == 1) return candidats.get(0);

        if (motCle != null) {
            for (Ancrage a : candidats) if (a.poste.equals(motCle)) return a;
        }
        String tourTrouve = null;
        for (String g : groupes) {
            if (g.equals("01") || g.equals("02")) {
                tourTrouve = g;
                break;
            }
        }
        if (tourTrouve != null) {
            for (Ancrage a : candidats) {
                if ((a.poste.equals("Agglo 1er tour") || a.poste.equals("Agglo 2ème tour")) && a.tour.equals(tourTrouve)) return a;
            }
        }
        return null;
    }

    private static final class Decode {
        final Fichier f;
        final InfoNom info;

        Decode(Fichier f, InfoNom info) {
            this.f = f;
            this.info = info;
        }
    }

    /**
     * Répartit les fichiers du dossier. {@code ordreDesNoms} reproduit le tri
     * localeCompare() du navigateur (Collator de la plateforme).
     */
    public static Resultat scanner(List<Fichier> fichiersDossier, String pariteScan, Comparator<String> ordreDesNoms) {
        Resultat res = new Resultat();
        List<Fichier> fichiers = new ArrayList<>(fichiersDossier);
        Collections.sort(fichiers, (a, b) -> ordreDesNoms.compare(a.nom, b.nom));
        res.nbFichiers = fichiers.size();

        List<Decode> decodes = new ArrayList<>();
        List<Fichier> sansCode = new ArrayList<>();
        for (Fichier f : fichiers) {
            InfoNom info = decoderNom(f.nom);
            if (info == null) sansCode.add(f);
            else decodes.add(new Decode(f, info));
        }

        Map<String, String> posteParCode = new HashMap<>();
        Map<String, String> posteParCodeEtSuffixe = new HashMap<>();
        for (Decode d : decodes) {
            if (d.info.poste == null) continue;
            if (!posteParCode.containsKey(d.info.code)) posteParCode.put(d.info.code, d.info.poste);
            posteParCodeEtSuffixe.put(d.info.code + "|" + d.info.suffixe, d.info.poste);
        }

        Map<String, Cible> groupes = new LinkedHashMap<>();
        for (Decode d : decodes) {
            InfoNom info = d.info;
            String poste;
            if (info.poste != null) poste = info.poste;
            else if (!info.suffixe.isEmpty()) poste = valeurOu(posteParCodeEtSuffixe.get(info.code + "|" + info.suffixe));
            else poste = valeurOu(posteParCode.get(info.code));
            if (!poste.equals(POSTE_CHANTIERS)) {
                Cible existant = groupes.get(poste + "|" + info.code);
                if (existant != null && !info.suffixe.isEmpty() && !existant.suffixe.isEmpty()
                        && !existant.suffixe.equals(info.suffixe)) {
                    poste = POSTE_CHANTIERS;
                }
            }
            String cleGroupe = poste.equals(POSTE_CHANTIERS)
                    ? poste + "|" + info.code + "|" + info.suffixe
                    : poste + "|" + info.code;
            Cible g = groupes.get(cleGroupe);
            if (g == null) {
                g = new Cible();
                g.poste = poste;
                g.code = info.code;
                g.suffixe = info.suffixe;
                g.parite = info.parite;
                groupes.put(cleGroupe, g);
            }
            if (info.estBkp) g.bkp = d.f;
            else if (info.estCutrite) g.coupe = d.f;
            else g.strat = d.f;
        }

        List<Ancrage> ancrages = new ArrayList<>();
        for (Cible g : groupes.values()) {
            Ancrage a = new Ancrage();
            a.poste = g.poste;
            a.code = g.code;
            a.semaine = tranche(g.code, 2, 4);
            a.tour = tranche(g.code, 4, 6);
            ancrages.add(a);
        }
        for (Fichier f : sansCode) {
            Ancrage ancrage = associerFichierSansCode(f.nom, ancrages);
            Cible g = ancrage == null ? null : groupes.get(ancrage.poste + "|" + ancrage.code);
            if (g == null) {
                res.nonReconnus.add(f.nom);
                continue;
            }
            if (f.nom.toLowerCase(Locale.ROOT).endsWith(".bkp")) g.bkp = f;
            else g.coupe = f;
        }

        if (groupes.isEmpty()) {
            res.aucunLancement = true;
            return res;
        }

        Map<String, Cible> ciblesFixes = new LinkedHashMap<>();
        Map<String, Cible> ciblesChantiers = new LinkedHashMap<>();
        for (Cible g : groupes.values()) {
            if (g.strat == null) continue;
            if (g.parite == null || !g.parite.equals(pariteScan)) {
                res.ignoresAutreSemaine++;
                continue;
            }
            long date = g.strat.dateModification;
            Map<String, Cible> cibles = g.poste.equals(POSTE_CHANTIERS) ? ciblesChantiers : ciblesFixes;
            String cle = g.poste.equals(POSTE_CHANTIERS) ? g.code + "|" + g.suffixe : g.poste + "|" + g.parite;
            Cible actuel = cibles.get(cle);
            if (actuel == null || date > actuel.strat.dateModification) cibles.put(cle, g.copie());
        }
        res.fixes.addAll(ciblesFixes.values());
        res.chantiers.addAll(ciblesChantiers.values());
        return res;
    }

    private static String valeurOu(String poste) {
        return poste != null ? poste : POSTE_CHANTIERS;
    }
}
