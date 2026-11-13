// Données d'exemple du compte rendu de la semaine : import de l'archive dans la bibliothèque (page Sentinelle),
// puis, pour la semaine demandée, les lancements (pièces) et la casse classée Casse / Retard / Rajout.
// Usage : node exemple_compte_rendu.js <site> <archive> <semaine> <sortie.json>
const { chromium } = require("playwright"); const path = require("path"); const fs = require("fs");
const [site, archive, semaine, sortie] = process.argv.slice(2);
const lister = (d, c = []) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? lister(path.join(d, e.name), [...c, e.name]) : [{ chemin: c, nom: e.name, source: path.join(d, e.name) }]));
(async () => {
  const nav = await chromium.launch(); const page = await nav.newPage();
  await page.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(path.join(site, "index.html")), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://s.test/index.html");
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    for await (const [nom] of opfs.entries()) await opfs.removeEntry(nom, { recursive: true });
    window.racine = await opfs.getDirectoryHandle("Lancement", { create: true });
  });
  for (const f of lister(archive)) {
    await page.evaluate(async ({ chemin, nom, b64 }) => {
      let d = window.racine; for (const c of chemin) d = await d.getDirectoryHandle(c, { create: true });
      const w = await (await d.getFileHandle(nom, { create: true })).createWritable();
      await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); await w.close();
    }, { chemin: f.chemin, nom: f.nom, b64: fs.readFileSync(f.source).toString("base64") });
  }
  await page.evaluate(() => (window.showDirectoryPicker = async () => window.racine));
  await page.click('.onglet-btn[data-onglet="bibliotheque"]');
  await page.click("#btnImporterSemaines");
  await page.waitForFunction(() => /ajouté|impossible/.test((document.querySelector("#pageBibliotheque .compte-rendu") || {}).innerText || ""), null, { timeout: 600000 });
  const donnees = await page.evaluate((sem) => {
    const s = [...bibliotheque.semaines.values()].find((x) => x.semaine === Number(sem));
    const avant = ordreSemaine(s.annee, s.semaine);
    // Commandes déjà lancées avant (hors casse), d'après la bibliothèque.
    const commandes = new Set();
    for (const t of bibliotheque.semaines.values()) if (ordreSemaine(t.annee, t.semaine) < avant) for (const l of t.lancements) if (!l.casse) for (const p of l.pieces) commandes.add(p[1]);
    return s.lancements.map((l) => {
      const r = { nom: l.nom, poste: l.poste, casse: l.casse, pieces: l.nbPieces };
      if (l.casse) {
        r.categories = { casse: 0, retard: 0, rajout: 0 };
        for (const p of l.pieces) {
          const n = Number(p[4]) || 0;
          if (derniereFoisLancee(p[0], avant)) r.categories.casse += n;
          else if (commandes.has(p[1])) r.categories.retard += n;
          else r.categories.rajout += n;
        }
      }
      return r;
    });
  }, semaine);
  fs.writeFileSync(sortie, JSON.stringify(donnees, null, 1));
  console.log(JSON.stringify(donnees));
  await nav.close();
})();
