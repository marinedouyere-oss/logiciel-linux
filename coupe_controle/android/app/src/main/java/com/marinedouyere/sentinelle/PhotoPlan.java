package com.marinedouyere.sentinelle;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;

/**
 * V6.8 : la photo du plan d'un claustra, prête à partir au PC : remise à l'endroit (sens de la prise de vue), réduite
 * à 2400 pixels au plus sur le grand côté (les cotes restent lisibles, le paquet reste léger), en JPEG.
 */
final class PhotoPlan {

    static final int COTE_MAX = 2400;
    static final int QUALITE = 85;

    private PhotoPlan() {}

    /** Les octets JPEG de la photo préparée ; IOException si ce n'est pas une image lisible. */
    static byte[] preparer(File source) throws IOException {
        BitmapFactory.Options taille = new BitmapFactory.Options();
        taille.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(source.getPath(), taille);
        if (taille.outWidth <= 0 || taille.outHeight <= 0) throw new IOException("ce n'est pas une photo lisible");
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inSampleSize = echantillon(taille.outWidth, taille.outHeight);
        Bitmap b = BitmapFactory.decodeFile(source.getPath(), o);
        if (b == null) throw new IOException("photo illisible");
        Matrix m = new Matrix();
        float echelle = Math.min(1f, COTE_MAX / (float) Math.max(b.getWidth(), b.getHeight()));
        if (echelle < 1f) m.postScale(echelle, echelle);
        int angle = angleExif(source);
        if (angle != 0) m.postRotate(angle);
        Bitmap finale = m.isIdentity() ? b : Bitmap.createBitmap(b, 0, 0, b.getWidth(), b.getHeight(), m, true);
        ByteArrayOutputStream sortie = new ByteArrayOutputStream();
        if (!finale.compress(Bitmap.CompressFormat.JPEG, QUALITE, sortie)) throw new IOException("photo impossible à enregistrer");
        if (finale != b) finale.recycle();
        b.recycle();
        return sortie.toByteArray();
    }

    /** Sous-échantillonnage (puissance de 2) pour ne pas charger une photo de 50 Mpx en mémoire. */
    static int echantillon(int largeur, int hauteur) {
        int s = 1;
        while (Math.max(largeur, hauteur) / (s * 2) >= COTE_MAX) s *= 2;
        return s;
    }

    /** L'angle à appliquer d'après l'EXIF (0 si rien). */
    static int angleExif(File f) {
        try {
            int o = new ExifInterface(f.getPath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            if (o == ExifInterface.ORIENTATION_ROTATE_90) return 90;
            if (o == ExifInterface.ORIENTATION_ROTATE_180) return 180;
            if (o == ExifInterface.ORIENTATION_ROTATE_270) return 270;
        } catch (IOException e) {
            // pas d'EXIF : telle quelle
        }
        return 0;
    }

    /** « 26100433 », « cvc26100433 », « CVC 2610 0433 » → « CVC26100433 » ; null si ce n'est pas un n° de commande. */
    static String commande(String saisie) {
        if (saisie == null) return null;
        String t = saisie.trim().toUpperCase(java.util.Locale.ROOT).replaceAll("\\s+", "");
        if (t.matches("\\d{8}")) t = "CVC" + t;
        return t.matches("CVC\\d{8}") ? t : null;
    }
}
