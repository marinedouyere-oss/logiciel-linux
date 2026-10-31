package com.marinedouyere.sentinelle.moteur;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Contrôle des couleurs : chaque coloris demandé par le fichier de lancement
 * (dessus : « coloris », dessous : « coloris_inf ») doit avoir été optimisé
 * dans le .bkp (feuilles de stratifié TF pour le dessus, TB pour le dessous).
 * Une couleur oubliée à l'optimisation = des pièces sans stratifié.
 */
public final class ControleCouleurs {

    private ControleCouleurs() {}

    public static final String DESSUS = "dessus";
    public static final String DESSOUS = "dessous";

    /** Une couleur du lancement absente du .bkp, et les pièces qui en ont besoin. */
    public static final class Absente {
        public String couleur;
        public String face;
        public double nbPieces;
        public final List<String> cles = new ArrayList<>();
    }

    public static final class Resultat {
        /** Le .bkp ne contient aucun stratifié (ex. recyclage) : rien à contrôler. */
        public boolean sansStratifie;
        /** Nombre de couleurs différentes demandées par le lancement (dessus et dessous). */
        public int nbCouleurs;
        public final List<Absente> absentes = new ArrayList<>();
    }

    private static String valeur(Map<String, String> donnees, String colonne) {
        String v = donnees.get(colonne);
        return v == null || Js.trim(v).isEmpty() ? null : Js.trim(v);
    }

    private static void noter(Map<String, Absente> demandes, String couleur, String face, String cle, double qte) {
        String cleDemande = face + "|" + couleur;
        Absente a = demandes.get(cleDemande);
        if (a == null) {
            a = new Absente();
            a.couleur = couleur;
            a.face = face;
            demandes.put(cleDemande, a);
        }
        a.nbPieces += qte;
        if (cle != null && !a.cles.contains(cle)) a.cles.add(cle);
    }

    /** Compare les couleurs des lignes du lancement (hors protections) à celles du .bkp. */
    public static Resultat controler(List<LecteurStrat.LigneStrat> lignes, LecteurBkp.Couleurs bkp) {
        Resultat r = new Resultat();
        Map<String, Absente> demandes = new LinkedHashMap<>();
        for (LecteurStrat.LigneStrat l : lignes) {
            // Toutes les lignes de la pièce : un compact et son support, par exemple, n'ont pas le même coloris.
            List<Map<String, String>> donnees = l.lignesBrutes;
            if (donnees == null || donnees.isEmpty()) {
                donnees = new ArrayList<>();
                if (l.toutesDonnees != null) donnees.add(l.toutesDonnees);
            }
            for (Map<String, String> d : donnees) {
                Double q = Js.nombreOuNull(d.get("comdet_qte"));
                double qte = q != null ? q : 0;
                String dessus = valeur(d, "coloris");
                String dessous = valeur(d, "coloris_inf");
                if (dessus != null) noter(demandes, dessus, DESSUS, l.cle, qte);
                if (dessous != null) noter(demandes, dessous, DESSOUS, l.cle, qte);
            }
        }
        Set<String> couleurs = new LinkedHashSet<>();
        for (Absente a : demandes.values()) couleurs.add(a.couleur);
        r.nbCouleurs = couleurs.size();
        if (bkp.sansStratifie()) {
            r.sansStratifie = true;
            return r;
        }
        for (Absente a : demandes.values()) {
            Map<String, Integer> present = a.face.equals(DESSUS) ? bkp.dessus : bkp.dessous;
            if (!present.containsKey(a.couleur)) r.absentes.add(a);
        }
        return r;
    }
}
