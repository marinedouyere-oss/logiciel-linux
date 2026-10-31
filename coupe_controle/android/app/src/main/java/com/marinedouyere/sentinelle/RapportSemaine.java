package com.marinedouyere.sentinelle;

import com.marinedouyere.sentinelle.moteur.Comparateur;
import com.marinedouyere.sentinelle.moteur.ControleCouleurs;
import com.marinedouyere.sentinelle.moteur.DoublonsEntreLancements;
import com.marinedouyere.sentinelle.moteur.ExportRapport;
import com.marinedouyere.sentinelle.moteur.LecteurBkp;
import com.marinedouyere.sentinelle.moteur.LecteurStrat;

import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Rapport Excel de toute une semaine : le tableau des lancements et ses
 * alertes, puis toutes les anomalies, lancement par lancement (contrôle,
 * Scies, couleurs, livraison, doublons). Le Diakonos est dans le rapport de son lancement.
 */
final class RapportSemaine {

    private RapportSemaine() {}

    /** « rapport_sentinelle_semaine_45.xlsx » */
    static String nomFichier(String libelleSemaine) {
        return "rapport_sentinelle_" + libelleSemaine.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "_") + ".xlsx";
    }

    private static String etatControle(Paire p) {
        if (p.rapport == null) return "—";
        return p.rapport.nbAnomalies == 0 ? "OK" : p.rapport.nbAnomalies + " anomalie(s)";
    }

    private static String etatScies(Paire p) {
        if (p.erreurScies != null) return "illisible";
        if (p.ecartsScies == null) return "—";
        return p.ecartsScies.isEmpty() ? "OK" : p.ecartsScies.size() + " écart(s)";
    }

    private static String etatCouleurs(Paire p) {
        if (p.couleurs == null) return "—";
        if (p.couleurs.sansStratifie) return "pas de stratifié";
        return p.couleurs.absentes.isEmpty() ? "OK" : p.couleurs.absentes.size() + " absente(s)";
    }

    private static int style(String etat) {
        if (etat.equals("OK")) return ExportRapport.VERT;
        if (etat.equals("—") || etat.equals("pas de stratifié")) return ExportRapport.NORMAL;
        return ExportRapport.ROUGE;
    }

    private static Object nombre(Double v) {
        return v == null || v.isNaN() ? (Object) "?" : (Object) v;
    }

    private static String nomLancement(RecapLancements.Ligne l) {
        return l.nom + " (" + l.lancement + ")";
    }

    private static LecteurStrat.SemaineLivraison principale(Paire p) {
        LecteurStrat.SemaineLivraison principale = p.semainesLivraison.get(0);
        for (LecteurStrat.SemaineLivraison s : p.semainesLivraison) if (s.nbPieces > principale.nbPieces) principale = s;
        return principale;
    }

    /** Les lignes ont toutes leur résumé (pièces, clés) : calculé avant, hors du fil d'affichage. */
    static byte[] xlsx(String libelleSemaine, List<RecapLancements.Ligne> lignes, List<RecapLancements.Ligne> autres,
            String libelleAutre, ControleCasse.Resultat casse) throws IOException {
        ExportRapport.Feuille f1 = new ExportRapport.Feuille(libelleSemaine, 26, 30, 15, 13, 18, 14, 16);
        f1.ligne(ExportRapport.TITRE, "Sentinelle — " + libelleSemaine + " — "
                + new SimpleDateFormat("dd/MM/yyyy", Locale.FRANCE).format(new Date()));
        f1.vide();
        f1.ligne(ExportRapport.ENTETE, "Poste", "Lancement", "Pièces prévues", "Pièces .bkp", "Contrôle", "Scies", "Couleurs");
        double prevues = 0;
        double bkp = 0;
        boolean auMoinsUnBkp = false;
        int anomalies = 0;
        int ecarts = 0;
        int couleurs = 0;
        for (RecapLancements.Ligne l : lignes) {
            Paire p = l.paire;
            String controle = etatControle(p);
            String scies = etatScies(p);
            String coul = etatCouleurs(p);
            // Une ligne par lancement ; la couleur suit le pire des trois contrôles.
            int st = Math.max(Math.max(style(controle), style(scies)), style(coul));
            f1.ligne(st == ExportRapport.ROUGE ? ExportRapport.ROUGE : ExportRapport.NORMAL, l.nom, l.lancement, nombre(l.prevues),
                    p.bkp == null ? "—" : nombre(l.bkp), controle, scies, coul);
            if (l.prevues != null && !l.prevues.isNaN()) prevues += l.prevues;
            if (p.bkp != null) {
                auMoinsUnBkp = true;
                if (l.bkp != null && !l.bkp.isNaN()) bkp += l.bkp;
            }
            if (p.rapport != null) anomalies += p.rapport.nbAnomalies;
            if (p.ecartsScies != null) ecarts += p.ecartsScies.size();
            if (p.couleurs != null) couleurs += p.couleurs.absentes.size();
        }
        f1.ligne(ExportRapport.TOTAL, "Total", "", prevues, auMoinsUnBkp ? (Object) bkp : "—",
                anomalies > 0 ? (Object) anomalies : "", ecarts > 0 ? (Object) ecarts : "", couleurs > 0 ? (Object) couleurs : "");

        // Alertes du tableau des lancements.
        Map<String, java.util.Set<String>> clesParLancement = new LinkedHashMap<>();
        for (RecapLancements.Ligne l : lignes) if (l.cles != null) clesParLancement.put(nomLancement(l), l.cles);
        List<DoublonsEntreLancements.Groupe> groupes = DoublonsEntreLancements.trouver(clesParLancement);
        if (!groupes.isEmpty()) {
            f1.vide();
            f1.ligne(ExportRapport.TITRE_ALERTE, "Pièces lancées deux fois");
            for (DoublonsEntreLancements.Groupe g : groupes) {
                f1.ligne(ExportRapport.NORMAL, String.join(", ", g.cles) + " — " + String.join(" + ", g.lancements));
            }
        }
        List<String> deja = new ArrayList<>();
        for (RecapLancements.Ligne l : lignes) {
            for (RecapLancements.Ligne o : autres) {
                // La casse a sa propre analyse (pièces déjà lancées la semaine d'avant), plus bas.
                if ("Casse".equals(l.paire.poste) || "Casse".equals(o.paire.poste)) continue;
                if (l.cles == null || o.cles == null) continue;
                List<String> communes = new ArrayList<>();
                for (String cle : l.cles) if (o.cles.contains(cle) && cle.length() > 3) communes.add(cle);
                if (communes.isEmpty()) continue;
                Collections.sort(communes);
                deja.add(String.join(", ", communes) + " — " + nomLancement(l) + " et " + nomLancement(o));
            }
        }
        if (!deja.isEmpty()) {
            f1.vide();
            f1.ligne(ExportRapport.TITRE_ALERTE, "Pièces déjà lancées en " + libelleAutre);
            for (String d : deja) f1.ligne(ExportRapport.NORMAL, d);
        }
        List<String> livraison = new ArrayList<>();
        for (RecapLancements.Ligne l : lignes) {
            Paire p = l.paire;
            if (p.semainesLivraison.size() <= 1 || "Casse".equals(p.poste)) continue;
            LecteurStrat.SemaineLivraison principale = principale(p);
            for (LecteurStrat.SemaineLivraison s : p.semainesLivraison) {
                if (s != principale) livraison.add(String.join(", ", s.cles) + " à livrer semaine " + s.semaine + " — " + nomLancement(l));
            }
        }
        if (!livraison.isEmpty()) {
            f1.vide();
            f1.ligne(ExportRapport.TITRE_ALERTE, "Pièces d'une autre semaine de livraison");
            for (String s : livraison) f1.ligne(ExportRapport.NORMAL, s);
        }
        if (casse != null && casse.erreur == null && casse.autreSemaineChargee == null && !casse.dejaLancees.isEmpty()) {
            f1.vide();
            f1.ligne(ExportRapport.TITRE_ALERTE, "Casse : pièces déjà lancées en semaine " + casse.semaineAvant);
            for (ControleCasse.Trouvee t : casse.dejaLancees) {
                f1.ligne(ExportRapport.NORMAL, ControleCasse.description(t.ligne, " — ") + " — " + t.lancement);
            }
            if (casse.nbAutres > 0) f1.ligne(ExportRapport.NORMAL, casse.nbAutres + " autre(s) pièce(s) pas lancée(s) en semaine " + casse.semaineAvant);
        }
        ExportRapport.Feuille f2 = new ExportRapport.Feuille("Anomalies", 20, 26, 12, 34, 7, 18, 9, 9, 48);
        f2.ligne(ExportRapport.ENTETE, "Poste", "Lancement", "Contrôle", "Clé / commande", "Ligne", "Article", "Attendu", "Trouvé", "Détail");
        int nb = 0;
        for (RecapLancements.Ligne l : lignes) {
            Paire p = l.paire;
            if (p.rapport != null) {
                for (Comparateur.LigneRapport a : p.rapport.anomalies()) {
                    String detail = a.couches > 1 ? a.statut + " — pièce de " + a.couches + " couches (quantités en couches)" : a.statut;
                    f2.ligne(Comparateur.MANQUANT.equals(a.statut) ? ExportRapport.ROUGE : ExportRapport.JAUNE, l.nom, l.lancement,
                            "Contrôle", a.cle, a.ligne, a.article, a.qteAttendue, a.qteTrouvee, detail);
                    nb++;
                }
                for (LecteurStrat.Doublon d : p.doublons) {
                    f2.ligne(ExportRapport.JAUNE, l.nom, l.lancement, "Doublon", d.cle, d.ligne, String.join(" / ", d.articles), "", "",
                            d.nbLignes + " lignes identiques dans le lancement");
                    nb++;
                }
            }
            if (p.erreurScies != null) {
                f2.ligne(ExportRapport.ROUGE, l.nom, l.lancement, "Scies", "", "", "", "", "", p.erreurScies);
                nb++;
            }
            if (p.ecartsScies != null) {
                for (LecteurBkp.Ecart e : p.ecartsScies) {
                    f2.ligne(ExportRapport.ROUGE, l.nom, l.lancement, "Scies", e.cle, "", "", e.attendu, e.trouve, e.type());
                    nb++;
                }
            }
            if (p.couleurs != null && !p.couleurs.sansStratifie) {
                for (ControleCouleurs.Absente a : p.couleurs.absentes) {
                    f2.ligne(ExportRapport.ROUGE, l.nom, l.lancement, "Couleur", String.join(", ", a.cles), "", "", a.nbPieces, 0,
                            "couleur " + a.couleur + " (" + a.face + ") absente du .bkp");
                    nb++;
                }
            }
            if (p.semainesLivraison.size() > 1 && !"Casse".equals(p.poste)) {
                LecteurStrat.SemaineLivraison principale = principale(p);
                for (LecteurStrat.SemaineLivraison s : p.semainesLivraison) {
                    if (s == principale) continue;
                    f2.ligne(ExportRapport.JAUNE, l.nom, l.lancement, "Livraison", String.join(", ", s.cles), "", "", s.nbPieces, "",
                            "à livrer semaine " + s.semaine + " (lancement : semaine " + principale.semaine + ")");
                    nb++;
                }
            }
        }
        if (nb == 0) f2.ligne(ExportRapport.NORMAL, "Aucune anomalie");
        return ExportRapport.classeur(Arrays.asList(f1, f2));
    }
}
