// Envoi au téléphone quand le réseau ne répond pas : l'envoi ne reste pas bloqué sur « Envoi en cours », il dit
// pourquoi (le site répond en lecture, l'envoi n'aboutit pas), prévoit un nouvel essai, puis repart quand le réseau revient.
// Usage : node test_web_lien_bloque.js <index.html> <sentinelle_partage.json.gz> <capture.png>
const { chromium } = require("playwright"); const fs = require("fs");
const [pageHtml, partage, capture] = process.argv.slice(2);
const ADRESSE = "https://sentinelle-laisne-0ysi8zpn.netlify.app";
let echecs = 0; const verifier = (ok, t) => { console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`); if (!ok) echecs++; };
(async () => {
  const nav = await chromium.launch(); const page = await nav.newPage({ viewport: { width: 1300, height: 900 } });
  page.on("pageerror", (e) => { console.log("ERREUR JS:", e.message); echecs++; }); page.on("dialog", (d) => d.accept());
  await page.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } }));
  let reseau = "bloque"; const recus = [];
  await page.route(`${ADRESSE}/**`, async (r) => {
    const q = r.request(); const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
    if (q.method() === "GET") return r.fulfill({ status: 404, body: JSON.stringify({ erreur: "rien pour ce code" }), headers: cors });
    if (reseau === "bloque") return; // jamais de réponse (envoi retenu par le réseau)
    recus.push(q.method());
    return r.fulfill({ status: 200, body: JSON.stringify({ ok: true }), headers: cors });
  });
  await page.goto("https://s.test/index.html");
  await page.evaluate(async (b64) => {
    const o = await navigator.storage.getDirectory(); for await (const [n] of o.entries()) await o.removeEntry(n, { recursive: true });
    const d = await o.getDirectoryHandle("Partage", { create: true });
    const w = await (await d.getFileHandle("sentinelle_partage.json.gz", { create: true })).createWritable(); await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); await w.close();
    window.showDirectoryPicker = async () => d;
    lienTelephone.delaiMax = 4000;
  }, fs.readFileSync(partage).toString("base64"));
  await page.click('.onglet-btn[data-onglet="bibliotheque"]');
  await page.click("#btnDossierBibliotheque");
  await page.waitForFunction(() => /Semaines gardées \([1-9]/.test(document.querySelector("#pageBibliotheque").innerText));
  await page.click("#btnActiverLien");
  await page.waitForFunction(() => /Envoi en cours… \(envoi [\d,]+ (Mo|Ko)\)/.test((document.querySelector("#etatLien") || {}).innerText || ""), null, { timeout: 30000 });
  verifier(true, `pendant l'envoi : ${(await page.textContent("#etatLien")).trim()}`);
  await page.waitForFunction(() => /raté/.test((document.querySelector("#etatLien") || {}).innerText || ""), null, { timeout: 30000 });
  const rate = (await page.textContent("#etatLien")).trim();
  console.log("   " + rate);
  verifier(/le site ne répond pas \(rien en 4 s\) à l'étape « envoi [\d,]+ (Mo|Ko) »/.test(rate), "réseau muet : l'envoi s'arrête au bout du délai et dit à quelle étape");
  verifier(/le site répond en lecture : c'est l'envoi qui n'aboutit pas/.test(rate), "diagnostic : le site répond en lecture, c'est l'envoi qui est bloqué");
  verifier(/Nouvel essai à \d\d:\d\d/.test(rate), "nouvel essai prévu tout seul");
  verifier(await page.isEnabled("#btnEnvoyerLien"), "« Envoyer maintenant » de nouveau cliquable");
  reseau = "ok";
  await page.click("#btnEnvoyerLien");
  await page.waitForFunction(() => /Envoyé le/.test((document.querySelector("#etatLien") || {}).innerText || ""), null, { timeout: 30000 });
  verifier(recus.join() === "PUT,POST", `réseau revenu : envoi réussi (${recus.join(", ")})`);
  await page.screenshot({ path: capture, fullPage: true });
  await nav.close(); console.log(echecs ? `${echecs} ÉCHEC(S)` : "TOUT EST BON"); process.exit(echecs ? 1 : 0);
})();
