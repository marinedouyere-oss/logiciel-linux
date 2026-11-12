// ---- Lien avec le téléphone (sans Drive) ----
// Le fichier partagé est CHIFFRÉ ici (AES-GCM, clé tirée du code de liaison par PBKDF2) puis envoyé tout seul sur le
// mini-site de Sentinelle ; l'appli du téléphone le récupère avec le même code et le déchiffre. Le site ne garde qu'un
// fichier illisible ; le code n'est jamais envoyé (seulement le canal et le jeton d'écriture qui en sont tirés).

const ADRESSE_LIEN_TELEPHONE = "https://sentinelle-laisne-0ysi8zpn.netlify.app";
const CLE_LIEN_TELEPHONE = "sentinelle-lien-telephone";
const SEL_LIEN = "sentinelle-laisne-industrie";
const ITERATIONS_LIEN = 150000;
const TAILLE_PARTIE_LIEN = 4 * 1024 * 1024;
const ALPHABET_CODE_LIEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O ni 1/I : se recopie sans erreur
// Le QR code affiché contient « SENTINELLE:ABCD-EFGH-JKLM-NPQR » : l'appli le scanne (le code tapé marche toujours).
const PREFIXE_QR_LIEN = "SENTINELLE:";

const lienTelephone = { envoi: null, minuteur: null, reprendre: false, etape: "", essais: 0 };
// Après un envoi raté : nouvel essai tout seul au bout de 2, 10 puis 30 minutes (ensuite toutes les 30 minutes).
const RELANCES_LIEN_MS = [2, 10, 30].map((m) => m * 60000);

// Une demande au site qui abandonne au bout d'un délai : un réseau qui ne répond jamais ne doit pas laisser
// l'envoi bloqué sur « Envoi en cours ».
async function demandeLien(url, options, delai) {
  if (lienTelephone.delaiMax) delai = Math.min(delai, lienTelephone.delaiMax); // essais (tests)
  const controle = new AbortController();
  const minuteur = setTimeout(() => controle.abort(), delai);
  try {
    const reponse = await fetch(url, { ...options, cache: "no-store", signal: controle.signal });
    // Le corps est lu ici, sous le même délai (petit : réponse JSON du site).
    const texte = await reponse.text();
    return { ok: reponse.ok, status: reponse.status, texte };
  } catch (erreur) {
    if (controle.signal.aborted) throw new Error(`le site ne répond pas (rien en ${Math.round(delai / 1000)} s)`);
    throw erreur;
  } finally {
    clearTimeout(minuteur);
  }
}

// Délai d'une partie : 1 minute, plus 1 seconde par 25 Ko (connexion lente).
const delaiPartieLien = (octets) => 60000 + Math.ceil(octets / 25600) * 1000;
const moLien = (octets) =>
  octets < 1048576 ? `${Math.max(1, Math.round(octets / 1024))} Ko` : `${(octets / 1048576).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;

function etapeLien(texte) {
  lienTelephone.etape = texte;
  rafraichirBibliotheque();
}

function lireLienTelephone() {
  try {
    return JSON.parse(localStorage.getItem(CLE_LIEN_TELEPHONE) || "null");
  } catch (_e) {
    return null;
  }
}

function ecrireLienTelephone(etat) {
  try {
    if (etat) localStorage.setItem(CLE_LIEN_TELEPHONE, JSON.stringify(etat));
    else localStorage.removeItem(CLE_LIEN_TELEPHONE);
  } catch (_e) {
    // sans stockage : le lien dure le temps de la page
  }
  lienTelephone.memoire = etat;
  garderCodeDansLExe(etat ? etat.code : null);
}

// ---- V6.5.2 : le code tient. Sentinelle.exe le garde aussi dans un fichier de l'ordinateur ----
// (%LOCALAPPDATA%\Sentinelle\lien-telephone.json). Si Chrome perd sa mémoire, le même code revient tout seul :
// le téléphone et les PC de validation n'ont rien à refaire.
const MEMOIRE_LIEN_EXE = "/sentinelle/lien";
const servieParLExe = () => location.protocol === "http:" && (location.hostname === "127.0.0.1" || location.hostname === "localhost");

function garderCodeDansLExe(code) {
  if (!servieParLExe() || lienTelephone.codeGarde === (code || null)) return;
  lienTelephone.codeGarde = code || null;
  fetch(MEMOIRE_LIEN_EXE, {
    method: "PUT",
    headers: { "X-Sentinelle": "lien", "Content-Type": "application/json" },
    body: JSON.stringify({ code: code || null, quand: new Date().toISOString() }),
  }).catch(() => {
    lienTelephone.codeGarde = undefined; // réessayé au prochain changement
  });
}

// Au démarrage : le code gardé par le .exe revient si la mémoire du navigateur l'a perdu.
async function restaurerLienTelephone() {
  if (!servieParLExe()) return;
  const local = etatLienTelephone();
  let fichier = null;
  try {
    const r = await fetch(MEMOIRE_LIEN_EXE, { headers: { "X-Sentinelle": "lien" }, cache: "no-store" });
    if (r.ok) fichier = await r.json();
  } catch (_e) {
    fichier = null; // ancienne version du .exe ou page ouverte autrement
  }
  const code = fichier && typeof fichier.code === "string" && normaliserCodeLien(fichier.code).length === 16 ? formaterCodeLien(fichier.code) : null;
  if (local && local.code) {
    lienTelephone.codeGarde = code;
    garderCodeDansLExe(local.code); // première fois en 6.5.2 : le code du navigateur part dans le fichier
    return;
  }
  if (!code) return;
  lienTelephone.codeGarde = code;
  lienTelephone.memoire = undefined;
  ecrireLienTelephone({ code, signature: null, dernierEnvoi: null, erreur: null, repris: new Date().toISOString() });
  planifierEnvoiTelephone(); // le téléphone reçoit les nouveautés dès l'ouverture
}

const formaterCodeLien = (code) => normaliserCodeLien(code).replace(/(.{4})(?!$)/g, "$1-");

// Reprendre le code d'un téléphone déjà relié (affiché dans l'appli) : rien à refaire sur le téléphone.
async function reprendreCodeLienTelephone() {
  const champ = document.getElementById("champCodeLien");
  const n = normaliserCodeLien(champ ? champ.value : "");
  if (n.length !== 16 || [...n].some((c) => !ALPHABET_CODE_LIEN.includes(c))) {
    lienTelephone.erreurCode = "Le code a 16 lettres et chiffres (ABCD-EFGH-JKLM-NPQR) : recopiez celui de l'appli (icône du livre → Lien avec le PC).";
    rafraichirBibliotheque();
    return;
  }
  const actuel = etatLienTelephone();
  if (actuel && actuel.code && normaliserCodeLien(actuel.code) === n) {
    lienTelephone.erreurCode = null;
    await envoyerAuTelephone(true);
    return;
  }
  lienTelephone.erreurCode = null;
  ecrireLienTelephone({ code: formaterCodeLien(n), signature: null, dernierEnvoi: null, erreur: null, repris: new Date().toISOString() });
  rafraichirBibliotheque();
  await envoyerAuTelephone(true);
}

function htmlReprendreCode(ouvert) {
  return `<details class="reprendre-code"${ouvert ? " open" : ""}>
      <summary>${ouvert ? "Un téléphone est déjà relié ? Reprenez son code" : "Le téléphone a un autre code ? Reprenez-le ici"}</summary>
      <div class="note">Dans l'appli : icône du livre en haut → carte « Lien avec le PC » → « Code ABCD-… ». Tapez ce code ici : le téléphone et les PC de validation n'ont <strong>rien à refaire</strong>.</div>
      <div class="ligne-code-lien">
        <input type="text" id="champCodeLien" placeholder="ABCD-EFGH-JKLM-NPQR" maxlength="24" autocomplete="off" spellcheck="false">
        <button type="button" id="btnReprendreLien">Reprendre ce code</button>
      </div>
      ${lienTelephone.erreurCode ? `<div class="compte-rendu erreur">${echapper(lienTelephone.erreurCode)}</div>` : ""}
    </details>`;
}

const etatLienTelephone = () => lienTelephone.memoire !== undefined ? lienTelephone.memoire : lireLienTelephone();

// « ABCD-EFGH-JKLM-NPQR » : 16 caractères au hasard (80 bits).
function nouveauCodeLien() {
  const octets = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(octets, (o) => ALPHABET_CODE_LIEN[o % 32]).join("").replace(/(.{4})(?!$)/g, "$1-");
}

const normaliserCodeLien = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const hexLien = (tampon) => [...new Uint8Array(tampon)].map((o) => o.toString(16).padStart(2, "0")).join("");

// Canal (où est le fichier), jeton d'écriture (seul ce PC peut le remplacer) et clé de chiffrement, tirés du code.
async function secretsLien(code) {
  const n = normaliserCodeLien(code);
  const enc = new TextEncoder();
  const canal = hexLien(await crypto.subtle.digest("SHA-256", enc.encode("sentinelle-canal:" + n))).slice(0, 32);
  const jeton = hexLien(await crypto.subtle.digest("SHA-256", enc.encode("sentinelle-ecriture:" + n)));
  const base = await crypto.subtle.importKey("raw", enc.encode(n), "PBKDF2", false, ["deriveKey"]);
  const cle = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(SEL_LIEN), iterations: ITERATIONS_LIEN, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  return { canal, jeton, cle };
}

// « SNT1 » + vecteur (12 octets) + fichier partagé chiffré (avec son étiquette d'authenticité).
async function paquetChiffre(cle, octets) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cle, octets));
  const paquet = new Uint8Array(16 + chiffre.length);
  paquet.set(new TextEncoder().encode("SNT1"), 0);
  paquet.set(iv, 4);
  paquet.set(chiffre, 16);
  return paquet;
}

async function envoyerPaquetLien(secrets, paquet, genere) {
  const version = Date.now().toString(36) + hexLien(crypto.getRandomValues(new Uint8Array(4)));
  const parties = Math.max(1, Math.ceil(paquet.length / TAILLE_PARTIE_LIEN));
  const api = `${ADRESSE_LIEN_TELEPHONE}/api/partage?canal=${secrets.canal}`;
  const verifier = (r) => {
    if (r.ok) return;
    let detail = "";
    try {
      detail = JSON.parse(r.texte).erreur || "";
    } catch (_e) {
      detail = "";
    }
    throw new Error(`le site a répondu ${r.status}${detail ? ` (${detail})` : ""}`);
  };
  for (let i = 0; i < parties; i++) {
    const morceau = paquet.slice(i * TAILLE_PARTIE_LIEN, (i + 1) * TAILLE_PARTIE_LIEN);
    etapeLien(`envoi ${parties > 1 ? `partie ${i + 1}/${parties}, ` : ""}${moLien(morceau.length)}`);
    verifier(
      await demandeLien(
        `${api}&version=${version}&partie=${i}`,
        { method: "PUT", headers: { "X-Sentinelle-Jeton": secrets.jeton, "Content-Type": "application/octet-stream" }, body: morceau },
        delaiPartieLien(morceau.length)
      )
    );
  }
  etapeLien("publication");
  verifier(
    await demandeLien(
      api,
      { method: "POST", headers: { "X-Sentinelle-Jeton": secrets.jeton, "Content-Type": "application/json" }, body: JSON.stringify({ version, parties, taille: paquet.length, genere }) },
      30000
    )
  );
  return version;
}

// Après un envoi raté : le site répond-il au moins en lecture ? (dit si c'est l'envoi qui est bloqué par le réseau).
async function diagnosticLien(secrets) {
  try {
    const r = await demandeLien(`${ADRESSE_LIEN_TELEPHONE}/api/partage?canal=${secrets.canal}`, { method: "GET" }, 15000);
    return r.ok || r.status === 404
      ? "le site répond en lecture : c'est l'envoi qui n'aboutit pas (le réseau de ce PC bloque sans doute l'envoi de fichiers)"
      : `le site répond ${r.status}`;
  } catch (_e) {
    return "le site est injoignable depuis ce PC (internet coupé, ou site bloqué par le réseau)";
  }
}

const signatureEnvoi = () =>
  signaturePartage([...bibliotheque.semaines.values()], typeof suiviPourPartage === "function" ? suiviPourPartage() : null, typeof retourPourPartage === "function" ? retourPourPartage() : null) +
  `|stock:${typeof signatureStock === "function" ? signatureStock() : ""}`;

// ---- V6.5.3 : plusieurs PC sur le même code (bureau, maison…) ----
// Le site garde le dernier envoi. Si un AUTRE PC l'a publié, ses semaines sont fusionnées dans notre bibliothèque
// (comme le fichier partagé du Drive : lancement par lancement, le plus récent), avec son suivi et son stock s'ils sont
// plus récents. Le prochain envoi contient alors les lancements des deux PC : le téléphone a tout.
async function reprendreDuSite(secrets) {
  const etat = etatLienTelephone();
  if (!etat || !etat.code) return 0;
  const api = `${ADRESSE_LIEN_TELEPHONE}/api/partage?canal=${secrets.canal}`;
  const r = await demandeLien(api, { method: "GET" }, 20000);
  if (!r.ok) return 0; // rien sur le site (404) ou site injoignable : on continue
  const m = JSON.parse(r.texte);
  if (!m || !m.version || m.version === etat.version || m.version === etat.versionReprise || !(m.parties >= 1 && m.parties <= 60)) return 0;
  const parties = [];
  for (let i = 0; i < m.parties; i++) parties.push(await partieRetour(`${api}&version=${m.version}&partie=${i}`));
  const paquet = new Uint8Array(parties.reduce((t, p) => t + p.length, 0));
  let k = 0;
  for (const p of parties) {
    paquet.set(p, k);
    k += p.length;
  }
  const contenu = await dechiffrerPaquetLien(secrets.cle, paquet);
  let recues = 0;
  if (contenu && Array.isArray(contenu.semaines) && !contenu.lien) {
    for (const d of contenu.semaines) {
      if (!d || !d.id || !Array.isArray(d.lancements)) continue;
      const locale = bibliotheque.semaines.get(d.id) || null;
      const fusion = fusionnerSemaines(locale ? { ...locale } : null, d);
      if (!locale || signatureSemaine(fusion) !== signatureSemaine(locale)) {
        await enregistrerSemaineLocale(fusion);
        recues++;
      }
    }
    if (typeof SUIVI !== "undefined" && contenu.suiviProduction) SUIVI.recevoir(contenu.suiviProduction);
    if (typeof recevoirRetourDistant === "function") recevoirRetourDistant(contenu.retourTelephone);
    if (typeof recevoirStockDistant === "function") recevoirStockDistant(contenu.stock);
  }
  ecrireLienTelephone({ ...etatLienTelephone(), versionReprise: m.version, repriseLe: new Date().toISOString(), repriseDe: String((contenu && contenu.poste) || "") });
  if (recues) {
    bibliotheque.generation++;
    bibliotheque.index = null;
    lienTelephone.recuesDuSite = (lienTelephone.recuesDuSite || 0) + recues;
  }
  return recues;
}

// Toutes les 2 minutes (page ouverte) : ce qu'un autre PC a publié revient ici ; s'il y a du nouveau, on renvoie
// l'ensemble au téléphone.
async function synchroniserAvecLeSite() {
  const etat = etatLienTelephone();
  if (!etat || !etat.code || lienTelephone.envoi || lienTelephone.synchro) return 0;
  lienTelephone.synchro = true;
  try {
    const n = await reprendreDuSite(await secretsLien(etat.code));
    if (n) {
      changementBibliotheque();
      if (typeof afficher === "function") afficher();
    } else if (signatureEnvoi() !== (etatLienTelephone() || {}).signature) {
      // V6.5.4 : un changement pas encore parti (Sentinelle fermée trop tôt, envoi raté…) : il part maintenant.
      envoyerAuTelephone(false);
    }
    return n;
  } catch (_e) {
    return 0;
  } finally {
    lienTelephone.synchro = false;
  }
}

// Le nom de ce PC (donné par Sentinelle.exe) : le téléphone dit de quel PC viennent ses données.
async function chargerNomPoste() {
  if (!servieParLExe()) return;
  try {
    const r = await fetch("/sentinelle/poste", { headers: { "X-Sentinelle": "lien" }, cache: "no-store" });
    if (r.ok) lienTelephone.poste = (await r.text()).trim().slice(0, 60);
  } catch (_e) {
    // ancienne version du .exe
  }
}

// Envoie la bibliothèque au téléphone si elle a changé depuis le dernier envoi (ou si forcer).
function envoyerAuTelephone(forcer = false) {
  const etat = etatLienTelephone();
  if (!etat || !etat.code) return Promise.resolve(null);
  if (lienTelephone.envoi) {
    lienTelephone.reprendre = true; // un changement pendant l'envoi : on renverra après
    return lienTelephone.envoi;
  }
  // Rien n'a changé depuis le dernier envoi réussi : rien à faire (et surtout rien qui reste « en cours »).
  const signature = signatureEnvoi();
  if (!forcer && etat.signature === signature && !etat.erreur) return Promise.resolve({ ok: true, inchange: true });
  clearTimeout(lienTelephone.relance);
  const envoi = (async () => {
    // La suite tourne une fois « lienTelephone.envoi » posé : sinon, une fin immédiate le laissait posé pour toujours
    // (« Envoi en cours… » sans fin, plus aucun envoi jusqu'au rechargement de la page).
    await null;
    let secrets = null;
    try {
      etapeLien("préparation");
      secrets = await secretsLien(etat.code);
      // V6.5.3 : un autre PC sur le même code a pu publier : ses lancements sont repris avant d'envoyer.
      etapeLien("lecture du site");
      await reprendreDuSite(secrets).catch(() => 0);
      const signature = signatureEnvoi();
      const contenu = contenuFichierPartage();
      const paquet = await paquetChiffre(secrets.cle, await compresserJson(contenu));
      const version = await envoyerPaquetLien(secrets, paquet, contenu.genere);
      const nbSemaines = [...bibliotheque.semaines.values()].filter((s) => s.lancements.length).length;
      // V6.5.4 : ce qui est parti, semaine par semaine (la carte Téléphone le montre : on voit tout de suite ce que le téléphone a).
      const envoye = contenu.semaines
        .filter((s) => !s.supprimeeLe && s.lancements.length)
        .map((s) => ({ s: `S${s.semaine} ${s.annee}`, l: s.lancements.map((l) => l.nom) }));
      ecrireLienTelephone({ ...etatLienTelephone(), signature, dernierEnvoi: new Date().toISOString(), version, nbSemaines, envoye, erreur: null });
      lienTelephone.essais = 0;
      return { ok: true };
    } catch (erreur) {
      const texte = erreur && erreur.message ? erreur.message : String(erreur);
      const raison = /failed to fetch|networkerror|network|réseau/i.test(texte) ? "pas de connexion au site" : texte;
      // Pas de réponse du site : on regarde s'il répond au moins en lecture (sinon, sa réponse dit déjà tout).
      const diagnostic = secrets && !/^le site a répondu/.test(texte) ? await diagnosticLien(secrets) : "";
      const etape = lienTelephone.etape ? ` à l'étape « ${lienTelephone.etape} »` : "";
      ecrireLienTelephone({ ...etatLienTelephone(), erreur: `${raison}${etape}${diagnostic ? ` — ${diagnostic}` : ""}` });
      // Nouvel essai tout seul un peu plus tard.
      const delai = RELANCES_LIEN_MS[Math.min(lienTelephone.essais, RELANCES_LIEN_MS.length - 1)];
      lienTelephone.essais++;
      lienTelephone.prochainEssai = Date.now() + delai;
      lienTelephone.relance = setTimeout(() => envoyerAuTelephone(false), delai);
      return { ok: false, erreur: texte };
    } finally {
      if (lienTelephone.envoi === envoi) lienTelephone.envoi = null;
      lienTelephone.etape = "";
      rafraichirBibliotheque();
      if (lienTelephone.reprendre) {
        lienTelephone.reprendre = false;
        planifierEnvoiTelephone();
      }
    }
  })();
  lienTelephone.envoi = envoi;
  rafraichirBibliotheque();
  return envoi;
}

// Après chaque changement de la bibliothèque : envoi quelques secondes plus tard (un seul pour plusieurs changements).
function planifierEnvoiTelephone() {
  const etat = etatLienTelephone();
  if (!etat || !etat.code) return;
  clearTimeout(lienTelephone.minuteur);
  lienTelephone.minuteur = setTimeout(() => envoyerAuTelephone(false), 3000);
}

async function activerLienTelephone() {
  ecrireLienTelephone({ code: nouveauCodeLien(), signature: null, dernierEnvoi: null, erreur: null });
  rafraichirBibliotheque();
  await envoyerAuTelephone(true);
}

// V6.5.1 : un dernier envoi sur l'ANCIEN code, marqué « code remplacé » ou « envoi arrêté » : le téléphone resté sur
// cet ancien code le dit en rouge (avant, il gardait l'ancienne version sans rien dire et ne recevait plus rien).
async function prevenirAncienCode(etat, avis) {
  if (!etat || !etat.code) return;
  try {
    const secrets = await secretsLien(etat.code);
    const contenu = { ...contenuFichierPartage(), lien: avis };
    await envoyerPaquetLien(secrets, await paquetChiffre(secrets.cle, await compresserJson(contenu)), contenu.genere);
  } catch (_e) {
    // pas de réseau : tant pis (le PC dit quand même qu'il faut rescanner le QR code)
  }
}

async function nouveauCodeLienTelephone() {
  if (!(await demanderConfirmation("Nouveau code pour le téléphone ?", "L'ancien code ne marchera plus : il faudra rescanner le QR code avec l'appli ET refaire le réglage des PC de validation. À ne faire que si le code a été donné à quelqu'un qui ne doit plus l'avoir.", "Nouveau code"))) return;
  const ancien = etatLienTelephone();
  await activerLienTelephone();
  prevenirAncienCode(ancien, "remplace");
}

async function arreterLienTelephone() {
  if (!(await demanderConfirmation("Arrêter l'envoi au téléphone ?", "Le téléphone ne recevra plus les nouvelles semaines (il garde la dernière version reçue).", "Arrêter"))) return;
  const ancien = etatLienTelephone();
  ecrireLienTelephone(null);
  rafraichirBibliotheque();
  prevenirAncienCode(ancien, "arrete");
}

// V6.5.1 : le téléphone a-t-il bien reçu le dernier envoi ? (il le dit au PC quand il a lu une nouvelle version)
function htmlLectureTelephone(etat) {
  const date = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "?");
  const lectures = typeof lecturesTelephone === "function" ? lecturesTelephone(etat.code) : [];
  if (!lectures.length) {
    if (!etat.dernierEnvoi) return "";
    return `<div class="compte-rendu erreur" id="lectureTelephone">⚠ Aucun téléphone n'a encore lu ce code. Si le téléphone n'a pas les nouveautés : dans l'appli, icône du livre en haut → « Délier », puis « Scanner le QR code du PC » et visez ce QR code. (Il faut l'appli 6.5.1 ou plus pour voir ici ce que le téléphone a reçu.)</div>`;
  }
  return lectures
    .slice(0, 3)
    .map((l) => {
      const aJour = !etat.version || l.version === etat.version;
      const qui = lectures.length > 1 ? `Téléphone ${l.appareil.slice(0, 4)}` : "Le téléphone";
      return aJour
        ? `<div class="compte-rendu" id="lectureTelephone">📱 ${qui} a bien reçu le dernier envoi (ouvert ${echapper(date(l.quand))}).</div>`
        : `<div class="compte-rendu attention" id="lectureTelephone">📱 ${qui} n'a pas encore ouvert le dernier envoi (dernière ouverture ${echapper(date(l.quand))}). Il le recevra en ouvrant l'appli.</div>`;
    })
    .join("");
}

// Carte de la page Bibliothèque.
function htmlLienTelephone() {
  const etat = etatLienTelephone();
  const date = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  let html = `<div class="carte" id="carteLienTelephone"><div class="carte-titre">Téléphone (envoi automatique)</div>`;
  if (!etat || !etat.code) {
    html += `<div class="note">Sentinelle envoie toute seule la bibliothèque au téléphone, chiffrée, à chaque changement : plus besoin du Drive. Le site de Sentinelle ne garde qu'un fichier illisible.</div>
      ${htmlReprendreCode(true)}
      <div class="note">Premier téléphone seulement :</div>
      <div class="boutons-carte"><button type="button" class="contour" id="btnActiverLien">Créer un code (nouveau téléphone)</button></div>`;
  } else {
    const heure = (ms) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const statut = lienTelephone.envoi
      ? `Envoi en cours…${lienTelephone.etape ? ` (${lienTelephone.etape})` : ""}`
      : etat.erreur
        ? `⚠ Dernier envoi raté : ${etat.erreur}.${lienTelephone.prochainEssai > Date.now() ? ` Nouvel essai à ${heure(lienTelephone.prochainEssai)}.` : ""}${etat.dernierEnvoi ? ` Le téléphone a la version du ${date(etat.dernierEnvoi)}.` : ""}`
        : etat.dernierEnvoi
          ? `✔ Envoyé le ${date(etat.dernierEnvoi)} (${etat.nbSemaines || 0} semaine(s))`
          : "Pas encore envoyé.";
    let qr = "";
    try {
      qr = qrSvg(PREFIXE_QR_LIEN + etat.code, 180);
    } catch (_e) {
      qr = "";
    }
    html += `<div class="lien-qr">
        ${qr ? `<div class="qr-cadre" id="qrLien" title="QR code du lien avec le téléphone">${qr}</div>` : ""}
        <div class="lien-qr-texte">
          <div class="note">Dans l'appli du téléphone : l'icône du livre (en haut) → <strong>« Scanner le QR code du PC »</strong>, et visez ce QR code (une seule fois). Le téléphone suit le code de <strong>ce</strong> PC : un nouveau code, ou un autre PC, demande de rescanner.</div>
          <div class="note">Ou tapez le code :</div>
          <div class="code-lien" id="codeLien">${echapper(etat.code)}</div>
        </div>
      </div>
      <div class="compte-rendu ${etat.erreur && !lienTelephone.envoi ? "erreur" : ""}" id="etatLien">${echapper(statut)}</div>
      ${htmlLectureTelephone(etat)}
      ${Object.keys(bibliotheque.nonArchives || {}).length ? `<div class="compte-rendu erreur">⚠ Pas dans la bibliothèque, donc <strong>pas envoyé au téléphone</strong> : ${Object.entries(bibliotheque.nonArchives).map(([nom, raison]) => `${echapper(nom)} (${echapper(raison)})`).join(" ; ")}</div>` : ""}
      ${Array.isArray(etat.envoye) && etat.envoye.length ? `<details class="reprendre-code"><summary>Ce que le téléphone a reçu au dernier envoi (${etat.envoye.reduce((t, x) => t + x.l.length, 0)} lancements)</summary>${etat.envoye.map((x) => `<div class="note"><strong>${echapper(x.s)}</strong> : ${echapper(x.l.join(", "))}</div>`).join("")}</details>` : ""}
      ${etat.repriseLe ? `<div class="note">Lancements des autres PC sur ce code : relus sur le site ${echapper(date(etat.repriseLe))}${etat.repriseDe ? ` (dernier envoi de ${echapper(etat.repriseDe)})` : ""}${lienTelephone.recuesDuSite ? ` · ${lienTelephone.recuesDuSite} semaine(s) complétée(s)` : ""}.</div>` : ""}
      ${lienTelephone.poste ? `<div class="note">Ce PC : <strong>${echapper(lienTelephone.poste)}</strong>. Un autre PC peut envoyer au même téléphone : tapez-y le même code (« Reprenez son code ») ; les lancements des deux PC sont mis en commun.</div>` : ""}
      ${htmlReprendreCode(false)}
      ${typeof htmlRetourTelephone === "function" ? htmlRetourTelephone() : ""}
      <div class="boutons-carte">
        <button type="button" id="btnEnvoyerLien" ${lienTelephone.envoi ? "disabled" : ""}>Envoyer maintenant</button>
        <button type="button" class="contour" id="btnNouveauCodeLien">Nouveau code</button>
        <button type="button" class="contour" id="btnArreterLien">Arrêter</button>
      </div>`;
  }
  return html + "</div>";
}

function brancherLienTelephone(page) {
  const b = (id, f) => {
    const x = page.querySelector(`#${id}`);
    if (x) x.addEventListener("click", f);
  };
  b("btnActiverLien", activerLienTelephone);
  b("btnEnvoyerLien", () => {
    const p = envoyerAuTelephone(true);
    rafraichirBibliotheque();
    return p;
  });
  b("btnNouveauCodeLien", nouveauCodeLienTelephone);
  b("btnReprendreLien", reprendreCodeLienTelephone);
  const champ = page.querySelector("#champCodeLien");
  if (champ)
    champ.addEventListener("keydown", (e) => {
      if (e.key === "Enter") reprendreCodeLienTelephone();
    });
  b("btnArreterLien", arreterLienTelephone);
}
