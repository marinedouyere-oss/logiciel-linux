package com.marinedouyere.sentinelle;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Les plans de coupe d'un lancement, tels que Sentinelle sur le PC les écrit dans le fichier partagé (lus dans la
 * sauvegarde .bkp de Cut Rite) : chaque plan (matière, numéro « Pdc » de Cut Rite, panneau, morceaux), et pour chaque
 * pièce ses plans et les morceaux à mettre en jaune. L'appli ne fait que les lire et les dessiner.
 */
final class PlansLancement {

    static final class Morceau {
        double x, y, L, W, finiL, finiW;
        String nom = "";
        String article = "";
        boolean chute;
        /** Plan modifié dans Sentinelle sur le PC : « a » pièce posée, « m » modifiée, « r » retirée (ne pas couper). */
        String etat = "";
        /** Ce qui a changé (texte écrit par le PC). */
        String marque = "";
    }

    static final class Plan {
        String matiere, nom, sorte, desc;
        int pdc, fois;
        boolean module;
        /** Modifié dans Sentinelle sur le PC (le .bkp, lui, ne change pas). */
        boolean modifie;
        double L, W;
        final List<Morceau> morceaux = new ArrayList<>();
    }

    static final class PlanPiece {
        Plan plan;
        /** 0 module, 1 agglo, 2 stratifié dessus, 3 stratifié dessous (ou autre). */
        int rang;
        final Set<Integer> visees = new HashSet<>();
    }

    static final class Piece {
        String groupe = "";
        /** « m » module, « b » bande, « » pièce seule. */
        String type = "";
        String dessus = "";
        String dessous = "";
        int placees;
        final List<PlanPiece> plans = new ArrayList<>();
    }

    private PlansLancement() {}

    /** Les plans d'une pièce (null si le lancement n'a pas de plans pour elle). */
    static Piece piece(JSONObject plans, String cle) {
        if (plans == null) return null;
        JSONObject pieces = plans.optJSONObject("pieces");
        JSONObject jp = pieces == null ? null : pieces.optJSONObject(cle);
        if (jp == null) return null;
        JSONArray noms = plans.optJSONArray("noms");
        JSONArray liste = plans.optJSONArray("plans");
        Piece p = new Piece();
        p.groupe = jp.optString("g", "");
        p.type = jp.optString("t", "");
        p.dessus = jp.optString("d", "");
        p.dessous = jp.optString("s", "");
        p.placees = jp.optInt("n", 0);
        JSONArray pp = jp.optJSONArray("p");
        if (pp == null || liste == null) return p;
        for (int i = 0; i < pp.length(); i++) {
            JSONArray x = pp.optJSONArray(i);
            if (x == null) continue;
            JSONArray jplan = liste.optJSONArray(x.optInt(0, -1));
            if (jplan == null) continue;
            PlanPiece y = new PlanPiece();
            y.plan = plan(jplan, noms);
            y.rang = x.optInt(1, 3);
            JSONArray v = x.optJSONArray(2);
            if (v != null) for (int k = 0; k < v.length(); k++) y.visees.add(v.optInt(k));
            p.plans.add(y);
        }
        return p;
    }

    private static String nom(JSONArray noms, int i) {
        return noms != null && i >= 0 && i < noms.length() ? noms.optString(i, "") : "";
    }

    private static Plan plan(JSONArray j, JSONArray noms) {
        Plan p = new Plan();
        p.matiere = j.optString(0, "");
        p.pdc = j.optInt(1);
        p.module = j.optInt(2) == 1;
        p.nom = j.optString(3, "");
        p.sorte = j.optString(4, "");
        p.L = j.optDouble(5, 1);
        p.W = j.optDouble(6, 1);
        p.fois = j.optInt(7, 1);
        p.desc = j.optString(8, "");
        p.modifie = j.optInt(10, 0) == 1;
        JSONArray rects = j.optJSONArray(9);
        if (rects != null)
            for (int i = 0; i < rects.length(); i++) {
                JSONArray r = rects.optJSONArray(i);
                if (r == null) continue;
                Morceau m = new Morceau();
                m.x = r.optDouble(0);
                m.y = r.optDouble(1);
                m.L = r.optDouble(2);
                m.W = r.optDouble(3);
                int n = r.optInt(4, -1);
                m.chute = n < 0;
                if (!m.chute) {
                    m.nom = nom(noms, n);
                    m.article = nom(noms, r.optInt(5, -1));
                    m.finiL = r.optDouble(6, m.L);
                    m.finiW = r.optDouble(7, m.W);
                    m.etat = r.optString(8, "");
                    m.marque = nom(noms, r.optInt(9, -1));
                }
                p.morceaux.add(m);
            }
        return p;
    }

    static String dims(double L, double W) {
        return nombre(L) + " × " + nombre(W);
    }

    static String nombre(double v) {
        return Math.abs(v - Math.rint(v)) < 0.05 ? String.valueOf((long) Math.rint(v)) : String.valueOf(Math.round(v * 10) / 10.0);
    }

    /** Titre, numéro Pdc, panneau et position de la pièce : les mêmes textes que sur le PC. */
    static String[] textes(PlanPiece y, Piece p) {
        Plan plan = y.plan;
        String desc = plan.desc.isEmpty() ? "" : " · " + plan.desc;
        String fois = plan.fois > 1 ? " · coupé " + plan.fois + " fois" : "";
        String titre;
        if (y.rang == 0) titre = "Dans le module " + plan.nom;
        else if (y.rang == 1) titre = "Agglo " + plan.matiere;
        else if (y.rang == 2) titre = "Stratifié " + (!p.dessus.isEmpty() && p.dessus.equals(p.dessous) ? "dessus et dessous " : "dessus ") + plan.matiere;
        else titre = plan.matiere.equals(p.dessous) ? "Stratifié dessous " + plan.matiere : "Plan " + plan.matiere;
        String quoi;
        if (y.rang == 0) quoi = "la pièce";
        else if ("m".equals(p.type)) quoi = y.rang == 1 ? "le module " + p.groupe : "le stratifié du module " + p.groupe;
        else if ("b".equals(p.type)) quoi = y.rang == 1 ? "la bande " + p.groupe + " (la pièce est coupée dedans)" : "le stratifié de la bande " + p.groupe;
        else quoi = y.rang == 1 ? "la pièce" : "son stratifié";
        Morceau premier = null;
        int n = 0;
        for (int i = 0; i < plan.morceaux.size(); i++)
            if (y.visees.contains(i)) {
                if (premier == null) premier = plan.morceaux.get(i);
                n++;
            }
        String position = premier == null ? "En jaune : " + quoi
                : "En jaune : " + quoi + " — à " + nombre(premier.x) + " mm du bord gauche, " + nombre(premier.y) + " mm du haut" + (n > 1 ? " (et " + (n - 1) + " autre(s))" : "");
        String badge = y.rang == 0 ? "Pdc " + plan.pdc : "Pdc " + plan.pdc + " · " + plan.matiere;
        String sous = (y.rang == 0 ? "module" : plan.sorte + " " + plan.nom) + " · " + dims(plan.L, plan.W) + desc + fois;
        return new String[] {titre, badge, sous, position};
    }
}
