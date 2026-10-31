package com.marinedouyere.sentinelle.moteur;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.BeforeClass;
import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Compare chaque résultat du moteur natif à celui calculé par l'appli web
 * (moteur JavaScript) sur les mêmes fichiers réels. Les fichiers et la
 * référence ne sont pas versionnés (données clients) : le test est ignoré
 * s'ils ne sont pas fournis (SENTINELLE_FIXTURES / SENTINELLE_REFERENCE).
 */
public class PariteAvecAppliWebTest {

    private static File dossier;
    private static JSONObject reference;

    @BeforeClass
    public static void charger() throws IOException {
        String f = System.getProperty("sentinelle.fixtures", "");
        String r = System.getProperty("sentinelle.reference", "");
        assumeTrue("fichiers de test non fournis", !f.isEmpty() && !r.isEmpty() && new File(r).exists());
        dossier = new File(f);
        reference = new JSONObject(new String(Files.readAllBytes(new File(r).toPath()), StandardCharsets.UTF_8));
    }

    private static byte[] octets(String nom) throws IOException {
        return Files.readAllBytes(new File(dossier, nom).toPath());
    }

    private static Classeur classeur(String nom) throws IOException {
        return Classeur.lire(octets(nom));
    }

    private static void egalNombre(String quoi, Object attendu, double obtenu) {
        assertTrue(quoi + " : attendu " + attendu + ", obtenu " + obtenu,
                attendu instanceof Number && Math.abs(((Number) attendu).doubleValue() - obtenu) < 1e-9);
    }

    private static void egalNombreOuNull(String quoi, Object attendu, Double obtenu) {
        if (attendu == JSONObject.NULL || attendu == null) {
            assertNull(quoi, obtenu);
        } else {
            assertTrue(quoi + " : attendu " + attendu + ", obtenu null", obtenu != null);
            egalNombre(quoi, attendu, obtenu);
        }
    }

    private static String texteOuNull(Object o) {
        return o == JSONObject.NULL ? null : (String) o;
    }

    private static void egalMap(String quoi, JSONArray attendu, Map<String, Double> obtenu) {
        List<String> clesObtenues = new ArrayList<>(obtenu.keySet());
        assertEquals(quoi + " : nombre de clés", attendu.length(), obtenu.size());
        for (int i = 0; i < attendu.length(); i++) {
            JSONArray kv = attendu.getJSONArray(i);
            assertEquals(quoi + " : clé n°" + i, kv.getString(0), clesObtenues.get(i));
            egalNombre(quoi + " " + kv.getString(0), kv.get(1), obtenu.get(kv.getString(0)));
        }
    }

    private static void egalRapport(String quoi, JSONObject attendu, Comparateur.Rapport obtenu) {
        egalNombre(quoi + " totalAttendu", attendu.get("totalAttendu"), obtenu.totalAttendu);
        egalNombre(quoi + " totalTrouve", attendu.get("totalTrouve"), obtenu.totalTrouve);
        assertEquals(quoi + " nbOk", attendu.getInt("nbOk"), obtenu.nbOk);
        assertEquals(quoi + " nbAnomalies", attendu.getInt("nbAnomalies"), obtenu.nbAnomalies);
        JSONArray lignes = attendu.getJSONArray("lignes");
        assertEquals(quoi + " nb lignes", lignes.length(), obtenu.lignes.size());
        for (int i = 0; i < lignes.length(); i++) {
            JSONObject a = lignes.getJSONObject(i);
            Comparateur.LigneRapport o = obtenu.lignes.get(i);
            String q = quoi + " ligne " + i + " (" + a.getString("cle") + ")";
            assertEquals(q + " cle", a.getString("cle"), o.cle);
            assertEquals(q + " commande", a.getString("commande"), o.commande);
            assertEquals(q + " ligne", a.getString("ligne"), o.ligne);
            assertEquals(q + " article", a.getString("article"), o.article);
            assertEquals(q + " lancement", a.getString("lancement"), o.lancement);
            assertEquals(q + " statut", a.getString("statut"), o.statut);
            egalNombre(q + " qte_attendue", a.get("qte_attendue"), o.qteAttendue);
            egalNombre(q + " qte_trouvee", a.get("qte_trouvee"), o.qteTrouvee);
            egalNombre(q + " ecart", a.get("ecart"), o.ecart);
        }
    }

    @Test
    public void fichiersDeLancement() throws Exception {
        JSONObject strats = reference.getJSONObject("strat");
        for (Iterator<String> it = strats.keys(); it.hasNext(); ) {
            String nom = it.next();
            JSONObject attendu = strats.getJSONObject(nom);
            Classeur c = classeur(nom);
            LecteurStrat.Resultat r = LecteurStrat.lire(c);

            JSONArray lignes = attendu.getJSONArray("lignes");
            assertEquals(nom + " nb lignes", lignes.length(), r.lignes.size());
            for (int i = 0; i < lignes.length(); i++) {
                JSONObject a = lignes.getJSONObject(i);
                LecteurStrat.LigneStrat o = r.lignes.get(i);
                String q = nom + " ligne " + i + " (" + a.getString("cle") + ")";
                assertEquals(q, a.getString("cle"), o.cle);
                egalNombre(q + " qte", a.get("qte"), o.qteAttendue);
                assertEquals(q + " commande", a.getString("commande"), o.commande);
                assertEquals(q + " ligne", a.getString("ligne"), o.ligne);
                assertEquals(q + " article", a.getString("article"), o.article);
                assertEquals(q + " lancement", a.getString("lancement"), o.lancement);
                assertEquals(q + " assemblage", texteOuNull(a.get("assemblage")), o.assemblage);
                egalNombreOuNull(q + " longueurFinie", a.get("longueurFinie"), o.longueurFinie);
                egalNombreOuNull(q + " largeurFinie", a.get("largeurFinie"), o.largeurFinie);
                egalNombreOuNull(q + " epaisseurFinie", a.get("epaisseurFinie"), o.epaisseurFinie);
                JSONObject td = a.getJSONObject("toutesDonnees");
                assertEquals(q + " toutesDonnees (colonnes)", new ArrayList<>(td.keySet()).size(), o.toutesDonnees.size());
                for (String col : td.keySet()) {
                    assertEquals(q + " colonne " + col, td.getString(col), o.toutesDonnees.get(col));
                }
            }

            JSONArray doublons = attendu.getJSONArray("doublons");
            assertEquals(nom + " doublons", doublons.length(), r.doublons.size());
            for (int i = 0; i < doublons.length(); i++) {
                JSONObject a = doublons.getJSONObject(i);
                LecteurStrat.Doublon o = r.doublons.get(i);
                assertEquals(nom + " doublon cle", a.getString("cle"), o.cle);
                assertEquals(nom + " doublon nbLignes", a.getInt("nbLignes"), o.nbLignes);
                assertEquals(nom + " doublon articles", a.getJSONArray("articles").toList(), new ArrayList<Object>(o.articles));
            }

            JSONArray semaines = attendu.getJSONArray("semaines");
            assertEquals(nom + " semaines", semaines.length(), r.semaines.size());
            for (int i = 0; i < semaines.length(); i++) {
                JSONObject a = semaines.getJSONObject(i);
                assertEquals(nom + " semaine annee", a.getString("annee"), r.semaines.get(i).annee);
                assertEquals(nom + " semaine", a.getString("semaine"), r.semaines.get(i).semaine);
                assertEquals(nom + " semaine nbPieces", a.getInt("nbPieces"), r.semaines.get(i).nbPieces);
            }

            egalMap(nom + " quantités scies", reference.getJSONObject("scies").getJSONArray(nom),
                    LecteurStrat.quantitesAttenduesScies(c));
        }
    }

    @Test
    public void listesDeCoupeEtRapports() throws Exception {
        JSONObject coupes = reference.getJSONObject("coupe");
        JSONObject pdfs = reference.getJSONObject("pdf");
        for (Iterator<String> it = coupes.keys(); it.hasNext(); ) {
            String cle = it.next();
            String[] noms = cle.split("\\|");
            JSONObject attendu = coupes.getJSONObject(cle);
            LecteurStrat.Resultat strat = LecteurStrat.lire(classeur(noms[0]));

            LecteurCoupe.Resultat res;
            Map<String, List<String>> grain;
            if (noms[1].endsWith(".pdf")) {
                List<LecteurCoupePdf.Enregistrement> records =
                        LecteurCoupePdf.lire(octets(noms[1]), new ExtracteurPdfBox());
                JSONArray recAttendus = pdfs.getJSONArray(noms[1]);
                assertEquals(noms[1] + " nb enregistrements", recAttendus.length(), records.size());
                for (int i = 0; i < recAttendus.length(); i++) {
                    JSONObject a = recAttendus.getJSONObject(i);
                    LecteurCoupePdf.Enregistrement o = records.get(i);
                    String q = noms[1] + " enregistrement " + i;
                    assertEquals(q + " desc", a.getString("desc"), o.desc);
                    assertEquals(q + " materiau", a.getString("materiau"), o.materiau);
                    assertEquals(q + " qte", a.getInt("qte"), o.qte);
                    assertEquals(q + " cle", texteOuNull(a.get("cle")), o.cle);
                    assertEquals(q + " grain", texteOuNull(a.get("grain")), o.grain);
                }
                res = LecteurCoupePdf.compter(records);
                grain = LecteurCoupePdf.grainMatching(records);
            } else {
                Classeur c = classeur(noms[1]);
                res = LecteurCoupe.lire(c, strat.cles(), strat.qteParCle());
                grain = LecteurCoupe.grainMatching(c, strat.cles());
            }
            egalMap(cle + " compteur", attendu.getJSONArray("compteur"), res.compteur);
            Object unitaires = attendu.get("nbUnitaires");
            assertEquals(cle + " nbUnitaires", unitaires == JSONObject.NULL ? null : (Integer) unitaires, res.nbUnitaires);
            assertEquals(cle + " nbPiecesTrouvees", attendu.getInt("nbPiecesTrouvees"), res.nbPiecesTrouvees);

            JSONArray grainAttendu = attendu.getJSONArray("grain");
            assertEquals(cle + " grain (clés)", grainAttendu.length(), grain.size());
            List<String> clesGrain = new ArrayList<>(grain.keySet());
            for (int i = 0; i < grainAttendu.length(); i++) {
                JSONArray kv = grainAttendu.getJSONArray(i);
                assertEquals(cle + " grain clé " + i, kv.getString(0), clesGrain.get(i));
                assertEquals(cle + " grain " + kv.getString(0), kv.getJSONArray(1).toList(), new ArrayList<Object>(grain.get(kv.getString(0))));
            }

            egalRapport(cle, attendu.getJSONObject("rapport"), Comparateur.comparer(strat.lignes, res.compteur));
        }
    }

    @Test
    public void fichiersBkpEtControleScies() throws Exception {
        JSONObject bkps = reference.getJSONObject("bkp");
        String[][] paires = {
            {"strat_264101.xlsx", "LAN264101STRAT_2026-09-22_0923_v12backup.bkp"},
            {"strat_264001.xlsx", "LAN264001STRAT_2026-09-23_0910_v12backup.bkp"},
            {"strat_264201.xlsx", "LAN264201STRAT_2026-09-28_0949_v12backup.bkp"},
        };
        for (String[] p : paires) {
            JSONObject attendu = bkps.getJSONObject(p[1]);
            Map<String, Double> qte = LecteurBkp.lire(octets(p[1]), p[1]);
            egalMap(p[1] + " quantités", attendu.getJSONArray("qte"), qte);

            Classeur c = classeur(p[0]);
            List<LecteurBkp.Ecart> ecarts = LecteurBkp.comparerScies(LecteurStrat.quantitesAttenduesScies(c), qte);
            JSONArray ecartsAttendus = attendu.getJSONArray("ecarts");
            assertEquals(p[1] + " écarts", ecartsAttendus.length(), ecarts.size());
            for (int i = 0; i < ecartsAttendus.length(); i++) {
                JSONObject a = ecartsAttendus.getJSONObject(i);
                assertEquals(p[1] + " écart cle", a.getString("cle"), ecarts.get(i).cle);
                egalNombre(p[1] + " écart attendu", a.get("attendu"), ecarts.get(i).attendu);
                egalNombre(p[1] + " écart trouve", a.get("trouve"), ecarts.get(i).trouve);
            }
            egalRapport(p[1] + " sans liste de coupe", attendu.getJSONObject("rapportSansCoupe"),
                    Comparateur.comparer(LecteurStrat.lire(c).lignes, qte));
        }
    }
}
