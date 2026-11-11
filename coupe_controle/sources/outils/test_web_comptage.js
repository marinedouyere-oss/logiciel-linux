// V6.4.3 : comptage du suivi en direct (une étiquette = une pièce), sur des données fabriquées (anonymes).
// Vérifie : lignes de plusieurs pièces, lancement hors extraction, dévalidation (l'extraction fait foi),
// ré-impression (plafonnée), casse (l'extraction décide, même si le lancement casse est scanné après).
// Usage : node test_web_comptage.js <index.html>
const { chromium } = require("playwright");
const fs = require("fs");
const [pageHtml] = process.argv.slice(2);
let echecs = 0;
const verifier = (ok, t) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`);
  if (!ok) echecs++;
};

(async () => {
  const nav = await chromium.launch();
  const page = await (await nav.newContext()).newPage();
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  await page.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://s.test/index.html");
  await page.waitForFunction(() => typeof SUIVI === "object" && typeof etiquettesEnDirect === "function", null, { timeout: 30000 });

  const res = await page.evaluate(() => {
    const T0 = Date.parse("2026-11-10T08:00:00Z"); // heure de l'extraction
    const h = (heures) => T0 + heures * 3600e3; // T0 + n heures
    const iso = (t) => new Date(t).toISOString();
    const cols = COLONNES_PIECES_BIBLIOTHEQUE;
    const ligne = (cmd, lig, qte) => {
      const p = cols.map(() => "");
      p[cols.indexOf("cle")] = cleLigne(cmd, lig);
      p[cols.indexOf("commande")] = cmd;
      p[cols.indexOf("ligne")] = lig;
      p[cols.indexOf("pieces")] = qte;
      return p;
    };
    const semaine = (sem, lancements) => ({ id: idSemaine(2026, sem), annee: 2026, semaine: sem, maj: "", supprimeeLe: null, colonnesPieces: cols, lancements });
    const rangee = (sem, cmd, lig, lanc, cours) => [sem, 2026, cmd, lig, "", lanc, cours, "TRANSP", "VILLE", "1"];
    const extraction = (lignesEx) => {
      const parCle = new Map();
      for (const r of lignesEx) {
        const k = cleLigne(r[2], r[3]);
        if (!parCle.has(k)) parCle.set(k, { lanc: 0, cours: 0, lignes: [] });
        const x = parCle.get(k);
        x.lanc += r[5];
        x.cours += r[6];
        x.lignes.push(r);
      }
      return { jour: "2026-11-10", courante: { annee: 2026, semaine: 46 }, ordre: ordreSemaine(2026, 46), ordreMax: ordreSemaine(2026, 46), modifie: T0, fichiers: [], lignes: lignesEx, parCle };
    };
    // Étiquettes au format de l'agent : « poste-secondes-compteur » (l'heure d'impression est dedans).
    let compteur = 0;
    const etiq = (cmd, lig, ...heures) => [
      cleLigne(cmd, lig),
      { commande: cmd, ligne: lig, poste: "1", nom: "Essai", quand: iso(h(heures[heures.length - 1])), etiquettes: heures.map((x) => [`1-${Math.floor(h(x) / 1000)}-${++compteur}`, Math.floor(h(x) / 1000) * 1000]) },
    ];
    const calcul = (semaines, ex, etiquettes) => {
      bibliotheque.semaines = new Map(semaines.map((s) => [s.id, s]));
      bibliotheque.generation = (bibliotheque.generation || 0) + 1;
      SUIVI.etat.extractions = [ex];
      SUIVI.etat.generation++;
      validations.faites = Object.fromEntries(etiquettes);
      validations.traitees = {};
      validations.postes = {};
      validations.rev++;
      const r = SUIVI.calculer();
      const L = Object.fromEntries(r.semaines.flatMap((x) => x.lancements).map((l) => [l.nom, [l.f, l.r]]));
      return { total: [r.totaux.faites, r.totaux.restantes], L };
    };
    const out = {};

    // Lancement de base : une ligne de 3 pièces + une ligne d'1 pièce, toutes « en cours » dans l'extraction.
    const base = () => semaine(46, [{ nom: "LAN2646P1", poste: "P1", maj: iso(h(-20)), pieces: [ligne("CVC11111111", "1", 3), ligne("CVC11111111", "2", 1)] }]);
    const ex = extraction([rangee(46, "CVC11111111", "1", 3, 3), rangee(46, "CVC11111111", "2", 1, 1)]);
    out.sans = calcul([base()], ex, []).total;
    out.ligne3_1etiq = calcul([base()], ex, [etiq("CVC11111111", "1", 1)]).total;
    out.ligne3_3etiq = calcul([base()], ex, [etiq("CVC11111111", "1", 1, 2, 3)]).total;
    // Ré-impression d'une pièce seule : deux étiquettes, plafonné à 1.
    out.reimpression = calcul([base()], ex, [etiq("CVC11111111", "2", 1, 2)]).total;
    // Dévalidation : étiquette imprimée AVANT l'extraction, qui remontre la pièce à faire → ne compte plus.
    out.devalidee = calcul([base()], ex, [etiq("CVC11111111", "2", -1)]).total;

    // Lancement de la semaine 47 (au-delà de l'extraction), 10 pièces, une seule étiquette.
    const lignes47 = [];
    for (let i = 1; i <= 10; i++) lignes47.push(ligne("CVC22222222", String(i), 1));
    const s47 = semaine(47, [{ nom: "LAN2647P1", poste: "P1", maj: iso(h(-20)), pieces: lignes47 }]);
    out.hors_sans = calcul([base(), s47], ex, []).L;
    out.hors_1etiq = calcul([base(), s47], ex, [etiq("CVC22222222", "1", 1)]).L;

    // Casse : c'est l'extraction qui décide (Diakonos remet la pièce relancée « en cours »).
    const avecCasse = () => [
      semaine(46, [
        { nom: "LAN2646P1", poste: "P1", maj: iso(h(-20)), pieces: [ligne("CVC33333333", "1", 1), ligne("CVC33333333", "2", 1)] },
        // Lancement casse scanné APRÈS l'extraction (cas courant) : sa date de scan ne doit rien changer.
        { nom: "LAN2646CASSE", poste: "", casse: true, maj: iso(h(5)), pieces: [ligne("CVC33333333", "1", 1)] },
      ]),
    ];
    // La pièce relancée n'est plus dans l'extraction : elle a été refaite → faite (régression 6.4.3 : passait à faire).
    out.casse_finie = calcul(avecCasse(), extraction([rangee(46, "CVC33333333", "2", 1, 1)]), []).L;
    // L'extraction la remontre « en cours » (relancée, pas encore refaite) → à faire ; une étiquette après → faite.
    const exC = extraction([rangee(46, "CVC33333333", "1", 1, 1), rangee(46, "CVC33333333", "2", 1, 1)]);
    out.casse_a_refaire = calcul(avecCasse(), exC, []).L;
    out.casse_recoupee = calcul(avecCasse(), exC, [etiq("CVC33333333", "1", 1)]).L;
    // Le bandeau compte les étiquettes (pièces), pas les lignes.
    validations.faites = Object.fromEntries([etiq("CVC11111111", "1", 1, 2, 3), etiq("CVC11111111", "2", 1)]);
    out.bandeau = nbEtiquettesRecues();
    return out;
  });
  console.log(JSON.stringify(res));
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  verifier(eq(res.sans, [0, 4]), `sans étiquette : 0 faite / 4 à faire (${res.sans})`);
  verifier(eq(res.ligne3_1etiq, [1, 3]), `ligne de 3 pièces, 1 étiquette → 1 faite / 3 à faire (${res.ligne3_1etiq})`);
  verifier(eq(res.ligne3_3etiq, [3, 1]), `ligne de 3 pièces, 3 étiquettes → 3 faites / 1 à faire (${res.ligne3_3etiq})`);
  verifier(eq(res.reimpression, [1, 3]), `ré-impression d'une pièce seule : plafonné à 1 (${res.reimpression})`);
  verifier(eq(res.devalidee, [0, 4]), `dévalidation (étiquette d'avant l'extraction) : ne compte plus (${res.devalidee})`);
  verifier(eq(res.hors_sans.LAN2647P1, [0, 0]), `lancement hors extraction sans étiquette : pas suivi (${res.hors_sans.LAN2647P1})`);
  verifier(eq(res.hors_1etiq.LAN2647P1, [1, 9]), `lancement hors extraction, 1 étiquette → 1 faite / 9 à faire (${res.hors_1etiq.LAN2647P1})`);
  verifier(eq(res.casse_finie.LAN2646CASSE, [1, 0]), `casse scannée après l'extraction, plus dans Diakonos → faite (${res.casse_finie.LAN2646CASSE})`);
  verifier(eq(res.casse_a_refaire.LAN2646CASSE, [0, 1]), `casse encore « en cours » dans l'extraction → à faire (${res.casse_a_refaire.LAN2646CASSE})`);
  verifier(eq(res.casse_recoupee.LAN2646CASSE, [1, 0]), `casse recoupée, étiquette après l'extraction → faite (${res.casse_recoupee.LAN2646CASSE})`);
  verifier(res.bandeau === 4, `bandeau : 4 étiquettes reçues = 4 pièces (${res.bandeau})`);

  // Réception (mini-site simulé) : 3 étiquettes de la même ligne → 3 étiquettes rangées sur la pièce, poste à 3 ;
  // le même lot renvoyé par l'agent (avant l'accusé) n'est pas recompté.
  const recu = await page.evaluate(async () => {
    const t = Math.floor(Date.parse("2026-11-10T10:00:00Z") / 1000);
    const lot = { pc: "1", nom: "Crédences", demandes: [1, 2, 3].map((i) => ({ id: `1-${t + i}-${i}`, jour: "2026-11-10", etiquette: "" })) };
    lienTelephone.memoire = { code: "ABCD-EFGH-JKLM-NPQR" };
    telechargerValidations = async (_code, poste) => (poste === "1" ? lot : null);
    pieceDeLEtiquette = async () => ({ cle: "CVC44444444001", commande: "CVC44444444", ligne: "1" });
    validations.faites = {};
    validations.traitees = {};
    validations.postes = {};
    const n1 = await lireValidations();
    const n2 = await lireValidations(); // même lot renvoyé
    const v = validations.faites.CVC44444444001;
    return { n1, n2, etiquettes: v ? v.etiquettes.length : 0, heure: v ? v.etiquettes[0][1] : 0, attendu: (t + 1) * 1000, poste: validations.postes["1"].nb };
  });
  console.log(JSON.stringify(recu));
  verifier(recu.n1 === 3 && recu.etiquettes === 3 && recu.poste === 3, `réception : 3 étiquettes de la même ligne → 3 pièces, poste à 3 (${recu.etiquettes}/${recu.poste})`);
  verifier(recu.n2 === 0 && recu.etiquettes === 3, `lot renvoyé par l'agent : pas recompté (${recu.n2})`);
  verifier(recu.heure === recu.attendu, `heure de l'étiquette = heure d'impression donnée par l'agent`);
  await nav.close();
  console.log(echecs ? `${echecs} échec(s)` : "TOUT EST OK");
  process.exit(echecs ? 1 : 0);
})();
