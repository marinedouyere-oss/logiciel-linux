// V6.4 : lecture du CVC sur l'étiquette Zebra (image ^GFA), recoupée avec les commandes lancées.
// Fabrique de fausses étiquettes (données anonymes) et vérifie que Sentinelle lit le bon CVC + la bonne ligne.
// Usage : node test_web_etiquette.js <index.html> <python> <fabriquer_etiquette_test.py> <dossier de sortie> [etiquette_vraie.spl]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const [pageHtml, python, fabriquer, sortie, vraie] = process.argv.slice(2);
let echecs = 0;
const verifier = (ok, t) => { console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`); if (!ok) echecs++; };

function fabriquerEtiquette(cvc, ligne) {
  const f = path.join(sortie, `etq_${cvc}_${ligne}.spl`);
  execFileSync(python, ["-I", fabriquer, cvc, String(ligne), f]);
  return fs.readFileSync(f).toString("base64");
}

(async () => {
  fs.mkdirSync(sortie, { recursive: true });
  const nav = await chromium.launch();
  const page = await (await nav.newContext()).newPage();
  page.on("pageerror", (e) => { console.log("ERREUR JS:", e.message); echecs++; });
  await page.route("https://s.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://s.test/index.html");
  await page.waitForFunction(() => typeof lireCvcEtiquette === "function", null, { timeout: 30000 });

  const lire = (b64, cands) =>
    page.evaluate(async ([d, c]) => {
      const o = Uint8Array.from(atob(d), (ch) => ch.charCodeAt(0));
      return await lireCvcEtiquette(o, c);
    }, [b64, cands]);

  // 1. Plusieurs étiquettes (tous les chiffres, lignes à 1 et 2 chiffres) : lecture brute juste.
  for (const [cvc, ligne] of [["CVC47123905", "11"], ["CVC26050839", "1"], ["CVC80916243", "7"], ["CVC30587164", "2"]]) {
    const r = await lire(fabriquerEtiquette(cvc, ligne), []);
    verifier(r && r.lectureBrute === cvc, `lecture brute ${cvc} → ${r && r.lectureBrute}`);
  }

  // 2. Recoupé avec les pièces lancées : la bonne pièce ressort devant les leurres proches, avec une marge nette.
  const b64 = fabriquerEtiquette("CVC47123905", "11");
  const candidats = [
    { commande: "CVC47123905", lignes: ["11", "2"] },
    { commande: "CVC47123805", lignes: ["11"] },
    { commande: "CVC41123905", lignes: ["11"] },
    { commande: "CVC47123900", lignes: ["1"] },
    { commande: "CVC26050839", lignes: ["1"] },
  ];
  const res = await lire(b64, candidats);
  console.log(JSON.stringify(res));
  verifier(res && res.commande === "CVC47123905", `pièce choisie : ${res && res.commande} (attendu CVC47123905)`);
  verifier(res && res.ligne === "11", `ligne lue : ${res && res.ligne} (attendu 11)`);
  verifier(res && res.cle === "CVC47123905011", `clé pièce : ${res && res.cle}`);
  verifier(res && res.marge > 0.01, `marge nette sur le 2e candidat : ${res && res.marge && res.marge.toFixed(3)}`);

  // 3. Une étiquette dont la pièce n'est PAS dans la liste : la lecture brute reste juste (sera mise de côté à l'intégration).
  const horsListe = await lire(fabriquerEtiquette("CVC99001122", "3"), candidats);
  verifier(horsListe && horsListe.lectureBrute === "CVC99001122", `hors liste : lecture brute ${horsListe && horsListe.lectureBrute}`);

  // 4. Sur la vraie étiquette, si fournie (donnée client, hors dépôt).
  if (vraie && fs.existsSync(vraie)) {
    const r = await lire(fs.readFileSync(vraie).toString("base64"), [{ commande: "CVC26050839", lignes: ["1", "2"] }, { commande: "CVC26050879", lignes: ["1"] }]);
    verifier(r && r.cle === "CVC26050839001", `vraie étiquette : ${r && r.cle} (attendu CVC26050839001)`);
  }

  // 5. L'écran Suivi s'affiche bien quand le lien est branché (bandeau + activité par poste + Réinitialiser),
  //    sans erreur JS (régression 6.4.1 : la page devenait blanche).
  const ecran = await page.evaluate(() => {
    lienTelephone.memoire = { code: "ABCD-EFGH-JKLM-NPQR" };
    validations.faites = { CVC26050839001: { poste: "1", nom: "Crédences" } };
    validations.traitees = {};
    validations.postes = { "1": { nom: "Crédences", nb: 1, dernier: new Date().toISOString() } };
    onglet = "suivi";
    afficher();
    const t = document.getElementById("pageSuivi").innerText;
    return { vide: t.trim().length < 50, bandeau: /re[çc]ue? en direct/i.test(t), poste: /Crédences/.test(t), reinit: /Réinitialiser/.test(t) };
  });
  verifier(!ecran.vide && ecran.bandeau && ecran.poste && ecran.reinit, `écran Suivi (lien branché) : bandeau + activité par poste + Réinitialiser, pas de page blanche`);

  await nav.close();
  console.log(echecs ? `${echecs} échec(s)` : "TOUT EST OK");
  process.exit(echecs ? 1 : 0);
})();
