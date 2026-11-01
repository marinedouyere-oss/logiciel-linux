// Test de la page web Sentinelle : Diakonos de la semaine 46 (1er tour).
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
  const page = await navigateur.newPage({ viewport: { width: 1100, height: 1000 }, acceptDownloads: true });
  page.on("dialog", (d) => {
    console.log("ALERTE:", d.message());
    d.accept();
  });
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs.push("erreur JS : " + e.message);
  });
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      const liste = await (await fetch("liste_s46.json")).json();
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
              const octets = await (await fetch(`s46/${encodeURIComponent(f.nom)}`)).arrayBuffer();
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
  await page.waitForTimeout(500);
  await attendreFin(page);
  await page.waitForFunction(() => document.querySelector(".zone-diakonos").innerText.includes("Comparé à"), null, { timeout: 60000 });
  const texte = await page.innerText("main");
  const diak = await page.innerText(".zone-diakonos");
  console.log(diak);
  verifier(texte.includes("✔ Diakonos 1er tour : diakonos46t1.xlsx"), "Diakonos rangé par le scan");
  verifier(diak.includes("⚠ 3 pièce(s) Diakonos absente(s) des lancements du 1er tour"), "3 pièces manquantes");
  verifier(!diak.includes("CVC26100810001"), "pièces manquantes : pas de détail à l'écran (fichier des problèmes)");
  verifier(!diak.includes("CVC26100557001"), "pièce du recyclage non signalée");
  verifier(diak.includes("LAN264601START.xlsx") && diak.includes("LAN264601RECYCLAGE.xlsx"), "comparé au STRAT et au recyclage");
  await page.screenshot({ path: `${captures}/web_diakonos_46.png`, fullPage: true });
  const [telechargement] = await Promise.all([page.waitForEvent("download"), page.click("#btnExporterSemaine")]);
  await telechargement.saveAs(`${captures}/web_rapport_semaine_46.xlsx`);
  verifier(telechargement.suggestedFilename() === "rapport_sentinelle_semaine_46.xlsx", `rapport : ${telechargement.suggestedFilename()}`);
  verifier(diak.includes("Diakonos 1er tour (.xlsx)") && (await page.innerText(".carte-paire")).includes("Diakonos 1er tour (.xlsx)"),
    "Diakonos dans la case Agglo 1er tour");
  const carteRecyclage = await page.locator(".carte-paire", { hasText: "✓ LAN264601RECYCLAGE.xlsx" }).first().innerText();
  verifier(carteRecyclage.includes("02\nRecyclage") && !carteRecyclage.includes("Diakonos"), "recyclage : sa case, sous l'Agglo 1er tour, sans Diakonos");

  // Rapport du lancement : sommaire choisi dans la case Agglo 1er tour, puis un seul PDF.
  const sommaire = process.argv[4];
  if (sommaire) {
    const carte = page.locator(".carte-paire").first();
    const [choix] = await Promise.all([page.waitForEvent("filechooser"), carte.locator('[data-role="sommaire"]').click()]);
    await choix.setFiles(sommaire);
    await page.waitForFunction(() => document.querySelector(".carte-paire").innerText.includes("LAN264601START.pdf"), null, { timeout: 60000 });
    verifier((await carte.innerText()).includes("Sommaire Cut Rite (.pdf)\n✓ LAN264601START.pdf"), "sommaire rangé dans la case Agglo 1er tour");
    const [pdf] = await Promise.all([page.waitForEvent("download"), page.locator('.carte-paire [data-action="rapport-lancement"]').first().click()]);
    const chemin = `${captures}/web_${pdf.suggestedFilename()}`;
    await pdf.saveAs(chemin);
    verifier(pdf.suggestedFilename() === "LAN264601_rapport_lancement.pdf", `rapport du lancement : ${pdf.suggestedFilename()}`);
    const texte = require("child_process").execFileSync("pdftotext", ["-layout", chemin, "-"]).toString();
    const pages = require("child_process").execFileSync("pdfinfo", [chemin]).toString();
    verifier(/Pages:\s+5/.test(pages), "rapport du lancement : 5 pages");
    for (const attendu of ["Agglo : panneaux et restes", "Strats : panneaux et restes", "Couleurs de la feuille", "Diakonos 1er tour",
      "3 pièce(s) Diakonos absente(s) des lancements du 1er tour", "CVC26100810001", "SAG38HYBLLINEX", "Nombre de pièces", "340", "Couleurs semaine", "ROSE", "Document interne — LAISNÉ INDUSTRIE", "LAN264601 — Rapport du lancement", "Semaine", "46"]) {
      verifier(texte.includes(attendu), `rapport du lancement : « ${attendu} »`);
    }
  }

  // Ordre de la case : Diakonos, lancement, liste de coupe, .bkp, sommaire.
  const carteAgglo = await page.locator(".carte-paire").first().innerText();
  const ordre = ["Diakonos 1er tour (.xlsx)", "Lancement", "Liste de coupe", "Fichier .bkp", "Sommaire Cut Rite (.pdf)"].map((t) => carteAgglo.indexOf(t));
  verifier(ordre.every((v, i) => v >= 0 && (i === 0 || ordre[i - 1] < v)), `ordre de la case : ${ordre.join(", ")}`);

  // Recherche sans « CVC », dans les bases choisies.
  await page.click('.onglet-btn[data-onglet="recherche"]');
  const chercher = async (requete, bases) => {
    await page.evaluate((b) => document.querySelectorAll("#basesRecherche input").forEach((c) => (c.checked = b.includes(c.value))), bases);
    await page.fill("#champRecherche", requete);
    await page.click("#btnRechercher");
    await page.waitForFunction(() => !document.querySelector("#resultatsRecherche").innerText.includes("Recherche en cours"), null, { timeout: 120000 });
    return page.innerText("#resultatsRecherche");
  };
  const tout = ["Diakonos", "LAN", "Liste", ".bkp"];
  let r = await chercher("26100810001", tout);
  verifier(r.includes("Diakonos 1er tour (commandée)") && !r.includes("introuvable"), "recherche sans CVC : trouvée dans Diakonos");
  r = await chercher("26100557001", tout);
  verifier(r.includes("Recyclage LAN ×1") && r.includes("Diakonos 1er tour (commandée)"), "recherche : lancement et Diakonos");
  r = await chercher("26100557001", ["Diakonos"]);
  verifier(r.includes("Diakonos 1er tour (commandée)") && !r.includes("Chantier 2 LAN"), "recherche : Diakonos seulement");
  r = await chercher("26100810001", ["LAN"]);
  verifier(r.includes("introuvable"), "recherche : LAN seulement, pièce absente des lancements");
  r = await chercher("CVC26100810001", []);
  verifier(r.includes("Cochez au moins une base"), "recherche : aucune base cochée");
  await page.evaluate(() => document.querySelectorAll("#basesRecherche input").forEach((c) => (c.checked = true)));
  await page.screenshot({ path: `${captures}/web_recherche_bases.png`, fullPage: true });
  await page.click('.onglet-btn[data-onglet="paire"]');

  // Rechargement : le fichier Diakonos est retrouvé.
  await page.reload();
  await page.click('.onglet-btn[data-onglet="paire"]');
  await page.waitForSelector("#btnChoisirDossier");
  await page.waitForFunction(() => (document.querySelector(".zone-diakonos") || { innerText: "" }).innerText.includes("Comparé à"), null, { timeout: 60000 });
  verifier((await page.innerText(".zone-diakonos")).includes("3 pièce(s) Diakonos absente(s)"), "retrouvé après rechargement");

  await navigateur.close();
  console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : "\nTOUT EST OK");
  process.exit(echecs.length ? 1 : 0);
})();
