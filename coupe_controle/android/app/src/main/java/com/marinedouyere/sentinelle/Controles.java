package com.marinedouyere.sentinelle;

import android.content.Context;

import com.marinedouyere.sentinelle.moteur.Classeur;
import com.marinedouyere.sentinelle.moteur.Comparateur;
import com.marinedouyere.sentinelle.moteur.ControleCouleurs;
import com.marinedouyere.sentinelle.moteur.ErreurLecture;
import com.marinedouyere.sentinelle.moteur.LecteurBkp;
import com.marinedouyere.sentinelle.moteur.LecteurCoupe;
import com.marinedouyere.sentinelle.moteur.LecteurCoupePdf;
import com.marinedouyere.sentinelle.moteur.LecteurDiakonos;
import com.marinedouyere.sentinelle.moteur.LecteurStrat;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Exécution des contrôles sur les fichiers d'une case (toujours hors du fil d'affichage). */
final class Controles {

    private final Context context;
    private ExtracteurPdfAndroid extracteurPdf;

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
                if (l.lancement == null || l.lancement.isEmpty()) continue;
                String semaine = LecteurStrat.extraireSemaine(l.lancement);
                // La casse a toujours une semaine de décalage : la casse 43 se fabrique en semaine 44.
                if (semaine != null && "Casse".equals(p.poste)) {
                    int n = Integer.parseInt(semaine);
                    semaine = String.format(java.util.Locale.ROOT, "%02d", n >= 52 ? 1 : n + 1);
                }
                return semaine;
            }
        } catch (Exception ignoree) {
            // fichier pas (encore) exploitable : l'erreur apparaîtra au contrôle
        }
        return null;
    }

    /** Texte d'un PDF, ligne par ligne (sommaire Cut Rite…). */
    List<String> lignesPdf(byte[] pdf) throws Exception {
        return LecteurCoupePdf.lignesTexte(extracteurPdf().elementsParPage(pdf));
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
        p.semainesLivraison = strat.semaines;
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
            // Les panneaux de protection du .bkp ne sont pas des pièces (le lancement ne les compte pas).
            trouve = LecteurBkp.lireSansProtections(lireOctets(p.bkp.fichier()), p.bkp.nom);
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
        Classeur strat = classeur(p.strat);
        Map<String, Double> attendues = LecteurStrat.quantitesAttenduesScies(strat);
        etape.nom = "lecture du fichier .bkp";
        byte[] octetsBkp = lireOctets(p.bkp.fichier());
        Map<String, Double> bkp = LecteurBkp.lire(octetsBkp, p.bkp.nom);
        etape.nom = "comparaison";
        p.ecartsScies = LecteurBkp.comparerScies(attendues, bkp);
        p.totalScies = LecteurBkp.somme(attendues);
        etape.nom = "contrôle des couleurs";
        p.couleurs = ControleCouleurs.controler(LecteurStrat.lire(strat).lignes, LecteurBkp.couleurs(octetsBkp, p.bkp.nom));
        p.erreurScies = null;
    }

    private static String cleCache(Paire.Fichier f) {
        return f == null ? "-" : f.chemin + "|" + f.fichier().lastModified() + "|" + f.fichier().length();
    }

    /** Ce que le tableau des lancements et le compteur savent d'une case. */
    static final class Resume {
        /** Pièces prévues par le lancement (une pièce assemblée compte une fois) ; NaN si illisible. */
        double prevues = Double.NaN;
        /** Pièces complètes dans le .bkp (null : pas de .bkp ; NaN : illisible). */
        Double bkp;
        /** Clés des pièces du lancement. */
        final Set<String> cles = new HashSet<>();
        /** Codes de lancement écrits dans le fichier (« LAN264601 »). */
        final Set<String> lancements = new HashSet<>();
    }

    private final Map<String, Resume> resumes = new HashMap<>();

    /** Résumé déjà calculé (null s'il reste à lire les fichiers). */
    Resume resumeEnCache(Paire.Fichier strat, Paire.Fichier bkp) {
        synchronized (resumes) {
            return resumes.get(cleCache(strat) + "#" + cleCache(bkp));
        }
    }

    /** Résumé d'une case (mis en cache : les fichiers copiés ne changent pas). */
    Resume resume(Paire.Fichier strat, Paire.Fichier bkp) {
        Resume r = resumeEnCache(strat, bkp);
        if (r != null) return r;
        r = new Resume();
        List<LecteurStrat.LigneStrat> lignes = null;
        if (strat != null) {
            try {
                lignes = LecteurStrat.lire(classeur(strat)).lignes;
                r.prevues = 0;
                for (LecteurStrat.LigneStrat l : lignes) {
                    r.prevues += l.pieces;
                    r.cles.add(l.cle);
                    if (l.lancement != null && !l.lancement.trim().isEmpty()) r.lancements.add(l.lancement.trim());
                }
            } catch (Exception e) {
                lignes = null; // lancement illisible : l'erreur apparaîtra au contrôle
            }
        }
        if (bkp != null) {
            try {
                Map<String, Double> trouve = LecteurBkp.lireSansProtections(lireOctets(bkp.fichier()), bkp.nom);
                r.bkp = lignes != null ? Comparateur.pieces(lignes, trouve) : LecteurBkp.somme(trouve);
            } catch (Exception e) {
                r.bkp = Double.NaN; // .bkp illisible : l'erreur sera visible via « Vérifier Scies »
            }
        }
        synchronized (resumes) {
            resumes.put(cleCache(strat) + "#" + cleCache(bkp), r);
        }
        return r;
    }

    private final Map<String, List<LecteurDiakonos.Piece>> piecesDiakonos = new HashMap<>();

    /** Pièces d'un fichier Diakonos (mises en cache). */
    List<LecteurDiakonos.Piece> diakonos(Paire.Fichier f) throws IOException, ErreurLecture {
        String cle = cleCache(f);
        synchronized (piecesDiakonos) {
            List<LecteurDiakonos.Piece> pieces = piecesDiakonos.get(cle);
            if (pieces != null) return pieces;
        }
        List<LecteurDiakonos.Piece> pieces = LecteurDiakonos.lire(classeur(f));
        synchronized (piecesDiakonos) {
            piecesDiakonos.put(cle, pieces);
        }
        return pieces;
    }

    /** Étape en cours, pour le message d'erreur ("échec à l'étape « ... »"). */
    static final class Etape {
        String nom = "lecture du fichier de lancement";
    }
}
