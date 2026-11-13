// Bibliothèque : « Ajouter les semaines d'avant » sur un dossier « Lancement » qui contient tout l'historique :
// anciennes semaines sans sous-dossiers (fichiers directement dans « Semaine NN », sous année / mois),
// nouvelles semaines avec un sous-dossier par lancement (1ER TOUR AGGLO, FENO…), noms « SEMAINE 47 - 2026 ».
// Usage : node test_web_import_lancements.js <site> <archive 2026> <dossier des LAN de la réécriture>
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const [site, archive, reecrits] = process.argv.slice(2);
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
  const fichiers = [
    ...lister(archive), // 2026 / mois / Semaine NN / … (tel que sur le Drive)
    { chemin: ["Semaine 46", "FENO"], nom: "LAN264601FENO.xlsx", source: path.join(reecrits, "LAN264601FENO.xlsx") },
    { chemin: ["SEMAINE 47 - 2026", "1ER TOUR AGGLO"], nom: "LAN264701START.xlsx", source: path.join(reecrits, "LAN264701START.xlsx") },
  ];
  const nav = await chromium.launch();
  const page = await nav.newPage({ viewport: { width: 1300, height: 900 } });
  await page.addInitScript(() => { try { localStorage.setItem("sentinelle-vue-controle", "toutes"); } catch (e) {} }); // V6.9 : toutes les cases affichées (tests du contrôle)
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  await page.route(`${base}/**`, (r) => r.fulfill({ status: 200, body: fs.readFileSync(path.join(site, "index.html")), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto(base + "/index.html");
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    for await (const [nom] of opfs.entries()) await opfs.removeEntry(nom, { recursive: true });
    window.racine = await opfs.getDirectoryHandle("Lancement", { create: true });
  });
  for (const f of fichiers) {
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
  console.log(`Arborescence « Lancement » : ${fichiers.length} fichiers`);
  await page.evaluate(() => (window.showDirectoryPicker = async () => window.racine));
  await page.click('.onglet-btn[data-onglet="bibliotheque"]');
  await page.click("#btnImporterSemaines");
  await page.waitForFunction(() => /ajouté|impossible|Aucun fichier/.test((document.querySelector("#pageBibliotheque .compte-rendu") || {}).innerText || ""), null, { timeout: 600000 });
  const etat = await page.innerText("#pageBibliotheque .compte-rendu");
  console.log("ÉTAT :", etat.replace(/\n/g, " | ").slice(0, 900));
  const semaines = await page.evaluate(() =>
    [...bibliotheque.semaines.values()]
      .sort((a, b) => a.annee - b.annee || a.semaine - b.semaine)
      .map((s) => ({ id: s.id, noms: s.lancements.map((l) => l.nom), lancements: s.lancements.map((l) => `${l.nom} [${l.poste}${l.dossier ? ` ← ${l.dossier}` : ""}] ${l.nbPieces} p.`) }))
  );
  if (process.env.DETAIL) for (const s of semaines) console.log(s.id, "\n   " + s.lancements.join("\n   "));
  const tout = semaines.flatMap((s) => s.lancements.map((l) => `${s.id} ${l}`));
  const trouve = (re) => tout.find((x) => re.test(x));
  verifier(/2026-46 LAN264601FENO \[Feno ← FENO\]/.test(trouve(/LAN264601FENO/) || ""), "nouveau rangement : Semaine 46 / FENO → Feno, semaine 46");
  verifier(/LAN264701START \[Agglo 1er tour ← 1ER TOUR AGGLO\]/.test(trouve(/LAN264701START/) || ""), "« SEMAINE 47 - 2026 » / 1ER TOUR AGGLO → Agglo 1er tour (semaine prise dans la colonne lancement)");
  verifier(/2026-40 LAN264001STRAT \[Agglo 1er tour\]/.test(trouve(/LAN264001STRAT /) || ""), "ancien rangement (sans sous-dossier) : LAN264001STRAT → Agglo 1er tour, semaine 40");
  verifier(/LAN2640RECYCLAGE \[Recyclage\]/i.test(trouve(/LAN2640RECYCLAGE/i) || ""), "ancien rangement : recyclage reconnu au nom");
  verifier(!tout.some((x) => /COUPE|CUTRITE|rapport|Classeur|FOURNITURE|analyse|DIAKONOS/i.test(x)), "listes de coupe, rapports, Diakonos et classeurs divers pas pris");
  const lan = new Set(fichiers.filter((f) => /^LAN/i.test(f.nom) && /\.xls[xm]?$/i.test(f.nom) && !/COUPE|CUTRITE|ANALYSE|_problemes|rapport|DIAKONOS/i.test(f.nom)).map((f) => f.nom.replace(/\.[^.]*$/, "").toUpperCase()));
  const pris = new Set(semaines.flatMap((s) => s.noms.map((n) => n.toUpperCase())));
  const manquants = [...lan].filter((n) => !pris.has(n));
  console.log(`Fichiers LAN : ${lan.size}, lancements dans la bibliothèque : ${pris.size}, pas pris : ${manquants.join(", ") || "aucun"}`);
  // Casse des semaines ajoutées : analysée avec les semaines d'avant (ce que lit le téléphone).
  const casses = await page.evaluate(() =>
    [...bibliotheque.semaines.values()]
      .sort((a, b) => a.annee - b.annee || a.semaine - b.semaine)
      .flatMap((s) => s.lancements.filter((l) => l.casse).map((l) => ({ semaine: s.semaine, nom: l.nom, casse: l.recap && l.recap.casse })))
  );
  for (const c of casses) console.log(`  casse semaine ${c.semaine} ${c.nom} : ${c.casse ? `${c.casse.dejaLancees} déjà lancée(s) ${c.casse.ou}, ${c.casse.rajouts} rajout(s) (${c.casse.periode})` : "PAS ANALYSÉE"}`);
  const premiere = Math.min(...casses.map((c) => c.semaine));
  verifier(casses.length > 5 && casses.filter((c) => c.semaine > premiere).every((c) => c.casse), "toutes les casses ajoutées sont analysées (sauf la toute première semaine)");
  verifier(casses.some((c) => c.casse && c.casse.dejaLancees > 0), "des pièces de casse sont retrouvées dans les semaines d'avant");
  await nav.close();
  console.log(echecs ? `${echecs} ÉCHEC(S)` : "TOUT EST BON");
  process.exit(echecs ? 1 : 0);
})();
