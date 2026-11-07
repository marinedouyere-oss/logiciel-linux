// ---- Plans de coupe Cut Rite (lus dans le .bkp) ----
//
// Le .bkp contient, pour chaque matière du lot, les résultats de l'optimisation :
//   <lancement>_<matière>.pct : les morceaux à couper (pièces, noyaux de module « T12/1 », stratifiés « LT12/1 »,
//                               « L0328 »…), numérotés (champ 2) ; champs 4 et 6 = cote de débit, 5 et 7 = cote finie,
//                               à partir du champ 13 = les champs de la ligne PNL2 de la liste de coupe (cle = 17) ;
//   <lancement>_<matière>.ptn : les plans, dans l'ordre de Cut Rite (le n° d'ordre est le « Pdc » de son écran) :
//                               PTN1 (panneau, nombre de fois…) puis PTN3 (le plan) ; PRM1 = trait de scie et rives ;
//   <lancement>_<matière>.brd : les panneaux (entiers, ou chutes du stock « X… »).
// Écriture d'un plan (PTN3) : sections « + » (coupes en travers d'abord), bandes « / » (coupes en long), morceaux
// d'une bande « , » ; « (a/b) » morceaux empilés ; « n*k » morceau répété ; « /*k » bande répétée ; « a<b> » morceau a
// (b au passage suivant) ; « ! » morceau tourné ; « Xn » chute gardée (le reste de la bande, jusqu'au bord du panneau).
// Un plan dont le panneau est un module (PTN1 champ 9 = 3) découpe ce module en pièces (trait 5 mm, sans rive).
// Chaque plan lu est vérifié : tous les morceaux dans le panneau, aucun ne se chevauche (sinon ok = false).
// Lecture vérifiée sur la 48 01 : 455 pièces sur 460 retrouvées dans leurs plans, les 5 autres (1047 grand format)
// dans aucun plan ; numéros Pdc identiques à ceux de Cut Rite.

const MOTIF_NOYAU_PLAN = /^T\d+\/\d+$/;
const MOTIF_STRATIFIE_PLAN = /^(LT\d+\/\d+|L\d+)$/;
const TRAIT_MODULE = 5;

function decouperPlan(s, sep) {
  const out = [];
  let prof = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") prof++;
    else if (ch === ")") prof--;
    if (ch === sep && prof === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// « a,b/*2,c/ » → [["a,b", 2], ["c", 1]]
function bandesDuPlan(section) {
  const res = [];
  let i = 0;
  let prof = 0;
  let cur = "";
  while (i < section.length) {
    const ch = section[i];
    if (ch === "(") prof++;
    else if (ch === ")") prof--;
    if (ch === "/" && prof === 0) {
      i++;
      let rep = 1;
      const m = /^\*(\d+)/.exec(section.slice(i));
      if (m) {
        rep = parseInt(m[1], 10);
        i += m[0].length;
      }
      if (section[i] === ",") i++;
      res.push([cur, rep]);
      cur = "";
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) res.push([cur, 1]);
  return res;
}

class LecteurPlan {
  constructor(morceaux, trait) {
    this.P = morceaux;
    this.K = trait;
  }

  taille(item) {
    item = item.trim();
    const tourne = item.endsWith("!");
    const it = item.replace(/!+$/, "");
    if (it.startsWith("X")) return null;
    const m = /^(.*?)\*(\d+)$/.exec(it);
    if (m && !it.startsWith("(")) {
      const t = this.taille(m[1] + (tourne ? "!" : ""));
      const k = parseInt(m[2], 10);
      return [t[0] * k + this.K * (k - 1), t[1]];
    }
    if (it.startsWith("(")) {
      const ts = decouperPlan(it.slice(1, -1), "/").map((p) => this.taille(p)).filter(Boolean);
      return [Math.max(...ts.map((t) => t[0])), ts.reduce((s, t) => s + t[1], 0) + this.K * (ts.length - 1)];
    }
    const k = parseInt(/\d+/.exec(it)[0], 10);
    const p = this.P.get(k);
    if (!p) throw new Error(`morceau ${k} introuvable`);
    const L = parseFloat(p[4]);
    const W = parseFloat(p[6]);
    return tourne ? [W, L] : [L, W];
  }

  poser(item, x, y, out) {
    item = item.trim();
    const tourne = item.endsWith("!");
    const it = item.replace(/!+$/, "");
    const m = /^(.*?)\*(\d+)$/.exec(it);
    if (m && !it.startsWith("(")) {
      const [l] = this.taille(m[1] + (tourne ? "!" : ""));
      for (let j = 0; j < parseInt(m[2], 10); j++) this.poser(m[1] + (tourne ? "!" : ""), x + j * (l + this.K), y, out);
      return;
    }
    if (it.startsWith("(")) {
      let yy = y;
      for (const p of decouperPlan(it.slice(1, -1), "/")) {
        const t = this.taille(p);
        if (t) {
          this.poser(p, x, yy, out);
          yy += t[1] + this.K;
        }
      }
      return;
    }
    const [L, W] = this.taille(item);
    out.push({ x, y, L, W, seq: (it.match(/\d+/g) || []).map(Number), tourne });
  }

  // x0, y0 : rives au début ; wtot, ltot : taille du panneau ; yfin : rive du bas (chute faite de bandes vides).
  lire(pat, x0 = 0, y0 = 0, wtot = null, yfin = 0, ltot = null) {
    const out = [];
    let xs = x0;
    const sections = pat.split("+").filter((s) => s.trim());
    for (const section of sections) {
      const bandes = bandesDuPlan(section).map(([contenu, rep]) => {
        const items = decouperPlan(contenu, ",").filter((s) => s.trim());
        const ts = items.map((s) => this.taille(s));
        const vrais = ts.filter(Boolean);
        return {
          items,
          ts,
          wb: vrais.length ? Math.max(...vrais.map((t) => t[1])) : 0,
          lb: vrais.reduce((s, t) => s + t[0], 0) + this.K * (items.length - 1),
          rep,
        };
      });
      const pleines = bandes.filter((b) => b.ts.every(Boolean));
      const ls = Math.max(...(pleines.length ? pleines : bandes).map((b) => b.lb));
      const vides = bandes.filter((b) => !b.ts.some(Boolean));
      if (vides.length && wtot) {
        const pris = bandes.reduce((s, b) => s + b.wb * b.rep, 0) + this.K * (bandes.reduce((s, b) => s + b.rep, 0) - 1);
        const reste = Math.max(0, (wtot - y0 - yfin - pris) / vides.length);
        for (const b of vides) b.wb = reste;
      }
      let y = y0;
      for (const b of bandes) {
        for (let r = 0; r < b.rep; r++) {
          let x = xs;
          if (!b.ts.some(Boolean)) {
            if (b.wb) out.push({ x, y, L: ls, W: b.wb, chute: b.items.map((i) => i.trim().replace(/!+$/, "")).join(" ") });
            y += b.wb + this.K;
            continue;
          }
          b.items.forEach((it, k) => {
            const t = b.ts[k];
            if (!t) {
              const fin = ltot && section === sections[sections.length - 1] ? ltot : xs + ls;
              const lc = Math.max(0, fin - xs - b.lb);
              out.push({ x, y, L: lc, W: b.wb, chute: it.trim().replace(/!+$/, "") });
              x += lc + this.K;
            } else {
              this.poser(it, x, y, out);
              x += t[0] + this.K;
            }
          });
          y += b.wb + this.K;
        }
      }
      xs += ls + this.K;
    }
    return out;
  }
}

function planVerifie(rects, L, W) {
  for (const r of rects) if (r.x < -0.5 || r.y < -0.5 || r.x + r.L > L + 0.6 || r.y + r.W > W + 0.6) return false;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.x < b.x + b.L - 0.5 && b.x < a.x + a.L - 0.5 && a.y < b.y + b.W - 0.5 && b.y < a.y + a.W - 0.5) return false;
    }
  }
  return true;
}

// Plans d'une matière (textes .pct, .ptn, .brd) → [{ pdc, module, nom, sorte, L, W, fois, plan, rects, ok }]
function lirePlansMatiere(texPct, texPtn, texBrd) {
  const P = new Map();
  for (const l of texPct.split(/\r?\n/)) {
    if (!l.startsWith("0,")) continue;
    const c = l.split(",");
    P.set(parseInt(c[2], 10), c);
  }
  const brd = texBrd.split(/\r?\n/).filter((l) => l.startsWith("BRD1,")).map((l) => l.split(","));
  const lignes = texPtn.split(/\r?\n/);
  const prm = (lignes.find((l) => l.startsWith("PRM1,")) || "PRM1,4.4,0,0,0,0,0").split(",");
  const mat1 = (lignes.find((l) => l.startsWith("MAT1,")) || "").split(",");
  const K = parseFloat(prm[1]) || 0;
  const rives = { y0: parseFloat(prm[2]) || 0, yfin: parseFloat(prm[3]) || 0, x0: parseFloat(prm[4]) || 0, xfin: parseFloat(prm[5]) || 0 };
  const plans = [];
  let pdc = 0;
  for (let i = 0; i < lignes.length; i++) {
    if (!lignes[i].startsWith("PTN1,")) continue;
    pdc++;
    const c = lignes[i].split(",");
    const pat = (lignes[i + 1] || "").startsWith("PTN3,") ? lignes[i + 1].slice(5).trim() : "";
    const module = c[9] === "3";
    const fois = parseInt(c[3], 10) || 1;
    let L;
    let W;
    let nom;
    let sorte;
    let rects;
    try {
      if (module) {
        const m = P.get(parseInt(c[1], 10));
        if (!m) continue;
        L = parseFloat(m[4]);
        W = parseFloat(m[6]);
        nom = m[1].split("/")[0];
        sorte = "module";
        rects = new LecteurPlan(P, TRAIT_MODULE).lire(pat);
      } else {
        const B = brd[parseInt(c[1], 10) - 1];
        if (!B) continue;
        L = parseFloat(B[3]);
        W = parseFloat(B[4]);
        nom = B[1];
        sorte = B[1].startsWith("X") ? "chute du stock" : "panneau entier";
        const lecteur = new LecteurPlan(P, K);
        rects = lecteur.lire(pat, rives.x0, rives.y0, W, rives.yfin, L);
        if (!planVerifie(rects, L, W)) {
          // coupé d'abord en travers : on lit le plan sur le panneau tourné
          rects = lecteur.lire(pat, rives.y0, rives.x0, L, rives.xfin, W).map((r) => ({ ...r, x: r.y, y: r.x, L: r.W, W: r.L }));
        }
      }
    } catch (_e) {
      rects = [];
    }
    for (const r of rects) {
      if (!r.seq) continue;
      const q = P.get(r.seq[0]);
      r.nom = q[1];
      r.cle = q[17] || "";
      r.fini = [parseFloat(q[5]), parseFloat(q[7])];
      r.commande = q[14] || "";
      r.ligne = q[15] || "";
      r.article = q[16] || "";
      r.dessus = q[30] || "";
      r.dessous = q[31] || "";
      r.support = q[21] || "";
    }
    plans.push({ pdc, module, nom, sorte, L, W, fois, plan: pat, rects, ok: rects.length > 0 && planVerifie(rects, L, W) });
  }
  return { desc: (mat1[2] || "").replace(/\s+\d+\*\d+.*$/, "").replace(/^STRAT\s+/, "").trim(), plans, morceaux: P };
}

// Tous les plans d'un .bkp, lus une seule fois par fichier.
const cachePlansBkp = new WeakMap();
function lirePlansBkp(fichier) {
  if (!cachePlansBkp.has(fichier)) {
    const lecture = (async () => {
      const bytes = await fichier.arrayBuffer();
      const entrees = await listerEntreesZip(bytes);
      const maitre = trouverEntreeCttMaitre(entrees, nomLancementBkp(fichier.name));
      const lancement = maitre.nom.split(/[/\\]/).pop().replace(/\.ctt$/i, "");
      const parNom = new Map(entrees.map((e) => [e.nom.split(/[/\\]/).pop().toLowerCase(), e]));
      const texte = async (nom) => {
        const e = parNom.get(nom.toLowerCase());
        return e ? new TextDecoder("iso-8859-1").decode(await extraireEntreeZip(bytes, e)) : "";
      };
      const prefixe = `${lancement}_`.toLowerCase();
      const matieres = new Map();
      for (const [nom] of parNom) {
        if (!nom.startsWith(prefixe) || !nom.endsWith(".ptn")) continue;
        const base = parNom.get(nom).nom.split(/[/\\]/).pop().replace(/\.ptn$/i, "");
        const mat = base.slice(lancement.length + 1);
        const [pct, ptn, brd] = await Promise.all([texte(`${base}.pct`), texte(`${base}.ptn`), texte(`${base}.brd`)]);
        if (!pct || !ptn) continue;
        matieres.set(mat, { mat, ...lirePlansMatiere(pct, ptn, brd) });
      }
      // Pièces sans agglo (faites seulement de stratifié, matière vide dans la liste) : leur stratifié « L0102 » est la
      // pièce elle-même. On garde, pour chacune, la matière de sa face dessus (où elle est comptée).
      const seulesStratifie = new Map();
      const lignes = new TextDecoder("iso-8859-1").decode(await extraireEntreeZip(bytes, maitre)).split(/\r?\n/);
      for (let i = 0; i + 2 < lignes.length; i++) {
        if (!lignes[i].startsWith("PNL1,")) continue;
        const p1 = lignes[i].split(",");
        const p2 = lignes[i + 1].split(",");
        const m = /^PNL3,P(\d+):TC:/.exec(lignes[i + 2]);
        if (m && p1[2] === "" && (p2[16] || p2[17])) seulesStratifie.set(`L${m[1].padStart(4, "0")}`, p2[16] || p2[17]);
      }
      return indexerPlans(lancement, matieres, seulesStratifie);
    })();
    lecture.catch(() => cachePlansBkp.delete(fichier));
    cachePlansBkp.set(fichier, lecture);
  }
  return cachePlansBkp.get(fichier);
}

// Index : modules par nom, plans par pièce, quantité de chaque pièce placée dans les plans (morceaux « pièce » seulement).
function indexerPlans(lancement, matieres, seulesStratifie = new Map()) {
  const modules = new Map();
  const parCle = new Map();
  const placees = new Map();
  let nbPlans = 0;
  let nbModules = 0;
  // Nombre de fois où chaque noyau (module « T73/1 », bande) est posé sur un panneau : les pièces d'un module ne
  // sont coupées que si le module l'est (un module retiré des panneaux à la scie laisse ses pièces de côté).
  const posesNoyau = new Map();
  for (const m of matieres.values()) {
    for (const plan of m.plans) {
      if (plan.module) continue;
      for (const r of plan.rects) {
        if (!r.seq) continue;
        for (let j = 0; j < plan.fois; j++) {
          const q = m.morceaux.get(r.seq[Math.min(j, r.seq.length - 1)]);
          if (q && MOTIF_NOYAU_PLAN.test(q[1])) posesNoyau.set(q[1].split("/")[0], (posesNoyau.get(q[1].split("/")[0]) || 0) + 1);
        }
      }
    }
  }
  for (const m of matieres.values()) {
    for (const plan of m.plans) {
      plan.matiere = m.mat;
      if (plan.module) {
        modules.set(plan.nom, plan);
        nbModules++;
      } else nbPlans++;
      const fois = plan.module ? Math.min(plan.fois, posesNoyau.get(plan.nom) || 0) : plan.fois;
      for (const r of plan.rects) {
        if (!r.seq) continue;
        const cles = new Set();
        for (let j = 0; j < plan.fois; j++) {
          const q = m.morceaux.get(r.seq[Math.min(j, r.seq.length - 1)]);
          if (!q) continue;
          const nom = q[1];
          const cle = q[17] || "";
          if (cle) cles.add(cle);
          const piece = (!MOTIF_NOYAU_PLAN.test(nom) && !MOTIF_STRATIFIE_PLAN.test(nom)) || seulesStratifie.get(nom) === m.mat;
          if (cle && j < fois && piece) placees.set(cle, (placees.get(cle) || 0) + 1);
        }
        for (const cle of cles) {
          if (!parCle.has(cle)) parCle.set(cle, []);
          const liste = parCle.get(cle);
          if (!liste.includes(plan)) liste.push(plan);
        }
      }
    }
  }
  // Les bandes n'ont pas de plan à elles : leurs pièces sont coupées avec la bande (noyau « T18/1 » posé sur un panneau).
  // Chaque fois que le noyau est posé, ses pièces le sont aussi.
  const bandes = new Map(); // « T18 » → { mat, membres: [{ cle, qte, q }] }
  for (const m of matieres.values()) {
    for (const q of m.morceaux.values()) {
      const g = /^(T\d+):/.exec(q[32] || "");
      if (!g || MOTIF_NOYAU_PLAN.test(q[1]) || MOTIF_STRATIFIE_PLAN.test(q[1]) || modules.has(g[1])) continue;
      if (!bandes.has(g[1])) bandes.set(g[1], { mat: m.mat, membres: [] });
      bandes.get(g[1]).membres.push({ cle: q[17] || "", qte: parseInt(q[12], 10) || 1, q });
    }
  }
  for (const [g, b] of bandes) {
    const n = posesNoyau.get(g) || 0;
    for (const x of b.membres) if (x.cle && n) placees.set(x.cle, (placees.get(x.cle) || 0) + x.qte * n);
  }
  return { lancement, matieres, modules, bandes, parCle, placees, nbPlans, nbModules };
}

// Le morceau « pièce » d'une clé dans les fichiers de l'optimisation (même s'il n'a pas de plan à lui : pièce de bande).
function morceauPiece(donnees, cle) {
  for (const m of donnees.matieres.values()) {
    for (const q of m.morceaux.values()) {
      if (q[17] === cle && !MOTIF_NOYAU_PLAN.test(q[1]) && !MOTIF_STRATIFIE_PLAN.test(q[1])) {
        const g = /^(T\d+):/.exec(q[32] || "");
        return { mat: m.mat, support: q[21] || m.mat, dessus: q[30] || "", dessous: q[31] || "", groupe: g ? g[1] : null, q };
      }
    }
  }
  return null;
}

// Les plans où passe une pièce : son module (ou sa bande), le panneau d'agglo, ses stratifiés dessus et dessous.
// Chaque plan est rendu avec les morceaux « visés » (la pièce, son module, leurs stratifiés).
function plansDeLaPiece(donnees, cle) {
  const piece = morceauPiece(donnees, cle);
  const groupe = piece ? piece.groupe : null; // « T73 » : module ou bande de la pièce
  const noms = new Set(groupe ? [`${groupe}/1`, `L${groupe}/1`] : []);
  // la pièce, son module (noyau et stratifiés), ou ses propres stratifiés (« L0328 ») si elle est seule
  const visee = (r) => Boolean(r.seq) && (noms.has(r.nom) || (r.cle === cle && !MOTIF_NOYAU_PLAN.test(r.nom) && !/^LT/.test(r.nom)));
  const resultat = [];
  for (const m of donnees.matieres.values()) {
    for (const plan of m.plans) {
      if (!plan.rects.some(visee) && !(plan.module && plan.nom === groupe)) continue;
      let rang = 3;
      if (plan.module) rang = 0;
      else if (piece && plan.matiere === piece.support) rang = 1;
      else if (piece && plan.matiere === piece.dessus) rang = 2;
      resultat.push({ plan, rang, visee });
    }
  }
  resultat.sort((a, b) => a.rang - b.rang || a.plan.matiere.localeCompare(b.plan.matiere) || a.plan.pdc - b.plan.pdc);
  const bande = groupe && donnees.bandes.has(groupe) ? donnees.bandes.get(groupe) : null;
  return { piece, groupe, bande, module: groupe && donnees.modules.has(groupe), plans: resultat };
}

// Pièces du fichier de lancement absentes des plans (ou en nombre insuffisant) : elles ne seront pas coupées.
function piecesNonPlacees(qteAttendueParCle, donnees) {
  const manquantes = [];
  for (const [cle, attendu] of qteAttendueParCle) {
    if (!cle || !(attendu > 0)) continue;
    const place = donnees.placees.get(cle) || 0;
    if (place < attendu) manquantes.push({ cle, attendu, place });
  }
  return manquantes.sort((a, b) => a.cle.localeCompare(b.cle));
}

// Contrôle « pièces dans les plans de coupe » (bouton Vérifier Scies). Seules comptent les pièces que le .bkp prévoit :
// une pièce absente du .bkp est déjà signalée par le contrôle Scies. Résultat gardé avec la case (petit, sans les plans).
async function controlerPlans(qteAttendueParCle, fichierBkp, qteParCleBkp) {
  const d = await lirePlansBkp(fichierBkp);
  const prevues = new Map();
  for (const [cle, attendu] of qteAttendueParCle) {
    const dansBkp = qteParCleBkp ? qteParCleBkp.get(cle) || 0 : attendu;
    if (Math.min(attendu, dansBkp) > 0) prevues.set(cle, Math.min(attendu, dansBkp));
  }
  const nbPieces = [...prevues.values()].reduce((t, n) => t + n, 0);
  return { nbPlans: d.nbPlans, nbModules: d.nbModules, nbMatieres: d.matieres.size, nbPieces, nonPlacees: piecesNonPlacees(prevues, d) };
}

// ---- Dessin d'un plan (SVG) ----
// options : { visee(r) → bool, numeros, cote: "fini"|"debit", imprimable, modules (Map nom → plan, pour dessiner leurs
// pièces dans le panneau, comme Cut Rite), etats (Map index → "ajoutee"|"partie"|"deplacee"|"chute_perdue"),
// textes (Map index → texte écrit dans une place laissée vide) }
function svgPlan(plan, options = {}) {
  const { L, W } = plan;
  const visee = options.visee || (() => false);
  const imp = Boolean(options.imprimable);
  const e = Math.max(L, W);
  const ech = (v) => (v * e / 4200).toFixed(0);
  const id = `h${Math.random().toString(36).slice(2, 8)}`;
  const s = [
    `<svg class="svg-plan" viewBox="0 0 ${L.toFixed(0)} ${W.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Plan ${plan.pdc}">`,
    `<defs><pattern id="${id}v" width="70" height="70" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="70" height="70" fill="#ffe082"/><line x1="0" y1="0" x2="0" y2="70" stroke="#22231d" stroke-width="${imp ? 16 : 0}"/></pattern>`,
    `<pattern id="${id}j" width="60" height="60" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="60" height="60" fill="#ffe082"/><line x1="0" y1="0" x2="0" y2="60" stroke="#c98a00" stroke-width="12"/></pattern>`,
    `<pattern id="${id}r" width="60" height="60" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="60" height="60" fill="#fde2df"/><line x1="0" y1="0" x2="0" y2="60" stroke="#c62828" stroke-width="10"/></pattern></defs>`,
    `<rect x="0" y="0" width="${L.toFixed(0)}" height="${W.toFixed(0)}" fill="${imp ? "#fff" : "#f4f3f1"}" stroke="${imp ? "#22231d" : "#797978"}" stroke-width="${ech(10)}"/>`,
  ];
  let n = 0;
  plan.rects.forEach((r, idx) => {
    const etat = options.etats ? options.etats.get(idx) : null;
    const xywh = `x="${r.x.toFixed(0)}" y="${r.y.toFixed(0)}" width="${r.L.toFixed(0)}" height="${r.W.toFixed(0)}"`;
    if (r.chute) {
      if (etat === "chute_perdue") s.push(`<rect ${xywh} fill="url(#${id}j)" stroke="#c98a00" stroke-width="${ech(14)}"/>`);
      else s.push(`<rect ${xywh} fill="${imp ? "#fff" : "#fff8e1"}" stroke="#b9a36a" stroke-width="${ech(5)}" stroke-dasharray="${ech(40)} ${ech(25)}"/>`);
      if (r.L > L * 0.2 && r.W > W * 0.12) s.push(`<text x="${(r.x + r.L / 2).toFixed(0)}" y="${(r.y + r.W / 2 + e / 140).toFixed(0)}" font-size="${(e / 46).toFixed(0)}" text-anchor="middle" fill="#7a5200" font-family="Lato,Arial">chute gardée ${r.L.toFixed(0)} × ${r.W.toFixed(0)}</text>`);
      return;
    }
    n++;
    r.n = n;
    const v = visee(r);
    if (etat === "partie") {
      s.push(`<rect ${xywh} fill="#fff" stroke="#c62828" stroke-width="${ech(16)}" stroke-dasharray="${ech(70)} ${ech(45)}"/>`);
      s.push(`<text x="${(r.x + r.L / 2).toFixed(0)}" y="${(r.y + r.W / 2 + e / 140).toFixed(0)}" font-size="${(e / 44).toFixed(0)}" text-anchor="middle" fill="#c62828" font-weight="700" font-family="Lato,Arial">${echapperSvg((options.textes && options.textes.get(idx)) || options.textePartie || "partie sur un autre plan")}</text>`);
      return;
    }
    const nom = (r.nom || "").split("/")[0];
    const mod = options.modules && MOTIF_NOYAU_PLAN.test(r.nom || "") ? options.modules.get(nom) : null;
    // Un module dessiné avec ses pièces : ses trous restent clairs, seule la pièce visée est en jaune.
    const fondModule = mod && !etat ? (v ? "#fff6d6" : "#fbfaf9") : null;
    const fond = fondModule || (etat === "ajoutee" ? "#c8e6c9" : etat === "deplacee" ? `url(#${id}r)` : v ? (imp ? `url(#${id}v)` : "#ffd54f") : imp ? "#f1f0ee" : "#eac2b7");
    const trait = etat === "ajoutee" ? "#2e7d32" : etat === "deplacee" ? "#c62828" : imp ? "#22231d" : "#78140c";
    s.push(`<rect ${xywh} fill="${fond}" stroke="${trait}" stroke-width="${ech(v || etat ? 16 : 6)}"/>`);
    if (mod && !etat) {
      for (const q of mod.rects) {
        if (q.chute) continue;
        const [qx, qy, ql, qw] = r.tourne ? [q.y, q.x, q.W, q.L] : [q.x, q.y, q.L, q.W];
        const qv = visee(q);
        s.push(`<rect x="${(r.x + qx).toFixed(0)}" y="${(r.y + qy).toFixed(0)}" width="${ql.toFixed(0)}" height="${qw.toFixed(0)}" fill="${qv ? (imp ? `url(#${id}v)` : "#ffd54f") : imp ? "#fafafa" : "#f6d9d1"}" stroke="${imp ? "#22231d" : "#78140c"}" stroke-width="${ech(qv ? 12 : 4)}"/>`);
      }
      s.push(`<text x="${(r.x + (options.numeros ? e / 28 : e / 110)).toFixed(0)}" y="${(r.y + e / 50).toFixed(0)}" font-size="${(e / 55).toFixed(0)}" fill="#78140c" font-weight="700" font-family="Lato,Arial">module ${echapperSvg(nom)}</text>`);
    } else if (r.L > L * 0.14 && r.W > W * 0.08) {
      const fs = Math.min(r.W * 0.32, e / 34);
      const cote = options.cote === "debit" ? `${r.L.toFixed(0)} × ${r.W.toFixed(0)}` : `${r.fini[0].toFixed(0)} × ${r.fini[1].toFixed(0)}`;
      const titre = r.cle && !MOTIF_NOYAU_PLAN.test(r.nom) && !MOTIF_STRATIFIE_PLAN.test(r.nom) ? r.cle.replace(/^[A-Z]+/, "") : MOTIF_STRATIFIE_PLAN.test(r.nom) && r.nom.startsWith("LT") ? `stratifié ${r.nom.slice(1).split("/")[0]}` : MOTIF_NOYAU_PLAN.test(r.nom) ? `module ${nom}` : r.nom;
      const deux = r.W >= fs * 2.6;
      s.push(`<text x="${(r.x + r.L / 2).toFixed(0)}" y="${(r.y + r.W / 2 + (deux ? -fs * 0.15 : fs * 0.35)).toFixed(0)}" font-size="${fs.toFixed(0)}" text-anchor="middle" font-weight="700" fill="#22231d" font-family="Lato,Arial">${echapperSvg(titre)}</text>`);
      if (deux) s.push(`<text x="${(r.x + r.L / 2).toFixed(0)}" y="${(r.y + r.W / 2 + fs * 0.95).toFixed(0)}" font-size="${(fs * 0.78).toFixed(0)}" text-anchor="middle" fill="#22231d" font-family="Lato,Arial">${cote}</text>`);
    }
    if (options.numeros) {
      const rr = Math.max(Math.min(r.W * 0.3, e / 70), e / 160);
      const cx = r.x + rr + e / 230;
      const cy = r.y + rr + e / 300;
      s.push(`<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rr.toFixed(0)}" fill="${v ? "#22231d" : "#fff"}" stroke="#22231d" stroke-width="${(rr / 7).toFixed(0)}"/>`);
      s.push(`<text x="${cx.toFixed(0)}" y="${(cy + rr * 0.38).toFixed(0)}" font-size="${(rr * 1.1).toFixed(0)}" text-anchor="middle" font-weight="700" fill="${v ? "#fff" : "#22231d"}" font-family="Lato,Arial">${n}</text>`);
    }
  });
  s.push("</svg>");
  return s.join("");
}

function echapperSvg(t) {
  return String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// Nom d'un morceau pour un tableau (pièce, module, stratifié).
function nomMorceauPlan(r) {
  const n = (r.nom || "").split("/")[0];
  if (/^LT\d+$/.test(n)) return `stratifié du module ${n.slice(1)}`;
  if (/^T\d+$/.test(n)) return `module ${n}`;
  if (/^L\d+$/.test(n)) return `stratifié de ${r.cle}`;
  return r.cle || n;
}

// Comparaison de deux versions des plans d'un même lancement (ex. optimisation et fichier modifié) :
// plans changés (même matière, même Pdc), et pour chacun les morceaux ajoutés / partis / chutes perdues.
function comparerPlans(avant, apres) {
  const signature = (r) => (r.chute ? `X:${r.L.toFixed(0)}x${r.W.toFixed(0)}` : `${r.nom}|${r.cle}|${r.L.toFixed(0)}x${r.W.toFixed(0)}`);
  const changes = [];
  const mats = new Set([...avant.matieres.keys(), ...apres.matieres.keys()]);
  const deplacements = new Map(); // cle → { de: [mat, pdc], vers: [mat, pdc] }
  for (const mat of [...mats].sort()) {
    const a = avant.matieres.get(mat);
    const b = apres.matieres.get(mat);
    const nb = Math.max(a ? a.plans.length : 0, b ? b.plans.length : 0);
    for (let i = 0; i < nb; i++) {
      const pa = a && a.plans[i];
      const pb = b && b.plans[i];
      const sa = pa ? pa.rects.map(signature) : [];
      const sb = pb ? pb.rects.map(signature) : [];
      const memePanneau = pa && pb && pa.nom === pb.nom && pa.L === pb.L && pa.W === pb.W;
      if (memePanneau && sa.join(";") === sb.join(";") && pa.fois === pb.fois) continue;
      const restant = [...sb];
      const partis = [];
      (pa ? pa.rects : []).forEach((r, idx) => {
        const k = restant.indexOf(signature(r));
        if (k >= 0) restant.splice(k, 1);
        else partis.push(idx);
      });
      const restantA = [...sa];
      const ajoutes = [];
      (pb ? pb.rects : []).forEach((r, idx) => {
        const k = restantA.indexOf(signature(r));
        if (k >= 0) restantA.splice(k, 1);
        else ajoutes.push(idx);
      });
      changes.push({ mat, pdc: i + 1, avant: pa || null, apres: pb || null, partis, ajoutes, panneauChange: Boolean(pa && pb && !memePanneau) });
      for (const idx of partis) {
        const r = pa.rects[idx];
        if (r.cle && !r.chute) deplacements.set(r.cle, { ...(deplacements.get(r.cle) || {}), de: { mat, pdc: i + 1 } });
      }
      for (const idx of ajoutes) {
        const r = pb.rects[idx];
        if (r.cle && !r.chute) deplacements.set(r.cle, { ...(deplacements.get(r.cle) || {}), vers: { mat, pdc: i + 1 } });
      }
    }
  }
  const perdues = [];
  for (const [cle, qa] of avant.placees) {
    const qb = apres.placees.get(cle) || 0;
    if (qb < qa) perdues.push({ cle, avant: qa, apres: qb });
  }
  return { changes, deplacements, perdues, nbPlans: avant.nbPlans + avant.nbModules };
}
