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

const lienTelephone = { envoi: null, minuteur: null, reprendre: false };

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
  const verifier = async (reponse) => {
    if (reponse.ok) return;
    let detail = "";
    try {
      detail = (await reponse.json()).erreur || "";
    } catch (_e) {
      detail = "";
    }
    throw new Error(`le site a répondu ${reponse.status}${detail ? ` (${detail})` : ""}`);
  };
  for (let i = 0; i < parties; i++)
    await verifier(
      await fetch(`${api}&version=${version}&partie=${i}`, {
        method: "PUT",
        headers: { "X-Sentinelle-Jeton": secrets.jeton, "Content-Type": "application/octet-stream" },
        body: paquet.slice(i * TAILLE_PARTIE_LIEN, (i + 1) * TAILLE_PARTIE_LIEN),
      })
    );
  await verifier(
    await fetch(api, {
      method: "POST",
      headers: { "X-Sentinelle-Jeton": secrets.jeton, "Content-Type": "application/json" },
      body: JSON.stringify({ version, parties, taille: paquet.length, genere }),
    })
  );
}

// Envoie la bibliothèque au téléphone si elle a changé depuis le dernier envoi (ou si forcer).
function envoyerAuTelephone(forcer = false) {
  const etat = etatLienTelephone();
  if (!etat || !etat.code) return Promise.resolve(null);
  if (lienTelephone.envoi) {
    lienTelephone.reprendre = true; // un changement pendant l'envoi : on renverra après
    return lienTelephone.envoi;
  }
  lienTelephone.envoi = (async () => {
    const signature = signatureDesSemaines([...bibliotheque.semaines.values()]);
    if (!forcer && etat.signature === signature && !etat.erreur) return { ok: true, inchange: true };
    try {
      const secrets = await secretsLien(etat.code);
      const contenu = contenuFichierPartage();
      const paquet = await paquetChiffre(secrets.cle, await compresserJson(contenu));
      await envoyerPaquetLien(secrets, paquet, contenu.genere);
      const nbSemaines = [...bibliotheque.semaines.values()].filter((s) => s.lancements.length).length;
      ecrireLienTelephone({ ...etatLienTelephone(), signature, dernierEnvoi: new Date().toISOString(), nbSemaines, erreur: null });
      return { ok: true };
    } catch (erreur) {
      const texte = erreur && erreur.message ? erreur.message : String(erreur);
      ecrireLienTelephone({ ...etatLienTelephone(), erreur: /fetch|network|réseau/i.test(texte) ? "pas de connexion au site (internet coupé ou bloqué)" : texte });
      return { ok: false, erreur: texte };
    } finally {
      lienTelephone.envoi = null;
      rafraichirBibliotheque();
      if (lienTelephone.reprendre) {
        lienTelephone.reprendre = false;
        planifierEnvoiTelephone();
      }
    }
  })();
  return lienTelephone.envoi;
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
    const statut = lienTelephone.envoi
      ? "Envoi en cours…"
      : etat.erreur
        ? `⚠ Dernier envoi raté : ${etat.erreur}`
        : etat.dernierEnvoi
          ? `✔ Envoyé le ${date(etat.dernierEnvoi)} (${etat.nbSemaines || 0} semaine(s))`
          : "Pas encore envoyé.";
    html += `<div class="note">Dans l'appli du téléphone : Bibliothèque des semaines → « Relier au PC », puis tapez ce code (une seule fois).</div>
      <div class="code-lien" id="codeLien">${echapper(etat.code)}</div>
      <div class="compte-rendu ${etat.erreur && !lienTelephone.envoi ? "erreur" : ""}" id="etatLien">${echapper(statut)}</div>
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
