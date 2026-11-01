// Même contenu lu (lireStrat) pour l'export brut et sa copie au format Excel normal ?
const { chromium } = require("playwright"); const fs = require("fs"); const path = require("path");
const [site, dossierBrut, dossierNormal] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route("https://t.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(path.join(site, "index.html")), headers: { "content-type": "text/html; charset=utf-8" } }));
  await p.goto("https://t.test/index.html");
  const lire = (f) => p.evaluate(async ({ b64, nom }) => {
    const s = lireStrat(await chargerClasseur(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], nom)));
    return JSON.stringify(s.lignes.map((l) => [l.cle, l.pieces, l.lancement, l.longueurFinie, l.largeurFinie, (l.toutesDonnees || {}).agglo, (l.toutesDonnees || {}).coloris_inf]));
  }, { b64: fs.readFileSync(f).toString("base64"), nom: path.basename(f) });
  let ko = 0;
  for (const n of fs.readdirSync(dossierNormal)) {
    const a = await lire(path.join(dossierBrut, n)), c = await lire(path.join(dossierNormal, n));
    const same = a === c; if (!same) ko++;
    console.log(same ? "IDENTIQUE" : "DIFFÉRENT", n, JSON.parse(a).length, "lignes");
  }
  console.log(ko ? `${ko} DIFFÉRENT(S)` : "TOUT EST BON"); await b.close();
})();
