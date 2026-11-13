const { chromium } = require("playwright"); const fs = require("fs"); const path = require("path");
const [site, fichier] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route("https://t.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(path.join(site, "index.html")), headers: { "content-type": "text/html; charset=utf-8" } }));
  await p.goto("https://t.test/index.html");
  const r = await p.evaluate(async ({ b64, nom }) => {
    const f = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], nom);
    try { const s = lireStrat(await chargerClasseur(f)); return { n: s.lignes.length, l: s.lignes.slice(0, 2).map((x) => ({ cle: x.cle, pieces: x.pieces, lancement: x.lancement, agglo: (x.toutesDonnees || {}).agglo })) }; }
    catch (e) { return { erreur: e.message }; }
  }, { b64: fs.readFileSync(fichier).toString("base64"), nom: path.basename(fichier) });
  console.log(JSON.stringify(r)); await b.close();
})();
