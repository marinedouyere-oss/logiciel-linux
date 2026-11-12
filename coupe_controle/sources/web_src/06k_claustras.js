// ---- V6.7 : CLAUSTRAS — saisie automatique à partir des confirmations de commande (PDF) d'un dossier ----
// Chaque confirmation (« CONFIRMATION DE COMMANDE CVC… ») est lue : en-tête (commande, référence, code client,
// représentant, transporteur, semaine de livraison) et lignes « Réalisation d'un claustra … » (coloris, épaisseur,
// longueur / hauteur, lames droites / obliques et leur largeur, profondeur des lisses, emballage, montage, quantité).
// Les autres lignes (îlots, plans…) ne sont pas des claustras : elles restent pour les lancements habituels.
// Le texte vient du PDF ; s'il n'y en a pas (PDF « Microsoft Print to PDF » : le texte y est dessiné), la page est
// rendue en image et lue par reconnaissance de caractères (Tesseract, fichiers « ocr/ » servis par le .exe, sans
// Internet). Tout se vérifie et se corrige à l'écran avant de créer le fichier de lancement.
// Règles du fichier de lancement : celles du logiciel Claustra (fichiers faits à la main par l'atelier, ex.
// LAN26CLAUSTRAbis = CVC26100432) :
//  - 2 lisses : longueur du claustra × profondeur des lisses, 4 chants ;
//  - lames (droites, obliques) : hauteur − 60 (2 lisses de 30) × largeur des lames, chants avant et arrière ;
//  - surcote 25 (débit = fini + 25), idPlan C, agglo SAG28HYBR (29 mm), double face (CBD), chants PVC ;
//  - commentaire « A MONTER » (montage inclus) ou « ENKIT » (montage non inclus) ;
//  - emballage : 2 panneaux (H+50)×(L+50), 2 bandes (H+50)×85, 2 bandes (L−38)×85 en PROTECTION (19 mm).
// Rien n'est écrit ailleurs que dans le nouveau fichier : ni les confirmations, ni les fichiers de lancement existants.

const CLE_CLAUSTRAS = "sentinelle-claustras";
// V6.7.6 : version de la lecture ; une confirmation lue avec une version plus ancienne est relue (ex. lames « 80 et 77 »).
const LECTURE_CL = 2;
const COLONNES_LAN_CLAUSTRA = [
  "conf_commande", "conf_ligne", "conf_article", "conf_epaisseur", "conf_longueur", "conf_largeur", "longueur", "largeur", "surepaisseur",
  "coloris", "agglo", "coloris_inf", "comdet_qte", "com_livsem", "com_livan", "comprod_lancement", "com_clientcom", "com_reference",
  "conf_chantavant", "conf_chantarriere", "conf_chantgauche", "conf_chantdroit", "idPlan", "commentaire", "commande+ligne",
  "info atelier assemblage", "Type chant", "CBD", "info 2 atelier", "info 3 atelier", "Usinage angle avant gauche", "Usinage angle avant droit",
  "Usinage angle arrière gauche", "Usinage angle arrière droit", "LongueurxLargeur debit", "LongueurxLargeurxEpaisseur fini", "trans_nomcourt",
];
const CL = { SURCOTE: 25, LISSE: 30, ID_PLAN: "C", OCR_ECHELLE: 300 / 72 };

const claustras = { confirmations: [], lu: false, enCours: null, erreur: null, nomFichier: "", message: null, photos: new Map(), photosChargees: false, nbPhotos: {} };

// ---------- Lecture du PDF : des mots placés sur la page ----------

let ocrClaustras = null;
function chargerScriptOcr(src) {
  return new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => ko(new Error(`lecteur d'image introuvable (${src}) : ouvrez Sentinelle par son .exe`));
    document.head.appendChild(s);
  });
}

// Le lecteur d'image (Tesseract), chargé une fois, au premier PDF sans texte.
function moteurOcr() {
  if (!ocrClaustras)
    ocrClaustras = (async () => {
      const base = new URL("ocr/", location.href).href;
      if (typeof Tesseract === "undefined") await chargerScriptOcr(`${base}tesseract.min.js`);
      return Tesseract.createWorker("fra", 1, {
        workerPath: `${base}worker.min.js`,
        corePath: `${base}tesseract-core-simd-lstm.wasm.js`,
        langPath: base.replace(/\/$/, ""),
        gzip: false,
        cacheMethod: "none",
        workerBlobURL: false,
      });
    })().catch((e) => {
      ocrClaustras = null;
      throw e;
    });
  return ocrClaustras;
}

// Mots d'une page : texte du PDF, sinon lecture de l'image. { mots: [{t, x0, y0, x1, y1}], largeur, image: bool }.
async function motsPageClaustra(page) {
  const vue = page.getViewport({ scale: 1 });
  const contenu = await page.getTextContent();
  const mots = [];
  for (const it of contenu.items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const h = Math.abs(it.transform[3]) || it.height || 8;
    const y = vue.height - it.transform[5];
    mots.push({ t: it.str.trim(), x0: x, x1: x + (it.width || h * it.str.length * 0.5), y0: y - h, y1: y });
  }
  if (mots.map((m) => m.t).join("").length >= 80) return { mots, largeur: vue.width, image: false };
  // Pas de texte : la page en image (300 dpi), lue par Tesseract.
  const v = page.getViewport({ scale: CL.OCR_ECHELLE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(v.width);
  canvas.height = Math.round(v.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: v }).promise;
  return { ...(await motsImageClaustra(canvas)), image: true };
}

async function motsImageClaustra(image) {
  const w = await moteurOcr();
  const { data } = await w.recognize(image, {}, { text: true, blocks: true });
  const mots = [];
  for (const b of data.blocks || [])
    for (const p of b.paragraphs || [])
      for (const l of p.lines || [])
        for (const m of l.words || []) if (m.text && m.text.trim()) mots.push({ t: m.text.trim(), x0: m.bbox.x0, x1: m.bbox.x1, y0: m.bbox.y0, y1: m.bbox.y1 });
  return { mots, largeur: image.width };
}

// Lignes de texte : mots regroupés par hauteur (milieu vertical), puis de gauche à droite.
function lignesDesMots(mots) {
  const tries = [...mots].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const hauteurs = tries.map((m) => m.y1 - m.y0).sort((a, b) => a - b);
  const tol = Math.max(2, (hauteurs[Math.floor(hauteurs.length / 2)] || 10) * 0.55);
  const lignes = [];
  for (const m of tries) {
    const c = (m.y0 + m.y1) / 2;
    const l = lignes.find((x) => Math.abs(x.c - c) <= tol);
    if (l) {
      l.mots.push(m);
      l.c = (l.c * (l.mots.length - 1) + c) / l.mots.length;
    } else lignes.push({ c, mots: [m] });
  }
  for (const l of lignes) l.mots.sort((a, b) => a.x0 - b.x0);
  lignes.sort((a, b) => a.c - b.c);
  return lignes.map((l) => ({ mots: l.mots, texte: l.mots.map((m) => m.t).join(" ").replace(/\s+/g, " ").trim() }));
}

// ---------- Ce que dit la confirmation ----------

const sansAccentsCl = (t) => String(t || "").normalize("NFD").replace(/\p{M}/gu, "").replace(/[’`]/g, "'").toLowerCase();
// Chiffres mal lus dans l'image : O → 0, l / I → 1 (seulement collés à des chiffres).
const chiffresCl = (t) => String(t || "").replace(/(?<=\d)[oO]|[oO](?=\d)/g, "0").replace(/(?<=\d)[lI|]|[lI|](?=\d)/g, "1");
const entierCl = (v) => {
  const n = parseInt(chiffresCl(v).replace(/\s/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

function aggloDuClaustra(ep) {
  const e = Number(ep);
  if (e >= 36 && e <= 42) return "SAG38HYBR";
  if (e >= 19 && e <= 23) return "SAG19HYBR";
  return "SAG28HYBR";
}

// pages : [{ mots, largeur }] → { commande, reference, client, representant, transporteur, semaine, annee, claustras, autres }.
function lireConfirmationClaustra(pages) {
  const lignes = [];
  const gauche = [];
  pages.forEach((p) => {
    const ls = lignesDesMots(p.mots);
    for (const l of ls) lignes.push(l.texte);
    // En-tête : seulement la moitié gauche (la droite porte l'adresse du client, sur les mêmes lignes).
    const g = lignesDesMots(p.mots.filter((m) => m.x1 < p.largeur * 0.47));
    for (const l of g) gauche.push(l.texte);
  });
  const tout = lignes.join("\n");
  const r = { commande: "", reference: "", client: "", representant: "", transporteur: "", semaine: "", annee: "", claustras: [], autres: 0 };
  const cvc = /CVC\s?(\d{8})/i.exec(chiffresCl(tout));
  if (cvc) r.commande = `CVC${cvc[1]}`;
  const liv = /semaine\s*(\d{1,2})\s*\/\s*(\d{4})/i.exec(chiffresCl(tout));
  if (liv) [r.semaine, r.annee] = [String(Number(liv[1])), liv[2]];
  for (let i = 0; i < gauche.length; i++) {
    const t = gauche[i];
    const n = sansAccentsCl(t);
    if (!r.reference && /^reference\b/.test(n)) r.reference = t.replace(/^\S+\s*/, "").replace(/^[\s:!|.;,]+/, "").trim();
    if (!r.transporteur && /^transporteur\b/.test(n)) r.transporteur = t.replace(/^\S+\s*/, "").replace(/^[\s:!|.;,]+/, "").trim();
    if (!r.client && /code client/.test(n)) {
      const valeurs = (gauche[i + 1] || "").split(/[\s:|!]+/).filter(Boolean);
      const iClient = valeurs.findIndex((v) => /^[A-Z0-9]{6,14}$/.test(v) && /\d/.test(v) && /[A-Z]/.test(v));
      if (iClient >= 0) {
        r.client = valeurs[iClient];
        const rep = valeurs.slice(iClient + 1).find((v) => /^[A-ZÀ-Ü][A-ZÀ-Ü'-]{2,}$/.test(v) && v !== "ADV");
        if (rep) r.representant = rep;
      }
    }
  }
  // Les lignes de commande : « N CODE DÉSIGNATION … » jusqu'à la suivante ; un claustra par ligne qui en parle.
  const debuts = [];
  lignes.forEach((t, i) => {
    const m = /^(\d{1,3})\s+[|!]?\s*([A-Z][A-Z0-9-]{1,})\b/.exec(t);
    if (m && !/^\d+\s+(rue|av|bd|chemin|route)\b/i.test(t)) debuts.push({ i, ligne: Number(m[1]) });
  });
  debuts.forEach((d, k) => {
    const bloc = lignes.slice(d.i, k + 1 < debuts.length ? debuts[k + 1].i : lignes.length);
    if (!/claustra/i.test(sansAccentsCl(bloc.join(" ")))) {
      r.autres++;
      return;
    }
    r.claustras.push(lireBlocClaustra(bloc, d.ligne));
  });
  return r;
}

function lireBlocClaustra(bloc, ligne) {
  const c = { ligne: String(ligne), coloris: "", colorisNom: "", epaisseur: "", longueur: "", hauteur: "", droites: "", largeurDroites: "", obliques: "", largeurObliques: "", epaisseurLames: "", profondeurLisses: "", montage: true, protection: true, qte: "1", agglo: "", aLancer: true };
  // V6.8 : « Largeur des lames : 80 et 77 mm » : la confirmation ne dit pas quelles lames font 77 et lesquelles 80 ;
  // seul le plan le dit. Les deux largeurs sont gardées (largeursLames) et la largeur de chaque lame se saisit en
  // regardant le plan (photo prise par le téléphone). Avant, seul le premier nombre était lu (cas réel CVC26100433).
  let largeursLames = null;
  for (const brut of bloc) {
    const t = chiffresCl(brut);
    const n = sansAccentsCl(t);
    let m;
    if (!c.coloris && (m = /coloris\s*:?\s*([A-Z0-9][A-Z0-9-]*)\s*(.*)$/i.exec(t))) [c.coloris, c.colorisNom] = [m[1].toUpperCase(), m[2].trim()];
    if ((m = /^epaisseur des lames\s*:?\s*(\d+)/.exec(n))) c.epaisseurLames = m[1];
    else if (!c.epaisseur && (m = /^epaisseur\s*:?\s*(\d+)/.exec(n))) c.epaisseur = m[1];
    if ((m = /longueur\s*:?\s*(\d+)\s*mm.*hauteur\s*:?\s*(\d+)/.exec(n))) [c.longueur, c.hauteur] = [m[1], m[2]];
    if ((m = /(\d+)\s*lames?\s*droites?/.exec(n))) c.droites = m[1];
    if ((m = /(\d+)\s*lames?\s*obliques?/.exec(n))) c.obliques = m[1];
    if ((m = /largeur des lames droites?\s*:?\s*(\d+)/.exec(n))) c.largeurDroites = m[1];
    else if ((m = /largeur des lames obliques?\s*:?\s*(\d+)/.exec(n))) c.largeurObliques = m[1];
    else if ((m = /largeur des lames\s*:?\s*(.*)$/.exec(n))) {
      const nombres = (m[1].split("mm")[0].match(/\d+/g) || []).filter((x) => Number(x) > 0);
      if (nombres.length) largeursLames = nombres;
    }
    if ((m = /profondeur des lisses\s*:?\s*(\d+)/.exec(n))) c.profondeurLisses = m[1];
    if ((m = /emballage\s*:?\s*(non)?/.exec(n))) c.protection = !m[1];
    if ((m = /montage\s*:?\s*(non)?/.exec(n))) c.montage = !m[1];
    if ((m = /(\d+[.,]\d{2})\s+(\d+)[.,]\d{2}\s+(\d+[.,]\d{2})/.exec(t))) c.qte = String(Number(m[2]) || 1);
  }
  if (largeursLames && largeursLames.length > 1) c.largeursLames = [...new Set(largeursLames)];
  else if (largeursLames) {
    // Une seule largeur : toutes les lames.
    if (c.droites && !c.largeurDroites) c.largeurDroites = largeursLames[0];
    if (c.obliques && !c.largeurObliques) c.largeurObliques = largeursLames[0];
  }
  c.agglo = aggloDuClaustra(c.epaisseur);
  return c;
}

// ---------- Les pièces et le fichier de lancement (règles du logiciel Claustra) ----------

const nombreCl = (v) => {
  const t = String(v ?? "").trim().replace(",", ".");
  return t === "" ? null : Number(t);
};
const codeCouleurCl = (c) => String(c || "").trim().split(/\s+/)[0].toUpperCase();

// V6.8 : les lames en lignes { sorte: droite | oblique, nombre, largeur } — plusieurs largeurs pour une même sorte
// possibles (ex. 6 obliques à 77 et 2 à 80, lu sur le plan). Sans lignes saisies : celles de la confirmation.
function lamesDe(c) {
  if (Array.isArray(c.lames)) return c.lames;
  const r = [];
  if (String(c.droites || "").trim()) r.push({ sorte: "droite", nombre: String(c.droites), largeur: String(c.largeurDroites || "") });
  if (String(c.obliques || "").trim()) r.push({ sorte: "oblique", nombre: String(c.obliques), largeur: String(c.largeurObliques || "") });
  return r;
}
const pluralCl = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

// Ce qui ne colle pas avec la confirmation (n'empêche pas de créer le fichier : le plan fait foi).
function avertissementsLames(c) {
  const a = [];
  const somme = (sorte) => lamesDe(c).filter((x) => x.sorte === sorte).reduce((t, x) => t + (nombreCl(x.nombre) || 0), 0);
  for (const [sorte, conf] of [["droite", c.droites], ["oblique", c.obliques]]) {
    const n = nombreCl(conf);
    if (n === null) continue;
    const saisi = somme(sorte);
    if (saisi !== n) a.push(`la confirmation dit ${n} lame${n > 1 ? "s" : ""} ${sorte}${n > 1 ? "s" : ""}, ${saisi} saisie${saisi > 1 ? "s" : ""}`);
  }
  const permises = (c.largeursLames || []).map(Number);
  if (permises.length)
    for (const x of lamesDe(c)) {
      const lg = nombreCl(x.largeur);
      if (lg !== null && !permises.includes(lg)) a.push(`largeur ${lg} mm : pas sur la confirmation (${c.largeursLames.join(" et ")} mm)`);
    }
  return [...new Set(a)];
}

function piecesClaustra(c) {
  const erreurs = [];
  const L = nombreCl(c.longueur);
  const H = nombreCl(c.hauteur);
  const ep = nombreCl(c.epaisseur);
  const prof = nombreCl(c.profondeurLisses);
  const q = Math.max(1, Math.round(nombreCl(c.qte) || 1));
  const positif = (v) => v !== null && Number.isFinite(v) && v > 0;
  if (!codeCouleurCl(c.coloris)) erreurs.push("coloris");
  if (!positif(L)) erreurs.push("longueur");
  if (!positif(H) || H <= 2 * CL.LISSE) erreurs.push("hauteur");
  if (!positif(ep)) erreurs.push("épaisseur");
  if (!positif(prof)) erreurs.push("profondeur des lisses");
  // Les lames, regroupées par sorte et largeur (obliques puis droites, comme le logiciel Claustra).
  const groupes = new Map();
  let total = 0;
  const plusieurs = (c.largeursLames || []).length > 1;
  for (const x of lamesDe(c)) {
    const nb = nombreCl(x.nombre);
    const lg = nombreCl(x.largeur);
    if (nb === null && lg === null) continue; // ligne vide
    if (nb === null || !Number.isInteger(nb) || nb < 0) {
      erreurs.push("nombre de lames (entier)");
      continue;
    }
    if (nb === 0) continue;
    const sorte = x.sorte === "droite" ? "droite" : "oblique";
    if (!positif(lg)) {
      erreurs.push(`largeur des lames ${sorte}s${plusieurs ? ` (voir le plan : ${c.largeursLames.join(" ou ")} mm)` : ""}`);
      continue;
    }
    const k = `${sorte}|${lg}`;
    groupes.set(k, { sorte, l: lg, n: (groupes.has(k) ? groupes.get(k).n : 0) + nb });
    total += nb;
  }
  if (!total && !erreurs.some((e) => /lames/.test(e))) erreurs.push("nombre de lames");
  if (erreurs.length) return { pieces: [], erreurs: [...new Set(erreurs)] };
  const pieces = [{ nom: "Lisse", L, l: prof, e: ep, qte: 2 * q, chants: 4 }];
  const ordre = [...groupes.values()].sort((a, b) => (a.sorte === b.sorte ? b.l - a.l : a.sorte === "oblique" ? -1 : 1));
  for (const g of ordre) pieces.push({ nom: g.sorte === "oblique" ? "Lame oblique" : "Lame droite", L: H - 2 * CL.LISSE, l: g.l, e: ep, qte: g.n * q, chants: 2 });
  if (c.protection) {
    pieces.push({ nom: "Protection", L: H + 50, l: L + 50, e: 19, qte: 2 * q, protection: true });
    pieces.push({ nom: "Protection", L: H + 50, l: 85, e: 19, qte: 2 * q, protection: true });
    pieces.push({ nom: "Protection", L: L - 38, l: 85, e: 19, qte: 2 * q, protection: true });
  }
  return { pieces, erreurs };
}

const texteNombreCl = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

function ligneLancementClaustra(p, c, cmd) {
  const code = codeCouleurCl(c.coloris);
  const chant = /^\d+$/.test(code) ? Number(code) : code;
  const surcote = p.protection ? 0 : CL.SURCOTE;
  const numero = String(cmd.commande || "").trim().toUpperCase();
  const v = {
    conf_commande: numero,
    conf_ligne: Number(c.ligne) || 1,
    conf_article: "CLAUSTRA",
    conf_epaisseur: nombreCl(c.epaisseur),
    conf_longueur: p.L,
    conf_largeur: p.l,
    longueur: p.L + surcote,
    largeur: p.l + surcote,
    surepaisseur: surcote,
    agglo: p.protection ? "PROTECTION" : c.agglo || "SAG28HYBR",
    comdet_qte: p.qte,
    com_livsem: nombreCl(cmd.semaine),
    com_livan: nombreCl(cmd.annee),
    comprod_lancement: String(cmd.representant || "").trim().toUpperCase(),
    com_clientcom: String(cmd.client || "").trim().toUpperCase(),
    com_reference: String(cmd.reference || "").trim(),
    commentaire: c.montage ? "A MONTER" : "ENKIT",
    "commande+ligne": `${numero}${String(Number(c.ligne) || 1).padStart(3, "0")}`,
    "LongueurxLargeurxEpaisseur fini": `${texteNombreCl(p.L)} X ${texteNombreCl(p.l)} X ${texteNombreCl(p.e)}`,
    trans_nomcourt: String(cmd.transporteur || "").trim().toUpperCase(),
  };
  if (!p.protection) {
    Object.assign(v, { coloris: code, coloris_inf: code, conf_chantavant: chant, conf_chantarriere: chant, idPlan: CL.ID_PLAN, "Type chant": "PVC", CBD: "CBD" });
    if (p.chants === 4) Object.assign(v, { conf_chantgauche: chant, conf_chantdroit: chant });
  }
  v["LongueurxLargeur debit"] = `${texteNombreCl(v.longueur)} X ${texteNombreCl(v.largeur)}`;
  return COLONNES_LAN_CLAUSTRA.map((n) => (v[n] === undefined || v[n] === "" ? null : v[n]));
}

function erreursCommandeClaustra(cmd) {
  const e = [];
  if (!/^CVC\d{8}$/i.test(String(cmd.commande || "").trim())) e.push("n° de commande (CVC + 8 chiffres)");
  if (!String(cmd.client || "").trim()) e.push("code client");
  if (!String(cmd.representant || "").trim()) e.push("représentant");
  const s = nombreCl(cmd.semaine);
  if (!Number.isInteger(s) || s < 1 || s > 53) e.push("semaine de livraison");
  const a = nombreCl(cmd.annee);
  if (!Number.isInteger(a) || a < 2020 || a > 2100) e.push("année");
  return e;
}

// Toutes les lignes du fichier (claustras cochés), ou ce qui manque.
function lignesFichierClaustras() {
  const manque = [];
  const lignes = [];
  const pieces = [];
  for (const cmd of claustras.confirmations) {
    const choisis = cmd.claustras.filter((c) => c.aLancer);
    if (!choisis.length) continue;
    for (const e of erreursCommandeClaustra(cmd)) manque.push(`${cmd.commande || cmd.fichier} : ${e}`);
    for (const c of choisis) {
      const r = piecesClaustra(c);
      if (r.erreurs.length) manque.push(`${cmd.commande || cmd.fichier} ligne ${c.ligne || "?"} : ${r.erreurs.join(", ")}`);
      for (const p of r.pieces) {
        lignes.push(ligneLancementClaustra(p, c, cmd));
        pieces.push({ cmd, c, p });
      }
    }
  }
  return { lignes, pieces, manque };
}

function nomFichierClaustrasParDefaut() {
  const parSemaine = new Map();
  for (const cmd of claustras.confirmations)
    if (cmd.claustras.some((c) => c.aLancer) && cmd.semaine) parSemaine.set(`${cmd.annee}|${cmd.semaine}`, (parSemaine.get(`${cmd.annee}|${cmd.semaine}`) || 0) + 1);
  const [cle] = [...parSemaine.entries()].sort((a, b) => b[1] - a[1])[0] || [""];
  const [a, s] = cle.split("|");
  return a && s ? `LAN${String(a).slice(-2)}${String(s).padStart(2, "0")}CLAUSTRA` : "LANCLAUSTRA";
}

async function classeurClaustras(lignes) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Feuil1", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(COLONNES_LAN_CLAUSTRA);
  ws.getRow(1).eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF808080" } }));
  for (const l of lignes) ws.addRow(l);
  COLONNES_LAN_CLAUSTRA.forEach((n, j) => (ws.getColumn(j + 1).width = Math.max(9, Math.min(34, n.length + 3))));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

async function creerFichierClaustras() {
  const { lignes, manque } = lignesFichierClaustras();
  if (manque.length || !lignes.length) return;
  const nom = `${(claustras.nomFichier || nomFichierClaustrasParDefaut()).replace(/\.xlsx$/i, "").trim() || "LANCLAUSTRA"}.xlsx`;
  const octets = await classeurClaustras(lignes);
  const type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  let enregistre = null;
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const fh = await window.showSaveFilePicker({ suggestedName: nom, types: [{ description: "Classeur Excel", accept: { [type]: [".xlsx"] } }] });
      const w = await fh.createWritable();
      await w.write(octets);
      await w.close();
      enregistre = fh.name;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  if (!enregistre) {
    telecharger(nom, octets, type);
    enregistre = nom;
  }
  claustras.message = `✔ ${enregistre} créé : ${lignes.length} ligne${lignes.length > 1 ? "s" : ""}.`;
  afficherClaustras();
}

// ---------- Lecture des confirmations ----------

function lireClaustrasMemoire() {
  if (claustras.lu) return;
  claustras.lu = true;
  try {
    const v = JSON.parse(localStorage.getItem(CLE_CLAUSTRAS) || "null");
    if (v && Array.isArray(v.confirmations)) Object.assign(claustras, { confirmations: v.confirmations, nomFichier: v.nomFichier || "", nbPhotos: v.nbPhotos && typeof v.nbPhotos === "object" ? v.nbPhotos : {} });
  } catch (_e) {
    // rien de gardé
  }
}
function garderClaustras() {
  lireClaustrasMemoire(); // jamais écrire par-dessus ce qui est gardé sans l'avoir lu
  try {
    localStorage.setItem(CLE_CLAUSTRAS, JSON.stringify({ confirmations: claustras.confirmations, nomFichier: claustras.nomFichier, nbPhotos: claustras.nbPhotos }));
  } catch (_e) {
    // sans place : gardé le temps de la page
  }
  // V6.8 : le téléphone reçoit la liste des commandes claustras (pour y prendre le plan en photo).
  if (typeof planifierEnvoiTelephone === "function") planifierEnvoiTelephone();
}

// ---------- V6.8 : photos du plan du claustra (prises par le téléphone, ou ajoutées sur ce PC) ----------
// La confirmation ne dit pas toujours quelle lame a quelle largeur (« 80 et 77 mm ») : le plan le dit. Le téléphone le
// prend en photo et l'envoie au PC par le canal retour (chiffré) ; la photo est gardée dans ce navigateur (IndexedDB),
// rangée par n° de commande, et affichée à côté de la saisie des lames.
const BASE_PHOTOS_CL = "sentinelle-claustras-photos";
const MAX_PHOTO_CL = 12 * 1024 * 1024;
let basePhotosCl = null;
function ouvrirPhotosCl() {
  if (!basePhotosCl) {
    basePhotosCl = new Promise((ok, ko) => {
      if (!window.indexedDB) return ko(new Error("IndexedDB indisponible"));
      const q = indexedDB.open(BASE_PHOTOS_CL, 1);
      q.onupgradeneeded = () => q.result.createObjectStore("photos", { keyPath: "id" });
      q.onsuccess = () => ok(q.result);
      q.onerror = () => ko(q.error);
    });
    basePhotosCl.catch(() => (basePhotosCl = null));
  }
  return basePhotosCl;
}
async function transactionPhotosCl(mode, faire) {
  const db = await ouvrirPhotosCl();
  return new Promise((ok, ko) => {
    const tx = db.transaction("photos", mode);
    const q = faire(tx.objectStore("photos"));
    tx.oncomplete = () => ok(q && "result" in q ? q.result : undefined);
    tx.onerror = () => ko(tx.error);
    tx.onabort = () => ko(tx.error);
  });
}
// Recharge les photos (adresses d'affichage) et le nombre par commande (pour le téléphone).
async function chargerPhotosClaustras() {
  let toutes = [];
  try {
    toutes = (await transactionPhotosCl("readonly", (st) => st.getAll())) || [];
  } catch (_e) {
    toutes = [];
  }
  for (const liste of claustras.photos.values()) for (const p of liste) URL.revokeObjectURL(p.url);
  claustras.photos = new Map();
  for (const p of toutes.sort((a, b) => String(a.quand).localeCompare(String(b.quand)))) {
    if (!claustras.photos.has(p.commande)) claustras.photos.set(p.commande, []);
    claustras.photos.get(p.commande).push({ id: p.id, commande: p.commande, quand: p.quand, source: p.source, url: URL.createObjectURL(p.donnees) });
  }
  claustras.photosChargees = true;
  const nb = Object.fromEntries([...claustras.photos.entries()].map(([k, v]) => [k, v.length]));
  if (JSON.stringify(nb) !== JSON.stringify(claustras.nbPhotos || {})) {
    claustras.nbPhotos = nb;
    garderClaustras();
  }
}
async function enregistrerPhotoClaustra(p) {
  await transactionPhotosCl("readwrite", (st) => st.put(p));
  await chargerPhotosClaustras();
}
async function supprimerPhotoClaustra(id) {
  await transactionPhotosCl("readwrite", (st) => st.delete(id));
  await chargerPhotosClaustras();
}
const typeImageCl = (o) => (o[0] === 0xff && o[1] === 0xd8 ? "image/jpeg" : o[0] === 0x89 && o[1] === 0x50 && o[2] === 0x4e && o[3] === 0x47 ? "image/png" : null);

// Demande du téléphone « photoClaustra » : { id, commande, image (JPEG en base64), quand }.
async function photoClaustraDuTelephone(d) {
  const commande = String(d.commande || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!/^CVC\d{8}$/.test(commande)) return { ok: false, texte: `photo du plan : n° de commande « ${String(d.commande || "").slice(0, 20)} » invalide` };
  let octets;
  try {
    octets = Uint8Array.from(atob(String(d.image || "")), (x) => x.charCodeAt(0));
  } catch (_e) {
    return { ok: false, texte: `photo du plan ${commande} : image illisible` };
  }
  const type = typeImageCl(octets);
  if (!type || octets.length > MAX_PHOTO_CL) return { ok: false, texte: `photo du plan ${commande} : ce n'est pas une photo (JPEG ou PNG de moins de 12 Mo)` };
  await enregistrerPhotoClaustra({ id: `tel-${String(d.id).slice(0, 60)}`, commande, quand: String(d.quand || new Date().toISOString()), source: "telephone", type, donnees: new Blob([octets], { type }) });
  lireClaustrasMemoire();
  const connue = claustras.confirmations.some((c) => String(c.commande || "").toUpperCase() === commande);
  if (typeof onglet !== "undefined" && onglet === "claustras") afficherClaustras();
  return { ok: true, texte: `Photo du plan reçue pour ${commande}${connue ? " (Claustras)" : " : elle attend la confirmation de commande dans Claustras"}` };
}

// Ce que le téléphone reçoit : les commandes claustras lues sur ce PC (pour y rattacher la photo du plan).
function claustrasPourTelephone() {
  lireClaustrasMemoire();
  return claustras.confirmations
    .filter((c) => /^CVC\d{8}$/i.test(String(c.commande || "")) && c.claustras && c.claustras.length)
    .map((c) => ({
      commande: String(c.commande).toUpperCase(),
      reference: String(c.reference || ""),
      client: String(c.client || ""),
      semaine: String(c.semaine || ""),
      annee: String(c.annee || ""),
      lignes: c.claustras.length,
      plusieursLargeurs: c.claustras.some((x) => (x.largeursLames || []).length > 1),
      photos: (claustras.nbPhotos || {})[String(c.commande).toUpperCase()] || 0,
    }));
}

function htmlPhotosClaustra(cmd, i) {
  const photos = claustras.photos.get(String(cmd.commande || "").toUpperCase()) || [];
  const date = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  const ajout = `<button type="button" class="texte" data-cl-photo-ajouter="${i}">Ajouter une photo du plan (fichier)…</button><input type="file" accept="image/*" multiple hidden data-cl-photo-fichier="${i}">`;
  if (!photos.length)
    return `<aside class="cl-photos cl-photos-vide"><div class="cl-photos-titre">Plan du claustra</div><div class="note">Pas encore de photo. Sur le téléphone : <strong>Claustras</strong> → cette commande → <strong>Photo du plan</strong> ; elle arrive ici toute seule (une minute environ).</div>${ajout}</aside>`;
  return `<aside class="cl-photos"><div class="cl-photos-titre">Plan du claustra · ${photos.length} photo${photos.length > 1 ? "s" : ""}</div>${photos
    .map((p) => `<figure class="cl-photo"><img src="${p.url}" alt="Plan ${echapper(p.commande)}" data-cl-photo-voir="${echapper(p.id)}" title="Cliquer pour agrandir">
      <figcaption>${p.source === "telephone" ? "du téléphone" : "ajoutée sur le PC"} · ${echapper(date(p.quand))} <button type="button" class="texte" data-cl-photo-suppr="${echapper(p.id)}">Supprimer</button></figcaption></figure>`)
    .join("")}${ajout}</aside>`;
}

// Visionneuse : la photo en grand (taille réelle, tourner), par-dessus la page.
function voirPhotoClaustra(id) {
  const p = [...claustras.photos.values()].flat().find((x) => x.id === id);
  if (!p) return;
  const fond = document.createElement("div");
  fond.className = "cl-visionneuse";
  fond.innerHTML = `<div class="cl-vis-barre"><strong>Plan ${echapper(p.commande)}</strong><span class="cl-vis-actions"><button type="button" data-a="taille">Taille réelle</button><button type="button" data-a="tourner">Tourner</button><button type="button" data-a="fermer">Fermer</button></span></div><div class="cl-vis-zone"><img src="${p.url}" alt="Plan ${echapper(p.commande)}"></div>`;
  let angle = 0;
  const img = fond.querySelector("img");
  const fermer = () => {
    fond.remove();
    document.removeEventListener("keydown", touche);
  };
  const touche = (e) => {
    if (e.key === "Escape") fermer();
  };
  fond.addEventListener("click", (e) => {
    const a = e.target && e.target.dataset ? e.target.dataset.a : "";
    if (a === "fermer" || e.target === fond) fermer();
    else if (a === "taille") {
      fond.classList.toggle("reelle");
      e.target.textContent = fond.classList.contains("reelle") ? "Ajuster à l'écran" : "Taille réelle";
    } else if (a === "tourner") {
      angle = (angle + 90) % 360;
      img.style.transform = `rotate(${angle}deg)`;
    }
  });
  document.addEventListener("keydown", touche);
  document.body.appendChild(fond);
}

async function pdfsDuDossierClaustras(dossier, chemin = "") {
  const res = [];
  for await (const [nom, h] of dossier.entries()) {
    if (h.kind === "file" && /\.pdf$/i.test(nom)) res.push({ fichier: await h.getFile(), chemin: chemin + nom });
    else if (h.kind === "directory") res.push(...(await pdfsDuDossierClaustras(h, `${chemin}${nom}/`)));
  }
  return res;
}

async function lireConfirmationsClaustras(entrees) {
  claustras.erreur = null;
  claustras.message = null;
  const deja = new Map(claustras.confirmations.map((c) => [c.cle, c]));
  let n = 0;
  for (const { fichier, chemin } of entrees) {
    n++;
    const cle = `${chemin || fichier.name}|${fichier.size}|${fichier.lastModified}`;
    if (deja.has(cle) && deja.get(cle).lecture === LECTURE_CL) continue;
    claustras.enCours = `Lecture ${n} / ${entrees.length} : ${chemin || fichier.name}`;
    afficherClaustras();
    try {
      const doc = await chargerDocumentPDF(fichier);
      const pages = [];
      let image = false;
      for (let i = 1; i <= doc.numPages; i++) {
        if (i > 1) {
          claustras.enCours = `Lecture ${n} / ${entrees.length} : ${chemin || fichier.name} (page ${i} / ${doc.numPages})`;
          afficherClaustras();
        }
        const p = await motsPageClaustra(await doc.getPage(i));
        image = image || p.image;
        pages.push(p);
      }
      const lu = lireConfirmationClaustra(pages);
      const cmd = { cle, fichier: chemin || fichier.name, image, lecture: LECTURE_CL, ...lu };
      // Une commande déjà lue (même CVC, autre fichier, ou lue avec une version plus ancienne) : la plus récente remplace l'ancienne.
      claustras.confirmations = claustras.confirmations.filter((c) => c.cle !== cle && !(cmd.commande && c.commande === cmd.commande));
      claustras.confirmations.push(cmd);
    } catch (e) {
      claustras.confirmations = claustras.confirmations.filter((c) => c.cle !== cle);
      claustras.confirmations.push({ cle, lecture: LECTURE_CL, fichier: chemin || fichier.name, erreur: e && e.message ? e.message : String(e), claustras: [], autres: 0 });
    }
    garderClaustras();
  }
  claustras.enCours = null;
  afficherClaustras();
}

// ---------- Écran ----------

function afficherClaustras() {
  lireClaustrasMemoire();
  const page = $("pageClaustras");
  if (!page) return;
  if (!claustras.photosChargees) {
    claustras.photosChargees = true;
    chargerPhotosClaustras().then(() => afficherClaustras(), () => {});
  }
  const actions = `<button type="button" id="btnClDossier">Lire un dossier de confirmations…</button>
    <button type="button" class="secondaire" id="btnClFichiers">Ajouter des PDF…</button>
    <input type="file" id="fichiersCl" accept=".pdf" multiple hidden>`;
  let html = entetePage(
    "Préparer un lancement",
    "Claustras",
    "Les claustras des confirmations de commande (PDF) d'un dossier, lus tout seuls : vérifiez, corrigez si besoin, puis créez le fichier de lancement.",
    actions
  );
  if (claustras.enCours) html += `<div class="bandeau attention normal">⏳ ${echapper(claustras.enCours)}… (un PDF en image se lit en quelques secondes par page)</div>`;
  if (claustras.erreur) html += `<div class="message-alerte">${echapper(claustras.erreur)}</div>`;
  const avec = claustras.confirmations.filter((c) => c.claustras && c.claustras.length);
  const sans = claustras.confirmations.filter((c) => !c.claustras || !c.claustras.length);
  if (!claustras.confirmations.length) {
    html += `<div class="carte"><div class="carte-titre">Aucune confirmation lue</div>
      <p>Choisissez le dossier où sont enregistrées les confirmations de commande (PDF). Sentinelle les lit toutes (sous-dossiers compris) et garde seulement les lignes « Réalisation d'un claustra ». Les PDF dont le texte est une image (« Microsoft Print to PDF ») sont lus aussi.</p></div>`;
  }
  for (const cmd of avec) html += htmlConfirmationClaustra(cmd, claustras.confirmations.indexOf(cmd));
  if (sans.length)
    html += `<div class="carte"><div class="carte-titre">Sans claustra</div><ul class="cl-liste">${sans
      .map((c) => `<li>${echapper(c.fichier)}${c.commande ? ` · ${echapper(c.commande)}` : ""} — ${c.erreur ? `<span class="message-alerte">illisible : ${echapper(c.erreur)}</span>` : `aucun claustra (${c.autres || 0} autre${(c.autres || 0) > 1 ? "s" : ""} ligne${(c.autres || 0) > 1 ? "s" : ""})`}</li>`)
      .join("")}</ul></div>`;
  // Photos reçues pour une commande pas (encore) lue ici.
  const lues = new Set(claustras.confirmations.map((c) => String(c.commande || "").toUpperCase()));
  const seules = [...claustras.photos.entries()].filter(([k]) => !lues.has(k));
  if (seules.length)
    html += `<div class="carte"><div class="carte-titre">Photos de plan sans confirmation lue</div><div class="note">Elles se rangent toutes seules dans leur commande quand sa confirmation est lue.</div><div class="cl-photos-seules">${seules
      .map(([k, ps]) => `<div><strong>${echapper(k)}</strong>${ps.map((p) => `<figure class="cl-photo"><img src="${p.url}" alt="Plan ${echapper(k)}" data-cl-photo-voir="${echapper(p.id)}"><figcaption><button type="button" class="texte" data-cl-photo-suppr="${echapper(p.id)}">Supprimer</button></figcaption></figure>`).join("")}</div>`)
      .join("")}</div></div>`;
  if (avec.length) html += htmlFichierClaustras();
  if (claustras.confirmations.length) html += `<div class="cl-bas"><button type="button" class="texte" id="btnClVider">Tout effacer (les PDF ne sont pas touchés)</button></div>`;
  page.innerHTML = html;
  brancherClaustras();
}

const CHAMPS_CMD_CL = [["commande", "Commande", 12], ["client", "Code client", 11], ["representant", "Représentant", 10], ["reference", "Référence", 14], ["transporteur", "Transporteur", 10], ["semaine", "Semaine", 4], ["annee", "Année", 5]];
const CHAMPS_CL = [["ligne", "Ligne", 3], ["qte", "Qté", 3], ["coloris", "Coloris", 8], ["epaisseur", "Ép.", 3], ["longueur", "Longueur", 5], ["hauteur", "Hauteur", 5], ["profondeurLisses", "Prof. lisses", 4], ["agglo", "Agglo", 10]];

// V6.8 : les lames, une ligne par sorte et largeur ; avec deux largeurs sur la confirmation, à lire sur le plan.
function htmlLamesClaustra(c, i, j) {
  const lames = lamesDe(c);
  const plusieurs = (c.largeursLames || []).length > 1;
  const conf = [String(c.droites || "").trim() ? pluralCl(Number(c.droites), "droite") : "", String(c.obliques || "").trim() ? pluralCl(Number(c.obliques), "oblique") : ""].filter(Boolean).join(", ");
  const largeursConf = plusieurs ? c.largeursLames.join(" et ") : [...new Set([c.largeurDroites, c.largeurObliques].filter(Boolean))].join(" et ");
  const liste = plusieurs ? `<datalist id="cl-larg-${i}-${j}">${c.largeursLames.map((x) => `<option value="${echapper(x)}">`).join("")}</datalist>` : "";
  const lignes = lames
    .map((x, r) => `<tr><td><select data-cl-lame="${i}:${j}:${r}:sorte"><option value="droite"${x.sorte === "droite" ? " selected" : ""}>droites</option><option value="oblique"${x.sorte !== "droite" ? " selected" : ""}>obliques</option></select></td>
      <td><input type="text" size="3" data-cl-lame="${i}:${j}:${r}:nombre" value="${echapper(x.nombre || "")}" aria-label="Nombre de lames"></td>
      <td><input type="text" size="4" data-cl-lame="${i}:${j}:${r}:largeur" value="${echapper(x.largeur || "")}"${plusieurs ? ` list="cl-larg-${i}-${j}" placeholder="${echapper(c.largeursLames.join(" ou "))}"` : ""} aria-label="Largeur"> mm</td>
      <td><button type="button" class="texte" data-cl-lame-retirer="${i}:${j}:${r}">Retirer</button></td></tr>`)
    .join("");
  const avert = avertissementsLames(c);
  return `<div class="cl-lames"><div class="cl-lames-titre">Lames${conf ? ` <span class="pale">· confirmation : ${echapper(conf)}${largeursConf ? `, largeur ${echapper(largeursConf)} mm` : ""}</span>` : ""}</div>
    ${plusieurs ? `<div class="bandeau attention normal">La confirmation donne ${c.largeursLames.length} largeurs (${echapper(c.largeursLames.join(" et "))} mm) sans dire quelles lames font quoi : regardez le plan (photo) et indiquez la largeur de chaque lame. Pour une même sorte en deux largeurs, faites deux lignes (ex. 6 obliques à 77 et 2 obliques à 80).</div>` : ""}
    <table class="cl-lames-table"><thead><tr><th>Sorte</th><th>Nombre</th><th>Largeur</th><th></th></tr></thead><tbody>${lignes}</tbody></table>${liste}
    <button type="button" class="texte" data-cl-lame-ajouter="${i}:${j}">+ Ajouter une ligne de lames</button>
    ${avert.length ? `<div class="bandeau attention normal">À vérifier : ${echapper(avert.join(" ; "))}</div>` : ""}</div>`;
}

function htmlConfirmationClaustra(cmd, i) {
  const champsCmd = CHAMPS_CMD_CL.map(([k, lib, taille]) => `<label class="cl-champ"><span>${lib}</span><input type="text" size="${taille}" data-cl-cmd="${i}:${k}" value="${echapper(cmd[k] || "")}"></label>`).join("");
  const erreursCmd = erreursCommandeClaustra(cmd);
  const blocs = cmd.claustras
    .map((c, j) => {
      const r = piecesClaustra(c);
      const champs = CHAMPS_CL.map(([k, lib, taille]) => `<label class="cl-champ"><span>${lib}</span><input type="text" size="${taille}" data-cl="${i}:${j}:${k}" value="${echapper(c[k] || "")}"></label>`).join("");
      const cases = `<label class="cl-case"><input type="checkbox" data-cl-case="${i}:${j}:montage" ${c.montage ? "checked" : ""}> montage inclus</label>
        <label class="cl-case"><input type="checkbox" data-cl-case="${i}:${j}:protection" ${c.protection ? "checked" : ""}> emballage inclus</label>
        <label class="cl-case"><input type="checkbox" data-cl-case="${i}:${j}:aLancer" ${c.aLancer ? "checked" : ""}> à lancer</label>`;
      const pieces = r.pieces.length
        ? `<table class="fp-table cl-pieces"><thead><tr><th>Pièce</th><th class="d">Fini (mm)</th><th class="d">Débit</th><th class="d">Qté</th></tr></thead><tbody>${r.pieces
            .map((p) => `<tr${p.protection ? ' class="pale"' : ""}><td>${p.nom}</td><td class="d">${nbFr(p.L)} × ${nbFr(p.l)} × ${p.e}</td><td class="d">${p.protection ? "—" : `${nbFr(p.L + CL.SURCOTE)} × ${nbFr(p.l + CL.SURCOTE)}`}</td><td class="d">${p.qte}</td></tr>`)
            .join("")}</tbody></table>`
        : `<div class="bandeau alerte normal">À compléter : ${echapper(r.erreurs.join(", "))}</div>`;
      return `<div class="cl-claustra${c.aLancer ? "" : " cl-off"}"><div class="cl-titre">Ligne ${echapper(c.ligne)} — claustra ${echapper(c.coloris)} ${echapper(c.colorisNom || "")}${c.epaisseurLames && c.epaisseur && c.epaisseurLames !== c.epaisseur ? ` <span class="pl-puce att pl-mini">lames de ${echapper(c.epaisseurLames)} mm</span>` : ""}</div>
        <div class="cl-champs">${champs}</div>${htmlLamesClaustra(c, i, j)}<div class="cl-cases">${cases}</div>${pieces}
        ${r.pieces.length ? `<details class="cl-plan-bloc"><summary>Voir le plan du claustra</summary>${svgPlanClaustra(c, cmd)}<button type="button" class="secondaire" data-cl-imprimer="${i}:${j}">Imprimer le plan</button></details>` : ""}</div>`;
    })
    .join("");
  return `<div class="carte"><div class="carte-titre">${echapper(cmd.commande || "Commande ?")} <span class="pale cl-source">${echapper(cmd.fichier)}${cmd.image ? " · lu dans l'image" : ""}</span>
      <button type="button" class="texte" data-cl-retirer="${i}" style="float:right">Retirer</button></div>
    <div class="cl-avec-photo"><div class="cl-corps">
    <div class="cl-champs">${champsCmd}</div>
    ${erreursCmd.length ? `<div class="bandeau alerte normal">À compléter : ${echapper(erreursCmd.join(", "))}</div>` : ""}
    ${cmd.autres ? `<div class="note">${cmd.autres} autre${cmd.autres > 1 ? "s" : ""} ligne${cmd.autres > 1 ? "s" : ""} de la commande (pas des claustras) : elles partent dans les lancements habituels.</div>` : ""}
    ${blocs}</div>${htmlPhotosClaustra(cmd, i)}</div></div>`;
}

function htmlFichierClaustras() {
  const { lignes, manque } = lignesFichierClaustras();
  const nom = claustras.nomFichier || nomFichierClaustrasParDefaut();
  return `<div class="carte"><div class="carte-titre">Fichier de lancement</div>
    <div class="cl-champs"><label class="cl-champ"><span>Nom du fichier</span><input type="text" id="nomFichierCl" size="24" value="${echapper(nom)}"></label></div>
    ${manque.length ? `<div class="bandeau alerte normal">À compléter avant de créer le fichier :<br>${manque.map(echapper).join("<br>")}</div>` : `<p class="note">${lignes.length} ligne${lignes.length > 1 ? "s" : ""} (lisses, lames, protections) pour les claustras cochés « à lancer ». Un nouveau fichier : aucun fichier existant n'est modifié.</p>`}
    ${claustras.message ? `<div class="bandeau ok">${echapper(claustras.message)}</div>` : ""}
    <button type="button" id="btnClCreer" ${manque.length || !lignes.length ? "disabled" : ""}>Créer le fichier de lancement</button></div>`;
}

function brancherClaustras() {
  const page = $("pageClaustras");
  const btnDossier = $("btnClDossier");
  if (btnDossier)
    btnDossier.addEventListener("click", async () => {
      if (typeof window.showDirectoryPicker !== "function") {
        claustras.erreur = "Ce navigateur ne sait pas ouvrir un dossier : utilisez « Ajouter des PDF… ».";
        afficherClaustras();
        return;
      }
      try {
        const d = await window.showDirectoryPicker({ id: "confirmations-claustras" });
        await lireConfirmationsClaustras(await pdfsDuDossierClaustras(d));
      } catch (e) {
        if (!(e && e.name === "AbortError")) {
          claustras.enCours = null;
          claustras.erreur = e && e.message ? e.message : String(e);
          afficherClaustras();
        }
      }
    });
  const btnFichiers = $("btnClFichiers");
  const champ = $("fichiersCl");
  if (btnFichiers && champ) {
    btnFichiers.addEventListener("click", () => champ.click());
    champ.addEventListener("change", () => {
      const f = [...champ.files].map((x) => ({ fichier: x, chemin: x.name }));
      if (f.length) lireConfirmationsClaustras(f);
    });
  }
  page.querySelectorAll("[data-cl-cmd]").forEach((el) =>
    el.addEventListener("change", () => {
      const [i, k] = el.dataset.clCmd.split(":");
      claustras.confirmations[Number(i)][k] = el.value.trim();
      garderClaustras();
      afficherClaustras();
    })
  );
  page.querySelectorAll("[data-cl]").forEach((el) =>
    el.addEventListener("change", () => {
      const [i, j, k] = el.dataset.cl.split(":");
      claustras.confirmations[Number(i)].claustras[Number(j)][k] = el.value.trim();
      garderClaustras();
      afficherClaustras();
    })
  );
  // V6.8 : lignes de lames (la première modification fige les lignes tirées de la confirmation).
  const claustraDe = (i, j) => claustras.confirmations[Number(i)].claustras[Number(j)];
  const lignesModifiables = (c) => (c.lames = lamesDe(c).map((x) => ({ ...x })));
  page.querySelectorAll("[data-cl-lame]").forEach((el) =>
    el.addEventListener("change", () => {
      const [i, j, r, k] = el.dataset.clLame.split(":");
      const c = claustraDe(i, j);
      const lames = lignesModifiables(c);
      if (lames[Number(r)]) lames[Number(r)][k] = el.value.trim();
      garderClaustras();
      afficherClaustras();
    })
  );
  page.querySelectorAll("[data-cl-lame-ajouter]").forEach((b) =>
    b.addEventListener("click", () => {
      const [i, j] = b.dataset.clLameAjouter.split(":");
      const c = claustraDe(i, j);
      lignesModifiables(c).push({ sorte: "oblique", nombre: "", largeur: "" });
      garderClaustras();
      afficherClaustras();
    })
  );
  page.querySelectorAll("[data-cl-lame-retirer]").forEach((b) =>
    b.addEventListener("click", () => {
      const [i, j, r] = b.dataset.clLameRetirer.split(":");
      const c = claustraDe(i, j);
      lignesModifiables(c).splice(Number(r), 1);
      garderClaustras();
      afficherClaustras();
    })
  );
  page.querySelectorAll("[data-cl-case]").forEach((el) =>
    el.addEventListener("change", () => {
      const [i, j, k] = el.dataset.clCase.split(":");
      claustras.confirmations[Number(i)].claustras[Number(j)][k] = el.checked;
      garderClaustras();
      afficherClaustras();
    })
  );
  page.querySelectorAll("[data-cl-retirer]").forEach((b) =>
    b.addEventListener("click", () => {
      claustras.confirmations.splice(Number(b.dataset.clRetirer), 1);
      garderClaustras();
      afficherClaustras();
    })
  );
  const nom = $("nomFichierCl");
  if (nom)
    nom.addEventListener("change", () => {
      claustras.nomFichier = nom.value.trim();
      garderClaustras();
    });
  page.querySelectorAll("[data-cl-imprimer]").forEach((b) =>
    b.addEventListener("click", () => {
      const [i, j] = b.dataset.clImprimer.split(":").map(Number);
      const cmd = claustras.confirmations[i];
      const f = window.open("", "_blank");
      if (!f) return;
      f.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Plan ${echapper(cmd.commande || "")} ligne ${echapper(cmd.claustras[j].ligne)}</title>
        <style>@page{size:A4 landscape;margin:0}html,body{margin:0}svg{display:block;width:297mm;height:210mm}</style></head><body>${svgPlanClaustra(cmd.claustras[j], cmd)}</body></html>`);
      f.document.close();
      f.focus();
      setTimeout(() => f.print(), 300);
    })
  );
  page.querySelectorAll("[data-cl-photo-voir]").forEach((im) => im.addEventListener("click", () => voirPhotoClaustra(im.dataset.clPhotoVoir)));
  page.querySelectorAll("[data-cl-photo-suppr]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!window.confirm("Supprimer cette photo du plan ?")) return;
      await supprimerPhotoClaustra(b.dataset.clPhotoSuppr).catch(() => null);
      afficherClaustras();
    })
  );
  page.querySelectorAll("[data-cl-photo-ajouter]").forEach((b) =>
    b.addEventListener("click", () => {
      const champ = page.querySelector(`[data-cl-photo-fichier="${b.dataset.clPhotoAjouter}"]`);
      if (champ) champ.click();
    })
  );
  page.querySelectorAll("[data-cl-photo-fichier]").forEach((champ) =>
    champ.addEventListener("change", async () => {
      const cmd = claustras.confirmations[Number(champ.dataset.clPhotoFichier)];
      const commande = String((cmd && cmd.commande) || "").toUpperCase();
      if (!/^CVC\d{8}$/.test(commande)) {
        claustras.erreur = "Indiquez d'abord le n° de commande (CVC + 8 chiffres) pour y ranger la photo.";
        afficherClaustras();
        return;
      }
      for (const f of [...champ.files]) {
        const octets = new Uint8Array(await f.arrayBuffer());
        const type = typeImageCl(octets);
        if (!type || octets.length > MAX_PHOTO_CL) continue;
        await enregistrerPhotoClaustra({ id: `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, commande, quand: new Date().toISOString(), source: "pc", type, donnees: new Blob([octets], { type }) });
      }
      afficherClaustras();
    })
  );
  const creer = $("btnClCreer");
  if (creer) creer.addEventListener("click", () => creerFichierClaustras());
  const vider = $("btnClVider");
  if (vider)
    vider.addEventListener("click", () => {
      claustras.confirmations = [];
      claustras.nomFichier = "";
      claustras.message = null;
      garderClaustras();
      afficherClaustras();
    });
}

// ---------- Plan du claustra (A4 paysage, en mm) ----------
// Vue de face, de côté et de dessus, cotées, et la liste des pièces. Les lames sont réparties à espaces égaux
// (bouts compris) et centrées dans la profondeur des lisses : la confirmation ne donne pas leur position exacte.
function svgPlanClaustra(c, cmd) {
  const L = nombreCl(c.longueur) || 0;
  const H = nombreCl(c.hauteur) || 0;
  const ep = nombreCl(c.epaisseurLames) || nombreCl(c.epaisseur) || 29;
  const prof = nombreCl(c.profondeurLisses) || 0;
  const lignesLames = lamesDe(c).map((x) => ({ sorte: x.sorte === "droite" ? "droite" : "oblique", n: Math.max(0, Math.round(nombreCl(x.nombre) || 0)), l: nombreCl(x.largeur) || 0 }));
  const nd = lignesLames.filter((x) => x.sorte === "droite").reduce((t, x) => t + x.n, 0);
  const no = lignesLames.filter((x) => x.sorte === "oblique").reduce((t, x) => t + x.n, 0);
  const n = nd + no;
  const largeurs = [...lignesLames.filter((x) => x.sorte === "droite"), ...lignesLames.filter((x) => x.sorte === "oblique")].flatMap((x) => Array(x.n).fill(x.l));
  const lisse = CL.LISSE;
  const lame = H - 2 * lisse;
  const espace = n ? (L - n * ep) / (n + 1) : 0;
  const ECHELLES = [1 / 2, 1 / 5, 1 / 10, 1 / 15, 1 / 20, 1 / 25, 1 / 30, 1 / 40, 1 / 50, 1 / 75, 1 / 100];
  const echelle = (taille, place) => ECHELLES.find((e) => taille * e <= place) || ECHELLES[ECHELLES.length - 1];
  const sF = Math.min(echelle(H, 150), echelle(L, 95));
  const sD = echelle(L, 125);
  const f = (v) => Math.round(v * 100) / 100;
  const bord = "#22231D";
  const bois = "#EAC2B7";
  const out = [];
  const rect = (x, y, w, h, extra = "") => out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${extra}/>`);
  const texte = (x, y, t, taille = 2.6, extra = "") => out.push(`<text x="${f(x)}" y="${f(y)}" font-size="${taille}" ${extra}>${echapper(t)}</text>`);
  // Cote horizontale (au-dessus si dy < 0) ou verticale.
  const coteH = (x1, x2, y, t, dy = -5) => {
    const yc = y + dy;
    out.push(`<path d="M${f(x1)} ${f(y)}V${f(yc + Math.sign(dy) * 1)}M${f(x2)} ${f(y)}V${f(yc + Math.sign(dy) * 1)}" stroke="#797978" stroke-width="0.18"/>`);
    out.push(`<path d="M${f(x1)} ${f(yc)}H${f(x2)}" stroke="#78140C" stroke-width="0.22" marker-start="url(#fl)" marker-end="url(#fl)"/>`);
    texte((x1 + x2) / 2, yc - 0.9, t, 2.5, 'text-anchor="middle" fill="#78140C"');
  };
  const coteV = (y1, y2, x, t, dx = -5) => {
    const xc = x + dx;
    out.push(`<path d="M${f(x)} ${f(y1)}H${f(xc + Math.sign(dx) * 1)}M${f(x)} ${f(y2)}H${f(xc + Math.sign(dx) * 1)}" stroke="#797978" stroke-width="0.18"/>`);
    out.push(`<path d="M${f(xc)} ${f(y1)}V${f(y2)}" stroke="#78140C" stroke-width="0.22" marker-start="url(#fl)" marker-end="url(#fl)"/>`);
    out.push(`<text x="${f(xc - 1)}" y="${f((y1 + y2) / 2)}" font-size="2.5" fill="#78140C" text-anchor="middle" transform="rotate(-90 ${f(xc - 1)} ${f((y1 + y2) / 2)})">${echapper(t)}</text>`);
  };
  const fr = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10).replace(".", ","));
  const lib1 = (s) => `1:${Math.round(1 / s)}`;

  // Vue de face.
  const x0 = 26;
  const y0 = 40;
  texte(x0, y0 - 9, `Vue de face (${lib1(sF)})`, 3, 'font-weight="700" fill="#78140C"');
  rect(x0, y0, L * sF, lisse * sF, `fill="${bois}" stroke="${bord}" stroke-width="0.25"`);
  rect(x0, y0 + (H - lisse) * sF, L * sF, lisse * sF, `fill="${bois}" stroke="${bord}" stroke-width="0.25"`);
  for (let i = 0; i < n; i++) rect(x0 + (espace + i * (ep + espace)) * sF, y0 + lisse * sF, ep * sF, lame * sF, `fill="${i < nd ? bois : "#d9a796"}" stroke="${bord}" stroke-width="0.2"`);
  rect(x0, y0, L * sF, H * sF, `fill="none" stroke="${bord}" stroke-width="0.35"`);
  coteH(x0, x0 + L * sF, y0, `${fr(L)}`);
  coteV(y0, y0 + H * sF, x0, `${fr(H)}`, -6);
  coteV(y0 + lisse * sF, y0 + (H - lisse) * sF, x0 + L * sF, `lames ${fr(lame)}`, 6);
  // Vue de côté.
  const xC = x0 + L * sF + 22;
  texte(xC, y0 - 9, `Côté (${lib1(sF)})`, 3, 'font-weight="700" fill="#78140C"');
  rect(xC, y0, prof * sF, lisse * sF, `fill="${bois}" stroke="${bord}" stroke-width="0.25"`);
  rect(xC, y0 + (H - lisse) * sF, prof * sF, lisse * sF, `fill="${bois}" stroke="${bord}" stroke-width="0.25"`);
  const lMax = Math.max(0, ...largeurs);
  rect(xC + ((prof - lMax) / 2) * sF, y0 + lisse * sF, lMax * sF, lame * sF, `fill="${bois}" stroke="${bord}" stroke-width="0.2"`);
  coteH(xC, xC + prof * sF, y0 + H * sF, `${fr(prof)}`, 6);

  // Vue de dessus (lisse du haut en transparence, lames en pointillés).
  const xD = 150;
  const yD = 48;
  texte(xD, yD - 12, `Vue de dessus (${lib1(sD)})`, 3, 'font-weight="700" fill="#78140C"');
  rect(xD, yD, L * sD, prof * sD, `fill="${bois}" fill-opacity="0.45" stroke="${bord}" stroke-width="0.3"`);
  for (let i = 0; i < n; i++) {
    const lg = largeurs[i];
    const cx = xD + (espace + i * (ep + espace) + ep / 2) * sD;
    const cy = yD + (prof / 2) * sD;
    const rot = i >= nd ? ` transform="rotate(-30 ${f(cx)} ${f(cy)})"` : "";
    out.push(`<rect x="${f(cx - (ep / 2) * sD)}" y="${f(cy - (lg / 2) * sD)}" width="${f(ep * sD)}" height="${f(lg * sD)}" fill="#fff" stroke="${bord}" stroke-width="0.22" stroke-dasharray="0.8 0.5"${rot}/>`);
  }
  coteH(xD, xD + L * sD, yD, `${fr(L)}`);
  coteV(yD, yD + prof * sD, xD, `${fr(prof)}`, -5);
  if (n) {
    const xa = xD + espace * sD;
    coteH(xD, xa, yD + prof * sD, `${fr(espace)}`, 6);
    coteH(xa, xa + ep * sD, yD + prof * sD, `${fr(ep)}`, 6);
    const lg0 = largeurs[0];
    const cy = yD + (prof / 2) * sD;
    coteV(cy - (lg0 / 2) * sD, cy + (lg0 / 2) * sD, xD + L * sD, `${fr(lg0)}`, 6);
  }
  const largeursTexte = [...new Set(largeurs)].map(fr).join(" et ");
  texte(xD, yD + prof * sD + 15, `${n} lame${n > 1 ? "s" : ""} de ${fr(ep)} mm${nd && no ? ` (${nd} droite${nd > 1 ? "s" : ""}, ${no} oblique${no > 1 ? "s" : ""})` : no ? " obliques" : " droites"}, largeur ${largeursTexte} mm, espace ${fr(espace)} mm entre les lames et aux bouts (supposé : réparties à espaces égaux ; la photo du plan fait foi).`, 2.4, 'fill="#797978"');

  // Pièces.
  const r = piecesClaustra(c);
  const yT = yD + prof * sD + 26;
  texte(xD, yT, "Pièces", 3, 'font-weight="700" fill="#78140C"');
  const lignesT = r.pieces.map((p) => [p.nom, `${fr(p.L)} × ${fr(p.l)} × ${fr(p.e)}`, p.protection ? "—" : `${fr(p.L + CL.SURCOTE)} × ${fr(p.l + CL.SURCOTE)}`, String(p.qte), p.protection ? "PROTECTION" : `${c.agglo || "SAG28HYBR"}${p.chants === 4 ? " · 4 chants" : p.chants ? " · chants AV/AR" : ""}`]);
  const cols = [xD, xD + 26, xD + 58, xD + 84, xD + 94];
  ["Pièce", "Fini (mm)", "Débit", "Qté", "Matière"].forEach((t, i) => texte(cols[i], yT + 6, t, 2.4, 'font-weight="700" fill="#797978"'));
  lignesT.forEach((l, k) => l.forEach((t, i) => texte(cols[i], yT + 11 + k * 4.6, t, 2.5, i === 0 ? 'font-weight="700"' : "")));
  if (r.erreurs.length) texte(xD, yT + 11, `À compléter : ${r.erreurs.join(", ")}`, 2.6, 'fill="#78140C"');

  const titre = `Plan du claustra — ${cmd && cmd.commande ? cmd.commande : ""} ligne ${c.ligne || "?"}`;
  const sous = `${c.coloris || "?"} ${c.colorisNom || ""} · ${fr(L)} × ${fr(H)} · épaisseur ${fr(nombreCl(c.epaisseur) || ep)} mm · ${c.montage ? "montage inclus" : "en kit"} · ${c.protection ? "emballage inclus" : "sans emballage"}${cmd && cmd.reference ? ` · réf. ${cmd.reference}` : ""}${cmd && cmd.semaine ? ` · semaine ${cmd.semaine}` : ""}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210" width="297mm" height="210mm" font-family="Lato, Arial, sans-serif" class="cl-plan">
  <defs><marker id="fl" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="2.2" markerHeight="2.2" orient="auto-start-reverse"><path d="M0 0L6 3L0 6z" fill="#78140C"/></marker></defs>
  <rect x="0" y="0" width="297" height="210" fill="#fff"/>
  <rect x="6" y="6" width="285" height="198" fill="none" stroke="#EAC2B7" stroke-width="0.4"/>
  <text x="12" y="16" font-size="5" font-weight="700" fill="#78140C" font-family="Raleway, Arial, sans-serif">${echapper(titre)}</text>
  <text x="12" y="22" font-size="2.9" fill="#22231D">${echapper(sous)}</text>
  ${out.join("\n  ")}
  <text x="285" y="200" font-size="2.2" fill="#797978" text-anchor="end">LAISNÉ INDUSTRIE · Sentinelle · plan indicatif à partir de la confirmation de commande</text>
</svg>`;
}
