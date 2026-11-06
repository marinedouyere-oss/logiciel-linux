// ---- V6.0 : accueil de la semaine, liste des postes du contrôle, menu ----

// Haut de page commun : surtitre, titre, phrase d'explication, boutons à droite.
function entetePage(surtitre, titre, chapeau, actions = "") {
  return `<header class="entete-page">
    <div class="entete-textes">
      <div class="surtitre">${echapper(surtitre)}</div>
      <h1>${echapper(titre)}</h1>
      ${chapeau ? `<div class="chapeau">${echapper(chapeau)}</div>` : ""}
    </div>
    ${actions ? `<div class="entete-actions">${actions}</div>` : ""}
  </header>`;
}

// Lundi de la semaine ISO « semaine » de l'année « annee ».
function lundiSemaineIso(annee, semaine) {
  const jan4 = new Date(annee, 0, 4);
  const lundi = new Date(annee, 0, 4 - ((jan4.getDay() + 6) % 7));
  lundi.setDate(lundi.getDate() + (semaine - 1) * 7);
  return lundi;
}

// Année d'un numéro de semaine : celle où cette semaine tombe le plus près d'aujourd'hui.
function anneeDeSemaine(semaine, aujourdHui = new Date()) {
  const a = aujourdHui.getFullYear();
  return [a - 1, a, a + 1].reduce((m, c) => (Math.abs(lundiSemaineIso(c, semaine) - aujourdHui) < Math.abs(lundiSemaineIso(m, semaine) - aujourdHui) ? c : m), a);
}

function datesSemaine(semaine) {
  const lundi = lundiSemaineIso(anneeDeSemaine(semaine), semaine);
  const vendredi = new Date(lundi);
  vendredi.setDate(lundi.getDate() + 4);
  const jour = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  const debut = lundi.getMonth() === vendredi.getMonth() ? String(lundi.getDate()) : jour(lundi);
  return `Du lundi ${debut} au vendredi ${jour(vendredi)}`;
}

// ---- État d'une case : ce qui est à regarder ----

function problemesDeLaCase(p) {
  const l = [];
  if (p.rapport && p.rapport.nbAnomalies) l.push(`${p.rapport.nbAnomalies} pièce(s) à vérifier dans ${sourceControle(p)}`);
  if (p.doublons.length) l.push(`${p.doublons.length} doublon(s) dans le lancement`);
  if (p.erreurScies) l.push("Scies : contrôle impossible");
  else if (p.ecartsScies && p.ecartsScies.length) l.push(`Scies : ${p.ecartsScies.length} pièce(s) différente(s)`);
  if (p.couleurs && p.couleurs.absentes.length) l.push(`Couleurs : ${p.couleurs.absentes.length} couleur(s) absente(s) du .bkp`);
  if (p.etatErreur && p.etat) l.push(p.etat.replace(/^❌\s*/, ""));
  return l;
}

function etatCase(p) {
  if (p.enCours) return { texte: "En cours…", genre: "encours" };
  if (!p.strat) return { texte: "Pas de lancement", genre: "vide" };
  const n = problemesDeLaCase(p).length;
  if (n) return { texte: `${n} à regarder`, genre: "souci" };
  if (!p.rapport) return { texte: "Pas contrôlé", genre: "vide" };
  return { texte: "OK", genre: "bon" };
}

function etatCoupe(p) {
  if (p.coupe && p.bkp) return { texte: "Liste + .bkp", genre: "bon" };
  if (p.bkp) return { texte: ".bkp seul", genre: "bon" };
  if (p.coupe) return { texte: "Liste seule", genre: "bon" };
  return { texte: "—", genre: "vide" };
}

const etiquette = (e) => `<span class="etiquette ${e.genre}">${echapper(e.texte)}</span>`;

// ---- Contrôle : la liste des postes à gauche, un clic amène à la case ----

function majListePostes() {
  const zone = $("listePostes");
  if (!zone || !estOngletSemaine()) return;
  zone.innerHTML = pairesDeLaSemaine(onglet)
    .map(
      (p) => `<button type="button" class="poste-item" data-case="${p.id}">
        <span class="poste-textes"><span class="poste-nom">${echapper(titreCase(p))}</span><span class="poste-fichier">${p.strat ? echapper(p.strat.name) : "Aucun lancement"}</span></span>
        ${etiquette(etatCase(p))}
      </button>`
    )
    .join("");
  zone.querySelectorAll(".poste-item").forEach((b) => b.addEventListener("click", () => montrerCase(Number(b.dataset.case))));
}

// Fait défiler jusqu'à la case et la met en avant un instant.
function montrerCase(id) {
  const carte = document.querySelector(`.carte-paire[data-id="${id}"]`);
  if (!carte) return;
  document.querySelectorAll(".carte-paire.choisie").forEach((c) => c.classList.remove("choisie"));
  carte.classList.add("choisie");
  carte.scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => carte.classList.remove("choisie"), 2500);
}

// ---- Journal des fichiers créés par « Préparer un lancement » (gardé dans ce navigateur) ----

const CLE_JOURNAL = "sentinelle-fichiers-crees";

function lireJournal() {
  try {
    const j = JSON.parse(localStorage.getItem(CLE_JOURNAL) || "[]");
    return Array.isArray(j) ? j : [];
  } catch (_e) {
    return [];
  }
}

function ajouterAuJournal(nom, chemin) {
  try {
    const j = [{ quand: new Date().toISOString(), nom, chemin }, ...lireJournal()].slice(0, 20);
    localStorage.setItem(CLE_JOURNAL, JSON.stringify(j));
  } catch (_e) {
    // Sans stockage (navigation privée…), pas de journal : rien de grave.
  }
}

// ---- Menu : le dossier où les lancements préparés sont rangés ----

function majMenuDossier() {
  const zone = $("menuDossier");
  if (!zone) return;
  const r = typeof reecriture !== "undefined" ? reecriture.racine : null;
  const pc = typeof window.showDirectoryPicker === "function";
  zone.innerHTML = `<span class="petit">Dossier des semaines</span>
    <span class="nom">${r ? echapper(r.name) : "Aucun dossier choisi"}</span>
    <span class="etat-dossier">${r ? "Les lancements préparés y sont rangés tout seuls." : "C'est là que les lancements préparés seront rangés."}</span>
    ${pc ? `<button type="button" class="bouton-menu" id="btnMenuDossier">${r ? "Changer de dossier" : "Choisir le dossier"}</button>` : ""}`;
  const bouton = $("btnMenuDossier");
  if (bouton) bouton.addEventListener("click", choisirRacineReecriture);
}

// ---- Accueil : la semaine d'un coup d'œil ----

let pariteAccueil = null;

const TYPE_DU_POSTE = { "Agglo 1er tour": "agglo1", "Agglo 2ème tour": "agglo2", Recyclage: "recyclage", Feno: "feno", Casse: "casse" };

function preparerLancementPour(p) {
  if (typeof reecriture !== "undefined") {
    const semaine = numeroSemaine(p.parite);
    reecriture.reglage.type = estChantier(p) ? "chantier" : TYPE_DU_POSTE[p.poste] || "";
    reecriture.reglage.semaine = String(semaine).padStart(2, "0");
    if (!reecriture.reglage.annee) reecriture.reglage.annee = String(anneeDeSemaine(semaine) % 100).padStart(2, "0");
    reecriture.etat = null;
  }
  onglet = "reecriture";
  afficher();
}

// Nombre de pièces de chaque lancement et de la semaine (lu dans les fichiers de lancement, sans bloquer l'écran).
async function remplirPiecesAccueil(page, cases) {
  let total = 0;
  for (const p of cases) {
    if (!p.strat) continue;
    const r = await resume(p.strat, p.bkp);
    const zone = page.querySelector(`[data-pieces="${p.id}"]`);
    if (!zone || !zone.isConnected) return; // l'écran a changé entre-temps
    zone.textContent = Number.isNaN(r.prevues) ? "?" : fmtNombre(r.prevues);
    if (!Number.isNaN(r.prevues)) total += r.prevues;
  }
  const tuile = page.querySelector("#tuilePiecesAccueil");
  if (tuile && tuile.isConnected) tuile.textContent = fmtNombre(total);
}

function afficherAccueil() {
  const page = $("pageAccueil");
  if (!page) return;
  if (!pariteAccueil) pariteAccueil = pariteDuNumero(semaineIso(new Date())) || "paire";
  const parite = pariteAccueil;
  const numero = numeroSemaine(parite);
  const enCours = numero === semaineIso(new Date());
  const cases = pairesDeLaSemaine(parite);
  const avecLancement = cases.filter((p) => p.strat);
  const controlees = avecLancement.filter((p) => p.rapport);
  const aRegarder = [];
  for (const p of cases) for (const t of problemesDeLaCase(p)) aRegarder.push({ p, titre: `${titreCase(p)} — ${t}`, genre: "souci" });
  for (const p of cases) if (!p.strat && !estChantier(p)) aRegarder.push({ p, titre: `${titreCase(p)} — pas encore de lancement`, genre: "vide" });
  const nbProblemes = aRegarder.filter((a) => a.genre === "souci").length;

  const semaines = ["paire", "impaire"].map((x) => ({ parite: x, numero: numeroSemaine(x) })).sort((a, b) => a.numero - b.numero);
  const actions = `<div class="choix-semaine" role="group" aria-label="Choisir la semaine">${semaines
    .map((s) => `<button type="button" data-parite="${s.parite}" aria-pressed="${s.parite === parite}" class="${s.parite === parite ? "actif" : ""}">S${s.numero}</button>`)
    .join("")}</div>
    <button type="button" id="btnAccueilPreparer">+ Préparer un lancement</button>`;

  const tuile = (valeur, legende, genre = "") => `<div class="tuile ${genre}"><span class="tuile-legende">${legende}</span><span class="tuile-valeur">${valeur}</span></div>`;
  let html = entetePage(enCours ? "Semaine en cours" : "Semaine", `Semaine ${numero} · ${anneeDeSemaine(numero)}`, datesSemaine(numero), actions);
  html += `<section class="tuiles" aria-label="Avancement de la semaine">
    ${tuile(`${avecLancement.length} sur ${cases.length}`, "Lancements chargés")}
    ${tuile('<span id="tuilePiecesAccueil">…</span>', "Pièces")}
    ${tuile(`${controlees.length} sur ${avecLancement.length}`, "Contrôles faits")}
    ${tuile(String(nbProblemes), "À regarder", nbProblemes ? "souci" : "")}
  </section>`;

  html += `<h2 class="titre-section">Les lancements de la semaine</h2><div class="grille-lancements">`;
  cases.forEach((p, i) => {
    html += `<article class="carte-lancement">
      <div class="carte-lancement-tete"><span class="pastille">${String(i + 1).padStart(2, "0")}</span><h3>${echapper(titreCase(p))}</h3></div>
      <div class="carte-lancement-fichier">${p.strat ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg><span>${echapper(p.strat.name)}</span>` : '<span class="vide">Pas encore de lancement</span>'}</div>
      <dl class="carte-lancement-etats">
        <div><dt>Lancement</dt><dd>${etiquette(p.strat ? { texte: "Chargé", genre: "bon" } : { texte: "À préparer", genre: "vide" })}</dd></div>
        <div><dt>Pièces</dt><dd class="pieces-lancement" data-pieces="${p.id}">${p.strat ? "…" : "—"}</dd></div>
        <div><dt>Coupe</dt><dd>${etiquette(etatCoupe(p))}</dd></div>
        <div><dt>Contrôle</dt><dd>${etiquette(etatCase(p))}</dd></div>
      </dl>
      ${p.strat ? `<button type="button" class="contour" data-voir="${p.id}">Voir le contrôle</button>` : `<button type="button" class="contour" data-preparer="${p.id}">Préparer</button>`}
    </article>`;
  });
  html += "</div>";

  const journal = lireJournal().slice(0, 6);
  const quand = (iso) => {
    const d = new Date(iso);
    const memeJour = d.toDateString() === new Date().toDateString();
    return memeJour ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  };
  html += `<div class="deux-colonnes">
    <section class="carte">
      <div class="carte-titre">À regarder</div>
      ${
        aRegarder.length
          ? aRegarder.map((a) => `<button type="button" class="ligne-regarder ${a.genre}" data-voir="${a.p.id}"><span class="point"></span><span>${echapper(a.titre)}</span></button>`).join("")
          : '<div class="note">Rien à signaler pour l\'instant.</div>'
      }
    </section>
    <section class="carte">
      <div class="carte-titre">Derniers fichiers créés</div>
      ${
        journal.length
          ? journal.map((j) => `<div class="ligne-journal"><span class="heure">${echapper(quand(j.quand))}</span><span class="journal-textes"><strong>${echapper(j.nom)}</strong><span class="note">${echapper(j.chemin)}</span></span></div>`).join("")
          : '<div class="note">Aucun fichier créé depuis ce PC pour l\'instant.</div>'
      }
      <div class="ligne-telephone">
        <span class="note">${(etatLienTelephone() || {}).code ? "Téléphone : envoi automatique activé (chiffré), réglé dans la Bibliothèque." : "Téléphone : le fichier partagé se fait dans la Bibliothèque, ou activez l'envoi automatique au téléphone."}</span>
        <button type="button" class="contour" id="btnAccueilTelephone">Fichier du téléphone</button>
      </div>
    </section>
  </div>`;
  page.innerHTML = html;
  remplirPiecesAccueil(page, cases);

  page.querySelectorAll(".choix-semaine button").forEach((b) =>
    b.addEventListener("click", () => {
      pariteAccueil = b.dataset.parite;
      afficherAccueil();
    })
  );
  $("btnAccueilPreparer").addEventListener("click", () => {
    onglet = "reecriture";
    afficher();
  });
  $("btnAccueilTelephone").addEventListener("click", () => {
    onglet = "bibliotheque";
    afficher();
  });
  page.querySelectorAll("[data-voir]").forEach((b) =>
    b.addEventListener("click", () => {
      const p = paires.find((x) => x.id === Number(b.dataset.voir));
      if (!p) return;
      onglet = p.parite;
      afficher();
      requestAnimationFrame(() => montrerCase(p.id));
    })
  );
  page.querySelectorAll("[data-preparer]").forEach((b) =>
    b.addEventListener("click", () => {
      const p = paires.find((x) => x.id === Number(b.dataset.preparer));
      if (p) preparerLancementPour(p);
    })
  );
}
