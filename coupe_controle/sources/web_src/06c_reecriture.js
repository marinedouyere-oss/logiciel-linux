// ---- Réécriture : l'extraction du logiciel de gestion devient le LAN du lancement ----
// RÈGLE ABSOLUE : rien n'est ajouté au fichier. Même onglet, mêmes lignes, même ordre, mêmes colonnes,
// même mise en forme. Seules les cellules à corriger changent de valeur ; les lignes dont les dimensions
// sont corrigées sont surlignées (jaune : +10, orange : +20), comme à la main. Le fichier est modifié
// directement dans son XML (pas de réécriture par une bibliothèque Excel), puis relu et comparé
// cellule par cellule à l'original avant d'être enregistré.
//
// Corrections (Feno seulement, pour l'instant) :
//  - Retour latéral LG / LD (pas FG / FD, pas ETR… = sans retour) : cote finie +10 par retour ;
//    débit = cote finie + 55 pour le FENO, + 50 pour le reste ; protection : débit = cote finie.
//  - Support 10 brut (SAG10HYBR) : RCB en sous-face si elle est vide, toujours (MIXTE compris).
// Corrections agglo (1er tour, 2ème tour, casse ; pas le recyclage ni les chantiers) :
//  - Bandes : une bande = 1, 2 ou 3 pièces « ban » de même agglo (28, 38 et plus) et mêmes couleurs dessus /
//    dessous, à 6 cm ou moins les unes des autres en largeur de débit ; elles prennent la plus grande largeur.
//    Le moins de bandes possible, puis le moins de pièces modifiées : une pièce n'est élargie que si cela
//    économise une bande. Lignes élargies surlignées en jaune.
//  - « BRUT » dans la couleur (colonne coloris) : retiré, ligne surlignée en jaune.
//  - Chant brut (« BRUT » dans Type chant, ou commentaire « CHANTS BRUTS ») : ligne seulement surlignée en jaune.
//  - Crédences (articles CRED12, CRED14) en 10 brut et 12 brut : RCB-CRED14 en sous-face si elle est vide
//    ou « RCB » (pas les CBD, pas les CRED…G…, pas les supports de compacts).
//  - Commentaire vide et usinage indiqué (info 3 atelier ou un des 4 usinages d'angle) : BAZ.

const TYPES_REECRITURE = [
  { id: "agglo1", libelle: "Agglo 1er tour", dossier: "1ER TOUR AGGLO", suffixe: "01START", agglo: true },
  { id: "agglo2", libelle: "Agglo 2ème tour", dossier: "2EME TOUR AGGLO", suffixe: "02START", agglo: true },
  { id: "recyclage", libelle: "Recyclage", dossier: "1ER TOUR AGGLO", suffixe: "01RECYCLAGE" },
  { id: "feno", libelle: "Feno", dossier: "FENO", suffixe: "01FENO", feno: true },
  { id: "casse", libelle: "Casse", dossier: "CASSE", suffixe: "CASSE", agglo: true },
  { id: "chantier", libelle: "Chantier", dossier: "CHANTIERS", suffixe: null },
];

const COLONNES_REECRITURE = {
  cle: "commande+ligne",
  fini: "conf_longueur",
  debit: "longueur",
  agglo: "agglo",
  sousFace: "coloris_inf",
  assemblage: "info atelier assemblage",
  commentaire: "commentaire",
  finiTexte: "LongueurxLargeurxEpaisseur fini",
};

// Colonnes utiles aux corrections agglo (une règle dont une colonne manque ne s'applique pas).
const COLONNES_AGGLO = {
  largeur: "largeur",
  coloris: "coloris",
  idPlan: "idPlan",
  cbd: "CBD",
  quantite: "comdet_qte",
  info3: "info 3 atelier",
  typeChant: "Type chant",
  angles: ["Usinage angle avant gauche", "Usinage angle avant droit", "Usinage angle arrière gauche", "Usinage angle arrière droit"],
};
const ECART_BANDE = 60; // mm : pas plus de 6 cm entre deux pièces d'une même bande

// Surlignage des lignes dont les dimensions sont corrigées (mêmes couleurs que les LAN faits à la main).
const COULEUR_PLUS_10 = "FFFFFF00"; // jaune
const COULEUR_PLUS_20 = "FFFFC000"; // orange
const couleurMarque = (retours) => (retours >= 2 ? COULEUR_PLUS_20 : COULEUR_PLUS_10);
// Erreurs trouvées dans le fichier final : la ligne passe en rouge, avant toutes les autres couleurs.
const COULEUR_ERREUR = "FFFF0000"; // rouge
const SURCOTE_MAX = 61; // mm : au-delà (débit moins cote finie, en longueur ou en largeur), c'est une aberration
const COLONNE_LARGEUR_FINIE = "conf_largeur"; // largeur finie (la longueur finie est conf_longueur)

const TYPE_CLASSEUR = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const TYPE_CLASSEUR_MACROS = "application/vnd.ms-excel.sheet.macroEnabled.main+xml";

// ---- Lecture du XML du classeur ----

function texteXml(t) {
  return t
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Préfixe d'espace de noms de l'élément racine d'une partie (« x: » ou rien).
const prefixeXml = (xml, racine) => ((xml || "").match(new RegExp(`<([\\w.-]+:)?${racine}\\b`)) || [])[1] || "";

const xmlEchapper = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const textesDesT = (xml) => [...xml.matchAll(/<(?:[\w.-]+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?t>)/g)].map((m) => texteXml(m[1] || "")).join("");

function chaineesPartagees(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<(?:[\w.-]+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?si>)/g)].map((m) => textesDesT((m[1] || "").replace(/<(?:[\w.-]+:)?rPh\b[\s\S]*?<\/(?:[\w.-]+:)?rPh>/g, "")));
}

function indexColonne(lettres) {
  let n = 0;
  for (const c of lettres) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

function lettresColonne(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const attribut = (attrs, nom) => {
  const m = attrs.match(new RegExp(`\\b${nom}="([^"]*)"`));
  return m ? m[1] : null;
};

// Cellules d'une ligne : position dans le contenu de la ligne, colonne, valeur lue.
function cellulesDeLigne(contenu, sst) {
  const cellules = [];
  for (const m of contenu.matchAll(/<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c>)/g)) {
    const attrs = m[1];
    const ref = attribut(attrs, "r");
    if (!ref) throw new Error("cellule sans référence (format de classeur non pris en charge)");
    const mr = ref.match(/^([A-Z]+)(\d+)$/);
    if (!mr) throw new Error(`référence de cellule illisible : ${ref}`);
    const interieur = m[2] || "";
    const type = attribut(attrs, "t");
    const v = interieur.match(/<(?:[\w.-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?v>/);
    let valeur = null;
    if (type === "s") valeur = v ? sst[Number(v[1])] ?? null : null;
    else if (type === "inlineStr") valeur = textesDesT(interieur);
    else if (v) valeur = texteXml(v[1]);
    cellules.push({ debut: m.index, fin: m.index + m[0].length, xml: m[0], attrs, ref, col: indexColonne(mr[1]), valeur, formule: /<(?:[\w.-]+:)?f\b/.test(interieur) });
  }
  return cellules;
}

// Les lignes de la feuille : position dans le XML, numéro, cellules.
function lignesDeFeuille(xml, sst) {
  const debutDonnees = xml.search(/<(?:[\w.-]+:)?sheetData\b/);
  if (debutDonnees < 0) throw new Error("feuille sans données");
  const lignes = [];
  const re = /<(?:[\w.-]+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?row>)/g;
  re.lastIndex = debutDonnees;
  let m;
  while ((m = re.exec(xml))) {
    const numero = Number(attribut(m[1], "r"));
    if (!numero) throw new Error("ligne sans numéro (format de classeur non pris en charge)");
    const contenu = m[2] || "";
    const fermeture = m[2] === undefined ? "" : m[0].slice(m[0].lastIndexOf("</"));
    const ouverture = m[0].length - contenu.length - fermeture.length;
    lignes.push({ debut: m.index, fin: m.index + m[0].length, numero, xml: m[0], ouverture: m[0].slice(0, ouverture), fermeture, debutContenu: m.index + ouverture, contenu, cellules: cellulesDeLigne(contenu, sst) });
  }
  return lignes;
}

function cheminCible(base, cible) {
  if (cible.startsWith("/")) return cible.slice(1);
  const parties = base.split("/").slice(0, -1);
  for (const p of cible.split("/")) {
    if (p === "..") parties.pop();
    else if (p !== ".") parties.push(p);
  }
  return parties.join("/");
}

// Les parties du classeur (archive zip) : [nom, octets], dans l'ordre de l'archive.
async function partiesClasseur(octets) {
  const tampon = octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength);
  let entrees;
  try {
    entrees = await listerEntreesZip(tampon);
  } catch (_erreur) {
    throw new Error("ce n'est pas un classeur Excel");
  }
  const parties = [];
  for (const e of entrees) if (!e.nom.endsWith("/")) parties.push([e.nom, await extraireEntreeZip(tampon, e)]);
  if (!parties.length) throw new Error("ce n'est pas un classeur Excel");
  return parties;
}

// Ouvre le classeur d'extraction : première feuille, chaînes partagées, lignes et colonnes.
async function analyserExtraction(octets) {
  const parties = await partiesClasseur(octets);
  const decodeur = new TextDecoder("utf-8");
  const lire = (chemin) => {
    const x = parties.find(([n]) => n === chemin);
    return x ? decodeur.decode(x[1]) : null;
  };
  if (parties.some(([n]) => /vbaProject\.bin$/i.test(n))) throw new Error("le fichier contient des macros : Sentinelle ne le réécrit pas");
  const classeur = lire("xl/workbook.xml");
  const liens = lire("xl/_rels/workbook.xml.rels");
  if (!classeur || !liens) throw new Error("ce n'est pas un classeur Excel");
  const feuille = classeur.match(/<(?:[\w.-]+:)?sheet\b([^>]*?)\/?>/);
  if (!feuille) throw new Error("classeur sans feuille");
  const nomFeuille = texteXml(attribut(feuille[1], "name") || "");
  const idFeuille = attribut(feuille[1], "r:id");
  const relations = [...liens.matchAll(/<(?:[\w.-]+:)?Relationship\b([^>]*?)\/?>/g)].map((m) => ({ id: attribut(m[1], "Id"), type: attribut(m[1], "Type") || "", cible: attribut(m[1], "Target") || "" }));
  const relFeuille = relations.find((r) => r.id === idFeuille);
  if (!relFeuille) throw new Error("feuille introuvable dans le classeur");
  const cheminFeuille = cheminCible("xl/workbook.xml", relFeuille.cible);
  const relChaines = relations.find((r) => /\/sharedStrings$/.test(r.type));
  const cheminChaines = relChaines ? cheminCible("xl/workbook.xml", relChaines.cible) : null;
  const relStyles = relations.find((r) => /\/styles$/.test(r.type));
  const cheminStyles = relStyles ? cheminCible("xl/workbook.xml", relStyles.cible) : null;
  const xmlStyles = cheminStyles ? lire(cheminStyles) : null;
  const xmlFeuille = lire(cheminFeuille);
  if (!xmlFeuille) throw new Error("feuille illisible");
  const xmlChaines = cheminChaines ? lire(cheminChaines) : null;
  const sst = chaineesPartagees(xmlChaines);
  const lignes = lignesDeFeuille(xmlFeuille, sst);
  const entete = lignes.find((l) => l.numero === 1);
  if (!entete) throw new Error("ligne d'en-têtes introuvable");
  const colonnes = {};
  for (const c of entete.cellules) if (c.valeur != null) colonnes[String(c.valeur).trim()] = c.col;
  const manquantes = Object.values(COLONNES_REECRITURE).filter((n) => !colonnes[n]);
  if (manquantes.length) throw new Error(`colonnes introuvables : ${manquantes.join(", ")}`);
  const donnees = lignes.filter((l) => l.numero > 1 && l.cellules.some((c) => c.valeur != null && String(c.valeur).trim() !== ""));
  const nbColonnes = Math.max(...entete.cellules.map((c) => c.col));
  // Préfixe d'espace de noms de chaque partie (« x: » dans les extractions du logiciel de gestion).
  const prefixes = { feuille: prefixeXml(xmlFeuille, "worksheet"), chaines: prefixeXml(xmlChaines, "sst"), styles: prefixeXml(xmlStyles, "styleSheet") };
  return { parties, nomFeuille, cheminFeuille, cheminChaines, cheminStyles, xmlFeuille, xmlChaines, xmlStyles, sst, lignes, colonnes, nbColonnes, donnees, prefixes };
}

// ---- Corrections ----

const nombreCellule = (v) => {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

// Retours latéraux (LG / LD) de la colonne assemblage ; FG / FD et ETR… (sans retour) ne comptent pas.
function retoursLateraux(assemblage) {
  let n = 0;
  for (const t of String(assemblage || "").toUpperCase().split(/[\s\-]+/)) if (/^L[GD]\d*$/.test(t)) n++;
  return n;
}

const supplementDebit = (agglo) => (agglo.startsWith("PROTECTION") ? 0 : agglo.startsWith("FENO") ? 55 : 50);

const PIECES_PAR_BANDE = 3; // une bande : 1, 2 ou 3 pièces
const LONGUEUR_BANDE = 4060; // mm : longueur maximum d'une bande (débits mis bout à bout), quel que soit le support
const TOLERANCE_SURCOTE = 2; // mm : une surcote peut baisser de 2 mm au plus (602 → 600)

// Nombre de bandes pour des pièces de même largeur : 3 pièces et 4060 mm au plus par bande
// (les plus longues d'abord, chacune dans la première bande où elle tient).
function nombreBandes(longueurs) {
  const bandes = [];
  for (const L of longueurs.map((x) => (x == null ? LONGUEUR_BANDE : x)).sort((a, b) => b - a)) {
    const b = bandes.find((x) => x.n < PIECES_PAR_BANDE && x.total + L <= LONGUEUR_BANDE);
    if (b) {
      b.n++;
      b.total += L;
    } else bandes.push({ n: 1, total: L });
  }
  return bandes.length;
}

// Harmonisation des bandes d'un groupe (même agglo, mêmes couleurs). On ne sait pas à l'avance quelles pièces
// Cut Rite mettra dans quelle bande : on met à la même largeur des pièces qui PEUVENT aller ensemble.
// Règles :
//  - une pièce ne change de largeur que si elle peut se coupler avec une autre pièce de la même largeur
//    finale : leurs deux longueurs de débit ensemble ne dépassent pas 4060 mm ;
//  - la largeur commune est celle d'une des pièces ; les autres montent de 6 cm au plus, ou baissent de 2 mm au plus ;
//  - une quantité 2 compte comme 2 pièces (2 fois la longueur) ;
//  - on cherche le moins de bandes possibles (3 pièces et 4060 mm au plus par bande), puis le moins de pièces
//    modifiées, puis le moins de mm ajoutés.
//  - une pièce ne monte jamais au-delà de sa largeur finie + 61 mm (max) : pas de surcote aberrante.
// pieces : [{ largeur, longueur, qte, max }] → largeur de débit de chaque pièce (même ordre).
function harmoniserLargeurs(pieces) {
  const ordre = pieces.map((p, i) => ({ largeur: p.largeur, longueur: p.longueur, qte: Math.max(1, Math.round(p.qte || 1)), max: p.max ?? null, i }));
  ordre.sort((a, b) => a.largeur - b.largeur || a.i - b.i);
  const n = ordre.length;
  const unites = (p) => Array(p.qte).fill(p.longueur);
  const bandesSeules = (liste) => {
    const parLargeur = new Map();
    for (const p of liste) parLargeur.set(p.largeur, [...(parLargeur.get(p.largeur) || []), ...unites(p)]);
    return [...parLargeur.values()].reduce((t, ls) => t + nombreBandes(ls), 0);
  };
  // Largeur commune d'un ensemble de pièces : celle d'une des pièces, à 2 mm au plus sous la plus large et
  // 6 cm au plus au-dessus de la plus étroite ; le moins de pièces modifiées, puis le moins de mm ajoutés.
  const largeurCommune = (membres) => {
    const max = membres[membres.length - 1].largeur;
    const min = membres[0].largeur;
    let choix = null;
    for (const w of new Set(membres.map((p) => p.largeur))) {
      if (w < max - TOLERANCE_SURCOTE || w - min > ECART_BANDE) continue;
      if (membres.some((p) => p.max != null && w > p.max && w !== p.largeur)) continue;
      const modifiees = membres.filter((p) => p.largeur !== w).length;
      const ajout = membres.reduce((t, p) => t + Math.max(0, w - p.largeur) * p.qte, 0);
      if (!choix || modifiees < choix.modifiees || (modifiees === choix.modifiees && ajout < choix.ajout)) choix = { w, modifiees, ajout };
    }
    return choix;
  };
  // Les pièces ordre[a..b-1] mises à une même largeur ; celles qui ne peuvent se coupler avec aucune autre gardent la leur.
  const classe = (a, b) => {
    const toutes = ordre.slice(a, b);
    let membres = toutes;
    let choix = null;
    for (;;) {
      choix = largeurCommune(membres);
      if (!choix) return null;
      const w = choix.w;
      const gardes = membres.filter(
        (p) => p.largeur === w || (p.longueur != null && membres.some((q) => q !== p && q.longueur != null && p.longueur + q.longueur <= LONGUEUR_BANDE))
      );
      if (gardes.length === membres.length) break;
      membres = gardes;
    }
    const exclues = toutes.filter((p) => !membres.includes(p));
    return {
      bandes: nombreBandes(membres.flatMap(unites)) + bandesSeules(exclues),
      modifiees: choix.modifiees,
      ajout: choix.ajout,
      cible: new Map(membres.map((p) => [p, choix.w])),
    };
  };
  const mieux = (a, b) => !b || a.bandes < b.bandes || (a.bandes === b.bandes && (a.modifiees < b.modifiees || (a.modifiees === b.modifiees && a.ajout < b.ajout)));
  const meilleur = [{ bandes: 0, modifiees: 0, ajout: 0, debut: -1, c: null }];
  for (let j = 1; j <= n; j++) {
    let m = null;
    for (let i = j - 1; i >= 0; i--) {
      if (ordre[j - 1].largeur - ordre[i].largeur > ECART_BANDE + TOLERANCE_SURCOTE) break;
      const c = classe(i, j);
      if (!c) continue;
      const cand = { bandes: meilleur[i].bandes + c.bandes, modifiees: meilleur[i].modifiees + c.modifiees, ajout: meilleur[i].ajout + c.ajout, debut: i, c };
      if (mieux(cand, m)) m = cand;
    }
    meilleur.push(m);
  }
  const cible = pieces.map((p) => p.largeur);
  for (let j = n; j > 0; j = meilleur[j].debut) for (const [p, w] of meilleur[j].c.cible) cible[p.i] = w;
  return cible;
}

// Corrections agglo : bandes (jaune), RCB-CRED14 sous les crédences en 10 / 12 brut, BAZ.
function corrigerAgglo(analyse, changements, pieces, marques) {
  const { colonnes, donnees } = analyse;
  const cellule = (l, nom) => {
    const c = colonnes[nom] && l.cellules.find((x) => x.col === colonnes[nom]);
    return c ? String(c.valeur ?? "").trim() : "";
  };
  const C = COLONNES_REECRITURE;
  const A = COLONNES_AGGLO;
  // Bandes
  if (colonnes[A.largeur] && colonnes[A.idPlan] && colonnes[A.coloris]) {
    const groupes = new Map();
    for (const l of donnees) {
      const agglo = cellule(l, C.agglo).toUpperCase();
      const m = agglo.match(/^SAG(\d+)/);
      const largeur = nombreCellule(cellule(l, A.largeur));
      if (!m || Number(m[1]) < 28 || cellule(l, A.idPlan).toLowerCase() !== "ban" || largeur == null) continue;
      const k = [agglo, cellule(l, A.coloris), cellule(l, C.sousFace)].join("|");
      if (!groupes.has(k)) groupes.set(k, []);
      const finie = nombreCellule(cellule(l, COLONNE_LARGEUR_FINIE));
      groupes.get(k).push({ l, largeur, agglo, longueur: nombreCellule(cellule(l, C.debit)), qte: nombreCellule(cellule(l, A.quantite)), max: finie == null ? null : finie + SURCOTE_MAX });
    }
    for (const pieces_ of groupes.values()) {
      const cible = harmoniserLargeurs(pieces_);
      for (const [i, x] of pieces_.entries()) {
        const w = cible[i];
        if (w === x.largeur) continue;
        const cle = cellule(x.l, C.cle);
        changements.push({ ligne: x.l.numero, col: colonnes[A.largeur], avant: x.largeur, apres: w, nombre: true, cle, agglo: x.agglo, quoi: "largeur (bande)" });
        marques.set(x.l.numero, COULEUR_PLUS_10);
        pieces.bandes.add(`${cle}|${x.l.numero}`);
      }
    }
  }
  for (const l of donnees) {
    const agglo = cellule(l, C.agglo).toUpperCase();
    const cle = cellule(l, C.cle);
    // « BRUT » dans la couleur : retiré, ligne en jaune.
    if (colonnes[A.coloris] && cellule(l, A.coloris).toUpperCase() === "BRUT") {
      changements.push({ ligne: l.numero, col: colonnes[A.coloris], avant: cellule(l, A.coloris), apres: "", nombre: false, cle, agglo, quoi: "couleur (BRUT retiré)" });
      marques.set(l.numero, COULEUR_PLUS_10);
      pieces.brut.add(`${cle}|${l.numero}`);
    }
    // Chant brut : la ligne est seulement surlignée (aucune valeur ne change).
    if (cellule(l, A.typeChant).toUpperCase() === "BRUT" || /CHANTS?\s+BRUTS?/i.test(cellule(l, C.commentaire))) {
      marques.set(l.numero, COULEUR_PLUS_10);
      pieces.chantBrut.add(`${cle}|${l.numero}`);
    }
    // Crédences (CRED12, CRED14) en 10 brut et 12 brut : RCB-CRED14 (sauf double face CBD).
    const sousFace = cellule(l, C.sousFace);
    const credence = /^CRED\d+$/i.test(cellule(l, "conf_article"));
    if (credence && (agglo === "SAG10HYBR" || agglo === "SAG12HYBR") && !cellule(l, A.cbd) && (sousFace === "" || sousFace.toUpperCase() === "RCB")) {
      changements.push({ ligne: l.numero, col: colonnes[C.sousFace], avant: sousFace || null, apres: "RCB-CRED14", nombre: false, cle, agglo, quoi: "sous-face" });
      pieces.cred14.add(`${cle}|${l.numero}`);
    }
    // Commentaire vide et usinage indiqué : BAZ.
    const usinage = cellule(l, A.info3) !== "" || A.angles.some((n) => cellule(l, n) !== "");
    if (colonnes[C.commentaire] && usinage && cellule(l, C.commentaire) === "") {
      changements.push({ ligne: l.numero, col: colonnes[C.commentaire], avant: null, apres: "BAZ", nombre: false, cle, agglo, quoi: "commentaire" });
      pieces.baz.add(`${cle}|${l.numero}`);
    }
  }
}

// Codes de sous-face à remplacer (demande de l'atelier) : la ligne passe en orange, en priorité sur les
// autres couleurs (posé en dernier, voir orangePortes).
const REMPLACEMENTS_SOUS_FACE = { RCB_B999_PORTES: "RCB_0003_PORTES" };

function remplacerSousFace(analyse, changements, pieces, marques) {
  const { colonnes, donnees } = analyse;
  const C = COLONNES_REECRITURE;
  if (!colonnes[C.sousFace]) return;
  const texte = (l, nom) => {
    const c = colonnes[nom] && l.cellules.find((x) => x.col === colonnes[nom]);
    return c ? String(c.valeur ?? "").trim() : "";
  };
  for (const l of donnees) {
    const avant = texte(l, C.sousFace);
    const apres = REMPLACEMENTS_SOUS_FACE[avant.toUpperCase()];
    if (!apres) continue;
    const cle = texte(l, C.cle);
    changements.push({ ligne: l.numero, col: colonnes[C.sousFace], avant, apres, nombre: false, cle, agglo: texte(l, C.agglo).toUpperCase(), quoi: "sous-face" });
    pieces.portes.add(`${cle}|${l.numero}`);
    pieces.lignesPortes.add(l.numero);
  }
}

// L'orange des portes passe avant toutes les autres couleurs de la ligne.
function orangePortes(pieces, marques) {
  for (const ligne of pieces.lignesPortes) marques.set(ligne, COULEUR_PLUS_20);
}

// Contrôle du fichier final (valeurs corrigées comprises) : surcote de plus de 61 mm en longueur ou en
// largeur, belle face (coloris) vide. Pas de couleur à demander pour la protection, ni pour le bois d'une
// pièce Feno (la couleur est portée par le FENO), ni quand « BRUT » vient d'être retiré.
function controlerErreurs(analyse, type, changements, pieces) {
  const { colonnes, donnees } = analyse;
  const C = COLONNES_REECRITURE;
  const A = COLONNES_AGGLO;
  const apres = new Map(changements.map((ch) => [`${ch.ligne}:${ch.col}`, ch.apres]));
  const valeur = (l, nom) => {
    const col = colonnes[nom];
    if (!col) return null;
    if (apres.has(`${l.numero}:${col}`)) return apres.get(`${l.numero}:${col}`);
    const c = l.cellules.find((x) => x.col === col);
    return c ? c.valeur : null;
  };
  const texte = (l, nom) => String(valeur(l, nom) ?? "").trim();
  const clesFeno = new Set(donnees.filter((l) => texte(l, C.agglo).toUpperCase().startsWith("FENO")).map((l) => texte(l, C.cle)));
  const erreurs = [];
  for (const l of donnees) {
    const cle = texte(l, C.cle);
    if (!cle) continue;
    const agglo = texte(l, C.agglo).toUpperCase();
    const surcotes = [];
    for (const [debit, fini, cote] of [[C.debit, C.fini, "longueur"], [A.largeur, COLONNE_LARGEUR_FINIE, "largeur"]]) {
      const d = nombreCellule(valeur(l, debit));
      const f = nombreCellule(valeur(l, fini));
      if (d != null && f != null && d - f > SURCOTE_MAX) surcotes.push(`${cote} +${formatNombre(d - f)} mm`);
    }
    if (surcotes.length) erreurs.push({ ligne: l.numero, cle, agglo, quoi: "surcote", detail: surcotes.join(", ") });
    const feno = agglo.startsWith("FENO");
    const sansCouleurNormal =
      !agglo || agglo.startsWith("PROTECTION") || pieces.brut.has(`${cle}|${l.numero}`) || (!feno && ((type && type.feno) || clesFeno.has(cle)));
    if (colonnes[A.coloris] && !sansCouleurNormal && texte(l, A.coloris) === "") erreurs.push({ ligne: l.numero, cle, agglo, quoi: "couleur", detail: "belle face sans couleur" });
  }
  return erreurs;
}

// Fin du plan : orange des portes, puis rouge des erreurs (avant tout le reste).
function finirPlan(analyse, type, plan) {
  orangePortes(plan.pieces, plan.marques);
  plan.marquesCorrections = new Map(plan.marques);
  plan.erreurs = controlerErreurs(analyse, type, plan.changements, plan.pieces);
  for (const e of plan.erreurs) plan.marques.set(e.ligne, COULEUR_ERREUR);
  return plan;
}

// Les cellules à changer, et ce qu'il faut dire à l'écran (rien de tout ça ne va dans le fichier).
function planifierCorrections(analyse, type) {
  const { colonnes, donnees } = analyse;
  const changements = [];
  const pieces = { retours: new Set(), rcb: new Set() };
  const avertissements = [];
  const marques = new Map(); // ligne -> couleur (dimensions corrigées)
  pieces.bandes = new Set();
  pieces.cred14 = new Set();
  pieces.baz = new Set();
  pieces.brut = new Set();
  pieces.chantBrut = new Set();
  pieces.portes = new Set();
  pieces.lignesPortes = new Set();
  if (type && (type.agglo || type.feno)) remplacerSousFace(analyse, changements, pieces, marques);
  if (type && type.agglo) corrigerAgglo(analyse, changements, pieces, marques);
  if (!type || !type.feno) return finirPlan(analyse, type, { changements, pieces, avertissements, marques });
  const val = (l, nom) => {
    const c = l.cellules.find((x) => x.col === colonnes[COLONNES_REECRITURE[nom]]);
    return c ? c.valeur : null;
  };
  const deja = new Set();
  const couchesParCle = new Map();
  for (const l of donnees) {
    const cle = String(val(l, "cle") ?? "").trim();
    const agglo = String(val(l, "agglo") ?? "").trim().toUpperCase();
    if (cle) {
      if (!couchesParCle.has(cle)) couchesParCle.set(cle, []);
      couchesParCle.get(cle).push(agglo);
    }
    const n = retoursLateraux(val(l, "assemblage"));
    if (n) {
      const fini = nombreCellule(val(l, "fini"));
      const debit = nombreCellule(val(l, "debit"));
      const m = String(val(l, "finiTexte") ?? "").match(/^\s*(\d+(?:[.,]\d+)?)\s*[xX]/);
      const finiErp = m ? Number(m[1].replace(",", ".")) : null;
      if (fini == null || debit == null) avertissements.push(`${cle || `ligne ${l.numero}`} (${agglo}) : cote finie ou débit illisible, ligne pas corrigée.`);
      else if (finiErp != null && Math.abs(finiErp - fini) > 0.01) deja.add(cle || `ligne ${l.numero}`);
      else {
        const nouveauFini = fini + 10 * n;
        const nouveauDebit = Math.max(nouveauFini + supplementDebit(agglo), agglo.startsWith("PROTECTION") ? 0 : debit);
        changements.push({ ligne: l.numero, col: colonnes[COLONNES_REECRITURE.fini], avant: fini, apres: nouveauFini, nombre: true, cle, agglo, quoi: "cote finie" });
        changements.push({ ligne: l.numero, col: colonnes[COLONNES_REECRITURE.debit], avant: debit, apres: nouveauDebit, nombre: true, cle, agglo, quoi: "débit" });
        pieces.retours.add(cle);
        marques.set(l.numero, couleurMarque(n));
      }
    }
    if (agglo === "SAG10HYBR" && String(val(l, "sousFace") ?? "").trim() === "") {
      changements.push({ ligne: l.numero, col: colonnes[COLONNES_REECRITURE.sousFace], avant: null, apres: "RCB", nombre: false, cle, agglo, quoi: "sous-face" });
      pieces.rcb.add(cle);
    }
  }
  if (deja.size) avertissements.push(`Déjà retouché à la main (cote finie différente du logiciel de gestion), pas corrigé : ${[...deja].join(", ")}.`);
  for (const [cle, couches] of couchesParCle) {
    if (couches.every((a) => a.startsWith("PROTECTION"))) avertissements.push(`${cle} : seulement la protection dans le fichier (pas de décor ni de support).`);
  }
  return finirPlan(analyse, type, { changements, pieces, avertissements, marques });
}

// ---- Écriture : seules les cellules prévues changent ----

const formatNombre = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

function celluleXml(ref, style, ch, indexChaine, px = "") {
  const s = style != null ? ` s="${style}"` : "";
  if (!ch.nombre && ch.apres === "") return `<${px}c r="${ref}"${s}/>`;
  if (ch.nombre) return `<${px}c r="${ref}"${s}><${px}v>${formatNombre(ch.apres)}</${px}v></${px}c>`;
  if (indexChaine != null) return `<${px}c r="${ref}"${s} t="s"><${px}v>${indexChaine}</${px}v></${px}c>`;
  return `<${px}c r="${ref}"${s} t="inlineStr"><${px}is><${px}t>${xmlEchapper(ch.apres)}</${px}t></${px}is></${px}c>`;
}

// Les styles du classeur : remplissages et styles de cellule, et le reste du fichier de styles.
function lireStyles(xml) {
  const fills = xml && xml.match(/<(?:[\w.-]+:)?fills\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?fills>/);
  const xfs = xml && xml.match(/<(?:[\w.-]+:)?cellXfs\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?cellXfs>/);
  if (!fills || !xfs) throw new Error("styles du classeur illisibles");
  return {
    fills: [...fills[2].matchAll(/<(?:[\w.-]+:)?fill\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:[\w.-]+:)?fill>)/g)].map((m) => m[0]),
    xfs: [...xfs[2].matchAll(/<(?:[\w.-]+:)?xf\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:[\w.-]+:)?xf>)/g)].map((m) => m[0]),
    reste: xml.replace(fills[0], "<fills/>").replace(xfs[0], "<cellXfs/>"),
  };
}

const avecAttribut = (balise, nom, valeur) => {
  const re = new RegExp(`\\s${nom}="[^"]*"`);
  return re.test(balise) ? balise.replace(re, ` ${nom}="${valeur}"`) : balise.replace(/^<([\w:.-]+)/, `<$1 ${nom}="${valeur}"`);
};
const sansRemplissage = (xf) => xf.replace(/\sfillId="[^"]*"/, "").replace(/\sapplyFill="[^"]*"/, "");
const couleurRemplissage = (fill) => ((fill || "").match(/<(?:[\w.-]+:)?fgColor\b[^>]*\brgb="([0-9A-Fa-f]{8})"/) || [])[1] || null;

// Ajoute les remplissages jaune / orange et, pour chaque style de cellule des lignes marquées, sa copie
// avec ce remplissage. Renvoie le nouveau XML et la table « style|couleur » -> numéro du nouveau style.
function stylesAvecMarques(xml, besoins, px = "") {
  const st = lireStyles(xml);
  const nouveauxFills = [];
  const idFill = new Map();
  for (const couleur of new Set([...besoins].map((b) => b.split("|")[1]))) {
    idFill.set(couleur, st.fills.length + nouveauxFills.length);
    nouveauxFills.push(`<${px}fill><${px}patternFill patternType="solid"><${px}fgColor rgb="${couleur}"/><${px}bgColor indexed="64"/></${px}patternFill></${px}fill>`);
  }
  const nouveauxXfs = [];
  const table = new Map();
  for (const b of besoins) {
    const [s, couleur] = b.split("|");
    const base = st.xfs[Number(s)] || st.xfs[0];
    if (!base) throw new Error("style de cellule introuvable");
    let xf = avecAttribut(base, "fillId", idFill.get(couleur));
    xf = avecAttribut(xf, "applyFill", "1");
    table.set(b, st.xfs.length + nouveauxXfs.length);
    nouveauxXfs.push(xf);
  }
  const compter = (ouverture, ajout) => ouverture.replace(/\bcount="(\d+)"/, (_m, n) => `count="${Number(n) + ajout}"`);
  let x = xml.replace(/(<(?:[\w.-]+:)?fills\b[^>]*>)([\s\S]*?)(<\/(?:[\w.-]+:)?fills>)/, (_m, o, c, f) => `${compter(o, nouveauxFills.length)}${c}${nouveauxFills.join("")}${f}`);
  x = x.replace(/(<(?:[\w.-]+:)?cellXfs\b[^>]*>)([\s\S]*?)(<\/(?:[\w.-]+:)?cellXfs>)/, (_m, o, c, f) => `${compter(o, nouveauxXfs.length)}${c}${nouveauxXfs.join("")}${f}`);
  return { xml: x, table };
}

async function ecrireLanCorrige(analyse, plan) {
  const changements = plan.changements;
  const marques = plan.marques || new Map();
  const { lignes, cheminFeuille, cheminChaines } = analyse;
  const px = analyse.prefixes.feuille;
  const pxs = analyse.prefixes.chaines;
  const encodeur = new TextEncoder();
  const parties = analyse.parties.map(([n, o]) => [n, o]);
  const remplacer = (nom, texte) => {
    const x = parties.find(([n]) => n === nom);
    if (!x) throw new Error(`partie ${nom} introuvable`);
    x[1] = encodeur.encode(texte);
  };
  let xmlFeuille = analyse.xmlFeuille;
  let xmlChaines = analyse.xmlChaines;
  const sst = analyse.sst.slice();
  let ajoutsChaines = 0;
  let referencesChaines = 0;
  const indexDe = (texte) => {
    if (xmlChaines == null) return null;
    let i = sst.indexOf(texte);
    if (i < 0) {
      i = sst.length;
      sst.push(texte);
      ajoutsChaines++;
    }
    referencesChaines++;
    return i;
  };
  const parLigne = new Map();
  for (const ch of changements) {
    if (!parLigne.has(ch.ligne)) parLigne.set(ch.ligne, []);
    parLigne.get(ch.ligne).push(ch);
  }
  const styleDeLigne = (l) => {
    const c = l.cellules.find((x) => x.col === analyse.colonnes[COLONNES_REECRITURE.agglo]) || l.cellules[0];
    return (c && attribut(c.attrs, "s")) || "0";
  };
  // Styles des lignes marquées : chaque style de cellule utilisé, avec la couleur de la ligne.
  let tableStyles = new Map();
  if (marques.size) {
    const besoins = new Set();
    for (const l of lignes) {
      const couleur = marques.get(l.numero);
      if (!couleur) continue;
      for (let col = 1; col <= analyse.nbColonnes; col++) {
        const c = l.cellules.find((x) => x.col === col);
        besoins.add(`${(c && attribut(c.attrs, "s")) || (c ? "0" : styleDeLigne(l))}|${couleur}`);
      }
    }
    if (!analyse.cheminStyles || !analyse.xmlStyles) throw new Error("classeur sans styles : surlignage impossible");
    const r = stylesAvecMarques(analyse.xmlStyles, besoins, analyse.prefixes.styles);
    tableStyles = r.table;
    remplacer(analyse.cheminStyles, r.xml);
  }
  // Des dernières lignes vers les premières : les positions du XML restent justes.
  for (const l of [...lignes].filter((x) => parLigne.has(x.numero) || marques.has(x.numero)).sort((a, b) => b.debut - a.debut)) {
    let contenu = l.contenu;
    const styleLigne = styleDeLigne(l);
    const couleur = marques.get(l.numero);
    const styleFinal = (s) => (couleur ? String(tableStyles.get(`${s}|${couleur}`)) : s);
    const operations = [];
    const changees = new Set();
    for (const ch of parLigne.get(l.numero) || []) {
      const ref = `${lettresColonne(ch.col)}${l.numero}`;
      const existante = l.cellules.find((c) => c.col === ch.col);
      const idx = ch.nombre || ch.apres === "" ? null : indexDe(ch.apres);
      changees.add(ch.col);
      if (existante) {
        const s = attribut(existante.attrs, "s");
        if (!ch.nombre && existante.valeur != null && String(existante.valeur).trim() !== "" && String(existante.valeur).trim() !== String(ch.avant ?? "")) throw new Error(`cellule ${ref} déjà remplie`);
        operations.push({ debut: existante.debut, fin: existante.fin, col: ch.col, xml: celluleXml(ref, couleur ? styleFinal(s || "0") : s, ch, idx, px) });
      } else {
        const suivante = l.cellules.find((c) => c.col > ch.col);
        const pos = suivante ? suivante.debut : contenu.length;
        operations.push({ debut: pos, fin: pos, col: ch.col, xml: celluleXml(ref, styleFinal(styleLigne), ch, idx, px) });
      }
    }
    if (couleur) {
      for (let col = 1; col <= analyse.nbColonnes; col++) {
        if (changees.has(col)) continue;
        const existante = l.cellules.find((c) => c.col === col);
        if (existante) {
          const xml = existante.xml.replace(/^<(?:[\w.-]+:)?c\b[^>]*?(?=\/?>)/, (ouverture) => avecAttribut(ouverture, "s", styleFinal(attribut(existante.attrs, "s") || "0")));
          operations.push({ debut: existante.debut, fin: existante.fin, col, xml });
        } else {
          const suivante = l.cellules.find((c) => c.col > col);
          const pos = suivante ? suivante.debut : contenu.length;
          operations.push({ debut: pos, fin: pos, col, xml: `<${px}c r="${lettresColonne(col)}${l.numero}" s="${styleFinal(styleLigne)}"/>` });
        }
      }
    }
    operations.sort((a, b) => b.debut - a.debut || b.fin - a.fin || b.col - a.col);
    for (const o of operations) contenu = contenu.slice(0, o.debut) + o.xml + contenu.slice(o.fin);
    const ouverture = l.xml.endsWith("/>") ? `${l.xml.slice(0, -2)}>` : l.ouverture;
    xmlFeuille = xmlFeuille.slice(0, l.debut) + ouverture + contenu + (l.fermeture || `</${px}row>`) + xmlFeuille.slice(l.fin);
  }
  remplacer(cheminFeuille, xmlFeuille);
  if (xmlChaines != null && referencesChaines) {
    const ajout = sst.slice(sst.length - ajoutsChaines).map((t) => `<${pxs}si><${pxs}t>${xmlEchapper(t)}</${pxs}t></${pxs}si>`).join("");
    xmlChaines = xmlChaines.replace(/<((?:[\w.-]+:)?)sst\b([^>]*)>/, (m, prefixe, attrs) => {
      let a = attrs;
      const compte = attribut(a, "count");
      const uniques = attribut(a, "uniqueCount");
      if (compte != null) a = a.replace(/\bcount="\d+"/, `count="${Number(compte) + referencesChaines}"`);
      if (uniques != null) a = a.replace(/\buniqueCount="\d+"/, `uniqueCount="${Number(uniques) + ajoutsChaines}"`);
      return `<${prefixe}sst${a}>`;
    });
    if (ajoutsChaines) xmlChaines = xmlChaines.replace(/<\/((?:[\w.-]+:)?)sst>\s*$/, (_m, prefixe) => `${ajout}</${prefixe}sst>`);
    remplacer(cheminChaines, xmlChaines);
  }
  // Un .xlsx ne peut pas être déclaré « classeur à macros » (l'extraction arrive en .xlsm, sans macro).
  const types = parties.find(([n]) => n === "[Content_Types].xml");
  if (!types) throw new Error("classeur sans [Content_Types].xml");
  const texteTypes = new TextDecoder("utf-8").decode(types[1]);
  if (texteTypes.includes(TYPE_CLASSEUR_MACROS)) remplacer("[Content_Types].xml", texteTypes.split(TYPE_CLASSEUR_MACROS).join(TYPE_CLASSEUR));
  return ecrireZip(parties);
}

// Relit le fichier écrit et le compare à l'original : toutes les cellules identiques sauf les cellules prévues,
// mêmes lignes, même onglet, le reste de la feuille et toutes les autres parties du classeur identiques.
// Sinon : rien n'est enregistré.
async function verifierLanCorrige(octetsOrigine, octetsCorriges, plan) {
  const changements = plan.changements;
  const marques = plan.marques || new Map();
  const a = await analyserExtraction(octetsOrigine);
  const b = await analyserExtraction(octetsCorriges);
  const erreurs = [];
  // Styles : ceux d'origine gardés à la même place ; seuls des remplissages et des styles s'ajoutent à la fin.
  const sa = a.xmlStyles ? lireStyles(a.xmlStyles) : null;
  const sb = b.xmlStyles ? lireStyles(b.xmlStyles) : null;
  if (sa && sb) {
    if (sa.reste !== sb.reste || sa.fills.some((x, i) => sb.fills[i] !== x) || sa.xfs.some((x, i) => sb.xfs[i] !== x)) erreurs.push("styles du classeur");
  } else if (marques.size) erreurs.push("styles du classeur");
  // Une cellule d'une ligne marquée : même style qu'avant, avec la couleur de la ligne en plus.
  const styleMarqueJuste = (sOrigine, sNouveau, couleur) => {
    const xa = sa && (sa.xfs[Number(sOrigine || 0)] || null);
    const xb = sb && (sb.xfs[Number(sNouveau || 0)] || null);
    if (!xa || !xb || sansRemplissage(xa) !== sansRemplissage(xb)) return false;
    return couleurRemplissage(sb.fills[Number((xb.match(/\bfillId="(\d+)"/) || [])[1])]) === couleur;
  };
  const valeurs = (an) => {
    const m = new Map();
    for (const l of an.lignes) for (const c of l.cellules) m.set(`${l.numero}:${c.col}`, { v: c.valeur == null ? "" : String(c.valeur), s: attribut(c.attrs, "s"), f: c.formule });
    return m;
  };
  const va = valeurs(a);
  const vb = valeurs(b);
  const prevus = new Map(changements.map((ch) => [`${ch.ligne}:${ch.col}`, ch]));
  if (a.nomFeuille !== b.nomFeuille) erreurs.push("nom de l'onglet");
  // Mêmes lignes, dans le même ordre, avec les mêmes attributs.
  const ouvertures = (an) => an.lignes.map((l) => l.ouverture.replace(/\/>$/, ">")).join("\n");
  if (ouvertures(a) !== ouvertures(b)) erreurs.push("lignes");
  // Le reste de la feuille (colonnes, mise en page…) identique.
  const horsDonnees = (x) => x.slice(0, x.search(/<(?:[\w.-]+:)?sheetData\b/)) + x.slice(x.search(/<\/(?:[\w.-]+:)?sheetData>/));
  if (horsDonnees(a.xmlFeuille) !== horsDonnees(b.xmlFeuille)) erreurs.push("mise en forme de la feuille");
  const couleurDe = (k) => marques.get(Number(k.split(":")[0]));
  for (const [k, ch] of prevus) {
    const y = vb.get(k);
    const ok = y && !y.f && (ch.nombre ? Number(y.v) === Number(formatNombre(ch.apres)) : y.v === ch.apres);
    if (!ok) erreurs.push(`cellule ${k} mal écrite`);
    else if (couleurDe(k) && va.has(k) && !styleMarqueJuste(va.get(k).s, y.s, couleurDe(k))) erreurs.push(`couleur de la cellule ${k}`);
  }
  for (const [k, x] of va) {
    if (prevus.has(k)) continue;
    const y = vb.get(k);
    const couleur = couleurDe(k) && Number(k.split(":")[1]) <= a.nbColonnes ? couleurDe(k) : null;
    if (!y || y.v !== x.v || y.f !== x.f) erreurs.push(`cellule ${k} changée`);
    else if (couleur ? !styleMarqueJuste(x.s, y.s, couleur) : y.s !== x.s) erreurs.push(`style de la cellule ${k} changé`);
  }
  for (const [k, y] of vb) {
    if (va.has(k) || prevus.has(k)) continue;
    // Seules des cellules vides colorées peuvent apparaître, dans les lignes marquées.
    const couleur = couleurDe(k) && Number(k.split(":")[1]) <= a.nbColonnes ? couleurDe(k) : null;
    const sb2 = sb && sb.xfs[Number(y.s || 0)];
    const ok = couleur && y.v === "" && !y.f && sb2 && couleurRemplissage(sb.fills[Number((sb2.match(/\bfillId="(\d+)"/) || [])[1])]) === couleur;
    if (!ok) erreurs.push(`cellule ${k} ajoutée`);
  }
  // Toutes les cellules (1 à la dernière colonne) des lignes marquées sont bien colorées.
  for (const [numero, couleur] of marques) {
    for (let col = 1; col <= a.nbColonnes; col++) {
      const y = vb.get(`${numero}:${col}`);
      const sb2 = y && sb && sb.xfs[Number(y.s || 0)];
      if (!sb2 || couleurRemplissage(sb.fills[Number((sb2.match(/\bfillId="(\d+)"/) || [])[1])]) !== couleur) erreurs.push(`ligne ${numero} pas entièrement colorée`);
    }
  }
  // Chaînes partagées : celles d'origine à la même place (une chaîne peut seulement s'ajouter à la fin).
  if (a.sst.some((x, i) => b.sst[i] !== x)) erreurs.push("chaînes du classeur");
  // Toutes les autres parties du classeur : identiques octet par octet.
  const noms = (an) => an.parties.map(([n]) => n).join("|");
  if (noms(a) !== noms(b)) erreurs.push("parties du classeur");
  for (const [n, octetsA] of a.parties) {
    const pb = b.parties.find(([x]) => x === n);
    if (n === a.cheminFeuille || n === a.cheminChaines || (n === a.cheminStyles && sa) || !pb) continue;
    let xa = octetsA;
    const xb = pb[1];
    if (n === "[Content_Types].xml") {
      // Seul changement permis : le type « classeur à macros » devient « classeur » (sinon : octets identiques).
      const texte = new TextDecoder().decode(xa);
      if (texte.includes(TYPE_CLASSEUR_MACROS)) xa = new TextEncoder().encode(texte.split(TYPE_CLASSEUR_MACROS).join(TYPE_CLASSEUR));
    }
    if (xa.length !== xb.length || xa.some((o, i) => o !== xb[i])) erreurs.push(`partie ${n} changée`);
  }
  if (erreurs.length) throw new Error(`vérification du fichier corrigé : ${erreurs.slice(0, 5).join(", ")}`);
}

// Nom réel du lancement : LAN + année + semaine + tour/type (ou nom du chantier).
function nomLancementReecrit(reglage) {
  const type = TYPES_REECRITURE.find((t) => t.id === reglage.type);
  const aa = String(reglage.annee || "").padStart(2, "0").slice(-2);
  const ss = String(reglage.semaine || "").padStart(2, "0");
  if (!type || !/^\d{2}$/.test(aa) || !/^\d{2}$/.test(ss) || Number(ss) < 1 || Number(ss) > 53) return null;
  if (type.suffixe) return `LAN${aa}${ss}${type.suffixe}.xlsx`;
  const chantier = String(reglage.chantier || "").trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ");
  return chantier ? `LAN${aa}${ss}${chantier}.xlsx` : null;
}

// ---- Dossier des semaines ----

const nomDossierSemaine = (ss) => `Semaine ${String(ss).padStart(2, "0")}`;
const memeNomDossier = (a, b) => a.trim().toLocaleUpperCase("fr") === b.trim().toLocaleUpperCase("fr");

// Numéro de semaine d'un nom de dossier : « Semaine 46 », « SEMAINE 46 - 2026 », « Sem 46 », « S46 » → 46 ; sinon null.
function numeroDossierSemaine(nom) {
  const m = /^(?:semaine|sem\.?|s)\s*0*(\d{1,2})(?!\d)/i.exec(String(nom).trim());
  return m ? Number(m[1]) : null;
}

// Les dossiers de la semaine sous le dossier choisi (jusqu'à 4 niveaux : année / mois / semaine…).
// On ne descend pas dans les dossiers des autres semaines.
async function chercherDossiersSemaine(racine, semaine, profondeur = 4, chemin = []) {
  const trouves = [];
  for await (const [nom, entree] of racine.entries()) {
    if (entree.kind !== "directory") continue;
    const n = numeroDossierSemaine(nom);
    if (n === Number(semaine)) trouves.push({ dossier: entree, chemin: [...chemin, nom] });
    else if (n === null && profondeur > 1) trouves.push(...(await chercherDossiersSemaine(entree, semaine, profondeur - 1, [...chemin, nom])));
  }
  return trouves;
}

async function sousDossier(parent, nom) {
  for await (const [n, entree] of parent.entries()) if (entree.kind === "directory" && memeNomDossier(n, nom)) return { dossier: entree, nom: n, cree: false };
  return { dossier: await parent.getDirectoryHandle(nom, { create: true }), nom, cree: true };
}

// Le vrai nom du fichier s'il existe déjà dans le dossier (majuscules ou non), sinon null.
async function fichierExistant(dossier, nom) {
  for await (const [n, entree] of dossier.entries()) if (entree.kind === "file" && n.toLocaleUpperCase("fr") === nom.toLocaleUpperCase("fr")) return n;
  return null;
}

// ---- L'onglet ----

const reecriture = {
  racine: null, // dossier des semaines (choisi une fois, gardé dans le navigateur)
  chargee: false,
  fichier: null, // { nom, octets }
  analyse: null,
  erreur: null,
  reglage: { semaine: "", annee: "", type: "", chantier: "" },
  etat: null, // { lignes, erreur }
  enCours: false,
};

async function chargerReecriture() {
  if (reecriture.chargee) return;
  reecriture.chargee = true;
  if (typeof window.showDirectoryPicker === "function") reecriture.racine = await chargerPoigneeDossierPartage("reecriture");
}

function afficherBlocage(titre, message) {
  const annuler = $("modaleConfirmationAnnuler");
  annuler.hidden = true;
  return demanderConfirmation(titre, message, "OK").finally(() => (annuler.hidden = false));
}

async function choisirRacineReecriture() {
  try {
    const handle = await window.showDirectoryPicker({ id: "reecriture", mode: "readwrite" });
    reecriture.racine = handle;
    await sauvegarderPoigneeDossierPartage(handle, "reecriture");
  } catch (_annulation) {
    return;
  }
  reecriture.etat = null;
  afficherReecriture();
  majMenuDossier();
}

async function fichierExtractionChoisi(fichier) {
  if (!fichier) return;
  reecriture.etat = null;
  reecriture.erreur = null;
  reecriture.analyse = null;
  try {
    const octets = new Uint8Array(await fichier.arrayBuffer());
    reecriture.fichier = { nom: fichier.name, octets };
    reecriture.analyse = await analyserExtraction(octets);
    const m = reecriture.analyse.nomFeuille.match(/^LAN(\d{2})(\d{2})/i);
    if (m) {
      reecriture.reglage.annee = m[1];
      reecriture.reglage.semaine = m[2];
    }
  } catch (erreur) {
    reecriture.erreur = erreur && erreur.message ? erreur.message : String(erreur);
  }
  afficherReecriture();
}

async function lancerReecriture() {
  if (reecriture.enCours) return;
  const r = reecriture.reglage;
  const type = TYPES_REECRITURE.find((t) => t.id === r.type);
  const nom = nomLancementReecrit(r);
  if (!reecriture.analyse || !type || !nom || !reecriture.racine) return;
  reecriture.enCours = true;
  const etat = (lignes, erreur = false) => {
    reecriture.etat = { lignes, erreur };
    afficherReecriture();
  };
  try {
    const racine = reecriture.racine;
    if (racine.queryPermission && (await racine.queryPermission({ mode: "readwrite" })) !== "granted") {
      if ((await racine.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("accès au dossier refusé");
    }
    const ss = String(r.semaine).padStart(2, "0");
    // Le dossier choisi peut être directement celui de la semaine : on range dedans.
    const numeroRacine = numeroDossierSemaine(racine.name);
    // Le dossier choisi est celui d'une autre semaine : on peut y ranger quand même le lancement (dérogation : ex.
    // une FENO en retard de la semaine 46 fabriquée en semaine 47). Sinon, rien n'est enregistré.
    let derogation = false;
    if (numeroRacine !== null && numeroRacine !== Number(ss)) {
      derogation = await demanderConfirmation(
        "Le dossier choisi est une autre semaine",
        `Le lancement est de la semaine ${Number(ss)}, le dossier choisi est « ${racine.name} » (semaine ${numeroRacine}).\n\nLe ranger quand même en semaine ${numeroRacine} (dérogation) ? Le nom et le contenu du fichier ne changent pas ; Sentinelle le contrôlera en semaine ${numeroRacine}.`,
        `Ranger en semaine ${numeroRacine}`
      );
      if (!derogation) {
        etat(["Rien n'a été enregistré : le dossier choisi est une autre semaine."], true);
        return;
      }
    }
    const semaines = numeroRacine === Number(ss) || derogation ? [{ dossier: racine, chemin: [] }] : await chercherDossiersSemaine(racine, ss);
    let dossierSemaine;
    let cheminSemaine;
    if (semaines.length > 1) {
      await afficherBlocage("Plusieurs dossiers pour cette semaine", `Il y a ${semaines.length} dossiers « ${nomDossierSemaine(ss)} » dans « ${racine.name} » :\n${semaines.map((s) => s.chemin.join(" / ")).join("\n")}\n\nChoisissez un dossier des semaines plus précis (par exemple celui de l'année). Rien n'a été enregistré.`);
      etat(["Rien n'a été enregistré."], true);
      return;
    }
    // Les dossiers des semaines existent déjà : Sentinelle n'en crée jamais.
    if (semaines.length === 0) {
      await afficherBlocage(
        "Dossier de la semaine introuvable",
        `Aucun dossier de la semaine ${Number(ss)} dans « ${racine.name} » ni dans ses sous-dossiers.\n\nSentinelle ne crée pas les dossiers des semaines. Changez le dossier des semaines (bouton « Changer ») : choisissez le dossier de la semaine ${Number(ss)}, ou celui qui contient les semaines. Rien n'a été enregistré.`
      );
      etat([`Rien n'a été enregistré : dossier de la semaine ${Number(ss)} introuvable dans « ${racine.name} ».`], true);
      return;
    }
    dossierSemaine = semaines[0].dossier;
    cheminSemaine = [racine.name, ...semaines[0].chemin];
    // Dans la semaine, le dossier du lancement (1ER TOUR AGGLO, FENO…) est créé s'il n'y est pas encore.
    const sous = await sousDossier(dossierSemaine, type.dossier);
    const chemin = [...cheminSemaine, sous.nom].join(" / ");
    // Le lancement existe déjà : on prévient, et on n'écrase que si c'est validé.
    const existant = await fichierExistant(sous.dossier, nom);
    if (existant && !(await demanderConfirmation("Le fichier existe déjà", `« ${existant} » existe déjà dans :\n${chemin}\n\nÉcraser ce lancement ? L'ancien fichier sera remplacé par le nouveau.`, "Écraser"))) {
      etat([`⚠ « ${existant} » existe déjà dans ${chemin} : rien n'a été enregistré.`], true);
      return;
    }
    // Les corrections sont refaites sur une copie neuve de l'extraction (l'analyse affichée reste intacte).
    const analyse = await analyserExtraction(reecriture.fichier.octets);
    const plan = planifierCorrections(analyse, type);
    const octets = await ecrireLanCorrige(analyse, plan);
    await verifierLanCorrige(reecriture.fichier.octets, octets, plan);
    const fh = await sous.dossier.getFileHandle(existant || nom, { create: true });
    const w = await fh.createWritable();
    await w.write(octets);
    await w.close();
    ajouterAuJournal(existant || nom, chemin);
    // Dérogation : « Contrôler la coupe » rangera ce lancement dans la semaine de son dossier.
    if (derogation) enregistrerDerogation(existant || nom, numeroRacine);
    etat([`✔ Enregistré${existant ? " (ancien fichier remplacé)" : ""} : ${chemin} / ${existant || nom}${derogation ? ` — rangé en semaine ${numeroRacine} (dérogation)` : ""}`, resumeCorrections(plan, type)]);
  } catch (erreur) {
    etat([`Réécriture impossible : ${erreur && erreur.message ? erreur.message : erreur}. Rien n'a été enregistré.`], true);
  } finally {
    reecriture.enCours = false;
    afficherReecriture();
  }
}

const lignesErreur = (plan, quoi) => new Set(plan.erreurs.filter((e) => e.quoi === quoi).map((e) => e.ligne)).size;

function resumeErreurs(plan) {
  const m = [];
  const surcotes = lignesErreur(plan, "surcote");
  const couleurs = lignesErreur(plan, "couleur");
  if (surcotes) m.push(`${surcotes} ligne(s) avec une surcote de plus de ${SURCOTE_MAX} mm`);
  if (couleurs) m.push(`${couleurs} ligne(s) sans couleur en belle face`);
  return m.length ? ` Erreurs à vérifier (lignes en rouge) : ${m.join(" ; ")}.` : "";
}

function resumeCorrections(plan, type) {
  return resumeCorrectionsSeules(plan, type) + resumeErreurs(plan);
}

function resumeCorrectionsSeules(plan, type) {
  if (type.agglo) {
    const m = [];
    if (plan.pieces.bandes.size) m.push(`${plan.pieces.bandes.size} pièce(s) mise(s) à la largeur d'une autre pour partager une bande (lignes en jaune)`);
    if (plan.pieces.cred14.size) m.push(`RCB-CRED14 en sous-face sur ${plan.pieces.cred14.size} crédence(s) en 10 / 12 brut`);
    if (plan.pieces.portes.size) m.push(`RCB_B999_PORTES remplacé par RCB_0003_PORTES sur ${plan.pieces.portes.size} ligne(s) (lignes en orange)`);
    if (plan.pieces.baz.size) m.push(`BAZ en commentaire sur ${plan.pieces.baz.size} ligne(s) avec usinage`);
    if (plan.pieces.brut.size) m.push(`« BRUT » retiré de la couleur sur ${plan.pieces.brut.size} ligne(s) (lignes en jaune)`);
    if (plan.pieces.chantBrut.size) m.push(`${plan.pieces.chantBrut.size} ligne(s) à chant brut surlignée(s) en jaune`);
    return m.length ? `Corrections : ${m.join(" ; ")}.` : "Aucune correction à faire dans ce fichier.";
  }
  if (!type.feno) return "Aucune correction automatique pour ce type de lancement : le fichier est enregistré tel quel, sous son vrai nom.";
  const morceaux = [];
  if (plan.pieces.retours.size) morceaux.push(`${plan.pieces.retours.size} pièce(s) avec retour LG / LD`);
  if (plan.pieces.rcb.size) morceaux.push(`RCB en sous-face sur ${plan.pieces.rcb.size} support(s) 10 brut`);
  if (plan.pieces.portes.size) morceaux.push(`RCB_B999_PORTES remplacé par RCB_0003_PORTES sur ${plan.pieces.portes.size} ligne(s) (lignes en orange)`);
  const jaunes = [...plan.marquesCorrections].filter(([ligne, c]) => c === COULEUR_PLUS_10 && !plan.pieces.lignesPortes.has(ligne)).length;
  const oranges = [...plan.marquesCorrections].filter(([ligne, c]) => c === COULEUR_PLUS_20 && !plan.pieces.lignesPortes.has(ligne)).length;
  const couleurs = [jaunes ? `${jaunes} en jaune (+10)` : "", oranges ? `${oranges} en orange (+20)` : ""].filter(Boolean).join(", ");
  if (!morceaux.length) return "Aucune correction à faire dans ce fichier.";
  return `Corrections : ${morceaux.join(" ; ")}.${couleurs ? ` Lignes surlignées : ${couleurs}.` : ""}`;
}


// Les corrections du plan, une ligne par sorte : marque (couleur de la ligne dans le LAN), texte, nombre.
function lignesCorrections(plan, type) {
  const lignes = [];
  const ajouter = (n, marque, genre, texte, unite) => {
    if (n) lignes.push({ marque, genre, texte, nombre: `${n} ${unite}${n > 1 ? "s" : ""}` });
  };
  const changements = (quoi) => plan.changements.filter((c) => c.quoi === quoi).length;
  ajouter(lignesErreur(plan, "surcote"), `+${SURCOTE_MAX}`, "rouge", `Erreur : surcote de plus de ${SURCOTE_MAX} mm (longueur ou largeur)`, "ligne");
  ajouter(lignesErreur(plan, "couleur"), "couleur", "rouge", "Erreur : belle face sans couleur", "ligne");
  if (type.feno) {
    const jaunes = [...plan.marquesCorrections].filter(([ligne, c]) => c === COULEUR_PLUS_10 && !plan.pieces.lignesPortes.has(ligne)).length;
    ajouter(jaunes, "+10", "jaune", "Retour LG / LD : cote finie +10", "ligne");
    ajouter([...plan.marquesCorrections].filter(([ligne, c]) => c === COULEUR_PLUS_20 && !plan.pieces.lignesPortes.has(ligne)).length, "+20", "orange", "Deux retours : cote finie +20", "ligne");
    ajouter(changements("débit"), "débit", "neutre", "Débit refait : cote finie +55 (FENO) ou +50", "ligne");
    ajouter(changements("sous-face") - plan.pieces.portes.size, "RCB", "neutre", "RCB en sous-face sous le 10 brut", "ligne");
    ajouter(plan.pieces.portes.size, "PORTES", "orange", "RCB_B999_PORTES remplacé par RCB_0003_PORTES", "ligne");
  } else if (type.agglo) {
    ajouter(plan.pieces.bandes.size, "bande", "jaune", "Largeur harmonisée pour coupler des pièces en bande (6 cm et 4060 mm max)", "pièce");
    ajouter(plan.pieces.brut.size, "BRUT", "jaune", "« BRUT » retiré de la couleur", "ligne");
    ajouter(plan.pieces.chantBrut.size, "chant", "jaune", "Chant brut : ligne surlignée", "ligne");
    ajouter(plan.pieces.cred14.size, "CRED", "neutre", "RCB-CRED14 sous les crédences 10 / 12 brut", "crédence");
    ajouter(plan.pieces.baz.size, "BAZ", "neutre", "BAZ ajouté (usinage sans commentaire)", "ligne");
    ajouter(plan.pieces.portes.size, "PORTES", "orange", "RCB_B999_PORTES remplacé par RCB_0003_PORTES", "ligne");
  }
  return lignes;
}

function peutReecrire() {
  return Boolean(reecriture.analyse && nomLancementReecrit(reecriture.reglage) && reecriture.racine && !reecriture.enCours);
}

function apercuReecriture() {
  const r = reecriture.reglage;
  const type = TYPES_REECRITURE.find((t) => t.id === r.type);
  const nom = nomLancementReecrit(r);
  const a = reecriture.analyse;
  const plan = a && type ? planifierCorrections(a, type) : null;
  const fleche = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
  const racine = reecriture.racine;
  // Dossier choisi = directement la semaine : pas de « Semaine NN » en plus dans le chemin.
  const racineEstSemaine = racine && numeroDossierSemaine(racine.name) !== null;
  const morceaux = [racine ? racine.name : "Dossier des semaines", ...(racineEstSemaine ? [] : [r.semaine ? nomDossierSemaine(r.semaine) : "Semaine ?"]), type ? type.dossier : "?"];
  let html = `<div class="fichier-cree">
    <div class="petit">Nom</div>
    <div class="nom-fichier" id="reecNom">${nom ? echapper(nom) : "—"}</div>
    <div class="petit">Rangé dans</div>
    <div class="chemin-fichier" id="reecChemin">${morceaux.map((m) => `<span>${echapper(m)}</span>`).join(fleche)}</div>
  </div>`;
  if (!type) return html + '<div class="note">Choisissez le type de lancement.</div>';
  if (type.id === "chantier" && !nom) html += '<div class="note">Tapez le nom du chantier.</div>';
  html += '<div class="titre-corrections">Ce que Sentinelle corrige</div>';
  if (!plan) return html + `<div class="note">${a ? "" : "Déposez d'abord le fichier d'extraction."}</div>`;
  const lignes = lignesCorrections(plan, type);
  if (lignes.length)
    html += `<div class="liste-corrections">${lignes
      .map((l) => `<div class="ligne-correction"><span class="marque ${l.genre}">${echapper(l.marque)}</span><span class="texte-correction">${echapper(l.texte)}</span><span class="nombre-correction">${echapper(l.nombre)}</span></div>`)
      .join("")}</div>`;
  else html += `<div class="note">${type.agglo || type.feno ? "Aucune correction à faire dans ce fichier." : "Aucune correction pour ce type : le fichier est rangé tel quel, sous son vrai nom."}</div>`;
  if (plan.erreurs.length) {
    html += `<details class="donnees"><summary>Voir les lignes en rouge (${new Set(plan.erreurs.map((e) => e.ligne)).size})</summary><div class="defile"><table class="recap"><thead><tr><th>Pièce</th><th>Matière</th><th>Ligne</th><th>Erreur</th></tr></thead><tbody>${plan.erreurs
      .map((e, i) => `<tr class="${i % 2 ? "impaire" : ""}"><td>${echapper(e.cle)}</td><td>${echapper(e.agglo)}</td><td>${e.ligne}</td><td>${echapper(e.quoi === "surcote" ? `Surcote : ${e.detail}` : "Belle face sans couleur")}</td></tr>`)
      .join("")}</tbody></table></div></details>`;
  }
  if (plan.avertissements.length) html += `<div class="avertissement-reecriture">${plan.avertissements.map((t) => `<div>⚠ ${echapper(t)}</div>`).join("")}</div>`;
  if (plan.changements.length) {
    html += `<details class="donnees"><summary>Voir les cellules corrigées (${plan.changements.length})</summary><div class="defile"><table class="recap"><thead><tr><th>Pièce</th><th>Matière</th><th>Cellule</th><th class="droite">Avant</th><th class="droite">Après</th></tr></thead><tbody>${plan.changements
      .map((ch, i) => `<tr class="${i % 2 ? "impaire" : ""}"><td>${echapper(ch.cle)}</td><td>${echapper(ch.agglo)}</td><td>${echapper(ch.quoi)} (${lettresColonne(ch.col)}${ch.ligne})</td><td class="droite">${ch.avant == null ? "vide" : echapper(formatNombre(ch.avant))}</td><td class="droite"><strong>${echapper(ch.nombre ? formatNombre(ch.apres) : ch.apres)}</strong></td></tr>`)
      .join("")}</tbody></table></div></details>`;
  }
  return html;
}

function majApercuReecriture() {
  const zone = $("reecApercu");
  if (zone) zone.innerHTML = apercuReecriture();
  const bouton = $("btnReecrire");
  if (bouton) bouton.disabled = !peutReecrire();
  const etat = $("reecEtat");
  if (etat && !reecriture.etat) etat.remove();
}

function afficherReecriture() {
  const page = $("pageReecriture");
  if (!page) return;
  if (!reecriture.chargee) {
    chargerReecriture().then(afficherReecriture);
    return;
  }
  const entete = entetePage("Réécriture", "Préparer un lancement", "L'extraction du logiciel de gestion devient le fichier LAN, corrigé et rangé dans la bonne semaine.");
  if (typeof window.showDirectoryPicker !== "function") {
    page.innerHTML = `${entete}<div class="carte"><div class="note">La préparation des lancements se fait sur le PC : ouvrez la page dans Chrome ou Edge.</div></div>`;
    return;
  }
  const r = reecriture.reglage;
  const a = reecriture.analyse;
  const numero = (n) => `<span class="numero-etape">${n}</span>`;
  const icone = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>';
  page.innerHTML = `${entete}
  <div class="reec-colonnes">
    <div class="reec-gauche">
      <section class="carte">
        <h2 class="titre-etape">${numero(1)}L'extraction</h2>
        <div class="zone-depot ${reecriture.fichier ? "pleine" : ""}" id="zoneExtraction">
          <span class="icone-depot">${icone}</span>
          <div class="textes-depot">
            ${
              reecriture.fichier
                ? `<div class="nom-depot">${echapper(reecriture.fichier.nom)}</div><div class="note">${a ? `Onglet ${echapper(a.nomFeuille)} · ${a.donnees.length} ligne(s)` : ""}</div>`
                : '<div class="nom-depot">Glissez le fichier d\'extraction ici</div><div class="note">ou cliquez sur « Choisir le fichier » (.xlsm, .xlsx)</div>'
            }
          </div>
          <button type="button" class="contour" id="btnExtraction">${reecriture.fichier ? "Changer de fichier" : "Choisir le fichier"}</button>
        </div>
        <input type="file" id="choixExtraction" accept=".xlsx,.xlsm" hidden>
        ${reecriture.erreur ? `<div class="compte-rendu erreur">Fichier illisible : ${echapper(reecriture.erreur)}</div>` : ""}
      </section>
      <section class="carte">
        <h2 class="titre-etape">${numero(2)}Le lancement</h2>
        <div class="formulaire-reecriture">
          <label>Semaine<input type="number" id="reecSemaine" min="1" max="53" value="${echapper(r.semaine)}"></label>
          <label>Année<input type="number" id="reecAnnee" min="0" max="99" value="${echapper(r.annee)}"></label>
        </div>
        <div class="petit-titre" id="libelleTypes">Type de lancement</div>
        <div class="choix-types" role="group" aria-labelledby="libelleTypes">
          ${TYPES_REECRITURE.map((t) => `<button type="button" class="type-btn ${t.id === r.type ? "choisi" : ""}" data-type="${t.id}" aria-pressed="${t.id === r.type}"><span class="type-libelle">${t.libelle}</span><span class="type-dossier">${t.dossier}</span></button>`).join("")}
        </div>
        ${r.type === "chantier" ? `<div class="formulaire-reecriture"><label class="large">Nom du chantier<input type="text" id="reecChantier" value="${echapper(r.chantier)}" placeholder="Nom du chantier"></label></div>` : ""}
      </section>
    </div>
    <aside class="reec-droite carte" aria-label="Le fichier créé">
      <h2 class="titre-etape">${numero(3)}Le fichier créé</h2>
      <div id="reecApercu">${apercuReecriture()}</div>
      <div class="ligne-dossier-semaines">
        <span>Dossier des semaines : <strong>${reecriture.racine ? echapper(reecriture.racine.name) : "aucun dossier choisi"}</strong></span>
        <button type="button" class="contour" id="btnRacineReecriture">${reecriture.racine ? "Changer" : "Choisir le dossier des semaines"}</button>
      </div>
      <div class="note note-cadenas">Rien n'est ajouté au fichier : seules les cases corrigées changent. Si le fichier existe déjà, Sentinelle demande avant de l'écraser.</div>
      <button type="button" class="bouton-creer" id="btnReecrire" ${peutReecrire() ? "" : "disabled"}>${reecriture.enCours ? "Enregistrement…" : "Créer le fichier"}</button>
      ${!reecriture.racine && a ? '<div class="note">Choisissez d\'abord le dossier des semaines.</div>' : ""}
      ${reecriture.etat ? `<div id="reecEtat" class="compte-rendu ${reecriture.etat.erreur ? "erreur" : "reussi"}">${reecriture.etat.lignes.map(echapper).join("<br>")}</div>` : ""}
    </aside>
  </div>`;
  $("btnRacineReecriture").addEventListener("click", choisirRacineReecriture);
  $("btnExtraction").addEventListener("click", () => $("choixExtraction").click());
  $("choixExtraction").addEventListener("change", (e) => fichierExtractionChoisi(e.target.files && e.target.files[0]));
  // Le fichier peut aussi être glissé sur la zone.
  const zone = $("zoneExtraction");
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("survol");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("survol"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("survol");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) fichierExtractionChoisi(f);
  });
  // Semaine, année, chantier : l'aperçu suit la frappe ; le type redessine l'écran (champ du chantier).
  const maj = (champ, cle) => {
    const el = $(champ);
    if (!el) return;
    el.addEventListener("input", () => {
      reecriture.reglage[cle] = el.value.trim();
      reecriture.etat = null;
      majApercuReecriture();
    });
  };
  maj("reecSemaine", "semaine");
  maj("reecAnnee", "annee");
  maj("reecChantier", "chantier");
  page.querySelectorAll(".type-btn").forEach((b) =>
    b.addEventListener("click", () => {
      reecriture.reglage.type = b.dataset.type;
      reecriture.etat = null;
      afficherReecriture();
      const champ = $("reecChantier");
      if (champ && !champ.value) champ.focus();
    })
  );
  $("btnReecrire").addEventListener("click", lancerReecriture);
}
