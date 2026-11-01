// Lance le cœur de la réécriture (analyse, corrections, écriture, vérification) dans la page, sur des fichiers donnés.
// Usage : node test_reecriture_coeur.js <site> <sortie> <type> <fichier>...
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const [site, sortie, type, ...fichiers] = process.argv.slice(2);
(async () => {
  const nav = await chromium.launch();
  const page = await nav.newPage();
  page.on("pageerror", (e) => console.log("ERREUR JS:", e.message));
  await page.route("https://t.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(path.join(site, "index.html")), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://t.test/index.html");
  let echec = 0;
  for (const f of fichiers) {
    const res = await page.evaluate(async ({ octets, typeId }) => {
      try {
        const o = new Uint8Array(octets);
        const type = TYPES_REECRITURE.find((t) => t.id === typeId);
        const analyse = await analyserExtraction(o);
        const plan = planifierCorrections(analyse, type);
        const sortie = await ecrireLanCorrige(analyse, plan);
        await verifierLanCorrige(o, sortie, plan);
        return { ok: true, resume: resumeCorrections(plan, type), avert: plan.avertissements, n: plan.changements.length, octets: Array.from(sortie) };
      } catch (e) {
        return { ok: false, erreur: e.message };
      }
    }, { octets: Array.from(fs.readFileSync(f)), typeId: type });
    if (!res.ok) { echec++; console.log("ÉCHEC", path.basename(f), res.erreur); continue; }
    const dst = path.join(sortie, path.basename(f).replace(/\.xls[xm]$/i, "_sentinelle.xlsx"));
    fs.writeFileSync(dst, Buffer.from(res.octets));
    console.log("OK  ", path.basename(f), "|", res.n, "cellules |", res.resume, res.avert.length ? "| ⚠ " + res.avert.join(" / ") : "");
  }
  await nav.close();
  process.exit(echec ? 1 : 0);
})();
