package com.marinedouyere.sentinelle;

import android.content.Context;

import com.marinedouyere.sentinelle.moteur.LecteurCoupePdf;
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.text.PDFTextStripper;
import com.tom_roush.pdfbox.text.TextPosition;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** Extraction du texte positionné d'un PDF avec PDFBox Android (même logique que les tests sur ordinateur). */
final class ExtracteurPdfAndroid implements LecteurCoupePdf.ExtracteurTexte {

    private static boolean initialise;

    ExtracteurPdfAndroid(Context context) {
        synchronized (ExtracteurPdfAndroid.class) {
            if (!initialise) {
                PDFBoxResourceLoader.init(context.getApplicationContext());
                initialise = true;
            }
        }
    }

    @Override
    public List<List<LecteurCoupePdf.ElementTexte>> elementsParPage(byte[] pdf) throws IOException {
        List<List<LecteurCoupePdf.ElementTexte>> pages = new ArrayList<>();
        try (PDDocument document = PDDocument.load(pdf)) {
            for (int n = 1; n <= document.getNumberOfPages(); n++) {
                final List<LecteurCoupePdf.ElementTexte> elements = new ArrayList<>();
                final float hauteur = document.getPage(n - 1).getMediaBox().getHeight();
                PDFTextStripper extracteur = new PDFTextStripper() {
                    @Override
                    protected void writeString(String texte, List<TextPosition> positions) {
                        if (positions.isEmpty()) return;
                        TextPosition premiere = positions.get(0);
                        elements.add(new LecteurCoupePdf.ElementTexte(
                                premiere.getXDirAdj(), hauteur - premiere.getYDirAdj(), texte));
                    }
                };
                extracteur.setSortByPosition(true);
                extracteur.setStartPage(n);
                extracteur.setEndPage(n);
                extracteur.getText(document);
                pages.add(elements);
            }
        }
        return pages;
    }
}
