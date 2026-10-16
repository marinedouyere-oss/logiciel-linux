package com.marinedouyere.sentinelle;

import android.view.View;
import android.widget.LinearLayout;

/** Onglet Recherche (clé, commande ou bande/modulo dans tous les fichiers chargés). */
final class RechercheVue {

    private final LinearLayout racine;

    RechercheVue(MainActivity activite, Ui ui, SentinelleApp app) {
        racine = ui.colonne();
        racine.addView(ui.texte("Recherche : en cours de portage."));
    }

    View vue() {
        if (racine.getParent() != null) ((android.view.ViewGroup) racine.getParent()).removeView(racine);
        return racine;
    }
}
