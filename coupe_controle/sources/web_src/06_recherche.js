// La recherche accepte trois formats, reconnus automatiquement :
// - une clé complète commande+ligne (ex. "CVC26090331003") ;
// - un numéro de commande seul, sans ligne (ex. "CVC26090331") — renvoie
//   alors toutes les lignes/pièces de cette commande ;
// - un numéro de bande ou de modulo (ex. "T9" ou "T9/1") — renvoie toutes
//   les pièces réelles rattachées à cette bande via leur champ de grain
//   matching (ex. une valeur "T9:1:1" signale que la pièce fait partie de
//   la bande T9), le même mécanisme qui relie déjà bandes/modulos et
//   pièces dans le fichier .bkp (voir lireQuantitesCtt).
const MOTIF_RECHERCHE_BANDE = /^L?T\s*(\d+)(?:\/\d+)?$/i;

function extraireNumeroBandeRecherche(requete) {
  const m = MOTIF_RECHERCHE_BANDE.exec(requete.trim());
  return m ? m[1] : null;
}

function clesDeLaBande(grainParCle, numeroBande) {
  const motif = new RegExp(`^T${numeroBande}:`, "i");
  const cles = new Set();
  for (const [cle, valeurs] of grainParCle) {
    if (valeurs.some((v) => motif.test(v))) cles.add(cle);
  }
  return cles;
}

// Grain matching par clé, à partir du .ctt d'un .bkp — même format que
// lireGrainMatching() pour une liste de coupe ("T9:1:1"), pour que
// clesDeLaBande() et l'affichage marchent à l'identique quelle que soit la
// source. Contrairement au CSV du .ctt où la position du champ grain
// matching varie selon le sous-format de ligne (voir lireQuantitesCtt), on
// cherche directement le motif dans le texte brut de la ligne PNL2 plutôt
// que de viser un index de colonne fixe.
const MOTIF_GRAIN_BKP = /\bT\d+:[\d\s]*:\d+\b/g;

function lireGrainMatchingDepuisBkpTexte(texte) {
  const resultat = new Map();
  for (const ligne of texte.split(/\r?\n/)) {
    if (!ligne.startsWith("PNL2,")) continue;
    const champs = ligne.split(",");
    const cle = champs[5] || "";
    if (!cle) continue;
    const valeurs = ligne.match(MOTIF_GRAIN_BKP);
    if (!valeurs) continue;
    if (!resultat.has(cle)) resultat.set(cle, []);
    for (const v of valeurs) {
      if (!resultat.get(cle).includes(v)) resultat.get(cle).push(v);
    }
  }
  return resultat;
}

// Quantités (sans les protections) et grain matching par clé d'un .bkp,
// pour que la recherche (clé, commande ou bande/modulo) marche directement
// sur le .bkp quand il n'y a pas de liste de coupe.
async function lireDonneesRechercheBkp(fichierBkp) {
  const texte = await texteCttBkp(fichierBkp);
  return { qteParCle: lireQuantitesCtt(texte, true), grainParCle: lireGrainMatchingDepuisBkpTexte(texte) };
}

// Liste de coupe déjà lue (Excel dézippé ou pages PDF), une fois par fichier.
const cacheSourceCoupe = new WeakMap();
function sourceCoupeEnCache(fichier) {
  if (!cacheSourceCoupe.has(fichier)) {
    const lecture = chargerSourceCoupe(fichier);
    lecture.catch(() => cacheSourceCoupe.delete(fichier));
    cacheSourceCoupe.set(fichier, lecture);
  }
  return cacheSourceCoupe.get(fichier);
}

function champsDepuisStrat(l, base) {
  const c = base ? { ...base } : {};
  c.lancement = l.lancement || (base ? base.lancement : null) || null;
  c.assemblage = l.assemblage || (base ? base.assemblage : null) || null;
  if (l.longueurFinie !== null && l.longueurFinie !== undefined) c.longueurFinie = l.longueurFinie;
  if (l.largeurFinie !== null && l.largeurFinie !== undefined) c.largeurFinie = l.largeurFinie;
  if (l.epaisseurFinie !== null && l.epaisseurFinie !== undefined) c.epaisseurFinie = l.epaisseurFinie;
  c.toutesDonneesLan = l.toutesDonnees || null;
  return c;
}

// Bases où chercher, au choix, dans l'ordre de l'atelier : Diakonos, lancement, liste de coupe, .bkp.
const BASE_DIAKONOS = "Diakonos", BASE_LAN = "LAN", BASE_LISTE = "Liste", BASE_BKP = ".bkp";
const BASES_RECHERCHE = [BASE_DIAKONOS, BASE_LAN, BASE_LISTE, BASE_BKP];

// Le « CVC » est facultatif : « 26100810 » trouve CVC26100810001, CVC26100810002…
function correspondRecherche(cle, requete, exacte) {
  if (exacte ? cle === requete : cle.startsWith(requete)) return true;
  if (!/^\d/.test(requete)) return false;
  const chiffres = cle.toUpperCase().replace(/^[A-Z]+/, "");
  return exacte ? chiffres === requete : chiffres.startsWith(requete);
}

function clesCiblesRecherche(requete, numeroBande, cles, grainParCle) {
  if (numeroBande) return clesDeLaBande(grainParCle, numeroBande);
  const toutes = [...cles];
  const exactes = toutes.filter((c) => correspondRecherche(c, requete, true));
  return new Set(exactes.length ? exactes : toutes.filter((c) => correspondRecherche(c, requete, false)));
}

// Ce que dit le fichier Diakonos d'une pièce commandée.
function champsDepuisDiakonos(p) {
  const donnees = { Commande: p.commande, Ligne: p.ligne };
  if (p.catalogue) donnees.Catalogue = p.catalogue;
  if (p.article) donnees.Article = p.article;
  if (p.designation) donnees["Désignation"] = p.designation;
  if (dimensionsDiakonos(p)) donnees.Dimensions = dimensionsDiakonos(p);
  if (p.coloris) donnees.Coloris = p.coloris;
  return { longueurFinie: p.longueur, largeurFinie: p.largeur, epaisseurFinie: p.epaisseur, toutesDonneesLan: donnees };
}

const aUneBase = (s, bases) =>
  (bases.has(BASE_LISTE) && s.coupe) || (bases.has(BASE_BKP) && s.bkp) || (bases.has(BASE_LAN) && s.strat) || (bases.has(BASE_DIAKONOS) && s.diakonos);

// Recherche une clé, une commande ou une bande/modulo dans les bases choisies
// de chaque source (une par case) : Diakonos, lancement, liste de coupe, .bkp.
async function rechercherDansSources(requeteBrute, toutes, bases = new Set(BASES_RECHERCHE)) {
  const requete = requeteBrute.trim().toUpperCase();
  if (!requete) return null;
  const res = { requete, numeroBande: null, nbSources: 0, trouvailles: [], erreurs: [], commandeUnique: null };
  const sources = toutes.filter((s) => aUneBase(s, bases));
  res.nbSources = sources.length;
  if (sources.length === 0) return res;
  const numeroBande = extraireNumeroBandeRecherche(requete);
  res.numeroBande = numeroBande;
  const lignesStratDe = async (s) => (s.strat ? lignesStratEnCache(s.strat) : []);
  const ligneDeCle = async (s, cle) => {
    try {
      return (await lignesStratDe(s)).find((l) => l.cle === cle) || null;
    } catch (_e) {
      return null; // le fichier de lancement reste optionnel pour la recherche
    }
  };
  const erreur = (s, e) => res.erreurs.push(`${s.nom} : ${e && e.message ? e.message : e}`);

  for (const s of sources) {
    if (bases.has(BASE_LISTE) && s.coupe) {
      try {
        const source = await sourceCoupeEnCache(s.coupe);
        let clesStrat = new Set();
        let qteAttendue = new Map();
        if (s.strat) {
          try {
            const lignes = await lignesStratDe(s);
            clesStrat = new Set(lignes.map((l) => l.cle));
            qteAttendue = new Map(lignes.map((l) => [l.cle, l.qte_attendue]));
          } catch (_e) {
            // sans fichier de lancement lisible : colonnes par défaut
          }
        }
        const grainParCle = lireGrainMatchingDepuisSource(source, clesStrat);
        const cles = clesCiblesRecherche(requete, numeroBande, grainParCle.keys(), grainParCle);
        let compteur = null;
        if (cles.size > 0) {
          try {
            compteur = lireCoupeDepuisSource(source, clesStrat, qteAttendue).compteur;
          } catch (_e) {
            compteur = null; // le grain matching reste affiché même si le comptage échoue
          }
        }
        for (const cle of cles) {
          let champs = null;
          if (source.pdf) {
            const record = source.records.find((r) => r.cle === cle && estRecordPieceReellePDF(r));
            if (record) champs = extraireChampsDetailPDF(record.detailTexte);
          }
          if (s.strat) {
            const l = await ligneDeCle(s, cle);
            if (l) champs = champsDepuisStrat(l, champs);
          }
          res.trouvailles.push({
            source: s,
            base: BASE_LISTE,
            cle,
            valeurs: grainParCle.get(cle) || [],
            quantite: compteur && compteur.has(cle) ? compteur.get(cle) : null,
            champs,
            sansCoupe: false,
          });
        }
      } catch (e) {
        erreur(s, e);
      }
    }
    if (bases.has(BASE_BKP) && s.bkp) {
      try {
        const bkp = await lireDonneesRechercheBkp(s.bkp);
        for (const cle of clesCiblesRecherche(requete, numeroBande, bkp.qteParCle.keys(), bkp.grainParCle)) {
          const l = s.strat ? await ligneDeCle(s, cle) : null;
          res.trouvailles.push({
            source: s,
            base: BASE_BKP,
            cle,
            valeurs: bkp.grainParCle.get(cle) || [],
            quantite: bkp.qteParCle.has(cle) ? bkp.qteParCle.get(cle) : null,
            champs: l ? champsDepuisStrat(l, null) : null,
            sansCoupe: true,
            sourceBkp: true,
          });
        }
      } catch (e) {
        erreur(s, e);
      }
    }
    if (numeroBande) continue;
    if (bases.has(BASE_LAN) && s.strat) {
      try {
        const parCle = new Map((await lignesStratDe(s)).map((l) => [l.cle, l]));
        for (const cle of clesCiblesRecherche(requete, null, parCle.keys(), null)) {
          const l = parCle.get(cle);
          res.trouvailles.push({ source: s, base: BASE_LAN, cle, valeurs: null, quantite: l.qte_attendue, champs: champsDepuisStrat(l, null), sansCoupe: true });
        }
      } catch (e) {
        erreur(s, e);
      }
    }
    if (bases.has(BASE_DIAKONOS) && s.diakonos) {
      try {
        const parCle = new Map((await diakonosEnCache(s.diakonos)).map((p) => [p.cle, p]));
        for (const cle of clesCiblesRecherche(requete, null, parCle.keys(), null)) {
          res.trouvailles.push({ source: s, base: BASE_DIAKONOS, cle, valeurs: null, quantite: null, champs: champsDepuisDiakonos(parCle.get(cle)), sansCoupe: true });
        }
      } catch (e) {
        erreur(s, e);
      }
    }
  }

  if (!numeroBande) {
    const commandes = new Set(res.trouvailles.map((t) => (t.cle.length >= 3 ? t.cle.slice(0, -3) : "")));
    if (commandes.size === 1) res.commandeUnique = [...commandes][0];
  }
  return res;
}

// Une pièce (une clé) et tout ce qu'en disent les fichiers où elle a été
// trouvée, dans l'ordre des clés (commande puis ligne).
function regrouperTrouvailles(trouvailles) {
  const parCle = new Map();
  for (const t of trouvailles) {
    if (!parCle.has(t.cle)) parCle.set(t.cle, { cle: t.cle, sources: [], grains: [], champs: null });
    const p = parCle.get(t.cle);
    p.sources.push(t);
    for (const v of t.valeurs || []) if (!p.grains.includes(v)) p.grains.push(v);
    if (t.champs && (!p.champs || (p.champs.longueurFinie == null && t.champs.longueurFinie != null))) p.champs = t.champs;
  }
  return [...parCle.values()].sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
}

// Toutes les lignes d'une commande, tous fichiers de lancement chargés confondus (une par clé).
async function lignesDeLaCommande(commande, sources) {
  const parCle = new Map();
  for (const s of sources) {
    if (!s.strat) continue;
    let lignes;
    try {
      lignes = await lignesStratEnCache(s.strat);
    } catch (_e) {
      continue;
    }
    for (const l of lignes) if (l.commande === commande && !parCle.has(l.cle)) parCle.set(l.cle, l);
  }
  return [...parCle.values()];
}

// ---- Pièce sans étiquette ----
// On mesure la pièce : cote finie, la première mesure est toujours le sens du fil (longueur), puis la
// largeur ; à 2 mm près. La couleur est facultative, la semaine obligatoire.
const TOLERANCE_COTES_RECHERCHE = 2; // mm

const normaliserCouleurRecherche = (c) => String(c ?? "").toUpperCase().replace(/[\s_.-]/g, "");

// criteres : { longueur, largeur, couleur } (chacun facultatif, au moins un) ;
// lancements : [{ annee, semaine, nom, poste, pieces }] avec les pièces au format de la bibliothèque
// (cle, commande, ligne, article, pieces, longueur, largeur, epaisseur, coloris, coloris_inf, matiere, livraison).
function chercherPiecesSansEtiquette(criteres, lancements) {
  const ecart = (valeur, cible) => {
    if (cible == null) return 0;
    const v = valeur === "" || valeur == null ? NaN : Number(valeur);
    return Number.isFinite(v) ? Math.abs(v - cible) : Infinity;
  };
  const couleur = normaliserCouleurRecherche(criteres.couleur);
  const trouvees = [];
  const vues = new Set();
  for (const l of lancements) {
    for (const p of l.pieces) {
      const eL = ecart(p[5], criteres.longueur);
      const el = ecart(p[6], criteres.largeur);
      if (eL > TOLERANCE_COTES_RECHERCHE || el > TOLERANCE_COTES_RECHERCHE) continue;
      if (couleur && !normaliserCouleurRecherche(p[8]).includes(couleur) && !normaliserCouleurRecherche(p[9]).includes(couleur)) continue;
      const cle = `${l.nom}|${p[0]}`;
      if (vues.has(cle)) continue;
      vues.add(cle);
      trouvees.push({
        annee: l.annee, semaine: l.semaine, lancement: l.nom, poste: l.poste || "", cle: p[0], article: p[3], quantite: p[4],
        longueur: p[5], largeur: p[6], epaisseur: p[7], coloris: p[8], colorisInf: p[9], matiere: p[10], ecart: eL + el,
      });
    }
  }
  return trouvees.sort((a, b) => a.ecart - b.ecart || a.lancement.localeCompare(b.lancement) || String(a.cle).localeCompare(String(b.cle)));
}
