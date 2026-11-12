// V6.5.6 : contrôle « Sentinelle = Diakonos » sur une vraie extraction (donnée client, hors dépôt).
// Chaque pièce « en cours » de l'extraction (production, et toute pièce d'un lancement de coupe quel que soit son
// catalogue : ex. du Dibond dans un lancement chantier) doit être comptée « à faire » pour la même quantité, et les
// vues doivent donner les mêmes nombres que Diakonos : transporteur × semaine de livraison, semaine, coloris × semaine,
// et le tableau « comme dans Excel » le même total que l'extraction. Noms de transporteurs : ceux de Diakonos.
// Usage : node test_web_suivi_diakonos.js <index.html> <suivi_production_JJMMAAAA.xlsx[+autre.xlsx…]> <dossier « Semaine NN »>...
// (plusieurs extractions séparées par « + » : chargées ensemble, la plus récente fait foi)
// (les lancements LAN*.xlsx des dossiers sont mis dans la bibliothèque, comme un scan).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [pageHtml, extraction, ...dossiers] = process.argv.slice(2);
let echecs = 0;
const verifier = (ok, t) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`);
  if (!ok) echecs++;
};
const posteDe = (chemin) => {
  const n = chemin.toUpperCase();
  if (/CASSE/.test(n)) return "Casse";
  if (/RECYCLAGE/.test(n)) return "Recyclage";
  if (/FENO/.test(n)) return "Feno";
  if (/2EME|02(START|STRAT)/.test(n)) return "Agglo 2ème tour";
  if (/1ER|01(START|STRAT)/.test(n)) return "Agglo 1er tour";
  return "Chantiers";
};
const lister = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const c = path.join(d, e.name);
    if (e.isDirectory()) return lister(c);
    return /^LAN.*\.xlsx$/i.test(e.name) && !/DIAKONOS/i.test(e.name) && !e.name.startsWith("~$") ? [c] : [];
  });

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
  // Les lancements (un seul par nom : le dernier dossier gagne, comme un nouveau scan).
  const parNom = new Map();
  for (const d of dossiers) for (const f of lister(d)) parNom.set(path.basename(f).toUpperCase(), { f, semaineDossier: (/Semaine\s*(\d+)/i.exec(d) || [])[1] || null });
  const liste = [...parNom.values()].map(({ f, semaineDossier }) => ({ b64: fs.readFileSync(f).toString("base64"), nom: path.basename(f), poste: posteDe(f), semaineDossier }));
  const n = await page.evaluate(async (liste) => {
    const items = [];
    for (const x of liste) {
      try {
        const fichier = new File([Uint8Array.from(atob(x.b64), (c) => c.charCodeAt(0))], x.nom);
        const strat = await stratEnCache(fichier);
        const casse = x.poste === "Casse";
        const sem = semaineDuLancement(strat.lignes, casse, x.nom, x.semaineDossier, strat.semaines);
        if (!sem) continue;
        items.push({ annee: sem.annee, semaine: sem.semaine, lancement: ficheLancementBibliotheque(x.nom, strat, { poste: x.poste, casse }) });
      } catch (_e) {
        // lancement illisible
      }
    }
    await archiverLancements(items);
    return items.length;
  }, liste);
  console.log(`${n} lancements mis dans la bibliothèque`);
  await page.evaluate(
    async (liste) => SUIVI.chargerFichiers(liste.map(([d, nom]) => new File([Uint8Array.from(atob(d), (c) => c.charCodeAt(0))], nom, { lastModified: Date.now() }))),
    extraction.split("+").map((f) => [fs.readFileSync(f).toString("base64"), path.basename(f)])
  );
  const res = await page.evaluate(() => {
    const r = SUIVI.calculer();
    const der = SUIVI.etat.extractions[SUIVI.etat.extractions.length - 1];
    const perim = (c) => (/r[ée]sine/i.test(c) ? "resine" : /fourniture|dibond/i.test(c) ? "fournitures" : "production");
    const affiches = new Set(r.semaines.map((s) => s.id));
    const dansLancement = new Set(SUIVI.etat.lancementsCalcul.filter((L) => !L.hors).flatMap((L) => [...L.pieces.keys()]));
    const suivie = (k, r0) => perim(r0[4]) === "production" || dansLancement.has(k);
    const compte = new Map();
    for (const L of SUIVI.etat.lancementsCalcul) {
      if (!L.detail || !affiches.has(L.id)) continue;
      for (const [k, [, rk]] of L.detail) compte.set(k, (compte.get(k) || 0) + rk);
    }
    let attendu = 0;
    const ecarts = [];
    for (const [k, v] of der.parCle) {
      const r0 = v.lignes[0];
      if (!suivie(k, r0) || v.cours <= 0) continue;
      attendu += v.cours;
      if ((compte.get(k) || 0) !== v.cours) ecarts.push(`${k} cours=${v.cours} compté=${compte.get(k) || 0}`);
    }
    const comparer = (vue, cleDiak) => {
      const d = new Map();
      for (const [k, v] of der.parCle) {
        const r0 = v.lignes[0];
        if (!suivie(k, r0) || v.cours <= 0) continue;
        d.set(cleDiak(r0), (d.get(cleDiak(r0)) || 0) + v.cours);
      }
      const s = new Map();
      for (const g of r.vues[vue] || []) {
        if (vue === "semaine") {
          if (g[2] > 0) s.set(g[0].replace("Semaine ", "S"), g[2]);
        } else for (const x of g[4]) if (x[2] > 0) s.set(`${g[0]}|${x[0].replace("Semaine ", "S")}`, x[2]);
      }
      const e = [];
      for (const c of new Set([...d.keys(), ...s.keys()])) if ((d.get(c) || 0) !== (s.get(c) || 0)) e.push(`${c} Diakonos=${d.get(c) || 0} Sentinelle=${s.get(c) || 0}`);
      return { cases: d.size, e };
    };
    const totTab = r.tableau.lignes.reduce((t, l) => t + (Number(l[l.length - 1]) || 0), 0);
    let totEx = 0;
    for (const x of der.lignes) totEx += Math.max(0, x[6]);
    const nomsDiak = new Set([...der.parCle.values()].filter((v) => perim(v.lignes[0][4]) === "production").map((v) => v.lignes[0][7]));
    const nomsSent = (r.vues.transporteur || []).map((g) => g[0]).filter((t) => t !== "Transporteur inconnu");
    return {
      jour: der.jour, attendu, restantes: r.totaux.restantes, ecarts: ecarts.slice(0, 10), nbEcarts: ecarts.length,
      ts: comparer("transporteur", (r0) => `${r0[7]}|S${r0[0]}`), sem: comparer("semaine", (r0) => `S${r0[0]}`), col: comparer("coloris", (r0) => `${r0[10] || "Sans coloris"}|S${r0[0]}`),
      tableau: [Math.round(totTab * 1000) / 1000, Math.round(totEx * 1000) / 1000], nomsInconnus: nomsSent.filter((t) => !nomsDiak.has(t)),
    };
  });
  console.log(`Extraction du ${res.jour}`);
  verifier(res.nbEcarts === 0 && res.restantes === res.attendu, `pièce par pièce : ${res.restantes} à faire = ${res.attendu} « Qte en cours » de Diakonos${res.nbEcarts ? ` — écarts : ${res.ecarts.join(" ; ")}` : ""}`);
  verifier(res.ts.e.length === 0, `transporteur × semaine de livraison : ${res.ts.cases} cases identiques à Diakonos${res.ts.e.length ? ` — ${res.ts.e.slice(0, 5).join(" ; ")}` : ""}`);
  verifier(res.sem.e.length === 0, `semaine de livraison : ${res.sem.cases} cases identiques${res.sem.e.length ? ` — ${res.sem.e.slice(0, 5).join(" ; ")}` : ""}`);
  verifier(res.col.e.length === 0, `coloris × semaine : ${res.col.cases} cases identiques${res.col.e.length ? ` — ${res.col.e.slice(0, 5).join(" ; ")}` : ""}`);
  verifier(Math.abs(res.tableau[0] - res.tableau[1]) < 0.01, `tableau « comme dans Excel » : total ${res.tableau[0]} = extraction ${res.tableau[1]}`);
  verifier(res.nomsInconnus.length === 0, `transporteurs : les noms de Diakonos${res.nomsInconnus.length ? ` — hors Diakonos : ${res.nomsInconnus.join(", ")}` : ""}`);
  await nav.close();
  console.log(echecs ? `${echecs} échec(s)` : "TOUT EST OK");
  process.exit(echecs ? 1 : 0);
})();
