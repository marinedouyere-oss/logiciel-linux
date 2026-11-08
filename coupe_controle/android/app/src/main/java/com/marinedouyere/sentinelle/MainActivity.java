package com.marinedouyere.sentinelle;

import android.content.res.ColorStateList;
import android.net.Uri;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
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
import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.google.android.material.navigation.NavigationBarView;

import java.io.OutputStream;

/**
 * Sentinelle sur le téléphone : les mêmes écrans que Sentinelle sur le PC (La semaine, Contrôler la coupe,
 * Rechercher une pièce, Bibliothèque des semaines, Suivi de production), lus dans le fichier partagé du PC.
 * L'appli ne fait que lire : les lancements se préparent et se contrôlent sur le PC.
 * V6.2.1 : barre compacte en haut, menu en bas (icônes du PC), écrans faits pour le téléphone.
 */
public class MainActivity extends AppCompatActivity {

    static final String ONGLET_SEMAINE = "semaine";
    static final String ONGLET_CONTROLE = "controle";
    static final String ONGLET_RECHERCHE = "recherche";
    static final String ONGLET_BIBLIOTHEQUE = "bibliotheque";
    static final String ONGLET_SUIVI = "suivi";

    /** Le menu du bas : { onglet, libellé court, icône } dans l'ordre du menu du PC. */
    static final Object[][] MENU = {
            {ONGLET_SEMAINE, "Semaine", R.drawable.ic_nav_semaine},
            {ONGLET_CONTROLE, "Contrôle", R.drawable.ic_nav_controle},
            {ONGLET_RECHERCHE, "Recherche", R.drawable.ic_nav_recherche},
            {ONGLET_BIBLIOTHEQUE, "Bibliothèque", R.drawable.ic_nav_bibliotheque},
            {ONGLET_SUIVI, "Suivi", R.drawable.ic_nav_suivi},
    };

    private SentinelleApp app;
    private Ui ui;
    private String onglet = ONGLET_SEMAINE;
    private LinearLayout contenu;
    private ScrollView defilement;
    private BottomNavigationView menu;
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

        defilement = new ScrollView(this);
        defilement.setFillViewport(true);
        contenu = ui.colonne();
        contenu.setPadding(ui.dp(14), ui.dp(10), ui.dp(14), ui.dp(24));
        defilement.addView(contenu, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        racine.addView(defilement, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        // Le menu de Sentinelle sur le PC, en bas de l'écran (Préparer un lancement reste sur le PC).
        View filet = new View(this);
        filet.setBackgroundColor(ui.couleur(R.color.bordure));
        racine.addView(filet, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, ui.dp(1))));
        menu = new BottomNavigationView(this);
        menu.setBackgroundColor(0xFFFFFFFF);
        menu.setLabelVisibilityMode(NavigationBarView.LABEL_VISIBILITY_LABELED);
        ColorStateList couleurs = new ColorStateList(new int[][] {{android.R.attr.state_checked}, {}}, new int[] {Ui.BORDEAUX, Ui.GRIS});
        menu.setItemIconTintList(couleurs);
        menu.setItemTextColor(couleurs);
        menu.setItemActiveIndicatorColor(ColorStateList.valueOf(Ui.SAUMON_PALE));
        menu.setItemTextAppearanceActive(R.style.Texte_Menu);
        menu.setItemTextAppearanceInactive(R.style.Texte_Menu);
        for (int i = 0; i < MENU.length; i++) {
            MenuItem item = menu.getMenu().add(Menu.NONE, i + 1, i, (String) MENU[i][1]);
            item.setIcon((Integer) MENU[i][2]);
        }
        racine.addView(menu, ui.pleineLargeur());
        setContentView(racine);

        menu.setSelectedItemId(idDe(onglet));
        menu.setOnItemSelectedListener(item -> {
            onglet = (String) MENU[item.getItemId() - 1][0];
            afficher();
            defilement.scrollTo(0, 0);
            return true;
        });
        menu.setOnItemReselectedListener(item -> defilement.smoothScrollTo(0, 0));
        afficher();
    }

    private static int idDe(String tag) {
        for (int i = 0; i < MENU.length; i++) if (MENU[i][0].equals(tag)) return i + 1;
        return 1;
    }

    /** Barre du haut à la charte, compacte : logo Laisné Industrie blanc, « Sentinelle », la version, Actualiser. */
    private View barreLaisne() {
        LinearLayout barre = ui.rangee();
        barre.setBackgroundColor(ui.couleur(R.color.marque));
        barre.setPadding(ui.dp(14), ui.dp(8), ui.dp(6), ui.dp(8));
        android.widget.ImageView logo = new android.widget.ImageView(this);
        logo.setImageResource(R.drawable.logo_laisne_blanc);
        logo.setAdjustViewBounds(true);
        logo.setContentDescription("LAISNÉ INDUSTRIE");
        barre.addView(logo, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ui.dp(26)));
        View filet = new View(this);
        filet.setBackgroundColor(0x59FFFFFF);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(Math.max(1, ui.dp(1)), ui.dp(26));
        lp.setMargins(ui.dp(12), 0, ui.dp(12), 0);
        barre.addView(filet, lp);
        LinearLayout titres = ui.colonne();
        titres.addView(ui.titre("Sentinelle", 17, 0xFFFFFFFF));
        titres.addView(ui.texte("Contrôle de coupe · " + version(), 11, false, 0xDDFFFFFF));
        barre.addView(titres, ui.poids(1));
        android.widget.ImageButton actualiser = new android.widget.ImageButton(this);
        actualiser.setImageResource(R.drawable.ic_actualiser);
        actualiser.setColorFilter(0xFFFFFFFF);
        actualiser.setContentDescription("Actualiser");
        android.util.TypedValue fond = new android.util.TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, fond, true);
        actualiser.setBackgroundResource(fond.resourceId);
        actualiser.setOnClickListener(v -> {
            if (partage().uri() != null || partage().codeLien() != null) partage().actualiser();
            else allerA(ONGLET_BIBLIOTHEQUE);
        });
        barre.addView(actualiser, new LinearLayout.LayoutParams(ui.dp(44), ui.dp(44)));
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
            case ONGLET_SUIVI:
                return PartageVue.Ecran.SUIVI;
            default:
                return PartageVue.Ecran.SEMAINE;
        }
    }

    void afficher() {
        contenu.removeAllViews();
        contenu.addView(partage().vue(ecran()));
    }

    /** Va à un écran (comme un appui dans le menu du bas). */
    void allerA(String tag) {
        if (tag.equals(onglet)) {
            afficher();
            defilement.scrollTo(0, 0);
        } else {
            menu.setSelectedItemId(idDe(tag));
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
