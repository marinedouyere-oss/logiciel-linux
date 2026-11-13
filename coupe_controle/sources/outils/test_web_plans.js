// V6.1 : plans de coupe Cut Rite, contrôle des pièces placées, recherche d'une pièce, outil Plans de coupe,
// plan modifié à la scie, liste de coupe générée (expérimental), noms de lancement avec espace,
// V6.1.2 : plans depuis la liste des résultats, plan modifié dans Sentinelle (imprimé d'origine / modifié, envoyé au téléphone).
// Usage : node test_web_plans.js <index.html> <dossier « 1ER TOUR AGGLO » de la semaine 48> <.bkp modifié (facultatif)> [dossier captures]
// Le dossier contient LAN264801START.xlsx, LISTE DE COUPES LAN264801STRAT.pdf et LAN264801STARTbackup.bkp.
// Le .bkp modifié : la même sauvegarde où le module T101 a été retiré du Pdc 4 du SAG10HYBR.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [pageHtml, dossier, modifie, captures] = process.argv.slice(2);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${message}`);
  if (!ok) echecs++;
};

(async () => {
  const nav = await chromium.launch();
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem("sentinelle-vue-controle", "toutes"); } catch (e) {} }); // V6.9 : toutes les cases affichées (tests du contrôle)
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  page.on("dialog", (d) => d.accept());
  await page.route("https://sentinelle.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://sentinelle.test/index.html");
  const fic = (f) => [[...fs.readFileSync(f)], path.basename(f)];
  const telecharge = async (clic) => {
    const [d] = await Promise.all([page.waitForEvent("download"), clic()]);
    const chemin = path.join(captures || require("os").tmpdir(), d.suggestedFilename());
    await d.saveAs(chemin);
    return chemin;
  };

  // 1. Plans lus dans le .bkp, contrôle « pièces placées » (bouton Vérifier Scies).
  const r1 = await page.evaluate(async ([s, c, b]) => {
    const p = pairesDeLaSemaine(ongletDuNumero(48))[0];
    p.strat = new File([new Uint8Array(s[0])], s[1]);
    p.coupe = new File([new Uint8Array(c[0])], c[1]);
    p.bkp = new File([new Uint8Array(b[0])], b[1]);
    p.semaine = "48";
    const d = await lirePlansBkp(p.bkp);
    await new Promise((r) => lancerControleScies(p, r));
    const pr = await problemesDuLancement(p);
    return {
      nbPlans: d.nbPlans, nbModules: d.nbModules, malLus: [...d.matieres.values()].flatMap((m) => m.plans).filter((x) => !x.ok).length,
      plans: p.plans, ecarts: p.ecartsScies.length, bilan: pr.bilan.find((x) => x.controle === "Plans de coupe (.bkp)"),
      hors: pr.hors.filter((h) => h.type === "Plus dans le lancement, pas coupée").map((h) => h.cle),
      desc: pr.hors.filter((h) => h.cle === "CVC26090536002").map((h) => `${h.article} | ${h.dimensions} | ${h.coloris}`)[0],
      piece: plansDeLaPiece(d, "CVC26110064003").plans.map((x) => `${x.rang}:${x.plan.matiere}:${x.plan.pdc}`),
    };
  }, [fic(path.join(dossier, "LAN264801START.xlsx")), fic(path.join(dossier, "LISTE DE COUPES LAN264801STRAT.pdf")), fic(path.join(dossier, "LAN264801STARTbackup.bkp"))]);
  verifier(r1.nbPlans === 326 && r1.nbModules === 74 && r1.malLus === 0, `326 plans et 74 modules, tous bien lus (${r1.nbPlans}, ${r1.nbModules}, ${r1.malLus})`);
  verifier(r1.plans.nonPlacees.length === 0, "toutes les pièces du lancement sont dans un plan");
  verifier(r1.plans.horsLancement.length === 5 && r1.ecarts === 0, "les 5 pièces de la liste du .bkp hors lancement : à part, plus « en trop »");
  verifier(r1.bilan && r1.bilan.statut === "attention" && r1.hors.length === 5, "bilan Plans de coupe : à vérifier, 5 pièces dans aucun plan");
  verifier(r1.desc === "TPPVC39651 | 3460 × 670 × 39 | 1047", `pièce hors lancement décrite : article, cote finie, épaisseur, couleur (${r1.desc})`);
  verifier(r1.piece.join(" ") === "0:SAG10HYBR:40 1:SAG10HYBR:12 2:997:1 3:RCB-CRED14:3", `CVC26110064003 : module Pdc 40, agglo Pdc 12, 997 Pdc 1, RCB-CRED14 Pdc 3 (${r1.piece.join(" ")})`);

  // 2. Recherche : fiche simple de la pièce, ses plans, le plan en grand, les PDF.
  await page.evaluate(() => {
    onglet = "recherche";
    afficher();
  });
  await page.fill("#champRecherche", "26110064003");
  await page.click("#btnRechercher");
  await page.waitForSelector(".fiche-piece .pl-carte", { timeout: 120000 });
  const fiche = await page.innerText(".fiche-piece");
  verifier(fiche.includes("Crédence 3592 × 161 × 14 mm") && fiche.includes("Lancée et placée — Agglo 1er tour, semaine 48"), "fiche : la pièce et le verdict");
  verifier(fiche.includes("✔ placée · Pdc 40 (module T73)") && fiche.includes("En jaune : le module T73"), "fiche : où est la pièce, plans avec la position");
  verifier((await page.locator(".fiche-piece .pl-carte").count()) === 4, "fiche : 4 plans");
  if (captures) await page.screenshot({ path: path.join(captures, "web_recherche_plans.png"), fullPage: true });
  await page.locator(".fiche-piece .pl-carte").nth(1).click();
  await page.waitForSelector("#modalePlan");
  verifier((await page.innerText("#modalePlan")).includes("module T73 ← pièce cherchée"), "plan en grand : pièces numérotées, la pièce cherchée marquée");
  const pdfPlan = await telecharge(() => page.click("#modalePlan [data-imprimer]"));
  await page.locator("#modalePlan .pl-boutons [data-fermer]").click();
  const pdfFiche = await telecharge(() => page.click("[data-imprimer-case]"));
  verifier(fs.statSync(pdfPlan).size > 50000 && fs.statSync(pdfFiche).size > 50000, "PDF du plan et des plans de la pièce");
  if (fs.existsSync("/usr/bin/pdftotext")) {
    const t = require("child_process").execFileSync("pdftotext", ["-layout", pdfFiche, "-"]).toString();
    verifier(t.includes("CVC26110064003") && t.includes("Pdc 40") && t.includes("Sentinelle V"), "PDF : la pièce, les Pdc, la version de Sentinelle");
  }

  // 3. Outil Plans de coupe, plan modifié à la scie.
  await page.evaluate(() => ouvrirOutilPlans(pairesDeLaSemaine(ongletDuNumero(48))[0]));
  await page.waitForSelector("#choixPlansMatiere", { timeout: 60000 });
  await page.selectOption("#choixPlansMatiere", "SAG10HYBR");
  verifier((await page.locator("#zonePlansLancement .pl-carte").count()) === 20, "outil : les 20 plans du SAG10HYBR");
  await telecharge(() => page.click("#btnImprimerMatiere"));
  if (modifie) {
    await page.evaluate(async (m) => comparerPlanModifie(new File([new Uint8Array(m[0])], m[1])), fic(modifie));
    await page.waitForSelector("#zonePlansModifies .pl-puces");
    const t = await page.innerText("#zonePlansModifies");
    verifier(t.includes("1 plan(s) changé(s) sur 400") && t.includes("module T101 plus dans aucun plan") && t.includes("2 pièce(s) du lancement dans aucun plan"), "plan modifié : changement et pièces perdues");
    await telecharge(() => page.click("#btnImprimerModif"));
  }

  // 4. Expérimental : liste de coupe générée (mêmes pièces, moins de pertes).
  await page.click('.menu [data-onglet="controle"]').then(() => page.click('.onglet-btn[data-onglet="liste-opt"]'));
  await page.waitForFunction(() => document.querySelector("#champNomListe") && document.querySelector("#champNomListe").value === "LAN264801START_OPT", null, { timeout: 30000 });
  await page.click("#btnGenererListe");
  await page.waitForSelector("#btnEnregistrerListe", { timeout: 120000 });
  const liste = await page.innerText("#zoneListeOpt");
  verifier(liste.includes("494 pièces, les mêmes") && liste.includes("5 pièce(s) retirée(s)"), "liste générée : mêmes pièces, celles hors lancement retirées");
  verifier(liste.includes("461,2 m²") && liste.includes("446,8 m²") && liste.includes("716,9 m²") && liste.includes("687,9 m²"), "liste générée : agglo 461,2 → 446,8 m², stratifié 716,9 → 687,9 m²");
  const ctt = await telecharge(() => page.click("#btnEnregistrerListe"));
  verifier(path.basename(ctt) === "LAN264801START_OPT.ctt" && fs.readFileSync(ctt, "latin1").includes("\r\nPNLHDR1,0,51,LAN264801START_OPT,"), "liste générée : LAN264801START_OPT.ctt");

  // 5. Noms de lancement avec espace : deux chantiers distincts.
  const chantiers = await page.evaluate(() => {
    const noms = ["LAN2648CHANTIERS.xlsx", "SOMMAIRE LAN2648CHANTIERS BIS.pdf", "LAN2648CHANTIERS BIS.xlsx", "LISTE DE COUPES LAN2648CHANTIERSBIS.pdf"];
    const res = repartirFichiersDossier(noms.map((nom, i) => ({ nom, chemin: ["CHANTIERS"], date: 1000 + i })), ongletDuNumero(48), "Semaine 48");
    return res.chantiers.map((g) => `${g.strat.nom}|${g.coupe ? g.coupe.nom : ""}`).sort();
  });
  verifier(chantiers.length === 2 && chantiers[0] === "LAN2648CHANTIERS BIS.xlsx|LISTE DE COUPES LAN2648CHANTIERSBIS.pdf", "LAN2648CHANTIERS BIS : à part, avec sa liste de coupe");

  // 6. Quatre semaines.
  const semaines = await page.evaluate(() => [45, 46, 47, 48].map(ongletDuNumero).join(" "));
  verifier(semaines === "impaire paire2 impaire2 paire" && (await page.locator('.onglet-btn[data-onglet^="paire"], .onglet-btn[data-onglet^="impaire"]').count()) === 4, "4 onglets semaine (45, 46, 47, 48)");

  // 7. Recherche d'une commande : les plans de chaque pièce ; un plan modifié dans Sentinelle (le .bkp ne change pas),
  //    imprimé d'origine, modifié ou avant / après, et envoyé modifié au téléphone.
  await page.evaluate(async () => {
    const d = await lirePlansBkp(pairesDeLaSemaine(ongletDuNumero(48))[0].bkp);
    await archiverLancements([{ annee: 2026, semaine: 48, lancement: { nom: "LAN264801START", poste: "Agglo 1er tour", pieces: [["CVC26110064003"]], plans: plansPourTelephone(d, ["CVC26110064003"]) } }]);
    onglet = "recherche";
    afficher();
  });
  await page.fill("#champRecherche", "CVC26110064");
  await page.click("#btnRechercher");
  await page.waitForSelector(".ligne-piece [data-voir-plans]", { state: "attached", timeout: 120000 });
  verifier((await page.locator(".ligne-piece [data-voir-plans]").count()) === 4, "recherche d'une commande : « Voir les plans de coupe » sur chaque pièce");
  const ligne = page.locator(".ligne-piece").filter({ hasText: "26110064003" }).first();
  await ligne.locator(".ligne-piece-haut").click();
  await ligne.locator("[data-voir-plans]").click();
  await ligne.locator(".pl-carte").first().waitFor({ timeout: 120000 });
  verifier((await ligne.locator(".pl-carte").count()) === 4, "les 4 plans de la pièce dans la liste des résultats");
  await ligne.locator(".pl-carte").first().click();
  await page.waitForSelector("#modalePlan");
  await page.click("#modalePlan [data-editer]");
  const morceaux = await page.evaluate(() => planEnGrand.x.plan.rects.map((r, i) => ({ i, chute: !!r.chute, fini: r.fini })).filter((r) => !r.chute));
  const [m1, m2] = morceaux;
  await page.click(`#modalePlan .pl-dessin [data-idx="${m1.i}"]`);
  await page.fill('#modalePlan [data-champ="finiL"]', String(m1.fini[0] + 500));
  await page.click('#modalePlan [data-action-plan="modifier"]');
  verifier((await page.innerText("#modalePlan .pl-message")).includes("Plus grande que sa place"), "pièce agrandie au-delà de sa place : refusée");
  await page.fill('#modalePlan [data-champ="finiL"]', String(m1.fini[0] - 100));
  await page.fill('#modalePlan [data-champ="note"]', "recoupée à la scie");
  await page.click('#modalePlan [data-action-plan="modifier"]');
  await page.click(`#modalePlan tr[data-choisir="${m2.i}"]`);
  await page.click('#modalePlan [data-action-plan="retirer"]');
  await page.click(`#modalePlan tr[data-choisir="${m2.i}"]`);
  await page.fill('#modalePlan [data-champ="cle"]', "CVC26119999001");
  await page.fill('#modalePlan [data-champ="article"]', "ESSAI");
  await page.fill('#modalePlan [data-champ="finiL"]', "500");
  await page.fill('#modalePlan [data-champ="finiW"]', "100");
  await page.click('#modalePlan [data-action-plan="poser"]');
  const changes = await page.innerText("#modalePlan .pl-changements");
  verifier(changes.includes("Ce qui a changé (3)") && changes.includes("cote finie 480 × 192 → 380 × 192 ; recoupée à la scie") && changes.includes("CVC26110064004 retirée du plan") && changes.includes("+ CVC26119999001 ESSAI 500 × 100 posée à la place de n°2"), "plan modifié : cote, pièce retirée, pièce posée à sa place");
  if (captures) await page.screenshot({ path: path.join(captures, "web_plan_modifie.png") });
  await page.click("#modalePlan [data-editer]");
  const pdfs = {};
  for (const quoi of ["origine", "modifie", "deux"]) pdfs[quoi] = await telecharge(() => page.click(`#modalePlan [data-imprimer="${quoi}"]`));
  verifier(Object.values(pdfs).every((f) => fs.statSync(f).size > 50000) && path.basename(pdfs.deux) === "Plan_LAN264801START_module_T73_avant_apres.pdf", "PDF : plan d'origine, plan modifié, avant / après");
  if (fs.existsSync("/usr/bin/pdftotext")) {
    const texte = (f) => require("child_process").execFileSync("pdftotext", ["-layout", f, "-"]).toString();
    const [o, m, d] = [texte(pdfs.origine), texte(pdfs.modifie), texte(pdfs.deux)];
    verifier(!o.includes("ESSAI") && m.includes("ESSAI") && m.includes("MODIFIÉ") && m.includes("480 × 192 -> 380 × 192") && !m.includes("?"), "PDF d'origine sans les modifications ; PDF modifié avec (sans « ? » à la place des flèches)");
    verifier(d.includes("AVANT (plan d'origine)") && d.includes("APRÈS (modifié)") && d.includes("retirée dans le plan modifié"), "PDF avant / après");
  }
  await page.click("#modalePlan .pl-boutons [data-fermer]");
  verifier((await ligne.locator(".pl-carte.modifie").count()) === 1 && (await ligne.locator(".pl-carte").first().innerText()).includes("✎ modifié dans Sentinelle"), "vignette : « ✎ modifié dans Sentinelle »");
  await page.waitForFunction(() => { const s = [...bibliotheque.semaines.values()].find((x) => x.semaine === 48); const l = s && s.lancements.find((y) => y.nom === "LAN264801START"); return l && l.plans.plans.some((p) => p[10] === 1); }, null, { timeout: 15000 }).catch(() => null);
  const tel = await page.evaluate(() => {
    const s = [...bibliotheque.semaines.values()].find((x) => x.semaine === 48);
    const t = s.lancements.find((y) => y.nom === "LAN264801START").plans;
    const pl = t.plans[t.pieces.CVC26110064003.p[0][0]];
    return { modifie: pl[10], etats: pl[9].filter((r) => r.length > 8).map((r) => `${r[8]}:${t.noms[r[4]]}`).join(" "), envoye: contenuFichierPartage().semaines.some((x) => x.lancements.some((l) => l.plans && l.plans.plans.some((p) => p[10] === 1))) };
  });
  verifier(tel.modifie === 1 && tel.etats === "m:CVC26110041005 a:CVC26119999001" && tel.envoye, `téléphone : le plan part modifié (${tel.etats})`);
  // Tout remettre comme à l'origine.
  await ligne.locator(".pl-carte").first().click();
  await page.waitForSelector("#modalePlan");
  await page.click("#modalePlan [data-editer]");
  await page.click("#modalePlan [data-tout-remettre]");
  await page.click("#modaleConfirmationOk");
  await page.waitForFunction(() => !document.querySelector("#modalePlan .pl-changements"));
  await page.click("#modalePlan .pl-boutons [data-fermer]");
  verifier((await ligne.locator(".pl-carte.modifie").count()) === 0, "tout remis comme à l'origine");

  // V6.9.5 : « 5<6,7> » (5, puis 6, puis 7 à la même place, plan fait 3 fois) est un seul morceau ; un plan dont
  // aucune lecture ne tient (stratifié de 4110 sur un panneau de 4100) garde la lecture qui dépasse le moins.
  const r9 = await page.evaluate(() => {
    const morceau = (n, nom, L, W, cle) => {
      const c = new Array(33).fill("");
      Object.assign(c, { 0: "0", 1: nom, 2: String(n), 4: String(L), 5: String(L), 6: String(W), 7: String(W), 12: "1", 17: cle });
      return c.join(",");
    };
    const pct = [morceau(5, "LT18/1", 3600, 670, ""), morceau(6, "LT19/1", 3600, 670, ""), morceau(7, "LT20/1", 3160, 670, ""), morceau(1, "L0138", 4110, 660, "CVC1")].join("\n");
    const a = lirePlansMatiere(pct, "PRM1,4.4,0,0,0,0,0\nMAT1,x,1002,0.6\nPTN1,1,x,3,0,0,0,0,0,0\nPTN3,5<6,7>/", "BRD1,X3988/0003,x,3650,850");
    const b = lirePlansMatiere(pct, "PRM1,4.4,0,0,0,0,0\nMAT1,x,1124,0.6\nPTN1,1,x,1,0,0,0,0,0,0\nPTN3,X1/1/", "BRD1,1124_4100_1310,x,4100,1310");
    const pb = b.plans[0].rects.find((r) => r.seq);
    return {
      a: a.plans[0].ok + " " + a.plans[0].rects.filter((r) => r.seq).map((r) => r.seq.join(">")).join(" "),
      b: `${pb.L}×${pb.W}`,
      bande: [extraireNumeroBandeRecherche("LT23/1"), extraireNumeroBandeRecherche("LAN264702START LT23/1"), lancementDeLaBandeRecherche("lan264702start lt23/1"), extraireNumeroBandeRecherche("26110117001")].join(" "),
    };
  });
  verifier(r9.a === "true 5>6>7", `plan « 5<6,7>/ » : un seul morceau, passages 5 puis 6 puis 7 (${r9.a})`);
  verifier(r9.b === "4110×660", `plan qui dépasse de 10 mm : lu à plat, pas tourné (${r9.b})`);
  verifier(r9.bande === "23 23 LAN264702START ", `recherche par bande : « LT23/1 », avec le lancement de l'étiquette (${r9.bande})`);

  await nav.close();
  console.log(echecs ? `${echecs} ÉCHEC(S)` : "TOUT EST OK");
  process.exitCode = echecs ? 1 : 0;
})();
