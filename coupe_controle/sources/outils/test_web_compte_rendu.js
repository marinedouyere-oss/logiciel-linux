// Compte rendu de la semaine (.pdf) : archive « Lancement » importée dans la bibliothèque (pour séparer
// casse déjà lancée / rajouts), puis « Contrôler la coupe » → semaine demandée → bouton du compte rendu.
// Usage : node test_web_compte_rendu.js <site> <archive « Lancement »> <semaine> <sortie.pdf>
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const [site, archive, semaine, sortie] = process.argv.slice(2);
let echecs = 0;
const verifier = (ok, texte) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${texte}`);
  if (!ok) echecs++;
};
const lister = (d, c = []) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? lister(path.join(d, e.name), [...c, e.name]) : [{ chemin: c, nom: e.name, source: path.join(d, e.name) }]));
(async () => {
  const nav = await chromium.launch();
  const page = await nav.newPage({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
  await page.addInitScript(() => { try { localStorage.setItem("sentinelle-vue-controle", "toutes"); } catch (e) {} }); // V6.9 : toutes les cases affichées (tests du contrôle)
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  page.on("dialog", (d) => d.accept());
  await page.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(path.join(site, "index.html")), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://s.test/index.html");
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    for await (const [nom] of opfs.entries()) await opfs.removeEntry(nom, { recursive: true });
    window.racine = await opfs.getDirectoryHandle("Lancement", { create: true });
  });
  for (const f of lister(archive)) {
    await page.evaluate(
      async ({ chemin, nom, b64 }) => {
        let d = window.racine;
        for (const c of chemin) d = await d.getDirectoryHandle(c, { create: true });
        const w = await (await d.getFileHandle(nom, { create: true })).createWritable();
        await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
        await w.close();
      },
      { chemin: f.chemin, nom: f.nom, b64: fs.readFileSync(f.source).toString("base64") }
    );
  }
  await page.evaluate(() => (window.showDirectoryPicker = async () => window.racine));
  await page.click('.onglet-btn[data-onglet="bibliotheque"]');
  await page.click("#btnImporterSemaines");
  await page.waitForFunction(() => /ajouté|impossible/.test((document.querySelector("#pageBibliotheque .compte-rendu") || {}).innerText || ""), null, { timeout: 900000 });
  // Dossier « Lancement » choisi, puis la semaine ouverte dans Contrôler la coupe.
  await page.click("#btnMenuDossier");
  await page.waitForFunction(() => /Lancement/.test(document.querySelector("#menuDossier").innerText));
  const parite = Number(semaine) % 2 === 0 ? "paire" : "impaire";
  await page.click(`.onglet-btn[data-onglet="${parite}"]`);
  await page.waitForSelector("#champSemaineControle");
  await page.fill("#champSemaineControle", String(semaine));
  await page.click("#btnOuvrirSemaine");
  await page.waitForFunction((s) => new RegExp(`Dossier ouvert : Semaine ${s}`).test((document.querySelector("#carteDossier") || {}).innerText || ""), String(semaine), { timeout: 300000 });
  await page.waitForFunction(() => /gardé\(s\) dans la bibliothèque|Aucun lancement|impossible|illisible|Plusieurs/.test((document.querySelector("#carteDossier") || {}).innerText || ""), null, { timeout: 300000 });
  await page.waitForTimeout(1500);
  verifier(await page.isVisible("#btnCompteRendu"), "bouton « Compte rendu de la semaine (.pdf) » dans Contrôler la coupe");
  const [telechargement] = await Promise.all([page.waitForEvent("download", { timeout: 300000 }), page.click("#btnCompteRendu")]);
  verifier(telechargement.suggestedFilename() === `rapport_lancements_semaine_${semaine}.pdf`, `nom du fichier : ${telechargement.suggestedFilename()}`);
  await telechargement.saveAs(sortie);
  const d = await page.evaluate(async (p) => (await compteRenduSemainePdf(p)).donnees, parite);
  console.log(JSON.stringify(d, null, 1));
  verifier(d.lancements.length > 0, `${d.lancements.length} lancement(s)`);
  verifier(fs.readFileSync(sortie).subarray(0, 5).toString() === "%PDF-", "le fichier est un PDF");
  // Pièce sans étiquette : une vraie pièce de la semaine, retrouvée par sa cote finie (à 2 mm près).
  const cible = await page.evaluate((sem) => {
    const s = [...bibliotheque.semaines.values()].find((x) => x.semaine === Number(sem) && x.lancements.length);
    for (const l of s.lancements) for (const p of l.pieces) if (p[5] !== "" && p[6] !== "" && p[8] && Number(p[5]) !== Number(p[6])) return { cle: p[0], L: Number(p[5]), l: Number(p[6]), coloris: p[8], lancement: l.nom };
    return null;
  }, semaine);
  verifier(Boolean(cible), `pièce témoin : ${cible && `${cible.cle} ${cible.L} × ${cible.l} ${cible.coloris} (${cible.lancement})`}`);
  await page.click('.onglet-btn[data-onglet="recherche"]');
  const chercher = async (L, l, couleur, sem) => {
    await page.fill("#champCoteLongueur", L == null ? "" : String(L));
    await page.fill("#champCoteLargeur", l == null ? "" : String(l));
    await page.fill("#champCoteCouleur", couleur || "");
    await page.fill("#champCoteSemaine", sem == null ? "" : String(sem));
    await page.click("#btnChercherCotes");
    await page.waitForFunction(() => !/Recherche en cours/.test(document.querySelector("#resultatsCotes").innerText) && document.querySelector("#resultatsCotes").innerText.trim() !== "");
    return page.innerText("#resultatsCotes");
  };
  let t = await chercher(cible.L + 1, cible.l - 2, "", semaine);
  verifier(t.includes(cible.cle), `cote finie à 2 mm près (${cible.L + 1} × ${cible.l - 2}) : ${cible.cle} trouvée`);
  t = await chercher(cible.L + 3, cible.l, "", semaine);
  verifier(!t.includes(cible.cle), "à 3 mm : pas trouvée");
  t = await chercher(cible.l, cible.L, "", semaine);
  verifier(!t.includes(cible.cle), "sens du fil inversé (largeur puis longueur) : pas trouvée");
  t = await chercher(cible.L, cible.l, cible.coloris, semaine);
  verifier(t.includes(cible.cle), `avec la couleur ${cible.coloris} : trouvée`);
  t = await chercher(cible.L, cible.l, "ZZZ999", semaine);
  verifier(!t.includes(cible.cle) && /^0 pièce/.test(t.trim()), "autre couleur : rien");
  t = await chercher(cible.L, null, "", semaine);
  verifier(t.includes(cible.cle), "longueur seule : trouvée");
  t = await chercher(cible.L, cible.l, "", null);
  verifier(/semaine \(obligatoire\)/.test(t), "sans semaine : « Tapez la semaine (obligatoire). »");
  t = await chercher(cible.L, cible.l, "", 2);
  verifier(/Semaine 2 : rien dans la bibliothèque/.test(t), "semaine absente : message clair");
  await page.screenshot({ path: sortie.replace(/\.pdf$/, "_recherche.png"), fullPage: true });
  await nav.close();
  console.log(echecs ? `${echecs} ÉCHEC(S)` : "TOUT EST BON");
  process.exit(echecs ? 1 : 0);
})();
