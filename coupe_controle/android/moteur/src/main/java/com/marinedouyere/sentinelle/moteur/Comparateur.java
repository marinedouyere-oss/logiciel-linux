package com.marinedouyere.sentinelle.moteur;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Comparaison fichier de lancement / pièces trouvées, comme comparer() de l'appli web. */
public final class Comparateur {

    private Comparateur() {}

    public static final String OK = "OK";
    public static final String MANQUANT = "Manquant";
    public static final String EN_TROP = "En trop";
    public static final String ECART = "Écart de quantité";

    private static final Pattern MOTIF_CLE = Pattern.compile("^(.+?)(\\d{3})$");

    public static final class LigneRapport {
        public String cle;
        public String commande = "";
        public String ligne = "";
        public String article = "";
        public String lancement = "";
        public double qteAttendue;
        public double qteTrouvee;
        public String statut;
        public double ecart;
    }

    public static final class Rapport {
        public final List<LigneRapport> lignes = new ArrayList<>();
        public double totalAttendu;
        public double totalTrouve;
        public int nbOk;
        public int nbAnomalies;

        public List<LigneRapport> anomalies() {
            List<LigneRapport> a = new ArrayList<>();
            for (LigneRapport l : lignes) if (!OK.equals(l.statut)) a.add(l);
            return a;
        }
    }

    public static Rapport comparer(List<LecteurStrat.LigneStrat> lignesStrat, Map<String, Double> trouveParCle) {
        Map<String, LecteurStrat.LigneStrat> stratParCle = new LinkedHashMap<>();
        for (LecteurStrat.LigneStrat l : lignesStrat) stratParCle.put(l.cle, l);
        Set<String> toutesLesCles = new LinkedHashSet<>(stratParCle.keySet());
        toutesLesCles.addAll(trouveParCle.keySet());

        Rapport rapport = new Rapport();
        for (String cle : toutesLesCles) {
            LecteurStrat.LigneStrat strat = stratParCle.get(cle);
            double qteAttendue = strat != null ? strat.qteAttendue : 0;
            Double trouvee = trouveParCle.get(cle);
            double qteTrouvee = trouvee == null ? 0 : trouvee;
            LigneRapport l = new LigneRapport();
            l.cle = cle;
            if (strat == null) {
                l.statut = EN_TROP;
                Matcher m = MOTIF_CLE.matcher(cle);
                if (m.find()) {
                    l.commande = m.group(1);
                    l.ligne = String.valueOf(Integer.parseInt(m.group(2)));
                } else {
                    l.commande = cle;
                }
            } else {
                l.commande = strat.commande;
                l.ligne = strat.ligne;
                l.article = strat.article;
                l.lancement = strat.lancement;
                if (qteTrouvee == 0) l.statut = MANQUANT;
                else if (qteTrouvee == qteAttendue) l.statut = OK;
                else l.statut = ECART;
            }
            l.qteAttendue = qteAttendue;
            l.qteTrouvee = qteTrouvee;
            l.ecart = qteTrouvee - qteAttendue;
            rapport.lignes.add(l);
        }

        Collections.sort(rapport.lignes, (a, b) -> {
            int aOk = OK.equals(a.statut) ? 1 : 0;
            int bOk = OK.equals(b.statut) ? 1 : 0;
            if (aOk != bOk) return aOk - bOk;
            if (!a.commande.equals(b.commande)) return a.commande.compareTo(b.commande) < 0 ? -1 : 1;
            if (!a.ligne.equals(b.ligne)) return a.ligne.compareTo(b.ligne) < 0 ? -1 : 1;
            return 0;
        });

        for (LigneRapport l : rapport.lignes) {
            rapport.totalAttendu += l.qteAttendue;
            rapport.totalTrouve += l.qteTrouvee;
            if (OK.equals(l.statut)) rapport.nbOk++;
        }
        rapport.nbAnomalies = rapport.lignes.size() - rapport.nbOk;
        return rapport;
    }
}
