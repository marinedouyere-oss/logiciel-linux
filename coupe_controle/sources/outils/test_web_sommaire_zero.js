// Sommaire Cut Rite avec un panneau à zéro dont les quantités ne sont pas imprimées : le sommaire se lit
// (panneau compté 0, signalé), et le rapport du lancement sort même avec un sommaire illisible.
// Usage : node test_web_sommaire_zero.js <index.html> <SOMMAIRE…pdf>
const { chromium } = require("playwright"); const fs = require("fs");
const [pageHtml, pdf] = process.argv.slice(2);
let echecs = 0; const verifier = (ok, t) => { console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`); if (!ok) echecs++; };
(async () => {
  const nav = await chromium.launch(); const page = await nav.newPage();
  page.on("pageerror", (e) => { console.log("ERREUR JS:", e.message); echecs++; });
  await page.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://s.test/index.html");
  const r = await page.evaluate(async (o) => {
    const lignes = await extraireLignesTextePDF(await chargerDocumentPDF(new File([new Uint8Array(o)], "SOMMAIRE.pdf")));
    const normal = lireSommaireCutRite(lignes);
    // Panneau à zéro sans ligne de quantités (SAG58HYBR) ; dernier panneau sans ses quantités (SMELBLALIS19) : la
    // ligne du total qui suit ne doit pas lui être donnée.
    const zero = lignes.filter((l) => !/^SAG58HYBR 0 0$/.test(l)).map((l) => (/^SMELBLALIS19 1 0$/.test(l) ? "SMELBLALIS19 1" : l));
    let lu = null, erreur = null;
    try { lu = lireSommaireCutRite(zero); } catch (e) { erreur = e.message; }
    const parties = lu ? partiesSommaire(lu) : [];
    // Rapport du lancement avec un sommaire qui n'en est pas un : il sort quand même.
    const p = { id: "t", poste: "Agglo 1er tour", parite: "paire", sommaire: new File([new Uint8Array([37, 80, 68, 70])], "SOMMAIRE LAN264601START.pdf"), strat: null };
    let rapport = null, erreurRapport = null;
    try { rapport = await rapportLancement(p); } catch (e) { erreurRapport = e.message; }
    return { normal: [normal.materiaux.length, normal.totalPanneaux, normal.totalRestes, avertissementSommaire(normal)], erreur,
      lu: lu && [lu.materiaux.length, lu.sansQuantites, lu.ecartTotal], statut: parties[0] && parties[0].statut,
      rapport: rapport && [rapport.nom, rapport.octets.length, new TextDecoder("latin1").decode(rapport.octets.slice(0, 5))], erreurRapport };
  }, Array.from(fs.readFileSync(pdf)));
  console.log(JSON.stringify(r, null, 1));
  verifier(r.normal[0] === 54 && r.normal[1] === 142 && r.normal[2] === 61 && r.normal[3] === null, "sommaire S46 normal : 54 matériaux, 142 / 61, aucun avertissement");
  verifier(!r.erreur && r.lu && r.lu[0] === 54, "panneau à zéro sans quantités : le sommaire se lit quand même");
  verifier(r.lu && r.lu[1].join() === "SAG58HYBR,SMELBLALIS19", "les panneaux sans quantités lisibles sont relevés");
  verifier(r.lu && /lu 141 \/ 61/.test(r.lu[2] || ""), "écart avec le total du sommaire relevé");
  verifier(/quantités illisibles pour SAG58HYBR, SMELBLALIS19/.test(r.statut || ""), "avertissement en tête du rapport agglo");
  verifier(!r.erreurRapport && r.rapport && r.rapport[2] === "%PDF-", "sommaire illisible : le rapport du lancement sort quand même");
  await nav.close(); console.log(echecs ? `${echecs} ÉCHEC(S)` : "TOUT EST BON"); process.exit(echecs ? 1 : 0);
})();
