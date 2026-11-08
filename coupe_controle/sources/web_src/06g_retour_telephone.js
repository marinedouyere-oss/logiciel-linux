// ---- V6.3 : ce que le téléphone renvoie au PC (plans de coupe modifiés, problèmes validés OK) ----
// Le téléphone dépose ses demandes, CHIFFRÉES avec la clé du code de liaison, sur le même mini-site, dans un second
// canal tiré du même code (le site ne peut pas les lire). Sentinelle les lit toute seule (à l'ouverture puis chaque
// minute), les applique comme si elles avaient été faites sur ce PC, puis répond dans le fichier partagé : « repris »,
// ou pourquoi pas. Le PC reste la référence : le .bkp, la liste de coupe et le fichier de lancement ne changent jamais.

const CLE_RETOUR_TELEPHONE = "sentinelle-retour-telephone"; // { version, traitees: { id: { quand, ok, texte, type, titre } } }
const DELAI_RETOUR_TELEPHONE_MS = 60000;
const MAX_REPONSES_RETOUR = 300;
const retourTelephone = { lecture: null, minuteur: null, erreur: null, distant: {} };

function lireEtatRetour() {
  try {
    const x = JSON.parse(localStorage.getItem(CLE_RETOUR_TELEPHONE) || "null");
    if (x && typeof x === "object") return { version: x.version || "", traitees: x.traitees && typeof x.traitees === "object" ? x.traitees : {} };
  } catch (_e) {
    // stockage illisible
  }
  return retourTelephone.memoire || { version: "", traitees: {} };
}

function ecrireEtatRetour(etat) {
  // Les réponses les plus récentes seulement.
  const ids = Object.keys(etat.traitees).sort((a, b) => String(etat.traitees[b].quand).localeCompare(String(etat.traitees[a].quand)));
  for (const id of ids.slice(MAX_REPONSES_RETOUR)) delete etat.traitees[id];
  retourTelephone.memoire = etat;
  try {
    localStorage.setItem(CLE_RETOUR_TELEPHONE, JSON.stringify(etat));
  } catch (_e) {
    // sans stockage : le temps de la page
  }
}

// Les réponses au téléphone (dans le fichier partagé) : celles de ce PC et celles d'un autre PC lues dans le fichier.
function retourPourPartage() {
  const traitees = { ...retourTelephone.distant, ...lireEtatRetour().traitees };
  return Object.keys(traitees).length ? { traitees } : null;
}

function recevoirRetourDistant(retour) {
  if (retour && retour.traitees && typeof retour.traitees === "object") retourTelephone.distant = { ...retour.traitees };
}

// Le canal où le téléphone dépose ses demandes (tiré du code, comme celui du fichier partagé).
async function canalRetourLien(code) {
  const n = normaliserCodeLien(code);
  return hexLien(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("sentinelle-retour:" + n))).slice(0, 32);
}

// « SNT1 » + vecteur (12 octets) + contenu chiffré : le même paquet que celui du PC, fait par le téléphone.
async function dechiffrerPaquetLien(cle, paquet) {
  if (paquet.length < 17 || new TextDecoder().decode(paquet.slice(0, 4)) !== "SNT1") throw new Error("paquet du téléphone illisible");
  let clair;
  try {
    clair = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: paquet.slice(4, 16) }, cle, paquet.slice(16)));
  } catch (_e) {
    throw new Error("demandes du téléphone illisibles (pas le même code ?)");
  }
  const texte = clair[0] === 0x1f && clair[1] === 0x8b ? await new Response(new Blob([clair]).stream().pipeThrough(new DecompressionStream("gzip"))).text() : new TextDecoder().decode(clair);
  return JSON.parse(texte);
}

async function partieRetour(url) {
  const controle = new AbortController();
  const minuteur = setTimeout(() => controle.abort(), 60000);
  try {
    const r = await fetch(url, { cache: "no-store", signal: controle.signal });
    if (!r.ok) throw new Error(`le site a répondu ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  } finally {
    clearTimeout(minuteur);
  }
}

// Lit les demandes du téléphone (si le lien est actif) et applique les nouvelles. Renvoie le nombre de demandes lues.
function lireRetourTelephone() {
  const etat = etatLienTelephone();
  if (!etat || !etat.code) return Promise.resolve(0);
  if (retourTelephone.lecture) return retourTelephone.lecture;
  const lecture = (async () => {
    await null;
    try {
      const canal = await canalRetourLien(etat.code);
      const api = `${ADRESSE_LIEN_TELEPHONE}/api/partage?canal=${canal}`;
      const r = await demandeLien(api, { method: "GET" }, 20000);
      if (r.status === 404) {
        retourTelephone.erreur = null;
        return 0; // rien envoyé par le téléphone
      }
      if (!r.ok) throw new Error(`le site a répondu ${r.status}`);
      const m = JSON.parse(r.texte);
      if (!m || !m.version || m.version === lireEtatRetour().version) {
        retourTelephone.erreur = null;
        return 0;
      }
      const parties = [];
      for (let i = 0; i < m.parties; i++) parties.push(await partieRetour(`${api}&version=${m.version}&partie=${i}`));
      const paquet = new Uint8Array(parties.reduce((t, p) => t + p.length, 0));
      let k = 0;
      for (const p of parties) {
        paquet.set(p, k);
        k += p.length;
      }
      const secrets = await secretsLien(etat.code);
      const n = await traiterDemandesTelephone(await dechiffrerPaquetLien(secrets.cle, paquet));
      ecrireEtatRetour({ ...lireEtatRetour(), version: m.version });
      retourTelephone.erreur = null;
      return n;
    } catch (erreur) {
      const texte = erreur && erreur.message ? erreur.message : String(erreur);
      retourTelephone.erreur = /failed to fetch|networkerror|network/i.test(texte) ? "pas de connexion au site de Sentinelle (nouvel essai dans une minute)" : texte;
      return 0;
    } finally {
      if (retourTelephone.lecture === lecture) retourTelephone.lecture = null;
      rafraichirBibliotheque();
    }
  })();
  retourTelephone.lecture = lecture;
  return lecture;
}

// Applique les demandes pas encore reprises ; chacune reçoit une réponse (reprise, ou pourquoi pas).
async function traiterDemandesTelephone(contenu) {
  if (!contenu || contenu.format !== "sentinelle-demandes-1" || !Array.isArray(contenu.demandes)) throw new Error("ce ne sont pas des demandes du téléphone");
  const memoire = lireEtatRetour();
  let n = 0;
  for (const d of contenu.demandes) {
    if (!d || typeof d.id !== "string" || !d.id || memoire.traitees[d.id]) continue;
    let res;
    try {
      if (d.type === "validation") res = await validationDuTelephone(d);
      else if (d.type === "plan") res = await planDuTelephone(d);
      else res = { ok: false, texte: `demande inconnue (${d.type})` };
    } catch (erreur) {
      res = { ok: false, texte: `pas reprise : ${erreur && erreur.message ? erreur.message : erreur}` };
    }
    memoire.traitees[d.id] = { quand: new Date().toISOString(), ok: Boolean(res.ok), texte: String(res.texte || ""), type: String(d.type || ""), titre: String(d.titre || "") };
    n++;
  }
  if (n) {
    ecrireEtatRetour({ ...memoire, version: lireEtatRetour().version });
    // La réponse part au téléphone (et dans le fichier partagé).
    changementBibliotheque();
    if (bibliotheque.dossier) synchroniserBibliotheque(false).catch(() => {});
  }
  return n;
}

// ---- Problème validé OK sur le téléphone : comme le bouton « Valider (c'est voulu) » du PC ----

async function validationDuTelephone(d) {
  if (!d.lancement || !d.cle || !d.probleme) return { ok: false, texte: "demande incomplète" };
  const e = { cle: String(d.cle), type: String(d.probleme) };
  validerProbleme(String(d.lancement), e, true);
  await validationDansBibliotheque(String(d.lancement), e, new Date().toISOString());
  // La case du lancement, si sa semaine est affichée : ses problèmes, le tableau, puis la bibliothèque refaite.
  const p = paires.find((x) => x.strat && baseDuLancement(x) === d.lancement);
  if (p) {
    for (const c of pairesDeLaSemaine(p.parite)) {
      const zone = document.querySelector(`.carte-paire[data-id="${c.id}"] .zone-problemes`);
      try {
        if (zone && c.analyse) remplirProblemes(zone, c);
      } catch (_e) {
        // la case se refera à l'affichage
      }
    }
    if (typeof onglet !== "undefined" && onglet === p.parite) majRecap();
    if (p.analyse) planifierArchivageValidations(p.parite);
  }
  return { ok: true, texte: `Validé OK : ${e.type} — ${e.cle} (${d.lancement})` };
}

// Le problème marqué validé dans la bibliothèque (le téléphone le voit tout de suite, même sans la case ouverte).
async function validationDansBibliotheque(base, e, date) {
  const deuxFois = e.type === "Lancée deux fois";
  const maj = new Date().toISOString();
  let touche = false;
  for (const s of [...bibliotheque.semaines.values()]) {
    let change = false;
    const lancements = s.lancements.map((l) => {
      if (!deuxFois && l.nom !== base) return l;
      let nbC = 0;
      let nbV = 0;
      let trouve = false;
      const problemes = (l.problemes || []).map((pb) => {
        if (pb.cle !== e.cle || pb.type !== e.type || pb.valide) return pb;
        trouve = true;
        if (pb.niveau === "corriger") nbC++;
        else if (pb.niveau === "verifier") nbV++;
        return { ...pb, niveau: "valide", valide: date };
      });
      if (!trouve) return l;
      change = true;
      const controle = l.controle ? { ...l.controle, nbCorriger: Math.max(0, (l.controle.nbCorriger || 0) - nbC), nbVerifier: Math.max(0, (l.controle.nbVerifier || 0) - nbV) } : l.controle;
      return { ...l, problemes, controle, maj };
    });
    if (change) {
      await enregistrerSemaineLocale({ ...s, lancements, maj });
      touche = true;
    }
  }
  if (touche) {
    changementBibliotheque();
    if (bibliotheque.dossier) await synchroniserBibliotheque(false).catch(() => null);
    rafraichirBibliotheque();
  }
  return touche;
}

// ---- Plan de coupe modifié sur le téléphone : comme une modification faite dans le plan en grand du PC ----

const nombreRetour = (v) => (typeof v === "number" && Number.isFinite(v) ? v : Number(String(v ?? "").replace(",", ".")));
const texteRetour = (v, max = 120) => String(v ?? "").slice(0, max);

// La modification reçue, nettoyée (seulement ce que le PC sait faire : retirer, cote finie, note, pièce posée).
function retoucheDuTelephone(rt) {
  const morceaux = {};
  for (const [k, m] of Object.entries((rt && rt.morceaux) || {})) {
    if (!/^\d{1,4}$/.test(k) || !m || typeof m !== "object") continue;
    if (m.retire) {
      morceaux[k] = { retire: true };
      continue;
    }
    const n = {};
    if (Array.isArray(m.fini) && m.fini.length === 2 && m.fini.every((v) => nombreRetour(v) > 0)) n.fini = m.fini.map(nombreRetour);
    if (m.note) n.note = texteRetour(m.note);
    if (m.cle !== undefined) n.cle = texteRetour(m.cle, 40).toUpperCase().replace(/\s+/g, "");
    if (m.article !== undefined) n.article = texteRetour(m.article, 60);
    if (Object.keys(n).length) morceaux[k] = n;
  }
  const ajouts = [];
  for (const a of Array.isArray(rt && rt.ajouts) ? rt.ajouts : []) {
    if (!a || !Number.isInteger(a.dans) || a.dans < 0 || !Array.isArray(a.fini) || a.fini.length !== 2 || !a.fini.every((v) => nombreRetour(v) > 0)) continue;
    ajouts.push({ dans: a.dans, cle: texteRetour(a.cle, 40).toUpperCase().replace(/\s+/g, ""), article: texteRetour(a.article, 60), fini: a.fini.map(nombreRetour), tourne: Boolean(a.tourne), note: texteRetour(a.note) });
  }
  return { morceaux, ajouts };
}

function planDuLancement(donnees, d) {
  for (const m of donnees.matieres.values())
    for (const plan of m.plans) {
      if (d.module ? plan.module && plan.nom === d.nom : !plan.module && plan.matiere === d.matiere && Number(plan.pdc) === Number(d.pdc)) return plan;
    }
  return null;
}

async function planDuTelephone(d) {
  if (!d.lancement || !d.empreinte || !d.rt) return { ok: false, texte: "demande incomplète" };
  const titre = d.module ? `Module ${d.nom}` : `Pdc ${d.pdc} · ${d.matiere}`;
  const rt = retoucheDuTelephone(d.rt);
  const resume = Array.isArray(d.resume) && d.resume.length ? ` : ${d.resume.slice(0, 6).map((x) => texteRetour(x, 160)).join(" ; ")}` : "";
  // Les plans du .bkp, si le lancement est dans une des semaines affichées (case avec son .bkp).
  let donnees = null;
  for (const p of paires) {
    if (!p.bkp) continue;
    try {
      const x = await lirePlansBkp(p.bkp);
      if (x.lancement === d.lancement) {
        donnees = x;
        break;
      }
    } catch (_e) {
      // .bkp illisible : case suivante
    }
  }
  if (donnees) {
    const plan = planDuLancement(donnees, d);
    if (!plan) return { ok: false, texte: `${titre} (${d.lancement}) : plan introuvable sur le PC (optimisation refaite ?) — modification pas reprise` };
    if (!memeEmpreinte(String(d.empreinte), plan)) return { ok: false, texte: `${titre} (${d.lancement}) : le plan a changé sur le PC (optimisation refaite) — modification pas reprise` };
    enregistrerRetouche(d.lancement, plan, rt);
    await majPlansBibliotheque(donnees);
    if (typeof onglet !== "undefined" && onglet === "plans") afficherOutilPlans();
    return { ok: true, texte: `${titre} (${d.lancement}) ${retoucheVide(rt) ? "remis comme à l'origine" : `modifié${resume}`}` };
  }
  // Le .bkp n'est pas ouvert sur ce PC : la modification est gardée, le plan sera refait quand il sera relu.
  const t = { ...lireRetouchesPlans() };
  const id = `${d.lancement}|${d.module ? `module ${d.nom}` : `${d.matiere}|Pdc ${d.pdc}`}`;
  if (retoucheVide(rt)) delete t[id];
  else t[id] = { morceaux: rt.morceaux, ajouts: rt.ajouts, empreinte: String(d.empreinte), date: new Date().toISOString() };
  ecrireRetouchesPlans(t);
  return { ok: true, texte: `${titre} (${d.lancement}) : modification gardée sur le PC — le plan sera refait quand sa semaine sera ouverte dans Contrôler la coupe${resume}` };
}

// ---- Lecture régulière ----

function demarrerRetourTelephone() {
  lireRetourTelephone();
  clearInterval(retourTelephone.minuteur);
  retourTelephone.minuteur = setInterval(() => {
    if (!document.hidden) lireRetourTelephone();
  }, DELAI_RETOUR_TELEPHONE_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) lireRetourTelephone();
  });
}

// Pour la carte « Téléphone » de la bibliothèque : les dernières demandes reprises.
function htmlRetourTelephone() {
  const t = lireEtatRetour().traitees;
  const liste = Object.values(t).sort((a, b) => String(b.quand).localeCompare(String(a.quand))).slice(0, 5);
  if (!liste.length && !retourTelephone.erreur) return `<div class="note">Le téléphone peut renvoyer des plans de coupe modifiés et des problèmes validés OK : Sentinelle les reprend tout seul.</div>`;
  const date = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  return `<div class="retour-telephone"><div class="note"><strong>Reçu du téléphone</strong> (repris tout seul)</div>${liste
    .map((x) => `<div class="retour-ligne ${x.ok ? "ok" : "refus"}">${x.ok ? "✔" : "⚠"} ${echapper(date(x.quand))} — ${echapper(x.texte)}</div>`)
    .join("")}${retourTelephone.erreur ? `<div class="retour-ligne refus">⚠ Lecture des demandes du téléphone : ${echapper(retourTelephone.erreur)}</div>` : ""}</div>`;
}
