// V6.9 : la nouvelle interface (PC). Menu qui tient dans l'écran, « Contrôler la coupe » un lancement à la fois
// (la liste à gauche choisit, « Tous » remet tout), compte rendu du scan dans un cadre, Suivi de production en onglets,
// explications derrière « ? », Stock avec le détail à droite, Bibliothèque sur deux colonnes, Recherche côte à côte.
// Usage : node test_web_interface.js <index.html> <dossier « Semaine 47 »> <extraction suivi_production.xlsx> <brdlib.bdx> [dossier captures]
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const [pageHtml, dossierSemaine, extraction, brdlib, captures] = process.argv.slice(2);
const base = "https://sentinelle.test";
let echecs = 0;
function verifier(ok, message) {
  if (!ok) echecs++;
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${message}`);
}
const lister = (dossier, chemin = []) =>
  fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? lister(path.join(dossier, e.name), [...chemin, e.name]) : [{ chemin, nom: e.name, source: path.join(dossier, e.name) }]
  );

(async () => {
  if (captures) fs.mkdirSync(captures, { recursive: true });
  const nav = await chromium.launch();
  const page = await (await nav.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => {
    echecs++;
    console.log("ERREUR JS:", e.message);
  });
  page.on("dialog", (d) => d.accept());
  page.on("crash", () => console.log("PLANTAGE de la page"));
  await page.route(`${base}/**`, (r) => r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.route("https://sentinelle-laisne-0ysi8zpn.netlify.app/**", (r) => r.fulfill({ status: 404, body: "{}", headers: { "access-control-allow-origin": "*" } }));
  await page.goto(base + "/index.html");
  await page.waitForFunction(() => typeof SUIVI !== "undefined" && SUIVI.etat.charge, null, { timeout: 30000 });

  // 1. Le menu tient dans un écran de portable (900 px de haut) : rien à faire défiler pour atteindre « Expérimental ».
  const menu = await page.evaluate(() => {
    const b = document.querySelector('.onglet-btn[data-onglet="woodstore"]').getBoundingClientRect();
    const m = document.querySelector(".menu");
    return { bas: b.bottom, hauteur: window.innerHeight, defile: m.scrollHeight > m.clientHeight + 1 };
  });
  verifier(menu.bas <= menu.hauteur, `menu : « Connexion woodStore » visible sans défiler (bas ${Math.round(menu.bas)} ≤ ${menu.hauteur})`);

  // 2. Une semaine scannée (OPFS : dossier « Lancement / 2026 / 11 Novembre / Semaine 47 »).
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    for await (const [nom] of opfs.entries()) await opfs.removeEntry(nom, { recursive: true });
    window.racine = await opfs.getDirectoryHandle("Lancement", { create: true });
  });
  for (const f of lister(dossierSemaine))
    await page.evaluate(
      async ({ chemin, nom, b64 }) => {
        let d = window.racine;
        for (const c of chemin) d = await d.getDirectoryHandle(c, { create: true });
        const w = await (await d.getFileHandle(nom, { create: true })).createWritable();
        await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
        await w.close();
      },
      { chemin: ["2026", "11 Novembre", "Semaine 47", ...f.chemin], nom: f.nom, b64: fs.readFileSync(f.source).toString("base64") }
    );
  await page.evaluate(() => (window.showDirectoryPicker = async () => window.racine));
  await page.click("#btnMenuDossier");
  await page.waitForFunction(() => /Lancement/.test(document.querySelector("#menuDossier").innerText));
  const onglet47 = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".onglet-btn")].find((x) => /Semaine (46|47|48)/.test(x.textContent));
    return b ? b.dataset.onglet : "paire";
  });
  await page.click(`.onglet-btn[data-onglet="${onglet47}"]`);
  await page.fill("#champSemaineControle", "47");
  await page.click("#btnOuvrirSemaine");
  await page.waitForFunction(() => /Dossier ouvert : Semaine 47/.test(document.querySelector("#carteDossier").innerText) && /gardé\(s\) dans la bibliothèque|Aucun lancement/.test(document.querySelector("#carteDossier").innerText), null, { timeout: 600000 });
  await page.waitForTimeout(1000);

  // 3. Un lancement à la fois : une seule case visible, la liste choisit.
  const visibles = () => page.$$eval("#pageSemaine .carte-paire", (cs) => cs.filter((c) => c.offsetParent !== null).map((c) => c.querySelector(".titre-carte").textContent));
  const v1 = await visibles();
  const items = await page.$$eval("#listePostes .poste-item[data-case]", (bs) => bs.map((b) => ({ id: b.dataset.case, nom: b.querySelector(".poste-nom").textContent, actif: b.classList.contains("actif") })));
  verifier(v1.length === 1 && items.length >= 6, `« Un lancement » : une seule case affichée (${v1.join(", ")}) sur ${items.length}`);
  verifier(items[0].actif && v1[0] === items[0].nom, "la première de la liste est choisie et mise en avant");
  await page.click(`#listePostes .poste-item[data-case="${items[2].id}"]`);
  const v2 = await visibles();
  const actif = await page.$eval("#listePostes .poste-item.actif .poste-nom", (e) => e.textContent);
  verifier(v2.length === 1 && v2[0] === items[2].nom && actif === items[2].nom, `clic dans la liste : « ${items[2].nom} » affichée à la place`);
  const etatCase = await page.$eval("#pageSemaine .carte-paire:not(.cachee-vue) .entete-carte .etiquette", (e) => e.textContent).catch(() => "");
  verifier(/OK|à regarder|Pas contrôlé|En cours/.test(etatCase), `l'état du lancement est dans l'en-tête de la case (${etatCase})`);
  const barre = await page.$$eval("#pageSemaine .carte-paire:not(.cachee-vue) .barre-actions-case > button", (bs) => bs.map((b) => b.dataset.action));
  verifier(barre.includes("go") && barre.includes("scies") && barre.includes("rapport-lancement"), `une seule barre d'actions (${barre.join(", ")})`);
  if (captures) await page.screenshot({ path: path.join(captures, "controle_un.png") });
  await page.click('.choix-vue [data-vue="toutes"]');
  const v3 = await visibles();
  verifier(v3.length === items.length, `« Tous » : les ${items.length} cases les unes sous les autres (${v3.length})`);
  verifier((await page.evaluate(() => localStorage.getItem("sentinelle-vue-controle"))) === "toutes", "le choix est gardé");
  await page.click('.choix-vue [data-vue="une"]');
  verifier((await visibles()).length === 1, "retour à « Un lancement »");
  // Tableau du bas : un clic sur une ligne affiche cette case.
  const ligne = await page.$$eval("#zoneRecap [data-case]", (ls) => ls.map((l) => l.dataset.case));
  if (ligne.length > 1) {
    await page.click(`#zoneRecap [data-case="${ligne[1]}"]`);
    const v4 = await page.$$eval("#pageSemaine .carte-paire", (cs) => cs.filter((c) => c.offsetParent !== null).map((c) => c.dataset.id));
    verifier(v4.length === 1 && v4[0] === ligne[1], "récapitulatif : un clic sur une ligne affiche sa case");
  }
  // Compte rendu du scan : dans un cadre qui défile, « Tout voir » le déplie (le texte reste entier dans la page).
  const journal = await page.evaluate(() => {
    const c = document.querySelector("#carteDossier .journal-scan .compte-rendu");
    return c ? { haut: c.clientHeight, total: c.scrollHeight, texte: c.innerText } : null;
  });
  verifier(journal && journal.total > journal.haut && /gardé\(s\) dans la bibliothèque/.test(journal.texte), `compte rendu du scan dans un cadre (${journal && journal.haut} px sur ${journal && journal.total})`);
  await page.click("#btnJournalScan");
  const deplie = await page.evaluate(() => {
    const c = document.querySelector("#carteDossier .journal-scan .compte-rendu");
    return c.clientHeight >= c.scrollHeight - 1;
  });
  verifier(deplie, "« Tout voir » : le compte rendu du scan en entier");

  // 4. Suivi de production : des onglets, un seul contenu à la fois.
  await page.evaluate(
    async ([d, nom]) => SUIVI.chargerFichiers([new File([Uint8Array.from(atob(d), (c) => c.charCodeAt(0))], nom, { lastModified: Date.now() })]),
    [fs.readFileSync(extraction).toString("base64"), path.basename(extraction)]
  );
  await page.click('.onglet-btn[data-onglet="suivi"]');
  await page.waitForSelector("[data-sv-panneau]");
  const onglets = await page.$$eval("[data-sv-panneau]", (bs) => bs.map((b) => b.textContent.replace(/\s+/g, " ").trim()));
  verifier(onglets.length === 5 && /Pas dans les lancements \d/.test(onglets[2]), `5 onglets (${onglets.join(" | ")})`);
  verifier((await page.locator("#pageSuivi [data-sv-lan]").count()) > 3 && (await page.locator("#svHors").count()) === 0, "onglet « Avancement par lancement » : les barres, pas la liste « Pas dans les lancements »");
  verifier((await page.locator("#svActualiser, #svFichier, #svDossier").count()) >= 2, "les boutons de l'extraction sont en haut de la page");
  const avant = await page.locator('#pageSuivi [data-aide-texte="sv-avancement"]').isVisible();
  await page.click('#pageSuivi [data-aide="sv-avancement"]');
  const apres = await page.locator('#pageSuivi [data-aide-texte="sv-avancement"]').isVisible();
  verifier(!avant && apres, "« ? » : l'explication s'ouvre (cachée avant)");
  await page.click('[data-sv-panneau="hors"]');
  verifier((await page.locator("#svHors").count()) === 1 && (await page.locator("#pageSuivi [data-sv-lan]").count()) === 0, "onglet « Pas dans les lancements » : la liste seule");
  await page.evaluate(() => window.scrollTo(0, 3000));
  await page.waitForTimeout(200);
  const entete = await page.evaluate(() => {
    const th = document.querySelector("#svHors table.sv-hors thead th");
    return th ? th.getBoundingClientRect().top : null;
  });
  verifier(entete !== null && entete >= -1 && entete < 80, `en descendant, l'en-tête du tableau reste visible (haut ${Math.round(entete)})`);
  await page.evaluate(() => window.scrollTo(0, 0));
  // L'onglet choisi est gardé (mémoire du navigateur) : relu comme à l'ouverture de Sentinelle.
  await page.evaluate(() => {
    SUIVI.etat.panneau = null;
    onglet = "accueil";
    afficher();
  });
  await page.click('.onglet-btn[data-onglet="suivi"]');
  await page.waitForSelector("[data-sv-panneau]");
  verifier((await page.$eval("[data-sv-panneau].actif", (b) => b.dataset.svPanneau)) === "hors", "l'onglet choisi est gardé (relu à l'ouverture)");
  await page.click('[data-sv-panneau="lancements"]');

  // 5. Stock : le détail du matériau cliqué s'affiche à droite, sans descendre en bas de la liste.
  await page.click('.onglet-btn[data-onglet="stock"]');
  await page.setInputFiles("#fichierStock", brdlib);
  await page.waitForSelector(".stk-fichier");
  await page.evaluate(() => window.scrollTo(0, 2500));
  await page.waitForTimeout(200);
  const cible = await page.evaluate(() => {
    const l = [...document.querySelectorAll("#pageStock tr.stk-ligne")].find((tr) => tr.getBoundingClientRect().top > 200 && tr.getBoundingClientRect().top < 700);
    return l ? l.dataset.stkMat : null;
  });
  await page.click(`#pageStock tr.stk-ligne[data-stk-mat="${cible}"]`);
  await page.waitForSelector(".stk-detail");
  const det = await page.evaluate(() => {
    const d = document.querySelector(".stk-detail").getBoundingClientRect();
    const l = document.querySelector(".stk-liste").getBoundingClientRect();
    return { haut: d.top, gauche: d.left, droiteListe: l.right, h: window.innerHeight };
  });
  verifier(det.gauche >= det.droiteListe && det.haut >= 0 && det.haut < det.h / 2, `détail du stock (${cible}) à droite de la liste et visible tout de suite`);
  const outils = await page.evaluate(() => document.querySelector(".stk-outils").getBoundingClientRect().top);
  verifier(outils >= -1 && outils < 60, `la recherche du stock reste en haut en descendant (${Math.round(outils)})`);
  if (captures) await page.screenshot({ path: path.join(captures, "stock_detail.png") });
  verifier(/case 302/.test(await page.locator("#pageStock").textContent()), "explication du stock gardée (derrière « ? »)");

  // 6. Bibliothèque : semaines à gauche, fichier partagé et téléphone à droite.
  await page.click('.onglet-btn[data-onglet="bibliotheque"]');
  const biblio = await page.evaluate(() => {
    const g = document.querySelector(".biblio-principale").getBoundingClientRect();
    const d = document.querySelector(".biblio-cote").getBoundingClientRect();
    return { cote: d.left >= g.right, tel: Boolean(document.querySelector(".biblio-cote #carteLienTelephone")), semaines: /Semaines gardées \(\d+\)/.test(document.querySelector(".biblio-principale").innerText) };
  });
  verifier(biblio.cote && biblio.tel && biblio.semaines, "bibliothèque : semaines à gauche, fichier partagé et téléphone à droite");
  verifier(await page.isVisible("#btnImporterSemaines"), "« + Ajouter les semaines d'avant » en haut de la page");

  // 7. Recherche : avec ou sans étiquette, côte à côte.
  await page.click('.onglet-btn[data-onglet="recherche"]');
  const rech = await page.evaluate(() => {
    const [a, b] = document.querySelectorAll(".recherche-entrees > .carte");
    return a && b && Math.abs(a.getBoundingClientRect().top - b.getBoundingClientRect().top) < 2 && b.getBoundingClientRect().left > a.getBoundingClientRect().right;
  });
  verifier(rech, "recherche : « Avec l'étiquette » et « Pièce sans étiquette » côte à côte");

  // 8. Écran étroit (1000 px) : rien ne dépasse sur le côté.
  await page.setViewportSize({ width: 1000, height: 800 });
  for (const o of ["accueil", onglet47, "suivi", "stock", "bibliotheque", "recherche"]) {
    await page.click(`.onglet-btn[data-onglet="${o}"]`);
    await page.waitForTimeout(300);
    const deborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    verifier(deborde <= 1, `1000 px de large, « ${o} » : pas de défilement de côté (${deborde})`);
  }

  await nav.close();
  console.log(echecs ? `${echecs} échec(s)` : "TOUT EST OK");
  process.exit(echecs ? 1 : 0);
})();
