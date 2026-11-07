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
  await page.goto(base + "/index.html");
  await page.waitForSelector("#btnChoisirDossier");
  await page.click("#btnChoisirDossier");
  await page.waitForSelector("#btnScanner:not([disabled])");
  await page.click("#btnScanner");
  await page.waitForFunction(() => /Non reconnu/.test(document.querySelector("#carteDossier").innerText), null, { timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector("#btnScanner").disabled, null, { timeout: 300000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll(".zone-diakonos")].filter((z) => /Comparé à/.test(z.innerText)).length >= 4,
    null,
    { timeout: 120000 }
  );
  const compte = await page.innerText("#carteDossier");
  console.log(compte);
  verifier(compte.includes("✔ Agglo 1er tour : LAN264601START.xlsx + sommaire + Diakonos (dossier 1ER TOUR AGGLO)"), "Agglo 1er tour rangé par son dossier");
  verifier(compte.includes("✔ Agglo 2ème tour : LAN264602START.xlsx + Diakonos (dossier 2EME TOUR AGGLO)"), "Agglo 2ème tour rangé par son dossier");
  verifier(compte.includes("✔ Feno : LAN264601FENO.xlsx + Diakonos (dossier FENO)"), "Feno rangé par son dossier");
  verifier(compte.includes("✔ Casse : LAN2646CASSE.xlsx + .bkp + Diakonos (dossier CASSE)"), "casse du dossier de la semaine 46 dans l'onglet 46");
  verifier(/LAN2646AIRDESIGN\.xlsx \+ coupe \+ sommaire \(dossier AIRDESIGN\)/.test(compte), "liste de coupe LAN264601AIRDESIGN rattachée par le dossier");
  verifier(compte.includes("✔ Recyclage : LAN264601RECYCLAGE.xlsx (dossier 1ER TOUR AGGLO)"), "recyclage : sa case");
  verifier(/LAN264601FENOBIS\.xlsx \(dossier FENO\)/.test(compte), "Feno bis : chantier du dossier FENO");
  verifier(compte.includes("Dossiers lus : 1ER TOUR AGGLO (4 fichiers), 2EME TOUR AGGLO (2 fichiers), AIRDESIGN (3 fichiers), CASSE (3 fichiers), dossier principal (1 fichier), FENO (4 fichiers)")
    || compte.includes("Dossiers lus : dossier principal (1 fichier), 1ER TOUR AGGLO (4 fichiers)"), "dossiers lus");
  verifier(compte.includes("FENO/S.46.xlsx") && compte.includes("FOURNITURE CHANT s46.xlsx") && !compte.includes("~$"), "non reconnus, fichier de verrou ignoré");

  const carte = async (texte) => page.locator(".carte-paire", { hasText: texte }).first().innerText();
  const agglo = await carte("✓ LAN264601START.xlsx");
  verifier(agglo.includes("✓ LAN264601STARTDIAKONOS.xlsx") && agglo.includes("3 pièce(s) Diakonos absente(s) des lancements du dossier « 1ER TOUR AGGLO »"),
    "Agglo 1er tour : son Diakonos, 3 pièces absentes");
  verifier(/Comparé à : LAN264601(START|RECYCLAGE)\.xlsx, LAN264601(START|RECYCLAGE)\.xlsx/.test(agglo), "Agglo 1er tour comparé au START et au recyclage");
  const feno = await carte("✓ LAN264601FENO.xlsx");
  console.log(feno.split("\n").slice(0, 14).join("\n"));
  verifier(feno.includes("1 pièce(s) Diakonos absente(s) des lancements du dossier « FENO »") && !feno.includes("CVC26100810001"), "Feno : son Diakonos, 1 pièce absente");
  verifier(!/Comparé à :[^\n]*START/.test(feno), "le Diakonos du Feno n'est pas comparé à l'agglo");
  const recyclage = await carte("✓ LAN264601RECYCLAGE.xlsx");
  verifier(recyclage.includes("02\nRecyclage") && !recyclage.includes("Diakonos"), "recyclage : case sous l'Agglo 1er tour, sans Diakonos");
  const casse = await carte("✓ LAN2646CASSE.xlsx");
  verifier(casse.includes("✓ LAN2646CASSE-DIAKONOS.xlsx"), "Casse : son Diakonos");

  // Problèmes du lancement de l'Agglo 1er tour : les pièces Diakonos absentes, hors du lancement.
  {
    const carteAgglo = page.locator(".carte-paire", { hasText: "✓ LAN264601START.xlsx" }).first();
    const [xlsx] = await Promise.all([page.waitForEvent("download"), carteAgglo.locator('[data-action="problemes-lancement"]').click()]);
    const chemin = `${captures}/web_${xlsx.suggestedFilename()}`;
    await xlsx.saveAs(chemin);
    const lu = execFileSync(path.join(__dirname, "..", "venv", "bin", "python3"), ["-I", "-c", `
import sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
print("FEUILLES", wb.sheetnames)
for r in wb["Rapport"].iter_rows(values_only=True):
    v = [str(x).replace(chr(10), " / ") for x in r if x not in (None, "")]
    if v: print(" | ".join(v))
`, chemin]).toString();
    console.log(lu);
    verifier(/Commandée, pas lancée \(Diakonos\) — 3 pièce\(s\)/.test(lu), "problèmes : groupe des pièces Diakonos pas lancées");
    verifier(/À corriger \| CVC26100810001 \| TPPVC39551 \|[^\n]*Absente des lancements du dossier « 1ER TOUR AGGLO »[^\n]*\| hors lancement/.test(lu), "problèmes : pièce Diakonos hors du lancement");
    verifier(/⚠ Problème \| Diakonos \| 3 pièce\(s\) commandée\(s\) absente\(s\)/.test(lu), "problèmes : bilan Diakonos");
  }

  // Rapport du lancement du Feno : page Diakonos du dossier.
  const carteFeno = page.locator(".carte-paire", { hasText: "LAN264601FENO.xlsx" }).first();
  const [pdf] = await Promise.all([page.waitForEvent("download"), carteFeno.locator('[data-action="rapport-lancement"]').click()]);
  const chemin = `${captures}/web_feno_rapport_dossier.pdf`;
  await pdf.saveAs(chemin);
  const texte = execFileSync("pdftotext", ["-layout", chemin, "-"]).toString();
  verifier(texte.includes("Feno") && texte.includes("1 pièce(s) Diakonos absente(s) des lancements du dossier « FENO »"), "rapport du Feno : Diakonos du dossier");
  await page.screenshot({ path: `${captures}/web_dossiers_46.png`, fullPage: true });
  await navigateur.close();
  console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : "\nTOUT EST OK");
  process.exit(echecs.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
