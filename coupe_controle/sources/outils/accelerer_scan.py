import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
def rep(a, b, n=1):
    global s
    assert s.count(a) == n, (s.count(a), a[:70])
    s = s.replace(a, b)

rep('''// Laisse le navigateur repeindre l'écran avant de continuer.
function tick() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}''', '''// Laisse le navigateur repeindre l'écran avant de continuer. Un message (et non requestAnimationFrame
// ou setTimeout) : il passe aussi quand l'onglet est caché, où les deux autres sont figés ou ralentis.
const canalTick = new MessageChannel();
const attentesTick = [];
canalTick.port1.onmessage = () => attentesTick.shift()();
function tick() {
  return new Promise((resolve) => {
    attentesTick.push(resolve);
    canalTick.port2.postMessage(null);
  });
}''')

rep('''const DB_MEMOIRE_NOM = "sentinelle-memoire";
const MAGASIN_PAIRES = "paires";

function ouvrirBaseMemoire() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB indisponible"));
      return;
    }
    const requete = indexedDB.open(DB_MEMOIRE_NOM, 1);
    requete.onupgradeneeded = () => {
      const db = requete.result;
      if (!db.objectStoreNames.contains(MAGASIN_PAIRES)) db.createObjectStore(MAGASIN_PAIRES, { keyPath: "cleMemoire" });
    };
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });
}''', '''const DB_MEMOIRE_NOM = "sentinelle-memoire";
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
      requete.onupgradeneeded = () => {
        const db = requete.result;
        if (!db.objectStoreNames.contains(MAGASIN_PAIRES)) db.createObjectStore(MAGASIN_PAIRES, { keyPath: "cleMemoire" });
        if (!db.objectStoreNames.contains(MAGASIN_FICHIERS)) db.createObjectStore(MAGASIN_FICHIERS);
      };
      requete.onsuccess = () => resolve(requete.result);
      requete.onerror = () => reject(requete.error);
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
  });''')

rep('''async function lireToutesLesMemoires() {
  try {
    const db = await ouvrirBaseMemoire();
    return await new Promise((resolve) => {
      const req = db.transaction(MAGASIN_PAIRES, "readonly").objectStore(MAGASIN_PAIRES).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (_erreur) {
    return [];
  }
}''', '''// Les fiches des cases, avec le contenu de leurs fichiers (rangé à part, ou dans la fiche pour les versions d'avant).
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
      const allegee = { ...fiche };
      for (const [role, champ] of roles) {
        tx.objectStore(MAGASIN_FICHIERS).put(fiche[champ].bytes, `${fiche.cleMemoire}||${role}`);
        allegee[champ] = { nom: fiche[champ].nom, type: fiche[champ].type, lastModified: fiche[champ].lastModified, separe: true };
      }
      tx.objectStore(MAGASIN_PAIRES).put(allegee);
      await finTransaction(tx);
    } catch (_erreur) {
      // sans effet : l'ancienne fiche reste lisible
    }
  }
}''')

rep('''async function effacerMemoire(p) {
  try {
    const db = await ouvrirBaseMemoire();
    const tx = db.transaction(MAGASIN_PAIRES, "readwrite");
    tx.objectStore(MAGASIN_PAIRES).delete(cleMemoire(p));
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch (_erreur) {
    // sans effet
  }
}''', '''async function effacerMemoire(p) {
  try {
    const db = await ouvrirBaseMemoire();
    const tx = db.transaction([MAGASIN_PAIRES, MAGASIN_FICHIERS], "readwrite");
    tx.objectStore(MAGASIN_PAIRES).delete(cleMemoire(p));
    for (const role of Object.keys(CHAMP_FICHIER)) tx.objectStore(MAGASIN_FICHIERS).delete(`${cleMemoire(p)}||${role}`);
    await finTransaction(tx);
  } catch (_erreur) {
    // sans effet
  }
}''')

rep('''async function memoriserFichier(p, role, fichier) {
  const bytes = await fichier.arrayBuffer();
  await sauvegarderDansMemoire(p, {
    [CHAMP_FICHIER[role]]: { nom: fichier.name, type: fichier.type, lastModified: fichier.lastModified, bytes },
  });
}''', '''async function memoriserFichier(p, role, fichier) {
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
}''')

rep('''function fichierDepuisMemoire(f) {
  return f ? new File([f.bytes], f.nom, { type: f.type || "", lastModified: f.lastModified || Date.now() }) : null;
}''', '''function fichierDepuisMemoire(f) {
  return f && f.bytes ? new File([f.bytes], f.nom, { type: f.type || "", lastModified: f.lastModified || Date.now() }) : null;
}''')

rep('''  const memoires = await lireToutesLesMemoires();
  const parCle = new Map(memoires.map((r) => [r.cleMemoire, r]));''', '''  const memoires = await lireToutesLesMemoires();
  rangerFichiersMemorises(memoires);
  const parCle = new Map(memoires.map((r) => [r.cleMemoire, r]));''')

rep('''    magasin.put({ ...existant, ...champs, cleMemoire: cle });
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });''', '''    magasin.put({ ...existant, ...champs, cleMemoire: cle });
    await finTransaction(tx);''')

rep('''async function resume(strat, bkp) {
  const cle = cleResume(strat, bkp);
  if (resumes.has(cle)) return resumes.get(cle);''', '''const resumesEnCours = new Map();
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

async function calculerResume(strat, bkp) {''')
rep('''      r.bkp = NaN; // .bkp illisible : l'erreur sera visible via « Vérifier Scies »
    }
  }
  resumes.set(cle, r);
  return r;
}''', '''      r.bkp = NaN; // .bkp illisible : l'erreur sera visible via « Vérifier Scies »
    }
  }
  return r;
}''')

debut = s.index("    // Une casse reprend par nature des pièces de plusieurs semaines : pas de confirmation.")
fin = s.index("    p.etat = p.coupe ? \"⏳ lecture de la liste de coupe…\"")
s = s[:debut] + s[fin:]

rep('''  if (parite === onglet) afficher();
  for (const a of affectations) {
    const p = a.paire;
    const g = a.cible;
    try {
      p.strat = await g.strat.entree.getFile();''', '''  if (parite === onglet) afficher();
  const stockage = [];
  const memoriser = (p, role, f) => stockage.push(memoriserFichier(p, role, f));
  for (const a of affectations) {
    const p = a.paire;
    const g = a.cible;
    try {
      p.strat = await g.strat.entree.getFile();''')
rep('''      await memoriserFichier(p, "strat", p.strat);''', '''      memoriser(p, "strat", p.strat);''', 2)
for role in ["coupe", "bkp", "sommaire"]:
    rep(f'''        await memoriserFichier(p, "{role}", p.{role});''', f'''        memoriser(p, "{role}", p.{role});''')
rep('''          await memoriserFichier(p, "diakonos", p.diakonos);''', '''          memoriser(p, "diakonos", p.diakonos);''')
rep('''  // Le scan sert à éviter les clics : les contrôles possibles partent tout seuls.
  for (const a of affectations) {''', '''  // Le scan sert à éviter les clics : les contrôles possibles partent tout seuls. Tous les fichiers sont lus
  // d'avance, en parallèle (les listes de coupe PDF sur plusieurs processeurs).
  prelireFichiers(affectations.filter((a) => a.copie).map((a) => a.paire));
  for (const a of affectations) {''')
rep('''    await problemesAutomatiques(a.paire);
  }
  scansEnCours.delete(parite);''', '''    await problemesAutomatiques(a.paire);
  }
  await Promise.all(stockage);
  scansEnCours.delete(parite);''')
rep('''// ---- Fenêtre de confirmation intégrée à la page ----''', '''// Lance la lecture de tous les fichiers des cases (chaque lecture est mise en cache) ; les erreurs apparaîtront au contrôle.
function prelireFichiers(cases) {
  const ignorer = () => {};
  for (const p of cases) {
    if (p.strat) stratEnCache(p.strat).catch(ignorer);
    if (p.bkp) texteCttBkp(p.bkp).catch(ignorer);
    if (p.diakonos) diakonosEnCache(p.diakonos).catch(ignorer);
  }
  for (const p of cases) if (p.coupe) sourceCoupeEnCache(p.coupe).catch(ignorer);
}

// ---- Fenêtre de confirmation intégrée à la page ----''')
open(p, "w", encoding="utf-8").write(s)
print("ok")
