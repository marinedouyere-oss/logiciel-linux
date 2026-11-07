// ---- Plan de coupe modifié dans Sentinelle (sur le PC seulement) ----
// Dans un plan ouvert en grand : retirer une pièce, changer sa clé, son article ou sa cote finie, ou poser une pièce
// dans une chute (ou à la place d'une pièce retirée). Puis imprimer le plan d'origine, le plan modifié, ou les deux.
// Les modifications restent dans Sentinelle (ce PC, et le téléphone qui les affiche) : le .bkp, la liste de coupe et
// le fichier de lancement ne sont JAMAIS modifiés.

const CLE_RETOUCHES_PLANS = "sentinelle-plans-modifies";
let retouchesEnMemoire = null; // sans stockage du navigateur : le temps de la page

// Un plan : lancement + matière + Pdc (ou le module). L'empreinte vérifie que c'est bien le même plan (une
// optimisation refaite renumérote les plans : une ancienne modification ne s'applique plus).
const idPlanRetouche = (lancement, plan) => `${lancement}|${plan.module ? `module ${plan.nom}` : `${plan.matiere}|Pdc ${plan.pdc}`}`;
const empreintePlan = (plan) => `${Math.round(plan.L)}x${Math.round(plan.W)}:${plan.rects.map((r) => (r.chute ? "-" : r.cle || r.nom || "?")).join(",")}`;
const retoucheVide = (rt) => !rt || (!Object.keys(rt.morceaux || {}).length && !(rt.ajouts || []).length);

function lireRetouchesPlans() {
  if (retouchesEnMemoire) return retouchesEnMemoire;
  try {
    const t = JSON.parse(localStorage.getItem(CLE_RETOUCHES_PLANS) || "{}");
    return t && typeof t === "object" ? t : {};
  } catch (_e) {
    return {};
  }
}

function ecrireRetouchesPlans(t) {
  try {
    localStorage.setItem(CLE_RETOUCHES_PLANS, JSON.stringify(t));
    retouchesEnMemoire = null;
  } catch (_e) {
    retouchesEnMemoire = t;
  }
}

// La modification d'un plan (null : plan d'origine).
function retoucheDuPlan(lancement, plan) {
  const rt = lireRetouchesPlans()[idPlanRetouche(lancement, plan)];
  return rt && rt.empreinte === empreintePlan(plan) && !retoucheVide(rt) ? rt : null;
}

function enregistrerRetouche(lancement, plan, rt) {
  const t = { ...lireRetouchesPlans() };
  const id = idPlanRetouche(lancement, plan);
  if (retoucheVide(rt)) delete t[id];
  else t[id] = { morceaux: rt.morceaux || {}, ajouts: rt.ajouts || [], empreinte: empreintePlan(plan), date: new Date().toISOString() };
  ecrireRetouchesPlans(t);
}

const commandeDeCle = (cle) => (/^[A-Z]*\d{6,}$/.test(cle || "") ? cle.slice(0, -3) : "");
const ligneDeCle = (cle) => (/^[A-Z]*\d{6,}$/.test(cle || "") ? String(parseInt(cle.slice(-3), 10)) : "");
const estMorceauPiece = (r) => Boolean(r.cle) && !MOTIF_NOYAU_PLAN.test(r.nom || "") && !MOTIF_STRATIFIE_PLAN.test(r.nom || "");

// Sens du morceau sur le plan : sa longueur finie va-t-elle de gauche à droite ?
const morceauDroit = (r) => Math.abs(r.L - r.fini[0]) + Math.abs(r.W - r.fini[1]) <= Math.abs(r.L - r.fini[1]) + Math.abs(r.W - r.fini[0]);

// Taille sur le plan d'un morceau dont la cote finie change (même surcote qu'avant).
function tailleSurPlan(r, fini) {
  const droit = morceauDroit(r);
  const [dx, dy] = droit ? [r.L - r.fini[0], r.W - r.fini[1]] : [r.L - r.fini[1], r.W - r.fini[0]];
  return droit ? { L: fini[0] + dx, W: fini[1] + dy } : { L: fini[1] + dx, W: fini[0] + dy };
}

// Taille sur le plan d'une pièce posée : sa cote finie, tournée ou non.
const taillePosee = (a) => (a.tourne ? { L: a.fini[1], W: a.fini[0] } : { L: a.fini[0], W: a.fini[1] });

// Pièces posées dans une place libre, en rangées depuis le coin haut gauche (coupes d'équerre, comme à la scie).
function poserDansPlace(hote, ajouts) {
  const poses = [];
  const restes = [];
  let x = hote.x;
  let y = hote.y;
  let h = 0;
  const finX = hote.x + hote.L + 0.5;
  const finY = hote.y + hote.W + 0.5;
  for (const a of ajouts) {
    const { L, W } = taillePosee(a);
    if (x > hote.x && x + L > finX) {
      restes.push({ x, y, L: hote.x + hote.L - x, W: h });
      y += h;
      x = hote.x;
      h = 0;
    }
    if (x + L > finX || y + W > finY) {
      poses.push({ a, L, W, place: null });
      continue;
    }
    poses.push({ a, L, W, place: { x, y } });
    x += L;
    h = Math.max(h, W);
  }
  if (h) restes.push({ x, y, L: hote.x + hote.L - x, W: h });
  restes.push({ x: hote.x, y: y + h, L: hote.L, W: hote.y + hote.W - y - h });
  return { poses, restes: restes.filter((r) => r.L > 1 && r.W > 1) };
}

function morceauModifie(r, m) {
  const n = { ...r };
  if (m.cle !== undefined && m.cle !== r.cle) {
    n.cle = m.cle;
    n.commande = commandeDeCle(m.cle);
    n.ligne = ligneDeCle(m.cle);
    if (estMorceauPiece(r)) n.nom = m.cle;
  }
  if (m.article !== undefined) n.article = m.article;
  if (m.fini) {
    Object.assign(n, tailleSurPlan(r, m.fini));
    n.fini = [...m.fini];
  }
  if (m.note) n.note = m.note;
  return n;
}

// Le plan modifié : morceaux changés, retirés, posés. etats (couleurs), textes (place vide), marques (tableau) et
// origine (morceau du plan affiché → morceau d'origine { idx } ou pièce posée { ajout }), par numéro de morceau.
function planRetouche(plan, rt) {
  const rects = [];
  const etats = new Map();
  const textes = new Map();
  const marques = new Map();
  const origine = [];
  const hotes = new Map();
  (rt.ajouts || []).forEach((a, k) => {
    if (!hotes.has(a.dans)) hotes.set(a.dans, []);
    hotes.get(a.dans).push({ ...a, k });
  });
  const poses = [];
  const ajouter = (r, o, etat, marque) => {
    if (etat) etats.set(rects.length, etat);
    if (marque) marques.set(rects.length, marque);
    origine[rects.length] = o;
    rects.push(r);
  };
  plan.rects.forEach((r, idx) => {
    const m = (rt.morceaux || {})[idx];
    const ajouts = hotes.get(idx) || [];
    if (r.chute) {
      if (!ajouts.length) return ajouter(r, { idx });
      const p = poserDansPlace(r, ajouts);
      poses.push(...p.poses);
      // ce qui reste de la chute (assez grand pour être gardé)
      for (const q of p.restes) if (q.L >= 100 && q.W >= 100) ajouter({ x: q.x, y: q.y, L: q.L, W: q.W, chute: true }, { idx, reste: true });
      return;
    }
    if (m && m.retire) {
      if (ajouts.length) {
        poses.push(...poserDansPlace(r, ajouts).poses);
        return;
      }
      textes.set(rects.length, "retirée — ne pas couper");
      return ajouter({ ...r }, { idx }, "partie", "retirée — ne pas couper");
    }
    if (m) return ajouter(morceauModifie(r, m), { idx }, "modifiee", texteModification(r, m));
    ajouter(r, { idx });
  });
  for (const p of poses) {
    if (!p.place) continue;
    const a = p.a;
    ajouter(
      { x: p.place.x, y: p.place.y, L: p.L, W: p.W, nom: a.cle || "pièce posée", cle: a.cle || "", article: a.article || "", fini: [...a.fini], commande: commandeDeCle(a.cle), ligne: ligneDeCle(a.cle), seq: [], note: a.note || "" },
      { ajout: a.k },
      "ajoutee",
      `posée dans Sentinelle${a.note ? ` — ${a.note}` : ""}`
    );
  }
  return { plan: { ...plan, rects, retouche: rt }, etats, textes, marques, origine, nonPosees: poses.filter((p) => !p.place).map((p) => p.a) };
}

function texteModification(r, m) {
  const t = [];
  if (m.cle !== undefined && m.cle !== r.cle) t.push(`clé ${r.cle || "—"} → ${m.cle || "—"}`);
  if (m.article !== undefined && m.article !== (r.article || "")) t.push(`article ${r.article || "—"} → ${m.article || "—"}`);
  if (m.fini && (Math.abs(m.fini[0] - r.fini[0]) > 0.05 || Math.abs(m.fini[1] - r.fini[1]) > 0.05)) t.push(`cote finie ${dimsPlan(r.fini[0], r.fini[1])} → ${dimsPlan(m.fini[0], m.fini[1])}`);
  if (m.note) t.push(m.note);
  return `modifiée : ${t.join(" ; ") || "—"}`;
}

// Le plan tel qu'il faut le montrer : modifié s'il l'a été, sinon d'origine.
function versionDuPlan(lancement, plan) {
  const rt = retoucheDuPlan(lancement, plan);
  if (!rt) return { plan, etats: null, textes: null, marques: null, origine: null, rt: null, nonPosees: [] };
  return { ...planRetouche(plan, rt), rt };
}

// Ce qui a changé, une ligne par changement (numéros du plan d'origine).
function changementsRetouche(plan, rt) {
  const { morceaux } = morceauxNumerotes(plan);
  const numero = (idx) => morceaux.indexOf(plan.rects[idx]) + 1;
  const nom = (r) => (estMorceauPiece(r) ? r.cle : nomMorceauPlan(r));
  const lignes = [];
  for (const [k, m] of Object.entries(rt.morceaux || {}).sort((a, b) => a[0] - b[0])) {
    const r = plan.rects[Number(k)];
    if (!r) continue;
    if (m.retire) lignes.push(`n°${numero(Number(k))} ${nom(r)} retirée du plan — ne pas la couper`);
    else lignes.push(`n°${numero(Number(k))} ${nom(r)} ${texteModification(r, m)}`);
  }
  const pr = planRetouche(plan, rt);
  (rt.ajouts || []).forEach((a, k) => {
    const hote = plan.rects[a.dans];
    if (!hote) return;
    const ou = hote.chute ? `dans la chute ${dimsPlan(hote.L, hote.W)}` : `à la place de n°${numero(a.dans)} ${nom(hote)}`;
    const pas = pr.nonPosees.some((x) => x.k === k);
    lignes.push(`+ ${a.cle || "pièce"}${a.article ? ` ${a.article}` : ""} ${dimsPlan(a.fini[0], a.fini[1])} posée ${ou}${a.note ? ` — ${a.note}` : ""}${pas ? " (⚠ ne rentre pas)" : ""}`);
  });
  return lignes;
}

// ---- Les plans modifiés vont au téléphone : les plans du lancement sont refaits dans la bibliothèque ----

let minuteurRetouchesBibliotheque = null;
const retouchesAEnvoyer = new Map(); // lancement → plans lus (un seul envoi pour plusieurs modifications)
function retoucheVersBibliotheque(donnees) {
  retouchesAEnvoyer.set(donnees.lancement, donnees);
  clearTimeout(minuteurRetouchesBibliotheque);
  minuteurRetouchesBibliotheque = setTimeout(async () => {
    const liste = [...retouchesAEnvoyer.values()];
    retouchesAEnvoyer.clear();
    for (const d of liste) await majPlansBibliotheque(d).catch(() => false);
  }, 1500);
}

async function majPlansBibliotheque(donnees) {
  if (typeof bibliotheque === "undefined") return false;
  const maj = new Date().toISOString();
  let touche = false;
  for (const s of [...bibliotheque.semaines.values()]) {
    if (!s.lancements.some((l) => l.plans && l.plans.lancement === donnees.lancement)) continue;
    const lancements = s.lancements.map((l) => {
      if (!l.plans || l.plans.lancement !== donnees.lancement) return l;
      const cles = new Set(Object.keys(l.plans.pieces || {}));
      for (const ligne of l.pieces || []) if (ligne && ligne[0]) cles.add(ligne[0]);
      return { ...l, plans: plansPourTelephone(donnees, [...cles]), maj };
    });
    await enregistrerSemaineLocale({ ...s, lancements, maj });
    touche = true;
  }
  if (!touche) return false;
  changementBibliotheque();
  if (bibliotheque.dossier) await synchroniserBibliotheque(false);
  rafraichirBibliotheque();
  return true;
}

// ---- Un plan en grand, avec ses modifications ----
// x : { plan, donnees, visee, titre, badge, sous, apresModification() }

const planEnGrand = { x: null, modifie: false };

function fermerPlanEnGrand() {
  const m = $("modalePlan");
  if (m) m.remove();
  document.removeEventListener("keydown", toucheModalePlan);
  const x = planEnGrand.x;
  const modifie = planEnGrand.modifie;
  planEnGrand.x = null;
  planEnGrand.modifie = false;
  if (modifie && x && x.apresModification) x.apresModification();
}

function toucheModalePlan(e) {
  const confirmation = $("modaleConfirmation");
  if (confirmation && !confirmation.classList.contains("masquee")) return; // la question posée par-dessus d'abord
  if (e.key === "Escape" && !(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) fermerPlanEnGrand();
}

function ouvrirPlanEnGrand(x) {
  fermerPlanEnGrand();
  planEnGrand.x = x;
  const { plan, donnees } = x;
  const lancement = donnees.lancement;
  const visee = x.visee || (() => false);
  const st = { cote: "fini", vue: "modifie", edition: false, choix: null, message: "" };
  let rt = retoucheDuPlan(lancement, plan);
  const brouillon = () => (rt ? JSON.parse(JSON.stringify({ morceaux: rt.morceaux || {}, ajouts: rt.ajouts || [] })) : { morceaux: {}, ajouts: [] });
  const fond = document.createElement("div");
  fond.className = "modale-fond";
  fond.id = "modalePlan";
  const boite = document.createElement("div");
  boite.className = "modale-boite pl-grand";
  boite.setAttribute("role", "dialog");
  boite.setAttribute("aria-modal", "true");
  fond.appendChild(boite);

  const enregistrer = (nouveau, message) => {
    enregistrerRetouche(lancement, plan, nouveau);
    rt = retoucheDuPlan(lancement, plan);
    planEnGrand.modifie = true;
    st.message = message || "";
    st.vue = "modifie";
    retoucheVersBibliotheque(donnees);
  };
  const version = () => (rt && st.vue === "modifie" ? { ...planRetouche(plan, rt), rt } : { plan, etats: null, textes: null, marques: null, origine: null, rt: null, nonPosees: [] });

  const rendre = () => {
    const v = version();
    const vu = v.plan;
    const { morceaux, chutes } = morceauxNumerotes(vu);
    const lignes = morceaux
      .map((r, i) => {
        const idx = vu.rects.indexOf(r);
        const vise = visee(r);
        const nom = (r.nom || "").split("/")[0];
        const module = MOTIF_NOYAU_PLAN.test(r.nom || "") && donnees.modules.has(nom);
        const marque = v.marques ? v.marques.get(idx) : null;
        const etat = v.etats ? v.etats.get(idx) : null;
        return `<tr class="${vise ? "visee" : ""}${etat ? ` pl-etat-${etat}` : ""}${st.choix === idx ? " pl-choisi" : ""}" ${st.edition ? `data-choisir="${idx}" title="Modifier ce morceau"` : ""}><td class="c">${i + 1}</td>
          <td>${echapper(nomMorceauPlan(r))}${vise ? " <strong>← pièce cherchée</strong>" : ""}${marque ? ` <span class="pl-marque">${echapper(marque)}</span>` : ""}${module ? ` <button type="button" class="texte petit" data-module="${echapper(nom)}">voir le module</button>` : ""}</td>
          <td>${echapper(r.article)}</td><td class="d">${dimsPlan(r.fini[0], r.fini[1])}</td><td class="d">${dimsPlan(r.L, r.W)}</td><td>${estMorceauPiece(r) ? `${echapper(r.commande)} / ${echapper(r.ligne)}` : ""}</td></tr>`;
      })
      .join("");
    const changements = rt ? changementsRetouche(plan, rt) : [];
    const puce = rt ? `<span class="pl-puce modif">✎ modifié dans Sentinelle${rt.date ? ` le ${new Date(rt.date).toLocaleDateString("fr-FR")}` : ""}</span>` : "";
    const bascule = rt && !st.edition
      ? `<div class="pl-bascule" role="group" aria-label="Version du plan"><button type="button" class="${st.vue === "modifie" ? "actif" : "contour"} petit" data-vue="modifie">Plan modifié</button><button type="button" class="${st.vue === "origine" ? "actif" : "contour"} petit" data-vue="origine">Plan d'origine</button></div>`
      : "";
    boite.innerHTML = `
      <div class="pl-grand-tete"><h3>${echapper(x.titre || `Plan ${plan.pdc}`)} <span class="pl-pdc">${echapper(x.badge || `Pdc ${plan.pdc}`)}</span> ${puce}</h3>
        <button type="button" class="texte" data-fermer aria-label="Fermer">✕</button></div>
      <div class="note">${echapper(x.sous || "")}</div>
      ${bascule}
      ${st.edition ? '<div class="pl-aide">Cliquez une pièce (sur le dessin ou dans le tableau) pour la modifier ou la retirer, ou une chute pour y poser une pièce.</div>' : ""}
      <div class="pl-dessin${st.edition ? " pl-edition" : ""}">${svgPlan(vu, { visee, numeros: true, modules: vu.module ? null : donnees.modules, cote: st.cote, etats: v.etats, textes: v.textes, cliquable: st.edition, selection: st.edition ? st.choix : null })}</div>
      ${rt && st.vue === "modifie" ? `<div class="pl-legende"><span><i style="background:#bbdefb;border-color:#1565c0"></i>pièce modifiée</span><span><i style="background:#c8e6c9;border-color:#2e7d32"></i>pièce posée</span><span><i style="background:#fff;border-color:#c62828;border-style:dashed"></i>pièce retirée (ne pas couper)</span></div>` : ""}
      ${st.message ? `<div class="pl-message">${echapper(st.message)}</div>` : ""}
      ${st.edition ? `<div class="pl-panneau">${panneauEdition()}</div>` : ""}
      ${changements.length ? `<div class="pl-changements"><div class="fp-h3">Ce qui a changé (${changements.length})</div><ul class="liste-pieces">${changements.map((t) => `<li>${echapper(t)}</li>`).join("")}</ul>
        ${st.edition ? '<button type="button" class="texte petit" data-tout-remettre>Tout remettre comme à l\'origine</button>' : ""}</div>` : ""}
      <div class="pl-boutons">
        <button type="button" class="contour" data-cote>${st.cote === "fini" ? "Voir les cotes de débit" : "Voir les cotes finies"}</button>
        <button type="button" class="${st.edition ? "" : "contour"}" data-editer>${st.edition ? "✔ Terminer les modifications" : "✎ Modifier le plan"}</button>
        <button type="button" class="contour" data-imprimer="origine">${rt ? "Imprimer le plan d'origine" : "Imprimer ce plan (PDF)"}</button>
        ${rt ? '<button type="button" class="contour" data-imprimer="modifie">Imprimer le plan modifié</button><button type="button" class="contour" data-imprimer="deux">Imprimer avant / après</button>' : ""}
        <button type="button" data-fermer>Fermer</button>
      </div>
      <div class="note">Les modifications restent dans Sentinelle (ce PC et le téléphone) : le .bkp, la liste de coupe et le fichier de lancement ne sont pas touchés.</div>
      <div class="defilement"><table class="fp-table pl-table"><thead><tr><th class="c">N°</th><th>Pièce</th><th>Article</th><th class="d">Cote finie</th><th class="d">Débit</th><th>Commande / ligne</th></tr></thead><tbody>${lignes}</tbody></table></div>
      ${chutes.length ? `<div class="note">Chutes gardées : ${chutes.map((r) => (st.edition ? `<button type="button" class="texte petit" data-choisir="${vu.rects.indexOf(r)}">${dimsPlan(r.L, r.W)}</button>` : dimsPlan(r.L, r.W))).join(", ")}</div>` : ""}`;
    brancher(v);
  };

  // Le panneau du morceau choisi (index dans le plan modifié affiché).
  const panneauEdition = () => {
    if (st.choix === null) return '<div class="note">Aucune pièce choisie.</div>';
    const v = version();
    const o = v.origine ? v.origine[st.choix] : { idx: st.choix };
    if (!o) return "";
    const champs = (d, poser) => `<div class="pl-champs">
        <label>Clé<input type="text" data-champ="cle" value="${echapper(d.cle || "")}" placeholder="CVC…" autocomplete="off"></label>
        <label>Article<input type="text" data-champ="article" value="${echapper(d.article || "")}"></label>
        <label>Cote finie : longueur<input type="number" min="1" step="0.1" data-champ="finiL" value="${d.fini ? d.fini[0] : ""}"></label>
        <label>× largeur (mm)<input type="number" min="1" step="0.1" data-champ="finiW" value="${d.fini ? d.fini[1] : ""}"></label>
        ${poser ? `<label class="pl-case"><input type="checkbox" data-champ="tourne" ${d.tourne ? "checked" : ""}> Tournée (longueur de haut en bas)</label>` : ""}
        <label class="pl-large">Note (imprimée)<input type="text" data-champ="note" value="${echapper(d.note || "")}"></label></div>`;
    if (o.ajout !== undefined) {
      const a = rt.ajouts[o.ajout];
      return `<div class="pl-panneau-titre">Pièce posée dans Sentinelle — ${echapper(a.cle || "sans clé")}</div>${champs(a, true)}
        <div class="pl-boutons-gauche"><button type="button" data-action-plan="maj-ajout">Enregistrer</button><button type="button" class="contour" data-action-plan="enlever-ajout">Enlever cette pièce</button></div>`;
    }
    const r = plan.rects[o.idx];
    const m = (rt && rt.morceaux && rt.morceaux[o.idx]) || null;
    const n = morceauxNumerotes(plan).morceaux.indexOf(r) + 1;
    if (r.chute) {
      return `<div class="pl-panneau-titre">Chute gardée ${dimsPlan(r.L, r.W)} — poser une pièce dedans</div>${champs({ fini: null }, true)}
        <div class="pl-boutons-gauche"><button type="button" data-action-plan="poser" data-hote="${o.idx}">Poser la pièce</button></div>`;
    }
    if (m && m.retire) {
      return `<div class="pl-panneau-titre">n°${n} ${echapper(nomMorceauPlan(r))} — retirée du plan (ne pas couper)</div>
        <div class="pl-boutons-gauche"><button type="button" data-action-plan="remettre" data-idx="${o.idx}">Remettre la pièce</button></div>
        <div class="note" style="margin-top:8px">Ou poser une autre pièce à sa place (${dimsPlan(r.L, r.W)} sur le plan) :</div>${champs({ fini: null }, true)}
        <div class="pl-boutons-gauche"><button type="button" class="contour" data-action-plan="poser" data-hote="${o.idx}">Poser la pièce à sa place</button></div>`;
    }
    const nomModule = (r.nom || "").split("/")[0];
    if (MOTIF_NOYAU_PLAN.test(r.nom || "") && donnees.modules.has(nomModule) && !plan.module) {
      return `<div class="pl-panneau-titre">Module ${echapper(nomModule)} (${dimsPlan(r.fini[0], r.fini[1])})</div>
        <div class="note">Les pièces du module se modifient dans le plan du module.</div>
        <div class="pl-boutons-gauche"><button type="button" data-module="${echapper(nomModule)}">Ouvrir le module</button>${m ? "" : `<button type="button" class="contour" data-action-plan="retirer" data-idx="${o.idx}">Retirer le module du plan</button>`}</div>`;
    }
    const d = m ? morceauModifie(r, m) : r;
    return `<div class="pl-panneau-titre">n°${n} ${echapper(nomMorceauPlan(r))}${m ? " — modifiée" : ""}</div>
      <div class="note">D'origine : ${echapper(r.cle || nomMorceauPlan(r))} · ${echapper(r.article || "")} · cote finie ${dimsPlan(r.fini[0], r.fini[1])} (au plus, pour tenir à sa place).</div>
      ${champs({ cle: d.cle, article: d.article, fini: d.fini, note: m ? m.note : "" }, false)}
      <div class="pl-boutons-gauche"><button type="button" data-action-plan="modifier" data-idx="${o.idx}">Enregistrer la modification</button>
        <button type="button" class="contour" data-action-plan="retirer" data-idx="${o.idx}">Retirer la pièce du plan</button>
        ${m ? `<button type="button" class="texte" data-action-plan="remettre" data-idx="${o.idx}">Remettre comme à l'origine</button>` : ""}</div>`;
  };

  // Les champs du panneau : { cle, article, fini, tourne, note } ou un message d'erreur.
  const lireChamps = () => {
    const val = (k) => {
      const c = boite.querySelector(`[data-champ="${k}"]`);
      return c ? (c.type === "checkbox" ? c.checked : c.value.trim()) : "";
    };
    const L = parseFloat(String(val("finiL")).replace(",", "."));
    const W = parseFloat(String(val("finiW")).replace(",", "."));
    if (!(L > 0) || !(W > 0)) return { erreur: "Indiquez la cote finie (longueur et largeur, en mm)." };
    return { cle: String(val("cle")).toUpperCase().replace(/\s+/g, ""), article: String(val("article")), fini: [L, W], tourne: Boolean(val("tourne")), note: String(val("note")) };
  };

  // Une clé tapée : article et cote finie repris de l'optimisation (si la pièce y est).
  const completerDepuisCle = () => {
    const c = boite.querySelector('[data-champ="cle"]');
    if (!c) return;
    const p = morceauPiece(donnees, c.value.trim().toUpperCase());
    if (!p) return;
    const mettre = (k, v) => {
      const e = boite.querySelector(`[data-champ="${k}"]`);
      if (e && !e.value) e.value = v;
    };
    mettre("article", p.q[16] || "");
    mettre("finiL", parseFloat(p.q[5]) || "");
    mettre("finiW", parseFloat(p.q[7]) || "");
  };

  const action = (quoi, el) => {
    const b = brouillon();
    const idx = el.dataset.idx !== undefined ? Number(el.dataset.idx) : null;
    if (quoi === "retirer") {
      b.morceaux[idx] = { retire: true };
      enregistrer(b, "Pièce retirée du plan : elle est marquée « ne pas couper » sur le plan modifié.");
    } else if (quoi === "remettre") {
      delete b.morceaux[idx];
      b.ajouts = b.ajouts.filter((a) => a.dans !== idx);
      enregistrer(b, "Remise comme à l'origine.");
    } else if (quoi === "modifier") {
      const c = lireChamps();
      if (c.erreur) return message(c.erreur);
      const r = plan.rects[idx];
      const t = tailleSurPlan(r, c.fini);
      if (t.L > r.L + 0.5 || t.W > r.W + 0.5) return message(`Plus grande que sa place sur le plan : au plus ${dimsPlan(r.fini[0], r.fini[1])} mm en cote finie.`);
      const m = {};
      if (c.cle !== (r.cle || "")) m.cle = c.cle;
      if (c.article !== (r.article || "")) m.article = c.article;
      if (Math.abs(c.fini[0] - r.fini[0]) > 0.05 || Math.abs(c.fini[1] - r.fini[1]) > 0.05) m.fini = c.fini;
      if (c.note) m.note = c.note;
      if (Object.keys(m).length) b.morceaux[idx] = m;
      else delete b.morceaux[idx];
      enregistrer(b, Object.keys(m).length ? "Modification enregistrée." : "Rien de changé : la pièce reste comme à l'origine.");
    } else if (quoi === "poser") {
      const c = lireChamps();
      if (c.erreur) return message(c.erreur);
      const hote = Number(el.dataset.hote);
      const essai = { ...b, ajouts: [...b.ajouts, { dans: hote, cle: c.cle, article: c.article, fini: c.fini, tourne: c.tourne, note: c.note }] };
      const r = plan.rects[hote];
      const autres = essai.ajouts.filter((a) => a.dans === hote);
      if (poserDansPlace(r, autres).poses.some((p) => !p.place)) return message(`Ne rentre pas : la place fait ${dimsPlan(r.L, r.W)} mm${autres.length > 1 ? `, avec ${autres.length - 1} autre(s) pièce(s) déjà posée(s)` : ""}. Essayez « Tournée ».`);
      if (!r.chute && !(b.morceaux[hote] && b.morceaux[hote].retire)) essai.morceaux[hote] = { retire: true };
      st.choix = null;
      enregistrer(essai, `Pièce ${c.cle || ""} posée (en vert sur le plan modifié).`);
    } else if (quoi === "maj-ajout" || quoi === "enlever-ajout") {
      const v = version();
      const o = v.origine[st.choix];
      if (quoi === "enlever-ajout") {
        b.ajouts.splice(o.ajout, 1);
        st.choix = null;
        enregistrer(b, "Pièce posée enlevée.");
      } else {
        const c = lireChamps();
        if (c.erreur) return message(c.erreur);
        const ancien = b.ajouts[o.ajout];
        b.ajouts[o.ajout] = { ...ancien, cle: c.cle, article: c.article, fini: c.fini, tourne: c.tourne, note: c.note };
        if (poserDansPlace(plan.rects[ancien.dans], b.ajouts.filter((a) => a.dans === ancien.dans)).poses.some((p) => !p.place)) return message("Ne rentre pas dans sa place avec cette cote.");
        enregistrer(b, "Pièce posée modifiée.");
      }
    }
    rendre();
  };
  const message = (t) => {
    st.message = `⚠ ${t}`;
    const zone = boite.querySelector(".pl-message");
    if (zone) zone.textContent = st.message;
    else rendre();
  };

  const brancher = (v) => {
    boite.querySelectorAll("[data-fermer]").forEach((b) => b.addEventListener("click", fermerPlanEnGrand));
    boite.querySelector("[data-cote]").addEventListener("click", () => {
      st.cote = st.cote === "fini" ? "debit" : "fini";
      rendre();
    });
    boite.querySelector("[data-editer]").addEventListener("click", () => {
      st.edition = !st.edition;
      st.choix = null;
      st.message = "";
      st.vue = "modifie";
      rendre();
    });
    boite.querySelectorAll("[data-vue]").forEach((b) =>
      b.addEventListener("click", () => {
        st.vue = b.dataset.vue;
        rendre();
      })
    );
    boite.querySelectorAll("[data-imprimer]").forEach((b) => b.addEventListener("click", () => imprimerPlanEnGrand(x, b.dataset.imprimer)));
    boite.querySelectorAll("[data-module]").forEach((b) => {
      const m = donnees.modules.get(b.dataset.module);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        ouvrirPlanEnGrand({ plan: m, donnees, visee, titre: `Module ${m.nom}`, badge: `Pdc ${m.pdc}`, sous: `module · ${dimsPlan(m.L, m.W)} · ${m.matiere}`, apresModification: x.apresModification });
      });
    });
    if (st.edition) {
      const choisir = (idx) => {
        st.choix = idx;
        st.message = "";
        rendre();
        const champ = boite.querySelector(".pl-panneau input");
        if (champ) champ.focus();
      };
      boite.querySelectorAll(".pl-dessin [data-idx]").forEach((g) => g.addEventListener("click", () => choisir(Number(g.dataset.idx))));
      boite.querySelectorAll("[data-choisir]").forEach((t) =>
        t.addEventListener("click", (e) => {
          if (e.target.closest("[data-module]")) return;
          choisir(Number(t.dataset.choisir));
        })
      );
      boite.querySelectorAll("[data-action-plan]").forEach((b) => b.addEventListener("click", () => action(b.dataset.actionPlan, b)));
      const cle = boite.querySelector('[data-champ="cle"]');
      if (cle) cle.addEventListener("change", completerDepuisCle);
      const tout = boite.querySelector("[data-tout-remettre]");
      if (tout)
        tout.addEventListener("click", async () => {
          if (!(await demanderConfirmation("Tout remettre comme à l'origine ?", "Toutes les modifications de ce plan seront effacées.", "Tout remettre"))) return;
          st.choix = null;
          enregistrer({ morceaux: {}, ajouts: [] }, "Plan remis comme à l'origine.");
          rendre();
        });
    }
    void v;
  };

  fond.addEventListener("click", (e) => {
    if (e.target === fond) fermerPlanEnGrand();
  });
  rendre();
  document.body.appendChild(fond);
  document.addEventListener("keydown", toucheModalePlan);
}

// Les plans d'un plan ouvert en grand pour le PDF : d'origine, modifié, ou les deux (avant / après).
function plansAImprimer(x, quoi) {
  const { plan, donnees } = x;
  const rt = retoucheDuPlan(donnees.lancement, plan);
  if (!rt || quoi === "origine") return [{ ...x, titre: `${x.titre || `Plan ${plan.pdc}`}${rt ? " — PLAN D'ORIGINE" : ""}` }];
  const pr = planRetouche(plan, rt);
  const date = rt.date ? ` le ${new Date(rt.date).toLocaleDateString("fr-FR")}` : "";
  const modifie = { ...x, plan: pr.plan, etats: pr.etats, textes: pr.textes, marques: pr.marques, titre: `${x.titre || `Plan ${plan.pdc}`} — MODIFIÉ`, legende: `Modifié dans Sentinelle${date} : ${changementsRetouche(plan, rt).length} changement(s)` };
  if (quoi === "modifie") return [modifie];
  // Avant : les morceaux d'origine qui changent, en rouge hachuré.
  const etats = new Map();
  const marques = new Map();
  for (const [k, m] of Object.entries(rt.morceaux || {})) {
    etats.set(Number(k), "deplacee");
    marques.set(Number(k), m.retire ? "retirée dans le plan modifié" : "modifiée dans le plan modifié");
  }
  for (const a of rt.ajouts || []) if (plan.rects[a.dans] && plan.rects[a.dans].chute) etats.set(a.dans, "chute_perdue");
  return [{ ...x, etats, marques, titre: `${x.titre || `Plan ${plan.pdc}`} — AVANT (plan d'origine)` }, { ...modifie, titre: `${x.titre || `Plan ${plan.pdc}`} — APRÈS (modifié)` }];
}

function imprimerPlanEnGrand(x, quoi) {
  const { plan, donnees } = x;
  const rt = retoucheDuPlan(donnees.lancement, plan);
  const plans = plansAImprimer(x, quoi);
  const avecModif = rt && quoi !== "origine";
  const suffixe = !rt ? "" : quoi === "origine" ? "_origine" : quoi === "modifie" ? "_modifie" : "_avant_apres";
  const octets = pdfPlansDeCoupe({
    surtitre: `Plan de coupe · lancement ${donnees.lancement}`,
    titre: `${x.titre || "Plan"} — ${x.badge || `Pdc ${plan.pdc}`}`,
    lignes: avecModif ? changementsRetouche(plan, rt) : rt ? ["Plan d'origine (optimisation Cut Rite), sans les modifications faites dans Sentinelle."] : [],
    note: avecModif
      ? "Bleu : pièce modifiée. Vert : pièce posée dans Sentinelle. Pointillés rouges : pièce retirée, à ne pas couper. Modifications faites dans Sentinelle : le .bkp et le fichier de lancement ne changent pas. Cotes finies en mm."
      : "Les numéros « Pdc » sont ceux de Cut Rite. Cotes finies en mm.",
    plans,
    document: `Plan de coupe ${plan.matiere} Pdc ${plan.pdc}${avecModif ? " (modifié)" : ""}`,
  });
  telecharger(`Plan_${donnees.lancement}_${plan.module ? `module_${plan.nom}` : `${plan.matiere}_Pdc${plan.pdc}`}${suffixe}.pdf`, octets, "application/pdf");
}
