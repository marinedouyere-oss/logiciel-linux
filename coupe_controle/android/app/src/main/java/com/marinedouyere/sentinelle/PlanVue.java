package com.marinedouyere.sentinelle;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.view.View;

import java.util.Collections;
import java.util.Set;

/**
 * Dessin d'un plan de coupe Cut Rite (mêmes couleurs que Sentinelle sur le PC) : panneau gris, morceaux saumon,
 * la pièce cherchée (ou ce qui la porte) en jaune, chutes gardées en pointillés. En grand : morceaux numérotés.
 */
final class PlanVue extends View {

    private final PlansLancement.Plan plan;
    private final Set<Integer> visees;
    private final boolean numeros;
    private final float densite;
    private final Paint fond = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint trait = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint texte = new Paint(Paint.ANTI_ALIAS_FLAG);

    PlanVue(Context c, PlansLancement.Plan plan, Set<Integer> visees, boolean numeros) {
        super(c);
        this.plan = plan;
        this.visees = visees == null ? Collections.<Integer>emptySet() : visees;
        this.numeros = numeros;
        this.densite = c.getResources().getDisplayMetrics().density;
        fond.setStyle(Paint.Style.FILL);
        trait.setStyle(Paint.Style.STROKE);
        texte.setTextAlign(Paint.Align.CENTER);
        texte.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
        setContentDescription("Plan " + plan.pdc + " " + plan.matiere);
    }

    @Override
    protected void onMeasure(int largeurSpec, int hauteurSpec) {
        int w = MeasureSpec.getSize(largeurSpec);
        if (MeasureSpec.getMode(largeurSpec) == MeasureSpec.UNSPECIFIED) w = Math.round(340 * densite);
        setMeasuredDimension(w, Math.max(1, Math.round((float) (w * plan.W / plan.L))));
    }

    @Override
    protected void onDraw(Canvas c) {
        float e = getWidth() / (float) plan.L;
        fond.setColor(Ui.GRIS_CLAIR);
        c.drawRect(0, 0, getWidth(), getHeight(), fond);
        trait.setPathEffect(null);
        trait.setColor(Ui.GRIS);
        trait.setStrokeWidth(densite);
        c.drawRect(0.5f, 0.5f, getWidth() - 0.5f, getHeight() - 0.5f, trait);
        int n = 0;
        for (int i = 0; i < plan.morceaux.size(); i++) {
            PlansLancement.Morceau m = plan.morceaux.get(i);
            float x = (float) m.x * e;
            float y = (float) m.y * e;
            float l = (float) m.L * e;
            float h = (float) m.W * e;
            if (m.chute) {
                fond.setColor(0xFFFFF8E1);
                c.drawRect(x, y, x + l, y + h, fond);
                trait.setColor(0xFFB9A36A);
                trait.setStrokeWidth(densite);
                trait.setPathEffect(new DashPathEffect(new float[] {5 * densite, 3 * densite}, 0));
                c.drawRect(x, y, x + l, y + h, trait);
                trait.setPathEffect(null);
                continue;
            }
            n++;
            boolean v = visees.contains(i);
            if ("r".equals(m.etat)) {
                // Pièce retirée sur le PC : place vide, pointillés rouges, « retirée » (comme le plan imprimé).
                fond.setColor(0xFFFFFFFF);
                c.drawRect(x, y, x + l, y + h, fond);
                trait.setColor(0xFFC62828);
                trait.setStrokeWidth(2 * densite);
                trait.setPathEffect(new DashPathEffect(new float[] {6 * densite, 4 * densite}, 0));
                c.drawRect(x, y, x + l, y + h, trait);
                trait.setPathEffect(null);
                float t = Math.min(h * 0.35f, 11 * densite);
                texte.setTextSize(t);
                texte.setColor(0xFFC62828);
                String mot = texte.measureText("retirée — ne pas couper") < l * 0.95f ? "retirée — ne pas couper" : "retirée";
                if (t >= 6 * densite && texte.measureText(mot) < l * 0.95f) c.drawText(mot, x + l / 2, y + h / 2 + t * 0.35f, texte);
            } else {
                boolean pose = "a".equals(m.etat);
                boolean modif = "m".equals(m.etat);
                fond.setColor(pose ? 0xFFC8E6C9 : modif ? 0xFFBBDEFB : v ? 0xFFFFD54F : Ui.SAUMON);
                c.drawRect(x, y, x + l, y + h, fond);
                trait.setColor(pose ? 0xFF2E7D32 : modif ? 0xFF1565C0 : Ui.BORDEAUX);
                trait.setStrokeWidth((v || pose || modif ? 2.5f : 0.8f) * densite);
                c.drawRect(x, y, x + l, y + h, trait);
            }
            // Nom (clé sans « CVC », module, stratifié) et cote finie quand il y a la place.
            float taille = Math.min(h * 0.32f, 12 * densite);
            String nom = m.nom.replaceFirst("^CVC", "");
            texte.setTextSize(taille);
            if (!"r".equals(m.etat) && taille >= 6 * densite && texte.measureText(nom) < l * 0.95f) {
                texte.setColor(Ui.NOIR);
                boolean deux = h > taille * 2.6f;
                c.drawText(nom, x + l / 2, y + h / 2 + (deux ? -taille * 0.15f : taille * 0.35f), texte);
                if (deux) {
                    texte.setTextSize(taille * 0.8f);
                    String cote = PlansLancement.dims(m.finiL, m.finiW);
                    if (texte.measureText(cote) < l * 0.95f) c.drawText(cote, x + l / 2, y + h / 2 + taille * 0.95f, texte);
                }
            }
            if (numeros) {
                float r = Math.max(5 * densite, Math.min(9 * densite, h * 0.3f));
                float cx = x + r + 2 * densite;
                float cy = y + r + 2 * densite;
                fond.setColor(v ? Ui.NOIR : 0xFFFFFFFF);
                c.drawCircle(cx, cy, r, fond);
                trait.setColor(Ui.NOIR);
                trait.setStrokeWidth(densite);
                c.drawCircle(cx, cy, r, trait);
                texte.setTextSize(r * 1.1f);
                texte.setColor(v ? 0xFFFFFFFF : Ui.NOIR);
                c.drawText(String.valueOf(n), cx, cy + r * 0.38f, texte);
            }
        }
    }
}
