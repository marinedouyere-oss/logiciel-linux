
// ---- Scan du dossier partagé ----
// Reconnaît dans le nom de chaque fichier à quel poste, quelle semaine et
// quel lancement il appartient — convention de l'atelier
// "LAN<AA><SS><TT><suffixe>", ex. "LAN264101STRAT.xlsx" : AA = année,
// SS = semaine, TT = tour (01/02, Agglo seulement), suffixe = STRAT (Agglo),
// FENO, CASSE ou autre (Chantiers). Seuls les chiffres du code comptent
// vraiment ; les mots-clés de poste sont cherchés n'importe où dans le nom.
// Le recyclage a sa case, sous l'Agglo 1er tour.
const POSTES_SEMAINE = ["Agglo 1er tour", "Recyclage", "Feno", "Casse", "Agglo 2ème tour"];
const POSTE_CHANTIERS = "Chantiers";
const MOTIF_DATE_SAUVEGARDE = /_\d{4}-\d{2}-\d{2}_\d{3,4}.*$/i;
const MOTIF_STRAT = /STRAT|START/;

function trouverCodeLancement(nomBrut) {
  const nom = nomBrut.replace(MOTIF_DATE_SAUVEGARDE, "");
  const avecMotCle = /\d{4,6}(?=(STRAT|START|FENO|CASSE))/i.exec(nom);
  if (avecMotCle) return avecMotCle[0];
  const groupe6 = /\d{6}/.exec(nom);
  if (groupe6) return groupe6[0];
  const groupe4 = /\d{4}/.exec(nom);
  if (groupe4) return groupe4[0];
  return null;
}

function pariteDeSemaine(code) {
  const semaine = parseInt(code.slice(2, 4), 10);
  if (Number.isNaN(semaine)) return null;
  return semaine % 2 === 0 ? "paire" : "impaire";
}

// La casse porte le numéro de la semaine précédente (LAN2644CASSE est
// fabriquée en semaine 45, avec les lancements de la 45) : elle va dans
// l'onglet de la semaine qui suit son numéro.
function pariteCasse(code) {
  const semaine = parseInt(code.slice(2, 4), 10);
  if (Number.isNaN(semaine)) return pariteDeSemaine(code);
  const suivante = semaine >= 52 ? 1 : semaine + 1;
  return suivante % 2 === 0 ? "paire" : "impaire";
}

// Le nom du chantier (ex. "TRIGANO", "EQUI76") : tout ce qui suit le code.
function extraireSuffixeLancement(nomBrut, code) {
  const nom = nomBrut.replace(MOTIF_DATE_SAUVEGARDE, "");
  const pos = nom.indexOf(code);
  if (pos === -1) return "";
  const m = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9-]+/.exec(nom.slice(pos + code.length));
  return m ? m[0].toUpperCase() : "";
}

function decoderNomFichierPartage(nom) {
  const code = trouverCodeLancement(nom);
  if (!code) return null;
  const tour = code.length === 6 ? code.slice(4, 6) : null;
  const nomMaj = nom.toUpperCase();
  let poste = null;
  if (nomMaj.includes("FENO")) poste = "Feno";
  else if (nomMaj.includes("CASSE")) poste = "Casse";
  else if (nomMaj.includes("RECYCLAGE")) poste = "Recyclage";
  else if (MOTIF_STRAT.test(nomMaj) && tour === "01") poste = "Agglo 1er tour";
  else if (MOTIF_STRAT.test(nomMaj) && tour === "02") poste = "Agglo 2ème tour";
  return {
    code,
    poste,
    suffixe: extraireSuffixeLancement(nom, code),
    parite: pariteDeSemaine(code),
    // Liste de coupe : le nom le dit (CUTRITE / COUPE). Un PDF qui ne le dit
    // pas (ex. récapitulatif des couleurs « LAN264501STRAT.pdf ») n'en est pas une.
    estCutrite: /CUTRITE|COUPE/i.test(nom),
    estBkp: /\.bkp$/i.test(nom),
    estSommaire: estFichierSommaire(nom),
  };
}

// Sommaire Cut Rite : « SOMMAIRE LAN264601START.pdf ».
const estFichierSommaire = (nom) => /SOMMAIRE/i.test(nom) && /\.pdf$/i.test(nom);

// Rôle d'un fichier rattaché à un lancement (null pour un fichier de lancement ou inconnu).
function roleRattache(nom) {
  if (/\.bkp$/i.test(nom)) return "bkp";
  if (estFichierSommaire(nom)) return "sommaire";
  if (/CUTRITE|COUPE/i.test(nom)) return "coupe";
  return null;
}

// Dossier de semaine (« Semaine 46 », « S46 », « SEM 46 », « SEMAINE 46 - 2026 ») : son numéro sur deux chiffres, sinon null.
function semaineDuDossier(nom) {
  const m = /^\s*S(?:EM(?:AINE)?)?\s*\.?\s*0*(\d{1,2})(?!\d)/i.exec(nom || "");
  return m && Number(m[1]) >= 1 && Number(m[1]) <= 53 ? m[1].padStart(2, "0") : null;
}

// Case d'un dossier de lancement (« 1ER TOUR AGGLO », « FENO », « CASSE »…) ; null pour un chantier.
function posteDuDossier(nom) {
  const n = String(nom || "").toUpperCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (n.includes("FENO")) return "Feno";
  if (n.includes("CASSE")) return "Casse";
  if (n.includes("RECYCLAGE")) return "Recyclage";
  if (/(^|\D)1\s*(ERE|ER|E)?\s*TOUR|TOUR\s*0?1(\D|$)/.test(n)) return "Agglo 1er tour";
  if (/(^|\D)2\s*(EME|E|ND)?\s*TOUR|TOUR\s*0?2(\D|$)/.test(n)) return "Agglo 2ème tour";
  return null;
}

// Place d'un fichier dans l'arborescence choisie : la semaine (dossier « Semaine 46 », la racine
// comprise) et le dossier du lancement (celui qui suit la semaine, ou le premier sous-dossier).
function placeDuFichier(f, racine) {
  const chemin = f.chemin || [];
  const segments = [racine || "", ...chemin];
  let i = -1;
  segments.forEach((seg, k) => {
    if (semaineDuDossier(seg)) i = k;
  });
  if (i >= 0) return { semaine: semaineDuDossier(segments[i]), dossier: segments[i + 1] || null };
  return { semaine: null, dossier: chemin[0] || null };
}

// Fichier de lancement : un vrai classeur Excel (pas une copie .bak, ni le
// fichier de verrou « ~$ » d'Excel).
function estFichierDeLancement(nom) {
  const min = nom.toLowerCase();
  if (min.startsWith("~$")) return false;
  return /\.(xlsx|xlsm|xls)$/.test(min);
}

// « STRATBACKUP » → « STRAT » : le mot ajouté par le logiciel d'optimisation ne fait pas partie du nom.
function suffixeSansSauvegarde(suffixe) {
  return suffixe.replace(/(V\d+)?B+ACKUP$/, "");
}

function prefixeCommun(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

// Lancement auquel rattacher une liste de coupe ou un .bkp : même code, puis
// même nom (qualité 3), nom absent (2), nom approchant — faute de frappe
// « STRA », mot ajouté — (1), ou à défaut même poste (0).
function choisirLancement(info, groupes, posteParCode) {
  const candidats = groupes.filter((g) => g.code === info.code);
  if (candidats.length === 0) return null;
  const s = suffixeSansSauvegarde(info.suffixe);
  const exact = candidats.find((g) => g.suffixe === s);
  if (exact) return { groupe: exact, qualite: 3 };
  if (!s) {
    const poste = info.poste || posteParCode.get(info.code);
    const parPoste = candidats.find((g) => g.poste === poste);
    if (parPoste) return { groupe: parPoste, qualite: 2 };
    return candidats.length === 1 ? { groupe: candidats[0], qualite: 2 } : null;
  }
  let meilleur = null;
  let longueur = 0;
  for (const g of candidats) {
    if (!g.suffixe || !(s.startsWith(g.suffixe) || g.suffixe.startsWith(s))) continue;
    const n = prefixeCommun(s, g.suffixe);
    if (n > longueur || (n === longueur && info.poste && g.poste === info.poste)) {
      meilleur = g;
      longueur = n;
    }
  }
  if (meilleur) return { groupe: meilleur, qualite: 1 };
  if (info.poste) {
    const parPoste = candidats.find((g) => g.poste === info.poste);
    if (parPoste) return { groupe: parPoste, qualite: 0 };
  }
  return null;
}

function motCleFenoCasse(nom) {
  const nomMaj = nom.toUpperCase();
  if (nomMaj.includes("FENO")) return "Feno";
  if (nomMaj.includes("CASSE")) return "Casse";
  return null;
}

// Fichier sans code (liste de coupe ou .bkp au nom imprévisible) : rattaché
// par la semaine (2 chiffres) à un lancement du dossier, affiné par un
// mot-clé de poste ou un numéro de tour ; laissé de côté s'il reste ambigu.
function associerFichierSansCode(nom, ancrages) {
  const groupesChiffres = [...nom.matchAll(/\d+/g)].map((m) => m[0]);
  if (groupesChiffres.length === 0) return null;
  const motCle = motCleFenoCasse(nom);
  const candidats = ancrages.filter((a) => groupesChiffres.includes(a.semaine));
  if (candidats.length === 0) return null;
  if (candidats.length === 1) return candidats[0];
  if (motCle) {
    const parMotCle = candidats.find((a) => a.poste === motCle);
    if (parMotCle) return parMotCle;
  }
  const tourTrouve = groupesChiffres.find((g) => g === "01" || g === "02");
  if (tourTrouve) {
    const parTour = candidats.find((a) => (a.poste === "Agglo 1er tour" || a.poste === "Agglo 2ème tour") && a.tour === tourTrouve);
    if (parTour) return parTour;
  }
  return null;
}

// Répartit les fichiers du dossier ({nom, date, entree, chemin}) pour l'onglet pariteScan. Chaque
// lancement peut avoir son sous-dossier (« Semaine 46/1ER TOUR AGGLO/… », « …/FENO/… ») : le dossier
// donne alors la case et y range la liste de coupe, le .bkp, le sommaire et le Diakonos du lancement.
// Les fichiers posés directement dans le dossier de la semaine sont rangés d'après leur nom.
function repartirFichiersDossier(fichiersDossier, pariteScan, racine = "") {
  const res = { nbFichiers: fichiersDossier.length, nonReconnus: [], aucunLancement: false, ignoresAutreSemaine: 0, fixes: [], chantiers: [], diakonos: [] };
  const aPlat = [];
  const parDossier = new Map();
  for (const f of fichiersDossier) {
    const { semaine, dossier } = placeDuFichier(f, racine);
    if (semaine && pariteDuNumeroSemaine(semaine) !== pariteScan) {
      if (estFichierDeLancement(f.nom)) res.ignoresAutreSemaine++;
      continue;
    }
    if (!dossier) {
      f.semaineDossier = semaine;
      aPlat.push(f);
      continue;
    }
    const cle = `${semaine || ""}|${dossier}`;
    if (!parDossier.has(cle)) parDossier.set(cle, { semaine, dossier, fichiers: [] });
    parDossier.get(cle).fichiers.push(f);
  }
  const fichiersDiakonos = [];
  const listeGroupes = groupesAPlat(aPlat, res, fichiersDiakonos);
  // Une casse posée directement dans un dossier « Semaine NN » est la casse de cette semaine (sinon : semaine de son nom + 1).
  for (const g of listeGroupes) {
    g.semaineDossier = (g.strat && g.strat.semaineDossier) || null;
    if (g.poste === "Casse" && g.semaineDossier) g.parite = pariteDuNumeroSemaine(g.semaineDossier);
  }
  for (const d of [...parDossier.values()].sort((a, b) => a.dossier.localeCompare(b.dossier))) {
    listeGroupes.push(...groupesDuDossier(d.dossier, d.semaine, d.fichiers, res, fichiersDiakonos));
  }
  diakonosDesTours(fichiersDiakonos, pariteScan, res);
  res.nonReconnus.sort((a, b) => a.localeCompare(b));
  if (listeGroupes.length === 0) {
    res.aucunLancement = true;
    return res;
  }
  selectionnerCibles(listeGroupes, pariteScan, res);
  return res;
}

const pariteDuNumeroSemaine = (semaine) => (parseInt(semaine, 10) % 2 === 0 ? "paire" : "impaire");

const nouveauGroupe = (poste, info, dossier) => ({
  poste,
  code: info.code,
  suffixe: info.suffixe,
  parite: poste === "Casse" ? pariteCasse(info.code) : info.parite,
  strat: null,
  coupe: null,
  bkp: null,
  sommaire: null,
  diakonos: null,
  dossier,
});

// Fichiers rangés d'après leur seul nom (tous dans le même dossier) ; renvoie les lancements trouvés.
function groupesAPlat(fichiersDossier, res, fichiersDiakonos) {
  const fichiers = [...fichiersDossier].sort((a, b) => a.nom.localeCompare(b.nom));

  const decodes = [];
  const sansCode = [];
  const diakonosDesLancements = [];
  for (const f of fichiers) {
    if (estFichierDiakonos(f.nom) && estFichierDeLancement(f.nom)) {
      const n = decoderNomDiakonos(f.nom);
      if (n.semaine && n.tour) fichiersDiakonos.push(f);
      else diakonosDesLancements.push(f);
      continue;
    }
    const info = decoderNomFichierPartage(f.nom);
    if (info) decodes.push({ f, info });
    else sansCode.push(f);
  }
  const posteParCode = new Map();
  const posteParCodeEtSuffixe = new Map();
  for (const { info } of decodes) {
    if (!info.poste) continue;
    if (!posteParCode.has(info.code)) posteParCode.set(info.code, info.poste);
    posteParCodeEtSuffixe.set(`${info.code}|${info.suffixe}`, info.poste);
  }

  // 1. Les fichiers de lancement (Excel uniquement) font les groupes.
  const groupes = new Map();
  const rattaches = [];
  for (const d of decodes) {
    const { info } = d;
    if (info.estBkp || info.estCutrite || info.estSommaire) {
      rattaches.push(d);
      continue;
    }
    if (!estFichierDeLancement(d.f.nom)) {
      res.nonReconnus.push(d.f.nom);
      continue;
    }
    let poste;
    if (info.poste) poste = info.poste;
    else if (info.suffixe) poste = posteParCodeEtSuffixe.get(`${info.code}|${info.suffixe}`) || POSTE_CHANTIERS;
    else poste = posteParCode.get(info.code) || POSTE_CHANTIERS;
    if (poste !== POSTE_CHANTIERS) {
      // Un second lancement du même poste, au nom différent, devient un chantier.
      const existant = groupes.get(`${poste}|${info.code}`);
      if (existant && info.suffixe && existant.suffixe && existant.suffixe !== info.suffixe) poste = POSTE_CHANTIERS;
    }
    const cleGroupe = poste === POSTE_CHANTIERS ? `${poste}|${info.code}|${info.suffixe}` : `${poste}|${info.code}`;
    if (!groupes.has(cleGroupe)) groupes.set(cleGroupe, nouveauGroupe(poste, info, null));
    // Deux fichiers du même lancement (ex. LAN264601START.xlsx et sa version _corrige) : le plus récent.
    const groupe = groupes.get(cleGroupe);
    if (!groupe.strat || d.f.date >= groupe.strat.date) groupe.strat = d.f;
  }

  // 2. Chaque liste de coupe, chaque .bkp et chaque sommaire rejoint le lancement qui porte le même code.
  const qualiteCoupe = new Map();
  const qualiteBkp = new Map();
  const qualiteSommaire = new Map();
  const listeGroupes = [...groupes.values()];
  for (const d of rattaches) {
    const choix = choisirLancement(d.info, listeGroupes, posteParCode);
    if (!choix) {
      res.nonReconnus.push(d.f.nom);
      continue;
    }
    const role = d.info.estBkp ? "bkp" : d.info.estSommaire ? "sommaire" : "coupe";
    const qualites = role === "bkp" ? qualiteBkp : role === "sommaire" ? qualiteSommaire : qualiteCoupe;
    // Un nom qui correspond exactement l'emporte sur un nom approchant ; à égalité, le dernier (ordre des noms).
    if (qualites.has(choix.groupe) && qualites.get(choix.groupe) > choix.qualite) continue;
    qualites.set(choix.groupe, choix.qualite);
    choix.groupe[role] = d.f;
  }

  const ancrages = listeGroupes.map((g) => ({ poste: g.poste, code: g.code, semaine: g.code.slice(2, 4), tour: g.code.slice(4, 6), groupe: g }));
  for (const f of sansCode) {
    const bkp = /\.bkp$/i.test(f.nom);
    const coupe = /COUPE|CUTRITE/i.test(f.nom);
    const ancrage = bkp || coupe ? associerFichierSansCode(f.nom, ancrages) : null;
    if (!ancrage) {
      res.nonReconnus.push(f.nom);
      continue;
    }
    if (bkp) {
      if (!qualiteBkp.has(ancrage.groupe)) ancrage.groupe.bkp = f;
    } else if (!qualiteCoupe.has(ancrage.groupe)) {
      ancrage.groupe.coupe = f;
    }
  }

  // « LAN264601STARTDIAKONOS.xlsx » : Diakonos du lancement qui porte ce nom.
  for (const f of diakonosDesLancements) {
    const g = groupeDuDiakonos(f.nom, listeGroupes);
    if (!g) res.nonReconnus.push(f.nom);
    else if (!g.diakonos || f.date >= g.diakonos.date) g.diakonos = f;
  }
  return listeGroupes;
}

// Lancement d'un fichier Diakonos « LAN264601FENODIAKONOS.xlsx », « LAN2646CASSE-DIAKONOS.xlsx » (null sinon).
function groupeDuDiakonos(nom, groupes) {
  const base = (n) => n.replace(/\.[^.]*$/, "").toUpperCase();
  const prefixe = base(nom).replace(/[\s_-]*DIAKONOS.*$/, "");
  return groupes.find((g) => g.strat && base(g.strat.nom) === prefixe) || null;
}

// Fichiers Diakonos d'un tour (« diakonos46t1.xlsx ») : le plus récent de chaque tour.
function diakonosDesTours(fichiersDiakonos, pariteScan, res) {
  const diakonosParTour = new Map();
  for (const f of fichiersDiakonos) {
    const n = decoderNomDiakonos(f.nom);
    if (!n.semaine || !n.tour) {
      res.nonReconnus.push(f.nom);
      continue;
    }
    if (pariteDeSemaine(`00${n.semaine}`) !== pariteScan) {
      res.ignoresAutreSemaine++;
      continue;
    }
    const actuel = diakonosParTour.get(n.tour);
    if (actuel && actuel.fichier.date >= f.date) continue;
    diakonosParTour.set(n.tour, { fichier: f, semaine: n.semaine, tour: n.tour });
  }
  res.diakonos.push(...diakonosParTour.values());
}

// Un lancement par poste fixe (le plus récent) et un par chantier ; ceux
// de l'autre semaine sont laissés de côté.
function selectionnerCibles(listeGroupes, pariteScan, res) {
  const ciblesFixes = new Map();
  const ciblesChantiers = new Map();
  for (const g of listeGroupes) {
    if (!g.strat) continue;
    if (g.parite !== pariteScan) {
      res.ignoresAutreSemaine++;
      continue;
    }
    const cibles = g.poste === POSTE_CHANTIERS ? ciblesChantiers : ciblesFixes;
    const cle = g.poste === POSTE_CHANTIERS ? `${g.code}|${g.suffixe}` : `${g.poste}|${g.parite}`;
    const actuel = cibles.get(cle);
    if (!actuel || g.strat.date > actuel.strat.date) cibles.set(cle, { ...g });
  }
  res.fixes.push(...ciblesFixes.values());
  res.chantiers.push(...ciblesChantiers.values());
}

// Un dossier de lancement (« 1ER TOUR AGGLO », « FENO », « CASSE », « AIRDESIGN »…) : son lancement
// principal prend la case du dossier (un chantier si le dossier n'en désigne pas) ; le recyclage
// prend sa propre case, les autres lancements du dossier (bis…) deviennent des chantiers. Liste de coupe, .bkp, sommaire et
// Diakonos vont au lancement dont ils portent le nom, sinon au lancement principal du dossier.
function groupesDuDossier(dossier, semaine, fichiers, res, fichiersDiakonos) {
  const poste = posteDuDossier(dossier);
  const lancements = [];
  const rattaches = [];
  const diakonos = [];
  const nomComplet = (f) => `${dossier}/${f.nom}`;
  for (const f of [...fichiers].sort((a, b) => a.nom.localeCompare(b.nom))) {
    if (estFichierDiakonos(f.nom) && estFichierDeLancement(f.nom)) {
      const n = decoderNomDiakonos(f.nom);
      if (n.semaine && n.tour) fichiersDiakonos.push(f);
      else diakonos.push(f);
      continue;
    }
    const info = decoderNomFichierPartage(f.nom);
    const role = roleRattache(f.nom);
    if (role) rattaches.push({ f, info, role });
    else if (info && estFichierDeLancement(f.nom)) lancements.push({ f, info });
    else res.nonReconnus.push(nomComplet(f));
  }
  // Un groupe par lancement ; deux versions du même lancement (ex. sa version _corrige) : la plus récente.
  const groupes = new Map();
  for (const { f, info } of lancements) {
    const cle = `${info.code}|${info.suffixe.replace(/_?CORRIGE$/, "")}`;
    if (!groupes.has(cle)) groupes.set(cle, { ...nouveauGroupe(POSTE_CHANTIERS, info, dossier), info });
    const g = groupes.get(cle);
    if (!g.strat || f.date >= g.strat.date) g.strat = f;
  }
  const liste = [...groupes.values()];
  if (!liste.length) {
    for (const { f } of rattaches) res.nonReconnus.push(nomComplet(f));
    for (const f of diakonos) res.nonReconnus.push(nomComplet(f));
    return [];
  }
  const nomDossier = dossier.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const score = (g) =>
    (poste && g.info.poste === poste ? 4 : 0) +
    (!poste && g.suffixe === nomDossier ? 4 : 0) +
    (/STRAT|START|FENO|CASSE/.test(g.suffixe) ? 2 : 0) -
    g.suffixe.length / 100;
  const principal = [...liste].sort((a, b) => score(b) - score(a))[0];
  principal.poste = poste || POSTE_CHANTIERS;
  for (const g of liste) if (g !== principal && g.info.poste === "Recyclage") g.poste = "Recyclage";
  // Le dossier de la semaine décide de l'onglet (la casse rangée dans « Semaine 46 » y reste).
  for (const g of liste) {
    g.semaineDossier = semaine || null;
    if (semaine) g.parite = pariteDuNumeroSemaine(semaine);
    else if (g.poste === "Casse") g.parite = pariteCasse(g.code);
  }

  const qualites = new Map();
  for (const { f, info, role } of rattaches) {
    const choix = info ? choisirLancement(info, liste, new Map()) : null;
    const g = choix ? choix.groupe : principal;
    const q = choix ? choix.qualite : -1;
    const cle = `${role}|${g.code}|${g.suffixe}`;
    if (qualites.has(cle) && qualites.get(cle) > q) continue;
    qualites.set(cle, q);
    g[role] = f;
  }
  // Diakonos du lancement qui porte son nom, sinon du lancement principal du dossier.
  for (const f of diakonos) {
    const g = groupeDuDiakonos(f.nom, liste) || principal;
    if (!g.diakonos || f.date >= g.diakonos.date) g.diakonos = f;
  }
  for (const g of liste) delete g.info;
  return liste;
}
