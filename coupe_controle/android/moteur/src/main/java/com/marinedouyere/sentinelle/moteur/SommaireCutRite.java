package com.marinedouyere.sentinelle.moteur;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * « Sommaire des matériaux » de Cut Rite (imprimé en PDF) : pour chaque
 * matière du lancement, le nombre de panneaux et de restes. Le texte arrive
 * ligne par ligne (LecteurCoupePdf.lignesTexte) : une ligne de description
 * « CODE DESCRIPTION… Epaisseur x Pqt. n », puis les quantités
 * « [CODE] [STRAT] panneaux restes » ; à la fin, le total.
 */
public final class SommaireCutRite {

    /** Couleurs de la feuille de réception (La Chapelle), dans son ordre, avec leur largeur de format. */
    public static final List<String> COULEURS_FEUILLE = Arrays.asList("1136", "1132", "1109", "1065", "1062", "1048", "1047",
            "1136-PF", "1132-PF", "1065-PF", "1062-PF", "1048-PF", "1047-PF");
    public static final String LARGEUR_FEUILLE = "2060";
    /** Couleurs des semaines, dans l'ordre du cycle (semaine 46 : rose, 47 : bleu, 48 : blanc…) ; la casse est en jaune. */
    private static final String[] CYCLE = {"BLANC", "ROSE", "BLEU"};
    public static final String COULEUR_CASSE = "JAUNE";

    private static final Pattern MOTIF_CODE = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9-]*$");
    private static final Pattern MOTIF_QUANTITES = Pattern.compile("^(?:(\\S+)\\s+)?(?:STRAT\\s+)?(\\d+)\\s+(\\d+)$");
    private static final Pattern MOTIF_LANCEMENT = Pattern.compile("(LAN\\w+?)-Code");
    private static final Pattern MOTIF_DATE =
            Pattern.compile("(?:Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche) (\\d+ \\S+ \\d{4}) (\\d\\d:\\d\\d)");
    private static final Pattern MOTIF_EPAISSEUR = Pattern.compile("Epaisseur\\s+(\\d+(?:\\.\\d+)?)");
    private static final Pattern MOTIF_EPAISSEUR_MM = Pattern.compile("(\\d+)\\s*MM\\b");
    private static final Pattern MOTIF_FORMAT = Pattern.compile("(\\d{4})\\*(\\d*)");

    public static final class Materiau {
        public String code;
        public String description;
        public int panneaux = -1;
        public int restes = -1;

        public Double epaisseur() {
            Matcher m = MOTIF_EPAISSEUR.matcher(description);
            if (m.find()) return Double.parseDouble(m.group(1));
            m = MOTIF_EPAISSEUR_MM.matcher(description);
            return m.find() ? Double.parseDouble(m.group(1)) : null;
        }

        /** Panneau d'agglo (ou mélaminé, martyr) : tout ce qui n'est pas un stratifié. */
        public boolean estAgglo() {
            Double e = epaisseur();
            return (e != null && e >= 2) || code.matches("^(SAG|SMEL|PROTECTION).*");
        }

        /** Description sans le code matière, l'épaisseur et les points de suspension. */
        public String designation() {
            String d = description.replaceAll("\\s*Epaiss.*$", "").replaceAll("^STRAT\\s+", "");
            return d.replace("...", "").trim();
        }

        /** « 4110 × 2060 » ; largeur coupée dans le sommaire : celle de la feuille de réception. */
        public String format() {
            Matcher m = MOTIF_FORMAT.matcher(description);
            if (!m.find()) return "—";
            return m.group(1) + " × " + (m.group(2).length() == 4 ? m.group(2) : LARGEUR_FEUILLE);
        }
    }

    public String lancement = "";
    public String date = "";
    public final List<Materiau> materiaux = new ArrayList<>();
    public int totalPanneaux;
    public int totalRestes;

    public static SommaireCutRite lire(List<String> lignes) throws ErreurLecture {
        SommaireCutRite s = new SommaireCutRite();
        Map<String, Materiau> parCode = new LinkedHashMap<>();
        Materiau courant = null;
        Integer[] total = null;
        for (String brute : lignes) {
            String l = Js.normaliserEspaces(brute);
            Matcher m = MOTIF_LANCEMENT.matcher(l);
            if (s.lancement.isEmpty() && m.find()) s.lancement = m.group(1);
            m = MOTIF_DATE.matcher(l);
            if (s.date.isEmpty() && m.find()) s.date = m.group(1) + " " + m.group(2);
            Matcher q = MOTIF_QUANTITES.matcher(l);
            if (q.matches()) {
                String code = q.group(1);
                if (courant != null && courant.panneaux < 0 && (code == null || code.equals(courant.code) || code.equals("STRAT"))) {
                    courant.panneaux = Integer.parseInt(q.group(2));
                    courant.restes = Integer.parseInt(q.group(3));
                } else if (code == null) {
                    total = new Integer[] {Integer.parseInt(q.group(2)), Integer.parseInt(q.group(3))};
                }
                continue;
            }
            String[] mots = l.split(" ");
            // Une suite de description (« 38.0 Pqt. 1 ») ne commence pas par un code matière.
            if (mots.length < 3 || !MOTIF_CODE.matcher(mots[0]).matches()) continue;
            if (mots[0].equals("LAISNE") || mots[0].equals("Sommaire") || mots[0].equals("Code")) continue;
            if (parCode.containsKey(mots[0])) continue;
            courant = new Materiau();
            courant.code = mots[0];
            courant.description = l.substring(mots[0].length()).trim();
            parCode.put(courant.code, courant);
        }
        for (Materiau mat : parCode.values()) {
            if (mat.panneaux < 0) throw new ErreurLecture("Sommaire Cut Rite : quantités introuvables pour « " + mat.code + " ».");
            s.materiaux.add(mat);
            s.totalPanneaux += mat.panneaux;
            s.totalRestes += mat.restes;
        }
        if (s.materiaux.isEmpty()) throw new ErreurLecture("Ce PDF n'est pas un sommaire des matériaux Cut Rite.");
        if (total != null && (total[0] != s.totalPanneaux || total[1] != s.totalRestes)) {
            throw new ErreurLecture("Sommaire Cut Rite mal lu : total " + total[0] + " / " + total[1] + ", lu " + s.totalPanneaux + " / "
                    + s.totalRestes + ".");
        }
        return s;
    }

    public List<Materiau> agglo() {
        List<Materiau> l = new ArrayList<>();
        for (Materiau m : materiaux) if (m.estAgglo()) l.add(m);
        return l;
    }

    public List<Materiau> strats() {
        List<Materiau> l = new ArrayList<>();
        for (Materiau m : materiaux) if (!m.estAgglo()) l.add(m);
        return l;
    }

    /** Couleurs de la feuille présentes dans le lancement, dans l'ordre de la feuille. */
    public List<Materiau> couleursFeuille() {
        List<Materiau> l = new ArrayList<>();
        for (String c : COULEURS_FEUILLE) for (Materiau m : materiaux) if (m.code.equals(c)) l.add(m);
        return l;
    }

    public List<String> couleursAbsentes() {
        List<String> l = new ArrayList<>();
        for (String c : COULEURS_FEUILLE) {
            boolean trouvee = false;
            for (Materiau m : materiaux) if (m.code.equals(c)) trouvee = true;
            if (!trouvee) l.add(c);
        }
        return l;
    }

    /** Hors gamme : couleur dont le code commence par une lettre (le contrebalancement RCB n'en est pas une). */
    public List<Materiau> horsGamme() {
        List<Materiau> l = new ArrayList<>();
        for (Materiau m : strats()) if (m.code.matches("^[A-Za-z].*") && !m.code.startsWith("RCB")) l.add(m);
        return l;
    }

    /** Couleur des étiquettes d'une semaine (46 : ROSE, 47 : BLEU, 48 : BLANC…), JAUNE pour la casse. */
    public static String couleurSemaine(int semaine, boolean casse) {
        if (casse) return COULEUR_CASSE;
        return CYCLE[((semaine % 3) + 3) % 3];
    }
}
