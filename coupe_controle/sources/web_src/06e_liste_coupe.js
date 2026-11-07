// ---- Expérimental : refaire la liste de coupe Cut Rite (.ctt) d'un lancement avec moins de pertes ----
// - Bandes (modèle « ban ») : règle des 6 cm (même agglo 28 et plus, mêmes couleurs ; largeur commune = celle d'une
//   des pièces, +60 mm au plus, -2 mm au plus, jamais plus que cote finie + 61 mm ; 3 pièces au plus ; bande <= 4060 mm,
//   soit somme des débits + 25 mm par pièce). Les pièces de la bande prennent la largeur de la bande.
// - Modules (modèle « C ») : par agglo + couleur dessus + couleur dessous, pièces rangées serrées (bandes en long,
//   tronçons, pièces empilées ; trait 5 mm comme dans les modules de Cut Rite), module <= 4060 × 1050 (stratifié
//   + 10 mm : <= 4070 × 1060). On garde la solution la moins chère (agglo + stratifiés).
// - Pièces sans modèle, protections : inchangées.
// La liste est écrite sous un autre nom (« LAN264801START_OPT ») : celle de Cut Rite reste intacte, et le fichier de
// lancement (LAN) n'est jamais touché. Format des enregistrements recopié de Cut Rite (vérifié sur la 48 01 : les 104
// bandes et modules et les 185 stratifiés se refont à l'identique avec ces règles ; liste importée dans Cut Rite).

const OPT = { LONGUEUR_BANDE: 4060, PIECES_PAR_BANDE: 3, AJOUT_PAR_PIECE: 25, ECART_BANDE: 60, TOLERANCE_SURCOTE: 2, SURCOTE_MAX: 61, LMAX: 4060, WMAX: 1050, TRAIT: 5, STRAT_EN_PLUS: 10 };

// Comparaison « à la Python » de deux listes de nombres (ordre lexicographique).
function comparerTuples(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -Infinity;
    const y = b[i] ?? -Infinity;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
const trierPar = (liste, cle) => [...liste].sort((a, b) => comparerTuples([].concat(cle(a)), [].concat(cle(b))));
const comparerTexte = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Lecture d'un .ctt : l'en-tête, puis les enregistrements (PNL1, PNL2, PNL3).
function lireCttListe(texte) {
  const lignes = texte.split("\r\n");
  if (lignes[lignes.length - 1] === "") lignes.pop();
  const entete = [];
  const recs = [];
  for (let i = 0; i < lignes.length; ) {
    if (lignes[i].startsWith("PNL1,")) {
      const p3 = lignes[i + 2] || "";
      const m = /^PNL3,([A-Z]+)(\d+):(T\w):N([^,]+),/.exec(p3);
      if (!m) throw new Error(`enregistrement illisible : ${p3.slice(0, 40)}`);
      recs.push({ p1: lignes[i].split(","), p2: (lignes[i + 1] || "").split(","), p3, pref: m[1], num: parseInt(m[2], 10), face: m[3], run: m[4], ordre: recs.length });
      i += 3;
    } else {
      if (recs.length) throw new Error("ligne inattendue au milieu des enregistrements");
      entete.push(lignes[i]);
      i++;
    }
  }
  const hdr = entete.find((l) => l.startsWith("PNLHDR1,"));
  const m = hdr && /^PNLHDR1,0,51,([^,]+),/.exec(hdr);
  if (!m) throw new Error("en-tête PNLHDR1 introuvable : ce n'est pas une liste de coupe Cut Rite");
  return { entete, recs, nom: m[1] };
}

function debitListe(r) {
  const m = r.p2.length > 51 ? /^(\d+(?:\.\d+)?) X (\d+(?:\.\d+)?)$/.exec(r.p2[51]) : null;
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
}

// texte : le .ctt de Cut Rite ; nom : le nom de la nouvelle liste ; retirees : clés à ne pas reprendre.
function genererListeOptimisee(texte, nom, retirees = new Set()) {
  const { LONGUEUR_BANDE, PIECES_PAR_BANDE, AJOUT_PAR_PIECE, ECART_BANDE, TOLERANCE_SURCOTE, SURCOTE_MAX, LMAX, WMAX, TRAIT, STRAT_EN_PLUS } = OPT;
  const { entete, recs, nom: NOM_ORIG } = lireCttListe(texte);
  const fmt = (x) => x.toFixed(2);
  const num = (s) => (s === "" || s === undefined || s === null ? null : parseFloat(s));

  // ---------- classement ----------
  let pieces = recs.filter((r) => r.face === "TC" && (r.p1[10] === "0" || r.p1[10] === "2"));
  const stratPiece = new Map();
  for (const r of recs) if (r.pref === "P" && r.face !== "TC") stratPiece.set(r.num, [...(stratPiece.get(r.num) || []), r]);
  const enlevees = pieces.filter((r) => retirees.has(r.p2[5]));
  pieces = pieces.filter((r) => !retirees.has(r.p2[5]));
  for (const r of enlevees) stratPiece.delete(r.num);
  if (!pieces.every((r) => r.pref === "P")) throw new Error("pièce sans numéro P : format inattendu");
  // Une pièce coupée en quantité 2 ou 3 entre deux modules (même numéro P) : un seul enregistrement.
  const parNum = new Map();
  for (const r of pieces) {
    if (parNum.has(r.num)) parNum.get(r.num).p1[5] = String(parseInt(parNum.get(r.num).p1[5], 10) + parseInt(r.p1[5], 10));
    else parNum.set(r.num, { ...r, p1: [...r.p1] });
  }
  pieces = [...parNum.values()];
  const ancienGroupe = new Map();
  for (const r of pieces) if (r.p1[10] === "2") ancienGroupe.set(r.num, r.p2[18].split(":")[0]);
  const epaisseur = new Map();
  const fil = new Map();
  for (const r of recs) {
    if (r.face !== "TC") {
      epaisseur.set(r.p1[2], r.p2[50]);
      fil.set(r.p1[2], r.p1[8]);
    }
  }
  let prochainId = Math.max(...recs.map((r) => parseInt(r.p1[12], 10))) + 1;
  let prochainC = Math.max(...recs.map((r) => r.num)) + 1;
  const nouvelId = () => String(prochainId++);

  const ban = pieces.filter((r) => r.p2[25] === "ban");
  const cc = pieces.filter((r) => r.p2[25] === "C");
  const autres = pieces.filter((r) => r.p2[25] !== "ban" && r.p2[25] !== "C");
  if (!autres.every((r) => r.p1[10] === "0")) throw new Error("une pièce sans modèle est dans une bande ou un module");
  const faces = (r) => [["TF", r.p2[16]], ["TB", r.p2[17]]].filter(([, col]) => col).map(([f]) => f);

  // ---------- bandes : règle des 6 cm ----------
  const longU = (L) => L + AJOUT_PAR_PIECE;
  const nombreBandes = (longueurs) => {
    const bandes = [];
    for (const L of [...longueurs].sort((a, b) => b - a)) {
      const b = bandes.find((x) => x[0] < PIECES_PAR_BANDE && x[1] + longU(L) <= LONGUEUR_BANDE);
      if (b) {
        b[0]++;
        b[1] += longU(L);
      } else bandes.push([1, longU(L)]);
    }
    return bandes.length;
  };
  function harmoniser(ps) {
    const ordre = trierPar(ps.map((_, k) => k), (k) => [ps[k].w, k]);
    const n = ordre.length;
    const unites = (p) => Array(p.q).fill(p.L);
    const seules = (liste) => {
      const parW = new Map();
      for (const p of liste) parW.set(p.w, [...(parW.get(p.w) || []), ...unites(p)]);
      return [...parW.values()].reduce((t, v) => t + nombreBandes(v), 0);
    };
    const commune = (membres) => {
      const mx = membres[membres.length - 1].w;
      const mn = membres[0].w;
      let choix = null;
      for (const w of [...new Set(membres.map((p) => p.w))]) {
        if (w < mx - TOLERANCE_SURCOTE || w - mn > ECART_BANDE) continue;
        if (membres.some((p) => p.max !== null && w > p.max && w !== p.w)) continue;
        const modif = membres.filter((p) => p.w !== w).length;
        const ajout = membres.reduce((t, p) => t + Math.max(0, w - p.w) * p.q, 0);
        if (!choix || comparerTuples([modif, ajout], [choix[1], choix[2]]) < 0) choix = [w, modif, ajout];
      }
      return choix;
    };
    const classe = (a, b) => {
      const toutes = ordre.slice(a, b).map((k) => ps[k]);
      let membres = toutes;
      let ch;
      for (;;) {
        ch = commune(membres);
        if (!ch) return null;
        const w = ch[0];
        const gardes = membres.filter((p) => p.w === w || membres.some((q) => q !== p && longU(p.L) + longU(q.L) <= LONGUEUR_BANDE));
        if (gardes.length === membres.length) break;
        membres = gardes;
      }
      const exclues = toutes.filter((p) => !membres.includes(p));
      const cible = new Map(membres.map((p) => [p, ch[0]]));
      return [nombreBandes(membres.flatMap(unites)) + seules(exclues), ch[1], ch[2], cible];
    };
    const meilleur = [[0, 0, 0, -1, null]];
    for (let j = 1; j <= n; j++) {
      let m = null;
      for (let i = j - 1; i >= 0; i--) {
        if (ps[ordre[j - 1]].w - ps[ordre[i]].w > ECART_BANDE + TOLERANCE_SURCOTE) break;
        const c = classe(i, j);
        if (!c) continue;
        const cand = [meilleur[i][0] + c[0], meilleur[i][1] + c[1], meilleur[i][2] + c[2], i, c[3]];
        if (!m || comparerTuples(cand.slice(0, 3), m.slice(0, 3)) < 0) m = cand;
      }
      meilleur.push(m);
    }
    const cible = new Map(ps.map((p) => [p, p.w]));
    for (let j = n; j > 0; j = meilleur[j][3]) for (const [p, w] of meilleur[j][4]) cible.set(p, w);
    return cible;
  }

  const groupesBan = new Map();
  for (const r of ban) {
    const d = debitListe(r) || [num(r.p1[3]), num(r.p1[4])];
    const fini = num(r.p2[36]);
    const cle = `${r.p1[2]}\u0001${r.p2[16]}\u0001${r.p2[17]}`;
    if (!groupesBan.has(cle)) groupesBan.set(cle, []);
    groupesBan.get(cle).push({ r, L: d[0], w: d[1], q: parseInt(r.p1[5], 10), max: fini === null ? null : fini + SURCOTE_MAX });
  }
  const bandes = []; // [agglo, largeur, items]
  const seulesBan = [];
  for (const [cle, ps] of groupesBan) {
    const agglo = cle.split("\u0001")[0];
    const m = /^SAG(\d+)/.exec(agglo);
    const cible = m && parseInt(m[1], 10) >= 28 ? harmoniser(ps) : new Map(ps.map((p) => [p, p.w]));
    const parW = new Map();
    for (const p of ps) parW.set(cible.get(p), [...(parW.get(cible.get(p)) || []), p]);
    for (const [w, items] of parW) {
      const bs = [];
      for (const p of trierPar(items, (p) => -p.q * longU(p.L))) {
        const b = bs.find((x) => x.n + p.q <= PIECES_PAR_BANDE && x.t + p.q * longU(p.L) <= LONGUEUR_BANDE);
        if (b) {
          b.n += p.q;
          b.t += p.q * longU(p.L);
          b.items.push(p);
        } else bs.push({ n: p.q, t: p.q * longU(p.L), items: [p] });
      }
      for (const b of bs) {
        if (b.n >= 2) bandes.push([agglo, w, b.items]);
        else seulesBan.push(...b.items);
      }
    }
  }

  // ---------- modules : rangement serré ----------
  function ranger(unites, lcap, ordre, wcap = WMAX) {
    const bm = [];
    for (const u of trierPar(unites, ordre)) {
      const [L, W] = u;
      let best = null;
      for (const b of bm) {
        for (const s of b.tr) {
          if (L <= s.l && s.u + TRAIT + W <= b.w) {
            const perte = (s.l - L) * W;
            if (!best || perte < best[0]) best = [perte, "pile", b, s];
          }
        }
        if (b.ul + TRAIT + L <= lcap && W <= b.w) {
          const perte = (b.w - W) * L;
          if (!best || perte < best[0]) best = [perte, "troncon", b, null];
        }
      }
      if (!best) {
        const tot = bm.reduce((t, b) => t + b.w, 0) + TRAIT * bm.length;
        if (L > lcap || tot + W > wcap) return null;
        bm.push({ w: W, ul: L, tr: [{ l: L, u: W, items: [u] }] });
      } else if (best[1] === "pile") {
        best[3].u += TRAIT + W;
        best[3].items.push(u);
      } else {
        best[2].ul += TRAIT + L;
        best[2].tr.push({ l: L, u: W, items: [u] });
      }
    }
    return [Math.max(...bm.map((b) => b.ul)), bm.reduce((t, b) => t + b.w, 0) + TRAIT * (bm.length - 1), bm];
  }
  const ORDRES = [(u) => [-u[1], -u[0]], (u) => [-u[0], -u[1]], (u) => [-u[0] * u[1]]];
  const plage = (de, a, pas, fin) => {
    const v = new Set([fin]);
    for (let x = de; x <= a; x += pas) v.add(x);
    return [...v].sort((x, y) => x - y);
  };
  const cacheSerrer = new Map();
  function serrer(unites) {
    const cle = unites.map((u) => `${u[0]}x${u[1]}#${u[2]}`).join(";");
    if (cacheSerrer.has(cle)) return cacheSerrer.get(cle);
    let best = null;
    const lmin = Math.trunc(Math.max(...unites.map((u) => u[0])));
    for (const o of ORDRES)
      for (const cap of plage(lmin, LMAX, 50, LMAX)) {
        const res = ranger(unites, cap, o);
        if (res && (!best || res[0] * res[1] < best[0] * best[1] - 1e-6)) best = [...res, "long"];
      }
    // d'abord en travers : pièces tournées de 90° dans un module tourné
    const ut = unites.map((u) => [u[1], u[0], u[2]]);
    const wmin = Math.trunc(Math.max(...ut.map((u) => u[0])));
    for (const o of ORDRES)
      for (const cap of plage(wmin, WMAX, 25, WMAX)) {
        const res = ranger(ut, cap, o, LMAX);
        if (res && (!best || res[0] * res[1] < best[0] * best[1] - 1e-6)) best = [res[1], res[0], res[2], "travers"];
      }
    cacheSerrer.set(cle, best);
    return best;
  }
  const coutModule = (Lx, Wx, nf) => Lx * Wx + nf * (Lx + STRAT_EN_PLUS) * (Wx + STRAT_EN_PLUS);
  const unitesDe = (rs) =>
    rs.flatMap((r) => {
      const d = debitListe(r);
      if (!d) throw new Error(`pas de cote de débit pour ${r.p2[5]}`);
      return Array(parseInt(r.p1[5], 10)).fill([d[0], d[1], r.num]);
    });
  const coutSeule = (r, nf) => {
    const d = debitListe(r);
    return parseInt(r.p1[5], 10) * (d[0] * d[1] + nf * (d[0] + STRAT_EN_PLUS) * (d[1] + STRAT_EN_PLUS));
  };
  const solutionCout = (sol, nf) => sol.reduce((t, m) => t + (m[0].length > 1 || parseInt(m[0][0].p1[5], 10) > 1 ? coutModule(m[1][0], m[1][1], nf) : coutSeule(m[0][0], nf)), 0);

  const groupesC = new Map();
  for (const r of cc) {
    const cle = `${r.p1[2]}\u0001${r.p2[16]}\u0001${r.p2[17]}`;
    if (!groupesC.has(cle)) groupesC.set(cle, []);
    groupesC.get(cle).push(r);
  }
  const modules = []; // [agglo, records, rangement]
  const seulesC = [];
  for (const [cle, tous] of groupesC) {
    const nf = faces(tous[0]).length;
    const trop = tous.filter((r) => serrer(unitesDe([r])) === null);
    seulesC.push(...trop);
    const rs = tous.filter((r) => !trop.includes(r));
    if (!rs.length) continue;
    const obligatoires = rs.filter((r) => ancienGroupe.has(r.num)); // déjà en module chez Cut Rite : restent en module
    const libres = rs.filter((r) => !ancienGroupe.has(r.num)); // seules chez Cut Rite : en module seulement si on gagne
    const taille = (r) => -parseInt(r.p1[5], 10) * debitListe(r)[0] * debitListe(r)[1];
    const fusionner = (depart) => {
      const sol = [...depart];
      let change = true;
      while (change) {
        change = false;
        for (let a = 0; a < sol.length && !change; a++) {
          for (let b = a + 1; b < sol.length; b++) {
            const nl = serrer(unitesDe([...sol[a][0], ...sol[b][0]]));
            if (!nl) continue;
            if (coutModule(nl[0], nl[1], nf) < solutionCout([sol[a], sol[b]], nf) - 1) {
              sol[a] = [[...sol[a][0], ...sol[b][0]], nl];
              sol.splice(b, 1);
              change = true;
              break;
            }
          }
        }
      }
      return sol;
    };
    const ajouterLibres = (depart) => {
      const sol = [...depart];
      const reste = [];
      for (const r of trierPar(libres, taille)) {
        let best = null;
        sol.forEach(([g, lay], k) => {
          const nl = serrer(unitesDe([...g, r]));
          if (nl) {
            const delta = coutModule(nl[0], nl[1], nf) - solutionCout([[g, lay]], nf);
            if (!best || delta < best[0]) best = [delta, k, nl];
          }
        });
        if (best && best[0] < coutSeule(r, nf) - 1) sol[best[1]] = [[...sol[best[1]][0], r], best[2]];
        else reste.push([[r], serrer(unitesDe([r]))]);
      }
      return fusionner([...sol, ...reste]);
    };
    const regrouper = (liste) => {
      const sol = [];
      for (const r of trierPar(liste, taille)) {
        let best = null;
        sol.forEach(([g, lay], k) => {
          const nl = serrer(unitesDe([...g, r]));
          if (nl) {
            const delta = coutModule(nl[0], nl[1], nf) - coutModule(lay[0], lay[1], nf);
            if (!best || delta < best[0]) best = [delta, k, nl];
          }
        });
        if (best) sol[best[1]] = [[...sol[best[1]][0], r], best[2]];
        else sol.push([[r], serrer(unitesDe([r]))]);
      }
      return sol;
    };
    // 1) modules de Cut Rite (mêmes pièces), resserrés ; 2) modules refaits ; on garde le moins cher
    const orig = new Map();
    for (const r of obligatoires) orig.set(ancienGroupe.get(r.num), [...(orig.get(ancienGroupe.get(r.num)) || []), r]);
    let solO = [];
    for (const g of orig.values()) {
      const lay = serrer(unitesDe(g));
      solO.push(...(lay ? [[g, lay]] : regrouper(g)));
    }
    let solN = regrouper(obligatoires);
    solO = ajouterLibres(fusionner(solO));
    solN = ajouterLibres(fusionner(solN));
    const sol = solutionCout(solN, nf) < solutionCout(solO, nf) ? solN : solO;
    for (const [g, lay] of sol) {
      if (g.length === 1 && parseInt(g[0].p1[5], 10) === 1) seulesC.push(g[0]);
      else modules.push([cle.split("\u0001")[0], g, lay]);
    }
  }

  // ---------- écriture des enregistrements ----------
  const sortie = []; // [ordre, p1, p2, p3]
  const noyauP2 = (membresP2, n, modele) => {
    const N = Math.max(...membresP2.map((y) => y.length));
    const p2 = [];
    for (let k = 0; k < N; k++) {
      const vals = new Set(membresP2.map((y) => (k < y.length ? y[k] : "")));
      p2.push(vals.size === 1 ? [...vals][0] : "");
    }
    for (const k of [11, 12, 13, 14]) p2[k] = "";
    p2[18] = `T${n}:0:1`;
    p2[28] = "1";
    if (modele === "ban") p2[26] = "";
    while (p2.length > 51 && p2[p2.length - 1] === "") p2.pop();
    return p2;
  };
  const stratNoyau = (n, c, p1n, p2n, ordre) => {
    const out = [];
    for (const [face, col] of [["TF", p2n[16]], ["TB", p2n[17]]]) {
      if (!col) continue;
      const q2 = [...p2n];
      q2[8] = q2[10] = q2[18] = "";
      q2[50] = epaisseur.get(col);
      const q1 = ["PNL1", `LT${n}/1`, col, fmt(parseFloat(p1n[3]) + STRAT_EN_PLUS), fmt(parseFloat(p1n[4]) + STRAT_EN_PLUS), p1n[5], "0", "0", fil.get(col), "0000", "0", "0", nouvelId()];
      out.push([ordre, q1, q2, `PNL3,C${c}:${face}:N${NOM_ORIG}_${col},0,,0,0,0,",37,59,"`]);
    }
    return out;
  };
  const stratPieceRecs = (r, ordre) => {
    const out = [];
    for (const [face, col] of [["TF", r.p2[16]], ["TB", r.p2[17]]]) {
      if (!col) continue;
      const q2 = [...r.p2];
      for (const k of [8, 10, 11, 12, 13, 14]) q2[k] = "";
      q2[50] = epaisseur.get(col);
      const q1 = ["PNL1", `L${String(r.num).padStart(4, "0")}`, col, fmt(parseFloat(r.p1[3]) + STRAT_EN_PLUS), fmt(parseFloat(r.p1[4]) + STRAT_EN_PLUS), r.p1[5], "0", "0", fil.get(col), "0000", "0", "0", nouvelId()];
      out.push([ordre, q1, q2, r.p3.replace(/:TC:N[^,]+,/g, `:${face}:N${NOM_ORIG}_${col},`)]);
    }
    return out;
  };
  const finP3 = (p3, fin) => p3.replace(/,0,,0,0,0,".*"$/, `,0,,0,0,0,"${fin}"`);
  const pieceSeule = (r) => {
    const p1 = [...r.p1];
    const p2 = [...r.p2];
    const d = debitListe(r);
    if (r.p1[10] === "0" && (d === null || (parseFloat(p1[3]) === d[0] && parseFloat(p1[4]) === d[1]))) {
      sortie.push([r.ordre, p1, p2, r.p3]);
      for (const s of stratPiece.get(r.num) || []) sortie.push([s.ordre, s.p1, s.p2, s.p3]);
      return;
    }
    p1[3] = fmt(d[0]);
    p1[4] = fmt(d[1]);
    p1[10] = "0";
    p2[18] = "";
    if (p2[25] === "ban") p2[26] = "";
    const p3 = finP3(r.p3, ",59,");
    sortie.push([r.ordre, p1, p2, p3]);
    sortie.push(...stratPieceRecs({ ...r, p1, p2, p3 }, r.ordre));
  };

  for (const r of autres) pieceSeule(r);
  let nT = 0;
  const elargies = [];
  for (const [agglo, w, items] of bandes) {
    nT++;
    const c = prochainC++;
    const membres = [];
    let k = 0;
    for (const p of trierPar(items, (p) => -p.L)) {
      const r = p.r;
      const p1 = [...r.p1];
      const p2 = [...r.p2];
      p1[3] = fmt(p.L);
      p1[4] = fmt(w);
      p1[8] = "0";
      p1[10] = "2";
      const pos = Array.from({ length: p.q }, (_, j) => k + j + 1).join(" ");
      k += p.q;
      p2[18] = `T${nT}:${pos}:1`;
      p2[26] = "1";
      membres.push([r.ordre, p1, p2, finP3(r.p3, ",35,59,")]);
      if (w > p.w) elargies.push({ cle: r.p2[5], avant: p.w, apres: w, L: p.L, q: p.q });
    }
    const long = items.reduce((t, p) => t + p.q * longU(p.L), 0);
    if (long > LONGUEUR_BANDE) throw new Error("bande trop longue");
    const p2n = noyauP2(membres.map((m) => m[2]), nT, "ban");
    const o = Math.min(...membres.map((m) => m[0]));
    const p1n = ["PNL1", `T${nT}/1`, agglo, fmt(long), fmt(w), "1", "0", "0", "0", "0000", "1", "0", nouvelId()];
    sortie.push([o, p1n, p2n, `PNL3,C${c}:TC:N${NOM_ORIG}_${agglo},0,,0,0,0,",37,59,"`]);
    sortie.push(...stratNoyau(nT, c, p1n, p2n, o));
    sortie.push(...membres);
  }
  for (const p of seulesBan) pieceSeule(p.r);
  const infosModules = [];
  for (const [agglo, g, lay] of modules) {
    nT++;
    const c = prochainC++;
    const [Lx, Wx, rangement, sens] = lay;
    const Lm = Math.ceil(Lx);
    const Wm = Math.ceil(Wx);
    if (Lm > LMAX || Wm > WMAX) throw new Error("module trop grand");
    const pos = new Map();
    let k = 0;
    for (const b of rangement) for (const s of b.tr) for (const u of s.items) pos.set(u[2], [...(pos.get(u[2]) || []), ++k]);
    const membres = [];
    for (const r of g) {
      const p1 = [...r.p1];
      const p2 = [...r.p2];
      p1[3] = fmt(num(p2[35]));
      p1[4] = fmt(num(p2[36]));
      p1[8] = "0";
      p1[10] = "2";
      if ((pos.get(r.num) || []).length !== parseInt(p1[5], 10)) throw new Error(`pièce ${r.p2[5]} mal rangée dans son module`);
      p2[18] = `T${nT}:${pos.get(r.num).join(" ")}:1`;
      p2[26] = "";
      membres.push([r.ordre, p1, p2, finP3(r.p3, ",3,4,59,")]);
    }
    const p2n = noyauP2(membres.map((m) => m[2]), nT, "C");
    const o = Math.min(...membres.map((m) => m[0]));
    const p1n = ["PNL1", `T${nT}/1`, agglo, fmt(Lm), fmt(Wm), "1", "0", "0", "1", "0000", "1", "0", nouvelId()];
    sortie.push([o, p1n, p2n, `PNL3,C${c}:TC:N${NOM_ORIG}_${agglo},0,,0,0,0,",37,59,"`]);
    sortie.push(...stratNoyau(nT, c, p1n, p2n, o));
    sortie.push(...membres);
    // Plan du module (pour l'écran et le rapport).
    const placees = [];
    let y = 0;
    for (const b of rangement) {
      let x = 0;
      for (const s of b.tr) {
        let yy = y;
        for (const u of s.items) {
          placees.push([x, yy, u[0], u[1], u[2]]);
          yy += u[1] + TRAIT;
        }
        x += s.l + TRAIT;
      }
      y += b.w + TRAIT;
    }
    const cles = new Map(g.map((r) => [r.num, r.p2[5]]));
    infosModules.push({
      nom: `T${nT}`,
      agglo,
      dessus: g[0].p2[16],
      dessous: g[0].p2[17],
      L: Lm,
      W: Wm,
      pieces: placees.map(([px, py, pl, pw, t]) => (sens === "travers" ? { x: py, y: px, L: pw, W: pl, cle: cles.get(t) } : { x: px, y: py, L: pl, W: pw, cle: cles.get(t) })),
    });
  }
  for (const r of seulesC) pieceSeule(r);

  // ordre : par matière comme dans l'original, puis ordre d'origine
  const ordreMat = new Map();
  for (const r of recs) if (!ordreMat.has(r.p1[2])) ordreMat.set(r.p1[2], ordreMat.size);
  sortie.sort((a, b) => (ordreMat.get(a[1][2]) ?? 999) - (ordreMat.get(b[1][2]) ?? 999) || a[0] - b[0] || comparerTexte(a[1][1], b[1][1]));
  const out = entete.map((l) => {
    if (!l.startsWith("PNLHDR2,")) return l;
    const ch = l.split(",");
    ch[ch.length - 1] = String(prochainId - 1);
    return ch.join(",");
  });
  for (const [, p1, p2, p3] of sortie) out.push(p1.join(","), p2.join(","), p3);
  const resultat = `${out.join("\r\n")}\r\n`.split(NOM_ORIG).join(nom);

  // ---------- contrôles : mêmes pièces, tailles, groupes, identifiants ----------
  const avant = new Map();
  for (const r of pieces) avant.set(r.p2[5], (avant.get(r.p2[5]) || 0) + parseInt(r.p1[5], 10));
  const relu = lireCttListe(resultat).recs;
  const apres = new Map();
  const noyaux = new Set();
  for (const r of relu) {
    if (r.face === "TC" && (r.p1[10] === "0" || r.p1[10] === "2")) apres.set(r.p2[5], (apres.get(r.p2[5]) || 0) + parseInt(r.p1[5], 10));
    if (r.face === "TC" && r.p1[10] === "1") {
      noyaux.add(r.p1[1].split("/")[0]);
      if (parseFloat(r.p1[3]) > LMAX || parseFloat(r.p1[4]) > WMAX) throw new Error(`noyau trop grand : ${r.p1[1]}`);
    }
    if (r.face !== "TC" && r.p1[1].startsWith("LT") && (parseFloat(r.p1[3]) > LMAX + STRAT_EN_PLUS || parseFloat(r.p1[4]) > WMAX + STRAT_EN_PLUS)) throw new Error(`stratifié trop grand : ${r.p1[1]}`);
  }
  if (avant.size !== apres.size || [...avant].some(([k, v]) => apres.get(k) !== v)) throw new Error("pièces perdues ou en double : liste non écrite");
  for (const r of relu) if (r.p1[10] === "2" && !noyaux.has(r.p2[18].split(":")[0])) throw new Error(`pièce ${r.p2[5]} dans un groupe inexistant`);
  const ids = relu.map((r) => r.p1[12]);
  if (new Set(ids).size !== ids.length) throw new Error("identifiant en double");
  for (const k of retirees) if (resultat.includes(k)) throw new Error(`pièce retirée encore présente : ${k}`);
  return { texte: resultat, nomOrigine: NOM_ORIG, modules: infosModules, elargies, retirees: enlevees.map((r) => r.p2[5]) };
}

// Mesures d'une liste de coupe : bandes, modules, surfaces d'agglo et de stratifié à débiter, cohérence.
function mesurerListe(texte, retirees = new Set()) {
  let R = lireCttListe(texte).recs;
  if (retirees.size) {
    const nums = new Set(R.filter((r) => r.face === "TC" && retirees.has(r.p2[5])).map((r) => r.num));
    R = R.filter((r) => !(r.pref === "P" && nums.has(r.num)));
  }
  const A = (r) => (parseFloat(r.p1[3]) * parseFloat(r.p1[4]) * parseInt(r.p1[5], 10)) / 1e6;
  const deb = (r) => debitListe(r) || [parseFloat(r.p1[3]), parseFloat(r.p1[4])];
  const tc = R.filter((r) => r.face === "TC");
  const pieces = tc.filter((r) => r.p1[10] === "0" || r.p1[10] === "2");
  const noyaux = new Map(tc.filter((r) => r.p1[10] === "1").map((r) => [r.p1[1].split("/")[0], r]));
  const membres = new Map();
  for (const r of pieces) if (r.p1[10] === "2") membres.set(r.p2[18].split(":")[0], [...(membres.get(r.p2[18].split(":")[0]) || []), r]);
  const strat = R.filter((r) => r.face !== "TC");
  const m = { pieces: pieces.reduce((t, r) => t + parseInt(r.p1[5], 10), 0) };
  for (const [modele, nom] of [["ban", "bandes"], ["C", "modules"]]) {
    const ns = [...noyaux].filter(([, r]) => r.p2[25] === modele).map(([n]) => n);
    m[nom] = ns.length;
    m[`piecesEn_${nom}`] = ns.reduce((t, n) => t + (membres.get(n) || []).reduce((s, p) => s + parseInt(p.p1[5], 10), 0), 0);
    m[`surface_${nom}`] = ns.reduce((t, n) => t + A(noyaux.get(n)), 0);
  }
  const pmod = [...noyaux].filter(([, r]) => r.p2[25] === "C").reduce((t, [n]) => t + (membres.get(n) || []).reduce((s, p) => s + deb(p)[0] * deb(p)[1] * parseInt(p.p1[5], 10), 0), 0) / 1e6;
  m.trousModules = m.surface_modules - pmod;
  m.remplissage = m.surface_modules ? (100 * pmod) / m.surface_modules : 0;
  const el = [...noyaux].filter(([, r]) => r.p2[25] === "ban").flatMap(([n]) => membres.get(n) || []).filter((p) => parseFloat(p.p1[4]) > deb(p)[1] + 0.01);
  m.elargies = el.length;
  m.surfaceElargie = el.reduce((t, p) => t + (parseFloat(p.p1[4]) - deb(p)[1]) * deb(p)[0] * parseInt(p.p1[5], 10), 0) / 1e6;
  const agglo = tc.filter((r) => r.p1[10] === "0" || r.p1[10] === "1");
  m.agglo = agglo.reduce((t, r) => t + A(r), 0);
  m.stratifie = strat.reduce((t, r) => t + A(r), 0);
  m.cles = new Set(pieces.map((r) => r.p2[5]));
  return m;
}
