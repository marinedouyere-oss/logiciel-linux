package com.marinedouyere.sentinelle;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.UUID;
import java.util.zip.GZIPOutputStream;

/**
 * V6.3 : ce que le téléphone demande au PC (plan de coupe modifié, problème validé OK). Les demandes attendent ici
 * jusqu'à ce que le PC réponde (dans le fichier partagé) : reprise, ou pourquoi pas. Elles partent au PC chiffrées,
 * par le même site que le fichier partagé (canal retour tiré du code de liaison).
 */
final class DemandesPc {

    static final String FORMAT = "sentinelle-demandes-1";
    private static final String PREFERENCES = "sentinelle_demandes";
    private static final int MAX_RESULTATS = 30;

    private final SharedPreferences prefs;

    DemandesPc(Context c) {
        prefs = c.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    /** L'identifiant de ce téléphone (tiré au hasard une fois). */
    synchronized String appareil() {
        String a = prefs.getString("appareil", null);
        if (a == null) {
            a = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
            prefs.edit().putString("appareil", a).apply();
        }
        return a;
    }

    static String maintenant() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }

    private JSONArray lire(String cle) {
        try {
            return new JSONArray(prefs.getString(cle, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    /** Les demandes pas encore reprises par le PC (la plus ancienne d'abord). */
    synchronized List<JSONObject> enAttente() {
        List<JSONObject> l = new ArrayList<>();
        JSONArray a = lire("attente");
        for (int i = 0; i < a.length(); i++) if (a.optJSONObject(i) != null) l.add(a.optJSONObject(i));
        return l;
    }

    private void ecrireAttente(List<JSONObject> l) {
        JSONArray a = new JSONArray();
        for (JSONObject o : l) a.put(o);
        prefs.edit().putString("attente", a.toString()).apply();
    }

    /** Ajoute une demande (elle reçoit son identifiant et sa date) ; une demande sur le même plan remplace l'ancienne. */
    synchronized JSONObject ajouter(JSONObject d) throws JSONException {
        int n = prefs.getInt("compteur", 0) + 1;
        prefs.edit().putInt("compteur", n).apply();
        d.put("id", appareil() + "-" + n);
        d.put("quand", maintenant());
        d.put("envoyee", false);
        List<JSONObject> l = enAttente();
        String cle = cleDe(d);
        List<JSONObject> garde = new ArrayList<>();
        for (JSONObject x : l) if (!cle.equals(cleDe(x))) garde.add(x);
        garde.add(d);
        ecrireAttente(garde);
        return d;
    }

    /** Ce sur quoi porte une demande (deux demandes sur le même plan : la dernière compte). */
    static String cleDe(JSONObject d) {
        if ("plan".equals(d.optString("type")))
            return "plan|" + d.optString("lancement") + "|" + (d.optInt("module") == 1 ? "module " + d.optString("nom") : d.optString("matiere") + "|" + d.optInt("pdc"));
        return "validation|" + d.optString("lancement") + "|" + d.optString("cle") + "|" + d.optString("probleme");
    }

    /** La demande en attente sur ce plan, ou null. */
    synchronized JSONObject enAttentePourPlan(String lancement, PlansLancement.Plan p) {
        String cle = "plan|" + lancement + "|" + (p.module ? "module " + p.nom : p.matiere + "|" + p.pdc);
        for (JSONObject d : enAttente()) if (cle.equals(cleDe(d))) return d;
        return null;
    }

    synchronized boolean validationEnAttente(String lancement, String cle, String probleme) {
        String k = "validation|" + lancement + "|" + cle + "|" + probleme;
        for (JSONObject d : enAttente()) if (k.equals(cleDe(d))) return true;
        return false;
    }

    /** Y a-t-il des demandes pas encore envoyées au site ? */
    synchronized boolean aEnvoyer() {
        for (JSONObject d : enAttente()) if (!d.optBoolean("envoyee")) return true;
        return false;
    }

    /** Envoi réussi : les demandes envoyées sont marquées (elles attendent la réponse du PC). */
    synchronized void envoyees(Set<String> ids) {
        List<JSONObject> l = enAttente();
        for (JSONObject d : l)
            if (ids.contains(d.optString("id")))
                try {
                    d.put("envoyee", true);
                } catch (JSONException e) {
                    // ne peut pas arriver
                }
        ecrireAttente(l);
        prefs.edit().putString("dernierEnvoi", maintenant()).remove("erreurEnvoi").apply();
    }

    // ---- V6.5.1 : le téléphone dit au PC quelle version il a lue (le PC voit si le téléphone est à jour) ----

    /** Une version du fichier partagé vient d'être lue. */
    synchronized void lu(String version, String genere) {
        if (version == null || version.isEmpty()) return;
        prefs.edit().putString("luVersion", version).putString("luGenere", genere == null ? "" : genere).putString("luQuand", maintenant()).apply();
    }

    /** La dernière version lue n'a pas encore été dite au PC. */
    synchronized boolean accuseAEnvoyer() {
        String v = prefs.getString("luVersion", "");
        return !v.isEmpty() && !v.equals(prefs.getString("accuseVersion", ""));
    }

    synchronized String versionLue() {
        return prefs.getString("luVersion", "");
    }

    synchronized void accuseEnvoye(String version) {
        if (version != null && !version.isEmpty()) prefs.edit().putString("accuseVersion", version).apply();
    }

    /** Ce que ce téléphone a lu : { version, genere, quand }. */
    synchronized JSONObject lecture() throws JSONException {
        JSONObject l = new JSONObject();
        l.put("version", prefs.getString("luVersion", ""));
        l.put("genere", prefs.getString("luGenere", ""));
        l.put("quand", prefs.getString("luQuand", ""));
        return l;
    }

    synchronized void erreurEnvoi(String texte) {
        prefs.edit().putString("erreurEnvoi", texte).apply();
    }

    String erreur() {
        return prefs.getString("erreurEnvoi", null);
    }

    String dernierEnvoi() {
        return prefs.getString("dernierEnvoi", "");
    }

    /**
     * Les réponses du PC (lues dans le fichier partagé) : les demandes reprises sortent de la file d'attente et vont
     * dans les derniers résultats. Renvoie le nombre de demandes reprises maintenant.
     */
    synchronized int reponses(Map<String, String[]> traitees) {
        if (traitees == null || traitees.isEmpty()) return 0;
        List<JSONObject> l = enAttente();
        List<JSONObject> reste = new ArrayList<>();
        JSONArray res = lire("resultats");
        int n = 0;
        for (JSONObject d : l) {
            String[] r = traitees.get(d.optString("id"));
            if (r == null) {
                reste.add(d);
                continue;
            }
            n++;
            JSONObject x = new JSONObject();
            try {
                x.put("id", d.optString("id"));
                x.put("titre", d.optString("titre"));
                x.put("type", d.optString("type"));
                x.put("lancement", d.optString("lancement"));
                x.put("ok", "true".equals(r[0]));
                x.put("texte", r[1]);
                x.put("quand", r[2]);
            } catch (JSONException e) {
                continue;
            }
            res.put(x);
        }
        if (n == 0) return 0;
        // Les plus récents d'abord, 30 au plus.
        JSONArray garde = new JSONArray();
        for (int i = res.length() - 1; i >= 0 && garde.length() < MAX_RESULTATS; i--) garde.put(res.optJSONObject(i));
        JSONArray ordre = new JSONArray();
        for (int i = garde.length() - 1; i >= 0; i--) ordre.put(garde.optJSONObject(i));
        prefs.edit().putString("resultats", ordre.toString()).apply();
        ecrireAttente(reste);
        return n;
    }

    /** Les dernières réponses du PC (la plus récente d'abord). */
    synchronized List<JSONObject> resultats() {
        JSONArray a = lire("resultats");
        List<JSONObject> l = new ArrayList<>();
        for (int i = a.length() - 1; i >= 0; i--) if (a.optJSONObject(i) != null) l.add(a.optJSONObject(i));
        return l;
    }

    /**
     * Ce qui part au PC (JSON compressé) : nos demandes en attente, et celles d'un autre téléphone déjà sur le site
     * que le PC n'a pas encore reprises (on ne les efface pas).
     */
    synchronized byte[] contenu(JSONArray autres) throws IOException {
        return contenu(autres, null);
    }

    /** Idem, avec ce que chaque téléphone a lu (le nôtre, et ceux d'un autre téléphone déjà sur le site). */
    synchronized byte[] contenu(JSONArray autres, JSONObject lecturesAutres) throws IOException {
        try {
            JSONObject o = new JSONObject();
            o.put("format", FORMAT);
            o.put("appareil", appareil());
            o.put("envoye", maintenant());
            JSONObject lectures = new JSONObject();
            if (lecturesAutres != null)
                for (java.util.Iterator<String> it = lecturesAutres.keys(); it.hasNext(); ) {
                    String a = it.next();
                    if (!a.equals(appareil()) && lecturesAutres.optJSONObject(a) != null) lectures.put(a, lecturesAutres.optJSONObject(a));
                }
            if (!prefs.getString("luVersion", "").isEmpty()) lectures.put(appareil(), lecture());
            o.put("lectures", lectures);
            JSONArray liste = new JSONArray();
            for (JSONObject d : enAttente()) {
                JSONObject c = new JSONObject(d.toString());
                c.remove("envoyee");
                liste.put(c);
            }
            if (autres != null) for (int i = 0; i < autres.length(); i++) liste.put(autres.get(i));
            o.put("demandes", liste);
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            try (GZIPOutputStream z = new GZIPOutputStream(b)) {
                z.write(o.toString().getBytes(StandardCharsets.UTF_8));
            }
            return b.toByteArray();
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    /** Ce que les téléphones ont lu, d'après le paquet déjà déposé (déchiffré) ; vide si illisible. */
    static JSONObject lecturesDuPaquet(byte[] clair) {
        try {
            byte[] json = clair;
            if (clair.length > 2 && (clair[0] & 0xff) == 0x1f && (clair[1] & 0xff) == 0x8b) {
                java.util.zip.GZIPInputStream z = new java.util.zip.GZIPInputStream(new java.io.ByteArrayInputStream(clair));
                ByteArrayOutputStream b = new ByteArrayOutputStream();
                byte[] t = new byte[8192];
                for (int n; (n = z.read(t)) > 0; ) b.write(t, 0, n);
                json = b.toByteArray();
            }
            JSONObject o = new JSONObject(new String(json, StandardCharsets.UTF_8));
            JSONObject l = FORMAT.equals(o.optString("format")) ? o.optJSONObject("lectures") : null;
            return l != null ? l : new JSONObject();
        } catch (IOException | JSONException e) {
            return new JSONObject();
        }
    }

    /** Les demandes d'un autre téléphone dans le paquet déjà déposé (déchiffré), pas encore reprises par le PC. */
    static JSONArray autres(byte[] clair, String appareil, Map<String, String[]> traitees) {
        JSONArray res = new JSONArray();
        try {
            byte[] json = clair;
            if (clair.length > 2 && (clair[0] & 0xff) == 0x1f && (clair[1] & 0xff) == 0x8b) {
                java.util.zip.GZIPInputStream z = new java.util.zip.GZIPInputStream(new java.io.ByteArrayInputStream(clair));
                ByteArrayOutputStream b = new ByteArrayOutputStream();
                byte[] t = new byte[8192];
                for (int n; (n = z.read(t)) > 0; ) b.write(t, 0, n);
                json = b.toByteArray();
            }
            JSONObject o = new JSONObject(new String(json, StandardCharsets.UTF_8));
            if (!FORMAT.equals(o.optString("format"))) return res;
            JSONArray l = o.optJSONArray("demandes");
            if (l == null) return res;
            for (int i = 0; i < l.length(); i++) {
                JSONObject d = l.optJSONObject(i);
                if (d == null) continue;
                String id = d.optString("id");
                if (id.startsWith(appareil + "-")) continue; // les nôtres : celles de la file d'attente comptent
                if (traitees != null && traitees.containsKey(id)) continue;
                res.put(d);
            }
        } catch (IOException | JSONException e) {
            // paquet illisible : rien à garder
        }
        return res;
    }
}
