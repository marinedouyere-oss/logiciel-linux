package com.marinedouyere.sentinelle;

import android.app.Dialog;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * V6.3 : l'écran Plans de coupe, comme l'onglet du PC : les plans d'un lancement (lus par le PC dans le .bkp), rangés
 * par matière, avec les mêmes numéros « Pdc » que Cut Rite ; un plan s'ouvre en grand, s'imprime (PDF), et se modifie :
 * retirer une pièce, changer sa cote finie, poser une pièce dans une chute. La modification part au PC, qui la reprend
 * (le PC reste la référence : le .bkp, la liste de coupe et le fichier de lancement ne changent jamais).
 */
final class EcranPlans {

    interface Hote {
        FichierPartage donnees();

        void reconstruire();

        /** L'appli est-elle reliée au PC (code de liaison) ? Sans lien, rien ne peut partir au PC. */
        boolean relie();

        DemandesPc demandes();

        /** Ajoute la demande à la file d'attente et l'envoie au PC. */
        void envoyerDemande(JSONObject d);
    }

    static final class Source {
        FichierPartage.Semaine semaine;
        FichierPartage.Lancement lancement;
        String nomPlans; // le lancement tel que le PC le nomme dans ses plans (celui de la sauvegarde .bkp)

        String titre() {
            return "S" + semaine.semaine + " · " + PartageVue.titrePoste(lancement) + " · " + lancement.nom;
        }
    }

    private final MainActivity activite;
    private final Ui ui;
    private final Hote hote;
    private String choisi; // nom du lancement choisi
    private final Set<String> ouvertes = new HashSet<>(); // matières dépliées

    EcranPlans(MainActivity activite, Ui ui, Hote hote) {
        this.activite = activite;
        this.ui = ui;
        this.hote = hote;
    }

    /** Les lancements qui ont des plans de coupe, semaine la plus récente d'abord. */
    List<Source> sources() {
        List<Source> l = new ArrayList<>();
        FichierPartage f = hote.donnees();
        if (f == null) return l;
        for (FichierPartage.Semaine s : f.semaines)
            for (FichierPartage.Lancement x : s.lancements) {
                if (x.plans == null) continue;
                JSONArray p = x.plans.optJSONArray("plans");
                if (p == null || p.length() == 0) continue;
                Source src = new Source();
                src.semaine = s;
                src.lancement = x;
                src.nomPlans = x.plans.optString("lancement", x.nom);
                l.add(src);
            }
        return l;
    }

    void choisir(String nomLancement) {
        choisi = nomLancement;
        ouvertes.clear();
    }

    // ---- l'écran ----

    void construire(LinearLayout racine) {
        List<Source> liste = sources();
        if (liste.isEmpty()) {
            MaterialCardView carte = ui.carte();
            LinearLayout corps = corps(carte);
            corps.addView(ui.titreCarte("Aucun plan de coupe"));
            corps.addView(ui.texte("Le PC envoie les plans des 4 dernières semaines, pour les lancements qui ont leur sauvegarde .bkp (Contrôler la coupe sur le PC).",
                    14, false, Ui.NOIR), ui.marges(4, 0));
            racine.addView(carte);
            return;
        }
        Source s = liste.get(0);
        for (Source x : liste) if (x.lancement.nom.equals(choisi)) s = x;
        choisi = s.lancement.nom;
        racine.addView(selecteur(s, liste), ui.marges(2, 4));

        List<PlansLancement.Plan> plans = PlansLancement.tous(s.lancement.plans);
        // Ce qui attend la réponse du PC, et les dernières réponses, pour ce lancement.
        int attente = 0;
        for (JSONObject d : hote.demandes().enAttente())
            if ("plan".equals(d.optString("type")) && s.nomPlans.equals(d.optString("lancement"))) attente++;
        if (attente > 0)
            racine.addView(ui.bandeau("⏳ " + attente + " modification(s) envoyée(s) au PC, pas encore reprise(s) : elles sont montrées dans les plans.",
                    ui.couleur(R.color.attention_fond), ui.couleur(R.color.attention_texte)), ui.marges(2, 2));
        if (hote.demandes().erreur() != null && hote.demandes().aEnvoyer())
            racine.addView(ui.bandeau("⚠ Envoi au PC pas encore fait : " + hote.demandes().erreur() + " (nouvel essai à chaque Actualiser).",
                    ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)), ui.marges(2, 2));
        int n = 0;
        for (JSONObject r : hote.demandes().resultats()) {
            if (!"plan".equals(r.optString("type")) || !s.nomPlans.equals(r.optString("lancement")) || n++ >= 3) continue;
            boolean ok = r.optBoolean("ok");
            racine.addView(ui.bandeau((ok ? "✔ Repris par le PC : " : "⚠ Pas repris par le PC : ") + r.optString("texte"), ok ? ui.couleur(R.color.ok_fond) : ui.couleur(R.color.attention_fond),
                    ok ? ui.couleur(R.color.ok_texte) : ui.couleur(R.color.attention_texte)), ui.marges(2, 2));
        }

        // V6.9.5 : « Modules et bandes » d'abord (T1, T2… : une bande n'a pas de plan à elle, on montre le panneau où elle
        // est coupée), puis par matière, dans l'ordre du fichier.
        List<PlansLancement.Groupe> groupes = PlansLancement.groupes(s.lancement.plans);
        Map<Integer, PlansLancement.Plan> parRang = new java.util.HashMap<>();
        for (PlansLancement.Plan p : plans) parRang.put(p.rang, p);
        int nbBandes = 0;
        for (PlansLancement.Groupe g : groupes) if ("b".equals(g.type)) nbBandes++;
        Map<String, List<PlansLancement.Plan>> parMatiere = new LinkedHashMap<>();
        Map<String, String> descriptions = new LinkedHashMap<>();
        String cleModules = groupes.isEmpty() ? "Modules" : MODULES_ET_BANDES;
        int modules = 0;
        int modifies = 0;
        for (PlansLancement.Plan p : plans) if (p.module) modules++;
        if (modules > 0 || nbBandes > 0) parMatiere.put(cleModules, new ArrayList<>());
        for (PlansLancement.Plan p : plans) {
            String cle = p.module ? cleModules : p.matiere;
            if (!parMatiere.containsKey(cle)) parMatiere.put(cle, new ArrayList<>());
            parMatiere.get(cle).add(p);
            if (!p.module && !p.desc.isEmpty()) descriptions.put(cle, p.desc);
            if (p.modifie) modifies++;
        }
        racine.addView(ui.note((plans.size() - modules) + " plan(s), " + modules + " module(s) et " + nbBandes + " bande(s) · " + parMatiere.size() + " groupe(s)"
                + (modifies > 0 ? " · " + modifies + " modifié(s) dans Sentinelle" : "") + ". Touchez un groupe pour voir ses plans, puis un plan pour l'ouvrir en grand."), ui.marges(4, 4));
        MaterialCardView carte = ui.carte();
        LinearLayout corps = corps(carte);
        boolean premiere = true;
        for (Map.Entry<String, List<PlansLancement.Plan>> e : parMatiere.entrySet()) {
            if (!premiere) corps.addView(ui.filet(0, 0));
            premiere = false;
            boolean ouvert = ouvertes.contains(e.getKey());
            int nbModif = 0;
            for (PlansLancement.Plan p : e.getValue()) if (p.modifie || hote.demandes().enAttentePourPlan(s.nomPlans, p) != null) nbModif++;
            String desc = descriptions.containsKey(e.getKey()) ? descriptions.get(e.getKey()) : "";
            String sous = e.getKey().equals(MODULES_ET_BANDES) ? (groupes.size() - nbBandes) + " module(s) · " + nbBandes + " bande(s)"
                    : e.getValue().size() + (e.getKey().equals("Modules") ? " module(s)" : " plan(s)") + (desc.isEmpty() ? "" : " · " + desc);
            sous += nbModif > 0 ? " · " + nbModif + " modifié(s)" : "";
            LinearLayout tete = ui.ligne(null, e.getKey(), sous, null, ouvert ? "˄" : "˅", v -> {
                if (!ouvertes.remove(e.getKey())) ouvertes.add(e.getKey());
                hote.reconstruire();
            });
            corps.addView(tete);
            if (ouvert) {
                final Source src = s;
                LinearLayout dedans = ui.colonne();
                dedans.setPadding(ui.dp(8), 0, 0, ui.dp(6));
                dedans.setBackground(ui.fondABarre(0xFFFFFFFF, Ui.SAUMON, 3));
                if (e.getKey().equals(MODULES_ET_BANDES)) {
                    java.util.Set<String> vus = new java.util.HashSet<>();
                    for (PlansLancement.Groupe g : groupes) {
                        PlansLancement.Plan p = parRang.get(g.plan);
                        dedans.addView(ui.filet(4, 0));
                        dedans.addView("m".equals(g.type) && p != null ? blocPlan(src, p) : blocBande(src, g, p));
                        if (p != null && p.module) vus.add(p.nom);
                    }
                    // un module sans pièce du lancement (rare) : à la fin
                    for (PlansLancement.Plan p : e.getValue())
                        if (!vus.contains(p.nom)) {
                            dedans.addView(ui.filet(4, 0));
                            dedans.addView(blocPlan(src, p));
                        }
                } else
                    for (PlansLancement.Plan p : e.getValue()) {
                        dedans.addView(ui.filet(4, 0));
                        dedans.addView(blocPlan(src, p));
                    }
                corps.addView(dedans, ui.pleineLargeur());
            }
        }
        racine.addView(carte);
    }

    private LinearLayout corps(MaterialCardView carte) {
        LinearLayout c = ui.colonne();
        c.setPadding(ui.dp(14), ui.dp(12), ui.dp(14), ui.dp(12));
        carte.addView(c);
        return c;
    }

    private View selecteur(Source s, List<Source> liste) {
        LinearLayout r = ui.colonne();
        android.graphics.drawable.GradientDrawable fond = ui.fondRond(0xFFFFFFFF, 14);
        fond.setStroke(Math.max(1, ui.dp(1)), ui.couleur(R.color.bordure));
        r.setBackground(fond);
        r.setPadding(ui.dp(14), ui.dp(10), ui.dp(10), ui.dp(10));
        r.addView(ui.note("Lancement"));
        LinearLayout ligne = ui.rangee();
        TextView t = ui.texte(PartageVue.titrePoste(s.lancement) + " · " + s.lancement.nom, 15, true, Ui.BORDEAUX);
        ligne.addView(t, ui.poids(1));
        ligne.addView(ui.texte("▾", 15, true, Ui.BORDEAUX));
        r.addView(ligne);
        r.addView(ui.note("Semaine " + s.semaine.semaine + " · " + s.semaine.annee));
        ui.cliquable(r, v -> {
            String[] noms = new String[liste.size()];
            for (int i = 0; i < liste.size(); i++) noms[i] = liste.get(i).titre();
            new MaterialAlertDialogBuilder(activite).setTitle("Choisir le lancement").setItems(noms, (d, k) -> {
                choisir(liste.get(k).lancement.nom);
                hote.reconstruire();
            }).setNegativeButton("Annuler", null).show();
        });
        return r;
    }

    private static String titrePlan(PlansLancement.Plan p) {
        return p.module ? "Module " + p.nom : "Pdc " + p.pdc + " · " + p.matiere;
    }

    private static String sousTitre(PlansLancement.Plan p) {
        return (p.module ? "module" : p.sorte + " " + p.nom) + " · " + PlansLancement.dims(p.L, p.W) + (p.desc.isEmpty() ? "" : " · " + p.desc)
                + (p.fois > 1 ? " · coupé " + p.fois + " fois" : "");
    }

    static final String MODULES_ET_BANDES = "Modules et bandes";

    /** Une bande : le panneau d'agglo où elle est coupée, la bande en jaune (une bande n'a pas de plan à elle). */
    private View blocBande(Source s, PlansLancement.Groupe g, PlansLancement.Plan p) {
        LinearLayout bloc = ui.colonne();
        bloc.setPadding(ui.dp(2), ui.dp(8), ui.dp(2), ui.dp(8));
        bloc.addView(ui.titre("Bande " + g.nom, 14, Ui.BORDEAUX));
        if (p == null) {
            bloc.addView(ui.note("bande · " + g.pieces + " pièce(s) · pas de plan d'agglo trouvé"), ui.marges(1, 4));
            return bloc;
        }
        String dims = "";
        for (int i : g.visees)
            if (i >= 0 && i < p.morceaux.size()) {
                dims = " " + PlansLancement.dims(p.morceaux.get(i).L, p.morceaux.get(i).W);
                break;
            }
        bloc.addView(ui.note("bande" + dims + " · " + g.pieces + " pièce(s) · coupée dans le Pdc " + p.pdc + " · " + p.matiere + " (" + p.sorte + " " + p.nom + ")"
                + (p.fois > 1 ? " · coupé " + p.fois + " fois" : "") + (g.autres.isEmpty() ? "" : " · stratifié : " + android.text.TextUtils.join(", ", g.autres))), ui.marges(1, 4));
        bloc.addView(new PlanVue(activite, p, g.visees, false), ui.pleineLargeur());
        ui.cliquable(bloc, v -> ouvrir(s, p));
        return bloc;
    }

    private View blocPlan(Source s, PlansLancement.Plan p) {
        LinearLayout bloc = ui.colonne();
        bloc.setPadding(ui.dp(2), ui.dp(8), ui.dp(2), ui.dp(8));
        LinearLayout tete = ui.rangee();
        tete.addView(ui.titre(titrePlan(p), 14, Ui.BORDEAUX), ui.poids(1));
        JSONObject attente = hote.demandes().enAttentePourPlan(s.nomPlans, p);
        if (attente != null) tete.addView(ui.pilule("⏳ envoyé au PC", ui.couleur(R.color.attention_fond), ui.couleur(R.color.attention_texte)));
        else if (p.modifie) tete.addView(ui.pilule("✎ modifié", 0xFFE3F0FC, 0xFF0D47A1));
        bloc.addView(tete);
        bloc.addView(ui.note(sousTitre(p)), ui.marges(1, 4));
        bloc.addView(new PlanVue(activite, attente != null ? planMontre(p, baseDe(p), rtDe(attente)) : p, null, false), ui.pleineLargeur());
        ui.cliquable(bloc, v -> ouvrir(s, p));
        return bloc;
    }

    // ---- la modification : { morceaux: { n° d'origine: { retire } | { fini, note } }, ajouts: [ { dans, cle, article, fini, tourne, note } ] } ----

    private static JSONObject vide() {
        JSONObject o = new JSONObject();
        try {
            o.put("morceaux", new JSONObject());
            o.put("ajouts", new JSONArray());
        } catch (JSONException e) {
            // ne peut pas arriver
        }
        return o;
    }

    private static JSONObject copie(JSONObject o) {
        if (o == null) return vide();
        try {
            JSONObject c = new JSONObject(o.toString());
            if (c.optJSONObject("morceaux") == null) c.put("morceaux", new JSONObject());
            if (c.optJSONArray("ajouts") == null) c.put("ajouts", new JSONArray());
            return c;
        } catch (JSONException e) {
            return vide();
        }
    }

    private static JSONObject baseDe(PlansLancement.Plan p) {
        return copie(p.rt);
    }

    private static JSONObject rtDe(JSONObject demande) {
        return copie(demande.optJSONObject("rt"));
    }

    private static boolean memeObjet(Object a, Object b) {
        if (a == null || b == null) return a == b;
        return a.toString().equals(b.toString());
    }

    /** Le plan tel qu'il sera une fois la modification reprise par le PC (les pièces posées : placées par le PC). */
    static PlansLancement.Plan planMontre(PlansLancement.Plan p, JSONObject base, JSONObject brouillon) {
        PlansLancement.Plan q = new PlansLancement.Plan();
        q.matiere = p.matiere;
        q.nom = p.nom;
        q.sorte = p.sorte;
        q.desc = p.desc;
        q.pdc = p.pdc;
        q.fois = p.fois;
        q.module = p.module;
        q.L = p.L;
        q.W = p.W;
        q.modifie = p.modifie;
        q.empreinte = p.empreinte;
        q.rt = p.rt;
        q.origine.addAll(p.origine);
        JSONObject mb = base.optJSONObject("morceaux");
        JSONObject md = brouillon.optJSONObject("morceaux");
        JSONArray ab = base.optJSONArray("ajouts");
        JSONArray ad = brouillon.optJSONArray("ajouts");
        for (int i = 0; i < p.morceaux.size(); i++) {
            PlansLancement.Morceau m = p.morceaux.get(i);
            PlansLancement.Morceau n = new PlansLancement.Morceau();
            n.x = m.x;
            n.y = m.y;
            n.L = m.L;
            n.W = m.W;
            n.finiL = m.finiL;
            n.finiW = m.finiW;
            n.nom = m.nom;
            n.article = m.article;
            n.chute = m.chute;
            n.etat = m.etat;
            n.marque = m.marque;
            if (!m.chute) {
                int k = PlansLancement.ajoutDe(p, i);
                if (k >= 0) {
                    if (ad == null || k >= ad.length() || ab == null || k >= ab.length() || !memeObjet(ab.opt(k), ad.opt(k))) {
                        n.etat = "r";
                        n.marque = "pièce posée retirée (envoyé au PC)";
                    }
                } else {
                    int o = PlansLancement.origineDe(p, i);
                    String cle = String.valueOf(o);
                    Object vb = mb == null ? null : mb.opt(cle);
                    Object vd = md == null ? null : md.opt(cle);
                    if (o >= 0 && !memeObjet(vb, vd)) {
                        JSONObject d = vd instanceof JSONObject ? (JSONObject) vd : null;
                        if (d != null && d.optBoolean("retire")) {
                            n.etat = "r";
                            n.marque = "retirée — ne pas couper (envoyé au PC)";
                        } else if (d != null && d.optJSONArray("fini") != null) {
                            JSONArray f = d.optJSONArray("fini");
                            n.etat = "m";
                            n.marque = "cote finie " + PlansLancement.dims(m.finiL, m.finiW) + " → " + PlansLancement.dims(f.optDouble(0), f.optDouble(1)) + " (envoyé au PC)"
                                    + (d.optString("note").isEmpty() ? "" : " — " + d.optString("note"));
                            n.finiL = f.optDouble(0);
                            n.finiW = f.optDouble(1);
                        } else if (d == null) {
                            n.etat = "";
                            n.marque = "remise comme à l'origine (envoyé au PC)";
                        }
                    }
                }
            }
            q.morceaux.add(n);
        }
        return q;
    }

    /** Ce qui change par rapport au plan du PC, une ligne par changement (noms et cotes : les mêmes que sur le PC). */
    static List<String> changements(PlansLancement.Plan p, JSONObject base, JSONObject brouillon) {
        List<String> l = new ArrayList<>();
        JSONObject mb = base.optJSONObject("morceaux");
        JSONObject md = brouillon.optJSONObject("morceaux");
        Set<String> cles = new TreeSet<>((a, b) -> Integer.compare(Integer.parseInt(a), Integer.parseInt(b)));
        for (JSONObject m : new JSONObject[] {mb, md})
            if (m != null)
                for (Iterator<String> it = m.keys(); it.hasNext(); ) {
                    String k = it.next();
                    if (k.matches("\\d+")) cles.add(k);
                }
        for (String k : cles) {
            Object vb = mb == null ? null : mb.opt(k);
            Object vd = md == null ? null : md.opt(k);
            if (memeObjet(vb, vd)) continue;
            String nom = nomOrigine(p, Integer.parseInt(k));
            JSONObject d = vd instanceof JSONObject ? (JSONObject) vd : null;
            if (d == null) l.add(nom + " remise comme à l'origine");
            else if (d.optBoolean("retire")) l.add(nom + " retirée du plan — ne pas la couper");
            else {
                JSONArray f = d.optJSONArray("fini");
                l.add(nom + " modifiée : " + (f != null ? "cote finie → " + PlansLancement.dims(f.optDouble(0), f.optDouble(1)) : "") + (d.optString("note").isEmpty() ? "" : " — " + d.optString("note")));
            }
        }
        JSONArray ab = base.optJSONArray("ajouts");
        JSONArray ad = brouillon.optJSONArray("ajouts");
        int nb = ab == null ? 0 : ab.length();
        int nd = ad == null ? 0 : ad.length();
        int commun = 0;
        while (commun < nb && commun < nd && memeObjet(ab.opt(commun), ad.opt(commun))) commun++;
        for (int k = commun; k < nb; k++) l.add("pièce posée retirée : " + texteAjout(p, ab.optJSONObject(k)));
        for (int k = commun; k < nd; k++) l.add("+ " + texteAjout(p, ad.optJSONObject(k)));
        return l;
    }

    private static String texteAjout(PlansLancement.Plan p, JSONObject a) {
        if (a == null) return "";
        JSONArray f = a.optJSONArray("fini");
        String ou = "";
        int dans = a.optInt("dans", -1);
        for (int i = 0; i < p.morceaux.size(); i++)
            if (PlansLancement.origineDe(p, i) == dans && PlansLancement.ajoutDe(p, i) < 0) {
                PlansLancement.Morceau m = p.morceaux.get(i);
                ou = m.chute ? " posée dans la chute " + PlansLancement.dims(m.L, m.W) : " posée à la place de " + m.nom;
                break;
            }
        return (a.optString("cle").isEmpty() ? "pièce" : a.optString("cle")) + (a.optString("article").isEmpty() ? "" : " " + a.optString("article"))
                + (f != null ? " " + PlansLancement.dims(f.optDouble(0), f.optDouble(1)) : "") + ou + (a.optString("note").isEmpty() ? "" : " — " + a.optString("note"));
    }

    private static String nomOrigine(PlansLancement.Plan p, int o) {
        int n = 0;
        for (int i = 0; i < p.morceaux.size(); i++) {
            PlansLancement.Morceau m = p.morceaux.get(i);
            if (m.chute) continue;
            n++;
            if (PlansLancement.ajoutDe(p, i) < 0 && PlansLancement.origineDe(p, i) == o) return "n°" + n + " " + m.nom + " (" + PlansLancement.dims(m.finiL, m.finiW) + ")";
        }
        return "morceau " + o;
    }

    // ---- le plan en grand ----

    private final class Ouvert {
        Source source;
        PlansLancement.Plan plan;
        JSONObject base;
        JSONObject brouillon;
        boolean edition;
        Dialog fenetre;
    }

    void ouvrir(Source s, PlansLancement.Plan p) {
        Ouvert o = new Ouvert();
        o.source = s;
        o.plan = p;
        o.base = baseDe(p);
        JSONObject attente = hote.demandes().enAttentePourPlan(s.nomPlans, p);
        o.brouillon = attente != null ? rtDe(attente) : copie(o.base);
        o.fenetre = new Dialog(activite, android.R.style.Theme_DeviceDefault_Light_NoActionBar);
        remplir(o);
        o.fenetre.show();
    }

    private void remplir(Ouvert o) {
        PlansLancement.Plan p = o.plan;
        LinearLayout tout = ui.colonne();
        tout.setBackgroundColor(ui.couleur(R.color.fond));
        // Barre du haut : fermer, titre.
        LinearLayout barre = ui.rangee();
        barre.setBackgroundColor(Ui.BORDEAUX);
        barre.setPadding(ui.dp(4), ui.dp(6), ui.dp(12), ui.dp(6));
        MaterialButton fermer = ui.boutonTexte("✕");
        fermer.setTextColor(0xFFFFFFFF);
        fermer.setTextSize(18);
        fermer.setContentDescription("Fermer");
        fermer.setOnClickListener(v -> o.fenetre.dismiss());
        barre.addView(fermer);
        LinearLayout titres = ui.colonne();
        titres.addView(ui.titre(titrePlan(p), 17, 0xFFFFFFFF));
        titres.addView(ui.texte(o.source.lancement.nom + " · semaine " + o.source.semaine.semaine, 11, false, 0xDDFFFFFF));
        barre.addView(titres, ui.poids(1));
        tout.addView(barre, ui.pleineLargeur());

        ScrollView defile = new ScrollView(activite);
        LinearLayout c = ui.colonne();
        c.setPadding(ui.dp(14), ui.dp(10), ui.dp(14), ui.dp(24));
        defile.addView(c);
        tout.addView(defile, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        c.addView(ui.note(sousTitre(p)));
        boolean attente = hote.demandes().enAttentePourPlan(o.source.nomPlans, p) != null;
        List<String> changes = changements(p, o.base, o.brouillon);
        if (p.modifie) c.addView(ui.bandeau("✎ Plan modifié dans Sentinelle. Bleu : pièce modifiée · vert : pièce posée · pointillés rouges : pièce retirée (ne pas couper).",
                0xFFE3F0FC, 0xFF0D47A1), ui.marges(6, 0));
        if (attente && !o.edition) c.addView(ui.bandeau("⏳ Modification envoyée au PC, pas encore reprise : elle est montrée sur le plan.",
                ui.couleur(R.color.attention_fond), ui.couleur(R.color.attention_texte)), ui.marges(6, 0));
        if (o.edition) c.addView(ui.bandeau("✎ Modification : touchez une pièce pour la retirer ou changer sa cote finie, ou une chute pour y poser une pièce. Puis « Envoyer au PC ».",
                ui.couleur(R.color.attention_fond), ui.couleur(R.color.attention_texte)), ui.marges(6, 0));

        PlansLancement.Plan montre = planMontre(p, o.base, o.brouillon);
        c.addView(new PlanVue(activite, montre, null, true), ui.marges(8, 8));

        // Les pièces, numérotées comme sur le dessin.
        MaterialCardView cp = ui.carte();
        LinearLayout pieces = corps(cp);
        pieces.addView(ui.titreCarte("Pièces du plan"));
        int n = 0;
        for (int i = 0; i < montre.morceaux.size(); i++) {
            PlansLancement.Morceau m = montre.morceaux.get(i);
            if (m.chute) continue;
            n++;
            int couleur = "r".equals(m.etat) ? 0xFFC62828 : "m".equals(m.etat) ? 0xFF0D47A1 : "a".equals(m.etat) ? 0xFF2E7D32 : Ui.NOIR;
            String sous = joindre(" · ", m.article, PlansLancement.dims(m.finiL, m.finiW), m.marque);
            TextView num = ui.texte(String.valueOf(n), 12, true, Ui.NOIR);
            num.setGravity(Gravity.CENTER);
            num.setBackground(ui.fondRond(Ui.GRIS_CLAIR, 12));
            num.setLayoutParams(new LinearLayout.LayoutParams(ui.dp(26), ui.dp(26)));
            final int idx = i;
            LinearLayout r = ui.ligne(num, m.nom.isEmpty() ? "pièce" : m.nom, sous, null, o.edition ? "›" : null, o.edition ? v -> modifierPiece(o, idx) : null);
            ((TextView) ((LinearLayout) r.getChildAt(2)).getChildAt(0)).setTextColor(couleur);
            r.setPadding(0, ui.dp(6), 0, ui.dp(6));
            pieces.addView(r);
        }
        c.addView(cp);

        // Les chutes gardées : on peut y poser une pièce.
        List<Integer> chutes = new ArrayList<>();
        for (int i = 0; i < montre.morceaux.size(); i++) if (montre.morceaux.get(i).chute) chutes.add(i);
        if (!chutes.isEmpty()) {
            MaterialCardView cc = ui.carte();
            LinearLayout lc = corps(cc);
            lc.addView(ui.titreCarte("Chutes gardées"));
            if (o.edition) lc.addView(ui.note("Touchez une chute pour y poser une pièce."));
            for (int i : chutes) {
                PlansLancement.Morceau m = montre.morceaux.get(i);
                final int idx = i;
                LinearLayout r = ui.ligne(null, "Chute " + PlansLancement.dims(m.L, m.W), "à " + PlansLancement.nombre(m.x) + " mm du bord gauche, " + PlansLancement.nombre(m.y) + " mm du haut",
                        null, o.edition ? "›" : null, o.edition ? v -> poserPiece(o, idx, null) : null);
                r.setPadding(0, ui.dp(6), 0, ui.dp(6));
                lc.addView(r);
            }
            c.addView(cc);
        }

        // Ce qui change (pas encore repris par le PC).
        if (!changes.isEmpty()) {
            MaterialCardView ch = ui.carte();
            LinearLayout lch = corps(ch);
            lch.addView(ui.titreCarte(o.edition ? "Changements à envoyer au PC" : "Changements envoyés au PC"));
            for (String t : changes) lch.addView(ui.texte("• " + t, 13, false, Ui.NOIR), ui.marges(3, 0));
            c.addView(ch);
        }

        // Boutons.
        boolean peutModifier = hote.relie() && !p.empreinte.isEmpty();
        if (!hote.relie()) c.addView(ui.note("Pour modifier un plan depuis le téléphone, reliez l'appli au PC (« Relier au PC » en haut → Scanner le QR code du PC)."), ui.marges(6, 0));
        else if (p.empreinte.isEmpty()) c.addView(ui.note("Pour modifier ce plan depuis le téléphone, mettez Sentinelle à jour sur le PC (V6.3), puis renvoyez au téléphone."), ui.marges(6, 0));
        if (o.edition) {
            MaterialButton envoyer = ui.bouton("Envoyer au PC");
            envoyer.setEnabled(peutModifier && (!changes.isEmpty() || attente));
            envoyer.setOnClickListener(v -> envoyer(o));
            c.addView(envoyer, ui.marges(8, 0));
            MaterialButton annuler = ui.boutonContour("Annuler les changements");
            annuler.setOnClickListener(v -> {
                JSONObject att = hote.demandes().enAttentePourPlan(o.source.nomPlans, p);
                o.brouillon = att != null ? rtDe(att) : copie(o.base);
                o.edition = false;
                remplir(o);
            });
            c.addView(annuler, ui.marges(4, 0));
        } else {
            MaterialButton modifier = ui.bouton("Modifier le plan");
            modifier.setEnabled(peutModifier);
            modifier.setOnClickListener(v -> {
                o.edition = true;
                remplir(o);
            });
            c.addView(modifier, ui.marges(8, 0));
        }
        MaterialButton imprimer = ui.boutonContour("Imprimer le plan (PDF)");
        imprimer.setOnClickListener(v -> imprimer(o, montre, changes));
        c.addView(imprimer, ui.marges(4, 0));
        o.fenetre.setContentView(tout);
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

    private EditText champ(String indice, String valeur, boolean nombre) {
        EditText e = new EditText(activite);
        e.setHint(indice);
        e.setSingleLine(true);
        e.setText(valeur);
        e.setInputType(nombre ? InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        e.setTypeface(ui.lato());
        return e;
    }

    private LinearLayout formulaire(View... vues) {
        LinearLayout f = ui.colonne();
        f.setPadding(ui.dp(20), ui.dp(4), ui.dp(20), 0);
        for (View v : vues) f.addView(v, ui.marges(2, 2));
        return f;
    }

    private static Double mm(EditText e) {
        try {
            double v = Double.parseDouble(e.getText().toString().trim().replace(',', '.'));
            return v > 0 ? v : null;
        } catch (NumberFormatException x) {
            return null;
        }
    }

    /** Une pièce du plan touchée : la retirer, changer sa cote finie, la remettre comme à l'origine. */
    private void modifierPiece(Ouvert o, int i) {
        PlansLancement.Plan p = o.plan;
        PlansLancement.Morceau m = planMontre(p, o.base, o.brouillon).morceaux.get(i);
        int ajout = PlansLancement.ajoutDe(p, i);
        JSONArray ajouts = o.brouillon.optJSONArray("ajouts");
        if (ajout >= 0) {
            // Une pièce posée dans Sentinelle : la retirer.
            new MaterialAlertDialogBuilder(activite).setTitle("Pièce posée " + m.nom).setMessage("Retirer cette pièce posée du plan ?")
                    .setPositiveButton("Retirer", (d, k) -> {
                        if (ajouts != null && ajout < ajouts.length()) ajouts.remove(ajout);
                        remplir(o);
                    }).setNegativeButton("Annuler", null).show();
            return;
        }
        int origine = PlansLancement.origineDe(p, i);
        if (origine < 0) return;
        JSONObject morceaux = o.brouillon.optJSONObject("morceaux");
        String cle = String.valueOf(origine);
        JSONObject actuel = morceaux.optJSONObject(cle);
        boolean retiree = actuel != null && actuel.optBoolean("retire");
        if (retiree) {
            new MaterialAlertDialogBuilder(activite).setTitle(m.nom + " — retirée")
                    .setItems(new String[] {"Remettre la pièce dans le plan", "Poser une autre pièce à sa place"}, (d, k) -> {
                        if (k == 0) {
                            morceaux.remove(cle);
                            remplir(o);
                        } else poserPiece(o, i, cle);
                    }).setNegativeButton("Annuler", null).show();
            return;
        }
        EditText longueur = champ("longueur finie (mm)", PlansLancement.nombre(m.finiL), true);
        EditText largeur = champ("largeur finie (mm)", PlansLancement.nombre(m.finiW), true);
        EditText note = champ("note (facultatif)", actuel != null ? actuel.optString("note") : "", false);
        note.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        MaterialAlertDialogBuilder b = new MaterialAlertDialogBuilder(activite)
                .setTitle(m.nom + (m.article.isEmpty() ? "" : " · " + m.article))
                .setView(formulaire(ui.note("Cote finie (longueur, puis largeur)"), longueur, largeur, note))
                .setPositiveButton("Enregistrer", (d, k) -> {
                    Double L = mm(longueur);
                    Double W = mm(largeur);
                    try {
                        JSONObject x = new JSONObject();
                        if (L != null && W != null && (Math.abs(L - m.finiL) > 0.05 || Math.abs(W - m.finiW) > 0.05 || actuel != null && actuel.has("fini")))
                            x.put("fini", new JSONArray().put(L).put(W));
                        if (!note.getText().toString().trim().isEmpty()) x.put("note", note.getText().toString().trim());
                        if (x.length() > 0) morceaux.put(cle, x);
                    } catch (JSONException e) {
                        // valeurs refusées : rien ne change
                    }
                    remplir(o);
                })
                .setNeutralButton("Retirer du plan", (d, k) -> {
                    try {
                        morceaux.put(cle, new JSONObject().put("retire", true));
                    } catch (JSONException e) {
                        // ne peut pas arriver
                    }
                    remplir(o);
                });
        if (actuel != null) b.setNegativeButton("Remettre comme avant", (d, k) -> {
            morceaux.remove(cle);
            remplir(o);
        });
        else b.setNegativeButton("Annuler", null);
        b.show();
    }

    /** Poser une pièce dans une chute (ou à la place d'une pièce retirée). */
    private void poserPiece(Ouvert o, int i, String placeDe) {
        PlansLancement.Plan p = o.plan;
        int dans = PlansLancement.origineDe(p, i);
        if (dans < 0) return;
        EditText cle = champ("clé de la pièce (ex. 26110064003, facultatif)", "", false);
        cle.setInputType(InputType.TYPE_CLASS_NUMBER); // des chiffres : le « CVC » est ajouté tout seul
        EditText article = champ("article (facultatif)", "", false);
        EditText longueur = champ("longueur finie (mm)", "", true);
        EditText largeur = champ("largeur finie (mm)", "", true);
        CheckBox tourne = new CheckBox(activite);
        tourne.setText("Tourner la pièce (longueur de haut en bas)");
        EditText note = champ("note (facultatif)", "", false);
        note.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        PlansLancement.Morceau m = p.morceaux.get(i);
        new MaterialAlertDialogBuilder(activite)
                .setTitle(placeDe != null ? "Poser une pièce à la place de " + m.nom : "Poser une pièce dans la chute " + PlansLancement.dims(m.L, m.W))
                .setView(formulaire(cle, article, ui.note("Cote finie"), longueur, largeur, tourne, note))
                .setPositiveButton("Poser", (d, k) -> {
                    Double L = mm(longueur);
                    Double W = mm(largeur);
                    if (L == null || W == null) {
                        new MaterialAlertDialogBuilder(activite).setMessage("Tapez la longueur et la largeur finies (en mm).").setPositiveButton("OK", null).show();
                        return;
                    }
                    try {
                        JSONObject a = new JSONObject();
                        a.put("dans", dans);
                        String clePiece = cle.getText().toString().trim().toUpperCase(Locale.ROOT).replaceAll("\\s+", "");
                        if (clePiece.matches("\\d+")) clePiece = "CVC" + clePiece; // tapé en chiffres seulement
                        a.put("cle", clePiece);
                        a.put("article", article.getText().toString().trim());
                        a.put("fini", new JSONArray().put(L).put(W));
                        a.put("tourne", tourne.isChecked());
                        a.put("note", note.getText().toString().trim());
                        o.brouillon.optJSONArray("ajouts").put(a);
                        if (placeDe != null) o.brouillon.optJSONObject("morceaux").put(placeDe, new JSONObject().put("retire", true));
                    } catch (JSONException e) {
                        // valeurs refusées
                    }
                    remplir(o);
                })
                .setNegativeButton("Annuler", null)
                .show();
    }

    private void envoyer(Ouvert o) {
        PlansLancement.Plan p = o.plan;
        try {
            JSONObject d = new JSONObject();
            d.put("type", "plan");
            d.put("titre", titrePlan(p));
            d.put("lancement", o.source.nomPlans);
            d.put("matiere", p.matiere);
            d.put("pdc", p.pdc);
            d.put("module", p.module ? 1 : 0);
            d.put("nom", p.nom);
            d.put("empreinte", p.empreinte);
            d.put("rt", o.brouillon);
            JSONArray resume = new JSONArray();
            for (String t : changements(p, o.base, o.brouillon)) resume.put(t);
            d.put("resume", resume);
            hote.envoyerDemande(d);
        } catch (JSONException e) {
            return;
        }
        o.edition = false;
        o.fenetre.dismiss();
        hote.reconstruire();
    }

    // ---- impression : le plan (numéroté), ses pièces, ce qui change ----

    private void imprimer(Ouvert o, PlansLancement.Plan montre, List<String> changes) {
        byte[] pdf;
        try {
            pdf = pdf(o, montre, changes);
        } catch (Throwable e) {
            new MaterialAlertDialogBuilder(activite).setTitle("Imprimer").setMessage("Impossible de faire le PDF : " + e.getMessage()).setPositiveButton("OK", null).show();
            return;
        }
        String nom = ("plan_" + o.source.lancement.nom + "_" + (o.plan.module ? "module_" + o.plan.nom : o.plan.matiere + "_Pdc" + o.plan.pdc)).replaceAll("[^A-Za-z0-9_.-]+", "_") + ".pdf";
        activite.enregistrerPdf(nom, pdf);
    }

    private byte[] pdf(Ouvert o, PlansLancement.Plan montre, List<String> changes) throws java.io.IOException {
        android.graphics.pdf.PdfDocument doc = new android.graphics.pdf.PdfDocument();
        int largeur = 842;
        int hauteur = 595;
        android.graphics.pdf.PdfDocument.Page page = doc.startPage(new android.graphics.pdf.PdfDocument.PageInfo.Builder(largeur, hauteur, 1).create());
        Canvas c = page.getCanvas();
        Paint t = new Paint(Paint.ANTI_ALIAS_FLAG);
        t.setColor(Ui.BORDEAUX);
        t.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
        t.setTextSize(16);
        c.drawText(titrePlan(o.plan) + " — " + o.source.lancement.nom + " (semaine " + o.source.semaine.semaine + ")", 28, 34, t);
        t.setColor(Ui.GRIS);
        t.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL));
        t.setTextSize(10);
        c.drawText(sousTitre(o.plan) + (o.plan.modifie || !changes.isEmpty() ? " · plan modifié dans Sentinelle" : ""), 28, 50, t);
        // Le dessin (numéroté), à la largeur de la page.
        float densite = activite.getResources().getDisplayMetrics().density;
        int lp = Math.round(786 * densite);
        PlanVue v = new PlanVue(activite, montre, null, true);
        v.measure(View.MeasureSpec.makeMeasureSpec(lp, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
        float echelle = 1f / densite;
        float hDessin = v.getMeasuredHeight() * echelle;
        float maxDessin = 330;
        if (hDessin > maxDessin) {
            lp = Math.round(lp * maxDessin / hDessin);
            v.measure(View.MeasureSpec.makeMeasureSpec(lp, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
            hDessin = v.getMeasuredHeight() * echelle;
        }
        v.layout(0, 0, v.getMeasuredWidth(), v.getMeasuredHeight());
        int s = c.save();
        c.translate(28, 62);
        c.scale(echelle, echelle);
        v.draw(c);
        c.restoreToCount(s);
        // Les pièces, sur deux colonnes, puis les changements.
        float y = 62 + hDessin + 18;
        t.setColor(Ui.NOIR);
        t.setTextSize(8.5f);
        int n = 0;
        List<String> lignes = new ArrayList<>();
        for (PlansLancement.Morceau m : montre.morceaux) {
            if (m.chute) continue;
            n++;
            lignes.add(n + ". " + m.nom + (m.article.isEmpty() ? "" : " · " + m.article) + " · " + PlansLancement.dims(m.finiL, m.finiW) + (m.marque.isEmpty() ? "" : " (" + m.marque + ")"));
        }
        int parColonne = (int) Math.max(1, Math.ceil(lignes.size() / 2.0));
        for (int i = 0; i < lignes.size(); i++) {
            float x = i < parColonne ? 28 : 28 + 393;
            float yy = y + (i % parColonne) * 11;
            if (yy > hauteur - 60) continue;
            c.drawText(couper(lignes.get(i), t, 385), x, yy, t);
        }
        float yc = Math.min(hauteur - 50, y + parColonne * 11 + 10);
        if (!changes.isEmpty()) {
            t.setColor(0xFF0D47A1);
            t.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
            c.drawText("Changements :", 28, yc, t);
            t.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL));
            for (String ch : changes) {
                yc += 11;
                if (yc > hauteur - 22) break;
                c.drawText(couper("• " + ch, t, 786), 28, yc, t);
            }
        }
        t.setColor(Ui.GRIS);
        t.setTextSize(7.5f);
        c.drawText("Sentinelle " + activite.version() + " · LAISNÉ INDUSTRIE — document interne · imprimé depuis le téléphone", 28, hauteur - 12, t);
        doc.finishPage(page);
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        doc.writeTo(b);
        doc.close();
        return b.toByteArray();
    }

    private static String couper(String texte, Paint p, float max) {
        if (p.measureText(texte) <= max) return texte;
        String t = texte;
        while (t.length() > 1 && p.measureText(t + "…") > max) t = t.substring(0, t.length() - 1);
        return t + "…";
    }
}
