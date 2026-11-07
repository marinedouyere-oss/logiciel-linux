package com.marinedouyere.sentinelle;

import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.snackbar.Snackbar;
import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;
import com.google.android.material.tabs.TabLayout;

import java.io.OutputStream;

/**
 * Sentinelle sur le téléphone : les mêmes écrans que Sentinelle sur le PC (La semaine, Contrôler la coupe,
 * Rechercher une pièce, Bibliothèque des semaines), lus dans le fichier partagé que le PC écrit sur le Drive.
 * L'appli ne fait que lire : les lancements se préparent et se contrôlent sur le PC.
 */
public class MainActivity extends AppCompatActivity {

    static final String ONGLET_SEMAINE = "semaine";
    static final String ONGLET_CONTROLE = "controle";
    static final String ONGLET_RECHERCHE = "recherche";
    static final String ONGLET_BIBLIOTHEQUE = "bibliotheque";

    private SentinelleApp app;
    private Ui ui;
    private String onglet = ONGLET_SEMAINE;
    private LinearLayout contenu;
    private ScrollView defilement;
    private TabLayout onglets;
    private PartageVue partage;
    private ActivityResultLauncher<String[]> choixPartage;
    private ActivityResultLauncher<String> creationPdf;
    private ActivityResultLauncher<ScanOptions> lecteurQr;

    @Override
    protected void onCreate(Bundle etat) {
        super.onCreate(etat);
        app = (SentinelleApp) getApplication();
        ui = new Ui(this);
        if (etat != null) onglet = etat.getString("onglet", ONGLET_SEMAINE);
        choixPartage = registerForActivityResult(new ActivityResultContracts.OpenDocument(), uri -> partage().fichierChoisi(uri));
        creationPdf = registerForActivityResult(new ActivityResultContracts.CreateDocument("application/pdf"), this::emplacementPdfChoisi);
        lecteurQr = registerForActivityResult(new ScanContract(), r -> {
            if (r != null && r.getContents() != null) partage().qrScanne(r.getContents());
        });

        LinearLayout racine = ui.colonne();
        racine.setBackgroundColor(ui.couleur(R.color.fond));
        racine.addView(barreLaisne(), ui.pleineLargeur());

        // Le menu de Sentinelle sur le PC (Préparer un lancement reste sur le PC : les modifications ne se font que là).
        onglets = new TabLayout(this);
        onglets.setBackgroundColor(0xFFFFFFFF);
        onglets.setTabMode(TabLayout.MODE_FIXED);
        onglets.setTabGravity(TabLayout.GRAVITY_FILL);
        onglets.setSelectedTabIndicatorColor(Ui.BORDEAUX);
        onglets.setTabTextColors(Ui.GRIS, Ui.BORDEAUX);
        onglets.addTab(onglets.newTab().setText("La semaine").setTag(ONGLET_SEMAINE));
        onglets.addTab(onglets.newTab().setText("Contrôler la coupe").setTag(ONGLET_CONTROLE));
        onglets.addTab(onglets.newTab().setText("Rechercher une pièce").setTag(ONGLET_RECHERCHE));
        onglets.addTab(onglets.newTab().setText("Bibliothèque des semaines").setTag(ONGLET_BIBLIOTHEQUE));
        racine.addView(onglets, ui.pleineLargeur());

        defilement = new ScrollView(this);
        defilement.setFillViewport(true);
        contenu = ui.colonne();
        contenu.setPadding(ui.dp(14), ui.dp(12), ui.dp(14), ui.dp(40));
        defilement.addView(contenu, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        racine.addView(defilement, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(racine);

        selectionnerOnglet(onglet);
        onglets.addOnTabSelectedListener(new TabLayout.OnTabSelectedListener() {
            @Override
            public void onTabSelected(TabLayout.Tab tab) {
                onglet = (String) tab.getTag();
                afficher();
                defilement.scrollTo(0, 0);
            }

            @Override
            public void onTabUnselected(TabLayout.Tab tab) {}

            @Override
            public void onTabReselected(TabLayout.Tab tab) {}
        });
        afficher();
    }

    /** Barre du haut à la charte (comme la page web) : logo Laisné Industrie blanc, filet, « Sentinelle » et la version. */
    private View barreLaisne() {
        LinearLayout barre = ui.rangee();
        barre.setBackgroundColor(ui.couleur(R.color.marque));
        barre.setPadding(ui.dp(16), ui.dp(10), ui.dp(16), ui.dp(10));
        android.widget.ImageView logo = new android.widget.ImageView(this);
        logo.setImageResource(R.drawable.logo_laisne_blanc);
        logo.setAdjustViewBounds(true);
        logo.setContentDescription("LAISNÉ INDUSTRIE");
        barre.addView(logo, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ui.dp(36)));
        View filet = new View(this);
        filet.setBackgroundColor(0x59FFFFFF);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(Math.max(1, ui.dp(1)), ui.dp(34));
        lp.setMargins(ui.dp(14), 0, ui.dp(14), 0);
        barre.addView(filet, lp);
        LinearLayout titres = ui.colonne();
        titres.addView(ui.titre("Sentinelle", 20, 0xFFFFFFFF));
        titres.addView(ui.texte("Contrôle de coupe · " + version(), 13, false, 0xDDFFFFFF));
        barre.addView(titres);
        return barre;
    }

    /** « V6.0.9 » : la version de Sentinelle (la même que sur le PC). */
    String version() {
        try {
            return "V" + getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle etat) {
        super.onSaveInstanceState(etat);
        etat.putString("onglet", onglet);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Retour dans l'appli : le fichier partagé a pu changer sur le PC.
        if (partage().uri() != null || partage().codeLien() != null) partage().actualiser();
    }

    /** Les écrans, tous lus dans le fichier partagé. */
    PartageVue partage() {
        if (partage == null) partage = new PartageVue(this, ui, app);
        return partage;
    }

    /** Le fichier partagé vient d'être lu (l'écran est déjà refait). */
    void partageCharge() {}

    /** Ouvre l'appareil photo pour scanner le QR code affiché par Sentinelle sur le PC (Bibliothèque des semaines). */
    void scannerQrDuPc() {
        ScanOptions o = new ScanOptions();
        o.setDesiredBarcodeFormats(ScanOptions.QR_CODE);
        o.setPrompt("Visez le QR code affiché sur le PC (Bibliothèque des semaines → Téléphone)");
        o.setBeepEnabled(false);
        o.setOrientationLocked(false);
        lecteurQr.launch(o);
    }

    /** Sélecteur d'Android pour choisir le fichier partagé (le Drive du compte de l'appareil y apparaît). */
    void choisirFichierPartage() {
        choixPartage.launch(new String[] {"*/*"});
    }

    private PartageVue.Ecran ecran() {
        switch (onglet) {
            case ONGLET_CONTROLE:
                return PartageVue.Ecran.CONTROLE;
            case ONGLET_RECHERCHE:
                return PartageVue.Ecran.RECHERCHE;
            case ONGLET_BIBLIOTHEQUE:
                return PartageVue.Ecran.BIBLIOTHEQUE;
            default:
                return PartageVue.Ecran.SEMAINE;
        }
    }

    void afficher() {
        contenu.removeAllViews();
        contenu.addView(partage().vue(ecran()));
    }

    private void selectionnerOnglet(String tag) {
        for (int i = 0; i < onglets.getTabCount(); i++) {
            TabLayout.Tab t = onglets.getTabAt(i);
            if (t != null && tag.equals(t.getTag()) && !t.isSelected()) t.select();
        }
    }

    /** Va à un écran (comme un clic dans le menu). */
    void allerA(String tag) {
        if (tag.equals(onglet)) {
            afficher();
            defilement.scrollTo(0, 0);
        } else {
            selectionnerOnglet(tag);
        }
    }

    /** Fait défiler l'écran jusqu'à une vue (une fois l'écran dessiné). */
    void montrer(View v) {
        v.post(() -> {
            int y = 0;
            for (View x = v; x != null && x != contenu; x = (View) x.getParent()) y += x.getTop();
            defilement.smoothScrollTo(0, Math.max(0, y - ui.dp(8)));
        });
    }

    // ---- enregistrement d'un PDF (compte rendu de la semaine) ----

    /** Demande où enregistrer le PDF (sélecteur d'Android), puis l'y écrit. */
    void enregistrerPdf(String nom, byte[] octets) {
        app.pdfEnAttente = octets;
        creationPdf.launch(nom);
    }

    private void emplacementPdfChoisi(Uri uri) {
        byte[] octets = app.pdfEnAttente;
        app.pdfEnAttente = null;
        if (uri == null || octets == null) return;
        try (OutputStream sortie = getContentResolver().openOutputStream(uri)) {
            if (sortie == null) throw new java.io.IOException("emplacement introuvable");
            sortie.write(octets);
            Snackbar.make(defilement, "Compte rendu enregistré.", Snackbar.LENGTH_LONG).show();
        } catch (Exception e) {
            new AlertDialog.Builder(this)
                    .setTitle("Compte rendu")
                    .setMessage("Impossible d'enregistrer le compte rendu : " + (e.getMessage() != null ? e.getMessage() : e))
                    .setPositiveButton("OK", null)
                    .show();
        }
    }
}
