package com.marinedouyere.sentinelle;

import android.content.Context;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Toutes les cases de l'appli et leur mémorisation : chaque case est
 * enregistrée dans un fichier JSON, ses fichiers sont copiés à côté.
 * Rien ne dépend du fichier d'origine, qui peut être déplacé ou supprimé.
 */
public final class Depot {

    public static final List<String> POSTES_SEMAINE = Arrays.asList("Agglo 1er tour", "Feno", "Casse", "Agglo 2ème tour");
    public static final String POSTE_CHANTIERS = "Chantiers";
    public static final String PAIRE = "paire";
    public static final String IMPAIRE = "impaire";

    private final File dossier;
    public final List<Paire> paires = new ArrayList<>();
    private int prochainNumeroChantier = 1;

    public Depot(Context context) {
        dossier = new File(context.getFilesDir(), "paires");
        //noinspection ResultOfMethodCallIgnored
        dossier.mkdirs();
        charger();
    }

    /** Parité d'un numéro de semaine (« 45 » → impaire), null s'il n'y en a pas. */
    public static String pariteDuNumero(String semaine) {
        if (semaine == null) return null;
        try {
            return Integer.parseInt(semaine.trim()) % 2 == 0 ? PAIRE : IMPAIRE;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public static String libelleSemaine(String parite) {
        return PAIRE.equals(parite) ? "Semaine paire" : "Semaine impaire";
    }

    private void charger() {
        List<Paire> lues = new ArrayList<>();
        File[] fichiers = dossier.listFiles((d, nom) -> nom.endsWith(".json"));
        if (fichiers != null) {
            for (File f : fichiers) {
                try {
                    lues.add(Paire.depuisJson(new JSONObject(lireTexte(f))));
                } catch (Exception ignoree) {
                    // Fichier de mémoire abîmé : la case repartira vide.
                }
            }
        }
        for (String poste : POSTES_SEMAINE) {
            for (String parite : new String[] {PAIRE, IMPAIRE}) {
                Paire p = trouver(lues, poste, libelleSemaine(parite));
                if (p == null) p = new Paire(poste, libelleSemaine(parite), parite);
                p.parite = parite;
                paires.add(p);
            }
        }
        List<Paire> chantiers = new ArrayList<>();
        for (Paire p : lues) {
            if (!p.estChantier()) continue;
            // Étanchéité stricte entre les deux semaines, chantiers compris.
            if (p.parite == null) {
                p.parite = PAIRE;
                enregistrer(p);
            }
            // Un chantier est dans l'onglet de la semaine de son lancement.
            String vraie = pariteDuNumero(p.semaine);
            if (vraie != null && !vraie.equals(p.parite)) {
                p.parite = vraie;
                enregistrer(p);
            }
            chantiers.add(p);
        }
        Collections.sort(chantiers, (a, b) -> numero(a.label) - numero(b.label));
        for (Paire c : chantiers) prochainNumeroChantier = Math.max(prochainNumeroChantier, numero(c.label) + 1);
        paires.addAll(chantiers);
        if (chantiers.isEmpty()) ajouterChantier(PAIRE);
    }

    private static Paire trouver(List<Paire> liste, String poste, String label) {
        for (Paire p : liste) if (p.poste.equals(poste) && p.label.equals(label)) return p;
        return null;
    }

    private static int numero(String label) {
        String chiffres = label.replaceAll("\\D", "");
        try {
            return chiffres.isEmpty() ? 0 : Integer.parseInt(chiffres);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    public Paire paireFixe(String poste, String parite) {
        for (Paire p : paires) if (p.poste.equals(poste) && parite.equals(p.parite) && !p.estChantier()) return p;
        return null;
    }

    public List<Paire> chantiers(String parite) {
        List<Paire> liste = new ArrayList<>();
        for (Paire p : paires) if (p.estChantier() && parite.equals(p.parite)) liste.add(p);
        Collections.sort(liste, (a, b) -> {
            int sa = semaineDeChantier(a);
            int sb = semaineDeChantier(b);
            return sa != sb ? Integer.compare(sa, sb) : Integer.compare(numero(a.label), numero(b.label));
        });
        return liste;
    }

    /** Semaine d'un chantier pour le tri (inconnue = en fin de liste). */
    static int semaineDeChantier(Paire p) {
        if (p.codeLancement != null) {
            String code = p.codeLancement.split("\\|")[0];
            if (code.length() >= 4) {
                try {
                    return Integer.parseInt(code.substring(2, 4));
                } catch (NumberFormatException ignoree) {
                    // code non numérique : on retombe sur la semaine détectée
                }
            }
        }
        if (p.semaine != null) {
            try {
                return Integer.parseInt(p.semaine);
            } catch (NumberFormatException ignoree) {
                // semaine illisible : en fin de liste
            }
        }
        return Integer.MAX_VALUE;
    }

    /** Toutes les cases de l'onglet semaine (postes fixes de cette semaine + ses chantiers). */
    public List<Paire> pairesDeLaSemaine(String parite) {
        List<Paire> liste = new ArrayList<>();
        for (String poste : POSTES_SEMAINE) liste.add(paireFixe(poste, parite));
        liste.addAll(chantiers(parite));
        return liste;
    }

    public Paire ajouterChantier(String parite) {
        Paire p = new Paire(POSTE_CHANTIERS, "Chantier " + prochainNumeroChantier++, parite);
        paires.add(p);
        enregistrer(p);
        return p;
    }

    public void retirerChantier(Paire p) {
        paires.remove(p);
        effacerFichiers(p);
        //noinspection ResultOfMethodCallIgnored
        fichierJson(p).delete();
    }

    public void reinitialiser(Paire p) {
        effacerFichiers(p);
        p.reinitialiser();
        enregistrer(p);
    }

    // ---- stockage ----

    private String identifiant(Paire p) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] h = md.digest(p.cle().getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 10; i++) sb.append(String.format("%02x", h[i]));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(p.cle().hashCode());
        }
    }

    private File fichierJson(Paire p) {
        return new File(dossier, identifiant(p) + ".json");
    }

    private File dossierFichiers(Paire p) {
        return new File(dossier, identifiant(p));
    }

    public synchronized void enregistrer(Paire p) {
        try {
            File cible = fichierJson(p);
            File temporaire = new File(dossier, identifiant(p) + ".tmp");
            try (OutputStream sortie = new FileOutputStream(temporaire)) {
                sortie.write(p.enJson().toString().getBytes(StandardCharsets.UTF_8));
            }
            //noinspection ResultOfMethodCallIgnored
            temporaire.renameTo(cible);
        } catch (Exception ignoree) {
            // Mémorisation impossible (stockage plein...) : l'appli continue sans.
        }
    }

    /** Copie le contenu d'un fichier choisi dans le dossier de la case et le rattache. */
    public Paire.Fichier copierFichier(Paire p, String role, String nom, InputStream source) throws IOException {
        File d = dossierFichiers(p);
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        String extension = nom.contains(".") ? nom.substring(nom.lastIndexOf('.')) : "";
        File cible = new File(d, role + extension);
        File ancien = p.fichier(role) != null ? p.fichier(role).fichier() : null;
        File temporaire = new File(d, role + ".tmp");
        try (OutputStream sortie = new FileOutputStream(temporaire)) {
            byte[] bloc = new byte[64 * 1024];
            int lu;
            while ((lu = source.read(bloc)) != -1) sortie.write(bloc, 0, lu);
        }
        if (ancien != null && !ancien.equals(cible)) {
            //noinspection ResultOfMethodCallIgnored
            ancien.delete();
        }
        if (!temporaire.renameTo(cible)) throw new IOException("Impossible d'enregistrer le fichier dans l'appli.");
        Paire.Fichier f = new Paire.Fichier(nom, cible.getAbsolutePath());
        p.poserFichier(role, f);
        return f;
    }

    private void effacerFichiers(Paire p) {
        File d = dossierFichiers(p);
        File[] contenu = d.listFiles();
        if (contenu != null) {
            for (File f : contenu) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
        //noinspection ResultOfMethodCallIgnored
        d.delete();
    }

    private static String lireTexte(File f) throws IOException {
        return new String(Controles.lireOctets(f), StandardCharsets.UTF_8);
    }
}
