package com.marinedouyere.sentinelle;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.ContextCompat;
import androidx.core.content.res.ResourcesCompat;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;

/**
 * Petits constructeurs de vues natives, pour garder l'écran principal lisible.
 * Charte Laisné Industrie : Lato pour le texte, Raleway pour les titres, bordeaux en accent.
 */
final class Ui {

    static final int BORDEAUX = 0xFF78140C;
    static final int SAUMON = 0xFFEAC2B7;
    static final int SAUMON_PALE = 0xFFFAF0EC;
    static final int GRIS = 0xFF797978;
    static final int GRIS_CLAIR = 0xFFF4F3F1;
    static final int GRIS_FILET = 0xFFE9E7E3;
    static final int NOIR = 0xFF22231D;

    private final Context c;
    private Typeface lato;
    private Typeface latoGras;
    private Typeface latoItalique;
    private Typeface raleway;

    Ui(Context c) {
        this.c = c;
    }

    private Typeface police(int id) {
        Typeface t = null;
        try {
            t = ResourcesCompat.getFont(c, id);
        } catch (RuntimeException e) {
            // Police introuvable (ancien appareil) : police du système.
        }
        return t != null ? t : Typeface.DEFAULT;
    }

    Typeface lato() {
        if (lato == null) lato = police(R.font.lato_regular);
        return lato;
    }

    Typeface latoGras() {
        if (latoGras == null) latoGras = police(R.font.lato_bold);
        return latoGras;
    }

    Typeface latoItalique() {
        if (latoItalique == null) latoItalique = police(R.font.lato_italic);
        return latoItalique;
    }

    Typeface raleway() {
        if (raleway == null) raleway = police(R.font.raleway_bold);
        return raleway;
    }

    int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    int couleur(int id) {
        return ContextCompat.getColor(c, id);
    }

    LinearLayout colonne() {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    LinearLayout rangee() {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    TextView texte(CharSequence t, float sp, boolean gras, int couleur) {
        TextView v = new TextView(c);
        v.setText(t);
        v.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        v.setTextColor(couleur);
        v.setTypeface(gras ? latoGras() : lato());
        return v;
    }

    TextView texte(CharSequence t) {
        return texte(t, 15, false, NOIR);
    }

    /** Titre en Raleway Bold (titres de section : bordeaux). */
    TextView titre(CharSequence t, float sp, int couleur) {
        TextView v = texte(t, sp, false, couleur);
        v.setTypeface(raleway());
        return v;
    }

    /** Fond uni avec une barre de couleur à gauche (encadré de mise en avant de la charte). */
    Drawable fondABarre(int fond, int barre, int largeurBarreDp) {
        LayerDrawable d = new LayerDrawable(new Drawable[] {new ColorDrawable(barre), new ColorDrawable(fond)});
        d.setLayerInset(1, dp(largeurBarreDp), 0, 0, 0);
        return d;
    }

    TextView bandeau(CharSequence t, int fond, int couleurTexte) {
        TextView v = texte(t, 14, true, couleurTexte);
        v.setPadding(dp(14), dp(9), dp(10), dp(9));
        v.setBackground(fondABarre(fond, couleurTexte, 3));
        return v;
    }

    /** Pastille numérotée de la charte : cercle saumon, numéro bordeaux à deux chiffres. */
    TextView pastille(int numero) {
        TextView v = titre(String.format(java.util.Locale.ROOT, "%02d", numero), 11, BORDEAUX);
        v.setGravity(Gravity.CENTER);
        GradientDrawable g = new GradientDrawable();
        g.setShape(GradientDrawable.OVAL);
        g.setColor(SAUMON);
        v.setBackground(g);
        v.setLayoutParams(new LinearLayout.LayoutParams(dp(26), dp(26)));
        return v;
    }

    /** Filet saumon sous un titre. */
    View filetSaumon() {
        View v = new View(c);
        v.setBackgroundColor(SAUMON);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, dp(1)));
        lp.setMargins(0, dp(4), 0, dp(8));
        v.setLayoutParams(lp);
        return v;
    }

    MaterialCardView carte() {
        MaterialCardView carte = new MaterialCardView(c);
        carte.setRadius(dp(6));
        carte.setCardElevation(0);
        carte.setStrokeWidth(dp(1));
        carte.setStrokeColor(couleur(R.color.bordure));
        carte.setCardBackgroundColor(0xFFFFFFFF);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(6), 0, dp(10));
        carte.setLayoutParams(lp);
        return carte;
    }

    /** Couleur d'un bouton : grisée quand il est désactivé. */
    private static ColorStateList selonEtat(int desactive, int actif) {
        return new ColorStateList(new int[][] {{-android.R.attr.state_enabled}, {}}, new int[] {desactive, actif});
    }

    MaterialButton bouton(String texte) {
        MaterialButton b = new MaterialButton(c);
        b.setText(texte);
        b.setAllCaps(false);
        b.setTypeface(latoGras());
        b.setCornerRadius(dp(4));
        b.setBackgroundTintList(selonEtat(GRIS_FILET, BORDEAUX));
        b.setTextColor(selonEtat(GRIS, 0xFFFFFFFF));
        return b;
    }

    MaterialButton boutonContour(String texte) {
        MaterialButton b = new MaterialButton(c, null, com.google.android.material.R.attr.materialButtonOutlinedStyle);
        b.setText(texte);
        b.setAllCaps(false);
        b.setTypeface(latoGras());
        b.setCornerRadius(dp(4));
        b.setStrokeColor(selonEtat(GRIS_FILET, BORDEAUX));
        b.setTextColor(selonEtat(GRIS, BORDEAUX));
        return b;
    }

    MaterialButton boutonTexte(String texte) {
        MaterialButton b = new MaterialButton(c, null, com.google.android.material.R.attr.borderlessButtonStyle);
        b.setText(texte);
        b.setAllCaps(false);
        b.setTypeface(latoGras());
        b.setTextColor(GRIS);
        b.setMinWidth(0);
        b.setPadding(dp(8), 0, dp(8), 0);
        return b;
    }

    LinearLayout.LayoutParams pleineLargeur() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    LinearLayout.LayoutParams poids(float poids) {
        return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, poids);
    }

    LinearLayout.LayoutParams marges(int haut, int bas) {
        LinearLayout.LayoutParams lp = pleineLargeur();
        lp.setMargins(0, dp(haut), 0, dp(bas));
        return lp;
    }

    View espace(int hauteurDp) {
        View v = new View(c);
        v.setLayoutParams(new LinearLayout.LayoutParams(1, dp(hauteurDp)));
        return v;
    }

    View separateur() {
        View v = new View(c);
        v.setBackgroundColor(couleur(R.color.bordure));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1));
        lp.setMargins(0, dp(8), 0, dp(8));
        v.setLayoutParams(lp);
        return v;
    }
}
