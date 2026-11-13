package com.marinedouyere.sentinelle;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
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
        /** V6.3 : empreinte du plan d'origine (« #1a2b3c4d ») : la modification faite ici est vérifiée par le PC. */
        String empreinte = "";
        /** La modification en cours sur le PC ({ morceaux, ajouts }), ou null. */
        JSONObject rt;
        /** Pour chaque morceau montré : son morceau d'origine (« 5 »), une pièce posée (« a2 »), un reste de chute (« r5 »). */
        final List<String> origine = new ArrayList<>();
        /** Rang du plan dans le fichier (pour le retrouver). */
        int rang;
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
        JSONObject extra = j.optJSONObject(11);
        if (extra != null) {
            p.empreinte = extra.optString("e", "");
            p.rt = extra.optJSONObject("rt");
            JSONArray o = extra.optJSONArray("o");
            if (o != null) for (int i = 0; i < o.length(); i++) p.origine.add(o.isNull(i) ? "" : o.optString(i, ""));
        }
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

    /** V6.9.5 : un module ou une bande du lancement (T1, T2…). */
    static final class Groupe {
        String nom = "";
        /** « m » module, « b » bande. */
        String type = "";
        int pieces;
        /** Module : son plan ; bande : le plan d'agglo où elle est coupée. Rang dans le fichier, -1 si aucun. */
        int plan = -1;
        /** Les morceaux à mettre en jaune dans ce plan (la bande). */
        final Set<Integer> visees = new HashSet<>();
        /** Les autres plans de la bande (stratifiés) : « Pdc 7 · 1002 ». */
        final List<String> autres = new ArrayList<>();
    }

    /**
     * Les modules et les bandes du lancement, dans l'ordre des numéros (T1, T2…), d'après les pièces des plans envoyés
     * par le PC. Une bande n'a pas de plan à elle : on donne le panneau d'agglo où elle est coupée.
     */
    static List<Groupe> groupes(JSONObject plans) {
        List<Groupe> res = new ArrayList<>();
        if (plans == null) return res;
        JSONObject pieces = plans.optJSONObject("pieces");
        JSONArray liste = plans.optJSONArray("plans");
        if (pieces == null) return res;
        java.util.Map<String, Groupe> parNom = new java.util.HashMap<>();
        for (java.util.Iterator<String> it = pieces.keys(); it.hasNext(); ) {
            JSONObject jp = pieces.optJSONObject(it.next());
            if (jp == null) continue;
            String g = jp.optString("g", "");
            String t = jp.optString("t", "");
            if (g.isEmpty() || !("m".equals(t) || "b".equals(t))) continue;
            Groupe gr = parNom.get(g);
            if (gr == null) {
                gr = new Groupe();
                gr.nom = g;
                gr.type = t;
                parNom.put(g, gr);
                res.add(gr);
            }
            gr.pieces++;
            if (gr.plan >= 0) continue;
            JSONArray pp = jp.optJSONArray("p");
            if (pp == null) continue;
            int voulu = "m".equals(t) ? 0 : 1;
            for (int i = 0; i < pp.length(); i++) {
                JSONArray x = pp.optJSONArray(i);
                if (x == null || x.optInt(1, 3) != voulu) continue;
                gr.plan = x.optInt(0, -1);
                JSONArray v = x.optJSONArray(2);
                if (v != null) for (int k = 0; k < v.length(); k++) gr.visees.add(v.optInt(k));
                break;
            }
            if ("b".equals(t) && liste != null)
                for (int i = 0; i < pp.length(); i++) {
                    JSONArray x = pp.optJSONArray(i);
                    if (x == null || x.optInt(1, 3) < 2) continue;
                    JSONArray jplan = liste.optJSONArray(x.optInt(0, -1));
                    if (jplan != null) gr.autres.add("Pdc " + jplan.optInt(1) + " · " + jplan.optString(0, ""));
                }
        }
        Collections.sort(res, (a, b) -> Integer.compare(numero(a.nom), numero(b.nom)));
        return res;
    }

    private static int numero(String g) {
        try {
            return Integer.parseInt(g.replaceAll("\\D", ""));
        } catch (NumberFormatException e) {
            return Integer.MAX_VALUE;
        }
    }

    /** Tous les plans d'un lancement, dans l'ordre du fichier. */
    static List<Plan> tous(JSONObject plans) {
        List<Plan> l = new ArrayList<>();
        if (plans == null) return l;
        JSONArray liste = plans.optJSONArray("plans");
        JSONArray noms = plans.optJSONArray("noms");
        if (liste == null) return l;
        for (int i = 0; i < liste.length(); i++) {
            JSONArray j = liste.optJSONArray(i);
            if (j == null) continue;
            Plan p = plan(j, noms);
            p.rang = i;
            l.add(p);
        }
        return l;
    }

    /** Le morceau d'origine d'un morceau montré (son numéro dans le plan d'origine), -1 si c'est une pièce posée. */
    static int origineDe(Plan p, int i) {
        if (p.origine.isEmpty()) return i; // plan pas modifié : les mêmes morceaux
        String o = i < p.origine.size() ? p.origine.get(i) : "";
        if (o.startsWith("r")) o = o.substring(1);
        try {
            return Integer.parseInt(o);
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /** La pièce posée (rang dans les ajouts) d'un morceau montré, -1 sinon. */
    static int ajoutDe(Plan p, int i) {
        String o = i < p.origine.size() ? p.origine.get(i) : "";
        if (!o.startsWith("a")) return -1;
        try {
            return Integer.parseInt(o.substring(1));
        } catch (NumberFormatException e) {
            return -1;
        }
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
