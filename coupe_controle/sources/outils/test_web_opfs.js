// Indexation sur de vrais dossiers du navigateur (OPFS) : mêmes FileSystemDirectoryHandle qu'un dossier choisi.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const site = process.argv[2], base = "https://sentinelle.test";
function lister(dossier, chemin = []) {
  const res = [];
  for (const e of fs.readdirSync(path.join(dossier, ...chemin), { withFileTypes: true })) {
    if (e.isDirectory()) res.push(...lister(dossier, [...chemin, e.name]));
    else res.push({ chemin, nom: e.name });
  }
  return res;
}
(async () => {
  fs.writeFileSync(path.join(site, "liste_s46d.json"), JSON.stringify(lister(path.join(site, "s46d", "Semaine 46"))));
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 1000, height: 900 } });
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => console.log("ERREUR JS:", e.message));
  await page.route(`${base}/**`, async (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
    const f = path.join(site, rel);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { "content-type": f.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" } });
  });
  await page.goto(base + "/index.html");
  await page.click('.onglet-btn[data-onglet="paire"]');
  await page.waitForSelector("#btnChoisirDossier");
  // Copie de l'arborescence dans l'OPFS, puis le sélecteur de dossier renvoie ce vrai dossier.
  await page.evaluate(async () => {
    const liste = await (await fetch("liste_s46d.json")).json();
    const racineOpfs = await navigator.storage.getDirectory();
    const semaine = await racineOpfs.getDirectoryHandle("Semaine 46", { create: true });
    for (const f of liste) {
      let d = semaine;
      for (const c of f.chemin) d = await d.getDirectoryHandle(c, { create: true });
      const url = ["s46d", "Semaine 46", ...f.chemin, f.nom].map(encodeURIComponent).join("/");
      const octets = await (await fetch(url)).arrayBuffer();
      const w = await (await d.getFileHandle(f.nom, { create: true })).createWritable();
      await w.write(octets);
      await w.close();
    }
    window.showDirectoryPicker = async () => semaine;
  });
  await page.click("#btnChoisirDossier");
  await page.waitForSelector("#btnScanner:not([disabled])");
  await page.click("#btnScanner");
  await page.waitForFunction(() => /Non reconnu|Dossier illisible|Aucun lancement/.test(document.querySelector("#carteDossier").innerText), null, { timeout: 120000 });
  console.log(await page.innerText("#carteDossier"));
  await page.waitForFunction(() => !document.querySelector("#btnScanner").disabled, null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  const cartes = await page.$$eval(".carte-paire", (cs) => cs.map((c) => c.innerText.split("\n").filter((l) => /^(\d\d|✓|Aucun fichier)/.test(l)).join(" | ")));
  for (const c of cartes) console.log("CASE", c);
  console.log("TABLEAU", (await page.innerText("#zoneRecap")).split("\n").slice(0, 30).join(" / "));
  await navigateur.close();
})().catch((e) => { console.error(e); process.exit(1); });
