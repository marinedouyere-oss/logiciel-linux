// Capture les zones d'anomalies des cases (semaine 44) pour relire les explications.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const site = process.argv[2], captures = process.argv[3], base = "https://sentinelle.test";
(async () => {
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 900, height: 1000 } });
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      const liste = await (await fetch("liste_s44.json")).json();
      return { kind: "directory", name: "Semaine 44", async queryPermission() { return "granted"; }, async requestPermission() { return "granted"; },
        async *entries() { for (const f of liste) yield [f.nom, { kind: "file", name: f.nom, async getFile() {
          const o = await (await fetch(`s44/${encodeURIComponent(f.nom)}`)).arrayBuffer(); return new File([o], f.nom, { lastModified: f.date }); } }]; } };
    };
  });
  await page.route(`${base}/**`, async (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
    const f = path.join(site, rel);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { "content-type": f.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" } });
  });
  await page.goto(base + "/index.html");
  await page.click("#btnChoisirDossier");
  await page.waitForSelector("#btnScanner:not([disabled])");
  await page.click("#btnScanner");
  await page.waitForTimeout(1000);
  const fin = Date.now() + 600000;
  while (Date.now() < fin) {
    if (await page.$("#modaleConfirmation:not(.masquee)")) await page.click("#modaleConfirmationOk");
    const fini = await page.evaluate(() => !document.querySelector("#btnScanner").disabled && !document.querySelector("main").innerText.includes("⏳"));
    if (fini) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(3000);
  const cartes = page.locator(".carte-paire");
  const n = await cartes.count();
  for (let i = 0; i < n; i++) {
    const c = cartes.nth(i);
    const t = await c.innerText();
    if (/anomalie|écart|doublon|absente/i.test(t)) {
      await c.screenshot({ path: `${captures}/anomalies_${i}.png` });
      fs.writeFileSync(`${captures}/anomalies_${i}.txt`, t);
      console.log("carte", i, t.split("\n")[1]);
    }
  }
  await navigateur.close();
})();
