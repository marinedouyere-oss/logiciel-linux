// ---- bkp_reader (Contrôle Scies) ----
//
// Le fichier .bkp est une sauvegarde ZIP complète du logiciel d'optimisation
// V12 Laisne. Elle contient, entre autres, un fichier <lancement>.ctt "maître"
// qui liste, pour chaque pièce réellement placée sur un panneau, une entrée
// CSV (lignes PNL1/PNL2/PNL3). Ce contrôle compare ce que le logiciel
// d'optimisation a effectivement traité à ce que le fichier de lancement
// attendait, pour détecter une pièce oubliée pendant l'optimisation.
//
// Deux pièges identifiés en analysant manuellement plusieurs .bkp réels
// (voir historique) :
// - chaque pièce réelle apparaît sous DEUX repères ("trace") au moins :
//   "TC" (référence catalogue/matériau — la seule source fiable de quantité)
//   et "TF" (référence à son placement sur un panneau donné). Ne prendre que
//   "TC" et sommer TOUTES ses occurrences par pièce (un même repère "TC"
//   peut apparaître plusieurs fois, une fois par bande qui l'utilise).
// - les bandes/chants découpés en longueur (matériau type "CRED14") génèrent
//   des enregistrements "modulo" techniques (nom "T9/1", "LT9/1"...) qui ne
//   sont jamais de vraies pièces à compter : à exclure systématiquement.

const MOTIF_BANDE_MODULO = /^L?T\d+\/\d+$/;

// Repère et décode le répertoire central d'une archive ZIP (implémentation
// minimale : lecture seule, méthodes "stocké" et "deflate" uniquement —
// suffisant pour les .bkp V12 Laisne — pour éviter d'ajouter une librairie
// externe au bundle).
async function listerEntreesZip(bytes) {
  const vue = new DataView(bytes);
  const taille = bytes.byteLength;
  let finPos = -1;
  const debutRecherche = Math.max(0, taille - 22 - 65536);
  for (let i = taille - 22; i >= debutRecherche; i--) {
    if (vue.getUint32(i, true) === 0x06054b50) {
      finPos = i;
      break;
    }
  }
  if (finPos === -1) {
    throw new Error("Archive .bkp invalide (fin de répertoire central introuvable).");
  }
  const nbEntrees = vue.getUint16(finPos + 10, true);
  let offsetCentral = vue.getUint32(finPos + 16, true);

  const entrees = [];
  const decodeur = new TextDecoder("utf-8");
  for (let i = 0; i < nbEntrees; i++) {
    if (vue.getUint32(offsetCentral, true) !== 0x02014b50) break;
    const methode = vue.getUint16(offsetCentral + 10, true);
    const tailleCompressee = vue.getUint32(offsetCentral + 20, true);
    const tailleReelle = vue.getUint32(offsetCentral + 24, true);
    const longueurNom = vue.getUint16(offsetCentral + 28, true);
    const longueurExtra = vue.getUint16(offsetCentral + 30, true);
    const longueurCommentaire = vue.getUint16(offsetCentral + 32, true);
    const offsetEnTeteLocal = vue.getUint32(offsetCentral + 42, true);
    const nomBytes = new Uint8Array(bytes, offsetCentral + 46, longueurNom);
    entrees.push({ nom: decodeur.decode(nomBytes), methode, tailleCompressee, tailleReelle, offsetEnTeteLocal });
    offsetCentral += 46 + longueurNom + longueurExtra + longueurCommentaire;
  }
  return entrees;
}

// Extrait et décompresse (si besoin) le contenu d'une entrée ZIP.
async function extraireEntreeZip(bytes, entree) {
  const vue = new DataView(bytes);
  const base = entree.offsetEnTeteLocal;
  if (vue.getUint32(base, true) !== 0x04034b50) {
    throw new Error("En-tête local ZIP invalide.");
  }
  const longueurNom = vue.getUint16(base + 26, true);
  const longueurExtra = vue.getUint16(base + 28, true);
  const debutDonnees = base + 30 + longueurNom + longueurExtra;
  const donneesCompressees = new Uint8Array(bytes, debutDonnees, entree.tailleCompressee);

  if (entree.methode === 0) return donneesCompressees.slice();
  if (entree.methode !== 8) {
    throw new Error(`Méthode de compression ZIP non supportée (code ${entree.methode}).`);
  }
  const flux = new Blob([donneesCompressees]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

// Trouve, dans l'archive .bkp, le fichier .ctt "maître" d'un lancement — les
// fichiers .ctt annexes (un par matériau ou par panneau) portent tous un
// suffixe "_xxx" après le nom du lancement ; le maître n'en a pas.
function trouverEntreeCttMaitre(entrees, nomLancement) {
  const candidats = entrees.filter((e) => /\.ctt$/i.test(e.nom));
  if (candidats.length === 0) {
    throw new Error("Aucun fichier .ctt trouvé dans l'archive .bkp.");
  }
  if (nomLancement) {
    const cible = candidats.find((e) => e.nom.split(/[/\\]/).pop().toLowerCase() === `${nomLancement.toLowerCase()}.ctt`);
    if (cible) return cible;
  }
  const sansSuffixe = candidats.filter((e) => !e.nom.split(/[/\\]/).pop().includes("_"));
  if (sansSuffixe.length >= 1) {
    return sansSuffixe.reduce((a, b) => (b.tailleReelle > a.tailleReelle ? b : a));
  }
  // Nom de lot avec « _ » (liste « LAN264801START_OPT ») : le maître est celui dont les autres .ctt sont les matières
  // (« LAN264801START_OPT_SAG10HYBR.ctt »).
  const base = (e) => e.nom.split(/[/\\]/).pop().replace(/\.ctt$/i, "").toLowerCase();
  const nbMatieres = (e) => candidats.filter((x) => x !== e && base(x).startsWith(`${base(e)}_`)).length;
  const maitre = candidats.reduce((a, b) => (nbMatieres(b) > nbMatieres(a) ? b : a));
  if (nbMatieres(maitre) > 0) return maitre;
  throw new Error("Fichier .ctt maître introuvable dans l'archive .bkp (tous les .ctt trouvés ont un suffixe).");
}

// Parse le contenu texte du .ctt maître et renvoie, par clé commande+ligne,
// la quantité de pièces réellement optimisées — voir notes ci-dessus sur le
// choix des repères "TC" et l'exclusion des bandes/modulos.
function lireQuantitesCtt(texte, sansProtections = false) {
  const lignes = texte.split(/\r?\n/);
  let pnl1Courant = null;
  let pnl2Courant = null;
  const pieces = new Map(); // id ("P123") -> { TC: [{nom, qte, cle}, ...] }

  for (const ligne of lignes) {
    if (ligne.startsWith("PNL1,")) {
      const c = ligne.split(",");
      pnl1Courant = { nom: c[1], materiau: c[2] || "", qte: parseInt(c[5], 10) || 0 };
    } else if (ligne.startsWith("PNL2,")) {
      const c = ligne.split(",");
      pnl2Courant = { cle: c[5] || "", agglo: c[9] || "" };
    } else if (ligne.startsWith("PNL3,")) {
      const m = /^PNL3,([A-Z]+\d+):(T[A-Z0-9]+):/.exec(ligne);
      if (m && pnl1Courant && pnl2Courant) {
        const [, id, type] = m;
        if (type !== "TC") continue;
        if (!pieces.has(id)) pieces.set(id, []);
        pieces.get(id).push({ ...pnl1Courant, ...pnl2Courant });
      }
    }
  }

  const qteParCle = new Map();
  for (const [id, entreesTC] of pieces) {
    if (!id.startsWith("P")) continue; // les identifiants "C<n>" sont des bandes/chutes, jamais des pièces
    // Les protections sont bien de vraies pièces (chacune a son propre
    // repère TC et sa propre quantité) : seules les bandes/modulos
    // techniques (jamais des pièces) sont à exclure ici.
    // Sans les protections (sansProtections) : pour comparer au fichier de
    // lancement, qui ne les compte pas, quand il n'y a pas de liste de coupe.
    const reelles = entreesTC.filter((e) => !(sansProtections && estProtection(e.materiau)) && !MOTIF_BANDE_MODULO.test(e.nom));
    if (reelles.length === 0) continue;
    const cle = reelles[0].cle;
    if (!cle) continue;
    const qte = reelles.reduce((s, e) => s + e.qte, 0);
    qteParCle.set(cle, (qteParCle.get(cle) || 0) + qte);
  }
  return qteParCle;
}

// Couleurs de stratifié présentes dans un .bkp : dessus (feuilles TF) et
// dessous (TB), avec le nombre de feuilles par couleur.
function couleursCtt(texte) {
  const dessus = new Map();
  const dessous = new Map();
  let materiau = null;
  let qte = 0;
  for (const ligne of texte.split(/\r?\n/)) {
    if (ligne.startsWith("PNL1,")) {
      const c = ligne.split(",");
      materiau = c[2] || "";
      qte = parseInt(c[5], 10) || 0;
    } else if (ligne.startsWith("PNL3,") && materiau) {
      const m = /^PNL3,([A-Z]+\d+):(T[A-Z0-9]+):/.exec(ligne);
      if (!m) continue;
      const face = m[2] === "TF" ? dessus : m[2] === "TB" ? dessous : null;
      if (!face) continue;
      const cle = materiau.trim();
      face.set(cle, (face.get(cle) || 0) + qte);
    }
  }
  return { dessus, dessous, sansStratifie: dessus.size === 0 && dessous.size === 0 };
}

function nomLancementBkp(nomFichier) {
  return nomFichier.replace(/_\d{4}-\d{2}-\d{2}.*$/i, "").replace(/\.bkp$/i, "");
}

// Texte du .ctt maître d'un .bkp, lu une seule fois par fichier.
const cacheTexteBkp = new WeakMap();
function texteCttBkp(fichier) {
  if (!cacheTexteBkp.has(fichier)) {
    const lecture = (async () => {
      const bytes = await fichier.arrayBuffer();
      const entrees = await listerEntreesZip(bytes);
      const entreeCtt = trouverEntreeCttMaitre(entrees, nomLancementBkp(fichier.name));
      const donnees = await extraireEntreeZip(bytes, entreeCtt);
      return new TextDecoder("iso-8859-1").decode(donnees);
    })();
    lecture.catch(() => cacheTexteBkp.delete(fichier));
    cacheTexteBkp.set(fichier, lecture);
  }
  return cacheTexteBkp.get(fichier);
}

// Quantités réellement optimisées par clé (protections comprises : Contrôle Scies).
// Quantités par clé, calculées une fois par fichier (avec et sans les panneaux de protection).
const cacheQuantitesBkp = new WeakMap();
function quantitesBkp(fichier, sansProtections) {
  if (!cacheQuantitesBkp.has(fichier)) cacheQuantitesBkp.set(fichier, {});
  const parVariante = cacheQuantitesBkp.get(fichier);
  if (!parVariante[sansProtections]) {
    parVariante[sansProtections] = texteCttBkp(fichier).then((texte) => lireQuantitesCtt(texte, sansProtections));
    parVariante[sansProtections].catch(() => delete parVariante[sansProtections]);
  }
  return parVariante[sansProtections];
}

async function lireBkp(fichier) {
  return new Map(await quantitesBkp(fichier, false));
}

// Quantités par clé sans les panneaux de protection (contrôle principal sans liste de coupe).
async function lireBkpSansProtections(fichier) {
  return new Map(await quantitesBkp(fichier, true));
}

async function lireCouleursBkp(fichier) {
  return couleursCtt(await texteCttBkp(fichier));
}

// Compare les quantités attendues (fichier de lancement) à celles réellement
// optimisées (extraites du .bkp) et renvoie la liste des écarts, triée.
function comparerScies(qteAttendueParCle, qteParCleBkp) {
  const cles = new Set([...qteAttendueParCle.keys(), ...qteParCleBkp.keys()]);
  const ecarts = [];
  for (const cle of cles) {
    const attendu = qteAttendueParCle.get(cle) || 0;
    const trouve = qteParCleBkp.get(cle) || 0;
    if (attendu !== trouve) ecarts.push({ cle, attendu, trouve });
  }
  ecarts.sort((a, b) => a.cle.localeCompare(b.cle));
  return ecarts;
}

// Quantité attendue par clé, pour le Contrôle Scies — délibérément
// différent de lireStrat() : ce dernier exclut les protections
// (estProtection) parce que le contrôle STRAT/liste de coupe a ses
// propres raisons historiques de le faire, mais une protection est une
// vraie pièce à envoyer en scie comme une autre, avec son propre repère
// dans le .bkp (voir lireQuantitesCtt) — elle doit compter ici.
function lireQuantitesAttenduesScies(workbook) {
  const { feuille, entetes } = trouverFeuilleEtEntetes(workbook);
  const idxCommande = entetes[COL_COMMANDE];
  const idxLigne = entetes[COL_LIGNE];
  const idxQte = entetes[COL_QTE];
  const idxCle = entetes[COL_CLE];

  const qteParCle = new Map();
  const nbLignes = feuille.rowCount || 0;
  for (let r = 2; r <= nbLignes; r++) {
    const row = feuille.getRow(r);
    if (!row || row.actualCellCount === 0) continue;

    const commandeRaw = cellValue(row.getCell(idxCommande));
    if (commandeRaw === null || commandeRaw === undefined) continue;
    const commande = String(commandeRaw).trim();

    const numeroLigne = cellValue(row.getCell(idxLigne));
    let cle = idxCle ? cellValue(row.getCell(idxCle)) : null;
    cle = cle !== null && cle !== undefined && String(cle).trim() !== "" ? String(cle).trim() : cleLigne(commande, numeroLigne);

    const qteRaw = cellValue(row.getCell(idxQte));
    const qteNum = toFloatOrNull(qteRaw) ?? 0;
    qteParCle.set(cle, (qteParCle.get(cle) || 0) + qteNum);
  }
  return qteParCle;
}

function sommeValeurs(map) {
  let total = 0;
  for (const v of map.values()) total += v;
  return total;
}
