// ---- V6.5 : stock des panneaux (fichier « brdlib.bdx » extrait de woodStore / Cut Rite) ----
// Une ligne par panneau entier ou par chute, 20 colonnes, sans en-tête (lecture seule, rien n'est jamais écrit) :
//   0 code (« 1114_4100_1310 », chute : « X… »)   1 quantité en stock   2 matériau (le code des LAN : 1114, SAG38HYBL…)
//   3-5 longueur, largeur, épaisseur (mm)          6 prix                7 LIMITE woodStore : 0 = limité au stock,
//   9 description   10 fil (décor à veines)        9 = dépassement autorisé (champ « BoardsLimit » de Cut Rite)
//   14 statut : 0 = panneau entier, 1 = chute disponible, 2 = chute réservée (en stock, déjà prise pour un
//      lancement ; à 0 = sortie)                                       15 emplacements « 1041(15) 7131(65) »
//   17 famille (STRAT, COMPACT).
// Le fichier est extrait à la main : Sentinelle garde le dernier chargé et prévient quand il vieillit.
// V6.5.7 : les PANNEAUX ENTIERS réservés pour un lancement sont rangés par woodStore dans la case 302 (fichier du
// 12/11 : 1063 = « 302(3) 1042(21) 1043(24) » = 48 en stock, il en reste 45). Ils sont retirés du stock réel et
// comptés à part, comme les chutes réservées (statut 2).

const CLE_STOCK = "sentinelle-stock";
const STOCK_VIEUX_JOURS = 7; // au-delà : « extrayez un fichier neuf »
const CHUTE_DORT_JOURS = 120; // une chute en stock depuis plus de 4 mois « dort »
const CASES_RESERVATION = new Set(["302"]); // cases woodStore des panneaux entiers réservés pour un lancement

// Panneaux d'un format rangés dans une case de réservation (jamais plus que la quantité en stock).
function reserveEnCase(emplacements, qte) {
  const n = emplacements.reduce((t, [c, q]) => t + (CASES_RESERVATION.has(c) ? q : 0), 0);
  return Math.max(0, Math.min(qte, n));
}

const stock = {
  // V6.5.8 : tous les matériaux par défaut, même à zéro (le 1136 sans stock n'apparaissait pas, seul le 1136-PF).
  donnees: null, lu: false, recherche: "", famille: "tous", avecStock: false, ouvert: null, erreur: null,
  // Tri choisi en cliquant sur les en-têtes de colonnes (sens : 1 croissant, -1 décroissant).
  tri: { liste: { col: "entiers", sens: -1 }, entiers: { col: "qte", sens: -1 }, chutes: { col: "taille", sens: -1 } },
};

const FAMILLES_STOCK = [
  ["tous", "Tous"],
  ["strat", "Stratifiés"],
  ["compact", "Compacts"],
  ["agglo", "Agglos"],
  ["protection", "Protections"],
  ["autre", "Autres"],
];

function familleStock(c17, desc, ep) {
  const d = `${c17} ${desc}`.toUpperCase();
  if (/COMPACT/.test(d)) return "compact";
  if (/MARTYR|PROTECTION/.test(d)) return "protection";
  if (/AGGLO/.test(d)) return "agglo";
  if (/^STRAT|STRAT\b|STRATIFI/.test(d) || (ep > 0 && ep <= 1.2)) return "strat";
  return "autre";
}

// D'où vient une chute, et depuis quand elle est là (d'après son code).
function origineChute(code) {
  let m = /^XLAN(\d{2})(\d{2})/.exec(code);
  if (m) {
    const nom = code.slice(1).split("_")[0];
    const annee = 2000 + Number(m[1]);
    const semaine = Number(m[2]);
    return { genre: "lancement", texte: `${nom} (semaine ${semaine})`, quand: semaine >= 1 && semaine <= 53 ? lundiSemaineIso(annee, semaine).getTime() : 0 };
  }
  m = /^X([^/]+)\/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(code);
  if (m) {
    const d = new Date(2000 + Number(m[2]), Number(m[3]) - 1, Number(m[4]), Number(m[5]), Number(m[6]));
    return { genre: "machine", texte: `machine ${m[1]}`, quand: d.getTime(), precis: true };
  }
  return { genre: "autre", texte: "chute du stock", quand: 0 };
}

// Lit le texte du fichier (déjà décodé) → { formats, materiaux, donneesJusquau }.
function lireFichierStock(texte) {
  const formats = [];
  let jusquau = 0;
  for (const ligne of texte.split(/\r?\n/)) {
    const c = ligne.split(",");
    if (c.length < 16 || !c[0].trim() || !c[2].trim()) continue;
    const code = c[0].trim();
    const L = Number(c[3]);
    const W = Number(c[4]);
    if (!(L > 0 && W > 0)) continue;
    const chute = code.startsWith("X");
    const ep = Number(c[5]) || 0;
    const desc = (c[9] || "").trim();
    const f = {
      code,
      qte: Math.max(0, Math.round(Number(c[1]) || 0)),
      mat: c[2].trim(),
      L,
      W,
      ep,
      limite: c[7].trim() === "9" ? 9 : 0,
      desc,
      fil: c[10].trim() === "1",
      chute,
      emplacements: [...(c[15] || "").matchAll(/([^\s()]+)\((\d+)\)?/g)].map((m) => [m[1], Number(m[2])]),
      reservee: c[0].trim().startsWith("X") && c[14].trim() === "2",
      famille: familleStock(c[17] || c[12] || "", desc, ep),
      origine: chute ? origineChute(code) : null,
    };
    // Panneau entier : disponible = stock − réservés (case 302). Chute : la réservation, c'est son statut 2.
    f.reserve = chute ? 0 : reserveEnCase(f.emplacements, f.qte);
    f.dispo = f.qte - f.reserve;
    if (f.origine && f.origine.precis && f.origine.quand > jusquau) jusquau = f.origine.quand;
    formats.push(f);
  }
  if (!formats.length) throw new Error("aucune ligne de stock lisible : est-ce bien le fichier brdlib.bdx ?");
  const parMat = new Map();
  for (const f of formats) {
    if (!parMat.has(f.mat)) parMat.set(f.mat, { mat: f.mat, desc: "", famille: f.famille, ep: f.ep, entiers: [], chutes: [], nbEntiers: 0, nbEntiersReserves: 0, nbChutes: 0, nbReservees: 0, limites: new Set() });
    const m = parMat.get(f.mat);
    if (f.chute) {
      if (f.qte > 0) {
        m.chutes.push(f);
        if (f.reservee) m.nbReservees += f.qte;
        else m.nbChutes += f.qte; // disponibles seulement
      }
    } else {
      m.entiers.push(f);
      m.nbEntiers += f.dispo; // stock réel : sans les panneaux réservés (case 302)
      m.nbEntiersReserves += f.reserve;
      m.limites.add(f.limite);
      if (!m.desc && f.desc) m.desc = f.desc;
      m.famille = f.famille;
      m.ep = f.ep;
    }
  }
  for (const m of parMat.values()) {
    if (!m.desc) m.desc = (m.chutes.find((f) => f.desc) || {}).desc || "";
    m.entiers.sort((a, b) => b.dispo - a.dispo || b.L * b.W - a.L * a.W);
    m.chutes.sort((a, b) => a.reservee - b.reservee || b.L * b.W - a.L * a.W); // les disponibles d'abord
    if (m.entiers.length) m.ep = m.entiers[0].ep; // l'épaisseur du format le plus en stock
  }
  return { formats, materiaux: [...parMat.values()], donneesJusquau: jusquau };
}

// Mémoire : le dernier fichier chargé (texte brut, ~300 ko), relu à l'ouverture de la page.
function lireStockMemoire() {
  if (stock.lu) return;
  stock.lu = true;
  try {
    const v = JSON.parse(localStorage.getItem(CLE_STOCK) || "null");
    if (v && v.texte) stock.donnees = { ...lireFichierStock(v.texte), nom: v.nom, modifie: v.modifie, charge: v.charge };
  } catch (_e) {
    stock.donnees = null;
  }
}

async function chargerFichierStock(fichier) {
  try {
    const texte = new TextDecoder("windows-1252").decode(await fichier.arrayBuffer());
    const donnees = lireFichierStock(texte);
    const memo = { nom: fichier.name, modifie: fichier.lastModified || Date.now(), charge: Date.now(), texte };
    stock.donnees = { ...donnees, nom: memo.nom, modifie: memo.modifie, charge: memo.charge };
    stock.erreur = null;
    stock.ouvert = null;
    try {
      localStorage.setItem(CLE_STOCK, JSON.stringify(memo));
    } catch (_e) {
      // sans place : gardé le temps de la page
    }
    // V6.5.1 : le téléphone relié reçoit le nouveau stock quelques secondes après.
    if (typeof planifierEnvoiTelephone === "function") planifierEnvoiTelephone();
  } catch (e) {
    stock.erreur = e && e.message ? e.message : String(e);
  }
  afficherStock();
}

// V6.5.1 : le stock part aussi au téléphone, dans le fichier partagé, déjà lu (le téléphone n'a qu'à l'afficher).
// Une ligne par format : [code, qté, matériau, L, l, ép., limite, désignation, fil, réservée, famille, cases, origine, depuis].
// Le stock envoyé par un autre PC (lu sur le site) : gardé tel quel et renvoyé s'il est plus récent que le nôtre.
let stockDistant = null;
function recevoirStockDistant(s) {
  if (s && Array.isArray(s.formats) && (!stockDistant || (s.charge || 0) > (stockDistant.charge || 0))) stockDistant = s;
}

function stockPourPartage() {
  lireStockMemoire();
  const d = stock.donnees;
  if (!d || (stockDistant && (stockDistant.charge || 0) > (d.charge || 0))) return stockDistant;
  return {
    nom: d.nom || "",
    modifie: d.modifie || 0,
    charge: d.charge || 0,
    jusquau: d.donneesJusquau || 0,
    formats: d.formats.map((f) => [
      f.code, f.qte, f.mat, f.L, f.W, f.ep, f.limite, f.desc, f.fil ? 1 : 0, f.reservee ? 1 : 0, f.famille,
      f.emplacements.map(([c, q]) => `${c}(${q})`).join(" "), f.origine ? f.origine.texte : "", f.origine ? f.origine.quand || 0 : 0,
    ]),
  };
}

// Change quand un autre fichier de stock est chargé (déclenche l'envoi au téléphone).
function signatureStock() {
  lireStockMemoire();
  return `${stock.donnees ? String(stock.donnees.charge || 0) : ""}/${stockDistant ? stockDistant.charge || 0 : ""}`;
}

// Le stock d'un matériau (pour la simulation d'un lancement, plus tard).
function stockDuMateriau(mat) {
  lireStockMemoire();
  return stock.donnees ? stock.donnees.materiaux.find((m) => m.mat === mat) || null : null;
}

// ---------- Rapport du lancement : les chutes de STRATIFIÉ réservées, à sortir des cases avant la coupe ----------
// Les chutes que Cut Rite utilise dans les plans du lancement (son .bkp) sont celles que woodStore a réservées pour
// lui (statut 2). Leur case est relevée par woodStore dans le .bkp (BRD3) ; à défaut, celle du fichier de stock.
// Stratifié seulement (pas d'agglo, pas de compact). Seules des CHUTES sont listées : les feuilles entières (dont
// celles de RCB / RCB-CRED14, toujours prises au même endroit) n'y figurent pas ; les chutes de RCB, elles, restent.

async function chutesStratReserveesLancement(fichierBkp) {
  const donnees = await lirePlansBkp(fichierBkp);
  lireStockMemoire();
  const parCode = new Map();
  if (stock.donnees) for (const f of stock.donnees.formats) if (f.chute) parCode.set(f.code, f);
  const res = new Map();
  for (const m of donnees.matieres.values()) {
    if (!m.stratifie) continue;
    for (const plan of m.plans) {
      if (plan.module || plan.sorte !== "chute du stock") continue;
      const s = parCode.get(plan.nom);
      // La case : celle relevée dans la sauvegarde du lancement (au moment de la réservation), sinon le fichier de stock.
      const casesBkp = [...String(plan.cases || "").matchAll(/([^\s()]+)\((\d+)\)?/g)].map((x) => [x[1], Number(x[2])]);
      const cases = casesBkp.length ? casesBkp : s && s.emplacements.length ? s.emplacements : null;
      if (!res.has(plan.nom))
        res.set(plan.nom, { code: plan.nom, mat: m.mat, desc: (s && s.desc) || m.desc, L: plan.L, W: plan.W, qte: 0, cases, reservee: s ? s.reservee : null });
      res.get(plan.nom).qte += plan.fois || 1;
    }
  }
  // Par case (pour la sortie en magasin) ; les chutes sans case connue à la fin.
  const caseDe = (c) => (c.cases && c.cases.length ? c.cases[0][0] : "");
  return [...res.values()].sort(
    (a, b) => !caseDe(a) - !caseDe(b) || comparerTexteFr(caseDe(a), caseDe(b)) || comparerTexteFr(a.mat, b.mat) || b.L * b.W - a.L * a.W
  );
}

// La page du rapport (null : pas de .bkp, ou aucune chute de stratifié dans ce lancement).
async function partieChutesStratReservees(p, base) {
  if (!p.bkp) return null;
  let liste;
  try {
    liste = await chutesStratReserveesLancement(p.bkp);
  } catch (_e) {
    return null;
  }
  if (!liste.length) return null;
  const mmFr = (v) => String(Math.round(v * 10) / 10).replace(".", ","); // sans séparateur de milliers (absent de la police du PDF)
  const partie = partieRapport("Chutes réservées", `${base} — Chutes de stratifié réservées (${liste.length})`,
    ["Case", "Couleur", "Désignation", "Longueur", "Largeur", "Qté"], [21, 26, 77, 23, 22, 13], 3);
  partie.total = false;
  for (const c of liste)
    partie.rangees.push([
      c.cases ? c.cases.map(([e, q]) => (q > 1 ? `${e} (${q})` : e)).join(", ") : "?",
      c.mat,
      c.desc || "",
      mmFr(c.L),
      mmFr(c.W),
      String(c.qte),
    ]);
  const sansCase = liste.filter((c) => !c.cases).length;
  if (sansCase) [partie.statut, partie.couleurStatut] = [`${sansCase} chute${sansCase > 1 ? "s" : ""} sans case connue (ni dans la sauvegarde Cut Rite, ni dans le fichier de stock).`, STATUT.ATTENTION];
  partie.notes.push(["Chutes : ", "celles que Cut Rite utilise dans les plans de ce lancement (réservées pour lui dans woodStore, statut 2). Stratifié seulement."]);
  partie.notes.push(["Cases : ", "relevées par woodStore dans la sauvegarde Cut Rite du lancement (au moment de l'optimisation)."]);
  return partie;
}

// ---------- Tri par les en-têtes de colonnes ----------

const comparerTexteFr = (a, b) => String(a || "").localeCompare(String(b || ""), "fr", { numeric: true, sensitivity: "base" });
const premierEmplacement = (f) => (f.emplacements[0] || [""])[0];
const TRIS_STOCK = {
  liste: {
    mat: (m) => m.mat,
    desc: (m) => m.desc,
    entiers: (m) => m.nbEntiers,
    chutes: (m) => m.nbChutes,
    limite: (m) => (m.limites.size === 1 ? [...m.limites][0] : m.limites.size ? 4.5 : -1),
  },
  entiers: { format: (f) => f.L * f.W, qte: (f) => f.dispo, emplacement: premierEmplacement, limite: (f) => f.limite, fil: (f) => (f.fil ? 1 : 0) },
  chutes: { taille: (f) => f.L * f.W, qte: (f) => f.qte, emplacement: premierEmplacement, origine: (f) => f.origine.texte, age: (f) => (f.origine.quand ? Date.now() - f.origine.quand : -1) },
};
const COLONNES_TEXTE_STOCK = new Set(["mat", "desc", "emplacement", "origine"]); // premier clic : A → Z ; nombres : du plus grand au plus petit

function trierStock(liste, quoi) {
  const t = stock.tri[quoi];
  const cle = TRIS_STOCK[quoi][t.col];
  if (!cle) return liste;
  return [...liste].sort((a, b) => {
    const x = cle(a);
    const y = cle(b);
    return (typeof x === "number" && typeof y === "number" ? x - y : comparerTexteFr(x, y)) * t.sens;
  });
}

function enteteTri(quoi, col, libelle, classe = "") {
  const t = stock.tri[quoi];
  const actif = t.col === col;
  const sens = actif ? (t.sens > 0 ? "ascending" : "descending") : "none";
  return `<th class="stk-tri${classe ? ` ${classe}` : ""}${actif ? " actif" : ""}" data-stk-tri="${quoi}:${col}" aria-sort="${sens}" title="Trier par cette colonne">${libelle}<span class="stk-fleche" aria-hidden="true">${actif ? (t.sens > 0 ? "▲" : "▼") : "↕"}</span></th>`;
}

// ---------- Écran ----------

const nbFr = (v) => Number(v || 0).toLocaleString("fr-FR");
const jourFr = (t) => (t ? new Date(t).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
// Une chute d'un lancement d'une semaine pas encore commencée (semaine de livraison) : 0 jour, pas « −4 j ».
const joursDepuis = (t) => (t ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : null);
const dureeFr = (j) => (j === null ? "" : j < 31 ? `${j} j` : j < 365 ? `${Math.round(j / 30)} mois` : `${(j / 365).toFixed(1).replace(".", ",")} an${j >= 730 ? "s" : ""}`);
const formatFr = (f) => `${nbFr(f.L)} × ${nbFr(f.W)}${f.ep ? ` × ${String(f.ep).replace(".", ",")}` : ""}`;
const puceEmplacements = (f) =>
  f.emplacements
    .map(([e, q]) =>
      !f.chute && CASES_RESERVATION.has(e)
        ? `<span class="stk-emp stk-emp-res" title="Case ${echapper(e)} : panneaux réservés pour un lancement">${echapper(e)} · ${q} réservé${q > 1 ? "s" : ""}</span>`
        : `<span class="stk-emp">${echapper(e)} · ${q}</span>`
    )
    .join(" ") || '<span class="pale">—</span>';
const puceLimite = (l) =>
  l === 9
    ? '<span class="stk-lim l9" title="Code woodStore 9 : dépassement autorisé">9<span class="stk-long"> · dépassement autorisé</span></span>'
    : '<span class="stk-lim l0" title="Code woodStore 0 : limité au stock">0<span class="stk-long"> · limité au stock</span></span>';

function afficherStock() {
  lireStockMemoire();
  const page = $("pageStock");
  const d = stock.donnees;
  const actions = `<button type="button" id="btnChargerStock">${d ? "Charger un fichier plus récent…" : "Charger le fichier de stock…"}</button>
    <input type="file" id="fichierStock" accept=".bdx,.csv,.txt" hidden>`;
  let html = entetePage("Outils", "Stock des panneaux", "Le stock de woodStore, extrait dans le fichier brdlib.bdx : panneaux entiers, chutes et emplacements. Lecture seule.", actions);
  if (stock.erreur) html += `<div class="message-alerte">Fichier illisible : ${echapper(stock.erreur)}</div>`;
  if (!d) {
    html += `<div class="carte"><div class="carte-titre">Aucun fichier de stock</div>
      <p>Extrayez le fichier <strong>brdlib.bdx</strong> (bibliothèque de panneaux de Cut Rite, tenue à jour par woodStore) et chargez-le ici. Sentinelle garde le dernier fichier chargé.</p></div>`;
    page.innerHTML = html;
    brancherStock();
    return;
  }
  html += htmlFichierStock(d) + htmlRechercheStock(d);
  if (stock.ouvert) {
    const m = d.materiaux.find((x) => x.mat === stock.ouvert);
    if (m) html += htmlMateriauStock(m);
  }
  html += htmlChutesQuiDorment(d);
  page.innerHTML = html;
  brancherStock();
}

function htmlFichierStock(d) {
  const age = joursDepuis(d.donneesJusquau || d.modifie);
  const entiers = d.materiaux.reduce((t, m) => t + m.nbEntiers, 0);
  const entiersReserves = d.materiaux.reduce((t, m) => t + (m.nbEntiersReserves || 0), 0);
  const chutes = d.materiaux.reduce((t, m) => t + m.nbChutes, 0);
  const reservees = d.materiaux.reduce((t, m) => t + m.nbReservees, 0);
  const vides = d.formats.filter((f) => !f.chute && f.dispo === 0).length;
  const vieux = age !== null && age > STOCK_VIEUX_JOURS;
  return `<div class="carte"><div class="carte-titre">Fichier de stock</div>
    ${vieux ? `<div class="bandeau attention">⚠ Ce stock date d'il y a <strong>${dureeFr(age)}</strong> : extrayez un fichier neuf avant de vous y fier.</div>` : ""}
    <div class="stk-fichier"><span><strong>${echapper(d.nom || "brdlib.bdx")}</strong></span>
      <span>données jusqu'au <strong>${jourFr(d.donneesJusquau || d.modifie)}</strong></span>
      <span class="pale">chargé le ${jourFr(d.charge)}</span></div>
    <div class="pl-puces" style="margin-top:10px">
      <span class="pl-puce">${nbFr(d.materiaux.length)} matériaux</span>
      <span class="pl-puce bon">${nbFr(entiers)} panneaux entiers (stock réel)</span>
      ${entiersReserves ? `<span class="pl-puce stk-res-puce">${nbFr(entiersReserves)} panneaux réservés</span>` : ""}
      <span class="pl-puce">${nbFr(chutes)} chutes disponibles (stock réel)</span>
      ${reservees ? `<span class="pl-puce stk-res-puce">${nbFr(reservees)} chutes réservées</span>` : ""}
      <span class="pl-puce att">${nbFr(vides)} formats à zéro</span>
    </div>
    <div class="note"><strong>Stock réel = stock − réservé.</strong> Chutes : celles au statut 2 de woodStore sont comptées comme réservées, à part. Panneaux entiers : ceux de la case 302 sont réservés pour un lancement, comptés à part.</div></div>`;
}

function materiauxFiltres(d) {
  const q = stock.recherche.trim().toUpperCase();
  const liste = d.materiaux
    .filter((m) => stock.famille === "tous" || m.famille === stock.famille)
    // Le code tapé en entier s'affiche toujours, même à zéro et la case « avec du stock seulement » cochée.
    .filter((m) => !stock.avecStock || m.nbEntiers + m.nbEntiersReserves + m.nbChutes + m.nbReservees > 0 || (q && m.mat.toUpperCase() === q))
    .filter((m) => !q || m.mat.toUpperCase().includes(q) || m.desc.toUpperCase().includes(q))
    .sort((a, b) => comparerTexteFr(a.mat, b.mat));
  const res = trierStock(liste, "liste");
  const exact = q ? res.findIndex((m) => m.mat.toUpperCase() === q) : -1;
  if (exact > 0) res.unshift(res.splice(exact, 1)[0]); // le code tapé exactement en tête
  return res;
}

function htmlRechercheStock(d) {
  // Tous les matériaux (aucune limite) : la liste défile.
  const liste = materiauxFiltres(d);
  const lignes = liste
    .map((m) => {
      const lim = m.limites.size === 1 ? puceLimite([...m.limites][0]) : m.limites.size ? '<span class="stk-lim">0 et 9</span>' : "";
      return `<tr class="stk-ligne${stock.ouvert === m.mat ? " visee" : ""}" data-stk-mat="${echapper(m.mat)}">
        <td><strong>${echapper(m.mat)}</strong><div class="stk-desc-m">${echapper(m.desc)}</div></td><td class="stk-col-desc">${echapper(m.desc)}</td>
        <td class="d">${m.nbEntiers ? nbFr(m.nbEntiers) : '<span class="pale">0</span>'}${m.nbEntiersReserves ? `<div class="stk-res-mini">+${m.nbEntiersReserves} rés.</div>` : ""}</td>
        <td class="d">${m.nbChutes ? nbFr(m.nbChutes) : '<span class="pale">0</span>'}${m.nbReservees ? `<div class="stk-res-mini">+${m.nbReservees} rés.</div>` : ""}</td><td>${lim}</td></tr>`;
    })
    .join("");
  const filtres = FAMILLES_STOCK.map(([c, n]) => `<button type="button" class="stk-filtre${stock.famille === c ? " actif" : ""}" data-stk-famille="${c}">${n}</button>`).join("");
  return `<div class="carte"><div class="carte-titre">Chercher une couleur</div>
    <div class="stk-cherche"><input type="search" id="champStock" placeholder="Code ou nom : 1114, chêne, SAG38…" value="${echapper(stock.recherche)}" autocomplete="off">
      <label class="stk-case"><input type="checkbox" id="caseAvecStock" ${stock.avecStock ? "checked" : ""}> avec du stock seulement</label></div>
    <div class="stk-filtres">${filtres}</div>
    <div class="defilement"><table class="fp-table"><thead><tr>${enteteTri("liste", "mat", "Matériau")}${enteteTri("liste", "desc", "Description", "stk-col-desc")}${enteteTri("liste", "entiers", '<span class="stk-long">Panneaux entiers</span><span class="stk-court">Entiers</span>', "d")}${enteteTri("liste", "chutes", "Chutes", "d")}${enteteTri("liste", "limite", '<span class="stk-long">Limite woodStore</span><span class="stk-court">Limite</span>')}</tr></thead>
      <tbody>${lignes || '<tr><td colspan="5" class="pale">Rien ne correspond.</td></tr>'}</tbody></table></div>
    <div class="note">${nbFr(liste.length)} matériau${liste.length > 1 ? "x" : ""}, tous affichés · cliquez sur une ligne pour le détail.</div></div>`;
}

function htmlMateriauStock(m) {
  const entiers = trierStock(m.entiers, "entiers")
    .map(
      (f) => `<tr><td>${formatFr(f)}</td><td class="d">${f.dispo ? `<strong>${nbFr(f.dispo)}</strong>` : '<span class="pale">0</span>'}${f.reserve ? `<div class="stk-res-mini">+${f.reserve} rés.</div>` : ""}</td>
      <td>${puceEmplacements(f)}</td><td>${puceLimite(f.limite)}</td><td class="c">${f.fil ? "oui" : '<span class="pale">non</span>'}</td></tr>`
    )
    .join("");
  // Les disponibles d'abord, puis les réservées ; chaque groupe dans l'ordre choisi.
  const chutes = [...trierStock(m.chutes.filter((f) => !f.reservee), "chutes"), ...trierStock(m.chutes.filter((f) => f.reservee), "chutes")]
    .map((f) => {
      const j = joursDepuis(f.origine.quand);
      const dort = j !== null && j > CHUTE_DORT_JOURS;
      return `<tr${f.reservee ? ' class="stk-res"' : ""}><td>${formatFr(f)}${f.reservee ? ' <span class="stk-res-badge" title="Statut 2 dans woodStore">réservée</span>' : ""}</td><td class="d">${f.qte > 1 ? nbFr(f.qte) : "1"}</td><td>${puceEmplacements(f)}</td>
        <td>${echapper(f.origine.texte)}</td><td>${j === null ? '<span class="pale">—</span>' : dort ? `<span class="stk-dort">dort depuis ${dureeFr(j)}</span>` : dureeFr(j)}</td></tr>`;
    })
    .join("");
  return `<div class="carte stk-detail"><div class="carte-titre">${echapper(m.mat)} — ${echapper(m.desc || "sans description")}
      <button type="button" class="texte" id="btnFermerStock" style="float:right">Fermer</button></div>
    <div class="pl-puces"><span class="pl-puce bon">${nbFr(m.nbEntiers)} panneau${m.nbEntiers > 1 ? "x" : ""} entier${m.nbEntiers > 1 ? "s" : ""} disponible${m.nbEntiers > 1 ? "s" : ""}</span>
      ${m.nbEntiersReserves ? `<span class="pl-puce stk-res-puce">${nbFr(m.nbEntiersReserves)} panneau${m.nbEntiersReserves > 1 ? "x" : ""} réservé${m.nbEntiersReserves > 1 ? "s" : ""} (case 302)</span>` : ""}
      <span class="pl-puce">${nbFr(m.nbChutes)} chute${m.nbChutes > 1 ? "s" : ""} disponible${m.nbChutes > 1 ? "s" : ""}</span>
      ${m.nbReservees ? `<span class="pl-puce stk-res-puce">${nbFr(m.nbReservees)} réservée${m.nbReservees > 1 ? "s" : ""}</span>` : ""}
      ${m.ep ? `<span class="pl-puce">épaisseur ${String(m.ep).replace(".", ",")} mm</span>` : ""}</div>
    <h3 class="stk-sous-titre">Panneaux entiers</h3>
    <div class="defilement"><table class="fp-table"><thead><tr>${enteteTri("entiers", "format", "Format (mm)")}${enteteTri("entiers", "qte", "Disponibles", "d")}${enteteTri("entiers", "emplacement", "Emplacements")}${enteteTri("entiers", "limite", "Limite woodStore")}${enteteTri("entiers", "fil", "Fil", "c")}</tr></thead>
      <tbody>${entiers || '<tr><td colspan="5" class="pale">Aucun format de panneau entier.</td></tr>'}</tbody></table></div>
    <h3 class="stk-sous-titre">Chutes en stock</h3>
    <div class="defilement"><table class="fp-table"><thead><tr>${enteteTri("chutes", "taille", "Dimensions (mm)")}${enteteTri("chutes", "qte", "Qté", "d")}${enteteTri("chutes", "emplacement", "Emplacement")}${enteteTri("chutes", "origine", "Origine")}${enteteTri("chutes", "age", "Âge")}</tr></thead>
      <tbody>${chutes || '<tr><td colspan="5" class="pale">Aucune chute en stock.</td></tr>'}</tbody></table></div>
    <div class="note">Panneaux entiers disponibles = en stock − réservés (case 302). Limite woodStore : <strong>0</strong> = Cut Rite ne peut pas utiliser plus que le stock ; <strong>9</strong> = il peut le dépasser (panneau à recommander).</div></div>`;
}

function htmlChutesQuiDorment(d) {
  const vieilles = [];
  for (const m of d.materiaux)
    for (const f of m.chutes) {
      const j = joursDepuis(f.origine.quand);
      if (!f.reservee && j !== null && j > CHUTE_DORT_JOURS) vieilles.push({ m, f, j });
    }
  if (!vieilles.length) return "";
  const parMat = new Map();
  for (const v of vieilles) parMat.set(v.m.mat, (parMat.get(v.m.mat) || 0) + v.f.qte);
  // Toutes (aucune limite) : par matériau, puis chaque chute, la plus vieille d'abord.
  const top = [...parMat.entries()].sort((a, b) => b[1] - a[1]);
  const plusVieilles = vieilles.sort((a, b) => b.j - a.j);
  return `<div class="carte"><div class="carte-titre">Chutes qui dorment</div>
    <p><strong>${nbFr(vieilles.reduce((t, v) => t + v.f.qte, 0))}</strong> chutes sont en stock depuis plus de 4 mois.</p>
    <div class="pl-puces">${top.map(([mat, n]) => `<button type="button" class="pl-puce stk-puce-mat" data-stk-mat="${echapper(mat)}">${echapper(mat)} · ${n}</button>`).join("")}</div>
    <div class="defilement" style="margin-top:8px"><table class="fp-table"><thead><tr><th>Matériau</th><th>Dimensions (mm)</th><th>Emplacement</th><th>Origine</th><th>Âge</th></tr></thead>
      <tbody>${plusVieilles
        .map((v) => `<tr><td><strong>${echapper(v.m.mat)}</strong></td><td>${formatFr(v.f)}</td><td>${puceEmplacements(v.f)}</td><td>${echapper(v.f.origine.texte)}</td><td><span class="stk-dort">${dureeFr(v.j)}</span></td></tr>`)
        .join("")}</tbody></table></div></div>`;
}

function brancherStock() {
  const page = $("pageStock");
  const bouton = $("btnChargerStock");
  const champFichier = $("fichierStock");
  if (bouton && champFichier) {
    bouton.addEventListener("click", () => champFichier.click());
    champFichier.addEventListener("change", () => {
      if (champFichier.files[0]) chargerFichierStock(champFichier.files[0]);
    });
  }
  const champ = $("champStock");
  if (champ) {
    champ.addEventListener("input", () => {
      stock.recherche = champ.value;
      const pos = champ.selectionStart;
      afficherStock();
      const c = $("champStock");
      c.focus();
      c.setSelectionRange(pos, pos);
    });
  }
  const caseStock = $("caseAvecStock");
  if (caseStock)
    caseStock.addEventListener("change", () => {
      stock.avecStock = caseStock.checked;
      afficherStock();
    });
  page.querySelectorAll("[data-stk-famille]").forEach((b) =>
    b.addEventListener("click", () => {
      stock.famille = b.dataset.stkFamille;
      afficherStock();
    })
  );
  page.querySelectorAll("[data-stk-mat]").forEach((el) =>
    el.addEventListener("click", () => {
      stock.ouvert = stock.ouvert === el.dataset.stkMat ? null : el.dataset.stkMat;
      afficherStock();
      const det = page.querySelector(".stk-detail");
      if (det) det.scrollIntoView({ behavior: "smooth", block: "start" });
    })
  );
  page.querySelectorAll("[data-stk-tri]").forEach((th) =>
    th.addEventListener("click", () => {
      const [quoi, col] = th.dataset.stkTri.split(":");
      const t = stock.tri[quoi];
      if (t.col === col) t.sens = -t.sens;
      else {
        t.col = col;
        t.sens = COLONNES_TEXTE_STOCK.has(col) ? 1 : -1;
      }
      afficherStock();
    })
  );
  const fermer = $("btnFermerStock");
  if (fermer)
    fermer.addEventListener("click", () => {
      stock.ouvert = null;
      afficherStock();
    });
}
