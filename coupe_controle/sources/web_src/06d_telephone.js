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

// Envoie la bibliothèque au téléphone si elle a changé depuis le dernier envoi (ou si forcer).
function envoyerAuTelephone(forcer = false) {
  const etat = etatLienTelephone();
  if (!etat || !etat.code) return Promise.resolve(null);
  if (lienTelephone.envoi) {
    lienTelephone.reprendre = true; // un changement pendant l'envoi : on renverra après
    return lienTelephone.envoi;
  }
  // Rien n'a changé depuis le dernier envoi réussi : rien à faire (et surtout rien qui reste « en cours »).
  const signature = signaturePartage([...bibliotheque.semaines.values()], typeof suiviPourPartage === "function" ? suiviPourPartage() : null, typeof retourPourPartage === "function" ? retourPourPartage() : null);
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
      const contenu = contenuFichierPartage();
      const paquet = await paquetChiffre(secrets.cle, await compresserJson(contenu));
      await envoyerPaquetLien(secrets, paquet, contenu.genere);
      const nbSemaines = [...bibliotheque.semaines.values()].filter((s) => s.lancements.length).length;
      ecrireLienTelephone({ ...etatLienTelephone(), signature, dernierEnvoi: new Date().toISOString(), nbSemaines, erreur: null });
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

async function nouveauCodeLienTelephone() {
  if (!(await demanderConfirmation("Nouveau code pour le téléphone ?", "L'ancien code ne marchera plus : il faudra taper le nouveau dans l'appli.", "Nouveau code"))) return;
  await activerLienTelephone();
}

async function arreterLienTelephone() {
  if (!(await demanderConfirmation("Arrêter l'envoi au téléphone ?", "Le téléphone ne recevra plus les nouvelles semaines (il garde la dernière version reçue).", "Arrêter"))) return;
  ecrireLienTelephone(null);
  rafraichirBibliotheque();
}

// Carte de la page Bibliothèque.
function htmlLienTelephone() {
  const etat = etatLienTelephone();
  const date = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  let html = `<div class="carte" id="carteLienTelephone"><div class="carte-titre">Téléphone (envoi automatique)</div>`;
  if (!etat || !etat.code) {
    html += `<div class="note">Sentinelle envoie toute seule la bibliothèque au téléphone, chiffrée, à chaque changement : plus besoin du Drive. Le site de Sentinelle ne garde qu'un fichier illisible.</div>
      <div class="boutons-carte"><button type="button" id="btnActiverLien">Activer l'envoi au téléphone</button></div>`;
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
          <div class="note">Dans l'appli du téléphone : l'icône du livre (en haut) → <strong>« Scanner le QR code du PC »</strong>, et visez ce QR code (une seule fois).</div>
          <div class="note">Ou tapez le code :</div>
          <div class="code-lien" id="codeLien">${echapper(etat.code)}</div>
        </div>
      </div>
      <div class="compte-rendu ${etat.erreur && !lienTelephone.envoi ? "erreur" : ""}" id="etatLien">${echapper(statut)}</div>
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
  b("btnArreterLien", arreterLienTelephone);
}
