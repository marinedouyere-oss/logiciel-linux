package com.marinedouyere.sentinelle;

import com.marinedouyere.sentinelle.moteur.Comparateur;
import com.marinedouyere.sentinelle.moteur.LecteurBkp;
import com.marinedouyere.sentinelle.moteur.LecteurStrat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/** Une case de contrôle : un poste (ou un chantier) pour une semaine paire ou impaire. */
public final class Paire {

    public static final String STRAT = "strat";
    public static final String COUPE = "coupe";
    public static final String BKP = "bkp";

    /** Fichier choisi par l'utilisateur, copié dans le stockage interne de l'appli. */
    public static final class Fichier {
        public final String nom;
        public final String chemin;

        public Fichier(String nom, String chemin) {
            this.nom = nom;
            this.chemin = chemin;
        }

        public File fichier() {
            return new File(chemin);
        }
    }

    public final String poste;
    public final String label;
    public String parite;
    public String codeLancement;
    public String semaine;

    public Fichier strat;
    public Fichier coupe;
    public Fichier bkp;

    public Comparateur.Rapport rapport;
    public List<LecteurStrat.Doublon> doublons = new ArrayList<>();
    public Integer nbUnitaires;
    public Integer nbPiecesTrouvees;
    public String source;

    public List<LecteurBkp.Ecart> ecartsScies;
    public Double totalScies;
    public String erreurScies;

    /** Message d'état affiché sous les boutons (progression, erreur...). Non mémorisé. */
    public transient String etat;
    public transient boolean etatErreur;
    public transient boolean enCours;

    public Paire(String poste, String label, String parite) {
        this.poste = poste;
        this.label = label;
        this.parite = parite;
    }

    public String cle() {
        return poste + "||" + label;
    }

    public boolean estChantier() {
        return Depot.POSTE_CHANTIERS.equals(poste);
    }

    public String titre() {
        if (!estChantier()) return semaine != null ? "Semaine " + semaine : label;
        return semaine != null ? label + " (sem " + semaine + ")" : label;
    }

    public String nomComplet() {
        return poste + " — " + titre();
    }

    public Fichier fichier(String role) {
        switch (role) {
            case STRAT:
                return strat;
            case COUPE:
                return coupe;
            default:
                return bkp;
        }
    }

    public void poserFichier(String role, Fichier f) {
        switch (role) {
            case STRAT:
                strat = f;
                break;
            case COUPE:
                coupe = f;
                break;
            default:
                bkp = f;
                break;
        }
    }

    /** Remet la case à zéro (fichiers, résultats, semaine détectée). */
    public void reinitialiser() {
        strat = null;
        coupe = null;
        bkp = null;
        semaine = null;
        rapport = null;
        doublons = new ArrayList<>();
        nbUnitaires = null;
        nbPiecesTrouvees = null;
        source = null;
        ecartsScies = null;
        totalScies = null;
        erreurScies = null;
        etat = null;
        etatErreur = false;
    }

    // ---- sérialisation ----

    private static JSONObject fichierEnJson(Fichier f) throws JSONException {
        if (f == null) return null;
        return new JSONObject().put("nom", f.nom).put("chemin", f.chemin);
    }

    private static Fichier fichierDepuisJson(JSONObject o) {
        if (o == null) return null;
        Fichier f = new Fichier(o.optString("nom"), o.optString("chemin"));
        return f.fichier().exists() ? f : null;
    }

    private static Object ouNull(Object o) {
        return o == null ? JSONObject.NULL : o;
    }

    public JSONObject enJson() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("poste", poste).put("label", label).put("parite", ouNull(parite));
        o.put("codeLancement", ouNull(codeLancement)).put("semaine", ouNull(semaine));
        o.put("strat", ouNull(fichierEnJson(strat)));
        o.put("coupe", ouNull(fichierEnJson(coupe)));
        o.put("bkp", ouNull(fichierEnJson(bkp)));
        o.put("nbUnitaires", ouNull(nbUnitaires)).put("nbPiecesTrouvees", ouNull(nbPiecesTrouvees));
        o.put("source", ouNull(source));
        if (rapport != null) {
            JSONObject r = new JSONObject();
            r.put("totalAttendu", rapport.totalAttendu).put("totalTrouve", rapport.totalTrouve);
            r.put("nbOk", rapport.nbOk).put("nbAnomalies", rapport.nbAnomalies);
            JSONArray lignes = new JSONArray();
            for (Comparateur.LigneRapport l : rapport.lignes) {
                lignes.put(new JSONObject().put("cle", l.cle).put("commande", l.commande).put("ligne", l.ligne)
                        .put("article", l.article).put("lancement", l.lancement).put("qa", l.qteAttendue)
                        .put("qt", l.qteTrouvee).put("statut", l.statut).put("ecart", l.ecart));
            }
            r.put("lignes", lignes);
            o.put("rapport", r);
        }
        JSONArray ds = new JSONArray();
        for (LecteurStrat.Doublon d : doublons) {
            JSONArray q = new JSONArray();
            for (Double v : d.quantites) q.put(v);
            ds.put(new JSONObject().put("cle", d.cle).put("commande", d.commande).put("ligne", d.ligne)
                    .put("nbLignes", d.nbLignes).put("articles", new JSONArray(d.articles)).put("quantites", q));
        }
        o.put("doublons", ds);
        if (ecartsScies != null) {
            JSONArray es = new JSONArray();
            for (LecteurBkp.Ecart e : ecartsScies) {
                es.put(new JSONObject().put("cle", e.cle).put("attendu", e.attendu).put("trouve", e.trouve));
            }
            o.put("ecartsScies", es);
            o.put("totalScies", ouNull(totalScies));
        }
        o.put("erreurScies", ouNull(erreurScies));
        return o;
    }

    private static String texte(JSONObject o, String cle) {
        return o.isNull(cle) ? null : o.optString(cle, null);
    }

    private static Integer entier(JSONObject o, String cle) {
        return o.isNull(cle) || !o.has(cle) ? null : o.optInt(cle);
    }

    public static Paire depuisJson(JSONObject o) throws JSONException {
        Paire p = new Paire(o.getString("poste"), o.getString("label"), texte(o, "parite"));
        p.codeLancement = texte(o, "codeLancement");
        p.semaine = texte(o, "semaine");
        p.strat = fichierDepuisJson(o.optJSONObject("strat"));
        p.coupe = fichierDepuisJson(o.optJSONObject("coupe"));
        p.bkp = fichierDepuisJson(o.optJSONObject("bkp"));
        p.nbUnitaires = entier(o, "nbUnitaires");
        p.nbPiecesTrouvees = entier(o, "nbPiecesTrouvees");
        p.source = texte(o, "source");
        JSONObject r = o.optJSONObject("rapport");
        if (r != null) {
            Comparateur.Rapport rapport = new Comparateur.Rapport();
            rapport.totalAttendu = r.optDouble("totalAttendu");
            rapport.totalTrouve = r.optDouble("totalTrouve");
            rapport.nbOk = r.optInt("nbOk");
            rapport.nbAnomalies = r.optInt("nbAnomalies");
            JSONArray lignes = r.optJSONArray("lignes");
            for (int i = 0; lignes != null && i < lignes.length(); i++) {
                JSONObject l = lignes.getJSONObject(i);
                Comparateur.LigneRapport lr = new Comparateur.LigneRapport();
                lr.cle = l.optString("cle");
                lr.commande = l.optString("commande");
                lr.ligne = l.optString("ligne");
                lr.article = l.optString("article");
                lr.lancement = l.optString("lancement");
                lr.qteAttendue = l.optDouble("qa");
                lr.qteTrouvee = l.optDouble("qt");
                lr.statut = l.optString("statut");
                lr.ecart = l.optDouble("ecart");
                rapport.lignes.add(lr);
            }
            p.rapport = rapport;
        }
        JSONArray ds = o.optJSONArray("doublons");
        for (int i = 0; ds != null && i < ds.length(); i++) {
            JSONObject d = ds.getJSONObject(i);
            LecteurStrat.Doublon db = new LecteurStrat.Doublon();
            db.cle = d.optString("cle");
            db.commande = d.optString("commande");
            db.ligne = d.optString("ligne");
            db.nbLignes = d.optInt("nbLignes");
            JSONArray a = d.optJSONArray("articles");
            for (int k = 0; a != null && k < a.length(); k++) db.articles.add(a.optString(k));
            JSONArray q = d.optJSONArray("quantites");
            for (int k = 0; q != null && k < q.length(); k++) db.quantites.add(q.optDouble(k));
            p.doublons.add(db);
        }
        JSONArray es = o.optJSONArray("ecartsScies");
        if (es != null) {
            p.ecartsScies = new ArrayList<>();
            for (int i = 0; i < es.length(); i++) {
                JSONObject e = es.getJSONObject(i);
                LecteurBkp.Ecart ec = new LecteurBkp.Ecart();
                ec.cle = e.optString("cle");
                ec.attendu = e.optDouble("attendu");
                ec.trouve = e.optDouble("trouve");
                p.ecartsScies.add(ec);
            }
            p.totalScies = o.isNull("totalScies") ? null : o.optDouble("totalScies");
        }
        p.erreurScies = texte(o, "erreurScies");
        return p;
    }
}
