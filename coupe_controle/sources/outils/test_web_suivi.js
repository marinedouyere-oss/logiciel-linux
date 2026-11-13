// V6.2 : onglet « Suivi de production » (avancement par lancement d'après l'extraction Diakonos).
// Usage : node test_web_suivi.js <index.html> <dossier « Semaine 47 »> <LAN264801START.xlsx> <extraction du 07/11 .xlsx>
//         <même extraction en .ref.json> <python avec openpyxl> <fabriquer_extraction.py> <dossier de sortie> [capture.png] [dossier « Semaine 46 »]
// Règle de l'atelier (V6.3.1) : un CVC du lancement qui n'est plus dans l'extraction = pièce faite ; encore là : « Qte en
// cours » à faire, le reste fait.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const [pageHtml, dossierS47, lan48, extraction07, ref07, python, fabriquer, sortie, capture, dossierS46] = process.argv.slice(2);
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
  await page.addInitScript(() => { try { localStorage.setItem("sentinelle-vue-controle", "toutes"); } catch (e) {} }); // V6.9 : toutes les cases affichées (tests du contrôle)
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
  // Semaine 46 (ta capture : presque finie le 07/11, ses CVC ne sont plus dans l'extraction).
  if (dossierS46)
    for (const [f, poste] of [["1ER TOUR AGGLO/LAN264601START.xlsx", "Agglo 1er tour"], ["2EME TOUR AGGLO/LAN264602START.xlsx", "Agglo 2ème tour"]])
      lancements.push({ b64: b64(path.join(dossierS46, f)), nom: path.basename(f), poste, semaine: 46 });
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
  verifier(s1.f === 48 && s1.r === 308 && s1.h === 0 && s1.e === "en_cours", "LAN264701START : 308 à faire (encore dans l'extraction), 48 faites (CVC plus dans l'extraction)");
  verifier(s48 && s48.f + s48.r === 0 && s48.h === 492 && s48.e === "hors_extraction" && r1.semaineMax === 47, "LAN264801START (semaine 48) : pas dans cette extraction (elle va jusqu'à la semaine 47), rien d'inventé");
  if (dossierS46) {
    const a = lan(r1, "LAN264601START");
    const b = lan(r1, "LAN264602START");
    console.log(JSON.stringify({ s46_1: [a.f, a.r, a.x, a.xd, a.e], s46_2: [b.f, b.r, b.x, b.xd, b.e] }));
    verifier(a.f + a.r + a.x === 340 && a.r <= 5 && a.x > 0 && /LAN2646CASSE/.test(a.xd) && Math.round((100 * a.f) / (a.f + a.r)) >= 98,
      `LAN264601START (semaine 46) : presque fini le 07/11 (${a.f} faites, ${a.r} à faire), ${a.x} pièces relancées dans la casse déduites`);
    verifier(b.f + b.r + b.x === 340 && b.f > b.r, `LAN264602START (semaine 46) : ${b.f} faites, ${b.r} à faire, ${b.x} relancées ailleurs (déduites)`);
  }
  // La casse : ses pièces comptent chez elle (le lancement le plus récent), la pièce relancée encore en cours
  // (CVC26100261001, « Lancement 2 » dans Diakonos) est à faire, les autres sont faites.
  verifier(casse.r === 1 && casse.f + casse.r === 77 && casse.e === "en_cours", `LAN2646CASSE : ${casse.f} faites, ${casse.r} à faire (la pièce relancée encore dans Diakonos)`);
  // La casse de la semaine 46 est suivie dans la semaine 46 (même rangée dans la 47 par la bibliothèque).
  const semCasse = r1.semaines.find((s) => s.lancements.some((l) => l.nom === "LAN2646CASSE"));
  verifier(semCasse && semCasse.semaine === 46, `LAN2646CASSE suivie dans la semaine ${semCasse && semCasse.semaine} (celle de son nom)`);

  // V6.4 : une pièce validée en direct (étiquette imprimée reçue d'un PC de validation) passe faite tout de
  // suite, même si elle est encore dans l'extraction. Ici LAN264702START est à 0 fait / 165 à faire.
  const direct = await page.evaluate(() => {
    const s = [...bibliotheque.semaines.values()].find((x) => x.lancements.some((l) => l.nom === "LAN264702START"));
    const l = s.lancements.find((l) => l.nom === "LAN264702START");
    const iCle = Math.max(0, (s.colonnesPieces || COLONNES_PIECES_BIBLIOTHEQUE).indexOf("cle"));
    const cols = s.colonnesPieces || COLONNES_PIECES_BIBLIOTHEQUE;
    const iQ = cols.indexOf("pieces") >= 0 ? cols.indexOf("pieces") : 4;
    const qte = new Map();
    for (const p of l.pieces) qte.set(p[iCle], (qte.get(p[iCle]) || 0) + Math.max(0, Number(p[iQ]) || 0));
    const cles = [...qte.keys()];
    // Une étiquette par pièce, imprimée après la dernière extraction (celles d'avant y sont déjà).
    const ex = SUIVI.etat.extractions;
    const apres = Math.floor(((ex[ex.length - 1].modifie || Date.now()) + 60e3) / 1000);
    let numero = 0;
    const etiquettes = (c, n) => Array.from({ length: n }, () => [`1-${apres}-${++numero}`, apres * 1000]);
    const faire = (n, parPiece) => {
      validations.faites = Object.fromEntries(cles.slice(0, n).map((c) => [c, { poste: "1", etiquettes: etiquettes(c, parPiece ? qte.get(c) : 1) }]));
      validations.rev++;
      SUIVI.etat.resume = null;
      const r = SUIVI.calculer().semaines.flatMap((x) => x.lancements).find((l) => l.nom === "LAN264702START");
      return [r.f, r.r, r.e];
    };
    const d10 = faire(10);
    const tout = faire(cles.length, true);
    validations.faites = {}; // on nettoie pour la suite du test
    validations.rev++;
    SUIVI.etat.resume = null;
    return { d10, tout, n: cles.length };
  });
  console.log(JSON.stringify({ validation_direct: direct }));
  verifier(direct.d10[0] === 10 && direct.d10[1] === 155, `10 étiquettes reçues → 10 faites, 155 à faire (étaient 0/165)`);
  verifier(direct.tout[0] === 165 && direct.tout[1] === 0 && direct.tout[2] === "termine", `toutes les étiquettes reçues → lancement terminé (${direct.tout.join("/")})`);
  // Suivi par semaine / transporteur / coloris : mêmes pièces que les barres (les totaux tombent juste).
  const somme = (vue, i) => r1.vues[vue].reduce((t, g) => t + g[i], 0);
  const sommeSous = (vue, i) => r1.vues[vue].reduce((t, g) => t + g[4].reduce((u, x) => u + x[i], 0), 0);
  const inconnu = r1.vues.transporteur.find((g) => g[0] === "Transporteur inconnu");
  console.log(JSON.stringify({ totaux: [r1.totaux.faites, r1.totaux.restantes], transporteurs: r1.vues.transporteur.length, coloris: r1.vues.coloris.length, clients: r1.vues.client.length, noms: r1.vues.transporteur.map((g) => g[0]), inconnu: inconnu && inconnu.slice(0, 3), t0: r1.vues.transporteur[0].slice(0, 4), c0: r1.vues.coloris[0].slice(0, 4) }));
  for (const vue of ["semaine", "transporteur", "coloris", "client"])
    verifier(somme(vue, 1) === r1.totaux.faites && somme(vue, 2) === r1.totaux.restantes && sommeSous(vue, 1) === r1.totaux.faites && sommeSous(vue, 2) === r1.totaux.restantes,
      `suivi par ${vue} : ${somme(vue, 1)} faites, ${somme(vue, 2)} à faire (= les barres des lancements, détail compris)`);
  const v46 = r1.vues.semaine.find((g) => g[0] === "Semaine 46");
  const v48 = r1.vues.semaine.find((g) => g[0] === "Semaine 48");
  verifier(!dossierS46 || (v46 && v46[1] > v46[2] && v46[4].length > 0), "suivi par semaine : la 46 presque finie, détail par transporteur");
  verifier(v48 && v48[3] === "hors_extraction", "suivi par semaine : la 48 « pas dans cette extraction »");
  verifier(!inconnu || inconnu[1] + inconnu[2] < 0.05 * (r1.totaux.faites + r1.totaux.restantes), `transporteur retrouvé pour presque toutes les pièces (inconnu : ${inconnu ? inconnu[1] + inconnu[2] : 0})`);
  // V6.4.4 : les pièces de production que Diakonos connaît mais qui ne sont dans aucun lancement comptent aussi (ligne
  // « Pas dans un lancement » de leur semaine) : rien d'oublié, et leur coloris vient de l'extraction (ex. 1114 en S46).
  const controle = await page.evaluate(() => {
    const ex = SUIVI.etat.extractions;
    const der = ex[ex.length - 1];
    const prod = (c) => !/r[ée]sine/i.test(c) && !/fourniture|dibond/i.test(c);
    let cours = 0;
    for (const l of der.lignes) if (l[0] && l[1] && prod(l[4])) cours += Math.max(0, l[6]);
    const r = SUIVI.calculer();
    const c1114 = r.vues.coloris.find((g) => String(g[0]) === "1114");
    const hors46 = r.semaines.flatMap((x) => x.lancements.map((l) => [x.semaine, l])).find(([sem, l]) => sem === 46 && l.nom === "Pas dans un lancement");
    return { cours: Math.round(cours * 100) / 100, restantes: r.totaux.restantes, c1114: c1114 ? [c1114[1], c1114[2], c1114[4].map((x) => x[0])] : null, hors46: hors46 ? [hors46[1].f, hors46[1].r] : null };
  });
  console.log(JSON.stringify({ controle }));
  verifier(Math.abs(controle.restantes - controle.cours) < 0.01, `aucune pièce de production de Diakonos oubliée : ${controle.restantes} à faire = somme « Qte en cours » (${controle.cours})`);
  verifier(!dossierS46 || (controle.c1114 && controle.c1114[2].includes("Semaine 46")), `coloris 1114 dans le suivi par coloris, avec la semaine 46 (${JSON.stringify(controle.c1114)})`);
  verifier(!dossierS46 || (controle.hors46 && controle.hors46[1] > 0), `semaine 46 : ligne « Pas dans un lancement » (${JSON.stringify(controle.hors46)})`);
  // Bibliothèque rangée avant la V6.3.3 (sans la colonne transporteur) : le transporteur vient de Diakonos.
  const ancien = await page.evaluate(() => {
    const garde = [];
    for (const s of bibliotheque.semaines.values()) {
      garde.push([s, s.colonnesPieces]);
      s.colonnesPieces = (s.colonnesPieces || COLONNES_PIECES_BIBLIOTHEQUE).map((c) => (c === "transporteur" ? "ancienne" : c));
    }
    bibliotheque.generation++;
    const r = SUIVI.calculer();
    for (const [s, c] of garde) s.colonnesPieces = c;
    bibliotheque.generation++;
    return { noms: r.vues.transporteur.map((g) => [g[0], g[1] + g[2]]), f: r.vues.transporteur.reduce((t, g) => t + g[1], 0) };
  });
  console.log(JSON.stringify(ancien));
  verifier(ancien.f === r1.totaux.faites, "bibliothèque sans la colonne transporteur : même total, transporteur pris dans Diakonos");
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
  verifier(lan(r2, "LAN264701START").f === 48, "LAN264701START : toujours 48 faites (rien de plus sorti de l'extraction)");

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
  verifier(/Suivi de production/.test(texte) && /Semaine 47/.test(texte) && /S48/.test(texte), "écran : semaine 47 affichée, 48 dans le bandeau");
  verifier(texte.includes(`${Math.round((100 * piecesRetirees) / 165)} %`) && /Pas dans cette extraction/i.test(texte), "écran : pourcentage de LAN264702START, « Pas dans cette extraction » pour la 48");
  // V6.9 : l'explication est derrière le bouton « ? » (cachée, mais dans la page) ; le bouton l'ouvre.
  verifier(/un CVC qui n'y est plus = pièce faite/.test(await page.locator("#pageSuivi").textContent()), "écran : la règle de l'atelier est écrite (derrière « ? »)");
  await page.click('#pageSuivi [data-aide="sv-avancement"]');
  verifier(/un CVC qui n'y est plus = pièce faite/.test(await page.locator("#pageSuivi").innerText()), "« ? » : la règle de l'atelier s'affiche");
  verifier(/depuis le 07\/11/.test(texte), "écran : « +N pièces depuis le 07/11 »");
  // V6.9.2 : une semaine à la fois (celle en fabrication au départ) ; « Toutes » pour compter toutes les barres.
  verifier((await page.locator("#pageSuivi [data-sv-sem]").count()) >= 3 && /S47/.test(await page.locator("#pageSuivi .sv-bandeau .bandeau-btn.actif").innerText()), "bandeau des semaines : la semaine en fabrication (S47) choisie au départ");
  await page.click('#pageSuivi [data-sv-sem="tout"]');
  const barres = await page.locator("#pageSuivi [data-sv-lan] .sv-barre").count();
  const lignesHors = await page.evaluate(() => SUIVI.calculer().semaines.flatMap((x) => x.lancements).filter((l) => l.nom === "Pas dans un lancement").length);
  verifier(barres === lancements.length + lignesHors, `une barre par lancement (${barres}, dont ${lignesHors} « Pas dans un lancement »)`);
  await page.locator('#pageSuivi [data-sv-lan="LAN264702START"] > .sv-ligne').click();
  const detail = await page.locator('#pageSuivi [data-sv-lan="LAN264702START"] .sv-detail').innerText();
  verifier(/Commande/.test(detail) && /CVC\d{8}/.test(detail), "clic : les commandes encore à faire du lancement");
  if (capture) await page.locator("#pageSuivi").screenshot({ path: capture });
  // Suivi par semaine / transporteur / coloris : une barre par ligne, un clic donne le détail.
  const vuesEcran = {};
  await page.click('#pageSuivi [data-sv-panneau="vues"]');
  for (const vue of ["transporteur", "coloris", "client", "semaine"]) {
    await page.locator(`#svVues [data-sv-vue="${vue}"]`).click();
    const lignes = await page.locator("#svVues [data-sv-groupe]").count();
    await page.locator("#svVues [data-sv-groupe] > .sv-ligne").first().click();
    const sous = await page.locator("#svVues .sv-sous").count();
    vuesEcran[vue] = [lignes, sous, await page.locator("#svVues .carte-titre").innerText(), await page.locator("#svVues .sv-sous").first().innerText().catch(() => "")];
    if (capture && vue !== "semaine") await page.locator("#svVues").screenshot({ path: capture.replace(/\.png$/, `_${vue}.png`) });
  }
  console.log(JSON.stringify(vuesEcran));
  verifier(vuesEcran.transporteur[0] > 3 && vuesEcran.transporteur[1] > 0 && /Semaine \d+/.test(vuesEcran.transporteur[3]) && /par transporteur/i.test(vuesEcran.transporteur[2]),
    `écran : suivi par transporteur (${vuesEcran.transporteur[0]} transporteurs), clic = détail par semaine`);
  verifier(vuesEcran.coloris[0] > 3 && vuesEcran.coloris[1] > 0, `écran : suivi par coloris (${vuesEcran.coloris[0]} coloris)`);
  verifier(vuesEcran.client[0] > 3 && vuesEcran.client[1] > 0, `écran : suivi par client (${vuesEcran.client[0]} clients)`);
  verifier(vuesEcran.semaine[0] >= 3 && vuesEcran.semaine[1] > 0, `écran : suivi par semaine (${vuesEcran.semaine[0]} semaines), clic = détail par transporteur`);

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
  await page.click('#pageSuivi [data-sv-panneau="extractions"]'); // V6.9 : les extractions gardées sont dans leur onglet
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
