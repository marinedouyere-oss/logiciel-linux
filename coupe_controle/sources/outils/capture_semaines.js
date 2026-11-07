// Capture des onglets S44 (paire) et S45 (impaire) d'une version de la page : texte de chaque case + image.
// Usage : node capture_semaines.js <site> <sortie>
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const site = process.argv[2];
const sortie = process.argv[3];
const base = "https://sentinelle.test";
function lister(dossier, chemin = []) {
  const res = [];
  for (const e of fs.readdirSync(path.join(dossier, ...chemin), { withFileTypes: true })) {
    if (e.isDirectory()) res.push(...lister(dossier, [...chemin, e.name]));
    else res.push({ chemin, nom: e.name, date: 1792999133913 });
  }
  return res;
}
(async () => {
  for (const d of ["s44", "s45"]) fs.writeFileSync(path.join(site, `liste_cap_${d}.json`), JSON.stringify(lister(path.join(site, d))));
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 1100, height: 1000 }, acceptDownloads: true });
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(() => {
    // Anciennes versions : la fenêtre de confirmation du scan est acceptée.
    setInterval(() => {
      const ok = document.querySelector("#modaleConfirmation:not(.masquee) #modaleConfirmationOk");
      if (ok) ok.click();
    }, 300);
    window.showDirectoryPicker = async () => {
      const cle = window.__dossierSuivant;
      const liste = await (await fetch(`liste_cap_${cle}.json`, { cache: "no-store" })).json();
      const dossier = (nom, chemin) => ({
        kind: "directory", name: nom,
        async queryPermission() { return "granted"; }, async requestPermission() { return "granted"; },
        async *entries() {
          for (const f of liste) {
            if (f.chemin.length !== chemin.length) continue;
            yield [f.nom, { kind: "file", name: f.nom, async getFile() {
              const octets = await (await fetch([cle, ...f.chemin, f.nom].map(encodeURIComponent).join("/"), { cache: "no-store" })).arrayBuffer();
              return new File([octets], f.nom, { lastModified: f.date });
            } }];
          }
        },
      });
      return dossier(cle, []);
    };
  });
  await page.route(`${base}/**`, async (route) => {
    const relatif = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
    const fichier = path.join(site, relatif);
    if (!fichier.startsWith(site) || !fs.existsSync(fichier)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, body: fs.readFileSync(fichier), headers: { "content-type": fichier.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" } });
  });
  await page.goto(base + "/index.html");
  await page.waitForSelector("#btnChoisirDossier");
  const scanner = async (onglet, cle) => {
    await page.click(`.onglet-btn[data-onglet="${onglet}"]`);
    await page.evaluate((c) => (window.__dossierSuivant = c), cle);
    await page.click("#btnChoisirDossier");
    await page.waitForSelector("#btnScanner:not([disabled])");
    await page.click("#btnScanner");
    await page.waitForFunction(() => document.querySelector("#btnScanner").disabled, null, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector("#btnScanner").disabled, null, { timeout: 600000 });
    await page.waitForTimeout(3000);
  };
  await scanner("paire", "s44");
  await scanner("impaire", "s45");
  for (const onglet of ["paire", "impaire"]) {
    await page.click(`.onglet-btn[data-onglet="${onglet}"]`);
    await page.waitForTimeout(4000);
    const textes = await page.$$eval(".carte-paire", (cs) => cs.map((c) => c.innerText));
    const recap = await page.innerText("#zoneRecap");
    const compteur = await page.innerText("#texteCompteur").catch(() => "");
    fs.writeFileSync(path.join(sortie, `${onglet}.txt`), `COMPTEUR ${compteur}\n\nRECAP\n${recap}\n\n` + textes.map((t) => "=== CASE\n" + t).join("\n\n"));
    await page.screenshot({ path: path.join(sortie, `${onglet}.png`), fullPage: true });
  }
  await navigateur.close();
})();
