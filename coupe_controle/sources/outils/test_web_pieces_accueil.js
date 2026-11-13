// La semaine (accueil) : nombre de pièces de chaque lancement et de la semaine.
// Usage : node test_web_pieces_accueil.js <site> <dossier « Semaine 46 »> <capture.png>
const { chromium } = require("playwright"); const path = require("path"); const fs = require("fs");
const [site, semaine46, capture] = process.argv.slice(2);
const lister = (d, c = []) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? lister(path.join(d, e.name), [...c, e.name]) : [{ chemin: c, nom: e.name, source: path.join(d, e.name) }]));
let echecs = 0; const verifier = (ok, t) => { console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`); if (!ok) echecs++; };
(async () => {
  const nav = await chromium.launch(); const page = await nav.newPage({ viewport: { width: 1300, height: 900 } });
  await page.addInitScript(() => { try { localStorage.setItem("sentinelle-vue-controle", "toutes"); } catch (e) {} }); // V6.9 : toutes les cases affichées (tests du contrôle)
  page.on("pageerror", (e) => { console.log("ERREUR JS:", e.message); echecs++; }); page.on("dialog", (d) => d.accept());
  await page.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(path.join(site, "index.html")), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://s.test/index.html");
  await page.evaluate(async () => { const o = await navigator.storage.getDirectory(); for await (const [n] of o.entries()) await o.removeEntry(n, { recursive: true }); window.racine = await o.getDirectoryHandle("Lancement", { create: true }); });
  for (const f of lister(semaine46)) await page.evaluate(async ({ chemin, nom, b64 }) => { let d = window.racine; for (const c of chemin) d = await d.getDirectoryHandle(c, { create: true }); const w = await (await d.getFileHandle(nom, { create: true })).createWritable(); await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); await w.close(); }, { chemin: ["2026", "Semaine 46", ...f.chemin], nom: f.nom, b64: fs.readFileSync(f.source).toString("base64") });
  await page.evaluate(() => (window.showDirectoryPicker = async () => window.racine));
  await page.click("#btnMenuDossier");
  await page.click('.onglet-btn[data-onglet="paire"]');
  await page.fill("#champSemaineControle", "46"); await page.click("#btnOuvrirSemaine");
  await page.waitForFunction(() => /gardé\(s\) dans la bibliothèque|Aucun lancement|impossible/.test((document.querySelector("#carteDossier") || {}).innerText || ""), null, { timeout: 300000 });
  await page.click('.onglet-btn[data-onglet="accueil"]');
  await page.evaluate(() => { const b = [...document.querySelectorAll(".choix-semaine button")].find((x) => x.textContent === "S46"); if (b) b.click(); });
  await page.waitForFunction(() => { const t = document.querySelector("#tuilePiecesAccueil"); return t && t.textContent !== "…"; }, null, { timeout: 120000 });
  const total = await page.textContent("#tuilePiecesAccueil");
  const parCase = await page.$$eval("[data-pieces]", (l) => l.map((x) => x.textContent));
  console.log("total", total, "| par lancement", parCase.join(", "));
  verifier(Number(total) > 0, `tuile Pièces : ${total}`);
  verifier(!parCase.includes("…"), "chaque lancement a son nombre de pièces");
  verifier(parCase.filter((x) => /^\d+$/.test(x)).reduce((t, x) => t + Number(x), 0) === Number(total), "le total est la somme des lancements");
  await page.screenshot({ path: capture, fullPage: true });
  await nav.close(); console.log(echecs ? `${echecs} ÉCHEC(S)` : "TOUT EST BON"); process.exit(echecs ? 1 : 0);
})();
