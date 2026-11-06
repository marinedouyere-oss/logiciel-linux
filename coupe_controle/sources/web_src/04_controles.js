
// ---- Contrôle des couleurs ----
// Chaque coloris demandé par le fichier de lancement (dessus : « coloris »,
// dessous : « coloris_inf ») doit avoir été optimisé dans le .bkp (feuilles
// de stratifié TF pour le dessus, TB pour le dessous). Une couleur oubliée à
// l'optimisation = des pièces sans stratifié.
function controlerCouleurs(lignesStrat, couleursBkp) {
  const demandes = new Map(); // "face|couleur" -> { couleur, face, nbPieces, cles }
  const noter = (couleur, face, cle, qte) => {
    const k = `${face}|${couleur}`;
    if (!demandes.has(k)) demandes.set(k, { couleur, face, nbPieces: 0, cles: [] });
    const a = demandes.get(k);
    a.nbPieces += qte;
    if (cle && !a.cles.includes(cle)) a.cles.push(cle);
  };
  for (const l of lignesStrat) {
    // Toutes les lignes de la pièce : un compact et son support, par exemple, n'ont pas le même coloris.
    const donnees = l.lignesBrutes && l.lignesBrutes.length ? l.lignesBrutes : l.toutesDonnees ? [l.toutesDonnees] : [];
    for (const d of donnees) {
      const qte = toFloatOrNull(d[COL_QTE]) ?? 0;
      const dessus = d.coloris ? String(d.coloris).trim() : "";
      const dessous = d.coloris_inf ? String(d.coloris_inf).trim() : "";
      if (dessus) noter(dessus, "dessus", l.cle, qte);
      if (dessous) noter(dessous, "dessous", l.cle, qte);
    }
  }
  // absentes : aucun panneau de ce coloris ; variantes : pas ce coloris exact, mais sa version PF (« 1136 » ↔ « 1136-PF »).
  const resultat = {
    sansStratifie: false,
    nbCouleurs: new Set([...demandes.values()].map((a) => a.couleur)).size,
    absentes: [],
    variantes: [],
  };
  if (couleursBkp.sansStratifie) {
    resultat.sansStratifie = true;
    return resultat;
  }
  for (const a of demandes.values()) {
    const presentes = a.face === "dessus" ? couleursBkp.dessus : couleursBkp.dessous;
    if (presentes.has(a.couleur)) continue;
    // Un coloris simple (« 1136 ») optimisé en petit format (« 1136-PF ») : voulu, pas un problème. L’inverse (un PF demandé,
    // seul le simple optimisé) reste une couleur absente.
    const versionPf = /-PF$/i.test(a.couleur) ? null : `${a.couleur}-PF`.toUpperCase();
    const variante = versionPf && [...presentes.keys()].find((c) => String(c).toUpperCase() === versionPf);
    if (variante) resultat.variantes.push({ ...a, variante });
    else resultat.absentes.push(a);
  }
  return resultat;
}

// ---- Pièces lancées deux fois ----
// Une clé valable : une commande suivie de son numéro de ligne (pas « 000 »
// d'une ligne sans commande).
function cleValable(cle) {
  return !!cle && cle.length > 3 && /[A-Za-z]/.test(cle.slice(0, -3));
}

// clesParLancement : Map nom affiché -> clés de ses pièces (hors
// protections). Renvoie les groupes de lancements qui partagent des pièces.
function doublonsEntreLancements(clesParLancement) {
  const lancementsParCle = new Map();
  for (const [lancement, cles] of clesParLancement) {
    for (const cle of cles) {
      if (!cleValable(cle)) continue;
      if (!lancementsParCle.has(cle)) lancementsParCle.set(cle, []);
      const l = lancementsParCle.get(cle);
      if (!l.includes(lancement)) l.push(lancement);
    }
  }
  const groupes = new Map();
  for (const [cle, lancements] of lancementsParCle) {
    if (lancements.length < 2) continue;
    const k = lancements.join("\u0001");
    if (!groupes.has(k)) groupes.set(k, { lancements, cles: [] });
    groupes.get(k).cles.push(cle);
  }
  return [...groupes.values()];
}

// ---- Vrai numéro de semaine d'un onglet ----
function bonneParite(semaine, parite) {
  return (semaine % 2 === 0) === (parite === "paire");
}

// Numéro de semaine ISO (comme en France).
function semaineIso(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const jour = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - jour);
  const debutAnnee = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - debutAnnee) / 86400000 + 1) / 7);
}

// Semaine du calendrier : celle en cours si sa parité convient, sinon la suivante.
function semaineCalendrier(aujourdHui, parite) {
  const d = new Date(aujourdHui.getTime());
  for (let i = 0; i < 3; i++) {
    const s = semaineIso(d);
    if (bonneParite(s, parite)) return s;
    d.setDate(d.getDate() + 7);
  }
  return semaineIso(d);
}

// Semaine d'un onglet : la plus fréquente parmi les semaines des lancements
// chargés qui ont la bonne parité (à égalité, la plus grande) ; sans
// lancement, celle du calendrier.
function semaineAffichee(semainesChargees, parite, aujourdHui = new Date()) {
  const nombre = new Map();
  for (const s of semainesChargees) {
    const n = parseInt(String(s ?? "").trim(), 10);
    if (Number.isNaN(n) || n < 1 || n > 53 || !bonneParite(n, parite)) continue;
    nombre.set(n, (nombre.get(n) || 0) + 1);
  }
  let meilleure = -1;
  let meilleurNombre = 0;
  for (const [n, c] of nombre) {
    if (c > meilleurNombre || (c === meilleurNombre && n > meilleure)) {
      meilleure = n;
      meilleurNombre = c;
    }
  }
  return meilleure > 0 ? meilleure : semaineCalendrier(aujourdHui, parite);
}
