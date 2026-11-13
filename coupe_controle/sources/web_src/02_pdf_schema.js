async function chargerClasseur(file) {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  let erreur = null;
  try {
    await workbook.xlsx.load(buffer);
    if (workbook.worksheets.length) return workbook;
  } catch (e) {
    erreur = e;
  }
  // Export brut du logiciel de gestion (balises « x:… », liens « /xl/… ») : relu après remise en forme,
  // en mémoire seulement (le fichier sur le disque ne change pas).
  let remis = null;
  try {
    remis = await classeurRemisEnForme(new Uint8Array(buffer));
  } catch (_e) {
    remis = null;
  }
  if (!remis) {
    if (erreur) throw erreur;
    return workbook;
  }
  const relu = new ExcelJS.Workbook();
  await relu.xlsx.load(remis);
  return relu;
}

// Parties XML écrites avec un préfixe (« <x:workbook xmlns:x=…> », « <ap:Properties> ») : le préfixe de la
// balise principale devient l'espace de noms par défaut ; liens absolus des .rels (« /xl/… ») rendus relatifs.
// Renvoie le classeur remis en forme (octets zip), ou null s'il n'y avait rien à changer.
async function classeurRemisEnForme(octets) {
  const parties = await partiesClasseur(octets);
  const lecteur = new TextDecoder("utf-8");
  const encodeur = new TextEncoder();
  let change = false;
  const nouvelles = parties.map(([nom, contenu]) => {
    if (!/\.(xml|rels)$/i.test(nom)) return [nom, contenu];
    const avant = lecteur.decode(contenu).replace(/^\uFEFF/, "");
    let t = avant;
    const racine = /^\s*(?:<\?xml[^>]*\?>)?\s*<([\w.-]+):[\w.-]+/.exec(t);
    if (racine) {
      const p = racine[1];
      const decl = new RegExp(`xmlns:${p}="([^"]*)"`).exec(t);
      const debut = t.slice(0, t.indexOf(">", racine[0].length) + 1);
      if (decl && !/\sxmlns="/.test(debut)) {
        t = t.replace(new RegExp(`<(/?)${p}:`, "g"), "<$1").replace(decl[0], `xmlns="${decl[1]}" ${decl[0]}`);
      }
    }
    if (/\.rels$/i.test(nom)) {
      const base = nom.replace(/(^|\/)_rels\/[^/]*$/, "");
      t = t.replace(/Target="\/([^"]*)"/g, (_m, cible) => `Target="${cheminRelatif(base, cible)}"`);
    }
    if (t === avant) return [nom, contenu];
    change = true;
    return [nom, encodeur.encode(t)];
  });
  return change ? ecrireZip(nouvelles) : null;
}

// « xl » + « xl/worksheets/sheet1.xml » → « worksheets/sheet1.xml » ; « » + « xl/workbook.xml » → « xl/workbook.xml ».
function cheminRelatif(base, cible) {
  const b = base ? base.split("/") : [];
  const c = cible.split("/");
  let i = 0;
  while (i < b.length && i < c.length - 1 && b[i] === c[i]) i++;
  return [...Array(b.length - i).fill(".."), ...c.slice(i)].join("/");
}


// ---- lecture PDF (liste de coupe exportée en PDF depuis Cutrite) ----
// Alternative à l'Excel/copier-coller manuel : ce PDF liste, pour chaque
// pièce, une ligne "N°. Description  Code matériau  Long.  Largeur  Qté..."
// suivie d'un paragraphe de champs numérotés ("1.Lancement ...,
// 2.Numero commande ..., 5.num commande+ligne ..., 18.Grain matching ...").
// Contrairement à l'Excel, tout est explicitement étiqueté : pas besoin de
// deviner les colonnes.
//
// Comme dans l'Excel, une même pièce (même clé commande+ligne) peut
// apparaître sur plusieurs lignes : la ligne du support (vraie pièce, à
// compter) plus une ou plusieurs lignes de décor/sous-face (composants
// matière séparés). Ces dernières sont repérables par leur description
// qui commence toujours par "L" (ex. "L0001", "LT1/1"). Il existe aussi
// des lignes de réserve technique nues ("T1/1", "T3/1"...) et des lignes
// "GABARIT" (gabarit/outillage) qui ne sont pas des pièces client — à
// exclure elles aussi, sinon elles fausseraient le compte quand elles
// partagent par hasard la clé d'une vraie commande.
let pdfjsWorkerInitialise = false;
function initialiserPdfJs() {
  if (pdfjsWorkerInitialise) return;
  const workerSrc = document.getElementById("pdfjs-worker-source").textContent;
  const blob = new Blob([workerSrc], { type: "text/javascript" });
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
  pdfjsWorkerInitialise = true;
}

function estFichierPDF(fichier) {
  return /\.pdf$/i.test(fichier.name);
}

// Quelques workers pdf.js : les PDF d'un scan (listes de coupe) se lisent en parallèle, un par processeur.
let workersPdf = null;
let prochainWorkerPdf = 0;
function workerPdf() {
  initialiserPdfJs();
  if (!workersPdf) {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    workersPdf = Array.from({ length: n }, () => new pdfjsLib.PDFWorker());
  }
  return workersPdf[prochainWorkerPdf++ % workersPdf.length];
}

async function chargerDocumentPDF(fichier) {
  const buffer = await fichier.arrayBuffer();
  const tache = pdfjsLib.getDocument({ data: buffer, worker: workerPdf() });
  return await tache.promise;
}

// Reconstruit le texte d'une page ligne par ligne (regroupement des mots
// par position Y, triés par X), pour retrouver un texte à espacement
// simple et fiable à analyser — plutôt que la liste brute d'éléments
// positionnés que renvoie pdf.js.
async function extraireLignesPagePDF(page) {
  const contenu = await page.getTextContent();
  const parLigne = new Map(); // y arrondi -> liste de {x, str}
  for (const item of contenu.items) {
    if (!item.str || !item.str.trim()) continue;
    const x = item.transform[4];
    const y = Math.round(item.transform[5]);
    if (!parLigne.has(y)) parLigne.set(y, []);
    parLigne.get(y).push({ x, str: item.str });
  }
  const ys = [...parLigne.keys()].sort((a, b) => b - a); // Y décroît du haut vers le bas en PDF
  return ys.map((y) =>
    parLigne
      .get(y)
      .sort((a, b) => a.x - b.x)
      .map((i) => i.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

async function extraireLignesTextePDF(documentPDF) {
  // Toutes les pages demandées d'un coup (le worker les enchaîne sans attendre), remises dans l'ordre.
  const pages = await Promise.all(Array.from({ length: documentPDF.numPages }, (_, i) => documentPDF.getPage(i + 1).then(extraireLignesPagePDF)));
  return pages.flat().filter(Boolean);
}

// Ligne d'en-tête d'une pièce : "N°. Description Matériau Long Largeur Qté"
// Long./Largeur acceptent une virgule décimale par prudence (comme
// toFloatOrNull ailleurs dans ce fichier) : ces deux valeurs ne servent
// qu'à reconnaître la ligne, pas à être stockées.
// Le code matériau peut être vide (pièce sans panneau support, ex. « 1. TD98401 4100.0 105.0 5 ») : sans
// lui, la ligne n'était pas reconnue et la pièce manquait au compte.
// Longueur et largeur s'écrivent toujours avec une décimale (« 4100.0 ») : sans elle, le code matériau facultatif
// pourrait avaler la longueur et décaler la quantité.
const MOTIF_ENTETE_PIECE_PDF = /^(\d+)\.\s*(\S+)\s+(?:(\S+)\s+)?(\d+[.,]\d+)\s+(\d+[.,]\d+)\s+(\d+)\b/;
// Les valeurs de détail sont séparées par des virgules ; le grain matching
// peut contenir un espace interne (ex. "T1:1 2:1" = positions 1 et 2), donc
// on borne par la virgule plutôt que par un espace pour ne pas le tronquer.
const MOTIF_CLE_DETAIL_PDF = /5\.num commande\+ligne\s+([^,\s]+)/;
const MOTIF_GRAIN_DETAIL_PDF = /18\.Grain matching\s+([^,]+)/;
const MOTIF_COMMANDE_DETAIL_PDF = /(?:^|[\s,])2\.Numero commande\s+([^,\s]+)/;
const MOTIF_LIGNE_DETAIL_PDF = /(?:^|[\s,])3\.Ligne de commande\s+(\d+)/;
const MOTIF_RESERVE_NUE_PDF = /^T\d+\/\d+$/i;

// Champs additionnels du détail PDF utilisés pour le schéma de pièce dans
// la recherche (dimensions finies, chants, usinages d'angle, assemblage...).
// Chaque champ est borné par la virgule qui le sépare du suivant, comme
// MOTIF_CLE_DETAIL_PDF / MOTIF_GRAIN_DETAIL_PDF ci-dessus.
const MOTIFS_CHAMPS_DETAIL_PDF = {
  lancement: /1\.Lancement\s+([^,]+)/,
  epaisseur: /6\.Epaisseur\s+([^,]+)/,
  chantAV: /11\.Chant AV\s+([^,]+)/,
  chantAR: /12\.Chant AR\s+([^,]+)/,
  chantG: /13\.Chant G\s+([^,]+)/,
  chantD: /14\.Chant D\s+([^,]+)/,
  angleAVG: /20\.Angle AV G\s+([^,]+)/,
  angleAVD: /21\.Angle AV D\s+([^,]+)/,
  angleARG: /22\.Angle AR G\s+([^,]+)/,
  angleARD: /23\.Angle AR D\s+([^,]+)/,
  assemblage: /44\.Assemblage\s+([^,]+)/,
  typeChant: /48\.Type chant\s+([^,]+)/,
};
const MOTIF_DIMENSIONS_FINIES_PDF = /52\.L\*l\*ep fini\s+([\d.,]+)\s*X\s*([\d.,]+)\s*X\s*([\d.,]+)/;

// Extrait, pour un enregistrement PDF donné, les champs utiles au schéma de
// pièce affiché dans la recherche. Fait exprès de ne pas être appelé pour
// chaque ligne du fichier (coût inutile) : seulement à la demande, sur
// l'enregistrement déjà retrouvé pour la clé recherchée.
function extraireChampsDetailPDF(detailTexte) {
  const champs = {};
  for (const [nom, motif] of Object.entries(MOTIFS_CHAMPS_DETAIL_PDF)) {
    const m = motif.exec(detailTexte);
    champs[nom] = m ? m[1].trim() : null;
  }
  const dim = MOTIF_DIMENSIONS_FINIES_PDF.exec(detailTexte);
  champs.longueurFinie = dim ? toFloatOrNull(dim[1]) : null;
  champs.largeurFinie = dim ? toFloatOrNull(dim[2]) : null;
  champs.epaisseurFinie = dim ? toFloatOrNull(dim[3]) : null;
  return champs;
}

// Ce que la liste de coupe (PDF) dit de chaque pièce : article, cote finie, épaisseur, couleurs, agglo (par clé).
function descriptionsRecordsPDF(records, cles) {
  const voulues = new Set(cles);
  const res = new Map();
  const champ = (t, n, libelle) => {
    const m = new RegExp(`(?:^|[\\s,])${n}\\.${libelle}\\s+([^,]+)`).exec(t);
    return m ? m[1].trim() : "";
  };
  for (const r of records) {
    if (!r.cle || !voulues.has(r.cle)) continue;
    const reelle = estRecordPieceReellePDF(r);
    if (res.has(r.cle) && (res.get(r.cle).reelle || !reelle)) continue;
    const t = r.detailTexte;
    const dim = MOTIF_DIMENSIONS_FINIES_PDF.exec(t);
    res.set(r.cle, {
      reelle,
      article: champ(t, 4, "Code article"),
      L: dim ? dim[1] : champ(t, 35, "conf_longueur"),
      W: dim ? dim[2] : champ(t, 36, "conf_largeur"),
      E: dim ? dim[3] : champ(t, 6, "Epaisseur"),
      dessus: champ(t, 16, "Strat Haut"),
      dessous: champ(t, 17, "Strat Bas"),
      agglo: champ(t, 9, "Support"),
    });
  }
  return res;
}

function fmtDim(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// Un champ texte libre du fichier de lancement (ex. "commentaire") peut
// contenir n'importe quel caractère, contrairement aux codes habituels de
// ce fichier : on échappe avant de l'injecter dans le HTML du tableau
// "toutes les données", pour ne pas casser l'affichage.
function echapperHtml(texte) {
  return String(texte)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Code d'assemblage par étrier (ex. "ETRLG585", "FG620") : préfixe "ETR" =
// sans retour (10 mm de retour sinon), puis F(rontal) ou L(atéral), puis le
// côté G/D, puis une valeur numérique dont le sens exact n'est pas encore
// connu — affichée telle quelle en attendant. Certains codes d'assemblage
// ne suivent pas ce format (ex. "BAZ", "USI", "DVR") : analyserCodeAssemblage
// renvoie alors null et le code brut reste affiché tel quel.
const MOTIF_CODE_ASSEMBLAGE = /^(ETR)?(F|L)(G|D)(\d+)$/i;

function analyserCodeAssemblage(code) {
  if (!code) return null;
  const m = MOTIF_CODE_ASSEMBLAGE.exec(code.trim());
  if (!m) return null;
  return {
    sansRetour: !!m[1],
    type: m[2].toUpperCase() === "F" ? "frontal" : "latéral",
    cote: m[3].toUpperCase() === "G" ? "gauche" : "droite",
    valeur: m[4],
    brut: code,
  };
}

// Construit un schéma SVG en vue de dessus de la pièce (dimensions finies,
// à l'échelle), avec les chants (AV/AR/G/D), le défonçage évier/plaque et
// les chapelles d'assemblage relevés dans le fichier, comme repères
// visuels des options du plan. Renvoie une chaîne vide si les dimensions
// finies n'ont pas pu être lues (Excel, ou PDF sans "52.L*l*ep fini").
function construireSchemaPieceSvg(champs) {
  const longueur = champs.longueurFinie;
  const largeur = champs.largeurFinie;
  if (!longueur || !largeur) return "";

  const vbW = 320;
  const vbH = 190;
  const margeG = 46;
  const margeD = 26;
  const margeH = 30;
  const margeB = 26;
  const availW = vbW - margeG - margeD;
  const availH = vbH - margeH - margeB;
  const echelle = Math.min(availW / longueur, availH / largeur);
  let rectW = longueur * echelle;
  let rectH = largeur * echelle;
  // Garde un minimum visuel pour les pièces très fines (bandes de chant...)
  // où la vraie proportion serait invisible à l'écran.
  if (rectH < 8) rectH = 8;
  if (rectW < 8) rectW = 8;
  const x0 = margeG + (availW - rectW) / 2;
  const y0 = margeH + (availH - rectH) / 2;

  const chants = [
    { cote: "AV", val: champs.chantAV, x1: x0, y1: y0 + rectH, x2: x0 + rectW, y2: y0 + rectH, lx: x0 + rectW / 2, ly: y0 + rectH + 14 },
    { cote: "AR", val: champs.chantAR, x1: x0, y1: y0, x2: x0 + rectW, y2: y0, lx: x0 + rectW / 2, ly: y0 - 6 },
    { cote: "G", val: champs.chantG, x1: x0, y1: y0, x2: x0, y2: y0 + rectH, lx: x0 - 8, ly: y0 + rectH / 2 },
    { cote: "D", val: champs.chantD, x1: x0 + rectW, y1: y0, x2: x0 + rectW, y2: y0 + rectH, lx: x0 + rectW + 8, ly: y0 + rectH / 2 },
  ];
  const chantsSvg = chants
    .filter((c) => c.val)
    .map(
      (c) => `
        <line x1="${c.x1}" y1="${c.y1}" x2="${c.x2}" y2="${c.y2}" class="schema-chant"><title>Chant ${c.cote} : ${c.val}</title></line>
        <text x="${c.lx}" y="${c.ly}" class="schema-chant-label" text-anchor="middle">${c.cote}</text>
      `
    )
    .join("");

  // Défonçage évier/plaque de cuisson : pas de position dans le fichier,
  // donc dessiné centré sur la pièce (convention indiquée par l'atelier) —
  // et réparti équitablement le long de la pièce s'il y en a plusieurs
  // (compté par le nombre d'occurrences de "DVR" dans le code, ex.
  // "DVRDVR1" = 2). "info 3 atelier" porte la découpe même quand
  // "info atelier assemblage" contient un code d'assemblage (ex. FD600).
  const codesDecoupe = (champs.toutesDonneesLan && champs.toutesDonneesLan["info 3 atelier"]) || champs.assemblage || "";
  const nbDvr = (codesDecoupe.match(/DVR/gi) || []).length;
  let dvrSvg = "";
  if (nbDvr > 0) {
    const cy = y0 + rectH / 2;
    const rw = Math.min(rectW / (nbDvr + 0.5), 70);
    const rh = Math.min(rectH * 0.5, 46);
    dvrSvg = Array.from({ length: nbDvr }, (_, i) => {
      const cx = x0 + (rectW * (i + 1)) / (nbDvr + 1);
      return `
        <rect x="${cx - rw / 2}" y="${cy - rh / 2}" width="${rw}" height="${rh}" rx="6" class="schema-dvr">
          <title>Défonçage évier/plaque de cuisson (DVR)${nbDvr > 1 ? `, ${i + 1}/${nbDvr}` : ", centré"}</title>
        </rect>
        <text x="${cx}" y="${cy + 3}" class="schema-dvr-label" text-anchor="middle">DVR</text>
      `;
    }).join("");
  }

  // Chapelles d'assemblage par étrier : ferrures fraisées sous la pièce
  // (invisibles du dessus), réparties par 3 le long du bord concerné (côté
  // gauche et/ou droite selon le code d'assemblage) — convention indiquée
  // par l'atelier, pas de position exacte dans le fichier. On retient aussi
  // si ce bord est "avec retour" ou "sans retour" pour le talon ci-dessous.
  const sansRetourParCote = new Map(); // "gauche"/"droite" -> sansRetour (bool)
  if (champs.assemblage) {
    for (const partie of champs.assemblage.split(/\s*-\s*/)) {
      const info = analyserCodeAssemblage(partie.trim());
      if (info) sansRetourParCote.set(info.cote, info.sansRetour);
    }
  }
  const NB_CHAPELLES = 3;
  const chapellesSvg = [...sansRetourParCote.keys()]
    .flatMap((cote) => {
      const xBord = cote === "gauche" ? x0 : x0 + rectW;
      const decalage = cote === "gauche" ? 9 : -9;
      return Array.from({ length: NB_CHAPELLES }, (_, i) => {
        const y = y0 + (rectH * (i + 1)) / (NB_CHAPELLES + 1);
        return `<ellipse cx="${xBord + decalage}" cy="${y}" rx="7" ry="3" class="schema-chapelle"><title>Chapelle d'assemblage, côté ${cote}</title></ellipse>`;
      });
    })
    .join("");

  return `
    <svg viewBox="0 0 ${vbW} ${vbH}" class="schema-piece" role="img" aria-label="Schéma de la pièce, ${fmtDim(longueur)} x ${fmtDim(largeur)} mm">
      <line x1="${x0}" y1="${y0 - 10}" x2="${x0 + rectW}" y2="${y0 - 10}" class="schema-cote" />
      <text x="${x0 + rectW / 2}" y="${y0 - 14}" class="schema-cote-label" text-anchor="middle">${fmtDim(longueur)} mm</text>
      <line x1="${x0 - 10}" y1="${y0}" x2="${x0 - 10}" y2="${y0 + rectH}" class="schema-cote" />
      <text x="${x0 - 14}" y="${y0 + rectH / 2}" class="schema-cote-label" text-anchor="middle" transform="rotate(-90 ${x0 - 14} ${y0 + rectH / 2})">${fmtDim(largeur)} mm</text>
      <rect x="${x0}" y="${y0}" width="${rectW}" height="${rectH}" class="schema-rect" />
      ${chantsSvg}
      ${dvrSvg}
      ${chapellesSvg}
    </svg>
  `;
}

// ---- schéma d'ensemble d'une commande (onglet Recherche) ----
// Aucune position n'est écrite telle quelle dans le fichier de lancement :
// elle est déduite. Assemblage d'angle = un code F (frontal) côté D/G reçoit
// sur son chant avant l'extrémité du plan portant L (latéral) côté opposé ;
// le nombre du F est la profondeur du plan L, celui du L sa propre
// profondeur (vérifié sur les commandes réelles). LD face à LG de même
// profondeur = deux plans aboutés en ligne. Les crédences qui suivent un
// plan et dont les longueurs font exactement la sienne vont au fond ; ce
// qui ne se déduit pas avec certitude est listé à part, jamais placé au hasard.

const TOLERANCE_CREDENCE_MM = 3;
const TYPES_PLAN = new Set(["plan", "ilot", "forme"]);
const LIBELLE_TYPE_PIECE = {
  plan: "Plan",
  ilot: "Îlot",
  forme: "Forme spéciale",
  credence: "Crédence",
  jambage: "Jambage",
  facade: "Façade",
  autre: "Autre",
};
const LIBELLE_USINAGE_ANGLE = { EP13: "angle arrondi", EP15: "pan coupé", EP12: "pan coupé faible arrondi", EP14: "entaille" };
const LIBELLE_COIN = { ARG: "arrière gauche", ARD: "arrière droit", AVD: "avant droit", AVG: "avant gauche" };

function typePieceCommande(article) {
  const a = String(article || "").toUpperCase();
  if (a.startsWith("CRED")) return "credence";
  if (a.startsWith("JAMB")) return "jambage";
  if (a.startsWith("PORTE")) return "facade";
  if (a.startsWith("ILOT")) return "ilot";
  if (a.startsWith("DECSPE")) return "forme";
  if (/^(TPPVC|TD\d|TPA)/.test(a)) return "plan";
  return "autre";
}

function pieceCommandeDepuisLigne(l) {
  const d = l.toutesDonnees || {};
  const dimension = (finie, colonne) => finie || toFloatOrNull(d[colonne]) || null;
  // "info 3 atelier" porte les découpes ; "info atelier assemblage" n'en est
  // qu'une copie quand la pièce n'a pas d'assemblage (ne pas compter deux fois).
  const codesAtelier = d["info 3 atelier"] || l.assemblage || "";
  return {
    cle: l.cle,
    ligne: Number(l.ligne) || 0,
    article: l.article,
    type: typePieceCommande(l.article),
    L: dimension(l.longueurFinie, "conf_longueur"),
    W: dimension(l.largeurFinie, "conf_largeur"),
    E: dimension(l.epaisseurFinie, "conf_epaisseur"),
    qte: l.qte_attendue,
    chants: { AV: !!d.conf_chantavant, AR: !!d.conf_chantarriere, G: !!d.conf_chantgauche, D: !!d.conf_chantdroit },
    angles: {
      ARG: d["Usinage angle arrière gauche"] || null,
      ARD: d["Usinage angle arrière droit"] || null,
      AVD: d["Usinage angle avant droit"] || null,
      AVG: d["Usinage angle avant gauche"] || null,
    },
    assemblages: (l.assemblage || "")
      .split(/\s*-\s*/)
      .map((code) => analyserCodeAssemblage(code))
      .filter(Boolean),
    decoupes: (codesAtelier.match(/DVR1|DVR/gi) || []).map((c) => c.toUpperCase()),
    commentaire: d.commentaire || null,
  };
}

function apparierAssemblagesCommande(plans) {
  const codes = plans.flatMap((piece) => piece.assemblages.map((a) => ({ piece, a, n: Number(a.valeur), partenaire: null })));
  const libres = (filtre) => codes.filter((c) => !c.partenaire && filtre(c));
  const ecartLignes = (x, y) => Math.abs(x.piece.ligne - y.piece.ligne);
  const joints = [];

  for (const f of libres((c) => c.a.type === "frontal")) {
    const coteAttendu = f.a.cote === "droite" ? "gauche" : "droite";
    const candidats = libres(
      (c) =>
        c.a.type === "latéral" &&
        c.a.cote === coteAttendu &&
        c.piece !== f.piece &&
        c.piece.W - f.n >= -2 &&
        c.piece.W - f.n <= 12
    );
    if (candidats.length === 0) continue;
    candidats.sort((x, y) => Math.abs(x.piece.W - f.n) - Math.abs(y.piece.W - f.n) || ecartLignes(x, f) - ecartLignes(y, f));
    const l = candidats[0];
    f.partenaire = l;
    l.partenaire = f;
    joints.push({ type: "angle", f, l });
  }

  for (const d of libres((c) => c.a.type === "latéral" && c.a.cote === "droite")) {
    if (d.partenaire) continue;
    const candidats = libres(
      (c) => c.a.type === "latéral" && c.a.cote === "gauche" && c.piece !== d.piece && Math.abs(c.piece.W - d.piece.W) <= 2
    );
    if (candidats.length === 0) continue;
    candidats.sort((x, y) => ecartLignes(x, d) - ecartLignes(y, d));
    const g = candidats[0];
    d.partenaire = g;
    g.partenaire = d;
    joints.push({ type: "ligne", d, g });
  }

  return { joints, orphelins: codes.filter((c) => !c.partenaire) };
}

// Matrices affines {a,b,c,d,e,f} (convention SVG) : repère local d'un plan =
// x le long de la longueur (0 = extrémité gauche vue de face), y en
// profondeur (0 = chant arrière contre le mur, W = chant avant).
const MATRICE_IDENTITE = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function composerMatrices(m1, m2) {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

function inverserMatrice(m) {
  const det = m.a * m.d - m.b * m.c;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

function appliquerMatrice(m, x, y) {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

function disposerEnsemblesCommande(plans, joints) {
  const voisins = new Map(plans.map((p) => [p, []]));
  for (const joint of joints) {
    let P;
    let Q;
    let m; // repère local de Q -> repère local de P
    if (joint.type === "angle") {
      P = joint.f.piece;
      Q = joint.l.piece;
      m =
        joint.f.a.cote === "droite"
          ? { a: 0, b: 1, c: -1, d: 0, e: P.L, f: P.W }
          : { a: 0, b: -1, c: 1, d: 0, e: 0, f: P.W + Q.L };
    } else {
      P = joint.d.piece;
      Q = joint.g.piece;
      m = { a: 1, b: 0, c: 0, d: 1, e: P.L, f: 0 };
    }
    voisins.get(P).push({ piece: Q, m, joint });
    voisins.get(Q).push({ piece: P, m: inverserMatrice(m), joint });
  }

  const transformes = new Map();
  const ensembles = [];
  for (const racine of [...plans].sort((x, y) => x.ligne - y.ligne)) {
    if (transformes.has(racine)) continue;
    const ensemble = { pieces: [], joints: new Set() };
    transformes.set(racine, MATRICE_IDENTITE);
    const aVisiter = [racine];
    while (aVisiter.length > 0) {
      const p = aVisiter.shift();
      ensemble.pieces.push(p);
      for (const v of voisins.get(p)) {
        ensemble.joints.add(v.joint);
        if (transformes.has(v.piece)) continue;
        transformes.set(v.piece, composerMatrices(transformes.get(p), v.m));
        aVisiter.push(v.piece);
      }
    }
    ensemble.pieces.sort((x, y) => x.ligne - y.ligne);
    ensembles.push(ensemble);
  }
  return { ensembles, transformes };
}

// Mur derrière chaque plan, dans le repère du plan (x de "debut" à "fin") :
// sa longueur, c'est celle du plan. Quand un plan vient s'assembler sur un
// autre en L, son mur continue derrière l'autre plan : il s'allonge de la
// profondeur de cet autre plan, du côté de l'assemblage.
function mursDesPlans(ensembles) {
  const murs = new Map();
  for (const ensemble of ensembles) {
    for (const p of ensemble.pieces) murs.set(p, { debut: 0, fin: p.L, assemble: false, derriere: null });
    for (const j of ensemble.joints) {
      if (j.type !== "angle") continue;
      const murL = murs.get(j.l.piece);
      if (j.l.a.cote === "gauche") murL.debut -= j.f.piece.W;
      else murL.fin += j.f.piece.W;
      murL.assemble = true;
      murL.derriere = j.f.piece;
      murs.get(j.f.piece).assemble = true;
    }
  }
  return murs;
}

// Longueurs de crédences acceptées pour un mur : la longueur exacte du plan
// (±3 mm) pour un plan seul ; pour un plan assemblé en L, jusqu'à 30 mm de
// moins (une crédence s'arrête contre celle du mur voisin, épaisseur et
// jeu d'assemblage compris) et 15 mm de plus.
function longueurAccepteePourMur(mur, somme) {
  const cible = mur.fin - mur.debut;
  if (!mur.assemble) return Math.abs(somme - cible) <= TOLERANCE_CREDENCE_MM;
  return somme >= cible - 30 && somme <= cible + 15;
}

function sousEnsemblePourMur(credences, mur) {
  const n = credences.length;
  if (n === 0 || n > 14) return null;
  const cible = mur.fin - mur.debut;
  let meilleur = null;
  for (let masque = 1; masque < 1 << n; masque++) {
    let somme = 0;
    let nb = 0;
    for (let i = 0; i < n; i++) {
      if (masque & (1 << i)) {
        somme += credences[i].L;
        nb++;
      }
    }
    if (!longueurAccepteePourMur(mur, somme)) continue;
    const ecart = Math.abs(somme - cible);
    if (!meilleur || nb > meilleur.nb || (nb === meilleur.nb && ecart < meilleur.ecart)) meilleur = { masque, nb, ecart };
  }
  return meilleur ? credences.filter((_, i) => meilleur.masque & (1 << i)) : null;
}

function placerCredencesCommande(ensembles, plans, credences) {
  const murs = mursDesPlans(ensembles);
  const placement = new Map(plans.map((p) => [p, { fond: [], debutFond: 0, retours: { gauche: null, droite: null } }]));
  const restantes = new Set(credences);
  const ensembleDe = new Map();
  for (const e of ensembles) for (const p of e.pieces) ensembleDe.set(p, e);

  const poserFond = (plan, fond) => {
    const mur = murs.get(plan);
    const total = fond.reduce((s, c) => s + c.L, 0);
    const cotesAssembles = new Set(plan.assemblages.map((a) => a.cote));
    // Une crédence plus courte que le mur reste calée côté extrémité libre :
    // le manque est du côté de l'assemblage, contre la crédence voisine.
    const calerADroite = cotesAssembles.has("gauche") && !cotesAssembles.has("droite");
    const place = placement.get(plan);
    place.fond = fond;
    place.debutFond = calerADroite ? mur.fin - total : mur.debut;
    fond.forEach((c) => restantes.delete(c));
  };

  const poserRetours = (plan, candidats) => {
    const place = placement.get(plan);
    if (place.fond.length === 0) return;
    const premiereLigneFond = Math.min(...place.fond.map((c) => c.ligne));
    const cotesAssembles = new Set(plan.assemblages.map((a) => a.cote));
    for (const c of candidats) {
      if (!restantes.has(c) || c.L > plan.W + TOLERANCE_CREDENCE_MM || c.L < plan.W - 30) continue;
      const prefere = c.ligne < premiereLigneFond ? "gauche" : "droite";
      const cote = [prefere, prefere === "gauche" ? "droite" : "gauche"].find((k) => !cotesAssembles.has(k) && !place.retours[k]);
      if (!cote) continue;
      place.retours[cote] = c;
      restantes.delete(c);
    }
  };

  // Crédences intercalées après leurs plans (plans, crédences, plans,
  // crédences...) : chaque groupe appartient à l'ensemble de plans qui le
  // précède. Si toutes les crédences sont regroupées après le dernier plan,
  // on passe directement à l'appariement crédence par crédence ci-dessous.
  const groupes = new Map(ensembles.map((e) => [e, []]));
  let ensembleCourant = null;
  for (const piece of [...plans, ...credences].sort((x, y) => x.ligne - y.ligne)) {
    if (piece.type === "credence") {
      if (ensembleCourant) groupes.get(ensembleCourant).push(piece);
    } else {
      ensembleCourant = ensembleDe.get(piece);
    }
  }
  const intercalees = ensembles.length <= 1 || ensembles.filter((e) => groupes.get(e).length > 0).length >= 2;

  for (const ensemble of intercalees ? ensembles : []) {
    const groupe = groupes.get(ensemble);
    const plansOrdonnes = [...ensemble.pieces].sort((a, b) => murs.get(a).assemble - murs.get(b).assemble || a.ligne - b.ligne);
    for (const plan of plansOrdonnes) {
      const fond = sousEnsemblePourMur(
        groupe.filter((c) => restantes.has(c)),
        murs.get(plan)
      );
      if (fond) poserFond(plan, fond);
    }
    for (const plan of ensemble.pieces) poserRetours(plan, groupe);
  }

  // Une crédence de la longueur du mur d'un plan encore sans crédence va à
  // son fond. Les crédences regroupées suivent l'ordre des plans : entre
  // deux plans possibles, on prend le premier situé après le plan apparié
  // à la crédence précédente ; la crédence qui suit, de la profondeur du
  // plan, en est le retour.
  const plansParLigne = [...plans].sort((x, y) => x.ligne - y.ligne);
  const credencesParLigne = [...credences].sort((x, y) => x.ligne - y.ligne);
  let indexDernierPlan = -1;
  for (const c of credencesParLigne) {
    if (!restantes.has(c)) continue;
    const candidats = plansParLigne
      .map((p, index) => ({ p, index }))
      .filter(({ p }) => placement.get(p).fond.length === 0 && longueurAccepteePourMur(murs.get(p), c.L));
    if (candidats.length === 0) continue;
    const choix = candidats.find(({ index }) => index > indexDernierPlan) || candidats[0];
    poserFond(choix.p, [c]);
    indexDernierPlan = choix.index;
    const suivante = credencesParLigne[credencesParLigne.indexOf(c) + 1];
    const suivanteVaAuFondDUnAutrePlan =
      suivante && plansParLigne.some((p) => placement.get(p).fond.length === 0 && longueurAccepteePourMur(murs.get(p), suivante.L));
    if (suivante && !suivanteVaAuFondDUnAutrePlan) poserRetours(choix.p, [suivante]);
  }

  return { placement, murs, nonPlacees: [...restantes].sort((x, y) => x.ligne - y.ligne) };
}

// Contour d'un plan dans son repère local, usinages d'angle compris. Le
// contour est parcouru dans le sens horaire à l'écran (fond en haut) :
// chaque coin est défini par sa direction d'arrivée et de départ.
const COINS_PLAN = [
  { nom: "ARG", x: (p) => 0, y: (p) => 0, arrivee: [0, -1], depart: [1, 0] },
  { nom: "ARD", x: (p) => p.L, y: (p) => 0, arrivee: [1, 0], depart: [0, 1] },
  { nom: "AVD", x: (p) => p.L, y: (p) => p.W, arrivee: [0, 1], depart: [-1, 0] },
  { nom: "AVG", x: (p) => 0, y: (p) => p.W, arrivee: [-1, 0], depart: [0, -1] },
];

function geometrieContourPlan(p, m) {
  const taille = Math.min(Math.max(Math.min(p.L, p.W) * 0.18, 50), 220);
  const entailleL = Math.min(p.L * 0.3, 400);
  const entailleW = Math.min(p.W * 0.35, 250);
  const pt = (x, y) => appliquerMatrice(m, x, y);
  const fmt = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;

  const coins = COINS_PLAN.map((coin) => {
    const cx = coin.x(p);
    const cy = coin.y(p);
    const [ax, ay] = coin.arrivee;
    const [dx, dy] = coin.depart;
    const code = (p.angles[coin.nom] || "").toUpperCase();
    if (code === "EP13" || code === "EP15" || code === "EP12") {
      const entree = pt(cx - ax * taille, cy - ay * taille);
      const sortie = pt(cx + dx * taille, cy + dy * taille);
      const rayon = code === "EP13" ? taille : code === "EP12" ? taille * 2.2 : null;
      return { entree, sortie, trace: rayon ? `A ${rayon.toFixed(1)} ${rayon.toFixed(1)} 0 0 1 ${fmt(sortie)}` : `L ${fmt(sortie)}` };
    }
    if (code === "EP14") {
      const aArrivee = ax !== 0 ? entailleL : entailleW;
      const aDepart = dx !== 0 ? entailleL : entailleW;
      const entree = pt(cx - ax * aArrivee, cy - ay * aArrivee);
      const interieur = pt(cx - ax * aArrivee + dx * aDepart, cy - ay * aArrivee + dy * aDepart);
      const sortie = pt(cx + dx * aDepart, cy + dy * aDepart);
      return { entree, sortie, trace: `L ${fmt(interieur)} L ${fmt(sortie)}` };
    }
    const sommet = pt(cx, cy);
    return { entree: sommet, sortie: sommet, trace: "" };
  });

  const [arg, ard, avd, avg] = coins;
  const chemin =
    `M ${fmt(arg.sortie)} L ${fmt(ard.entree)} ${ard.trace} L ${fmt(avd.entree)} ${avd.trace} ` +
    `L ${fmt(avg.entree)} ${avg.trace} L ${fmt(arg.entree)} ${arg.trace} Z`;
  const bords = {
    AR: [arg.sortie, ard.entree],
    D: [ard.sortie, avd.entree],
    AV: [avd.sortie, avg.entree],
    G: [avg.sortie, arg.entree],
  };
  const points = coins.flatMap((c) => [c.entree, c.sortie]);
  return { chemin, bords, points };
}

function construireSvgEnsembleCommande(ensemble, transformes, placement, orphelinsParPiece, cleSurlignee) {
  const ECART_RABATTEMENT = 60;
  const formes = []; // { genre, points|segment|centre, ... } en coordonnées globales (mm)
  const tousPoints = [];

  const polygone = (m, coinsLocaux) => coinsLocaux.map(([x, y]) => appliquerMatrice(m, x, y));

  for (const p of ensemble.pieces) {
    const m = transformes.get(p);
    const contour = geometrieContourPlan(p, m);
    tousPoints.push(...contour.points);
    formes.push({ genre: "plan", piece: p, contour, centre: appliquerMatrice(m, p.L / 2, p.W / 2) });

    p.decoupes.forEach((code, i) => {
      const n = p.decoupes.length;
      const cx = (p.L * (i + 1)) / (n + 1);
      const largeur = Math.min(520, (0.8 * p.L) / n);
      const hauteur = Math.min(0.45 * p.W, 350);
      formes.push({
        genre: "decoupe",
        code,
        points: polygone(m, [
          [cx - largeur / 2, p.W / 2 - hauteur / 2],
          [cx + largeur / 2, p.W / 2 - hauteur / 2],
          [cx + largeur / 2, p.W / 2 + hauteur / 2],
          [cx - largeur / 2, p.W / 2 + hauteur / 2],
        ]),
      });
    });

    const place = placement.get(p);
    let x = place.debutFond;
    for (const c of place.fond) {
      const pts = polygone(m, [
        [x, -ECART_RABATTEMENT - c.W],
        [x + c.L, -ECART_RABATTEMENT - c.W],
        [x + c.L, -ECART_RABATTEMENT],
        [x, -ECART_RABATTEMENT],
      ]);
      tousPoints.push(...pts);
      formes.push({ genre: "credence", piece: c, points: pts });
      x += c.L;
    }
    for (const [cote, c] of Object.entries(place.retours)) {
      if (!c) continue;
      const x0 = cote === "gauche" ? -ECART_RABATTEMENT - c.W : p.L + ECART_RABATTEMENT;
      const pts = polygone(m, [
        [x0, p.W - c.L],
        [x0 + c.W, p.W - c.L],
        [x0 + c.W, p.W],
        [x0, p.W],
      ]);
      tousPoints.push(...pts);
      formes.push({ genre: "credence", piece: c, points: pts });
    }

    for (const o of orphelinsParPiece.get(p) || []) {
      const droite = o.a.cote === "droite";
      const segment =
        o.a.type === "frontal"
          ? droite
            ? [[p.L - (o.n || p.W * 0.3), p.W], [p.L, p.W]]
            : [[0, p.W], [o.n || p.W * 0.3, p.W]]
          : droite
            ? [[p.L, 0], [p.L, p.W]]
            : [[0, 0], [0, p.W]];
      formes.push({ genre: "orphelin", code: o.a.brut, points: polygone(m, segment) });
    }
  }

  for (const joint of ensemble.joints) {
    const P = joint.type === "angle" ? joint.f.piece : joint.d.piece;
    const m = transformes.get(P);
    let segment;
    if (joint.type === "angle") {
      const n = joint.l.piece.W;
      segment = joint.f.a.cote === "droite" ? [[P.L - n, P.W], [P.L, P.W]] : [[0, P.W], [n, P.W]];
    } else {
      segment = [[P.L, 0], [P.L, P.W]];
    }
    const codes = joint.type === "angle" ? `${joint.f.a.brut} / ${joint.l.a.brut}` : `${joint.d.a.brut} / ${joint.g.a.brut}`;
    formes.push({ genre: "joint", codes, points: polygone(m, segment) });
  }

  const xs = tousPoints.map((q) => q[0]);
  const ys = tousPoints.map((q) => q[1]);
  const largeurGeo = Math.max(...xs) - Math.min(...xs) || 1;
  const hauteurGeo = Math.max(...ys) - Math.min(...ys) || 1;
  // L'unité du dessin est le mm : la taille du texte suit celle de
  // l'ensemble pour rester lisible (~13 px) une fois affiché sur ~280 px.
  const police = Math.max(largeurGeo, hauteurGeo * 0.9) / 18;
  const marge = 1.2 * police;
  const minX = Math.min(...xs) - marge;
  const minY = Math.min(...ys) - marge;
  const vbW = largeurGeo + 2 * marge;
  const vbH = hauteurGeo + 2 * marge;
  const pxParMm = 280 / vbW;

  const f1 = (v) => v.toFixed(1);
  const listePoints = (pts) => pts.map(([x, y]) => `${f1(x)},${f1(y)}`).join(" ");
  const texte = (x, y, contenu, classe, taille = police) =>
    `<text x="${f1(x)}" y="${f1(y)}" class="${classe}" font-size="${f1(taille)}" text-anchor="middle" dominant-baseline="middle">${echapperHtml(contenu)}</text>`;

  const svg = [];
  for (const forme of formes.filter((fo) => fo.genre === "credence")) {
    const c = forme.piece;
    const surligne = c.cle === cleSurlignee ? " surligne" : "";
    const cx = forme.points.reduce((s, q) => s + q[0], 0) / 4;
    const cy = forme.points.reduce((s, q) => s + q[1], 0) / 4;
    svg.push(
      `<polygon points="${listePoints(forme.points)}" class="sc-credence${surligne}"><title>Ligne ${c.ligne} — crédence ${fmtDim(c.L)} × ${fmtDim(c.W)} mm</title></polygon>`,
      texte(cx, cy, String(c.ligne), "sc-texte-credence", police * 0.85)
    );
  }
  for (const forme of formes.filter((fo) => fo.genre === "plan")) {
    const p = forme.piece;
    const classes = `sc-plan${p.type === "forme" ? " forme" : ""}${p.cle === cleSurlignee ? " surligne" : ""}`;
    svg.push(`<path d="${forme.contour.chemin}" class="${classes}"><title>Ligne ${p.ligne} — ${echapperHtml(p.article)} ${fmtDim(p.L)} × ${fmtDim(p.W)} mm</title></path>`);
    for (const [cote, [a, b]] of Object.entries(forme.contour.bords)) {
      if (p.chants[cote]) svg.push(`<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}" class="sc-chant" />`);
    }
  }
  for (const forme of formes.filter((fo) => fo.genre === "decoupe")) {
    svg.push(
      `<polygon points="${listePoints(forme.points)}" class="sc-dvr${forme.code === "DVR1" ? " predecoupe" : ""}"><title>${forme.code === "DVR1" ? "Prédécoupe évier/cuisson non débouchante (DVR1)" : "Découpe évier/cuisson (DVR)"} — centrée par convention, position réelle non indiquée dans le fichier</title></polygon>`
    );
  }
  for (const forme of formes.filter((fo) => fo.genre === "joint")) {
    const [[x1, y1], [x2, y2]] = forme.points;
    svg.push(`<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" class="sc-joint"><title>Assemblage ${echapperHtml(forme.codes)}</title></line>`);
    for (const t of [0.25, 0.5, 0.75]) {
      svg.push(`<circle cx="${f1(x1 + (x2 - x1) * t)}" cy="${f1(y1 + (y2 - y1) * t)}" r="${f1(0.2 * police)}" class="sc-chapelle" />`);
    }
  }
  for (const forme of formes.filter((fo) => fo.genre === "orphelin")) {
    const [[x1, y1], [x2, y2]] = forme.points;
    svg.push(
      `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" class="sc-orphelin"><title>Assemblage ${echapperHtml(forme.code)} : pièce associée introuvable dans les fichiers chargés</title></line>`,
      texte((x1 + x2) / 2, (y1 + y2) / 2 - police, `${forme.code} ?`, "sc-texte-alerte", police * 0.85)
    );
  }
  for (const forme of formes.filter((fo) => fo.genre === "plan")) {
    const p = forme.piece;
    const [cx, cy] = forme.centre;
    const etroit = Math.min(p.L, p.W) * pxParMm < 36;
    svg.push(texte(cx, etroit ? cy : cy - police * 0.6, `${p.ligne}`, "sc-texte"));
    if (!etroit) svg.push(texte(cx, cy + police * 0.7, `${fmtDim(p.L)} × ${fmtDim(p.W)}`, "sc-texte-cote", police * 0.85));
  }

  return `<svg viewBox="${f1(minX)} ${f1(minY)} ${f1(vbW)} ${f1(vbH)}" class="schema-commande-svg" role="img" aria-label="Schéma de l'ensemble">${svg.join("")}</svg>`;
}

function descriptionFormeEnsemble(ensemble, transformes) {
  if (ensemble.pieces.length === 1) return "";
  const orientations = new Set(
    ensemble.pieces.map((p) => {
      const m = transformes.get(p);
      return Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI + 360) % 360;
    })
  );
  const opposees = [...orientations].some((o) => orientations.has((o + 180) % 360));
  const perpendiculaires = [...orientations].some((o) => orientations.has((o + 90) % 360));
  if (opposees && perpendiculaires) return " · plan en U";
  if (perpendiculaires) return " · plan en L";
  return " · plans aboutés en ligne";
}

// Schéma d'une commande : pièces, assemblages, ensembles et crédences placées.
function construireSchemaCommande(commande, lignes) {
  const pieces = lignes.map(pieceCommandeDepuisLigne).sort((x, y) => x.ligne - y.ligne);
  const plans = pieces.filter((p) => TYPES_PLAN.has(p.type) && p.L && p.W);
  const credences = pieces.filter((p) => p.type === "credence" && p.L && p.W);
  const autres = pieces.filter((p) => !plans.includes(p) && !credences.includes(p));

  const { joints, orphelins } = apparierAssemblagesCommande(plans);
  const { ensembles, transformes } = disposerEnsemblesCommande(plans, joints);
  const { placement, murs, nonPlacees } = placerCredencesCommande(ensembles, plans, credences);
  const orphelinsParPiece = new Map();
  for (const o of orphelins) {
    if (!orphelinsParPiece.has(o.piece)) orphelinsParPiece.set(o.piece, []);
    orphelinsParPiece.get(o.piece).push(o);
  }
  return { commande, pieces, plans, credences, autres, joints, orphelinsParPiece, ensembles, transformes, placement, murs, nonPlacees };
}

const dimsPieceCommande = (p) => `${fmtDim(p.L)} × ${fmtDim(p.W)}${p.E ? ` × ${fmtDim(p.E)}` : ""} mm${p.qte > 1 ? ` (×${p.qte})` : ""}`;

// Blocs du détail : un par ensemble, puis crédences non placées, puis autres
// pièces ; chaque pièce avec ses informations (assemblage, angles, découpes...).
function blocsSchemaCommande(s, cleSurlignee) {
  const partenaires = new Map(); // code d'assemblage -> ligne de la pièce associée
  const codesParPiece = new Map();
  for (const j of s.joints) {
    const [x, y] = j.type === "angle" ? [j.f, j.l] : [j.d, j.g];
    partenaires.set(x, y.piece.ligne);
    partenaires.set(y, x.piece.ligne);
    for (const c of [x, y]) {
      if (!codesParPiece.has(c.piece)) codesParPiece.set(c.piece, []);
      codesParPiece.get(c.piece).push(c);
    }
  }
  const info = (texte, alerte = false, commentaire = false) => ({ texte, alerte, commentaire });
  const avecCommentaire = (p) => ({ piece: p, infos: p.commentaire ? [info(p.commentaire, false, true)] : [] });

  const blocs = s.ensembles.map((ensemble, i) => {
    const lignes = [];
    let nbCredences = 0;
    for (const p of ensemble.pieces) {
      const infos = [
        ...(codesParPiece.get(p) || []).map((c) => info(`${c.a.type === "frontal" ? "Reçoit" : "S'assemble sur"} la ligne ${partenaires.get(c)} (${c.a.brut})`)),
        ...(s.orphelinsParPiece.get(p) || []).map((o) => info(`${o.a.brut} : pièce associée absente des fichiers chargés`, true)),
        ...Object.entries(p.angles)
          .filter(([, code]) => code)
          .map(([coin, code]) => info(`Angle ${LIBELLE_COIN[coin]} : ${code}${LIBELLE_USINAGE_ANGLE[code] ? ` (${LIBELLE_USINAGE_ANGLE[code]})` : ""}`)),
      ];
      if (p.decoupes.length) infos.push(info(`${p.decoupes.join(" + ")} : découpe évier/cuisson (centrée sur le dessin, position réelle non indiquée)`));
      if (p.type === "forme") infos.push(info("Forme spéciale : contour réel sur le plan client"));
      if (p.commentaire) infos.push(info(p.commentaire, false, true));
      lignes.push({ piece: p, infos });

      const place = s.placement.get(p);
      const finFond = place.debutFond + place.fond.reduce((t, c) => t + c.L, 0);
      const derriere = s.murs.get(p).derriere;
      const continueDerriere = derriere && (place.debutFond < -TOLERANCE_CREDENCE_MM || finFond > p.L + TOLERANCE_CREDENCE_MM);
      place.fond.forEach((c, k) =>
        lignes.push({
          piece: c,
          infos: [
            info(
              `Fond du plan ligne ${p.ligne}, ${k + 1}${k === 0 ? "re" : "e"} en partant de la gauche` +
                (continueDerriere ? ` (le mur continue derrière le plan ligne ${derriere.ligne})` : "")
            ),
          ],
        })
      );
      for (const cote of ["gauche", "droite"]) {
        const c = place.retours[cote];
        if (c) lignes.push({ piece: c, infos: [info(`Retour ${cote} du plan ligne ${p.ligne}`)] });
      }
      nbCredences += place.fond.length + Object.values(place.retours).filter(Boolean).length;
    }
    const titre =
      `Ensemble ${i + 1} · ${ensemble.pieces.length > 1 ? `lignes ${ensemble.pieces.map((p) => p.ligne).join(", ")}` : `ligne ${ensemble.pieces[0].ligne}`}` +
      descriptionFormeEnsemble(ensemble, s.transformes) +
      (nbCredences ? ` · ${nbCredences} crédence(s)` : "");
    const ouvert = s.ensembles.length <= 3 || lignes.some((l) => l.piece.cle === cleSurlignee);
    return { titre, ensemble, ouvert, lignes };
  });
  if (s.nonPlacees.length) {
    blocs.push({ titre: `Crédences sans position déductible (${s.nonPlacees.length})`, ouvert: true, lignes: s.nonPlacees.map(avecCommentaire) });
  }
  if (s.autres.length) blocs.push({ titre: `Autres pièces (${s.autres.length})`, ouvert: true, lignes: s.autres.map(avecCommentaire) });
  return blocs;
}

// Dessin seulement pour ce qui est assemblé (L, U, plans aboutés) ou porte des crédences.
function ensembleADessiner(s, ensemble) {
  if (ensemble.pieces.length > 1) return true;
  const place = s.placement.get(ensemble.pieces[0]);
  return !!place && (place.fond.length > 0 || !!place.retours.gauche || !!place.retours.droite);
}

function svgEnsembleCommande(s, ensemble, cleSurlignee) {
  return construireSvgEnsembleCommande(ensemble, s.transformes, s.placement, s.orphelinsParPiece, cleSurlignee);
}

// Comme les autres comparaisons de codes de ce fichier (matériau, type de
// trace...), on normalise en majuscules avant de comparer : Cutrite génère
// ces codes de façon cohérente, mais mieux vaut ne pas en dépendre.
function estDescriptionPieceReellePDF(desc) {
  if (!desc) return false;
  const d = desc.toUpperCase();
  if (d.startsWith("L")) return false; // décor/sous-face (L0001, LT1/1...)
  if (MOTIF_RESERVE_NUE_PDF.test(d)) return false; // réserve technique nue (T1/1...)
  if (d === "GABARIT") return false; // gabarit/outillage, pas une pièce client
  return true;
}

// Un enregistrement PDF est une vraie pièce si sa description passe le test
// ci-dessus ET que son matériau n'est pas un panneau de protection (même
// exclusion que côté Excel, voir estProtection) : un panneau de
// protection accompagne une pièce sans être lui-même une pièce à compter —
// sinon la pièce protégée est comptée deux fois (une fois pour elle-même,
// une fois pour son panneau de protection).
function estRecordPieceReellePDF(r) {
  if (!estDescriptionPieceReellePDF(r.desc)) return false;
  if (r.materiau && estProtection(r.materiau)) return false;
  return true;
}

function extraireRecordsPDF(lignesTexte) {
  const records = [];
  let courant = null;
  for (const ligne of lignesTexte) {
    const m = MOTIF_ENTETE_PIECE_PDF.exec(ligne);
    if (m) {
      if (courant) records.push(courant);
      courant = {
        desc: m[2],
        materiau: m[3] || "",
        qte: parseInt(m[6], 10),
        detailTexte: "",
        cle: null,
        grain: null,
      };
    } else if (courant) {
      courant.detailTexte += " " + ligne;
    }
  }
  if (courant) records.push(courant);

  for (const r of records) {
    const cleM = MOTIF_CLE_DETAIL_PDF.exec(r.detailTexte);
    r.cle = cleM ? cleM[1] : null;
    // Sans « 5.num commande+ligne », la clé se refait avec la commande et la ligne (« 2.Numero commande CVC26080067,
    // 3.Ligne de commande 1 » → CVC26080067001) : sinon la pièce, bien dans la liste, serait signalée absente.
    if (!r.cle) {
      const commande = MOTIF_COMMANDE_DETAIL_PDF.exec(r.detailTexte);
      const ligne = MOTIF_LIGNE_DETAIL_PDF.exec(r.detailTexte);
      if (commande && ligne) r.cle = cleLigne(commande[1], ligne[1]);
    }
    const grainM = MOTIF_GRAIN_DETAIL_PDF.exec(r.detailTexte);
    r.grain = grainM ? grainM[1].trim() : null;
  }
  return records;
}

async function lireRecordsPDF(fichier) {
  const documentPDF = await chargerDocumentPDF(fichier);
  try {
    const lignesTexte = await extraireLignesTextePDF(documentPDF);
    return extraireRecordsPDF(lignesTexte);
  } finally {
    // Libère la mémoire côté worker pdf.js (polices, structure des pages) :
    // sans ça, chaque lecture PDF (contrôle, recherche globale) en laisse
    // une copie non libérée pour toute la durée de vie de l'onglet.
    documentPDF.destroy();
  }
}

function lireCoupeDepuisRecordsPDF(records) {
  const pieces = records.filter((r) => r.cle && estRecordPieceReellePDF(r));

  const compteur = new Map();
  for (const p of pieces) {
    compteur.set(p.cle, (compteur.get(p.cle) || 0) + p.qte);
  }

  let total = 0;
  for (const v of compteur.values()) total += v;
  if (total === 0) {
    throw new Error(
      "Aucune pièce n'a été reconnue dans le PDF de la liste de coupe : le format du fichier semble différent de celui attendu."
    );
  }

  // Réutilise directement compterUnitaires (elle attend des [clé, ligne]
  // avec ligne[colGrain] ; on lui passe un tableau à une seule case
  // contenant le grain déjà extrait).
  const piecesPourGrain = pieces.map((p) => [p.cle, [p.grain]]);
  const nbUnitaires = compterUnitaires(piecesPourGrain, 0, compteur);

  return {
    compteur,
    nbUnitaires,
    nbPiecesTrouvees: compteur.size,
  };
}

async function lireCoupePDF(fichier) {
  const records = await lireRecordsPDF(fichier);
  return lireCoupeDepuisRecordsPDF(records);
}

function lireGrainMatchingDepuisRecordsPDF(records) {
  const resultat = new Map();
  for (const r of records) {
    if (!r.cle || !estRecordPieceReellePDF(r)) continue;
    if (!resultat.has(r.cle)) resultat.set(r.cle, []);
    if (r.grain && !resultat.get(r.cle).includes(r.grain)) resultat.get(r.cle).push(r.grain);
  }
  return resultat;
}

async function lireGrainMatchingPDF(fichier) {
  const records = await lireRecordsPDF(fichier);
  return lireGrainMatchingDepuisRecordsPDF(records);
}

// ---- Points d'entrée communs Excel / PDF pour la liste de coupe ----
// Charge le fichier UNE SEULE fois (l'étape coûteuse : dézipper l'Excel ou
// parser toutes les pages du PDF) pour être réutilisé par plusieurs
// lectures (comptage, grain matching) sans reparser le fichier à chaque
// fois — voir rechercherGrainMatchingGlobal, qui a besoin des deux.
async function chargerSourceCoupe(fichier) {
  if (estFichierPDF(fichier)) {
    return { pdf: true, records: await lireRecordsPDF(fichier) };
  }
  return { pdf: false, workbook: await chargerClasseur(fichier) };
}

function lireCoupeDepuisSource(source, clesStrat, qteAttendueParCle) {
  if (source.pdf) return lireCoupeDepuisRecordsPDF(source.records);
  return lireCoupe(source.workbook, clesStrat, qteAttendueParCle);
}

function lireGrainMatchingDepuisSource(source, clesStrat) {
  if (source.pdf) return lireGrainMatchingDepuisRecordsPDF(source.records);
  return lireGrainMatching(source.workbook, clesStrat);
}

async function lireCoupeDepuisFichier(fichier, clesStrat, qteAttendueParCle) {
  return lireCoupeDepuisSource(await chargerSourceCoupe(fichier), clesStrat, qteAttendueParCle);
}

async function lireGrainMatchingDepuisFichier(fichier, clesStrat) {
  return lireGrainMatchingDepuisSource(await chargerSourceCoupe(fichier), clesStrat);
}

