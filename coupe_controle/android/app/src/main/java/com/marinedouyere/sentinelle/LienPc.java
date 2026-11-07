package com.marinedouyere.sentinelle;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Locale;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Lien avec Sentinelle sur le PC, sans Drive : le PC chiffre le fichier partagé (AES-GCM, clé tirée du code de
 * liaison par PBKDF2-HMAC-SHA256) et l'envoie sur le mini-site de Sentinelle ; l'appli le récupère avec le même code
 * et le déchiffre. Le site ne garde qu'un fichier illisible ; le code ne quitte jamais le téléphone.
 */
final class LienPc {

    static final String ADRESSE = "https://sentinelle-laisne-0ysi8zpn.netlify.app";
    private static final String SEL = "sentinelle-laisne-industrie";
    private static final int ITERATIONS = 150000;

    private LienPc() {}

    /** Le code tel que tapé (« abcd efgh-… ») → « ABCDEFGH… ». */
    static String normaliser(String code) {
        return code == null ? "" : code.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
    }

    static boolean codeValide(String code) {
        return normaliser(code).length() == 16;
    }

    static final String PREFIXE_QR = "SENTINELLE:";

    /** Le code lu dans le QR code du PC (« SENTINELLE:ABCD-EFGH-JKLM-NPQR »), ou null si ce n'est pas celui de Sentinelle. */
    static String codeDuQr(String texte) {
        if (texte == null) return null;
        String t = texte.trim();
        if (!t.toUpperCase(Locale.ROOT).startsWith(PREFIXE_QR)) return null;
        String n = normaliser(t.substring(PREFIXE_QR.length()));
        return n.length() == 16 && n.matches("[A-HJ-NP-Z2-9]{16}") ? formater(n) : null;
    }

    /** « ABCD-EFGH-JKLM-NPQR ». */
    static String formater(String code) {
        String n = normaliser(code);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n.length(); i++) {
            if (i > 0 && i % 4 == 0) sb.append('-');
            sb.append(n.charAt(i));
        }
        return sb.toString();
    }

    private static String hex(byte[] octets) {
        StringBuilder sb = new StringBuilder();
        for (byte b : octets) sb.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return sb.toString();
    }

    /** Où est le fichier sur le site (tiré du code, comme sur le PC). */
    static String canal(String code) throws GeneralSecurityException {
        byte[] e = MessageDigest.getInstance("SHA-256").digest(("sentinelle-canal:" + normaliser(code)).getBytes(StandardCharsets.UTF_8));
        return hex(e).substring(0, 32);
    }

    /** PBKDF2-HMAC-SHA256, un bloc de 32 octets (clé AES-256), comme le PC (WebCrypto). */
    static byte[] cle(String code) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(normaliser(code).getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        mac.update(SEL.getBytes(StandardCharsets.UTF_8));
        mac.update(new byte[] {0, 0, 0, 1});
        byte[] u = mac.doFinal();
        byte[] t = u.clone();
        for (int i = 1; i < ITERATIONS; i++) {
            u = mac.doFinal(u);
            for (int k = 0; k < t.length; k++) t[k] ^= u[k];
        }
        return t;
    }

    /** Code faux (le fichier ne se déchiffre pas). */
    static final class CodeFaux extends IOException {
        CodeFaux() {
            super("le code ne correspond pas au fichier du PC");
        }
    }

    /** « SNT1 » + vecteur (12 octets) + données chiffrées → le fichier partagé (gzip). */
    static byte[] dechiffrer(byte[] paquet, byte[] cle) throws IOException {
        if (paquet.length < 32 || paquet[0] != 'S' || paquet[1] != 'N' || paquet[2] != 'T' || paquet[3] != '1') throw new IOException("fichier du site inconnu");
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(cle, "AES"), new GCMParameterSpec(128, paquet, 4, 12));
            return c.doFinal(paquet, 16, paquet.length - 16);
        } catch (javax.crypto.AEADBadTagException e) {
            throw new CodeFaux();
        } catch (GeneralSecurityException e) {
            throw new IOException("déchiffrement impossible : " + e.getMessage(), e);
        }
    }

    /** Rien sur le site pour ce code (le PC n'a encore rien envoyé, ou le code est faux). */
    static final class RienPourCeCode extends IOException {
        RienPourCeCode() {
            super("rien sur le site pour ce code");
        }
    }

    static final class Recu {
        byte[] paquet;
        String version;
        String genere;
    }

    private static byte[] lire(String adresse, int max) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(adresse).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(60000);
        c.setUseCaches(false);
        try {
            int statut = c.getResponseCode();
            if (statut == 404) throw new RienPourCeCode();
            if (statut != 200) throw new IOException("le site a répondu " + statut);
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream sortie = new ByteArrayOutputStream();
                byte[] tampon = new byte[65536];
                for (int n; (n = in.read(tampon)) > 0; ) {
                    sortie.write(tampon, 0, n);
                    if (sortie.size() > max) throw new IOException("réponse trop grosse");
                }
                return sortie.toByteArray();
            }
        } finally {
            c.disconnect();
        }
    }

    /** Le manifeste, puis chaque partie, mises bout à bout (paquet encore chiffré). */
    static Recu telecharger(String code) throws IOException, GeneralSecurityException {
        String api = ADRESSE + "/api/partage?canal=" + canal(code);
        JSONObject m;
        try {
            m = new JSONObject(new String(lire(api, 1 << 16), StandardCharsets.UTF_8));
        } catch (JSONException e) {
            throw new IOException("réponse du site illisible", e);
        }
        String version = m.optString("version", "");
        int parties = m.optInt("parties", 0);
        if (!version.matches("[a-z0-9]{6,40}") || parties < 1 || parties > 60) throw new IOException("manifeste du site invalide");
        ByteArrayOutputStream tout = new ByteArrayOutputStream();
        for (int i = 0; i < parties; i++) tout.write(lire(api + "&version=" + version + "&partie=" + i, 6 * 1024 * 1024));
        Recu r = new Recu();
        r.paquet = tout.toByteArray();
        r.version = version;
        r.genere = m.optString("genere", "");
        return r;
    }
}
