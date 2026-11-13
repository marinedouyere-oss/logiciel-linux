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

  // 1 bis. V6.8 : « Largeur des lames : 80 et 77 mm » : la confirmation ne dit pas quelles lames font 77 et
  // lesquelles 80 (cas réel CVC26100433) ; seul le plan le dit. Sentinelle ne devine pas : largeur à saisir, lame par
  // lame (lignes sorte / nombre / largeur), et le fichier ne se crée pas avant.
  const deux = await page.evaluate(() => {
    const bloc = (lignes) => lireBlocClaustra(lignes, 1);
    const a = bloc(["Coloris: 1047 Chêne Halifax Naturel", "Épaisseur : 29 mm", "Dimensions totales : longueur 1001 mm / hauteur 1397 mm", "1 lame droite / 8 lames obliques", "Largeur des lames : 80 et 77 mm", "Épaisseur des lames : 29 mm", "Profondeur des lisses : 80 mm"]);
    const avant = piecesClaustra(a);
    // Lu sur le plan : la droite à 80, 6 obliques à 77 et 2 obliques à 80.
    const saisi = { ...a, lames: [{ sorte: "droite", nombre: "1", largeur: "80" }, { sorte: "oblique", nombre: "6", largeur: "77" }, { sorte: "oblique", nombre: "2", largeur: "80" }] };
    const p = piecesClaustra(saisi).pieces.filter((x) => /Lame/.test(x.nom)).map((x) => `${x.nom}:${x.l}x${x.qte}`).join(" ");
    const faux = avertissementsLames({ ...a, lames: [{ sorte: "droite", nombre: "1", largeur: "80" }, { sorte: "oblique", nombre: "7", largeur: "75" }] });
    const s = bloc(["5 lames droites", "3 lames obliques", "Largeur des lames : 90 mm"]);
    const o = bloc(["4 lames obliques", "Largeur des lames : 75 mm"]);
    const svg = svgPlanClaustra(saisi, { commande: "CVC99001234" });
    return { a: [a.droites, a.largeurDroites, a.obliques, a.largeurObliques, (a.largeursLames || []).join("/")], erreurs: avant.erreurs, n: avant.pieces.length, p, faux, s: [s.largeurDroites, s.largeurObliques, s.largeursLames], o: [o.largeurDroites, o.largeurObliques], svg: /largeur 80 et 77 mm/.test(svg) && /9 lames/.test(svg) };
  });
  console.log(JSON.stringify(deux));
  verifier(deux.a.join(",") === "1,,8,,80/77", `« 80 et 77 mm » : pas de largeur devinée, les deux largeurs gardées (${deux.a.join(",")})`);
  verifier(deux.n === 0 && deux.erreurs.join(" | ") === "largeur des lames droites (voir le plan : 80 ou 77 mm) | largeur des lames obliques (voir le plan : 80 ou 77 mm)", `sans saisie : « À compléter : largeur… (voir le plan : 80 ou 77 mm) », pas de fichier (${deux.erreurs.join(" | ")})`);
  verifier(deux.p === "Lame oblique:80x2 Lame oblique:77x6 Lame droite:80x1", `saisi d'après le plan (1 droite 80, 6 obliques 77, 2 obliques 80) : pièces ${deux.p}`);
  verifier(deux.faux.length === 2 && /8 lames obliques, 7 saisies/.test(deux.faux.join()) && /largeur 75 mm : pas sur la confirmation/.test(deux.faux.join()), `à vérifier : nombre différent de la confirmation, largeur pas sur la confirmation`);
  verifier(deux.s[0] === "90" && deux.s[1] === "90" && !deux.s[2] && deux.o.join(",") === ",75", `une seule largeur : pour toutes les lames`);
  verifier(deux.svg, "plan : 9 lames, largeur 80 et 77 mm");

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

  // 5 bis. V6.8 : deux largeurs sur la confirmation : lignes de lames saisies à l'écran.
  await page.evaluate((lu) => {
    const deuxL = lireBlocClaustra(["Coloris: 1047 Chêne Halifax Naturel", "Épaisseur : 29 mm", "Dimensions totales : longueur 1001 mm / hauteur 1397 mm", "1 lame droite / 8 lames obliques", "Largeur des lames : 80 et 77 mm", "Profondeur des lisses : 80 mm"], 1);
    claustras.confirmations = [{ cle: "essai2", fichier: "essai2.pdf", image: false, lecture: LECTURE_CL, ...lu, claustras: [deuxL] }];
    afficherClaustras();
  }, lu);
  await page.waitForSelector('[data-cl-lame="0:0:0:largeur"]');
  const texteAvant = await page.locator("#pageClaustras").innerText();
  verifier(/2 largeurs \(80 et 77 mm\)/.test(texteAvant) && (await page.isDisabled("#btnClCreer")), "écran : « 2 largeurs (80 et 77 mm) … regardez le plan », création impossible");
  await page.fill('[data-cl-lame="0:0:0:largeur"]', "80");
  await page.dispatchEvent('[data-cl-lame="0:0:0:largeur"]', "change");
  await page.waitForFunction(() => document.querySelector('[data-cl-lame="0:0:1:largeur"]'));
  await page.fill('[data-cl-lame="0:0:1:nombre"]', "6");
  await page.dispatchEvent('[data-cl-lame="0:0:1:nombre"]', "change");
  await page.waitForFunction(() => document.querySelector('[data-cl-lame="0:0:1:nombre"]').value === "6");
  await page.fill('[data-cl-lame="0:0:1:largeur"]', "77");
  await page.dispatchEvent('[data-cl-lame="0:0:1:largeur"]', "change");
  await page.waitForFunction(() => document.querySelector('[data-cl-lame="0:0:1:largeur"]').value === "77");
  verifier(/8 lames obliques, 6 saisies/.test(await page.locator("#pageClaustras").innerText()), "écran : « la confirmation dit 8 lames obliques, 6 saisies »");
  await page.click('[data-cl-lame-ajouter="0:0"]');
  await page.waitForSelector('[data-cl-lame="0:0:2:nombre"]');
  await page.fill('[data-cl-lame="0:0:2:nombre"]', "2");
  await page.dispatchEvent('[data-cl-lame="0:0:2:nombre"]', "change");
  await page.waitForFunction(() => document.querySelector('[data-cl-lame="0:0:2:nombre"]').value === "2");
  await page.fill('[data-cl-lame="0:0:2:largeur"]', "80");
  await page.dispatchEvent('[data-cl-lame="0:0:2:largeur"]', "change");
  await page.waitForFunction(() => !document.querySelector("#btnClCreer").disabled, null, { timeout: 5000 });
  const lignesEcran = await page.evaluate(() => piecesClaustra(claustras.confirmations[0].claustras[0]).pieces.filter((x) => /Lame/.test(x.nom)).map((x) => `${x.l}x${x.qte}`).join(" "));
  verifier(lignesEcran === "80x2 77x6 80x1" && !/À vérifier/.test(await page.locator("#pageClaustras").innerText()), `écran : 3 lignes saisies, plus rien à vérifier, fichier possible (${lignesEcran})`);
  await page.screenshot({ path: path.join(sortie, "claustras_deux_largeurs.png"), fullPage: true });

  // 5 ter. V6.8 : photo du plan envoyée par le téléphone (canal retour), rangée par commande, affichée à côté.
  const photo = await page.evaluate(async () => {
    const cv = document.createElement("canvas");
    cv.width = 300;
    cv.height = 200;
    const g = cv.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 300, 200);
    g.fillStyle = "#000";
    g.fillText("PLAN 80 / 77", 20, 100);
    const b64 = cv.toDataURL("image/jpeg", 0.8).split(",")[1];
    const n0 = await traiterDemandesTelephone({ format: "sentinelle-demandes-1", demandes: [
      { id: "essai-1", type: "photoClaustra", commande: "cvc99001234", image: b64, quand: "2026-11-12T20:15:00Z", titre: "Photo du plan" },
      { id: "essai-2", type: "photoClaustra", commande: "CVC1", image: b64 },
      { id: "essai-3", type: "photoClaustra", commande: "CVC99001234", image: btoa("pas une image") },
    ] });
    const rep = lireEtatRetour().traitees;
    afficherClaustras();
    await new Promise((r) => setTimeout(r, 300));
    return { n0, r1: rep["essai-1"], r2: rep["essai-2"], r3: rep["essai-3"], nb: (claustras.photos.get("CVC99001234") || []).length, tel: claustrasPourTelephone(), partage: contenuFichierPartage().claustras };
  });
  console.log(JSON.stringify({ ...photo, tel: photo.tel, partage: undefined }));
  verifier(photo.n0 === 3 && photo.r1.ok && /Photo du plan reçue pour CVC99001234/.test(photo.r1.texte), `demande du téléphone reprise : « ${photo.r1.texte} »`);
  verifier(!photo.r2.ok && !photo.r3.ok, `refusées : n° de commande invalide (${photo.r2.texte}) ; pas une image (${photo.r3.texte})`);
  verifier(photo.nb === 1 && photo.tel.length === 1 && photo.tel[0].commande === "CVC99001234" && photo.tel[0].photos === 1 && photo.tel[0].plusieursLargeurs, "pour le téléphone : la commande, 1 photo, deux largeurs à voir");
  verifier(Array.isArray(photo.partage) && photo.partage[0].commande === "CVC99001234", "fichier partagé : liste des commandes claustras");
  await page.waitForSelector(".cl-photos img[data-cl-photo-voir]");
  verifier(/Plan du claustra · 1 photo/.test(await page.locator("#pageClaustras").innerText()), "écran : la photo du plan à côté de la saisie");
  await page.screenshot({ path: path.join(sortie, "claustras_photo.png"), fullPage: true });
  await page.click(".cl-photos img[data-cl-photo-voir]");
  await page.waitForSelector(".cl-visionneuse img");
  await page.click('.cl-visionneuse [data-a="tourner"]');
  verifier(/rotate\(90deg\)/.test(await page.$eval(".cl-visionneuse img", (i) => i.style.transform)), "visionneuse : en grand, tourner");
  await page.keyboard.press("Escape");
  verifier(!(await page.$(".cl-visionneuse")), "visionneuse fermée (Échap)");
  // Gardée après rechargement de la page (IndexedDB).
  await page.reload();
  await page.waitForFunction(() => typeof afficherClaustras === "function");
  await page.click('[data-onglet="claustras"]');
  await page.waitForSelector(".cl-photos img[data-cl-photo-voir]", { timeout: 10000 });
  verifier(true, "photo gardée après rechargement de la page");
  page.once("dialog", (d) => d.accept());
  await page.click(".cl-photos [data-cl-photo-suppr]");
  await page.waitForFunction(() => !document.querySelector(".cl-photos img[data-cl-photo-voir]"), null, { timeout: 10000 });
  verifier(/Pas encore de photo/.test(await page.locator("#pageClaustras").innerText()), "photo supprimée : « Pas encore de photo »");

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
    // V6.7.6 : la même confirmation, lue avec une version plus ancienne (gardée en mémoire), est relue.
    await page.evaluate(() => {
      const c = claustras.confirmations[0];
      delete c.lecture;
      c.claustras[0].largeurObliques = "1";
      c.claustras[0].largeurDroites = "1";
    });
    await page.setInputFiles("#fichiersCl", []);
    await page.setInputFiles("#fichiersCl", vraiPdf);
    await page.waitForFunction(() => claustras.confirmations.length && claustras.confirmations[0].lecture === LECTURE_CL && !claustras.enCours, null, { timeout: 180000 });
    const relu = await page.evaluate(() => ({ n: claustras.confirmations.length, c: claustras.confirmations[0].claustras[0] }));
    verifier(relu.n === 1 && relu.c.largeurDroites !== "1" && relu.c.largeurObliques !== "1", `lue avec une ancienne version : relue, pas en double (${relu.c.largeurDroites} / ${relu.c.largeurObliques})`);
  } else console.log("(SENTINELLE_CLAUSTRA_PDF absent : lecture d'une vraie confirmation en image non testée)");

  await nav.close();
  console.log(echecs ? `${echecs} échec(s)` : "TOUT EST OK");
  process.exit(echecs ? 1 : 0);
})();
