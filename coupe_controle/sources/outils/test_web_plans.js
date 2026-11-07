// V6.1 : plans de coupe Cut Rite, contrôle des pièces placées, recherche d'une pièce, outil Plans de coupe,
// plan modifié à la scie, liste de coupe générée (expérimental), noms de lancement avec espace.
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
      hors: pr.hors.filter((h) => h.type === "Dans le .bkp, dans aucun plan").map((h) => h.cle),
      piece: plansDeLaPiece(d, "CVC26110064003").plans.map((x) => `${x.rang}:${x.plan.matiere}:${x.plan.pdc}`),
    };
  }, [fic(path.join(dossier, "LAN264801START.xlsx")), fic(path.join(dossier, "LISTE DE COUPES LAN264801STRAT.pdf")), fic(path.join(dossier, "LAN264801STARTbackup.bkp"))]);
  verifier(r1.nbPlans === 326 && r1.nbModules === 74 && r1.malLus === 0, `326 plans et 74 modules, tous bien lus (${r1.nbPlans}, ${r1.nbModules}, ${r1.malLus})`);
  verifier(r1.plans.nonPlacees.length === 0, "toutes les pièces du lancement sont dans un plan");
  verifier(r1.plans.horsLancement.length === 5 && r1.ecarts === 0, "les 5 pièces de la liste du .bkp hors lancement : à part, plus « en trop »");
  verifier(r1.bilan && r1.bilan.statut === "attention" && r1.hors.length === 5, "bilan Plans de coupe : à vérifier, 5 pièces dans aucun plan");
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
  await page.click('.onglet-btn[data-onglet="liste-opt"]');
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

  await nav.close();
  console.log(echecs ? `${echecs} ÉCHEC(S)` : "TOUT EST OK");
  process.exitCode = echecs ? 1 : 0;
})();
