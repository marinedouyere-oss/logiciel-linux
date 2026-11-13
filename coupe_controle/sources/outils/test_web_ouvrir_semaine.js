// « Contrôler la coupe » : on tape une semaine, Sentinelle trouve « Semaine NN » dans le dossier « Lancement »
// (année / mois compris), le scanne ; la casse rangée dans « Semaine 46 / CASSE » est la casse de la semaine 46
// (contrôle et bibliothèque, donc téléphone).
// Usage : node test_web_ouvrir_semaine.js <site> <dossier « Semaine 46 » réel> <captures> [dossier « Semaine 45 » à plat]
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const [site, semaine46, captures, semaine45] = process.argv.slice(2);
const base = "https://sentinelle.test";
let echecs = 0;
const verifier = (ok, texte) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${texte}`);
  if (!ok) echecs++;
};
const lister = (dossier, chemin = []) =>
  fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? lister(path.join(dossier, e.name), [...chemin, e.name]) : [{ chemin, nom: e.name, source: path.join(dossier, e.name) }]
  );
(async () => {
  const nav = await chromium.launch();
  const page = await nav.newPage({ viewport: { width: 1300, height: 900 } });
  await page.addInitScript(() => { try { localStorage.setItem("sentinelle-vue-controle", "toutes"); } catch (e) {} }); // V6.9 : toutes les cases affichées (tests du contrôle)
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  page.on("dialog", (d) => d.accept());
  await page.route(`${base}/**`, (r) => r.fulfill({ status: 200, body: fs.readFileSync(path.join(site, "index.html")), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto(base + "/index.html");
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    for await (const [nom] of opfs.entries()) await opfs.removeEntry(nom, { recursive: true });
    window.racine = await opfs.getDirectoryHandle("Lancement", { create: true });
    // Un autre « Semaine 46 » (année d'avant), pour vérifier que la bonne année est prise.
    await (await window.racine.getDirectoryHandle("2025", { create: true })).getDirectoryHandle("Semaine 46", { create: true });
  });
  for (const f of lister(semaine46)) {
    await page.evaluate(
      async ({ chemin, nom, b64 }) => {
        let d = window.racine;
        for (const c of chemin) d = await d.getDirectoryHandle(c, { create: true });
        const w = await (await d.getFileHandle(nom, { create: true })).createWritable();
        await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
        await w.close();
      },
      { chemin: ["2026", "11 Novembre", "Semaine 46", ...f.chemin], nom: f.nom, b64: fs.readFileSync(f.source).toString("base64") }
    );
  }
  // Semaine 45 rangée à l'ancienne (fichiers à plat, casse LAN2644CASSE).
  if (semaine45)
    for (const f of lister(semaine45)) {
      await page.evaluate(
        async ({ chemin, nom, b64 }) => {
          let d = window.racine;
          for (const c of chemin) d = await d.getDirectoryHandle(c, { create: true });
          const w = await (await d.getFileHandle(nom, { create: true })).createWritable();
          await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
          await w.close();
        },
        { chemin: ["2026", "11 Novembre", "Semaine 45", ...f.chemin], nom: f.nom, b64: fs.readFileSync(f.source).toString("base64") }
      );
    }
  await page.evaluate(() => (window.showDirectoryPicker = async () => window.racine));
  await page.click("#btnMenuDossier");
  await page.waitForFunction(() => /Lancement/.test(document.querySelector("#menuDossier").innerText));
  await page.click('.menu [data-onglet="controle"]').then(() => page.click('.onglet-btn[data-onglet="impaire"]'));
  await page.waitForSelector("#champSemaineControle");
  verifier((await page.innerText("#carteDossier")).includes("Cherchée dans « Lancement »"), "le contrôle dit où il cherche la semaine");
  // Semaine absente : message clair.
  await page.fill("#champSemaineControle", "47");
  await page.click("#btnOuvrirSemaine");
  await page.waitForFunction(() => /Aucun dossier « Semaine 47 »/.test(document.querySelector("#carteDossier").innerText));
  verifier(true, "semaine 47 absente : « Aucun dossier « Semaine 47 » dans « Lancement » »");
  if (semaine45) {
    await page.fill("#champSemaineControle", "45");
    await page.click("#btnOuvrirSemaine");
    await page.waitForFunction(() => /gardé\(s\) dans la bibliothèque|Aucun lancement|impossible|illisible|Plusieurs/.test((document.querySelector("#carteDossier") || {}).innerText || ""), null, { timeout: 300000 });
    await page.waitForTimeout(1500);
    verifier(/✔ Casse : LAN2644CASSE\.xlsx/.test(await page.innerText("#carteDossier")), "semaine 45 à l'ancienne : casse LAN2644CASSE prise en semaine 45");
    await page.fill("#champSemaineControle", "46");
  }
  // Semaine 46 : trouvée sous 2026 / 11 Novembre (pas celle de 2025), onglet de la semaine 46, scan.
  await page.fill("#champSemaineControle", "46");
  await page.click("#btnOuvrirSemaine");
  await page.waitForFunction(
    () => {
      const t = (document.querySelector("#carteDossier") || {}).innerText || "";
      return onglet === ongletDuNumero(46) && /Dossier ouvert : Semaine 46/.test(t) && /gardé\(s\) dans la bibliothèque|Aucun lancement|impossible|illisible|Plusieurs/.test(t);
    },
    null,
    { timeout: 300000 }
  );
  await page.waitForTimeout(1500);
  const carte = await page.innerText("#carteDossier");
  console.log("CARTE :", carte.replace(/\n/g, " | ").slice(-700));
  verifier(await page.evaluate(() => onglet === ongletDuNumero(46) && document.querySelector(`.onglet-btn[data-onglet="${ongletDuNumero(46)}"]`).textContent.includes("Semaine 46")), "onglet de la semaine 46 ouvert tout seul");
  verifier(carte.includes("Dossier ouvert : Semaine 46"), "dossier « Semaine 46 » de 2026 pris (pas celui de 2025)");
  verifier(/✔ Casse : LAN2646CASSE\.xlsx/.test(carte), "la casse de « Semaine 46 / CASSE » est prise en semaine 46");
  verifier(/✔ Agglo 1er tour : LAN264601START\.xlsx/.test(carte) && /✔ Feno : LAN264601FENO\.xlsx/.test(carte), "1er tour et Feno pris dans leurs sous-dossiers");
  const biblio = await page.evaluate(() => [...bibliotheque.semaines.values()].map((s) => `${s.id}: ${s.lancements.map((l) => l.nom).join(", ")}`));
  console.log("BIBLIOTHÈQUE :", biblio.join(" || "));
  verifier(biblio.some((s) => s.startsWith("2026-46") && s.includes("LAN2646CASSE")), "bibliothèque (téléphone) : la casse est en semaine 46");
  verifier(!biblio.some((s) => s.startsWith("2026-47")), "bibliothèque : rien en semaine 47");
  if (semaine45) {
    const casse = await page.evaluate(() => {
      const p = pairesDeLaSemaine(ongletDuNumero(46)).find((x) => x.poste === "Casse");
      const s = bibliotheque.semaines.get("2026-46");
      const l = s && s.lancements.find((x) => x.nom === "LAN2646CASSE");
      return { semaine: p && p.semaine, recap: l && l.recap && l.recap.casse };
    });
    console.log("CASSE 46 :", JSON.stringify(casse));
    verifier(casse.semaine === "46", "la case Casse est en semaine 46 (pas 47)");
    verifier(casse.recap && casse.recap.dejaLancees > 0 && /45/.test(casse.recap.ou || ""), "analyse de la casse 46 (pour le téléphone) : pièces déjà lancées en semaine 45");
    const texte = await page.innerText("main");
    verifier(/de la casse déjà lancée\(s\) en semaine 45/.test(texte), "écran : pièces de la casse déjà lancées en semaine 45");
  }
  await page.screenshot({ path: path.join(captures, "v604_ouvrir_semaine.png") });
  await nav.close();
  console.log(echecs ? `${echecs} ÉCHEC(S)` : "TOUT EST BON");
  process.exit(echecs ? 1 : 0);
})();
