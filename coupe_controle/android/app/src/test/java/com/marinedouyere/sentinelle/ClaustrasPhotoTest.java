package com.marinedouyere.sentinelle;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.shadows.ShadowLooper;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.GZIPInputStream;

/** V6.8 : le plan d'un claustra pris en photo sur le téléphone, envoyé au PC (canal retour). */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, qualifiers = "w411dp-h891dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class ClaustrasPhotoTest {

    private static final String PARTAGE = "{\"format\":\"sentinelle-partage-1\",\"genere\":\"2026-11-12T20:00:00.000Z\",\"semaines\":[],"
            + "\"claustras\":[{\"commande\":\"CVC99001234\",\"reference\":\"ESSAI-CLAUSTRA\",\"client\":\"ESSA35TEST\",\"semaine\":\"48\",\"annee\":\"2026\","
            + "\"lignes\":1,\"plusieursLargeurs\":true,\"photos\":0},"
            + "{\"commande\":\"CVC99005678\",\"reference\":\"\",\"client\":\"\",\"semaine\":\"49\",\"annee\":\"2026\",\"lignes\":2,\"plusieursLargeurs\":false,\"photos\":1}]}";

    private static void textes(View v, StringBuilder sb) {
        if (v instanceof TextView) sb.append(((TextView) v).getText()).append('\n');
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) textes(g.getChildAt(i), sb);
        }
    }

    private static String ecran(MainActivity a) {
        StringBuilder sb = new StringBuilder();
        textes(a.getWindow().getDecorView(), sb);
        return sb.toString();
    }

    /** Capture de l'écran entier (défilé compris) si SENTINELLE_CAPTURES est donné. */
    private static void capturerSiDemande(MainActivity a, String nom) throws Exception {
        String captures = System.getProperty("sentinelle.captures", "");
        if (captures.isEmpty()) return;
        View racine = a.getWindow().getDecorView();
        android.widget.ScrollView sv = null;
        java.util.ArrayDeque<View> pile = new java.util.ArrayDeque<>();
        pile.push(racine);
        while (!pile.isEmpty() && sv == null) {
            View v = pile.pop();
            if (v instanceof android.widget.ScrollView) sv = (android.widget.ScrollView) v;
            else if (v instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) v).getChildCount(); i++) pile.push(((ViewGroup) v).getChildAt(i));
        }
        View contenu = sv != null ? sv.getChildAt(0) : racine;
        contenu.measure(View.MeasureSpec.makeMeasureSpec(racine.getWidth(), View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
        contenu.layout(0, 0, contenu.getMeasuredWidth(), contenu.getMeasuredHeight());
        Bitmap b = Bitmap.createBitmap(contenu.getMeasuredWidth(), contenu.getMeasuredHeight(), Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        c.drawColor(0xFFF8F1EE);
        contenu.draw(c);
        File d = new File(captures);
        d.mkdirs();
        try (FileOutputStream o = new FileOutputStream(new File(d, nom))) {
            b.compress(Bitmap.CompressFormat.PNG, 100, o);
        }
    }

    private static byte[] jpeg(int l, int h) {
        Bitmap b = Bitmap.createBitmap(l, h, Bitmap.Config.ARGB_8888);
        new Canvas(b).drawColor(Color.WHITE);
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.JPEG, 90, o);
        return o.toByteArray();
    }

    @Test
    public void listeDesClaustrasDuPc() throws Exception {
        FichierPartage f = FichierPartage.lire(new ByteArrayInputStream(PARTAGE.getBytes(StandardCharsets.UTF_8)));
        assertEquals(2, f.claustras.size());
        FichierPartage.ClaustraCmd c = f.claustras.get(0);
        assertEquals("CVC99001234", c.commande);
        assertEquals("ESSAI-CLAUSTRA", c.reference);
        assertEquals("48", c.semaine);
        assertTrue(c.plusieursLargeurs);
        assertEquals(0, c.photos);
        assertEquals(1, f.claustras.get(1).photos);
    }

    @Test
    public void numeroDeCommande() {
        assertEquals("CVC26100433", PhotoPlan.commande("26100433"));
        assertEquals("CVC26100433", PhotoPlan.commande(" cvc 2610 0433 "));
        assertNull(PhotoPlan.commande("CVC1"));
        assertNull(PhotoPlan.commande(""));
        assertEquals(2, PhotoPlan.echantillon(6000, 4000));
        assertEquals(1, PhotoPlan.echantillon(2000, 1000));
    }

    @Test
    public void photoReduiteEnJpeg() throws Exception {
        File source = File.createTempFile("plan", ".jpg");
        try (FileOutputStream o = new FileOutputStream(source)) {
            o.write(jpeg(3600, 2400));
        }
        byte[] pret = PhotoPlan.preparer(source);
        assertEquals(0xFF, pret[0] & 0xFF);
        assertEquals(0xD8, pret[1] & 0xFF);
        Bitmap b = BitmapFactory.decodeByteArray(pret, 0, pret.length);
        assertEquals(2400, b.getWidth());
        assertEquals(1600, b.getHeight());
        File rien = File.createTempFile("plan", ".jpg");
        try {
            PhotoPlan.preparer(rien);
            throw new AssertionError("un fichier vide n'est pas une photo");
        } catch (java.io.IOException attendu) {
            // ok
        }
    }

    @Test
    public void photoEnvoyeeAuPcPuisEffacee() throws Exception {
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().get();
        DemandesPc d = new DemandesPc(a);
        byte[] octets = jpeg(40, 30);
        File f = new File(d.dossierPhotos(), "plan_essai.jpg");
        try (FileOutputStream o = new FileOutputStream(f)) {
            o.write(octets);
        }
        JSONObject x = new JSONObject();
        x.put("type", "photoClaustra");
        x.put("commande", "CVC99001234");
        x.put("titre", "Photo du plan CVC99001234");
        x.put("fichierPhoto", "plan_essai.jpg");
        JSONObject ajoutee = d.ajouter(x);
        assertEquals(1, d.photosEnAttente().size());
        // Deux photos d'un même plan : deux demandes (pas de remplacement).
        JSONObject y = new JSONObject(x.toString());
        y.put("fichierPhoto", "absente.jpg");
        d.ajouter(y);
        assertEquals(2, d.photosEnAttente().size());

        // Le paquet pour le PC : la photo en base64, pas le nom du fichier local ; la photo disparue n'est pas envoyée.
        byte[] contenu = d.contenu(null);
        GZIPInputStream z = new GZIPInputStream(new ByteArrayInputStream(contenu));
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] t = new byte[8192];
        for (int n; (n = z.read(t)) > 0; ) b.write(t, 0, n);
        JSONArray demandes = new JSONObject(new String(b.toByteArray(), StandardCharsets.UTF_8)).getJSONArray("demandes");
        assertEquals(1, demandes.length());
        JSONObject envoyee = demandes.getJSONObject(0);
        assertEquals("photoClaustra", envoyee.getString("type"));
        assertEquals("CVC99001234", envoyee.getString("commande"));
        assertFalse(envoyee.has("fichierPhoto"));
        assertEquals(android.util.Base64.encodeToString(octets, android.util.Base64.NO_WRAP), envoyee.getString("image"));

        // Le PC répond : la demande sort de la file, la photo locale est effacée.
        Map<String, String[]> rep = new HashMap<>();
        rep.put(ajoutee.getString("id"), new String[] {"true", "Photo du plan reçue pour CVC99001234 (Claustras)", "2026-11-12T20:10:00Z"});
        assertEquals(1, d.reponses(rep));
        assertFalse(f.exists());
        assertEquals(1, d.photosEnAttente().size());
        assertEquals(1, d.resultatsPhotos().size());
        assertTrue(d.resultatsPhotos().get(0).optBoolean("ok"));
    }

    @Test
    public void ecranClaustrasEtPhotoMiseEnFile() throws Exception {
        MainActivity a = Robolectric.buildActivity(MainActivity.class).setup().visible().get();
        ShadowLooper.idleMainLooper();
        a.getSharedPreferences("sentinelle_partage", android.content.Context.MODE_PRIVATE).edit().putString("code_lien", "TEST-TEST-TEST-TEST").commit();
        FichierPartage f = FichierPartage.lire(new ByteArrayInputStream(PARTAGE.getBytes(StandardCharsets.UTF_8)));
        a.partage().afficherDonnees(f, "essai");
        a.allerA(MainActivity.ONGLET_CLAUSTRAS);
        ShadowLooper.idleMainLooper();
        String texte = ecran(a);
        assertTrue(texte, texte.contains("Claustras : photo du plan"));
        assertTrue(texte, texte.contains("CVC99001234 · ESSAI-CLAUSTRA"));
        assertTrue(texte, texte.contains("Semaine 48 2026 · ESSA35TEST · 1 claustra"));
        assertTrue(texte, texte.contains("Plusieurs largeurs de lames : photo du plan nécessaire"));
        assertTrue(texte, texte.contains("1 photo sur le PC"));
        assertTrue(texte, texte.contains("Photo du plan"));
        assertTrue(texte, texte.contains("Choisir une photo"));
        assertTrue(texte, texte.contains("Autre commande"));
        capturerSiDemande(a, "appli_claustras.png");

        // Une photo prise : préparée, gardée, mise en file pour le PC.
        File prise = File.createTempFile("prise", ".jpg");
        try (FileOutputStream o = new FileOutputStream(prise)) {
            o.write(jpeg(1200, 900));
        }
        a.partage().photoDuPlan("CVC99001234", prise);
        ((SentinelleApp) a.getApplication()).annexe.submit(() -> null).get();
        ShadowLooper.idleMainLooper();
        assertEquals(1, a.partage().demandes().photosEnAttente().size());
        assertEquals("CVC99001234", a.partage().demandes().photosEnAttente().get(0).getString("commande"));
        assertFalse(prise.exists());
        texte = ecran(a);
        assertTrue(texte, texte.contains("Photos envoyées"));
        assertTrue(texte, texte.contains("Photo du plan CVC99001234"));
    }
}
