// ---- Rapport des problèmes du lancement (.xlsx), une seule feuille à lire de haut en bas :
// 1. le bilan de chaque contrôle en une phrase (ce que l'écran affichait) ;
// 2. le détail des pièces à problème, regroupées par problème, chacun expliqué en clair ;
// 3. les fichiers comparés. ----

const GRAVITE = { CORRIGER: 2, VERIFIER: 1, INFO: 0 };
const A_FAIRE = { [GRAVITE.CORRIGER]: "À corriger", [GRAVITE.VERIFIER]: "À vérifier", [GRAVITE.INFO]: "Pour info" };

// Les problèmes, dans l'ordre du rapport : ce qu'ils veulent dire, et que faire.
const PROBLEMES = [
  ["Absente de la liste de coupe", "Pièce du lancement introuvable dans la liste de coupe Cut Rite : elle ne sera pas débitée.",
    "l'ajouter à l'optimisation Cut Rite (ou vérifier qu'elle est débitée ailleurs)."],
  ["Quantité différente dans la liste de coupe", "La liste de coupe ne prévoit pas le même nombre de pièces que le lancement.", "corriger la quantité dans l'optimisation."],
  ["Absente du .bkp", "Pièce du lancement introuvable dans l'optimisation (.bkp) : aucun panneau n'est prévu pour elle.", "l'ajouter à l'optimisation."],
  ["Quantité différente dans le .bkp", "L'optimisation (.bkp) ne prévoit pas le même nombre de pièces que le lancement.", "corriger la quantité dans l'optimisation."],
  ["Couleur absente du .bkp", "Aucun panneau de ce coloris dans l'optimisation (.bkp) : ces pièces ne sont pas optimisées.", "ajouter un panneau de ce coloris à l'optimisation."],
  ["Pas dans les plans de coupe", "Pièce prévue dans l'optimisation (.bkp), mais posée sur aucun panneau des plans de coupe : elle ne sera pas coupée.",
    "relancer l'optimisation Cut Rite (panneau manquant, pièce trop grande…), ou valider si c'est voulu."],
  ["Dans le .bkp, dans aucun plan", "Pièce de la liste du .bkp qui n'est ni dans le fichier de lancement ni dans aucun plan de coupe : elle ne sera pas coupée (retirée du lancement après l'import ?).",
    "vérifier qu'elle ne doit pas être fabriquée, ou valider si c'est voulu."],
  ["Ligne en double", "Deux lignes identiques dans le fichier de lancement : la pièce serait fabriquée deux fois.",
    "supprimer la ligne en trop (bouton « Créer le lancement sans doublons » de Sentinelle)."],
  ["Lancée deux fois", "La même pièce est aussi dans un autre lancement de la semaine : risque de la fabriquer deux fois.", "la retirer d'un des deux lancements."],
  ["Débitée, mais pas dans le lancement", "Pièce prévue à la découpe (liste de coupe, .bkp) qui n'est pas dans le fichier de lancement.",
    "l'ajouter au fichier de lancement si elle est commandée (Diakonos), sinon la retirer de l'optimisation."],
  ["Débitée ici, lancée ailleurs", "Pièce prévue à la découpe ici (liste de coupe, .bkp) alors qu'elle est dans un autre lancement.",
    "la retirer de cette optimisation (ou de l'autre lancement)."],
  ["Commandée, pas lancée (Diakonos)", "Pièce commandée (fichier Diakonos) qui n'est dans aucun des lancements comparés : elle ne sera pas fabriquée.",
    "l'ajouter à un lancement."],
  ["Couleur en version PF", "Le lancement demande un coloris, le .bkp utilise sa version PF (même décor) : à confirmer.", "vérifier que la version PF convient."],
  ["Commandée ici, lancée ailleurs (Diakonos)", "Pièce commandée pour ces lancements, mais lancée dans un autre : elle sera fabriquée, ailleurs que prévu.",
    "vérifier que c'est voulu."],
  ["Autre semaine de livraison", "Pièce à livrer une autre semaine que le reste du lancement.", "vérifier qu'elle doit bien être fabriquée maintenant."],
  ["Déjà lancée la semaine d'avant", "La pièce était déjà dans un lancement de l'autre semaine chargée.", "vérifier qu'il faut bien la refaire."],
  ["Casse : relancée", "Pièce de la casse déjà lancée une semaine d'avant (autre onglet ou bibliothèque) : c'est une pièce refaite.", ""],
  ["Casse : rajout", "Pièce de la casse lancée dans aucune des semaines d'avant connues : c'est un rajout.", ""],
];
const RANG_PROBLEME = new Map(PROBLEMES.map(([type], i) => [type, i]));
const SENS_PROBLEME = new Map(PROBLEMES.map(([type, sens, queFaire]) => [type, { sens, queFaire }]));

// Tous les contrôles du lancement : le bilan (une phrase par contrôle), les problèmes de chaque pièce du lancement
// (par clé commande + ligne) et ceux des pièces qui n'y sont pas.
async function problemesDuLancement(p) {
  const parCle = new Map(); // clé → [{ gravite, type, detail }]
  const hors = []; // { gravite, type, detail, cle, article, dimensions, coloris }
  const bilan = []; // { statut: "ok" | "alerte" | "attention" | "info", controle, texte }
  // Chaque problème garde le contrôle qui l'a trouvé (une validation peut rendre ce contrôle OK).
  const ajouter = (cle, gravite, type, detail, controle) => {
    if (!parCle.has(cle)) parCle.set(cle, []);
    parCle.get(cle).push({ gravite, type, detail, controle });
  };
  const dehors = (h) => hors.push({ gravite: GRAVITE.CORRIGER, article: "", dimensions: "", coloris: "", ...h });
  const bkp = p.source === "bkp";
  const dans = bkp ? "le .bkp" : "la liste de coupe";
  const de = bkp ? "du .bkp" : "de la liste de coupe";
  const strat = await stratEnCache(p.strat);

  // Lancement contre la liste de coupe (sinon contre le .bkp).
  const controle = bkp ? "Lancement / .bkp (pas de liste de coupe)" : "Lancement / liste de coupe";
  const signales = new Set(); // pièces déjà signalées par ce contrôle quand il se fait avec le .bkp
  if (p.rapport) {
    const r = p.rapport;
    const enPieces = r.piecesAttendues > 0 || r.piecesTrouvees > 0;
    const attendu = Math.trunc(enPieces ? r.piecesAttendues : r.totalAttendu);
    const trouve = fmtNombre(enPieces ? r.piecesTrouvees : r.totalTrouve);
    let texte = r.nbAnomalies === 0
      ? `Tout est correct : les ${attendu} pièces du lancement sont dans ${dans}.`
      : `${r.nbAnomalies} pièce(s) à vérifier : ${attendu} pièces dans le lancement, ${trouve} dans ${dans}.`;
    if (p.nbUnitaires !== null && p.nbPiecesTrouvees) {
      const unitaire = (p.nbUnitaires * 100) / p.nbPiecesTrouvees;
      texte += ` Liste de coupe : ${pourcent(unitaire)} % des pièces en unitaire, ${pourcent(100 - unitaire)} % en grain matching.`;
    }
    bilan.push({ statut: r.nbAnomalies ? "alerte" : "ok", controle, texte });
    for (const l of r.lignes) {
      if (l.statut === "OK") continue;
      // Pièce assemblée (compact + support…) : les quantités comptent les couches.
      const couches = (l.couches || 1) > 1;
      const unite = (n) => (couches ? `${fmtNombre(n)} couche(s)` : `${fmtNombre(n)} pièce(s)`);
      const debut = couches ? `Pièce en ${l.couches} couches : ` : "";
      if (bkp) signales.add(l.cle);
      if (l.statut === "Manquant") ajouter(l.cle, GRAVITE.CORRIGER, `Absente ${de}`, `${debut}${unite(l.qte_attendue)} dans le lancement, aucune dans ${dans}`, controle);
      else if (l.statut === "En trop")
        dehors({ cle: l.cle, article: l.article || "", type: `En trop dans ${dans}`, quantite: fmtNombre(l.qte_trouvee), detail: `${unite(l.qte_trouvee)} dans ${dans}, rien dans le lancement`, controle });
      else {
        const ecart = Math.abs(l.qte_trouvee - l.qte_attendue);
        ajouter(l.cle, GRAVITE.CORRIGER, `Quantité différente dans ${dans}`,
          `${debut}${unite(l.qte_attendue)} dans le lancement, ${fmtNombre(l.qte_trouvee)} dans ${dans} (${fmtNombre(ecart)} ${l.qte_trouvee < l.qte_attendue ? "en moins" : "en trop"})`, controle);
      }
    }
  } else
    bilan.push({ statut: "info", controle: "Lancement / liste de coupe", texte: p.coupe || p.bkp ? "Pas encore fait (bouton GO)." : "Pas de liste de coupe ni de .bkp : pas de contrôle." });

  // Scies : le lancement (protections comprises) contre ce qui est optimisé dans le .bkp.
  if (p.erreurScies) bilan.push({ statut: "alerte", controle: "Scies (.bkp)", texte: `Contrôle impossible : ${p.erreurScies}` });
  else if (!p.ecartsScies) bilan.push({ statut: "info", controle: "Scies (.bkp)", texte: p.bkp ? "Pas encore fait (bouton Vérifier Scies)." : "Pas de .bkp : pas de contrôle." });
  else {
    const panneaux = `${fmtNombre(p.totalScies || 0)} panneaux`;
    bilan.push(p.ecartsScies.length
      ? { statut: "alerte", controle: "Scies (.bkp)", texte: `${p.ecartsScies.length} pièce(s) différente(s) entre le lancement et le .bkp (${panneaux} vérifiés).` }
      : { statut: "ok", controle: "Scies (.bkp)", texte: `Tout correspond : ${panneaux}.` });
    for (const e of p.ecartsScies) {
      if (signales.has(e.cle)) continue; // déjà dans le contrôle avec le .bkp
      if (e.attendu === 0) dehors({ cle: e.cle, type: "En trop dans le .bkp", quantite: fmtNombre(e.trouve), detail: `${fmtNombre(e.trouve)} dans le .bkp, rien dans le lancement`, controle: "Scies (.bkp)" });
      else if (e.trouve === 0) ajouter(e.cle, GRAVITE.CORRIGER, "Absente du .bkp", `${fmtNombre(e.attendu)} pièce(s) dans le lancement, aucune dans le .bkp`, "Scies (.bkp)");
      else ajouter(e.cle, GRAVITE.VERIFIER, "Quantité différente dans le .bkp", `${fmtNombre(e.attendu)} pièce(s) dans le lancement, ${fmtNombre(e.trouve)} dans le .bkp`, "Scies (.bkp)");
    }
  }

  // Couleurs du lancement absentes du .bkp, ou remplacées par leur version PF.
  if (p.couleurs) {
    const c = p.couleurs;
    const variantes = c.variantes || [];
    // « 1136 (faces dessus et dessous) » : une ligne par pièce, toutes ses faces ensemble.
    const faces = (liste) =>
      [...new Set(liste.map((a) => a.couleur))].map((couleur) => {
        const lesFaces = liste.filter((a) => a.couleur === couleur).map((a) => a.face);
        return `${couleur} (${lesFaces.length > 1 ? `faces ${lesFaces.join(" et ")}` : `face ${lesFaces[0]}`})`;
      });
    const parPiece = (liste) => {
      const m = new Map();
      for (const a of liste) for (const cle of a.cles) m.set(cle, [...(m.get(cle) || []), a]);
      return m;
    };
    // Une couleur optimisée en petit format (« 1136 » → « 1136-PF ») est voulue : pas un problème, juste précisé.
    const formatsPf = variantes.length ? ` (${[...new Set(variantes.map((v) => v.variante))].join(", ")} : petit format)` : "";
    if (c.sansStratifie) bilan.push({ statut: "info", controle: "Couleurs (.bkp)", texte: "Pas de stratifié dans ce .bkp." });
    else if (!c.absentes.length) bilan.push({ statut: "ok", controle: "Couleurs (.bkp)", texte: `Les ${c.nbCouleurs} couleurs du lancement sont dans le .bkp${formatsPf}.` });
    else {
      bilan.push({
        statut: "alerte",
        controle: "Couleurs (.bkp)",
        texte: `${c.absentes.length} couleur(s) du lancement absente(s) du .bkp : ${faces(c.absentes).join(", ")}. Ces panneaux ne sont pas optimisés.${formatsPf}`,
      });
      for (const [cle, liste] of parPiece(c.absentes)) ajouter(cle, GRAVITE.CORRIGER, "Couleur absente du .bkp", `Couleur ${faces(liste).join(", ")} : pas de panneau dans le .bkp`, "Couleurs (.bkp)");
    }
  }

  // Pièces dans les plans de coupe : prévues par le .bkp, mais posées sur aucun panneau (Cut Rite n'a pas pu les placer).
  const ctrlPlans = "Plans de coupe (.bkp)";
  if (p.plans) {
    const r = p.plans;
    const plans = `${fmtNombre(r.nbPlans)} plans de panneaux et ${fmtNombre(r.nbModules)} modules`;
    const hors = r.horsLancement || [];
    const texteHors = hors.length ? ` ${hors.length} pièce(s) de la liste du .bkp, hors lancement, dans aucun plan : elles ne seront pas coupées.` : "";
    for (const h of hors)
      dehors({ cle: h.cle, gravite: GRAVITE.VERIFIER, type: "Dans le .bkp, dans aucun plan", quantite: fmtNombre(h.qte),
        detail: "Dans la liste du .bkp, mais ni dans le fichier de lancement ni dans aucun plan de coupe : elle ne sera pas coupée", controle: ctrlPlans });
    if (!r.nonPlacees.length)
      bilan.push({ statut: hors.length ? "attention" : "ok", controle: ctrlPlans, texte: `Les ${fmtNombre(r.nbPieces)} pièces prévues par le .bkp sont placées dans les plans de coupe (${plans}).${texteHors}` });
    else {
      bilan.push({ statut: "alerte", controle: ctrlPlans, texte: `${r.nonPlacees.length} pièce(s) du .bkp dans aucun plan de coupe : elles ne seront pas coupées (${plans}).${texteHors}` });
      for (const n of r.nonPlacees)
        ajouter(n.cle, GRAVITE.CORRIGER, "Pas dans les plans de coupe", n.place
          ? `${fmtNombre(n.attendu)} pièce(s) prévue(s) dans le .bkp, ${fmtNombre(n.place)} seulement dans les plans de coupe`
          : `${fmtNombre(n.attendu)} pièce(s) prévue(s) dans le .bkp, posée(s) sur aucun panneau`, ctrlPlans);
    }
  } else if (p.bkp && !p.erreurScies)
    bilan.push({ statut: "info", controle: ctrlPlans, texte: p.ecartsScies ? "Refaire « Vérifier Scies » pour contrôler les plans de coupe." : "Pas encore fait (bouton Vérifier Scies)." });

  // Semaines de livraison (une casse en mélange toujours plusieurs).
  if (p.poste !== "Casse" && strat.semaines.length) {
    const principale = strat.semaines.reduce((a, s) => (s.nbPieces > a.nbPieces ? s : a), strat.semaines[0]);
    const autres = strat.semaines.filter((s) => s !== principale);
    if (!autres.length) bilan.push({ statut: "ok", controle: "Semaine de livraison", texte: `Toutes les pièces sont à livrer en semaine ${principale.semaine}.` });
    else {
      const n = autres.reduce((t, s) => t + s.nbPieces, 0);
      bilan.push({ statut: "attention", controle: "Semaine de livraison",
        texte: `${n} pièce(s) à livrer une autre semaine que la semaine ${principale.semaine} : ${autres.map((s) => `${s.nbPieces} en semaine ${s.semaine}`).join(", ")}.` });
      for (const s of autres) for (const cle of s.cles || []) ajouter(cle, GRAVITE.VERIFIER, "Autre semaine de livraison", `À livrer en semaine ${s.semaine} ; le reste du lancement est pour la semaine ${principale.semaine}`, "Semaine de livraison");
    }
  }

  // Lignes en double dans le fichier de lancement (signalées ligne par ligne plus bas).
  const nbDoublons = strat.doublons.length;
  bilan.push(nbDoublons
    ? { statut: "alerte", controle: "Lignes en double", texte: `${nbDoublons} pièce(s) en double dans le fichier de lancement : ${strat.doublons.map((d) => d.cle).join(", ")}.` }
    : { statut: "ok", controle: "Lignes en double", texte: "Aucune ligne en double dans le fichier de lancement." });

  // Pièces aussi dans un autre lancement de la semaine.
  const autre = ongletPrecedent(p.parite);
  const nomDe = (o) => `${titreCase(o)} (${o.strat.name})`;
  const clesDuLancement = (await resume(p.strat, p.bkp)).cles;
  const deuxFois = new Map(); // lancement → nombre de pièces en commun
  for (const o of pairesDeLaSemaine(p.parite)) {
    if (o === p || !o.strat) continue;
    const cles = (await resume(o.strat, o.bkp)).cles;
    for (const cle of clesDuLancement) {
      if (!cles.has(cle) || !cleValable(cle)) continue;
      ajouter(cle, GRAVITE.CORRIGER, "Lancée deux fois", `Aussi dans ${nomDe(o)}`, "Autres lancements de la semaine");
      deuxFois.set(nomDe(o), (deuxFois.get(nomDe(o)) || 0) + 1);
    }
  }
  bilan.push(deuxFois.size
    ? { statut: "alerte", controle: "Autres lancements de la semaine", texte: `Pièces aussi lancées ailleurs : ${[...deuxFois].map(([nom, n]) => `${n} dans ${nom}`).join(", ")}.` }
    : { statut: "ok", controle: "Autres lancements de la semaine", texte: "Aucune pièce de ce lancement n'est dans un autre lancement de la semaine." });

  // Pièces déjà lancées dans l'autre onglet semaine ; la casse a sa propre analyse (relancées / rajouts).
  const autresLancements = pairesDeLaSemaine(autre).filter((o) => o.strat);
  if (p.poste === "Casse") {
    const r = await calculerCasse(p, pairesDeLaSemaine(autre), numeroSemaine(autre));
    if (r.erreur) bilan.push({ statut: "alerte", controle: "Casse", texte: `Casse illisible : ${r.erreur}` });
    else if (r.autreSemaineChargee)
      bilan.push({ statut: "info", controle: "Casse", texte: `Pour séparer les pièces relancées des rajouts, chargez la semaine ${r.semaineAvant || "d'avant"} dans l'autre onglet, ou ajoutez les semaines d'avant à la bibliothèque.` });
    else {
      // Une pièce de casse déjà lancée avant, c'est normal (elle est refaite) : pour info, pas un problème.
      bilan.push({ statut: "ok", controle: "Casse",
        texte: r.dejaLancees.length
          ? `${r.dejaLancees.length} pièce(s) relancée(s) (déjà lancées ${libelleSemaines(r.dejaLancees.map((t) => t.semaine))}) et ${r.rajouts.length} rajout(s).`
          : `Aucune pièce relancée (rien ${r.periode}) : ${r.rajouts.length} rajout(s).` });
      for (const t of r.dejaLancees) ajouter(t.ligne.cle, GRAVITE.INFO, "Casse : relancée", `Déjà lancée en semaine ${t.semaine} dans ${t.lancement}`, "Casse");
      for (const l of r.rajouts) ajouter(l.cle, GRAVITE.INFO, "Casse : rajout", `Pas lancée ${r.periode}`, "Casse");
    }
  } else if (!autresLancements.length)
    bilan.push({ statut: "info", controle: `Déjà lancée en ${libelleOnglet(autre)}`, texte: `Aucun lancement chargé en ${libelleOnglet(autre)} : pas de comparaison.` });
  else {
    let n = 0;
    for (const o of autresLancements) {
      if (o.poste === "Casse") continue;
      const cles = (await resume(o.strat, o.bkp)).cles;
      for (const cle of clesDuLancement) {
        if (!cles.has(cle) || cle.length <= 3) continue;
        ajouter(cle, GRAVITE.VERIFIER, "Déjà lancée la semaine d'avant", `Déjà dans ${libelleOnglet(autre)} : ${nomDe(o)}`, `Déjà lancée en ${libelleOnglet(autre)}`);
        n++;
      }
    }
    bilan.push(n
      ? { statut: "attention", controle: `Déjà lancée en ${libelleOnglet(autre)}`, texte: `${n} pièce(s) déjà dans un lancement de ${libelleOnglet(autre)}.` }
      : { statut: "ok", controle: `Déjà lancée en ${libelleOnglet(autre)}`, texte: `Aucune pièce déjà lancée en ${libelleOnglet(autre)}.` });
  }

  // Diakonos : chaque pièce commandée doit être dans un des lancements comparés.
  const semaine = pairesDeLaSemaine(p.parite);
  const toutes = [...semaine, ...pairesDeLaSemaine(autre)];
  const groupe = groupeDiakonosDossier(p);
  const diakonos = diakonosDeLaCase(p);
  let rd = null;
  if (groupe) rd = await calculerDiakonosDossier(groupe, toutes);
  else if (diakonos && diakonos.strat) rd = await calculerDiakonos(diakonos, String(numeroSemaine(p.parite)).padStart(2, "0"), semaine, toutes);
  if (rd && groupe && groupe.porteur !== p) {
    bilan.push({ statut: "info", controle: "Diakonos", texte: `Le Diakonos du dossier (${rd.fichier}) est contrôlé dans le rapport de ${titreCase(groupe.porteur)}.` });
    rd = null;
  } else if (!rd) bilan.push({ statut: "info", controle: "Diakonos", texte: "Pas de fichier Diakonos pour ce lancement." });
  else if (rd.erreur) bilan.push({ statut: "alerte", controle: "Diakonos", texte: `Diakonos illisible : ${rd.erreur}` });
  else {
    const portee = porteeDiakonos(rd);
    if (!rd.lancements.length) bilan.push({ statut: "attention", controle: "Diakonos", texte: `${portee.aucun}.` });
    else if (!rd.manquantes.length) bilan.push({ statut: "ok", controle: "Diakonos", texte: `Les ${rd.nbPieces} pièces commandées sont ${portee.dans}.` });
    else {
      const lanceesAilleurs = rd.manquantes.filter((m) => rd.ailleurs.has(m.cle));
      const ou = [...new Set(lanceesAilleurs.map((m) => rd.ailleurs.get(m.cle)))].join(", ");
      const nulle = rd.manquantes.length - lanceesAilleurs.length;
      // Lancée dans un autre lancement de la semaine (chantier extrait du lancement) : bonne, juste précisée.
      const precision = lanceesAilleurs.length ? ` (dont ${lanceesAilleurs.length} dans ${ou})` : "";
      bilan.push(
        nulle
          ? { statut: "alerte", controle: "Diakonos", texte: `${nulle} pièce(s) commandée(s) dans aucun lancement chargé (sur ${rd.nbPieces})${precision}.` }
          : { statut: "ok", controle: "Diakonos", texte: `Les ${rd.nbPieces} pièces commandées sont lancées${precision}.` }
      );
    }
    for (const m of rd.manquantes) {
      const ailleurs = rd.ailleurs.get(m.cle);
      dehors({
        cle: m.cle,
        article: m.article,
        dimensions: dimensionsDiakonos(m),
        coloris: m.coloris,
        type: "Commandée, pas lancée (Diakonos)",
        detail: `Absente ${portee.de}${ailleurs ? ` ; elle est dans ${ailleurs}` : ""}`,
        diakonos: true,
        controle: "Diakonos",
        porteeDe: portee.de,
        porteeDans: portee.dans,
        ailleurs,
      });
    }
  }
  for (const h of hors) {
    if (!h.type.startsWith("En trop")) continue;
    for (const o of toutes) {
      if (o === p || !o.strat || !(await resume(o.strat, o.bkp)).cles.has(h.cle)) continue;
      h.ailleurs = o.strat.name;
      break;
    }
  }
  return { parCle, hors: diagnostiquerHors(hors), bilan, diakonos: groupe && groupe.porteur !== p ? null : rd };
}

// Une pièce hors du lancement peut être signalée par plusieurs contrôles (en trop dans la liste de coupe, en trop
// dans le .bkp, commandée dans le Diakonos) : un seul constat par pièce, qui dit tout.
function diagnostiquerHors(hors) {
  const parCle = new Map();
  for (const h of hors) parCle.set(h.cle, [...(parCle.get(h.cle) || []), h]);
  const resultat = [];
  for (const [cle, liste] of parCle) {
    const decrite = liste.find((h) => h.article) || liste[0];
    const controle = (liste.find((h) => h.type.startsWith("En trop")) || liste[0]).controle;
    const piece = { cle, article: decrite.article || "", dimensions: decrite.dimensions || "", coloris: decrite.coloris || "", controle };
    const enTrop = liste.filter((h) => h.type.startsWith("En trop"));
    const diakonos = liste.find((h) => h.diakonos);
    const ailleurs = (enTrop.find((h) => h.ailleurs) || {}).ailleurs || (diakonos && diakonos.ailleurs);
    if (enTrop.length && ailleurs) {
      // Débitée ici alors qu'elle est lancée ailleurs : elle serait débitée deux fois.
      const ou = enTrop.map((h) => h.type.replace("En trop dans ", "")).join(" et ");
      resultat.push({ ...piece, gravite: GRAVITE.CORRIGER, type: "Débitée ici, lancée ailleurs", detail: `Dans ${ou} de ce lancement, mais lancée dans ${ailleurs} : risque de la débiter deux fois` });
    } else if (enTrop.length) {
      const ou = enTrop.map((h) => h.type.replace("En trop dans ", "") + (h.quantite ? ` (${h.quantite})` : "")).join(" et ");
      resultat.push({
        ...piece,
        gravite: GRAVITE.CORRIGER,
        type: "Débitée, mais pas dans le lancement",
        detail: diakonos
          ? `Dans ${ou}, et commandée (Diakonos), mais absente du fichier de lancement : le lancement est incomplet`
          : `Dans ${ou}, mais pas dans le fichier de lancement`,
      });
    } else if (diakonos && diakonos.ailleurs) {
      // Commandée ici, lancée dans un autre lancement de la semaine : bonne (chantier extrait du lancement).
    } else if (diakonos) resultat.push({ ...piece, controle: "Diakonos", gravite: GRAVITE.CORRIGER, type: "Commandée, pas lancée (Diakonos)", detail: `Absente ${diakonos.porteeDe} et des autres lancements chargés` });
    else resultat.push(...liste);
  }
  return resultat;
}

// Charte Laisné Industrie pour les rapports de problèmes.
const CHARTE_RAPPORT = {
  BORDEAUX: "FF78140C",
  NOIR: "FF22231D",
  GRIS: "FF797978",
  COULEURS: {
    ok: { fond: "FFE3F1E4", texte: "FF2E7D32", libelle: "✔ OK", symbole: "✔" },
    alerte: { fond: "FFF9D9D4", texte: "FFC62828", libelle: "⚠ Problème", symbole: "⚠" },
    attention: { fond: "FFFFF1CC", texte: "FFB45309", libelle: "⚠ À vérifier", symbole: "⚠" },
    info: { fond: "FFF4F3F1", texte: "FF797978", libelle: "— Info", symbole: "—" },
  },
};
const fondRapport = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const MISE_EN_PAGE_RAPPORT = (pied) => ({
  views: [{ showGridLines: false }],
  pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  headerFooter: { oddFooter: `&L${pied} — LAISNÉ INDUSTRIE, document interne&RPage &P / &N` },
});

// ---- Problème validé (« c'est voulu ») : il ne compte plus, nulle part (case, tableau, rapports, téléphone) ----
// Gardé dans ce PC (et dans la bibliothèque, d'où il revient s'il le faut), par lancement, pièce et problème.

const CLE_VALIDATIONS = "sentinelle-problemes-valides";
let validationsProblemes = null; // clé → { date }

function lesValidations() {
  if (validationsProblemes) return validationsProblemes;
  validationsProblemes = new Map();
  try {
    for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(CLE_VALIDATIONS) || "{}"))) if (v && v.date) validationsProblemes.set(k, v);
  } catch (_e) {
    // stockage indisponible : les validations de la bibliothèque restent
  }
  return validationsProblemes;
}

function enregistrerValidations() {
  try {
    localStorage.setItem(CLE_VALIDATIONS, JSON.stringify(Object.fromEntries(lesValidations())));
  } catch (_e) {
    // stockage indisponible
  }
}

const baseDuLancement = (p) => (p && p.strat ? p.strat.name.replace(/\.[^.]*$/, "") : "");
// « Lancée deux fois » se valide pour les deux lancements à la fois.
const cleValidation = (base, cle, type) => (type === "Lancée deux fois" ? `*|${cle}|${type}` : `${base}|${cle}|${type}`);
const validationDe = (base, e) => lesValidations().get(cleValidation(base, e.cle, e.type)) || null;

function validerProbleme(base, e, oui) {
  const k = cleValidation(base, e.cle, e.type);
  if (oui) lesValidations().set(k, { date: new Date().toISOString() });
  else lesValidations().delete(k);
  enregistrerValidations();
}

// Les validations gardées dans la bibliothèque (autre navigateur, stockage effacé) reviennent sur ce PC.
function validationsDepuisBibliotheque(semaines) {
  let ajout = false;
  for (const s of semaines || [])
    for (const l of s.lancements || [])
      for (const e of l.problemes || []) {
        if (!e.valide || !e.cle || !e.type) continue;
        const k = cleValidation(l.nom, e.cle, e.type);
        if (lesValidations().has(k)) continue;
        lesValidations().set(k, { date: e.valide });
        ajout = true;
      }
  if (ajout) enregistrerValidations();
}

const dateValidation = (v) => (v && v.date ? new Date(v.date).toLocaleDateString("fr-FR") : "");

// Les problèmes d'un lancement, une ligne par pièce et par problème, avec ce que dit le fichier de lancement de la
// pièce. Gardés dans la case (p.analyse) : une validation s'applique ensuite sans tout relire.
async function analyserLancement(p) {
  const { parCle, hors, bilan, diakonos } = await problemesDuLancement(p);
  const classeur = await classeurEnCache(p.strat);
  const { feuille, entetes } = trouverFeuilleEtEntetes(classeur);
  const doublons = doublonsLancement(classeur).lignes;
  const colonne = (r, nom) => {
    const v = entetes[nom] ? cellValue(feuille.getRow(r).getCell(entetes[nom])) : null;
    return v === null || v === undefined ? "" : v;
  };

  // Les lignes du lancement, avec leurs problèmes.
  const cleDeLigne = (r) => {
    const commande = String(colonne(r, COL_COMMANDE)).trim();
    if (!commande) return null;
    const cleColonne = String(colonne(r, COL_CLE)).trim();
    return cleColonne || cleLigne(commande, entetes[COL_LIGNE] ? colonne(r, COL_LIGNE) : null);
  };
  const protection = (r) => estProtection(colonne(r, COL_AGGLO));
  // Les problèmes d'une pièce vont sur ses vraies lignes ; sur ses lignes de protection seulement si elle n'a qu'elles.
  const clesAvecPiece = new Set();
  for (let r = 2; r <= (feuille.rowCount || 0); r++) if (cleDeLigne(r) && !protection(r)) clesAvecPiece.add(cleDeLigne(r));

  // Une ligne du rapport par pièce et par problème (les lignes Excel d'une même pièce regroupées).
  const dimensions = (r) => [colonne(r, "conf_longueur"), colonne(r, "conf_largeur"), colonne(r, "conf_epaisseur")].filter((v) => v !== "").join(" × ");
  const joindre = (valeurs) => [...new Set(valeurs.map(String).filter(Boolean))].join(" / ");
  const parProbleme = new Map();
  for (let r = 2; r <= (feuille.rowCount || 0); r++) {
    const cle = cleDeLigne(r);
    if (!cle) continue;
    const liste = protection(r) && clesAvecPiece.has(cle) ? [] : [...(parCle.get(cle) || [])];
    if (doublons.has(r)) liste.unshift({ gravite: GRAVITE.CORRIGER, type: "Ligne en double", detail: "Identique à une ligne au-dessus : la retirer", controle: "Lignes en double" });
    for (const x of liste) {
      const id = `${cle}|${x.type}|${x.detail}`;
      if (!parProbleme.has(id)) parProbleme.set(id, { ...x, cle, rangs: [] });
      parProbleme.get(id).rangs.push(r);
    }
  }
  const pieces = [...parProbleme.values()].map((e) => ({
    ...e,
    article: joindre(e.rangs.map((r) => colonne(r, COL_ARTICLE))),
    dimensions: joindre(e.rangs.map(dimensions)),
    coloris: joindre(e.rangs.map((r) => {
      const dessus = String(colonne(r, "coloris"));
      const dessous = String(colonne(r, "coloris_inf"));
      return dessous && dessous !== dessus ? `${dessus} / ${dessous}` : dessus;
    })),
    quantite: joindre(e.rangs.map((r) => colonne(r, COL_QTE))),
    lignes: e.rangs.join(", "),
  }));
  for (const h of hors) pieces.push({ ...h, quantite: h.quantite || "", lignes: "hors lancement", rangs: [Infinity] });
  p.analyse = { base: baseDuLancement(p), strat: p.strat, pieces, bilan, diakonos };
  return p.analyse;
}

// L'analyse avec les validations : les problèmes à traiter, les validés, et le bilan des contrôles (un contrôle dont
// tous les problèmes sont validés est OK).
function etatAnalyse(a) {
  const valides = [];
  const restants = [];
  for (const e of a.pieces) {
    const v = e.gravite > GRAVITE.INFO ? validationDe(a.base, e) : null;
    if (v) valides.push({ ...e, validation: v });
    else restants.push(e);
  }
  const aTraiter = restants.filter((e) => e.gravite > GRAVITE.INFO);
  const nbCorriger = aTraiter.filter((e) => e.gravite === GRAVITE.CORRIGER).length;
  const bilan = a.bilan.map((b) => {
    if (b.statut !== "alerte" && b.statut !== "attention") return b;
    const n = valides.filter((e) => e.controle === b.controle).length;
    if (!n) return b;
    const reste = aTraiter.some((e) => e.controle === b.controle);
    return { ...b, statut: reste ? b.statut : "ok", texte: `${b.texte} ${reste ? `(${n} validé(s) OK)` : `Validé OK (${n}).`}` };
  });
  return { restants, aTraiter, valides, nbCorriger, nbVerifier: aTraiter.length - nbCorriger, bilan };
}

// L'analyse de la case si elle vaut pour son fichier de lancement actuel, avec les validations ; sinon null.
const analyseDeLaCase = (p) => (p && p.strat && p.analyse && p.analyse.strat === p.strat ? etatAnalyse(p.analyse) : null);

// Problèmes d'un contrôle (« Scies (.bkp) »…) encore à traiter : null si l'analyse ne dit rien de ce contrôle.
function restantsDuControle(p, test) {
  const a = analyseDeLaCase(p);
  if (!a) return null;
  const total = a.aTraiter.filter((e) => test(e.controle || "")).length + a.valides.filter((e) => test(e.controle || "")).length;
  return total ? a.aTraiter.filter((e) => test(e.controle || "")).length : null;
}
const estControleListe = (c) => c.startsWith("Lancement /");
const estControleScies = (c) => c === "Scies (.bkp)";
const estControleCouleurs = (c) => c === "Couleurs (.bkp)";
const estControlePlans = (c) => c === "Plans de coupe (.bkp)";

// Les bilans de tous les lancements de l'onglet (sans fichier à enregistrer), pour la bibliothèque.
async function bilansDeLOnglet(parite) {
  const wb = new ExcelJS.Workbook();
  const pris = new Set();
  const lancements = [];
  for (const p of pairesDeLaSemaine(parite)) {
    if (!p.strat) continue;
    try {
      lancements.push({ p, ...(await feuilleRapportLancement(wb, p, nomFeuilleExcel(titreCase(p), pris))) });
    } catch (erreur) {
      lancements.push({ p, erreur: erreur && erreur.message ? erreur.message : String(erreur), bilan: [], nbCorriger: 0, nbVerifier: 0, problemes: [] });
    }
  }
  return lancements;
}

// Écrit le rapport des problèmes d'un lancement dans une nouvelle feuille du classeur ; renvoie son bilan.
async function feuilleRapportLancement(wb, p, nomFeuille) {
  const analyse = await analyserLancement(p);
  const { diakonos } = analyse;
  const { restants: pieces, aTraiter, valides, nbCorriger, nbVerifier, bilan } = etatAnalyse(analyse);

  // Regroupées par problème, dans l'ordre du rapport (les plus graves d'abord).
  const groupes = new Map();
  for (const e of pieces) {
    if (!groupes.has(e.type)) groupes.set(e.type, []);
    groupes.get(e.type).push(e);
  }
  const ordre = [...groupes.keys()].sort(
    (a, b) => Math.max(...groupes.get(b).map((e) => e.gravite)) - Math.max(...groupes.get(a).map((e) => e.gravite)) || (RANG_PROBLEME.get(a) ?? 99) - (RANG_PROBLEME.get(b) ?? 99)
  );
  for (const type of ordre) groupes.get(type).sort((a, b) => a.rangs[0] - b.rangs[0] || a.cle.localeCompare(b.cle));

  // Mise en page : une feuille A4 paysage, lue de haut en bas.
  const { BORDEAUX, NOIR, GRIS, COULEURS } = CHARTE_RAPPORT;
  const STATUT_GRAVITE = { [GRAVITE.CORRIGER]: "alerte", [GRAVITE.VERIFIER]: "attention", [GRAVITE.INFO]: "info" };
  const LARGEURS = [14, 21, 18, 21, 10, 6, 50, 12]; // À faire, pièce, article, dimensions, coloris, qté, explication, lignes
  const NB = LARGEURS.length;
  const fond = fondRapport;
  const filet = { style: "thin", color: { argb: "FFE9E7E3" } };
  const bordure = { top: filet, bottom: filet, left: filet, right: filet };
  // Hauteur d'une ligne d'après la longueur du texte (Excel ne l'ajuste pas tout seul sur les cellules fusionnées).
  const hauteur = (texte, largeur) => Math.max(18, 15 * String(texte).split("\n").reduce((t, l) => t + Math.max(1, Math.ceil((l.length * 1.25) / largeur)), 0) + 4);
  const largeurDe = (de, a) => LARGEURS.slice(de - 1, a).reduce((t, l) => t + l, 0);

  const base = p.strat.name.replace(/\.[^.]*$/, "");
  const f = wb.addWorksheet(nomFeuille, MISE_EN_PAGE_RAPPORT(base));
  LARGEURS.forEach((l, i) => (f.getColumn(i + 1).width = l));
  // Une ligne de texte sur toute la largeur.
  const bandeau = (texte, police, options = {}) => {
    const ligne = f.addRow([texte]);
    f.mergeCells(ligne.number, 1, ligne.number, NB);
    const c = ligne.getCell(1);
    c.font = { name: "Lato", ...police };
    c.alignment = { vertical: "middle", wrapText: true, indent: options.indent || 0 };
    if (options.fond) c.fill = fond(options.fond);
    if (options.bordureGauche) c.border = { left: { style: "thick", color: { argb: options.bordureGauche } } };
    ligne.height = options.hauteur || hauteur(texte, largeurDe(1, NB));
    return ligne;
  };
  const titreSection = (texte) => {
    f.addRow([]);
    bandeau(texte, { bold: true, size: 12, color: { argb: "FFFFFFFF" } }, { fond: BORDEAUX, hauteur: 22, indent: 1 });
  };

  // En-tête.
  bandeau(`${titreCase(p)} — ${base}`, { name: "Raleway", bold: true, size: 18, color: { argb: BORDEAUX } }, { hauteur: 30 });
  bandeau(`Rapport de contrôle du lancement · semaine ${numeroSemaine(p.parite)} · ${new Date().toLocaleDateString("fr-FR")} · LAISNÉ INDUSTRIE — document interne`,
    { italic: true, color: { argb: GRIS } });
  const comptes = await resume(p.strat, p.bkp);
  bandeau(`${nombrePieces(comptes.prevues)} pièces prévues${p.bkp ? ` · ${nombrePieces(comptes.bkp)} dans le .bkp` : ""}`, { bold: true, color: { argb: NOIR } });
  const resumeTexte = (!aTraiter.length
    ? valides.length ? "Aucun problème à traiter." : "Aucun problème trouvé."
    : `${nbCorriger ? `${nbCorriger} problème(s) à corriger${nbVerifier ? `, ${nbVerifier} à vérifier` : ""}` : `${nbVerifier} problème(s) à vérifier`}. Le détail des pièces est plus bas.`) +
    (valides.length ? ` ${valides.length} problème(s) validé(s) OK (voulu).` : "");
  const tete = !aTraiter.length ? COULEURS.ok : nbCorriger ? COULEURS.alerte : COULEURS.attention;
  bandeau(resumeTexte, { bold: true, size: 13, color: { argb: tete.texte } }, { fond: tete.fond, hauteur: 26, indent: 1 });

  // 1. Bilan des contrôles.
  titreSection("1. Bilan des contrôles");
  for (const b of bilan) {
    const ligne = f.addRow([COULEURS[b.statut].libelle, b.controle, "", b.texte]);
    f.mergeCells(ligne.number, 2, ligne.number, 3);
    f.mergeCells(ligne.number, 4, ligne.number, NB);
    ligne.eachCell({ includeEmpty: true }, (c, n) => {
      c.font = { name: "Lato", bold: n <= 2, color: { argb: n === 1 ? COULEURS[b.statut].texte : NOIR } };
      c.alignment = { vertical: "middle", wrapText: true };
      c.border = bordure;
    });
    ligne.getCell(1).fill = fond(COULEURS[b.statut].fond);
    ligne.height = Math.max(hauteur(b.texte, largeurDe(4, NB)), hauteur(b.controle, largeurDe(2, 3)));
  }

  // 2. Détail des pièces, problème par problème.
  titreSection(aTraiter.length || pieces.length || valides.length ? "2. Détail des pièces à problème" : "2. Détail des pièces : aucune pièce à problème");
  if (pieces.length || valides.length) {
    const entete = f.addRow(["À faire", "Pièce (commande + ligne)", "Article", "Dimensions (L × l × ép.)", "Coloris (dessus / dessous)", "Qté", "Explication", "Ligne(s) Excel du lancement"]);
    entete.eachCell((c) => {
      c.font = { name: "Lato", bold: true, size: 9, color: { argb: BORDEAUX } };
      c.alignment = { vertical: "bottom", wrapText: true };
      c.border = { bottom: { style: "medium", color: { argb: BORDEAUX } } };
    });
    entete.height = 42;
    for (const type of ordre) {
      const liste = groupes.get(type);
      const statut = STATUT_GRAVITE[Math.max(...liste.map((e) => e.gravite))];
      f.addRow([]).height = 8;
      bandeau(`${type} — ${liste.length} pièce(s)`, { bold: true, size: 11, color: { argb: COULEURS[statut].texte } },
        { fond: COULEURS[statut].fond, bordureGauche: COULEURS[statut].texte, hauteur: 20, indent: 1 });
      if (SENS_PROBLEME.has(type)) {
        const { sens, queFaire } = SENS_PROBLEME.get(type);
        const ligne = bandeau(`${sens}${queFaire ? ` Que faire : ${queFaire}` : ""}`, { size: 9, color: { argb: GRIS } }, { indent: 1 });
        ligne.getCell(1).value = {
          richText: [
            { text: `${sens}${queFaire ? " " : ""}`, font: { name: "Lato", italic: true, size: 9, color: { argb: GRIS } } },
            ...(queFaire ? [{ text: "Que faire : ", font: { name: "Lato", bold: true, size: 9, color: { argb: NOIR } } }, { text: queFaire, font: { name: "Lato", size: 9, color: { argb: NOIR } } }] : []),
          ],
        };
      }
      for (const e of liste) {
        const ligne = f.addRow([A_FAIRE[e.gravite], e.cle, e.article, e.dimensions, e.coloris, e.quantite, e.detail, e.lignes]);
        ligne.eachCell({ includeEmpty: true }, (c, n) => {
          c.font = { name: "Lato", bold: n === 2, color: { argb: n === 1 ? COULEURS[STATUT_GRAVITE[e.gravite]].texte : NOIR } };
          c.alignment = { vertical: "top", wrapText: true };
          c.border = bordure;
        });
        ligne.height = Math.max(hauteur(e.detail, LARGEURS[6]), hauteur(e.dimensions, LARGEURS[3]), hauteur(e.lignes, LARGEURS[7]));
      }
    }
    // Les problèmes validés « c'est voulu » : gardés pour mémoire, ils ne comptent plus.
    if (valides.length) {
      f.addRow([]).height = 8;
      bandeau(`Validé OK (voulu) — ${valides.length} pièce(s)`, { bold: true, size: 11, color: { argb: COULEURS.ok.texte } },
        { fond: COULEURS.ok.fond, bordureGauche: COULEURS.ok.texte, hauteur: 20, indent: 1 });
      for (const e of valides) {
        const detail = `${e.type} : ${e.detail}`;
        const ligne = f.addRow([`Validé le ${dateValidation(e.validation)}`, e.cle, e.article, e.dimensions, e.coloris, e.quantite, detail, e.lignes]);
        ligne.eachCell({ includeEmpty: true }, (c, n) => {
          c.font = { name: "Lato", bold: n === 2, color: { argb: n === 1 ? COULEURS.ok.texte : NOIR } };
          c.alignment = { vertical: "top", wrapText: true };
          c.border = bordure;
        });
        ligne.height = Math.max(hauteur(detail, LARGEURS[6]), hauteur(e.dimensions, LARGEURS[3]), hauteur(e.lignes, LARGEURS[7]));
      }
    }
  }

  // 3. Fichiers comparés.
  titreSection("3. Fichiers comparés");
  const fichiers = [
    ["Lancement", p.strat && p.strat.name],
    ["Liste de coupe", p.coupe ? p.coupe.name : "—"],
    ["Optimisation (.bkp)", p.bkp ? p.bkp.name : "—"],
    ["Diakonos", diakonos && diakonos.fichier ? `${diakonos.fichier}${diakonos.lancements && diakonos.lancements.length ? ` — comparé à ${diakonos.lancements.join(", ")}` : ""}` : "—"],
  ];
  for (const [nom, valeur] of fichiers) {
    const ligne = f.addRow(["", nom, "", valeur]);
    f.mergeCells(ligne.number, 2, ligne.number, 3);
    f.mergeCells(ligne.number, 4, ligne.number, NB);
    ligne.getCell(2).font = { name: "Lato", bold: true, color: { argb: GRIS } };
    ligne.getCell(4).font = { name: "Lato", color: { argb: NOIR } };
    ligne.getCell(4).alignment = { wrapText: true, vertical: "top" };
    ligne.height = hauteur(valeur, largeurDe(4, NB));
  }

  // Le détail, dans l'ordre du rapport, pour le fichier partagé (l'appli Android l'affiche).
  const NIVEAU = { [GRAVITE.CORRIGER]: "corriger", [GRAVITE.VERIFIER]: "verifier", [GRAVITE.INFO]: "info" };
  const texte = (v) => (v === null || v === undefined ? "" : String(v));
  const ligneDetail = (e) => ({
    niveau: e.validation ? "valide" : NIVEAU[e.gravite], type: e.type, cle: e.cle, article: texte(e.article), dimensions: texte(e.dimensions), coloris: texte(e.coloris),
    quantite: texte(e.quantite), detail: texte(e.detail), lignes: texte(e.lignes), ...(e.validation ? { valide: e.validation.date } : {}),
  });
  const details = [...ordre.flatMap((type) => groupes.get(type)), ...valides].map(ligneDetail);
  return { base, bilan, nbCorriger, nbVerifier, nbValides: valides.length, details, problemes: aTraiter.map((e) => ({ id: `${e.cle}|${e.type}`, gravite: e.gravite })) };
}

async function problemesLancementXlsx(p) {
  const wb = new ExcelJS.Workbook();
  const { base, nbCorriger, nbVerifier } = await feuilleRapportLancement(wb, p, "Rapport");
  return { nom: `${base}_problemes.xlsx`, octets: new Uint8Array(await wb.xlsx.writeBuffer()), nbProblemes: nbCorriger + nbVerifier };
}

// Nom de feuille Excel : 31 caractères au plus, sans : \ / ? * [ ], unique dans le classeur.
function nomFeuilleExcel(texte, pris) {
  const propre = String(texte).replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "Feuille";
  let nom = propre;
  for (let i = 2; pris.has(nom.toLowerCase()); i++) nom = `${propre.slice(0, 27)} (${i})`;
  pris.add(nom.toLowerCase());
  return nom;
}

// Nombre de pièces affiché (« ? » si le fichier est illisible).
const nombrePieces = (v) => (v === null || v === undefined || Number.isNaN(v) ? "?" : fmtNombre(Math.trunc(v)));

// Rapport de la semaine : une synthèse (un lancement par ligne avec son nombre de pièces, un contrôle par colonne,
// lien vers son onglet ; puis le bilan de la semaine : pièces, lancées deux fois, casse), puis le rapport de chaque
// lancement dans son onglet.
async function rapportSemaineXlsx(parite, options = {}) {
  const { BORDEAUX, NOIR, GRIS, COULEURS } = CHARTE_RAPPORT;
  const titre = libelleOnglet(parite);
  const wb = new ExcelJS.Workbook();
  const pris = new Set();
  const f = wb.addWorksheet(nomFeuilleExcel(`${titre} — synthèse`, pris), MISE_EN_PAGE_RAPPORT(titre));
  const lancements = [];
  for (const p of pairesDeLaSemaine(parite)) {
    if (!p.strat) continue;
    const nom = nomFeuilleExcel(titreCase(p), pris);
    try {
      lancements.push({ p, nom, ...(await feuilleRapportLancement(wb, p, nom)) });
    } catch (erreur) {
      // Lancement illisible : une ligne dans la synthèse, les autres lancements ont leur rapport.
      const message = erreur && erreur.message ? erreur.message : String(erreur);
      lancements.push({ p, nom: null, base: p.strat.name.replace(/\.[^.]*$/, ""), erreur: message, bilan: [], nbCorriger: 0, nbVerifier: 0, problemes: [] });
    }
  }
  if (options.seulementSiProbleme && !lancements.some((l) => l.nbCorriger + l.nbVerifier)) return { nbProblemes: 0, lancements };
  for (const l of lancements) {
    const r = await resume(l.p.strat, l.p.bkp);
    l.prevues = r.prevues;
    l.bkp = l.p.bkp ? r.bkp : null;
    l.cles = r.cles;
  }

  const COLONNES = [
    ["Poste", 22, null],
    ["Lancement", 25, null],
    ["Pièces prévues", 9, null],
    ["Pièces .bkp", 9, null],
    ["Liste de coupe", 11, (c) => c.startsWith("Lancement /")],
    ["Scies", 9, (c) => c === "Scies (.bkp)"],
    ["Couleurs", 10, (c) => c === "Couleurs (.bkp)"],
    ["Livraison", 10, (c) => c === "Semaine de livraison"],
    ["Doublons", 10, (c) => c === "Lignes en double"],
    ["Lancée 2 fois", 10, (c) => c === "Autres lancements de la semaine"],
    ["Semaine d'avant / casse", 14, (c) => c === "Casse" || c.startsWith("Déjà lancée en")],
    ["Diakonos", 10, (c) => c === "Diakonos"],
    ["À corriger", 10, null],
    ["À vérifier", 10, null],
  ];
  COLONNES.forEach(([, largeur], i) => (f.getColumn(i + 1).width = largeur));
  const NB = COLONNES.length;
  const bandeau = (texte, police, options = {}) => {
    const ligne = f.addRow([texte]);
    f.mergeCells(ligne.number, 1, ligne.number, NB);
    const c = ligne.getCell(1);
    c.font = { name: "Lato", ...police };
    c.alignment = { vertical: "middle", wrapText: true, indent: options.indent || 0 };
    if (options.fond) c.fill = fondRapport(options.fond);
    ligne.height = options.hauteur || 18;
    return ligne;
  };
  // Une même pièce avec le même problème dans deux lancements (lancée deux fois) compte une fois pour la semaine.
  const parProbleme = new Map();
  for (const l of lancements) for (const x of l.problemes) parProbleme.set(x.id, Math.max(parProbleme.get(x.id) || 0, x.gravite));
  const nbCorriger = [...parProbleme.values()].filter((g) => g === GRAVITE.CORRIGER).length;
  const nbVerifier = parProbleme.size - nbCorriger;
  const avecProblemes = lancements.filter((l) => l.nbCorriger + l.nbVerifier).length;
  const illisibles = lancements.filter((l) => l.erreur).length;
  // Aucun contrôle fait (ni liste de coupe ni .bkp nulle part) : ne pas annoncer « aucun problème ».
  const controlesFaits = lancements.some((l) => l.bilan.some((b) => (b.controle.startsWith("Lancement /") || b.controle === "Scies (.bkp)") && b.statut !== "info"));
  bandeau(`${titre} — rapport de contrôle des lancements`, { name: "Raleway", bold: true, size: 18, color: { argb: BORDEAUX } }, { hauteur: 30 });
  bandeau(`${new Date().toLocaleDateString("fr-FR")} · LAISNÉ INDUSTRIE — document interne`, { italic: true, color: { argb: GRIS } });
  const probleme = nbCorriger + nbVerifier > 0;
  const tete = illisibles || nbCorriger ? COULEURS.alerte : nbVerifier ? COULEURS.attention : controlesFaits ? COULEURS.ok : COULEURS.info;
  bandeau(
    (probleme
      ? `${nbCorriger + nbVerifier} problème(s) dans ${avecProblemes} lancement(s) sur ${lancements.length} : ${nbCorriger} à corriger, ${nbVerifier} à vérifier.`
      : controlesFaits
        ? `Aucun problème dans les ${lancements.length} lancement(s).`
        : `Aucun contrôle fait : il manque les listes de coupe et les .bkp des ${lancements.length} lancement(s).`) +
      (illisibles ? ` ${illisibles} lancement(s) illisible(s).` : ""),
    { bold: true, size: 13, color: { argb: tete.texte } },
    { fond: tete.fond, hauteur: 26, indent: 1 }
  );
  bandeau("Cliquez sur un poste pour ouvrir son rapport (un onglet par lancement, en bas).", { italic: true, size: 9, color: { argb: GRIS } });
  f.addRow([]);
  const entete = f.addRow(COLONNES.map(([nom]) => nom));
  entete.eachCell((c) => {
    c.font = { name: "Lato", bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    c.fill = fondRapport(BORDEAUX);
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  entete.height = 34;
  const filet = { style: "thin", color: { argb: "FFE9E7E3" } };
  for (const l of lancements) {
    const valeurs = COLONNES.map(([nom, , controle]) => {
      if (nom === "Poste") return l.nom ? { text: titreCase(l.p), hyperlink: `#'${l.nom}'!A1` } : titreCase(l.p);
      if (nom === "Lancement") return l.base;
      if (nom === "Pièces prévues") return Number.isNaN(l.prevues) ? "?" : Math.trunc(l.prevues);
      if (nom === "Pièces .bkp") return !l.p.bkp ? "—" : l.bkp === null || Number.isNaN(l.bkp) ? "?" : Math.trunc(l.bkp);
      if (l.erreur) return nom === "Liste de coupe" ? "❌ illisible" : "";
      if (nom === "À corriger") return l.nbCorriger || "";
      if (nom === "À vérifier") return l.nbVerifier || "";
      const b = l.bilan.find((x) => controle(x.controle));
      return b ? COULEURS[b.statut].symbole : "—";
    });
    const ligne = f.addRow(valeurs);
    ligne.height = 20;
    ligne.eachCell({ includeEmpty: true }, (c, n) => {
      const [nom, , controle] = COLONNES[n - 1];
      c.border = { top: filet, bottom: filet, left: filet, right: filet };
      c.alignment = { vertical: "middle", horizontal: n <= 2 ? "left" : nom.startsWith("Pièces") ? "right" : "center" };
      c.font = { name: "Lato", color: { argb: NOIR } };
      if (nom === "Poste") c.font = { name: "Lato", bold: true, underline: Boolean(l.nom), color: { argb: BORDEAUX } };
      if (nom === "À corriger" && l.nbCorriger) c.font = { name: "Lato", bold: true, color: { argb: COULEURS.alerte.texte } };
      if (nom === "À vérifier" && l.nbVerifier) c.font = { name: "Lato", bold: true, color: { argb: COULEURS.attention.texte } };
      if (l.erreur && nom === "Liste de coupe") {
        c.fill = fondRapport(COULEURS.alerte.fond);
        c.font = { name: "Lato", bold: true, color: { argb: COULEURS.alerte.texte } };
        c.note = `Lancement illisible : ${l.erreur}`;
      } else if (controle && !l.erreur) {
        const b = l.bilan.find((x) => controle(x.controle));
        const statut = b ? b.statut : "info";
        c.fill = fondRapport(COULEURS[statut].fond);
        c.font = { name: "Lato", bold: true, color: { argb: COULEURS[statut].texte } };
        if (b) c.note = b.texte;
      }
    });
  }
  const somme = (champ) => lancements.reduce((t, l) => t + (l[champ] === null || Number.isNaN(l[champ]) ? 0 : Math.trunc(l[champ])), 0);
  const avecBkp = lancements.some((l) => l.p.bkp);
  const total = f.addRow(COLONNES.map(([nom]) =>
    nom === "Poste" ? "Total" : nom === "Pièces prévues" ? somme("prevues") : nom === "Pièces .bkp" ? (avecBkp ? somme("bkp") : "—")
      : nom === "À corriger" ? nbCorriger || "" : nom === "À vérifier" ? nbVerifier || "" : ""));
  total.eachCell({ includeEmpty: true }, (c, n) => {
    c.font = { name: "Lato", bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = fondRapport(BORDEAUX);
    c.alignment = { horizontal: n <= 2 ? "left" : COLONNES[n - 1][0].startsWith("Pièces") ? "right" : "center" };
  });
  f.addRow([]);
  const sommeLancements = lancements.reduce((t, l) => t + l.nbCorriger + l.nbVerifier, 0);
  bandeau("✔ OK · ⚠ rouge : à corriger · ⚠ jaune : à vérifier · — : pas de contrôle (fichier manquant). Survolez une case pour lire le bilan." +
    (sommeLancements !== nbCorriger + nbVerifier ? " Total : une pièce lancée dans deux lancements compte une seule fois." : ""),
    { size: 9, color: { argb: GRIS } });

  // Bilan de la semaine : les pièces, les pièces lancées deux fois, les autres semaines de livraison, la casse.
  f.addRow([]);
  bandeau("Bilan de la semaine", { bold: true, size: 12, color: { argb: "FFFFFFFF" } }, { fond: BORDEAUX, hauteur: 22, indent: 1 });
  const ligneBilan = (texte, statut) =>
    bandeau(texte, { bold: statut !== "info", color: { argb: COULEURS[statut].texte === COULEURS.info.texte ? NOIR : COULEURS[statut].texte } },
      { fond: statut === "info" ? null : COULEURS[statut].fond, indent: 1, hauteur: Math.max(20, 15 * Math.ceil(texte.length / 150) + 5) });
  ligneBilan(`Pièces : ${somme("prevues")} prévues dans ${lancements.length} lancement(s)${avecBkp ? `, ${somme("bkp")} dans les .bkp` : ""}.`, "info");
  const groupes = doublonsEntreLancements(new Map(lancements.filter((l) => l.cles).map((l) => [`${titreCase(l.p)} (${l.base})`, l.cles])));
  const nbDeuxFois = groupes.reduce((t, g) => t + g.cles.length, 0);
  if (nbDeuxFois)
    ligneBilan(`${nbDeuxFois} pièce(s) lancée(s) deux fois : ${groupes.map((g) => `${g.cles.join(", ")} (${g.lancements.join(" et ")})`).join(" ; ")}.`, "alerte");
  else ligneBilan("Aucune pièce lancée deux fois.", "ok");
  let nbLivraison = 0;
  for (const l of lancements) {
    const p = l.p;
    if (p.poste === "Casse" || p.semainesLivraison.length <= 1) continue;
    const principale = semainePrincipale(p);
    for (const s of p.semainesLivraison) if (s !== principale) nbLivraison += s.nbPieces;
  }
  if (nbLivraison) ligneBilan(`${nbLivraison} pièce(s) à livrer une autre semaine que leur lancement.`, "attention");
  const autre = ongletPrecedent(parite);
  for (const l of lancements.filter((x) => x.p.poste === "Casse" && !x.erreur)) {
    const r = await calculerCasse(l.p, pairesDeLaSemaine(autre), numeroSemaine(autre));
    const debut = `Casse (${l.base}) : ${nombrePieces(l.prevues)} pièce(s)`;
    if (r.erreur) ligneBilan(`${debut} — illisible : ${r.erreur}`, "alerte");
    else if (r.autreSemaineChargee) ligneBilan(`${debut} — pour compter les pièces déjà lancées, ${messageChargerCasse(r)}.`, "info");
    else
      ligneBilan(`${debut} — ${r.dejaLancees.length} déjà lancée(s)${r.dejaLancees.length ? ` ${libelleSemaines(r.dejaLancees.map((t) => t.semaine))}` : ""}, ${r.rajouts.length} rajout(s)` +
        (r.dejaLancees.length ? ` (détail dans l'onglet « ${l.nom} »).` : "."), "ok");
  }
  return {
    nom: `rapport_sentinelle_${slug(titre)}.xlsx`,
    octets: new Uint8Array(await wb.xlsx.writeBuffer()),
    nbProblemes: nbCorriger + nbVerifier,
    lancements,
  };
}

// Après un contrôle : s'il y a un problème, le rapport des problèmes du lancement est créé tout seul.
async function problemesAutomatiques(p) {
  if (!p.strat) return;
  try {
    const { nom, octets, nbProblemes } = await problemesLancementXlsx(p);
    if (!nbProblemes) return;
    telecharger(nom, octets, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    p.etat = `📊 ${nbProblemes} problème(s) : fichier ${nom} créé`;
    p.etatErreur = false;
    rafraichir(p);
  } catch (_erreur) {
    // Le bouton « Problèmes du lancement » reste là pour réessayer.
  }
}

// Après le scan d'une semaine : un seul fichier, le rapport de la semaine, s'il y a un problème.
// Renvoie { nom, nbProblemes, lancements } (le bilan de chaque lancement part aussi dans la bibliothèque).
async function rapportSemaineAutomatique(parite) {
  try {
    const { nom, octets, nbProblemes, lancements } = await rapportSemaineXlsx(parite, { seulementSiProbleme: true });
    for (const l of lancements) {
      if (l.p.etatErreur) continue; // l'erreur du contrôle reste affichée
      const n = l.nbCorriger + l.nbVerifier;
      if (n) l.p.etat = `📊 ${n} problème(s) : voir l'onglet « ${l.nom} » du rapport ${nom}`;
      else if (l.erreur) {
        l.p.etat = `❌ lancement illisible : ${l.erreur}`;
        l.p.etatErreur = true;
      }
    }
    if (nbProblemes) telecharger(nom, octets, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return { nom, nbProblemes, lancements };
  } catch (_erreur) {
    return { nom: null, nbProblemes: 0, lancements: [] }; // le bouton « Exporter le rapport de la semaine » reste là pour réessayer
  }
}

async function exporterProblemesLancement(p) {
  if (!p.strat) {
    alert(`${titreCase(p)} : ajoutez d'abord le fichier de lancement.`);
    return;
  }
  const { nom, octets } = await problemesLancementXlsx(p);
  telecharger(nom, octets, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
