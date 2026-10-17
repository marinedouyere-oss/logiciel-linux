package com.marinedouyere.sentinelle;

import android.content.Context;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.ContextCompat;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;

/** Petits constructeurs de vues natives, pour garder l'écran principal lisible. */
final class Ui {

    private final Context c;

    Ui(Context c) {
        this.c = c;
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
        if (gras) v.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return v;
    }

    TextView texte(CharSequence t) {
        return texte(t, 15, false, 0xFF222222);
    }

    TextView bandeau(CharSequence t, int fond, int couleurTexte) {
        TextView v = texte(t, 14, true, couleurTexte);
        v.setPadding(dp(10), dp(8), dp(10), dp(8));
        GradientDrawable g = new GradientDrawable();
        g.setColor(fond);
        g.setCornerRadius(dp(8));
        v.setBackground(g);
        return v;
    }

    MaterialCardView carte() {
        MaterialCardView carte = new MaterialCardView(c);
        carte.setRadius(dp(12));
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

    MaterialButton bouton(String texte) {
        MaterialButton b = new MaterialButton(c);
        b.setText(texte);
        b.setAllCaps(false);
        return b;
    }

    MaterialButton boutonContour(String texte) {
        MaterialButton b = new MaterialButton(c, null, com.google.android.material.R.attr.materialButtonOutlinedStyle);
        b.setText(texte);
        b.setAllCaps(false);
        return b;
    }

    MaterialButton boutonTexte(String texte) {
        MaterialButton b = new MaterialButton(c, null, com.google.android.material.R.attr.borderlessButtonStyle);
        b.setText(texte);
        b.setAllCaps(false);
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
