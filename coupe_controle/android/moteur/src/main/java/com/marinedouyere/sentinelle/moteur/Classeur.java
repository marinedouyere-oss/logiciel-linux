package com.marinedouyere.sentinelle.moteur;

import org.xml.sax.Attributes;
import org.xml.sax.InputSource;
import org.xml.sax.helpers.DefaultHandler;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import javax.xml.parsers.SAXParser;
import javax.xml.parsers.SAXParserFactory;

/**
 * Lecteur minimal de classeur Excel (.xlsx / .xlsm) : un .xlsx est une
 * archive ZIP de fichiers XML. Ne lit que les valeurs des cellules (texte,
 * nombre, booléen, résultat de formule), comme l'appli web via ExcelJS.
 */
public final class Classeur {

    public final List<Feuille> feuilles;

    private Classeur(List<Feuille> feuilles) {
        this.feuilles = feuilles;
    }

    public static Classeur lire(byte[] octets) throws IOException {
        Map<String, byte[]> parties = new HashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(octets))) {
            ZipEntry entree;
            while ((entree = zip.getNextEntry()) != null) {
                if (entree.isDirectory()) continue;
                String nom = entree.getName().replace('\\', '/');
                if (nom.startsWith("/")) nom = nom.substring(1);
                if (nom.endsWith(".xml") || nom.endsWith(".rels")) parties.put(nom, lireTout(zip));
            }
        } catch (IllegalArgumentException e) {
            throw new IOException("Le fichier n'est pas un classeur Excel lisible.", e);
        }
        byte[] workbook = parties.get("xl/workbook.xml");
        if (workbook == null) throw new IOException("Le fichier n'est pas un classeur Excel (.xlsx) : workbook.xml introuvable.");

        List<String> partages = new ArrayList<>();
        byte[] sharedStrings = parties.get("xl/sharedStrings.xml");
        if (sharedStrings != null) analyser(sharedStrings, new LecteurTextesPartages(partages));

        LecteurClasseur lecteurClasseur = new LecteurClasseur();
        analyser(workbook, lecteurClasseur);
        Map<String, String> cibles = new HashMap<>();
        byte[] rels = parties.get("xl/_rels/workbook.xml.rels");
        if (rels != null) analyser(rels, new LecteurRelations(cibles));

        List<Feuille> feuilles = new ArrayList<>();
        for (String[] feuille : lecteurClasseur.feuilles) {
            String cible = cibles.get(feuille[1]);
            if (cible == null) continue;
            String chemin = cible.startsWith("/") ? cible.substring(1) : "xl/" + cible;
            byte[] xml = parties.get(normaliserChemin(chemin));
            if (xml == null) continue;
            LecteurFeuille lecteur = new LecteurFeuille(feuille[0], partages);
            analyser(xml, lecteur);
            feuilles.add(lecteur.feuille);
        }
        return new Classeur(feuilles);
    }

    private static String normaliserChemin(String chemin) {
        List<String> morceaux = new ArrayList<>();
        for (String m : chemin.split("/")) {
            if (m.isEmpty() || m.equals(".")) continue;
            if (m.equals("..")) {
                if (!morceaux.isEmpty()) morceaux.remove(morceaux.size() - 1);
            } else {
                morceaux.add(m);
            }
        }
        return String.join("/", morceaux);
    }

    private static byte[] lireTout(InputStream flux) throws IOException {
        ByteArrayOutputStream tampon = new ByteArrayOutputStream();
        byte[] bloc = new byte[16 * 1024];
        int lu;
        while ((lu = flux.read(bloc)) != -1) tampon.write(bloc, 0, lu);
        return tampon.toByteArray();
    }

    private static void analyser(byte[] xml, DefaultHandler lecteur) throws IOException {
        try {
            SAXParserFactory fabrique = SAXParserFactory.newInstance();
            fabrique.setNamespaceAware(false);
            SAXParser parseur = fabrique.newSAXParser();
            InputSource source = new InputSource(new ByteArrayInputStream(xml));
            source.setEncoding(StandardCharsets.UTF_8.name());
            parseur.parse(source, lecteur);
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException("Classeur Excel illisible : " + e.getMessage(), e);
        }
    }

    /** Nom de balise sans préfixe d'espace de noms ("x:c" -> "c"). */
    static String local(String qName) {
        int i = qName.indexOf(':');
        return i < 0 ? qName : qName.substring(i + 1);
    }

    private static final class LecteurTextesPartages extends DefaultHandler {
        private final List<String> textes;
        private StringBuilder courant;
        private boolean dansT;
        private int profondeurPhonetique;

        LecteurTextesPartages(List<String> textes) {
            this.textes = textes;
        }

        @Override
        public void startElement(String uri, String localName, String qName, Attributes a) {
            String n = local(qName);
            if (n.equals("si")) courant = new StringBuilder();
            else if (n.equals("rPh")) profondeurPhonetique++;
            else if (n.equals("t") && profondeurPhonetique == 0) dansT = true;
        }

        @Override
        public void endElement(String uri, String localName, String qName) {
            String n = local(qName);
            if (n.equals("si")) {
                textes.add(courant.toString());
                courant = null;
            } else if (n.equals("rPh")) {
                profondeurPhonetique--;
            } else if (n.equals("t")) {
                dansT = false;
            }
        }

        @Override
        public void characters(char[] ch, int debut, int longueur) {
            if (dansT && courant != null) courant.append(ch, debut, longueur);
        }
    }

    private static final class LecteurClasseur extends DefaultHandler {
        final List<String[]> feuilles = new ArrayList<>(); // {nom, r:id}

        @Override
        public void startElement(String uri, String localName, String qName, Attributes a) {
            if (!local(qName).equals("sheet")) return;
            String id = null;
            for (int i = 0; i < a.getLength(); i++) {
                if (local(a.getQName(i)).equals("id") && a.getQName(i).contains(":")) id = a.getValue(i);
            }
            if (id == null) id = a.getValue("r:id");
            feuilles.add(new String[] {a.getValue("name"), id});
        }
    }

    private static final class LecteurRelations extends DefaultHandler {
        private final Map<String, String> cibles;

        LecteurRelations(Map<String, String> cibles) {
            this.cibles = cibles;
        }

        @Override
        public void startElement(String uri, String localName, String qName, Attributes a) {
            if (local(qName).equals("Relationship")) cibles.put(a.getValue("Id"), a.getValue("Target"));
        }
    }

    private static final class LecteurFeuille extends DefaultHandler {
        final Feuille feuille;
        private final List<String> partages;
        private int ligneCourante;
        private int colonneSuivante;
        private int colonneCellule;
        private String typeCellule;
        private StringBuilder valeur;
        private StringBuilder texteEnLigne;
        private boolean dansV;
        private boolean dansT;
        private boolean aFormule;

        LecteurFeuille(String nom, List<String> partages) {
            this.feuille = new Feuille(nom);
            this.partages = partages;
        }

        @Override
        public void startElement(String uri, String localName, String qName, Attributes a) {
            switch (local(qName)) {
                case "row": {
                    String r = a.getValue("r");
                    ligneCourante = r != null ? Integer.parseInt(r) : ligneCourante + 1;
                    colonneSuivante = 1;
                    feuille.declarerLigne(ligneCourante);
                    break;
                }
                case "c": {
                    String ref = a.getValue("r");
                    colonneCellule = ref != null ? colonneDepuisReference(ref) : colonneSuivante;
                    colonneSuivante = colonneCellule + 1;
                    typeCellule = a.getValue("t");
                    valeur = null;
                    texteEnLigne = null;
                    aFormule = false;
                    feuille.declarerColonne(colonneCellule);
                    break;
                }
                case "v":
                    dansV = true;
                    valeur = new StringBuilder();
                    break;
                case "f":
                    aFormule = true;
                    break;
                case "is":
                    texteEnLigne = new StringBuilder();
                    break;
                case "t":
                    if (texteEnLigne != null) dansT = true;
                    break;
                default:
                    break;
            }
        }

        @Override
        public void endElement(String uri, String localName, String qName) {
            switch (local(qName)) {
                case "v":
                    dansV = false;
                    break;
                case "t":
                    dansT = false;
                    break;
                case "c":
                    Object v = interpreter();
                    if (v != null) feuille.poser(ligneCourante, colonneCellule, v);
                    break;
                default:
                    break;
            }
        }

        @Override
        public void characters(char[] ch, int debut, int longueur) {
            if (dansV && valeur != null) valeur.append(ch, debut, longueur);
            else if (dansT && texteEnLigne != null) texteEnLigne.append(ch, debut, longueur);
        }

        private Object interpreter() {
            String t = typeCellule == null ? "n" : typeCellule;
            if (t.equals("inlineStr")) return texteEnLigne != null ? texteEnLigne.toString() : null;
            if (valeur == null) return null;
            String brut = valeur.toString();
            switch (t) {
                case "s": {
                    int index = Integer.parseInt(brut.trim());
                    return index >= 0 && index < partages.size() ? partages.get(index) : null;
                }
                case "str":
                case "e":
                    return brut;
                case "b":
                    return brut.trim().equals("1");
                default:
                    if (brut.isEmpty()) return null;
                    try {
                        return Double.parseDouble(brut);
                    } catch (NumberFormatException e) {
                        return aFormule ? brut : null;
                    }
            }
        }

        private static int colonneDepuisReference(String ref) {
            int col = 0;
            for (int i = 0; i < ref.length(); i++) {
                char c = ref.charAt(i);
                if (c >= 'A' && c <= 'Z') col = col * 26 + (c - 'A' + 1);
                else if (c >= 'a' && c <= 'z') col = col * 26 + (c - 'a' + 1);
                else break;
            }
            return col;
        }
    }
}
