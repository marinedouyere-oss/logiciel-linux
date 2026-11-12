// V6.6 : vérifier un pré-lancement Diakonos (contrôle avant lancement + simulation sur le stock).
// Données fabriquées (anonymes) : un pré-lancement de 19 colonnes sans en-tête, un petit stock woodStore, une
// bibliothèque avec un lancement déjà fait (pour apprendre les articles et repérer une pièce déjà lancée).
// Usage : node test_web_pre_lancement.js <index.html> <dossier de sortie>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [pageHtml, sortie] = process.argv.slice(2);
let echecs = 0;
const verifier = (ok, t) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`);
  if (!ok) echecs++;
};

// Stock : code, qté, matériau, L, l, ép., prix, limite, -, description, fil, -, -, -, statut, emplacements, -, famille.
const ligneStock = (code, qte, mat, L, W, ep, limite, desc, fil, statut, emplacements) => {
  const c = new Array(20).fill("");
  [c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[9], c[10], c[11], c[13], c[14], c[15]] = [code, qte, mat, L, W, ep, "100.000", limite, desc, fil, "0", "0.000", statut, emplacements];
  return c.join(",");
};
const STOCK = [
  ligneStock("9001_4100_1300", 40, "9001", "4100.0", "1300.0", "0.8", 0, "STRAT ESSAI CHENE 4100*1300", 1, 0, "1041(40)"),
  ligneStock("9002_4200_1400", 1, "9002", "4200.0", "1400.0", "0.8", 0, "STRAT ESSAI NICKEL 4200*1400", 0, 0, "1042(1)"),
  // Cas du 1136 : grand format à 0 (limité au stock), seul le petit format en stock.
  ligneStock("9004_4110_2060", 0, "9004", "4110.0", "2060.0", "0.7", 0, "STRAT ESSAI CASELLA 4110*2060", 1, 0, ""),
  ligneStock("9004_5_2790_2060", 14, "9004-PF", "2790.0", "2060.0", "0.8", 0, "STRAT ESSAI CASELLA 2790*2060", 1, 0, "7107(14)"),
  ligneStock("SAG38HYBL_4100_2070", 1, "SAG38HYBL", "4100.0", "2070.0", "38.0", 9, "AGGLO ESSAI 38 UNE FACE MELAMINE", 0, 0, "1200(1)"),
  ligneStock("SMELBLALIS19_4110_2070", 7, "SMELBLALIS19", "4110.0", "2070.0", "19.0", 0, "MELAMINE ESSAI BLANC 19MM", 0, 0, "1200(7)"),
  ligneStock("RCB_4200_1600", 300, "RCB", "4200.0", "1600.0", "0.8", 9, "CONTREBALANCEMENT ESSAI", 0, 0, "7124(300)"),
].join("\r\n");

// Pré-lancement : Qté à lancer, Semaine, Commande, Ligne, Catalogue, Article, Désignation, Qte, L, l, ép., code
// coloris, coloris, CP, ville, com_transporteur, Transporteur, Blocage compta, Blocage fab.
const P = (qteL, sem, cde, lig, art, des, qte, L, W, ep, col, compta = 0, fab = 0) => [qteL, sem, cde, lig, "Stratifié", art, des, qte, L, W, ep, col, `COLORIS ${col}`, 99999, "VILLE ESSAI", "TRANS1", "TRANSPORT ESSAI", compta, fab];
const PRE = [
  P(1, 48, "CVC99000001", 1, "TPPVC39551", "Plan ep 39mm - Chant Plaqué ABS - Prof 551-650", 1, 1900, 630, 39, 9001), // normale
  P(1, 48, "CVC99000001", 2, "TPPVC39551", "Plan ep 39mm - Chant Plaqué ABS - Prof 551-650", 1, 1200, 630, 39, 9001, 1), // bloquée compta
  P(1, 48, "CVC99000002", 1, "TPPVC39551", "Plan ep 39mm - Chant Plaqué ABS - Prof 551-650", 1, 900, 630, 39, 9001), // en double…
  P(1, 48, "CVC99000002", 1, "TPPVC39551", "Plan ep 39mm - Chant Plaqué ABS - Prof 551-650", 1, 900, 630, 39, 9001), // …deux fois
  P(1, 48, "CVC99000003", 1, "TPPVC39551", "Plan ep 39mm - Chant Plaqué ABS - Prof 551-650", 1, 1500, 630, 39, 9001), // déjà lancée
  P(1, 46, "CVC99000004", 1, "TPPVC39551", "Plan ep 39mm - Chant Plaqué ABS - Prof 551-650", 1, 1600, 630, 39, 9001), // en retard
  P(1, 48, "CVC99000005", 3, "RENF391001", "PLAN 39 MM AVEC RENFORTS METALLIQUES PROFONDEUR 10", 1, 1740, 1005, 38, 9001), // cas particulier
  P(1, 48, "CVC99000006", 2, "TPPVC39801", "Plan ep 39mm - Chant Plaqué ABS - Prof 801-1000", 1, 3449, 995, 39, 9004), // trop grande
  P(3, 48, "CVC99000007", 1, "TPPVC39551", "Plan ep 39mm - Chant Plaqué ABS - Prof 551-650", 2, 1000, 600, 39, 9001), // qté trop grande
  P(1, 48, "CVC99000008", 1, "XYZ123", "ARTICLE ESSAI INCONNU", 1, 800, 400, 18, 9002), // article jamais vu
  ...Array.from({ length: 6 }, (_, i) => P(1, 48, "CVC99000009", i + 1, "TPPVC39551", "Plan ep 39mm - Chant Plaqué ABS - Prof 551-650", 1, 3000, 1300, 39, 9002)), // 9002 : manque, limité au stock
];

(async () => {
  fs.mkdirSync(sortie, { recursive: true });
  const fichierStock = path.join(sortie, "brdlib_pl.bdx");
  fs.writeFileSync(fichierStock, Buffer.from(STOCK, "latin1"));
  const nav = await chromium.launch();
  const page = await (await nav.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  await page.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://s.test/index.html");
  await page.waitForFunction(() => typeof afficherPreLancement === "function" && typeof ExcelJS !== "undefined" && typeof bibliotheque !== "undefined", null, { timeout: 30000 });

  // Bibliothèque : un lancement déjà fait (TPPVC39551 → SAG38HYBL sans dessous ; CVC99000003 ligne 1 déjà lancée).
  await page.evaluate(() => {
    const s = { id: "2026-47", annee: 2026, semaine: 47, maj: "", supprimeeLe: null, colonnesPieces: COLONNES_PIECES_BIBLIOTHEQUE, lancements: [] };
    const piece = (cle, art, mat, inf, col, ep) => [cle, cle.slice(0, 11), String(Number(cle.slice(11))), art, 1, 1000, 600, ep, col, inf, mat, "2026-47", "", "", "0000", "", "", "CLIENT", "REF", "TRANS"];
    s.lancements.push({
      nom: "LAN264701ESSAI", fichier: "LAN264701ESSAI.xlsx", casse: false, pieces: [
        piece("CVC99000003001", "TPPVC39551", "SAG38HYBL", "", "9001", 39),
        piece("CVC98000001001", "TPPVC39551", "SAG38HYBL", "", "9001", 39),
        piece("CVC98000001002", "TPPVC39551", "SAG38HYBL", "", "9001", 39),
      ],
    });
    bibliotheque.semaines.set(s.id, s);
    bibliotheque.index = null;
    localStorage.removeItem("sentinelle-cas-particuliers");
  });
  // Stock.
  await page.click('[data-onglet="stock"]');
  await page.setInputFiles("#fichierStock", fichierStock);
  await page.waitForSelector(".stk-fichier");

  // Pré-lancement : fabriqué dans la page (ExcelJS), 19 colonnes sans en-tête.
  const fabriquer = async (lignes, titres) =>
    page.evaluate(
      async ([lignes, titres]) => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("Feuil1");
        if (titres) ws.addRow(titres);
        for (const l of lignes) ws.addRow(l);
        const buf = await wb.xlsx.writeBuffer();
        return btoa(String.fromCharCode(...new Uint8Array(buf)));
      },
      [lignes, titres]
    );
  const b64 = await fabriquer(PRE, null);
  const fichierPre = path.join(sortie, "pre_lancement_essai.xlsx");
  fs.writeFileSync(fichierPre, Buffer.from(b64, "base64"));
  await page.click('[data-onglet="prelancement"]');
  await page.setInputFiles("#fichierPreLancement", fichierPre);
  await page.waitForSelector("#pagePreLancement .pl-sim", { timeout: 20000 });
  const texte = await page.locator("#pagePreLancement").innerText();

  // 1. Lecture.
  verifier(/16 lignes/.test(texte) && /livraison\s+semaine 48/.test(texte), `lecture : 16 lignes, semaine 48 (celle du plus de pièces)`);

  // 2. Contrôle avant lancement.
  const ligne = (cde, lig) => page.evaluate(([c, l]) => {
    const tr = [...document.querySelectorAll("#pagePreLancement table:not(.pl-sim) tbody tr")].find((t) => t.cells[0] && t.cells[0].innerText.replace(/\s+/g, " ").includes(`${c} · ${l}`));
    return tr ? tr.innerText.replace(/\s+/g, " ") : "";
  }, [cde, lig]);
  verifier(/Bloquée par la compta/.test(await ligne("CVC99000001", 2)), `bloquée par la compta : signalée`);
  verifier(!(await ligne("CVC99000001", 1)), `pièce normale : pas dans la liste`);
  verifier(/En double dans le pré-lancement \(2 fois\)/.test(await ligne("CVC99000002", 1)), `pièce en double : signalée`);
  verifier(/Déjà lancée : LAN264701ESSAI \(semaine 47\)/.test(await ligne("CVC99000003", 1)), `pièce déjà dans un lancement de la bibliothèque : signalée avec son lancement`);
  verifier(/En retard : livraison semaine 46/.test(await ligne("CVC99000004", 1)), `pièce d'une semaine passée : en retard`);
  verifier(/Qté à lancer \(3\) plus grande que la commande \(2\)/.test(await ligne("CVC99000007", 1)), `qté à lancer plus grande que la commande : signalée`);
  const grande = await ligne("CVC99000006", 2);
  verifier(/Plus grande \(3 449 × 995\) que les panneaux 9004 en stock \(2 790 × 2 060\) : le format 4 110 × 2 060 est à 0/.test(grande), `pièce plus longue que le petit format en stock, grand format à 0 : signalée (${grande})`);

  // 3. Simulation sur le stock.
  const sim = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll("#pagePreLancement .pl-sim tbody tr")].map((tr) => [tr.cells[0].querySelector("strong").innerText, { pieces: tr.cells[2].innerText, etat: tr.cells[6].innerText, classe: tr.className, pour: tr.cells[1].innerText }]))
  );
  console.log(JSON.stringify(sim));
  verifier(sim["9001"] && /OK/.test(sim["9001"].etat), `9001 : assez de stock (OK)`);
  verifier(sim["9002"] && /Il manque/.test(sim["9002"].etat) && /limité au stock/.test(sim["9002"].etat) && /rouge/.test(sim["9002"].classe), `9002 : il manque des panneaux, limité au stock → rouge`);
  verifier(sim.SAG38HYBL && /à commander/.test(sim.SAG38HYBL.etat) && /orange/.test(sim.SAG38HYBL.classe), `SAG38HYBL (appris de la bibliothèque) : manque, dépassement autorisé → à commander`);
  verifier(sim["9004"] && /plus grande que les panneaux en stock/.test(sim["9004"].etat), `9004 : la pièce trop longue apparaît aussi dans la simulation`);
  verifier(sim.SMELBLALIS19 && sim.SMELBLALIS19.pieces.trim() === "2", `RENF391001 (cas particulier) : 2 panneaux de mélaminé 19 mm pour 1 pièce (${sim.SMELBLALIS19 && sim.SMELBLALIS19.pieces})`);
  const nb9001 = PRE.filter((l) => l[11] === 9001).reduce((t, l) => t + l[0], 0);
  verifier(sim["9001"] && Number(sim["9001"].pieces) === nb9001, `décor 9001 compté une seule fois par pièce, RENF compris (${sim["9001"] && sim["9001"].pieces} = ${nb9001})`);
  verifier(/jamais vu.*XYZ123/s.test(texte), `article jamais vu : signalé (matière inconnue)`);
  verifier(/réservé|Stock réel : sans les chutes réservées ni les panneaux de la case 302/.test(texte), `la simulation part du stock réel (sans les réservés)`);

  // 4. Cas particuliers : saisie d'un nouveau cas, pris en compte tout de suite ; retrait.
  await page.fill("#plCasArticle", "xyz123");
  await page.fill("#plCasMatiere", "SAG19HYBR");
  await page.fill("#plCasCouches", "1");
  await page.selectOption("#plCasDessous", "RCB");
  await page.click("#btnPlCasAjouter");
  await page.waitForSelector("#pagePreLancement .pl-sim");
  const apres = await page.locator("#pagePreLancement").innerText();
  verifier(!/jamais vu.*XYZ123/s.test(apres) && /XYZ123/.test(apres) && /SAG19HYBR/.test(apres), `cas particulier saisi (XYZ123 → SAG19HYBR) : pris en compte`);
  const memo = await page.evaluate(() => JSON.parse(localStorage.getItem("sentinelle-cas-particuliers") || "{}"));
  verifier(memo.XYZ123 && memo.RENF391001, `cas particuliers gardés en mémoire (RENF391001 + le nouveau)`);
  await page.click('[data-pl-retirer="XYZ123"]');
  await page.waitForSelector("#pagePreLancement .pl-sim");
  verifier(/jamais vu.*XYZ123/s.test(await page.locator("#pagePreLancement").innerText()), `cas particulier retiré : l'article redevient « jamais vu »`);

  // 5. Export avec en-têtes : lu par le nom des colonnes.
  const titres = ["Qté à lancer", "Semaine", "Commande", "Ligne", "Catalogue", "Article", "Désignation", "Qte", "Longueur", "Largeur", "Epaisseur", "Code Coloris", "Coloris", "Cp", "Ville", "com_transporteur", "Transporteur", "Blocage compta", "Blocage fab"];
  const n = await page.evaluate(async (b64) => {
    const octets = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const wb = await chargerClasseur(new File([octets], "avec_titres.xlsx"));
    return lirePreLancement(wb).length;
  }, await fabriquer(PRE.slice(0, 3), titres));
  verifier(n === 3, `export avec une ligne de titres : lu par le nom des colonnes (${n})`);

  // 6. Gardé en mémoire : rouvert sans recharger.
  const garde = await page.evaluate(() => {
    preLancement.lu = false;
    preLancement.donnees = null;
    lirePreLancementMemoire();
    return preLancement.donnees && preLancement.donnees.lignes.length;
  });
  verifier(garde === 16, `pré-lancement gardé en mémoire (${garde} lignes)`);

  await page.screenshot({ path: path.join(sortie, "pre_lancement.png"), fullPage: true });
  await nav.close();
  console.log(echecs ? `${echecs} échec(s)` : "TOUT EST OK");
  process.exit(echecs ? 1 : 0);
})();
