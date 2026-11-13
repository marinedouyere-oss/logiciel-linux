// ---- Compte rendu de la semaine : le modèle de l'atelier (« rapport_lancements_semaine_NN.pdf ») ----
// Une ligne par lancement (TOURS, Lancement, Pièces, Remarque), le total hors casse, puis la casse :
// « Casse » (pièces déjà lancées avant) et « RAJOUT » (les autres), et son total.

const ORDRE_COMPTE_RENDU = ["Agglo 1er tour", "Recyclage", "Feno", "Agglo 2ème tour"];
const LIBELLES_COMPTE_RENDU = { Recyclage: "Recyclage Agglo 1er tour" };

// « LAN2644TRIGANObis » → « TRIGANO BIS » ; « LAN264301COMMANDE TARDIVE » → « COMMANDE TARDIVE ».
function nomChantierCompteRendu(base) {
  const s = base.replace(/^LAN\d{4,6}/i, "").trim().toUpperCase();
  return s ? s.replace(/([A-Z])(BIS|TER)$/, "$1 $2") : base.toUpperCase();
}

// La casse lancée en semaine N est la casse de la semaine d'avant (N − 1, l'année d'avant pour la semaine 1),
// quel que soit le nom du fichier (« LAN264301CASSE » ou « LAN2646CASSE » lancés en 44 / 46 → 43 / 45).
function semaineAvantCompteRendu(numero) {
  const n = Number(numero);
  const lundi = lundiSemaineIso(anneeDeSemaine(n), n);
  lundi.setDate(lundi.getDate() - 7);
  return String(semaineIso(lundi)).padStart(2, "0");
}

async function donneesCompteRendu(parite) {
  const lancements = [];
  const casses = [];
  for (const p of pairesDeLaSemaine(parite)) {
    if (!p.strat) continue;
    const base = p.strat.name.replace(/\.[^.]*$/, "");
    const r = await resume(p.strat, p.bkp);
    const pieces = r.prevues === null || Number.isNaN(r.prevues) ? null : r.prevues;
    if (p.poste === "Casse" || /CASSE/i.test(base)) casses.push({ p, base, pieces });
    else {
      const rang = estChantier(p) ? ORDRE_COMPTE_RENDU.length : Math.max(0, ORDRE_COMPTE_RENDU.indexOf(p.poste));
      lancements.push({ libelle: estChantier(p) ? nomChantierCompteRendu(base) : LIBELLES_COMPTE_RENDU[p.poste] || p.poste, base, pieces, rang });
    }
  }
  // V6.8.3 : les lancements de la bibliothèque de la semaine qui ne sont dans aucune case (créés dans Sentinelle, ou
  // ajoutés depuis un autre dossier, ex. Trigano).
  for (const l of lancementsHorsCasesDeLaSemaine(numeroSemaine(parite), pairesDeLaSemaine(parite))) {
    if (l.casse) casses.push({ p: { poste: "Casse supplémentaire" }, base: l.nom, pieces: l.pieces });
    else lancements.push({ libelle: nomChantierCompteRendu(l.nom), base: l.nom, pieces: l.pieces, rang: ORDRE_COMPTE_RENDU.length, remarque: l.manuel ? "créé dans Sentinelle" : "hors dossiers (bibliothèque)" });
  }
  lancements.sort((a, b) => a.rang - b.rang);
  // Casse : déjà lancées avant / rajouts, en pièces.
  const lignesCasse = [];
  const autre = ongletPrecedent(parite);
  for (const c of casses.sort((a, b) => (a.p.poste === "Casse" ? 0 : 1) - (b.p.poste === "Casse" ? 0 : 1))) {
    if (c.p.poste !== "Casse") {
      lignesCasse.push({ libelle: /RECYCLAGE/i.test(c.base) ? "Recyclage casse" : "Casse", base: c.base, pieces: c.pieces, remarque: "" });
      continue;
    }
    const rc = await calculerCasse(c.p, pairesDeLaSemaine(autre), numeroSemaine(autre));
    if (rc.erreur || rc.autreSemaineChargee) {
      lignesCasse.push({ libelle: "Casse", base: c.base, pieces: c.pieces, remarque: "déjà lancées / rajouts pas séparés : semaines d'avant absentes" });
      continue;
    }
    const somme = (ls) => ls.reduce((t, l) => t + (Number(l.pieces) || 0), 0);
    lignesCasse.push({ libelle: "Casse", base: c.base, pieces: somme(rc.dejaLancees.map((d) => d.ligne)), remarque: "" });
    lignesCasse.push({ libelle: "RAJOUT", base: c.base, pieces: somme(rc.rajouts), remarque: "" });
  }
  const numero = numeroSemaine(parite);
  return { numero, lancements, lignesCasse, semaineCasse: semaineAvantCompteRendu(numero) };
}

// ---- Le PDF (charte Laisné : bandeau, logo, chiffres clés, tableaux) ----

const COLONNES_COMPTE_RENDU = ["Tours", "Lancement", "Pièces", "Remarque"];
const LARGEURS_COMPTE_RENDU = [44, 62, 22, 46];
const fmtPiecesCompteRendu = (n) => (n === null || n === undefined ? "—" : fmtNombre(n));

// Un tableau du compte rendu (lignes puis total en bordeaux) ; renvoie le bas du tableau.
function tableauCompteRenduPdf(pdf, y, lignes, libelleTotal) {
  const l = largeursPdf({ largeursMm: LARGEURS_COMPTE_RENDU });
  const droite = [2];
  y = enteteTableauPdf(pdf, y, COLONNES_COMPTE_RENDU, l, droite);
  const total = lignes.reduce((t, x) => t + (x.pieces || 0), 0);
  const rangees = [...lignes.map((x) => [x.libelle, x.base, fmtPiecesCompteRendu(x.pieces), x.remarque || ""]), [libelleTotal, "", fmtNombre(total), ""]];
  rangees.forEach((r, i) => {
    const estTotal = i === rangees.length - 1;
    const police = estTotal ? POLICE.GRAS : POLICE.TEXTE;
    if (y + hauteurRangeePdf(r, l, police) > RAPPORT_BAS) {
      pdf.nouvellePage();
      bandeauPdf(pdf);
      y = enteteTableauPdf(pdf, RAPPORT_BANDEAU + 12 * PDF_MM, COLONNES_COMPTE_RENDU, l, droite);
    }
    const fond = estTotal ? CHARTE.BORDEAUX : i % 2 === 1 ? CHARTE.GRIS_CLAIR : null;
    y = rangeePdf(pdf, y, r, l, droite, fond, police, estTotal ? CHARTE.BLANC : CHARTE.NOIR, !estTotal);
  });
  return y;
}

// Titre de partie : pastille numérotée et titre bordeaux ; renvoie le haut du tableau.
function titrePartieCompteRenduPdf(pdf, y, numero, titre) {
  if (y + 80 > RAPPORT_BAS) {
    pdf.nouvellePage();
    bandeauPdf(pdf);
    y = RAPPORT_BANDEAU + 12 * PDF_MM;
  }
  y += 14;
  pdf.texte(pastillePdf(pdf, RAPPORT_MARGE, y, numero) + 8, y, titre, 11.5, POLICE.TITRE, CHARTE.BORDEAUX);
  return y + 10;
}

async function compteRenduSemainePdf(parite) {
  const d = await donneesCompteRendu(parite);
  const titre = `Rapport des lancements — Semaine ${d.numero}`;
  const pdf = new PdfSimple(titre);
  bandeauPdf(pdf);
  const hLogo = pdf.logo(PDF_LARGEUR - RAPPORT_MARGE - RAPPORT_LOGO, RAPPORT_BANDEAU + 7 * PDF_MM, RAPPORT_LOGO);
  const largeurTitres = RAPPORT_UTILE - RAPPORT_LOGO - 8 * PDF_MM;
  let y = RAPPORT_BANDEAU + 7 * PDF_MM - 8;
  for (const ligne of couperTextePdf("Rapport des lancements", largeurTitres, 26, POLICE.TITRE)) {
    y += 30;
    pdf.texte(RAPPORT_MARGE, y, ligne, 26, POLICE.TITRE, CHARTE.GRIS);
  }
  y += 16;
  pdf.texte(RAPPORT_MARGE, y, `Semaine ${d.numero} · ${datesSemaine(Number(d.numero))} ${anneeDeSemaine(Number(d.numero))}`, 11.5, POLICE.TITRE, CHARTE.BORDEAUX);
  y = Math.max(y + 10, RAPPORT_BANDEAU + 7 * PDF_MM + hLogo + 8);
  pdf.filet(RAPPORT_MARGE, PDF_LARGEUR - RAPPORT_MARGE, y, CHARTE.SAUMON, 1);
  y += 12;

  const totalPieces = d.lancements.reduce((t, l) => t + (l.pieces || 0), 0);
  const totalCasse = d.lignesCasse.reduce((t, l) => t + (l.pieces || 0), 0);
  let x = chiffreClePdf(pdf, RAPPORT_MARGE, y, String(d.numero), "Semaine", null);
  x = chiffreClePdf(pdf, x, y, fmtNombre(totalPieces), "Pièces (hors casse)", null);
  if (d.lignesCasse.length) chiffreClePdf(pdf, x, y, fmtNombre(totalCasse), "Pièces de casse", null);
  y += 15 * PDF_MM + 14;

  y = titrePartieCompteRenduPdf(pdf, y, 1, `Lancements de la semaine ${d.numero}`);
  if (d.lancements.length) y = tableauCompteRenduPdf(pdf, y, d.lancements, "Total pièces (hors casse)");
  else y = encadrePdf(pdf, y, "Aucun lancement chargé pour cette semaine.", true);

  if (d.lignesCasse.length) {
    y = titrePartieCompteRenduPdf(pdf, y + 10, 2, `Casse — SEMAINE ${d.semaineCasse}`);
    y = tableauCompteRenduPdf(pdf, y, d.lignesCasse, "Total casse");
    pdf.texte(RAPPORT_MARGE, y + 14, "Casse : pièces déjà lancées une semaine d'avant. RAJOUT : les autres pièces de la casse.", 7.8, POLICE.ITALIQUE, CHARTE.GRIS);
  }
  piedsDePagePdf(pdf, titre);
  return { nom: `rapport_lancements_semaine_${d.numero}.pdf`, octets: pdf.octets(), donnees: d };
}

async function exporterCompteRendu(parite) {
  const { nom, octets } = await compteRenduSemainePdf(parite);
  telecharger(nom, octets, "application/pdf");
}
