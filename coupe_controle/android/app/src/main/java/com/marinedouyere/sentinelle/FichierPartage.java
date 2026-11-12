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
        String niveau; // corriger, verifier, info ; valide : validé « c'est voulu » sur le PC, ne compte plus
        String valide; // date de la validation (ISO), vide sinon
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
        Integer scies; // pièces différentes (et pièces dans aucun plan de coupe) ; -1 : contrôle impossible
        Integer horsPlans; // pièces dans aucun plan de coupe du .bkp (null : pas contrôlé)
        /** Plans de coupe du lancement (lus par le PC dans le .bkp), tels quels ; null si absents. */
        JSONObject plans;
        Integer couleursAbsentes;
        Integer couleursPf;
        /** Casse : pièces déjà lancées une semaine d'avant, rajouts (null : pas compté). */
        Integer casseDejaLancees;
        Integer casseRajouts;
        String casseOu = "";
        String cassePeriode = "";
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

    /** V6.2 : avancement des lancements d'après l'extraction Diakonos (onglet Suivi de production du PC). */
    static final class Suivi {
        String jour; // « 2026-11-10 »
        int semaine;
        int annee;
        String precedente; // jour de l'extraction d'avant (vide sinon)
        int nbExtractions;
        /** La semaine la plus loin dans l'extraction (0 : inconnue) ; au-delà : « pas dans cette extraction ». */
        int semaineMax;
        final List<String> fichiers = new ArrayList<>();
        int lancements;
        int retard;
        double faites;
        double restantes;
        Double depuis;
        final List<SemaineSuivi> semaines = new ArrayList<>();
        int anciennes;
        /** Dans Diakonos, dans aucun lancement : semaine, pièces à faire, lignes, commandes. */
        final List<String[]> hors = new ArrayList<>();
        /** Pièces à faire par transporteur et par semaine : colonnes (semaines puis « Total »), lignes (transporteur, valeurs…). */
        final List<String> colonnes = new ArrayList<>();
        final List<String[]> tableau = new ArrayList<>();
        /** V6.3.3 : suivi par semaine, transporteur, coloris, client (même calcul que les barres). Vue → lignes. */
        final Map<String, List<GroupeSuivi>> vues = new HashMap<>();
    }

    /** Une ligne du suivi par… : nom, pièces faites, à faire, état, et le détail (par semaine, ou par transporteur). */
    static final class GroupeSuivi {
        String nom;
        double f;
        double r;
        String e;
        final List<GroupeSuivi> sous = new ArrayList<>();
    }

    static final String[] VUES_SUIVI = {"semaine", "transporteur", "coloris", "client"};

    static final class SemaineSuivi {
        String id;
        int annee;
        int semaine;
        double f;
        double r;
        double h;
        String e;
        final List<LancementSuivi> lancements = new ArrayList<>();
    }

    static final class LancementSuivi {
        String cle;
        String nom;
        String poste;
        /** État : termine, absent (plus rien dans Diakonos), attente (pas encore dans Diakonos), retard, en_cours. */
        String e;
        double f; // pièces faites
        double r; // pièces à faire
        double h; // pièces pas comptées (sa semaine n'est pas dans l'extraction)
        /** Pièces relancées dans un lancement plus récent (casse, retard) : déduites d'ici, comptées là-bas. */
        double x;
        String xd = "";
        Double d; // pièces faites depuis l'extraction d'avant (null : pas d'extraction d'avant)
        final List<String> joursCourbe = new ArrayList<>();
        final List<Integer> pctCourbe = new ArrayList<>();
        /** Commandes encore à faire : commande, transporteur, ville, pièces à faire, semaine Diakonos. */
        final List<String[]> commandes = new ArrayList<>();
    }

    String genere;
    String par;
    /** V6.5.1 : « remplace » (le PC a pris un nouveau code de liaison) ou « arrete » (envoi arrêté) ; vide sinon. */
    String lien = "";
    /** V6.5.3 : le nom du PC qui a envoyé (plusieurs PC peuvent partager le même code). */
    String poste = "";
    /** V6.5.1 : le stock des panneaux (fichier woodStore chargé sur le PC) ; null : pas de fichier de stock. */
    Stock stock;

    /** Un format du stock : panneau entier ou chute (code « X… »). */
    static final class FormatStock {
        String code = "";
        int qte;
        String mat = "";
        double L;
        double W;
        double ep;
        /** Code woodStore : 0 = limité au stock, 9 = dépassement autorisé. */
        int limite;
        String desc = "";
        boolean fil;
        /** Chute réservée pour un lancement à débiter (statut 2) : pas disponible. */
        boolean reservee;
        String famille = "";
        /** Cases : « 1041(15) 7131(65) ». */
        String cases = "";
        String origine = "";
        /** Depuis quand la chute est là (ms ; 0 : inconnu). */
        long depuis;

        boolean chute() {
            return code.startsWith("X");
        }
    }

    static final class Stock {
        String nom = "";
        long modifie;
        long charge;
        /** Chute machine la plus récente du fichier (ms ; 0 : inconnu) : à peu près la date des données. */
        long jusquau;
        final List<FormatStock> formats = new ArrayList<>();
    }
    /** null : aucune extraction Diakonos lue sur le PC. */
    Suivi suivi;
    /** V6.3 : les réponses du PC aux demandes du téléphone : identifiant → { ok ("true"/"false"), texte, quand }. */
    final Map<String, String[]> reponsesPc = new HashMap<>();
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
        f.lien = texte(racine, "lien");
        f.poste = texte(racine, "poste");
        f.stock = stock(racine.optJSONObject("stock"));
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
        f.suivi = suivi(racine.optJSONObject("suiviProduction"));
        JSONObject retour = racine.optJSONObject("retourTelephone");
        JSONObject traitees = retour == null ? null : retour.optJSONObject("traitees");
        if (traitees != null)
            for (java.util.Iterator<String> it = traitees.keys(); it.hasNext(); ) {
                String id = it.next();
                JSONObject t = traitees.optJSONObject(id);
                if (t != null) f.reponsesPc.put(id, new String[] {String.valueOf(t.optBoolean("ok")), texte(t, "texte"), texte(t, "quand")});
            }
        return f;
    }

    private static String[] textes(JSONArray a) {
        if (a == null) return new String[0];
        String[] t = new String[a.length()];
        for (int i = 0; i < a.length(); i++) t[i] = a.isNull(i) ? "" : a.optString(i, "");
        return t;
    }

    static Stock stock(JSONObject js) {
        if (js == null) return null;
        JSONArray l = js.optJSONArray("formats");
        if (l == null) return null;
        Stock s = new Stock();
        s.nom = texte(js, "nom");
        s.modifie = js.optLong("modifie", 0);
        s.charge = js.optLong("charge", 0);
        s.jusquau = js.optLong("jusquau", 0);
        for (int i = 0; i < l.length(); i++) {
            JSONArray a = l.optJSONArray(i);
            if (a == null || a.length() < 12) continue;
            FormatStock x = new FormatStock();
            x.code = a.optString(0, "");
            x.qte = a.optInt(1, 0);
            x.mat = a.optString(2, "");
            x.L = a.optDouble(3, 0);
            x.W = a.optDouble(4, 0);
            x.ep = a.optDouble(5, 0);
            x.limite = a.optInt(6, 0);
            x.desc = a.isNull(7) ? "" : a.optString(7, "");
            x.fil = a.optInt(8, 0) == 1;
            x.reservee = a.optInt(9, 0) == 1;
            x.famille = a.optString(10, "");
            x.cases = a.isNull(11) ? "" : a.optString(11, "");
            x.origine = a.length() > 12 && !a.isNull(12) ? a.optString(12, "") : "";
            x.depuis = a.length() > 13 ? a.optLong(13, 0) : 0;
            if (x.code.isEmpty() || x.mat.isEmpty()) continue;
            s.formats.add(x);
        }
        return s;
    }

    static Suivi suivi(JSONObject js) {
        if (js == null || js.optInt("version") < 1 || texte(js, "jour").isEmpty()) return null;
        Suivi s = new Suivi();
        s.jour = texte(js, "jour");
        s.semaine = js.optInt("semaine");
        s.annee = js.optInt("annee");
        s.precedente = texte(js, "precedente");
        s.nbExtractions = js.optInt("nbExtractions");
        s.semaineMax = js.optInt("semaineMax", 0);
        for (String n : textes(js.optJSONArray("fichiers"))) s.fichiers.add(n);
        JSONObject t = js.optJSONObject("totaux");
        if (t != null) {
            s.lancements = t.optInt("lancements");
            s.retard = t.optInt("retard");
            s.faites = t.optDouble("faites", 0);
            s.restantes = t.optDouble("restantes", 0);
            s.depuis = nombre(t, "depuis");
        }
        s.anciennes = js.optInt("anciennes");
        JSONArray semaines = js.optJSONArray("semaines");
        if (semaines != null)
            for (int i = 0; i < semaines.length(); i++) {
                JSONObject jsem = semaines.optJSONObject(i);
                if (jsem == null) continue;
                SemaineSuivi sem = new SemaineSuivi();
                sem.id = texte(jsem, "id");
                sem.annee = jsem.optInt("annee");
                sem.semaine = jsem.optInt("semaine");
                sem.f = jsem.optDouble("f", 0);
                sem.r = jsem.optDouble("r", 0);
                sem.h = jsem.optDouble("h", 0);
                sem.e = texte(jsem, "e");
                JSONArray lancements = jsem.optJSONArray("lancements");
                if (lancements != null)
                    for (int j = 0; j < lancements.length(); j++) {
                        JSONObject jl = lancements.optJSONObject(j);
                        if (jl == null) continue;
                        LancementSuivi l = new LancementSuivi();
                        l.cle = texte(jl, "cle");
                        l.nom = texte(jl, "nom");
                        l.poste = texte(jl, "poste");
                        l.e = texte(jl, "e");
                        l.f = jl.optDouble("f", 0);
                        l.r = jl.optDouble("r", 0);
                        l.h = jl.optDouble("h", 0);
                        l.x = jl.optDouble("x", 0);
                        l.xd = texte(jl, "xd");
                        l.d = nombre(jl, "d");
                        JSONArray p = jl.optJSONArray("p");
                        if (p != null)
                            for (int k = 0; k < p.length(); k++) {
                                JSONArray pt = p.optJSONArray(k);
                                if (pt == null || pt.length() < 2) continue;
                                l.joursCourbe.add(pt.optString(0));
                                l.pctCourbe.add(pt.optInt(1));
                            }
                        JSONArray c = jl.optJSONArray("c");
                        if (c != null) for (int k = 0; k < c.length(); k++) l.commandes.add(textes(c.optJSONArray(k)));
                        sem.lancements.add(l);
                    }
                s.semaines.add(sem);
            }
        JSONArray hors = js.optJSONArray("hors");
        if (hors != null) for (int i = 0; i < hors.length(); i++) s.hors.add(textes(hors.optJSONArray(i)));
        JSONObject tableau = js.optJSONObject("tableau");
        if (tableau != null) {
            for (String c : textes(tableau.optJSONArray("colonnes"))) s.colonnes.add(c);
            JSONArray lignes = tableau.optJSONArray("lignes");
            if (lignes != null) for (int i = 0; i < lignes.length(); i++) s.tableau.add(textes(lignes.optJSONArray(i)));
        }
        JSONObject vues = js.optJSONObject("vues");
        if (vues != null)
            for (String vue : VUES_SUIVI) {
                JSONArray lignes = vues.optJSONArray(vue);
                if (lignes == null) continue;
                List<GroupeSuivi> liste = new ArrayList<>();
                for (int i = 0; i < lignes.length(); i++) {
                    GroupeSuivi g = groupeSuivi(lignes.optJSONArray(i));
                    if (g == null) continue;
                    JSONArray sous = lignes.optJSONArray(i).optJSONArray(4);
                    if (sous != null)
                        for (int k = 0; k < sous.length(); k++) {
                            GroupeSuivi x = groupeSuivi(sous.optJSONArray(k));
                            if (x != null) g.sous.add(x);
                        }
                    liste.add(g);
                }
                s.vues.put(vue, liste);
            }
        return s;
    }

    private static GroupeSuivi groupeSuivi(JSONArray a) {
        if (a == null || a.length() < 4) return null;
        GroupeSuivi g = new GroupeSuivi();
        g.nom = a.optString(0, "");
        g.f = a.optDouble(1, 0);
        g.r = a.optDouble(2, 0);
        g.e = a.optString(3, "");
        return g;
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
            l.horsPlans = entier(recap, "horsPlans");
            l.couleursAbsentes = entier(recap, "couleursAbsentes");
            l.couleursPf = entier(recap, "couleursPf");
            JSONObject casse = recap.optJSONObject("casse");
            if (casse != null) {
                l.casseDejaLancees = entier(casse, "dejaLancees");
                l.casseRajouts = entier(casse, "rajouts");
                l.casseOu = texte(casse, "ou");
                l.cassePeriode = texte(casse, "periode");
            }
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
                p.valide = texte(jp, "valide");
                if (!p.valide.isEmpty()) p.niveau = "valide";
                l.problemes.add(p);
            }
        l.plans = jl.optJSONObject("plans");
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

    /** Pièces de la semaine qui sont dans au moins deux de ses lancements (clé → lancements). */
    static Map<String, List<String>> lanceesDeuxFois(Semaine s, int iCle) {
        Map<String, List<String>> parCle = new LinkedHashMap<>();
        for (Lancement l : s.lancements)
            for (String[] piece : l.pieces) {
                String cle = iCle >= 0 && iCle < piece.length ? piece[iCle] : "";
                if (cle.length() <= 3 || !cle.substring(0, cle.length() - 3).matches(".*[A-Za-z].*")) continue;
                List<String> ou = parCle.get(cle);
                if (ou == null) parCle.put(cle, ou = new ArrayList<>());
                if (!ou.contains(l.nom)) ou.add(l.nom);
            }
        Map<String, List<String>> res = new LinkedHashMap<>();
        for (Map.Entry<String, List<String>> e : parCle.entrySet()) if (e.getValue().size() >= 2) res.put(e.getKey(), e.getValue());
        return res;
    }

    // ---- bibliothèque : où une pièce était déjà lancée (pour la casse) ----

    static final class Vu {
        int ordre;
        int semaine;
        String lancement;
    }

    private Map<String, List<Vu>> index;

    private synchronized Map<String, List<Vu>> index() {
        if (index != null) return index;
        Map<String, List<Vu>> m = new HashMap<>();
        int iCle = Math.max(0, colonne("cle"));
        for (Semaine s : semaines)
            for (Lancement l : s.lancements) {
                Vu vu = new Vu();
                vu.ordre = s.annee * 100 + s.semaine;
                vu.semaine = s.semaine;
                vu.lancement = l.fichier.isEmpty() ? l.nom : l.fichier;
                for (String[] piece : l.pieces) {
                    if (iCle >= piece.length) continue;
                    List<Vu> liste = m.get(piece[iCle]);
                    if (liste == null) m.put(piece[iCle], liste = new ArrayList<>());
                    liste.add(vu);
                }
            }
        index = m;
        return m;
    }

    /** Dernière semaine (strictement avant « avant » = année × 100 + semaine) où la pièce était lancée ; null sinon. */
    Vu derniereFoisLancee(String cle, int avant) {
        Vu meilleur = null;
        List<Vu> liste = index().get(cle);
        if (liste != null) for (Vu v : liste) if (v.ordre < avant && (meilleur == null || v.ordre > meilleur.ordre)) meilleur = v;
        return meilleur;
    }

    /** Semaines du fichier avant « avant » (« 44 », « 45 »), de la plus ancienne à la plus récente. */
    List<String> semainesAvant(int avant) {
        List<Semaine> liste = new ArrayList<>();
        for (Semaine s : semaines) if (s.annee * 100 + s.semaine < avant) liste.add(s);
        Collections.sort(liste, (a, b) -> Integer.compare(a.annee * 100 + a.semaine, b.annee * 100 + b.semaine));
        List<String> res = new ArrayList<>();
        for (Semaine s : liste) res.add(String.format(Locale.ROOT, "%02d", s.semaine));
        return res;
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

    // ---- pièce sans étiquette (comme la page web) ----

    /** À 2 mm près. */
    static final double TOLERANCE_COTES = 2;

    static String normaliserCouleur(String c) {
        return c == null ? "" : c.toUpperCase(Locale.ROOT).replaceAll("[\\s_.-]", "");
    }

    private static double ecart(String valeur, Double cible) {
        if (cible == null) return 0;
        try {
            return valeur == null || valeur.isEmpty() ? Double.POSITIVE_INFINITY : Math.abs(Double.parseDouble(valeur) - cible);
        } catch (NumberFormatException e) {
            return Double.POSITIVE_INFINITY;
        }
    }

    /**
     * Pièce sans étiquette : cote finie mesurée (la première mesure est le sens du fil : longueur, puis largeur),
     * à 2 mm près ; couleur facultative (belle face ou sous-face) ; dans les semaines de ce numéro. La plus proche d'abord.
     */
    List<Trouvaille> chercherSansEtiquette(Double longueur, Double largeur, String couleur, int semaine) {
        List<Trouvaille> res = new ArrayList<>();
        List<Double> ecarts = new ArrayList<>();
        String c = normaliserCouleur(couleur);
        int iCle = Math.max(0, colonne("cle"));
        int iL = colonne("longueur");
        int il = colonne("largeur");
        int iC = colonne("coloris");
        int iCi = colonne("coloris_inf");
        for (Semaine s : semaines) {
            if (s.semaine != semaine) continue;
            for (Lancement l : s.lancements) {
                java.util.Set<String> vues = new java.util.HashSet<>();
                for (String[] piece : l.pieces) {
                    double eL = ecart(iL >= 0 && iL < piece.length ? piece[iL] : "", longueur);
                    double el = ecart(il >= 0 && il < piece.length ? piece[il] : "", largeur);
                    if (eL > TOLERANCE_COTES || el > TOLERANCE_COTES) continue;
                    if (!c.isEmpty() && !normaliserCouleur(iC >= 0 && iC < piece.length ? piece[iC] : "").contains(c)
                            && !normaliserCouleur(iCi >= 0 && iCi < piece.length ? piece[iCi] : "").contains(c)) continue;
                    String cle = iCle < piece.length ? piece[iCle] : "";
                    if (!vues.add(cle)) continue;
                    Trouvaille t = new Trouvaille();
                    t.semaine = s;
                    t.lancement = l;
                    t.piece = piece;
                    for (Probleme p : l.problemes) if (cle.equals(p.cle)) t.problemes.add(p);
                    int k = 0;
                    while (k < res.size() && ecarts.get(k) <= eL + el) k++;
                    res.add(k, t);
                    ecarts.add(k, eL + el);
                }
            }
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
