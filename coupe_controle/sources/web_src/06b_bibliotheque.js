// ---- Bibliothèque des semaines ----
// Chaque semaine scannée (ou ajoutée depuis un dossier d'archives) est gardée : ses lancements, leurs pièces
// (commande + ligne, article, dimensions, coloris…) et le bilan des contrôles. La casse s'en sert pour savoir si
// une pièce était déjà lancée une semaine d'avant, même ancienne.
//
// Rangement : une copie dans le navigateur (IndexedDB) et, si un dossier est choisi (sur le Drive), le fichier partagé
// « sentinelle_partage.json.gz » dans ce dossier, avec toutes les infos que Sentinelle génère. L'appli Android se
// branche sur ce fichier. Les PC qui choisissent le même dossier partagent la même bibliothèque : chaque semaine est
// fusionnée lancement par lancement (le plus récent gagne) ; une semaine retirée garde la date du retrait.

const FORMAT_PARTAGE = "sentinelle-partage-1";
const NOM_FICHIER_PARTAGE = "sentinelle_partage.json.gz";
const ID_FICHIER_CONNU = "__fichier_partage"; // dernier état connu du fichier partagé (dans IndexedDB)
// Une pièce = un tableau dans cet ordre (le fichier redonne l'ordre dans « colonnesPieces »).
// V6.1 : de quoi redessiner la commande sur le téléphone (assemblage, découpes, chants, angles, commentaire), client et référence.
// V6.3.3 : transporteur (trans_nomcourt du fichier de lancement), pour le suivi de production par transporteur.
const COLONNES_PIECES_BIBLIOTHEQUE = ["cle", "commande", "ligne", "article", "pieces", "longueur", "largeur", "epaisseur", "coloris", "coloris_inf", "matiere", "livraison",
  "assemblage", "info3", "chants", "angles", "commentaire", "client", "reference", "transporteur"];
const ANGLES_BIBLIOTHEQUE = [["ARG", "Usinage angle arrière gauche"], ["ARD", "Usinage angle arrière droit"], ["AVD", "Usinage angle avant droit"], ["AVG", "Usinage angle avant gauche"]];
// Les plans de coupe ne vont dans le fichier partagé que pour les semaines les plus récentes (taille du fichier).
const SEMAINES_AVEC_PLANS = 4;
const DB_BIBLIOTHEQUE = "sentinelle-bibliotheque";
const MAGASIN_SEMAINES = "semaines";
// Un fichier par semaine : rangement de la V5.2, repris une fois.
const MOTIF_FICHIER_SEMAINE = /^sentinelle_semaine_(\d{4})-(\d{2})\.json\.gz$/;
const idSemaine = (annee, semaine) => `${annee}-${String(semaine).padStart(2, "0")}`;
const ordreSemaine = (annee, semaine) => annee * 100 + Number(semaine);
// « LAN264601START_corrige » remplace « LAN264601START » : même lancement.
const cleNomLancement = (nom) => String(nom).replace(/\.[^.]*$/, "").replace(/_corrige$/i, "").toUpperCase();

const bibliotheque = {
  semaines: new Map(), // id « 2026-46 » → fiche de la semaine
  generation: 0, // change à chaque modification (les calculs de casse se refont)
  index: null, // clé de pièce → [{ ordre, annee, semaine, lancement, casse }]
  dossier: null, // poignée du dossier du fichier partagé (sur le Drive)
  fichier: null, // fichier partagé au dernier échange { lastModified, size, signature }
  synchro: null, // synchronisation en cours (promesse)
  etat: null, // dernier compte rendu { lignes, erreur }
  enCours: false, // ajout de semaines en cours
};

let baseBibliotheque = null;
function ouvrirBaseBibliotheque() {
  if (!baseBibliotheque) {
    baseBibliotheque = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB indisponible"));
        return;
      }
      const requete = indexedDB.open(DB_BIBLIOTHEQUE, 1);
      const delai = setTimeout(() => reject(new Error("bibliothèque bloquée par un autre onglet")), 5000);
      requete.onupgradeneeded = () => requete.result.createObjectStore(MAGASIN_SEMAINES, { keyPath: "id" });
      requete.onsuccess = () => {
        clearTimeout(delai);
        const db = requete.result;
        db.onversionchange = () => {
          db.close();
          baseBibliotheque = null;
        };
        resolve(db);
      };
      requete.onerror = () => {
        clearTimeout(delai);
        reject(requete.error);
      };
    });
    baseBibliotheque.catch(() => (baseBibliotheque = null));
  }
  return baseBibliotheque;
}

async function enregistrerSemaineLocale(s) {
  bibliotheque.semaines.set(s.id, s);
  try {
    const db = await ouvrirBaseBibliotheque();
    const tx = db.transaction(MAGASIN_SEMAINES, "readwrite");
    tx.objectStore(MAGASIN_SEMAINES).put(s);
    await finTransaction(tx);
  } catch (_erreur) {
    // sans IndexedDB : la bibliothèque vit le temps de la page (et sur le Drive)
  }
}

function changementBibliotheque() {
  bibliotheque.generation++;
  bibliotheque.index = null;
  // Le téléphone relié au PC reçoit la bibliothèque (chiffrée) quelques secondes après.
  planifierEnvoiTelephone();
}

// Au démarrage : la copie du navigateur, puis le fichier partagé si son dossier est déjà autorisé.
async function chargerBibliotheque() {
  try {
    const db = await ouvrirBaseBibliotheque();
    const fiches = await new Promise((resolve) => {
      const requete = db.transaction(MAGASIN_SEMAINES, "readonly").objectStore(MAGASIN_SEMAINES).getAll();
      requete.onsuccess = () => resolve(requete.result || []);
      requete.onerror = () => resolve([]);
    });
    for (const s of fiches) {
      if (s.id === ID_FICHIER_CONNU) bibliotheque.fichier = s;
      else bibliotheque.semaines.set(s.id, s);
    }
  } catch (_erreur) {
    // pas de copie locale
  }
  changementBibliotheque();
  validationsDepuisBibliotheque([...bibliotheque.semaines.values()]);
  // Casses gardées sans analyse (semaines ajoutées avant cette version) : analysées tout de suite.
  try {
    await analyserCassesBibliotheque();
  } catch (_erreur) {
    // analyse impossible : la casse reste « pas comptée »
  }
  if (typeof window.showDirectoryPicker === "function") {
    bibliotheque.dossier = await chargerPoigneeDossierPartage("bibliotheque");
    if (bibliotheque.dossier) synchroniserBibliotheque(false).then(apresSynchro);
  }
}

// Casse des semaines gardées sans contrôle (« Ajouter les semaines d'avant ») : pièces déjà lancées et rajouts,
// d'après les semaines d'avant de la bibliothèque, comme au contrôle sur le PC ; c'est ce que lit le téléphone.
// Une casse déjà analysée au contrôle n'est pas touchée. Renvoie le nombre de semaines mises à jour.
async function analyserCassesBibliotheque() {
  const maj = new Date().toISOString();
  const touchees = [];
  for (const s of bibliotheque.semaines.values()) {
    if (!s.lancements.some((l) => l.casse && !(l.recap && l.recap.casse))) continue;
    const avant = ordreSemaine(s.annee, s.semaine);
    const connues = semainesConnuesAvant(avant);
    if (!connues.length) continue;
    const iCle = Math.max(0, (s.colonnesPieces || COLONNES_PIECES_BIBLIOTHEQUE).indexOf("cle"));
    const lancements = s.lancements.map((l) => {
      if (!l.casse || (l.recap && l.recap.casse)) return l;
      const deja = [];
      let rajouts = 0;
      for (const piece of l.pieces) {
        const vu = derniereFoisLancee(piece[iCle], avant);
        if (vu) deja.push(vu.semaine);
        else rajouts++;
      }
      const base = { prevues: l.nbPieces ?? null, bkp: null, source: null, controle: null, scies: null, couleursAbsentes: null, couleursPf: null };
      const recap = { ...base, ...(l.recap || {}), casse: { dejaLancees: deja.length, rajouts, ou: deja.length ? libelleSemaines(deja) : "", periode: periodeCasse(connues) } };
      return { ...l, recap, maj };
    });
    touchees.push({ ...s, lancements, maj });
  }
  for (const s of touchees) await enregistrerSemaineLocale(s);
  if (touchees.length) changementBibliotheque();
  return touchees.length;
}

// Semaines visibles (pas retirées, avec au moins un lancement), la plus récente d'abord.
const semainesBibliotheque = () =>
  [...bibliotheque.semaines.values()].filter((s) => s.lancements.length).sort((a, b) => ordreSemaine(b.annee, b.semaine) - ordreSemaine(a.annee, a.semaine));

function indexBibliotheque() {
  if (bibliotheque.index) return bibliotheque.index;
  const index = new Map();
  for (const s of bibliotheque.semaines.values()) {
    const ordre = ordreSemaine(s.annee, s.semaine);
    const iCle = Math.max(0, (s.colonnesPieces || COLONNES_PIECES_BIBLIOTHEQUE).indexOf("cle"));
    for (const l of s.lancements) {
      const vu = { ordre, annee: s.annee, semaine: String(s.semaine).padStart(2, "0"), lancement: l.fichier || l.nom, casse: Boolean(l.casse) };
      for (const piece of l.pieces) {
        const cle = piece[iCle];
        if (!index.has(cle)) index.set(cle, []);
        index.get(cle).push(vu);
      }
    }
  }
  bibliotheque.index = index;
  return index;
}

// Dernière semaine (strictement avant « avant ») où la pièce était lancée, d'après la bibliothèque ; null sinon.
function derniereFoisLancee(cle, avant) {
  let meilleure = null;
  for (const v of indexBibliotheque().get(cle) || []) if (v.ordre < avant && (!meilleure || v.ordre > meilleure.ordre)) meilleure = v;
  return meilleure;
}

// Semaines de la bibliothèque avant « avant » (numéros sur deux chiffres, de la plus ancienne à la plus récente).
const semainesConnuesAvant = (avant) =>
  semainesBibliotheque()
    .filter((s) => ordreSemaine(s.annee, s.semaine) < avant)
    .reverse()
    .map((s) => String(s.semaine).padStart(2, "0"));

// Semaine écrite dans le fichier de lancement lui-même : colonne com_livsem (année : com_livan), celle du plus
// grand nombre de pièces (à égalité, la plus récente) ; null si la colonne est vide. « 47.0 » vaut 47.
function semaineLivraisonDuLancement(semaines) {
  const parSemaine = new Map();
  for (const s of semaines || []) {
    const semaine = Math.trunc(parseFloat(s.semaine));
    if (!(semaine >= 1 && semaine <= 53)) continue;
    const an = Math.trunc(parseFloat(s.annee));
    const annee = an >= 2000 && an < 2100 ? an : null;
    const cle = `${annee}-${semaine}`;
    const actuel = parSemaine.get(cle) || { annee, semaine, nbPieces: 0 };
    actuel.nbPieces += s.nbPieces || 0;
    parSemaine.set(cle, actuel);
  }
  const rang = (s) => (s.annee || 0) * 100 + s.semaine;
  let meilleure = null;
  for (const s of parSemaine.values())
    if (!meilleure || s.nbPieces > meilleure.nbPieces || (s.nbPieces === meilleure.nbPieces && rang(s) > rang(meilleure))) meilleure = s;
  return meilleure;
}

// Semaine d'un lancement, comme l'onglet l'affiche : celle écrite dans le fichier (colonne com_livsem) ; sinon celle
// du dossier « Semaine NN » où il est rangé, sinon celle du code de la colonne lancement, sinon du nom du fichier.
// La casse se fabrique la semaine d'après (casse 46 en semaine 47), sauf rangée dans un dossier de semaine.
function semaineDuLancement(lignes, casse, nomFichier, semaineDossier = null, semainesLivraison = null) {
  // Semaine choisie à la main (dérogation) : elle passe avant tout le reste.
  const derogation = typeof derogationDe === "function" ? derogationDe(nomFichier) : null;
  if (derogation) return { annee: derogation.annee || new Date().getFullYear(), semaine: derogation.semaine };
  const livraison = semaineLivraisonDuLancement(semainesLivraison);
  if (livraison) {
    let n = livraison.semaine;
    let annee = livraison.annee;
    if (!annee) {
      const base = semaineDuLancement(lignes, false, nomFichier, null);
      annee = base ? base.annee : new Date().getFullYear();
    }
    if (casse) {
      if (n >= 52) {
        n = 1;
        annee++;
      } else n++;
    }
    return { annee, semaine: n };
  }
  const nDossier = parseInt(semaineDossier, 10);
  if (nDossier >= 1 && nDossier <= 53) {
    const base = semaineDuLancement(lignes, false, nomFichier, null);
    // Année : celle du lancement, corrigée au passage d'une année à l'autre (casse 52 rangée en semaine 01).
    const annee = !base
      ? new Date().getFullYear()
      : nDossier < base.semaine - 26 ? base.annee + 1 : nDossier > base.semaine + 26 ? base.annee - 1 : base.annee;
    return { annee, semaine: nDossier };
  }
  let code = String((lignes.find((l) => l.lancement) || {}).lancement || "");
  let semaine = extraireSemaine(code);
  if (!semaine) {
    code = trouverCodeLancement(nomFichier || "") || "";
    semaine = extraireSemaine(code);
  }
  const chiffres = code.replace(/\D/g, "");
  let annee = chiffres.length >= 4 ? 2000 + parseInt(chiffres.slice(0, 2), 10) : new Date().getFullYear();
  if (!semaine) semaine = semaineDossier;
  let n = parseInt(semaine, 10);
  if (Number.isNaN(n) || n < 1 || n > 53) return null;
  if (casse) {
    if (n >= 52) {
      n = 1;
      annee++;
    } else n++;
  }
  return { annee, semaine: n };
}

// Couleur de la belle face d'une pièce : la première trouvée dans ses lignes (le bois d'une pièce Feno n'en a pas,
// le FENO la porte).
const colorisDeLaPiece = (l) => ((l.lignesBrutes || []).map((d) => d.coloris).find((c) => c && String(c).trim()) ?? (l.toutesDonnees || {}).coloris);

// Ce que la bibliothèque garde d'un lancement.
function ficheLancementBibliotheque(nomFichier, strat, infos) {
  const livraison = new Map();
  for (const s of strat.semaines || []) for (const cle of s.cles || []) livraison.set(cle, s.annee ? `${s.annee}-${s.semaine}` : String(s.semaine));
  const texte = (v) => (v === null || v === undefined ? "" : String(v));
  const pieces = strat.lignes.map((l) => {
    const d = l.toutesDonnees || {};
    return [l.cle, texte(l.commande), texte(l.ligne), texte(l.article), l.pieces, l.longueurFinie ?? "", l.largeurFinie ?? "", l.epaisseurFinie ?? "",
      texte(colorisDeLaPiece(l)), texte(d.coloris_inf), texte(d[COL_AGGLO]), livraison.get(l.cle) || "",
      texte(l.assemblage || d["info atelier assemblage"]), texte(d["info 3 atelier"]),
      ["conf_chantavant", "conf_chantarriere", "conf_chantgauche", "conf_chantdroit"].map((k) => (d[k] ? "1" : "0")).join(""),
      ANGLES_BIBLIOTHEQUE.filter(([, k]) => d[k]).map(([c, k]) => `${c}:${d[k]}`).join(";"), texte(d.commentaire), texte(d.com_clientcom), texte(d.com_reference),
      texte(d.trans_nomcourt).trim()];
  });
  return {
    nom: nomFichier.replace(/\.[^.]*$/, ""),
    fichier: nomFichier,
    poste: infos.poste || null,
    dossier: infos.dossier || null,
    casse: Boolean(infos.casse),
    fichiers: infos.fichiers || {},
    recap: infos.recap || null,
    controle: infos.controle || null,
    problemes: infos.problemes || [],
    plans: infos.plans || null,
    nbPieces: strat.lignes.reduce((t, l) => t + (l.pieces || 0), 0),
    pieces,
  };
}

const nouvelleSemaineBibliotheque = (annee, semaine) => ({
  id: idSemaine(annee, semaine), annee, semaine, maj: "", supprimeeLe: null, colonnesPieces: COLONNES_PIECES_BIBLIOTHEQUE, lancements: [],
});

// Range des lancements dans leurs semaines (un lancement du même nom remplace l'ancien), puis met à jour le fichier partagé.
async function archiverLancements(items) {
  const maj = new Date().toISOString();
  const touchees = new Map();
  for (const { annee, semaine, lancement } of items) {
    const id = idSemaine(annee, semaine);
    if (!touchees.has(id)) {
      const existante = bibliotheque.semaines.get(id);
      touchees.set(id, existante ? { ...existante, lancements: [...existante.lancements] } : nouvelleSemaineBibliotheque(annee, semaine));
    }
    const s = touchees.get(id);
    const k = cleNomLancement(lancement.nom);
    s.lancements = s.lancements.filter((l) => cleNomLancement(l.nom) !== k);
    s.lancements.push({ ...lancement, maj });
    s.colonnesPieces = COLONNES_PIECES_BIBLIOTHEQUE; // les colonnes d'avant en sont le début : les anciennes lignes restent lisibles
    s.lancements.sort((a, b) => a.nom.localeCompare(b.nom));
    s.maj = maj;
  }
  for (const s of touchees.values()) await enregistrerSemaineLocale(s);
  changementBibliotheque();
  let drive = null;
  if (bibliotheque.dossier) drive = await synchroniserBibliotheque(false);
  rafraichirBibliotheque();
  return { semaines: [...touchees.values()], drive };
}

// Après un scan ou « Lancer le(s) contrôle(s) » : les lancements de l'onglet, avec le bilan de leurs contrôles.
async function archiverOnglet(parite, lancementsRapport) {
  const controles = new Map((lancementsRapport || []).filter((l) => !l.erreur).map((l) => [l.p, l]));
  const items = [];
  for (const p of pairesDeLaSemaine(parite)) {
    if (!p.strat) continue;
    try {
      const strat = await stratEnCache(p.strat);
      const casse = p.poste === "Casse";
      // La casse est dans l'onglet de la semaine où le scan l'a rangée.
      const sem = semaineDuLancement(strat.lignes, casse, p.strat.name, casse ? String(numeroSemaine(parite)) : p.semaineDossier || null, strat.semaines);
      if (!sem) continue;
      const c = controles.get(p);
      const fichiers = {};
      for (const role of ["coupe", "bkp", "sommaire", "diakonos"]) if (p[role]) fichiers[role] = p[role].name;
      // Le tableau des lancements de l'onglet, tel qu'il est affiché.
      const r = await resume(p.strat, p.bkp);
      const nombre = (v) => (v === null || v === undefined || Number.isNaN(v) ? null : v);
      const couleurs = p.couleurs && !p.couleurs.sansStratifie ? p.couleurs : null;
      const recap = {
        prevues: nombre(r.prevues),
        bkp: p.bkp ? nombre(r.bkp) : null,
        source: p.source || null,
        controle: p.rapport ? p.rapport.nbAnomalies : null,
        scies: p.erreurScies ? -1 : p.ecartsScies ? p.ecartsScies.length : null,
        couleursAbsentes: couleurs ? couleurs.absentes.length : null,
        couleursPf: couleurs ? (couleurs.variantes || []).length : null,
        casse: null,
      };
      // Problèmes validés « c'est voulu » : ils ne comptent plus dans le tableau (ni sur le téléphone).
      const reste = (test, valeur) => (valeur > 0 && restantsDuControle(p, test) === 0 ? 0 : valeur);
      recap.controle = reste(estControleListe, recap.controle);
      recap.scies = sciesRestants(p);
      recap.horsPlans = p.plans ? reste(estControlePlans, nbHorsPlans(p)) : null;
      recap.couleursAbsentes = reste(estControleCouleurs, recap.couleursAbsentes);
      // Casse : combien de ses pièces étaient déjà lancées, combien de rajouts.
      if (casse) {
        const autre = ongletPrecedent(parite);
        const rc = await calculerCasse(p, pairesDeLaSemaine(autre), numeroSemaine(autre));
        if (!rc.erreur && !rc.autreSemaineChargee)
          recap.casse = {
            dejaLancees: rc.dejaLancees.length,
            rajouts: rc.rajouts.length,
            ou: rc.dejaLancees.length ? libelleSemaines(rc.dejaLancees.map((t) => t.semaine)) : "",
            periode: rc.periode,
          };
      }
      items.push({
        ...sem,
        lancement: ficheLancementBibliotheque(p.strat.name, strat, {
          poste: estChantier(p) ? POSTE_CHANTIERS : p.poste,
          dossier: p.dossier,
          casse,
          fichiers,
          controle: c ? { nbCorriger: c.nbCorriger, nbVerifier: c.nbVerifier, bilan: c.bilan.map(({ statut, controle, texte }) => ({ statut, controle, texte })) } : null,
          problemes: c && c.details ? c.details : [],
          recap,
          plans: await plansDuLancementPourTelephone(p, strat),
        }),
      });
    } catch (_erreur) {
      // lancement illisible : pas dans la bibliothèque
    }
  }
  if (!items.length) return null;
  const r = await archiverLancements(items);
  return { ...r, nbLancements: items.length };
}

// Les plans de coupe du lancement pour le téléphone (null sans .bkp lisible).
async function plansDuLancementPourTelephone(p, strat) {
  if (!p.bkp) return null;
  try {
    return plansPourTelephone(await lirePlansBkp(p.bkp), [...new Set(strat.lignes.map((l) => l.cle))]);
  } catch (_e) {
    return null;
  }
}

// Une ligne pour le compte rendu du scan.
function texteArchivage(a) {
  if (!a) return null;
  const semaines = [...new Set(a.semaines.map((s) => String(s.semaine).padStart(2, "0")))].join(", ");
  const ou = !bibliotheque.dossier ? "" : a.drive && a.drive.ok ? " et dans le fichier partagé" : " (fichier partagé pas encore à jour : onglet Bibliothèque, Synchroniser)";
  return `📚 ${a.nbLancements} lancement(s) gardé(s) dans la bibliothèque (semaine ${semaines})${ou}`;
}

// ---- Le fichier partagé (dans le dossier Drive choisi) ----
// Un seul fichier, « sentinelle_partage.json.gz » (JSON compressé gzip) :
// { format, genere, par, colonnesPieces, explications, semaines: [{ id, annee, semaine, maj, supprimeeLe, lancements }] }.
// Chaque lancement : nom, fichier, poste, dossier, casse, fichiers comparés, recap (prévues, .bkp, contrôle, scies,
// couleurs), controle (bilan de chaque contrôle), problemes (pièce par pièce), pieces (une ligne par pièce).
// L'appli Android se branche dessus (elle le lit) ; les PC qui choisissent le même dossier le complètent tour à tour.

const signatureSemaine = (s) => (s ? JSON.stringify([s.supprimeeLe || "", ...s.lancements.map((l) => `${cleNomLancement(l.nom)}@${l.maj}`).sort(), JSON.stringify(s.retraits || {})]) : "");
const signatureDesSemaines = (liste) => liste.map((s) => `${s.id}:${signatureSemaine(s)}`).sort().join("|");

// Deux versions d'une semaine : lancement par lancement, le plus récent ; un retrait efface ce qui est plus ancien.
function fusionnerSemaines(a, b) {
  if (!a) return b;
  if (!b) return a;
  const supprimeeLe = [a.supprimeeLe, b.supprimeeLe].filter(Boolean).sort().pop() || null;
  // Lancements retirés d'une semaine (déplacés dans une autre) : la date du retrait la plus récente.
  const retraits = { ...(a.retraits || {}) };
  for (const [k, v] of Object.entries(b.retraits || {})) if (!retraits[k] || v > retraits[k]) retraits[k] = v;
  const parNom = new Map();
  for (const l of [...a.lancements, ...b.lancements]) {
    const k = cleNomLancement(l.nom);
    const x = parNom.get(k);
    if (!x || l.maj > x.maj) parNom.set(k, l);
  }
  const lancements = [...parNom.values()]
    .filter((l) => (!supprimeeLe || l.maj > supprimeeLe) && !(retraits[cleNomLancement(l.nom)] && l.maj <= retraits[cleNomLancement(l.nom)]))
    .sort((x, y) => x.nom.localeCompare(y.nom));
  return { ...a, colonnesPieces: a.colonnesPieces || b.colonnesPieces, maj: a.maj > b.maj ? a.maj : b.maj, supprimeeLe, retraits, lancements };
}

async function compresserJson(objet) {
  const flux = new Blob([JSON.stringify(objet)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

async function lireJsonCompresse(fichier) {
  const flux = fichier.stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(flux).text());
}

// Ce que le fichier partagé contient (toutes les semaines, retirées comprises pour que le retrait se propage).
function contenuFichierPartage() {
  const semaines = [...bibliotheque.semaines.values()]
    .map(({ drive: _drive, ...s }) => s)
    .sort((a, b) => ordreSemaine(a.annee, a.semaine) - ordreSemaine(b.annee, b.semaine));
  // Plans de coupe : seulement les semaines les plus récentes.
  const avecPlans = new Set(semaines.filter((s) => !s.supprimeeLe && s.lancements.length).slice(-SEMAINES_AVEC_PLANS).map((s) => s.id));
  for (let i = 0; i < semaines.length; i++)
    if (!avecPlans.has(semaines[i].id) && semaines[i].lancements.some((l) => l.plans)) semaines[i] = { ...semaines[i], lancements: semaines[i].lancements.map(({ plans: _p, ...l }) => l) };
  return {
    format: FORMAT_PARTAGE,
    genere: new Date().toISOString(),
    par: `${document.title.split(" — ")[0]} (page web)`,
    colonnesPieces: COLONNES_PIECES_BIBLIOTHEQUE,
    explications: Object.fromEntries(PROBLEMES.map(([type, sens, queFaire]) => [type, { sens, queFaire }])),
    semaines,
    // V6.2 : avancement des lancements d'après l'extraction Diakonos (onglet Suivi de production).
    suiviProduction: typeof suiviPourPartage === "function" ? suiviPourPartage() : null,
    // V6.3 : les demandes du téléphone reprises par ce PC (le téléphone les retire de sa file d'attente).
    retourTelephone: typeof retourPourPartage === "function" ? retourPourPartage() : null,
    // V6.4 : les étiquettes validées déjà prises en compte (les PC de validation arrêtent de les renvoyer).
    retourValidations: typeof accusesValidations === "function" ? { traitees: accusesValidations() } : null,
    // V6.5.1 : le stock des panneaux (fichier woodStore chargé sur la page Stock).
    stock: typeof stockPourPartage === "function" ? stockPourPartage() : null,
  };
}

// Signature du fichier partagé : les semaines, le suivi, les réponses au téléphone et les étiquettes prises.
const signaturePartage = (semaines, suivi, retour = null, valid = null) =>
  `${signatureDesSemaines(semaines)}|suivi:${typeof signatureSuivi === "function" ? signatureSuivi(suivi) : ""}|retour:${retour && retour.traitees ? Object.keys(retour.traitees).sort().join(",") : ""}|val:${valid && valid.traitees ? Object.keys(valid.traitees).length : 0}`;

async function ecrireFichierPartage() {
  const octets = await compresserJson(contenuFichierPartage());
  const fh = await bibliotheque.dossier.getFileHandle(NOM_FICHIER_PARTAGE, { create: true });
  const w = await fh.createWritable();
  await w.write(octets);
  await w.close();
  const f = await fh.getFile();
  return { lastModified: f.lastModified, size: f.size };
}

async function enregistrerFichierConnu(infos) {
  bibliotheque.fichier = infos;
  try {
    const db = await ouvrirBaseBibliotheque();
    const tx = db.transaction(MAGASIN_SEMAINES, "readwrite");
    tx.objectStore(MAGASIN_SEMAINES).put({ id: ID_FICHIER_CONNU, ...infos });
    await finTransaction(tx);
  } catch (_erreur) {
    // sans IndexedDB : le fichier sera relu à la prochaine ouverture
  }
}

async function autorisationBibliotheque(interactif) {
  const d = bibliotheque.dossier;
  if (!d || !d.queryPermission) return Boolean(d);
  const options = { mode: "readwrite" };
  if ((await d.queryPermission(options)) === "granted") return true;
  if (!interactif) return false;
  try {
    return (await d.requestPermission(options)) === "granted";
  } catch (_erreur) {
    return false; // la demande doit venir d'un clic : le bouton « Synchroniser » le refera
  }
}

// Semaines écrites par la V5.2 (un fichier par semaine) : reprises une fois, tant que le fichier partagé n'existe pas.
async function semainesDesAnciensFichiers() {
  const semaines = [];
  for await (const [nom, entree] of bibliotheque.dossier.entries()) {
    const m = MOTIF_FICHIER_SEMAINE.exec(nom);
    if (!m || entree.kind !== "file") continue;
    try {
      const s = await lireJsonCompresse(await entree.getFile());
      if (s && Array.isArray(s.lancements)) semaines.push({ ...s, id: `${m[1]}-${m[2]}` });
    } catch (_erreur) {
      // fichier abîmé : ignoré
    }
  }
  return semaines;
}

// Échange avec le fichier partagé : ce qu'il contient de nouveau entre dans la bibliothèque, puis il est réécrit s'il
// lui manque quelque chose. Renvoie { ok, recues, ecrit }.
function synchroniserBibliotheque(interactif) {
  if (!bibliotheque.dossier) return Promise.resolve(null);
  if (bibliotheque.synchro) return bibliotheque.synchro;
  bibliotheque.synchro = (async () => {
    const r = { ok: false, recues: 0, ecrit: false };
    try {
      if (!(await autorisationBibliotheque(interactif))) {
        bibliotheque.etat = { lignes: ["Dossier du fichier partagé pas encore autorisé : cliquez sur « Synchroniser »."], erreur: true };
        return r;
      }
      let fh = null;
      try {
        fh = await bibliotheque.dossier.getFileHandle(NOM_FICHIER_PARTAGE);
      } catch (_absent) {
        fh = null;
      }
      let distantes = null; // semaines lues dans le fichier (null : fichier inchangé depuis le dernier échange)
      let signatureFichier = null;
      if (fh) {
        const f = await fh.getFile();
        const connu = bibliotheque.fichier && bibliotheque.fichier.lastModified === f.lastModified && bibliotheque.fichier.size === f.size;
        if (connu) signatureFichier = bibliotheque.fichier.signature;
        else {
          const contenu = await lireJsonCompresse(f);
          if (!contenu || !Array.isArray(contenu.semaines)) throw new Error(`${NOM_FICHIER_PARTAGE} n'est pas un fichier Sentinelle`);
          distantes = contenu.semaines;
          // Suivi de production écrit par un autre PC : gardé s'il vient d'une extraction plus récente.
          if (typeof SUIVI !== "undefined") SUIVI.recevoir(contenu.suiviProduction);
          if (typeof recevoirRetourDistant === "function") recevoirRetourDistant(contenu.retourTelephone);
          signatureFichier = signaturePartage(distantes, contenu.suiviProduction, contenu.retourTelephone);
        }
      } else distantes = await semainesDesAnciensFichiers();
      for (const d of distantes || []) {
        if (!d || !d.id || !Array.isArray(d.lancements)) continue;
        const locale = bibliotheque.semaines.get(d.id) || null;
        const fusion = fusionnerSemaines(locale ? { ...locale } : null, d);
        if (!locale || signatureSemaine(fusion) !== signatureSemaine(locale)) {
          await enregistrerSemaineLocale(fusion);
          r.recues++;
        }
      }
      const signatureLocale = signaturePartage([...bibliotheque.semaines.values()], typeof suiviPourPartage === "function" ? suiviPourPartage() : null, typeof retourPourPartage === "function" ? retourPourPartage() : null);
      if (!fh || signatureLocale !== signatureFichier) {
        await enregistrerFichierConnu({ ...(await ecrireFichierPartage()), signature: signatureLocale });
        r.ecrit = true;
      } else if (distantes) {
        const f = await fh.getFile();
        await enregistrerFichierConnu({ lastModified: f.lastModified, size: f.size, signature: signatureLocale });
      }
      r.ok = true;
      const heure = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      bibliotheque.etat = {
        lignes: [`Fichier partagé à jour (${heure}) : ${r.recues} semaine(s) reçue(s)${r.ecrit ? ", fichier réécrit" : ""}.`],
        erreur: false,
      };
      if (r.recues) changementBibliotheque();
    } catch (erreur) {
      bibliotheque.etat = { lignes: [`Fichier partagé illisible ou impossible à écrire : ${erreur && erreur.message ? erreur.message : erreur}`], erreur: true };
    } finally {
      bibliotheque.synchro = null;
    }
    return r;
  })();
  return bibliotheque.synchro;
}

// Des semaines reçues : l'écran (casse comprise) se recalcule.
function apresSynchro(r) {
  // Validations faites sur un autre PC (fichier partagé reçu) : reprises ici.
  if (r && r.recues) validationsDepuisBibliotheque([...bibliotheque.semaines.values()]);
  rafraichirBibliotheque();
  if (r && r.recues && estOngletSemaine()) afficher();
}

async function choisirDossierBibliotheque() {
  try {
    const handle = await window.showDirectoryPicker({ id: "bibliotheque", mode: "readwrite" });
    bibliotheque.dossier = handle;
    await sauvegarderPoigneeDossierPartage(handle, "bibliotheque");
  } catch (_annulation) {
    return;
  }
  rafraichirBibliotheque();
  apresSynchro(await synchroniserBibliotheque(true));
}

// Avant un scan (clic de l'utilisateur) : l'autorisation d'écrire le fichier partagé, si elle manque.
async function autoriserBibliothequeAuClic() {
  if (!bibliotheque.dossier) return;
  try {
    await autorisationBibliotheque(true);
  } catch (_erreur) {
    // la bibliothèque restera dans le navigateur jusqu'à la prochaine synchronisation
  }
}

// ---- Ajouter les semaines d'avant : un dossier d'archives (« 2026 » avec ses mois et ses semaines) ----

// Fichier de lancement d'archive : un classeur « LAN… » (pas un Diakonos, une liste de coupe, une analyse ni un rapport).
const estLancementArchive = (nom) =>
  /^LAN/i.test(nom) && estFichierDeLancement(nom) && !estFichierDiakonos(nom) && !/COUPE|CUTRITE|ANALYSE|_problemes|rapport/i.test(nom);

async function importerSemainesBibliotheque() {
  if (bibliotheque.enCours) return;
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: "archives" });
  } catch (_annulation) {
    return;
  }
  bibliotheque.enCours = true;
  const etat = (lignes, erreur = false) => {
    bibliotheque.etat = { lignes, erreur };
    rafraichirBibliotheque();
  };
  etat(["Lecture du dossier…"]);
  try {
    const fichiers = [];
    await listerDossier(handle, [], fichiers, 6);
    // Un lancement et sa version corrigée : la plus récente.
    const parNom = new Map();
    for (const f of fichiers.filter((x) => estLancementArchive(x.nom))) {
      const k = cleNomLancement(f.nom);
      if (!parNom.has(k) || f.date > parNom.get(k).date) parNom.set(k, f);
    }
    const aLire = [...parNom.values()].sort((a, b) => a.nom.localeCompare(b.nom));
    const items = [];
    const ignores = [];
    for (let i = 0; i < aLire.length; i++) {
      const f = aLire[i];
      if (i % 3 === 0) {
        etat([`Lecture des lancements : ${i + 1} / ${aLire.length} (${f.nom})`]);
        await tick();
      }
      try {
        const fichier = await f.entree.getFile();
        const strat = lireStrat(await chargerClasseur(fichier));
        if (!strat.lignes.length) throw new Error("vide");
        const info = decoderNomFichierPartage(f.nom);
        const { semaine: semaineDossier, dossier } = placeDuFichier(f, handle.name);
        const poste = (info && info.poste) || posteDuDossier(dossier) || POSTE_CHANTIERS;
        const casse = poste === "Casse";
        const sem = semaineDuLancement(strat.lignes, casse, f.nom, semaineDossier, strat.semaines);
        if (!sem) throw new Error("semaine introuvable");
        items.push({ ...sem, lancement: ficheLancementBibliotheque(f.nom, strat, { poste, dossier, casse }) });
      } catch (_erreur) {
        ignores.push(f.nom);
      }
    }
    if (!items.length) {
      etat([`Aucun fichier de lancement lisible dans « ${handle.name} ».`], true);
      return;
    }
    let a = await archiverLancements(items);
    // Les casses ajoutées sont analysées avec les semaines d'avant (pour le téléphone), puis le fichier partagé suit.
    if ((await analyserCassesBibliotheque()) && bibliotheque.dossier) await synchroniserBibliotheque(false);
    const numeros = a.semaines.map((s) => ordreSemaine(s.annee, s.semaine)).sort((x, y) => x - y);
    const libelle = (o) => String(o % 100).padStart(2, "0");
    const lignes = [`✔ ${items.length} lancement(s) ajouté(s) : ${a.semaines.length} semaine(s), de la semaine ${libelle(numeros[0])} à la semaine ${libelle(numeros[numeros.length - 1])}.`];
    if (ignores.length) lignes.push(`Pas lus (pas un fichier de lancement) : ${ignores.join(", ")}`);
    if (bibliotheque.etat && bibliotheque.dossier) lignes.push(...bibliotheque.etat.lignes);
    etat(lignes);
    if (estOngletSemaine()) afficher();
  } catch (erreur) {
    etat([`Ajout impossible : ${erreur && erreur.message ? erreur.message : erreur}`], true);
  } finally {
    bibliotheque.enCours = false;
    rafraichirBibliotheque();
  }
}

// Retirer une semaine (partout : la date du retrait part aussi dans le fichier partagé).
// Un lancement rangé dans une autre semaine (dérogation) : retiré des autres semaines de la bibliothèque (le retrait
// est daté, pour qu'une ancienne copie du fichier partagé ne le fasse pas revenir).
async function retirerLancementDesAutresSemaines(nomFichier, idGarde) {
  const k = cleNomLancement(String(nomFichier).replace(/\.[^.]*$/, ""));
  const maintenant = new Date().toISOString();
  let touche = false;
  for (const s of [...bibliotheque.semaines.values()]) {
    if (s.id === idGarde || !s.lancements.some((l) => cleNomLancement(l.nom) === k)) continue;
    await enregistrerSemaineLocale({ ...s, lancements: s.lancements.filter((l) => cleNomLancement(l.nom) !== k), retraits: { ...(s.retraits || {}), [k]: maintenant }, maj: maintenant });
    touche = true;
  }
  if (!touche) return false;
  changementBibliotheque();
  if (bibliotheque.dossier) await synchroniserBibliotheque(false);
  rafraichirBibliotheque();
  return true;
}

async function retirerSemaineBibliotheque(id) {
  const s = bibliotheque.semaines.get(id);
  if (!s) return;
  if (!(await demanderConfirmation(`Retirer la semaine ${String(s.semaine).padStart(2, "0")} de la bibliothèque ?`, "Ses lancements ne serviront plus à contrôler la casse.", "Retirer"))) return;
  const maintenant = new Date().toISOString();
  await enregistrerSemaineLocale({ ...s, lancements: [], supprimeeLe: maintenant, maj: maintenant });
  changementBibliotheque();
  if (bibliotheque.dossier) await synchroniserBibliotheque(false);
  rafraichirBibliotheque();
}

// ---- Onglet Bibliothèque ----

function rafraichirBibliotheque() {
  if (typeof onglet !== "undefined" && onglet === "bibliotheque") afficherBibliotheque();
}

function afficherBibliotheque() {
  const page = $("pageBibliotheque");
  if (!page) return;
  const partage = typeof window.showDirectoryPicker === "function";
  const d = bibliotheque.dossier;
  const semaines = semainesBibliotheque();
  const etat = bibliotheque.etat;
  const date = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  const resumeControle = (l) => {
    if (!l.controle) return "";
    const n = l.controle.nbCorriger + l.controle.nbVerifier;
    return n ? ` <span class="alerte-texte">⚠ ${n}</span>` : ' <span class="ok-texte">✔</span>';
  };
  let html = `${entetePage("Outils", "Bibliothèque des semaines", "Toutes les semaines scannées, et le fichier partagé lu par le téléphone.")}<div class="carte">
    <div class="carte-titre">Bibliothèque des semaines</div>
    <div class="note">Chaque semaine scannée est gardée ici (lancements, pièces, bilan des contrôles). La casse s'en sert pour savoir si une pièce était déjà lancée, même plusieurs semaines avant.</div>
    ${partage
      ? `<div class="ligne-bibliotheque">Fichier partagé : <strong>${d ? `${echapper(d.name)} / ${NOM_FICHIER_PARTAGE}` : "aucun dossier choisi"}</strong></div>
    <div class="note">Sentinelle y écrit toutes les semaines (lancements, résultats, problèmes, pièces). L'appli Android se branche sur ce fichier. Mettez-le dans un dossier du Drive.</div>
    <div class="boutons-carte">
      <button type="button" class="contour" id="btnDossierBibliotheque">${d ? "Changer de dossier" : "Choisir le dossier du fichier partagé"}</button>
      <button type="button" id="btnSynchroniser" ${d && !bibliotheque.synchro ? "" : "disabled"}>Synchroniser</button>
    </div>
    <button type="button" class="contour pleine" id="btnImporterSemaines" ${bibliotheque.enCours ? "disabled" : ""}>+ Ajouter les semaines d'avant (choisir le dossier des archives)</button>`
      : '<div class="note">Fichier partagé et ajout des semaines d\'avant : ouvrez la page dans Chrome ou Edge sur PC.</div>'}
    ${etat ? `<div class="compte-rendu ${etat.erreur ? "erreur" : ""}">${etat.lignes.map(echapper).join("<br>")}</div>` : ""}
  </div>`;
  html += htmlLienTelephone();
  html += `<div class="carte"><div class="carte-titre">Semaines gardées (${semaines.length})</div>`;
  if (!semaines.length) html += '<div class="note">Aucune semaine pour l\'instant : scannez une semaine, ou ajoutez les semaines d\'avant.</div>';
  else {
    html += `<table class="recap bibliotheque"><thead><tr><th>Semaine</th><th>Lancements</th><th class="droite">Pièces</th><th>Mise à jour</th><th></th></tr></thead><tbody>`;
    semaines.forEach((s, i) => {
      const pieces = s.lancements.reduce((t, l) => t + (l.nbPieces || 0), 0);
      const lancements = s.lancements.map((l) => `${echapper(l.nom)}${l.casse ? " (casse)" : ""}${resumeControle(l)}`).join("<br>");
      html += `<tr class="${i % 2 ? "impaire" : ""}"><td><strong>Semaine ${String(s.semaine).padStart(2, "0")}</strong><br><span class="lancement">${s.annee}</span></td>
        <td class="lancements-bibliotheque">${lancements}</td><td class="droite">${fmtNombre(Math.trunc(pieces))}</td><td>${date(s.maj)}</td>
        <td class="centre"><button type="button" class="texte alerte" data-retirer="${echapper(s.id)}" title="Retirer cette semaine">✕</button></td></tr>`;
    });
    html += "</tbody></table>";
  }
  html += "</div>";
  page.innerHTML = html;
  if (partage) {
    $("btnDossierBibliotheque").addEventListener("click", choisirDossierBibliotheque);
    $("btnSynchroniser").addEventListener("click", async () => {
      afficherBibliotheque();
      apresSynchro(await synchroniserBibliotheque(true));
    });
    $("btnImporterSemaines").addEventListener("click", importerSemainesBibliotheque);
  }
  page.querySelectorAll("[data-retirer]").forEach((b) => b.addEventListener("click", () => retirerSemaineBibliotheque(b.dataset.retirer)));
  brancherLienTelephone(page);
}
