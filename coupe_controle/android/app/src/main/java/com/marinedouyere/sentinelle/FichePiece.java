package com.marinedouyere.sentinelle;

import android.graphics.Typeface;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.google.android.material.card.MaterialCardView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.marinedouyere.sentinelle.moteur.ElementSvg;
import com.marinedouyere.sentinelle.moteur.LecteurStrat;
import com.marinedouyere.sentinelle.moteur.Recherche;
import com.marinedouyere.sentinelle.moteur.SchemaCommande;
import com.marinedouyere.sentinelle.moteur.SchemaPiece;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Recherche d'une pièce par sa clé : la fiche simple, comme sur le PC — ce qu'est la pièce, le verdict, où elle est
 * lancée, où elle va dans la commande, et ses plans de coupe (lus par le PC dans la sauvegarde .bkp). Lecture seule.
 */
final class FichePiece {

    private final MainActivity activite;
    private final Ui ui;
    private final FichierPartage donnees;

    FichePiece(MainActivity activite, Ui ui, FichierPartage donnees) {
        this.activite = activite;
        this.ui = ui;
        this.donnees = donnees;
    }

    private String valeur(String[] piece, String colonne) {
        int i = donnees.colonne(colonne);
        return i >= 0 && i < piece.length ? piece[i] : "";
    }

    private static Double nombre(String v) {
        try {
            return v == null || v.isEmpty() ? null : Double.parseDouble(v);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Une ligne du fichier partagé, remise sous la forme d'une ligne du fichier de lancement (pour le schéma). */
    LecteurStrat.LigneStrat ligne(String[] p) {
        LecteurStrat.LigneStrat l = new LecteurStrat.LigneStrat();
        l.cle = valeur(p, "cle");
        l.commande = valeur(p, "commande");
        l.ligne = valeur(p, "ligne");
        l.article = valeur(p, "article");
        Double q = nombre(valeur(p, "pieces"));
        l.qteAttendue = q == null ? 1 : q;
        l.pieces = l.qteAttendue;
        l.longueurFinie = nombre(valeur(p, "longueur"));
        l.largeurFinie = nombre(valeur(p, "largeur"));
        l.epaisseurFinie = nombre(valeur(p, "epaisseur"));
        String assemblage = valeur(p, "assemblage");
        l.assemblage = assemblage.isEmpty() ? null : assemblage;
        Map<String, String> d = new LinkedHashMap<>();
        if (!valeur(p, "info3").isEmpty()) d.put("info 3 atelier", valeur(p, "info3"));
        String chants = valeur(p, "chants");
        String[] colonnesChants = {"conf_chantavant", "conf_chantarriere", "conf_chantgauche", "conf_chantdroit"};
        for (int i = 0; i < colonnesChants.length && i < chants.length(); i++) if (chants.charAt(i) == '1') d.put(colonnesChants[i], "1");
        Map<String, String> coins = new LinkedHashMap<>();
        coins.put("ARG", "Usinage angle arrière gauche");
        coins.put("ARD", "Usinage angle arrière droit");
        coins.put("AVD", "Usinage angle avant droit");
        coins.put("AVG", "Usinage angle avant gauche");
        for (String a : valeur(p, "angles").split(";")) {
            int k = a.indexOf(':');
            if (k > 0 && coins.containsKey(a.substring(0, k))) d.put(coins.get(a.substring(0, k)), a.substring(k + 1));
        }
        if (!valeur(p, "commentaire").isEmpty()) d.put("commentaire", valeur(p, "commentaire"));
        l.toutesDonnees = d;
        return l;
    }

    private static boolean aDessiner(SchemaCommande.Schema s, SchemaCommande.Ensemble e) {
        if (e.pieces.size() > 1) return true;
        SchemaCommande.Place place = s.placement.get(e.pieces.get(0));
        return place != null && (!place.fond.isEmpty() || place.retourGauche != null || place.retourDroite != null);
    }

    private TextView h3(String t) {
        TextView v = ui.titre(t, 14, Ui.BORDEAUX);
        v.setPadding(0, ui.dp(14), 0, ui.dp(4));
        return v;
    }

    private static String nomLancement(FichierPartage.Trouvaille t) {
        return PartageVue.titrePoste(t.lancement) + " · S" + t.semaine.semaine;
    }

    /** La fiche ; trouvailles : la pièce dans chaque lancement où elle est (la plus récente d'abord). */
    MaterialCardView carte(List<FichierPartage.Trouvaille> trouvailles) {
        MaterialCardView carte = ui.carte();
        LinearLayout corps = ui.colonne();
        corps.setPadding(ui.dp(16), ui.dp(14), ui.dp(16), ui.dp(14));
        carte.addView(corps);
        FichierPartage.Trouvaille t0 = trouvailles.get(0);
        String[] p = t0.piece;
        String cle = valeur(p, "cle");
        LecteurStrat.LigneStrat ligne = ligne(p);
        SchemaCommande.Piece piece = SchemaCommande.pieceDepuisLigne(ligne);

        TextView tCle = ui.texte(joindre(" · ", cle, "commande " + ligne.commande + ", ligne " + ligne.ligne, valeur(p, "client"),
                valeur(p, "reference").isEmpty() ? "" : "réf. " + valeur(p, "reference")), 12, false, Ui.GRIS);
        tCle.setTypeface(Typeface.MONOSPACE);
        corps.addView(tCle);
        String type = "autre".equals(piece.type) ? (ligne.article == null || ligne.article.isEmpty() ? "Pièce" : ligne.article) : SchemaCommande.libelleType(piece.type);
        String dims = ligne.longueurFinie != null && ligne.largeurFinie != null
                ? PlansLancement.nombre(ligne.longueurFinie) + " × " + PlansLancement.nombre(ligne.largeurFinie) + (ligne.epaisseurFinie != null ? " × " + PlansLancement.nombre(ligne.epaisseurFinie) : "") + " mm" : "";
        corps.addView(ui.titre(type + " " + dims, 20, Ui.NOIR), ui.marges(2, 0));
        String sous = joindre(" · ", valeur(p, "matiere").isEmpty() ? "" : "Agglo " + valeur(p, "matiere"), valeur(p, "coloris").isEmpty() ? "" : "dessus " + valeur(p, "coloris"),
                valeur(p, "coloris_inf").isEmpty() ? "" : "dessous " + valeur(p, "coloris_inf"), ligne.article);
        if (!sous.isEmpty()) corps.addView(ui.texte(sous, 14, false, Ui.GRIS));

        // Plans de la pièce dans le lancement le plus récent qui en a.
        PlansLancement.Piece plans = null;
        FichierPartage.Trouvaille avecPlans = null;
        for (FichierPartage.Trouvaille t : trouvailles) {
            PlansLancement.Piece x = PlansLancement.piece(t.lancement.plans, cle);
            if (x != null) {
                plans = x;
                avecPlans = t;
                break;
            }
        }
        corps.addView(verdict(trouvailles, plans, avecPlans), ui.marges(12, 4));

        // Où va la pièce : l'ensemble de la commande (pièces de la même commande dans la même semaine).
        try {
            List<LecteurStrat.LigneStrat> lignes = new ArrayList<>();
            java.util.Set<String> vues = new java.util.HashSet<>();
            for (FichierPartage.Lancement l : t0.semaine.lancements)
                for (String[] q : l.pieces)
                    if (ligne.commande.equals(valeur(q, "commande")) && vues.add(valeur(q, "cle"))) lignes.add(ligne(q));
            SchemaCommande.Schema schema = SchemaCommande.construire(ligne.commande, lignes);
            SchemaCommande.Bloc bloc = null;
            List<SchemaCommande.Info> infos = new ArrayList<>();
            for (SchemaCommande.Bloc b : SchemaCommande.blocs(schema, cle))
                for (SchemaCommande.LignePiece lp : b.lignes)
                    if (cle.equals(lp.piece.cle)) {
                        if (b.ensemble != null && aDessiner(schema, b.ensemble)) bloc = b;
                        infos.addAll(lp.infos);
                    }
            Recherche.ChampsDetail champs = new Recherche.ChampsDetail();
            champs.longueurFinie = ligne.longueurFinie;
            champs.largeurFinie = ligne.largeurFinie;
            champs.epaisseurFinie = ligne.epaisseurFinie;
            champs.assemblage = ligne.assemblage;
            champs.toutesDonnees = ligne.toutesDonnees;
            // Chants de la pièce (comme le PC les lit dans la liste de coupe).
            String chants = valeur(p, "chants");
            String[] cotes = {"chantAV", "chantAR", "chantG", "chantD"};
            for (int i = 0; i < cotes.length && i < chants.length(); i++) if (chants.charAt(i) == '1') champs.pdf.put(cotes[i], "oui");
            List<ElementSvg> seule = SchemaPiece.construire(champs);
            if (bloc != null || seule != null || !infos.isEmpty()) corps.addView(h3("Où va la pièce"));
            if (bloc != null) {
                SchemaCommande.Dessin dessin = SchemaCommande.dessiner(schema, bloc.ensemble);
                SchemaVue vue = SchemaVue.ensemble(activite, dessin, SchemaCommande.elements(dessin, cle));
                corps.addView(vue, ui.pleineLargeur());
                corps.addView(ui.texte(bloc.titre + " — la pièce cherchée est en jaune", 12, false, Ui.GRIS), ui.marges(2, 6));
            }
            if (seule != null) corps.addView(SchemaVue.piece(activite, seule), ui.marges(4, 4));
            for (SchemaCommande.Info i : infos) corps.addView(ui.texte(i.texte, 13, i.alerte, i.alerte ? 0xFFC62828 : Ui.NOIR));
        } catch (RuntimeException e) {
            // schéma impossible avec ces données : la fiche reste lisible sans lui
        }

        // Où est la pièce : une ligne par lancement.
        corps.addView(h3("Où est la pièce"));
        for (FichierPartage.Trouvaille t : trouvailles) {
            String n = valeur(t.piece, "pieces");
            PlansLancement.Piece x = PlansLancement.piece(t.lancement.plans, cle);
            String plan = "";
            if (x != null) {
                PlansLancement.PlanPiece premier = null;
                for (PlansLancement.PlanPiece y : x.plans) if (y.rang <= 1 && (premier == null || y.rang < premier.rang)) premier = y;
                plan = x.placees > 0 ? " · ✔ placée" + (premier == null ? "" : " · Pdc " + premier.plan.pdc + (premier.rang == 0 ? " (module " + premier.plan.nom + ")" : " · " + premier.plan.matiere)) : " · ✗ dans aucun plan";
            }
            corps.addView(ui.texte(nomLancement(t) + " · " + t.lancement.nom + " — " + (n.isEmpty() ? "?" : PlansLancement.nombre(Double.parseDouble(n))) + " pièce(s)" + plan, 13, false, Ui.NOIR), ui.marges(2, 0));
            for (FichierPartage.Probleme pb : t.problemes) {
                boolean valide = "valide".equals(pb.niveau);
                corps.addView(ui.texte((valide ? "✔ Validé OK · " : "⚠ ") + pb.type + " : " + pb.detail, 13, !valide, valide ? 0xFF2E7D32 : ("corriger".equals(pb.niveau) ? 0xFFC62828 : 0xFFB45309)), ui.marges(2, 0));
            }
        }

        // Plans de coupe.
        if (plans != null && !plans.plans.isEmpty()) {
            corps.addView(h3("Plans de coupe — " + plans.plans.size() + " plan(s), mêmes numéros « Pdc » que dans Cut Rite"));
            if ("b".equals(plans.type)) corps.addView(ui.texte("Pièce de la bande " + plans.groupe + " : elle est coupée dans la bande (pas de plan à part).", 13, false, Ui.GRIS));
            int i = 1;
            for (PlansLancement.PlanPiece y : plans.plans) corps.addView(cartePlan(i++, y, plans), ui.marges(6, 0));
            corps.addView(ui.texte("Toucher un plan l'ouvre en grand, pièces numérotées. Plans lus par Sentinelle sur le PC dans la sauvegarde .bkp.", 12, false, Ui.GRIS), ui.marges(6, 0));
        }
        return carte;
    }

    private View verdict(List<FichierPartage.Trouvaille> trouvailles, PlansLancement.Piece plans, FichierPartage.Trouvaille avecPlans) {
        FichierPartage.Trouvaille t0 = trouvailles.get(0);
        List<String> memeSemaine = new ArrayList<>();
        for (FichierPartage.Trouvaille t : trouvailles) if (t.semaine == t0.semaine && !t.lancement.casse) memeSemaine.add(nomLancement(t));
        boolean ok;
        String titre;
        String texte;
        List<String> aVoir = new ArrayList<>();
        for (FichierPartage.Probleme pb : t0.problemes) if (!"valide".equals(pb.niveau) && !"info".equals(pb.niveau)) aVoir.add(pb.type);
        String ou = PartageVue.titrePoste(t0.lancement) + ", semaine " + t0.semaine.semaine;
        if (memeSemaine.size() > 1) {
            ok = false;
            titre = "Lancée " + memeSemaine.size() + " fois";
            texte = "Dans " + String.join(" et ", memeSemaine) + " : risque de la fabriquer deux fois.";
        } else if (!aVoir.isEmpty()) {
            ok = false;
            titre = "Lancée — " + ou;
            texte = "À vérifier : " + String.join(", ", new java.util.LinkedHashSet<>(aVoir)) + ".";
        } else if (plans != null && avecPlans == t0 && plans.placees <= 0) {
            ok = false;
            titre = "Lancée — " + ou;
            texte = "À vérifier : dans aucun plan de coupe, elle ne sera pas coupée.";
        } else {
            ok = true;
            titre = (plans != null && avecPlans == t0 ? "Lancée et placée — " : "Lancée — ") + ou;
            texte = "Une seule fois." + (plans != null && !plans.groupe.isEmpty() ? " Dans " + ("m".equals(plans.type) ? "le module " : "la bande ") + plans.groupe + "." : "");
        }
        TextView v = ui.bandeau((ok ? "✔ " : "⚠ ") + titre + "\n" + texte, ok ? 0xFFE8F3EA : 0xFFFBF3E1, ok ? 0xFF2E7D32 : 0xFF7A5200);
        return v;
    }

    private View cartePlan(int numero, PlansLancement.PlanPiece y, PlansLancement.Piece p) {
        String[] t = PlansLancement.textes(y, p);
        LinearLayout bloc = ui.colonne();
        bloc.setPadding(ui.dp(10), ui.dp(8), ui.dp(10), ui.dp(8));
        bloc.setBackground(ui.fondABarre(0xFFFFFFFF, Ui.SAUMON, 0));
        LinearLayout tete = ui.rangee();
        tete.addView(ui.titre(numero + " · " + t[0], 14, Ui.BORDEAUX), ui.poids(1));
        TextView badge = ui.texte(t[1], 12, true, Ui.BORDEAUX);
        badge.setPadding(ui.dp(8), 0, 0, 0);
        tete.addView(badge);
        bloc.addView(tete);
        bloc.addView(ui.texte(t[2], 12, false, Ui.GRIS), ui.marges(2, 4));
        if (y.plan.modifie) bloc.addView(ui.texte("✎ Plan modifié dans Sentinelle sur le PC", 12, true, 0xFF1565C0), ui.marges(0, 4));
        bloc.addView(new PlanVue(activite, y.plan, y.visees, false), ui.pleineLargeur());
        bloc.addView(ui.texte(t[3], 13, false, Ui.NOIR), ui.marges(4, 0));
        bloc.setOnClickListener(v -> planEnGrand(y, t));
        bloc.setClickable(true);
        return bloc;
    }

    private void planEnGrand(PlansLancement.PlanPiece y, String[] t) {
        LinearLayout corps = ui.colonne();
        corps.setPadding(ui.dp(16), ui.dp(8), ui.dp(16), ui.dp(8));
        corps.addView(ui.texte(t[1] + " · " + t[2], 12, false, Ui.GRIS));
        if (y.plan.modifie)
            corps.addView(ui.bandeau("✎ Plan modifié dans Sentinelle sur le PC.\nBleu : pièce modifiée · vert : pièce posée · pointillés rouges : pièce retirée (ne pas couper).", 0xFFE3F0FC, 0xFF0D47A1), ui.marges(6, 0));
        corps.addView(new PlanVue(activite, y.plan, y.visees, true), ui.marges(6, 8));
        int n = 0;
        for (int i = 0; i < y.plan.morceaux.size(); i++) {
            PlansLancement.Morceau m = y.plan.morceaux.get(i);
            if (m.chute) continue;
            n++;
            boolean v = y.visees.contains(i);
            boolean change = !m.etat.isEmpty();
            String ligne = n + ". " + m.nom + (v ? " ← pièce cherchée" : "") + " · " + m.article + " · " + PlansLancement.dims(m.finiL, m.finiW)
                    + (change && !m.marque.isEmpty() ? " (" + m.marque + ")" : "");
            int couleur = "r".equals(m.etat) ? 0xFFC62828 : change ? 0xFF0D47A1 : Ui.NOIR;
            corps.addView(ui.texte(ligne, 13, v || change, couleur), ui.marges(2, 0));
        }
        List<String> chutes = new ArrayList<>();
        for (PlansLancement.Morceau m : y.plan.morceaux) if (m.chute) chutes.add(PlansLancement.dims(m.L, m.W));
        if (!chutes.isEmpty()) corps.addView(ui.texte("Chutes gardées : " + String.join(", ", chutes), 12, false, Ui.GRIS), ui.marges(6, 0));
        ScrollView defile = new ScrollView(activite);
        defile.addView(corps);
        new MaterialAlertDialogBuilder(activite).setTitle(t[0]).setView(defile).setPositiveButton("Fermer", null).show();
    }

    private static String joindre(String sep, String... morceaux) {
        StringBuilder sb = new StringBuilder();
        for (String m : morceaux) {
            if (m == null || m.isEmpty()) continue;
            if (sb.length() > 0) sb.append(sep);
            sb.append(m);
        }
        return sb.toString();
    }
}
