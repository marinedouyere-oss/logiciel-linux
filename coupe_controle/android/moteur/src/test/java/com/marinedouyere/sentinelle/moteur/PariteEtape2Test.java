package com.marinedouyere.sentinelle.moteur;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import com.ibm.icu.text.Collator;
import com.ibm.icu.util.ULocale;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.BeforeClass;
import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Étape 2 : scan du dossier partagé, recherche et schéma de commande,
 * comparés à l'appli web sur les mêmes fichiers réels
 * (référence reference_etape2.json à côté de reference.json).
 */
public class PariteEtape2Test {

    private static File dossier;
    private static JSONObject reference;

    @BeforeClass
    public static void charger() throws IOException {
        String f = System.getProperty("sentinelle.fixtures", "");
        String r = System.getProperty("sentinelle.reference", "");
        assumeTrue("fichiers de test non fournis", !f.isEmpty() && !r.isEmpty());
        File ref = new File(new File(r).getParentFile(), "reference_etape2.json");
        assumeTrue("référence de l'étape 2 absente", ref.exists());
        dossier = new File(f);
        reference = new JSONObject(new String(Files.readAllBytes(ref.toPath()), StandardCharsets.UTF_8));
    }

    private static byte[] octets(String nom) throws IOException {
        return Files.readAllBytes(new File(dossier, nom).toPath());
    }

    private static Object nul(Object o) {
        return o == JSONObject.NULL ? null : o;
    }

    /** Même tri que localeCompare() du navigateur. */
    static Comparator<String> ordreNavigateur() {
        Collator c = Collator.getInstance(ULocale.ROOT);
        return c::compare;
    }

    // ---- A. scan ----

    @Test
    public void scanDuDossierPartage() {
        JSONObject scenarios = reference.getJSONObject("scenarios");
        JSONObject scan = reference.getJSONObject("scan");
        int verifies = 0;
        for (Iterator<String> it = scan.keys(); it.hasNext();) {
            String cas = it.next();
            String[] parts = cas.split("\\|");
            JSONArray defs = scenarios.getJSONArray(parts[0]);
            List<ScanDossier.Fichier> fichiers = new ArrayList<>();
            for (int i = 0; i < defs.length(); i++) {
                JSONObject d = defs.getJSONObject(i);
                fichiers.add(new ScanDossier.Fichier(d.getString("nom"), d.getLong("date"), null));
            }
            ScanDossier.Resultat r = ScanDossier.scanner(fichiers, parts[1], ordreNavigateur());

            List<String> obtenu = new ArrayList<>();
            List<ScanDossier.Cible> toutes = new ArrayList<>(r.fixes);
            toutes.addAll(r.chantiers);
            for (ScanDossier.Cible g : toutes) {
                boolean chantier = g.poste.equals(ScanDossier.POSTE_CHANTIERS);
                String code = chantier ? g.identiteChantier() : null;
                obtenu.add(String.join("|", "fichier", g.poste, g.parite, String.valueOf(code), "strat", g.strat.nom));
                if (g.coupe != null) obtenu.add(String.join("|", "fichier", g.poste, g.parite, String.valueOf(code), "coupe", g.coupe.nom));
                if (g.bkp != null) obtenu.add(String.join("|", "fichier", g.poste, g.parite, String.valueOf(code), "bkp", g.bkp.nom));
                if (g.coupe != null) obtenu.add(String.join("|", "go", g.poste, g.parite, String.valueOf(code)));
                if (g.bkp != null) obtenu.add(String.join("|", "scies", g.poste, g.parite, String.valueOf(code)));
            }
            JSONObject attendu = scan.getJSONObject(cas);
            JSONArray log = attendu.getJSONArray("log");
            List<String> attenduLog = new ArrayList<>();
            for (int i = 0; i < log.length(); i++) {
                JSONArray a = log.getJSONArray(i);
                List<String> morceaux = new ArrayList<>();
                for (int k = 0; k < a.length(); k++) morceaux.add(String.valueOf(nul(a.get(k))));
                attenduLog.add(String.join("|", morceaux));
            }
            assertEquals(cas, attenduLog, obtenu);

            String texte = attendu.getString("texte");
            if (r.aucunLancement) {
                assertTrue(cas, texte.startsWith("Aucun fichier de lancement reconnu dans ce dossier."));
            } else if (toutes.isEmpty()) {
                assertTrue(cas, texte.startsWith("Aucun fichier de \"" + libelle(parts[1]) + "\" trouvé dans ce dossier."));
            }
            assertTrue(cas + " : " + texte, texte.contains(noteNonReconnus(r)));
            String ignores = noteIgnores(r, libelle(parts[1]));
            if (ignores != null) assertTrue(cas, texte.contains(ignores));
            else assertFalse(cas, texte.contains("ignoré(s)"));
            verifies++;
        }
        assertEquals(18, verifies);
    }

    // Textes de l'appli web, pour vérifier que le moteur donne les mêmes informations.
    private static String noteNonReconnus(ScanDossier.Resultat r) {
        if (r.nonReconnus.isEmpty()) return r.nbFichiers + " fichier(s) dans le dossier, tous reconnus.";
        return r.nonReconnus.size() + " fichier(s) sur " + r.nbFichiers
                + " non reconnu(s) (aucun code ni semaine reconnaissable) : " + String.join(", ", r.nonReconnus);
    }

    private static String noteIgnores(ScanDossier.Resultat r, String libelleSemaine) {
        if (r.ignoresAutreSemaine == 0) return null;
        return r.ignoresAutreSemaine + " fichier(s) ignoré(s) : semaine différente de l'onglet actif (" + libelleSemaine + ").";
    }

    private static String messageIntrouvable(Recherche.Resultat r) {
        String quoi = r.numeroBande != null ? "bande/modulo T" + r.numeroBande : "clé ou commande " + r.requete;
        return quoi + " introuvable dans les " + r.nbSources
                + " poste(s)/lancement(s) sélectionné(s) (liste de coupe, .bkp et/ou fichier de lancement).";
    }

    private static String noteSource(Recherche.Trouvaille t) {
        if (t.sourceBkp) return "Pas de liste de coupe pour ce poste — données du .bkp (réellement optimisé).";
        if (t.sansCoupe) return "Pas de liste de coupe ni de .bkp pour ce poste — données du fichier de lancement uniquement.";
        return null;
    }

    private static String libelleQuantite(Recherche.Trouvaille t) {
        return t.sourceBkp ? "Quantité trouvée (.bkp)" : t.sansCoupe ? "Quantité attendue (fichier de lancement)" : "Quantité trouvée";
    }

    private static String libelle(String parite) {
        return parite.equals("paire") ? "Semaine paire" : "Semaine impaire";
    }

    // ---- B. recherche ----

    static final class SourceTest implements Recherche.Source {
        final String nom;
        final String strat;
        final String[] coupe;
        final String[] bkp;
        List<LecteurStrat.LigneStrat> lignes;
        Recherche.Coupe cacheCoupe;
        Recherche.DonneesBkp cacheBkp;

        SourceTest(String nom, String strat, String[] coupe, String[] bkp) {
            this.nom = nom;
            this.strat = strat;
            this.coupe = coupe;
            this.bkp = bkp;
        }

        @Override
        public String nom() {
            return nom;
        }

        @Override
        public boolean aCoupe() {
            return coupe != null;
        }

        @Override
        public boolean aBkp() {
            return bkp != null;
        }

        @Override
        public boolean aStrat() {
            return strat != null;
        }

        @Override
        public List<LecteurStrat.LigneStrat> lignesStrat() throws Exception {
            if (lignes == null) lignes = LecteurStrat.lire(Classeur.lire(octets(strat))).lignes;
            return lignes;
        }

        @Override
        public Recherche.Coupe coupe() throws Exception {
            if (cacheCoupe == null) {
                cacheCoupe = coupe[1].toLowerCase().endsWith(".pdf")
                        ? new Recherche.Coupe(null, LecteurCoupePdf.lire(octets(coupe[0]), new ExtracteurPdfBox()))
                        : new Recherche.Coupe(Classeur.lire(octets(coupe[0])), null);
            }
            return cacheCoupe;
        }

        @Override
        public Recherche.DonneesBkp bkp() throws Exception {
            if (cacheBkp == null) cacheBkp = Recherche.lireBkp(octets(bkp[0]), bkp[1]);
            return cacheBkp;
        }
    }

    private static String[] paireDeNoms(Object o) {
        if (o == JSONObject.NULL) return null;
        JSONArray a = (JSONArray) o;
        return new String[] {a.getString(0), a.getString(1)};
    }

    private static List<SourceTest> sources() {
        JSONArray defs = reference.getJSONArray("recherchePaires");
        String[] postes = {"Agglo 1er tour", "Feno", "Casse", "Agglo 2ème tour"};
        List<SourceTest> liste = new ArrayList<>();
        for (String poste : postes) {
            for (String parite : new String[] {"paire", "impaire"}) {
                for (int i = 0; i < defs.length(); i++) {
                    JSONArray d = defs.getJSONArray(i);
                    if (!d.getString(0).equals(poste) || !d.getString(1).equals(parite)) continue;
                    String[] strat = paireDeNoms(d.get(2));
                    liste.add(new SourceTest(poste + " — " + libelle(parite), strat == null ? null : strat[0],
                            paireDeNoms(d.get(3)), paireDeNoms(d.get(4))));
                }
            }
        }
        return liste;
    }

    private static final Pattern BALISE = Pattern.compile("<(\\w+)((?:\\s+[\\w:-]+=\"[^\"]*\")*)\\s*/?>([^<]*)");
    private static final Pattern ATTRIBUT = Pattern.compile("([\\w:-]+)=\"([^\"]*)\"");

    private static String decoder(String s) {
        return s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&amp;", "&");
    }

    /** Éléments d'un SVG sérialisé : "tag attr=val ... | texte". */
    private static List<String> elementsSvgJs(String svg) {
        List<String> r = new ArrayList<>();
        Matcher m = BALISE.matcher(svg);
        String precedent = null;
        while (m.find()) {
            String tag = m.group(1);
            if (tag.equals("svg")) continue;
            if (tag.equals("title")) {
                r.set(r.size() - 1, precedent + " | titre=" + decoder(m.group(3).trim()));
                continue;
            }
            StringBuilder sb = new StringBuilder(tag);
            Matcher a = ATTRIBUT.matcher(m.group(2));
            while (a.find()) {
                if (a.group(1).equals("text-anchor")) continue;
                sb.append(" ").append(a.group(1)).append("=").append(decoder(a.group(2)));
            }
            if (tag.equals("text")) sb.append(" | ").append(decoder(m.group(3).trim()));
            precedent = sb.toString();
            r.add(precedent);
        }
        return r;
    }

    private static List<String> elementsSvgNatifs(List<ElementSvg> elements) {
        List<String> r = new ArrayList<>();
        for (ElementSvg e : elements) {
            StringBuilder sb = new StringBuilder(e.tag);
            Map<String, String> attrs = new LinkedHashMap<>(e.attributs);
            // ordre des attributs de l'appli web : géométrie, puis classe, puis transform
            List<String> avant = new ArrayList<>();
            for (Map.Entry<String, String> a : attrs.entrySet()) {
                if (!a.getKey().equals("transform")) avant.add(a.getKey() + "=" + a.getValue());
            }
            avant.add("class=" + e.classe);
            if (attrs.containsKey("transform")) avant.add("transform=" + attrs.get("transform"));
            for (String a : avant) sb.append(' ').append(a);
            if (e.tag.equals("text")) sb.append(" | ").append(e.texte);
            if (e.titre != null) sb.append(" | titre=").append(e.titre);
            r.add(sb.toString());
        }
        return r;
    }

    private static List<String> champsNatifs(Recherche.Trouvaille t) {
        List<String> c = new ArrayList<>();
        c.add(libelleQuantite(t) + "=" + (t.quantite != null ? Js.nombre(t.quantite) : "?"));
        if (t.valeurs != null) c.add("Grain matching=" + (t.valeurs.isEmpty() ? "Unitaire (pas de grain matching)" : String.join("", t.valeurs)));
        Recherche.ChampsDetail d = t.champs;
        if (d != null && d.lancement != null) c.add("Lancement=" + d.lancement);
        if (d != null && d.epaisseurFinie != null) c.add("Épaisseur=" + Js.dimension(d.epaisseurFinie) + " mm");
        if (d != null && d.assemblage != null) c.add("Assemblage=" + d.assemblage);
        return c;
    }

    @Test
    public void rechercheCommeLAppliWeb() {
        JSONObject recherche = reference.getJSONObject("recherche");
        List<SourceTest> sources = sources();
        int nbSchemas = 0;
        for (Iterator<String> it = recherche.keys(); it.hasNext();) {
            String requete = it.next();
            JSONObject attendu = recherche.getJSONObject(requete);
            Recherche.Resultat r = Recherche.rechercher(requete, sources);
            JSONArray resultats = attendu.getJSONArray("resultats");
            if (r == null) {
                assertEquals(requete, "", attendu.getString("texte"));
                continue;
            }
            assertEquals(requete, attendu.getJSONArray("erreurs").length(), r.erreurs.size());
            assertEquals(requete + " : nombre de résultats", resultats.length(), r.trouvailles.size());
            if (resultats.length() == 0) {
                assertEquals(requete, attendu.getString("texte").trim(), messageIntrouvable(r));
            }
            for (int i = 0; i < resultats.length(); i++) {
                JSONObject a = resultats.getJSONObject(i);
                Recherche.Trouvaille t = r.trouvailles.get(i);
                String quoi = requete + " n°" + i + " (" + a.getString("cle") + ")";
                assertEquals(quoi, a.getString("cle"), t.cle);
                assertEquals(quoi, a.getString("poste"), t.source.nom());
                assertEquals(quoi, nul(a.get("note")), noteSource(t));
                List<String> champs = new ArrayList<>();
                JSONArray ca = a.getJSONArray("champs");
                for (int k = 0; k < ca.length(); k++) champs.add(ca.getJSONArray(k).getString(0) + "=" + ca.getJSONArray(k).getString(1));
                assertEquals(quoi, champs, champsNatifs(t));
                List<String> donnees = new ArrayList<>();
                JSONArray da = a.getJSONArray("donnees");
                for (int k = 0; k < da.length(); k++) donnees.add(da.getJSONArray(k).getString(0) + "=" + da.getJSONArray(k).getString(1));
                List<String> donneesNatives = new ArrayList<>();
                if (t.champs != null && t.champs.toutesDonnees != null) {
                    for (Map.Entry<String, String> e : t.champs.toutesDonnees.entrySet()) donneesNatives.add(e.getKey() + "=" + e.getValue());
                }
                assertEquals(quoi, donnees, donneesNatives);
                Object svg = nul(a.get("schemaPiece"));
                List<ElementSvg> schema = t.champs == null ? null : SchemaPiece.construire(t.champs);
                if (svg == null) {
                    assertNull(quoi, schema);
                } else {
                    assertNotNull(quoi, schema);
                    assertTrue(quoi, ((String) svg).contains("aria-label=\"" + SchemaPiece.libelle(t.champs) + "\""));
                    assertEquals(quoi, elementsSvgJs((String) svg), elementsSvgNatifs(schema));
                    nbSchemas++;
                }
            }

            Object schemaAttendu = nul(attendu.get("schema"));
            if (schemaAttendu == null) {
                assertTrue(requete, r.commandeUnique == null
                        || Recherche.lignesDeLaCommande(r.commandeUnique, sources).isEmpty());
                continue;
            }
            assertNotNull(requete, r.commandeUnique);
            SchemaCommande.Schema s = SchemaCommande.construire(r.commandeUnique, Recherche.lignesDeLaCommande(r.commandeUnique, sources));
            JSONObject sa = (JSONObject) schemaAttendu;
            assertEquals(requete, sa.getString("titre"), SchemaCommande.titre(s));
            comparerBlocs(requete, sa.getJSONArray("ensembles"), s, r.requete, true);
        }
        assertTrue("schémas de pièce vérifiés : " + nbSchemas, nbSchemas > 20);
    }

    private static String texteLigne(SchemaCommande.LignePiece lp) {
        SchemaCommande.Piece p = lp.piece;
        StringBuilder sb = new StringBuilder();
        sb.append(SchemaCommande.libelleType(p.type)).append(' ').append(p.article).append(" · ").append(SchemaCommande.dims(p));
        StringBuilder infos = new StringBuilder();
        for (SchemaCommande.Info i : lp.infos) infos.append(i.texte);
        if (infos.length() > 0) sb.append(' ').append(infos);
        return Js.normaliserEspaces(sb.toString());
    }

    private static void comparerBlocs(String quoi, JSONArray ensembles, SchemaCommande.Schema s, String cleSurlignee, boolean detail) {
        List<SchemaCommande.Bloc> blocs = SchemaCommande.blocs(s, cleSurlignee);
        assertEquals(quoi + " : blocs", ensembles.length(), blocs.size());
        for (int b = 0; b < blocs.size(); b++) {
            SchemaCommande.Bloc bloc = blocs.get(b);
            JSONObject e = ensembles.getJSONObject(b);
            String ici = quoi + " / bloc " + b;
            assertEquals(ici, e.getString("titre"), bloc.titre);
            assertEquals(ici, nul(e.get("ouvert")), bloc.ensemble == null ? null : bloc.ouvert);
            JSONArray pieces = e.getJSONArray("pieces");
            assertEquals(ici + " : pièces", pieces.length(), bloc.lignes.size());
            for (int k = 0; k < pieces.length(); k++) {
                SchemaCommande.LignePiece lp = bloc.lignes.get(k);
                String classe = "sc-piece " + lp.piece.type + (lp.piece.cle != null && lp.piece.cle.equals(cleSurlignee) ? " surligne" : "");
                if (detail) {
                    JSONObject pa = pieces.getJSONObject(k);
                    assertEquals(ici, pa.getString("classe"), classe);
                    assertEquals(ici, pa.getString("num"), lp.piece.ligneTexte());
                    assertEquals(ici, pa.getString("texte"), texteLigne(lp));
                    JSONArray infos = pa.getJSONArray("infos");
                    assertEquals(ici, infos.length(), lp.infos.size());
                    for (int i = 0; i < infos.length(); i++) assertEquals(ici, infos.getString(i), Js.trim(lp.infos.get(i).texte));
                } else {
                    JSONArray pa = pieces.getJSONArray(k);
                    assertEquals(ici, pa.getString(0), classe);
                    assertEquals(ici, pa.getString(1), lp.piece.ligneTexte());
                    assertEquals(ici, pa.getString(2), texteLigne(lp));
                }
            }
            Object svg = nul(e.get("svg"));
            if (bloc.ensemble == null) {
                assertNull(ici, svg);
                continue;
            }
            SchemaCommande.Dessin dessin = SchemaCommande.dessiner(s, bloc.ensemble);
            List<ElementSvg> elements = SchemaCommande.elements(dessin, cleSurlignee);
            if (detail) {
                JSONObject sv = (JSONObject) svg;
                assertEquals(ici, sv.getString("viewBox"), SchemaCommande.viewBox(dessin));
                JSONArray el = sv.getJSONArray("elements");
                assertEquals(ici + " : éléments", el.length(), elements.size());
                for (int i = 0; i < el.length(); i++) {
                    JSONArray x = el.getJSONArray(i);
                    ElementSvg n = elements.get(i);
                    String ou = ici + " / élément " + i;
                    assertEquals(ou, x.getString(0), n.tag);
                    assertEquals(ou, x.getString(1), n.classe);
                    assertEquals(ou, x.getString(2), n.geometrie());
                    assertEquals(ou, nul(x.get(3)), n.tag.equals("text") ? n.texte : n.titre);
                }
            } else {
                JSONArray sv = (JSONArray) svg;
                assertEquals(ici, sv.getString(0), SchemaCommande.viewBox(dessin));
                assertEquals(ici + " : éléments", sv.length() - 1, elements.size());
                for (int i = 0; i < elements.size(); i++) {
                    ElementSvg n = elements.get(i);
                    String ligne = n.tag + "|" + n.classe + "|" + n.geometrie() + "|" + (n.tag.equals("text") ? n.texte : "");
                    assertEquals(ici + " / élément " + i, sv.getString(i + 1), ligne);
                }
            }
        }
    }

    // ---- C. schéma de toutes les commandes ----

    @Test
    public void schemaDeToutesLesCommandes() throws Exception {
        JSONObject schemas = reference.getJSONObject("schemas");
        Map<String, List<LecteurStrat.LigneStrat>> lignesParFichier = new HashMap<>();
        int n = 0;
        int avecAssemblage = 0;
        for (Iterator<String> it = schemas.keys(); it.hasNext();) {
            String cle = it.next();
            String[] parts = cle.split("\\|", 2);
            List<LecteurStrat.LigneStrat> lignes = lignesParFichier.get(parts[0]);
            if (lignes == null) {
                lignes = LecteurStrat.lire(Classeur.lire(octets(parts[0]))).lignes;
                lignesParFichier.put(parts[0], lignes);
            }
            List<LecteurStrat.LigneStrat> lc = new ArrayList<>();
            java.util.Set<String> vues = new java.util.HashSet<>();
            for (LecteurStrat.LigneStrat l : lignes) if (l.commande.equals(parts[1]) && vues.add(l.cle)) lc.add(l);
            SchemaCommande.Schema s = SchemaCommande.construire(parts[1], lc);
            if (!s.joints.isEmpty()) avecAssemblage++;
            comparerBlocs(cle, schemas.getJSONObject(cle).getJSONArray("ensembles"), s, lc.get(0).cle, false);
            n++;
        }
        assertEquals(377, n);
        assertTrue("commandes avec plans assemblés : " + avecAssemblage, avecAssemblage > 10);
    }
}
