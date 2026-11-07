// Test : un onglet scanné une semaine, puis une autre semaine (même parité) : rien de l'ancienne ne doit rester.
// Usage : node test_web_semaines.js <dossier du site de test> <dossier captures>
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const site = process.argv[2];
const captures = process.argv[3];
const base = "https://sentinelle.test";
const echecs = [];
function verifier(condition, message) {
  if (!condition) echecs.push(message);
  console.log(`${condition ? "OK  " : "ÉCHEC"} ${message}`);
}
function lister(dossier, chemin = []) {
  const res = [];
  for (const e of fs.readdirSync(path.join(dossier, ...chemin), { withFileTypes: true })) {
    if (e.isDirectory()) res.push(...lister(dossier, [...chemin, e.name]));
    else res.push({ chemin, nom: e.name, date: 1792999133913 });
  }
  return res;
}
(async () => {
  const dossiers = { s44: ["s44"], s46: ["s46g", "Semaine 46"] };
  for (const [nom, rel] of Object.entries(dossiers)) fs.writeFileSync(path.join(site, `liste_sem_${nom}.json`), JSON.stringify(lister(path.join(site, ...rel))));
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 1100, height: 1000 }, acceptDownloads: true });
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs.push("erreur JS : " + e.message);
  });
  await page.addInitScript((dossiers) => {
    window.showDirectoryPicker = async () => {
      const cle = window.__dossierSuivant;
      const rel = dossiers[cle];
      const liste = await (await fetch(`liste_sem_${cle}.json`, { cache: "no-store" })).json();
      const dossier = (nom, chemin) => ({
        kind: "directory",
        name: nom,
        async queryPermission() { return "granted"; },
        async requestPermission() { return "granted"; },
        async *entries() {
          const sous = new Set();
          for (const f of liste) {
            if (f.chemin.length < chemin.length || chemin.some((c, i) => f.chemin[i] !== c)) continue;
            if (f.chemin.length > chemin.length) { sous.add(f.chemin[chemin.length]); continue; }
            yield [f.nom, { kind: "file", name: f.nom, async getFile() {
              const url = [...rel, ...f.chemin, f.nom].map(encodeURIComponent).join("/");
              const octets = await (await fetch(url, { cache: "no-store" })).arrayBuffer();
              return new File([octets], f.nom, { lastModified: f.date });
            } }];
          }
          for (const s of sous) yield [s, dossier(s, [...chemin, s])];
        },
      });
      return dossier(rel[rel.length - 1], []);
    };
  }, dossiers);
  await page.route(`${base}/**`, async (route) => {
    const relatif = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
    const fichier = path.join(site, relatif);
    if (!fichier.startsWith(site) || !fs.existsSync(fichier)) return route.fulfill({ status: 404, body: "" });
    const type = fichier.endsWith(".html") ? "text/html; charset=utf-8" : fichier.endsWith(".json") ? "application/json" : "application/octet-stream";
    return route.fulfill({ status: 200, body: fs.readFileSync(fichier), headers: { "content-type": type } });
  });
  await page.goto(base + "/index.html");
  await page.waitForSelector("#btnChoisirDossier");
  const scanner = async (cle) => {
    await page.evaluate((c) => (window.__dossierSuivant = c), cle);
    await page.click("#btnChoisirDossier");
    await page.waitForSelector("#btnScanner:not([disabled])");
    await page.click("#btnScanner");
    await page.waitForFunction(() => document.querySelector("#btnScanner").disabled, null, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector("#btnScanner").disabled, null, { timeout: 600000 });
    await page.waitForTimeout(1500);
  };
  await scanner("s44");
  await scanner("s46");
  const cartes = await page.$$eval(".carte-paire", (cs) => cs.map((c) => c.innerText.replace(/\n+/g, " | ")));
  for (const c of cartes) console.log("CASE", c.slice(0, 400));
  const recap = await page.innerText("#zoneRecap");
  console.log(recap);
  const texte = cartes.join("\n");
  verifier(!/LAN2644|LAN2643|LAN26440|LAN26430|LISTE DE COUPE LAN2644/.test(texte), "plus aucun fichier de la semaine 44 dans les cases");
  verifier(!/Semaine 44|LAN2644/.test(recap), "le tableau ne montre que la semaine 46");
  await page.screenshot({ path: `${captures}/web_semaines.png`, fullPage: true });

  // Un fichier changé à la main : les résultats faits avec l'ancien ne restent pas affichés.
  const ligneRecap = () =>
    page.$$eval("#zoneRecap tr", (trs) => {
      const tr = trs.find((t) => t.innerText.includes("LAN264601START") && !t.innerText.includes("RECYCLAGE"));
      return tr ? [...tr.querySelectorAll("td")].map((td) => td.innerText.trim()) : null;
    });
  const changer = async (role, fichier) => {
    const carte = page.locator(".carte-paire", { has: page.locator(".titre-carte", { hasText: /^Agglo 1er tour$/ }) });
    const [choix] = await Promise.all([page.waitForEvent("filechooser"), carte.locator(`[data-action="choisir"][data-role="${role}"]`).click()]);
    await choix.setFiles(fichier);
    await page.waitForTimeout(1500);
  };
  const avant = await ligneRecap();
  console.log("AVANT", avant);
  verifier(avant && avant[3] === "✔ OK" && avant[4] === "✔ OK", "1er tour contrôlé (contrôle et scies OK)");
  const deuxieme = path.join(site, "s46g", "Semaine 46", "2EME TOUR AGGLO");
  await changer("bkp", path.join(deuxieme, "LAN264602START 2backup.bkp"));
  const apresBkp = await ligneRecap();
  console.log("APRÈS .bkp", apresBkp);
  verifier(apresBkp && apresBkp[4] === "—" && apresBkp[5] === "—", "autre .bkp : Scies et Couleurs à refaire");
  verifier(apresBkp && apresBkp[3] === "✔ OK", "autre .bkp : le contrôle avec la liste de coupe reste");
  await changer("coupe", path.join(deuxieme, "liste de coupe LAN264602START.pdf"));
  const apresCoupe = await ligneRecap();
  console.log("APRÈS coupe", apresCoupe);
  verifier(apresCoupe && apresCoupe[3] === "—", "autre liste de coupe : contrôle à refaire");
  await navigateur.close();
  console.log(echecs.length ? `${echecs.length} ÉCHEC(S)` : "TOUT EST OK");
  process.exit(echecs.length ? 1 : 0);
})();
