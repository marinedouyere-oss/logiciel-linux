// La page servie par le programme Sentinelle (.exe) : chargée, à jour, dossiers possibles, signe de vie.
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const erreurs = [];
  p.on("pageerror", (e) => erreurs.push(e.message));
  let vie = 0;
  p.on("response", (r) => { if (r.url().endsWith("/sentinelle/vivant") && r.status() === 204) vie++; });
  await p.goto("http://127.0.0.1:47815/");
  await p.waitForTimeout(2500);
  const r = await p.evaluate(async () => ({
    titre: document.title,
    badge: document.querySelector(".badge-version").textContent,
    securise: window.isSecureContext,
    dossiers: typeof window.showDirectoryPicker,
    sw: (await navigator.serviceWorker.getRegistrations()).length,
  }));
  console.log(JSON.stringify(r), "signes de vie:", vie, "erreurs:", erreurs.length ? erreurs : "aucune");
  await p.click('.onglet-btn[data-onglet="reecriture"]');
  await p.setInputFiles("#choixExtraction", process.argv[2]);
  await p.waitForFunction(() => /ligne\(s\)/.test(document.querySelector("#pageReecriture").innerText), null, { timeout: 15000 });
  await p.click('.type-btn[data-type="feno"]');
  console.log("nom:", await p.innerText("#reecNom"));
  await p.screenshot({ path: process.argv[3] });
  const ok = r.titre.includes("V6.0.1") && r.badge === "V6.0.1" && r.securise && r.dossiers === "function" && r.sw === 0 && vie >= 1 && !erreurs.length;
  console.log(ok ? "TOUT EST BON" : "ÉCHEC");
  await b.close();
  process.exit(ok ? 0 : 1);
})();
