// ---- V6.6 : vérifier un PRÉ-LANCEMENT Diakonos, avant « START LANCEMENT » ----
// Le pré-lancement est la grille de l'écran « Lancement » de Diakonos, exportée en Excel : une ligne par pièce,
// 19 colonnes, sans en-tête (si la 1re ligne porte des titres, ils sont lus par leur nom) :
//   0 Qté à lancer  1 Semaine (de livraison)  2 Commande  3 Ligne  4 Catalogue  5 Article  6 Désignation  7 Qte
//   8 Longueur  9 Largeur  10 Epaisseur (cotes finies)  11 Code coloris  12 Coloris  13 Cp  14 Ville
//   15 com_transporteur  16 Transporteur  17 Blocage compta  18 Blocage fab
// Deux choses :
//  1) le CONTRÔLE avant lancement : bloquées, en double, déjà lancées, autre semaine, quantité, pièce plus grande
//     que les panneaux du stock ;
//  2) la SIMULATION sur le stock woodStore (stock réel : sans les chutes réservées ni les panneaux de la case 302) :
//     ce que chaque article devient à la coupe (matière, couches, dessous), puis, par matériau, le besoin estimé
//     et ce qu'il y a en stock.
// Ce que devient un article est APPRIS dans les fichiers de lancement déjà dans la bibliothèque (colonne « agglo »,
// coloris_inf, épaisseur) ; les cas jamais vus viennent de règles connues (CAS_PARTICULIERS, puis désignation et
// épaisseur), marqués « supposé » à l'écran.
// Lecture seule : rien n'est écrit dans Diakonos, ni dans woodStore, ni dans les fichiers de lancement.

const CLE_PRE_LANCEMENT = "sentinelle-pre-lancement";
const COLONNES_PRE_LANCEMENT = ["qteLancer", "semaine", "commande", "ligne", "catalogue", "article", "designation", "qte", "L", "W", "ep", "coloris", "colorisNom", "cp", "ville", "codeTransporteur", "transporteur", "blocageCompta", "blocageFab"];
const TITRES_PRE_LANCEMENT = {
  "qte a lancer": "qteLancer", semaine: "semaine", commande: "commande", ligne: "ligne", catalogue: "catalogue", article: "article", designation: "designation", qte: "qte",
  longueur: "L", largeur: "W", epaisseur: "ep", "code coloris": "coloris", coloris: "colorisNom", cp: "cp", ville: "ville", com_transporteur: "codeTransporteur",
  transporteur: "transporteur", "blocage compta": "blocageCompta", "blocage fab": "blocageFab",
};

// CAS PARTICULIERS, saisis par l'atelier (ils passent avant ce qui est appris) : ce que l'article devient à la coupe.
// couches : panneaux de la matière par pièce commandée (le décor dessus, lui, n'est compté qu'une fois) ;
// dessous : « » rien, « RCB… » contrebalancement, « = » même décor ; debit : mm ajoutés à la cote finie (L, l).
//  - RENF391001 « plan 39 mm avec renforts métalliques » : 2 panneaux de mélaminé blanc lisse 19 mm (2 × 19 = 38) avec
//    un seul stratifié dessus ; à la main, il faut mettre 2 agglos dans la liste de coupe. Débit = cote finie + 10 mm
//    (fichier LAN264806, CVC26040209 ligne 3, 12/11).
const CLE_CAS_PARTICULIERS = "sentinelle-cas-particuliers";
const CAS_PARTICULIERS_DEFAUT = {
  RENF391001: { matiere: "SMELBLALIS19", couches: 2, dessous: "", debit: [10, 10], note: "un seul stratifié dessus ; 2 agglos à mettre dans la liste de coupe" },
};

function casParticuliers() {
  try {
    const v = JSON.parse(localStorage.getItem(CLE_CAS_PARTICULIERS) || "null");
    if (v && typeof v === "object") return v;
  } catch (_e) {
    // illisible : les cas connus
  }
  return { ...CAS_PARTICULIERS_DEFAUT };
}

function enregistrerCasParticuliers(cas) {
  try {
    localStorage.setItem(CLE_CAS_PARTICULIERS, JSON.stringify(cas));
  } catch (_e) {
    // sans place : gardé le temps de la page
  }
}

// Mètres carrés de panneau pris dans le stock pour 1 m² de pièces (plans des lancements de la bibliothèque) ; à
// défaut, ceux mesurés sur les lancements des semaines 46 à 48 de 2026.
const FACTEURS_STOCK_DEFAUT = { strat: 2.0, agglo: 1.55, rcb: 1.8, autre: 1.6 };

const preLancement = { donnees: null, erreur: null, lu: false };

const normaliserPl = (v) =>
  String(v ?? "")
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
const codeColoris = (v) => String(v ?? "").trim().toUpperCase().replace(/\.0+$/, "");
const sansPf = (c) => String(c || "").replace(/-PF$/i, "");

function familleMatierePl(code) {
  const c = String(code || "").toUpperCase();
  if (/^RCB/.test(c)) return "rcb";
  if (/^SAG|^SMEL|AGGLO/.test(c)) return "agglo";
  if (/^\d/.test(c)) return "strat";
  return "autre";
}

// Épaisseur d'une matière : celle du stock, sinon les chiffres de son code (SAG38HYBL → 38, SMELBLALIS19 → 19).
function epaisseurMatiere(code) {
  const m = typeof stockDuMateriau === "function" ? stockDuMateriau(code) : null;
  if (m && m.ep > 1.5) return m.ep;
  const n = /(\d{2})(?!.*\d)/.exec(String(code || ""));
  return n ? Number(n[1]) : null;
}

// ---------- Lecture du fichier ----------

function lirePreLancement(workbook) {
  for (const feuille of workbook.worksheets) {
    const n = feuille.rowCount || 0;
    if (!n) continue;
    const pos = {};
    feuille.getRow(1).eachCell({ includeEmpty: false }, (cell, c) => {
      const k = TITRES_PRE_LANCEMENT[normaliserPl(cellValue(cell))];
      if (k && !(k in pos)) pos[k] = c;
    });
    const avecTitres = Boolean(pos.commande && pos.ligne);
    if (!avecTitres) COLONNES_PRE_LANCEMENT.forEach((k, i) => (pos[k] = i + 1));
    const lignes = [];
    for (let r = avecTitres ? 2 : 1; r <= n; r++) {
      const row = feuille.getRow(r);
      const v = (k) => (pos[k] ? cellValue(row.getCell(pos[k])) : null);
      const t = (k) => {
        const x = v(k);
        return x === null || x === undefined ? "" : String(x).trim();
      };
      const nb = (k) => toFloatOrNull(v(k));
      const commande = t("commande");
      const ligne = nb("ligne");
      if (!commande || ligne === null || !/\d/.test(commande)) continue;
      const qte = nb("qte");
      const qteLancer = nb("qteLancer");
      lignes.push({
        cle: cleLigne(commande, ligne),
        commande,
        ligne: Math.trunc(ligne),
        qteLancer: qteLancer === null ? qte || 0 : qteLancer,
        qte: qte === null ? qteLancer || 0 : qte,
        semaine: Math.trunc(nb("semaine") || 0),
        catalogue: t("catalogue"),
        article: t("article").toUpperCase(),
        designation: t("designation"),
        L: nb("L") || 0,
        W: nb("W") || 0,
        ep: nb("ep") || 0,
        coloris: codeColoris(v("coloris")),
        colorisNom: t("colorisNom"),
        ville: t("ville"),
        codeTransporteur: t("codeTransporteur"),
        transporteur: t("transporteur"),
        blocageCompta: (nb("blocageCompta") || 0) !== 0,
        blocageFab: (nb("blocageFab") || 0) !== 0,
      });
    }
    if (lignes.length) return lignes;
  }
  throw new Error("aucune pièce lue : est-ce bien le pré-lancement exporté de l'écran « Lancement » de Diakonos ?");
}

// La semaine du pré-lancement : celle du plus grand nombre de pièces (à égalité, la plus récente).
function semaineDuPreLancement(lignes) {
  const n = new Map();
  for (const l of lignes) if (l.semaine) n.set(l.semaine, (n.get(l.semaine) || 0) + (l.qteLancer || 1));
  let best = 0;
  for (const [s, q] of n) if (!best || q > n.get(best) || (q === n.get(best) && s > best)) best = s;
  return best || null;
}

function lirePreLancementMemoire() {
  if (preLancement.lu) return;
  preLancement.lu = true;
  try {
    const v = JSON.parse(localStorage.getItem(CLE_PRE_LANCEMENT) || "null");
    if (v && Array.isArray(v.lignes)) preLancement.donnees = v;
  } catch (_e) {
    preLancement.donnees = null;
  }
}

async function chargerPreLancement(fichier) {
  try {
    const lignes = lirePreLancement(await chargerClasseur(fichier));
    const d = { nom: fichier.name, modifie: fichier.lastModified || Date.now(), charge: Date.now(), lignes };
    preLancement.donnees = d;
    preLancement.erreur = null;
    try {
      localStorage.setItem(CLE_PRE_LANCEMENT, JSON.stringify(d));
    } catch (_e) {
      // sans place : gardé le temps de la page
    }
  } catch (e) {
    preLancement.erreur = e && e.message ? e.message : String(e);
  }
  afficherPreLancement();
}

// ---------- Ce que devient un article à la coupe ----------

// Appris dans la bibliothèque : (article + coloris) puis article → matière (colonne « agglo »), dessous
// (coloris_inf : « » rien, « RCB… » contrebalancement, sinon un décor : compté comme le coloris de la pièce),
// couches (épaisseur finie / épaisseur de la matière, arrondi ; 1 au moins).
function apprendreArticles() {
  const parArticle = new Map();
  const parArtCol = new Map();
  const ajouter = (map, cle, mat, dessous, couches) => {
    if (!map.has(cle)) map.set(cle, { mat: new Map(), dessous: new Map(), couches: new Map(), n: 0 });
    const a = map.get(cle);
    a.mat.set(mat, (a.mat.get(mat) || 0) + 1);
    a.dessous.set(dessous, (a.dessous.get(dessous) || 0) + 1);
    a.couches.set(couches, (a.couches.get(couches) || 0) + 1);
    a.n++;
  };
  if (typeof bibliotheque === "undefined") return { parArticle, parArtCol };
  for (const s of bibliotheque.semaines.values()) {
    const cols = s.colonnesPieces || COLONNES_PIECES_BIBLIOTHEQUE;
    const i = (c) => cols.indexOf(c);
    const [iArt, iMat, iInf, iCol, iEp] = [i("article"), i("matiere"), i("coloris_inf"), i("coloris"), i("epaisseur")];
    if (iArt < 0 || iMat < 0) continue;
    for (const l of s.lancements) {
      for (const p of l.pieces || []) {
        const art = String(p[iArt] || "").trim().toUpperCase();
        const mat = String(p[iMat] || "").trim().toUpperCase();
        if (!art || !mat || estProtection(mat)) continue;
        const inf = codeColoris(iInf >= 0 ? p[iInf] : "");
        const dessous = !inf ? "" : /^RCB/.test(inf) ? inf : "=";
        const epM = epaisseurMatiere(mat);
        const epF = iEp >= 0 ? Number(p[iEp]) || 0 : 0;
        const couches = epM && epF && epF / epM >= 1.8 ? Math.round(epF / epM) : 1;
        ajouter(parArticle, art, mat, dessous, couches);
        ajouter(parArtCol, `${art}|${sansPf(codeColoris(iCol >= 0 ? p[iCol] : ""))}`, mat, dessous, couches);
      }
    }
  }
  return { parArticle, parArtCol };
}

const plusFrequent = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];

// Règles quand l'article n'a jamais été vu (désignation et épaisseur finie).
function regleParDefaut(l) {
  const d = normaliserPl(l.designation);
  const ep = Math.round(l.ep);
  if (/credence/.test(d)) return ep <= 12 ? { matiere: "SAG10HYBR", dessous: "RCB-CRED14" } : ep <= 14 ? { matiere: "SAG12HYBR", dessous: "RCB-CRED14" } : { matiere: "SAG19HYBR", dessous: "RCB" };
  if (/jambage|2 faces/.test(d)) return { matiere: ep <= 22 ? "SAG19HYBR" : ep <= 30 ? "SAG28HYBR" : ep <= 40 ? "SAG38HYBR" : "SAG58HYBR", dessous: "=" };
  if (/plan|ilot|decor|renfort/.test(d)) {
    if (ep <= 22) return { matiere: "SAG19HYBR", dessous: "RCB" };
    if (ep <= 30) return { matiere: "SAG28HYBL", dessous: "" };
    if (ep <= 40) return { matiere: "SAG38HYBL", dessous: "" };
    return { matiere: "SAG58HYBL", dessous: "" };
  }
  return null;
}

function transformationArticle(l, appris, cas = casParticuliers()) {
  const c = cas[l.article];
  if (c && c.matiere) return { matiere: c.matiere, couches: Math.max(1, Number(c.couches) || 1), dessous: c.dessous || "", debit: c.debit || null, source: "cas particulier", suppose: false, cas: true };
  const vu = appris.parArtCol.get(`${l.article}|${sansPf(l.coloris)}`) || appris.parArticle.get(l.article);
  if (vu) return { matiere: plusFrequent(vu.mat), dessous: plusFrequent(vu.dessous), couches: plusFrequent(vu.couches), debit: null, source: `appris (${vu.n} pièce${vu.n > 1 ? "s" : ""} déjà lancée${vu.n > 1 ? "s" : ""})`, suppose: false };
  const r = regleParDefaut(l);
  if (r) return { ...r, couches: 1, debit: null, source: "supposé (article jamais lancé)", suppose: true };
  return null;
}

// ---------- Contrôle avant lancement ----------

function controlerPreLancement(lignes, semaine) {
  const index = typeof indexBibliotheque === "function" ? indexBibliotheque() : new Map();
  const compte = new Map();
  for (const l of lignes) compte.set(l.cle, (compte.get(l.cle) || 0) + 1);
  const parCle = new Map();
  const noter = (l, gravite, type, texte) => {
    if (!parCle.has(l.cle)) parCle.set(l.cle, { l, pbs: [] });
    const e = parCle.get(l.cle);
    if (!e.pbs.some((p) => p.type === type)) e.pbs.push({ gravite, type, texte });
  };
  for (const l of lignes) {
    if (l.blocageCompta) noter(l, "rouge", "compta", "Bloquée par la compta");
    if (l.blocageFab) noter(l, "rouge", "fab", "Bloquée en fabrication");
    if (compte.get(l.cle) > 1) noter(l, "rouge", "double", `En double dans le pré-lancement (${compte.get(l.cle)} fois)`);
    if (l.qteLancer > l.qte) noter(l, "rouge", "qte", `Qté à lancer (${l.qteLancer}) plus grande que la commande (${l.qte})`);
    else if (l.qteLancer === 0) noter(l, "info", "zero", "Qté à lancer à 0 : pas lancée");
    else if (l.qteLancer < l.qte) noter(l, "info", "partiel", `Lancée en partie : ${l.qteLancer} sur ${l.qte}`);
    const deja = [...(index.get(l.cle) || [])].sort((a, b) => b.ordre - a.ordre);
    if (deja.length) {
      const d = deja[0];
      noter(l, "orange", "deja", `Déjà lancée : ${String(d.lancement).replace(/\.[^.]*$/, "")} (semaine ${Number(d.semaine)})${d.casse ? ", en casse" : ""}${deja.length > 1 ? ` et ${deja.length - 1} autre${deja.length > 2 ? "s" : ""} fois` : ""}`);
    }
    if (semaine && l.semaine && l.semaine < semaine) noter(l, "orange", "retard", `En retard : livraison semaine ${l.semaine}`);
    if (semaine && l.semaine && l.semaine > semaine) noter(l, "info", "avance", `En avance : livraison semaine ${l.semaine}`);
  }
  return parCle;
}

// ---------- Simulation sur le stock ----------

// Mètres carrés de stock pris pour 1 m² de pièces, mesurés sur les lancements de la bibliothèque qui ont leurs
// plans de coupe (plans « panneau entier » et « chute du stock » ; les modules ne prennent rien au stock).
function facteursConsommation() {
  const t = { strat: [0, 0], agglo: [0, 0], rcb: [0, 0] };
  const semaines = new Set();
  let n = 0;
  if (typeof bibliotheque !== "undefined") {
    for (const s of bibliotheque.semaines.values()) {
      const cols = s.colonnesPieces || COLONNES_PIECES_BIBLIOTHEQUE;
      const i = (c) => cols.indexOf(c);
      for (const l of s.lancements) {
        const plans = l.plans && Array.isArray(l.plans.plans) ? l.plans.plans : null;
        if (!plans || !plans.length || !(l.pieces || []).length) continue;
        const besoin = { strat: 0, agglo: 0, rcb: 0 };
        const conso = { strat: 0, agglo: 0, rcb: 0 };
        for (const p of l.pieces) {
          const a = ((Number(p[i("longueur")]) || 0) * (Number(p[i("largeur")]) || 0) * (Number(p[i("pieces")]) || 1)) / 1e6;
          for (const m of [p[i("matiere")], sansPf(p[i("coloris")]), p[i("coloris_inf")]]) {
            const f = familleMatierePl(m);
            if (m && f in besoin) besoin[f] += a;
          }
        }
        for (const pl of plans) {
          if (!Array.isArray(pl) || pl[4] === "module") continue;
          const f = familleMatierePl(pl[0]);
          if (f in conso) conso[f] += ((Number(pl[5]) || 0) * (Number(pl[6]) || 0) * (Number(pl[7]) || 1)) / 1e6;
        }
        let pris = false;
        for (const f of Object.keys(t))
          if (besoin[f] > 0 && conso[f] > 0) {
            t[f][0] += besoin[f];
            t[f][1] += conso[f];
            pris = true;
          }
        if (pris) {
          n++;
          semaines.add(Number(s.semaine));
        }
      }
    }
  }
  const res = { ...FACTEURS_STOCK_DEFAUT, lancements: n, semaines: [...semaines].sort((a, b) => a - b), mesures: {} };
  for (const f of Object.keys(t)) {
    const [b, c] = t[f];
    const r = b > 5 ? c / b : 0;
    if (r >= 1 && r <= 4) {
      res[f] = Math.round(r * 100) / 100;
      res.mesures[f] = true;
    }
  }
  return res;
}

// Les formats du stock pour un code : le code lui-même et, pour un stratifié, son petit format (« -PF »).
function materiauxStockPour(code) {
  const c = String(code || "").toUpperCase();
  const codes = familleMatierePl(c) === "strat" ? [sansPf(c), `${sansPf(c)}-PF`] : [c];
  return [...new Set(codes)].map((x) => stockDuMateriau(x)).filter(Boolean);
}

const tientDans = (L, W, f) => (L <= f.L && W <= f.W) || (!f.fil && L <= f.W && W <= f.L);

function simulerPreLancement(lignes) {
  const appris = apprendreArticles();
  const cas = casParticuliers();
  const facteurs = facteursConsommation();
  const besoins = new Map();
  const sansRegle = [];
  const transfos = new Map();
  const ajouter = (code, role, l, surface, couches, debit) => {
    if (!code) return;
    const cle = familleMatierePl(code) === "strat" ? sansPf(code) : code;
    if (!besoins.has(cle)) besoins.set(cle, { code: cle, famille: familleMatierePl(cle), roles: new Set(), pieces: 0, surface: 0, lignes: [], nom: "" });
    const b = besoins.get(cle);
    b.roles.add(role);
    b.pieces += l.qteLancer * couches;
    b.surface += surface * couches;
    b.lignes.push({ l, debit });
    if (!b.nom && role !== "âme" && l.colorisNom) b.nom = l.colorisNom;
  };
  for (const l of lignes) {
    if (!(l.qteLancer > 0) || !(l.L > 0 && l.W > 0)) continue;
    const t = transformationArticle(l, appris, cas);
    transfos.set(l.cle, t);
    const surface = (l.L * l.W * l.qteLancer) / 1e6;
    if (l.coloris) ajouter(l.coloris, "dessus", l, surface, 1, null);
    if (!t) {
      sansRegle.push(l);
      continue;
    }
    const debit = t.debit ? [l.L + t.debit[0], l.W + t.debit[1]] : null;
    ajouter(t.matiere, "âme", l, surface, t.couches || 1, debit);
    if (t.dessous === "=" && l.coloris) ajouter(l.coloris, "dessous", l, surface, 1, null);
    else if (t.dessous) ajouter(t.dessous, "dessous", l, surface, 1, null);
  }
  const lignesStock = [];
  const tropGrandes = [];
  for (const b of besoins.values()) {
    const mats = materiauxStockPour(b.code);
    const formats = mats.flatMap((m) => m.entiers);
    const dispoPanneaux = formats.reduce((t, f) => t + (f.dispo || 0), 0);
    const aireEntiers = formats.reduce((t, f) => t + ((f.dispo || 0) * f.L * f.W) / 1e6, 0);
    const chutes = mats.flatMap((m) => m.chutes.filter((f) => !f.reservee && f.qte > 0));
    const nbChutes = chutes.reduce((t, f) => t + f.qte, 0);
    const aireChutes = chutes.reduce((t, f) => t + (f.qte * f.L * f.W) / 1e6, 0);
    const reserves = mats.reduce((t, m) => t + (m.nbEntiersReserves || 0), 0);
    const principal = [...formats].sort((a, x) => (x.dispo || 0) - (a.dispo || 0) || x.L * x.W - a.L * a.W)[0] || null;
    const aireFormat = principal ? (principal.L * principal.W) / 1e6 : 0;
    const besoinAire = b.surface * (facteurs[b.famille] || facteurs.autre);
    const panneaux = aireFormat ? Math.ceil(besoinAire / aireFormat) : null;
    const dispoAire = aireEntiers + aireChutes;
    const limite = mats.some((m) => m.limites && m.limites.has(9)) ? 9 : 0;
    let etat;
    if (!mats.length) etat = { classe: "rouge", ordre: 0, texte: "Pas dans le stock woodStore" };
    else if (besoinAire <= dispoAire * 0.85) etat = { classe: "vert", ordre: 4, texte: "OK" };
    else if (besoinAire <= dispoAire) etat = { classe: "orange", ordre: 3, texte: "Juste : à surveiller" };
    else {
      const manque = aireFormat ? Math.max(1, Math.ceil((besoinAire - dispoAire) / aireFormat)) : null;
      etat =
        limite === 9
          ? { classe: "orange", ordre: 2, texte: `Il manque ≈ ${manque ?? "?"} panneau${manque > 1 ? "x" : ""} : à commander (dépassement autorisé)` }
          : { classe: "rouge", ordre: 1, texte: `Il manque ≈ ${manque ?? "?"} panneau${manque > 1 ? "x" : ""} : Cut Rite ne pourra pas tout placer (limité au stock)` };
    }
    // Pièce plus grande que les panneaux qu'on peut prendre (débit si connu, sinon cote finie) : formats en stock ou
    // en dépassement autorisé (Limite 9), chutes disponibles. Cas réel : 1136, pièces de 3 449 mm, seul le petit
    // format 2790 × 2060 en stock, le 4110 × 2060 à 0 et limité au stock.
    if (formats.length) {
      const utilisables = formats.filter((f) => (f.dispo || 0) > 0 || f.limite === 9);
      let n = 0;
      for (const { l, debit } of b.lignes) {
        const [L, W] = debit || [l.L, l.W];
        if (utilisables.some((f) => tientDans(L, W, f)) || chutes.some((f) => tientDans(L, W, f))) continue;
        const aZero = formats.filter((f) => tientDans(L, W, f));
        tropGrandes.push({ l, code: b.code, L, W, formats: utilisables, aZero });
        n += l.qteLancer;
      }
      if (n) {
        const texte = `${n} pièce${n > 1 ? "s" : ""} plus grande${n > 1 ? "s" : ""} que les panneaux en stock`;
        etat = etat.ordre <= 1 ? { ...etat, texte: `${etat.texte} ; ${texte}` } : { classe: "rouge", ordre: 1, texte };
      }
    }
    lignesStock.push({ ...b, mats, dispoPanneaux, nbChutes, aireChutes, reserves, principal, besoinAire, panneaux, dispoAire, limite, etat, desc: mats.length ? mats[0].desc : "" });
  }
  lignesStock.sort((a, b) => a.etat.ordre - b.etat.ordre || b.besoinAire - a.besoinAire);
  return { lignes: lignesStock, facteurs, sansRegle, tropGrandes, transfos };
}

// ---------- Écran ----------

const m2Fr = (v) => (Math.round(v * 10) / 10).toLocaleString("fr-FR");
const ROLES_PL = { dessus: "décor dessus", "âme": "âme", dessous: "dessous" };

function afficherPreLancement() {
  lirePreLancementMemoire();
  if (typeof lireStockMemoire === "function") lireStockMemoire();
  const page = $("pagePreLancement");
  const d = preLancement.donnees;
  const actions = `<button type="button" id="btnChargerPreLancement">${d ? "Charger un autre pré-lancement…" : "Charger le pré-lancement…"}</button>
    <input type="file" id="fichierPreLancement" accept=".xlsx,.xls" hidden>`;
  let html = entetePage(
    "Préparer un lancement",
    "Vérifier un pré-lancement",
    "Avant « START LANCEMENT » dans Diakonos : les pièces à regarder, et si le stock woodStore suffit. Lecture seule.",
    actions
  );
  if (preLancement.erreur) html += `<div class="message-alerte">Fichier illisible : ${echapper(preLancement.erreur)}</div>`;
  if (!d) {
    html += `<div class="carte"><div class="carte-titre">Aucun pré-lancement</div>
      <p>Dans Diakonos, écran <strong>Lancement</strong> : choisissez la semaine, puis exportez la grille en Excel. Chargez ce fichier ici.</p></div>`;
    page.innerHTML = html;
    brancherPreLancement();
    return;
  }
  const semaine = semaineDuPreLancement(d.lignes);
  const controles = controlerPreLancement(d.lignes, semaine);
  const sim = stock.donnees ? simulerPreLancement(d.lignes) : null;
  if (sim)
    for (const t of sim.tropGrandes) {
      const fmt = (liste) => [...new Set(liste.map((f) => `${nbFr(f.L)} × ${nbFr(f.W)}`))].join(", ");
      const texte = t.aZero.length
        ? `Plus grande (${nbFr(t.L)} × ${nbFr(t.W)}) que les panneaux ${t.code} en stock${t.formats.length ? ` (${fmt(t.formats)})` : ""} : le format ${fmt(t.aZero)} est à 0`
        : `Plus grande (${nbFr(t.L)} × ${nbFr(t.W)}) que tous les panneaux ${t.code}${t.formats.length ? ` (${fmt(t.formats)})` : ""}`;
      const e = controles.get(t.l.cle) || { l: t.l, pbs: [] };
      if (!e.pbs.some((p) => p.type === `grand-${t.code}`)) e.pbs.push({ gravite: "rouge", type: `grand-${t.code}`, texte });
      controles.set(t.l.cle, e);
    }
  html += htmlFichierPreLancement(d, semaine);
  html += htmlControlePreLancement(controles);
  html += htmlSimulationPreLancement(sim);
  html += htmlCasParticuliers(d);
  page.innerHTML = html;
  brancherPreLancement();
}

function htmlFichierPreLancement(d, semaine) {
  const pieces = d.lignes.reduce((t, l) => t + (l.qteLancer || 0), 0);
  const commandes = new Set(d.lignes.map((l) => l.commande)).size;
  const transporteurs = new Set(d.lignes.map((l) => l.transporteur).filter(Boolean)).size;
  const coloris = new Set(d.lignes.map((l) => l.coloris).filter(Boolean)).size;
  const catalogues = [...new Set(d.lignes.map((l) => l.catalogue).filter(Boolean))];
  return `<div class="carte"><div class="carte-titre">Pré-lancement Diakonos</div>
    <div class="stk-fichier"><span><strong>${echapper(d.nom || "pré-lancement")}</strong></span>
      ${semaine ? `<span>livraison <strong>semaine ${semaine}</strong></span>` : ""}
      <span class="pale">chargé le ${jourFr(d.charge)}</span></div>
    <div class="pl-puces" style="margin-top:10px">
      <span class="pl-puce">${nbFr(d.lignes.length)} lignes</span>
      <span class="pl-puce bon">${nbFr(pieces)} pièces à lancer</span>
      <span class="pl-puce">${nbFr(commandes)} commandes</span>
      <span class="pl-puce">${nbFr(coloris)} coloris</span>
      <span class="pl-puce">${nbFr(transporteurs)} transporteurs</span>
      ${catalogues.map((c) => `<span class="pl-puce">${echapper(c)}</span>`).join("")}
    </div></div>`;
}

function htmlControlePreLancement(controles) {
  const ordreG = { rouge: 0, orange: 1, info: 2 };
  const entrees = [...controles.values()].filter((e) => e.pbs.length);
  for (const e of entrees) e.pire = Math.min(...e.pbs.map((p) => ordreG[p.gravite]));
  entrees.sort((a, b) => a.pire - b.pire || comparerTexteFr(a.l.cle, b.l.cle));
  const compte = (g) => entrees.filter((e) => e.pbs.some((p) => p.gravite === g)).length;
  const parType = new Map();
  for (const e of entrees) for (const p of e.pbs) parType.set(p.type.startsWith("grand-") ? "grand" : p.type, (parType.get(p.type.startsWith("grand-") ? "grand" : p.type) || 0) + 1);
  const NOMS = { compta: "bloquées compta", fab: "bloquées fab", double: "en double", qte: "quantité trop grande", deja: "déjà lancées", retard: "en retard", avance: "en avance", partiel: "lancées en partie", zero: "à 0", grand: "trop grandes pour le stock" };
  const puces = [...parType.entries()]
    .map(([t, n]) => `<span class="pl-puce ${["compta", "fab", "double", "qte", "grand"].includes(t) ? "pl-rouge" : t === "deja" || t === "retard" ? "att" : ""}">${nbFr(n)} ${NOMS[t] || t}</span>`)
    .join("");
  const lignes = entrees
    .map((e) => {
      const l = e.l;
      const textes = e.pbs
        .sort((a, b) => ordreG[a.gravite] - ordreG[b.gravite])
        .map((p) => `<div class="pl-pb pl-pb-${p.gravite}">${echapper(p.texte)}</div>`)
        .join("");
      return `<tr><td><strong>${echapper(l.commande)}</strong> · ${l.ligne}</td>
        <td>${echapper(l.article)}<div class="pale">${nbFr(l.L)} × ${nbFr(l.W)} × ${nbFr(l.ep)}</div></td>
        <td>${echapper(l.coloris)}<div class="pale">${echapper(l.colorisNom)}</div></td>
        <td>${echapper(l.transporteur)}</td><td class="c">${l.semaine || ""}</td><td>${textes}</td></tr>`;
    })
    .join("");
  return `<div class="carte"><div class="carte-titre">Contrôle avant lancement</div>
    ${entrees.length ? `<div class="pl-puces">${puces}</div>` : `<div class="bandeau ok">✔ Rien à signaler : aucune pièce bloquée, en double, déjà lancée ni d'une autre semaine.</div>`}
    ${
      entrees.length
        ? `<p class="note" style="margin-top:8px">${nbFr(compte("rouge"))} pièce${compte("rouge") > 1 ? "s" : ""} à corriger avant de lancer, ${nbFr(compte("orange"))} à vérifier, ${nbFr(compte("info"))} pour information. Toutes les pièces concernées sont listées.</p>
      <div class="defilement"><table class="fp-table"><thead><tr><th>Pièce</th><th>Article</th><th>Coloris</th><th>Transporteur</th><th class="c">Sem.</th><th>À regarder</th></tr></thead><tbody>${lignes}</tbody></table></div>`
        : ""
    }</div>`;
}

function htmlSimulationPreLancement(sim) {
  if (!sim)
    return `<div class="carte"><div class="carte-titre">Simulation sur le stock</div>
      <div class="bandeau attention">Aucun fichier de stock : chargez le brdlib.bdx dans la page <strong>Stock des panneaux</strong>, puis revenez ici.</div></div>`;
  const d = stock.donnees;
  const age = joursDepuis(d.donneesJusquau || d.modifie);
  const n = (c) => sim.lignes.filter((x) => x.etat.classe === c).length;
  const lignes = sim.lignes
    .map((b) => {
      const roles = [...b.roles].map((r) => ROLES_PL[r] || r).join(", ");
      const format = b.principal ? `${nbFr(b.principal.L)} × ${nbFr(b.principal.W)}` : "";
      return `<tr class="pl-etat-${b.etat.classe}"><td><strong>${echapper(b.code)}</strong><div class="pale">${echapper(b.desc || b.nom || "")}</div></td>
        <td>${echapper(roles)}</td><td class="d">${nbFr(b.pieces)}</td><td class="d">${m2Fr(b.surface)} m²</td>
        <td class="d">${b.panneaux !== null ? `≈ ${nbFr(b.panneaux)} pann.` : "—"}<div class="pale">${format}</div></td>
        <td class="d">${b.mats.length ? `${nbFr(b.dispoPanneaux)} pann.${b.nbChutes ? `<div class="pale">+ ${nbFr(b.nbChutes)} chute${b.nbChutes > 1 ? "s" : ""} (${m2Fr(b.aireChutes)} m²)</div>` : ""}${b.reserves ? `<div class="stk-res-mini">${nbFr(b.reserves)} réservé${b.reserves > 1 ? "s" : ""} (302) non compté${b.reserves > 1 ? "s" : ""}</div>` : ""}` : '<span class="pale">—</span>'}</td>
        <td><span class="pl-etat">${echapper(b.etat.texte)}</span></td></tr>`;
    })
    .join("");
  const f = sim.facteurs;
  const mesure = Object.keys(f.mesures).length
    ? `mesurés sur ${f.lancements} lancement${f.lancements > 1 ? "s" : ""} de la bibliothèque (semaine${f.semaines.length > 1 ? "s" : ""} ${f.semaines.join(", ")})`
    : "mesurés sur les lancements des semaines 46 à 48";
  const supposes = [...sim.transfos.entries()].filter(([, t]) => t && t.suppose);
  const articlesSupposes = [...new Set(supposes.map(([cle]) => preLancement.donnees.lignes.find((l) => l.cle === cle)).filter(Boolean).map((l) => `${l.article} → ${sim.transfos.get(l.cle).matiere}`))];
  return `<div class="carte"><div class="carte-titre">Simulation sur le stock</div>
    ${age !== null && age > STOCK_VIEUX_JOURS ? `<div class="bandeau attention">⚠ Le stock date d'il y a <strong>${dureeFr(age)}</strong> : extrayez un fichier neuf avant de vous y fier.</div>` : ""}
    <div class="pl-puces">
      ${n("rouge") ? `<span class="pl-puce pl-rouge">${n("rouge")} matériau${n("rouge") > 1 ? "x" : ""} en manque</span>` : ""}
      ${n("orange") ? `<span class="pl-puce att">${n("orange")} à surveiller ou à commander</span>` : ""}
      <span class="pl-puce bon">${n("vert")} OK</span>
      <span class="pl-puce">stock du ${jourFr(d.donneesJusquau || d.modifie)}</span>
    </div>
    <div class="defilement" style="margin-top:8px"><table class="fp-table pl-sim"><thead><tr><th>Matériau</th><th>Pour</th><th class="d">Pièces</th><th class="d">Surface</th><th class="d">Besoin estimé</th><th class="d">En stock (réel)</th><th>État</th></tr></thead><tbody>${lignes}</tbody></table></div>
    ${sim.sansRegle.length ? `<div class="bandeau attention" style="margin-top:8px">Article${sim.sansRegle.length > 1 ? "s" : ""} jamais vu${sim.sansRegle.length > 1 ? "s" : ""}, matière inconnue (seul le décor est compté) : ${echapper([...new Set(sim.sansRegle.map((l) => l.article))].join(", "))}.</div>` : ""}
    ${articlesSupposes.length ? `<div class="note">Matière supposée (article jamais lancé, d'après sa désignation) : ${echapper(articlesSupposes.join(" · "))}.</div>` : ""}
    <div class="note">Estimation : surface des pièces (cotes finies) × m² de stock pris pour 1 m² de pièces — stratifié ${String(f.strat).replace(".", ",")}, agglo ${String(f.agglo).replace(".", ",")}, contrebalancement ${String(f.rcb).replace(".", ",")} (${mesure}). Ce que devient chaque article (matière, couches, dessous) est appris dans les lancements déjà faits. Stock réel : sans les chutes réservées ni les panneaux de la case 302.</div></div>`;
}

// Les cas particuliers : la liste (modifiable) et ceux du pré-lancement chargé.
function htmlCasParticuliers(d) {
  const cas = casParticuliers();
  const presents = new Set((d ? d.lignes : []).map((l) => l.article));
  const DESSOUS = [["", "rien"], ["RCB", "RCB"], ["RCB-CRED14", "RCB-CRED14"], ["=", "même décor"]];
  const lignes = Object.entries(cas)
    .sort((a, b) => comparerTexteFr(a[0], b[0]))
    .map(
      ([art, c]) => `<tr><td><strong>${echapper(art)}</strong>${presents.has(art) ? ' <span class="pl-puce bon pl-mini">dans ce pré-lancement</span>' : ""}</td>
      <td>${echapper(c.matiere)}</td><td class="c">${Number(c.couches) || 1}</td><td>${echapper((DESSOUS.find(([v]) => v === (c.dessous || "")) || [, c.dessous])[1])}</td>
      <td class="c">${c.debit ? `+${c.debit[0]} / +${c.debit[1]}` : "—"}</td><td class="pale">${echapper(c.note || "")}</td>
      <td><button type="button" class="texte" data-pl-retirer="${echapper(art)}">Retirer</button></td></tr>`
    )
    .join("");
  return `<div class="carte"><div class="carte-titre">Cas particuliers</div>
    <p class="note">Les articles qui ne se coupent pas comme d'habitude (ex. RENF391001 : 2 panneaux de mélaminé 19 mm, un seul stratifié dessus). Ils passent avant ce que Sentinelle apprend des lancements déjà faits.</p>
    <div class="defilement"><table class="fp-table"><thead><tr><th>Article</th><th>Matière</th><th class="c">Panneaux par pièce</th><th>Dessous</th><th class="c">Débit en plus (mm)</th><th>Note</th><th></th></tr></thead>
      <tbody>${lignes || '<tr><td colspan="7" class="pale">Aucun cas particulier.</td></tr>'}</tbody></table></div>
    <div class="pl-saisie">
      <input type="text" id="plCasArticle" placeholder="Article (ex. RENF391001)" autocomplete="off">
      <input type="text" id="plCasMatiere" placeholder="Matière (ex. SMELBLALIS19)" autocomplete="off">
      <input type="number" id="plCasCouches" min="1" max="9" value="1" title="Panneaux de la matière par pièce">
      <select id="plCasDessous">${DESSOUS.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select>
      <input type="number" id="plCasDebit" min="0" max="100" value="0" title="Débit en plus de la cote finie (mm)">
      <input type="text" id="plCasNote" placeholder="Note (facultatif)" autocomplete="off">
      <button type="button" id="btnPlCasAjouter">Ajouter</button>
    </div></div>`;
}

function brancherPreLancement() {
  const page = $("pagePreLancement");
  const ajouter = $("btnPlCasAjouter");
  if (ajouter)
    ajouter.addEventListener("click", () => {
      const art = $("plCasArticle").value.trim().toUpperCase();
      const mat = $("plCasMatiere").value.trim().toUpperCase();
      if (!art || !mat) return;
      const debit = Number($("plCasDebit").value) || 0;
      const cas = casParticuliers();
      cas[art] = { matiere: mat, couches: Math.max(1, Math.round(Number($("plCasCouches").value) || 1)), dessous: $("plCasDessous").value, debit: debit ? [debit, debit] : null, note: $("plCasNote").value.trim() };
      enregistrerCasParticuliers(cas);
      afficherPreLancement();
    });
  page.querySelectorAll("[data-pl-retirer]").forEach((b) =>
    b.addEventListener("click", () => {
      const cas = casParticuliers();
      delete cas[b.dataset.plRetirer];
      enregistrerCasParticuliers(cas);
      afficherPreLancement();
    })
  );
  const bouton = $("btnChargerPreLancement");
  const champ = $("fichierPreLancement");
  if (bouton && champ) {
    bouton.addEventListener("click", () => champ.click());
    champ.addEventListener("change", () => {
      if (champ.files[0]) chargerPreLancement(champ.files[0]);
    });
  }
}
