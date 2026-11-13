// ---- V6.4 : lecture du CVC sur l'étiquette Zebra (suivi en direct) ----
// Un petit outil sur chaque PC de validation envoie à Sentinelle, par le mini-site chiffré, l'étiquette
// imprimée (le ZPL de la Zebra). Diakonos dessine l'étiquette en IMAGE (pas de texte, pas de code-barre
// exploitable). Ce module décode cette image et lit le CVC écrit dessus, puis le recoupe avec la liste des
// pièces lancées pour ne jamais se tromper. Aucune base Diakonos n'est touchée.
//
// La lecture se fait en deux temps :
//   1. décoder le dessin de l'étiquette (ZPL « ^GFA » compressé en Z64) → une image noir et blanc ;
//   2. lire la ligne du CVC chiffre par chiffre (les chiffres de la police sont à pas fixe), puis choisir la
//      pièce lancée qui colle le mieux (jamais une pièce inventée ; si c'est trop juste, on met de côté).

// ---------- 1. Décoder le dessin de l'étiquette (ZPL ^GFA, Z64 = zlib + base64) ----------

async function decoderImageEtiquette(octets) {
  const texte = new TextDecoder("latin1").decode(octets);
  const m = texte.match(/\^GFA,\d+,\d+,(\d+),:Z64:/);
  if (!m) throw new Error("pas de dessin ^GFA dans l'étiquette");
  const octetsParLigne = Number(m[1]);
  let reste = texte.slice(m.index + m[0].length).split("^XZ")[0];
  // Données base64 jusqu'au « : » du CRC final.
  const i = reste.lastIndexOf(":");
  const b64 = (i > 0 ? reste.slice(0, i) : reste).replace(/\s+/g, "");
  const comprime = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const brut = new Uint8Array(await new Response(new Blob([comprime]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  const bw = octetsParLigne * 8;
  const bh = Math.floor(brut.length / octetsParLigne);
  // bit 1 = noir, de haut en bas, 8 pixels par octet (bit de poids fort à gauche).
  const brutNoir = (x, y) => (brut[y * octetsParLigne + (x >> 3)] >> (7 - (x & 7))) & 1;
  // L'étiquette est imprimée tournée de 90° : on la remet droite.
  const uw = bh;
  const uh = bw;
  const noir = (x, y) => (x < 0 || y < 0 || x >= uw || y >= uh ? 0 : brutNoir(y, bh - 1 - x));
  return { largeur: uw, hauteur: uh, noir };
}

// ---------- 2. Repérer la ligne du CVC et la lire ----------

// Les bandes horizontales de texte (une par ligne écrite), de haut en bas.
function bandesTexte(img, seuil = 3) {
  const { largeur, hauteur, noir } = img;
  const bandes = [];
  let y = 0;
  while (y < hauteur) {
    let n = 0;
    for (let x = 0; x < largeur; x++) n += noir(x, y);
    if (n > seuil) {
      const y0 = y;
      let vide = 0;
      while (y < hauteur && vide < 3) {
        let m = 0;
        for (let x = 0; x < largeur; x++) m += noir(x, y);
        if (m > seuil) vide = 0;
        else vide++;
        y++;
      }
      bandes.push({ y0, y1: y - vide });
    } else y++;
  }
  return bandes;
}

// Un chiffre « rendu » dans la police de l'étiquette (Arial/Helvetica gras), en noir et blanc, recadré.
const _tplCvc = new Map();
function gabaritChiffre(ch, taille) {
  const cle = ch + "|" + taille;
  if (_tplCvc.has(cle)) return _tplCvc.get(cle);
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 96;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  ctx.font = `bold ${taille}px Arial, "Liberation Sans", Helvetica, sans-serif`;
  ctx.fillText(ch, 2, 2);
  const g = recadrerCanvas(ctx, c.width, c.height);
  _tplCvc.set(cle, g);
  return g;
}

// Un texte « rendu » dans la police de l'étiquette, en noir et blanc, recadré (pour comparer un n° de ligne).
function gabaritTexte(txt, taille) {
  const cle = "T:" + txt + "|" + taille;
  if (_tplCvc.has(cle)) return _tplCvc.get(cle);
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 96;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  ctx.font = `bold ${taille}px Arial, "Liberation Sans", Helvetica, sans-serif`;
  ctx.fillText(txt, 2, 2);
  const g = recadrerCanvas(ctx, c.width, c.height);
  _tplCvc.set(cle, g);
  return g;
}

// Largeur d'un texte dans la même police (pour placer les cases des chiffres).
let _ctxMesure = null;
function largeurTexte(txt, taille) {
  if (!_ctxMesure) _ctxMesure = document.createElement("canvas").getContext("2d");
  _ctxMesure.font = `bold ${taille}px Arial, "Liberation Sans", Helvetica, sans-serif`;
  return _ctxMesure.measureText(txt).width;
}

// Un petit bitmap noir/blanc { w, h, noir(x,y) } recadré sur le noir d'un canvas.
function recadrerCanvas(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const noir = (x, y) => (d[(y * w + x) * 4] < 128 ? 1 : 0);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (noir(x, y)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return { w: 1, h: 1, noir: () => 0 };
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, noir: (x, y) => noir(x0 + x, y0 + y) };
}

// Ressemblance en GARDANT les proportions : les deux bitmaps sont posés, à leur échelle, centrés dans une
// même boîte, puis comparés. Indispensable pour un « 1 » (fin) qu'on ne doit pas confondre avec un « 2 ».
function ressemblanceForme(a, b) {
  const NW = 32, NH = 44;
  const grille = (g) => {
    const e = Math.min(NW / g.w, NH / g.h);
    const w = Math.max(1, Math.round(g.w * e)), h = Math.max(1, Math.round(g.h * e));
    const ox = Math.floor((NW - w) / 2), oy = Math.floor((NH - h) / 2);
    const m = new Uint8Array(NW * NH);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (g.noir(Math.min(g.w - 1, Math.floor((x * g.w) / w)), Math.min(g.h - 1, Math.floor((y * g.h) / h)))) m[(oy + y) * NW + (ox + x)] = 1;
    return m;
  };
  const ga = grille(a), gb = grille(b);
  let inter = 0, uni = 0;
  for (let i = 0; i < ga.length; i++) { if (ga[i] || gb[i]) uni++; if (ga[i] && gb[i]) inter++; }
  return uni ? inter / uni : 0;
}

// Un morceau de l'image (une case de chiffre), recadré sur le noir.
function morceau(img, x0, x1, y0, y1) {
  let ax = x1, ay = y1, bx = x0 - 1, by = y0 - 1;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (img.noir(x, y)) {
        if (x < ax) ax = x;
        if (x > bx) bx = x;
        if (y < ay) ay = y;
        if (y > by) by = y;
      }
  if (bx < ax) return { w: 1, h: 1, noir: () => 0 };
  return { w: bx - ax + 1, h: by - ay + 1, noir: (x, y) => img.noir(ax + x, ay + y) };
}

// Ressemblance entre deux petits bitmaps (part du noir commun) ; b est ramené à la taille de a.
function ressemblance(a, b) {
  let inter = 0, uni = 0;
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const bx = Math.min(b.w - 1, Math.floor((x * b.w) / a.w));
      const by = Math.min(b.h - 1, Math.floor((y * b.h) / a.h));
      const va = a.noir(x, y);
      const vb = b.noir(bx, by);
      if (va || vb) uni++;
      if (va && vb) inter++;
    }
  return uni ? inter / uni : 0;
}

// Lit le CVC d'une étiquette déjà décodée, en le recoupant avec les commandes lancées.
// `candidats` : [{ commande: "CVC26050839", lignes: ["1","2"] }, …] (ou des chaînes de commande).
// Renvoie { commande, ligne, cle, score, marge } ou null si rien de sûr.
function lireCvcImage(img, candidats) {
  // On garde les bandes de vraie hauteur (on écarte les traits de séparation, fins de 1 à 2 px).
  const bandes = bandesTexte(img).filter((b) => b.y1 - b.y0 >= 8);
  if (bandes.length < 2) return null;
  // La ligne du CVC : la bande juste sous le gros titre (1re bande = titre).
  const bande = bandes[1];
  const by0 = bande.y0, by1 = bande.y1;
  // Bord gauche du texte, puis fin du bloc « CVC… » (avant le grand blanc qui précède « lig. »).
  const colonneNoire = (x) => {
    for (let y = by0; y < by1; y++) if (img.noir(x, y)) return true;
    return false;
  };
  let gauche = 0;
  while (gauche < img.largeur && !colonneNoire(gauche)) gauche++;
  // Fin du bloc « CVC… » : le premier vrai espace (avant « lig. »). Les espaces entre lettres/chiffres
  // font 1 à 3 px ; l'espace du mot fait ~0,4 × la hauteur de la bande. On coupe à ~0,22 × la hauteur.
  const hb = by1 - by0;
  const seuilEspace = Math.max(5, Math.round(hb * 0.22));
  let x = gauche, finBloc = gauche, blanc = 0;
  while (x < img.largeur) {
    if (colonneNoire(x)) { blanc = 0; finBloc = x; }
    else { blanc++; if (blanc >= seuilEspace && finBloc > gauche) break; }
    x++;
  }
  finBloc += 1;
  const largeurBloc = finBloc - gauche;
  if (largeurBloc < 40) return null;

  // Taille de police telle que « CVC » + 8 chiffres occupe la largeur du bloc.
  let taille = 24, best = 1e9;
  for (let t = 20; t <= 44; t += 0.5) {
    const l = largeurTexte("CVC", t) + 8 * largeurTexte("0", t);
    if (Math.abs(l - largeurBloc) < best) { best = Math.abs(l - largeurBloc); taille = t; }
  }
  const echelle = largeurBloc / (largeurTexte("CVC", taille) + 8 * largeurTexte("0", taille));
  const wCvc = largeurTexte("CVC", taille) * echelle;
  const wChiffre = largeurTexte("0", taille) * echelle;
  const tTaille = Math.round(taille);

  // Score de chaque chiffre (0..9) dans chacune des 8 cases.
  const scores = [];
  for (let i = 0; i < 8; i++) {
    const cx0 = Math.round(gauche + wCvc + i * wChiffre);
    const cx1 = Math.round(gauche + wCvc + (i + 1) * wChiffre);
    const c = morceau(img, cx0, cx1, by0, by1 + 2);
    const row = {};
    for (let d = 0; d <= 9; d++) row[d] = ressemblance(c, gabaritChiffre(String(d), tTaille));
    scores.push(row);
  }
  const lecture = scores.map((r) => { let m = "0", v = -1; for (let d = 0; d <= 9; d++) if (r[d] > v) { v = r[d]; m = String(d); } return m; }).join("");

  // On choisit la commande lancée qui colle le mieux (somme des scores de ses chiffres).
  const liste = (candidats || []).map((c) => (typeof c === "string" ? { commande: c, lignes: [] } : c)).filter((c) => /^CVC\d{8}$/.test(c.commande));
  const noteCommande = (cmd) => { const t = cmd.slice(3); let s = 0; for (let i = 0; i < 8; i++) s += scores[i][Number(t[i])]; return s / 8; };
  let resultat;
  if (liste.length) {
    const classees = liste.map((c) => ({ ...c, note: noteCommande(c.commande) })).sort((a, b) => b.note - a.note);
    resultat = { commande: classees[0].commande, lignes: classees[0].lignes, score: classees[0].note, marge: classees[0].note - (classees[1] ? classees[1].note : 0) };
  } else {
    // sans liste : la lecture brute (pour les tests / diagnostic)
    const note = scores.reduce((s, r, i) => s + r[Number(lecture[i])], 0) / 8;
    resultat = { commande: "CVC" + lecture, lignes: [], score: note, marge: 0 };
  }

  // La ligne (« lig. N ») : le dernier mot de la bande (après le mot « lig. »).
  const ligne = lireLigne(img, finBloc, by0, by1, tTaille, seuilEspace, resultat.lignes);
  const cle = typeof cleLigne === "function" ? cleLigne(resultat.commande, ligne) : resultat.commande + String(ligne).padStart(3, "0");
  return { commande: resultat.commande, ligne, cle, lectureBrute: "CVC" + lecture, score: resultat.score, marge: resultat.marge };
}

// Lit le numéro de ligne : le dernier « mot » de la bande (après « lig. »), chiffre par chiffre.
function lireLigne(img, apres, by0, by1, taille, seuilEspace, lignesConnues) {
  const colonneNoire = (x) => { for (let y = by0; y < by1; y++) if (img.noir(x, y)) return true; return false; };
  // On découpe la fin de la bande en mots (séparés par un vrai espace) ; le dernier mot est le n° de ligne.
  const mots = [];
  let x = apres, dansMot = false, mx0 = 0, blanc = 0;
  while (x < img.largeur) {
    if (colonneNoire(x)) { if (!dansMot) { dansMot = true; mx0 = x; } blanc = 0; }
    else if (dansMot) { blanc++; if (blanc >= seuilEspace) { mots.push([mx0, x - blanc + 1]); dansMot = false; } }
    x++;
  }
  if (dansMot) mots.push([mx0, x]);
  if (!mots.length) return lignesConnues && lignesConnues[0] ? lignesConnues[0] : "1";
  const [mx0b, mx1b] = mots[mots.length - 1];
  const crop = morceau(img, mx0b, mx1b, by0, by1 + 2);
  // Quand on connaît les lignes possibles de la commande : on redessine chacune et on garde la plus proche
  // (la largeur distingue « 1 » de « 10 », de « 2 »…). C'est le plus sûr.
  if (lignesConnues && lignesConnues.length) {
    let best = -1, meilleur = lignesConnues[0];
    for (const l of lignesConnues) { const s = ressemblanceForme(crop, gabaritTexte(l, taille)); if (s > best) { best = s; meilleur = l; } }
    return meilleur;
  }
  // Sinon : chiffre par chiffre, à pas fixe.
  const wChiffre = Math.max(6, largeurTexte("0", taille));
  const nbCh = Math.max(1, Math.round((mx1b - mx0b) / wChiffre));
  let n = "";
  for (let i = 0; i < nbCh; i++) {
    const c = morceau(img, Math.round(mx0b + (i * (mx1b - mx0b)) / nbCh), Math.round(mx0b + ((i + 1) * (mx1b - mx0b)) / nbCh), by0, by1 + 2);
    let best = -1, bestD = "0";
    for (let d = 0; d <= 9; d++) { const s = ressemblance(c, gabaritChiffre(String(d), taille)); if (s > best) { best = s; bestD = String(d); } }
    n += bestD;
  }
  n = n.replace(/^0+(?=\d)/, "");
  return n || "1";
}

// Décode une étiquette (octets ZPL) et en lit le CVC, recoupé avec les commandes lancées.
async function lireCvcEtiquette(octets, candidats) {
  const img = await decoderImageEtiquette(octets);
  return lireCvcImage(img, candidats);
}
