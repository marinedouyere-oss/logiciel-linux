// Test de la page web Sentinelle V3.4 sur les vrais dossiers S44 et S45.
// Usage : node test_web.js <dossier du site de test> <dossier captures>
// Aucun serveur : le navigateur reçoit les fichiers du disque via page.route.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const site = process.argv[2];
const captures = process.argv[3];
const base = "https://sentinelle.test";

const echecs = [];
function verifier(condition, message) {
  if (!condition) echecs.push(message);
  console.log(`${condition ? "OK  " : "ÉCHEC"} ${message}`);
}

async function attendreFin(page, maxMs = 600000) {
  const fin = Date.now() + maxMs;
  while (Date.now() < fin) {
    // Fenêtre « semaines de livraison différentes » : on continue.
    const modale = await page.$("#modaleConfirmation:not(.masquee)");
    if (modale) await page.click("#modaleConfirmationOk");
    const texte = await page.innerText("main");
    const scanFini = await page.evaluate(() => {
      const b = document.querySelector("#btnScanner");
      return !b || !b.disabled;
    });
    const calculs = await page.evaluate(
      () =>
        [...document.querySelectorAll("#zoneRecap td")].some((td) => td.textContent.trim() === "…") ||
        (document.querySelector("#texteCompteur") || {}).textContent === "…"
    );
    if (scanFini && !calculs && !texte.includes("⏳") && !texte.includes("Scan en cours")) return texte;
    await page.waitForTimeout(300);
  }
  throw new Error("délai dépassé\n" + (await page.innerText("main")));
}

(async () => {
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 1100, height: 1000 } });
  await page.addInitScript(() => { try { localStorage.setItem("sentinelle-vue-controle", "toutes"); } catch (e) {} }); // V6.9 : toutes les cases affichées (tests du contrôle)
  page.on("dialog", (d) => {
    console.log("ALERTE:", d.message());
    d.accept();
  });
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs.push("erreur JS : " + e.message);
  });
  // Faux sélecteur de dossier : sert les fichiers du dossier de test.
  await page.addInitScript(() => {
    window.__dossierSuivant = null;
    window.showDirectoryPicker = async () => {
      const dossier = window.__dossierSuivant;
      const liste = await (await fetch(`liste_${dossier}.json`)).json();
      return {
        kind: "directory",
        name: dossier === "s44" ? "Semaine 44" : "Semaine 45",
        async queryPermission() {
          return "granted";
        },
        async requestPermission() {
          return "granted";
        },
        async *entries() {
          for (const f of liste) {
            yield [
              f.nom,
              {
                kind: "file",
                name: f.nom,
                async getFile() {
                  const octets = await (await fetch(`${dossier}/${encodeURIComponent(f.nom)}`)).arrayBuffer();
                  return new File([octets], f.nom, { lastModified: f.date });
                },
              },
            ];
          }
        },
      };
    };
  });
  await page.route(`${base}/**`, async (route) => {
    const relatif = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
    const fichier = path.join(site, relatif);
    if (!fichier.startsWith(site) || !fs.existsSync(fichier)) return route.fulfill({ status: 404, body: "" });
    const type = fichier.endsWith(".html") ? "text/html; charset=utf-8" : fichier.endsWith(".json") ? "application/json" : "application/octet-stream";
    return route.fulfill({ status: 200, body: fs.readFileSync(fichier), headers: { "content-type": type } });
  });
  // Fichiers créés tout seuls (problèmes du lancement).
  const telecharges = [];
  page.on("download", (d) => telecharges.push(d.suggestedFilename()));
  await page.goto(base + "/index.html");
  await page.click('.menu [data-onglet="controle"]').then(() => page.click('.onglet-btn[data-onglet="paire"]'));
  await page.waitForSelector("#btnChoisirDossier");

  // ---- Semaine 44 (onglet pair) ----
  await page.evaluate(() => (window.__dossierSuivant = "s44"));
  await page.click("#btnChoisirDossier");
  await page.waitForSelector("#btnScanner:not([disabled])");
  const t0 = Date.now();
  await page.click("#btnScanner");
  await page.waitForTimeout(500);
  let texte = await attendreFin(page);
  console.log(`S44 scannée et contrôlée en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const onglets = await page.$$eval('.onglet-btn[data-onglet="paire"], .onglet-btn[data-onglet="impaire"]', (bs) => bs.map((b) => (b.querySelector(".libelle-onglet") || b).textContent.trim()));
  verifier(onglets[0] === "Semaine 44", `onglet pair = « ${onglets[0]} »`);
  verifier(texte.includes("✔ Casse : LAN264301CASSE.xlsx + .bkp"), "casse 43 rangée en semaine 44");
  verifier(texte.includes("✔ Agglo 1er tour : LAN264401STRAT.xlsx + coupe + .bkp"), "agglo 1er tour avec coupe et .bkp");
  verifier(texte.includes("✔ Tout est correct — 101 pièces"), "Feno : 101 pièces, aucune anomalie");
  verifier(texte.includes("✔ Tout est correct — 69 pièces"), "Casse 43 : 69 pièces");
  verifier(/⚠ \d+ pièce\(s\) lancée\(s\) deux fois/.test(texte), "pièces lancées deux fois (une ligne)");
  verifier(/⚠ Couleurs : 1 couleur\(s\) du lancement absente/.test(texte), "couleur B125-FA absente (une ligne)");
  verifier(/⚠ Scies : \d+ pièce\(s\) différente\(s\)/.test(texte), "Scies : écarts (une ligne)");
  // Le détail des problèmes n'est que dans le fichier Excel.
  for (const detail of ["CVC26100163003", "CVC26090772001", "Couleur B125-FA", "prévue(s)", "Absente de", "à livrer en semaine"])
    verifier(!texte.includes(detail), `pas de détail à l'écran : « ${detail} »`);
  verifier(texte.includes("pièces dans les .bkp"), "compteur affiché");
  // Le dossier « Semaine 44 » décide de la semaine, même si la colonne lancement dit 45 (comme LAN2647CHANTIERSBIS,
  // colonne LAN2646BSR, rangé dans « Semaine 47 »).
  verifier(!texte.includes("LAN2644TRIGANO.xlsx → semaine 45"), "chantier TRIGANO du dossier Semaine 44 pas envoyé en 45");
  const recap44 = await page.innerText("#zoneRecap");
  verifier(/LAN2644TRIGANO\s*\t/.test(recap44), "chantier LAN2644TRIGANO dans l'onglet 44 (son dossier)");
  verifier(texte.includes("Rapport de la semaine (.xlsx)"), "bouton d'export de la semaine en haut");
  console.log("Créés tout seuls :", telecharges.join(", "));
  verifier(telecharges.includes("rapport_sentinelle_semaine_44.xlsx"), "problèmes : rapport de la semaine créé tout seul après le scan");
  verifier(!telecharges.some((n) => n.endsWith("_problemes.xlsx")), "problèmes : un seul fichier pour le scan, pas un par lancement");
  verifier(/📊 \d+ problème\(s\) : rapport rapport_sentinelle_semaine_44\.xlsx créé/.test(texte), "problèmes : le scan dit quel rapport il a créé");
  verifier(/📊 \d+ problème\(s\) : voir l'onglet « Agglo 1er tour » du rapport/.test(texte), "problèmes : la case renvoie à son onglet");
  // Lecteur de liste de coupe PDF : une pièce sans code matériau compte aussi.
  {
    const r = await page.evaluate(() =>
      extraireRecordsPDF(["1. TD98401 4100.0 105.0 5 O 0000", "5.num commande+ligne CVC26100504001, 6.Epaisseur 105", "2. CRED14 SAG12HYBR 450.0 150.0 2 O 0000", "5.num commande+ligne CVC26070301007,"])
        .map((x) => `${x.desc}|${x.materiau}|${x.qte}|${x.cle}`)
    );
    verifier(r.join(" ") === "TD98401||5|CVC26100504001 CRED14|SAG12HYBR|2|CVC26070301007", `PDF : pièce sans code matériau (${r.join(" ")})`);
    const c = await page.evaluate(() => {
      const r = controlerCouleurs([{ cle: "A001", lignesBrutes: [{ coloris: "1136", coloris_inf: "1063", comdet_qte: "1" }] }],
        { dessus: new Map([["1136-PF", 1]]), dessous: new Map([["975", 1]]), sansStratifie: false });
      return `${r.variantes.map((v) => `${v.couleur}>${v.variante}`).join(",")} / ${r.absentes.map((a) => a.couleur).join(",")}`;
    });
    verifier(c === "1136>1136-PF / 1063", `couleurs : petit format repéré (voulu), couleur absente à corriger (${c})`);
  }
  // Rapport des problèmes du lancement : bilan des contrôles, puis les pièces, problème par problème.
  {
    const carte = page.locator(".carte-paire", { hasText: "✓ LAN264401STRAT.xlsx" }).first();
    const [xlsx] = await Promise.all([page.waitForEvent("download"), carte.locator('[data-action="problemes-lancement"]').click()]);
    const chemin = `${captures}/web_${xlsx.suggestedFilename()}`;
    await xlsx.saveAs(chemin);
    verifier(xlsx.suggestedFilename() === "LAN264401STRAT_problemes.xlsx", `problèmes : ${xlsx.suggestedFilename()}`);
    const lu = require("child_process").execFileSync(path.join(__dirname, "..", "venv", "bin", "python3"), ["-I", "-c", `
import sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
print("FEUILLES", wb.sheetnames)
for r in wb["Rapport"].iter_rows(values_only=True):
    v = [str(x).replace(chr(10), " / ") for x in r if x not in (None, "")]
    if v: print(" | ".join(v))
`, chemin]).toString();
    console.log(lu.split("\n").slice(0, 40).join("\n"));
    verifier(lu.includes("FEUILLES ['Rapport']"), "problèmes : une seule feuille");
    verifier(/1\. Bilan des contrôles/.test(lu) && /✔ OK \| Lancement \/ liste de coupe \| Tout est correct/.test(lu), "problèmes : bilan du contrôle de la liste de coupe");
    verifier(/✔ OK \| Lignes en double/.test(lu) || /⚠ Problème \| Lignes en double/.test(lu), "problèmes : bilan des doublons");
    // MEGANITE CVC26080067 ligne 1 : dans la liste de coupe sans « 5.num commande+ligne » (clé refaite avec la commande et la ligne).
    verifier(!/Absente de la liste de coupe/.test(lu) && !/CVC26080067001 \|[^\n]*aucune dans la liste de coupe/.test(lu), "problèmes : pièce de la liste de coupe sans « num commande+ligne » retrouvée");
    verifier(/À corriger \| CVC26090772001 \|[^\n]*aucune dans le \.bkp/.test(lu), "problèmes : pièce absente du .bkp");
    verifier(/Couleur B125-FA \(face dessus\) : pas de panneau/.test(lu), "problèmes : couleur absente");
    verifier(/À livrer en semaine 43/.test(lu), "problèmes : autre semaine de livraison");
    verifier(/3\. Fichiers comparés/.test(lu) && /Liste de coupe \|/.test(lu), "problèmes : fichiers comparés");
  }
  console.log(texte.split("\n").slice(0, 60).join("\n"));
  await page.screenshot({ path: `${captures}/web_s44.png`, fullPage: true });

  // ---- Semaine 45 (onglet impair) ----
  await page.click('.menu [data-onglet="controle"]').then(() => page.click('.onglet-btn[data-onglet="impaire"]'));
  await page.evaluate(() => (window.__dossierSuivant = "s45"));
  await page.click("#btnChoisirDossier");
  await page.waitForSelector("#btnScanner:not([disabled])");
  await page.click("#btnScanner");
  await page.waitForTimeout(500);
  texte = await attendreFin(page);
  const onglets2 = await page.$$eval('.onglet-btn[data-onglet="paire"], .onglet-btn[data-onglet="impaire"]', (bs) => bs.map((b) => (b.querySelector(".libelle-onglet") || b).textContent.trim()));
  verifier(onglets2[1] === "Semaine 45", `onglet impair = « ${onglets2[1]} »`);
  verifier(texte.includes("✔ Casse : LAN2644CASSE.xlsx + .bkp"), "casse 44 rangée en semaine 45");
  verifier(texte.includes("LAN264502STRA backup.bkp"), "bkp au nom approché rattaché");
  // Petit format voulu : 1063 optimisé en 1063-PF n'est pas un problème, juste précisé.
  verifier(/✔ Couleurs : les \d+ couleurs sont dans le \.bkp \(1063-PF : petit format\)/.test(texte) && !texte.includes("remplacée par 1063-PF"), "couleur 1063 en petit format 1063-PF (Feno) : pas un problème");
  verifier(texte.includes("✔ Tout est correct — 116 pièces"), "Feno 45 : 116 pièces");
  verifier(!texte.includes("CVC26100043001") && !texte.includes("CVC26100043002"), "doublons CVC26100043001/002 : pas de détail à l'écran");
  await page.waitForFunction(() => document.querySelector("main").innerText.includes("de la casse déjà lancée(s)"), null, { timeout: 60000 });
  texte = await page.innerText("main");
  verifier(texte.includes("🔁 13 pièce(s) de la casse déjà lancée(s) en semaine 44"), "casse : 13 pièces déjà lancées en semaine 44");
  verifier(!texte.includes("CVC26100337006"), "casse : pas de détail à l'écran");
  verifier(texte.includes("47 autre(s) pièce(s) pas lancée(s) en semaine 44"), "casse : 47 autres pièces");
  verifier(!texte.includes("⚠ Pièces déjà lancées en Semaine 44"), "plus d'alerte générale pour la casse");
  verifier(/⚠ \d+ pièce\(s\) à livrer une autre semaine que leur lancement/.test(texte), "autre semaine de livraison (une ligne)");
  verifier(!texte.includes("à livrer en semaine 44"), "livraison : pas de détail à l'écran");
  // Rapport du lancement de la casse (sans sommaire) : pièces relancées, puis rajouts.
  {
    const carteCasse = page.locator(".carte-paire", { hasText: "LAN2644CASSE.xlsx" }).first();
    const [pdf] = await Promise.all([page.waitForEvent("download"), carteCasse.locator('[data-action="rapport-lancement"]').click()]);
    const chemin = `${captures}/web_${pdf.suggestedFilename()}`;
    await pdf.saveAs(chemin);
    verifier(pdf.suggestedFilename() === "LAN2644CASSE_rapport_lancement.pdf", `rapport casse : ${pdf.suggestedFilename()}`);
    const contenu = require("child_process").execFileSync("pdftotext", ["-layout", chemin, "-"]).toString();
    const pages = require("child_process").execFileSync("pdfinfo", [chemin]).toString();
    verifier(/Pages:\s+3/.test(pages), "rapport casse : 3 pages");
    for (const attendu of ["Casse : pièces relancées", "13 pièce(s) relancée(s) : déjà lancée(s) en semaine 44", "CVC26100337006", "LAN264401STRAT.xlsx",
      "Casse : rajouts", "47 rajout(s) : pièce(s) pas lancée(s) en semaine 44", "CVC26100727002", "JAUNE"]) {
      verifier(contenu.includes(attendu), `rapport casse : « ${attendu} »`);
    }
  }
  // Rapport des problèmes de la casse : relancées et rajouts, pour info (une pièce de casse déjà lancée est normale).
  {
    const carteCasse = page.locator(".carte-paire", { hasText: "LAN2644CASSE.xlsx" }).first();
    const [xlsx] = await Promise.all([page.waitForEvent("download"), carteCasse.locator('[data-action="problemes-lancement"]').click()]);
    const chemin = `${captures}/web_casse_${xlsx.suggestedFilename()}`;
    await xlsx.saveAs(chemin);
    const lu = require("child_process").execFileSync(path.join(__dirname, "..", "venv", "bin", "python3"), ["-I", "-c", `import sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
for r in wb["Rapport"].iter_rows(values_only=True):
    v = [str(x).replace(chr(10), " / ") for x in r if x not in (None, "")]
    if v: print(" | ".join(v))
`, chemin]).toString();
    verifier(/✔ OK \| Casse \| 13 pièce\(s\) relancée\(s\) \(déjà lancées en semaine 44\) et 47 rajout\(s\)/.test(lu), "problèmes casse : bilan relancées / rajouts (pour info)");
    verifier(!/À vérifier \| CVC/.test(lu) || !/Casse : relancée[^\n]*\n[^\n]*\nÀ vérifier/.test(lu), "problèmes casse : les pièces relancées ne sont pas des problèmes");
    verifier(/Casse : relancée — 13 pièce\(s\)/.test(lu) && /Casse : rajout — 47 pièce\(s\)/.test(lu), "problèmes casse : relancées puis rajouts");
    verifier(/Pour info \| CVC26100337006 \|[^\n]*Déjà lancée en semaine 44 dans LAN26\d+\w+\.xlsx/.test(lu), "problèmes casse : pièce relancée et son lancement d'origine");
  }
  verifier(texte.includes("Couleurs : pas de stratifié dans ce .bkp"), "recyclage sans stratifié");
  verifier(!/LAN2644TRIGANO\s*\t/.test(await page.innerText("#zoneRecap")), "chantier LAN2644TRIGANO pas dans l'onglet 45");
  console.log(texte.split("\n").slice(0, 60).join("\n"));
  await page.screenshot({ path: `${captures}/web_s45.png`, fullPage: true });
  verifier(!texte.includes("Exporter le rapport (.xlsx)"), "plus de bouton d'export par lancement");
  const [telechargement] = await Promise.all([page.waitForEvent("download"), page.click("#btnExporterSemaine")]);
  await telechargement.saveAs(`${captures}/rapport_semaine_45.xlsx`);
  verifier(telechargement.suggestedFilename() === "rapport_sentinelle_semaine_45.xlsx", `rapport exporté : ${telechargement.suggestedFilename()}`);
  {
    const lu = require("child_process").execFileSync(path.join(__dirname, "..", "venv", "bin", "python3"), ["-I", "-c", `import sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
print("FEUILLES", wb.sheetnames)
for r in wb.worksheets[0].iter_rows(values_only=True):
    v = [str(x) for x in r if x not in (None, "")]
    if v: print(" | ".join(v))
`, `${captures}/rapport_semaine_45.xlsx`]).toString();
    console.log(lu.split("\n").slice(0, 26).join("\n"));
    verifier(/Agglo 1er tour \| LAN264501STRAT \| 422 \| 422 \|/.test(lu), "rapport de la semaine : pièces prévues et .bkp de chaque lancement");
    verifier(/Total \| 1196 \| 1173 \|/.test(lu), "rapport de la semaine : total des pièces");
    verifier(/Pièces : 1196 prévues dans 6 lancement\(s\), 1173 dans les \.bkp\./.test(lu), "bilan de la semaine : pièces");
    verifier(/Casse \(LAN2644CASSE\) : 61 pièce\(s\) — 13 déjà lancée\(s\) en semaine 44, 47 rajout\(s\)/.test(lu), "bilan de la semaine : casse (déjà lancées, rajouts)");
    verifier(/2 pièce\(s\) lancée\(s\) deux fois/.test(lu), "bilan de la semaine : pièces lancées deux fois");
    verifier(/FEUILLES \['Semaine 45 — synthèse', 'Agglo 1er tour', [^\n]*'Casse'/.test(lu), "rapport de la semaine : synthèse puis un onglet par lancement");
    verifier(/\d+ problème\(s\) dans \d+ lancement\(s\) sur \d+/.test(lu) && /Total \|/.test(lu), "rapport de la semaine : résumé et total");
  }

  // ---- Recherche ----
  await page.click('.onglet-btn[data-onglet="recherche"]');
  await page.fill("#champRecherche", "CVC26100163003");
  await page.click("#btnRechercher");
  await page.waitForFunction(() => !document.querySelector("#resultatsRecherche").innerText.includes("Recherche en cours"), null, { timeout: 120000 });
  texte = await page.innerText("#resultatsRecherche");
  // V6.1 : la fiche simple de la pièce d'abord, la commande repliée dessous.
  verifier(texte.includes("CVC26100163003 · commande CVC26100163, ligne 3") && texte.includes("Les autres pièces de la commande CVC26100163"), "fiche de la pièce, puis la commande");
  verifier(texte.includes("Agglo 1er tour") && texte.includes("Agglo 2ème tour"), "pièce trouvée dans les deux tours");
  console.log(texte.slice(0, 1500));
  await page.screenshot({ path: `${captures}/web_recherche.png`, fullPage: true });

  // ---- Rechargement : tout est retrouvé ----
  await page.reload();
  await page.click('.menu [data-onglet="controle"]').then(() => page.click('.onglet-btn[data-onglet="paire"]'));
  await page.waitForSelector("#btnChoisirDossier");
  await page.waitForTimeout(3000);
  texte = await page.innerText("main");
  verifier(texte.includes("✔ Tout est correct — 101 pièces"), "résultats retrouvés après rechargement");

  await navigateur.close();
  console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : "\nTOUT EST OK");
  process.exit(echecs.length ? 1 : 0);
})();
