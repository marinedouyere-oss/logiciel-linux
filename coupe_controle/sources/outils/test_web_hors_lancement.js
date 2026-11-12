// V6.7.2 : Suivi de production → « Pas dans les lancements » : la liste des pièces de l'extraction Diakonos qui ne sont
// dans aucun fichier de lancement de la bibliothèque. Données inventées (aucun fichier client) :
//   CVCTEST001 l.1 : 5 en cours, 5 dans le lancement            → pas listée
//   CVCTEST002 l.1 : 3 en cours, 2 dans le lancement            → listée, 1 pièce « en plus du lancement »
//   CVCTEST003 l.1 : 4 en cours, dans aucun lancement           → listée, 4 pièces (semaine 48)
//   CVCTEST004 l.2 : 1 en cours, dans aucun lancement           → listée, 1 pièce (semaine 47)
//   CVCTEST005 l.1 : Fournitures & DIBOND, 2 en cours           → pas listée (ne passe pas par les lancements)
//   CVCTEST006 l.1 : Résine, 2 en cours                         → pas listée
//   CVCTEST007 l.1 : 2 lancées, 0 en cours (faite)              → pas listée
// Vérifie : les puces par semaine, le filtre, la recherche, et l'export Excel (en-tête de l'extraction, lignes en jaune).
// Usage : node test_web_hors_lancement.js <index.html> <dossier de sortie>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [pageHtml, sortie] = process.argv.slice(2);
let echecs = 0;
const verifier = (ok, t) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`);
  if (!ok) echecs++;
};
const ENTETE = ["Semaine", "Commande", "Ligne", "Catalogue", "Article", "Désignation", "Qte Lancement", "Qte en cours", "Longueur", "Largeur", "Epaisseur",
  "Code Coloris", "Coloris", "Transporteur", "Ville", "Lancement", "groupement"];
const LIGNES = [
  [48, "CVCTEST001", 1, "Stratifié", "TPPVC39651", "Plan essai A", 5, 5, 3000, 650, 39, "9001", "Gris essai", "TRANSP A", "VILLE A", "LAN264801", "AUCUN"],
  [48, "CVCTEST002", 1, "Stratifié", "TPPVC39551", "Plan essai B", 3, 3, 2500, 600, 39, "9001", "Gris essai", "TRANSP A", "VILLE A", "LAN264801", "AUCUN"],
  [48, "CVCTEST003", 1, "Stratifié", "TRI-ESSAI", "Dessus essai C", 4, 4, 2398, 600, 29, "9002", "Bois essai", "TRANSP B", "VILLE B", "", "INDUSTRIE"],
  [47, "CVCTEST004", 2, "Crédences", "CRED14", "Crédence essai D", 1, 1, 3160, 530, 14, "9001", "Gris essai", "TRANSP B", "VILLE C", "", "AUCUN"],
  [48, "CVCTEST005", 1, "Fournitures & DIBOND", "DIB-ESSAI", "Dibond essai", 2, 2, "", "", "", "", "", "TRANSP A", "VILLE A", "", "AUCUN"],
  [48, "CVCTEST006", 1, "Résine", "RES-ESSAI", "Résine essai", 2, 2, "", "", "", "", "", "TRANSP A", "VILLE A", "", "AUCUN"],
  [48, "CVCTEST007", 1, "Stratifié", "TPPVC39651", "Plan essai G", 2, 0, 3000, 650, 39, "9001", "Gris essai", "TRANSP A", "VILLE A", "LAN264801", "AUCUN"],
];

(async () => {
  fs.mkdirSync(sortie, { recursive: true });
  const nav = await chromium.launch();
  const contexte = await nav.newContext({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
  const page = await contexte.newPage();
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  page.on("dialog", (d) => d.accept());
  await contexte.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://s.test/index.html");
  await page.waitForFunction(() => typeof SUIVI !== "undefined" && SUIVI.etat.charge, null, { timeout: 30000 });

  // 1. La bibliothèque : un lancement de la semaine 48 (CVCTEST001 ×5, CVCTEST002 ×2, CVCTEST007 ×2).
  await page.evaluate(() => {
    const p = (cmd, ligne, n) => {
      const x = COLONNES_PIECES_BIBLIOTHEQUE.map(() => "");
      x[COLONNES_PIECES_BIBLIOTHEQUE.indexOf("cle")] = cleLigne(cmd, ligne);
      x[COLONNES_PIECES_BIBLIOTHEQUE.indexOf("commande")] = cmd;
      x[COLONNES_PIECES_BIBLIOTHEQUE.indexOf("ligne")] = String(ligne);
      x[COLONNES_PIECES_BIBLIOTHEQUE.indexOf("pieces")] = n;
      return x;
    };
    bibliotheque.semaines.set("2026-48", {
      id: "2026-48", annee: 2026, semaine: 48, maj: "", supprimeeLe: null, colonnesPieces: COLONNES_PIECES_BIBLIOTHEQUE,
      lancements: [{ nom: "LAN264801START", poste: "Agglo 1er tour", casse: false, pieces: [p("CVCTEST001", 1, 5), p("CVCTEST002", 1, 2), p("CVCTEST007", 1, 2)] }],
    });
    bibliotheque.index = null;
  });

  // 2. L'extraction inventée, fabriquée en Excel dans la page (même lecture qu'un vrai fichier).
  await page.evaluate(
    async ([entete, lignes]) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Suivi");
      ws.addRow(["Suivi production (essai)"]);
      ws.addRow(entete);
      for (const l of lignes) ws.addRow(l);
      const octets = await wb.xlsx.writeBuffer();
      await SUIVI.chargerFichiers([new File([octets], "suivi_production_12112026.xlsx", { lastModified: Date.UTC(2026, 10, 12, 7) })]);
    },
    [ENTETE, LIGNES]
  );
  const r = await page.evaluate(() => {
    SUIVI.calculer();
    return SUIVI.etat.horsDetail.map((x) => [x.r[2], x.r[3], x.n, x.partiel, x.r[0]]);
  });
  console.log(JSON.stringify(r));
  const vu = new Map(r.map((x) => [x[0], x]));
  verifier(r.length === 3, `3 pièces listées (${r.map((x) => x[0]).join(", ")})`);
  verifier(!vu.has("CVCTEST001") && !vu.has("CVCTEST007"), "pièces dans le lancement (ou faites) : pas listées");
  verifier(vu.get("CVCTEST002") && vu.get("CVCTEST002")[2] === 1 && vu.get("CVCTEST002")[3] === true, "CVCTEST002 : 1 pièce en plus du lancement");
  verifier(vu.get("CVCTEST003") && vu.get("CVCTEST003")[2] === 4 && !vu.get("CVCTEST003")[3], "CVCTEST003 : 4 pièces dans aucun lancement");
  verifier(vu.get("CVCTEST004") && vu.get("CVCTEST004")[2] === 1 && vu.get("CVCTEST004")[4] === 47, "CVCTEST004 : 1 pièce, semaine 47");
  verifier(!vu.has("CVCTEST005") && !vu.has("CVCTEST006"), "fournitures, Dibond et résine : pas listés");

  // 3. L'écran.
  await page.click('[data-onglet="suivi"]');
  await page.waitForSelector("#svHors", { timeout: 30000 });
  const puces = await page.$$eval("[data-sv-hors-sem]", (b) => b.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  console.log(puces.join(" | "));
  verifier(puces.length === 3 && /Toutes · 6/.test(puces[0]) && /S47 · 1/.test(puces[1]) && /S48 · 5/.test(puces[2]), "puces : Toutes · 6, S47 · 1, S48 · 5");
  const nbLignes = () => page.$$eval("#svHors tr.sv-hors-ligne", (t) => t.length);
  verifier((await nbLignes()) === 3, "3 lignes affichées");
  const fond = await page.$eval("#svHors tr.sv-hors-ligne td", (td) => getComputedStyle(td).backgroundColor);
  verifier(fond === "rgb(255, 247, 166)", `lignes en jaune (${fond})`);
  await page.click('[data-sv-hors-sem="2026-48"]');
  await page.waitForTimeout(200);
  verifier((await nbLignes()) === 2, "semaine 48 : 2 lignes");
  const texte = await page.locator("#svHors").innerText();
  verifier(/en plus du lancement/.test(texte), "« en plus du lancement » écrit pour CVCTEST002");
  await page.fill("#svHorsRecherche", "test003");
  await page.waitForTimeout(200);
  verifier((await nbLignes()) === 1, "recherche « test003 » : 1 ligne");
  verifier((await page.$eval("#svHorsRecherche", (i) => i.value)) === "test003", "la recherche garde ce qui est tapé");
  await page.fill("#svHorsRecherche", "");
  await page.waitForTimeout(200);
  if (sortie) await page.locator("#svHors").screenshot({ path: path.join(sortie, "hors_lancement.png") });

  // 4. L'export Excel : en-tête de l'extraction, lignes brutes, en jaune.
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#svHorsExport")]);
  const fichier = path.join(sortie, dl.suggestedFilename());
  await dl.saveAs(fichier);
  verifier(dl.suggestedFilename() === "pas_dans_les_lancements_20261112_S48.xlsx", `nom du fichier : ${dl.suggestedFilename()}`);
  const lu = await page.evaluate(async (b64) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const ws = wb.worksheets[0];
    const lignes = [];
    ws.eachRow((row) => lignes.push({ v: row.values.slice(1), fill: row.getCell(1).fill && row.getCell(1).fill.fgColor && row.getCell(1).fill.fgColor.argb, gras: Boolean(row.font && row.font.bold) }));
    return lignes;
  }, fs.readFileSync(fichier).toString("base64"));
  verifier(JSON.stringify(lu[0].v) === JSON.stringify(ENTETE) && lu[0].gras, "export : même en-tête que l'extraction, en gras");
  verifier(lu.length === 3, `export : 2 lignes (semaine 48) — ${lu.length - 1}`);
  verifier(lu.slice(1).every((l) => l.fill === "FFFFFF00"), "export : lignes en jaune");
  verifier(lu.slice(1).map((l) => l.v[1]).join(",") === "CVCTEST002,CVCTEST003", "export : CVCTEST002 et CVCTEST003, colonnes du fichier de suivi");

  // 5. V6.7.3 : « tricher » — compter des pièces de la liste dans un lancement (le fichier LAN n'est pas touché).
  const lan = () =>
    page.evaluate(() => {
      const L = SUIVI.etat.lancementsCalcul.find((x) => x.nom === "LAN264801START");
      const R = SUIVI.calculer().semaines.flatMap((s) => s.lancements).find((x) => x.nom === "LAN264801START");
      return { total: [...L.pieces.values()].reduce((t, q) => t + q, 0), p3: L.pieces.get(cleLigne("CVCTEST003", "1")) || 0, p2: L.pieces.get(cleLigne("CVCTEST002", "1")) || 0, aj: R.aj, r: R.r, f: R.f };
    });
  const avant = await lan();
  verifier(avant.total === 9 && avant.aj === 0, `LAN264801START avant : 9 pièces (${avant.total})`);
  verifier(await page.$eval("#svHorsAjouter", (b) => b.disabled), "bouton « Compter » grisé sans case cochée ni lancement");
  await page.check('[data-sv-hors-coche="' + (await page.evaluate(() => cleLigne("CVCTEST003", "1"))) + '"]');
  await page.check('[data-sv-hors-coche="' + (await page.evaluate(() => cleLigne("CVCTEST002", "1"))) + '"]');
  const valeur = await page.$eval("#svHorsLancement", (s) => [...s.options].find((o) => o.textContent.startsWith("LAN264801START")).value);
  await page.selectOption("#svHorsLancement", valeur);
  const texteBouton = await page.$eval("#svHorsAjouter", (b) => [b.disabled, b.textContent]);
  verifier(!texteBouton[0] && /les 2 pièces cochées/.test(texteBouton[1]), `bouton : « ${texteBouton[1]} »`);
  await page.click("#svHorsAjouter");
  await page.waitForTimeout(300);
  const apres = await lan();
  console.log(JSON.stringify({ avant, apres }));
  verifier(apres.p3 === 4 && apres.p2 === 3 && apres.total === 14 && apres.aj === 5, `LAN264801START après : CVCTEST003 ×4 ajoutée, CVCTEST002 2+1, 14 pièces, dont 5 ajoutées (${apres.total}, ${apres.aj})`);
  verifier(apres.r === avant.r + 5, `à faire du lancement : ${avant.r} → ${apres.r}`);
  const reste = await page.evaluate(() => SUIVI.etat.horsDetail.map((x) => x.r[2]));
  verifier(reste.join(",") === "CVCTEST004", `liste « Pas dans les lancements » : il ne reste que CVCTEST004 (${reste.join(",")})`);
  const garde = await page.evaluate(() => JSON.parse(localStorage.getItem("sentinelle-suivi-rajouts") || "[]").map((a) => [a.commande, a.n, a.partiel, a.nom]));
  verifier(garde.length === 2 && garde.some((a) => a[0] === "CVCTEST003" && a[1] === 4 && !a[2]) && garde.some((a) => a[0] === "CVCTEST002" && a[1] === 1 && a[2]), "ajouts gardés en mémoire");
  const rajouts = await page.locator("#svRajouts").innerText();
  verifier(/ajoutées à la main dans un lancement · 5/.test(rajouts) && /CVCTEST003/.test(rajouts), "liste des pièces ajoutées à la main affichée");
  const ligneLan = await page.locator('[data-sv-lan] .sv-ligne', { hasText: "LAN264801START" }).first().innerText();
  verifier(/dont 5 pièces ajoutées à la main/.test(ligneLan), "barre du lancement : « dont 5 pièces ajoutées à la main »");
  if (sortie) await page.locator("#svHors").screenshot({ path: path.join(sortie, "hors_lancement_ajout.png") });

  // La pièce arrive ensuite dans un vrai fichier de lancement : l'ajout ne compte plus (pas de double compte).
  const double = await page.evaluate(() => {
    const s = bibliotheque.semaines.get("2026-48");
    const x = COLONNES_PIECES_BIBLIOTHEQUE.map(() => "");
    x[0] = cleLigne("CVCTEST003", "1");
    x[COLONNES_PIECES_BIBLIOTHEQUE.indexOf("commande")] = "CVCTEST003";
    x[COLONNES_PIECES_BIBLIOTHEQUE.indexOf("pieces")] = 4;
    s.lancements.push({ nom: "LAN2648CHANTIERS", poste: "Chantiers", casse: false, pieces: [x] });
    bibliotheque.generation++;
    const L = SUIVI.etat.lancementsCalcul;
    SUIVI.calculer();
    const A = SUIVI.etat.lancementsCalcul.find((y) => y.nom === "LAN264801START");
    const res = { p3: A.pieces.get(cleLigne("CVCTEST003", "1")) || 0, aj: A.aj, ignores: SUIVI.etat.rajoutsIgnores.size };
    s.lancements.pop();
    bibliotheque.generation++;
    return res;
  });
  verifier(double.p3 === 0 && double.aj === 1 && double.ignores === 1, `pièce arrivée dans un vrai lancement : l'ajout ne compte plus (${JSON.stringify(double)})`);

  // « Retirer » : la pièce revient dans la liste.
  await page.evaluate(() => SUIVI.afficher());
  const id3 = await page.evaluate(() => SUIVI.etat.rajouts.find((a) => a.commande === "CVCTEST003").id);
  await page.click(`[data-sv-rajout-retirer="${id3}"]`);
  await page.waitForTimeout(300);
  const fin = await lan();
  const reste2 = await page.evaluate(() => SUIVI.etat.horsDetail.map((x) => x.r[2]).sort());
  verifier(fin.p3 === 0 && fin.aj === 1 && reste2.join(",") === "CVCTEST003,CVCTEST004", `« Retirer » : CVCTEST003 revient dans la liste (${reste2.join(",")}), 1 pièce ajoutée reste`);
  await nav.close();
  console.log(echecs ? `${echecs} échec(s)` : "TOUT EST OK");
  process.exit(echecs ? 1 : 0);
})();
