package com.marinedouyere.sentinelle;

import android.text.InputType;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;

import org.json.JSONObject;

import java.util.List;

/**
 * V6.8 : l'écran Claustras du téléphone. La confirmation de commande ne dit pas toujours quelle lame a quelle largeur
 * (« Largeur des lames : 80 et 77 mm ») : le plan le dit. On le prend en photo (ou on choisit une photo déjà prise) ;
 * elle part au PC par le lien (chiffrée) et se range dans Claustras, à côté de la commande, où l'on saisit les lames.
 */
final class EcranClaustras {

    interface Hote {
        FichierPartage donnees();

        DemandesPc demandes();

        boolean relie();

        /** Ouvre l'appareil photo pour cette commande. */
        void prendrePhoto(String commande);

        /** Ouvre la galerie pour cette commande. */
        void choisirPhoto(String commande);
    }

    private final MainActivity activite;
    private final Ui ui;
    private final Hote hote;
    /** N° tapé dans « Autre commande » (gardé tant que l'appli est ouverte). */
    private String autre = "";

    EcranClaustras(MainActivity activite, Ui ui, Hote hote) {
        this.activite = activite;
        this.ui = ui;
        this.hote = hote;
    }

    void construire(LinearLayout racine) {
        FichierPartage d = hote.donnees();
        DemandesPc demandes = hote.demandes();
        if (!hote.relie())
            racine.addView(ui.bandeau("Reliez d'abord le téléphone au PC (« Relier au PC » en haut, ou Plus → Lien avec le PC) : la photo part au PC par ce lien.",
                    ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)), ui.marges(4, 8));

        // Les photos en route, et les dernières reprises par le PC.
        List<JSONObject> attente = demandes.photosEnAttente();
        List<JSONObject> res = demandes.resultatsPhotos();
        if (!attente.isEmpty() || !res.isEmpty()) {
            MaterialCardView carte = ui.carte();
            LinearLayout c = ui.colonne();
            c.setPadding(ui.dp(14), ui.dp(12), ui.dp(14), ui.dp(12));
            c.addView(ui.titreCarte("Photos envoyées"));
            for (JSONObject x : attente)
                c.addView(ui.texte("⏳ " + x.optString("titre") + " — " + (x.optBoolean("envoyee") ? "envoyée, le PC la reprend dans une minute environ" : "pas encore envoyée"), 13.5f, false, Ui.NOIR), ui.marges(4, 0));
            if (demandes.erreur() != null && !attente.isEmpty())
                c.addView(ui.bandeau("⚠ Envoi au PC : " + demandes.erreur(), ui.couleur(R.color.alerte_fond), ui.couleur(R.color.alerte_texte)), ui.marges(6, 4));
            int n = 0;
            for (JSONObject x : res) {
                if (n++ >= 5) break;
                boolean ok = x.optBoolean("ok");
                c.addView(ui.texte((ok ? "✔ " : "⚠ ") + x.optString("texte"), 13.5f, false, ok ? ui.couleur(R.color.ok_texte) : ui.couleur(R.color.alerte_texte)), ui.marges(4, 0));
            }
            carte.addView(c);
            racine.addView(carte);
        }

        // Les commandes claustras lues sur le PC.
        MaterialCardView carte = ui.carte();
        LinearLayout c = ui.colonne();
        c.setPadding(ui.dp(14), ui.dp(12), ui.dp(14), ui.dp(12));
        c.addView(ui.titreCarte("Commandes claustras du PC"));
        if (d == null || d.claustras.isEmpty()) {
            c.addView(ui.note("Aucune commande claustra sur le PC pour l'instant (sur le PC : Claustras → lire les confirmations). Vous pouvez quand même envoyer une photo : tapez le n° de commande ci-dessous."), ui.marges(4, 0));
        } else {
            boolean premier = true;
            for (FichierPartage.ClaustraCmd cmd : d.claustras) {
                if (!premier) c.addView(ui.filet(8, 8));
                premier = false;
                c.addView(ligneCommande(cmd));
            }
        }
        carte.addView(c);
        racine.addView(carte);

        // Une commande pas encore lue sur le PC.
        MaterialCardView carteAutre = ui.carte();
        LinearLayout a = ui.colonne();
        a.setPadding(ui.dp(14), ui.dp(12), ui.dp(14), ui.dp(12));
        a.addView(ui.titreCarte("Autre commande"));
        a.addView(ui.note("Le n° de la confirmation (8 chiffres, « CVC » s'ajoute tout seul)."), ui.marges(2, 6));
        EditText champ = new EditText(activite);
        champ.setHint("CVC26100433");
        champ.setSingleLine(true);
        champ.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        champ.setText(autre);
        champ.setTypeface(ui.lato());
        champ.setTextSize(15);
        champ.addTextChangedListener(new android.text.TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int st, int co, int af) {}

            @Override
            public void onTextChanged(CharSequence s, int st, int av, int co) {}

            @Override
            public void afterTextChanged(android.text.Editable s) {
                autre = s.toString();
            }
        });
        a.addView(champ, ui.pleineLargeur());
        a.addView(boutons(() -> PhotoPlan.commande(autre)), ui.marges(6, 0));
        carteAutre.addView(a);
        racine.addView(carteAutre);
    }

    private View ligneCommande(FichierPartage.ClaustraCmd cmd) {
        LinearLayout l = ui.colonne();
        LinearLayout haut = ui.rangee();
        TextView titre = ui.texte(cmd.commande + (cmd.reference.isEmpty() ? "" : " · " + cmd.reference), 15, true, Ui.NOIR);
        haut.addView(titre, ui.poids(1));
        if (cmd.photos > 0)
            haut.addView(ui.pilule(cmd.photos + " photo" + (cmd.photos > 1 ? "s" : "") + " sur le PC", ui.couleur(R.color.ok_fond), ui.couleur(R.color.ok_texte)));
        l.addView(haut);
        StringBuilder sous = new StringBuilder();
        if (!cmd.semaine.isEmpty()) sous.append("Semaine ").append(cmd.semaine).append(cmd.annee.isEmpty() ? "" : " " + cmd.annee);
        if (!cmd.client.isEmpty()) sous.append(sous.length() > 0 ? " · " : "").append(cmd.client);
        sous.append(sous.length() > 0 ? " · " : "").append(cmd.lignes).append(" claustra").append(cmd.lignes > 1 ? "s" : "");
        l.addView(ui.note(sous));
        if (cmd.plusieursLargeurs && cmd.photos == 0)
            l.addView(ui.pilule("Plusieurs largeurs de lames : photo du plan nécessaire", ui.couleur(R.color.attention_fond), ui.couleur(R.color.attention_texte)), ui.marges(4, 0));
        final String commande = cmd.commande;
        l.addView(boutons(() -> commande), ui.marges(6, 0));
        return l;
    }

    interface Numero {
        String commande();
    }

    private View boutons(Numero numero) {
        LinearLayout r = ui.rangee();
        MaterialButton photo = ui.bouton("Photo du plan");
        photo.setOnClickListener(v -> {
            String c = numero.commande();
            if (c == null) Toast.makeText(activite, "N° de commande : CVC + 8 chiffres", Toast.LENGTH_LONG).show();
            else hote.prendrePhoto(c);
        });
        MaterialButton galerie = ui.boutonContour("Choisir une photo");
        galerie.setOnClickListener(v -> {
            String c = numero.commande();
            if (c == null) Toast.makeText(activite, "N° de commande : CVC + 8 chiffres", Toast.LENGTH_LONG).show();
            else hote.choisirPhoto(c);
        });
        r.addView(photo, ui.poids(1));
        r.addView(ui.espace(1), new LinearLayout.LayoutParams(ui.dp(8), 1));
        r.addView(galerie, ui.poids(1));
        return r;
    }
}
