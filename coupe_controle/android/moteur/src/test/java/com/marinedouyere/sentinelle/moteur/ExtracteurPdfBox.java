package com.marinedouyere.sentinelle.moteur;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** Extraction du texte d'un PDF sur ordinateur (même logique que la version Android). */
final class ExtracteurPdfBox implements LecteurCoupePdf.ExtracteurTexte {

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
