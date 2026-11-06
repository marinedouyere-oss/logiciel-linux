// ---- Corrections du fichier de lancement ----
// Sentinelle écrit un NOUVEAU classeur (l'original n'est jamais modifié) où
// seules les lignes concernées changent ; tout le reste (mise en forme,
// autres colonnes, autres feuilles) est recopié tel quel.

// « LAN264601START.xlsx » → « LAN264601START_corrige.xlsx ».
const nomCorrige = (nom) => `${nom.replace(/\.[^.]*$/, "").replace(/_corrige$/, "")}_corrige.xlsx`;

// Lignes parfaitement identiques (même commande, ligne, article, quantité,
// lancement, agglo, semaine de livraison, dimensions, couleurs), comme les doublons signalés par le
// contrôle (lireStrat) ; protections exclues. La première de chaque groupe est gardée.
function doublonsLancement(workbook) {
  const { feuille, entetes } = trouverFeuilleEtEntetes(workbook);
  const brut = (r, nom) => {
    const c = entetes[nom];
    if (!c) return "";
    const v = cellValue(feuille.getRow(r).getCell(c));
    return v === null || v === undefined || v === "" ? "" : String(v);
  };
  const res = { feuille: feuille.name, lignes: new Set(), cles: [] };
  const premieres = new Set();
  for (let r = 2; r <= (feuille.rowCount || 0); r++) {
    const commande = brut(r, COL_COMMANDE).trim();
    if (!commande) continue;
    if (estProtection(brut(r, COL_AGGLO))) continue;
    const numeroLigne = entetes[COL_LIGNE] ? cellValue(feuille.getRow(r).getCell(entetes[COL_LIGNE])) : null;
    const qte = toFloatOrNull(brut(r, COL_QTE)) ?? 0;
    const signature = JSON.stringify([
      commande, numeroLigne === null || numeroLigne === undefined ? "" : String(numeroLigne), brut(r, COL_ARTICLE), qte,
      brut(r, COL_LANCEMENT), brut(r, COL_AGGLO).trim(), brut(r, COL_LIVSEM).trim(), brut(r, COL_LIVAN).trim(),
      ...COLONNES_SIGNATURE_DOUBLON.map((c) => brut(r, c).trim()),
    ]);
    if (!premieres.has(signature)) {
      premieres.add(signature);
      continue;
    }
    res.lignes.add(r);
    const cle = cleLigne(commande, numeroLigne);
    if (!res.cles.includes(cle)) res.cles.push(cle);
  }
  return res;
}

// Nouvelle position d'une ligne une fois les lignes supprimées (une ligne supprimée renvoie à celle d'avant).
function decalerLigne(ligne, supprimees) {
  let avant = 0;
  for (const s of supprimees) if (s < ligne) avant++;
  return ligne - avant - (supprimees.has(ligne) ? 1 : 0);
}

// Décale les références A1 d'un texte (formule, plage « A1:AK319 ») ; pas un nom de feuille ni une fonction.
const decalerReferences = (texte, supprimees) =>
  texte.replace(/(?<![A-Za-z0-9_.$'])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(!'])/g, (_m, d1, col, d2, ligne) => `${d1}${col}${d2}${decalerLigne(Number(ligne), supprimees)}`);

const decalerAttributs = (xml, supprimees) =>
  xml.replace(/\b(ref|sqref|activeCell|topLeftCell)="([^"]*)"/g, (_m, nom, valeur) => `${nom}="${decalerReferences(valeur, supprimees)}"`);

const decalerFormules = (xml, supprimees) =>
  xml.replace(/(<f\b)([^>]*?)(\/>|>([\s\S]*?)<\/f>)/g, (_m, debut, attributs, fin, texte) =>
    `${debut}${decalerAttributs(attributs, supprimees)}${texte === undefined ? fin : `>${decalerReferences(texte, supprimees)}</f>`}`);

// Feuille sans les lignes données ; les lignes suivantes remontent (références et plages suivent).
function supprimerLignesFeuille(xml, supprimees) {
  const debut = xml.indexOf("<sheetData");
  const fin = xml.indexOf("</sheetData>");
  if (debut < 0) throw new Error("Feuille sans données.");
  if (fin < 0) return xml;
  const donnees = xml.slice(debut, fin).replace(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g, (_m, attributs, _fin, contenu) => {
    const r = /\br="(\d+)"/.exec(attributs);
    if (!r) throw new Error("Ligne sans numéro dans la feuille : format non pris en charge.");
    const numero = Number(r[1]);
    if (supprimees.has(numero)) return "";
    const nouveau = decalerLigne(numero, supprimees);
    const attrs = attributs.replace(/\br="\d+"/, `r="${nouveau}"`);
    if (contenu === undefined) return `<row${attrs}/>`;
    const cellules = contenu.replace(/(<c\b[^>]*?\br=")([A-Z]{1,3})(\d+)(")/g, (_c, a, col, _l, b) => `${a}${col}${nouveau}${b}`);
    return `<row${attrs}>${decalerFormules(cellules, supprimees)}</row>`;
  });
  // Hors des lignes : dimension, filtre, fusions, mises en forme conditionnelles, sélection…
  return decalerAttributs(xml.slice(0, debut), supprimees) + donnees + decalerAttributs(xml.slice(fin), supprimees);
}

// ---- écriture d'une archive ZIP (compression « deflate ») ----

const TABLE_CRC32 = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(octets) {
  let c = 0xffffffff;
  for (let i = 0; i < octets.length; i++) c = TABLE_CRC32[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function ecrireZip(parties) {
  const encodeur = new TextEncoder();
  const morceaux = [];
  const central = [];
  let position = 0;
  for (const [nom, contenu] of parties) {
    const nomOctets = encodeur.encode(nom);
    const flux = new Blob([contenu]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const compresse = new Uint8Array(await new Response(flux).arrayBuffer());
    const crc = crc32(contenu);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // noms en UTF-8
    local.setUint16(8, 8, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, compresse.length, true);
    local.setUint32(22, contenu.length, true);
    local.setUint16(26, nomOctets.length, true);
    const entete = new DataView(new ArrayBuffer(46));
    entete.setUint32(0, 0x02014b50, true);
    entete.setUint16(4, 20, true);
    entete.setUint16(6, 20, true);
    entete.setUint16(8, 0x0800, true);
    entete.setUint16(10, 8, true);
    entete.setUint32(16, crc, true);
    entete.setUint32(20, compresse.length, true);
    entete.setUint32(24, contenu.length, true);
    entete.setUint16(28, nomOctets.length, true);
    entete.setUint32(42, position, true);
    morceaux.push(new Uint8Array(local.buffer), nomOctets, compresse);
    central.push(new Uint8Array(entete.buffer), nomOctets);
    position += 30 + nomOctets.length + compresse.length;
  }
  const tailleCentral = central.reduce((t, m) => t + m.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, parties.length, true);
  fin.setUint16(10, parties.length, true);
  fin.setUint32(12, tailleCentral, true);
  fin.setUint32(16, position, true);
  return new Uint8Array(await new Blob([...morceaux, ...central, new Uint8Array(fin.buffer)]).arrayBuffer());
}

// Recopie le classeur en supprimant des lignes d'une feuille.
async function supprimerLignesXlsx(octets, nomFeuille, supprimees) {
  const decodeur = new TextDecoder("utf-8");
  const encodeur = new TextEncoder();
  const parties = [];
  for (const e of await listerEntreesZip(octets)) if (!e.nom.endsWith("/")) parties.push([e.nom, await extraireEntreeZip(octets, e)]);
  const texte = (nom) => decodeur.decode(parties.find(([n]) => n === nom)[1]);
  const remplacer = (nom, contenu) => (parties.find((p) => p[0] === nom)[1] = encodeur.encode(contenu));
  const workbook = texte("xl/workbook.xml");
  const rels = texte("xl/_rels/workbook.xml.rels");
  const attribut = (balise, nom) => (new RegExp(`\\b${nom}="([^"]*)"`).exec(balise) || [])[1];
  const feuille = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((b) => attribut(b, "name") === nomFeuille);
  const id = feuille && attribut(feuille, "r:id");
  const relation = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((b) => attribut(b, "Id") === id);
  const cible = relation && attribut(relation, "Target");
  const chemin = cible && (cible.startsWith("/") ? cible.slice(1) : `xl/${cible}`);
  if (!chemin || !parties.some(([n]) => n === chemin)) throw new Error(`Feuille « ${nomFeuille} » introuvable dans le classeur.`);
  remplacer(chemin, supprimerLignesFeuille(texte(chemin), supprimees));
  // Noms définis (zone de filtre, zone d'impression…) de cette feuille.
  remplacer(
    "xl/workbook.xml",
    workbook.replace(/(<definedName\b[^>]*>)([^<]*)(<\/definedName>)/g, (_m, a, contenu, b) =>
      `${a}${contenu.includes(`${nomFeuille}!`) || contenu.includes(`'${nomFeuille}'!`) ? decalerReferences(contenu, supprimees) : contenu}${b}`)
  );
  // La chaîne de calcul cite des cellules : Excel la reconstruit si elle manque.
  const calc = parties.findIndex(([n]) => n === "xl/calcChain.xml");
  if (calc >= 0) {
    parties.splice(calc, 1);
    remplacer("xl/_rels/workbook.xml.rels", rels.replace(/<Relationship\b[^>]*calcChain[^>]*\/>/g, ""));
    remplacer("[Content_Types].xml", texte("[Content_Types].xml").replace(/<Override\b[^>]*calcChain[^>]*\/>/g, ""));
  }
  return ecrireZip(parties);
}

// Nouveau fichier de lancement sans les lignes en double (null s'il n'y en a pas).
async function lancementSansDoublons(fichier) {
  const octets = await fichier.arrayBuffer();
  const d = doublonsLancement(await classeurEnCache(fichier));
  if (!d.lignes.size) return { doublons: d, octets: null };
  return { doublons: d, octets: await supprimerLignesXlsx(octets, d.feuille, d.lignes) };
}
