package com.marinedouyere.sentinelle.moteur;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Lecture du fichier de lancement (STRAT), comme lireStrat() de l'appli web. */
public final class LecteurStrat {

    private LecteurStrat() {}

    public static final String COL_COMMANDE = "conf_commande";
    public static final String COL_LIGNE = "conf_ligne";
    public static final String COL_ARTICLE = "conf_article";
    public static final String COL_QTE = "comdet_qte";
    public static final String COL_LANCEMENT = "comprod_lancement";
    public static final String COL_CLE = "commande+ligne";
    public static final String COL_AGGLO = "agglo";
    public static final String COL_LIVSEM = "com_livsem";
    public static final String COL_LIVAN = "com_livan";
    public static final String COL_ASSEMBLAGE = "info atelier assemblage";
    public static final String COL_DIMENSIONS_FINIES = "LongueurxLargeurxEpaisseur fini";
    private static final List<String> ENTETES_REQUISES = Arrays.asList(COL_COMMANDE, COL_LIGNE, COL_ARTICLE, COL_QTE);
    private static final Pattern MOTIF_DIMENSIONS_FINIES =
            Pattern.compile("([\\d.,]+)\\s*X\\s*([\\d.,]+)\\s*X\\s*([\\d.,]+)", Pattern.CASE_INSENSITIVE);

    /** Un panneau de protection n'est pas une pièce commandée par le client. */
    public static final Set<String> MATERIAUX_EXCLUS = Collections.singleton("PROTECTION");

    public static final class LigneStrat {
        public String cle;
        public double qteAttendue;
        public String commande;
        public String ligne;
        public String article;
        public String lancement;
        public String assemblage;
        public Double longueurFinie;
        public Double largeurFinie;
        public Double epaisseurFinie;
        public Map<String, String> toutesDonnees;
    }

    public static final class Doublon {
        public String cle;
        public String commande;
        public String ligne;
        public int nbLignes;
        public List<String> articles = new ArrayList<>();
        public List<Double> quantites = new ArrayList<>();
    }

    public static final class SemaineLivraison {
        public String annee;
        public String semaine;
        public int nbPieces;
    }

    public static final class Resultat {
        public final List<LigneStrat> lignes = new ArrayList<>();
        public final List<Doublon> doublons = new ArrayList<>();
        public final List<SemaineLivraison> semaines = new ArrayList<>();

        public Set<String> cles() {
            Set<String> cles = new HashSet<>();
            for (LigneStrat l : lignes) cles.add(l.cle);
            return cles;
        }

        public Map<String, Double> qteParCle() {
            Map<String, Double> m = new LinkedHashMap<>();
            for (LigneStrat l : lignes) m.put(l.cle, l.qteAttendue);
            return m;
        }
    }

    static final class FeuilleEtEntetes {
        Feuille feuille;
        Map<String, Integer> entetes;
    }

    static FeuilleEtEntetes trouverFeuilleEtEntetes(Classeur classeur) throws ErreurLecture {
        for (Feuille feuille : classeur.feuilles) {
            Map<String, Integer> entetes = new LinkedHashMap<>();
            Map<Integer, Object> cellules = feuille.cellulesDeLaLigne(1);
            List<Integer> colonnes = new ArrayList<>(cellules.keySet());
            Collections.sort(colonnes);
            for (Integer col : colonnes) {
                Object v = cellules.get(col);
                if (v != null) entetes.put(Js.trim(Js.texte(v)), col);
            }
            if (entetes.keySet().containsAll(ENTETES_REQUISES)) {
                FeuilleEtEntetes r = new FeuilleEtEntetes();
                r.feuille = feuille;
                r.entetes = entetes;
                return r;
            }
        }
        throw new ErreurLecture("Aucune feuille du fichier de lancement ne contient les colonnes attendues ("
                + String.join(", ", ENTETES_REQUISES) + ").");
    }

    /** Clé commande+ligne construite à partir du numéro de ligne (3 chiffres). */
    public static String cleLigne(String commande, Object ligne) {
        Double n = Js.nombreOuNull(ligne);
        if (n == null) return commande + (ligne == null ? "" : Js.texte(ligne));
        String num = Js.entierTronque(n);
        StringBuilder sb = new StringBuilder();
        for (int i = num.length(); i < 3; i++) sb.append('0');
        return commande + sb + num;
    }

    public static String fmtLigne(Object ligne) {
        if (ligne == null) return "";
        Double n = Js.nombreOuNull(ligne);
        if (n == null) return Js.texte(ligne);
        return Js.entierTronque(n);
    }

    private static Object cellule(Feuille f, int ligne, Integer colonne) {
        return colonne == null ? null : f.valeur(ligne, colonne);
    }

    public static Resultat lire(Classeur classeur) throws ErreurLecture {
        FeuilleEtEntetes fe = trouverFeuilleEtEntetes(classeur);
        Feuille f = fe.feuille;
        Map<String, Integer> e = fe.entetes;
        Integer idxCommande = e.get(COL_COMMANDE);
        Integer idxLigne = e.get(COL_LIGNE);
        Integer idxArticle = e.get(COL_ARTICLE);
        Integer idxQte = e.get(COL_QTE);
        Integer idxLancement = e.get(COL_LANCEMENT);
        Integer idxCle = e.get(COL_CLE);
        Integer idxAgglo = e.get(COL_AGGLO);
        Integer idxLivsem = e.get(COL_LIVSEM);
        Integer idxLivan = e.get(COL_LIVAN);
        Integer idxAssemblage = e.get(COL_ASSEMBLAGE);
        Integer idxDimFinies = e.get(COL_DIMENSIONS_FINIES);

        Map<String, Double> qteParCle = new LinkedHashMap<>();
        Map<String, LigneStrat> infosParCle = new LinkedHashMap<>();
        Map<String, List<Object[]>> lignesBrutesParCle = new LinkedHashMap<>(); // {signature, article, qte}
        Map<String, Integer> comptePieceParSemaine = new LinkedHashMap<>();

        for (int r = 2; r <= f.nbLignes(); r++) {
            if (f.ligneVide(r)) continue;
            Object commandeBrute = cellule(f, r, idxCommande);
            if (commandeBrute == null) continue;
            String commande = Js.trim(Js.texte(commandeBrute));

            Object agglo = cellule(f, r, idxAgglo);
            if (agglo != null && MATERIAUX_EXCLUS.contains(Js.trim(Js.texte(agglo)).toUpperCase(Locale.ROOT))) continue;

            Object numeroLigne = cellule(f, r, idxLigne);
            Object articleBrut = cellule(f, r, idxArticle);
            String article = articleBrut == null ? "" : Js.texte(articleBrut);
            Object qteBrute = cellule(f, r, idxQte);
            Object qte = Js.estVide(qteBrute) ? (Object) 0.0 : qteBrute;
            Object lancementBrut = cellule(f, r, idxLancement);
            String lancement = Js.estVide(lancementBrut) ? "" : Js.texte(lancementBrut);

            Object cleBrute = cellule(f, r, idxCle);
            String cle = cleBrute != null && !Js.trim(Js.texte(cleBrute)).isEmpty()
                    ? Js.trim(Js.texte(cleBrute))
                    : cleLigne(commande, numeroLigne);

            Object livsem = cellule(f, r, idxLivsem);
            Object livan = cellule(f, r, idxLivan);

            Object assemblageBrut = cellule(f, r, idxAssemblage);
            Object dimFiniesBrut = cellule(f, r, idxDimFinies);
            Matcher dimFinies = null;
            if (dimFiniesBrut != null && !Js.texte(dimFiniesBrut).isEmpty()) {
                Matcher m = MOTIF_DIMENSIONS_FINIES.matcher(Js.texte(dimFiniesBrut));
                if (m.find()) dimFinies = m;
            }

            Map<String, String> toutesDonnees = new LinkedHashMap<>();
            for (Map.Entry<String, Integer> entete : e.entrySet()) {
                Object v = f.valeur(r, entete.getValue());
                if (v != null && !Js.trim(Js.texte(v)).isEmpty()) toutesDonnees.put(entete.getKey(), Js.trim(Js.texte(v)));
            }

            Double qteNumOuNull = Js.nombreOuNull(qte);
            double qteNum = qteNumOuNull == null ? 0 : qteNumOuNull;
            Double precedent = qteParCle.get(cle);
            qteParCle.put(cle, (precedent == null ? 0 : precedent) + qteNum);

            LigneStrat infos = new LigneStrat();
            infos.cle = cle;
            infos.commande = commande;
            infos.ligne = fmtLigne(numeroLigne);
            infos.article = article;
            infos.lancement = lancement;
            infos.assemblage = assemblageBrut != null && !Js.trim(Js.texte(assemblageBrut)).isEmpty()
                    ? Js.trim(Js.texte(assemblageBrut)) : null;
            infos.longueurFinie = dimFinies != null ? Js.nombreOuNull(dimFinies.group(1)) : null;
            infos.largeurFinie = dimFinies != null ? Js.nombreOuNull(dimFinies.group(2)) : null;
            infos.epaisseurFinie = dimFinies != null ? Js.nombreOuNull(dimFinies.group(3)) : null;
            infos.toutesDonnees = toutesDonnees;
            infosParCle.put(cle, infos);

            String signature = String.join("\u0001",
                    commande,
                    numeroLigne == null ? "" : Js.texte(numeroLigne),
                    article,
                    Js.nombre(qteNum),
                    lancement,
                    agglo == null ? "" : Js.trim(Js.texte(agglo)),
                    livsem == null ? "" : Js.trim(Js.texte(livsem)),
                    livan == null ? "" : Js.trim(Js.texte(livan)));
            List<Object[]> brutes = lignesBrutesParCle.get(cle);
            if (brutes == null) {
                brutes = new ArrayList<>();
                lignesBrutesParCle.put(cle, brutes);
            }
            brutes.add(new Object[] {signature, article, qteNum});

            if (livsem != null && !Js.trim(Js.texte(livsem)).isEmpty()) {
                String cleSemaine = (livan == null ? "" : Js.texte(livan)) + "-" + Js.texte(livsem);
                Integer n = comptePieceParSemaine.get(cleSemaine);
                comptePieceParSemaine.put(cleSemaine, (n == null ? 0 : n) + 1);
            }
        }

        Resultat resultat = new Resultat();
        for (Map.Entry<String, Double> q : qteParCle.entrySet()) {
            LigneStrat l = infosParCle.get(q.getKey());
            l.qteAttendue = q.getValue();
            resultat.lignes.add(l);
        }

        for (Map.Entry<String, List<Object[]>> entree : lignesBrutesParCle.entrySet()) {
            List<Object[]> occurrences = entree.getValue();
            if (occurrences.size() <= 1) continue;
            Map<String, List<Object[]>> parSignature = new LinkedHashMap<>();
            for (Object[] occ : occurrences) {
                List<Object[]> liste = parSignature.get((String) occ[0]);
                if (liste == null) {
                    liste = new ArrayList<>();
                    parSignature.put((String) occ[0], liste);
                }
                liste.add(occ);
            }
            LigneStrat infos = infosParCle.get(entree.getKey());
            for (List<Object[]> identiques : parSignature.values()) {
                if (identiques.size() <= 1) continue;
                Doublon d = new Doublon();
                d.cle = entree.getKey();
                d.commande = infos.commande;
                d.ligne = infos.ligne;
                d.nbLignes = identiques.size();
                for (Object[] o : identiques) {
                    d.articles.add((String) o[1]);
                    d.quantites.add((Double) o[2]);
                }
                resultat.doublons.add(d);
            }
        }

        for (Map.Entry<String, Integer> s : comptePieceParSemaine.entrySet()) {
            String[] morceaux = s.getKey().split("-", -1);
            SemaineLivraison sem = new SemaineLivraison();
            sem.annee = morceaux[0];
            sem.semaine = morceaux.length > 1 ? morceaux[1] : null;
            sem.nbPieces = s.getValue();
            resultat.semaines.add(sem);
        }
        Collections.sort(resultat.semaines, (a, b) -> (a.annee + a.semaine).compareTo(b.annee + b.semaine));
        return resultat;
    }

    /**
     * Quantités attendues pour le Contrôle Scies : comme lire(), mais
     * protections comprises (une protection passe en scie comme une autre pièce).
     */
    public static Map<String, Double> quantitesAttenduesScies(Classeur classeur) throws ErreurLecture {
        FeuilleEtEntetes fe = trouverFeuilleEtEntetes(classeur);
        Feuille f = fe.feuille;
        Integer idxCommande = fe.entetes.get(COL_COMMANDE);
        Integer idxLigne = fe.entetes.get(COL_LIGNE);
        Integer idxQte = fe.entetes.get(COL_QTE);
        Integer idxCle = fe.entetes.get(COL_CLE);
        Map<String, Double> qteParCle = new LinkedHashMap<>();
        for (int r = 2; r <= f.nbLignes(); r++) {
            if (f.ligneVide(r)) continue;
            Object commandeBrute = cellule(f, r, idxCommande);
            if (commandeBrute == null) continue;
            String commande = Js.trim(Js.texte(commandeBrute));
            Object numeroLigne = cellule(f, r, idxLigne);
            Object cleBrute = cellule(f, r, idxCle);
            String cle = cleBrute != null && !Js.trim(Js.texte(cleBrute)).isEmpty()
                    ? Js.trim(Js.texte(cleBrute))
                    : cleLigne(commande, numeroLigne);
            Double q = Js.nombreOuNull(cellule(f, r, idxQte));
            Double precedent = qteParCle.get(cle);
            qteParCle.put(cle, (precedent == null ? 0 : precedent) + (q == null ? 0 : q));
        }
        return qteParCle;
    }

    /**
     * Semaine encodée dans le code de lancement (ex. "LAN264004" -> "40") :
     * avant-dernière paire de chiffres, ou dernière pour un code à 4 chiffres.
     */
    public static String extraireSemaine(String codeLancement) {
        if (codeLancement == null || codeLancement.isEmpty()) return null;
        String chiffres = codeLancement.replaceAll("\\D", "");
        if (chiffres.length() == 4) return chiffres.substring(2, 4);
        if (chiffres.length() < 4) return null;
        return chiffres.substring(chiffres.length() - 4, chiffres.length() - 2);
    }
}
