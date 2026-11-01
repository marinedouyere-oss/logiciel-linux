// Envoi automatique au téléphone : activation, code, envoi chiffré sur le vrai mini-site, relecture et déchiffrement
// (comme l'appli), nouvel envoi après un changement de la bibliothèque.
// Usage : node test_web_lien_telephone.js <site> <sentinelle_partage.json.gz> <fichier où écrire le code>
const { chromium } = require("playwright"); const path = require("path"); const fs = require("fs"); const zlib = require("zlib");
const [site, partage, sortieCode] = process.argv.slice(2);
const ADRESSE = "https://sentinelle-laisne-0ysi8zpn.netlify.app";
let echecs = 0; const verifier = (ok, t) => { console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`); if (!ok) echecs++; };
const { subtle } = globalThis.crypto; const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((o) => o.toString(16).padStart(2, "0")).join("");
async function lireCommeLeTelephone(code) {
  const n = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const canal = hex(await subtle.digest("SHA-256", enc.encode("sentinelle-canal:" + n))).slice(0, 32);
  const base = await subtle.importKey("raw", enc.encode(n), "PBKDF2", false, ["deriveKey"]);
  const cle = await subtle.deriveKey({ name: "PBKDF2", salt: enc.encode("sentinelle-laisne-industrie"), iterations: 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const api = `${ADRESSE}/api/partage?canal=${canal}`;
  const m = await (await fetch(api)).json();
  const morceaux = [];
  for (let i = 0; i < m.parties; i++) morceaux.push(Buffer.from(await (await fetch(`${api}&version=${m.version}&partie=${i}`)).arrayBuffer()));
  const paquet = Buffer.concat(morceaux);
  if (paquet.subarray(0, 4).toString() !== "SNT1") throw new Error("paquet inconnu");
  const clair = Buffer.from(await subtle.decrypt({ name: "AES-GCM", iv: paquet.subarray(4, 16) }, cle, paquet.subarray(16)));
  return { manifeste: m, contenu: JSON.parse(zlib.gunzipSync(clair).toString("utf8")) };
}
(async () => {
  const nav = await chromium.launch(); const page = await nav.newPage({ viewport: { width: 1300, height: 900 } });
  page.on("pageerror", (e) => { console.log("ERREUR JS:", e.message); echecs++; }); page.on("dialog", (d) => d.accept());
  await page.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(path.join(site, "index.html")), headers: { "content-type": "text/html; charset=utf-8" } }));
  // Le mini-site : les demandes de la page passent par Node (même site réel).
  await page.route(`${ADRESSE}/**`, async (r) => {
    const q = r.request();
    const rep = await fetch(q.url(), { method: q.method(), headers: q.headers(), body: ["PUT", "POST"].includes(q.method()) ? q.postDataBuffer() : undefined });
    const corps = Buffer.from(await rep.arrayBuffer());
    await r.fulfill({ status: rep.status, body: corps, headers: { "content-type": rep.headers.get("content-type") || "application/octet-stream", "access-control-allow-origin": "*" } });
  });
  await page.goto("https://s.test/index.html");
  await page.evaluate(async (b64) => {
    const o = await navigator.storage.getDirectory(); for await (const [n] of o.entries()) await o.removeEntry(n, { recursive: true });
    const d = await o.getDirectoryHandle("Partage", { create: true });
    const w = await (await d.getFileHandle("sentinelle_partage.json.gz", { create: true })).createWritable(); await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); await w.close();
    window.showDirectoryPicker = async () => d;
  }, fs.readFileSync(partage).toString("base64"));
  await page.click('.onglet-btn[data-onglet="bibliotheque"]');
  await page.click("#btnDossierBibliotheque");
  await page.waitForFunction(() => /Semaines gardées \([1-9]/.test(document.querySelector("#pageBibliotheque").innerText));
  verifier(await page.isVisible("#btnActiverLien"), "carte « Téléphone (envoi automatique) » avec « Activer l'envoi au téléphone »");
  await page.click("#btnActiverLien");
  await page.waitForFunction(() => /Envoyé le|raté/.test((document.querySelector("#etatLien") || {}).innerText || ""), null, { timeout: 120000 });
  const code = (await page.textContent("#codeLien")).trim();
  const etat = await page.textContent("#etatLien");
  verifier(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), `code affiché : ${code}`);
  verifier(/Envoyé le/.test(etat), `état : ${etat.trim()}`);
  fs.writeFileSync(sortieCode, code);
  let lu = await lireCommeLeTelephone(code);
  const avec = (c) => c.semaines.filter((s) => s.lancements.length).length;
  const nbPc = await page.evaluate(() => [...bibliotheque.semaines.values()].filter((s) => s.lancements.length).length);
  verifier(lu.contenu.format === "sentinelle-partage-1" && avec(lu.contenu) === nbPc, `relu et déchiffré : ${avec(lu.contenu)} semaine(s), comme le PC (${nbPc})`);
  // Un changement de la bibliothèque part tout seul : on retire une semaine.
  const versionAvant = lu.manifeste.version;
  const id = await page.evaluate(() => [...bibliotheque.semaines.values()].find((s) => s.lancements.length).id);
  await page.evaluate((x) => { retirerSemaineBibliotheque(x); }, id);
  await page.click("#modaleConfirmationOk");
  await page.waitForFunction((v) => { const e = JSON.parse(localStorage.getItem("sentinelle-lien-telephone")); return e && e.dernierEnvoi && !e.erreur && e.nbSemaines !== undefined; }, versionAvant);
  for (let i = 0; i < 60; i++) { lu = await lireCommeLeTelephone(code); if (lu.manifeste.version !== versionAvant) break; await new Promise((r) => setTimeout(r, 1000)); }
  verifier(lu.manifeste.version !== versionAvant && avec(lu.contenu) === nbPc - 1, `changement envoyé tout seul : ${avec(lu.contenu)} semaine(s) maintenant`);
  await page.screenshot({ path: sortieCode.replace(/\.txt$/, ".png"), fullPage: true });
  await nav.close(); console.log(echecs ? `${echecs} ÉCHEC(S)` : "TOUT EST BON"); process.exit(echecs ? 1 : 0);
})();
