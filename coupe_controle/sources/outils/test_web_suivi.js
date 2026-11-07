// V6.2 : onglet « Suivi de production » (avancement par lancement d'après l'extraction Diakonos).
// Usage : node test_web_suivi.js <index.html> <dossier « Semaine 47 »> <LAN264801START.xlsx> <extraction du 07/11 .xlsx>
//         <même extraction en .ref.json> <python avec openpyxl> <fabriquer_extraction.py> <dossier de sortie> [capture.png]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const [pageHtml, dossierS47, lan48, extraction07, ref07, python, fabriquer, sortie, capture] = process.argv.slice(2);
let echecs = 0;
const verifier = (ok, t) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`);
  if (!ok) echecs++;
};
const LANS_S47 = [
  ["1ER TOUR AGGLO/LAN264701START.xlsx", "Agglo 1er tour"],
  ["1ER TOUR AGGLO/LAN264701RECYCLAGE.xlsx", "Recyclage"],
  ["2EME TOUR AGGLO/LAN264702START.xlsx", "Agglo 2ème tour"],
  ["FENO/LAN264701FENO.xlsx", "Feno"],
  ["CASSE/LAN2646CASSE.xlsx", "Casse"],
  ["CHANTIERS/LAN2647AIRDESIGN.xlsx", "Chantiers"],
];
(async () => {
  fs.mkdirSync(sortie, { recursive: true });
  const nav = await chromium.launch();
  const contexte = await nav.newContext({ viewport: { width: 1300, height: 1000 } });
  const page = await contexte.newPage();
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  page.on("dialog", (d) => d.accept());
  await contexte.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://s.test/index.html");
  await page.waitForFunction(() => typeof SUIVI !== "undefined" && SUIVI.etat.charge, null, { timeout: 30000 });
  const b64 = (f) => fs.readFileSync(f).toString("base64");

  // 1. La bibliothèque : les lancements de la semaine 47 (et un de la semaine 48).
  const lancements = LANS_S47.map(([f, poste]) => ({ b64: b64(path.join(dossierS47, f)), nom: path.basename(f), poste, semaine: 47 })).concat([{ b64: b64(lan48), nom: "LAN264801START.xlsx", poste: "Agglo 1er tour", semaine: 48 }]);
  const nb = await page.evaluate(async (liste) => {
    const items = [];
    for (const x of liste) {
      const fichier = new File([Uint8Array.from(atob(x.b64), (c) => c.charCodeAt(0))], x.nom);
      const strat = await stratEnCache(fichier);
      items.push({ annee: 2026, semaine: x.semaine, lancement: ficheLancementBibliotheque(x.nom, strat, { poste: x.poste, casse: /CASSE/.test(x.nom) }) });
    }
    await archiverLancements(items);
    return [...bibliotheque.semaines.values()].reduce((t, s) => t + s.lancements.length, 0);
  }, lancements);
  verifier(nb === lancements.length, `bibliothèque : ${nb} lancements`);

  // 2. L'extraction du 07/11 (semaine 45), chargée à la main.
  const charger = (f, date) =>
    page.evaluate(
      async ([donnees, nom, modifie]) => {
        await SUIVI.chargerFichiers([new File([Uint8Array.from(atob(donnees), (c) => c.charCodeAt(0))], nom, { lastModified: modifie })]);
        return SUIVI.etat.message;
      },
      [b64(f), path.basename(f), date]
    );
  const m1 = await charger(extraction07, Date.UTC(2026, 10, 7, 7));
  verifier(m1 && m1.genre === "bon", `extraction du 07/11 lue (${m1 && m1.texte})`);
  const lan = (r, nom) => r.semaines.flatMap((s) => s.lancements).find((l) => l.nom === nom);
  const r1 = await page.evaluate(() => SUIVI.calculer());
  const s2 = lan(r1, "LAN264702START");
  const s1 = lan(r1, "LAN264701START");
  const s48 = lan(r1, "LAN264801START");
  const casse = lan(r1, "LAN2646CASSE");
  console.log(JSON.stringify({ s2: [s2.f, s2.r, s2.h, s2.e], s1: [s1.f, s1.r, s1.h, s1.e], s48: s48 && [s48.f, s48.r, s48.h, s48.e], casse: [casse.f, casse.r, casse.h, casse.e] }));
  verifier(r1.jour === "2026-11-07" && r1.semaine === 45, "extraction du 07/11/2026, semaine 45");
  verifier(s2.f === 0 && s2.r === 165 && s2.h === 0 && s2.e === "en_cours", "LAN264702START : 165 pièces à faire, 0 faite (toutes dans Diakonos)");
  verifier(s1.f === 0 && s1.r === 308 && s1.h === 48 && s1.e === "en_cours", "LAN264701START : 308 à faire, 48 pièces pas dans Diakonos (pas comptées)");
  verifier(s48 && s48.f + s48.r === 0 && s48.e === "attente", "LAN264801START (semaine 48) : pas encore dans Diakonos");
  verifier(casse.r === 1 && casse.h === 76, "LAN2646CASSE : 1 pièce dans Diakonos, 76 pas dans Diakonos");
  // Le tableau des transporteurs : la somme de « Qte en cours » du fichier, comme Excel.
  const ref = JSON.parse(fs.readFileSync(ref07, "utf8"));
  const sommeExcel = ref.slice(1).reduce((t, r) => t + (r && typeof r[8] === "number" ? r[8] : 0), 0);
  const totalTableau = r1.tableau.lignes.reduce((t, l) => t + l[l.length - 1], 0);
  verifier(Math.abs(totalTableau - sommeExcel) < 0.01, `tableau transporteurs × semaines : total ${totalTableau} = somme Excel ${sommeExcel}`);

  // 3. Une extraction plus récente (10/11, semaine 46) : 100 pièces de LAN264702START sont sorties de Diakonos.
  const cles = await page.evaluate(() => {
    const s = [...bibliotheque.semaines.values()].find((x) => x.lancements.some((l) => l.nom === "LAN264702START"));
    return s.lancements.find((l) => l.nom === "LAN264702START").pieces.map((p) => p[0]);
  });
  const retirees = cles.slice(0, 100);
  fs.writeFileSync(path.join(sortie, "cles.json"), JSON.stringify(retirees));
  const extraction10 = path.join(sortie, "suivi_production_10112026.xlsx");
  console.log(execFileSync(python, [fabriquer, ref07, path.join(sortie, "cles.json"), extraction10]).toString().trim());
  const piecesRetirees = await page.evaluate((liste) => {
    const s = [...bibliotheque.semaines.values()].find((x) => x.lancements.some((l) => l.nom === "LAN264702START"));
    const l = s.lancements.find((x) => x.nom === "LAN264702START");
    return l.pieces.filter((p) => liste.includes(p[0])).reduce((t, p) => t + p[4], 0);
  }, retirees);
  const m2 = await charger(extraction10, Date.UTC(2026, 10, 10, 7));
  verifier(m2 && m2.genre === "bon", "extraction du 10/11 lue");
  const r2 = await page.evaluate(() => SUIVI.calculer());
  const t2 = lan(r2, "LAN264702START");
  console.log(JSON.stringify({ t2: [t2.f, t2.r, t2.h, t2.e, t2.d], p: t2.p, depuis: r2.totaux.depuis, precedente: r2.precedente }));
  verifier(t2.f === piecesRetirees && t2.r === 165 - piecesRetirees && t2.h === 0, `LAN264702START : ${piecesRetirees} faites, ${165 - piecesRetirees} à faire`);
  verifier(t2.d === piecesRetirees && r2.precedente === "2026-11-07" && r2.totaux.depuis === piecesRetirees, `évolution : +${piecesRetirees} pièces depuis le 07/11`);
  verifier(t2.p.length === 2 && t2.p[0][1] === 0 && t2.p[1][1] === Math.round((100 * piecesRetirees) / 165), `courbe : 0 % puis ${t2.p[1] && t2.p[1][1]} %`);
  verifier(lan(r2, "LAN264701START").f === 0, "LAN264701START : rien de fait (ses 48 pièces hors Diakonos ne comptent pas)");

  // 4. Le fichier partagé (et le téléphone) contient le même résumé.
  const partage = await page.evaluate(() => {
    const c = contenuFichierPartage();
    return { jour: c.suiviProduction && c.suiviProduction.jour, lan: c.suiviProduction && c.suiviProduction.semaines.flatMap((s) => s.lancements).find((l) => l.nom === "LAN264702START"), sig: signaturePartage([...bibliotheque.semaines.values()], c.suiviProduction) };
  });
  verifier(partage.jour === "2026-11-10" && partage.lan && partage.lan.f === piecesRetirees && partage.sig.includes("|suivi:2026-11-10:"), "fichier partagé : suiviProduction du 10/11 (même avancement), dans la signature d'envoi");
  fs.writeFileSync(path.join(sortie, "partage_suivi.json"), JSON.stringify(await page.evaluate(() => contenuFichierPartage())));

  // 5. L'écran : barres par lancement, rangées par semaine ; un clic donne les commandes à faire.
  await page.evaluate(() => {
    onglet = "suivi";
    afficher();
  });
  const texte = await page.locator("#pageSuivi").innerText();
  verifier(/Suivi de production/.test(texte) && /Semaine 47/.test(texte) && /Semaine 48/.test(texte), "écran : semaines 47 et 48");
  verifier(texte.includes(`${Math.round((100 * piecesRetirees) / 165)} %`) && /Pas encore dans Diakonos/i.test(texte), "écran : pourcentage de LAN264702START, « Pas encore dans Diakonos » pour la 48");
  verifier(/depuis le 07\/11/.test(texte), "écran : « +N pièces depuis le 07/11 »");
  const barres = await page.locator("#pageSuivi .sv-lan .sv-barre").count();
  verifier(barres === lancements.length, `une barre par lancement (${barres})`);
  await page.locator('#pageSuivi [data-sv-lan="LAN264702START"] > .sv-ligne').click();
  const detail = await page.locator('#pageSuivi [data-sv-lan="LAN264702START"] .sv-detail').innerText();
  verifier(/Commande/.test(detail) && /CVC\d{8}/.test(detail), "clic : les commandes encore à faire du lancement");
  if (capture) await page.locator("#pageSuivi").screenshot({ path: capture });

  // 6. Rechargé : les extractions sont gardées (évolution conservée).
  await page.reload();
  await page.waitForFunction(() => typeof SUIVI !== "undefined" && SUIVI.etat.charge && bibliotheque.semaines.size > 0, null, { timeout: 30000 });
  const apres = await page.evaluate(() => ({ n: SUIVI.etat.extractions.length, f: SUIVI.calculer().semaines.flatMap((s) => s.lancements).find((l) => l.nom === "LAN264702START").f }));
  verifier(apres.n === 2 && apres.f === piecesRetirees, "après rechargement : 2 extractions gardées, même avancement");

  // 7. Oublier une extraction.
  await page.evaluate(() => {
    onglet = "suivi";
    afficher();
  });
  await page.locator('[data-sv-oublier="2026-11-10"]').click();
  await page.locator("#modaleConfirmationOk").click();
  await page.waitForFunction(() => SUIVI.etat.extractions.length === 1, null, { timeout: 10000 }).catch(() => null);
  const oubli = await page.evaluate(() => ({ n: SUIVI.etat.extractions.length, jour: SUIVI.calculer().jour }));
  verifier(oubli.n === 1 && oubli.jour === "2026-11-07", "« Oublier » : il reste l'extraction du 07/11");

  // 8. Le dossier des extractions : la dernière version de chaque jour (sous-dossiers compris), le reste ignoré.
  const dossier = await page.evaluate(
    async ([a, b]) => {
      const fichier = (donnees, nom, modifie) => new File([Uint8Array.from(atob(donnees), (c) => c.charCodeAt(0))], nom, { lastModified: modifie });
      const entree = (f) => ({ kind: "file", getFile: async () => f });
      const sousDossier = (nom, enfants) => ({ kind: "directory", name: nom, async *entries() { for (const [n, h] of enfants) yield [n, h]; } });
      const racine = sousDossier("Extractions", [
        ["suivi_production_07112026.xlsx", entree(fichier(a, "suivi_production_07112026.xlsx", Date.UTC(2026, 10, 7, 7)))],
        ["notes.txt", entree(new File(["x"], "notes.txt"))],
        ["~$suivi_production_10112026.xlsx", entree(new File(["x"], "~$suivi_production_10112026.xlsx"))],
        ["Novembre", sousDossier("Novembre", [
          ["suivi_production_10112026.xlsx", entree(fichier(b, "suivi_production_10112026.xlsx", Date.UTC(2026, 10, 10, 9)))],
          ["suivi_production_10112026 (ancienne).xlsx", entree(fichier(a, "suivi_production_10112026 (ancienne).xlsx", Date.UTC(2026, 10, 10, 6)))],
        ])],
      ]);
      racine.queryPermission = async () => "granted";
      for (const e of [...SUIVI.etat.extractions]) for (const f of e.fichiers) SUIVI.etat.fichiers.delete(f.id);
      SUIVI.etat.dossier = racine;
      await SUIVI.lireDossier(false);
      const r = SUIVI.calculer();
      return { n: SUIVI.etat.extractions.length, jours: SUIVI.etat.extractions.map((e) => `${e.jour}:${e.fichiers.map((f) => f.nom).join("+")}`), f: r.semaines.flatMap((s) => s.lancements).find((l) => l.nom === "LAN264702START").f, info: SUIVI.etat.infoDossier };
    },
    [b64(extraction07), b64(extraction10)]
  );
  console.log(JSON.stringify(dossier));
  verifier(dossier.n === 2 && dossier.jours.join(" ") === "2026-11-07:suivi_production_07112026.xlsx 2026-11-10:suivi_production_10112026.xlsx", "dossier : 07/11 et 10/11 lus, la version la plus récente du 10/11 (sous-dossier), le reste ignoré");
  verifier(dossier.f === piecesRetirees, "dossier : même avancement qu'avec les fichiers chargés à la main");

  await nav.close();
  console.log(echecs ? `${echecs} échec(s)` : "TOUT EST OK");
  process.exit(echecs ? 1 : 0);
})();
