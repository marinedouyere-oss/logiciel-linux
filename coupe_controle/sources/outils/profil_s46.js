// Test de la page web Sentinelle : scan d'un dossier de semaine rangé en sous-dossiers (un par lancement),
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
  const racine = path.join(site, "s46g", "Semaine 46");
  fs.writeFileSync(path.join(site, "liste_s46g.json"), JSON.stringify(lister(racine)));
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 1100, height: 1000 }, acceptDownloads: true });
  const sortie = process.argv[4];
  fs.mkdirSync(sortie, { recursive: true });
  const telecharges = [];
  page.on("download", async (d) => { const n = d.suggestedFilename(); telecharges.push(n); await d.saveAs(path.join(sortie, n)); });
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs.push("erreur JS : " + e.message);
  });
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      const liste = await (await fetch("liste_s46g.json", { cache: "no-store" })).json();
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
              const url = ["s46g", "Semaine 46", ...f.chemin, f.nom].map(encodeURIComponent).join("/");
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
  await page.goto(base + "/index.html");
  await page.waitForSelector("#btnChoisirDossier");
  await page.click("#btnChoisirDossier");
  await page.waitForSelector("#btnScanner:not([disabled])");
  const cdp = await page.context().newCDPSession(page);
  if (process.env.LENT) await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.LENT) });
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
  await cdp.send("Profiler.start");
  await page.evaluate(() => {
    window.__temps = {};
    const noms = ["stratEnCache", "classeurEnCache", "sourceCoupeEnCache", "lireCoupeDepuisSource", "lireBkpSansProtections", "lireBkp", "lireCouleursBkp",
      "lireQuantitesAttenduesScies", "problemesLancementXlsx", "problemesDuLancement", "memoriserFichier", "sauvegarderDansMemoire", "detecterSemaine", "resume",
      "calculerDiakonosDossier", "calculerDiakonos", "calculerCasse", "majDiakonos", "afficher", "rafraichir", "majRecap", "majCompteur", "lancerUnePaire",
      "lancerControleScies", "problemesAutomatiques", "listerDossier", "placerFichiersScannes", "tick", "diakonosEnCache", "lireDiakonos", "telecharger", "demanderConfirmation", "enregistrer"];
    for (const n of noms) {
      const f = window[n];
      if (typeof f !== "function") { console.log("absent " + n); continue; }
      window[n] = function (...a) {
        const t = performance.now();
        const fin = () => { const e = (window.__temps[n] ||= { n: 0, ms: 0 }); e.n++; e.ms += performance.now() - t; };
        let r;
        try { r = f.apply(this, a); } catch (e) { fin(); throw e; }
        if (r && typeof r.then === "function") r.then(fin, fin); else fin();
        return r;
      };
    }
    // Clique tout seul sur les fenêtres de confirmation.
    setInterval(() => { const b = document.getElementById("modaleConfirmationOk"); if (b && !document.getElementById("modaleConfirmation").classList.contains("masquee")) b.click(); }, 50);
  });
  const t0 = Date.now();
  await page.click("#btnScanner");
  await page.waitForFunction(() => /Dossiers lus/.test(document.querySelector("#carteDossier").innerText), null, { timeout: 300000 });
  for (let i = 0; i < Number(process.env.TOURS || 2400); i++) {
    if (await page.evaluate(() => !document.querySelector("#btnScanner").disabled)) break;
    const modale = page.locator("#modaleConfirmation button").last();
    if (await modale.isVisible().catch(() => false)) { console.log("MODALE : " + (await page.locator("#modaleConfirmation").innerText())); await modale.click(); }
    await page.waitForTimeout(500);
    if (false) console.log(`… ${(i + 1) * 15} s : ` + (await page.evaluate(() => [...document.querySelectorAll(".etat")].map((e) => e.textContent).join(" / ") + " # " + document.querySelector("#carteDossier").innerText.slice(-200))));
  }
  console.log(`SCAN TERMINÉ en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  {
    const t1 = Date.now();
    await page.click("#btnScanner");
    await page.waitForFunction(() => document.querySelector("#btnScanner").disabled, null, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector("#btnScanner").disabled, null, { timeout: 600000 });
    console.log(`DEUXIÈME SCAN en ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  }
  console.log(JSON.stringify(await page.evaluate(() => Object.entries(window.__temps).sort((a, b) => b[1].ms - a[1].ms).map(([n, e]) => `${n} ×${e.n} ${Math.round(e.ms)} ms`)), null, 1));
  const { profile } = await cdp.send("Profiler.stop");
  fs.writeFileSync(path.join(sortie, "profil.cpuprofile"), JSON.stringify(profile));
  await page.waitForFunction(
    () => [...document.querySelectorAll(".zone-diakonos")].filter((z) => /Comparé à/.test(z.innerText)).length >= 4,
    null,
    { timeout: 300000 }
  ).catch(() => console.log("(Diakonos pas tous calculés)"));
  await page.waitForTimeout(20000);
  console.log("=== DOSSIER ===\n" + (await page.innerText("#carteDossier")));
  console.log("=== RECAP ===\n" + (await page.innerText("#zoneRecap")));
  for (const c of await page.locator(".carte-paire").all()) console.log("=== CASE ===\n" + (await c.innerText()));
  console.log("=== FICHIERS CRÉÉS ===\n" + telecharges.join("\n"));
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.screenshot({ path: path.join(sortie, "ecran_s46.png"), fullPage: true });
  await navigateur.close();
})();
