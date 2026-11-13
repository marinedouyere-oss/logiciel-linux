// Chaque fichier : lu par chargerClasseur + lireStrat (comme le scan et la bibliothèque) ?
const { chromium } = require("playwright"); const fs = require("fs"); const path = require("path");
const [site, ...fichiers] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route("https://t.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(path.join(site, "index.html")), headers: { "content-type": "text/html; charset=utf-8" } }));
  await p.goto("https://t.test/index.html");
  let ok = 0; const ko = [];
  for (const f of fichiers) {
    const r = await p.evaluate(async ({ b64, nom }) => {
      const fi = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], nom);
      try { return { n: lireStrat(await chargerClasseur(fi)).lignes.length }; } catch (e) { return { erreur: e.message }; }
    }, { b64: fs.readFileSync(f).toString("base64"), nom: path.basename(f) });
    if (r.erreur) ko.push(`${path.basename(f)} : ${r.erreur}`); else ok++;
  }
  console.log(`lus : ${ok} / ${fichiers.length}`); ko.forEach((x) => console.log("  ILLISIBLE", x));
  await b.close();
})();
