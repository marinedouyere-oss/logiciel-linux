// V6.7.4 : une semaine retirée de la bibliothèque puis rescannée garde sa date de retrait (supprimeeLe, utile à la fusion
// entre PC), mais ses lancements scannés APRÈS le retrait doivent compter partout. Cas réel : semaine 46 retirée le
// 01/11 à 21:06:54 et rescannée 20 s plus tard ; le suivi de production ignorait ses 9 lancements.
// Données inventées : semaine 48 retirée à 21:06:54 ; LANTESTAPRES (scanné à 21:07:14, CVC26990001 ×5) doit compter,
// LANTESTAVANT (daté de 20:00, avant le retrait, CVC26990002 ×3) non.
// Usage : node test_web_semaine_retiree.js <index.html>
const { chromium } = require("playwright");
const fs = require("fs");
const [pageHtml] = process.argv.slice(2);
let echecs = 0;
const verifier = (ok, t) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`);
  if (!ok) echecs++;
};
const ENTETE = ["Semaine", "Commande", "Ligne", "Catalogue", "Article", "Qte Lancement", "Qte en cours", "Transporteur", "Ville", "Code Coloris"];
const LIGNES = [
  [48, "CVC26990001", 1, "Stratifié", "TPPVC39651", 5, 5, "TRANSP A", "VILLE A", "9001"],
  [48, "CVC26990002", 1, "Stratifié", "TPPVC39551", 3, 3, "TRANSP A", "VILLE A", "9001"],
];

(async () => {
  const nav = await chromium.launch();
  const page = await (await nav.newContext()).newPage();
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  page.on("dialog", (d) => d.accept());
  await page.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://s.test/index.html");
  await page.waitForFunction(() => typeof SUIVI !== "undefined" && SUIVI.etat.charge, null, { timeout: 30000 });

  await page.evaluate(() => {
    const p = (cmd, n) => {
      const x = COLONNES_PIECES_BIBLIOTHEQUE.map(() => "");
      x[COLONNES_PIECES_BIBLIOTHEQUE.indexOf("cle")] = cleLigne(cmd, "1");
      x[COLONNES_PIECES_BIBLIOTHEQUE.indexOf("commande")] = cmd;
      x[COLONNES_PIECES_BIBLIOTHEQUE.indexOf("ligne")] = "1";
      x[COLONNES_PIECES_BIBLIOTHEQUE.indexOf("pieces")] = n;
      return x;
    };
    bibliotheque.semaines.set("2026-48", {
      id: "2026-48", annee: 2026, semaine: 48, maj: "2026-11-03T18:04:00.678Z", supprimeeLe: "2026-11-01T21:06:54.681Z", colonnesPieces: COLONNES_PIECES_BIBLIOTHEQUE,
      lancements: [
        { nom: "LANTESTAPRES", poste: "Agglo 1er tour", casse: false, maj: "2026-11-01T21:07:14.725Z", pieces: [p("CVC26990001", 5)] },
        { nom: "LANTESTAVANT", poste: "Agglo 2ème tour", casse: false, maj: "2026-11-01T20:00:00.000Z", pieces: [p("CVC26990002", 3)] },
      ],
    });
    bibliotheque.index = null;
    bibliotheque.generation++;
  });
  const actifs = await page.evaluate(() => lancementsActifs(bibliotheque.semaines.get("2026-48")).map((l) => l.nom));
  verifier(actifs.join(",") === "LANTESTAPRES", `lancements qui comptent : ${actifs.join(",")} (pas celui d'avant le retrait)`);

  await page.evaluate(
    async ([entete, lignes]) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Suivi");
      ws.addRow(entete);
      for (const l of lignes) ws.addRow(l);
      await SUIVI.chargerFichiers([new File([await wb.xlsx.writeBuffer()], "suivi_production_12112026.xlsx", { lastModified: Date.UTC(2026, 10, 12, 7) })]);
    },
    [ENTETE, LIGNES]
  );
  const r = await page.evaluate(() => {
    const R = SUIVI.calculer();
    const s = R.semaines.find((x) => x.id === "2026-48");
    return { lancements: s ? s.lancements.map((L) => [L.nom, L.r]) : [], hors: SUIVI.etat.horsDetail.map((x) => x.r[2]) };
  });
  console.log(JSON.stringify(r));
  verifier(r.lancements.some((L) => L[0] === "LANTESTAPRES" && L[1] === 5), "suivi : LANTESTAPRES compté dans la semaine 48 (5 à faire)");
  verifier(!r.lancements.some((L) => L[0] === "LANTESTAVANT"), "suivi : LANTESTAVANT (d'avant le retrait) pas compté");
  verifier(r.hors.join(",") === "CVC26990002", `« Pas dans les lancements » : seulement CVC26990002 (${r.hors.join(",")})`);
  const cmd = await page.evaluate(() => commandesLancees().map((c) => c.commande).sort());
  verifier(cmd.includes("CVC26990001") && !cmd.includes("CVC26990002"), `validations : commandes lancées ${cmd.join(",")}`);
  const fusion = await page.evaluate(() => {
    const a = bibliotheque.semaines.get("2026-48");
    return fusionnerSemaines(a, { ...a, lancements: [] }).lancements.map((l) => l.nom);
  });
  verifier(fusion.join(",") === "LANTESTAPRES", `fusion entre PC : ${fusion.join(",")} (même règle)`);
  await nav.close();
  console.log(echecs ? `${echecs} échec(s)` : "TOUT EST OK");
  process.exit(echecs ? 1 : 0);
})();
