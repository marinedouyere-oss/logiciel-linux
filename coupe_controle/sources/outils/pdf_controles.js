// PDF « Points de contrôle de Sentinelle » avec la charte de la page (bandeau, logo, tableaux).
// Usage : node pdf_controles.js <site> <sortie.pdf>
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const [site, sortie] = process.argv.slice(2);

const SECTIONS = [
  {
    titre: "Contrôler la coupe — chaque lancement de la semaine",
    entete: ["Contrôle", "Ce que Sentinelle vérifie", "Alerte si"],
    largeurs: [36, 74, 64],
    lignes: [
      ["Lancement / liste de coupe", "Chaque pièce du lancement est dans la liste de coupe (ou le .bkp), à la bonne quantité.", "Pièce manquante, écart de quantité, pièce en trop."],
      ["Scies (.bkp)", "Les quantités du lancement sont les mêmes que dans le .bkp.", "Pièce différente entre le lancement et le .bkp."],
      ["Couleurs (.bkp)", "Chaque couleur du lancement (dessus et dessous) est optimisée dans le .bkp.", "Couleur absente du .bkp. Couleur remplacée par sa version PF : à vérifier."],
      ["Lignes en double", "Pas deux fois la même ligne dans le fichier de lancement.", "Pièce en double (bouton : lancement sans doublons)."],
      ["Autres lancements de la semaine", "Une pièce n'est lancée qu'une fois dans la semaine.", "Pièce aussi dans un autre lancement de la semaine."],
      ["Déjà lancée l'autre semaine", "La pièce n'est pas déjà dans un lancement de l'autre semaine chargée.", "Pièce déjà lancée."],
      ["Semaine de livraison", "Toutes les pièces du lancement sont à livrer la même semaine.", "Pièces à livrer une autre semaine."],
      ["Diakonos", "Chaque pièce commandée (fichier Diakonos) est dans un lancement du même tour.", "Pièce commandée absente des lancements."],
      ["Casse", "Sépare les pièces déjà lancées avant (Casse) des RAJOUTS.", "Semaines d'avant absentes : séparation impossible."],
      ["Sommaire Cut Rite", "Panneaux et restes par matière, couleurs de la feuille (rapport du lancement).", "Couleur de la feuille absente du lancement. Couleur hors gamme."],
      ["Fichiers du dossier", "Chaque fichier du dossier Semaine NN est reconnu et rangé dans sa case.", "Fichier non reconnu, lancement d'une autre semaine laissé de côté."],
    ],
  },
  {
    titre: "Préparer un lancement — corrections du fichier final",
    entete: ["Lancement", "Correction", "Ligne"],
    lignes: [
      ["Agglo, Casse", "Harmonisation des bandes : largeur d'une autre pièce du même groupe, +60 mm au plus ou -2 mm au plus, seulement si la pièce peut se coupler avec une autre (2 longueurs : 4060 mm au plus). 3 pièces et 4060 mm au plus par bande. Jamais plus de 61 mm de surcote.", "Jaune"],
      ["Agglo, Casse", "« BRUT » retiré de la couleur.", "Jaune"],
      ["Agglo, Casse", "Chant brut : ligne surlignée, rien ne change.", "Jaune"],
      ["Agglo, Casse", "RCB-CRED14 en sous-face des crédences CRED12 / CRED14 en 10 et 12 brut (sauf double face CBD).", "—"],
      ["Agglo, Casse", "BAZ en commentaire si usinage et commentaire vide.", "—"],
      ["Feno", "Retour LG / LD : cote finie +10 (deux retours : +20). Débit = cote finie +55 (FENO) ou +50.", "Jaune (+10) Orange (+20)"],
      ["Feno", "RCB en sous-face sous le 10 brut vide.", "—"],
      ["Agglo, Casse, Feno", "RCB_B999_PORTES remplacé par RCB_0003_PORTES.", "Orange"],
      ["Feno", "Cote finie déjà différente du logiciel de gestion : pas corrigée, signalée. Pièce avec seulement la protection : signalée.", "—"],
    ],
  },
  {
    titre: "Préparer un lancement — erreurs (tous les lancements)",
    entete: ["Erreur", "Règle", "Ligne"],
    lignes: [
      ["Surcote aberrante", "Débit moins cote finie de plus de 61 mm, en longueur (conf_longueur) ou en largeur (conf_largeur).", "Rouge"],
      ["Belle face sans couleur", "Case coloris vide. Pas d'erreur pour : PROTECTION, bois d'une pièce Feno (couleur portée par le FENO), lancement Feno hors FENO, « BRUT » retiré.", "Rouge"],
      ["Priorité des couleurs", "Rouge avant orange, orange avant jaune.", "—"],
    ],
  },
  {
    titre: "Préparer un lancement — rangement",
    entete: ["Point", "Règle", ""],
    lignes: [
      ["Semaine", "Le dossier « Semaine NN » doit exister : Sentinelle ne le crée jamais, il crée seulement le dossier du lancement.", "Bloquant"],
      ["Fichier existant", "Écrasé seulement après validation.", "Question"],
      ["Fichier de lancement", "Aucune ligne ni colonne ajoutée : seules les cellules corrigées et les couleurs de ligne changent. Pas de version dans le fichier.", "—"],
    ],
  },
  {
    titre: "Rechercher une pièce",
    entete: ["Recherche", "Règle"],
    largeurs: [38, 136],
    lignes: [
      ["Par étiquette", "Commande + ligne, commande seule ou bande (T9), CVC facultatif. Dans Diakonos, lancements, listes de coupe et .bkp."],
      ["Sans étiquette", "Cote finie : longueur (sens du fil) puis largeur, à 2 mm près. Couleur facultative. Semaine obligatoire. Bibliothèque et lancements chargés."],
    ],
  },
];

(async () => {
  const nav = await chromium.launch();
  const page = await nav.newPage();
  page.on("pageerror", (e) => console.log("ERREUR JS:", e.message));
  await page.route("https://p.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(path.join(site, "index.html")), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://p.test/index.html");
  const octets = await page.evaluate((sections) => {
    const version = document.querySelector(".badge-version").textContent.trim();
    const titre = "Points de contrôle de Sentinelle";
    const pdf = new PdfSimple(titre);
    bandeauPdf(pdf);
    const hLogo = pdf.logo(PDF_LARGEUR - RAPPORT_MARGE - RAPPORT_LOGO, RAPPORT_BANDEAU + 7 * PDF_MM, RAPPORT_LOGO);
    let y = RAPPORT_BANDEAU + 7 * PDF_MM - 8;
    for (const ligne of couperTextePdf("Points de contrôle", RAPPORT_UTILE - RAPPORT_LOGO - 8 * PDF_MM, 26, POLICE.TITRE)) {
      y += 30;
      pdf.texte(RAPPORT_MARGE, y, ligne, 26, POLICE.TITRE, CHARTE.GRIS);
    }
    y += 16;
    pdf.texte(RAPPORT_MARGE, y, `Sentinelle ${version} · Contrôle de coupe`, 11.5, POLICE.TITRE, CHARTE.BORDEAUX);
    y = Math.max(y + 10, RAPPORT_BANDEAU + 7 * PDF_MM + hLogo + 8);
    pdf.filet(RAPPORT_MARGE, PDF_LARGEUR - RAPPORT_MARGE, y, CHARTE.SAUMON, 1);
    y += 6;
    sections.forEach((s, k) => {
      const l = largeursPdf({ largeursMm: s.largeurs || [38, 104, 32] });
      const n = s.entete.length;
      if (y + 90 > RAPPORT_BAS) {
        pdf.nouvellePage();
        bandeauPdf(pdf);
        y = RAPPORT_BANDEAU + 8 * PDF_MM;
      }
      y += 22;
      pdf.texte(pastillePdf(pdf, RAPPORT_MARGE, y, k + 1) + 8, y, s.titre, 11.5, POLICE.TITRE, CHARTE.BORDEAUX);
      y += 10;
      y = enteteTableauPdf(pdf, y, s.entete, l, n);
      s.lignes.forEach((r, i) => {
        if (y + hauteurRangeePdf(r, l, POLICE.TEXTE) > RAPPORT_BAS) {
          pdf.nouvellePage();
          bandeauPdf(pdf);
          y = enteteTableauPdf(pdf, RAPPORT_BANDEAU + 12 * PDF_MM, s.entete, l, n);
        }
        y = rangeePdf(pdf, y, r, l, n, i % 2 === 1 ? CHARTE.GRIS_CLAIR : null, POLICE.TEXTE, CHARTE.NOIR, true);
      });
    });
    piedsDePagePdf(pdf, titre);
    return Array.from(pdf.octets());
  }, SECTIONS);
  fs.writeFileSync(sortie, Buffer.from(octets));
  console.log(sortie, octets.length, "octets");
  await nav.close();
})();
