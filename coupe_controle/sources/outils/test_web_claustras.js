// V6.7 : claustras — lecture des confirmations de commande, pièces, fichier de lancement, plan.
// Partie autonome : une confirmation fabriquée (mots placés comme dans le PDF, données anonymes).
// Partie facultative : une vraie confirmation en image (PDF « Microsoft Print to PDF », donnée client hors dépôt),
// lue par Tesseract avec les fichiers web/ocr : SENTINELLE_CLAUSTRA_PDF=<fichier.pdf>.
// Usage : node test_web_claustras.js <index.html> <dossier web/ocr> <dossier de sortie>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [pageHtml, ocrDir, sortie] = process.argv.slice(2);
const vraiPdf = process.env.SENTINELLE_CLAUSTRA_PDF || "";
let echecs = 0;
const verifier = (ok, t) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`);
  if (!ok) echecs++;
};

// Une confirmation : chaque ligne = [texte à gauche (x 40), texte à droite (x 330)] ; page de 595 de large.
const CONFIRMATION = [
  ["", "CONFIRMATION DE COMMANDE CVC99001234"],
  ["Référence : ESSAI-REF", "CLIENT ESSAI"],
  ["Code client Représentant ADV", "1 RUE DES ESSAIS"],
  ["ESSA35TEST : DUPONT Martine", "35000 VILLE"],
  ["Transporteur LOG 9 T9", "Adresse Livraison"],
  ["Livraison courant semaine 47/2026", ""],
  ["1 PANNEAUX FABRICATION DE PANNEAUX EN STRATIFIE", ""],
  ["Réalisation d'un claustra en aggloméré stratifié double face", ""],
  ["Coloris : 9001 Chêne Essai", ""],
  ["Épaisseur : 29 mm", ""],
  ["Dimensions totales : longueur 800 mm / hauteur 2500 mm", ""],
  ["5 lames droites", ""],
  ["3 lames obliques", ""],
  ["Largeur des lames droites : 90 mm", ""],
  ["Largeur des lames obliques : 70 mm", ""],
  ["Épaisseur des lames : 29 mm", ""],
  ["Profondeur des lisses : 110 mm", ""],
  ["Emballage : non inclus", ""],
  ["Montage : non inclus", ""],
  ["480.19 2.00 960.38", ""],
  ["2 ILOT39551PVC ILOT EP 39MM - 4 CHANTS PLAQUÉS ABS", ""],
  ["Agglo. 38 mm Hydro. Sous face blanche", ""],
  ["83.50 1.00 83.50", ""],
];
const motsDe = (lignes) => {
  const mots = [];
  lignes.forEach(([g, d], i) => {
    const y = 40 + i * 14;
    let x = 40;
    for (const t of g.split(" ").filter(Boolean)) {
      mots.push({ t, x0: x, x1: x + t.length * 5, y0: y, y1: y + 9 });
      x += t.length * 5 + 4;
    }
    x = 330;
    for (const t of d.split(" ").filter(Boolean)) {
      mots.push({ t, x0: x, x1: x + t.length * 5, y0: y, y1: y + 9 });
      x += t.length * 5 + 4;
    }
  });
  return [{ mots, largeur: 595 }];
};

(async () => {
  fs.mkdirSync(sortie, { recursive: true });
  const nav = await chromium.launch();
  const page = await (await nav.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  await page.route("https://s.test/**", (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith("/ocr/")) {
      const f = path.join(ocrDir, path.basename(u.pathname));
      return r.fulfill({ status: 200, body: fs.readFileSync(f), headers: { "content-type": f.endsWith(".js") ? "text/javascript" : "application/octet-stream" } });
    }
    return r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } });
  });
  await page.goto("https://s.test/index.html");
  await page.waitForFunction(() => typeof lireConfirmationClaustra === "function" && typeof ExcelJS !== "undefined", null, { timeout: 30000 });

  // 1. Lecture de la confirmation.
  const lu = await page.evaluate((pages) => lireConfirmationClaustra(pages), motsDe(CONFIRMATION));
  console.log(JSON.stringify(lu));
  verifier(lu.commande === "CVC99001234" && lu.reference === "ESSAI-REF" && lu.client === "ESSA35TEST" && lu.representant === "DUPONT", `en-tête : commande, référence (sans l'adresse à droite), code client, représentant`);
  verifier(lu.transporteur === "LOG 9 T9" && lu.semaine === "47" && lu.annee === "2026", `transporteur et semaine de livraison 47/2026`);
  verifier(lu.claustras.length === 1 && lu.autres === 1, `1 claustra, 1 autre ligne (îlot) laissée aux lancements habituels`);
  const c = lu.claustras[0] || {};
  verifier(c.ligne === "1" && c.coloris === "9001" && c.colorisNom === "Chêne Essai" && c.epaisseur === "29" && c.longueur === "800" && c.hauteur === "2500", `claustra : ligne, coloris, épaisseur, longueur × hauteur`);
  verifier(c.droites === "5" && c.largeurDroites === "90" && c.obliques === "3" && c.largeurObliques === "70" && c.profondeurLisses === "110", `lames droites / obliques et leurs largeurs, profondeur des lisses`);
  verifier(c.montage === false && c.protection === false && c.qte === "2" && c.agglo === "SAG28HYBR", `montage et emballage non inclus, quantité 2, agglo 29 mm`);

  // 2. Pièces et lignes du fichier de lancement.
  const r = await page.evaluate(([c, cmd]) => {
    const p = piecesClaustra(c);
    return { pieces: p.pieces, lignes: p.pieces.map((x) => ligneLancementClaustra(x, c, cmd)), cols: COLONNES_LAN_CLAUSTRA };
  }, [c, lu]);
  const col = (l, n) => l[r.cols.indexOf(n)];
  const [lisse, oblique, droite] = r.lignes;
  verifier(r.pieces.length === 3, `sans emballage : lisses, lames obliques, lames droites (pas de protection)`);
  verifier(col(lisse, "conf_longueur") === 800 && col(lisse, "conf_largeur") === 110 && col(lisse, "comdet_qte") === 4 && col(lisse, "longueur") === 825 && col(lisse, "largeur") === 135, `lisses : 800 × 110, débit + 25, 2 par claustra × 2 claustras = 4`);
  verifier(col(lisse, "conf_chantgauche") === 9001 && col(droite, "conf_chantgauche") === null && col(droite, "conf_chantavant") === 9001, `chants : 4 sur les lisses, avant et arrière sur les lames`);
  verifier(col(droite, "conf_longueur") === 2440 && col(droite, "conf_largeur") === 90 && col(droite, "comdet_qte") === 10 && col(oblique, "conf_largeur") === 70 && col(oblique, "comdet_qte") === 6, `lames : hauteur − 60 = 2440 ; 5 droites et 3 obliques × 2 claustras`);
  verifier(col(lisse, "commentaire") === "ENKIT" && col(lisse, "idPlan") === "C" && col(lisse, "CBD") === "CBD" && col(lisse, "agglo") === "SAG28HYBR", `ENKIT (montage non inclus), idPlan C, CBD, SAG28HYBR`);
  verifier(col(lisse, "comprod_lancement") === "DUPONT" && col(lisse, "com_clientcom") === "ESSA35TEST" && col(lisse, "commande+ligne") === "CVC99001234001" && col(lisse, "trans_nomcourt") === "LOG 9 T9", `représentant (comprod_lancement), client, commande+ligne, transporteur`);
  const avecEmballage = await page.evaluate((c) => piecesClaustra({ ...c, protection: true, qte: "1" }).pieces.filter((p) => p.protection).map((p) => `${p.L}x${p.l}x${p.qte}`).join(" "), c);
  verifier(avecEmballage === "2550x850x2 2550x85x2 762x85x2", `emballage : (H+50)×(L+50), (H+50)×85, (L−38)×85, 2 de chaque (${avecEmballage})`);

  // 3. Fichier Excel : 37 colonnes, en-tête puis une ligne par pièce.
  const relu = await page.evaluate(async ([lignes]) => {
    const octets = await classeurClaustras(lignes);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(octets);
    const ws = wb.worksheets[0];
    return { nom: ws.name, entetes: ws.getRow(1).values.slice(1), n: ws.rowCount, l2: ws.getRow(2).values.slice(1, 6) };
  }, [r.lignes]);
  verifier(relu.nom === "Feuil1" && relu.entetes.length === 37 && relu.entetes[0] === "conf_commande" && relu.n === 4, `classeur : Feuil1, 37 colonnes, 3 pièces (${relu.n - 1})`);

  // 4. Plan du claustra.
  const svg = await page.evaluate((c) => svgPlanClaustra(c, { commande: "CVC99001234", reference: "ESSAI-REF", semaine: "47" }), c);
  verifier(/Vue de face/.test(svg) && /Vue de dessus/.test(svg) && /2440/.test(svg) && /CVC99001234 ligne 1/.test(svg) && (svg.match(/rotate\(-30/g) || []).length === 3, `plan : vues de face et de dessus, lames 2440, 3 lames obliques tournées`);
  fs.writeFileSync(path.join(sortie, "plan_essai.svg"), svg);

  // 5. Écran : champs remplis, correction, fichier, et ce qui manque.
  await page.evaluate((lu) => {
    localStorage.removeItem("sentinelle-claustras");
    claustras.lu = true;
    claustras.confirmations = [{ cle: "essai", fichier: "essai.pdf", image: false, ...lu }];
  }, lu);
  await page.click('[data-onglet="claustras"]');
  await page.waitForSelector("#pageClaustras .cl-claustra");
  verifier((await page.inputValue('[data-cl="0:0:longueur"]')) === "800" && (await page.inputValue('[data-cl-cmd="0:client"]')) === "ESSA35TEST", `écran : les champs lus sont remplis`);
  verifier(!(await page.isDisabled("#btnClCreer")), `tout est complet : « Créer le fichier de lancement » possible`);
  verifier((await page.inputValue("#nomFichierCl")) === "LAN2647CLAUSTRA", `nom du fichier : LAN2647CLAUSTRA (semaine de livraison)`);
  await page.fill('[data-cl="0:0:hauteur"]', "");
  await page.dispatchEvent('[data-cl="0:0:hauteur"]', "change");
  await page.waitForSelector("#pageClaustras .bandeau.alerte");
  verifier((await page.isDisabled("#btnClCreer")) && /À compléter.*hauteur/s.test(await page.locator("#pageClaustras").innerText()), `hauteur effacée : « À compléter : hauteur », création impossible`);
  await page.fill('[data-cl="0:0:hauteur"]', "2500");
  await page.dispatchEvent('[data-cl="0:0:hauteur"]', "change");
  await page.waitForFunction(() => !document.querySelector("#btnClCreer").disabled);
  const garde = await page.evaluate(() => JSON.parse(localStorage.getItem("sentinelle-claustras") || "{}"));
  verifier(garde.confirmations && garde.confirmations[0].claustras[0].hauteur === "2500", `corrections gardées en mémoire`);
  await page.screenshot({ path: path.join(sortie, "claustras.png"), fullPage: true });

  // 6. Facultatif : une vraie confirmation en image, lue par Tesseract.
  if (vraiPdf) {
    await page.evaluate(() => {
      claustras.confirmations = [];
      afficherClaustras();
    });
    await page.setInputFiles("#fichiersCl", vraiPdf);
    await page.waitForFunction(() => claustras.confirmations.length && !claustras.enCours, null, { timeout: 180000 });
    const vrai = await page.evaluate(() => claustras.confirmations[0]);
    console.log(JSON.stringify(vrai));
    verifier(vrai.image && /^CVC\d{8}$/.test(vrai.commande) && vrai.claustras.length >= 1 && vrai.claustras.every((x) => x.longueur && x.hauteur && x.coloris), `vraie confirmation en image : lue par Tesseract (${vrai.commande}, ${vrai.claustras.length} claustra(s))`);
  } else console.log("(SENTINELLE_CLAUSTRA_PDF absent : lecture d'une vraie confirmation en image non testée)");

  await nav.close();
  console.log(echecs ? `${echecs} échec(s)` : "TOUT EST OK");
  process.exit(echecs ? 1 : 0);
})();
