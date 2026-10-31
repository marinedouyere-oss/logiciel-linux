package com.marinedouyere.sentinelle.moteur;

import java.util.HashMap;
import java.util.Map;

/** Une feuille de classeur : valeurs des cellules, lignes et colonnes numérotées à partir de 1. */
public final class Feuille {

    public final String nom;
    private final Map<Integer, Map<Integer, Object>> lignes = new HashMap<>();
    private int nbLignes;
    private int nbColonnes;

    Feuille(String nom) {
        this.nom = nom;
    }

    void declarerLigne(int ligne) {
        if (ligne > nbLignes) nbLignes = ligne;
    }

    void declarerColonne(int colonne) {
        if (colonne > nbColonnes) nbColonnes = colonne;
    }

    void poser(int ligne, int colonne, Object valeur) {
        declarerLigne(ligne);
        declarerColonne(colonne);
        Map<Integer, Object> cellules = lignes.get(ligne);
        if (cellules == null) {
            cellules = new HashMap<>();
            lignes.put(ligne, cellules);
        }
        cellules.put(colonne, valeur);
    }

    /** Numéro de la dernière ligne présente (équivalent de rowCount d'ExcelJS). */
    public int nbLignes() {
        return nbLignes;
    }

    /** Numéro de la dernière colonne présente (équivalent de columnCount d'ExcelJS). */
    public int nbColonnes() {
        return nbColonnes;
    }

    /** Valeur d'une cellule (String, Double ou Boolean), null si vide. */
    public Object valeur(int ligne, int colonne) {
        Map<Integer, Object> cellules = lignes.get(ligne);
        return cellules == null ? null : cellules.get(colonne);
    }

    /** Vrai si la ligne n'a aucune cellule renseignée (actualCellCount === 0). */
    public boolean ligneVide(int ligne) {
        Map<Integer, Object> cellules = lignes.get(ligne);
        return cellules == null || cellules.isEmpty();
    }

    /** Colonnes renseignées d'une ligne (numéro de colonne -> valeur). */
    public Map<Integer, Object> cellulesDeLaLigne(int ligne) {
        Map<Integer, Object> cellules = lignes.get(ligne);
        return cellules == null ? new HashMap<Integer, Object>() : cellules;
    }
}
