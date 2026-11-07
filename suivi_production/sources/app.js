"use strict";
// ---- Suivi de production (maquette) ----
// Lit l'extraction « Suivi production » de Diakonos (.xlsx), sur ce PC : rien n'est envoyé nulle part.
// Tout est recalculé à chaque nouveau fichier. L'outil garde un résumé des extractions (navigateur) pour montrer
// ce qui est sorti (terminé / expédié) et ce qui est arrivé depuis la fois d'avant.

// ---------- Lecture d'un .xlsx sans bibliothèque (zip + XML) ----------

async function lireZip(octets) {
  const dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  let fin = -1;
  for (let i = octets.length - 22; i >= Math.max(0, octets.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error("ce n'est pas un fichier Excel (.xlsx)");
  const nb = dv.getUint16(fin + 10, true);
  let p = dv.getUint32(fin + 16, true);
  const entrees = new Map();
  const dec = new TextDecoder();
  for (let k = 0; k < nb && dv.getUint32(p, true) === 0x02014b50; k++) {
    const lNom = dv.getUint16(p + 28, true);
    entrees.set(dec.decode(octets.subarray(p + 46, p + 46 + lNom)), {
      methode: dv.getUint16(p + 10, true),
      taille: dv.getUint32(p + 20, true),
      local: dv.getUint32(p + 42, true),
    });
    p += 46 + lNom + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return {
    noms: [...entrees.keys()],
    async texte(nom) {
      const e = entrees.get(nom);
      const debut = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
      let donnees = octets.subarray(debut, debut + e.taille);
      if (e.methode === 8) donnees = new Uint8Array(await new Response(new Blob([donnees]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      else if (e.methode !== 0) throw new Error("fichier Excel compressé d'une façon inconnue");
      return new TextDecoder("utf-8").decode(donnees).replace(/^﻿/, "");
    },
  };
}

const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const tous = (n, local) => [...n.getElementsByTagNameNS("*", local)];
const indexColonne = (ref) => {
  let n = 0;
  for (const c of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
};
const lettreColonne = (i) => {
  let s = "";
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};

// Toutes les feuilles du classeur : [{ nom, lignes }] (valeurs brutes : texte, nombre ou vide).
async function lireClasseur(fichier) {
  if (/\.xls$/i.test(fichier.name)) throw new Error("ancien format Excel (.xls) : ouvrez-le dans Excel et enregistrez-le en .xlsx");
  const zip = await lireZip(new Uint8Array(await fichier.arrayBuffer()));
  const trouver = (nom) => zip.noms.find((n) => n.toLowerCase() === nom.toLowerCase());
  const xml = async (nom) => {
    const n = nom && trouver(nom.replace(/^\//, ""));
    return n ? new DOMParser().parseFromString(await zip.texte(n), "application/xml") : null;
  };
  const wb = await xml("xl/workbook.xml");
  if (!wb) throw new Error("classeur illisible (pas de « xl/workbook.xml »)");
  const rels = await xml("xl/_rels/workbook.xml.rels");
  const ss = await xml("xl/sharedStrings.xml");
  const chaines = ss ? tous(ss, "si").map((si) => tous(si, "t").filter((t) => t.parentNode.localName !== "rPh").map((t) => t.textContent).join("")) : [];
  const feuilles = [];
  const declarees = tous(wb, "sheet");
  for (let k = 0; k < Math.max(1, declarees.length); k++) {
    const f = declarees[k];
    const rid = f && (f.getAttributeNS(NS_REL, "id") || f.getAttribute("r:id"));
    const rel = rels && tous(rels, "Relationship").find((r) => r.getAttribute("Id") === rid);
    const cible = rel ? rel.getAttribute("Target") : `worksheets/sheet${k + 1}.xml`;
    const doc = await xml(cible.startsWith("/") ? cible : `xl/${cible}`);
    if (doc) feuilles.push({ nom: f ? f.getAttribute("name") : `Feuille ${k + 1}`, lignes: lireFeuille(doc, chaines) });
  }
  if (!feuilles.length) throw new Error("aucune feuille lisible dans le classeur");
  return feuilles;
}

function lireFeuille(doc, chaines) {
  const lignes = [];
  for (const row of tous(doc, "row")) {
    const vals = [];
    let col = 0;
    for (const c of tous(row, "c")) {
      const ref = c.getAttribute("r");
      if (ref) col = indexColonne(ref);
      const t = c.getAttribute("t");
      const v = tous(c, "v")[0];
      let val = null;
      if (t === "s") val = v ? chaines[Number(v.textContent)] ?? "" : "";
      else if (t === "inlineStr") val = tous(c, "t").map((x) => x.textContent).join("");
      else if (t === "str" || t === "e") val = v ? v.textContent : "";
      else if (t === "b") val = v ? v.textContent === "1" : null;
      else if (v) {
        const n = Number(v.textContent);
        val = Number.isFinite(n) ? n : v.textContent;
      }
      vals[col++] = val;
    }
    const r = Number(row.getAttribute("r"));
    lignes[r > 0 ? r - 1 : lignes.length] = vals;
  }
  return lignes.filter(Boolean);
}

// Semaine écrite de toutes les façons : 47, « 47 », « S47 », « 2026-47 », « 47/2026 », une date (Excel ou jj/mm/aaaa).
// Renvoie { semaine, annee (ou null) }, ou null si la case est vide ou à 0 (pas encore planifiée).
function lireSemaine(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    if (v >= 1 && v <= 53 && Number.isInteger(v)) return { semaine: v, annee: null };
    if (v > 20000 && v < 80000) return semaineIso(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000 + 43200000));
    return null;
  }
  const t = String(v).trim().toUpperCase();
  let m;
  if ((m = /^S?\s*0*(\d{1,2})(?:[.,]0+)?$/.exec(t))) return Number(m[1]) >= 1 && Number(m[1]) <= 53 ? { semaine: Number(m[1]), annee: null } : null;
  if ((m = /^(20\d{2})\s*[-/ ]\s*S?\s*(\d{1,2})$/.exec(t))) return { semaine: Number(m[2]), annee: Number(m[1]) };
  if ((m = /^S?\s*(\d{1,2})\s*[-/ ]\s*(20\d{2})$/.exec(t))) return { semaine: Number(m[1]), annee: Number(m[2]) };
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t))) {
    const a = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return semaineIso(new Date(a, Number(m[2]) - 1, Number(m[1])));
  }
  if ((m = /^(20\d{2})-(\d{2})-(\d{2})/.exec(t))) return semaineIso(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return null;
}

// ---------- Semaines ----------

function semaineIso(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const jour = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - jour);
  const debut = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { annee: d.getUTCFullYear(), semaine: Math.ceil(((d - debut) / 86400000 + 1) / 7) };
}
function lundiIso(annee, semaine) {
  const j4 = new Date(Date.UTC(annee, 0, 4));
  const lundi1 = new Date(j4);
  lundi1.setUTCDate(j4.getUTCDate() - ((j4.getUTCDay() || 7) - 1));
  lundi1.setUTCDate(lundi1.getUTCDate() + (semaine - 1) * 7);
  return lundi1;
}
const ecartSemaines = (a, b) => Math.round((lundiIso(b.annee, b.semaine) - lundiIso(a.annee, a.semaine)) / (7 * 86400000));

// L'année d'une semaine : celle de la commande (« CVC26090100 » : 2026, septembre), l'année suivante si la semaine
// tombe avant la commande. Sans numéro lisible : la semaine la plus proche de l'extraction.
function anneeDeLaSemaine(semaine, commande, courante) {
  const m = /^[A-Z]*(\d{2})(\d{2})\d/.exec(commande || "");
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    const an = 2000 + Number(m[1]);
    const semCommande = Math.round((Number(m[2]) - 1) * 4.345) + 1;
    return semaine + 3 < semCommande ? an + 1 : an;
  }
  const d = semaine - courante.semaine;
  return d > 26 ? courante.annee - 1 : d < -26 ? courante.annee + 1 : courante.annee;
}

// Date de l'extraction : dans le nom (« suivi_production_07112026.xlsx »), sinon la date du fichier.
function dateExtraction(fichier) {
  const m = /(\d{2})(\d{2})(20\d{2})/.exec(fichier.name);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (d.getDate() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1) return d;
  }
  return new Date(fichier.lastModified || Date.now());
}

// ---------- Analyse de l'extraction ----------

const sansAccents = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const COLONNES = {
  semaine: ["semaine"], commande: ["commande"], ligne: ["ligne"], catalogue: ["catalogue"], article: ["article"],
  designation: ["designation"], qteLanc: ["qtelancement"], qteCours: ["qteencours"], L: ["longueur"], W: ["largeur"],
  E: ["epaisseur"], codeColoris: ["codecoloris"], coloris: ["coloris"], cp: ["cp", "codepostal"], ville: ["ville"],
  codeTransp: ["codeptransporteur", "codetransporteur"], transporteur: ["transporteur"], lancement: ["lancement"], groupement: ["groupement"],
};
const OBLIGATOIRES = { semaine: "Semaine", commande: "Commande", transporteur: "Transporteur" };

function analyser(feuilles, fichier, dateReference) {
  const date = dateReference || dateExtraction(fichier);
  const courante = semaineIso(date);
  const txt = (v) => (v === null || v === undefined ? "" : String(v).trim());
  const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".")) || 0);
  const lignes = [];
  const lues = [];
  let nbLignesFichier = 0;
  let manquantes = null;
  let sansTitreLettres = [];
  for (const feuille of feuilles) {
    const lignesBrutes = feuille.lignes;
    const iEntete = lignesBrutes.findIndex((l) => l && l.some((v) => sansAccents(v) === "semaine") && l.some((v) => sansAccents(v) === "commande"));
    if (iEntete < 0) continue; // feuille sans le tableau « Suivi production »
    const entete = lignesBrutes[iEntete];
    const idx = {};
    entete.forEach((v, i) => {
      const n = sansAccents(v);
      for (const [cle, noms] of Object.entries(COLONNES)) if (idx[cle] === undefined && noms.includes(n)) idx[cle] = i;
    });
    // Les lignes du tableau : toutes celles qui ont au moins une valeur (aucune n'est écartée).
    const corps = lignesBrutes.slice(iEntete + 1).filter((l) => l && l.some((v) => v !== null && v !== undefined && String(v).trim() !== ""));
    nbLignesFichier += corps.length;
    // Colonnes sans titre qui ont des valeurs (ex. colonne T : 0, 1 ou 2 par commande) : gardées telles quelles.
    const sansTitre = [];
    const largeur = Math.max(entete.length, ...corps.map((l) => l.length));
    for (let i = 0; i < largeur; i++) if ((entete[i] === null || entete[i] === undefined || entete[i] === "") && corps.some((l) => l[i] !== null && l[i] !== undefined && l[i] !== "")) sansTitre.push(i);
    if (!lues.length) sansTitreLettres = sansTitre.map(lettreColonne);
    const absentes = Object.keys(COLONNES).filter((c) => idx[c] === undefined);
    manquantes = manquantes === null ? absentes : manquantes.filter((c) => absentes.includes(c));
    lues.push({ nom: feuille.nom, lignes: corps.length });
    for (const l of corps) {
      const get = (cle) => (idx[cle] === undefined ? null : l[idx[cle]]);
      const sem = lireSemaine(get("semaine"));
      const commande = txt(get("commande")) || "(sans commande)";
      const annee = sem ? sem.annee || anneeDeLaSemaine(sem.semaine, commande, courante) : null;
      const r = {
        semaine: sem ? sem.semaine : null, annee, semaineBrute: txt(get("semaine")), commande, ligne: txt(get("ligne")), catalogue: txt(get("catalogue")) || "(sans catalogue)", article: txt(get("article")),
        designation: txt(get("designation")), qteLanc: num(get("qteLanc")), qteCours: num(get("qteCours")), L: num(get("L")), W: num(get("W")), E: num(get("E")),
        codeColoris: txt(get("codeColoris")), coloris: txt(get("coloris")), cp: txt(get("cp")), ville: txt(get("ville")), codeTransp: txt(get("codeTransp")),
        transporteur: txt(get("transporteur")) || txt(get("codeTransp")) || "(sans transporteur)", lancement: txt(get("lancement")), groupement: txt(get("groupement")) || "AUCUN",
        autres: sansTitre.map((i) => txt(l[i])), feuille: feuille.nom, fichier: fichier.name,
      };
      // Sans semaine (vide, 0, illisible) : la ligne est gardée, dans la colonne « Sans semaine ».
      r.retard = sem ? ecartSemaines({ annee, semaine: sem.semaine }, courante) : 0; // > 0 : semaine dépassée
      r.cleSemaine = !sem ? "sans" : r.retard > 0 ? "retard" : `${annee}-${String(sem.semaine).padStart(2, "0")}`;
      r.departement = /^\d{5}$/.test(r.cp) ? (r.cp.startsWith("20") ? "2A/2B" : r.cp.slice(0, 2)) : /^\d{4}$/.test(r.cp) ? `0${r.cp[0]}` : r.cp ? "Étranger / autre" : "(sans CP)";
      // Périmètre : la production de l'atelier (Stratifié, Crédences, Compact, Portes…), les fournitures & Dibond
      // (suivies à part), la résine (Méganite, quantités en m²).
      r.perimetre = /r[ée]sine/i.test(r.catalogue) ? "resine" : /fourniture|dibond/i.test(r.catalogue) ? "fournitures" : "production";
      r.unite = r.perimetre === "resine" ? "m2" : "piece";
      r.cle = "";
      lignes.push(r);
    }
  }
  if (!lues.length) throw new Error("colonnes « Semaine » et « Commande » introuvables : est-ce bien l'extraction « Suivi production » de Diakonos ?");
  // Chaque ligne du fichier compte, comme dans Excel (les sommes de « Qte Lancement » et « Qte en cours » sont celles
  // d'Excel). Une même ligne de commande lancée plusieurs fois (n° de lancement 1, 2…) est signalée « relancée ».
  const parBase = new Map();
  for (const r of lignes) {
    const base = `${r.commande}|${r.ligne}`;
    if (!parBase.has(base)) parBase.set(base, []);
    parBase.get(base).push(r);
  }
  const vues = new Map();
  for (const r of lignes) {
    const freres = parBase.get(`${r.commande}|${r.ligne}`);
    r.lancements = [...new Set(freres.map((x) => x.lancement).filter(Boolean))].sort((x, y) => Number(x) - Number(y));
    r.repetitions = freres.length;
    const cle = `${r.commande}|${r.ligne}|${r.lancement}`;
    const n = (vues.get(cle) || 0) + 1;
    vues.set(cle, n);
    r.cle = n > 1 ? `${cle}#${n}` : cle;
  }
  const totaux = (liste) => ({ lignes: liste.length, commandes: new Set(liste.map((r) => r.commande)).size, lanc: liste.reduce((t, r) => t + r.qteLanc, 0), cours: liste.reduce((t, r) => t + r.qteCours, 0) });
  return {
    fichier: fichier.name, taille: fichier.size, date, courante, lignes, nbLignesFichier, feuilles: lues,
    relancees: [...parBase.values()].filter((l) => l.length > 1).length,
    totaux: Object.fromEntries(["production", "fournitures", "resine"].map((k) => [k, totaux(lignes.filter((r) => r.perimetre === k))]).concat([["tout", totaux(lignes)]])),
    sansSemaine: lignes.filter((r) => r.cleSemaine === "sans").length,
    sansTitre: sansTitreLettres, colonnesManquantes: manquantes || [],
  };
}

// ---------- Mesures et regroupements ----------

const MESURES = {
  commandes: { nom: "Commandes", court: "commande(s)", f: (g) => g.commandes.size },
  lignes: { nom: "Lignes", court: "ligne(s)", f: (g) => g.lignes },
  lanc: { nom: "Qté lancement", court: "qté lancement", f: (g) => g.lanc },
  cours: { nom: "Qté en cours", court: "qté en cours", f: (g) => g.cours },
};
const nouveauGroupe = () => ({ lignes: 0, commandes: new Set(), lanc: 0, cours: 0 });
function ajouter(g, r) {
  g.lignes++;
  g.commandes.add(r.commande);
  g.lanc += r.qteLanc;
  g.cours += r.qteCours;
}
const fmt = (v, dec = 0) => Number(v).toLocaleString("fr-FR", { maximumFractionDigits: dec, minimumFractionDigits: 0 });
const fmtMesure = (m, v) => fmt(v, 2);
const PERIMETRES = {
  production: "Production (Stratifié, Crédences, Compact, Portes…)",
  fournitures: "Fournitures & Dibond",
  resine: "Résine (m²)",
  tout: "Tout le fichier",
};

const VUES = {
  transporteur: { nom: "Transporteur", cle: (r) => r.transporteur },
  catalogue: { nom: "Catalogue", cle: (r) => r.catalogue },
  groupement: { nom: "Groupement (client)", cle: (r) => r.groupement },
  coloris: { nom: "Coloris", cle: (r) => (r.coloris ? `${r.coloris}${r.codeColoris ? ` (${r.codeColoris})` : ""}` : "(sans coloris)") },
  departement: { nom: "Département", cle: (r) => r.departement },
};

// Couleur fixe par catalogue (la couleur suit le catalogue, jamais son rang). Palette vérifiée (daltonisme).
const COULEURS_CATALOGUE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const ORDRE_CATALOGUES = ["Crédences", "Stratifié", "Compact", "Résine", "Fournitures & DIBOND", "Portes"];
const GRIS_AUTRES = "#a3a29d";

// ---------- État de l'écran ----------

const etat = {
  analyse: null,
  vue: "transporteur",
  mesure: "cours",
  perimetre: "production",
  filtres: { semaine: "", transporteur: "", catalogue: "", groupement: "", coloris: "", departement: "", texte: "" },
  limiteDetail: 2000,
  evolution: null,
  sources: [], // fichiers chargés ensemble : { fichier, feuilles }
  catalogues: [],
};

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function libelleSemaine(cle) {
  if (cle === "retard") return "En retard";
  if (cle === "sans") return "Sans semaine (vide ou à 0)";
  const [a, s] = cle.split("-").map(Number);
  const c = etat.analyse.courante;
  const ecart = ecartSemaines(c, { annee: a, semaine: s });
  return `S${s}${a !== c.annee ? ` ${a}` : ""}${ecart === 0 ? " (en cours)" : ""}`;
}
const libelleCourt = (cle) => (cle === "retard" ? "Retard" : cle === "sans" ? "Sans sem." : `S${Number(cle.split("-")[1])}`);

function lignesFiltrees() {
  const f = etat.filtres;
  const t = sansAccents(f.texte);
  return etat.analyse.lignes.filter(
    (r) =>
      (etat.perimetre === "tout" || r.perimetre === etat.perimetre) &&
      (!f.semaine || r.cleSemaine === f.semaine) &&
      (!f.transporteur || r.transporteur === f.transporteur) &&
      (!f.catalogue || r.catalogue === f.catalogue) &&
      (!f.groupement || r.groupement === f.groupement) &&
      (!f.coloris || VUES.coloris.cle(r) === f.coloris) &&
      (!f.departement || r.departement === f.departement) &&
      (!t || sansAccents(`${r.commande} ${r.ville} ${r.cp} ${r.article} ${r.designation} ${r.coloris} ${r.codeColoris}`).includes(t))
  );
}

// Les colonnes « semaine » : retard d'abord, puis chaque semaine à venir (toutes celles du fichier).
function colonnesSemaines(lignes) {
  const cles = new Set(lignes.map((r) => r.cleSemaine));
  return [...(cles.has("retard") ? ["retard"] : []), ...[...cles].filter((c) => c !== "retard" && c !== "sans").sort(), ...(cles.has("sans") ? ["sans"] : [])];
}

// ---------- Affichage ----------

function afficher() {
  const a = etat.analyse;
  $("vide").hidden = Boolean(a);
  $("tableauBord").hidden = !a;
  if (!a) return;
  const d = a.date.toLocaleDateString("fr-FR");
  $("source").innerHTML = `Extraction Diakonos du <strong>${esc(d)}</strong> · semaine en cours <strong>S${a.courante.semaine}</strong>
    <div class="fichiers">${a.fichiers
      .map((f, i) => `<span class="fichier">${esc(f.nom)} · ${fmt(f.lignes)} ligne(s)${f.doublons ? ` <span class="pale">(${fmt(f.doublons)} déjà dans un autre fichier)</span>` : ""}${a.fichiers.length > 1 ? ` <button type="button" class="texte" data-enlever="${i}" title="Enlever ce fichier du tableau">✕</button>` : ""}</span>`)
      .join("")}<button type="button" class="contour petit" data-ajouter>+ Ajouter un fichier Diakonos</button></div>`;
  $("source").querySelectorAll("[data-enlever]").forEach((b) => b.addEventListener("click", () => {
    etat.sources.splice(Number(b.dataset.enlever), 1);
    recalculer("enlever");
  }));
  $("source").querySelector("[data-ajouter]").addEventListener("click", () => ouvrirChoix(true));
  afficherFiltres();
  const lignes = lignesFiltrees();
  afficherIndicateurs(lignes);
  afficherGraphique(lignes);
  afficherTableau(lignes);
  afficherCommandes(lignes);
  afficherRetards(lignes);
  afficherDetail(lignes);
  afficherEvolution();
  afficherControle();
}

function options(valeurs, choisie, tout) {
  return `<option value="">${esc(tout)}</option>${valeurs.map(([v, lib]) => `<option value="${esc(v)}" ${v === choisie ? "selected" : ""}>${esc(lib)}</option>`).join("")}`;
}

function afficherFiltres() {
  const a = etat.analyse;
  const f = etat.filtres;
  const compte = (cle) => {
    const m = new Map();
    for (const r of a.lignes) m.set(cle(r), (m.get(cle(r)) || 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0])));
  };
  $("filtrePerimetre").innerHTML = Object.entries(PERIMETRES)
    .map(([k, lib]) => `<option value="${k}" ${k === etat.perimetre ? "selected" : ""}>${esc(lib)} — ${fmt(a.totaux[k].lignes)} ligne(s)</option>`)
    .join("");
  $("filtreSemaine").innerHTML = options(colonnesSemaines(a.lignes).map((c) => [c, libelleSemaine(c)]), f.semaine, "Toutes les semaines");
  $("filtreTransporteur").innerHTML = options(compte((r) => r.transporteur).map(([v, n]) => [v, `${v} (${n})`]), f.transporteur, "Tous les transporteurs");
  $("filtreCatalogue").innerHTML = options(compte((r) => r.catalogue).map(([v, n]) => [v, `${v} (${n})`]), f.catalogue, "Tous les catalogues");
  $("filtreGroupement").innerHTML = options(compte((r) => r.groupement).map(([v, n]) => [v, `${v} (${n})`]), f.groupement, "Tous les groupements");
  if ($("filtreTexte").value !== f.texte) $("filtreTexte").value = f.texte;
  const puces = [];
  if (f.coloris) puces.push(["coloris", `Coloris : ${f.coloris}`]);
  if (f.departement) puces.push(["departement", `Département : ${f.departement}`]);
  $("pucesFiltres").innerHTML = puces.map(([k, t]) => `<button type="button" class="puce-filtre" data-retirer="${k}" title="Retirer ce filtre">${esc(t)} ✕</button>`).join("");
  const actifs = Object.values(f).some(Boolean);
  $("btnEffacer").hidden = !actifs;
  const n = lignesFiltrees().length;
  $("bandeFiltre").hidden = !actifs;
  $("bandeFiltre").innerHTML = actifs ? `Filtre actif : <strong>${fmt(n)}</strong> ligne(s) affichée(s) sur ${fmt(a.lignes.length)}. <button type="button" class="texte" data-tout>Tout afficher</button>` : "";
  const tout = $("bandeFiltre").querySelector("[data-tout]");
  if (tout) tout.addEventListener("click", () => filtrer({ semaine: "", transporteur: "", catalogue: "", groupement: "", coloris: "", departement: "", texte: "" }));
}

function afficherIndicateurs(lignes) {
  const a = etat.analyse;
  const m2 = etat.perimetre === "resine" ? " m²" : "";
  const tout = nouveauGroupe();
  const retard = nouveauGroupe();
  const sansSem = nouveauGroupe();
  const parSem = new Map();
  for (const r of lignes) {
    ajouter(tout, r);
    if (r.retard > 0) ajouter(retard, r);
    else if (r.cleSemaine === "sans") ajouter(sansSem, r);
    else {
      if (!parSem.has(r.retard)) parSem.set(r.retard, nouveauGroupe());
      ajouter(parSem.get(r.retard), r);
    }
  }
  const qte = (g) => `lancement ${fmt(g.lanc, 2)}${m2} · en cours ${fmt(g.cours, 2)}${m2}`;
  const semaine = (ecart) => {
    const g = parSem.get(-ecart) || nouveauGroupe();
    const ws = semaineIso(new Date(lundiIso(a.courante.annee, a.courante.semaine).getTime() + ecart * 7 * 86400000 + 3 * 86400000));
    return `<div class="tuile"><div class="tuile-titre">S${ws.semaine} · ${ecart === 0 ? "cette semaine" : ecart === 1 ? "semaine prochaine" : `dans ${ecart} semaines`}</div>
      <div class="tuile-valeur">${fmt(g.cours, 2)}</div><div class="tuile-sous">qté en cours${m2} · ${fmt(g.commandes.size)} commande(s) · ${fmt(g.lignes)} ligne(s)</div></div>`;
  };
  const hors = ["production", "fournitures", "resine"].filter((k) => k !== etat.perimetre && a.totaux[k].lignes);
  $("indicateurs").innerHTML = `
    <div class="tuile principale"><div class="tuile-titre">${esc(PERIMETRES[etat.perimetre])}</div>
      <div class="tuile-valeur">${fmt(tout.cours, 2)}<span class="unite">${m2 || " "}en cours</span></div>
      <div class="tuile-sous">Qté lancement ${fmt(tout.lanc, 2)}${m2} · ${fmt(tout.commandes.size)} commande(s) · ${fmt(tout.lignes)} ligne(s)</div></div>
    <div class="tuile ${retard.lignes ? "alerte" : "bon"}"><div class="tuile-titre">${retard.lignes ? "⚠ Semaine passée" : "✔ Aucune semaine passée"}</div>
      <div class="tuile-valeur">${fmt(retard.cours, 2)}</div><div class="tuile-sous">${retard.lignes ? `qté en cours${m2} · ${fmt(retard.commandes.size)} commande(s) · ${fmt(retard.lignes)} ligne(s)` : "toutes les semaines sont à venir"}</div></div>
    ${semaine(0)}${semaine(1)}${semaine(2)}
    ${sansSem.lignes ? `<div class="tuile attention"><div class="tuile-titre">⚠ Sans semaine</div><div class="tuile-valeur">${fmt(sansSem.cours, 2)}</div><div class="tuile-sous">qté en cours · ${fmt(sansSem.lignes)} ligne(s) · semaine vide ou à 0</div></div>` : ""}
    ${hors.length ? `<div class="tuile hors"><div class="tuile-titre">Pas compté ici</div>${hors
      .map((k) => `<button type="button" class="lien" data-perimetre="${k}">${esc(PERIMETRES[k])}</button><div class="tuile-sous">${fmt(a.totaux[k].lignes)} ligne(s) · ${qte(a.totaux[k])}${k === "resine" ? " m²" : ""}</div>`)
      .join("")}</div>` : ""}`;
  $("indicateurs").querySelectorAll("[data-perimetre]").forEach((b) => b.addEventListener("click", () => changerPerimetre(b.dataset.perimetre)));
}

function changerPerimetre(k) {
  etat.perimetre = k;
  etat.filtres.catalogue = "";
  etat.limiteDetail = 2000;
  afficher();
}

// ---------- Graphique : charge par semaine, par catalogue ----------

function couleurCatalogue(c) {
  const i = etat.catalogues.indexOf(c);
  return i >= 0 && i < COULEURS_CATALOGUE.length ? COULEURS_CATALOGUE[i] : GRIS_AUTRES;
}

function afficherGraphique(lignes) {
  const m = etat.mesure === "commandes" ? "lignes" : etat.mesure;
  const cols = colonnesSemaines(lignes);
  const zone = $("graphique");
  $("titreGraphique").textContent = `Charge par semaine — ${MESURES[m].nom.toLowerCase()}, par catalogue`;
  if (!cols.length) {
    zone.innerHTML = '<div class="note">Aucune ligne avec ces filtres.</div>';
    $("legendeGraphique").innerHTML = "";
    return;
  }
  const cats = etat.catalogues.filter((c) => lignes.some((r) => r.catalogue === c));
  const autres = [...new Set(lignes.map((r) => r.catalogue))].filter((c) => !etat.catalogues.slice(0, COULEURS_CATALOGUE.length).includes(c));
  const series = [...cats.filter((c) => etat.catalogues.indexOf(c) < COULEURS_CATALOGUE.length), ...(autres.length ? ["Autres"] : [])];
  const serieDe = (r) => (autres.includes(r.catalogue) ? "Autres" : r.catalogue);
  const groupes = new Map(cols.map((c) => [c, new Map(series.map((s) => [s, nouveauGroupe()]))]));
  for (const r of lignes) ajouter(groupes.get(r.cleSemaine).get(serieDe(r)), r);
  const totaux = cols.map((c) => series.reduce((t, s) => t + MESURES[m].f(groupes.get(c).get(s)), 0));
  const max = Math.max(...totaux, 1);
  const pas = echelle(max);
  const haut = Math.ceil(max / pas) * pas;
  const W = Math.max(560, zone.clientWidth || 900);
  const H = 300;
  const g = { gauche: 52, droite: 12, haut: 22, bas: 40 };
  const lp = W - g.gauche - g.droite;
  const hp = H - g.haut - g.bas;
  const bande = lp / cols.length;
  const lb = Math.min(64, bande * 0.62);
  const y = (v) => g.haut + hp - (v / haut) * hp;
  const s = [`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Charge par semaine et par catalogue">`];
  for (let v = 0; v <= haut + 1e-9; v += pas) {
    s.push(`<line x1="${g.gauche}" x2="${W - g.droite}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? "axe" : "grille"}"/>`);
    s.push(`<text x="${g.gauche - 8}" y="${y(v) + 4}" class="graduation" text-anchor="end">${fmtMesure(m, v)}</text>`);
  }
  cols.forEach((c, i) => {
    const x = g.gauche + bande * i + (bande - lb) / 2;
    let cumul = 0;
    const visibles = series.filter((se) => MESURES[m].f(groupes.get(c).get(se)) > 0);
    visibles.forEach((se, k) => {
      const v = MESURES[m].f(groupes.get(c).get(se));
      const y1 = y(cumul + v);
      const y0 = y(cumul);
      const h = Math.max(0, y0 - y1 - (k > 0 ? 2 : 0)); // 2 px d'écart entre les segments
      cumul += v;
      if (h <= 0) return;
      const coul = se === "Autres" ? GRIS_AUTRES : couleurCatalogue(se);
      const dernier = k === visibles.length - 1;
      const rr = dernier ? Math.min(4, h, lb / 2) : 0;
      const d = `M${x},${y1 + h} L${x},${y1 + rr} Q${x},${y1} ${x + rr},${y1} L${x + lb - rr},${y1} Q${x + lb},${y1} ${x + lb},${y1 + rr} L${x + lb},${y1 + h} Z`;
      s.push(`<path d="${d}" fill="${coul}" class="segment" tabindex="0" data-col="${esc(c)}" data-serie="${esc(se)}" data-valeur="${v}"/>`);
    });
    s.push(`<text x="${x + lb / 2}" y="${y(totaux[i]) - 6}" class="total" text-anchor="middle">${fmtMesure(m, totaux[i])}</text>`);
    s.push(`<text x="${x + lb / 2}" y="${H - g.bas + 18}" class="etiquette${c === "retard" ? " retard" : ""}" text-anchor="middle">${c === "retard" ? "⚠ Retard" : esc(libelleCourt(c))}</text>`);
    s.push(`<rect x="${g.gauche + bande * i}" y="${g.haut}" width="${bande}" height="${hp}" class="cible" data-col="${esc(c)}"/>`);
  });
  s.push("</svg>");
  zone.innerHTML = s.join("");
  $("legendeGraphique").innerHTML = series.map((se) => `<span><i style="background:${se === "Autres" ? GRIS_AUTRES : couleurCatalogue(se)}"></i>${esc(se)}</span>`).join("");
  // Survol : la colonne entière (toutes les séries) ; un clic filtre sur la semaine.
  const bulle = $("bulle");
  const montrer = (e, c) => {
    const gr = groupes.get(c);
    bulle.replaceChildren();
    const titre = document.createElement("div");
    titre.className = "bulle-titre";
    titre.textContent = `${libelleSemaine(c)} — ${fmtMesure(m, totaux[cols.indexOf(c)])} ${MESURES[m].court}`;
    bulle.appendChild(titre);
    for (const se of series) {
      const v = MESURES[m].f(gr.get(se));
      if (!v) continue;
      const l = document.createElement("div");
      l.className = "bulle-ligne";
      const trait = document.createElement("span");
      trait.className = "bulle-trait";
      trait.style.background = se === "Autres" ? GRIS_AUTRES : couleurCatalogue(se);
      const val = document.createElement("strong");
      val.textContent = fmtMesure(m, v);
      const nom = document.createElement("span");
      nom.textContent = se;
      l.append(trait, val, nom);
      bulle.appendChild(l);
    }
    placerBulle(e);
  };
  zone.querySelectorAll("[data-col]").forEach((el) => {
    el.addEventListener("pointermove", (e) => montrer(e, el.dataset.col));
    el.addEventListener("focus", (e) => montrer(e, el.dataset.col));
    el.addEventListener("pointerleave", () => (bulle.hidden = true));
    el.addEventListener("blur", () => (bulle.hidden = true));
    el.addEventListener("click", () => filtrer({ semaine: etat.filtres.semaine === el.dataset.col ? "" : el.dataset.col }));
  });
}

function echelle(max) {
  const brut = max / 5;
  const p = 10 ** Math.floor(Math.log10(brut));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= brut) || p * 10;
}

function placerBulle(e) {
  const b = $("bulle");
  b.hidden = false;
  const r = e.target.getBoundingClientRect();
  const px = e.clientX || r.left + r.width / 2;
  const py = e.clientY || r.top;
  const l = b.offsetWidth;
  b.style.left = `${Math.min(window.innerWidth - l - 12, Math.max(8, px + 14))}px`;
  b.style.top = `${Math.max(8, py - b.offsetHeight - 10) + window.scrollY}px`;
}

// ---------- Tableau de contrôle (transporteur / catalogue / … × semaine) ----------

const RAMPE = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"]; // une seule teinte, clair → foncé

function afficherTableau(lignes) {
  const m = etat.mesure;
  const vue = VUES[etat.vue];
  document.querySelectorAll("[data-vue]").forEach((b) => b.classList.toggle("actif", b.dataset.vue === etat.vue));
  document.querySelectorAll("[data-mesure]").forEach((b) => b.classList.toggle("actif", b.dataset.mesure === m));
  const cols = colonnesSemaines(lignes);
  const rangs = new Map();
  const totCol = new Map(cols.map((c) => [c, nouveauGroupe()]));
  const total = nouveauGroupe();
  for (const r of lignes) {
    const k = vue.cle(r);
    if (!rangs.has(k)) rangs.set(k, { tot: nouveauGroupe(), cols: new Map(cols.map((c) => [c, nouveauGroupe()])) });
    const x = rangs.get(k);
    ajouter(x.tot, r);
    ajouter(x.cols.get(r.cleSemaine), r);
    ajouter(totCol.get(r.cleSemaine), r);
    ajouter(total, r);
  }
  const liste = [...rangs.entries()].sort((a, b) => MESURES[m].f(b[1].tot) - MESURES[m].f(a[1].tot) || String(a[0]).localeCompare(String(b[0])));
  let max = 0;
  for (const [, x] of liste) for (const c of cols) if (c !== "retard") max = Math.max(max, MESURES[m].f(x.cols.get(c)));
  const cellule = (k, c, g) => {
    const v = MESURES[m].f(g);
    if (!v) return `<td class="vide" data-k="${esc(k)}" data-c="${esc(c)}"></td>`;
    if (c === "retard") return `<td class="cel retard" tabindex="0" data-k="${esc(k)}" data-c="${esc(c)}">${fmtMesure(m, v)}</td>`;
    const n = Math.min(RAMPE.length - 1, Math.floor((v / (max || 1)) * RAMPE.length - 1e-9));
    return `<td class="cel" tabindex="0" style="background:${RAMPE[n]};color:${n >= 3 ? "#fff" : "#0b0b0b"}" data-k="${esc(k)}" data-c="${esc(c)}">${fmtMesure(m, v)}</td>`;
  };
  const filtreVue = etat.filtres[etat.vue];
  $("tableauControle").innerHTML = `<table class="controle">
    <thead><tr><th class="g">${esc(vue.nom)}</th>${cols.map((c) => `<th class="${c === "retard" ? "retard" : ""}" title="${esc(libelleSemaine(c))}">${c === "retard" ? "⚠ En retard" : esc(libelleCourt(c))}</th>`).join("")}<th>Total</th></tr></thead>
    <tbody>${liste
      .map(([k, x]) => `<tr class="${filtreVue === k ? "choisi" : ""}"><th class="g"><button type="button" class="lien" data-rang="${esc(k)}" title="Filtrer sur ${esc(k)}">${esc(k)}</button></th>${cols.map((c) => cellule(k, c, x.cols.get(c))).join("")}<td class="tot">${fmtMesure(m, MESURES[m].f(x.tot))}</td></tr>`)
      .join("")}</tbody>
    <tfoot><tr><th class="g">Total</th>${cols.map((c) => `<td class="tot${c === "retard" ? " retard-tot" : ""}">${fmtMesure(m, MESURES[m].f(totCol.get(c)))}</td>`).join("")}<td class="tot">${fmtMesure(m, MESURES[m].f(total))}</td></tr></tfoot>
  </table>`;
  $("noteTableau").textContent = `${liste.length} ${vue.nom.toLowerCase()}(s) · ${MESURES[m].nom.toLowerCase()} · plus le bleu est foncé, plus il y a de charge · un clic sur une case montre ses commandes juste en dessous.`;
  const bulle = $("bulle");
  $("tableauControle").querySelectorAll("td.cel").forEach((td) => {
    const montrer = (e) => {
      const x = rangs.get(td.dataset.k).cols.get(td.dataset.c);
      bulle.replaceChildren();
      const t = document.createElement("div");
      t.className = "bulle-titre";
      t.textContent = `${td.dataset.k} · ${libelleSemaine(td.dataset.c)}`;
      bulle.appendChild(t);
      for (const [cle, mm] of Object.entries(MESURES)) {
        const l = document.createElement("div");
        l.className = "bulle-ligne";
        const v = document.createElement("strong");
        v.textContent = fmtMesure(cle, mm.f(x));
        const n = document.createElement("span");
        n.textContent = mm.court;
        l.append(v, n);
        bulle.appendChild(l);
      }
      placerBulle(e);
    };
    td.addEventListener("pointermove", montrer);
    td.addEventListener("focus", montrer);
    td.addEventListener("pointerleave", () => (bulle.hidden = true));
    td.addEventListener("blur", () => (bulle.hidden = true));
    td.addEventListener("click", () => {
      filtrer({ [etat.vue]: td.dataset.k, semaine: td.dataset.c });
      $("carteCommandes").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  $("tableauControle").querySelectorAll("[data-rang]").forEach((b) => b.addEventListener("click", () => filtrer({ [etat.vue]: etat.filtres[etat.vue] === b.dataset.rang ? "" : b.dataset.rang })));
}

// ---------- Les commandes (de la case cliquée, ou toutes) ----------

function afficherCommandes(lignes) {
  const parCommande = new Map();
  for (const r of lignes) {
    if (!parCommande.has(r.commande)) parCommande.set(r.commande, { r, lignes: 0, lanc: 0, cours: 0, catalogues: new Set(), semaines: new Set(), retard: 0, relancees: 0 });
    const x = parCommande.get(r.commande);
    x.lignes++;
    x.lanc += r.qteLanc;
    x.cours += r.qteCours;
    x.catalogues.add(r.catalogue);
    x.semaines.add(r.semaine ? `S${r.semaine}` : "sans sem.");
    x.retard = Math.max(x.retard, r.retard);
    if (r.repetitions > 1) x.relancees++;
  }
  const ordre = (x) => (x.retard > 0 ? -1e6 - x.retard : (x.r.annee || 9999) * 100 + (x.r.semaine || 99));
  const liste = [...parCommande.values()].sort((a, b) => ordre(a) - ordre(b) || a.r.transporteur.localeCompare(b.r.transporteur) || a.r.commande.localeCompare(b.r.commande));
  const f = etat.filtres;
  const quoi = [f.transporteur, f.catalogue, f.groupement, f.coloris, f.departement && `département ${f.departement}`, f.semaine && libelleSemaine(f.semaine), f.texte && `« ${f.texte} »`].filter(Boolean).join(" · ");
  $("titreCommandes").textContent = `Commandes${quoi ? ` — ${quoi}` : ""} (${fmt(liste.length)})`;
  const tot = liste.reduce((t, x) => ({ lignes: t.lignes + x.lignes, lanc: t.lanc + x.lanc, cours: t.cours + x.cours }), { lignes: 0, lanc: 0, cours: 0 });
  $("commandes").innerHTML = liste.length
    ? `<div class="defile"><table class="liste"><thead><tr><th>Commande</th><th>Semaine</th><th>Transporteur</th><th>Groupement</th><th>Livraison</th><th>Catalogue(s)</th><th class="d">Lignes</th><th class="d">Qté lancement</th><th class="d">Qté en cours</th></tr></thead><tbody>${liste
        .slice(0, 400)
        .map((x) => `<tr class="${x.retard > 0 ? "en-retard" : ""}"><td><button type="button" class="lien" data-commande="${esc(x.r.commande)}">${esc(x.r.commande)}</button></td>
          <td>${esc([...x.semaines].join(", "))}${x.retard > 0 ? ` <span class="badge-retard">passée de ${x.retard} sem.</span>` : ""}</td><td>${esc(x.r.transporteur)}</td><td>${esc(x.r.groupement)}</td><td>${esc(x.r.cp)} ${esc(x.r.ville)}</td>
          <td>${esc([...x.catalogues].join(", "))}</td><td class="d">${x.lignes}</td><td class="d">${fmt(x.lanc, 2)}</td><td class="d">${fmt(x.cours, 2)}</td></tr>`)
        .join("")}</tbody><tfoot><tr><th colspan="6">Total</th><td class="d"><strong>${fmt(tot.lignes)}</strong></td><td class="d"><strong>${fmt(tot.lanc, 2)}</strong></td><td class="d"><strong>${fmt(tot.cours, 2)}</strong></td></tr></tfoot></table></div>
      ${liste.length > 400 ? '<div class="note">Les 400 premières affichées : filtrez (transporteur, semaine…) pour voir les autres.</div>' : ""}`
    : '<div class="note">Aucune commande avec ces filtres.</div>';
  $("commandes").querySelectorAll("[data-commande]").forEach((b) => b.addEventListener("click", () => {
    filtrer({ texte: b.dataset.commande });
    $("carteDetail").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

// ---------- Contrôle : ce que l'outil a lu, à comparer avec Excel ----------

function afficherControle() {
  const a = etat.analyse;
  $("controle").innerHTML = `<div class="defile"><table class="liste"><thead><tr><th>Périmètre</th><th class="d">Lignes</th><th class="d">Commandes</th><th class="d">Somme « Qte Lancement »</th><th class="d">Somme « Qte en cours »</th></tr></thead><tbody>
    ${Object.entries(PERIMETRES)
      .map(([k, lib]) => `<tr class="${k === etat.perimetre ? "total-controle" : ""}"><td>${esc(lib)}</td><td class="d">${fmt(a.totaux[k].lignes)}</td><td class="d">${fmt(a.totaux[k].commandes)}</td><td class="d">${fmt(a.totaux[k].lanc, 2)}</td><td class="d">${fmt(a.totaux[k].cours, 2)}</td></tr>`)
      .join("")}
    </tbody></table></div>
    <div class="note">Mêmes chiffres que dans Excel : nombre de lignes et SOMME des colonnes « Qte Lancement » et « Qte en cours », par catalogue (Production = Stratifié, Crédences, Compact, Portes et les autres catalogues de l'atelier). ${a.relancees ? `${fmt(a.relancees)} ligne(s) de commande apparaissent plusieurs fois (n° de lancement 1, 2…) : marquées « relancée » dans le détail.` : ""} ${a.fichiers.length > 1 ? `Fichiers : ${a.fichiers.map((f) => `${esc(f.nom)} (${fmt(f.lignesFichier)} lignes${f.doublons ? `, ${fmt(f.doublons)} déjà dans un autre fichier` : ""})`).join(" · ")}.` : ""}</div>`;
}

// ---------- Retards ----------

function afficherRetards(lignes) {
  const parCommande = new Map();
  for (const r of lignes) {
    if (r.retard <= 0) continue;
    if (!parCommande.has(r.commande)) parCommande.set(r.commande, { r, lignes: 0, cours: 0, catalogues: new Set(), retard: 0 });
    const x = parCommande.get(r.commande);
    x.lignes++;
    x.cours += r.qteCours;
    x.catalogues.add(r.catalogue);
    x.retard = Math.max(x.retard, r.retard);
  }
  const liste = [...parCommande.values()].sort((a, b) => b.retard - a.retard || a.r.commande.localeCompare(b.r.commande));
  $("titreRetards").textContent = liste.length ? `⚠ Commandes en retard (${liste.length})` : "✔ Aucune commande en retard";
  $("carteRetards").classList.toggle("bon", !liste.length);
  $("retards").innerHTML = liste.length
    ? `<div class="defile"><table class="liste"><thead><tr><th>Commande</th><th>Semaine prévue</th><th class="d">Retard</th><th>Groupement</th><th>Livraison</th><th>Transporteur</th><th>Catalogue(s)</th><th class="d">Lignes</th><th class="d">Qté en cours</th></tr></thead><tbody>${liste
        .map((x) => `<tr><td><button type="button" class="lien" data-commande="${esc(x.r.commande)}">${esc(x.r.commande)}</button></td><td>S${x.r.semaine}${x.r.annee !== etat.analyse.courante.annee ? ` ${x.r.annee}` : ""}</td>
          <td class="d"><span class="badge-retard">${x.retard} sem.</span></td><td>${esc(x.r.groupement)}</td><td>${esc(x.r.cp)} ${esc(x.r.ville)}</td><td>${esc(x.r.transporteur)}</td><td>${esc([...x.catalogues].join(", "))}</td><td class="d">${x.lignes}</td><td class="d">${fmt(x.cours, 2)}${x.r.unite === "m2" ? " m²" : ""}</td></tr>`)
        .join("")}</tbody></table></div>`
    : '<div class="note">Toutes les lignes affichées sont prévues cette semaine ou plus tard.</div>';
  $("retards").querySelectorAll("[data-commande]").forEach((b) => b.addEventListener("click", () => {
    filtrer({ texte: b.dataset.commande, semaine: "" });
    $("carteDetail").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

// ---------- Détail des lignes ----------

function afficherDetail(lignes) {
  const rang = (r) => (r.retard > 0 ? 0 : r.cleSemaine === "sans" ? 2 : 1);
  const tri = [...lignes].sort((a, b) => rang(a) - rang(b) || (a.annee || 0) - (b.annee || 0) || (a.semaine || 0) - (b.semaine || 0) || a.transporteur.localeCompare(b.transporteur) || a.commande.localeCompare(b.commande) || Number(a.ligne) - Number(b.ligne));
  const n = Math.min(tri.length, etat.limiteDetail);
  const autres = etat.analyse.sansTitre;
  $("titreDetail").textContent = `Détail des lignes (${fmt(tri.length)})`;
  const dims = (r) => (r.L || r.W ? `${fmt(r.L)} × ${fmt(r.W)}${r.E ? ` × ${fmt(r.E)}` : ""}` : r.E ? `ép. ${fmt(r.E)}` : "");
  $("detail").innerHTML = `<div class="defile"><table class="liste detail"><thead><tr><th>Sem.</th><th>Commande</th><th class="d">Ligne</th><th>Catalogue</th><th>Article</th><th>Désignation</th><th class="d">Dimensions (mm)</th><th>Coloris</th><th class="d">Qté en cours / lancement</th><th>Livraison</th><th>Transporteur</th><th>Groupement</th><th class="d">Lanc.</th>${autres.map((l) => `<th class="d" title="Colonne ${l} du fichier, sans titre">Col. ${l}</th>`).join("")}</tr></thead>
    <tbody>${tri
      .slice(0, n)
      .map((r) => `<tr class="${r.retard > 0 ? "en-retard" : ""}"><td>${r.retard > 0 ? `<span class="badge-retard" title="Semaine dépassée de ${r.retard} semaine(s)">S${r.semaine}</span>` : r.semaine ? `S${r.semaine}` : `<span class="badge-sans" title="Semaine dans Diakonos : « ${esc(r.semaineBrute || "vide")} »">—</span>`}</td><td>${esc(r.commande)}</td><td class="d">${esc(r.ligne)}</td>
        <td><i class="pastille" style="background:${couleurCatalogue(r.catalogue)}"></i>${esc(r.catalogue)}</td><td>${esc(r.article)}</td><td class="desig">${esc(r.designation)}</td><td class="d">${dims(r)}</td>
        <td>${esc(r.coloris)}${r.codeColoris ? ` <span class="pale">${esc(r.codeColoris)}</span>` : ""}</td><td class="d">${fmt(r.qteCours, 2)}${r.unite === "m2" ? " m²" : ""}${r.qteLanc !== r.qteCours ? ` <span class="pale">/ ${fmt(r.qteLanc, 2)}</span>` : ""}</td>
        <td>${esc(r.cp)} ${esc(r.ville)}</td><td>${esc(r.transporteur)}</td><td>${esc(r.groupement)}</td><td class="d"${r.repetitions > 1 ? ` title="${r.repetitions} lignes dans le fichier (lancements ${esc(r.lancements.join(", "))}), comptée une fois"` : ""}>${esc(r.lancements.join(", ") || r.lancement)}${r.repetitions > 1 ? ' <span class="badge-relance">relancée</span>' : ""}</td>${r.autres.map((v) => `<td class="d">${esc(v)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table></div>
    ${n < tri.length ? `<button type="button" class="contour" id="btnSuite">Afficher la suite (${fmt(tri.length - n)} ligne(s))</button>` : ""}`;
  const suite = $("btnSuite");
  if (suite) suite.addEventListener("click", () => {
    etat.limiteDetail += 2000;
    afficherDetail(lignes);
  });
}

function exporterCsv() {
  const lignes = lignesFiltrees();
  const autres = etat.analyse.sansTitre;
  const ent = ["Semaine", "Année", "Retard (semaines)", "Commande", "Ligne", "Catalogue", "Article", "Désignation", "Qté lancement", "Qté en cours", "Unité", "Longueur", "Largeur", "Épaisseur", "Code coloris", "Coloris", "CP", "Ville", "Code transporteur", "Transporteur", "Lancement(s)", "Lignes dans le fichier", "Groupement", ...autres.map((l) => `Colonne ${l}`)];
  const cel = (v) => {
    const t = typeof v === "number" ? String(v).replace(".", ",") : String(v ?? "");
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const corps = lignes.map((r) => [r.semaine ?? r.semaineBrute, r.annee ?? "", Math.max(0, r.retard), r.commande, r.ligne, r.catalogue, r.article, r.designation, r.qteLanc, r.qteCours, r.unite === "m2" ? "m²" : "pièce", r.L, r.W, r.E, r.codeColoris, r.coloris, r.cp, r.ville, r.codeTransp, r.transporteur, r.lancements.join(" "), r.repetitions, r.groupement, ...r.autres].map(cel).join(";"));
  const texte = "﻿" + [ent.map(cel).join(";"), ...corps].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([texte], { type: "text/csv;charset=utf-8" }));
  a.download = `suivi_production_${etat.analyse.date.toISOString().slice(0, 10)}${Object.values(etat.filtres).some(Boolean) ? "_filtre" : ""}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

// ---------- Évolution entre deux extractions ----------

const CLE_HISTORIQUE = "suivi-production-historique-3"; // clé = commande + ligne + n° de lancement
function lireHistorique() {
  try {
    const h = JSON.parse(localStorage.getItem(CLE_HISTORIQUE) || "null");
    return h && Array.isArray(h.extractions) ? h : { extractions: [], instantanes: [] };
  } catch (_e) {
    return { extractions: [], instantanes: [] };
  }
}
function ecrireHistorique(h) {
  try {
    localStorage.setItem(CLE_HISTORIQUE, JSON.stringify(h));
  } catch (_e) {
    // sans stockage : pas d'historique, le reste marche
  }
}

// Garde l'extraction (résumé + ses lignes en bref) et la compare à la précédente (date différente).
function memoriserEtComparer(a) {
  const h = lireHistorique();
  const jour = a.date.toISOString().slice(0, 10);
  const resume = {
    jour, fichier: a.fichier, semaine: a.courante.semaine, annee: a.courante.annee, lignes: a.lignes.length,
    commandes: new Set(a.lignes.map((r) => r.commande)).size, retard: new Set(a.lignes.filter((r) => r.retard > 0).map((r) => r.commande)).size,
  };
  h.extractions = [...h.extractions.filter((x) => x.jour !== jour), resume].sort((x, y) => x.jour.localeCompare(y.jour)).slice(-30);
  const instantane = { jour, lignes: a.lignes.map((r) => [r.cle, r.commande, r.ligne, r.semaine, r.transporteur, r.catalogue, r.groupement]) };
  h.instantanes = [...(h.instantanes || []).filter((x) => x.jour !== jour), instantane].sort((x, y) => x.jour.localeCompare(y.jour)).slice(-2);
  ecrireHistorique(h);
  const avant = h.instantanes.filter((x) => x.jour < jour).pop();
  if (!avant) return { premier: true, historique: h.extractions };
  const actuelles = new Set(a.lignes.map((r) => r.cle));
  const anciennes = new Set(avant.lignes.map((x) => x[0]));
  return {
    jourAvant: avant.jour,
    sorties: avant.lignes.filter((x) => !actuelles.has(x[0])),
    nouvelles: a.lignes.filter((r) => !anciennes.has(r.cle)),
    historique: h.extractions,
  };
}

function afficherEvolution() {
  const e = etat.evolution;
  const z = $("evolution");
  if (!e) {
    z.innerHTML = "";
    return;
  }
  const jourFr = (j) => new Date(`${j}T12:00:00`).toLocaleDateString("fr-FR");
  const histo = `<div class="fp-h3">Extractions gardées</div><div class="defile"><table class="liste"><thead><tr><th>Extraction</th><th>Semaine</th><th class="d">Lignes</th><th class="d">Commandes</th><th class="d">Commandes semaine passée</th></tr></thead><tbody>${[...e.historique]
    .reverse()
    .map((x) => `<tr><td>${esc(jourFr(x.jour))}</td><td>S${x.semaine}</td><td class="d">${fmt(x.lignes)}</td><td class="d">${fmt(x.commandes)}</td><td class="d">${x.retard ? `<span class="badge-retard">${fmt(x.retard)}</span>` : "0"}</td></tr>`)
    .join("")}</tbody></table></div>`;
  if (e.premier) {
    z.innerHTML = `<div class="note">Première extraction gardée sur ce PC. Au prochain fichier extrait de Diakonos, l'outil montrera ici les lignes <strong>sorties</strong> (terminées ou expédiées) et les lignes <strong>nouvelles</strong> depuis aujourd'hui.</div>${histo}`;
    return;
  }
  const parCommande = (liste, cle) => {
    const m = new Map();
    for (const x of liste) {
      const k = cle(x);
      m.set(k.commande, { ...k, n: (m.has(k.commande) ? m.get(k.commande).n : 0) + 1 });
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.commande.localeCompare(b.commande));
  };
  const sorties = parCommande(e.sorties, (x) => ({ commande: x[1], semaine: x[3], transporteur: x[4] }));
  const nouvelles = parCommande(e.nouvelles, (r) => ({ commande: r.commande, semaine: r.semaine, transporteur: r.transporteur }));
  const liste = (items) => (items.length ? `<ul class="puces">${items.slice(0, 40).map((x) => `<li><strong>${esc(x.commande)}</strong> · S${x.semaine} · ${esc(x.transporteur)} · ${x.n} ligne(s)</li>`).join("")}${items.length > 40 ? `<li class="pale">… et ${items.length - 40} autre(s) commande(s)</li>` : ""}</ul>` : '<div class="note">Aucune.</div>');
  z.innerHTML = `<div class="note">Comparaison avec l'extraction du <strong>${esc(jourFr(e.jourAvant))}</strong> (une ligne = commande + n° de ligne + n° de lancement).</div>
    <div class="evo-grille">
      <div class="evo"><div class="evo-chiffre bon">✔ ${fmt(e.sorties.length)}</div><div class="evo-titre">ligne(s) sortie(s) — terminées ou expédiées</div>${liste(sorties)}</div>
      <div class="evo"><div class="evo-chiffre">+ ${fmt(e.nouvelles.length)}</div><div class="evo-titre">ligne(s) nouvelle(s) en production</div>${liste(nouvelles)}</div>
    </div>${histo}`;
}

// ---------- Chargement d'un fichier ----------

// Lit les fichiers choisis puis recalcule tout. ajouter : ils s'ajoutent à ceux déjà chargés (ex. l'extraction des
// fournitures en plus de celle de la production), sinon ils les remplacent.
async function chargerFichiers(fichiers, ajouter) {
  fichiers = [...(fichiers || [])].filter(Boolean);
  if (!fichiers.length) return;
  $("message").hidden = false;
  $("message").className = "message";
  $("message").textContent = `Lecture de ${fichiers.map((f) => f.name).join(", ")}…`;
  const lus = [];
  const erreurs = [];
  for (const f of fichiers) {
    try {
      lus.push({ fichier: f, feuilles: await lireClasseur(f) });
    } catch (e) {
      erreurs.push(`${f.name} : ${e && e.message ? e.message : e}`);
    }
  }
  if (!lus.length) {
    $("message").textContent = `⚠ Illisible — ${erreurs.join(" · ")}`;
    $("message").className = "message alerte";
    return;
  }
  const garder = ajouter ? etat.sources.filter((x) => !lus.some((l) => l.fichier.name === x.fichier.name)) : [];
  const avant = etat.sources;
  etat.sources = [...garder, ...lus];
  if (!recalculer(ajouter ? "ajouter" : "remplacer", erreurs)) etat.sources = avant;
}

// Analyse tous les fichiers chargés (même date de référence : la plus récente) et les fusionne. Une même ligne
// (commande + ligne + n° de lancement) présente dans deux fichiers n'est comptée qu'une fois : rien n'est perdu, rien
// n'est compté deux fois.
function recalculer(quoi, erreurs = []) {
  if (!etat.sources.length) {
    etat.analyse = null;
    afficher();
    return true;
  }
  try {
    const dateRef = new Date(Math.max(...etat.sources.map((x) => dateExtraction(x.fichier).getTime())));
    const analyses = etat.sources.map((x) => ({ x, a: analyser(x.feuilles, x.fichier, dateRef) }));
    const vues = new Set();
    const lignes = [];
    const fichiers = [];
    let doublons = 0;
    for (const { x, a } of analyses) {
      let d = 0;
      for (const r of a.lignes) {
        if (vues.has(r.cle)) {
          d++;
          continue;
        }
        vues.add(r.cle);
        lignes.push(r);
      }
      doublons += d;
      fichiers.push({ nom: x.fichier.name, lignes: a.lignes.length, lignesFichier: a.nbLignesFichier, doublons: d, feuilles: a.feuilles });
    }
    const a0 = analyses[0].a;
    const fusion = {
      fichier: fichiers.map((f) => f.nom).join(" + "), date: dateRef, courante: semaineIso(dateRef), lignes, fichiers, doublons,
      relancees: analyses.reduce((t, y) => t + y.a.relancees, 0),
      nbLignesFichier: fichiers.reduce((t, f) => t + f.lignesFichier, 0), sansSemaine: lignes.filter((r) => r.cleSemaine === "sans").length,
      sansTitre: a0.sansTitre, colonnesManquantes: analyses.map((y) => y.a.colonnesManquantes).reduce((acc, c) => acc.filter((k) => c.includes(k))),
    };
    if (!fusion.lignes.length) throw new Error("aucune ligne de production dans ce fichier");
    etat.analyse = fusion;
    etat.limiteDetail = 2000;
    etat.filtres = { semaine: "", transporteur: "", catalogue: "", groupement: "", coloris: "", departement: "", texte: "" };
    // Ordre des catalogues (couleurs fixes) : les connus d'abord, puis les autres par nombre de lignes.
    const compte = new Map();
    for (const r of fusion.lignes) compte.set(r.catalogue, (compte.get(r.catalogue) || 0) + 1);
    etat.catalogues = [...ORDRE_CATALOGUES.filter((c) => compte.has(c)), ...[...compte.keys()].filter((c) => !ORDRE_CATALOGUES.includes(c)).sort((x, y) => compte.get(y) - compte.get(x))];
    const tot = (liste) => ({ lignes: liste.length, commandes: new Set(liste.map((r) => r.commande)).size, lanc: liste.reduce((s2, r) => s2 + r.qteLanc, 0), cours: liste.reduce((s2, r) => s2 + r.qteCours, 0) });
    fusion.totaux = Object.fromEntries(["production", "fournitures", "resine"].map((k) => [k, tot(lignes.filter((r) => r.perimetre === k))]).concat([["tout", tot(lignes)]]));
    if (!fusion.totaux[etat.perimetre] || (!fusion.totaux[etat.perimetre].lignes && etat.perimetre !== "tout")) etat.perimetre = fusion.totaux.production.lignes ? "production" : "tout";
    etat.evolution = memoriserEtComparer(fusion);
    // Contrôle : toutes les lignes des fichiers sont prises en compte (à comparer avec Diakonos).
    const lues = fusion.nbLignesFichier;
    const t = fusion.totaux;
    const infos = [`${fmt(fusion.lignes.length)} ligne(s) lue(s)${fichiers.length > 1 ? ` dans ${fichiers.length} fichiers` : ""}`,
      `Production : ${fmt(t.production.lignes)} ligne(s), Qté lancement ${fmt(t.production.lanc, 2)}, Qté en cours ${fmt(t.production.cours, 2)}`];
    if (t.fournitures.lignes) infos.push(`Fournitures & Dibond : ${fmt(t.fournitures.lignes)} ligne(s) (à part)`);
    if (t.resine.lignes) infos.push(`Résine : ${fmt(t.resine.lignes)} ligne(s) (à part, en m²)`);
    if (doublons) infos.push(`${fmt(doublons)} ligne(s) présente(s) dans deux fichiers, comptée(s) une fois`);
    if (fusion.sansSemaine) infos.push(`${fmt(fusion.sansSemaine)} sans semaine (gardée(s), colonne « Sans sem. »)`);
    const feuilles = fichiers.flatMap((f) => f.feuilles);
    if (feuilles.length > fichiers.length) infos.push(`${feuilles.length} feuilles lues`);
    if (fusion.colonnesManquantes.length) infos.push(`colonnes absentes : ${fusion.colonnesManquantes.join(", ")}`);
    if (erreurs.length) infos.push(`⚠ illisible(s) : ${erreurs.join(" · ")}`);
    $("message").textContent = `✔ ${quoi === "ajouter" ? "Fichier ajouté. " : ""}${infos.join(" · ")}.`;
    $("message").className = `message ${erreurs.length ? "alerte" : "bon"}`;
    afficher();
    return true;
  } catch (e) {
    $("message").textContent = `⚠ ${etat.sources.map((x) => x.fichier.name).join(", ")} : ${e && e.message ? e.message : e}`;
    $("message").className = "message alerte";
    return false;
  }
}

let ajoutDemande = false;
function ouvrirChoix(ajouter) {
  ajoutDemande = ajouter;
  $("champFichier").click();
}

// Un fichier déposé alors qu'un tableau est déjà chargé : remplacer, ou ajouter (ex. les fournitures) ?
function demanderRemplacerOuAjouter(fichiers) {
  const m = $("message");
  m.hidden = false;
  m.className = "message question";
  m.innerHTML = `${esc(fichiers.map((f) => f.name).join(", "))} : <button type="button" data-choix="ajouter">Ajouter au tableau</button> <button type="button" class="contour" data-choix="remplacer">Remplacer ce qui est chargé</button>`;
  m.querySelectorAll("[data-choix]").forEach((b) => b.addEventListener("click", () => chargerFichiers(fichiers, b.dataset.choix === "ajouter")));
}

function filtrer(changements) {
  Object.assign(etat.filtres, changements);
  etat.limiteDetail = 2000;
  afficher();
}

function brancher() {
  const champ = $("champFichier");
  document.querySelectorAll("[data-ouvrir]").forEach((b) => b.addEventListener("click", () => ouvrirChoix(false)));
  champ.addEventListener("change", () => {
    chargerFichiers(champ.files, ajoutDemande);
    champ.value = "";
  });
  // Glisser-déposer le fichier n'importe où sur la page.
  let profondeur = 0;
  document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    profondeur++;
    document.body.classList.add("depot");
  });
  document.addEventListener("dragleave", () => {
    if (--profondeur <= 0) document.body.classList.remove("depot");
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    profondeur = 0;
    document.body.classList.remove("depot");
    const fichiers = [...(e.dataTransfer.files || [])];
    if (!fichiers.length) return;
    if (etat.analyse) demanderRemplacerOuAjouter(fichiers);
    else chargerFichiers(fichiers, false);
  });
  for (const [id, cle] of [["filtreSemaine", "semaine"], ["filtreTransporteur", "transporteur"], ["filtreCatalogue", "catalogue"], ["filtreGroupement", "groupement"]]) $(id).addEventListener("change", (e) => filtrer({ [cle]: e.target.value }));
  let minuteur = null;
  $("filtreTexte").addEventListener("input", (e) => {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => filtrer({ texte: e.target.value.trim() }), 200);
  });
  $("btnEffacer").addEventListener("click", () => filtrer({ semaine: "", transporteur: "", catalogue: "", groupement: "", coloris: "", departement: "", texte: "" }));
  $("pucesFiltres").addEventListener("click", (e) => {
    const b = e.target.closest("[data-retirer]");
    if (b) filtrer({ [b.dataset.retirer]: "" });
  });
  document.querySelectorAll("[data-vue]").forEach((b) => b.addEventListener("click", () => {
    etat.vue = b.dataset.vue;
    afficher();
  }));
  document.querySelectorAll("[data-mesure]").forEach((b) => b.addEventListener("click", () => {
    etat.mesure = b.dataset.mesure;
    afficher();
  }));
  $("btnExporter").addEventListener("click", exporterCsv);
  $("btnImprimer").addEventListener("click", () => window.print());
  let largeur = window.innerWidth;
  window.addEventListener("resize", () => {
    if (etat.analyse && Math.abs(window.innerWidth - largeur) > 40) {
      largeur = window.innerWidth;
      afficherGraphique(lignesFiltrees());
    }
  });
}

brancher();
afficher();
