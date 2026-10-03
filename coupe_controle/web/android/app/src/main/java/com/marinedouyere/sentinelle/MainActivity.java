package com.marinedouyere.sentinelle;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.documentfile.provider.DocumentFile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

public class MainActivity extends Activity {

    private static final int FILE_CHOOSER_REQUEST = 1;
    private static final int OPEN_TREE_REQUEST = 2;
    private static final String PREFS = "sentinelle_dossier_partage";
    private static final String PREF_TREE_URI = "treeUri";
    private static final String PREF_NOM = "nom";

    private ValueCallback<Uri[]> filePathCallback;
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        // Sans ces deux réglages, la WebView ignore la balise <meta
        // name="viewport"> de la page et l'affiche comme une page "bureau"
        // large (~980px) réduite pour tenir à l'écran — d'où un rendu tassé
        // à gauche avec une bande vide à droite et un défilement horizontal,
        // au lieu du rendu responsive mobile normal.
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        webView.addJavascriptInterface(new DossierPartageBridge(), "AndroidDossierPartage");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                filePathCallback = callback;
                Intent intent = params.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback != null) {
                Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }
        if (requestCode == OPEN_TREE_REQUEST) {
            if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null) {
                Uri treeUri = data.getData();
                getContentResolver().takePersistableUriPermission(treeUri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION);
                String nom = nomDossier(treeUri);
                getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                        .putString(PREF_TREE_URI, treeUri.toString())
                        .putString(PREF_NOM, nom)
                        .apply();
                notifierDossierChoisi(treeUri.toString(), nom);
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private String nomDossier(Uri treeUri) {
        DocumentFile dossier = DocumentFile.fromTreeUri(this, treeUri);
        String nom = dossier != null ? dossier.getName() : null;
        return nom != null ? nom : "Dossier";
    }

    // Appelle window.__androidDossierChoisi(treeUri, nom) côté JS une fois
    // le dossier sélectionné — l'activité ne peut pas renvoyer sa réponse
    // de façon synchrone (onActivityResult arrive après le retour de
    // choisirDossier()), d'où ce rappel asynchrone plutôt qu'une valeur de
    // retour directe.
    private void notifierDossierChoisi(String treeUri, String nom) {
        String js = "window.__androidDossierChoisi && window.__androidDossierChoisi("
                + JSONObject.quote(treeUri) + "," + JSONObject.quote(nom) + ")";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    // Pont JS <-> natif pour le "Scan du dossier partagé" : le sélecteur de
    // dossier du navigateur (showDirectoryPicker) n'existe pas dans la
    // WebView Android, donc on passe par le sélecteur système d'Android
    // (Storage Access Framework) à la place — qui propose "Google Drive"
    // comme source si l'appli Drive est installée et connectée sur
    // l'appareil, exactement comme pour un dossier local.
    private class DossierPartageBridge {

        @JavascriptInterface
        public void choisirDossier() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                try {
                    startActivityForResult(intent, OPEN_TREE_REQUEST);
                } catch (Exception e) {
                    // Aucun sélecteur disponible : rien à faire, le JS reste
                    // sans réponse et l'utilisateur peut réessayer.
                }
            });
        }

        // Dossier déjà choisi lors d'une session précédente, si la
        // permission tenue par Android est toujours valable — évite de
        // redemander le sélecteur à chaque ouverture de l'appli.
        @JavascriptInterface
        public String dossierMemorise() {
            SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String treeUriString = prefs.getString(PREF_TREE_URI, null);
            String nom = prefs.getString(PREF_NOM, null);
            if (treeUriString == null) return "null";

            boolean permissionValide = false;
            for (android.content.UriPermission p : getContentResolver().getPersistedUriPermissions()) {
                if (p.getUri().toString().equals(treeUriString) && p.isReadPermission()) {
                    permissionValide = true;
                    break;
                }
            }
            if (!permissionValide) return "null";

            JSONObject resultat = new JSONObject();
            try {
                resultat.put("treeUri", treeUriString);
                resultat.put("nom", nom != null ? nom : "Dossier");
            } catch (Exception e) {
                return "null";
            }
            return resultat.toString();
        }

        // Liste les fichiers (pas les sous-dossiers) directement sous le
        // dossier choisi — même profondeur que le scan sur PC.
        @JavascriptInterface
        public String listerFichiers(String treeUriString) {
            JSONArray resultat = new JSONArray();
            try {
                DocumentFile dossier = DocumentFile.fromTreeUri(MainActivity.this, Uri.parse(treeUriString));
                if (dossier == null || !dossier.isDirectory()) return resultat.toString();
                for (DocumentFile fichier : dossier.listFiles()) {
                    if (!fichier.isFile()) continue;
                    JSONObject entree = new JSONObject();
                    entree.put("nom", fichier.getName());
                    entree.put("uri", fichier.getUri().toString());
                    entree.put("lastModified", fichier.lastModified());
                    resultat.put(entree);
                }
            } catch (Exception e) {
                // Dossier inaccessible (déplacé, permission révoquée...) :
                // la liste reste vide, signalée côté JS comme un dossier
                // sans fichier reconnu plutôt qu'une erreur bloquante.
            }
            return resultat.toString();
        }

        // Lit le contenu d'un fichier (désigné par son URI de contenu
        // Android, pas un chemin) et le renvoie en base64 pour que le JS
        // puisse en refaire un objet File/Blob exploitable par le moteur
        // de lecture Excel/.bkp existant, inchangé.
        @JavascriptInterface
        public String lireFichierBase64(String fileUriString) {
            ContentResolver resolver = getContentResolver();
            try (InputStream flux = resolver.openInputStream(Uri.parse(fileUriString))) {
                if (flux == null) return "";
                ByteArrayOutputStream tampon = new ByteArrayOutputStream();
                byte[] bloc = new byte[64 * 1024];
                int lu;
                while ((lu = flux.read(bloc)) != -1) {
                    tampon.write(bloc, 0, lu);
                }
                return Base64.encodeToString(tampon.toByteArray(), Base64.NO_WRAP);
            } catch (IOException e) {
                return "";
            }
        }
    }
}
