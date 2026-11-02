// Claustra : la commande CVC26100432 (confirmation) donne le même fichier que LAN26CLAUSTRAbis fait à la main ;
// le fichier se lit dans Sentinelle (Préparer un lancement : aucune ligne rouge).
// Usage : node test_claustra.js <claustra/index.html> <sentinelle index.html> <sortie.xlsx> <capture.png>
const { chromium } = require("playwright"); const fs = require("fs");
const [pageClaustra, pageSentinelle, sortie, capture] = process.argv.slice(2);
let echecs = 0; const verifier = (ok, t) => { console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`); if (!ok) echecs++; };
(async () => {
  const nav = await chromium.launch();
  const page = await nav.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("pageerror", (e) => { console.log("ERREUR JS:", e.message); echecs++; });
  await page.route("https://c.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(pageClaustra), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://c.test/index.html");
  await page.evaluate(() => { window.__octets = null; window.showSaveFilePicker = async (o) => ({ name: o.suggestedName, createWritable: async () => ({ write: async (b) => { window.__octets = Array.from(b); }, close: async () => {} }) }); });
  const remplir = async (id, v) => { await page.fill(`#${id}`, v); };
  await remplir("cmdNumero", "CVC26100432"); await remplir("cmdClient", "GASR22CUCA"); await remplir("cmdRepresentant", "HILLION");
  await remplir("cmdSemaine", "45"); await remplir("cmdAnnee", "2026");
  for (const [k, v] of [["coloris", "1047"], ["longueur", "600"], ["hauteur", "1400"], ["profondeurLisses", "78"], ["droites", "1"], ["largeurDroites", "78"], ["obliques", "4"], ["largeurObliques", "75"]]) await remplir(`c0${k}`, v);
  await page.waitForTimeout(800);
  verifier(await page.isEnabled("#btnFabriquer"), "tout est rempli : le bouton d'enregistrement est actif");
  verifier((await page.inputValue("#nomFichier")) === "LAN2645CLAUSTRA", "nom proposé : LAN2645CLAUSTRA");
  await page.screenshot({ path: capture, fullPage: true });
  await page.click("#btnFabriquer");
  await page.waitForFunction(() => window.__octets, null, { timeout: 10000 });
  fs.writeFileSync(sortie, Buffer.from(await page.evaluate(() => window.__octets)));
  verifier(/Enregistré : LAN2645CLAUSTRA\.xlsx \(6 ligne/.test(await page.textContent("#compteRendu")), await page.textContent("#compteRendu"));
  // Montage non inclus : ENKIT et plus de protection (cochée selon le montage).
  await page.check('input[name="c0montage"][value="0"]');
  await page.waitForTimeout(300);
  verifier(!(await page.isChecked("#c0protection")), "montage non inclus : protection décochée toute seule");
  verifier((await page.textContent("table.apercu")).includes("ENKIT"), "commentaire ENKIT");
  // Sentinelle lit le fichier : Préparer un lancement, aucune ligne rouge.
  const s = await nav.newPage();
  s.on("pageerror", (e) => { console.log("ERREUR JS (Sentinelle):", e.message); echecs++; });
  await s.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(pageSentinelle), headers: { "content-type": "text/html; charset=utf-8" } }));
  await s.goto("https://s.test/index.html");
  const r = await s.evaluate(async (octets) => {
    const o = new Uint8Array(octets);
    const analyse = await analyserExtraction(o);
    const type = TYPES_REECRITURE.find((t) => t.id === "chantier");
    const plan = planifierCorrections(analyse, type);
    const strat = lireStrat(await chargerClasseur(new File([o], "LAN2645CLAUSTRA.xlsx")));
    return { lignes: analyse.donnees.length, erreurs: plan.erreurs.length, pieces: strat.lignes.reduce((t, l) => t + l.pieces, 0), cles: strat.lignes.map((l) => l.cle) };
  }, Array.from(fs.readFileSync(sortie)));
  verifier(r.lignes === 6 && r.erreurs === 0, `Sentinelle lit le fichier : ${r.lignes} lignes, ${r.erreurs} ligne(s) rouge(s)`);
  verifier(r.cles.includes("CVC26100432001"), `commande+ligne : ${[...new Set(r.cles)].join(", ")} ; ${r.pieces} pièces`);
  await nav.close(); console.log(echecs ? `${echecs} ÉCHEC(S)` : "TOUT EST BON"); process.exit(echecs ? 1 : 0);
})();
