// ---- V6.4 : réception des étiquettes validées (suivi en direct) ----
// Chaque PC de validation dépose sur le mini-site, chiffrées, les étiquettes imprimées (= pièces faites), sur
// son propre canal (tiré du code de liaison + numéro de poste). Sentinelle récupère ces étiquettes, lit le CVC
// (module 07j), le recoupe avec les pièces lancées, et marque la pièce faite tout de suite. Les pièces déjà
// prises sont accusées dans le fichier partagé (« retourValidations.traitees ») pour ne pas les refaire.

const POSTES_VALIDATION = ["1", "2", "3", "4"]; // on écoute jusqu'à 4 postes
const CLE_VALIDATIONS_FAITES = "sentinelle-validations-faites"; // pièces faites reçues (gardées sur ce PC)

const validations = {
  lecture: null,
  faites: null, // { cle: { id, jour, poste, nom, commande, ligne, quand } }
  traitees: null, // id déjà pris en compte
  postes: null, // { poste: { nom, dernier, nb } } — activité par poste
  erreur: null,
};

function lireValidationsLocal() {
  if (validations.faites) return;
  try {
    const v = JSON.parse(localStorage.getItem(CLE_VALIDATIONS_FAITES) || "null") || {};
    validations.faites = v.faites || {};
    validations.traitees = v.traitees || {};
    validations.postes = v.postes || {};
  } catch (_e) {
    validations.faites = {};
    validations.traitees = {};
    validations.postes = {};
  }
}

function ecrireValidationsLocal() {
  try {
    localStorage.setItem(CLE_VALIDATIONS_FAITES, JSON.stringify({ faites: validations.faites, traitees: validations.traitees, postes: validations.postes }));
  } catch (_e) {
    // sans stockage : gardé le temps de la page
  }
}

// Remet à zéro le suivi en direct (pratique en phase de dev). Les pièces reviennent à l'état de l'extraction.
function reinitialiserValidations() {
  lireValidationsLocal();
  validations.faites = {};
  validations.postes = {};
  // on garde « traitees » : les étiquettes déjà reçues ne seront pas recomptées (seules les nouvelles le seront).
  ecrireValidationsLocal();
  if (typeof SUIVI !== "undefined" && SUIVI.rafraichirValidations) SUIVI.rafraichirValidations();
}

// Le canal d'un poste de validation (tiré du code, comme le canal du fichier partagé et celui du retour).
async function canalValidationsLien(code, poste) {
  const n = normaliserCodeLien(code);
  return hexLien(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("sentinelle-validations:" + poste + ":" + n))).slice(0, 32);
}

// Les commandes lancées (pour recouper la lecture du CVC) : { commande: [lignes…] } depuis la bibliothèque.
function commandesLancees() {
  const par = new Map();
  for (const s of bibliotheque.semaines.values()) {
    if (s.supprimeeLe || !s.lancements.length) continue;
    const cols = s.colonnesPieces || COLONNES_PIECES_BIBLIOTHEQUE;
    const iCmd = cols.indexOf("commande");
    const iLig = cols.indexOf("ligne");
    for (const l of s.lancements)
      for (const p of l.pieces || []) {
        const cmd = iCmd >= 0 ? String(p[iCmd] ?? "").trim() : "";
        if (!/^CVC\d{8}$/.test(cmd)) continue;
        if (!par.has(cmd)) par.set(cmd, new Set());
        const lig = iLig >= 0 ? String(p[iLig] ?? "").trim() : "";
        if (lig) par.get(cmd).add(lig);
      }
  }
  return [...par.entries()].map(([commande, lignes]) => ({ commande, lignes: [...lignes] }));
}

// Récupère le lot d'un poste (manifeste + parties), déchiffre et renvoie { pc, demandes }. null si rien.
async function telechargerValidations(code, poste) {
  const canal = await canalValidationsLien(code, poste);
  const api = `${ADRESSE_LIEN_TELEPHONE}/api/partage?canal=${canal}`;
  const r = await demandeLien(api, { method: "GET" }, 20000);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`le site a répondu ${r.status}`);
  const m = JSON.parse(r.texte);
  if (!m || !m.version) return null;
  const parties = [];
  for (let i = 0; i < m.parties; i++) parties.push(await partieRetour(`${api}&version=${m.version}&partie=${i}`));
  const paquet = new Uint8Array(parties.reduce((t, p) => t + p.length, 0));
  let k = 0;
  for (const p of parties) {
    paquet.set(p, k);
    k += p.length;
  }
  const secrets = await secretsLien(code);
  const lot = await dechiffrerPaquetLien(secrets.cle, paquet);
  if (!lot || lot.format !== "sentinelle-validations-1" || !Array.isArray(lot.demandes)) throw new Error("ce ne sont pas des étiquettes validées");
  return { version: m.version, pc: lot.pc || poste, nom: lot.nom || "", demandes: lot.demandes };
}

// Lit l'étiquette d'une demande et renvoie la pièce faite { cle, commande, ligne } ou null (lecture douteuse).
async function pieceDeLEtiquette(etiquetteB64, candidats) {
  const octets = Uint8Array.from(atob(etiquetteB64), (c) => c.charCodeAt(0));
  const lu = await lireCvcEtiquette(octets, candidats);
  if (!lu) return null;
  // Sûr si la lecture brute est elle-même une commande lancée (et choisie), ou si la marge est nette.
  const connue = candidats.some((c) => c.commande === lu.commande);
  const sur = connue && (lu.lectureBrute === lu.commande || lu.marge >= 0.015);
  return sur ? { cle: lu.cle, commande: lu.commande, ligne: lu.ligne } : null;
}

// Lit tous les postes, applique les nouvelles étiquettes, renvoie le nombre de pièces nouvellement faites.
function lireValidations() {
  const etat = etatLienTelephone();
  if (!etat || !etat.code) return Promise.resolve(0);
  if (validations.lecture) return validations.lecture;
  lireValidationsLocal();
  const lecture = (async () => {
    await null;
    let nouvelles = 0;
    try {
      const candidats = commandesLancees();
      for (const poste of POSTES_VALIDATION) {
        let lot;
        try {
          lot = await telechargerValidations(etat.code, poste);
        } catch (_e) {
          continue; // ce poste ne répond pas / illisible : on passe
        }
        if (!lot) continue;
        const nomPoste = lot.nom || ("Poste " + lot.pc);
        // Activité du poste : nom + dernière réception (même s'il n'y a rien de nouveau).
        const act = validations.postes[lot.pc] || { nb: 0 };
        act.nom = nomPoste;
        validations.postes[lot.pc] = act;
        for (const d of lot.demandes) {
          if (!d || typeof d.id !== "string" || !d.id || validations.traitees[d.id]) continue;
          validations.traitees[d.id] = { jour: d.jour || "", poste: lot.pc };
          let piece = null;
          try {
            piece = await pieceDeLEtiquette(d.etiquette, candidats);
          } catch (_e) {
            piece = null;
          }
          if (piece && !validations.faites[piece.cle]) {
            validations.faites[piece.cle] = { id: d.id, jour: d.jour || "", poste: lot.pc, nom: nomPoste, commande: piece.commande, ligne: piece.ligne, quand: new Date().toISOString() };
            act.nb = (act.nb || 0) + 1;
            act.dernier = new Date().toISOString();
            nouvelles++;
          }
        }
      }
      ecrireValidationsLocal();
      validations.erreur = null;
      if (nouvelles && typeof SUIVI !== "undefined") SUIVI.rafraichirValidations && SUIVI.rafraichirValidations();
    } catch (erreur) {
      const t = erreur && erreur.message ? erreur.message : String(erreur);
      validations.erreur = /failed to fetch|networkerror|network/i.test(t) ? "pas de connexion au site de Sentinelle" : t;
    } finally {
      if (validations.lecture === lecture) validations.lecture = null;
    }
    return nouvelles;
  })();
  validations.lecture = lecture;
  return lecture;
}

// L'ensemble des clés de pièces faites reçues des PC de validation (pour le suivi).
function clesValidees() {
  lireValidationsLocal();
  return new Set(Object.keys(validations.faites || {}));
}

// Les accusés à mettre dans le fichier partagé (pour que les PC arrêtent de renvoyer ces étiquettes).
// On ne garde que les plus récents (file bornée), pour ne pas gonfler le fichier partagé.
const MAX_ACCUSES = 3000;
function accusesValidations() {
  lireValidationsLocal();
  const ids = Object.keys(validations.traitees || {});
  const gardes = ids.slice(-MAX_ACCUSES);
  const t = {};
  for (const id of gardes) t[id] = validations.traitees[id] || {};
  return t;
}

// ---- Lecture régulière (suivi en direct) ----

const DELAI_VALIDATIONS_MS = 8000;

function demarrerValidations() {
  lireValidations();
  clearInterval(validations.minuteur);
  validations.minuteur = setInterval(() => {
    if (!document.hidden) lireValidations();
  }, DELAI_VALIDATIONS_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) lireValidations();
  });
}

// Un petit bandeau sur l'écran Suivi : les pièces faites reçues en direct des PC de validation.
function htmlBandeauValidations() {
  const etat = etatLienTelephone();
  if (!etat || !etat.code) return ""; // pas de lien : pas de postes de validation
  lireValidationsLocal();
  const n = Object.keys(validations.faites || {}).length;
  const postes = Object.entries(validations.postes || {}).sort(([a], [b]) => a.localeCompare(b));
  if (n === 0 && !postes.length && !validations.erreur) return "";
  // Fonctions internes au module Suivi (fmt, jourCourt) non accessibles ici : on reste autonome.
  const nombre = (v) => Number(v || 0).toLocaleString("fr-FR");
  const quand = (iso) => {
    try {
      return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch (_e) {
      return "—";
    }
  };
  const err = validations.erreur ? `<div class="note sv-t-retard">${echapper(validations.erreur)}</div>` : "";
  const mot = n > 1 ? "pièces faites reçues en direct" : "pièce faite reçue en direct";
  // Activité par poste.
  const lignes = postes
    .map(([, p]) => `<tr><td>${echapper(p.nom || "")}</td><td class="nombre">${nombre(p.nb || 0)}</td><td>${p.dernier ? echapper(quand(p.dernier)) : "—"}</td></tr>`)
    .join("");
  const table = postes.length
    ? `<table class="sv-table" style="margin-top:6px"><thead><tr><th>Poste</th><th class="nombre">Pièces faites</th><th>Dernière</th></tr></thead><tbody>${lignes}</tbody></table>`
    : "";
  return `<div class="sv-direct">⚡ <strong>${nombre(n)}</strong> ${mot} des postes de validation (étiquette imprimée = pièce faite)
    <button type="button" class="texte" id="svReinitValidations" style="margin-left:10px">Réinitialiser</button>
    ${table}${err}</div>`;
}
