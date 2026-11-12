// V6.5.5 : tout lancement mis dans une case du PC entre dans la bibliothèque (donc part au téléphone), même sans
// « Lancer les contrôles » de toute la semaine. Cas réel du 10/11 : un lancement visible sur le PC, jamais sur le
// téléphone, parce qu'il n'était pas dans la bibliothèque. Un lancement qui ne peut pas y entrer est signalé.
// Usage : node test_web_lancement_bibliotheque.js <index.html> <LAN264801START.xlsx>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [pageHtml, lan] = process.argv.slice(2);
const ORIGINE = "http://127.0.0.1:47998";
let echecs = 0;
const verifier = (ok, t) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`);
  if (!ok) echecs++;
};
const attendre = async (cond, ms = 15000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

(async () => {
  const nav = await chromium.launch();
  const page = await (await nav.newContext()).newPage();
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  page.on("dialog", (d) => d.accept());
  const envois = [];
  await page.route(`${ORIGINE}/**`, (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith("/sentinelle/")) return r.fulfill({ status: 404, body: "" });
    return r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } });
  });
  const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,PUT,POST", "access-control-allow-headers": "*" };
  await page.route("https://sentinelle-laisne-0ysi8zpn.netlify.app/**", (r) => {
    const m = r.request().method();
    if (m === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
    if (m === "PUT" || m === "POST") {
      envois.push(m);
      return r.fulfill({ status: 200, contentType: "application/json", body: "{}", headers: cors });
    }
    return r.fulfill({ status: 404, contentType: "application/json", body: "{}", headers: cors });
  });
  await page.addInitScript(() => localStorage.setItem("sentinelle-lien-telephone", JSON.stringify({ code: "ABCD-EFGH-JKLM-NPQR", signature: null })));
  await page.goto(`${ORIGINE}/index.html`);
  await page.waitForFunction(() => typeof archiverLancementsManquants === "function" && typeof SUIVI !== "undefined" && SUIVI.etat.charge, null, { timeout: 30000 });
  const dans = () => page.evaluate(() => [...bibliotheque.semaines.values()].some((s) => s.lancements.some((l) => /LAN264801START/.test(l.nom))));

  // 1. Le fichier mis à la main dans une case (sans « Lancer les contrôles ») : il entre dans la bibliothèque.
  await page.evaluate(() => {
    fichierEnAttente = { p: paireFixe("Agglo 1er tour", "paire"), role: "strat" };
  });
  await page.setInputFiles("#choixFichier", lan);
  verifier(await attendre(dans), `fichier mis dans une case : le lancement entre dans la bibliothèque (sans « Lancer les contrôles »)`);
  verifier(await attendre(async () => envois.includes("POST")), `… et part au téléphone`);

  // 2. À l'ouverture : un lancement des cases absent de la bibliothèque y entre.
  await page.evaluate(() => {
    for (const s of bibliotheque.semaines.values()) s.lancements = s.lancements.filter((l) => !/LAN264801START/.test(l.nom));
  });
  verifier(!(await dans()), `(lancement retiré de la bibliothèque pour l'essai)`);
  const n = await page.evaluate(() => archiverLancementsManquants());
  verifier(n === 1 && (await dans()), `ouverture : le lancement de la case revient dans la bibliothèque (${n})`);
  const n2 = await page.evaluate(() => archiverLancementsManquants());
  verifier(n2 === 0, `rien à faire quand tout y est déjà`);

  // 3. Contrôle d'une case seule : la bibliothèque est mise à jour (2 s après).
  await page.evaluate(() => {
    for (const s of bibliotheque.semaines.values()) s.lancements = s.lancements.filter((l) => !/LAN264801START/.test(l.nom));
    planifierArchivageValidations("paire");
  });
  verifier(await attendre(dans), `contrôle d'une case seule : le lancement entre dans la bibliothèque`);

  // 4. Un lancement illisible : signalé en rouge sur la carte Téléphone (avant : écarté sans rien dire).
  await page.evaluate(async () => {
    const p = paireFixe("Recyclage", "paire");
    p.strat = new File([new Uint8Array([1, 2, 3, 4])], "LAN264801RECYCLAGE.xlsx");
    await archiverOnglet("paire", null, (x) => x === p);
  });
  await page.click('[data-onglet="bibliotheque"]');
  const carte = await page.locator("#carteLienTelephone").innerText();
  verifier(/pas envoyé au téléphone/.test(carte) && /LAN264801RECYCLAGE/.test(carte), `lancement illisible : « pas envoyé au téléphone » sur la carte, avec son nom`);

  await nav.close();
  console.log(echecs ? `${echecs} échec(s)` : "TOUT EST OK");
  process.exit(echecs ? 1 : 0);
})();
