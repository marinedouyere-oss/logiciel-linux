// Test de la page web Sentinelle : lancement corrigé sans doublons.
// Usage : node test_web_correction.js <dossier du site de test> <dossier captures>
// Le dossier s44c contient LAN264401FENO.xlsx avec sa dernière ligne en double et son .bkp.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const site = process.argv[2];
const captures = process.argv[3];
const base = "https://sentinelle.test";
const python = path.join(__dirname, "..", "venv", "bin", "python3");

const echecs = [];
function verifier(condition, message) {
  if (!condition) echecs.push(message);
  console.log(`${condition ? "OK  " : "ÉCHEC"} ${message}`);
}

async function attendreFin(page, maxMs = 600000) {
  const fin = Date.now() + maxMs;
  while (Date.now() < fin) {
    const modale = await page.$("#modaleConfirmation:not(.masquee)");
    if (modale) await page.click("#modaleConfirmationOk");
    const texte = await page.innerText("main");
    const scanFini = await page.evaluate(() => {
      const b = document.querySelector("#btnScanner");
      return !b || !b.disabled;
    });
    if (scanFini && !texte.includes("⏳") && !texte.includes("Scan en cours")) return texte;
    await page.waitForTimeout(300);
  }
  throw new Error("délai dépassé\n" + (await page.innerText("main")));
}

const ecrireListe = (fichiers) =>
  fs.writeFileSync(path.join(site, "liste_s44c.json"), JSON.stringify(fichiers.map(([nom, date]) => ({ nom, date }))));

async function scanner(page) {
  await page.click("#btnChoisirDossier");
  await page.waitForSelector("#btnScanner:not([disabled])");
  await page.click("#btnScanner");
  await page.waitForTimeout(500);
  return attendreFin(page);
}

(async () => {
  const dossier = path.join(site, "s44c");
  for (const f of fs.readdirSync(dossier)) if (f.includes("_corrige")) fs.unlinkSync(path.join(dossier, f));
  ecrireListe([["LAN264401FENO.xlsx", 1792019886000], ["LAN264401FENO bbackup.bkp", 1791880358000]]);

  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 1100, height: 1000 }, acceptDownloads: true });
  await page.addInitScript(() => { try { localStorage.setItem("sentinelle-vue-controle", "toutes"); } catch (e) {} }); // V6.9 : toutes les cases affichées (tests du contrôle)
  const alertes = [];
  page.on("dialog", (d) => {
    console.log("ALERTE:", d.message());
    alertes.push(d.message());
    d.accept();
  });
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs.push("erreur JS : " + e.message);
  });
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      const liste = await (await fetch("liste_s44c.json", { cache: "no-store" })).json();
      return {
        kind: "directory",
        name: "Semaine 44",
        async queryPermission() {
          return "granted";
        },
        async requestPermission() {
          return "granted";
        },
        async *entries() {
          for (const f of liste) {
            yield [f.nom, { kind: "file", name: f.nom, async getFile() {
              const octets = await (await fetch(`s44c/${encodeURIComponent(f.nom)}`, { cache: "no-store" })).arrayBuffer();
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

  let texte = await scanner(page);
  const carte = page.locator(".carte-paire", { hasText: "LAN264401FENO.xlsx" }).first();
  await carte.locator('[data-action="sans-doublons"]').waitFor({ timeout: 120000 });
  const avant = await carte.innerText();
  console.log(avant);
  verifier(avant.includes("⚠ 1 doublon(s) dans le lancement"), "doublon signalé");
  verifier(!avant.includes("CVC26100318001"), "clé du doublon : pas de détail à l'écran");

  const [telechargement] = await Promise.all([page.waitForEvent("download"), carte.locator('[data-action="sans-doublons"]').click()]);
  verifier(telechargement.suggestedFilename() === "LAN264401FENO_corrige.xlsx", `nom : ${telechargement.suggestedFilename()}`);
  const corrige = path.join(captures, "web_LAN264401FENO_corrige.xlsx");
  await telechargement.saveAs(corrige);
  await page.waitForFunction(() => document.body.innerText.includes("en double supprimée"), null, { timeout: 30000 });
  verifier((await carte.innerText()).includes("✔ 1 ligne(s) en double supprimée(s) (CVC26100318001)"), "état de la case");
  verifier(alertes.some((a) => a.includes("L'original LAN264401FENO.xlsx n'a pas changé.")), "alerte : original inchangé");

  // Le fichier corrigé : intègre, 128 lignes, identique à l'original d'avant le doublon.
  const original = path.join(site, "s44", "LAN264401FENO.xlsx");
  const verif = execFileSync(python, ["-I", "-c", `
import sys, zipfile, openpyxl
a, b = sys.argv[1], sys.argv[2]
assert zipfile.ZipFile(b).testzip() is None
for formules in (False, True):
    wa = openpyxl.load_workbook(a, data_only=not formules)
    wb = openpyxl.load_workbook(b, data_only=not formules)
    assert wa.sheetnames == wb.sheetnames
    for fa, fb in zip(wa.worksheets, wb.worksheets):
        la = [[c.value for c in r] for r in fa.iter_rows()]
        lb = [[c.value for c in r] for r in fb.iter_rows()]
        assert la == lb, (fa.title, len(la), len(lb))
print("identique", wb.worksheets[0].max_row, "lignes")
`, original, corrige]).toString().trim();
  verifier(verif === "identique 128 lignes", `contenu du fichier corrigé : ${verif}`);

  // Rangé dans le dossier, le scan prend le fichier corrigé (le plus récent) : plus de doublon.
  fs.copyFileSync(corrige, path.join(dossier, "LAN264401FENO_corrige.xlsx"));
  ecrireListe([["LAN264401FENO.xlsx", 1792019886000], ["LAN264401FENO_corrige.xlsx", 1792019999000], ["LAN264401FENO bbackup.bkp", 1791880358000]]);
  texte = await scanner(page);
  await page.waitForFunction(() => document.body.innerText.includes("LAN264401FENO_corrige.xlsx") && document.body.innerText.includes("Tout est correct"), null, { timeout: 120000 });
  texte = await page.innerText("main");
  verifier(texte.includes("✔ Tout est correct — 101 pièces"), "lancement corrigé : 101 pièces, aucune anomalie");
  verifier(!texte.includes("doublon(s) dans le lancement"), "lancement corrigé : plus de doublon");
  await page.screenshot({ path: `${captures}/web_correction.png`, fullPage: true });

  await navigateur.close();
  fs.unlinkSync(path.join(dossier, "LAN264401FENO_corrige.xlsx"));
  console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : "\nTOUT EST OK");
  process.exit(echecs.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
