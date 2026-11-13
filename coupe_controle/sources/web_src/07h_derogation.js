// ---- Déroger à la règle des semaines ----
// Normalement, un lancement est rangé dans la semaine écrite dans son fichier (colonne com_livsem), sinon celle de son
// dossier « Semaine NN ». On peut décider autrement : une FENO en retard (semaine 46) fabriquée en semaine 47.
// La dérogation est retenue par nom de lancement : elle tient aux scans suivants, dans la bibliothèque et sur le
// téléphone. Le fichier de lancement, lui, n'est jamais modifié.

const CLE_DEROGATIONS = "sentinelle-derogations-semaine";

function lireDerogations() {
  try {
    const d = JSON.parse(localStorage.getItem(CLE_DEROGATIONS) || "{}");
    return d && typeof d === "object" ? d : {};
  } catch (_e) {
    return {};
  }
}

function ecrireDerogations(d) {
  try {
    localStorage.setItem(CLE_DEROGATIONS, JSON.stringify(d));
  } catch (_e) {
    // sans stockage : la dérogation dure le temps de la page
  }
}

const cleDerogation = (nomFichier) => cleNomLancement(String(nomFichier || "").replace(/\.[^.]*$/, ""));

// { annee, semaine } choisie à la main pour ce lancement, ou null.
function derogationDe(nomFichier) {
  if (!nomFichier) return null;
  const d = lireDerogations()[cleDerogation(nomFichier)];
  return d && d.semaine >= 1 && d.semaine <= 53 ? d : null;
}

function enregistrerDerogation(nomFichier, semaine, annee) {
  const d = lireDerogations();
  d[cleDerogation(nomFichier)] = { semaine: Number(semaine), annee: annee || anneeDeSemaine(Number(semaine)), date: new Date().toISOString(), nom: String(nomFichier).replace(/\.[^.]*$/, "") };
  ecrireDerogations(d);
}

function supprimerDerogation(nomFichier) {
  const d = lireDerogations();
  delete d[cleDerogation(nomFichier)];
  ecrireDerogations(d);
}

// L'onglet qui affiche cette semaine (une des 4 semaines de « Contrôler la coupe »), ou null.
const ongletAffichant = (n) => ONGLETS_SEMAINE.find((o) => Number(numeroSemaine(o)) === Number(n)) || null;

// Les fichiers et résultats d'une case passent dans une autre (même poste, autre semaine).
async function deplacerCase(a, b) {
  for (const role of ["strat", "coupe", "bkp", "sommaire", "diakonos"]) {
    if (!a[role]) continue;
    b[role] = a[role];
    await memoriserFichier(b, role, a[role]);
  }
  const garder = resultatsAMemoriser(a);
  delete garder.semaineParite;
  Object.assign(b, garder);
  await reinitialiser(a);
}

// Range le lancement de la case p en semaine n (dérogation retenue si avecDerogation). Rend la case où il est
// maintenant (ou null).
async function derogerSemaine(p, n, avecDerogation = true) {
  if (!p || !p.strat) return null;
  const nom = p.strat.name;
  const cible = ongletAffichant(n);
  if (!cible) {
    alert(`La semaine ${n} n'est pas affichée dans « Contrôler la coupe » (semaines ${ONGLETS_SEMAINE.map(numeroSemaine).join(", ")}).`);
    return null;
  }
  let q = p;
  if (cible !== p.parite) {
    if (caseAjoutee(p)) p.parite = cible;
    else {
      const fixe = paireFixe(p.poste, cible);
      if (fixe && !fixe.strat) q = fixe;
      else if (POSTES_SUPPLEMENTS.includes(p.poste)) q = ajouterSupplement(p.poste, cible);
      else {
        alert(`La case « ${p.poste} » de la semaine ${n} a déjà un lancement (${fixe.strat.name}) : videz-la d'abord (↺ Réinitialiser), puis recommencez.`);
        return null;
      }
      await deplacerCase(p, q);
    }
  }
  if (avecDerogation) enregistrerDerogation(nom, n);
  else supprimerDerogation(nom);
  q.semaine = String(n).padStart(2, "0");
  enregistrer(q);
  // Bibliothèque (et téléphone) : retiré des autres semaines, rangé dans la semaine choisie.
  await retirerLancementDesAutresSemaines(nom, idSemaine(anneeDeSemaine(Number(n)), Number(n)));
  try {
    await archiverOnglet(cible, null);
  } catch (_e) {
    // la bibliothèque sera mise à jour au prochain contrôle
  }
  afficher();
  return q;
}

// Retour à la règle normale : la semaine du fichier (ou de son dossier).
async function remettreSemaineDuFichier(p) {
  if (!p || !p.strat) return;
  supprimerDerogation(p.strat.name);
  const n = Number(await detecterSemaine(p, true));
  // La semaine du fichier est affichée : le lancement y retourne (même case que d'habitude) ; sinon il reste là.
  if (n && ongletAffichant(n)) {
    await derogerSemaine(p, n, false);
    return;
  }
  p.semaine = n ? String(n).padStart(2, "0") : null;
  enregistrer(p);
  afficher();
}

// La zone « semaine » d'une case : la dérogation en cours, ou le choix d'une autre semaine.
async function remplirZoneSemaine(zone, p) {
  if (!zone || !p.strat || estDiakonos(p)) {
    if (zone) zone.innerHTML = "";
    return;
  }
  const d = derogationDe(p.strat.name);
  const fichier = await detecterSemaine(p, true);
  if (d) {
    zone.innerHTML = `<div class="derogation">⇄ <strong>Semaine ${d.semaine} choisie à la main</strong>${fichier ? ` (le fichier dit semaine ${Number(fichier)})` : ""}.
      <button type="button" class="texte" data-remettre-semaine>Remettre la semaine du fichier</button></div>`;
    zone.querySelector("[data-remettre-semaine]").addEventListener("click", () => remettreSemaineDuFichier(p));
    return;
  }
  if (!zone.dataset.ouvert) {
    zone.innerHTML = "";
    return;
  }
  const semaines = ONGLETS_SEMAINE.map((o) => Number(numeroSemaine(o))).sort((a, b) => a - b);
  zone.innerHTML = `<div class="derogation choix">Ranger ce lancement en semaine
      <select data-semaine-cible>${semaines.map((s) => `<option value="${s}" ${s === Number(p.semaine) ? "selected" : ""}>${s}</option>`).join("")}</select>
      <button type="button" data-deroger>Déroger</button> <button type="button" class="texte" data-annuler>Annuler</button>
      <div class="note">Semaine du fichier : ${fichier ? Number(fichier) : "?"}. Le fichier de lancement n'est pas modifié ; le choix tient aux prochains scans, dans la bibliothèque et sur le téléphone.</div></div>`;
  zone.querySelector("[data-annuler]").addEventListener("click", () => {
    delete zone.dataset.ouvert;
    zone.innerHTML = "";
  });
  zone.querySelector("[data-deroger]").addEventListener("click", async () => {
    const n = Number(zone.querySelector("[data-semaine-cible]").value);
    if (n === Number(fichier) && !d) {
      delete zone.dataset.ouvert;
      zone.innerHTML = "";
      return;
    }
    await derogerSemaine(p, n);
  });
}
