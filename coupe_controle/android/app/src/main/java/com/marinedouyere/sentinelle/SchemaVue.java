package com.marinedouyere.sentinelle;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.View;

import com.marinedouyere.sentinelle.moteur.ElementSvg;
import com.marinedouyere.sentinelle.moteur.SchemaCommande;

import java.util.List;

/**
 * Dessin natif d'un schéma (pièce seule ou ensemble d'une commande), à
 * partir des éléments calculés par le moteur — mêmes formes, couleurs et
 * traits que les dessins de l'appli web.
 */
final class SchemaVue extends View {

    private final List<ElementSvg> elements;
    private final float minX;
    private final float minY;
    private final float largeur;
    private final float hauteur;
    /** Schéma de commande : traits d'épaisseur fixe à l'écran, textes détourés de blanc, centrés verticalement. */
    private final boolean commande;
    private final float largeurMaxPx;
    private final float densite;

    private final Paint remplissage = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint trait = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint texte = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path chemin = new Path();
    private final RectF ovale = new RectF();

    SchemaVue(Context c, List<ElementSvg> elements, double minX, double minY, double largeur, double hauteur,
            boolean commande, int largeurMaxDp) {
        super(c);
        this.elements = elements;
        this.minX = (float) minX;
        this.minY = (float) minY;
        this.largeur = (float) largeur;
        this.hauteur = (float) hauteur;
        this.commande = commande;
        this.densite = c.getResources().getDisplayMetrics().density;
        this.largeurMaxPx = largeurMaxDp * densite;
        remplissage.setStyle(Paint.Style.FILL);
        trait.setStyle(Paint.Style.STROKE);
        trait.setStrokeJoin(Paint.Join.ROUND);
        texte.setTextAlign(Paint.Align.CENTER);
        GradientDrawable fond = new GradientDrawable();
        fond.setColor(0xFFFBFCFD);
        fond.setStroke(Math.max(1, Math.round(densite)), 0xFFE0E6EC);
        fond.setCornerRadius(6 * densite);
        setBackground(fond);
    }

    static SchemaVue piece(Context c, List<ElementSvg> elements) {
        return new SchemaVue(c, elements, 0, 0, 320, 190, false, 340);
    }

    static SchemaVue ensemble(Context c, SchemaCommande.Dessin d, List<ElementSvg> elements) {
        return new SchemaVue(c, elements, d.minX, d.minY, d.largeur, d.hauteur, true, 560);
    }

    @Override
    protected void onMeasure(int largeurSpec, int hauteurSpec) {
        int dispo = MeasureSpec.getSize(largeurSpec);
        int w = MeasureSpec.getMode(largeurSpec) == MeasureSpec.UNSPECIFIED ? Math.round(largeurMaxPx)
                : Math.min(dispo, Math.round(largeurMaxPx));
        int h = Math.round(w * hauteur / largeur);
        setMeasuredDimension(w, h);
    }

    /** Épaisseur de trait : en px d'écran (CSS) pour une commande, en unités du dessin pour une pièce. */
    private float epaisseur(float valeur, float echelle) {
        return commande ? valeur * densite / echelle : valeur;
    }

    private void styleTrait(String classe, float echelle) {
        trait.setPathEffect(null);
        trait.setStrokeCap(Paint.Cap.BUTT);
        int couleur;
        float largeurTrait;
        float[] tirets = null;
        switch (classe.split(" ")[0]) {
            case "schema-rect":
                couleur = 0xFF37474F;
                largeurTrait = 1.5f;
                break;
            case "schema-cote":
                couleur = 0xFF90A4AE;
                largeurTrait = 1f;
                break;
            case "schema-chant":
                couleur = 0xFFB26A00;
                largeurTrait = 4f;
                trait.setStrokeCap(Paint.Cap.ROUND);
                break;
            case "schema-dvr":
                couleur = 0xFF6A1B9A;
                largeurTrait = 1.5f;
                tirets = new float[] {4, 3};
                break;
            case "schema-chapelle":
                couleur = 0xFF2E7D32;
                largeurTrait = 1.3f;
                break;
            case "sc-plan":
                couleur = 0xFF37474F;
                largeurTrait = 1.4f;
                if (classe.contains("forme")) tirets = new float[] {6, 4};
                break;
            case "sc-credence":
                couleur = 0xFF00796B;
                largeurTrait = 1.2f;
                break;
            case "sc-chant":
                couleur = 0xFFB26A00;
                largeurTrait = 3.5f;
                trait.setStrokeCap(Paint.Cap.ROUND);
                break;
            case "sc-joint":
                couleur = 0xFF1565C0;
                largeurTrait = 3f;
                tirets = new float[] {7, 4};
                break;
            case "sc-chapelle":
                couleur = 0xFF2E7D32;
                largeurTrait = 1.2f;
                break;
            case "sc-orphelin":
                couleur = 0xFFC62828;
                largeurTrait = 3f;
                tirets = new float[] {3, 3};
                break;
            case "sc-dvr":
                couleur = 0xFF6A1B9A;
                largeurTrait = 1.4f;
                tirets = classe.contains("predecoupe") ? new float[] {2, 3} : new float[] {5, 3};
                break;
            default:
                couleur = 0xFF37474F;
                largeurTrait = 1f;
                break;
        }
        if (classe.contains("surligne")) {
            couleur = 0xFF1565C0;
            largeurTrait = 2.6f;
        }
        trait.setColor(couleur);
        trait.setStrokeWidth(epaisseur(largeurTrait, echelle));
        if (tirets != null) {
            float[] t = new float[tirets.length];
            for (int i = 0; i < t.length; i++) t[i] = epaisseur(tirets[i], echelle);
            trait.setPathEffect(new DashPathEffect(t, 0));
        }
    }

    /** Couleur de fond d'une forme, ou 0 si elle n'est pas remplie. */
    private static int fond(String classe) {
        if (classe.contains("surligne")) return 0xFFFFF59D;
        switch (classe.split(" ")[0]) {
            case "schema-rect":
            case "sc-plan":
                return 0xFFEEF3F9;
            case "sc-credence":
                return 0xFFE0F2F1;
            case "schema-chapelle":
            case "sc-chapelle":
                return 0xFFFFFFFF;
            default:
                return 0;
        }
    }

    private void dessinerForme(Canvas canvas, ElementSvg e, Path forme, float echelle) {
        int f = fond(e.classe);
        if (f != 0) {
            remplissage.setColor(f);
            canvas.drawPath(forme, remplissage);
        }
        styleTrait(e.classe, echelle);
        canvas.drawPath(forme, trait);
    }

    private void construireContour(SchemaCommande.Contour contour) {
        chemin.reset();
        float px = 0;
        float py = 0;
        for (SchemaCommande.Trace t : contour.traces) {
            if (t.op == 'M') {
                chemin.moveTo((float) t.x, (float) t.y);
            } else if (t.op == 'L') {
                chemin.lineTo((float) t.x, (float) t.y);
            } else {
                double[] arc = SchemaCommande.arcCentre(px, py, t.x, t.y, t.r);
                ovale.set((float) (arc[0] - arc[2]), (float) (arc[1] - arc[2]), (float) (arc[0] + arc[2]), (float) (arc[1] + arc[2]));
                chemin.arcTo(ovale, (float) arc[3], (float) arc[4], false);
            }
            px = (float) t.x;
            py = (float) t.y;
        }
        chemin.close();
    }

    private void dessinerTexte(Canvas canvas, ElementSvg e, float echelle) {
        String classe = e.classe;
        float taille;
        int couleur;
        boolean gras = true;
        switch (classe) {
            case "schema-cote-label":
                taille = 10;
                couleur = 0xFF37474F;
                break;
            case "schema-chant-label":
                taille = 9;
                couleur = 0xFFB26A00;
                break;
            case "schema-dvr-label":
                taille = 9;
                couleur = 0xFF6A1B9A;
                break;
            case "sc-texte-cote":
                taille = (float) e.v("font-size");
                couleur = 0xFF455A64;
                break;
            case "sc-texte-credence":
                taille = (float) e.v("font-size");
                couleur = 0xFF00695C;
                break;
            case "sc-texte-alerte":
                taille = (float) e.v("font-size");
                couleur = 0xFFC62828;
                break;
            default:
                taille = (float) e.v("font-size");
                couleur = 0xFF263238;
                break;
        }
        texte.setTypeface(gras ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        texte.setTextSize(taille);
        float x = (float) e.v("x");
        float y = (float) e.v("y");
        if (commande) {
            // dominant-baseline: middle
            Paint.FontMetrics m = texte.getFontMetrics();
            y -= (m.ascent + m.descent) / 2;
        }
        int sauvegarde = canvas.save();
        if (e.valeurs.containsKey("rotation")) canvas.rotate((float) e.v("rotation"), (float) e.v("x"), (float) e.v("y"));
        if (commande) {
            texte.setStyle(Paint.Style.STROKE);
            texte.setStrokeWidth(3 * densite / echelle);
            texte.setStrokeJoin(Paint.Join.ROUND);
            texte.setColor(0xFFFFFFFF);
            canvas.drawText(e.texte, x, y, texte);
        }
        texte.setStyle(Paint.Style.FILL);
        texte.setColor(couleur);
        canvas.drawText(e.texte, x, y, texte);
        canvas.restoreToCount(sauvegarde);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float echelle = getWidth() / largeur;
        int sauvegarde = canvas.save();
        canvas.scale(echelle, echelle);
        canvas.translate(-minX, -minY);
        for (ElementSvg e : elements) {
            switch (e.tag) {
                case "rect": {
                    float x = (float) e.v("x");
                    float y = (float) e.v("y");
                    float w = (float) e.v("width");
                    float h = (float) e.v("height");
                    float rx = (float) e.v("rx");
                    chemin.reset();
                    chemin.addRoundRect(new RectF(x, y, x + w, y + h), rx, rx, Path.Direction.CW);
                    dessinerForme(canvas, e, chemin, echelle);
                    break;
                }
                case "line":
                    styleTrait(e.classe, echelle);
                    canvas.drawLine((float) e.v("x1"), (float) e.v("y1"), (float) e.v("x2"), (float) e.v("y2"), trait);
                    break;
                case "ellipse": {
                    float cx = (float) e.v("cx");
                    float cy = (float) e.v("cy");
                    float rx = (float) e.v("rx");
                    float ry = (float) e.v("ry");
                    chemin.reset();
                    chemin.addOval(new RectF(cx - rx, cy - ry, cx + rx, cy + ry), Path.Direction.CW);
                    dessinerForme(canvas, e, chemin, echelle);
                    break;
                }
                case "circle": {
                    float r = (float) e.v("r");
                    chemin.reset();
                    chemin.addCircle((float) e.v("cx"), (float) e.v("cy"), r, Path.Direction.CW);
                    dessinerForme(canvas, e, chemin, echelle);
                    break;
                }
                case "polygon": {
                    chemin.reset();
                    for (int i = 0; i < e.points.size(); i++) {
                        double[] p = e.points.get(i);
                        if (i == 0) chemin.moveTo((float) p[0], (float) p[1]);
                        else chemin.lineTo((float) p[0], (float) p[1]);
                    }
                    chemin.close();
                    dessinerForme(canvas, e, chemin, echelle);
                    break;
                }
                case "path":
                    construireContour(e.contour);
                    dessinerForme(canvas, e, chemin, echelle);
                    break;
                case "text":
                    dessinerTexte(canvas, e, echelle);
                    break;
                default:
                    break;
            }
        }
        canvas.restoreToCount(sauvegarde);
    }
}
