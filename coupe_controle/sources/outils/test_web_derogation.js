// V6.1.4 : déroger à la règle des semaines (ex. une FENO en retard de la semaine 46 fabriquée en semaine 47).
// Usage : node test_web_derogation.js <index.html> <dossier « 1ER TOUR AGGLO » de la semaine 48> [capture.png]
// (LAN264801START.xlsx : un lancement de la semaine 48, utilisé comme lancement « en retard » à ranger en 47.)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [pageHtml, dossier, capture] = process.argv.slice(2);
let echecs = 0;
const verifier = (ok, t) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`);
  if (!ok) echecs++;
};
(async () => {
  const nav = await chromium.launch();
  const page = await (await nav.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
  await page.addInitScript(() => { try { localStorage.setItem("sentinelle-vue-controle", "toutes"); } catch (e) {} }); // V6.9 : toutes les cases affichées (tests du contrôle)
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  page.on("dialog", (d) => d.accept());
  await page.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://s.test/index.html");
  const lan = [...fs.readFileSync(path.join(dossier, "LAN264801START.xlsx"))];
  // 1. Un lancement de la semaine 48 dans la case Agglo 1er tour de la semaine 48, rangé à la main en semaine 47.
  const r1 = await page.evaluate(async (octets) => {
    const p = paireFixe("Agglo 1er tour", ongletDuNumero(48));
    p.strat = new File([new Uint8Array(octets)], "LAN264801START.xlsx");
    await memoriserFichier(p, "strat", p.strat);
    p.semaine = await detecterSemaine(p);
    enregistrer(p);
    const avant = p.semaine;
    const q = await derogerSemaine(p, 47);
    const strat = await stratEnCache(q.strat);
    const sem = semaineDuLancement(strat.lignes, false, q.strat.name, null, strat.semaines);
    const biblio = [...bibliotheque.semaines.values()].filter((s) => s.lancements.some((l) => l.nom === "LAN264801START")).map((s) => s.semaine);
    return { avant, apres: q.semaine, ongletQ: q.parite === ongletDuNumero(47), videe: !p.strat, derog: (derogationDe("LAN264801START.xlsx") || {}).semaine, fichier: await detecterSemaine(q, true), sem: sem.semaine, biblio };
  }, lan);
  console.log(JSON.stringify(r1));
  verifier(r1.avant === "48" && r1.apres === "47" && r1.ongletQ && r1.videe, "lancement de la semaine 48 passé dans la case Agglo 1er tour de la semaine 47 (celle de la 48 vidée)");
  verifier(r1.derog === 47 && r1.fichier === "48" && r1.sem === 47, "dérogation retenue : semaine 47 (le fichier dit toujours 48)");
  verifier(r1.biblio.join(",") === "47", `bibliothèque (et téléphone) : rangé en semaine 47 seulement (${r1.biblio.join(",")})`);
  // 2. À l'écran : la case de la semaine 47 dit la dérogation, avec « Remettre la semaine du fichier ».
  await page.evaluate(() => {
    onglet = ongletDuNumero(47);
    afficher();
  });
  await page.waitForFunction(() => /choisie à la main/.test(document.body.innerText), null, { timeout: 15000 });
  const texteCase = await page.locator(".carte-paire").filter({ hasText: "LAN264801START" }).first().innerText();
  verifier(texteCase.includes("Semaine 47 choisie à la main (le fichier dit semaine 48)"), "case : « Semaine 47 choisie à la main (le fichier dit semaine 48) »");
  if (capture) await page.locator(".carte-paire").filter({ hasText: "LAN264801START" }).first().screenshot({ path: capture });
  // 3. Le scan garde le lancement en semaine 47 (pas « retiré, ce n'est pas la semaine 47 »).
  const garde = await page.evaluate(async () => {
    const p = paireFixe("Agglo 1er tour", ongletDuNumero(47));
    p.semaine = await detecterSemaine(p);
    return p.semaine;
  });
  verifier(garde === "47", "au prochain scan : toujours semaine 47");
  // 4. Retour à la règle : la case de la semaine 48 le reprend.
  await page.locator(".carte-paire").filter({ hasText: "LAN264801START" }).first().locator("[data-remettre-semaine]").click();
  await page.waitForFunction(
    () => paireFixe("Agglo 1er tour", ongletDuNumero(48)).semaine === "48" && !paireFixe("Agglo 1er tour", ongletDuNumero(47)).strat && ![...bibliotheque.semaines.values()].some((s) => s.semaine === 47 && s.lancements.some((l) => l.nom === "LAN264801START")),
    null,
    { timeout: 30000 }
  ).catch(() => null);
  const r4 = await page.evaluate(() => ({ s48: paireFixe("Agglo 1er tour", ongletDuNumero(48)).semaine, vide47: !paireFixe("Agglo 1er tour", ongletDuNumero(47)).strat, derog: derogationDe("LAN264801START.xlsx"), biblio: [...bibliotheque.semaines.values()].filter((s) => s.lancements.some((l) => l.nom === "LAN264801START")).map((s) => s.semaine) }));
  console.log(JSON.stringify(r4));
  verifier(r4.s48 === "48" && r4.vide47 && !r4.derog && r4.biblio.join(",") === "48", "« Remettre la semaine du fichier » : retour en semaine 48, partout");
  // 5. Feno : la case de la semaine 47 est déjà prise → une case « Feno 2 » en semaine 47.
  const r5 = await page.evaluate(async (octets) => {
    const f47 = paireFixe("Feno", ongletDuNumero(47));
    f47.strat = new File([new Uint8Array(octets)], "LAN2647FENO.xlsx");
    const p = paireFixe("Feno", ongletDuNumero(48));
    p.strat = new File([new Uint8Array(octets)], "LAN2646FENO6087.xlsx");
    p.semaine = "46";
    const q = await derogerSemaine(p, 47);
    return { label: q.label, supplement: Boolean(q.supplement), onglet: q.parite === ongletDuNumero(47), semaine: q.semaine, f47: f47.strat.name };
  }, lan);
  console.log(JSON.stringify(r5));
  verifier(r5.supplement && /^Feno \d/.test(r5.label) && r5.onglet && r5.semaine === "47" && r5.f47 === "LAN2647FENO.xlsx", `FENO 6087 en retard rangée en semaine 47 dans une case « ${r5.label} » (la Feno de la 47 reste)`);
  // 6. Compte rendu du scan : « Le garder en semaine 47 ».
  const r6 = await page.evaluate(async (octets) => {
    const p = ajouterSupplement("Feno", ongletDuNumero(46));
    p.strat = new File([new Uint8Array(octets)], "LAN2646FENO7001.xlsx");
    p.semaine = "46";
    onglet = ongletDuNumero(47);
    etatsScan[onglet] = { lignes: [{ texte: "✔ Feno 3 : LAN2646FENO7001.xlsx (dossier FENO) → semaine 46 — le fichier dit semaine 46", derogation: { id: p.id, semaine: 47 } }], erreur: false };
    afficher();
    return p.id;
  }, lan);
  await page.click(`[data-deroger-case="${r6}"]`);
  await page.waitForFunction(() => /gardé en semaine 47/.test(document.querySelector("#carteDossier").innerText), null, { timeout: 15000 });
  const r6b = await page.evaluate((id) => {
    const p = paires.find((x) => x.id === id);
    return { onglet: p.parite === ongletDuNumero(47), semaine: p.semaine, derog: (derogationDe("LAN2646FENO7001.xlsx") || {}).semaine };
  }, r6);
  verifier(r6b.onglet && r6b.semaine === "47" && r6b.derog === 47, "scan : « Le garder en semaine 47 » range le lancement en semaine 47");
  await nav.close();
  console.log(echecs ? `${echecs} ÉCHEC(S)` : "TOUT EST OK");
  process.exitCode = echecs ? 1 : 0;
})();
