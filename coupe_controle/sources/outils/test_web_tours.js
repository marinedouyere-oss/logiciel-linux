// Test de la page web Sentinelle : chaque lancement va dans le Diakonos de son tour, lu dans le nom
// du fichier ; le Feno n'est comparé à aucun Diakonos (il se contrôle avec le Feno). Le dossier s46f
// contient un LAN264601FENO.xlsx dont la colonne lancement dit LAN264602.
// Usage : node test_web_tours.js <dossier du site de test> <dossier captures>
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

(async () => {
  const dossier = path.join(site, "s46f");
  fs.writeFileSync(path.join(site, "liste_s46f.json"), JSON.stringify(fs.readdirSync(dossier).map((nom) => ({ nom, date: 1792999133913 }))));
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 1100, height: 1000 } });
  await page.addInitScript(() => { try { localStorage.setItem("sentinelle-vue-controle", "toutes"); } catch (e) {} }); // V6.9 : toutes les cases affichées (tests du contrôle)
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => echecs.push("erreur JS : " + e.message));
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      const liste = await (await fetch("liste_s46f.json", { cache: "no-store" })).json();
      return {
        kind: "directory",
        name: "Semaine 46",
        async queryPermission() {
          return "granted";
        },
        async requestPermission() {
          return "granted";
        },
        async *entries() {
          for (const f of liste) {
            yield [f.nom, { kind: "file", name: f.nom, async getFile() {
              const octets = await (await fetch(`s46f/${encodeURIComponent(f.nom)}`, { cache: "no-store" })).arrayBuffer();
              return new File([octets], f.nom, { lastModified: f.date });
            } }];
          }
        },
      };
    };
  });
  await page.route(`${base}/**`, async (route) => {
    const relatif = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
    const fichier = path.join(site, relatif);
    if (!fichier.startsWith(site) || !fs.existsSync(fichier)) return route.fulfill({ status: 404, body: "" });
    const type = fichier.endsWith(".html") ? "text/html; charset=utf-8" : fichier.endsWith(".json") ? "application/json" : "application/octet-stream";
    return route.fulfill({ status: 200, body: fs.readFileSync(fichier), headers: { "content-type": type } });
  });
  await page.goto(base + "/index.html");
  await page.click('.onglet-btn[data-onglet="paire"]');
  await page.waitForSelector("#btnChoisirDossier");
  await page.click("#btnChoisirDossier");
  await page.waitForSelector("#btnScanner:not([disabled])");
  await page.click("#btnScanner");
  await page.waitForFunction(
    () => [...document.querySelectorAll(".zone-diakonos")].filter((z) => /Comparé à|Aucun lancement/.test(z.innerText)).length >= 2,
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(500);
  const zones = await page.$$eval(".zone-diakonos", (zs) => zs.map((z) => z.innerText));
  const tour1 = zones.find((z) => z.includes("Diakonos 1er tour") && z.includes("Comparé à")) || "";
  const tour2 = zones.find((z) => z.includes("Diakonos 2ème tour")) || "";
  console.log("--- 1er tour ---\n" + tour1 + "\n--- 2ème tour ---\n" + tour2);
  verifier(tour1.includes("LAN264601START.xlsx") && tour1.includes("LAN264601RECYCLAGE.xlsx"), "le 1er tour est comparé au START et au recyclage");
  verifier(!tour1.includes("LAN264601FENO.xlsx"), "le Feno n'est pas comparé au Diakonos du 1er tour");
  verifier(!tour2.includes("LAN264601FENO.xlsx"), "le Feno n'est pas comparé au Diakonos du 2ème tour");
  const carteFeno = await page.locator(".carte-paire", { hasText: "LAN264601FENO.xlsx" }).first().innerText();
  verifier(!carteFeno.includes("Diakonos"), "pas de Diakonos dans la case Feno");
  verifier(tour2.includes("Aucun lancement du 2ème tour"), "aucun lancement du 2ème tour dans ce dossier");
  await page.screenshot({ path: `${captures}/web_tours_46.png`, fullPage: true });
  await navigateur.close();
  console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : "\nTOUT EST OK");
  process.exit(echecs.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
