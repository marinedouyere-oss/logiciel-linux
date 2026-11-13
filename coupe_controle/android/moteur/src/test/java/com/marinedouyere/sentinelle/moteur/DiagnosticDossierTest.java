package com.marinedouyere.sentinelle.moteur;

import static org.junit.Assume.assumeTrue;

import com.ibm.icu.text.Collator;
import com.ibm.icu.util.ULocale;

import org.junit.Test;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Diagnostic d'un vrai dossier partagé (SENTINELLE_DOSSIER) : refait le scan
 * puis les contrôles de l'appli sur chaque case et affiche le résultat.
 * Sans dossier fourni, le test est ignoré.
 */
public class DiagnosticDossierTest {

    @Test
    public void diagnostic() throws Exception {
        String chemins = System.getProperty("sentinelle.dossier", "");
        assumeTrue(!chemins.isEmpty());
        for (String chemin : chemins.split(File.pathSeparator)) diagnostiquer(new File(chemin));
    }

    private static void diagnostiquer(File dossier) throws Exception {
        List<ScanDossier.Fichier> fichiers = new ArrayList<>();
        File[] contenu = dossier.listFiles();
        if (contenu == null) return;
        for (File f : contenu) if (f.isFile()) fichiers.add(new ScanDossier.Fichier(f.getName(), f.lastModified(), f));
        Collator c = Collator.getInstance(ULocale.ROOT);
        System.out.println("\n################ " + dossier.getName() + " (" + fichiers.size() + " fichiers)");
        for (String parite : new String[] {"paire", "impaire"}) {
            ScanDossier.Resultat r = ScanDossier.scanner(fichiers, parite, c::compare);
            System.out.println("\n=== Scan onglet " + parite + " : " + r.fixes.size() + " poste(s), " + r.chantiers.size()
                    + " chantier(s), autre semaine " + r.ignoresAutreSemaine + ", non reconnus " + r.nonReconnus);
            List<ScanDossier.Cible> toutes = new ArrayList<>(r.fixes);
            toutes.addAll(r.chantiers);
            Map<String, List<String>> clesParLancement = new java.util.LinkedHashMap<>();
            for (ScanDossier.Cible g : toutes) {
                controler(g);
                try {
                    List<String> cles = new ArrayList<>();
                    for (LecteurStrat.LigneStrat l : LecteurStrat.lire(Classeur.lire(Files.readAllBytes(((File) g.strat.reference).toPath()))).lignes) {
                        cles.add(l.cle);
                    }
                    clesParLancement.put(g.strat.nom, cles);
                } catch (Exception ignoree) {
                    // déjà signalé
                }
            }
            for (DoublonsEntreLancements.Groupe d : DoublonsEntreLancements.trouver(clesParLancement)) {
                System.out.println("\n    ⚠ " + d.cles.size() + " pièce(s) dans " + String.join(" + ", d.lancements) + " : "
                        + d.cles.subList(0, Math.min(5, d.cles.size())));
            }
        }
    }

    private static String nom(ScanDossier.Fichier f) {
        return f == null ? "—" : f.nom;
    }

    private static void controler(ScanDossier.Cible g) {
        System.out.println("\n--- " + g.poste + (g.poste.equals("Chantiers") ? " " + g.identiteChantier() : "")
                + " | lancement " + nom(g.strat) + " | coupe " + nom(g.coupe) + " | bkp " + nom(g.bkp));
        LecteurStrat.Resultat strat;
        Classeur classeur;
        try {
            classeur = Classeur.lire(Files.readAllBytes(((File) g.strat.reference).toPath()));
            strat = LecteurStrat.lire(classeur);
        } catch (Exception e) {
            System.out.println("    ❌ lancement illisible : " + e.getMessage());
            return;
        }
        StringBuilder sem = new StringBuilder();
        for (LecteurStrat.SemaineLivraison s : strat.semaines) sem.append(s.semaine).append("/").append(s.annee).append(" (").append(s.nbPieces).append(") ");
        String lancement = strat.lignes.isEmpty() ? "?" : strat.lignes.get(0).lancement;
        System.out.println("    lancement interne " + lancement + " · " + strat.lignes.size() + " lignes · semaines de livraison " + sem
                + "· doublons " + strat.doublons.size());
        try {
            Map<String, Double> trouve;
            String source;
            if (g.coupe != null) {
                byte[] octets = Files.readAllBytes(((File) g.coupe.reference).toPath());
                LecteurCoupe.Resultat rc = g.coupe.nom.toLowerCase().endsWith(".pdf")
                        ? LecteurCoupePdf.compter(LecteurCoupePdf.lire(octets, new ExtracteurPdfBox()))
                        : LecteurCoupe.lire(Classeur.lire(octets), strat.cles(), strat.qteParCle());
                trouve = rc.compteur;
                source = "liste de coupe";
            } else if (g.bkp != null) {
                trouve = LecteurBkp.lireSansProtections(Files.readAllBytes(((File) g.bkp.reference).toPath()), g.bkp.nom);
                source = ".bkp";
            } else {
                System.out.println("    (ni liste de coupe ni .bkp)");
                return;
            }
            Comparateur.Rapport rap = Comparateur.comparer(strat.lignes, trouve);
            System.out.println("    GO (" + source + ") : " + rap.nbAnomalies + " anomalie(s) / " + rap.lignes.size() + " clés, pièces attendues "
                    + Js.nombre(rap.piecesAttendues) + ", trouvées " + Js.nombre(rap.piecesTrouvees) + " (couches " + Js.nombre(rap.totalAttendu)
                    + "/" + Js.nombre(rap.totalTrouve) + ")");
            int n = 0;
            for (Comparateur.LigneRapport l : rap.anomalies()) {
                if (n++ >= 12) {
                    System.out.println("      …");
                    break;
                }
                System.out.println("      " + l.statut + " " + l.cle + " " + l.article + " attendu " + Js.nombre(l.qteAttendue) + " trouvé "
                        + Js.nombre(l.qteTrouvee));
            }
        } catch (Exception e) {
            System.out.println("    ❌ GO : " + e);
        }
        if (g.bkp != null) {
            try {
                byte[] octetsBkp = Files.readAllBytes(((File) g.bkp.reference).toPath());
                ControleCouleurs.Resultat couleurs = ControleCouleurs.controler(strat.lignes, LecteurBkp.couleurs(octetsBkp, g.bkp.nom));
                System.out.println("    Couleurs : " + (couleurs.sansStratifie ? "pas de stratifié dans le .bkp"
                        : couleurs.absentes.size() + " absente(s) sur " + couleurs.nbCouleurs));
                for (ControleCouleurs.Absente a : couleurs.absentes) {
                    System.out.println("      " + a.couleur + " (" + a.face + ") " + Js.nombre(a.nbPieces) + " pièce(s) : " + a.cles);
                }
                Map<String, Double> bkp = LecteurBkp.lire(octetsBkp, g.bkp.nom);
                List<LecteurBkp.Ecart> ecarts = LecteurBkp.comparerScies(LecteurStrat.quantitesAttenduesScies(classeur), bkp);
                System.out.println("    Scies : " + ecarts.size() + " écart(s), " + Js.nombre(LecteurBkp.somme(bkp)) + " pièces dans le .bkp");
                int n = 0;
                for (LecteurBkp.Ecart e : ecarts) {
                    if (n++ >= 12) {
                        System.out.println("      …");
                        break;
                    }
                    System.out.println("      " + e.cle + " attendu " + Js.nombre(e.attendu) + " .bkp " + Js.nombre(e.trouve) + " " + e.type());
                }
            } catch (Exception e) {
                System.out.println("    ❌ Scies : " + e);
            }
        }
    }
}
