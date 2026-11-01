const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const erreurs = [];
  p.on("pageerror", (e) => erreurs.push(e.message));
  await p.goto("file://" + process.argv[2]);
  await p.waitForSelector("#btnChoisirDossier", { timeout: 20000 });
  console.log(await p.$$eval(".onglet-btn", (bs) => bs.map((x) => x.textContent).join(" | ")));
  console.log((await p.innerText("main")).slice(0, 300));
  console.log("erreurs JS :", erreurs.length ? erreurs : "aucune");
  await b.close();
})();
