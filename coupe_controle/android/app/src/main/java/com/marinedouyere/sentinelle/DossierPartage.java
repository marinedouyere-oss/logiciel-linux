package com.marinedouyere.sentinelle;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import com.marinedouyere.sentinelle.moteur.ScanDossier;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Dossier partagé choisi pour un onglet semaine (un par semaine, jamais
 * partagé entre les deux) : n'importe quel dossier proposé par le
 * sélecteur Android — téléphone, carte SD, Google Drive... L'autorisation
 * de lecture est conservée, il n'y a pas à le rechoisir à chaque ouverture.
 */
final class DossierPartage {

    private static final String PREFERENCES = "dossier-partage";

    final Uri uri;
    final String nom;

    private DossierPartage(Uri uri, String nom) {
        this.uri = uri;
        this.nom = nom;
    }

    private static SharedPreferences preferences(Context c) {
        return c.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    static DossierPartage memorise(Context c, String parite) {
        String brut = preferences(c).getString("uri-" + parite, null);
        if (brut == null) return null;
        return new DossierPartage(Uri.parse(brut), preferences(c).getString("nom-" + parite, "dossier"));
    }

    /** Mémorise le dossier choisi pour cette semaine, en gardant l'autorisation de lecture. */
    static DossierPartage memoriser(Context c, String parite, Uri uri) {
        if (ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            try {
                c.getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException ignoree) {
                // fournisseur sans autorisation durable : valable pour cette session
            }
        }
        String nom = nomDuDossier(c, uri);
        preferences(c).edit().putString("uri-" + parite, uri.toString()).putString("nom-" + parite, nom).apply();
        return new DossierPartage(uri, nom);
    }

    private static String nomDuDossier(Context c, Uri uri) {
        if (ContentResolver.SCHEME_FILE.equals(uri.getScheme())) return new File(uri.getPath()).getName();
        try {
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri));
            try (Cursor curseur = c.getContentResolver().query(doc,
                    new String[] {DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                if (curseur != null && curseur.moveToFirst() && curseur.getString(0) != null) return curseur.getString(0);
            }
        } catch (Exception ignoree) {
            // nom indisponible : on affiche la fin de l'adresse
        }
        String dernier = uri.getLastPathSegment();
        if (dernier == null) return "dossier";
        return dernier.substring(dernier.lastIndexOf(dernier.contains("/") ? '/' : ':') + 1);
    }

    /** Fichiers directement dans le dossier (pas les sous-dossiers), avec leur date de modification. */
    List<ScanDossier.Fichier> lister(Context c) throws IOException {
        List<ScanDossier.Fichier> fichiers = new ArrayList<>();
        if (ContentResolver.SCHEME_FILE.equals(uri.getScheme())) {
            File[] contenu = new File(uri.getPath()).listFiles();
            if (contenu == null) throw new IOException("dossier introuvable ou illisible");
            for (File f : contenu) {
                if (f.isFile()) fichiers.add(new ScanDossier.Fichier(f.getName(), f.lastModified(), Uri.fromFile(f)));
            }
            return fichiers;
        }
        Uri enfants;
        try {
            enfants = DocumentsContract.buildChildDocumentsUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri));
        } catch (IllegalArgumentException e) {
            throw new IOException("adresse de dossier invalide");
        }
        String[] colonnes = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
        };
        try (Cursor curseur = c.getContentResolver().query(enfants, colonnes, null, null, null)) {
            if (curseur == null) throw new IOException("dossier inaccessible");
            while (curseur.moveToNext()) {
                String type = curseur.getString(2);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(type)) continue;
                String nom = curseur.getString(1);
                if (nom == null) continue;
                long date = curseur.isNull(3) ? 0 : curseur.getLong(3);
                Uri doc = DocumentsContract.buildDocumentUriUsingTree(uri, curseur.getString(0));
                fichiers.add(new ScanDossier.Fichier(nom, date, doc));
            }
        } catch (SecurityException e) {
            throw new IOException("autorisation de lecture perdue, rechoisissez le dossier");
        }
        return fichiers;
    }

    static InputStream ouvrir(Context c, ScanDossier.Fichier f) throws IOException {
        Uri u = (Uri) f.reference;
        if (ContentResolver.SCHEME_FILE.equals(u.getScheme())) return new FileInputStream(u.getPath());
        InputStream entree = c.getContentResolver().openInputStream(u);
        if (entree == null) throw new IOException("fichier inaccessible : " + f.nom);
        return entree;
    }
}
