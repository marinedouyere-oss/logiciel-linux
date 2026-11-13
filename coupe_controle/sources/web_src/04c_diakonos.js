// ---- Fichier de contrôle Diakonos ----
// « diakonos46t1.xlsx » : semaine 46, 1er tour. Les pièces commandées, une
// ligne par commande + ligne ; chacune doit se trouver dans un lancement de
// la même semaine et du même tour (STRAT, Feno, recyclage, chantiers…).
const POSTES_DIAKONOS = ["Diakonos 1er tour", "Diakonos 2ème tour"];
const MOTIF_NOM_DIAKONOS = /DIAKONOS\D*?(\d{1,4})(?:\D*?T(?:OUR)?\D{0,3}?0?([12])(?!\d))?/i;

const estFichierDiakonos = (nom) => /DIAKONOS/i.test(nom || "");

// « diakonos46t1.xlsx » → { semaine: "46", tour: "1" } ; null si le nom ne parle pas de Diakonos.
function decoderNomDiakonos(nom) {
  if (!estFichierDiakonos(nom)) return null;
  const m = MOTIF_NOM_DIAKONOS.exec(nom);
  if (!m) return { semaine: null, tour: null };
  // « diakonos2646t1 » : année + semaine.
  return { semaine: m[1].slice(-2).padStart(2, "0"), tour: m[2] || null };
}

// « LAN264601 » → ["46", "1"], « LAN2646TRIGANO » → ["46", null] ; null sans semaine.
function semaineEtTourDuLancement(code) {
  for (const c of String(code || "").match(/\d+/g) || []) {
    if (c.length >= 6) return [c.slice(2, 4), String(parseInt(c.slice(4, 6), 10))];
    if (c.length === 4) return [c.slice(2, 4), null];
  }
  return null;
}

const libelleTourDiakonos = (tour) => (tour === "2" ? "2ème tour" : "1er tour");
const tourDiakonos = (p) => (p.poste === POSTES_DIAKONOS[1] ? "2" : "1");

function lireDiakonos(workbook) {
  const normaliser = (v) =>
    String(v ?? "")
      .trim()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
  const dimension = (v) => (v === null || v === undefined ? null : toFloatOrNull(typeof v === "number" ? v : String(v).replace(/\s/g, "")));
  for (const feuille of workbook.worksheets) {
    const col = {};
    feuille.getRow(1).eachCell({ includeEmpty: false }, (cell, n) => {
      const nom = normaliser(cellValue(cell));
      if (!(nom in col)) col[nom] = n;
    });
    if (!col.commande || !col.ligne) continue;
    const colLongueur = col.longueur || col.longeur;
    const colColoris = col["code coloris"] || col.coloris;
    const pieces = new Map();
    for (let r = 2; r <= (feuille.rowCount || 0); r++) {
      const ligne = feuille.getRow(r);
      const valeur = (c) => (c ? cellValue(ligne.getCell(c)) : null);
      const texte = (c) => {
        const v = valeur(c);
        return v === null || v === undefined ? "" : String(v).trim();
      };
      const commande = texte(col.commande);
      const numero = valeur(col.ligne);
      if (!commande || numero === null || numero === undefined || numero === "") continue;
      const cle = cleLigne(commande, numero);
      if (pieces.has(cle)) continue;
      pieces.set(cle, {
        cle,
        commande,
        ligne: fmtLigne(numero),
        catalogue: texte(col.catalogue),
        article: texte(col.article),
        designation: texte(col.designation),
        longueur: dimension(valeur(colLongueur)),
        largeur: dimension(valeur(col.largeur)),
        epaisseur: dimension(valeur(col.epaisseur)),
        coloris: texte(colColoris),
      });
    }
    return [...pieces.values()];
  }
  throw new Error("Aucune feuille du fichier Diakonos ne contient les colonnes « Commande » et « Ligne ».");
}

const dimensionsDiakonos = (m) => (m.longueur === null || m.largeur === null ? "" : `${fmtDim(m.longueur)} × ${fmtDim(m.largeur)}`);
