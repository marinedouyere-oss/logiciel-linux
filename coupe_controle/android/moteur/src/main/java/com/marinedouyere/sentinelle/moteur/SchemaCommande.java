package com.marinedouyere.sentinelle.moteur;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Schéma d'ensemble d'une commande (onglet Recherche) : plans assemblés en
 * L/U ou aboutés d'après les codes d'assemblage, crédences placées d'après
 * la longueur des plans, usinages d'angle et découpes — identique à
 * construireSchemaCommandeHtml() de l'appli web. Les coordonnées sont en mm.
 */
public final class SchemaCommande {

    private SchemaCommande() {}

    public static final double TOLERANCE_CREDENCE_MM = 3;
    private static final Set<String> TYPES_PLAN = new HashSet<>(Arrays.asList("plan", "ilot", "forme"));
    private static final Pattern MOTIF_CODE_ASSEMBLAGE = Pattern.compile("^(ETR)?(F|L)(G|D)(\\d+)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern SEPARATEUR_ASSEMBLAGE =
            Pattern.compile(Js.CLASSE_ESPACES + "*-" + Js.CLASSE_ESPACES + "*");
    private static final Pattern MOTIF_DECOUPE = Pattern.compile("DVR1|DVR", Pattern.CASE_INSENSITIVE);
    private static final Pattern MOTIF_ARTICLE_PLAN = Pattern.compile("^(TPPVC|TD\\d|TPA)");

    public static final String[] COINS = {"ARG", "ARD", "AVD", "AVG"};

    public static String libelleType(String type) {
        switch (type) {
            case "plan":
                return "Plan";
            case "ilot":
                return "Îlot";
            case "forme":
                return "Forme spéciale";
            case "credence":
                return "Crédence";
            case "jambage":
                return "Jambage";
            case "facade":
                return "Façade";
            default:
                return "Autre";
        }
    }

    static String libelleUsinageAngle(String code) {
        switch (code) {
            case "EP13":
                return "angle arrondi";
            case "EP15":
                return "pan coupé";
            case "EP12":
                return "pan coupé faible arrondi";
            case "EP14":
                return "entaille";
            default:
                return null;
        }
    }

    static String libelleCoin(String coin) {
        switch (coin) {
            case "ARG":
                return "arrière gauche";
            case "ARD":
                return "arrière droit";
            case "AVD":
                return "avant droit";
            default:
                return "avant gauche";
        }
    }

    // ---- pièces ----

    /** Code d'assemblage par étrier (ex. "ETRLG585", "FD600"). */
    public static final class Assemblage {
        public boolean sansRetour;
        /** "frontal" ou "latéral". */
        public String type;
        /** "gauche" ou "droite". */
        public String cote;
        public String valeur;
        public String brut;
    }

    public static Assemblage analyserCodeAssemblage(String code) {
        if (code == null || code.isEmpty()) return null;
        Matcher m = MOTIF_CODE_ASSEMBLAGE.matcher(Js.trim(code));
        if (!m.find()) return null;
        Assemblage a = new Assemblage();
        a.sansRetour = m.group(1) != null;
        a.type = m.group(2).toUpperCase(Locale.ROOT).equals("F") ? "frontal" : "latéral";
        a.cote = m.group(3).toUpperCase(Locale.ROOT).equals("G") ? "gauche" : "droite";
        a.valeur = m.group(4);
        a.brut = code;
        return a;
    }

    public static List<Assemblage> assemblagesDe(String texte) {
        List<Assemblage> liste = new ArrayList<>();
        for (String partie : SEPARATEUR_ASSEMBLAGE.split(texte == null ? "" : texte, -1)) {
            Assemblage a = analyserCodeAssemblage(partie);
            if (a != null) liste.add(a);
        }
        return liste;
    }

    public static final class Piece {
        public String cle;
        public double ligne;
        public String article;
        public String type;
        public Double L;
        public Double W;
        public Double E;
        public double qte;
        /** Chants AV, AR, G, D. */
        public final Map<String, Boolean> chants = new LinkedHashMap<>();
        /** Usinage par coin (ARG, ARD, AVD, AVG), null si aucun. */
        public final Map<String, String> angles = new LinkedHashMap<>();
        public List<Assemblage> assemblages = new ArrayList<>();
        public final List<String> decoupes = new ArrayList<>();
        public String commentaire;

        double l() {
            return L;
        }

        double w() {
            return W;
        }

        public String ligneTexte() {
            return Js.nombre(ligne);
        }
    }

    static String typePiece(String article) {
        String a = article == null ? "" : article.toUpperCase(Locale.ROOT);
        if (a.startsWith("CRED")) return "credence";
        if (a.startsWith("JAMB")) return "jambage";
        if (a.startsWith("PORTE")) return "facade";
        if (a.startsWith("ILOT")) return "ilot";
        if (a.startsWith("DECSPE")) return "forme";
        if (MOTIF_ARTICLE_PLAN.matcher(a).find()) return "plan";
        return "autre";
    }

    private static String donnee(Map<String, String> d, String colonne) {
        String v = d.get(colonne);
        return v == null || v.isEmpty() ? null : v;
    }

    private static Double dimension(Double finie, Map<String, String> d, String colonne) {
        if (finie != null && finie != 0 && !finie.isNaN()) return finie;
        Double v = Js.nombreOuNull(d.get(colonne));
        return v != null && v != 0 && !v.isNaN() ? v : null;
    }

    public static Piece pieceDepuisLigne(LecteurStrat.LigneStrat l) {
        Map<String, String> d = l.toutesDonnees != null ? l.toutesDonnees : Collections.<String, String>emptyMap();
        String info3 = donnee(d, "info 3 atelier");
        String codesAtelier = info3 != null ? info3 : (l.assemblage != null && !l.assemblage.isEmpty() ? l.assemblage : "");
        Piece p = new Piece();
        p.cle = l.cle;
        double n = Js.nombreStrict(l.ligne);
        p.ligne = Double.isNaN(n) ? 0 : n;
        p.article = l.article;
        p.type = typePiece(l.article);
        p.L = dimension(l.longueurFinie, d, "conf_longueur");
        p.W = dimension(l.largeurFinie, d, "conf_largeur");
        p.E = dimension(l.epaisseurFinie, d, "conf_epaisseur");
        p.qte = l.qteAttendue;
        p.chants.put("AV", donnee(d, "conf_chantavant") != null);
        p.chants.put("AR", donnee(d, "conf_chantarriere") != null);
        p.chants.put("G", donnee(d, "conf_chantgauche") != null);
        p.chants.put("D", donnee(d, "conf_chantdroit") != null);
        p.angles.put("ARG", donnee(d, "Usinage angle arrière gauche"));
        p.angles.put("ARD", donnee(d, "Usinage angle arrière droit"));
        p.angles.put("AVD", donnee(d, "Usinage angle avant droit"));
        p.angles.put("AVG", donnee(d, "Usinage angle avant gauche"));
        p.assemblages = assemblagesDe(l.assemblage);
        Matcher m = MOTIF_DECOUPE.matcher(codesAtelier);
        while (m.find()) p.decoupes.add(m.group().toUpperCase(Locale.ROOT));
        p.commentaire = donnee(d, "commentaire");
        return p;
    }

    // ---- appariement des assemblages ----

    public static final class Code {
        public final Piece piece;
        public final Assemblage a;
        final double n;
        Code partenaire;

        Code(Piece piece, Assemblage a) {
            this.piece = piece;
            this.a = a;
            this.n = Js.nombreStrict(a.valeur);
        }
    }

    public static final class Joint {
        /** "angle" (f reçoit l) ou "ligne" (d prolongé par g). */
        public final String type;
        public final Code f;
        public final Code l;
        public final Code d;
        public final Code g;

        Joint(String type, Code x, Code y) {
            this.type = type;
            if (type.equals("angle")) {
                f = x;
                l = y;
                d = null;
                g = null;
            } else {
                d = x;
                g = y;
                f = null;
                l = null;
            }
        }

        public boolean estAngle() {
            return type.equals("angle");
        }

        Code premier() {
            return estAngle() ? f : d;
        }

        Code second() {
            return estAngle() ? l : g;
        }

        public String codes() {
            return premier().a.brut + " / " + second().a.brut;
        }
    }

    interface Filtre {
        boolean garde(Code c);
    }

    private static List<Code> libres(List<Code> codes, Filtre filtre) {
        List<Code> r = new ArrayList<>();
        for (Code c : codes) if (c.partenaire == null && filtre.garde(c)) r.add(c);
        return r;
    }

    private static double ecartLignes(Code x, Code y) {
        return Math.abs(x.piece.ligne - y.piece.ligne);
    }

    static List<Joint> apparier(List<Piece> plans, List<Code> orphelins) {
        List<Code> codes = new ArrayList<>();
        for (Piece p : plans) for (Assemblage a : p.assemblages) codes.add(new Code(p, a));
        List<Joint> joints = new ArrayList<>();

        for (Code f : libres(codes, c -> c.a.type.equals("frontal"))) {
            String coteAttendu = f.a.cote.equals("droite") ? "gauche" : "droite";
            List<Code> candidats = libres(codes, c -> c.a.type.equals("latéral") && c.a.cote.equals(coteAttendu)
                    && c.piece != f.piece && c.piece.w() - f.n >= -2 && c.piece.w() - f.n <= 12);
            if (candidats.isEmpty()) continue;
            Collections.sort(candidats, (x, y) -> {
                int k = Double.compare(Math.abs(x.piece.w() - f.n), Math.abs(y.piece.w() - f.n));
                return k != 0 ? k : Double.compare(ecartLignes(x, f), ecartLignes(y, f));
            });
            Code l = candidats.get(0);
            f.partenaire = l;
            l.partenaire = f;
            joints.add(new Joint("angle", f, l));
        }

        for (Code d : libres(codes, c -> c.a.type.equals("latéral") && c.a.cote.equals("droite"))) {
            if (d.partenaire != null) continue;
            List<Code> candidats = libres(codes, c -> c.a.type.equals("latéral") && c.a.cote.equals("gauche")
                    && c.piece != d.piece && Math.abs(c.piece.w() - d.piece.w()) <= 2);
            if (candidats.isEmpty()) continue;
            Collections.sort(candidats, (x, y) -> Double.compare(ecartLignes(x, d), ecartLignes(y, d)));
            Code g = candidats.get(0);
            d.partenaire = g;
            g.partenaire = d;
            joints.add(new Joint("ligne", d, g));
        }

        for (Code c : codes) if (c.partenaire == null) orphelins.add(c);
        return joints;
    }

    // ---- disposition (matrices affines, convention SVG) ----

    public static final class Matrice {
        public final double a, b, c, d, e, f;

        public Matrice(double a, double b, double c, double d, double e, double f) {
            this.a = a;
            this.b = b;
            this.c = c;
            this.d = d;
            this.e = e;
            this.f = f;
        }

        static final Matrice IDENTITE = new Matrice(1, 0, 0, 1, 0, 0);

        Matrice composer(Matrice m2) {
            Matrice m1 = this;
            return new Matrice(
                    m1.a * m2.a + m1.c * m2.b,
                    m1.b * m2.a + m1.d * m2.b,
                    m1.a * m2.c + m1.c * m2.d,
                    m1.b * m2.c + m1.d * m2.d,
                    m1.a * m2.e + m1.c * m2.f + m1.e,
                    m1.b * m2.e + m1.d * m2.f + m1.f);
        }

        Matrice inverser() {
            double det = a * d - b * c;
            return new Matrice(d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det);
        }

        public double[] appliquer(double x, double y) {
            return new double[] {a * x + c * y + e, b * x + d * y + f};
        }
    }

    public static final class Ensemble {
        public final List<Piece> pieces = new ArrayList<>();
        public final Set<Joint> joints = new LinkedHashSet<>();
    }

    private static final class Voisin {
        final Piece piece;
        final Matrice m;
        final Joint joint;

        Voisin(Piece piece, Matrice m, Joint joint) {
            this.piece = piece;
            this.m = m;
            this.joint = joint;
        }
    }

    private static final Comparator<Piece> PAR_LIGNE = (x, y) -> Double.compare(x.ligne, y.ligne);

    static List<Ensemble> disposer(List<Piece> plans, List<Joint> joints, Map<Piece, Matrice> transformes) {
        Map<Piece, List<Voisin>> voisins = new IdentityHashMap<>();
        for (Piece p : plans) voisins.put(p, new ArrayList<>());
        for (Joint joint : joints) {
            Piece P;
            Piece Q;
            Matrice m;
            if (joint.estAngle()) {
                P = joint.f.piece;
                Q = joint.l.piece;
                m = joint.f.a.cote.equals("droite")
                        ? new Matrice(0, 1, -1, 0, P.l(), P.w())
                        : new Matrice(0, -1, 1, 0, 0, P.w() + Q.l());
            } else {
                P = joint.d.piece;
                Q = joint.g.piece;
                m = new Matrice(1, 0, 0, 1, P.l(), 0);
            }
            voisins.get(P).add(new Voisin(Q, m, joint));
            voisins.get(Q).add(new Voisin(P, m.inverser(), joint));
        }

        List<Ensemble> ensembles = new ArrayList<>();
        List<Piece> racines = new ArrayList<>(plans);
        Collections.sort(racines, PAR_LIGNE);
        for (Piece racine : racines) {
            if (transformes.containsKey(racine)) continue;
            Ensemble ensemble = new Ensemble();
            transformes.put(racine, Matrice.IDENTITE);
            List<Piece> aVisiter = new ArrayList<>();
            aVisiter.add(racine);
            while (!aVisiter.isEmpty()) {
                Piece p = aVisiter.remove(0);
                ensemble.pieces.add(p);
                for (Voisin v : voisins.get(p)) {
                    ensemble.joints.add(v.joint);
                    if (transformes.containsKey(v.piece)) continue;
                    transformes.put(v.piece, transformes.get(p).composer(v.m));
                    aVisiter.add(v.piece);
                }
            }
            Collections.sort(ensemble.pieces, PAR_LIGNE);
            ensembles.add(ensemble);
        }
        return ensembles;
    }

    // ---- crédences ----

    public static final class Mur {
        public double debut;
        public double fin;
        public boolean assemble;
        public Piece derriere;
    }

    public static final class Place {
        public List<Piece> fond = new ArrayList<>();
        public double debutFond;
        public Piece retourGauche;
        public Piece retourDroite;

        Piece retour(String cote) {
            return cote.equals("gauche") ? retourGauche : retourDroite;
        }

        void poserRetour(String cote, Piece c) {
            if (cote.equals("gauche")) retourGauche = c;
            else retourDroite = c;
        }

        int nbCredences() {
            return fond.size() + (retourGauche != null ? 1 : 0) + (retourDroite != null ? 1 : 0);
        }
    }

    static Map<Piece, Mur> murs(List<Ensemble> ensembles) {
        Map<Piece, Mur> murs = new IdentityHashMap<>();
        for (Ensemble ensemble : ensembles) {
            for (Piece p : ensemble.pieces) {
                Mur m = new Mur();
                m.debut = 0;
                m.fin = p.l();
                murs.put(p, m);
            }
            for (Joint j : ensemble.joints) {
                if (!j.estAngle()) continue;
                Mur murL = murs.get(j.l.piece);
                if (j.l.a.cote.equals("gauche")) murL.debut -= j.f.piece.w();
                else murL.fin += j.f.piece.w();
                murL.assemble = true;
                murL.derriere = j.f.piece;
                murs.get(j.f.piece).assemble = true;
            }
        }
        return murs;
    }

    static boolean longueurAcceptee(Mur mur, double somme) {
        double cible = mur.fin - mur.debut;
        if (!mur.assemble) return Math.abs(somme - cible) <= TOLERANCE_CREDENCE_MM;
        return somme >= cible - 30 && somme <= cible + 15;
    }

    static List<Piece> sousEnsemblePourMur(List<Piece> credences, Mur mur) {
        int n = credences.size();
        if (n == 0 || n > 14) return null;
        double cible = mur.fin - mur.debut;
        int meilleurMasque = -1;
        int meilleurNb = 0;
        double meilleurEcart = 0;
        for (int masque = 1; masque < 1 << n; masque++) {
            double somme = 0;
            int nb = 0;
            for (int i = 0; i < n; i++) {
                if ((masque & (1 << i)) != 0) {
                    somme += credences.get(i).l();
                    nb++;
                }
            }
            if (!longueurAcceptee(mur, somme)) continue;
            double ecart = Math.abs(somme - cible);
            if (meilleurMasque < 0 || nb > meilleurNb || (nb == meilleurNb && ecart < meilleurEcart)) {
                meilleurMasque = masque;
                meilleurNb = nb;
                meilleurEcart = ecart;
            }
        }
        if (meilleurMasque < 0) return null;
        List<Piece> r = new ArrayList<>();
        for (int i = 0; i < n; i++) if ((meilleurMasque & (1 << i)) != 0) r.add(credences.get(i));
        return r;
    }

    private static Set<String> cotesAssembles(Piece plan) {
        Set<String> s = new HashSet<>();
        for (Assemblage a : plan.assemblages) s.add(a.cote);
        return s;
    }

    private static final class Placement {
        final Map<Piece, Mur> murs;
        final Map<Piece, Place> places = new IdentityHashMap<>();
        final Set<Piece> restantes = new LinkedHashSet<>();

        Placement(Map<Piece, Mur> murs) {
            this.murs = murs;
        }

        void poserFond(Piece plan, List<Piece> fond) {
            Mur mur = murs.get(plan);
            double total = 0;
            for (Piece c : fond) total += c.l();
            Set<String> cotes = cotesAssembles(plan);
            boolean calerADroite = cotes.contains("gauche") && !cotes.contains("droite");
            Place place = places.get(plan);
            place.fond = fond;
            place.debutFond = calerADroite ? mur.fin - total : mur.debut;
            restantes.removeAll(fond);
        }

        void poserRetours(Piece plan, List<Piece> candidats) {
            Place place = places.get(plan);
            if (place.fond.isEmpty()) return;
            double premiereLigneFond = Double.POSITIVE_INFINITY;
            for (Piece c : place.fond) premiereLigneFond = Math.min(premiereLigneFond, c.ligne);
            Set<String> cotes = cotesAssembles(plan);
            for (Piece c : candidats) {
                if (!restantes.contains(c) || c.l() > plan.w() + TOLERANCE_CREDENCE_MM || c.l() < plan.w() - 30) continue;
                String prefere = c.ligne < premiereLigneFond ? "gauche" : "droite";
                String autre = prefere.equals("gauche") ? "droite" : "gauche";
                String cote = null;
                for (String k : new String[] {prefere, autre}) {
                    if (!cotes.contains(k) && place.retour(k) == null) {
                        cote = k;
                        break;
                    }
                }
                if (cote == null) continue;
                place.poserRetour(cote, c);
                restantes.remove(c);
            }
        }
    }

    static Placement placerCredences(List<Ensemble> ensembles, List<Piece> plans, List<Piece> credences) {
        Placement pl = new Placement(murs(ensembles));
        for (Piece p : plans) pl.places.put(p, new Place());
        pl.restantes.addAll(credences);
        Map<Piece, Ensemble> ensembleDe = new IdentityHashMap<>();
        for (Ensemble e : ensembles) for (Piece p : e.pieces) ensembleDe.put(p, e);

        Map<Ensemble, List<Piece>> groupes = new IdentityHashMap<>();
        for (Ensemble e : ensembles) groupes.put(e, new ArrayList<>());
        Ensemble courant = null;
        List<Piece> toutes = new ArrayList<>(plans);
        toutes.addAll(credences);
        Collections.sort(toutes, PAR_LIGNE);
        for (Piece piece : toutes) {
            if (piece.type.equals("credence")) {
                if (courant != null) groupes.get(courant).add(piece);
            } else {
                courant = ensembleDe.get(piece);
            }
        }
        int avecCredences = 0;
        for (Ensemble e : ensembles) if (!groupes.get(e).isEmpty()) avecCredences++;
        boolean intercalees = ensembles.size() <= 1 || avecCredences >= 2;

        if (intercalees) {
            for (Ensemble ensemble : ensembles) {
                List<Piece> groupe = groupes.get(ensemble);
                List<Piece> plansOrdonnes = new ArrayList<>(ensemble.pieces);
                Collections.sort(plansOrdonnes, (a, b) -> {
                    int k = Boolean.compare(pl.murs.get(a).assemble, pl.murs.get(b).assemble);
                    return k != 0 ? k : Double.compare(a.ligne, b.ligne);
                });
                for (Piece plan : plansOrdonnes) {
                    List<Piece> dispo = new ArrayList<>();
                    for (Piece c : groupe) if (pl.restantes.contains(c)) dispo.add(c);
                    List<Piece> fond = sousEnsemblePourMur(dispo, pl.murs.get(plan));
                    if (fond != null) pl.poserFond(plan, fond);
                }
                for (Piece plan : ensemble.pieces) pl.poserRetours(plan, groupe);
            }
        }

        List<Piece> plansParLigne = new ArrayList<>(plans);
        Collections.sort(plansParLigne, PAR_LIGNE);
        List<Piece> credencesParLigne = new ArrayList<>(credences);
        Collections.sort(credencesParLigne, PAR_LIGNE);
        int indexDernierPlan = -1;
        for (int ic = 0; ic < credencesParLigne.size(); ic++) {
            Piece c = credencesParLigne.get(ic);
            if (!pl.restantes.contains(c)) continue;
            int choix = -1;
            int premier = -1;
            for (int i = 0; i < plansParLigne.size(); i++) {
                Piece p = plansParLigne.get(i);
                if (!pl.places.get(p).fond.isEmpty() || !longueurAcceptee(pl.murs.get(p), c.l())) continue;
                if (premier < 0) premier = i;
                if (choix < 0 && i > indexDernierPlan) choix = i;
            }
            if (premier < 0) continue;
            if (choix < 0) choix = premier;
            Piece plan = plansParLigne.get(choix);
            List<Piece> fond = new ArrayList<>();
            fond.add(c);
            pl.poserFond(plan, fond);
            indexDernierPlan = choix;
            Piece suivante = ic + 1 < credencesParLigne.size() ? credencesParLigne.get(ic + 1) : null;
            if (suivante == null) continue;
            boolean vaAuFondDUnAutrePlan = false;
            for (Piece p : plansParLigne) {
                if (pl.places.get(p).fond.isEmpty() && longueurAcceptee(pl.murs.get(p), suivante.l())) {
                    vaAuFondDUnAutrePlan = true;
                    break;
                }
            }
            if (!vaAuFondDUnAutrePlan) {
                List<Piece> candidats = new ArrayList<>();
                candidats.add(suivante);
                pl.poserRetours(plan, candidats);
            }
        }
        return pl;
    }

    // ---- schéma complet ----

    public static final class Schema {
        public String commande;
        public final List<Piece> pieces = new ArrayList<>();
        public final List<Piece> plans = new ArrayList<>();
        public final List<Piece> credences = new ArrayList<>();
        public final List<Piece> autres = new ArrayList<>();
        public List<Joint> joints;
        public final List<Code> orphelins = new ArrayList<>();
        public List<Ensemble> ensembles;
        public final Map<Piece, Matrice> transformes = new IdentityHashMap<>();
        public Map<Piece, Place> placement;
        public Map<Piece, Mur> murs;
        public final List<Piece> nonPlacees = new ArrayList<>();

        public List<Code> orphelinsDe(Piece p) {
            List<Code> r = new ArrayList<>();
            for (Code o : orphelins) if (o.piece == p) r.add(o);
            return r;
        }
    }

    public static Schema construire(String commande, List<LecteurStrat.LigneStrat> lignes) {
        Schema s = new Schema();
        s.commande = commande;
        for (LecteurStrat.LigneStrat l : lignes) s.pieces.add(pieceDepuisLigne(l));
        Collections.sort(s.pieces, PAR_LIGNE);
        for (Piece p : s.pieces) {
            boolean dims = p.L != null && p.W != null;
            if (TYPES_PLAN.contains(p.type) && dims) s.plans.add(p);
            else if (p.type.equals("credence") && dims) s.credences.add(p);
            else s.autres.add(p);
        }
        s.joints = apparier(s.plans, s.orphelins);
        s.ensembles = disposer(s.plans, s.joints, s.transformes);
        Placement pl = placerCredences(s.ensembles, s.plans, s.credences);
        s.placement = pl.places;
        s.murs = pl.murs;
        s.nonPlacees.addAll(pl.restantes);
        Collections.sort(s.nonPlacees, PAR_LIGNE);
        return s;
    }

    public static String description(Ensemble ensemble, Map<Piece, Matrice> transformes) {
        if (ensemble.pieces.size() == 1) return "";
        Set<Long> orientations = new LinkedHashSet<>();
        for (Piece p : ensemble.pieces) {
            Matrice m = transformes.get(p);
            orientations.add(Math.floorMod(Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI + 360), 360L));
        }
        boolean opposees = false;
        boolean perpendiculaires = false;
        for (long o : orientations) {
            if (orientations.contains((o + 180) % 360)) opposees = true;
            if (orientations.contains((o + 90) % 360)) perpendiculaires = true;
        }
        if (opposees && perpendiculaires) return " · plan en U";
        if (perpendiculaires) return " · plan en L";
        return " · plans aboutés en ligne";
    }

    // ---- contour d'un plan (usinages d'angle compris) ----

    /** Élément de tracé : "M" (départ), "L" (droite) ou "A" (arc de rayon r, sens horaire). */
    public static final class Trace {
        public final char op;
        public final double x;
        public final double y;
        public final double r;

        Trace(char op, double[] pt, double r) {
            this.op = op;
            this.x = pt[0];
            this.y = pt[1];
            this.r = r;
        }
    }

    public static final class Contour {
        public final List<Trace> traces = new ArrayList<>();
        /** Bords AR, D, AV, G : deux points chacun. */
        public final Map<String, double[][]> bords = new LinkedHashMap<>();
        public final List<double[]> points = new ArrayList<>();
        /** Même tracé au format SVG que l'appli web (sert aux vérifications). */
        public String chemin;
    }

    private static final class Coin {
        double[] entree;
        double[] sortie;
        final List<Trace> traces = new ArrayList<>();
        String svg = "";
    }

    private static final double[][] COINS_XY_ARRIVEE_DEPART = {
        // x (0 ou L), y (0 ou W), arrivée (ax, ay), départ (dx, dy)
        {0, 0, 0, -1, 1, 0},
        {1, 0, 1, 0, 0, 1},
        {1, 1, 0, 1, -1, 0},
        {0, 1, -1, 0, 0, -1},
    };

    private static String f1(double v) {
        return Js.toFixed(v, 1);
    }

    private static String fmt(double[] pt) {
        return f1(pt[0]) + " " + f1(pt[1]);
    }

    public static Contour contour(Piece p, Matrice m) {
        double L = p.l();
        double W = p.w();
        double taille = Math.min(Math.max(Math.min(L, W) * 0.18, 50), 220);
        double entailleL = Math.min(L * 0.3, 400);
        double entailleW = Math.min(W * 0.35, 250);

        Coin[] coins = new Coin[4];
        for (int i = 0; i < 4; i++) {
            double[] def = COINS_XY_ARRIVEE_DEPART[i];
            double cx = def[0] * L;
            double cy = def[1] * W;
            double ax = def[2];
            double ay = def[3];
            double dx = def[4];
            double dy = def[5];
            String angle = p.angles.get(COINS[i]);
            String code = angle == null ? "" : angle.toUpperCase(Locale.ROOT);
            Coin coin = new Coin();
            if (code.equals("EP13") || code.equals("EP15") || code.equals("EP12")) {
                coin.entree = m.appliquer(cx - ax * taille, cy - ay * taille);
                coin.sortie = m.appliquer(cx + dx * taille, cy + dy * taille);
                double rayon = code.equals("EP13") ? taille : code.equals("EP12") ? taille * 2.2 : -1;
                if (rayon > 0) {
                    coin.traces.add(new Trace('A', coin.sortie, rayon));
                    coin.svg = "A " + f1(rayon) + " " + f1(rayon) + " 0 0 1 " + fmt(coin.sortie);
                } else {
                    coin.traces.add(new Trace('L', coin.sortie, 0));
                    coin.svg = "L " + fmt(coin.sortie);
                }
            } else if (code.equals("EP14")) {
                double aArrivee = ax != 0 ? entailleL : entailleW;
                double aDepart = dx != 0 ? entailleL : entailleW;
                coin.entree = m.appliquer(cx - ax * aArrivee, cy - ay * aArrivee);
                double[] interieur = m.appliquer(cx - ax * aArrivee + dx * aDepart, cy - ay * aArrivee + dy * aDepart);
                coin.sortie = m.appliquer(cx + dx * aDepart, cy + dy * aDepart);
                coin.traces.add(new Trace('L', interieur, 0));
                coin.traces.add(new Trace('L', coin.sortie, 0));
                coin.svg = "L " + fmt(interieur) + " L " + fmt(coin.sortie);
            } else {
                double[] sommet = m.appliquer(cx, cy);
                coin.entree = sommet;
                coin.sortie = sommet;
            }
            coins[i] = coin;
        }

        Coin arg = coins[0];
        Coin ard = coins[1];
        Coin avd = coins[2];
        Coin avg = coins[3];
        Contour c = new Contour();
        c.chemin = "M " + fmt(arg.sortie) + " L " + fmt(ard.entree) + " " + ard.svg + " L " + fmt(avd.entree) + " " + avd.svg + " "
                + "L " + fmt(avg.entree) + " " + avg.svg + " L " + fmt(arg.entree) + " " + arg.svg + " Z";
        c.traces.add(new Trace('M', arg.sortie, 0));
        for (Coin coin : new Coin[] {ard, avd, avg, arg}) {
            c.traces.add(new Trace('L', coin.entree, 0));
            c.traces.addAll(coin.traces);
        }
        c.bords.put("AR", new double[][] {arg.sortie, ard.entree});
        c.bords.put("D", new double[][] {ard.sortie, avd.entree});
        c.bords.put("AV", new double[][] {avd.sortie, avg.entree});
        c.bords.put("G", new double[][] {avg.sortie, arg.entree});
        for (Coin coin : coins) {
            c.points.add(coin.entree);
            c.points.add(coin.sortie);
        }
        return c;
    }

    /** Arc SVG (grand arc 0, sens horaire) de (x1,y1) à (x2,y2) : centre, rayon, angle de départ et balayage (degrés). */
    public static double[] arcCentre(double x1, double y1, double x2, double y2, double r) {
        double xp = (x1 - x2) / 2;
        double yp = (y1 - y2) / 2;
        double lambda = (xp * xp + yp * yp) / (r * r);
        if (lambda > 1) r *= Math.sqrt(lambda);
        double num = r * r * r * r - r * r * yp * yp - r * r * xp * xp;
        double den = r * r * yp * yp + r * r * xp * xp;
        double coef = den == 0 ? 0 : Math.sqrt(Math.max(0, num / den)); // grand arc 0 ≠ sens 1 : signe +
        double cxp = coef * yp;
        double cyp = -coef * xp;
        double cx = cxp + (x1 + x2) / 2;
        double cy = cyp + (y1 + y2) / 2;
        double debut = Math.toDegrees(Math.atan2((yp - cyp) / r, (xp - cxp) / r));
        double fin = Math.toDegrees(Math.atan2((-yp - cyp) / r, (-xp - cxp) / r));
        double balayage = fin - debut;
        while (balayage < 0) balayage += 360;
        while (balayage > 360) balayage -= 360;
        return new double[] {cx, cy, r, debut, balayage};
    }

    // ---- dessin d'un ensemble ----

    public static final class Forme {
        /** "plan", "decoupe", "credence", "joint", "orphelin". */
        public final String genre;
        public Piece piece;
        public Contour contour;
        public double[] centre;
        public List<double[]> points;
        public String code;

        Forme(String genre) {
            this.genre = genre;
        }
    }

    public static final class Dessin {
        public final List<Forme> formes = new ArrayList<>();
        public double minX;
        public double minY;
        public double largeur;
        public double hauteur;
        /** Taille du texte, en mm du dessin. */
        public double police;
        /** Échelle de référence de l'appli web (dessin affiché sur 280 px). */
        public double pxParMm;

        public List<Forme> genre(String g) {
            List<Forme> r = new ArrayList<>();
            for (Forme f : formes) if (f.genre.equals(g)) r.add(f);
            return r;
        }

        /** Le texte de cotes tient-il dans ce plan (sinon seul le numéro de ligne est écrit) ? */
        public boolean etroit(Piece p) {
            return Math.min(p.l(), p.w()) * pxParMm < 36;
        }
    }

    private static List<double[]> polygone(Matrice m, double[][] coins) {
        List<double[]> r = new ArrayList<>();
        for (double[] c : coins) r.add(m.appliquer(c[0], c[1]));
        return r;
    }

    public static Dessin dessiner(Schema s, Ensemble ensemble) {
        final double ecart = 60;
        Dessin dessin = new Dessin();
        List<double[]> tousPoints = new ArrayList<>();

        for (Piece p : ensemble.pieces) {
            Matrice m = s.transformes.get(p);
            double L = p.l();
            double W = p.w();
            Forme plan = new Forme("plan");
            plan.piece = p;
            plan.contour = contour(p, m);
            plan.centre = m.appliquer(L / 2, W / 2);
            tousPoints.addAll(plan.contour.points);
            dessin.formes.add(plan);

            int n = p.decoupes.size();
            for (int i = 0; i < n; i++) {
                double cx = L * (i + 1) / (n + 1);
                double largeur = Math.min(520, 0.8 * L / n);
                double hauteur = Math.min(0.45 * W, 350);
                Forme f = new Forme("decoupe");
                f.code = p.decoupes.get(i);
                f.points = polygone(m, new double[][] {
                    {cx - largeur / 2, W / 2 - hauteur / 2},
                    {cx + largeur / 2, W / 2 - hauteur / 2},
                    {cx + largeur / 2, W / 2 + hauteur / 2},
                    {cx - largeur / 2, W / 2 + hauteur / 2},
                });
                dessin.formes.add(f);
            }

            Place place = s.placement.get(p);
            double x = place.debutFond;
            for (Piece c : place.fond) {
                List<double[]> pts = polygone(m, new double[][] {
                    {x, -ecart - c.w()}, {x + c.l(), -ecart - c.w()}, {x + c.l(), -ecart}, {x, -ecart},
                });
                tousPoints.addAll(pts);
                Forme f = new Forme("credence");
                f.piece = c;
                f.points = pts;
                dessin.formes.add(f);
                x += c.l();
            }
            for (String cote : new String[] {"gauche", "droite"}) {
                Piece c = place.retour(cote);
                if (c == null) continue;
                double x0 = cote.equals("gauche") ? -ecart - c.w() : L + ecart;
                List<double[]> pts = polygone(m, new double[][] {
                    {x0, W - c.l()}, {x0 + c.w(), W - c.l()}, {x0 + c.w(), W}, {x0, W},
                });
                tousPoints.addAll(pts);
                Forme f = new Forme("credence");
                f.piece = c;
                f.points = pts;
                dessin.formes.add(f);
            }

            for (Code o : s.orphelinsDe(p)) {
                boolean droite = o.a.cote.equals("droite");
                double nn = o.n != 0 && !Double.isNaN(o.n) ? o.n : W * 0.3;
                double[][] segment;
                if (o.a.type.equals("frontal")) {
                    segment = droite ? new double[][] {{L - nn, W}, {L, W}} : new double[][] {{0, W}, {nn, W}};
                } else {
                    segment = droite ? new double[][] {{L, 0}, {L, W}} : new double[][] {{0, 0}, {0, W}};
                }
                Forme f = new Forme("orphelin");
                f.code = o.a.brut;
                f.points = polygone(m, segment);
                dessin.formes.add(f);
            }
        }

        for (Joint joint : ensemble.joints) {
            Piece P = joint.premier().piece;
            Matrice m = s.transformes.get(P);
            double[][] segment;
            if (joint.estAngle()) {
                double n = joint.l.piece.w();
                segment = joint.f.a.cote.equals("droite")
                        ? new double[][] {{P.l() - n, P.w()}, {P.l(), P.w()}}
                        : new double[][] {{0, P.w()}, {n, P.w()}};
            } else {
                segment = new double[][] {{P.l(), 0}, {P.l(), P.w()}};
            }
            Forme f = new Forme("joint");
            f.code = joint.codes();
            f.points = polygone(m, segment);
            dessin.formes.add(f);
        }

        double minX = Double.POSITIVE_INFINITY;
        double maxX = Double.NEGATIVE_INFINITY;
        double minY = Double.POSITIVE_INFINITY;
        double maxY = Double.NEGATIVE_INFINITY;
        for (double[] q : tousPoints) {
            minX = Math.min(minX, q[0]);
            maxX = Math.max(maxX, q[0]);
            minY = Math.min(minY, q[1]);
            maxY = Math.max(maxY, q[1]);
        }
        double largeurGeo = maxX - minX;
        if (largeurGeo == 0 || Double.isNaN(largeurGeo)) largeurGeo = 1;
        double hauteurGeo = maxY - minY;
        if (hauteurGeo == 0 || Double.isNaN(hauteurGeo)) hauteurGeo = 1;
        dessin.police = Math.max(largeurGeo, hauteurGeo * 0.9) / 18;
        double marge = 1.2 * dessin.police;
        dessin.minX = minX - marge;
        dessin.minY = minY - marge;
        dessin.largeur = largeurGeo + 2 * marge;
        dessin.hauteur = hauteurGeo + 2 * marge;
        dessin.pxParMm = 280 / dessin.largeur;
        return dessin;
    }

    /** Cadre du dessin, au format de l'attribut SVG viewBox. */
    public static String viewBox(Dessin d) {
        return f1(d.minX) + " " + f1(d.minY) + " " + f1(d.largeur) + " " + f1(d.hauteur);
    }

    private static ElementSvg texte(double x, double y, String contenu, String classe, double taille) {
        ElementSvg t = new ElementSvg("text", classe).nombre1("x", x).nombre1("y", y).nombre1("font-size", taille);
        t.texte = contenu;
        return t;
    }

    private static String surligne(Piece p, String cleSurlignee) {
        return p.cle != null && p.cle.equals(cleSurlignee) ? " surligne" : "";
    }

    /** Éléments du dessin d'un ensemble, dans l'ordre où ils se superposent. */
    public static List<ElementSvg> elements(Dessin d, String cleSurlignee) {
        List<ElementSvg> el = new ArrayList<>();
        for (Forme f : d.genre("credence")) {
            Piece c = f.piece;
            ElementSvg poly = new ElementSvg("polygon", "sc-credence" + surligne(c, cleSurlignee)).polygone(f.points);
            poly.titre = "Ligne " + c.ligneTexte() + " — crédence " + Js.dimension(c.L) + " × " + Js.dimension(c.W) + " mm";
            el.add(poly);
            double cx = 0;
            double cy = 0;
            for (double[] q : f.points) cx += q[0];
            for (double[] q : f.points) cy += q[1];
            el.add(texte(cx / 4, cy / 4, c.ligneTexte(), "sc-texte-credence", d.police * 0.85));
        }
        for (Forme f : d.genre("plan")) {
            Piece p = f.piece;
            ElementSvg chemin = new ElementSvg("path",
                    "sc-plan" + (p.type.equals("forme") ? " forme" : "") + surligne(p, cleSurlignee));
            chemin.contour = f.contour;
            chemin.attributs.put("d", f.contour.chemin);
            chemin.titre = "Ligne " + p.ligneTexte() + " — " + p.article + " " + Js.dimension(p.L) + " × " + Js.dimension(p.W) + " mm";
            el.add(chemin);
            for (Map.Entry<String, double[][]> bord : f.contour.bords.entrySet()) {
                if (!Boolean.TRUE.equals(p.chants.get(bord.getKey()))) continue;
                double[] a = bord.getValue()[0];
                double[] b = bord.getValue()[1];
                el.add(new ElementSvg("line", "sc-chant").nombre1("x1", a[0]).nombre1("y1", a[1]).nombre1("x2", b[0]).nombre1("y2", b[1]));
            }
        }
        for (Forme f : d.genre("decoupe")) {
            boolean predecoupe = f.code.equals("DVR1");
            ElementSvg poly = new ElementSvg("polygon", "sc-dvr" + (predecoupe ? " predecoupe" : "")).polygone(f.points);
            poly.titre = (predecoupe ? "Prédécoupe évier/cuisson non débouchante (DVR1)" : "Découpe évier/cuisson (DVR)")
                    + " — centrée par convention, position réelle non indiquée dans le fichier";
            el.add(poly);
        }
        for (Forme f : d.genre("joint")) {
            double x1 = f.points.get(0)[0];
            double y1 = f.points.get(0)[1];
            double x2 = f.points.get(1)[0];
            double y2 = f.points.get(1)[1];
            ElementSvg ligne = new ElementSvg("line", "sc-joint").nombre1("x1", x1).nombre1("y1", y1).nombre1("x2", x2).nombre1("y2", y2);
            ligne.titre = "Assemblage " + f.code;
            el.add(ligne);
            for (double t : new double[] {0.25, 0.5, 0.75}) {
                el.add(new ElementSvg("circle", "sc-chapelle").nombre1("cx", x1 + (x2 - x1) * t).nombre1("cy", y1 + (y2 - y1) * t)
                        .nombre1("r", 0.2 * d.police));
            }
        }
        for (Forme f : d.genre("orphelin")) {
            double x1 = f.points.get(0)[0];
            double y1 = f.points.get(0)[1];
            double x2 = f.points.get(1)[0];
            double y2 = f.points.get(1)[1];
            ElementSvg ligne = new ElementSvg("line", "sc-orphelin").nombre1("x1", x1).nombre1("y1", y1).nombre1("x2", x2).nombre1("y2", y2);
            ligne.titre = "Assemblage " + f.code + " : pièce associée introuvable dans les fichiers chargés";
            el.add(ligne);
            el.add(texte((x1 + x2) / 2, (y1 + y2) / 2 - d.police, f.code + " ?", "sc-texte-alerte", d.police * 0.85));
        }
        for (Forme f : d.genre("plan")) {
            Piece p = f.piece;
            double cx = f.centre[0];
            double cy = f.centre[1];
            boolean etroit = d.etroit(p);
            el.add(texte(cx, etroit ? cy : cy - d.police * 0.6, p.ligneTexte(), "sc-texte", d.police));
            if (!etroit) {
                el.add(texte(cx, cy + d.police * 0.7, Js.dimension(p.L) + " × " + Js.dimension(p.W), "sc-texte-cote", d.police * 0.85));
            }
        }
        return el;
    }

    // ---- textes (détail des pièces) ----

    public static String dims(Piece p) {
        return Js.dimension(p.L) + " × " + Js.dimension(p.W) + (p.E != null ? " × " + Js.dimension(p.E) : "") + " mm"
                + (p.qte > 1 ? " (×" + Js.nombre(p.qte) + ")" : "");
    }

    /** Une information sous une pièce ; {@code alerte} en rouge, {@code commentaire} en italique. */
    public static final class Info {
        public final String texte;
        public final boolean alerte;
        public final boolean commentaire;

        Info(String texte, boolean alerte, boolean commentaire) {
            this.texte = texte;
            this.alerte = alerte;
            this.commentaire = commentaire;
        }

        @Override
        public String toString() {
            return texte;
        }
    }

    public static final class LignePiece {
        public final Piece piece;
        public final List<Info> infos = new ArrayList<>();

        LignePiece(Piece piece) {
            this.piece = piece;
        }
    }

    public static final class Bloc {
        public String titre;
        public String note;
        public Ensemble ensemble;
        public boolean ouvert;
        public final List<LignePiece> lignes = new ArrayList<>();
    }

    private static LignePiece avecCommentaire(Piece p) {
        LignePiece l = new LignePiece(p);
        if (p.commentaire != null) l.infos.add(new Info(p.commentaire, false, true));
        return l;
    }

    /** Blocs affichés sous le schéma : un par ensemble, puis crédences non placées, puis autres pièces. */
    public static List<Bloc> blocs(Schema s, String cleSurlignee) {
        Map<Code, Double> partenaires = new IdentityHashMap<>();
        Map<Piece, List<Code>> codesParPiece = new IdentityHashMap<>();
        for (Joint j : s.joints) {
            partenaires.put(j.premier(), j.second().piece.ligne);
            partenaires.put(j.second(), j.premier().piece.ligne);
        }
        for (Joint j : s.joints) {
            for (Code c : new Code[] {j.premier(), j.second()}) {
                List<Code> l = codesParPiece.get(c.piece);
                if (l == null) {
                    l = new ArrayList<>();
                    codesParPiece.put(c.piece, l);
                }
                l.add(c);
            }
        }

        List<Bloc> blocs = new ArrayList<>();
        for (int i = 0; i < s.ensembles.size(); i++) {
            Ensemble ensemble = s.ensembles.get(i);
            Bloc bloc = new Bloc();
            bloc.ensemble = ensemble;
            boolean surligne = false;
            int nbCredences = 0;
            for (Piece p : ensemble.pieces) {
                LignePiece lp = new LignePiece(p);
                List<Code> codes = codesParPiece.get(p);
                if (codes != null) {
                    for (Code c : codes) {
                        lp.infos.add(new Info((c.a.type.equals("frontal") ? "Reçoit" : "S'assemble sur") + " la ligne "
                                + Js.nombre(partenaires.get(c)) + " (" + c.a.brut + ")", false, false));
                    }
                }
                for (Code o : s.orphelinsDe(p)) {
                    lp.infos.add(new Info(o.a.brut + " : pièce associée absente des fichiers chargés", true, false));
                }
                for (String coin : COINS) {
                    String code = p.angles.get(coin);
                    if (code == null) continue;
                    String libelle = libelleUsinageAngle(code);
                    lp.infos.add(new Info("Angle " + libelleCoin(coin) + " : " + code + (libelle != null ? " (" + libelle + ")" : ""),
                            false, false));
                }
                if (!p.decoupes.isEmpty()) {
                    lp.infos.add(new Info(String.join(" + ", p.decoupes)
                            + " : découpe évier/cuisson (centrée sur le dessin, position réelle non indiquée)", false, false));
                }
                if (p.type.equals("forme")) lp.infos.add(new Info("Forme spéciale : contour réel sur le plan client", false, false));
                if (p.commentaire != null) lp.infos.add(new Info(p.commentaire, false, true));
                bloc.lignes.add(lp);

                Place place = s.placement.get(p);
                double finFond = place.debutFond;
                for (Piece c : place.fond) finFond += c.l();
                Piece derriere = s.murs.get(p).derriere;
                boolean continueDerriere = derriere != null
                        && (place.debutFond < -TOLERANCE_CREDENCE_MM || finFond > p.l() + TOLERANCE_CREDENCE_MM);
                for (int k = 0; k < place.fond.size(); k++) {
                    LignePiece lc = new LignePiece(place.fond.get(k));
                    lc.infos.add(new Info("Fond du plan ligne " + p.ligneTexte() + ", " + (k + 1) + (k == 0 ? "re" : "e")
                            + " en partant de la gauche"
                            + (continueDerriere ? " (le mur continue derrière le plan ligne " + derriere.ligneTexte() + ")" : ""),
                            false, false));
                    bloc.lignes.add(lc);
                }
                for (String cote : new String[] {"gauche", "droite"}) {
                    Piece c = place.retour(cote);
                    if (c == null) continue;
                    LignePiece lc = new LignePiece(c);
                    lc.infos.add(new Info("Retour " + cote + " du plan ligne " + p.ligneTexte(), false, false));
                    bloc.lignes.add(lc);
                }
                nbCredences += place.nbCredences();
            }
            for (LignePiece lp : bloc.lignes) if (lp.piece.cle != null && lp.piece.cle.equals(cleSurlignee)) surligne = true;
            StringBuilder lignes = new StringBuilder();
            for (Piece p : ensemble.pieces) {
                if (lignes.length() > 0) lignes.append(", ");
                lignes.append(p.ligneTexte());
            }
            bloc.titre = "Ensemble " + (i + 1) + " · "
                    + (ensemble.pieces.size() > 1 ? "lignes " + lignes : "ligne " + ensemble.pieces.get(0).ligneTexte())
                    + description(ensemble, s.transformes)
                    + (nbCredences > 0 ? " · " + nbCredences + " crédence(s)" : "");
            bloc.ouvert = s.ensembles.size() <= 3 || surligne;
            blocs.add(bloc);
        }

        if (!s.nonPlacees.isEmpty()) {
            Bloc bloc = new Bloc();
            bloc.titre = "Crédences sans position déductible (" + s.nonPlacees.size() + ")";
            bloc.note = "Leurs longueurs ne correspondent à aucun plan de la commande : position à lire sur le plan client.";
            bloc.ouvert = true;
            for (Piece c : s.nonPlacees) bloc.lignes.add(avecCommentaire(c));
            blocs.add(bloc);
        }
        if (!s.autres.isEmpty()) {
            Bloc bloc = new Bloc();
            bloc.titre = "Autres pièces (" + s.autres.size() + ")";
            bloc.ouvert = true;
            for (Piece p : s.autres) bloc.lignes.add(avecCommentaire(p));
            blocs.add(bloc);
        }
        return blocs;
    }

    public static String titre(Schema s) {
        return "Schéma de la commande " + s.commande + " — " + s.pieces.size() + " pièce(s)";
    }

    public static final String NOTE =
            "Vue de dessus, plans à l'échelle, crédences rabattues derrière leur plan. Disposition déduite des codes "
                    + "d'assemblage et de l'ordre des lignes du fichier de lancement.";
}
