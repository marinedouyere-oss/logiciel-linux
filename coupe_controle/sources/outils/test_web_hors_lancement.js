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
  // V6.9 : le Suivi est en onglets ; « Pas dans les lancements » en est un.
  await page.click('[data-sv-panneau="hors"]');
  await page.waitForSelector("#svHors", { timeout: 30000 });
  const puces = await page.$$eval("[data-sv-hors-sem]", (b) => b.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  console.log(puces.join(" | "));
  verifier(puces.length === 3 && /Toutes · 6/.test(puces[0]) && /S48 · 5/.test(puces[1]) && /S47 · 1/.test(puces[2]), "puces : Toutes · 6, S48 · 5, S47 · 1 (la plus récente d'abord)");
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
  verifier(/ajoutées à la main dans un lancement existant · 5/.test(rajouts) && /CVCTEST003/.test(rajouts), "liste des pièces ajoutées à la main affichée");
  if (sortie) await page.locator("#svHors").screenshot({ path: path.join(sortie, "hors_lancement_ajout.png") });
  await page.click('[data-sv-panneau="lancements"]');
  await page.click('[data-sv-sem="tout"]'); // V6.9.2 : toutes les semaines du suivi
  const ligneLan = await page.locator('[data-sv-lan] .sv-ligne', { hasText: "LAN264801START" }).first().innerText();
  verifier(/dont 5 pièces ajoutées à la main/.test(ligneLan), "barre du lancement : « dont 5 pièces ajoutées à la main »");
  await page.click('[data-sv-panneau="hors"]');

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

  // 6. V6.7.5 : « Nouveau lancement » nommé par l'utilisateur, qui compte comme un lancement normal (bibliothèque).
  const cle4 = await page.evaluate(() => cleLigne("CVCTEST004", "2"));
  const cle3 = await page.evaluate(() => cleLigne("CVCTEST003", "1"));
  await page.click('[data-sv-hors-sem=""]');
  await page.waitForTimeout(200);
  await page.selectOption("#svHorsLancement", "__nouveau__");
  verifier(await page.isVisible("#svHorsNomNouveau"), "« Nouveau lancement » : champ du nom affiché");
  await page.check(`[data-sv-hors-coche="${cle4}"]`);
  verifier((await page.$eval("#svHorsSemNouveau", (s) => s.value)) === "2026-47", "semaine proposée : celle de la pièce cochée (S47)");
  verifier(await page.$eval("#svHorsAjouter", (b) => b.disabled), "bouton grisé tant que le nom est vide");
  await page.fill("#svHorsNomNouveau", "LAN2647ESSAI");
  const txt = await page.$eval("#svHorsAjouter", (b) => [b.disabled, b.textContent]);
  verifier(!txt[0] && /Créer le lancement « LAN2647ESSAI » avec la pièce cochée/.test(txt[1]), `bouton : « ${txt[1]} »`);
  await page.click("#svHorsAjouter");
  await page.waitForFunction(() => [...(bibliotheque.semaines.get("2026-47") || { lancements: [] }).lancements].some((l) => l.nom === "LAN2647ESSAI"), null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const essai = () =>
    page.evaluate(() => {
      const w = bibliotheque.semaines.get("2026-47");
      const l = w && w.lancements.find((x) => x.nom === "LAN2647ESSAI");
      const R = SUIVI.calculer().semaines.flatMap((s) => s.lancements.map((L) => ({ ...L, sem: s.id }))).find((x) => x.nom === "LAN2647ESSAI");
      return {
        biblio: l ? { manuel: l.manuel, poste: l.poste, pieces: l.pieces.map((p) => [p[1], p[COLONNES_PIECES_BIBLIOTHEQUE.indexOf("pieces")], p[COLONNES_PIECES_BIBLIOTHEQUE.indexOf("article")]]) } : null,
        suivi: R ? { sem: R.sem, r: R.r, f: R.f, poste: R.poste, m: R.m } : null,
        hors: SUIVI.etat.horsDetail.map((x) => x.r[2]).sort(),
        choix: SUIVI.etat.horsLancement,
        commandes: commandesLancees().map((c) => c.commande),
      };
    });
  const e1 = await essai();
  console.log(JSON.stringify(e1));
  verifier(e1.biblio && e1.biblio.manuel && e1.biblio.poste === "Chantiers" && e1.biblio.pieces.length === 1 && e1.biblio.pieces[0][0] === "CVCTEST004" && e1.biblio.pieces[0][1] === 1 && e1.biblio.pieces[0][2] === "CRED14",
    "bibliothèque : LAN2647ESSAI créé en semaine 47 (poste Chantiers, CVCTEST004 ×1, article)");
  verifier(e1.suivi && e1.suivi.sem === "2026-47" && e1.suivi.r === 1 && e1.suivi.m === 1, "suivi : LAN2647ESSAI compté en semaine 47 comme un lancement (1 à faire)");
  verifier(e1.hors.join(",") === "CVCTEST003", `liste : CVCTEST004 n'y est plus (${e1.hors.join(",")})`);
  verifier(e1.choix === "2026-47|LAN2647ESSAI", "le lancement créé est choisi dans la liste pour la suite");
  verifier((await page.locator("#svManuels").innerText()).includes("LAN2647ESSAI"), "liste « Lancements créés dans Sentinelle » affichée");
  await page.click('[data-sv-panneau="lancements"]');
  const barre = await page.locator('[data-sv-lan] .sv-ligne', { hasText: "LAN2647ESSAI" }).first().innerText();
  verifier(/créé dans Sentinelle/.test(barre), "barre du lancement : « lancement créé dans Sentinelle »");
  await page.click('[data-sv-panneau="hors"]');
  // Le même nom dans une autre semaine : refusé.
  await page.selectOption("#svHorsLancement", "__nouveau__");
  await page.fill("#svHorsNomNouveau", "lan2647essai");
  await page.check(`[data-sv-hors-coche="${cle3}"]`);
  await page.selectOption("#svHorsSemNouveau", "2026-48");
  await page.click("#svHorsAjouter");
  await page.waitForTimeout(300);
  verifier(/existe déjà en semaine 47/.test(await page.locator("#svHors").innerText()), "même nom en semaine 48 : refusé (« existe déjà en semaine 47 »)");
  // Ajouter une autre pièce au lancement créé.
  await page.selectOption("#svHorsLancement", "2026-47|LAN2647ESSAI");
  if (!(await page.isChecked(`[data-sv-hors-coche="${cle3}"]`))) await page.check(`[data-sv-hors-coche="${cle3}"]`);
  await page.click("#svHorsAjouter");
  await page.waitForFunction(() => (bibliotheque.semaines.get("2026-47").lancements.find((x) => x.nom === "LAN2647ESSAI") || { pieces: [] }).pieces.length === 2, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const e2 = await essai();
  verifier(e2.biblio.pieces.length === 2 && e2.suivi.r === 5 && e2.hors.length === 0, `CVCTEST003 ajoutée au lancement créé : 2 lignes, 5 à faire (${e2.suivi && e2.suivi.r})`);
  // Retirer une pièce, puis supprimer le lancement.
  await page.click(`[data-sv-manuel-retirer="2026-47|LAN2647ESSAI"][data-k="${cle3}"]`);
  await page.waitForFunction(() => (bibliotheque.semaines.get("2026-47").lancements.find((x) => x.nom === "LAN2647ESSAI") || { pieces: [] }).pieces.length === 1, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const e3 = await essai();
  verifier(e3.hors.join(",") === "CVCTEST003" && e3.suivi.r === 1, "« Retirer » : CVCTEST003 revient dans la liste");
  await page.click('[data-sv-manuel-supprimer="2026-47|LAN2647ESSAI"]');
  await page.waitForFunction(() => !bibliotheque.semaines.get("2026-47").lancements.some((x) => x.nom === "LAN2647ESSAI"), null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const e4 = await essai();
  verifier(!e4.biblio && !e4.suivi && e4.hors.join(",") === "CVCTEST003,CVCTEST004", `« Supprimer le lancement » : retiré de la bibliothèque, pièces revenues (${e4.hors.join(",")})`);

  // 7. V6.8.2 : coller des lignes (pièces pas dans l'extraction, ex. Trigano) puis les mettre dans un lancement.
  const colle = [
    "CVCTEST010\t1\tStratifié\tTRI-229532-H1242\t2114 X 600 X 29 MM\t2 114\t600\t29\t15\tH1242-ST10\tAcacia Sheffield Naturel",
    "CVCTEST003\t1\tStratifié\tTRI-ESSAI\t2398 X 600 X 29 MM\t2 398\t600\t29\t4\t9002\tBois essai",
    "n'importe quoi",
  ].join("\n");
  await page.click(".sv-coller summary");
  await page.fill("#svColler", colle);
  await page.click("#svCollerLire");
  await page.waitForTimeout(300);
  const apresColle = await page.evaluate(() => ({ hors: SUIVI.etat.horsDetail.map((x) => `${x.r[2]}${x.collee ? "*" : ""}`).sort(), filtre: SUIVI.etat.horsSemaine, msg: SUIVI.etat.horsMessage }));
  console.log(JSON.stringify(apresColle));
  verifier(apresColle.hors.join(",") === "CVCTEST003,CVCTEST004,CVCTEST010*", `lignes collées : CVCTEST010 ajoutée à la liste (${apresColle.hors.join(",")})`);
  verifier(/1 ligne ajoutée/.test(apresColle.msg.texte) && /CVCTEST003 l\.1 : déjà dans la liste/.test(apresColle.msg.texte) && /ligne 3 : pas de n° de commande/.test(apresColle.msg.texte), `message : 1 ajoutée, CVCTEST003 déjà dans la liste, ligne 3 illisible`);
  const puces2 = await page.$$eval("[data-sv-hors-sem]", (b) => b.map((x) => x.textContent.trim()));
  verifier(apresColle.filtre === "collees" && puces2.includes("Collées · 15"), `puce « Collées · 15 » choisie (${puces2.join(" | ")})`);
  const cle10 = await page.evaluate(() => cleLigne("CVCTEST010", "1"));
  verifier(/collée/.test(await page.locator("#svHors tr.sv-hors-ligne").first().innerText()), "ligne collée marquée « collée »");
  // Export : la ligne collée dans les colonnes du fichier de suivi.
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#svHorsExport")]);
  const f2 = path.join(sortie, "colle_" + dl2.suggestedFilename());
  await dl2.saveAs(f2);
  const lu2 = await page.evaluate(async (b64) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const ws = wb.worksheets[0];
    return [ws.getRow(1).values.slice(1), ws.getRow(2).values.slice(1)];
  }, fs.readFileSync(f2).toString("base64"));
  const col2 = (n) => lu2[1][lu2[0].indexOf(n)];
  verifier(lu2[0][0] === "Semaine" && col2("Commande") === "CVCTEST010" && col2("Qte en cours") === 15 && col2("Article") === "TRI-229532-H1242" && col2("Code Coloris") === "H1242-ST10", "export : la ligne collée dans les colonnes de l'extraction");
  // Nouveau lancement LAN2648TRIGANO en semaine 48.
  await page.check(`[data-sv-hors-coche="${cle10}"]`);
  await page.selectOption("#svHorsLancement", "__nouveau__");
  await page.fill("#svHorsNomNouveau", "LAN2648TRIGANO");
  await page.selectOption("#svHorsSemNouveau", "2026-48");
  await page.click("#svHorsAjouter");
  await page.waitForFunction(() => (bibliotheque.semaines.get("2026-48").lancements || []).some((l) => l.nom === "LAN2648TRIGANO"), null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const trig = await page.evaluate(() => {
    const l = bibliotheque.semaines.get("2026-48").lancements.find((x) => x.nom === "LAN2648TRIGANO");
    const R = SUIVI.calculer().semaines.flatMap((s) => s.lancements).find((x) => x.nom === "LAN2648TRIGANO");
    const C = COLONNES_PIECES_BIBLIOTHEQUE;
    return { pieces: l.pieces.map((p) => [p[C.indexOf("commande")], p[C.indexOf("pieces")], p[C.indexOf("article")], p[C.indexOf("longueur")], p[C.indexOf("coloris")]]), collees: l.collees, f: R.f, r: R.r, restantes: SUIVI.etat.collees.length, hors: SUIVI.etat.horsDetail.map((x) => x.r[2]).sort() };
  });
  console.log(JSON.stringify(trig));
  verifier(trig.pieces.length === 1 && trig.pieces[0].join("|") === "CVCTEST010|15|TRI-229532-H1242|2114|H1242-ST10" && trig.collees.length === 1, "LAN2648TRIGANO créé : CVCTEST010 ×15, article, longueur, coloris");
  verifier(trig.f === 15 && trig.r === 0, `pas dans le suivi de production : comptée faite (${trig.f} faites, ${trig.r} à faire)`);
  verifier(trig.restantes === 0 && trig.hors.join(",") === "CVCTEST003,CVCTEST004", "la ligne collée sort de la liste");
  // V6.8.2 : le lancement créé se voit dans « La semaine » (S48) et dans « Contrôler la coupe → Semaine 48 ».
  await page.click('[data-onglet="accueil"]');
  await page.waitForTimeout(200);
  // V6.9.2 : le bandeau des semaines en haut de « La semaine ».
  const b48 = await page.$$eval(".bandeau-semaines .bandeau-btn .libelle-onglet", (bs) => bs.map((b) => b.textContent.trim()));
  if (b48.includes("Semaine 48")) {
    await page.click('.bandeau-semaines .bandeau-btn:has(.libelle-onglet:text-is("Semaine 48"))');
    await page.waitForTimeout(200);
    const acc = await page.locator("#pageAccueil").innerText();
    verifier(/LAN2648TRIGANO/.test(acc) && /créé dans Sentinelle/i.test(acc) && /\+ 2 hors dossiers/.test(acc), "« La semaine » S48 : LAN2648TRIGANO affiché (créé dans Sentinelle), + 2 hors dossiers (avec LAN264801START d'essai)");
    await page.click('.menu [data-onglet="controle"]');
    const onglet48 = await page.evaluate(() => [...document.querySelectorAll(".bandeau-semaines .onglet-btn")].find((b) => /Semaine 48/.test(b.textContent))?.dataset.onglet);
    if (onglet48) {
      await page.click(`.bandeau-semaines [data-onglet="${onglet48}"]`);
      await page.waitForTimeout(300);
      const postes = await page.locator("#listePostes").innerText();
      verifier(/LAN2648TRIGANO · 15 pièces/.test(postes) && /créé dans Sentinelle/.test(postes), "« Semaine 48 » : LAN2648TRIGANO dans la liste des postes");
      const recap = await page.locator("#zoneRecap").innerText();
      verifier(/LAN2648TRIGANO/.test(recap) && /créé dans Sentinelle/i.test(recap), "récapitulatif du bas : LAN2648TRIGANO compté");
      const cr = await page.evaluate(async (o) => (await donneesCompteRendu(o)).lancements.map((l) => `${l.libelle}|${l.base}|${l.pieces}|${l.remarque || ""}`), onglet48);
      verifier(cr.includes("TRIGANO|LAN2648TRIGANO|15|créé dans Sentinelle"), `compte rendu de la semaine : LAN2648TRIGANO (${cr.join(" ; ")})`);
    } else verifier(false, "onglet Semaine 48 introuvable");
    await page.click('[data-onglet="suivi"]');
    await page.waitForSelector("#svHors");
  } else console.log(`(semaine 48 pas dans le bandeau de ce jour : ${b48.join(" ")})`);
  // Retirer : elle revient dans les lignes collées.
  await page.click(`[data-sv-manuel-retirer="2026-48|LAN2648TRIGANO"][data-k="${cle10}"]`);
  await page.waitForFunction(() => !(bibliotheque.semaines.get("2026-48").lancements || []).some((l) => l.nom === "LAN2648TRIGANO"), null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const retour = await page.evaluate(() => SUIVI.etat.horsDetail.filter((x) => x.collee).map((x) => `${x.r[2]}:${x.n}`));
  verifier(retour.join(",") === "CVCTEST010:15", `retirée du lancement : revenue dans les lignes collées (${retour.join(",")})`);
  await page.click(`[data-sv-collee-retirer="${cle10}"]`);
  await page.waitForTimeout(300);
  verifier((await page.evaluate(() => SUIVI.etat.collees.length)) === 0, "« Retirer » une ligne collée : enlevée");
  await nav.close();
  console.log(echecs ? `${echecs} échec(s)` : "TOUT EST OK");
  process.exit(echecs ? 1 : 0);
})();
