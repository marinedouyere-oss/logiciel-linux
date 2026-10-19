package com.marinedouyere.sentinelle;

import android.content.Context;

import com.marinedouyere.sentinelle.moteur.Classeur;
import com.marinedouyere.sentinelle.moteur.Comparateur;
import com.marinedouyere.sentinelle.moteur.ErreurLecture;
import com.marinedouyere.sentinelle.moteur.LecteurBkp;
import com.marinedouyere.sentinelle.moteur.LecteurCoupe;
import com.marinedouyere.sentinelle.moteur.LecteurCoupePdf;
import com.marinedouyere.sentinelle.moteur.LecteurStrat;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Exécution des contrôles sur les fichiers d'une case (toujours hors du fil d'affichage). */
final class Controles {

    private final Context context;
    private ExtracteurPdfAndroid extracteurPdf;
    private final Map<String, Double> totauxBkp = new HashMap<>();

    Controles(Context context) {
        this.context = context.getApplicationContext();
    }

    static byte[] lireOctets(File f) throws IOException {
        try (InputStream entree = new FileInputStream(f)) {
            ByteArrayOutputStream tampon = new ByteArrayOutputStream((int) Math.max(32, f.length()));
            byte[] bloc = new byte[64 * 1024];
            int lu;
            while ((lu = entree.read(bloc)) != -1) tampon.write(bloc, 0, lu);
            return tampon.toByteArray();
        }
    }

    static boolean estPdf(Paire.Fichier f) {
        return f.nom.toLowerCase(Locale.ROOT).endsWith(".pdf");
    }

    Classeur classeur(Paire.Fichier f) throws IOException {
        return Classeur.lire(lireOctets(f.fichier()));
    }

    LecteurStrat.Resultat lireStrat(Paire p) throws IOException, ErreurLecture {
        return LecteurStrat.lire(classeur(p.strat));
    }

    /** Semaine de livraison encodée dans le code de lancement du fichier STRAT (ex. "40"). */
    String detecterSemaine(Paire p) {
        if (p.strat == null) return null;
        try {
            for (LecteurStrat.LigneStrat l : lireStrat(p).lignes) {
                if (l.lancement != null && !l.lancement.isEmpty()) return LecteurStrat.extraireSemaine(l.lancement);
            }
        } catch (Exception ignoree) {
            // fichier pas (encore) exploitable : l'erreur apparaîtra au contrôle
        }
        return null;
    }

    private synchronized LecteurCoupePdf.ExtracteurTexte extracteurPdf() {
        if (extracteurPdf == null) extracteurPdf = new ExtracteurPdfAndroid(context);
        return extracteurPdf;
    }

    List<LecteurCoupePdf.Enregistrement> enregistrementsPdf(Paire.Fichier f) throws IOException, ErreurLecture {
        return LecteurCoupePdf.lire(lireOctets(f.fichier()), extracteurPdf());
    }

    Map<String, Double> lireBkp(Paire.Fichier f) throws IOException, ErreurLecture {
        return LecteurBkp.lire(lireOctets(f.fichier()), f.nom);
    }

    /**
     * Contrôle principal, une fois le fichier de lancement lu (et une
     * éventuelle confirmation des semaines de livraison obtenue) : compare
     * avec la liste de coupe, ou à défaut avec le .bkp.
     */
    void comparer(Paire p, LecteurStrat.Resultat strat, Etape etape) throws IOException, ErreurLecture {
        p.doublons = strat.doublons;
        Map<String, Double> trouve;
        if (p.coupe != null) {
            etape.nom = "lecture de la liste de coupe (Cutrite)";
            LecteurCoupe.Resultat r;
            if (estPdf(p.coupe)) {
                r = LecteurCoupePdf.compter(enregistrementsPdf(p.coupe));
            } else {
                r = LecteurCoupe.lire(classeur(p.coupe), strat.cles(), strat.qteParCle());
            }
            trouve = r.compteur;
            p.nbUnitaires = r.nbUnitaires;
            p.nbPiecesTrouvees = r.nbPiecesTrouvees;
            p.source = "coupe";
        } else {
            etape.nom = "lecture du fichier .bkp";
            trouve = lireBkp(p.bkp);
            p.nbUnitaires = null;
            p.nbPiecesTrouvees = null;
            p.source = "bkp";
        }
        etape.nom = "comparaison";
        p.rapport = Comparateur.comparer(strat.lignes, trouve);
    }

    /** Contrôle Scies : lancement (protections comprises) contre ce qui a été réellement optimisé. */
    void controleScies(Paire p, Etape etape) throws IOException, ErreurLecture {
        etape.nom = "lecture du fichier de lancement";
        Map<String, Double> attendues = LecteurStrat.quantitesAttenduesScies(classeur(p.strat));
        etape.nom = "lecture du fichier .bkp";
        Map<String, Double> bkp = lireBkp(p.bkp);
        etape.nom = "comparaison";
        p.ecartsScies = LecteurBkp.comparerScies(attendues, bkp);
        p.totalScies = LecteurBkp.somme(attendues);
        p.erreurScies = null;
    }

    private static String cleCache(String quoi, Paire.Fichier f) {
        return quoi + "|" + f.chemin + "|" + f.fichier().lastModified() + "|" + f.fichier().length();
    }

    /** Total déjà calculé (null s'il reste à calculer). */
    Double totalEnCache(String quoi, Paire.Fichier f) {
        synchronized (totauxBkp) {
            return totauxBkp.get(cleCache(quoi, f));
        }
    }

    /** Nombre de pièces réellement optimisées dans un .bkp (mis en cache : le fichier ne change pas). */
    double totalBkp(Paire.Fichier f) {
        Double t = totalEnCache("bkp", f);
        if (t != null) return t;
        double total;
        try {
            total = LecteurBkp.somme(lireBkp(f));
        } catch (Exception e) {
            total = 0; // .bkp illisible : l'erreur sera visible via "Vérifier Scies"
        }
        synchronized (totauxBkp) {
            totauxBkp.put(cleCache("bkp", f), total);
        }
        return total;
    }

    /** Nombre de pièces prévues par un fichier de lancement (hors protections), NaN s'il est illisible. */
    double totalStrat(Paire.Fichier f) {
        Double t = totalEnCache("strat", f);
        if (t != null) return t;
        double total = 0;
        try {
            for (LecteurStrat.LigneStrat l : LecteurStrat.lire(classeur(f)).lignes) total += l.qteAttendue;
        } catch (Exception e) {
            total = Double.NaN;
        }
        synchronized (totauxBkp) {
            totauxBkp.put(cleCache("strat", f), total);
        }
        return total;
    }

    /** Étape en cours, pour le message d'erreur ("échec à l'étape « ... »"). */
    static final class Etape {
        String nom = "lecture du fichier de lancement";
    }
}
