package com.marinedouyere.sentinelle;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.zip.GZIPInputStream;

/**
 * Le fichier partagé que Sentinelle (la page web, sur le PC) écrit dans un dossier du Drive :
 * « sentinelle_partage.json.gz » (JSON compressé gzip). L'appli le lit seulement : toutes les semaines
 * gardées, leurs lancements, le tableau des lancements, le bilan des contrôles, les problèmes pièce par
 * pièce et les pièces elles-mêmes.
 */
final class FichierPartage {

    static final String NOM = "sentinelle_partage.json.gz";
    static final String FORMAT = "sentinelle-partage-1";

    static final class Bilan {
        String statut; // ok, alerte, attention, info
        String controle;
        String texte;
    }

    static final class Probleme {
        String niveau; // corriger, verifier, info
        String type;
        String cle;
        String article;
        String dimensions;
        String coloris;
        String quantite;
        String detail;
        String lignes;
    }

    static final class Lancement {
        String nom;
        String fichier;
        String poste;
        String dossier;
        boolean casse;
        String maj;
        final Map<String, String> fichiers = new LinkedHashMap<>();
        // Tableau des lancements (null : pas de valeur).
        Double prevues;
        Double bkp;
        String source;
        Integer controle; // pièces à vérifier dans la liste de coupe (ou le .bkp)
        Integer scies; // pièces différentes ; -1 : contrôle impossible
        Integer couleursAbsentes;
        Integer couleursPf;
        boolean controleFait;
        int nbCorriger;
        int nbVerifier;
        final List<Bilan> bilan = new ArrayList<>();
        final List<Probleme> problemes = new ArrayList<>();
        /** Une pièce par ligne, colonnes dans l'ordre de {@link FichierPartage#colonnes}. */
        final List<String[]> pieces = new ArrayList<>();
        double nbPieces;
    }

    static final class Semaine {
        String id;
        int annee;
        int semaine;
        String maj;
        final List<Lancement> lancements = new ArrayList<>();

        String libelle() {
            return String.format(Locale.ROOT, "Semaine %02d", semaine);
        }
    }

    String genere;
    String par;
    final List<String> colonnes = new ArrayList<>();
    /** Type de problème → { ce qu'il veut dire, que faire }. */
    final Map<String, String[]> explications = new HashMap<>();
    /** Semaines avec au moins un lancement, la plus récente d'abord. */
    final List<Semaine> semaines = new ArrayList<>();

    int colonne(String nom) {
        return colonnes.indexOf(nom);
    }

    /** Lit le fichier (compressé gzip ou non). */
    static FichierPartage lire(InputStream entree) throws IOException {
        BufferedInputStream b = new BufferedInputStream(entree);
        b.mark(2);
        int o1 = b.read();
        int o2 = b.read();
        b.reset();
        InputStream flux = o1 == 0x1f && o2 == 0x8b ? new GZIPInputStream(b, 65536) : b;
        ByteArrayOutputStream tout = new ByteArrayOutputStream();
        byte[] tampon = new byte[65536];
        for (int n; (n = flux.read(tampon)) > 0; ) tout.write(tampon, 0, n);
        try {
            return depuisJson(new JSONObject(new String(tout.toByteArray(), StandardCharsets.UTF_8)));
        } catch (JSONException e) {
            throw new IOException("Ce n'est pas un fichier partagé Sentinelle (" + e.getMessage() + ")", e);
        }
    }

    private static String texte(JSONObject o, String cle) {
        if (o == null || !o.has(cle) || o.isNull(cle)) return "";
        return o.optString(cle, "");
    }

    private static Double nombre(JSONObject o, String cle) {
        if (o == null || !o.has(cle) || o.isNull(cle)) return null;
        double v = o.optDouble(cle, Double.NaN);
        return Double.isNaN(v) ? null : v;
    }

    private static Integer entier(JSONObject o, String cle) {
        Double v = nombre(o, cle);
        return v == null ? null : (int) Math.round(v);
    }

    static FichierPartage depuisJson(JSONObject racine) throws JSONException, IOException {
        String format = texte(racine, "format");
        if (!format.startsWith("sentinelle-partage")) throw new IOException("Ce n'est pas un fichier partagé Sentinelle (format « " + format + " »)");
        FichierPartage f = new FichierPartage();
        f.genere = texte(racine, "genere");
        f.par = texte(racine, "par");
        JSONArray colonnes = racine.optJSONArray("colonnesPieces");
        if (colonnes != null) for (int i = 0; i < colonnes.length(); i++) f.colonnes.add(colonnes.optString(i));
        JSONObject explications = racine.optJSONObject("explications");
        if (explications != null) {
            for (java.util.Iterator<String> it = explications.keys(); it.hasNext(); ) {
                String type = it.next();
                JSONObject e = explications.optJSONObject(type);
                f.explications.put(type, new String[] {texte(e, "sens"), texte(e, "queFaire")});
            }
        }
        JSONArray semaines = racine.optJSONArray("semaines");
        if (semaines == null) throw new IOException("Fichier partagé sans semaines");
        for (int i = 0; i < semaines.length(); i++) {
            JSONObject js = semaines.optJSONObject(i);
            if (js == null) continue;
            JSONArray lancements = js.optJSONArray("lancements");
            if (lancements == null || lancements.length() == 0) continue; // semaine retirée
            Semaine s = new Semaine();
            s.id = texte(js, "id");
            s.annee = js.optInt("annee");
            s.semaine = js.optInt("semaine");
            s.maj = texte(js, "maj");
            for (int j = 0; j < lancements.length(); j++) {
                JSONObject jl = lancements.optJSONObject(j);
                if (jl != null) s.lancements.add(lancement(jl));
            }
            // Dans l'ordre des cases de la page web : Agglo 1er tour, Recyclage, Feno, Casse, Agglo 2ème tour, chantiers.
            Collections.sort(s.lancements, (a, b) -> rangPoste(a.poste) != rangPoste(b.poste)
                    ? Integer.compare(rangPoste(a.poste), rangPoste(b.poste)) : a.nom.compareTo(b.nom));
            f.semaines.add(s);
        }
        Collections.sort(f.semaines, (a, b) -> Integer.compare(b.annee * 100 + b.semaine, a.annee * 100 + a.semaine));
        return f;
    }

    private static final List<String> ORDRE_POSTES = java.util.Arrays.asList("Agglo 1er tour", "Recyclage", "Feno", "Casse", "Agglo 2ème tour");

    private static int rangPoste(String poste) {
        int i = ORDRE_POSTES.indexOf(poste);
        return i < 0 ? ORDRE_POSTES.size() : i;
    }

    private static Lancement lancement(JSONObject jl) {
        Lancement l = new Lancement();
        l.nom = texte(jl, "nom");
        l.fichier = texte(jl, "fichier");
        l.poste = texte(jl, "poste");
        l.dossier = texte(jl, "dossier");
        l.casse = jl.optBoolean("casse");
        l.maj = texte(jl, "maj");
        l.nbPieces = jl.optDouble("nbPieces", 0);
        JSONObject fichiers = jl.optJSONObject("fichiers");
        if (fichiers != null)
            for (java.util.Iterator<String> it = fichiers.keys(); it.hasNext(); ) {
                String role = it.next();
                l.fichiers.put(role, fichiers.optString(role));
            }
        JSONObject recap = jl.optJSONObject("recap");
        if (recap != null) {
            l.prevues = nombre(recap, "prevues");
            l.bkp = nombre(recap, "bkp");
            l.source = texte(recap, "source");
            l.controle = entier(recap, "controle");
            l.scies = entier(recap, "scies");
            l.couleursAbsentes = entier(recap, "couleursAbsentes");
            l.couleursPf = entier(recap, "couleursPf");
        }
        JSONObject controle = jl.optJSONObject("controle");
        if (controle != null) {
            l.controleFait = true;
            l.nbCorriger = controle.optInt("nbCorriger");
            l.nbVerifier = controle.optInt("nbVerifier");
            JSONArray bilan = controle.optJSONArray("bilan");
            if (bilan != null)
                for (int k = 0; k < bilan.length(); k++) {
                    JSONObject jb = bilan.optJSONObject(k);
                    if (jb == null) continue;
                    Bilan b = new Bilan();
                    b.statut = texte(jb, "statut");
                    b.controle = texte(jb, "controle");
                    b.texte = texte(jb, "texte");
                    l.bilan.add(b);
                }
        }
        JSONArray problemes = jl.optJSONArray("problemes");
        if (problemes != null)
            for (int k = 0; k < problemes.length(); k++) {
                JSONObject jp = problemes.optJSONObject(k);
                if (jp == null) continue;
                Probleme p = new Probleme();
                p.niveau = texte(jp, "niveau");
                p.type = texte(jp, "type");
                p.cle = texte(jp, "cle");
                p.article = texte(jp, "article");
                p.dimensions = texte(jp, "dimensions");
                p.coloris = texte(jp, "coloris");
                p.quantite = texte(jp, "quantite");
                p.detail = texte(jp, "detail");
                p.lignes = texte(jp, "lignes");
                l.problemes.add(p);
            }
        JSONArray pieces = jl.optJSONArray("pieces");
        if (pieces != null)
            for (int k = 0; k < pieces.length(); k++) {
                JSONArray jp = pieces.optJSONArray(k);
                if (jp == null) continue;
                String[] valeurs = new String[jp.length()];
                for (int m = 0; m < jp.length(); m++) valeurs[m] = jp.isNull(m) ? "" : jp.optString(m, "");
                l.pieces.add(valeurs);
            }
        return l;
    }

    // ---- recherche d'une pièce dans toutes les semaines ----

    static final class Trouvaille {
        Semaine semaine;
        Lancement lancement;
        String[] piece;
        final List<Probleme> problemes = new ArrayList<>();
    }

    /** « CVC26100982004 », « 26100982004 » ou une commande seule (« 26100982 ») : toutes les semaines, la plus récente d'abord. */
    List<Trouvaille> chercher(String requeteBrute) {
        List<Trouvaille> res = new ArrayList<>();
        String requete = requeteBrute == null ? "" : requeteBrute.trim().toUpperCase(Locale.ROOT);
        if (requete.isEmpty()) return res;
        int iCle = Math.max(0, colonne("cle"));
        for (Semaine s : semaines)
            for (Lancement l : s.lancements)
                for (String[] piece : l.pieces) {
                    String cle = iCle < piece.length ? piece[iCle] : "";
                    if (!correspond(cle, requete)) continue;
                    Trouvaille t = new Trouvaille();
                    t.semaine = s;
                    t.lancement = l;
                    t.piece = piece;
                    for (Probleme p : l.problemes) if (cle.equals(p.cle)) t.problemes.add(p);
                    res.add(t);
                }
        return res;
    }

    /** Le « CVC » est facultatif. */
    static boolean correspond(String cle, String requete) {
        String c = cle.toUpperCase(Locale.ROOT);
        if (c.startsWith(requete)) return true;
        return !requete.isEmpty() && Character.isDigit(requete.charAt(0)) && c.replaceFirst("^[A-Z]+", "").startsWith(requete);
    }
}
