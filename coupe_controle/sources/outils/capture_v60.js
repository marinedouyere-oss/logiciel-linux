// Test de la page web Sentinelle V3.4 sur les vrais dossiers S44 et S45.
// Usage : node test_web.js <dossier du site de test> <dossier captures>
// Aucun serveur : le navigateur reçoit les fichiers du disque via page.route.
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

async function attendreFin(page, maxMs = 600000) {
  const fin = Date.now() + maxMs;
  while (Date.now() < fin) {
    // Fenêtre « semaines de livraison différentes » : on continue.
    const modale = await page.$("#modaleConfirmation:not(.masquee)");
    if (modale) await page.click("#modaleConfirmationOk");
    const texte = await page.innerText("main");
    const scanFini = await page.evaluate(() => {
      const b = document.querySelector("#btnScanner");
      return !b || !b.disabled;
    });
    const calculs = await page.evaluate(
      () =>
        [...document.querySelectorAll("#zoneRecap td")].some((td) => td.textContent.trim() === "…") ||
        (document.querySelector("#texteCompteur") || {}).textContent === "…"
    );
    if (scanFini && !calculs && !texte.includes("⏳") && !texte.includes("Scan en cours")) return texte;
    await page.waitForTimeout(300);
  }
  throw new Error("délai dépassé\n" + (await page.innerText("main")));
}

(async () => {
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("dialog", (d) => {
    console.log("ALERTE:", d.message());
    d.accept();
  });
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs.push("erreur JS : " + e.message);
  });
  // Faux sélecteur de dossier : sert les fichiers du dossier de test.
  await page.addInitScript(() => {
    window.__dossierSuivant = null;
    window.showDirectoryPicker = async () => {
      const dossier = window.__dossierSuivant;
      const liste = await (await fetch(`liste_${dossier}.json`)).json();
      return {
        kind: "directory",
        name: dossier === "s44" ? "Semaine 44" : "Semaine 45",
        async queryPermission() {
          return "granted";
        },
        async requestPermission() {
          return "granted";
        },
        async *entries() {
          for (const f of liste) {
            yield [
              f.nom,
              {
                kind: "file",
                name: f.nom,
                async getFile() {
                  const octets = await (await fetch(`${dossier}/${encodeURIComponent(f.nom)}`)).arrayBuffer();
                  return new File([octets], f.nom, { lastModified: f.date });
                },
              },
            ];
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
  // Fichiers créés tout seuls (problèmes du lancement).
  const telecharges = [];
  page.on("download", (d) => telecharges.push(d.suggestedFilename()));
  await page.goto(base + "/index.html");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${captures}/v60_1_accueil_vide.png` });
  await page.click('.onglet-btn[data-onglet="paire"]');
  await page.evaluate(() => (window.__dossierSuivant = "s44"));
  await page.click("#btnChoisirDossier");
  await page.waitForSelector("#btnScanner:not([disabled])");
  await page.click("#btnScanner");
  await page.waitForTimeout(500);
  await attendreFin(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${captures}/v60_2_controle_haut.png` });
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${captures}/v60_3_controle_milieu.png` });
  await page.click('.poste-item:nth-child(3)');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${captures}/v60_4_controle_clic.png` });
  await page.click('.onglet-btn[data-onglet="accueil"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${captures}/v60_5_accueil.png`, fullPage: true });
  await page.click('.onglet-btn[data-onglet="reecriture"]');
  await page.waitForSelector("#choixExtraction", { state: "attached" });
  await page.setInputFiles("#choixExtraction", process.argv[4]);
  await page.waitForFunction(() => /ligne\(s\)/.test(document.querySelector("#pageReecriture").innerText), null, { timeout: 15000 });
  await page.click('.type-btn[data-type="feno"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${captures}/v60_6_preparer.png`, fullPage: true });
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.click('.onglet-btn[data-onglet="paire"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${captures}/v60_7_etroit.png` });
  console.log("ERREURS:", echecs.length ? echecs.join(" | ") : "aucune");
  await navigateur.close();
})();
