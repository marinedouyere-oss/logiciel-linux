
// ============================================================
// Écran (même organisation que l'appli Android V3.4) : deux onglets
// semaine portant leur vrai numéro, et la Recherche. Chaque onglet semaine :
// compteur, tableau des lancements, dossier partagé, puis une case par
// poste (Agglo 1er tour, Feno, Casse, Agglo 2ème tour) et les chantiers.
// ============================================================

const $ = (id) => document.getElementById(id);
const PAR_PAGE = 60;
const ROLES = { strat: "Lancement", coupe: "Liste de coupe", bkp: "Fichier .bkp", sommaire: "Sommaire Cut Rite (.pdf)" };

function echapper(texte) {
  return String(texte ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtNombre(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "?";
  return String(v);
}

function pourcent(v) {
  return v.toFixed(1).replace(".", ",");
}

function slug(texte) {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

// Laisse le navigateur repeindre l'écran avant de continuer. Un message (et non requestAnimationFrame
// ou setTimeout) : il passe aussi quand l'onglet est caché, où les deux autres sont figés ou ralentis.
const canalTick = new MessageChannel();
const attentesTick = [];
canalTick.port1.onmessage = () => attentesTick.shift()();
function tick() {
  return new Promise((resolve) => {
    attentesTick.push(resolve);
    canalTick.port2.postMessage(null);
  });
}

// ---- Cases ----

let prochainId = 1;
let prochainNumeroChantier = 1;
const paires = [];
let onglet = "accueil";
// Onglet d'une semaine (et non Accueil, Recherche, Bibliothèque ou Réécriture).
const estOngletSemaine = (o = onglet) => o === "paire" || o === "impaire";

function nouvellePaire(poste, label, parite) {
  const p = {
    id: prochainId++,
    poste,
    label,
    parite,
    semaine: null,
    codeLancement: null,
    strat: null,
    coupe: null,
    bkp: null,
    sommaire: null,
    // Diakonos du lancement (« LAN264601STARTDIAKONOS.xlsx ») et dossier du lancement (« 1ER TOUR AGGLO »).
    diakonos: null,
    dossier: null,
    // Numéro du dossier « Semaine NN » d'où vient le lancement (scan) : la semaine d'une casse.
    semaineDossier: null,
    rapport: null,
    doublons: [],
    semainesLivraison: [],
    nbUnitaires: null,
    nbPiecesTrouvees: null,
    source: null,
    ecartsScies: null,
    totalScies: null,
    erreurScies: null,
    couleurs: null,
    etat: null,
    etatErreur: false,
    enCours: false,
  };
  paires.push(p);
  return p;
}

const estChantier = (p) => p.poste === POSTE_CHANTIERS;
// Case du fichier de contrôle Diakonos (son fichier est rangé à la place du lancement).
const estDiakonos = (p) => POSTES_DIAKONOS.includes(p.poste);

function titrePaire(p) {
  if (!estChantier(p)) return p.semaine ? `Semaine ${p.semaine}` : p.label;
  return p.semaine ? `${p.label} (sem ${p.semaine})` : p.label;
}

// Parité d'un numéro de semaine (« 45 » → impaire), null s'il n'y en a pas.
function pariteDuNumero(semaine) {
  const n = parseInt(semaine, 10);
  return Number.isNaN(n) ? null : n % 2 === 0 ? "paire" : "impaire";
}

// Un chantier va dans l'onglet de sa vraie semaine (celle du lancement écrite
// dans le fichier), même si le nom du fichier en dit une autre ; vrai s'il a
// changé d'onglet.
function ranger(p) {
  const parite = pariteDuNumero(p.semaine);
  if (!estChantier(p) || !parite || parite === p.parite) return false;
  p.parite = parite;
  return true;
}

const nomComplet = (p) => `${p.poste} — ${titrePaire(p)}`;
// Titre d'une case : le poste (la semaine est déjà sur l'onglet), ou le chantier.
const titreCase = (p) => (estChantier(p) ? titrePaire(p) : p.poste);

function paireFixe(poste, parite) {
  return paires.find((p) => p.poste === poste && p.parite === parite);
}

function semaineDeChantier(p) {
  if (p.codeLancement) {
    const s = parseInt(p.codeLancement.split("|")[0].slice(2, 4), 10);
    if (!Number.isNaN(s)) return s;
  }
  const s = parseInt(p.semaine, 10);
  return Number.isNaN(s) ? Infinity : s;
}

function chantiers(parite) {
  const numero = (label) => parseInt(String(label).replace(/\D/g, ""), 10) || 0;
  return paires
    .filter((p) => estChantier(p) && p.parite === parite)
    .sort((a, b) => semaineDeChantier(a) - semaineDeChantier(b) || numero(a.label) - numero(b.label));
}

function pairesDeLaSemaine(parite) {
  return [...POSTES_SEMAINE.map((poste) => paireFixe(poste, parite)), ...chantiers(parite)];
}

// Les deux cases Diakonos de l'onglet (1er tour, 2ème tour).
const diakonosDeLaSemaine = (parite) => POSTES_DIAKONOS.map((poste) => paireFixe(poste, parite));

// Vrai numéro de la semaine d'un onglet (celle des lancements chargés, sinon le calendrier).
function numeroSemaine(parite) {
  const semaines = pairesDeLaSemaine(parite)
    .filter((p) => p.strat)
    .map((p) => p.semaine);
  return semaineAffichee(semaines, parite);
}

const libelleOnglet = (parite) => `Semaine ${numeroSemaine(parite)}`;

// ---- Mémorisation locale (IndexedDB) : fichiers et derniers résultats de
// chaque case, retrouvés à la réouverture de la page. Purement un confort :
// sans IndexedDB (mode privé...), tout marche, sans mémoire. ----

const DB_MEMOIRE_NOM = "sentinelle-memoire";
const MAGASIN_PAIRES = "paires";
const MAGASIN_FICHIERS = "fichiers"; // contenu des fichiers, clé « case||rôle »

let baseMemoire = null;
function ouvrirBaseMemoire() {
  if (!baseMemoire) {
    baseMemoire = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB indisponible"));
        return;
      }
      const requete = indexedDB.open(DB_MEMOIRE_NOM, 2);
      // Une page ouverte ailleurs sur une ancienne version bloque la mise à niveau : sans réponse, la page
      // marche sans mémoire plutôt que de rester figée au démarrage.
      const delai = setTimeout(() => reject(new Error("mémoire bloquée par un autre onglet")), 5000);
      requete.onupgradeneeded = () => {
        const db = requete.result;
        if (!db.objectStoreNames.contains(MAGASIN_PAIRES)) db.createObjectStore(MAGASIN_PAIRES, { keyPath: "cleMemoire" });
        if (!db.objectStoreNames.contains(MAGASIN_FICHIERS)) db.createObjectStore(MAGASIN_FICHIERS);
      };
      requete.onsuccess = () => {
        clearTimeout(delai);
        const db = requete.result;
        // Une version plus récente ouverte dans un autre onglet : lui laisser la place.
        db.onversionchange = () => {
          db.close();
          baseMemoire = null;
        };
        resolve(db);
      };
      requete.onerror = () => {
        clearTimeout(delai);
        reject(requete.error);
      };
    });
    baseMemoire.catch(() => (baseMemoire = null));
  }
  return baseMemoire;
}

const finTransaction = (tx) =>
  new Promise((resolve) => {
    tx.oncomplete = resolve;
    tx.onerror = resolve;
    tx.onabort = resolve;
  });

const cleMemoire = (p) => `${p.poste}||${p.label}`;

async function sauvegarderDansMemoire(p, champs) {
  try {
    const db = await ouvrirBaseMemoire();
    const cle = cleMemoire(p);
    const tx = db.transaction(MAGASIN_PAIRES, "readwrite");
    const magasin = tx.objectStore(MAGASIN_PAIRES);
    const existant = await new Promise((resolve) => {
      const req = magasin.get(cle);
      req.onsuccess = () => resolve(req.result || { cleMemoire: cle });
      req.onerror = () => resolve({ cleMemoire: cle });
    });
    magasin.put({ ...existant, ...champs, cleMemoire: cle });
    await finTransaction(tx);
  } catch (_erreur) {
    // Mémorisation indisponible : sans effet sur le fonctionnement normal.
  }
}

// Les fiches des cases, avec le contenu de leurs fichiers (rangé à part, ou dans la fiche pour les versions d'avant).
async function lireToutesLesMemoires() {
  try {
    const db = await ouvrirBaseMemoire();
    const tx = db.transaction([MAGASIN_PAIRES, MAGASIN_FICHIERS], "readonly");
    const lire = (requete) =>
      new Promise((resolve) => {
        requete.onsuccess = () => resolve(requete.result || []);
        requete.onerror = () => resolve([]);
      });
    const [fiches, cles, contenus] = await Promise.all([
      lire(tx.objectStore(MAGASIN_PAIRES).getAll()),
      lire(tx.objectStore(MAGASIN_FICHIERS).getAllKeys()),
      lire(tx.objectStore(MAGASIN_FICHIERS).getAll()),
    ]);
    const parCle = new Map(cles.map((c, i) => [c, contenus[i]]));
    for (const fiche of fiches) {
      for (const [role, champ] of Object.entries(CHAMP_FICHIER)) {
        const f = fiche[champ];
        if (f && !f.bytes && parCle.has(`${fiche.cleMemoire}||${role}`)) f.bytes = parCle.get(`${fiche.cleMemoire}||${role}`);
      }
    }
    return fiches;
  } catch (_erreur) {
    return [];
  }
}

// Fiches des versions d'avant : leurs fichiers passent dans le magasin à part (une fois, en arrière-plan).
async function rangerFichiersMemorises(fiches) {
  for (const fiche of fiches) {
    const roles = Object.entries(CHAMP_FICHIER).filter(([, champ]) => fiche[champ] && fiche[champ].bytes && !fiche[champ].separe);
    if (!roles.length) continue;
    try {
      const db = await ouvrirBaseMemoire();
      const tx = db.transaction([MAGASIN_PAIRES, MAGASIN_FICHIERS], "readwrite");
      const magasin = tx.objectStore(MAGASIN_PAIRES);
      const actuelle = await new Promise((resolve) => {
        const req = magasin.get(fiche.cleMemoire);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
      if (actuelle) {
        for (const [role, champ] of Object.entries(CHAMP_FICHIER)) {
          const f = actuelle[champ];
          if (!f || !f.bytes || f.separe) continue;
          tx.objectStore(MAGASIN_FICHIERS).put(f.bytes, `${fiche.cleMemoire}||${role}`);
          actuelle[champ] = { nom: f.nom, type: f.type, lastModified: f.lastModified, separe: true };
        }
        magasin.put(actuelle);
      }
      await finTransaction(tx);
    } catch (_erreur) {
      // sans effet : l'ancienne fiche reste lisible
    }
  }
}

async function effacerMemoire(p) {
  try {
    const db = await ouvrirBaseMemoire();
    const tx = db.transaction([MAGASIN_PAIRES, MAGASIN_FICHIERS], "readwrite");
    tx.objectStore(MAGASIN_PAIRES).delete(cleMemoire(p));
    for (const role of Object.keys(CHAMP_FICHIER)) tx.objectStore(MAGASIN_FICHIERS).delete(`${cleMemoire(p)}||${role}`);
    await finTransaction(tx);
  } catch (_erreur) {
    // sans effet
  }
}

const CHAMP_FICHIER = { strat: "fichierStrat", coupe: "fichierCoupe", bkp: "fichierBkp", sommaire: "fichierSommaire", diakonos: "fichierDiakonos" };

async function memoriserFichier(p, role, fichier) {
  try {
    const bytes = await fichier.arrayBuffer();
    const db = await ouvrirBaseMemoire();
    const tx = db.transaction(MAGASIN_FICHIERS, "readwrite");
    tx.objectStore(MAGASIN_FICHIERS).put(bytes, `${cleMemoire(p)}||${role}`);
    await finTransaction(tx);
  } catch (_erreur) {
    return;
  }
  await sauvegarderDansMemoire(p, {
    [CHAMP_FICHIER[role]]: { nom: fichier.name, type: fichier.type, lastModified: fichier.lastModified, separe: true },
  });
}

async function oublierFichier(p, role) {
  p[role] = null;
  await sauvegarderDansMemoire(p, { [CHAMP_FICHIER[role]]: null });
  try {
    const db = await ouvrirBaseMemoire();
    const tx = db.transaction(MAGASIN_FICHIERS, "readwrite");
    tx.objectStore(MAGASIN_FICHIERS).delete(`${cleMemoire(p)}||${role}`);
    await finTransaction(tx);
  } catch (_erreur) {
    // sans effet
  }
}

function resultatsAMemoriser(p) {
  return {
    semaineParite: p.parite,
    codeLancement: p.codeLancement,
    dossier: p.dossier,
    semaineDossier: p.semaineDossier || null,
    semaine: p.semaine,
    rapport: p.rapport,
    doublons: p.doublons,
    semainesLivraison: p.semainesLivraison,
    nbUnitaires: p.nbUnitaires,
    nbPiecesTrouvees: p.nbPiecesTrouvees,
    source: p.source,
    ecartsScies: p.ecartsScies,
    totalScies: p.totalScies,
    erreurScies: p.erreurScies,
    couleurs: p.couleurs,
  };
}

const enregistrer = (p) => sauvegarderDansMemoire(p, resultatsAMemoriser(p));

function fichierDepuisMemoire(f) {
  return f && f.bytes ? new File([f.bytes], f.nom, { type: f.type || "", lastModified: f.lastModified || Date.now() }) : null;
}

function restaurer(p, rec) {
  p.codeLancement = rec.codeLancement || null;
  p.strat = fichierDepuisMemoire(rec.fichierStrat);
  p.coupe = fichierDepuisMemoire(rec.fichierCoupe);
  p.bkp = fichierDepuisMemoire(rec.fichierBkp);
  p.sommaire = fichierDepuisMemoire(rec.fichierSommaire);
  p.diakonos = fichierDepuisMemoire(rec.fichierDiakonos);
  p.dossier = rec.dossier || null;
  p.semaineDossier = rec.semaineDossier || null;
  p.semaine = rec.semaine || null;
  p.rapport = rec.rapport || null;
  if (p.rapport) {
    // Rapport d'une version précédente : pas encore de comptage en pièces.
    p.rapport.piecesAttendues = p.rapport.piecesAttendues || 0;
    p.rapport.piecesTrouvees = p.rapport.piecesTrouvees || 0;
  }
  p.doublons = rec.doublons || rec.doublonsStrat || [];
  p.semainesLivraison = rec.semainesLivraison || [];
  p.nbUnitaires = rec.nbUnitaires ?? null;
  p.nbPiecesTrouvees = rec.nbPiecesTrouvees ?? null;
  p.source = rec.source || rec.sourceTrouve || null;
  p.ecartsScies = rec.ecartsScies || null;
  p.totalScies = rec.totalScies ?? null;
  p.erreurScies = rec.erreurScies || null;
  p.couleurs = rec.couleurs || null;
}

async function initialiserPaires() {
  const memoires = await lireToutesLesMemoires();
  rangerFichiersMemorises(memoires);
  const parCle = new Map(memoires.map((r) => [r.cleMemoire, r]));
  for (const poste of [...POSTES_SEMAINE, ...POSTES_DIAKONOS]) {
    for (const parite of ["paire", "impaire"]) {
      const p = nouvellePaire(poste, parite === "paire" ? "Semaine paire" : "Semaine impaire", parite);
      const rec = parCle.get(cleMemoire(p));
      if (rec) restaurer(p, rec);
    }
  }
  const numero = (label) => parseInt(label.replace(/\D/g, ""), 10) || 0;
  const prefixe = `${POSTE_CHANTIERS}||`;
  const chantiersMemorises = memoires
    .filter((r) => typeof r.cleMemoire === "string" && r.cleMemoire.startsWith(prefixe))
    .sort((a, b) => numero(a.cleMemoire) - numero(b.cleMemoire));
  for (const rec of chantiersMemorises) {
    const label = rec.cleMemoire.slice(prefixe.length);
    const p = nouvellePaire(POSTE_CHANTIERS, label, rec.semaineParite || "paire");
    restaurer(p, rec);
    if (ranger(p)) sauvegarderDansMemoire(p, { semaineParite: p.parite });
    prochainNumeroChantier = Math.max(prochainNumeroChantier, numero(label) + 1);
  }
  if (!paires.some(estChantier)) ajouterChantier("paire");
}

function ajouterChantier(parite) {
  const p = nouvellePaire(POSTE_CHANTIERS, `Chantier ${prochainNumeroChantier++}`, parite);
  sauvegarderDansMemoire(p, { semaineParite: parite });
  return p;
}

function viderPaire(p) {
  p.strat = null;
  p.coupe = null;
  p.bkp = null;
  p.sommaire = null;
  p.diakonos = null;
  p.dossier = null;
  p.semaineDossier = null;
  p.semaine = null;
  viderResultats(p);
  p.etat = null;
  p.etatErreur = false;
}

// Les résultats des contrôles (ils ne valent que pour les fichiers avec lesquels ils ont été faits).
function viderResultats(p) {
  p.rapport = null;
  p.doublons = [];
  p.semainesLivraison = [];
  p.nbUnitaires = null;
  p.nbPiecesTrouvees = null;
  p.source = null;
  p.ecartsScies = null;
  p.totalScies = null;
  p.erreurScies = null;
  p.couleurs = null;
}

// Un fichier changé à la main : les résultats faits avec l'ancien ne valent plus (refaire GO / Vérifier Scies).
function oublierResultatsDe(p, role) {
  if (role === "strat") viderResultats(p);
  if (role === "coupe" || (role === "bkp" && p.source === "bkp")) {
    p.rapport = null;
    p.nbUnitaires = null;
    p.nbPiecesTrouvees = null;
    p.source = null;
  }
  if (role === "bkp") {
    p.ecartsScies = null;
    p.totalScies = null;
    p.erreurScies = null;
    p.couleurs = null;
  }
  if (role === "strat" || role === "coupe" || role === "bkp") {
    p.etat = null;
    p.etatErreur = false;
  }
}

async function reinitialiser(p) {
  viderPaire(p);
  await effacerMemoire(p);
  if (estChantier(p)) await sauvegarderDansMemoire(p, { semaineParite: p.parite, codeLancement: p.codeLancement });
}

// ---- Lectures mises en cache (un fichier ne change pas une fois choisi) ----

const cacheClasseurs = new WeakMap();
function classeurEnCache(fichier) {
  if (!cacheClasseurs.has(fichier)) {
    const lecture = chargerClasseur(fichier);
    lecture.catch(() => cacheClasseurs.delete(fichier));
    cacheClasseurs.set(fichier, lecture);
  }
  return cacheClasseurs.get(fichier);
}

const cacheStrat = new WeakMap();
function stratEnCache(fichier) {
  if (!cacheStrat.has(fichier)) {
    const lecture = classeurEnCache(fichier).then((wb) => lireStrat(wb));
    lecture.catch(() => cacheStrat.delete(fichier));
    cacheStrat.set(fichier, lecture);
  }
  return cacheStrat.get(fichier);
}

// Utilisé par la recherche et le schéma de commande.
function lignesStratEnCache(fichier) {
  return stratEnCache(fichier).then((r) => r.lignes);
}

async function detecterSemaine(p) {
  if (!p.strat) return null;
  try {
    const { lignes } = await stratEnCache(p.strat);
    const l = lignes.find((x) => x.lancement);
    if (!l) return null;
    // Un lancement rangé dans un dossier « Semaine NN » est de cette semaine, même si sa colonne lancement dit
    // autre chose (LAN2646BSR dans « Semaine 47 ») ; une casse rangée là est la casse de cette semaine.
    if (p.semaineDossier) return String(p.semaineDossier).padStart(2, "0");
    let semaine = extraireSemaine(l.lancement);
    // Sinon la casse a une semaine de décalage : la casse 43 se fabrique en semaine 44.
    if (semaine && p.poste === "Casse") {
      const n = parseInt(semaine, 10);
      semaine = String(n >= 52 ? 1 : n + 1).padStart(2, "0");
    }
    return semaine;
  } catch (_erreur) {
    return null; // fichier pas (encore) exploitable : l'erreur apparaîtra au contrôle
  }
}

// Le code de lancement (ex. "LAN264004") : la semaine est l'avant-dernière
// paire de chiffres, ou la dernière pour un code à 4 chiffres (Feno, Casse...).
function extraireSemaine(codeLancement) {
  if (!codeLancement) return null;
  const chiffres = String(codeLancement).replace(/\D/g, "");
  if (chiffres.length === 4) return chiffres.slice(2, 4);
  if (chiffres.length < 4) return null;
  return chiffres.slice(-4, -2);
}

// Ce que le tableau des lancements et le compteur savent d'une case :
// pièces prévues (une pièce assemblée compte une fois), pièces complètes
// dans le .bkp, clés des pièces. Mis en cache par couple de fichiers.
const idsFichiers = new WeakMap();
let prochainIdFichier = 1;
const idFichier = (f) => {
  if (!f) return "-";
  if (!idsFichiers.has(f)) idsFichiers.set(f, prochainIdFichier++);
  return idsFichiers.get(f);
};
const resumes = new Map();
const cleResume = (strat, bkp) => `${idFichier(strat)}#${idFichier(bkp)}`;
const resumeEnCache = (strat, bkp) => resumes.get(cleResume(strat, bkp)) || null;

const resumesEnCours = new Map();
function resume(strat, bkp) {
  const cle = cleResume(strat, bkp);
  if (resumes.has(cle)) return Promise.resolve(resumes.get(cle));
  if (!resumesEnCours.has(cle))
    resumesEnCours.set(
      cle,
      calculerResume(strat, bkp).then((r) => {
        resumes.set(cle, r);
        resumesEnCours.delete(cle);
        return r;
      })
    );
  return resumesEnCours.get(cle);
}

async function calculerResume(strat, bkp) {
  // lancements : codes écrits dans le fichier (« LAN264601 »).
  const r = { prevues: NaN, bkp: null, cles: new Set(), lancements: new Set() };
  let lignes = null;
  if (strat) {
    try {
      lignes = (await stratEnCache(strat)).lignes;
      r.prevues = lignes.reduce((t, l) => t + l.pieces, 0);
      for (const l of lignes) {
        r.cles.add(l.cle);
        if (l.lancement && String(l.lancement).trim()) r.lancements.add(String(l.lancement).trim());
      }
    } catch (_erreur) {
      lignes = null; // lancement illisible : l'erreur apparaîtra au contrôle
    }
  }
  if (bkp) {
    try {
      const trouve = await lireBkpSansProtections(bkp);
      r.bkp = lignes ? piecesTrouvees(lignes, trouve) : sommeValeurs(trouve);
    } catch (_erreur) {
      r.bkp = NaN; // .bkp illisible : l'erreur sera visible via « Vérifier Scies »
    }
  }
  return r;
}

// ---- Construction de l'écran ----

const zonesRecap = { generation: 0 };

function afficher() {
  majOnglets();
  document.querySelectorAll(".onglet-btn").forEach((b) => b.classList.toggle("actif", b.dataset.onglet === onglet));
  $("pageAccueil").classList.toggle("inactif", onglet !== "accueil");
  $("pageSemaine").classList.toggle("inactif", !estOngletSemaine());
  $("pageRecherche").classList.toggle("inactif", onglet !== "recherche");
  $("pageBibliotheque").classList.toggle("inactif", onglet !== "bibliotheque");
  $("pageReecriture").classList.toggle("inactif", onglet !== "reecriture");
  majMenuDossier();
  if (estOngletSemaine()) construireSemaine(onglet);
  else if (onglet === "accueil") afficherAccueil();
  else if (onglet === "bibliotheque") afficherBibliotheque();
  else if (onglet === "reecriture") afficherReecriture();
}

function majOnglets() {
  let change = false;
  document.querySelectorAll(".onglet-btn").forEach((b) => {
    if (!estOngletSemaine(b.dataset.onglet)) return;
    const libelle = libelleOnglet(b.dataset.onglet);
    const zone = b.querySelector(".libelle-onglet") || b;
    if (zone.textContent !== libelle) {
      zone.textContent = libelle;
      if (b.dataset.onglet === onglet) change = true;
    }
  });
  return change;
}

function construireSemaine(parite) {
  const page = $("pageSemaine");
  const numero = numeroSemaine(parite);
  page.innerHTML = `
    ${entetePage(
      `Semaine ${numero} · ${anneeDeSemaine(numero)}`,
      "Contrôler la coupe",
      "Les fichiers de la semaine sont trouvés tout seuls dans son dossier.",
      `<button type="button" class="contour export-semaine" id="btnCompteRendu">Compte rendu de la semaine (.pdf)</button>
       <button type="button" class="contour export-semaine" id="btnExporterSemaine">Exporter le rapport de la semaine (.xlsx)</button>
       <button type="button" id="btnLancerTout"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>Lancer tous les contrôles</button>`
    )}
    <div class="carte" id="carteDossier"></div>
    <div class="colonnes-controle">
      <div class="colonne-postes">
        <div class="carte compteur" id="texteCompteur"><span class="valeur">…</span></div>
        <nav class="liste-postes" id="listePostes" aria-label="Les postes de la semaine"></nav>
        <button type="button" class="contour" id="btnAjouterChantier">+ Ajouter un chantier</button>
        <button type="button" class="texte" id="btnReinitialiserSemaine">↺ Réinitialiser la semaine</button>
      </div>
      <div class="colonne-cases">
        <div id="cartesPostes"></div>
        <h2 class="titre-poste">Chantiers</h2>
        <div id="cartesChantiers"></div>
      </div>
    </div>
    <div class="carte"><div class="carte-titre">Lancements</div><div id="zoneRecap"></div></div>
  `;
  majCompteur();
  majRecap();
  remplirCarteDossier(parite);
  $("btnLancerTout").addEventListener("click", lancerTousLesControles);
  $("btnExporterSemaine").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await exporterSemaine(parite);
    } catch (erreur) {
      alert("Impossible d'enregistrer le rapport :\n" + (erreur && erreur.message ? erreur.message : erreur));
    } finally {
      e.target.disabled = false;
    }
  });
  $("btnCompteRendu").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await exporterCompteRendu(parite);
    } catch (erreur) {
      alert("Impossible de faire le compte rendu :\n" + (erreur && erreur.message ? erreur.message : erreur));
    } finally {
      e.target.disabled = false;
    }
  });
  $("btnReinitialiserSemaine").addEventListener("click", reinitialiserSemaine);
  $("btnAjouterChantier").addEventListener("click", () => {
    const p = ajouterChantier(parite);
    afficher();
    const carte = document.querySelector(`.carte-paire[data-id="${p.id}"]`);
    if (carte) carte.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  for (const poste of POSTES_SEMAINE) $("cartesPostes").appendChild(carteDe(paireFixe(poste, parite)));
  for (const c of chantiers(parite)) $("cartesChantiers").appendChild(carteDe(c));
  majDiakonos();
}

function carteDe(p) {
  const carte = document.createElement("div");
  carte.className = "carte carte-paire";
  carte.dataset.id = p.id;
  remplirCarte(carte, p);
  return carte;
}

// Redessine une case (et le tableau, et les onglets si la semaine a changé).
function rafraichir(p) {
  // Le fichier Diakonos est affiché dans toutes les cases de son tour.
  if (estDiakonos(p)) document.querySelectorAll(`.zone-diakonos[data-diakonos="${p.id}"]`).forEach((zone) => remplirZoneDiakonos(zone, p));
  else {
    const carte = document.querySelector(`.carte-paire[data-id="${p.id}"]`);
    if (carte) remplirCarte(carte, p);
  }
  if (majOnglets()) afficher();
  else {
    majRecap();
    majDiakonos();
  }
}

// Numéro de la case dans son onglet (pastille de la charte) : postes, puis chantiers.
function numeroCase(p) {
  const cases = [...POSTES_SEMAINE.map((poste) => paireFixe(poste, p.parite)), ...chantiers(p.parite)];
  return cases.indexOf(p) + 1;
}

function remplirCarte(carte, p) {
  const lignesFichiers = Object.entries(ROLES)
    .map(([role, libelle]) => {
      const f = p[role];
      return `
        <div class="ligne-fichier">
          <div class="ligne-fichier-textes">
            <div class="ligne-fichier-libelle">${libelle}</div>
            <div class="ligne-fichier-nom ${f ? "ok" : "vide"}" title="${f ? echapper(f.name) : ""}">${f ? `✓ ${echapper(f.name)}` : "Aucun fichier"}</div>
          </div>
          <button type="button" class="contour" data-action="choisir" data-role="${role}">${f ? "Changer" : "Choisir"}</button>
        </div>`;
    })
    .join("");
  carte.innerHTML = `
    <div class="entete-carte">
      ${numeroCase(p) ? `<span class="pastille">${String(numeroCase(p)).padStart(2, "0")}</span>` : ""}
      <span class="titre-carte">${echapper(titreCase(p))}</span>
      ${estChantier(p) ? '<button type="button" class="texte alerte" data-action="retirer">✕ Retirer</button>' : ""}
      <button type="button" class="texte" data-action="reinitialiser">↺ Réinitialiser</button>
    </div>
    ${zonesDiakonosHtml(p)}
    ${lignesFichiers}
    <div class="boutons-carte">
      <button type="button" data-action="go" ${p.enCours ? "disabled" : ""}>GO</button>
      <button type="button" class="contour" data-action="scies" ${p.enCours ? "disabled" : ""}>Vérifier Scies</button>
    </div>
    <button type="button" class="contour pleine" data-action="rapport-lancement" ${p.enCours ? "disabled" : ""}>📄 Rapport du lancement (.pdf)</button>
    ${p.strat ? `<button type="button" class="contour pleine" data-action="problemes-lancement" ${p.enCours ? "disabled" : ""}>📊 Problèmes du lancement (.xlsx)</button>` : ""}
    ${p.etat ? `<div class="etat ${p.etatErreur ? "erreur" : ""}">${echapper(p.etat)}</div>` : ""}
    <div class="zone-rapport"></div>
    <div class="zone-scies"></div>
    <div class="zone-casse"></div>
  `;
  carte.querySelectorAll('[data-action="choisir"]').forEach((b) => b.addEventListener("click", () => demanderFichier(p, b.dataset.role)));
  carte.querySelector('[data-action="go"]').addEventListener("click", () => lancerUnePaire(p, null).then(() => problemesAutomatiques(p)));
  carte.querySelector('[data-action="scies"]').addEventListener("click", () => lancerControleScies(p, () => problemesAutomatiques(p)));
  const problemes = carte.querySelector('[data-action="problemes-lancement"]');
  if (problemes)
    problemes.addEventListener("click", async () => {
      problemes.disabled = true;
      try {
        await exporterProblemesLancement(p);
      } catch (erreur) {
        alert("Impossible de faire le fichier des problèmes :\n" + (erreur && erreur.message ? erreur.message : erreur));
      } finally {
        problemes.disabled = false;
      }
    });
  carte.querySelector('[data-action="rapport-lancement"]').addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await exporterLancement(p);
    } catch (erreur) {
      alert("Impossible de faire le rapport du lancement :\n" + (erreur && erreur.message ? erreur.message : erreur));
    } finally {
      e.target.disabled = false;
    }
  });
  carte.querySelectorAll(".zone-diakonos").forEach(remplirUneZoneDiakonos);
  carte.querySelector('[data-action="reinitialiser"]').addEventListener("click", async () => {
    if (!(await demanderConfirmation(`Réinitialiser « ${titreCase(p)} » ?`, "Les fichiers et résultats de cette case seront effacés.", "Oui"))) return;
    await reinitialiser(p);
    const diakonos = diakonosDeLaCase(p);
    if (diakonos) await reinitialiser(diakonos);
    rafraichir(p);
    majCompteur();
  });
  const retirer = carte.querySelector('[data-action="retirer"]');
  if (retirer) retirer.addEventListener("click", () => retirerChantier(p));
  if (p.rapport) afficherRapport(carte.querySelector(".zone-rapport"), p);
  if (p.ecartsScies || p.erreurScies) afficherScies(carte.querySelector(".zone-scies"), p);
  if (p.poste === "Casse" && p.strat && estOngletSemaine()) remplirCasse(carte.querySelector(".zone-casse"), p);
}

// ---- Casse : les pièces déjà lancées une semaine d'avant, retrouvées dans les fichiers de lancement de
// l'autre onglet (la semaine d'avant) et dans la bibliothèque (toutes les semaines gardées) ----

const resultatsCasse = new Map(); // id de la case → dernier résultat
const casseEnCours = new Set();

// Semaine d'avant celle où la casse est fabriquée (la casse 44 se fabrique en 45 : semaine d'avant 44).
function semaineAvantCasse(p) {
  const n = parseInt(p.semaine, 10);
  if (Number.isNaN(n)) return null;
  return String(n <= 1 ? 52 : n - 1).padStart(2, "0");
}

const cleCasse = (p, autreSemaine, numeroAutre) =>
  [idFichier(p.strat), p.semaine, numeroAutre, bibliotheque.generation, ...autreSemaine.filter((o) => o.strat).map((o) => idFichier(o.strat))].join("|");

// « en semaine 44 », « en semaines 43 et 44 ».
function libelleSemaines(numeros) {
  const u = [...new Set(numeros.map((n) => String(n).padStart(2, "0")))].sort();
  if (u.length <= 1) return `en semaine ${u[0] || "?"}`;
  return `en semaines ${u.slice(0, -1).join(", ")} et ${u[u.length - 1]}`;
}

// Semaines où l'on a cherché : « en semaine 44 », ou « dans les semaines 38 à 45 ».
function periodeCasse(semaines) {
  const u = [...new Set(semaines)];
  if (u.length <= 1) return `en semaine ${u[0] || "?"}`;
  if (u.length === 2) return `en semaines ${u[0]} et ${u[1]}`;
  return `dans les semaines ${u[0]} à ${u[u.length - 1]}`;
}

async function calculerCasse(p, autreSemaine, numeroAutre) {
  // dejaLancees : pièces relancées ({ ligne, lancement, semaine }) ; rajouts : les autres.
  const r = {
    cle: cleCasse(p, autreSemaine, numeroAutre), semaineAvant: semaineAvantCasse(p), autreSemaineChargee: null, nbPieces: 0,
    dejaLancees: [], rajouts: [], nbAutres: 0, lancements: [], semainesCherchees: [], periode: "", erreur: null,
  };
  let lignes;
  try {
    lignes = (await stratEnCache(p.strat)).lignes;
  } catch (erreur) {
    r.erreur = erreur && erreur.message ? erreur.message : String(erreur);
    return r;
  }
  const autre = String(numeroAutre).padStart(2, "0");
  const autreUtile = Boolean(r.semaineAvant && r.semaineAvant === autre && autreSemaine.some((o) => o.strat));
  // Rang de la semaine de fabrication (année comprise) : on cherche dans les semaines d'avant.
  const code = semaineDuLancement(lignes, false, p.strat.name);
  const fabrication = parseInt(p.semaine, 10);
  const avant = code && !Number.isNaN(fabrication) ? ordreSemaine(code.annee + (fabrication < code.semaine ? 1 : 0), fabrication) : null;
  const connues = avant ? semainesConnuesAvant(avant) : [];
  // Rien de chargé dans l'onglet de la semaine d'avant ni dans la bibliothèque : impossible de séparer relancées et rajouts.
  if (!autreUtile && !connues.length) {
    r.autreSemaineChargee = autre;
    return r;
  }
  r.semainesCherchees = [...new Set([...connues, ...(autreUtile ? [r.semaineAvant] : [])])].sort();
  r.periode = periodeCasse(r.semainesCherchees);
  r.nbPieces = lignes.length;
  if (autreUtile) r.lancements = autreSemaine.filter((o) => o.strat).map((o) => o.strat.name);
  if (connues.length) r.lancements.push(`bibliothèque (${r.semainesCherchees.length > 1 ? `semaines ${connues[0]} à ${connues[connues.length - 1]}` : `semaine ${connues[0]}`})`);
  for (const l of lignes) {
    let origine = null;
    if (autreUtile)
      for (const o of autreSemaine) {
        if (o.strat && (await resume(o.strat, o.bkp)).cles.has(l.cle)) {
          origine = { lancement: o.strat.name, semaine: r.semaineAvant };
          break;
        }
      }
    if (!origine && avant) {
      const vu = derniereFoisLancee(l.cle, avant);
      if (vu) origine = { lancement: vu.lancement, semaine: vu.semaine };
    }
    if (origine) r.dejaLancees.push({ ligne: l, ...origine });
    else {
      r.rajouts.push(l);
      r.nbAutres++;
    }
  }
  return r;
}

const dimensionsCasse = (l) => (l.longueurFinie != null && l.largeurFinie != null ? `${fmtDim(l.longueurFinie)} × ${fmtDim(l.largeurFinie)}` : "");
const colorisCasse = (l) => (l.toutesDonnees && l.toutesDonnees.coloris) || "";
const messageChargerCasse = (r) => `chargez la semaine ${r.semaineAvant || "d'avant"} dans l'autre onglet, ou ajoutez les semaines d'avant à la bibliothèque`;

// Pages du rapport du lancement de la casse : pièces relancées, puis rajouts.
function partiesCasse(r, base) {
  const relancees = partieRapport("Relancées", `${base} — Casse : pièces relancées`, ["Commande + ligne", "Article", "Dimensions", "Coloris", "Lancée dans", "Qté"], [34, 34, 26, 18, 58, 12], 5);
  relancees.total = false;
  if (r.erreur) {
    [relancees.statut, relancees.couleurStatut] = [`Casse illisible : ${r.erreur}`, STATUT.ALERTE];
    return [relancees];
  }
  if (r.autreSemaineChargee) {
    [relancees.statut, relancees.couleurStatut] = [`Pour séparer les pièces relancées et les rajouts, ${messageChargerCasse(r)}`, STATUT.ATTENTION];
    return [relancees];
  }
  if (!r.dejaLancees.length) [relancees.statut, relancees.couleurStatut] = [`Aucune pièce de la casse n'était lancée ${r.periode}`, STATUT.OK];
  else [relancees.statut, relancees.couleurStatut] = [`${r.dejaLancees.length} pièce(s) relancée(s) : déjà lancée(s) ${libelleSemaines(r.dejaLancees.map((t) => t.semaine))}`, STATUT.ATTENTION];
  for (const t of r.dejaLancees) relancees.rangees.push([t.ligne.cle, t.ligne.article || "", dimensionsCasse(t.ligne), colorisCasse(t.ligne), `${t.lancement} (sem. ${t.semaine})`, String(t.ligne.pieces)]);
  if (r.lancements.length) relancees.notes.push(["Comparé à : ", r.lancements.join(", ")]);
  const rajouts = partieRapport("Rajouts", `${base} — Casse : rajouts`, ["Commande + ligne", "Article", "Dimensions", "Coloris", "Qté"], [40, 52, 36, 36, 18], 4);
  rajouts.total = false;
  rajouts.statut = r.rajouts.length
    ? `${r.rajouts.length} rajout(s) : pièce(s) pas lancée(s) ${r.periode}`
    : `Aucun rajout : toutes les pièces étaient déjà lancées ${r.periode}`;
  for (const l of r.rajouts) rajouts.rangees.push([l.cle, l.article || "", dimensionsCasse(l), colorisCasse(l), String(l.pieces)]);
  return [relancees, rajouts];
}

function remplirCasse(zone, p) {
  const autre = p.parite === "paire" ? "impaire" : "paire";
  const autreSemaine = pairesDeLaSemaine(autre);
  const numeroAutre = numeroSemaine(autre);
  const cle = cleCasse(p, autreSemaine, numeroAutre);
  const r = resultatsCasse.get(p.id);
  if (!r || r.cle !== cle) {
    zone.innerHTML = '<div class="note">…</div>';
    if (!casseEnCours.has(cle)) {
      casseEnCours.add(cle);
      calculerCasse(p, autreSemaine, numeroAutre).then((calcule) => {
        casseEnCours.delete(cle);
        resultatsCasse.set(p.id, calcule);
        const carte = document.querySelector(`.carte-paire[data-id="${p.id}"] .zone-casse`);
        if (carte) remplirCasse(carte, p);
      });
    }
    return;
  }
  let html = '<div class="separateur"></div>';
  if (r.erreur) html += `<div class="etat erreur">Casse illisible : ${echapper(r.erreur)}</div>`;
  else if (r.autreSemaineChargee) html += `<div class="note">Pour retrouver les pièces déjà lancées, ${echapper(messageChargerCasse(r))}.</div>`;
  else if (!r.dejaLancees.length) html += bandeau(`Casse : aucune pièce n'était lancée ${echapper(r.periode)}`, "ok");
  else {
    html += bandeau(`🔁 ${r.dejaLancees.length} pièce(s) de la casse déjà lancée(s) ${echapper(libelleSemaines(r.dejaLancees.map((t) => t.semaine)))}`, "attention");
    if (r.nbAutres) html += `<div class="note">${r.nbAutres} autre(s) pièce(s) pas lancée(s) ${echapper(r.periode)}</div>`;
  }
  zone.innerHTML = html;
}

const bandeau = (texte, genre) => `<div class="bandeau ${genre}">${texte}</div>`;

function afficherRapport(zone, p) {
  const r = p.rapport;
  // En pièces finies : une pièce assemblée (Feno : compact + support) compte une fois.
  const enPieces = r.piecesAttendues > 0 || r.piecesTrouvees > 0;
  const attendu = Math.trunc(enPieces ? r.piecesAttendues : r.totalAttendu);
  let html = '<div class="separateur"></div>';
  html += r.nbAnomalies === 0 ? bandeau(`✔ Tout est correct — ${attendu} pièces`, "ok") : bandeau(`⚠ ${r.nbAnomalies} pièce(s) à vérifier dans ${sourceControle(p)}`, "alerte");
  const details = [];
  if (p.source === "bkp") details.push("Pas de liste de coupe : lancement comparé au .bkp");
  if (p.nbUnitaires !== null && p.nbPiecesTrouvees) {
    const unitaire = (p.nbUnitaires * 100) / p.nbPiecesTrouvees;
    details.push(`Liste de coupe : ${pourcent(unitaire)} % des pièces en unitaire, ${pourcent(100 - unitaire)} % en grain matching`);
  }
  if (details.length) html += `<div class="note">${details.join(" · ")}</div>`;
  html += htmlSemainesLivraison(p);
  if (p.doublons.length) {
    html += bandeau(`⚠ ${p.doublons.length} doublon(s) dans le lancement`, "attention");
    if (p.strat) html += '<button type="button" class="contour pleine" data-action="sans-doublons">✂ Créer le lancement sans doublons (.xlsx)</button>';
  }
  zone.innerHTML = html;
  const sansDoublons = zone.querySelector('[data-action="sans-doublons"]');
  if (sansDoublons)
    sansDoublons.addEventListener("click", async () => {
      sansDoublons.disabled = true;
      try {
        await creerSansDoublons(p);
      } finally {
        sansDoublons.disabled = false;
      }
    });
}

// Nouveau fichier de lancement sans les lignes en double ; l'original n'est jamais modifié.
async function creerSansDoublons(p) {
  const strat = p.strat;
  let message;
  try {
    const { doublons, octets } = await lancementSansDoublons(strat);
    if (!octets) message = `Aucune ligne en double dans ${strat.name} : rien à corriger.`;
    else {
      const nom = nomCorrige(strat.name);
      telecharger(nom, octets, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      message = `${doublons.lignes.size} ligne(s) en double supprimée(s) (${doublons.cles.join(", ")}).\nNouveau fichier : ${nom}\nL'original ${strat.name} n'a pas changé.`;
    }
    p.etat = `✔ ${message.split("\n")[0]}`;
    p.etatErreur = false;
  } catch (erreur) {
    message = `Impossible de créer le lancement corrigé :\n${erreur && erreur.message ? erreur.message : erreur}`;
    p.etat = `❌ ${message.replace(/\n/g, " ")}`;
    p.etatErreur = true;
  }
  rafraichir(p);
  alert(message);
}

// Ce à quoi le lancement a été comparé : la liste de coupe, sinon le .bkp.
const sourceControle = (p) => (p.source === "bkp" ? "le .bkp" : "la liste de coupe");

// Pièces d'un lancement à livrer une autre semaine que les autres (en retard, le plus souvent).
function semainePrincipale(p) {
  return p.semainesLivraison.reduce((a, s) => (s.nbPieces > a.nbPieces ? s : a), p.semainesLivraison[0]);
}

function htmlSemainesLivraison(p) {
  if (p.semainesLivraison.length <= 1 || p.poste === "Casse") return "";
  const principale = semainePrincipale(p);
  const n = p.semainesLivraison.filter((s) => s !== principale).reduce((t, s) => t + s.nbPieces, 0);
  return bandeau(`⚠ ${n} pièce(s) à livrer une autre semaine que la semaine ${echapper(principale.semaine)}`, "attention");
}

function afficherScies(zone, p) {
  let html = '<div class="separateur"></div>';
  if (p.erreurScies) {
    zone.innerHTML = html + bandeau(`❌ Scies : ${echapper(p.erreurScies)}`, "alerte");
    return;
  }
  const panneaux = `${fmtNombre(p.totalScies || 0)} panneaux`;
  if (p.ecartsScies.length === 0) {
    html += bandeau(`✔ Scies : tout correspond — ${panneaux}`, "ok");
  } else {
    html += bandeau(`⚠ Scies : ${p.ecartsScies.length} pièce(s) différente(s) entre le lancement et le .bkp (${panneaux} vérifiés)`, "alerte");
  }
  html += htmlCouleurs(p.couleurs);
  zone.innerHTML = html;
}

// Contrôle des couleurs : chaque coloris du lancement doit avoir été optimisé dans le .bkp.
function htmlCouleurs(c) {
  if (!c) return "";
  if (c.sansStratifie) return '<div class="note">Couleurs : pas de stratifié dans ce .bkp</div>';
  const variantes = c.variantes || [];
  // Petit format (« 1136-PF » pour « 1136 ») : voulu, simplement précisé.
  const formatsPf = variantes.length ? ` (${[...new Set(variantes.map((v) => echapper(v.variante)))].join(", ")} : petit format)` : "";
  if (c.absentes.length === 0) return bandeau(`✔ Couleurs : les ${c.nbCouleurs} couleurs sont dans le .bkp${formatsPf}`, "ok");
  return bandeau(`⚠ Couleurs : ${c.absentes.length} couleur(s) du lancement absente(s) du .bkp — ces panneaux ne sont pas optimisés`, "alerte");
}

// ---- Diakonos : chaque pièce commandée doit être dans un lancement du même tour ----

const cacheDiakonos = new WeakMap();
function diakonosEnCache(fichier) {
  if (!cacheDiakonos.has(fichier)) {
    const lecture = classeurEnCache(fichier).then((wb) => lireDiakonos(wb));
    lecture.catch(() => cacheDiakonos.delete(fichier));
    cacheDiakonos.set(fichier, lecture);
  }
  return cacheDiakonos.get(fichier);
}

// Le Feno se contrôle avec le Feno : il n'est jamais comparé au Diakonos de l'agglo.
const estFeno = (p) => p.poste === "Feno" || /FENO/i.test(p.strat ? p.strat.name : "");

// Lancement de la semaine et du tour (un code sans tour, ex. LAN2646TRIGANO, vaut pour les deux tours).
// Le tour se lit dans le nom du fichier (LAN264601START → 1er tour) : la colonne « lancement » du fichier
// porte le numéro du lancement dans la semaine (LAN264505 pour un Feno), pas le tour. Elle ne sert
// que si le nom n'a pas de code. Ni le Feno (son propre contrôle) ni la casse (pièces d'autres semaines, sans tour).
function duTourDiakonos(p, res, semaine, tour) {
  if (estFeno(p) || estCasse(p, p.strat.name)) return false;
  const codeDuNom = trouverCodeLancement(p.strat.name);
  const codes = codeDuNom ? [codeDuNom] : [...res.lancements];
  return codes.some((code) => {
    const st = semaineEtTourDuLancement(code);
    return st !== null && st[0] === semaine && (st[1] === null || st[1] === tour);
  });
}

async function calculerDiakonos(p, semaineOnglet, semaine, toutes) {
  const r = { fichier: p.strat.name, semaine: p.semaine || semaineOnglet, tour: tourDiakonos(p), nbPieces: 0, lancements: [], manquantes: [], ailleurs: new Map(), erreur: null };
  let pieces;
  try {
    pieces = await diakonosEnCache(p.strat);
  } catch (erreur) {
    r.erreur = erreur && erreur.message ? erreur.message : String(erreur);
    return r;
  }
  r.nbPieces = pieces.length;
  const lancees = new Set();
  for (const l of semaine) {
    if (!l.strat) continue;
    const res = await resume(l.strat, l.bkp);
    if (!duTourDiakonos(l, res, r.semaine, r.tour)) continue;
    for (const cle of res.cles) lancees.add(cle);
    r.lancements.push(l.strat.name);
  }
  r.manquantes = pieces.filter((m) => !lancees.has(m.cle));
  // Pièce manquante retrouvée dans un autre lancement (autre tour, autre semaine).
  for (const m of r.manquantes) {
    for (const l of toutes) {
      if (l.strat && (await resume(l.strat, l.bkp)).cles.has(m.cle)) {
        r.ailleurs.set(m.cle, l.strat.name);
        break;
      }
    }
  }
  return r;
}

async function resultatsDiakonos(parite) {
  const autre = parite === "paire" ? "impaire" : "paire";
  const semaine = pairesDeLaSemaine(parite);
  const toutes = [...semaine, ...pairesDeLaSemaine(autre)];
  const numero = String(numeroSemaine(parite)).padStart(2, "0");
  const resultats = [];
  for (const p of diakonosDeLaSemaine(parite)) if (p.strat) resultats.push(await calculerDiakonos(p, numero, semaine, toutes));
  return resultats;
}

const derniersDiakonos = new Map(); // dernier résultat de chaque case, affiché pendant le nouveau calcul
const zonesDiakonos = { generation: 0 };

// Recalcule les pièces Diakonos manquantes : Diakonos de chaque dossier de lancement et Diakonos des tours.
function majDiakonos() {
  if (!estOngletSemaine()) return;
  const parite = onglet;
  remplirDiakonos();
  const autre = parite === "paire" ? "impaire" : "paire";
  const dossiers = groupesDiakonosDeLaSemaine(parite).filter((g) => {
    const e = derniersDiakonosDossier.get(g.porteur.id);
    return !e || e.cle !== cleDiakonosDossier(g);
  });
  const tours = diakonosDeLaSemaine(parite).some((p) => p.strat);
  if (!tours && !dossiers.length) return;
  const numero = ++zonesDiakonos.generation;
  (async () => {
    if (tours) {
      const resultats = await resultatsDiakonos(parite);
      for (const p of diakonosDeLaSemaine(parite)) {
        const r = resultats.find((x) => p.strat && x.fichier === p.strat.name && x.tour === tourDiakonos(p));
        if (r) derniersDiakonos.set(p.id, r);
      }
    }
    const toutes = [...pairesDeLaSemaine(parite), ...pairesDeLaSemaine(autre)];
    for (const g of dossiers) derniersDiakonosDossier.set(g.porteur.id, { cle: cleDiakonosDossier(g), r: await calculerDiakonosDossier(g, toutes) });
    if (numero === zonesDiakonos.generation && parite === onglet) remplirDiakonos();
  })();
}

// ---- Diakonos d'un lancement (« LAN264601STARTDIAKONOS.xlsx », rangé dans le dossier du lancement) :
// comparé aux lancements du même dossier (« 1ER TOUR AGGLO » : START et recyclage ; « FENO » : Feno et bis) ----

const derniersDiakonosDossier = new Map(); // id de la case qui porte le Diakonos → { cle, r }

// Groupe d'une case : les cases de l'onglet du même dossier, et celle qui porte le Diakonos (null s'il n'y en a pas).
// Le recyclage est comparé avec le Diakonos de son dossier (celui du 1er tour), mais sa case n'en montre
// que le sien s'il en a un.
function groupeDiakonosDossier(p) {
  if (estDiakonos(p)) return null;
  if (!p.dossier || p.poste === "Recyclage") return p.diakonos ? { porteur: p, membres: [p] } : null;
  const membres = pairesDeLaSemaine(p.parite).filter((o) => o.dossier === p.dossier);
  const porteur = membres.find((o) => o.diakonos && o.poste !== "Recyclage");
  return porteur ? { porteur, membres } : null;
}

function groupesDiakonosDeLaSemaine(parite) {
  const groupes = new Map();
  for (const p of pairesDeLaSemaine(parite)) {
    const g = groupeDiakonosDossier(p);
    if (g && !groupes.has(g.porteur)) groupes.set(g.porteur, g);
  }
  return [...groupes.values()];
}

const cleDiakonosDossier = (g) => [idFichier(g.porteur.diakonos), ...g.membres.filter((m) => m.strat).map((m) => idFichier(m.strat))].join("|");

async function calculerDiakonosDossier(g, toutes) {
  const r = { fichier: g.porteur.diakonos.name, dossier: g.porteur.dossier || "", nbPieces: 0, lancements: [], manquantes: [], ailleurs: new Map(), erreur: null };
  let pieces;
  try {
    pieces = await diakonosEnCache(g.porteur.diakonos);
  } catch (erreur) {
    r.erreur = erreur && erreur.message ? erreur.message : String(erreur);
    return r;
  }
  r.nbPieces = pieces.length;
  const lancees = new Set();
  for (const l of g.membres) {
    if (!l.strat) continue;
    for (const cle of (await resume(l.strat, l.bkp)).cles) lancees.add(cle);
    r.lancements.push(l.strat.name);
  }
  r.manquantes = pieces.filter((m) => !lancees.has(m.cle));
  // Pièce manquante retrouvée dans un autre lancement (autre dossier, autre semaine).
  for (const m of r.manquantes) {
    for (const l of toutes) {
      if (g.membres.includes(l) || !l.strat) continue;
      if ((await resume(l.strat, l.bkp)).cles.has(m.cle)) {
        r.ailleurs.set(m.cle, l.strat.name);
        break;
      }
    }
  }
  return r;
}

// Zones Diakonos d'une case : celle de son dossier de lancement, sinon celles de son tour
// (fichiers « diakonos46t1.xlsx » ; vides, seulement dans les cases Agglo).
function zonesDiakonosHtml(p) {
  if (groupeDiakonosDossier(p)) return `<div class="zone-diakonos" data-diakonos-case="${p.id}"></div>`;
  return diakonosDesCases(p)
    .filter((d) => d.strat || p.poste === "Agglo 1er tour" || p.poste === "Agglo 2ème tour")
    .map((d) => `<div class="zone-diakonos" data-diakonos="${d.id}"></div>`)
    .join("");
}

function remplirZoneDiakonosDossier(zone, p) {
  const g = groupeDiakonosDossier(p);
  if (!g) {
    zone.innerHTML = "";
    return;
  }
  const porteur = g.porteur;
  const e = derniersDiakonosDossier.get(porteur.id);
  const r = e && e.cle === cleDiakonosDossier(g) ? e.r : null;
  zone.innerHTML = `
    <div class="ligne-fichier">
      <div class="ligne-fichier-textes">
        <div class="ligne-fichier-libelle">Diakonos${porteur !== p ? ` de ${echapper(titreCase(porteur))}` : ""} (.xlsx)</div>
        <div class="ligne-fichier-nom ok" title="${echapper(porteur.diakonos.name)}">✓ ${echapper(porteur.diakonos.name)}</div>
      </div>
      <button type="button" class="contour" data-choisir-diakonos>Changer</button>
    </div>
    ${r ? htmlDiakonos(r) : '<div class="note">…</div>'}`;
  zone.querySelector("[data-choisir-diakonos]").addEventListener("click", () => demanderFichier(porteur, "diakonos"));
}

// Où sont cherchées les pièces : le tour (« des lancements du 1er tour »), le dossier, ou le seul lancement.
function porteeDiakonos(r) {
  if (r.dossier === undefined) {
    const tour = libelleTourDiakonos(r.tour);
    return { de: `des lancements du ${tour}`, dans: `dans les lancements du ${tour}`, aucun: `Aucun lancement du ${tour} (semaine ${r.semaine}) chargé` };
  }
  if (r.dossier) return { de: `des lancements du dossier « ${r.dossier} »`, dans: `dans les lancements du dossier « ${r.dossier} »`, aucun: `Aucun lancement chargé dans le dossier « ${r.dossier} »` };
  return { de: "du lancement", dans: "dans le lancement", aucun: "Aucun lancement chargé" };
}

function remplirDiakonos() {
  document.querySelectorAll(".zone-diakonos").forEach(remplirUneZoneDiakonos);
}

// Zone du Diakonos d'un dossier (data-diakonos-case : la case affichée) ou d'un tour (data-diakonos : la case Diakonos).
function remplirUneZoneDiakonos(zone) {
  const id = zone.dataset.diakonosCase || zone.dataset.diakonos;
  const p = paires.find((x) => String(x.id) === id);
  if (!p) return;
  if (zone.dataset.diakonosCase) remplirZoneDiakonosDossier(zone, p);
  else remplirZoneDiakonos(zone, p);
}

function remplirZoneDiakonos(zone, p) {
  const r = p.strat ? derniersDiakonos.get(p.id) : null;
  zone.innerHTML = `
    <div class="ligne-fichier">
      <div class="ligne-fichier-textes">
        <div class="ligne-fichier-libelle">Diakonos ${libelleTourDiakonos(tourDiakonos(p))} (.xlsx)</div>
        <div class="ligne-fichier-nom ${p.strat ? "ok" : "vide"}" title="${p.strat ? echapper(p.strat.name) : ""}">${p.strat ? `✓ ${echapper(p.strat.name)}` : "Aucun fichier"}</div>
      </div>
      <button type="button" class="contour" data-choisir-diakonos>${p.strat ? "Changer" : "Choisir"}</button>
    </div>
    ${p.etat ? `<div class="etat ${p.etatErreur ? "erreur" : ""}">${echapper(p.etat)}</div>` : ""}
    ${!p.strat ? "" : r && r.fichier === p.strat.name ? htmlDiakonos(r) : '<div class="note">…</div>'}`;
  zone.querySelector("[data-choisir-diakonos]").addEventListener("click", () => demanderFichier(p, "strat"));
}

function htmlDiakonos(r) {
  const portee = porteeDiakonos(r);
  if (r.erreur) return bandeau(`❌ Diakonos illisible : ${echapper(r.erreur)}`, "alerte");
  if (!r.lancements.length) return bandeau(`⚠ ${echapper(portee.aucun)}`, "attention");
  const ailleurs = r.manquantes.filter((m) => r.ailleurs.has(m.cle)).length;
  let html = r.manquantes.length
    ? bandeau(
        `⚠ ${r.manquantes.length} pièce(s) Diakonos absente(s) ${echapper(portee.de)}${ailleurs ? ` — dont ${ailleurs} lancée(s) dans un autre lancement` : ""}`,
        ailleurs === r.manquantes.length ? "attention" : "alerte"
      )
    : bandeau(`✔ Les ${r.nbPieces} pièces Diakonos sont ${echapper(portee.dans)}`, "ok");
  html += `<div class="note">Comparé à : ${r.lancements.map(echapper).join(", ")}</div>`;
  return html;
}

// ---- Rapport du lancement : sommaire Cut Rite (agglo, strats, couleurs) et Diakonos de son tour ----

function telecharger(nom, octets, type) {
  const url = URL.createObjectURL(new Blob([octets], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Case Diakonos du tour d'une case Agglo (null pour les autres cases).
function diakonosDeLaCase(p) {
  const tour = p.poste === "Agglo 1er tour" ? "1" : p.poste === "Agglo 2ème tour" ? "2" : null;
  return tour ? paireFixe(POSTES_DIAKONOS[tour === "2" ? 1 : 0], p.parite) : null;
}

// Tours dont une case montre le Diakonos : celui de l'Agglo, celui du code du lancement
// (LAN264601TRIGANO → 1er tour), sinon les deux (chantier sans tour). Rien pour une case vide, ni pour le
// Feno (contrôlé avec le Feno), le recyclage ou la casse (ses pièces viennent de plusieurs lancements, sans tour).
function toursDiakonosDeLaCase(p) {
  if (estDiakonos(p) || estFeno(p) || p.poste === "Recyclage" || estCasse(p, p.strat ? p.strat.name : "")) return [];
  if (p.poste === "Agglo 1er tour") return ["1"];
  if (p.poste === "Agglo 2ème tour") return ["2"];
  if (!p.strat) return [];
  const code = trouverCodeLancement(p.strat.name);
  const tour = code && code.length === 6 ? code.slice(4) : null;
  return tour === "01" ? ["1"] : tour === "02" ? ["2"] : ["1", "2"];
}

const diakonosDesCases = (p) => toursDiakonosDeLaCase(p).map((t) => paireFixe(POSTES_DIAKONOS[t === "2" ? 1 : 0], p.parite)).filter(Boolean);

// Une page par liste du sommaire (agglo, strats, couleurs), puis le Diakonos du tour ou, pour la casse, les pièces relancées et les rajouts.
async function rapportLancement(p) {
  const autre = p.parite === "paire" ? "impaire" : "paire";
  const semaine = pairesDeLaSemaine(p.parite);
  const numero = String(numeroSemaine(p.parite)).padStart(2, "0");
  const parties = [];
  let s = null;
  let erreurSommaire = null;
  if (p.sommaire) {
    // Sommaire illisible : le rapport sort quand même (Diakonos, casse), avec la raison en tête.
    try {
      s = lireSommaireCutRite(await extraireLignesTextePDF(await chargerDocumentPDF(p.sommaire)));
      parties.push(...partiesSommaire(s));
    } catch (erreur) {
      erreurSommaire = erreur && erreur.message ? erreur.message : String(erreur);
    }
  }
  const nomLancement = p.strat ? p.strat.name : s ? s.lancement : titreCase(p);
  const base = s ? baseSommaire(s) : baseLancement(nomLancement);
  if (erreurSommaire) {
    const partie = partieRapport("Sommaire", `${base} — Sommaire Cut Rite`, ["Fichier"], [180], 1);
    partie.total = false;
    [partie.statut, partie.couleurStatut] = [`Sommaire Cut Rite illisible : ${erreurSommaire}`, STATUT.ALERTE];
    partie.notes.push(["Fichier : ", p.sommaire.name]);
    parties.push(partie);
  }
  const groupe = groupeDiakonosDossier(p);
  const diakonos = diakonosDeLaCase(p);
  if (groupe) parties.push(partieDiakonos(await calculerDiakonosDossier(groupe, [...semaine, ...pairesDeLaSemaine(autre)]), base));
  else if (diakonos && diakonos.strat) parties.push(partieDiakonos(await calculerDiakonos(diakonos, numero, semaine, [...semaine, ...pairesDeLaSemaine(autre)]), base));
  const casse = estCasse(p, nomLancement);
  if (casse && p.strat) parties.push(...partiesCasse(await calculerCasse(p, pairesDeLaSemaine(autre), numeroSemaine(autre)), base));
  let nbPieces = null;
  if (p.strat) {
    const r = await resume(p.strat, p.bkp);
    if (!Number.isNaN(r.prevues)) nbPieces = String(Math.trunc(r.prevues));
  }
  const sem = p.semaine || (s ? extraireSemaine(s.lancement) : null);
  const couleur = couleurSemaine(parseInt(sem || numero, 10), casse);
  const enTete = titreCase(p);
  const sousTitre = s ? sousTitreSommaire(s) : nomLancement.replace(/\.[A-Za-z]+$/, "");
  return { nom: `${base}_rapport_lancement.pdf`, octets: rapportLancementPdf(`${base} — Rapport du lancement`, enTete, sousTitre, sem || numero, nbPieces, couleur, parties) };
}

// Page Diakonos du rapport du lancement.
function partieDiakonos(r, base) {
  const portee = porteeDiakonos(r);
  const titre = r.dossier === undefined ? `Diakonos ${libelleTourDiakonos(r.tour)}` : "Diakonos";
  const p = partieRapport("Diakonos", `${base} — ${titre}`, ["Commande + ligne", "Article", "Dimensions", "Coloris", "Lancée ailleurs"], [36, 34, 28, 20, 64], 5);
  p.total = false;
  if (r.erreur) [p.statut, p.couleurStatut] = [`Diakonos illisible : ${r.erreur}`, STATUT.ALERTE];
  else if (!r.lancements.length) [p.statut, p.couleurStatut] = [portee.aucun, STATUT.ATTENTION];
  else if (!r.manquantes.length) [p.statut, p.couleurStatut] = [`Les ${r.nbPieces} pièces Diakonos sont ${portee.dans}`, STATUT.OK];
  else [p.statut, p.couleurStatut] = [`${r.manquantes.length} pièce(s) Diakonos absente(s) ${portee.de}`, STATUT.ALERTE];
  for (const m of r.manquantes) p.rangees.push([m.cle, m.article, dimensionsDiakonos(m), m.coloris, r.ailleurs.get(m.cle) || ""]);
  p.notes.push(["Fichier Diakonos : ", r.fichier]);
  if (r.lancements.length) p.notes.push(["Comparé à : ", r.lancements.join(", ")]);
  return p;
}

// Casse (case Casse ou lancement « …CASSE ») : le rapport détaille les pièces relancées et les rajouts.
const estCasse = (p, nomLancement) => p.poste === "Casse" || /CASSE/i.test(nomLancement || "");

async function exporterLancement(p) {
  const diakonos = diakonosDeLaCase(p);
  if (!p.sommaire && !(diakonos && diakonos.strat) && !groupeDiakonosDossier(p) && !(p.strat && estCasse(p, p.strat.name))) {
    alert(`${titreCase(p)} : ajoutez le sommaire Cut Rite${diakonos ? " (ou le fichier Diakonos)" : ""} pour faire le rapport du lancement.`);
    return;
  }
  const { nom, octets } = await rapportLancement(p);
  telecharger(nom, octets, "application/pdf");
}

// ---- Rapport de toute la semaine (.xlsx) ----
// Feuille 1 : le tableau des lancements et les alertes de la semaine.
// Feuille 2 : toutes les anomalies, lancement par lancement (contrôle,
// Scies, couleurs, semaines de livraison, doublons).

async function exporterSemaine(parite) {
  const { nom, octets } = await rapportSemaineXlsx(parite);
  telecharger(nom, octets, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

// ---- Compteur ----

async function majCompteur() {
  if (!estOngletSemaine()) return;
  const parite = onglet;
  let total = 0;
  for (const p of pairesDeLaSemaine(parite)) {
    if (!p.bkp) continue;
    const r = await resume(p.strat, p.bkp);
    if (r.bkp !== null && !Number.isNaN(r.bkp)) total += r.bkp;
  }
  const zone = $("texteCompteur");
  if (zone && onglet === parite) zone.innerHTML = `<span class="valeur">${fmtNombre(total)}</span><span class="legende">pièces dans les .bkp</span>`;
}

// ---- Tableau des lancements ----

function lignesRecap(pairesSemaine) {
  const lignes = [];
  for (const p of pairesSemaine) {
    if (!p.strat) continue;
    const nom = p.strat.name;
    const r = resumeEnCache(p.strat, p.bkp);
    lignes.push({
      paire: p,
      semaine: p.semaine,
      nom: estChantier(p) ? p.label : p.poste,
      lancement: nom.includes(".") ? nom.slice(0, nom.lastIndexOf(".")) : nom,
      prevues: r ? r.prevues : null,
      bkp: r ? r.bkp : null,
      cles: r ? r.cles : null,
    });
  }
  const num = (l) => {
    const n = parseInt(l.semaine, 10);
    return Number.isNaN(n) ? Infinity : n;
  };
  // Tri stable : à semaine égale, l'ordre des cases.
  return lignes.map((l, i) => [l, i]).sort((a, b) => num(a[0]) - num(b[0]) || a[1] - b[1]).map((x) => x[0]);
}

function majRecap() {
  if (onglet === "accueil") {
    afficherAccueil();
    return;
  }
  majListePostes();
  const zone = $("zoneRecap");
  if (!zone || !estOngletSemaine()) return;
  const parite = onglet;
  const numero = ++zonesRecap.generation;
  const autre = parite === "paire" ? "impaire" : "paire";
  const lignes = lignesRecap(pairesDeLaSemaine(parite));
  const autres = lignesRecap(pairesDeLaSemaine(autre));
  zone.innerHTML = htmlRecap(lignes, autres, libelleOnglet(autre));
  zone.querySelectorAll("[data-case]").forEach((el) => el.addEventListener("click", () => montrerCase(Number(el.dataset.case))));
  const incomplet = (ls) => ls.some((l) => l.cles === null);
  if (!incomplet(lignes) && !incomplet(autres)) return;
  // Lecture des fichiers pour les totaux manquants, puis nouvel affichage.
  (async () => {
    for (const l of [...lignes, ...autres]) await resume(l.paire.strat, l.paire.bkp);
    if (numero === zonesRecap.generation && parite === onglet) majRecap();
  })();
}

const nombreRecap = (v) => (v === null || v === undefined ? "…" : Number.isNaN(v) ? "?" : fmtNombre(v));

function celluleControle(p) {
  if (p.enCours) return '<td class="centre gris">⏳</td>';
  if (!p.rapport) return '<td class="centre pale">—</td>';
  if (p.rapport.nbAnomalies === 0) return '<td class="centre ok">✔ OK</td>';
  return `<td class="centre alerte">⚠ ${p.rapport.nbAnomalies}</td>`;
}

function celluleScies(p) {
  if (p.erreurScies) return '<td class="centre alerte">❌</td>';
  if (!p.ecartsScies) return '<td class="centre pale">—</td>';
  if (p.ecartsScies.length === 0) return '<td class="centre ok">✔ OK</td>';
  return `<td class="centre alerte">⚠ ${p.ecartsScies.length}</td>`;
}

function celluleCouleurs(p) {
  if (!p.couleurs || p.couleurs.sansStratifie) return '<td class="centre pale">—</td>';
  if (p.couleurs.absentes.length) return `<td class="centre alerte">⚠ ${p.couleurs.absentes.length}</td>`;
  return '<td class="centre ok">✔ OK</td>';
}

function totauxRecap(lignes) {
  const t = { prevues: 0, bkp: 0, prevuesConnues: true, bkpConnus: true, auMoinsUnBkp: false, anomalies: 0, ecarts: 0, couleurs: 0, couleursPf: 0 };
  for (const l of lignes) {
    if (l.prevues === null || Number.isNaN(l.prevues)) t.prevuesConnues = false;
    else t.prevues += l.prevues;
    if (l.paire.bkp) {
      t.auMoinsUnBkp = true;
      if (l.bkp === null) t.bkpConnus = false;
      else t.bkp += l.bkp;
    }
    if (l.paire.rapport) t.anomalies += l.paire.rapport.nbAnomalies;
    if (l.paire.ecartsScies) t.ecarts += l.paire.ecartsScies.length;
    if (l.paire.couleurs) {
      t.couleurs += l.paire.couleurs.absentes.length;
      t.couleursPf += (l.paire.couleurs.variantes || []).length;
    }
  }
  return t;
}

function ligneTotalRecap(libelle, t) {
  const alerte = (n) => `<td class="centre alerte">${n > 0 ? `⚠ ${n}` : ""}</td>`;
  return `<tr class="total"><td>${echapper(libelle)}</td><td class="droite">${t.prevuesConnues ? fmtNombre(t.prevues) : "…"}</td>
    <td class="droite">${!t.auMoinsUnBkp ? "—" : t.bkpConnus ? fmtNombre(t.bkp) : "…"}</td>${alerte(t.anomalies)}${alerte(t.ecarts)}${alerte(t.couleurs)}</tr>`;
}

const nomLancementRecap = (l) => `${l.nom} (${l.lancement})`;

function htmlRecap(lignes, autres, libelleAutre) {
  if (lignes.length === 0) return '<div class="note">Aucun lancement.</div>';
  const semaines = new Set(lignes.map((l) => l.semaine));
  const plusieurs = semaines.size > 1;
  let html = `<table class="recap"><thead><tr><th>Poste</th><th class="droite">Prévues</th><th class="droite">.bkp</th>
    <th class="centre">Contrôle</th><th class="centre">Scies</th><th class="centre">Couleurs</th></tr></thead><tbody>`;
  let i = 0;
  while (i < lignes.length) {
    const semaine = lignes[i].semaine;
    if (plusieurs) html += `<tr class="titre-semaine"><td colspan="6">Semaine ${echapper(semaine ?? "?")}</td></tr>`;
    const groupe = [];
    for (; i < lignes.length && lignes[i].semaine === semaine; i++) groupe.push(lignes[i]);
    groupe.forEach((l, n) => {
      const p = l.paire;
      html += `<tr class="${n % 2 ? "impaire" : ""} cliquable" data-case="${p.id}">
        <td><strong>${echapper(l.nom)}</strong><br><span class="lancement">${echapper(l.lancement)}</span></td>
        <td class="droite">${nombreRecap(l.prevues)}</td>
        <td class="droite ${p.bkp ? "" : "pale"}">${p.bkp ? nombreRecap(l.bkp) : "—"}</td>
        ${celluleControle(p)}${celluleScies(p)}${celluleCouleurs(p)}</tr>`;
    });
    if (plusieurs) html += ligneTotalRecap(`Total sem. ${semaine ?? "?"}`, totauxRecap(groupe));
  }
  html += ligneTotalRecap("Total", totauxRecap(lignes));
  html += "</tbody></table>";
  html += htmlDoublonsRecap(lignes) + htmlDejaLancees(lignes, autres, libelleAutre) + htmlAutresSemainesLivraison(lignes);
  return html;
}

const alerteRecap = (texte, genre) => `<div class="alertes-recap"><div class="titre-alerte ${genre}">${texte}</div></div>`;

// Pièces présentes dans plusieurs lancements de l'onglet : risque de les fabriquer deux fois.
function htmlDoublonsRecap(lignes) {
  if (lignes.some((l) => l.cles === null)) return "";
  const groupes = doublonsEntreLancements(new Map(lignes.map((l) => [nomLancementRecap(l), l.cles])));
  const n = groupes.reduce((t, g) => t + g.cles.length, 0);
  return n ? alerteRecap(`⚠ ${n} pièce(s) lancée(s) deux fois : elles sont dans deux lancements`, "alerte") : "";
}

// Pièces déjà présentes dans un lancement de l'autre onglet semaine (relancées, ou lancées en double).
// La casse reprend par nature des pièces déjà lancées : elle a sa propre analyse, dans sa case.
function htmlDejaLancees(lignes, autres, libelleAutre) {
  lignes = lignes.filter((l) => l.paire.poste !== "Casse");
  autres = autres.filter((l) => l.paire.poste !== "Casse");
  if (lignes.some((l) => l.cles === null) || autres.some((l) => l.cles === null)) return "";
  const communes = new Set();
  for (const l of lignes) for (const o of autres) for (const cle of l.cles) if (o.cles.has(cle) && cle.length > 3) communes.add(cle);
  return communes.size ? alerteRecap(`⚠ ${communes.size} pièce(s) déjà lancée(s) en ${echapper(libelleAutre)}`, "alerte") : "";
}

// Pièces à livrer une autre semaine que le reste de leur lancement (hors casse, qui en reprend toujours).
function htmlAutresSemainesLivraison(lignes) {
  let n = 0;
  for (const l of lignes) {
    const p = l.paire;
    if (p.semainesLivraison.length <= 1 || p.poste === "Casse") continue;
    const principale = semainePrincipale(p);
    for (const s of p.semainesLivraison) if (s !== principale) n += s.nbPieces;
  }
  return n ? alerteRecap(`⚠ ${n} pièce(s) à livrer une autre semaine que leur lancement`, "attention") : "";
}

// ---- Fichiers ----

let fichierEnAttente = null;

function demanderFichier(p, role) {
  fichierEnAttente = { p, role };
  const input = $("choixFichier");
  input.value = "";
  input.accept = role === "strat" || role === "diakonos" ? ".xlsx,.xlsm,.xls" : role === "coupe" ? ".xlsx,.xlsm,.xls,.pdf" : role === "sommaire" ? ".pdf" : ".bkp";
  input.click();
}

async function fichierChoisi() {
  const input = $("choixFichier");
  const fichier = input.files[0];
  const attente = fichierEnAttente;
  fichierEnAttente = null;
  if (!fichier || !attente) return;
  const { p, role } = attente;
  const motCle = estDiakonos(p) || role === "diakonos" ? "Diakonos" : role === "strat" ? "LAN" : role === "coupe" ? "coupe" : role === "sommaire" ? ".pdf" : ".bkp";
  const type = estDiakonos(p) || role === "diakonos"
    ? "Diakonos"
    : role === "strat" ? "lancement" : role === "coupe" ? "liste de coupe" : role === "sommaire" ? "sommaire Cut Rite" : "sauvegarde d'optimisation";
  if (!fichier.name.toLowerCase().includes(motCle.toLowerCase())) {
    alert(`« ${fichier.name} » ne ressemble pas à un fichier ${type} (le nom devrait contenir « ${motCle} »).\nSélection annulée.`);
    return;
  }
  if (role === "sommaire") {
    try {
      lireSommaireCutRite(await extraireLignesTextePDF(await chargerDocumentPDF(fichier)));
    } catch (erreur) {
      alert(`Impossible de lire « ${fichier.name} » : ${erreur && erreur.message ? erreur.message : erreur}`);
      return;
    }
  }
  const ancien = p[role];
  p[role] = fichier;
  if (!estDiakonos(p) && !memeFichier(ancien, fichier)) oublierResultatsDe(p, role);
  let deplace = false;
  if (estDiakonos(p)) {
    p.semaine = decoderNomDiakonos(fichier.name).semaine;
  } else if (role === "strat") {
    // Fichier choisi à la main : pas de dossier de semaine.
    p.semaineDossier = null;
    p.semaine = await detecterSemaine(p);
    deplace = ranger(p);
  }
  await memoriserFichier(p, role, fichier);
  enregistrer(p);
  if (role === "strat" && estChantier(p)) afficher();
  else rafraichir(p);
  if (role === "bkp") majCompteur();
  if (deplace) alert(`${p.label} : lancement de la semaine ${p.semaine}, rangé dans l'onglet ${libelleOnglet(p.parite)}.`);
}

// ---- Contrôles ----

async function lancerUnePaire(p, fin) {
  const seul = !fin;
  const terminer = (erreur, resultat) => {
    if (fin) fin(erreur, resultat);
  };
  if (!p.strat && !p.coupe && !p.bkp) {
    p.etat = null;
    p.etatErreur = false;
    rafraichir(p);
    return terminer(null, false);
  }
  if (!p.strat) {
    const msg = `${nomComplet(p)} : sélectionnez le fichier de lancement.`;
    p.etat = "❌ fichier de lancement manquant";
    p.etatErreur = true;
    rafraichir(p);
    if (seul) alert(msg);
    return terminer(msg, false);
  }
  if (!p.coupe && !p.bkp) {
    p.etat = "Il manque la liste de coupe ou le .bkp";
    p.etatErreur = false;
    rafraichir(p);
    return terminer(null, false);
  }
  p.enCours = true;
  p.etat = "⏳ lecture du fichier de lancement…";
  p.etatErreur = false;
  rafraichir(p);
  await tick();
  let etape = "lecture du fichier de lancement";
  try {
    const strat = await stratEnCache(p.strat);
    p.etat = p.coupe ? "⏳ lecture de la liste de coupe…" : "⏳ comparaison avec le .bkp…";
    rafraichir(p);
    await tick();
    p.doublons = strat.doublons;
    p.semainesLivraison = strat.semaines;
    const clesStrat = new Set(strat.lignes.map((l) => l.cle));
    const qteAttendueParCle = new Map(strat.lignes.map((l) => [l.cle, l.qte_attendue]));
    let trouve;
    if (p.coupe) {
      etape = "lecture de la liste de coupe (Cutrite)";
      const r = lireCoupeDepuisSource(await sourceCoupeEnCache(p.coupe), clesStrat, qteAttendueParCle);
      trouve = r.compteur;
      p.nbUnitaires = r.nbUnitaires;
      p.nbPiecesTrouvees = r.nbPiecesTrouvees;
      p.source = "coupe";
    } else {
      etape = "lecture du fichier .bkp";
      // Les panneaux de protection du .bkp ne sont pas des pièces (le lancement ne les compte pas).
      trouve = await lireBkpSansProtections(p.bkp);
      p.nbUnitaires = null;
      p.nbPiecesTrouvees = null;
      p.source = "bkp";
    }
    etape = "comparaison";
    p.rapport = comparer(strat.lignes, trouve);
    p.enCours = false;
    p.etat = null;
    p.etatErreur = false;
    enregistrer(p);
    rafraichir(p);
    return terminer(null, true);
  } catch (erreur) {
    const message = `échec à l'étape « ${etape} » : ${erreur && erreur.message ? erreur.message : erreur}`;
    // L'ancien résultat ne doit pas rester affiché comme s'il était bon.
    p.rapport = null;
    enregistrer(p);
    p.enCours = false;
    p.etat = `❌ ${message}`;
    p.etatErreur = true;
    rafraichir(p);
    const msg = `${nomComplet(p)} : ${message}`;
    if (seul) alert(msg);
    return terminer(msg, false);
  }
}

async function lancerTousLesControles() {
  const parite = onglet;
  const visibles = pairesDeLaSemaine(parite);
  const erreurs = [];
  let auMoinsUnResultat = visibles.some((p) => p.rapport);
  for (const p of visibles) {
    await lancerUnePaire(p, (erreur, resultat) => {
      if (erreur) erreurs.push(erreur);
      if (resultat) auMoinsUnResultat = true;
    });
  }
  const rapport = await rapportSemaineAutomatique(parite);
  if (rapport.nbProblemes) for (const p of visibles) rafraichir(p);
  await archiverOnglet(parite, rapport.lancements);
  if (erreurs.length) alert("Certaines cases n'ont pas pu être traitées :\n\n" + erreurs.join("\n"));
  else if (!auMoinsUnResultat) alert("Sélectionnez au moins un fichier de lancement (avec, si possible, une liste de coupe ou un .bkp).");
}

// Contrôle Scies : lancement (protections comprises) contre ce qui a été
// réellement optimisé, puis contrôle des couleurs.
async function lancerControleScies(p, fin) {
  if (!p.strat) {
    alert(`${nomComplet(p)} : sélectionnez d'abord le fichier de lancement.`);
    if (fin) fin();
    return;
  }
  if (!p.bkp) {
    alert(`${nomComplet(p)} : sélectionnez le fichier .bkp à vérifier.`);
    if (fin) fin();
    return;
  }
  p.enCours = true;
  p.etat = "⏳ contrôle Scies…";
  p.etatErreur = false;
  rafraichir(p);
  await tick();
  let etape = "lecture du fichier de lancement";
  try {
    const classeur = await classeurEnCache(p.strat);
    const attendues = lireQuantitesAttenduesScies(classeur);
    etape = "lecture du fichier .bkp";
    const bkp = await lireBkp(p.bkp);
    etape = "comparaison";
    p.ecartsScies = comparerScies(attendues, bkp);
    p.totalScies = sommeValeurs(attendues);
    etape = "contrôle des couleurs";
    p.couleurs = controlerCouleurs((await stratEnCache(p.strat)).lignes, await lireCouleursBkp(p.bkp));
    p.erreurScies = null;
  } catch (erreur) {
    p.ecartsScies = null;
    p.totalScies = null;
    p.couleurs = null;
    p.erreurScies = `échec à l'étape « ${etape} » : ${erreur && erreur.message ? erreur.message : erreur}`;
  }
  enregistrer(p);
  p.enCours = false;
  p.etat = null;
  rafraichir(p);
  majCompteur();
  if (fin) fin();
}

async function reinitialiserSemaine() {
  const parite = onglet;
  const ok = await demanderConfirmation(
    `Réinitialiser « ${libelleOnglet(parite)} » ?`,
    "Toutes les cases de cette semaine (y compris Chantiers) seront vidées. Cette action est irréversible.",
    "Oui"
  );
  if (!ok) return;
  for (const p of [...pairesDeLaSemaine(parite), ...diakonosDeLaSemaine(parite)]) await reinitialiser(p);
  afficher();
}

async function retirerChantier(p) {
  if (!(await demanderConfirmation(`Retirer définitivement « ${p.label} » ?`, "Ses fichiers et résultats seront effacés.", "Oui"))) return;
  await effacerMemoire(p);
  paires.splice(paires.indexOf(p), 1);
  afficher();
}

// ---- Dossier partagé ----

const etatsScan = { paire: null, impaire: null }; // { lignes, erreur }
const scansEnCours = new Set();

function remplirCarteDossier(parite) {
  const carte = $("carteDossier");
  if (!carte) return;
  const handle = dossierPartageHandles[parite];
  const etat = etatsScan[parite];
  const racine = typeof reecriture !== "undefined" ? reecriture.racine : null;
  carte.innerHTML = `
    <div class="carte-titre">Dossier de la semaine</div>
    ${
      typeof window.showDirectoryPicker === "function"
        ? `<div class="ouvrir-semaine">
      <label>Semaine<input type="number" id="champSemaineControle" min="1" max="53" value="${numeroSemaine(parite)}"></label>
      <button type="button" id="btnOuvrirSemaine" ${scansEnCours.size ? "disabled" : ""}>Ouvrir et contrôler</button>
      <span class="note">Cherchée dans « ${racine ? echapper(racine.name) : "le dossier des semaines"} »${racine ? "" : " (à choisir dans le menu à gauche)"}, sous-dossiers compris.</span>
    </div>`
        : ""
    }
    ${handle ? `<div class="note">Dossier ouvert : <strong>${echapper(handle.name)}</strong></div>` : ""}
    <div class="boutons-carte">
      <button type="button" class="contour" id="btnChoisirDossier">${handle ? "Choisir un autre dossier" : "Choisir le dossier à la main"}</button>
      <button type="button" id="btnScanner" ${handle && !scansEnCours.has(parite) ? "" : "disabled"}>Scanner</button>
    </div>
    ${etat ? `<div class="compte-rendu ${etat.erreur ? "erreur" : ""}">${etat.lignes.map(echapper).join("<br>")}</div>` : ""}
  `;
  $("btnChoisirDossier").addEventListener("click", () => choisirDossier(parite));
  $("btnScanner").addEventListener("click", () => scannerDossier(parite));
  const ouvrir = $("btnOuvrirSemaine");
  if (ouvrir) {
    ouvrir.addEventListener("click", () => ouvrirSemaine(parite, $("champSemaineControle").value));
    $("champSemaineControle").addEventListener("keydown", (e) => {
      if (e.key === "Enter") ouvrirSemaine(parite, e.target.value);
    });
  }
}

// « Ouvrir et contrôler » : le dossier « Semaine NN » est cherché dans le dossier des semaines (« Lancement »,
// année / mois compris), devient le dossier de l'onglet de cette semaine, puis il est scanné.
async function ouvrirSemaine(pariteActuelle, valeur) {
  const n = parseInt(valeur, 10);
  if (Number.isNaN(n) || n < 1 || n > 53) {
    compteRendu(pariteActuelle, ["Tapez un numéro de semaine entre 1 et 53."], true);
    return;
  }
  const parite = n % 2 === 0 ? "paire" : "impaire";
  const libelle = `Semaine ${String(n).padStart(2, "0")}`;
  let racine = typeof reecriture !== "undefined" ? reecriture.racine : null;
  if (!racine) {
    await choisirRacineReecriture();
    racine = reecriture.racine;
    if (!racine) return;
  }
  try {
    if (racine.queryPermission && (await racine.queryPermission({ mode: "read" })) !== "granted") {
      if ((await racine.requestPermission({ mode: "read" })) !== "granted") throw new Error("accès refusé");
    }
    let trouves = numeroDossierSemaine(racine.name) === n ? [{ dossier: racine, chemin: [] }] : await chercherDossiersSemaine(racine, n);
    // Plusieurs années : celle qui correspond au calendrier.
    if (trouves.length > 1) {
      const annee = String(anneeDeSemaine(n));
      const memeAnnee = trouves.filter((t) => t.chemin.some((c) => c.includes(annee)));
      if (memeAnnee.length === 1) trouves = memeAnnee;
    }
    if (!trouves.length) {
      compteRendu(pariteActuelle, [`Aucun dossier « ${libelle} » dans « ${racine.name} ».`], true);
      return;
    }
    if (trouves.length > 1) {
      compteRendu(pariteActuelle, [`Plusieurs dossiers « ${libelle} » dans « ${racine.name} » : ${trouves.map((t) => t.chemin.join(" / ")).join(" ; ")}. Choisissez le bon à la main.`], true);
      return;
    }
    const dossier = trouves[0].dossier;
    dossierPartageHandles[parite] = dossier;
    sauvegarderPoigneeDossierPartage(dossier, parite);
    etatsScan[parite] = null;
    if (onglet !== parite) {
      onglet = parite;
      afficher();
    } else remplirCarteDossier(parite);
    await scannerDossier(parite);
  } catch (erreur) {
    compteRendu(pariteActuelle, [`Ouverture impossible : ${erreur && erreur.message ? erreur.message : erreur}`], true);
  }
}

function compteRendu(parite, lignes, erreur) {
  etatsScan[parite] = { lignes, erreur };
  if (parite === onglet) remplirCarteDossier(parite);
}

async function choisirDossier(parite) {
  if (!scanPartageDisponible()) {
    compteRendu(parite, ["Non disponible : ouvrez la page dans Chrome ou Edge sur PC."], true);
    return;
  }
  if (androidDossierPartageDisponible()) {
    window.__androidDossierChoisi = (treeUri, nom, pariteChoisie) => {
      dossierPartageHandles[pariteChoisie] = creerPoigneeDossierAndroid(treeUri, nom);
      etatsScan[pariteChoisie] = null;
      if (pariteChoisie === onglet) remplirCarteDossier(pariteChoisie);
    };
    window.AndroidDossierPartage.choisirDossier(parite);
    return;
  }
  try {
    const handle = await window.showDirectoryPicker();
    dossierPartageHandles[parite] = handle;
    sauvegarderPoigneeDossierPartage(handle, parite);
    etatsScan[parite] = null;
    if (parite === onglet) remplirCarteDossier(parite);
  } catch (_annulation) {
    // Sélection annulée : rien à faire.
  }
}

// Retrouve, pour chaque onglet, le dossier choisi la dernière fois (le
// navigateur peut redemander une confirmation d'accès au premier scan).
async function restaurerDossiersPartages() {
  if (!scanPartageDisponible()) return;
  if (androidDossierPartageDisponible()) {
    for (const parite of ["paire", "impaire"]) {
      try {
        const brut = window.AndroidDossierPartage.dossierMemorise(parite);
        const memoire = brut && brut !== "null" ? JSON.parse(brut) : null;
        if (memoire) dossierPartageHandles[parite] = creerPoigneeDossierAndroid(memoire.treeUri, memoire.nom);
      } catch (_erreur) {
        // pas de dossier mémorisé pour cette semaine
      }
    }
    return;
  }
  for (const parite of ["paire", "impaire"]) {
    const handle = await chargerPoigneeDossierPartage(parite);
    if (handle) dossierPartageHandles[parite] = handle;
  }
}

async function scannerDossier(parite) {
  const handle = dossierPartageHandles[parite];
  if (!handle) {
    compteRendu(parite, ["Choisissez d'abord un dossier."], true);
    return;
  }
  if (scansEnCours.has(parite)) return;
  scansEnCours.add(parite);
  compteRendu(parite, ["Scan en cours…"], false);
  const fichiers = [];
  try {
    if (handle.queryPermission && (await handle.queryPermission({ mode: "read" })) !== "granted") {
      if ((await handle.requestPermission({ mode: "read" })) !== "granted") throw new Error("accès refusé");
    }
    await autoriserBibliothequeAuClic();
    await listerDossier(handle, [], fichiers);
  } catch (erreur) {
    scansEnCours.delete(parite);
    compteRendu(parite, [`Dossier illisible : ${erreur && erreur.message ? erreur.message : erreur}. Rechoisissez-le.`], true);
    return;
  }
  try {
    const r = repartirFichiersDossier(fichiers, parite, handle.name);
    r.dossiersLus = dossiersLus(fichiers);
    await placerFichiersScannes(parite, r);
  } catch (erreur) {
    // Jamais de bouton « Scanner » bloqué : l'erreur s'affiche et on peut relancer.
    scansEnCours.delete(parite);
    compteRendu(parite, [`Scan interrompu : ${erreur && erreur.message ? erreur.message : erreur}`], true);
  }
}

// « 1ER TOUR AGGLO (7 fichiers), FENO (7 fichiers)… » : ce que le scan a vu, sous-dossier par sous-dossier.
function dossiersLus(fichiers) {
  const parDossier = new Map();
  for (const f of fichiers) {
    const nom = f.chemin && f.chemin.length ? f.chemin.join("/") : "";
    parDossier.set(nom, (parDossier.get(nom) || 0) + 1);
  }
  return [...parDossier.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([nom, n]) => `${nom || "dossier principal"} (${n} fichier${n > 1 ? "s" : ""})`);
}

// Fichiers du dossier et de ses sous-dossiers (un par lancement : « 1ER TOUR AGGLO », « FENO »…),
// chacun avec son chemin ; les fichiers de verrou d'Excel (« ~$… ») et les fichiers cachés sont ignorés.
async function listerDossier(handle, chemin, fichiers, profondeur = 3) {
  for await (const [nom, entree] of handle.entries()) {
    if (nom.startsWith("~$") || nom.startsWith(".")) continue;
    if (entree.kind === "directory") {
      if (chemin.length < profondeur) await listerDossier(entree, [...chemin, nom], fichiers, profondeur);
      continue;
    }
    if (entree.kind !== "file") continue;
    // La date ne sert qu'à départager deux fichiers de lancement d'un même poste.
    const date = estFichierDeLancement(nom) ? (await entree.getFile()).lastModified : 0;
    fichiers.push({ nom, date, entree, chemin });
  }
}

async function placerFichiersScannes(parite, r) {
  if (r.aucunLancement && !r.diakonos.length) {
    scansEnCours.delete(parite);
    compteRendu(parite, ["Aucun lancement dans ce dossier.", ...(r.dossiersLus && r.dossiersLus.length ? [`Dossiers lus : ${r.dossiersLus.join(", ")}`] : [])], true);
    return;
  }
  const lignes = [];
  const affectations = [];
  for (const g of r.fixes) {
    const p = paireFixe(g.poste, g.parite);
    if (!p) {
      lignes.push(`— ${g.poste} : case introuvable`);
      continue;
    }
    affectations.push({ cible: g, paire: p, libelle: g.poste, copie: false });
  }
  for (const g of r.chantiers) {
    const identite = `${g.code}|${g.suffixe}`;
    let p = paires.find((c) => estChantier(c) && c.codeLancement === identite);
    if (!p) {
      p = ajouterChantier(g.parite);
      p.codeLancement = identite;
      sauvegarderDansMemoire(p, { semaineParite: g.parite, codeLancement: identite });
    }
    affectations.push({ cible: g, paire: p, libelle: p.label, copie: false });
  }
  // Un lancement qui a maintenant sa case (ex. le recyclage, chantier dans les versions d'avant) n'est plus un chantier.
  for (const g of r.fixes) {
    for (const c of paires.filter((x) => estChantier(x) && x.codeLancement === `${g.code}|${g.suffixe}`)) {
      await effacerMemoire(c);
      paires.splice(paires.indexOf(c), 1);
    }
  }
  for (const a of affectations) {
    a.paire.etat = "⏳ fichiers du dossier partagé…";
    a.paire.etatErreur = false;
  }
  if (parite === onglet) afficher();
  const stockage = [];
  // Un fichier inchangé depuis le dernier scan (même nom, taille, date) garde sa lecture en cache et n'est pas recopié.
  const prendre = async (p, role, entree) => {
    const f = await entree.getFile();
    if (!memeFichier(p[role], f)) {
      p[role] = f;
      stockage.push(memoriserFichier(p, role, f));
    }
    return p[role];
  };
  for (const a of affectations) {
    const p = a.paire;
    const g = a.cible;
    try {
      const ancienLancement = p.strat;
      await prendre(p, "strat", g.strat.entree);
      const nouveauLancement = !memeFichier(ancienLancement, p.strat);
      if (nouveauLancement) {
        viderResultats(p);
        for (const role of ["coupe", "bkp", "sommaire"]) if (!g[role] && p[role]) await oublierFichier(p, role);
        if (!g.dossier && !g.diakonos && p.diakonos) await oublierFichier(p, "diakonos");
      }
      p.semaineDossier = g.semaineDossier || null;
      p.semaine = await detecterSemaine(p);
      const deplace = ranger(p);
      let suffixe = "";
      if (g.coupe) {
        await prendre(p, "coupe", g.coupe.entree);
        suffixe = " + coupe";
      }
      if (g.bkp) {
        await prendre(p, "bkp", g.bkp.entree);
        suffixe += " + .bkp";
      }
      if (g.sommaire) {
        await prendre(p, "sommaire", g.sommaire.entree);
        suffixe += " + sommaire";
      }
      // Rangé par dossier : le dossier et son Diakonos remplacent ceux d'avant.
      p.dossier = g.dossier || null;
      if (g.dossier || g.diakonos) {
        if (g.diakonos) {
          await prendre(p, "diakonos", g.diakonos.entree);
          suffixe += " + Diakonos";
        } else if (p.diakonos) await oublierFichier(p, "diakonos");
      }
      enregistrer(p);
      a.copie = true;
      lignes.push(`✔ ${a.libelle} : ${g.strat.nom}${suffixe}${g.dossier ? ` (dossier ${g.dossier})` : ""}${deplace ? ` → semaine ${p.semaine}` : ""}`);
    } catch (erreur) {
      enregistrer(p);
      lignes.push(`❌ ${a.libelle} : ${erreur && erreur.message ? erreur.message : erreur}`);
    }
  }
  const diakonosPlaces = [];
  for (const d of r.diakonos) {
    const p = paireFixe(POSTES_DIAKONOS[d.tour === "2" ? 1 : 0], parite);
    diakonosPlaces.push(p);
    try {
      await prendre(p, "strat", d.fichier.entree);
      p.semaine = d.semaine;
      lignes.push(`✔ ${p.poste} : ${d.fichier.nom}`);
    } catch (erreur) {
      lignes.push(`❌ ${p.poste} : ${erreur && erreur.message ? erreur.message : erreur}`);
    }
    enregistrer(p);
  }
  const placees = new Set([...affectations.filter((a) => a.copie).map((a) => a.paire), ...diakonosPlaces]);
  if (affectations.some((a) => a.copie)) {
    const semaineScan = semaineAffichee(affectations.filter((a) => a.copie).map((a) => a.paire.semaine), parite);
    // Une casse de la semaine N se fabrique en N+1 : elle appartient à l'onglet N+1.
    const deLaSemaine = (p) => {
      const n = parseInt(p.semaine, 10);
      return Number.isNaN(n) || n === semaineScan || (p.poste === "Casse" && (n % 52) + 1 === semaineScan);
    };
    for (const p of [...pairesDeLaSemaine(parite), ...diakonosDeLaSemaine(parite)]) {
      if (placees.has(p) || !p.strat || deLaSemaine(p)) continue;
      const ancienne = `${titreCase(p)} : ${p.strat.name} (semaine ${p.semaine}) retiré, ce n'est pas la semaine ${semaineScan}`;
      if (estChantier(p)) {
        await effacerMemoire(p);
        paires.splice(paires.indexOf(p), 1);
      } else await reinitialiser(p);
      lignes.push(`🧹 ${ancienne}`);
    }
  }
  for (const a of affectations) {
    a.paire.etat = null;
    a.paire.etatErreur = false;
  }
  const compte = [];
  if (lignes.length === 0) compte.push("Aucun lancement de cette semaine dans ce dossier.");
  compte.push(...lignes);
  if (r.nonReconnus.length) compte.push(`Non reconnu(s) : ${r.nonReconnus.join(", ")}`);
  if (r.dossiersLus && r.dossiersLus.length) compte.push(`Dossiers lus : ${r.dossiersLus.join(", ")}`);
  etatsScan[parite] = { lignes: compte, erreur: lignes.length === 0 };
  if (parite === onglet) afficher();
  // Le scan sert à éviter les clics : les contrôles possibles partent tout seuls. Tous les fichiers sont lus
  // d'avance, en parallèle (les listes de coupe PDF sur plusieurs processeurs).
  prelireFichiers(affectations.filter((a) => a.copie).map((a) => a.paire));
  for (const a of affectations) {
    if (!a.copie) continue;
    // GO avec la liste de coupe, ou à défaut avec le .bkp (semaines de livraison, pièces manquantes…).
    if (a.paire.coupe || a.paire.bkp) {
      await lancerUnePaire(a.paire, (erreur) => {
        if (erreur) compte.push(`❌ ${erreur}`);
      });
    }
    if (a.cible.bkp) await new Promise((resolve) => lancerControleScies(a.paire, resolve));
  }
  // Un seul fichier pour toute la semaine (un onglet par lancement), s'il y a un problème.
  const rapport = await rapportSemaineAutomatique(parite);
  if (rapport.nbProblemes) {
    compte.push(`📊 ${rapport.nbProblemes} problème(s) : rapport ${rapport.nom} créé (un onglet par lancement)`);
    for (const a of affectations) rafraichir(a.paire);
  }
  // La semaine part dans la bibliothèque (et sur le Drive partagé).
  const archive = texteArchivage(await archiverOnglet(parite, rapport.lancements));
  if (archive) compte.push(archive);
  await Promise.all(stockage);
  scansEnCours.delete(parite);
  if (parite === onglet) afficher();
}

const memeFichier = (a, b) => Boolean(a && b && a.name === b.name && a.size === b.size && a.lastModified === b.lastModified);

// Lance la lecture de tous les fichiers des cases (chaque lecture est mise en cache) ; les erreurs apparaîtront au contrôle.
function prelireFichiers(cases) {
  const ignorer = () => {};
  for (const p of cases) {
    if (p.strat) stratEnCache(p.strat).catch(ignorer);
    if (p.bkp) texteCttBkp(p.bkp).catch(ignorer);
    if (p.diakonos) diakonosEnCache(p.diakonos).catch(ignorer);
  }
  for (const p of cases) if (p.coupe) sourceCoupeEnCache(p.coupe).catch(ignorer);
}

// ---- Fenêtre de confirmation intégrée à la page ----

function demanderConfirmation(titre, message, libelleOk = "OK") {
  const fond = $("modaleConfirmation");
  $("modaleConfirmationTitre").textContent = titre;
  $("modaleConfirmationMessage").textContent = message;
  $("modaleConfirmationOk").textContent = libelleOk;
  fond.classList.remove("masquee");
  return new Promise((resolve) => {
    const ok = $("modaleConfirmationOk");
    const annuler = $("modaleConfirmationAnnuler");
    const nettoyer = (valeur) => {
      fond.classList.add("masquee");
      ok.removeEventListener("click", surOk);
      annuler.removeEventListener("click", surAnnuler);
      resolve(valeur);
    };
    const surOk = () => nettoyer(true);
    const surAnnuler = () => nettoyer(false);
    ok.addEventListener("click", surOk);
    annuler.addEventListener("click", surAnnuler);
  });
}

// ---- Recherche : une fiche par commande, une ligne par pièce ----

let generationRecherche = 0;

// Une source par case ; le fichier d'une case Diakonos est la liste des pièces commandées.
function sourcesRecherche() {
  return paires.map((p) =>
    estDiakonos(p)
      ? { nom: nomComplet(p), paire: p, strat: null, coupe: null, bkp: null, diakonos: p.strat }
      : { nom: nomComplet(p), paire: p, strat: p.strat, coupe: p.coupe, bkp: p.bkp, diakonos: p.diakonos }
  );
}

// Bases cochées (Diakonos, LAN, Liste, .bkp).
const basesRecherche = () => new Set([...document.querySelectorAll("#basesRecherche input:checked")].map((c) => c.value));

async function preparerRecherche(requete, sources, bases) {
  const a = { r: null, cleCherchee: null, fiches: [], erreurs: [], nbPieces: 0 };
  a.r = await rechercherDansSources(requete, sources, bases);
  if (!a.r || a.r.nbSources === 0 || a.r.trouvailles.length === 0) {
    if (a.r) a.erreurs.push(...a.r.erreurs);
    return a;
  }
  a.erreurs.push(...a.r.erreurs);
  const commande = a.r.commandeUnique;
  let r = a.r;
  // Une seule commande concernée : on montre toute la commande, la pièce cherchée en surbrillance.
  if (commande && commande !== a.r.requete) {
    const toute = await rechercherDansSources(commande, sources, bases);
    if (toute && toute.trouvailles.length) {
      r = toute;
      for (const e of toute.erreurs) if (!a.erreurs.includes(e)) a.erreurs.push(e);
    }
  }
  const pieces = regrouperTrouvailles(r.trouvailles);
  for (const p of pieces) if (correspondRecherche(p.cle, a.r.requete, true)) a.cleCherchee = p.cle;

  if (commande) {
    const f = { commande, schema: null, blocs: null, lignes: [] };
    try {
      const lignes = await lignesDeLaCommande(commande, sources);
      if (lignes.length) {
        f.schema = construireSchemaCommande(commande, lignes);
        f.blocs = blocsSchemaCommande(f.schema, a.cleCherchee);
      }
    } catch (erreur) {
      a.erreurs.push(`Schéma de la commande : ${erreur && erreur.message ? erreur.message : erreur}`);
    }
    const parCle = new Map(pieces.map((p) => [p.cle, p]));
    if (f.schema) {
      const infos = new Map();
      for (const b of f.blocs) for (const lp of b.lignes) if (lp.piece.cle && !infos.has(lp.piece.cle)) infos.set(lp.piece.cle, lp.infos);
      for (const piece of f.schema.pieces) {
        const trouvee = parCle.get(piece.cle) || null;
        parCle.delete(piece.cle);
        f.lignes.push({ cle: piece.cle, piece, trouvee, infos: infos.get(piece.cle) || [] });
      }
    }
    for (const p of parCle.values()) f.lignes.push({ cle: p.cle, piece: null, trouvee: p, infos: [] });
    a.fiches.push(f);
  } else {
    let f = null;
    for (const p of pieces) {
      const cmd = p.cle.length >= 3 ? p.cle.slice(0, -3) : "";
      if (!f || f.commande !== cmd) {
        f = { commande: cmd, schema: null, blocs: null, lignes: [] };
        a.fiches.push(f);
      }
      f.lignes.push({ cle: p.cle, piece: null, trouvee: p, infos: [] });
    }
  }
  a.nbPieces = a.fiches.reduce((t, f) => t + f.lignes.length, 0);
  return a;
}

async function rechercher(requete) {
  const champ = $("champRecherche");
  if (requete !== undefined) champ.value = requete;
  const texte = champ.value;
  const zone = $("resultatsRecherche");
  zone.innerHTML = "";
  if (!texte.trim()) return;
  const bases = basesRecherche();
  if (!bases.size) {
    zone.innerHTML = '<div class="message-alerte">Cochez au moins une base (Diakonos, LAN, Liste ou .bkp).</div>';
    return;
  }
  const numero = ++generationRecherche;
  $("btnRechercher").disabled = true;
  zone.innerHTML = '<div class="note">Recherche en cours…</div>';
  await tick();
  let a;
  let echec = null;
  try {
    a = await preparerRecherche(texte, sourcesRecherche(), bases);
  } catch (erreur) {
    echec = erreur && erreur.message ? erreur.message : String(erreur);
  } finally {
    if (numero === generationRecherche) $("btnRechercher").disabled = false;
  }
  if (numero !== generationRecherche) return;
  if (echec) {
    zone.innerHTML = `<div class="message-alerte">Recherche impossible : ${echapper(echec)}</div>`;
    return;
  }
  afficherRecherche(a);
}

function afficherRecherche(a) {
  const zone = $("resultatsRecherche");
  zone.innerHTML = "";
  const r = a.r;
  if (!r) return;
  if (r.nbSources === 0) {
    zone.innerHTML = '<div class="message-alerte">Aucun fichier chargé.</div>';
    return;
  }
  if (a.fiches.length === 0) {
    zone.innerHTML = `<div class="message-alerte">« ${echapper(r.requete)} » introuvable.</div>`;
  } else {
    if (a.fiches.length > 1 || r.numeroBande) {
      const quoi = r.numeroBande ? `Bande T${r.numeroBande} : ` : "";
      zone.insertAdjacentHTML("beforeend", `<div class="bilan-recherche">${quoi}${a.nbPieces} pièce(s) dans ${a.fiches.length} commande(s)</div>`);
    }
    const liste = document.createElement("div");
    zone.appendChild(liste);
    afficherFiches(liste, a, 0);
  }
  if (a.erreurs.length) zone.insertAdjacentHTML("beforeend", `<div class="message-alerte">Illisibles : ${echapper(a.erreurs.join(" · "))}</div>`);
}

// Fiches par paquets (une recherche large peut en donner des centaines).
function afficherFiches(liste, a, debut) {
  let i = debut;
  let lignes = 0;
  while (i < a.fiches.length && (lignes < PAR_PAGE || i === debut)) {
    lignes += a.fiches[i].lignes.length;
    liste.appendChild(fiche(a.fiches[i], a.cleCherchee));
    i++;
  }
  if (i < a.fiches.length) {
    const suite = i;
    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "contour";
    plus.textContent = `Afficher la suite (${a.fiches.length - suite} commande(s))`;
    plus.addEventListener("click", () => {
      plus.remove();
      afficherFiches(liste, a, suite);
    });
    liste.appendChild(plus);
  }
}

function nomSourceRecherche(t) {
  const p = t.source.paire;
  return p ? (estChantier(p) ? p.label : p.poste) : t.source.nom;
}

function fiche(f, cleCherchee) {
  const carte = document.createElement("div");
  carte.className = "carte fiche";
  let html = `<div class="entete-carte"><span class="titre-fiche">Commande ${echapper(f.commande)}</span>`;
  html += f.schema
    ? `<span class="note">${f.lignes.length} pièce(s)</span>`
    : '<button type="button" class="texte" data-action="voir">Voir la commande</button>';
  html += "</div>";
  if (f.schema) {
    for (const b of f.blocs) {
      if (!b.ensemble || !ensembleADessiner(f.schema, b.ensemble)) continue;
      const legende = b.titre.replace(/^Ensemble \d+ · /, "");
      html += `<div class="legende-schema">${echapper(legende.charAt(0).toUpperCase() + legende.slice(1))}</div>`;
      html += svgEnsembleCommande(f.schema, b.ensemble, cleCherchee);
    }
  }
  html += '<div class="separateur"></div>';
  carte.innerHTML = html;
  const voir = carte.querySelector('[data-action="voir"]');
  if (voir) voir.addEventListener("click", () => rechercher(f.commande));
  for (const l of f.lignes) carte.appendChild(lignePiece(f, l, cleCherchee));
  return carte;
}

function descriptionPiece(l) {
  if (l.piece) {
    const p = l.piece;
    let d = `<strong>${LIBELLE_TYPE_PIECE[p.type]}</strong>`;
    if (p.article) d += ` <span class="article">${echapper(p.article)}</span>`;
    if (p.L && p.W) d += ` · ${dimsPieceCommande(p)}`;
    return d;
  }
  let d = `<strong>${echapper(l.cle)}</strong>`;
  const c = l.trouvee ? l.trouvee.champs : null;
  if (c && c.longueurFinie != null && c.largeurFinie != null) {
    d += ` · ${fmtDim(c.longueurFinie)} × ${fmtDim(c.largeurFinie)}${c.epaisseurFinie != null ? ` × ${fmtDim(c.epaisseurFinie)}` : ""} mm`;
  }
  return d;
}

// « Feno ×1 · T73:2:1 » : où la pièce a été trouvée, combien, et son grain matching.
function etatPiece(l) {
  if (!l.trouvee) return "Non trouvée dans les fichiers chargés";
  const morceaux = l.trouvee.sources.map((t) => {
    const qte = t.quantite !== null && t.quantite !== undefined ? fmtNombre(t.quantite) : "?";
    if (t.base === BASE_DIAKONOS) return `${nomSourceRecherche(t)} (commandée)`;
    return `${nomSourceRecherche(t)} ${t.base === BASE_LAN ? "LAN" : t.base === BASE_BKP ? ".bkp" : "liste"} ×${qte}`;
  });
  let texte = morceaux.join(" · ");
  if (l.trouvee.grains.length) texte += ` · ${l.trouvee.grains.join(" ")}`;
  return texte;
}

function lignePiece(f, l, cleCherchee) {
  const cherchee = !!l.cle && l.cle === cleCherchee;
  const bloc = document.createElement("div");
  bloc.className = `ligne-piece${cherchee ? " cherchee" : ""}`;
  const numero = l.piece ? String(l.piece.ligne) : String(parseInt(l.cle.slice(-3), 10) || 0);
  const credence = l.piece && l.piece.type === "credence";
  bloc.innerHTML = `
    <div class="ligne-piece-haut">
      <span class="sc-num${credence ? " credence" : ""}">${echapper(numero)}</span>
      <div class="ligne-piece-textes">
        <div>${descriptionPiece(l)}</div>
        <div class="etat-piece ${l.trouvee ? "" : "alerte"}">${echapper(etatPiece(l))}</div>
      </div>
      <span class="chevron">${cherchee ? "▾" : "▸"}</span>
    </div>
    <div class="details-piece" ${cherchee ? "" : "hidden"}></div>
  `;
  remplirDetails(bloc.querySelector(".details-piece"), f, l);
  bloc.querySelector(".ligne-piece-haut").addEventListener("click", () => {
    const details = bloc.querySelector(".details-piece");
    details.hidden = !details.hidden;
    bloc.querySelector(".chevron").textContent = details.hidden ? "▸" : "▾";
  });
  return bloc;
}

function remplirDetails(zone, f, l) {
  let html = `<div class="cle-piece">${echapper(l.cle)}</div>`;
  const c = l.trouvee ? l.trouvee.champs : null;
  if (c) {
    html += construireSchemaPieceSvg(c);
    if (c.lancement) html += `<div class="info">Lancement ${echapper(c.lancement)}</div>`;
    if (!l.piece && c.assemblage) html += `<div class="info">Assemblage ${echapper(c.assemblage)}</div>`;
  }
  for (const i of l.infos) html += `<div class="info${i.alerte ? " alerte" : ""}${i.commentaire ? " commentaire" : ""}">${echapper(i.texte)}</div>`;
  if (f.schema && l.piece && f.schema.nonPlacees.includes(l.piece)) html += '<div class="info">Position à lire sur le plan client</div>';
  const donnees = c && c.toutesDonneesLan ? Object.entries(c.toutesDonneesLan) : [];
  if (donnees.length) {
    html += `<details class="donnees"><summary>Toutes les données (${donnees.length})</summary><table class="table-donnees-lan">${donnees
      .map(([k, v]) => `<tr><th>${echapper(k)}</th><td>${echapper(v)}</td></tr>`)
      .join("")}</table></details>`;
  }
  zone.innerHTML = html;
}

// ---- Pièce sans étiquette : cote finie (sens du fil puis largeur), couleur facultative, semaine obligatoire ----
// Cherche dans la bibliothèque (toutes les années de ce numéro de semaine) et dans les lancements chargés.

async function lancementsDeLaSemaineRecherche(numero) {
  const lancements = [];
  for (const s of bibliotheque.semaines.values()) {
    if (s.semaine !== numero) continue;
    for (const l of s.lancements) lancements.push({ annee: s.annee, semaine: s.semaine, nom: l.nom, poste: l.poste, pieces: l.pieces || [] });
  }
  for (const parite of ["paire", "impaire"]) {
    if (Number(numeroSemaine(parite)) !== numero) continue;
    for (const p of pairesDeLaSemaine(parite)) {
      if (!p.strat || estDiakonos(p)) continue;
      try {
        const fiche = ficheLancementBibliotheque(p.strat.name, await stratEnCache(p.strat), { poste: estChantier(p) ? POSTE_CHANTIERS : p.poste });
        lancements.push({ annee: anneeDeSemaine(numero), semaine: numero, nom: fiche.nom, poste: fiche.poste, pieces: fiche.pieces });
      } catch (_e) {
        // lancement illisible : la bibliothèque reste cherchée
      }
    }
  }
  return lancements;
}

async function chercherParCotes() {
  const zone = $("resultatsCotes");
  const nombre = (id) => {
    const v = $(id).value.trim().replace(",", ".");
    return v === "" ? null : Number(v);
  };
  const criteres = { longueur: nombre("champCoteLongueur"), largeur: nombre("champCoteLargeur"), couleur: $("champCoteCouleur").value.trim() };
  const semaine = nombre("champCoteSemaine");
  if (!Number.isInteger(semaine) || semaine < 1 || semaine > 53) {
    zone.innerHTML = '<div class="message-alerte">Tapez la semaine (obligatoire).</div>';
    return;
  }
  if ([criteres.longueur, criteres.largeur].some((v) => v !== null && !(v > 0))) {
    zone.innerHTML = '<div class="message-alerte">Longueur et largeur : des mm (nombres).</div>';
    return;
  }
  if (criteres.longueur === null && criteres.largeur === null && !criteres.couleur) {
    zone.innerHTML = '<div class="message-alerte">Tapez au moins une cote ou la couleur.</div>';
    return;
  }
  $("btnChercherCotes").disabled = true;
  zone.innerHTML = '<div class="note">Recherche en cours…</div>';
  try {
    const lancements = await lancementsDeLaSemaineRecherche(semaine);
    const quoi = [
      criteres.longueur !== null ? `longueur ${fmtNombre(criteres.longueur)}` : "",
      criteres.largeur !== null ? `largeur ${fmtNombre(criteres.largeur)}` : "",
      criteres.couleur ? `couleur ${criteres.couleur}` : "",
    ].filter(Boolean).join(" · ");
    if (!lancements.length) {
      zone.innerHTML = `<div class="message-alerte">Semaine ${semaine} : rien dans la bibliothèque ni dans Contrôler la coupe. Ajoutez la semaine à la bibliothèque ou ouvrez-la dans Contrôler la coupe.</div>`;
      return;
    }
    const trouvees = chercherPiecesSansEtiquette(criteres, lancements);
    const noms = [...new Set(lancements.map((l) => l.nom))];
    let html = `<div class="bilan-recherche">${trouvees.length} pièce(s) — ${echapper(quoi)} (± ${TOLERANCE_COTES_RECHERCHE} mm), semaine ${semaine}</div>`;
    html += `<div class="note">Cherché dans ${noms.length} lancement(s) : ${echapper(noms.join(", "))}</div>`;
    if (trouvees.length) {
      const dim = (v) => (v === "" || v == null ? "?" : fmtNombre(Number(v)));
      html += `<div class="defile"><table class="recap"><thead><tr><th>Pièce</th><th>Article</th><th class="droite">Cote finie</th><th>Couleur</th><th>Sous-face</th><th>Matière</th><th class="droite">Qté</th><th>Lancement</th><th>Semaine</th></tr></thead><tbody>${trouvees
        .map(
          (t, i) => `<tr class="${i % 2 ? "impaire" : ""}"><td><strong>${echapper(t.cle)}</strong></td><td>${echapper(t.article)}</td><td class="droite">${dim(t.longueur)} × ${dim(t.largeur)} × ${dim(t.epaisseur)}</td><td>${echapper(t.coloris)}</td><td>${echapper(t.colorisInf)}</td><td>${echapper(t.matiere)}</td><td class="droite">${echapper(t.quantite == null ? "" : fmtNombre(t.quantite))}</td><td>${echapper(t.lancement)}</td><td>${t.semaine}${t.annee ? ` · ${t.annee}` : ""}</td></tr>`
        )
        .join("")}</tbody></table></div>`;
    }
    zone.innerHTML = html;
  } catch (erreur) {
    zone.innerHTML = `<div class="message-alerte">Recherche impossible : ${echapper(erreur && erreur.message ? erreur.message : String(erreur))}</div>`;
  } finally {
    $("btnChercherCotes").disabled = false;
  }
}

// ---- Démarrage ----

document.querySelectorAll(".onglet-btn").forEach((b) =>
  b.addEventListener("click", () => {
    onglet = b.dataset.onglet;
    afficher();
  })
);
$("btnRechercher").addEventListener("click", () => rechercher());
$("champRecherche").addEventListener("keydown", (e) => {
  if (e.key === "Enter") rechercher();
});
$("choixFichier").addEventListener("change", fichierChoisi);
$("btnChercherCotes").addEventListener("click", chercherParCotes);
for (const id of ["champCoteLongueur", "champCoteLargeur", "champCoteCouleur", "champCoteSemaine"])
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") chercherParCotes();
  });

// Logo Laisné Industrie (version blanche sur le bandeau bordeaux).
document.querySelectorAll("img[data-logo]").forEach((img) => (img.src = img.dataset.logo === "blanc" ? LOGO_BLANC_PNG : LOGO_COULEUR_PNG));

(async () => {
  await initialiserPaires();
  await restaurerDossiersPartages();
  await chargerBibliotheque();
  await chargerReecriture().catch(() => {});
  afficher();
})();

// N'a d'effet que servi en http(s)/localhost (ex. server/lancer_sentinelle.bat).
if ("serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
