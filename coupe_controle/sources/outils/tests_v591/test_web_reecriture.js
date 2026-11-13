// Onglet Réécriture : l'extraction du Feno semaine 46 (LAN264602.xlsm) devient LAN264601FENO.xlsx,
// enregistré dans un vrai dossier du navigateur (OPFS). Scénarios : création du dossier de la semaine,
// fichier déjà présent (message bloquant, rien d'écrasé), dossier « Semaine NN » rangé dans année / mois,
// deux dossiers pour la même semaine (bloquant).
// Usage : node test_web_reecriture.js <site> <extraction.xlsm> <dossier de sortie>
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const [site, extraction, sortie] = process.argv.slice(2);
const base = "https://sentinelle.test";
let echecs = 0;
const verifier = (ok, texte) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${texte}`);
  if (!ok) echecs++;
};
(async () => {
  fs.mkdirSync(sortie, { recursive: true });
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 1000, height: 900 } });
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  await page.route(`${base}/**`, async (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
    const f = path.join(site, rel);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { "content-type": f.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" } });
  });
  await page.goto(base + "/index.html");
  await page.click('.onglet-btn[data-onglet="reecriture"]');
  await page.waitForSelector("#btnRacineReecriture");
  verifier((await page.innerText("#pageReecriture")).includes("aucun dossier choisi"), "onglet Réécriture affiché");

  // Dossier des semaines : un vrai dossier OPFS, vide.
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    for await (const [nom] of opfs.entries()) await opfs.removeEntry(nom, { recursive: true });
    window.racineTest = await opfs.getDirectoryHandle("Lancements", { create: true });
    window.showDirectoryPicker = async () => window.racineTest;
  });
  await page.click("#btnRacineReecriture");
  await page.waitForFunction(() => document.querySelector("#pageReecriture").innerText.includes("Lancements"), null, { timeout: 5000 }).catch(async () => console.log("TEXTE:", await page.innerText("#pageReecriture")));

  // Le fichier d'extraction.
  await page.setInputFiles("#choixExtraction", extraction);
  await page.waitForFunction(() => /onglet LAN264602, 118 ligne/.test(document.querySelector("#pageReecriture").innerText), null, { timeout: 15000 }).catch(async () => console.log("TEXTE:", await page.innerText("#pageReecriture")));
  verifier((await page.inputValue("#reecSemaine")) === "46" && (await page.inputValue("#reecAnnee")) === "26", "semaine 46 et année 26 lues dans le nom de l'onglet");
  verifier(await page.isDisabled("#btnReecrire"), "bouton bloqué tant que le type n'est pas choisi");
  await page.selectOption("#reecType", "feno");
  const apercu = await page.innerText("#reecApercu");
  console.log("APERÇU :", apercu.split("\n").slice(0, 4).join(" | "));
  verifier(apercu.includes("Nom : LAN264601FENO.xlsx — rangé dans Semaine 46 / FENO"), "nom réel et dossier");
  verifier(/seulement la protection/.test(apercu), "avertissement : pièce avec seulement la protection (CVC26100772)");

  // 1) La semaine n'existe pas : demande de création, puis enregistrement.
  await page.click("#btnReecrire");
  await page.waitForSelector("#modaleConfirmation:not(.masquee)");
  verifier((await page.innerText("#modaleConfirmationTitre")).includes("Créer le dossier « Semaine 46 »"), "demande de création du dossier de la semaine");
  await page.click("#modaleConfirmationOk");
  await page.waitForFunction(() => /Enregistré|impossible/.test((document.querySelector("#reecEtat") || {}).innerText || ""), null, { timeout: 60000 });
  const etat1 = await page.innerText("#reecEtat");
  console.log("ÉTAT :", etat1.replace(/\n/g, " | "));
  verifier(etat1.includes("✔ Enregistré : Lancements / Semaine 46 / FENO / LAN264601FENO.xlsx"), "enregistré dans Semaine 46 / FENO");
  const lire = async (chemin) =>
    page.evaluate(async (chemin) => {
      let d = window.racineTest;
      for (const c of chemin.slice(0, -1)) d = await d.getDirectoryHandle(c);
      const f = await (await d.getFileHandle(chemin[chemin.length - 1])).getFile();
      return { octets: Array.from(new Uint8Array(await f.arrayBuffer())), date: f.lastModified };
    }, chemin);
  const ecrit = await lire(["Semaine 46", "FENO", "LAN264601FENO.xlsx"]);
  fs.writeFileSync(path.join(sortie, "LAN264601FENO.xlsx"), Buffer.from(ecrit.octets));
  console.log("FICHIER :", ecrit.octets.length, "octets");

  // 2) Le fichier existe déjà : message bloquant (un seul bouton), rien n'est écrasé.
  await page.waitForTimeout(50);
  await page.click("#btnReecrire");
  await page.waitForSelector("#modaleConfirmation:not(.masquee)");
  verifier((await page.innerText("#modaleConfirmationTitre")) === "Le fichier existe déjà", "message bloquant : le fichier existe déjà");
  verifier(await page.isHidden("#modaleConfirmationAnnuler"), "message bloquant : seulement OK");
  await page.click("#modaleConfirmationOk");
  await page.waitForFunction(() => /existe déjà/.test((document.querySelector("#reecEtat") || {}).innerText || ""));
  const apres = await lire(["Semaine 46", "FENO", "LAN264601FENO.xlsx"]);
  verifier(apres.date === ecrit.date && apres.octets.length === ecrit.octets.length && apres.octets.every((o, i) => o === ecrit.octets[i]), "fichier existant pas touché");

  // 3) Les semaines rangées par année / mois : le dossier « Semaine 47 » existant est retrouvé ;
  //    le sous-dossier 1ER TOUR AGGLO est créé ; agglo : pas de correction, juste le vrai nom.
  await page.evaluate(async () => {
    const mois = await (await window.racineTest.getDirectoryHandle("2026", { create: true })).getDirectoryHandle("11 Novembre", { create: true });
    await mois.getDirectoryHandle("Semaine 47", { create: true });
  });
  await page.fill("#reecSemaine", "47");
  await page.selectOption("#reecType", "agglo1");
  verifier((await page.innerText("#reecApercu")).includes("Nom : LAN264701START.xlsx — rangé dans Semaine 47 / 1ER TOUR AGGLO"), "agglo 1er tour : nom LAN264701START");
  await page.click("#btnReecrire");
  await page.waitForFunction(() => /Enregistré|impossible/.test((document.querySelector("#reecEtat") || {}).innerText || ""), null, { timeout: 60000 });
  const etat3 = await page.innerText("#reecEtat");
  console.log("ÉTAT :", etat3.replace(/\n/g, " | "));
  verifier(etat3.includes("Lancements / 2026 / 11 Novembre / Semaine 47 / 1ER TOUR AGGLO / LAN264701START.xlsx"), "dossier de la semaine retrouvé sous année / mois");
  const agglo = await lire(["2026", "11 Novembre", "Semaine 47", "1ER TOUR AGGLO", "LAN264701START.xlsx"]);
  fs.writeFileSync(path.join(sortie, "LAN264701START.xlsx"), Buffer.from(agglo.octets));

  // 4) Chantier : nom tapé, dossier CHANTIERS.
  await page.selectOption("#reecType", "chantier");
  await page.fill("#reecChantier", "AIRDESIGN");
  verifier((await page.innerText("#reecApercu")).includes("Nom : LAN2647AIRDESIGN.xlsx — rangé dans Semaine 47 / CHANTIERS"), "chantier : LAN2647AIRDESIGN dans CHANTIERS");

  // 5) Deux dossiers « Semaine 46 » : message bloquant, rien d'enregistré.
  await page.evaluate(async () => {
    await (await window.racineTest.getDirectoryHandle("2025", { create: true })).getDirectoryHandle("Semaine 46", { create: true });
  });
  await page.fill("#reecSemaine", "46");
  await page.selectOption("#reecType", "casse");
  await page.click("#btnReecrire");
  await page.waitForSelector("#modaleConfirmation:not(.masquee)");
  verifier((await page.innerText("#modaleConfirmationTitre")) === "Plusieurs dossiers pour cette semaine", "deux dossiers Semaine 46 : bloquant");
  await page.click("#modaleConfirmationOk");
  const casse = await page.evaluate(async () => {
    try {
      await (await window.racineTest.getDirectoryHandle("Semaine 46")).getDirectoryHandle("CASSE");
      return true;
    } catch (_e) {
      return false;
    }
  });
  verifier(!casse, "rien d'écrit pour la casse");

  // 6) Un fichier qui n'est pas un classeur : message clair.
  const faux = path.join(sortie, "pas_un_classeur.xlsx");
  fs.writeFileSync(faux, "bonjour");
  await page.setInputFiles("#choixExtraction", faux);
  await page.waitForFunction(() => /Fichier illisible/.test(document.querySelector("#pageReecriture").innerText));
  verifier(await page.isDisabled("#btnReecrire"), "fichier illisible : bouton bloqué");

  await page.screenshot({ path: path.join(sortie, "onglet_reecriture.png"), fullPage: true });
  await navigateur.close();
  console.log(echecs ? `${echecs} ÉCHEC(S)` : "TOUT EST BON");
  process.exit(echecs ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
