
"use strict";

/* ============================================================
 * Portage JS de coupe_controle (strat_reader.py, coupe_reader.py,
 * comparator.py, report_export.py). Même logique métier que la
 * version de bureau PySide6, pour fonctionner dans un navigateur
 * sans installer Python (usage hors-ligne, aucune donnée envoyée
 * à un serveur : tout se passe dans cette page). Gère jusqu'à 5
 * paires fichier de lancement / liste de coupe en une fois.
 * ============================================================ */

// ---- strat_reader ----
const COL_COMMANDE = "conf_commande";
const COL_LIGNE = "conf_ligne";
const COL_ARTICLE = "conf_article";
const COL_QTE = "comdet_qte";
const COL_LANCEMENT = "comprod_lancement";
const COL_CLE = "commande+ligne";
const COL_AGGLO = "agglo";
const COL_LIVSEM = "com_livsem";
const COL_LIVAN = "com_livan";
// Colonnes utilisées pour le schéma de pièce affiché dans la recherche :
// le fichier de lancement a ces informations avec de vrais en-têtes
// (contrairement à la liste de coupe PDF, où elles sont à extraire d'un
// texte numéroté), donc c'est la source privilégiée quand il est fourni.
const COL_ASSEMBLAGE = "info atelier assemblage";
const COL_DIMENSIONS_FINIES = "LongueurxLargeurxEpaisseur fini";
const REQUIRED_HEADERS = [COL_COMMANDE, COL_LIGNE, COL_ARTICLE, COL_QTE];
const MOTIF_DIMENSIONS_FINIES_STRAT = /([\d.,]+)\s*X\s*([\d.,]+)\s*X\s*([\d.,]+)/i;

// Panneau de protection : il accompagne une pièce sans en être une (ce
// n'est pas une pièce commandée par le client). Selon les fichiers il
// s'appelle « PROTECTION » ou « PROTECTION-PF » (le logiciel
// d'optimisation passe parfois de l'un à l'autre).
function estProtection(materiau) {
  if (materiau === null || materiau === undefined) return false;
  return String(materiau).trim().toUpperCase().startsWith("PROTECTION");
}

function cellValue(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (Object.prototype.hasOwnProperty.call(v, "result")) return v.result;
    if (Object.prototype.hasOwnProperty.call(v, "richText")) {
      return v.richText.map((rt) => rt.text).join("");
    }
    if (Object.prototype.hasOwnProperty.call(v, "text")) return v.text;
  }
  return v;
}

function toFloatOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

function cleLigne(commande, ligne) {
  const n = toFloatOrNull(ligne);
  if (n === null) return `${commande}${ligne === null || ligne === undefined ? "" : ligne}`;
  return `${commande}${String(Math.trunc(n)).padStart(3, "0")}`;
}

function fmtLigne(ligne) {
  if (ligne === null || ligne === undefined) return "";
  const n = toFloatOrNull(ligne);
  if (n === null) return String(ligne);
  return String(Math.trunc(n));
}

function trouverFeuilleEtEntetes(workbook) {
  for (const feuille of workbook.worksheets) {
    const ligneEntetes = feuille.getRow(1);
    const entetes = {};
    ligneEntetes.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const v = cellValue(cell);
      if (v !== null && v !== undefined) entetes[String(v).trim()] = colNumber;
    });
    if (REQUIRED_HEADERS.every((h) => h in entetes)) return { feuille, entetes };
  }
  throw new Error(
    "Aucune feuille du fichier de lancement ne contient les colonnes attendues " +
      `(${REQUIRED_HEADERS.join(", ")}).`
  );
}

// Un doublon, c'est deux lignes parfaitement identiques sur toute la donnée
// (commande, ligne, article, quantité, lancement, agglo, semaine de
// livraison...) dans le fichier de lancement (hors panneaux "PROTECTION",
// qui accompagnent normalement une pièce sans être un doublon) : ça peut
// signaler une pièce lancée deux fois par erreur dans l'ERP. Deux lignes qui
// partagent la même clé commande+ligne mais dont une autre donnée diffère
// (ex. une pièce nestée sur plusieurs lots) ne sont pas un doublon — voir
// lireStrat().
function lireStrat(workbook) {
  const { feuille, entetes } = trouverFeuilleEtEntetes(workbook);

  const idxCommande = entetes[COL_COMMANDE];
  const idxLigne = entetes[COL_LIGNE];
  const idxArticle = entetes[COL_ARTICLE];
  const idxQte = entetes[COL_QTE];
  const idxLancement = entetes[COL_LANCEMENT];
  const idxCle = entetes[COL_CLE];
  const idxAgglo = entetes[COL_AGGLO];
  const idxLivsem = entetes[COL_LIVSEM];
  const idxLivan = entetes[COL_LIVAN];
  const idxAssemblage = entetes[COL_ASSEMBLAGE];
  const idxDimFinies = entetes[COL_DIMENSIONS_FINIES];

  const qteParCle = new Map();
  const infosParCle = new Map();
  const lignesBrutesParCle = new Map(); // clé -> [{signature, article, qte}] (une entrée par ligne source, pour repérer les doublons)
  const donneesParCle = new Map(); // clé -> données de chacune de ses lignes (couleurs, couches d'une pièce assemblée)
  const comptePieceParSemaine = new Map(); // "annee-semaine" -> nb de pièces (pour repérer un mélange de semaines de livraison)
  const clesParSemaine = new Map(); // "annee-semaine" -> clés des pièces à livrer cette semaine-là

  const nbLignes = feuille.rowCount || 0;
  for (let r = 2; r <= nbLignes; r++) {
    const row = feuille.getRow(r);
    if (!row || row.actualCellCount === 0) continue;

    const commandeRaw = cellValue(row.getCell(idxCommande));
    if (commandeRaw === null || commandeRaw === undefined) continue;
    const commande = String(commandeRaw).trim();

    const agglo = idxAgglo ? cellValue(row.getCell(idxAgglo)) : null;
    if (estProtection(agglo)) continue;

    const numeroLigne = cellValue(row.getCell(idxLigne));
    const articleRaw = cellValue(row.getCell(idxArticle));
    const article = articleRaw === null || articleRaw === undefined ? "" : articleRaw;
    const qteRaw = cellValue(row.getCell(idxQte));
    const qte = qteRaw === null || qteRaw === undefined || qteRaw === "" ? 0 : qteRaw;
    const lancementRaw = idxLancement ? cellValue(row.getCell(idxLancement)) : null;
    const lancement = lancementRaw === null || lancementRaw === undefined || lancementRaw === "" ? "" : lancementRaw;

    let cle = idxCle ? cellValue(row.getCell(idxCle)) : null;
    cle = cle !== null && cle !== undefined && String(cle).trim() !== "" ? String(cle).trim() : cleLigne(commande, numeroLigne);

    const livsem = idxLivsem ? cellValue(row.getCell(idxLivsem)) : null;
    const livan = idxLivan ? cellValue(row.getCell(idxLivan)) : null;

    const assemblageRaw = idxAssemblage ? cellValue(row.getCell(idxAssemblage)) : null;
    const dimFiniesRaw = idxDimFinies ? cellValue(row.getCell(idxDimFinies)) : null;
    const dimFinies = dimFiniesRaw ? MOTIF_DIMENSIONS_FINIES_STRAT.exec(String(dimFiniesRaw)) : null;

    // Toutes les colonnes de la ligne, telles quelles (nom de colonne du
    // fichier -> valeur) : utilisé par l'onglet Recherche pour afficher
    // l'intégralité de la donnée du fichier de lancement, pas seulement
    // les quelques champs ci-dessous déjà utilisés pour le schéma.
    const toutesDonnees = {};
    for (const [nomColonne, idxColonne] of Object.entries(entetes)) {
      const v = cellValue(row.getCell(idxColonne));
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        toutesDonnees[nomColonne] = String(v).trim();
      }
    }

    const qteNum = toFloatOrNull(qte) ?? 0;
    qteParCle.set(cle, (qteParCle.get(cle) || 0) + qteNum);
    if (!donneesParCle.has(cle)) donneesParCle.set(cle, []);
    donneesParCle.get(cle).push(toutesDonnees);
    infosParCle.set(cle, {
      commande,
      ligne: fmtLigne(numeroLigne),
      article: String(article),
      lancement: String(lancement),
      assemblage: assemblageRaw !== null && assemblageRaw !== undefined && String(assemblageRaw).trim() !== "" ? String(assemblageRaw).trim() : null,
      longueurFinie: dimFinies ? toFloatOrNull(dimFinies[1]) : null,
      largeurFinie: dimFinies ? toFloatOrNull(dimFinies[2]) : null,
      epaisseurFinie: dimFinies ? toFloatOrNull(dimFinies[3]) : null,
      toutesDonnees,
      lignesBrutes: donneesParCle.get(cle),
    });
    // Signature = toute la donnée de la ligne : deux lignes ne sont un
    // doublon que si elles sont identiques sur chacun de ces champs, pas
    // seulement sur la clé commande+ligne (voir lireStrat()).
    const signature = JSON.stringify([
      commande,
      String(numeroLigne ?? ""),
      String(article),
      qteNum,
      String(lancement),
      agglo === null || agglo === undefined ? "" : String(agglo).trim(),
      livsem === null || livsem === undefined ? "" : String(livsem).trim(),
      livan === null || livan === undefined ? "" : String(livan).trim(),
    ]);
    if (!lignesBrutesParCle.has(cle)) lignesBrutesParCle.set(cle, []);
    lignesBrutesParCle.get(cle).push({ signature, article: String(article), qte: qteNum });

    if (livsem !== null && livsem !== undefined && String(livsem).trim() !== "") {
      const cleSemaine = `${livan ?? ""}-${livsem}`;
      comptePieceParSemaine.set(cleSemaine, (comptePieceParSemaine.get(cleSemaine) || 0) + 1);
      if (!clesParSemaine.has(cleSemaine)) clesParSemaine.set(cleSemaine, []);
      if (!clesParSemaine.get(cleSemaine).includes(cle)) clesParSemaine.get(cleSemaine).push(cle);
    }
  }

  // Pièce assemblée (ex. Feno : compact décor + support collés) : une ligne
  // par couche, toutes avec la même clé, mais une seule pièce finie. Par
  // matière (agglo), la somme des quantités ; la plus grande = les pièces.
  const resultat = [];
  for (const [cle, qte] of qteParCle) {
    const infos = infosParCle.get(cle);
    const parMatiere = new Map();
    for (const d of infos.lignesBrutes) {
      const matiere = d[COL_AGGLO] ? String(d[COL_AGGLO]).toUpperCase() : "";
      parMatiere.set(matiere, (parMatiere.get(matiere) || 0) + (toFloatOrNull(d[COL_QTE]) ?? 0));
    }
    const pieces = parMatiere.size === 0 ? qte : Math.max(...parMatiere.values());
    resultat.push({ cle, qte_attendue: qte, ...infos, pieces, couches: Math.max(1, parMatiere.size) });
  }

  const doublons = [];
  for (const [cle, occurrences] of lignesBrutesParCle) {
    if (occurrences.length <= 1) continue;
    const parSignature = new Map();
    for (const occ of occurrences) {
      if (!parSignature.has(occ.signature)) parSignature.set(occ.signature, []);
      parSignature.get(occ.signature).push(occ);
    }
    const infos = infosParCle.get(cle);
    for (const identiques of parSignature.values()) {
      if (identiques.length <= 1) continue;
      doublons.push({
        cle,
        commande: infos.commande,
        ligne: infos.ligne,
        nbLignes: identiques.length,
        articles: identiques.map((o) => o.article),
        quantites: identiques.map((o) => o.qte),
      });
    }
  }

  // Semaines de livraison distinctes trouvées (normalement une seule par
  // fichier de lancement) : plusieurs semaines différentes peuvent
  // signaler des pièces mélangées par erreur entre deux lancements.
  const semaines = [...comptePieceParSemaine.entries()]
    .map(([cleSemaine, nbPieces]) => {
      const [annee, semaine] = cleSemaine.split("-");
      return { annee, semaine, nbPieces, cles: clesParSemaine.get(cleSemaine) || [] };
    })
    .sort((a, b) => (a.annee + a.semaine).localeCompare(b.annee + b.semaine));

  return { lignes: resultat, doublons, semaines };
}

// ---- coupe_reader ----
const COLONNE_CLE_PAR_DEFAUT = 15; // colonne P (0-indexé)
const COLONNE_MATERIAU_PAR_DEFAUT = 1; // colonne B
const COLONNE_GRAIN_MATCHING_PAR_DEFAUT = 27; // colonne AB
const MOTIF_GRAIN_MATCHING = /^[A-Za-z]*\d+:\d+:\d+$/;

// Certains exports Cutrite ajoutent, pour une même clé commande+ligne,
// des lignes techniques en plus de la pièce réelle (talon/chute, bande de
// chant...). Elles sont repérables par un code du type "P1:TC:..." dans
// une colonne : la lettre après "T" vaut "C" (Coupe = la pièce) pour la
// vraie pièce, et autre chose (ex. "F", "B") pour les lignes techniques à
// exclure du comptage — sinon chaque pièce concernée est comptée deux fois.
// Groupe 1 : identifiant de trace (ex. "P1", "C389") — partagé par la
// pièce et sa ligne technique associée (talon/chute...), utile pour les
// apparier. Groupe 2 : lettre de type ("C" = pièce, "F"/"B" = technique).
const MOTIF_TYPE_TRACE = /^([A-Za-z0-9]+):T([A-Z]):/;
const TYPE_TRACE_PIECE = "C";

// Un modulo ou une bande (ex. "T9/1", "T58/1") n'est jamais une pièce : ce
// sont les panneaux (agglo/strat/sous-face) qui composent ce groupe de
// pièces, qui elles se trouvent ailleurs dans le fichier et se rattachent au
// modulo via leur grain matching ("T9:1 2:1" = fait partie de la bande T9).
// Repérable par sa description (colonne "Noms", en position 0) qui porte
// alors le nom du modulo lui-même — vrai même quand la ligne est par
// ailleurs taguée "TC" comme une vraie pièce.
const MOTIF_DESCRIPTION_MODULE = /^T\d+\/\d+$/;

function feuillePrincipale(workbook) {
  let meilleure = null;
  let meilleurNb = -1;
  for (const feuille of workbook.worksheets) {
    const nb = feuille.rowCount || 0;
    if (nb > meilleurNb) {
      meilleure = feuille;
      meilleurNb = nb;
    }
  }
  return meilleure;
}

function chargerLignes(workbook) {
  const feuille = feuillePrincipale(workbook);
  if (!feuille) throw new Error("Le fichier de la liste de coupe est vide.");

  const largeur = feuille.columnCount || 0;
  const hauteur = feuille.rowCount || 0;
  const lignes = [];
  for (let r = 1; r <= hauteur; r++) {
    const row = feuille.getRow(r);
    const arr = new Array(largeur);
    for (let c = 1; c <= largeur; c++) arr[c - 1] = cellValue(row.getCell(c));
    lignes.push(arr);
  }
  if (lignes.length === 0) throw new Error("Le fichier de la liste de coupe est vide.");
  return lignes.slice(1);
}

function detecterColonne(lignes, scoreLigne) {
  let nbColonnes = 0;
  for (const ligne of lignes) nbColonnes = Math.max(nbColonnes, ligne.length);
  let meilleurIndex = null;
  let meilleurScore = 0;
  for (let col = 0; col < nbColonnes; col++) {
    let score = 0;
    for (const ligne of lignes) score += scoreLigne(ligne, col);
    if (score > meilleurScore) {
      meilleurIndex = col;
      meilleurScore = score;
    }
  }
  return meilleurIndex;
}

function detecterColonneCle(lignes, clesStrat) {
  if (!clesStrat || clesStrat.size === 0) return null;
  return detecterColonne(lignes, (ligne, col) => {
    if (col >= ligne.length || ligne[col] === null || ligne[col] === undefined) return 0;
    return clesStrat.has(String(ligne[col]).trim()) ? 1 : 0;
  });
}

function detecterColonneMateriau(lignes) {
  return detecterColonne(lignes, (ligne, col) => {
    if (col >= ligne.length || ligne[col] === null || ligne[col] === undefined) return 0;
    return String(ligne[col]).trim().toUpperCase() === "PROTECTION" ? 1 : 0;
  });
}

function detecterColonneGrainMatching(lignes) {
  return detecterColonne(lignes, (ligne, col) => {
    if (col >= ligne.length || ligne[col] === null || ligne[col] === undefined) return 0;
    return MOTIF_GRAIN_MATCHING.test(String(ligne[col]).trim()) ? 1 : 0;
  });
}

function detecterColonneTypeTrace(lignes) {
  return detecterColonne(lignes, (ligne, col) => {
    if (col >= ligne.length || ligne[col] === null || ligne[col] === undefined) return 0;
    return MOTIF_TYPE_TRACE.test(String(ligne[col]).trim()) ? 1 : 0;
  });
}

// Renvoie false pour une ligne technique (talon/chute, bande de chant,
// modulo/bande qui s'auto-référence...) et true pour une vraie pièce.
//
// Un modulo/bande n'est jamais une pièce, même s'il est par ailleurs tagué
// "TC" comme une vraie pièce (repéré par son nom en colonne 0, voir
// MOTIF_DESCRIPTION_MODULE) : ce contrôle passe avant celui du type de
// trace, qui identifie le reste des lignes techniques (talon/chute, bande de
// chant) quand cette colonne est disponible. Si le type de trace n'a pas pu
// être détecté, les autres lignes restent considérées comme des pièces
// (comportement inchangé).
function estLignePiece(ligne, colTypeTrace) {
  if (ligne.length > 0 && ligne[0] !== null && ligne[0] !== undefined
      && MOTIF_DESCRIPTION_MODULE.test(String(ligne[0]).trim().toUpperCase())) {
    return false;
  }

  if (colTypeTrace === null || colTypeTrace >= ligne.length) return true;
  const valeur = ligne[colTypeTrace];
  if (valeur === null || valeur === undefined) return true;
  const correspondance = MOTIF_TYPE_TRACE.exec(String(valeur).trim());
  if (!correspondance) return true;
  return correspondance[2] === TYPE_TRACE_PIECE;
}

// Liste des [clé, ligne] pour les lignes qui représentent une pièce réelle
// (clé renseignée, matériau pas "PROTECTION", type de trace "TC", et ne
// correspondant pas au filtre supplémentaire {col, valeur} quand détecté).
function lignesPieces(lignes, colCle, colMateriau, colTypeTrace, exclusion) {
  const resultat = [];
  for (const ligne of lignes) {
    if (colCle >= ligne.length || ligne[colCle] === null || ligne[colCle] === undefined) continue;
    const cle = String(ligne[colCle]).trim();

    const materiau = colMateriau < ligne.length ? ligne[colMateriau] : null;
    if (estProtection(materiau)) continue;
    if (!estLignePiece(ligne, colTypeTrace)) continue;

    if (exclusion) {
      const { col: colExclu, valeur: valeurExclue } = exclusion;
      if (colExclu < ligne.length && ligne[colExclu] !== null && ligne[colExclu] !== undefined) {
        if (String(ligne[colExclu]).trim().toUpperCase() === valeurExclue) continue;
      }
    }

    resultat.push([cle, ligne]);
  }
  return resultat;
}

function sommeParCle(pieces, colQuantite) {
  const sommes = new Map();
  for (const [cle, ligne] of pieces) {
    const valeur = colQuantite !== null && colQuantite < ligne.length ? ligne[colQuantite] : null;
    const n = toFloatOrNull(valeur);
    const quantite = n === null ? 1 : n;
    sommes.set(cle, (sommes.get(cle) || 0) + quantite);
  }
  return sommes;
}

function scoreCorrespondance(sommes, qteAttendueParCle) {
  let score = 0;
  for (const [cle, total] of sommes) {
    const attendu = qteAttendueParCle.get(cle);
    if (attendu !== undefined && Math.abs(total - attendu) < 1e-6) score++;
  }
  return score;
}

// Certains exports marquent en plus une ligne technique supplémentaire
// (réserve/chute) avec le même type de trace "TC" que la vraie pièce.
// On cherche une colonne + valeur (indicateur catégoriel, ex. oui/non)
// dont l'exclusion, en plus du filtrage par type de trace, améliore
// encore la correspondance entre quantités retrouvées et attendues.
function detecterExclusionSupplementaire(lignes, colCle, colMateriau, colTypeTrace, colQuantite, qteAttendueParCle) {
  if (!qteAttendueParCle || qteAttendueParCle.size === 0) return null;

  const pieces = lignesPieces(lignes, colCle, colMateriau, colTypeTrace);
  const scoreBase = scoreCorrespondance(sommeParCle(pieces, colQuantite), qteAttendueParCle);

  let nbColonnes = 0;
  for (const [, ligne] of pieces) nbColonnes = Math.max(nbColonnes, ligne.length);

  let meilleur = null;
  let meilleurScore = scoreBase;
  for (let col = 0; col < nbColonnes; col++) {
    if (col === colCle || col === colMateriau || col === colTypeTrace || col === colQuantite) continue;
    const valeurs = new Set();
    for (const [, ligne] of pieces) {
      if (col < ligne.length && ligne[col] !== null && ligne[col] !== undefined) {
        const v = String(ligne[col]).trim().toUpperCase();
        if (v) valeurs.add(v);
      }
    }
    if (valeurs.size < 2 || valeurs.size > 6) continue; // profil d'un indicateur catégoriel

    for (const valeur of valeurs) {
      const piecesFiltrees = pieces.filter(([, ligne]) => {
        if (col >= ligne.length || ligne[col] === null || ligne[col] === undefined) return true;
        return String(ligne[col]).trim().toUpperCase() !== valeur;
      });
      const score = scoreCorrespondance(sommeParCle(piecesFiltrees, colQuantite), qteAttendueParCle);
      if (score > meilleurScore) {
        meilleur = { col, valeur };
        meilleurScore = score;
      }
    }
  }

  const seuil = SEUIL_CONFIANCE_COLONNE_QUANTITE * qteAttendueParCle.size;
  return meilleur && meilleurScore >= seuil ? meilleur : null;
}

// La colonne quantité n'est adoptée que si elle explique au moins cette
// proportion des clés du fichier de lancement (sinon, un faux positif sur
// un fichier sans cette colonne compterait n'importe quoi).
const SEUIL_CONFIANCE_COLONNE_QUANTITE = 0.5;

// La colonne quantité est celle dont la somme par clé (sur les lignes
// pièce) reproduit le plus souvent, exactement, la quantité attendue du
// fichier de lancement — une même clé peut être débitée en plusieurs
// lots (nesting), avec un nombre de pièces différent à chaque lot :
// compter "1 par ligne" sous-évalue alors la quantité réelle.
function detecterColonneQuantite(lignes, colCle, colMateriau, colTypeTrace, qteAttendueParCle) {
  if (!qteAttendueParCle || qteAttendueParCle.size === 0) return null;
  const piecesLignes = lignesPieces(lignes, colCle, colMateriau, colTypeTrace);
  let nbColonnes = 0;
  for (const ligne of lignes) nbColonnes = Math.max(nbColonnes, ligne.length);

  let meilleurIndex = null;
  let meilleurScore = 0;
  for (let col = 0; col < nbColonnes; col++) {
    if (col === colCle || col === colMateriau || col === colTypeTrace) continue;
    const sommes = new Map();
    for (const [cle, ligne] of piecesLignes) {
      const valeur = col < ligne.length ? ligne[col] : null;
      const n = toFloatOrNull(valeur);
      if (n === null) continue;
      sommes.set(cle, (sommes.get(cle) || 0) + n);
    }
    let score = 0;
    for (const [cle, total] of sommes) {
      const attendu = qteAttendueParCle.get(cle);
      if (attendu !== undefined && Math.abs(total - attendu) < 1e-6) score++;
    }
    if (score > meilleurScore) {
      meilleurIndex = col;
      meilleurScore = score;
    }
  }

  const seuil = SEUIL_CONFIANCE_COLONNE_QUANTITE * qteAttendueParCle.size;
  return meilleurScore >= seuil ? meilleurIndex : null;
}

// Compte les clés trouvées qui n'ont aucune valeur de grain matching sur
// aucune de leurs lignes ("unitaires" : pas de calage de fil nécessaire).
// Renvoie null si la colonne grain matching n'a pas pu être détectée.
function compterUnitaires(pieces, colGrain, compteur) {
  if (colGrain === null) return null;
  const aGrain = new Set();
  for (const [cle, ligne] of pieces) {
    if (colGrain < ligne.length && ligne[colGrain] !== null && ligne[colGrain] !== undefined) {
      if (String(ligne[colGrain]).trim()) aGrain.add(cle);
    }
  }
  let nbUnitaires = 0;
  for (const cle of compteur.keys()) {
    if (!aGrain.has(cle)) nbUnitaires++;
  }
  return nbUnitaires;
}

function lireCoupe(workbook, clesStrat, qteAttendueParCle) {
  const lignes = chargerLignes(workbook);

  let colCle = detecterColonneCle(lignes, clesStrat);
  if (colCle === null) colCle = COLONNE_CLE_PAR_DEFAUT;
  let colMateriau = detecterColonneMateriau(lignes);
  if (colMateriau === null) colMateriau = COLONNE_MATERIAU_PAR_DEFAUT;
  const colTypeTrace = detecterColonneTypeTrace(lignes);
  const colQuantite = detecterColonneQuantite(lignes, colCle, colMateriau, colTypeTrace, qteAttendueParCle || new Map());
  const colGrain = detecterColonneGrainMatching(lignes);
  const exclusion = detecterExclusionSupplementaire(
    lignes,
    colCle,
    colMateriau,
    colTypeTrace,
    colQuantite,
    qteAttendueParCle || new Map()
  );

  const pieces = lignesPieces(lignes, colCle, colMateriau, colTypeTrace, exclusion);

  const compteur = new Map();
  for (const [cle, ligne] of pieces) {
    let quantite = 1;
    if (colQuantite !== null && colQuantite < ligne.length) {
      const n = toFloatOrNull(ligne[colQuantite]);
      if (n !== null) quantite = n;
    }
    compteur.set(cle, (compteur.get(cle) || 0) + quantite);
  }

  let total = 0;
  for (const v of compteur.values()) total += v;
  if (total === 0) {
    throw new Error(
      "Aucune pièce n'a été reconnue dans la liste de coupe : le format du fichier semble différent de celui attendu."
    );
  }

  const nbUnitaires = compterUnitaires(pieces, colGrain, compteur);

  return {
    compteur,
    nbUnitaires,
    nbPiecesTrouvees: compteur.size,
  };
}

function lireGrainMatching(workbook, clesStrat) {
  const lignes = chargerLignes(workbook);

  let colCle = detecterColonneCle(lignes, clesStrat || new Set());
  if (colCle === null) colCle = COLONNE_CLE_PAR_DEFAUT;
  let colMateriau = detecterColonneMateriau(lignes);
  if (colMateriau === null) colMateriau = COLONNE_MATERIAU_PAR_DEFAUT;
  let colGrain = detecterColonneGrainMatching(lignes);
  if (colGrain === null) colGrain = COLONNE_GRAIN_MATCHING_PAR_DEFAUT;
  const colTypeTrace = detecterColonneTypeTrace(lignes);

  const resultat = new Map();
  for (const [cle, ligne] of lignesPieces(lignes, colCle, colMateriau, colTypeTrace)) {
    if (!resultat.has(cle)) resultat.set(cle, []);

    const valeurRaw = colGrain < ligne.length ? ligne[colGrain] : null;
    if (valeurRaw === null || valeurRaw === undefined) continue;
    const valeur = String(valeurRaw).trim();
    if (valeur && !resultat.get(cle).includes(valeur)) resultat.get(cle).push(valeur);
  }
  return resultat;
}

// ---- comparator ----

// Couches trouvées -> pièces complètes : une pièce assemblée ne compte que
// si toutes ses couches sont là, et une seule fois.
function piecesCompletes(ligneStrat, nbCouches) {
  if (!ligneStrat.pieces || ligneStrat.pieces <= 0 || ligneStrat.qte_attendue <= 0) return nbCouches;
  return Math.floor((nbCouches * ligneStrat.pieces) / ligneStrat.qte_attendue + 1e-9);
}

// Pièces finies d'un fichier d'optimisation (.bkp ou liste de coupe) pour un lancement.
function piecesTrouvees(lignesStrat, trouveParCle) {
  const stratParCle = new Map(lignesStrat.map((l) => [l.cle, l]));
  let total = 0;
  for (const [cle, qte] of trouveParCle) {
    const s = stratParCle.get(cle);
    total += s ? piecesCompletes(s, qte) : qte;
  }
  return total;
}

function comparer(lignesStrat, trouveParCle) {
  const stratParCle = new Map(lignesStrat.map((l) => [l.cle, l]));
  const toutesLesCles = new Set([...stratParCle.keys(), ...trouveParCle.keys()]);

  const lignes = [];
  let piecesAttendues = 0;
  let piecesTrouveesTotal = 0;
  for (const cle of toutesLesCles) {
    const strat = stratParCle.get(cle);
    const qteAttendue = strat ? strat.qte_attendue : 0;
    const qteTrouvee = trouveParCle.get(cle) || 0;
    // Pièce assemblée : les quantités comptent les couches (compact, support…).
    const couches = strat ? strat.couches || 1 : 1;
    const piecesLigne = strat ? (strat.pieces > 0 ? strat.pieces : qteAttendue) : 0;
    piecesAttendues += piecesLigne;
    piecesTrouveesTotal += strat ? piecesCompletes(strat, qteTrouvee) : qteTrouvee;

    let commande = "", ligneNum = "", article = "", lancement = "", statut;
    if (!strat) {
      statut = "En trop";
      // Pièce absente du fichier de lancement : on n'a que sa clé
      // commande+ligne (venant de la liste de coupe). On en déduit le
      // numéro de commande et la ligne (mêmes conventions que
      // cleLigne() : les 3 derniers chiffres sont le numéro de ligne).
      const correspondance = /^(.+?)(\d{3})$/.exec(cle);
      if (correspondance) {
        commande = correspondance[1];
        ligneNum = String(parseInt(correspondance[2], 10));
      } else {
        commande = cle;
      }
    } else {
      commande = strat.commande;
      ligneNum = strat.ligne;
      article = strat.article;
      lancement = strat.lancement;
      if (qteTrouvee === 0) statut = "Manquant";
      else if (qteTrouvee === qteAttendue) statut = "OK";
      else statut = "Écart de quantité";
    }

    lignes.push({
      cle,
      commande,
      ligne: ligneNum,
      article,
      lancement,
      qte_attendue: qteAttendue,
      qte_trouvee: qteTrouvee,
      statut,
      ecart: qteTrouvee - qteAttendue,
      couches,
      pieces: piecesLigne,
    });
  }

  lignes.sort((a, b) => {
    const aOk = a.statut === "OK" ? 1 : 0;
    const bOk = b.statut === "OK" ? 1 : 0;
    if (aOk !== bOk) return aOk - bOk;
    if (a.commande !== b.commande) return a.commande < b.commande ? -1 : 1;
    if (a.ligne !== b.ligne) return a.ligne < b.ligne ? -1 : 1;
    return 0;
  });

  const totalAttendu = lignes.reduce((s, l) => s + l.qte_attendue, 0);
  const totalTrouve = lignes.reduce((s, l) => s + l.qte_trouvee, 0);
  const nbOk = lignes.filter((l) => l.statut === "OK").length;
  const nbAnomalies = lignes.length - nbOk;

  return { lignes, totalAttendu, totalTrouve, nbOk, nbAnomalies, piecesAttendues, piecesTrouvees: piecesTrouveesTotal };
}

// ---- report_export ----
const CLASSE_PAR_STATUT = {
  OK: "statut-ok",
  Manquant: "statut-manquant",
  "En trop": "statut-entrop",
  "Écart de quantité": "statut-ecart",
};

const ARGB_PAR_STATUT = {
  OK: "FFC6EFCE",
  Manquant: "FFFFC7CE",
  "En trop": "FFFFEB9C",
  "Écart de quantité": "FFFFEB9C",
};

async function exporterRapport(rapport, nomFichier) {
  const workbook = new ExcelJS.Workbook();
  const feuille = workbook.addWorksheet("Contrôle coupe");

  const ligneTotaux = feuille.addRow([
    "Total attendu",
    rapport.totalAttendu,
    "Total trouvé",
    rapport.totalTrouve,
    "Anomalies",
    rapport.nbAnomalies,
  ]);
  ligneTotaux.eachCell((cell) => (cell.font = { bold: true }));
  feuille.addRow([]);

  const entetes = [
    "Commande",
    "Ligne",
    "Article",
    "Lancement",
    "Qté attendue",
    "Qté trouvée (coupe)",
    "Écart",
    "Statut",
  ];
  const ligneEntetes = feuille.addRow(entetes);
  ligneEntetes.eachCell((cell) => {
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center" };
  });

  for (const ligne of rapport.lignes) {
    const row = feuille.addRow([
      ligne.commande,
      ligne.ligne,
      ligne.article,
      ligne.lancement,
      ligne.qte_attendue,
      ligne.qte_trouvee,
      ligne.ecart,
      ligne.statut,
    ]);
    const argb = ARGB_PAR_STATUT[ligne.statut];
    if (argb) row.eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } }));
  }

  const largeurs = [16, 8, 22, 14, 20, 20, 8, 20];
  largeurs.forEach((l, i) => (feuille.getColumn(i + 1).width = l));

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomFichier || "rapport_controle_coupe.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

