// Test de la page web Sentinelle : passage de la V4.5 (recyclage en chantier) à la case Recyclage ;
// scan d'un dossier de semaine rangé en sous-dossiers (un par lancement),
// comme « Semaine 46 » du Drive : 1ER TOUR AGGLO, 2EME TOUR AGGLO, FENO, CASSE, AIRDESIGN.
// Usage : node test_web_dossiers.js <dossier du site de test> <dossier captures>
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const site = process.argv[2];
const captures = process.argv[3];
const base = "https://sentinelle.test";
const echecs = [];
function verifier(condition, message) {
  if (!condition) echecs.push(message);
  console.log(`${condition ? "OK  " : "ÉCHEC"} ${message}`);
}

// Arborescence → liste { chemin: [sous-dossiers], nom }.
function lister(dossier, chemin = []) {
  const res = [];
  for (const e of fs.readdirSync(path.join(dossier, ...chemin), { withFileTypes: true })) {
    if (e.isDirectory()) res.push(...lister(dossier, [...chemin, e.name]));
    else res.push({ chemin, nom: e.name, date: 1792999133913 });
  }
  return res;
}

(async () => {
  const racine = path.join(site, "s46d", "Semaine 46");
  fs.writeFileSync(path.join(site, "liste_s46d.json"), JSON.stringify(lister(racine)));
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 1100, height: 1000 }, acceptDownloads: true });
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs.push("erreur JS : " + e.message);
  });
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      const liste = await (await fetch("liste_s46d.json", { cache: "no-store" })).json();
      const dossier = (nom, chemin) => ({
        kind: "directory",
        name: nom,
        async queryPermission() {
          return "granted";
        },
        async requestPermission() {
          return "granted";
        },
        async *entries() {
          const sous = new Set();
          for (const f of liste) {
            if (f.chemin.length < chemin.length || chemin.some((c, i) => f.chemin[i] !== c)) continue;
            if (f.chemin.length > chemin.length) {
              sous.add(f.chemin[chemin.length]);
              continue;
            }
            yield [f.nom, { kind: "file", name: f.nom, async getFile() {
              const url = ["s46d", "Semaine 46", ...f.chemin, f.nom].map(encodeURIComponent).join("/");
              const octets = await (await fetch(url, { cache: "no-store" })).arrayBuffer();
              return new File([octets], f.nom, { lastModified: f.date });
            } }];
          }
          for (const s of sous) yield [s, dossier(s, [...chemin, s])];
        },
      });
      return dossier("Semaine 46", []);
    };
  });
  await page.route(`${base}/**`, async (route) => {
    const relatif = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
    const fichier = path.join(site, relatif);
    if (!fichier.startsWith(site) || !fs.existsSync(fichier)) return route.fulfill({ status: 404, body: "" });
    const type = fichier.endsWith(".html") ? "text/html; charset=utf-8" : fichier.endsWith(".json") ? "application/json" : "application/octet-stream";
    return route.fulfill({ status: 200, body: fs.readFileSync(fichier), headers: { "content-type": type } });
  });
  const scanner = async () => {
    await page.waitForSelector("#btnChoisirDossier");
    await page.click("#btnChoisirDossier");
    await page.waitForSelector("#btnScanner:not([disabled])");
    await page.click("#btnScanner");
    await page.waitForFunction(() => /Non reconnu/.test(document.querySelector("#carteDossier").innerText), null, { timeout: 120000 });
    await page.waitForFunction(() => !document.querySelector("#btnScanner").disabled, null, { timeout: 300000 });
    await page.waitForTimeout(1500);
  };
  // V4.5 : le recyclage devient « Chantier 2 » (mémorisé) ; puis la nouvelle version, même navigateur.
  await page.goto(base + "/v45.html");
  await scanner();
  const avant = await page.$$eval(".carte-paire .titre-carte", (t) => t.map((x) => x.textContent));
  console.log("V4.5 :", avant.join(" | "));
  await page.goto(base + "/index.html");
  await page.waitForTimeout(1500);
  await scanner();
  const apres = await page.$$eval(".carte-paire", (cs) => cs.map((c) => c.querySelector(".titre-carte").textContent + " = " + ((c.innerText.match(/✓ LAN[^\n]*\.xlsx/g) || []).join(", "))));
  console.log("Nouvelle :", apres.join(" | "));
  verifier(apres[1].startsWith("Recyclage = ✓ LAN264601RECYCLAGE.xlsx"), "recyclage dans sa case, sous l'Agglo 1er tour");
  verifier(!apres.some((t) => /^Chantier/.test(t) && t.includes("RECYCLAGE")), "plus de chantier recyclage en double");
  await navigateur.close();
  console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : "\nTOUT EST OK");
  process.exit(echecs.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
