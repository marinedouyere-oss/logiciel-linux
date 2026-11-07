// Semaine 47 réelle : valider un problème « c'est voulu » (Recyclage + 2ème tour), case « Feno 2 », fichiers sans
// lancement signalés (RETARD6087), semaine lue dans la colonne com_livsem du fichier.
// Usage : node test_web_validation.js <site> [capture.png]
// <site> contient index.html et « s46d/Semaine 47 » (1ER TOUR AGGLO, 2EME TOUR AGGLO, CASSE, CHANTIERS, FENO).
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const [site, capture] = process.argv.slice(2);
const base = "https://sentinelle.test";
let echecs = 0;
function verifier(condition, message) {
  console.log(`${condition ? "OK  " : "ÉCHEC"} ${message}`);
  if (!condition) echecs++;
}
function lister(dossier, chemin = []) {
  const res = [];
  for (const e of fs.readdirSync(path.join(dossier, ...chemin), { withFileTypes: true })) {
    if (e.isDirectory()) res.push(...lister(dossier, [...chemin, e.name]));
    else res.push({ chemin, nom: e.name, date: 1792999133913 });
  }
  return res;
}
const DEUX_FOIS = ["CVC26100827002", "CVC26100696004", "CVC26100832005"];

(async () => {
  fs.writeFileSync(path.join(site, "liste_s46d.json"), JSON.stringify(lister(path.join(site, "s46d", "Semaine 47"))));
  const nav = await chromium.launch();
  const contexte = await nav.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await contexte.newPage();
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      const liste = await (await fetch("liste_s46d.json", { cache: "no-store" })).json();
      const dossier = (nom, chemin) => ({
        kind: "directory", name: nom,
        async queryPermission() { return "granted"; },
        async requestPermission() { return "granted"; },
        async *entries() {
          const sous = new Set();
          for (const f of liste) {
            if (f.chemin.length < chemin.length || chemin.some((c, i) => f.chemin[i] !== c)) continue;
            if (f.chemin.length > chemin.length) { sous.add(f.chemin[chemin.length]); continue; }
            yield [f.nom, { kind: "file", name: f.nom, async getFile() {
              const url = ["s46d", "Semaine 47", ...f.chemin, f.nom].map(encodeURIComponent).join("/");
              return new File([await (await fetch(url, { cache: "no-store" })).arrayBuffer()], f.nom, { lastModified: f.date });
            } }];
          }
          for (const s of sous) yield [s, dossier(s, [...chemin, s])];
        },
      });
      return dossier("Semaine 47", []);
    };
  });
  await page.route(`${base}/**`, async (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
    const f = path.join(site, rel);
    if (!f.startsWith(site) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { "content-type": f.endsWith(".html") ? "text/html; charset=utf-8" : f.endsWith(".json") ? "application/json" : "application/octet-stream" } });
  });
  await page.goto(base + "/index.html");

  // 1. Semaine lue dans la colonne com_livsem (« 47.0 » vaut 47) ; la casse 46 se fabrique en 47.
  const semaines = await page.evaluate(() => ({
    bsr: semaineDuLancement([], false, "LAN2646BSR.xlsx", null, [{ annee: "2026.0", semaine: "47.0", nbPieces: 2 }]),
    casse: semaineDuLancement([], true, "LAN2646CASSE.xlsx", null, [{ annee: "2026", semaine: "46", nbPieces: 49 }, { annee: "2026", semaine: "45", nbPieces: 12 }]),
    sansColonne: semaineDuLancement([{ lancement: "LAN264402" }], false, "LAN264402STRAT.xlsx", null, []),
  }));
  verifier(semaines.bsr && semaines.bsr.semaine === 47 && semaines.bsr.annee === 2026, "colonne com_livsem 47 : semaine 47 (même si la colonne lancement dit LAN2646BSR)");
  verifier(semaines.casse && semaines.casse.semaine === 47, "casse : semaine de la colonne (46) + 1 = 47");
  verifier(semaines.sansColonne && semaines.sansColonne.semaine === 44, "colonne vide : semaine du code lancement");

  // 2. Scan de la semaine 47.
  await page.click('.onglet-btn[data-onglet="impaire2"]'); // V6.1 : semaine 47 = onglet « impaire2 » (47 modulo 4 = 3)
  await page.waitForSelector("#btnChoisirDossier");
  await page.click("#btnChoisirDossier");
  await page.waitForSelector("#btnScanner:not([disabled])");
  await page.click("#btnScanner");
  await page.waitForFunction(() => /Dossiers lus/.test(document.querySelector("#carteDossier").innerText), null, { timeout: 180000 });
  await page.waitForFunction(() => !document.querySelector("#btnScanner").disabled, null, { timeout: 300000 });
  await page.waitForFunction(() => /lancée\(s\) deux fois/.test(document.querySelector("#zoneRecap").innerText), null, { timeout: 120000 });
  let texte = await page.innerText("main");
  verifier(/Sans fichier de lancement.*RETARD6087/.test(texte), "RETARD6087 (liste, .bkp, sommaire sans LAN) : signalé au scan");
  // V6.1 : la case chantier porte le nom du lancement (« CHANTIERS BIS »).
  verifier(/CHANTIERS BIS \(sem 47\)/.test(texte) && !/\(sem 46\)/.test(texte), "LAN2647CHANTIERSBIS (colonne lancement LAN2646BSR) : semaine 47");
  verifier(texte.includes("⚠ 3 pièce(s) lancée(s) deux fois"), "3 pièces lancées deux fois (Recyclage et 2ème tour)");

  // 3. Les problèmes de l'Agglo 2ème tour : une ligne, la liste s'ouvre d'un clic.
  const carte2 = page.locator(".carte-paire", { hasText: "✓ LAN264702START.xlsx" }).first();
  const zone2 = carte2.locator(".zone-problemes");
  verifier(/Problèmes du lancement : .*à corriger/.test(await zone2.innerText()) && !(await zone2.innerText()).includes(DEUX_FOIS[0]), "Agglo 2ème tour : une ligne, pas de détail avant le clic");
  await zone2.locator('[data-action="ouvrir-problemes"]').click();
  texte = await zone2.innerText();
  verifier(texte.includes("Lancée deux fois — 3 pièce(s)") && DEUX_FOIS.every((c) => texte.includes(c)), "liste ouverte : les 3 pièces lancées deux fois");
  for (const cle of DEUX_FOIS) await zone2.locator(".probleme", { hasText: cle }).locator("[data-valider]").first().click();
  texte = await zone2.innerText();
  verifier(texte.includes("Validé OK (voulu) — 3 pièce(s)") && !texte.includes("Lancée deux fois — "), "les 3 pièces validées : groupe « Validé OK »");
  const recap = await page.innerText("#zoneRecap");
  verifier(recap.includes("✔ 3 pièce(s) dans deux lancements, validée(s) OK") && !recap.includes("⚠ 3 pièce(s) lancée(s) deux fois"), "tableau : plus d'alerte « lancée deux fois »");
  const recyclage = page.locator(".carte-paire", { hasText: "✓ LAN264701RECYCLAGE.xlsx" }).first().locator(".zone-problemes");
  const texteRecyclage = await recyclage.innerText();
  verifier(!/Lancée deux fois/.test(texteRecyclage) && /validé\(s\) OK/.test(texteRecyclage), "Recyclage : validées aussi (même pièces)");

  // 4. La bibliothèque (et le téléphone) : les problèmes marqués validés, plus comptés.
  await page.waitForFunction(() => {
    const s = [...bibliotheque.semaines.values()].find((x) => x.semaine === 47);
    const l = s && s.lancements.find((x) => x.nom === "LAN264702START");
    return l && l.problemes.some((e) => e.valide);
  }, null, { timeout: 120000 });
  const biblio = await page.evaluate((cles) => {
    const s = [...bibliotheque.semaines.values()].find((x) => x.semaine === 47);
    const l = s.lancements.find((x) => x.nom === "LAN264702START");
    return {
      valides: l.problemes.filter((e) => e.valide && e.niveau === "valide" && e.type === "Lancée deux fois").map((e) => e.cle),
      restants: l.problemes.filter((e) => !e.valide && e.type === "Lancée deux fois").length,
      bilan: (l.controle.bilan.find((b) => b.controle === "Autres lancements de la semaine") || {}).statut,
    };
  }, DEUX_FOIS);
  verifier(DEUX_FOIS.every((c) => biblio.valides.includes(c)) && biblio.restants === 0, "bibliothèque : les 3 pièces marquées validées");
  verifier(biblio.bilan === "ok", "bibliothèque : contrôle « autres lancements » OK");

  // 5. Rapport Excel du lancement : validés à part, plus comptés.
  const rapport = await page.evaluate(async () => {
    const p = pairesDeLaSemaine("impaire2").find((x) => x.strat && x.strat.name === "LAN264702START.xlsx");
    const r = await feuilleRapportLancement(new ExcelJS.Workbook(), p, "Rapport");
    return { nbValides: r.nbValides, lancees: r.problemes.filter((e) => e.id.endsWith("|Lancée deux fois")).length };
  });
  verifier(rapport.nbValides === 3 && rapport.lancees === 0, "rapport du lancement : 3 validés, plus de « lancée deux fois » à traiter");

  // 6. Après rechargement : les validations restent.
  await page.reload();
  await page.click('.onglet-btn[data-onglet="impaire2"]'); // V6.1 : semaine 47 = onglet « impaire2 » (47 modulo 4 = 3)
  await page.waitForSelector(".carte-paire");
  const zoneApres = page.locator(".carte-paire", { hasText: "✓ LAN264702START.xlsx" }).first().locator(".zone-problemes");
  // Les problèmes sont relus en fond à l'ouverture de la semaine (sinon : bouton « Voir les problèmes »).
  await page.waitForFunction(() => {
    const carte = [...document.querySelectorAll(".carte-paire")].find((c) => c.innerText.includes("✓ LAN264702START.xlsx"));
    const zone = carte && carte.querySelector(".zone-problemes");
    if (zone && zone.querySelector('[data-action="voir-problemes"]:not([disabled])')) zone.querySelector('[data-action="voir-problemes"]').click();
    return Boolean(zone && zone.querySelector('[data-action="ouvrir-problemes"]'));
  }, null, { timeout: 120000, polling: 500 });
  await zoneApres.locator('[data-action="ouvrir-problemes"]').click();
  texte = await zoneApres.innerText();
  verifier(texte.includes("Validé OK (voulu) — 3 pièce(s)"), "après rechargement : toujours validées");
  // Annuler une validation : le problème revient.
  await zoneApres.locator(".probleme", { hasText: DEUX_FOIS[0] }).locator("[data-annuler]").click();
  texte = await zoneApres.innerText();
  verifier(texte.includes("Lancée deux fois — 1 pièce(s)") && texte.includes("Validé OK (voulu) — 2 pièce(s)"), "annuler : le problème revient");

  // 7. Ajouter un lancement Feno : case « Feno 2 », qui se retire.
  await page.click('[data-ajouter-poste="Feno"]');
  const feno2 = page.locator(".carte-paire", { hasText: "Feno 2" }).first();
  verifier((await feno2.count()) === 1 && (await feno2.innerText()).includes("Aucun fichier"), "« + Ajouter un lancement Feno » : case Feno 2");
  verifier((await page.innerText("#listePostes")).includes("Feno 2"), "Feno 2 dans la liste des postes");
  if (capture) await page.screenshot({ path: capture, fullPage: true });
  await feno2.locator('[data-action="retirer"]').click();
  await page.click("#modaleConfirmationOk");
  await page.waitForTimeout(500);
  verifier((await page.locator(".carte-paire", { hasText: "Feno 2" }).count()) === 0, "Feno 2 retiré");

  await nav.close();
  console.log(echecs ? `${echecs} ÉCHEC(S)` : "TOUT EST OK");
  process.exitCode = echecs ? 1 : 0;
})();
