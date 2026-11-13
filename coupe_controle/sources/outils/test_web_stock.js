// V6.5 : stock des panneaux (fichier brdlib.bdx de woodStore) et page « Chutes de stratifié réservées » du rapport.
// Partie autonome : un petit fichier de stock fabriqué (données anonymes). Partie optionnelle : une vraie sauvegarde
// Cut Rite d'un lancement (.bkp, donnée client hors dépôt) pour la page du rapport.
// Usage : node test_web_stock.js <index.html> <dossier de sortie> [sauvegarde.bkp]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [pageHtml, sortie, bkp] = process.argv.slice(2);
let echecs = 0;
const verifier = (ok, t) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`);
  if (!ok) echecs++;
};

// Une ligne de 20 colonnes : code, qté, matériau, L, l, ép., prix, limite, -, description, fil, -, -, -, statut, emplacements.
const ligne = (code, qte, mat, L, W, ep, limite, desc, fil, statut, emplacements, famille = "") => {
  const c = new Array(20).fill("");
  [c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[9], c[10], c[11], c[13], c[14], c[15], c[17]] = [code, qte, mat, L, W, ep, "100.000", limite, desc, fil, "0", "0.000", statut, emplacements, famille];
  return c.join(",");
};
const FICHIER = [
  ligne("9001_4100_1300", 21, "9001", "4100.0", "1300.0", "0.8", 9, "STRAT ESSAI CHENE 4100*1300*0.8", 1, 0, "1041(9) 1042(12)", "STRAT"),
  ligne("9001_3050_1300", 0, "9001", "3050.0", "1300.0", "0.8", 0, "STRAT ESSAI CHENE 3050*1300*0.8", 1, 0, ""),
  ligne("XLAN260101STRAT_9001/0001", 1, "9001", "2500.0", "600.0", "0.8", 0, "STRAT ESSAI CHENE", 1, 1, "5985(1)"),
  ligne("XLAN264601STRAT_9001/0002", 1, "9001", "2000.0", "620.0", "0.8", 0, "STRAT ESSAI CHENE", 1, 2, "5986(1)"),
  ligne("XLAN260202_9001/0003", 0, "9001", "1800.0", "600.0", "0.8", 0, "", 1, 2, ""),
  ligne("X3988/260911065549-0014", 1, "9002", "2620.0", "930.0", "0.8", 0, "STRAT ESSAI GRIS", 0, 1, "6027(1)"),
  // V6.5.7 : panneaux entiers réservés pour un lancement, rangés dans la case 302 (cas réel du 1063 le 12/11 : 48 − 3 = 45).
  ligne("9003_4100_1300", 48, "9003", "4100.0", "1300.0", "0.8", 0, "STRAT ESSAI HAMILTON 4100*1310", 1, 0, "302(3) 1042(21) 1043(24)", "STRAT"),
  // V6.5.8 : un coloris à zéro (cas réel du 1136, seul le 1136-PF a du stock) reste dans la liste.
  ligne("9004_4110_2060", 0, "9004", "4110.0", "2060.0", "0.7", 0, "STRAT ESSAI CASELLA 4110*2060", 1, 0, ""),
  ligne("9004_5_2790_2060", 14, "9004-PF", "2790.0", "2060.0", "0.8", 0, "STRAT ESSAI CASELLA 2790*2060", 1, 0, "7107(14)"),
  ligne("SAGTEST_4150_2070", 34, "SAGTEST", "4150.0", "2070.0", "38.0", 0, "AGGLO ESSAI 38MM", 0, 0, "1205(10) 1206(24)"),
  // Liste d'emplacements coupée dans le fichier (« 1005(11 » sans parenthèse) : la quantité reste juste.
  ligne("CAISSE_4290_1690", 55, "CAISSE", "4290", "1690", "19", 0, "CAISSE ESSAI", 0, 0, "1000(10) 1001(11) 1002(11) 1003(6) 1004(6) 1005(11"),
].join("\r\n");

(async () => {
  fs.mkdirSync(sortie, { recursive: true });
  const fichierStock = path.join(sortie, "brdlib_essai.bdx");
  fs.writeFileSync(fichierStock, Buffer.from(FICHIER, "latin1"));
  const nav = await chromium.launch();
  const page = await (await nav.newContext()).newPage();
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  await page.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://s.test/index.html");
  await page.waitForFunction(() => typeof lireFichierStock === "function", null, { timeout: 30000 });

  // 1. Lecture du fichier.
  const lu = await page.evaluate((texte) => {
    const d = lireFichierStock(texte);
    const m = (code) => d.materiaux.find((x) => x.mat === code);
    const s = m("9001");
    const caisse = d.formats.find((f) => f.code === "CAISSE_4290_1690");
    return {
      nbMat: d.materiaux.length,
      entiers: s.nbEntiers,
      dispo: s.nbChutes,
      reservees: s.nbReservees,
      chutesListees: s.chutes.length,
      limites: [...s.limites].sort(),
      famille: [s.famille, m("SAGTEST").famille],
      empl: caisse.emplacements.reduce((t, [, q]) => t + q, 0),
      jusquau: new Date(d.donneesJusquau).toISOString().slice(0, 10),
      r302: [m("9003").nbEntiers, m("9003").nbEntiersReserves, s.nbEntiersReserves],
    };
  }, FICHIER);
  console.log(JSON.stringify(lu));
  verifier(lu.nbMat === 7, `7 matériaux lus (${lu.nbMat})`);
  verifier(JSON.stringify(lu.r302) === "[45,3,0]", `case 302 : 48 en stock, 3 réservés pour un lancement → 45 panneaux disponibles (${lu.r302})`);
  verifier(lu.entiers === 21 && lu.dispo === 1 && lu.reservees === 1, `9001 : 21 panneaux entiers, 1 chute disponible, 1 réservée (statut 2) — stock réel = stock − réservé`);
  verifier(lu.chutesListees === 2, `chute sortie (quantité 0) écartée`);
  verifier(JSON.stringify(lu.limites) === "[0,9]", `Limite woodStore lue (0 et 9)`);
  verifier(lu.famille[0] === "strat" && lu.famille[1] === "agglo", `familles : stratifié, agglo`);
  verifier(lu.empl === 55, `emplacements coupés dans le fichier relus quand même (55)`);
  verifier(lu.jusquau === "2026-09-11", `date des données = chute machine la plus récente (${lu.jusquau})`);

  // 2. La page : chargement, recherche, détail, tri par en-tête.
  await page.click('[data-onglet="stock"]');
  await page.setInputFiles("#fichierStock", fichierStock);
  await page.waitForSelector(".stk-fichier");
  const texte = await page.locator("#pageStock").innerText();
  verifier(/1 chutes? réservées?/.test(texte) && /chutes disponibles/.test(texte), `page : chutes disponibles et réservées à part`);
  verifier(/3 panneaux réservés/.test(texte) && /case 302/.test(await page.locator("#pageStock").textContent()), `page : panneaux entiers réservés (case 302) comptés à part`);
  // Coloris à zéro : affiché par défaut ; case « avec du stock seulement » : caché, sauf son code tapé en entier.
  await page.fill("#champStock", "9004");
  const a0 = await page.$$eval("#pageStock tr.stk-ligne", (trs) => trs.map((tr) => tr.dataset.stkMat).join(" "));
  await page.check("#caseAvecStock");
  await page.fill("#champStock", "900");
  const coche = await page.$$eval("#pageStock tr.stk-ligne", (trs) => trs.map((tr) => tr.dataset.stkMat).join(" "));
  await page.fill("#champStock", "9004");
  const exact = await page.$$eval("#pageStock tr.stk-ligne", (trs) => trs.map((tr) => tr.dataset.stkMat).join(" "));
  await page.uncheck("#caseAvecStock");
  verifier(a0 === "9004 9004-PF", `coloris à zéro affiché par défaut avec son PF (${a0})`);
  verifier(!/9004\b(?!-)/.test(coche.replace("9004-PF", "")) && /9004-PF/.test(coche), `case cochée : le coloris à zéro est caché (${coche})`);
  verifier(/^9004\b/.test(exact), `case cochée, code tapé en entier : affiché quand même (${exact})`);
  await page.fill("#champStock", "9003");
  const ligne9003 = await page.locator('tr[data-stk-mat="9003"]').innerText();
  await page.click('tr[data-stk-mat="9003"]');
  const det9003 = await page.locator(".stk-detail").innerText();
  verifier(/45/.test(ligne9003) && /\+3 rés\./.test(ligne9003) && !/48/.test(ligne9003), `liste : 45 panneaux (+3 rés.), pas 48 (${ligne9003.replace(/\s+/g, " ")})`);
  verifier(/45 panneaux entiers disponibles/.test(det9003) && /3 panneaux réservés \(case 302\)/.test(det9003) && /302 · 3 réservés/.test(det9003), `détail : 45 disponibles, 3 réservés dans la case 302`);
  await page.click('tr[data-stk-mat="9003"]');
  await page.fill("#champStock", "9001");
  await page.click('tr[data-stk-mat="9001"]');
  const detail = await page.locator(".stk-detail").innerText();
  verifier(/réservée/.test(detail) && /1041 · 9/.test(detail) && /dépassement autorisé/.test(detail), `détail : badge « réservée », emplacements, Limite 9`);
  await page.fill("#champStock", "");
  const ordre = async () => page.$$eval("#pageStock tr.stk-ligne", (trs) => trs.map((tr) => tr.dataset.stkMat));
  await page.click('[data-stk-tri="liste:mat"]');
  const az = await ordre();
  await page.click('[data-stk-tri="liste:mat"]');
  const za = await ordre();
  verifier(az.length > 1 && JSON.stringify(az) === JSON.stringify([...za].reverse()), `tri par en-tête : A → Z puis Z → A (${az.join(" ")})`);
  const memo = await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem("sentinelle-stock") || "null")));
  verifier(memo, `dernier fichier gardé en mémoire`);

  // Tous les matériaux sont affichés (aucune limite : le vrai fichier en a 326 avec du stock).
  const tous = await page.evaluate((lignes) => {
    const memo = stock.donnees;
    stock.donnees = { ...lireFichierStock(lignes.join("\r\n")), nom: "gros.bdx", modifie: Date.now(), charge: Date.now() };
    stock.recherche = "";
    stock.famille = "tous";
    afficherStock();
    const n = document.querySelectorAll("#pageStock tr.stk-ligne").length;
    const vieilles = document.querySelectorAll("#pageStock .stk-puce-mat").length;
    stock.donnees = memo;
    afficherStock();
    return { n, vieilles };
  }, Array.from({ length: 150 }, (_, i) => [
    [`M${1000 + i}_4100_1300`, 3, `M${1000 + i}`, "4100.0", "1300.0", "0.8", "100.000", "0", "", `STRAT ESSAI ${i}`, "0", "0", "", "0.000", "0", "1041(3)", "", "STRAT", "", ""].join(","),
    [`X3988/250101065549-${i}`, 1, `M${1000 + i}`, "1000.0", "500.0", "0.8", "100.000", "0", "", "", "0", "0", "", "0.000", "1", "6027(1)", "", "", "", ""].join(","),
  ]).flat());
  verifier(tous.n === 150, `liste : les 150 matériaux affichés, sans limite (${tous.n})`);
  verifier(tous.vieilles === 150, `chutes qui dorment : toutes listées, sans limite (${tous.vieilles})`);

  // 3. V6.5.1 : le stock part au téléphone (fichier partagé), le PC voit si le téléphone a lu le dernier envoi,
  // et un nouveau code prévient le téléphone resté sur l'ancien.
  const lien = await page.evaluate(async () => {
    const contenu = contenuFichierPartage();
    const s = contenu.stock;
    const f9001 = s && s.formats.find((x) => x[0] === "9001_4100_1300");
    const reservee = s && s.formats.find((x) => x[0] === "XLAN264601STRAT_9001/0002");
    const etat = { code: "AAAA-BBBB-CCCC-DDDD", version: "v2", dernierEnvoi: "2026-11-11T20:01:53Z" };
    const sans = htmlLectureTelephone(etat);
    noterLecturesTelephone(etat.code, { tel1: { version: "v1", quand: "2026-11-11T06:00:00Z" } });
    const ancienne = htmlLectureTelephone(etat);
    noterLecturesTelephone(etat.code, { tel1: { version: "v2", quand: "2026-11-12T06:05:00Z" } });
    const aJour = htmlLectureTelephone(etat);
    const autreCode = htmlLectureTelephone({ ...etat, code: "ZZZZ-ZZZZ-ZZZZ-ZZZZ" });
    // Nouveau code : un dernier envoi marqué « remplace » sur l'ANCIEN canal (envoi simulé).
    const envois = [];
    const vrai = envoyerPaquetLien;
    envoyerPaquetLien = async (secrets, paquet) => {
      const clair = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: paquet.slice(4, 16) }, secrets.cle, paquet.slice(16)));
      envois.push({ canal: secrets.canal, contenu: await lireJsonCompresse(new Blob([clair])) });
      return "v-essai";
    };
    await prevenirAncienCode({ code: "AAAA-BBBB-CCCC-DDDD" }, "remplace");
    envoyerPaquetLien = vrai;
    const canalAncien = (await secretsLien("AAAA-BBBB-CCCC-DDDD")).canal;
    return {
      stock: Boolean(s && s.formats.length === 11),
      f9001: f9001 && f9001[1] === 21 && f9001[6] === 9 && f9001[11] === "1041(9) 1042(12)",
      reservee: reservee && reservee[9] === 1,
      signature: signatureStock() !== "",
      sans: /Aucun téléphone/.test(sans),
      ancienne: /pas encore ouvert/.test(ancienne),
      aJour: /a bien reçu le dernier envoi/.test(aJour),
      autreCode: /Aucun téléphone/.test(autreCode),
      avis: envois.length === 1 && envois[0].canal === canalAncien && envois[0].contenu.lien === "remplace" && Array.isArray(envois[0].contenu.semaines),
    };
  });
  console.log(JSON.stringify(lien));
  verifier(lien.stock && lien.f9001 && lien.reservee, `fichier partagé : le stock part au téléphone (formats, Limite, cases, réservées)`);
  verifier(lien.signature, `un nouveau fichier de stock déclenche l'envoi au téléphone`);
  verifier(lien.sans && lien.ancienne && lien.aJour && lien.autreCode, `PC : dit si le téléphone a lu le dernier envoi (jamais / pas encore / à jour, par code)`);
  verifier(lien.avis, `nouveau code : l'ancien code reçoit « code remplacé » (le téléphone resté dessus le dit en rouge)`);

  // 4. Page du rapport (vraie sauvegarde, optionnelle) : chutes de stratifié, toutes avec leur case, triées par case.
  if (bkp && fs.existsSync(bkp)) {
    const r = await page.evaluate(
      async ([b64, nom]) => {
        const fichier = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], nom);
        const liste = await chutesStratReserveesLancement(fichier);
        const plans = await lirePlansBkp(fichier);
        const nonStrat = liste.filter((c) => !(plans.matieres.get(c.mat) || {}).stratifie).length;
        const cases = liste.map((c) => (c.cases ? c.cases[0][0] : ""));
        const trie = cases.every((c, i) => i === 0 || comparerTexteFr(cases[i - 1], c) <= 0);
        const partie = await partieChutesStratReservees({ bkp: fichier }, "LAN-ESSAI");
        return { n: liste.length, avecCase: cases.filter(Boolean).length, nonStrat, trie, rcb: liste.filter((c) => /^RCB/i.test(c.mat)).length, pdf: Boolean(partie && rapportLancementPdf("essai", "essai", "essai", "48", null, null, [partie]).length) };
      },
      [fs.readFileSync(bkp).toString("base64"), path.basename(bkp)]
    );
    console.log(JSON.stringify(r));
    verifier(r.n > 0 && r.avecCase === r.n, `rapport : ${r.n} chutes de stratifié, toutes avec leur case (lue dans la sauvegarde)`);
    verifier(r.nonStrat === 0, `rapport : stratifié seulement (ni agglo ni compact)`);
    verifier(r.trie, `rapport : trié par case`);
    verifier(r.pdf, `rapport : la page PDF se fabrique (dont ${r.rcb} chute(s) de RCB, gardées)`);
  }

  await nav.close();
  console.log(echecs ? `${echecs} échec(s)` : "TOUT EST OK");
  process.exit(echecs ? 1 : 0);
})();
