// V6.3, sur le vrai site de Sentinelle : le PC relit la demande déposée par l'appli (test Android retourSurLeVraiSite).
// Usage : node test_web_retour_vrai_site.js <index.html> <fichier du code de liaison>
const { chromium } = require("playwright");
const fs = require("fs");
const [pageHtml, fichierCode] = process.argv.slice(2);
(async () => {
  const code = fs.readFileSync(fichierCode, "utf8").trim();
  const nav = await chromium.launch();
  const page = await nav.newPage();
  page.on("pageerror", (e) => console.log("ERREUR JS:", e.message));
  await page.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://s.test/index.html");
  await page.waitForFunction(() => typeof lireRetourTelephone === "function");
  const r = await page.evaluate(async (code) => {
    ecrireLienTelephone({ code, signature: "x", dernierEnvoi: null, erreur: null });
    const n = await lireRetourTelephone();
    const t = retourPourPartage();
    return { n, erreur: retourTelephone.erreur, reponses: t ? Object.values(t.traitees).map((x) => `${x.ok}:${x.texte}`) : [], valide: Boolean(validationDe("LAN-ESSAI", { cle: "CVC00000000001", type: "Essai vrai site" })) };
  }, code);
  console.log(JSON.stringify(r));
  const ok = r.n >= 1 && !r.erreur && r.valide;
  console.log(ok ? "OK   demande de l'appli relue sur le vrai site, déchiffrée et reprise par le PC" : "ÉCHEC demande de l'appli pas relue sur le vrai site");
  await nav.close();
  process.exit(ok ? 0 : 1);
})();
