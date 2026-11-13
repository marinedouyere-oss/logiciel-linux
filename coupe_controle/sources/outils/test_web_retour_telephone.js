// V6.3 : le téléphone renvoie au PC des plans de coupe modifiés et des problèmes validés OK (canal retour chiffré).
// Usage : node test_web_retour_telephone.js <index.html> <dossier « 1ER TOUR AGGLO » de la semaine 48> [paquet de l'appli .bin] [capture.png]
// Le site de Sentinelle est simulé ici (mêmes réponses que le vrai : manifeste, parties, jeton d'écriture).
// Le paquet de l'appli (facultatif) : demandes chiffrées par l'appli Android avec le code TEST-TEST-TEST-TEST.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [pageHtml, dossier, paquetAppli, capture] = process.argv.slice(2);
let echecs = 0;
const verifier = (ok, t) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`);
  if (!ok) echecs++;
};
const SITE = "https://sentinelle-laisne-0ysi8zpn.netlify.app";
const CODE = "TEST-TEST-TEST-TEST";

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
  // Le site simulé : { canal/manifeste, canal/version/partie }.
  const magasin = new Map();
  let envoisPc = 0;
  await page.route(`${SITE}/**`, async (r) => {
    const u = new URL(r.request().url());
    const canal = u.searchParams.get("canal");
    const version = u.searchParams.get("version");
    const partie = u.searchParams.get("partie");
    const json = (o, status = 200) => r.fulfill({ status, body: JSON.stringify(o), headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
    const m = r.request().method();
    if (m === "OPTIONS") return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (m === "GET" && version === null) return magasin.has(`${canal}/manifeste`) ? json(magasin.get(`${canal}/manifeste`)) : json({ erreur: "rien pour ce code" }, 404);
    if (m === "GET") return magasin.has(`${canal}/${version}/${partie}`) ? r.fulfill({ status: 200, body: magasin.get(`${canal}/${version}/${partie}`), headers: { "access-control-allow-origin": "*" } }) : json({ erreur: "partie absente" }, 404);
    if (m === "PUT") {
      magasin.set(`${canal}/${version}/${partie}`, r.request().postDataBuffer());
      return json({ ok: true });
    }
    if (m === "POST") {
      magasin.set(`${canal}/manifeste`, JSON.parse(r.request().postData()));
      envoisPc++;
      return json({ ok: true });
    }
    return json({ erreur: "méthode" }, 405);
  });
  await page.goto("https://s.test/index.html");
  await page.waitForFunction(() => typeof lireRetourTelephone === "function" && bibliotheque && paires.length > 0, null, { timeout: 30000 });
  const fic = (f) => [[...fs.readFileSync(f)], path.basename(f)];

  // 1. Un vrai lancement de la semaine 48, avec son .bkp, rangé dans la bibliothèque (plans pour le téléphone) ;
  //    un problème « à corriger » ajouté pour l'essai de validation.
  const r1 = await page.evaluate(async ([s, b, code]) => {
    const p = pairesDeLaSemaine(ongletDuNumero(48))[0];
    p.strat = new File([new Uint8Array(s[0])], s[1]);
    p.bkp = new File([new Uint8Array(b[0])], b[1]);
    p.semaine = "48";
    await archiverOnglet(ongletDuNumero(48), null);
    const sem = [...bibliotheque.semaines.values()].find((x) => x.lancements.some((l) => l.nom === "LAN264801START"));
    const lancements = sem.lancements.map((l) =>
      l.nom !== "LAN264801START" ? l : { ...l, controle: { nbCorriger: 1, nbVerifier: 0, bilan: [] }, problemes: [{ niveau: "corriger", type: "Essai téléphone", cle: "CVC26110064003", detail: "pour l'essai", article: "", dimensions: "", coloris: "", quantite: "1", lignes: "2" }] }
    );
    await enregistrerSemaineLocale({ ...sem, lancements, maj: new Date().toISOString() });
    changementBibliotheque();
    ecrireLienTelephone({ code, signature: null, dernierEnvoi: null, erreur: null });
    const c = contenuFichierPartage();
    const l = c.semaines.find((x) => x.lancements.some((y) => y.nom === "LAN264801START")).lancements.find((y) => y.nom === "LAN264801START");
    const jp = l.plans.pieces.CVC26110064003.p.find((x) => x[1] === 1);
    const pl = l.plans.plans[jp[0]];
    return { lancement: l.plans.lancement, plan: { matiere: pl[0], pdc: pl[1], module: pl[2], nom: pl[3], extra: pl[11], drapeau: pl[10] }, idx: jp[2][0], nom: l.plans.noms[pl[9][jp[2][0]][4]] };
  }, [fic(path.join(dossier, "LAN264801START.xlsx")), fic(path.join(dossier, "LAN264801STARTbackup.bkp")), CODE]);
  console.log(JSON.stringify(r1));
  verifier(r1.plan.extra && /^#[0-9a-f]{8}$/.test(r1.plan.extra.e) && r1.plan.extra.rt === null && r1.plan.drapeau === 0, "plans pour le téléphone : empreinte du plan, pas encore modifié");
  // Le fichier partagé à ce moment-là (pour les tests de l'appli : plans au format V6.3, un problème à valider).
  if (process.env.SENTINELLE_PARTAGE_SORTIE) fs.writeFileSync(process.env.SENTINELLE_PARTAGE_SORTIE, JSON.stringify(await page.evaluate(() => contenuFichierPartage())));

  // 2. Le téléphone envoie 3 demandes : retirer le morceau du plan, valider le problème, et une modification d'un
  //    plan qui a changé sur le PC (empreinte différente) : refusée.
  const demandes = [
    { id: "essai-1", type: "plan", titre: `Pdc ${r1.plan.pdc}`, lancement: r1.lancement, matiere: r1.plan.matiere, pdc: r1.plan.pdc, module: r1.plan.module, nom: r1.plan.nom, empreinte: r1.plan.extra.e, rt: { morceaux: { [r1.idx]: { retire: true } }, ajouts: [] }, resume: [`${r1.nom} retiré du plan — ne pas le couper`] },
    { id: "essai-2", type: "validation", titre: "Essai téléphone", lancement: "LAN264801START", cle: "CVC26110064003", probleme: "Essai téléphone" },
    { id: "essai-3", type: "plan", titre: `Pdc ${r1.plan.pdc}`, lancement: r1.lancement, matiere: r1.plan.matiere, pdc: r1.plan.pdc, module: 0, nom: r1.plan.nom, empreinte: "#00000000", rt: { morceaux: { 0: { retire: true } }, ajouts: [] } },
  ];
  const envoi = await page.evaluate(async ([code, demandes]) => {
    const secrets = await secretsLien(code);
    const json = new TextEncoder().encode(JSON.stringify({ format: "sentinelle-demandes-1", appareil: "essai", envoye: new Date().toISOString(), demandes }));
    const gz = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    const paquet = await paquetChiffre(secrets.cle, gz);
    return { canal: await canalRetourLien(code), paquet: [...paquet] };
  }, [CODE, demandes]);
  magasin.set(`${envoi.canal}/v1essai/0`, Buffer.from(envoi.paquet));
  magasin.set(`${envoi.canal}/manifeste`, { version: "v1essai", parties: 1, taille: envoi.paquet.length });
  const r2 = await page.evaluate(async ([d0]) => {
    const n = await lireRetourTelephone();
    const t = retourPourPartage().traitees;
    const p = pairesDeLaSemaine(ongletDuNumero(48))[0];
    const donnees = await lirePlansBkp(p.bkp);
    const plan = planDuLancement(donnees, d0);
    const rt = retoucheDuPlan(d0.lancement, plan);
    const c = contenuFichierPartage();
    const l = c.semaines.find((x) => x.lancements.some((y) => y.nom === "LAN264801START")).lancements.find((y) => y.nom === "LAN264801START");
    const pl = l.plans.plans.find((x) => x[0] === d0.matiere && x[1] === d0.pdc && !x[2]);
    const pb = l.problemes.find((x) => x.type === "Essai téléphone");
    return {
      n, erreur: retourTelephone.erreur, reponses: ["essai-1", "essai-2", "essai-3"].map((id) => t[id] && `${t[id].ok}:${t[id].texte}`),
      retire: Boolean(rt && rt.morceaux[d0.rt.morceaux ? Object.keys(d0.rt.morceaux)[0] : 0] && rt.morceaux[Object.keys(d0.rt.morceaux)[0]].retire),
      envoye: pl ? { drapeau: pl[10], etat: pl[9].map((r) => r[8]).filter(Boolean), rt: Boolean(pl[11] && pl[11].rt) } : null,
      valide: Boolean(validationDe("LAN264801START", { cle: "CVC26110064003", type: "Essai téléphone" })), pb: pb && `${pb.niveau}:${Boolean(pb.valide)}`, nbCorriger: l.controle && l.controle.nbCorriger,
      signature: signaturePartage([...bibliotheque.semaines.values()], null, retourPourPartage()).includes("essai-1"),
    };
  }, [demandes[0]]);
  console.log(JSON.stringify(r2));
  verifier(r2.n === 3 && !r2.erreur, `3 demandes du téléphone lues et déchiffrées (${r2.n}${r2.erreur ? `, ${r2.erreur}` : ""})`);
  verifier(r2.reponses[0] && r2.reponses[0].startsWith("true:") && r2.retire, "plan modifié sur le téléphone : la modification est reprise par le PC (morceau retiré)");
  verifier(r2.envoye && r2.envoye.drapeau === 1 && r2.envoye.etat.includes("r") && r2.envoye.rt, "le plan repart au téléphone modifié (pièce retirée, en pointillés rouges)");
  verifier(r2.reponses[1] && r2.reponses[1].startsWith("true:") && r2.valide && r2.pb === "valide:true" && r2.nbCorriger === 0, "« Valider OK » du téléphone : validé sur le PC et dans la bibliothèque (plus à corriger)");
  verifier(r2.reponses[2] && r2.reponses[2].startsWith("false:") && /a changé sur le PC/.test(r2.reponses[2]), `plan changé sur le PC : modification refusée, avec la raison (${r2.reponses[2]})`);
  verifier(r2.signature, "les réponses vont au téléphone (fichier partagé et signature d'envoi)");
  const r3 = await page.evaluate(() => lireRetourTelephone());
  verifier(r3 === 0, "relu sans changement : rien n'est refait");

  // 3. La réponse part au téléphone (envoi chiffré du fichier partagé), et la carte Téléphone de la bibliothèque la montre.
  const avant = envoisPc;
  await page.evaluate(() => envoyerAuTelephone(true));
  verifier(envoisPc > avant, "le fichier partagé (avec les réponses) est renvoyé au téléphone");
  await page.evaluate(() => {
    onglet = "bibliotheque";
    afficher();
  });
  const carte = await page.locator("#carteLienTelephone").innerText();
  verifier(/Reçu du téléphone/.test(carte) && /Validé OK : Essai téléphone/.test(carte) && /a changé sur le PC/.test(carte), "Bibliothèque → Téléphone : « Reçu du téléphone » avec les réponses");
  if (capture) await page.locator("#carteLienTelephone").screenshot({ path: capture });

  // 4. Un paquet chiffré par l'appli Android elle-même (même format, même clé) : lu et repris.
  if (paquetAppli && fs.existsSync(paquetAppli)) {
    const octets = fs.readFileSync(paquetAppli);
    magasin.set(`${envoi.canal}/v2appli/0`, octets);
    magasin.set(`${envoi.canal}/manifeste`, { version: "v2appli", parties: 1, taille: octets.length });
    const r4 = await page.evaluate(async () => {
      const n = await lireRetourTelephone();
      const t = retourPourPartage().traitees;
      return { n, erreur: retourTelephone.erreur, reponses: Object.entries(t).filter(([id]) => !id.startsWith("essai-")).map(([, x]) => `${x.ok}:${x.type}:${x.texte}`), valide: Boolean(validationDe("LAN264801START", { cle: "CVC26110064004", type: "Essai Android" })) };
    });
    console.log(JSON.stringify(r4));
    verifier(r4.n >= 2 && !r4.erreur && r4.valide, `paquet fait par l'appli Android : déchiffré et repris par le PC (${r4.n} demandes)`);
    verifier(r4.reponses.length === r4.n && r4.reponses.every((x) => x.startsWith("true:")) && r4.reponses.some((x) => x.startsWith("true:plan:")), "demandes de l'appli (plan modifié depuis l'écran Plans, Valider OK) toutes reprises");
  } else console.log("(pas de paquet de l'appli : étape 4 sautée)");

  await nav.close();
  console.log(echecs ? `${echecs} échec(s)` : "TOUT EST OK");
  process.exit(echecs ? 1 : 0);
})();
