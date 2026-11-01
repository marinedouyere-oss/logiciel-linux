// Envoi au téléphone comme sur le PC : page servie par le .exe (http://127.0.0.1:47815), vrai navigateur, vrai réseau.
const { chromium } = require("playwright");
(async () => {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const nav = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "127.0.0.1,localhost" } } : {});
  const ctx = await nav.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on("console", (m) => console.log("CONSOLE", m.type(), m.text()));
  page.on("requestfailed", (r) => console.log("ÉCHEC REQUÊTE", r.method(), r.url().slice(0, 90), r.failure() && r.failure().errorText));
  page.on("response", (r) => { if (r.url().includes("netlify")) console.log("RÉPONSE", r.request().method(), r.status(), r.url().slice(0, 90)); });
  page.on("dialog", (d) => d.accept());
  await page.goto("http://127.0.0.1:47815/");
  await page.click('.onglet-btn[data-onglet="bibliotheque"]');
  await page.click("#btnActiverLien");
  await page.waitForFunction(() => /Envoyé le|raté/.test((document.querySelector("#etatLien") || {}).innerText || ""), null, { timeout: 90000 }).catch(() => {});
  console.log("CODE", await page.textContent("#codeLien").catch(() => "?"), "| ÉTAT", await page.textContent("#etatLien").catch(() => "?"));
  await nav.close();
})();
