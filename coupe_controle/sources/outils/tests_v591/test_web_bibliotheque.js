// Test de la bibliothèque des semaines : ajout des semaines d'avant (dossier d'archives), scan de la semaine 46
// (la casse comparée à toute la bibliothèque), partage par un dossier « Drive » entre deux postes, retrait d'une semaine.
// Usage : node test_web_bibliotheque.js <dossier du site de test> <dossier captures>
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const site = process.argv[2];
const captures = process.argv[3];
const base = "https://sentinelle.test";
const echecs = [];
function verifier(condition, message) {
  if (!condition) echecs.push(message);
  console.log(`${condition ? "OK  " : "ÉCHEC"} ${message}`);
}
function lister(dossier, chemin = [], prefixe = []) {
  const res = [];
  for (const e of fs.readdirSync(path.join(dossier, ...chemin), { withFileTypes: true })) {
    if (e.isDirectory()) res.push(...lister(dossier, [...chemin, e.name], prefixe));
    else res.push({ chemin: [...prefixe, ...chemin], nom: e.name, url: path.relative(site, path.join(dossier, ...chemin, e.name)), date: 1792999133913 });
  }
  return res;
}

// Le « Drive » partagé : un dossier en mémoire côté Node, commun aux deux postes.
const drive = new Map(); // nom → { octets, lastModified }
let horloge = 1793000000000;

(async () => {
  const listes = {
    archives: [...lister(path.join(site, "s44"), [], ["10 - Octobre", "Semaine 44"]), ...lister(path.join(site, "s45"), [], ["10 - Octobre", "Semaine 45"])],
    s46: lister(path.join(site, "s46g", "Semaine 46")),
  };
  const nomsDossiers = { archives: "2026", s46: "Semaine 46" };
  const navigateur = await chromium.launch();

  async function poste(nom) {
    const contexte = await navigateur.newContext({ viewport: { width: 1100, height: 1000 }, acceptDownloads: true });
    await contexte.exposeFunction("__driveListe", () => [...drive.entries()].map(([n, f]) => ({ nom: n, lastModified: f.lastModified, size: f.octets.length })));
    await contexte.exposeFunction("__driveLire", (n) => (drive.has(n) ? drive.get(n).octets.toString("base64") : null));
    await contexte.exposeFunction("__driveEcrire", (n, b64) => {
      const f = { octets: Buffer.from(b64, "base64"), lastModified: (horloge += 1000) };
      drive.set(n, f);
      return { lastModified: f.lastModified, size: f.octets.length };
    });
    await contexte.addInitScript(({ listes, nomsDossiers }) => {
      const b64 = (octets) => {
        let s = "";
        for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode(...octets.subarray(i, i + 0x8000));
        return btoa(s);
      };
      const fichierDrive = (nom) => ({
        kind: "file",
        name: nom,
        async getFile() {
          const contenu = await window.__driveLire(nom);
          const infos = (await window.__driveListe()).find((f) => f.nom === nom);
          const octets = contenu ? Uint8Array.from(atob(contenu), (c) => c.charCodeAt(0)) : new Uint8Array(0);
          return new File([octets], nom, { lastModified: infos ? infos.lastModified : 0 });
        },
        async createWritable() {
          const morceaux = [];
          return {
            async write(d) { morceaux.push(new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer ? d : await new Blob([d]).arrayBuffer())); },
            async close() { await window.__driveEcrire(nom, b64(new Uint8Array(await new Blob(morceaux).arrayBuffer()))); },
          };
        },
      });
      const dossierDrive = {
        kind: "directory",
        name: "Bibliothèque Sentinelle",
        async queryPermission() { return "granted"; },
        async requestPermission() { return "granted"; },
        async *entries() { for (const f of await window.__driveListe()) yield [f.nom, fichierDrive(f.nom)]; },
        async getFileHandle(nom, options = {}) {
          if (!options.create && !(await window.__driveListe()).some((f) => f.nom === nom)) throw new DOMException("absent", "NotFoundError");
          return fichierDrive(nom);
        },
      };
      const dossierLecture = (cle, nom, chemin) => ({
        kind: "directory",
        name: nom,
        async queryPermission() { return "granted"; },
        async requestPermission() { return "granted"; },
        async *entries() {
          const sous = new Set();
          for (const f of listes[cle]) {
            if (f.chemin.length < chemin.length || chemin.some((c, i) => f.chemin[i] !== c)) continue;
            if (f.chemin.length > chemin.length) { sous.add(f.chemin[chemin.length]); continue; }
            yield [f.nom, { kind: "file", name: f.nom, async getFile() {
              const octets = await (await fetch(f.url.split("/").map(encodeURIComponent).join("/"), { cache: "no-store" })).arrayBuffer();
              return new File([octets], f.nom, { lastModified: f.date });
            } }];
          }
          for (const s of sous) yield [s, dossierLecture(cle, s, [...chemin, s])];
        },
      });
      window.showDirectoryPicker = async () => {
        const cle = window.__dossierSuivant;
        return cle === "drive" ? dossierDrive : dossierLecture(cle, nomsDossiers[cle], []);
      };
    }, { listes, nomsDossiers });
    const page = await contexte.newPage();
    page.on("pageerror", (e) => {
      console.log(`ERREUR JS (${nom}):`, e.message);
      echecs.push("erreur JS : " + e.message);
    });
    page.on("dialog", (d) => d.accept());
    await page.route(`${base}/**`, async (route) => {
      const relatif = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
      const fichier = path.join(site, relatif);
      if (!fichier.startsWith(site) || !fs.existsSync(fichier)) return route.fulfill({ status: 404, body: "" });
      const type = fichier.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";
      return route.fulfill({ status: 200, body: fs.readFileSync(fichier), headers: { "content-type": type } });
    });
    await page.goto(base + "/index.html");
    await page.waitForSelector("#btnChoisirDossier");
    return { contexte, page };
  }
  const choisir = (page, cle) => page.evaluate((c) => (window.__dossierSuivant = c), cle);
  const ongletBibliotheque = async (page) => {
    await page.click('.onglet-btn[data-onglet="bibliotheque"]');
    await page.waitForSelector("#pageBibliotheque .carte");
  };
  const semainesAffichees = (page) => page.$$eval("#pageBibliotheque table.bibliotheque tbody tr td:first-child strong", (e) => e.map((x) => x.textContent));
  const compteRendu = (page) => page.$eval("#pageBibliotheque .compte-rendu", (e) => e.innerText).catch(() => "");

  // ---- Poste A : dossier Drive, puis les semaines d'avant ----
  const A = await poste("A");
  await ongletBibliotheque(A.page);
  verifier((await A.page.innerText("#pageBibliotheque")).includes("Aucune semaine pour l'instant"), "A : bibliothèque vide au départ");
  await choisir(A.page, "drive");
  await A.page.click("#btnDossierBibliotheque");
  await A.page.waitForFunction(() => document.querySelector("#pageBibliotheque").innerText.includes("Fichier partagé à jour"), null, { timeout: 30000 });
  verifier((await A.page.innerText("#pageBibliotheque")).includes("Bibliothèque Sentinelle"), "A : dossier Drive choisi");
  await choisir(A.page, "archives");
  const debut = Date.now();
  await A.page.click("#btnImporterSemaines");
  await A.page.waitForFunction(() => /lancement\(s\) ajouté\(s\)|Ajout impossible|Aucun fichier/.test(document.querySelector("#pageBibliotheque").innerText), null, { timeout: 300000 });
  console.log(`Ajout des semaines : ${((Date.now() - debut) / 1000).toFixed(1)} s`);
  const crImport = await compteRendu(A.page);
  console.log(crImport);
  verifier(/✔ \d+ lancement\(s\) ajouté\(s\)/.test(crImport), "A : semaines d'avant ajoutées");
  verifier(!/LAN26/.test(crImport.split("Pas lus")[1] || ""), "A : tous les fichiers LAN… lus");
  const semainesA = await semainesAffichees(A.page);
  console.log("SEMAINES A", semainesA);
  verifier(semainesA.includes("Semaine 44") && semainesA.includes("Semaine 45"), "A : semaines 44 et 45 dans la bibliothèque");
  const partage = () => JSON.parse(zlib.gunzipSync(drive.get("sentinelle_partage.json.gz").octets).toString("utf8"));
  verifier([...drive.keys()].join() === "sentinelle_partage.json.gz", "Drive : un seul fichier partagé");
  const p1 = partage();
  const s45 = p1.semaines.find((s) => s.id === "2026-45");
  console.log("S45 :", s45.lancements.map((l) => `${l.nom} (${l.poste}, ${l.pieces.length} pièces)`).join(" · "));
  verifier(p1.format === "sentinelle-partage-1" && p1.colonnesPieces[0] === "cle" && p1.explications["Lancée deux fois"], "fichier partagé : format lisible (colonnes, explications)");
  verifier(s45.lancements.some((l) => l.nom === "LAN264501STRAT" && l.pieces.length > 100), "Drive : pièces du lancement LAN264501STRAT");
  verifier(s45.lancements.some((l) => l.nom === "LAN2644CASSE" && l.casse), "Drive : la casse 44 rangée en semaine 45");
  await A.page.screenshot({ path: `${captures}/web_bibliotheque_A.png`, fullPage: true });

  // ---- Poste A : scan de la semaine 46, la casse est comparée à la bibliothèque ----
  await A.page.click('.onglet-btn[data-onglet="paire"]');
  await choisir(A.page, "s46");
  await A.page.click("#btnChoisirDossier");
  await A.page.waitForSelector("#btnScanner:not([disabled])");
  await A.page.click("#btnScanner");
  await A.page.waitForFunction(() => document.querySelector("#btnScanner").disabled, null, { timeout: 5000 }).catch(() => {});
  await A.page.waitForFunction(() => !document.querySelector("#btnScanner").disabled, null, { timeout: 600000 });
  await A.page.waitForTimeout(2000);
  const crScan = await A.page.innerText("#carteDossier");
  console.log(crScan);
  verifier(/📚 \d+ lancement\(s\) gardé\(s\) dans la bibliothèque \(semaine 46\) et dans le fichier partagé/.test(crScan), "scan : semaine 46 gardée dans la bibliothèque et dans le fichier partagé");
  const s46 = partage().semaines.find((s) => s.id === "2026-46");
  verifier(Boolean(s46), "fichier partagé : semaine 46");
  verifier(s46 && s46.lancements.every((l) => l.controle && Array.isArray(l.controle.bilan) && l.controle.bilan.length), "fichier partagé : bilan des contrôles de chaque lancement");
  const deuxieme = s46 && s46.lancements.find((l) => l.nom === "LAN264602START");
  console.log("2ème tour :", JSON.stringify(deuxieme && deuxieme.recap), deuxieme && deuxieme.problemes.length, "problèmes");
  verifier(deuxieme && deuxieme.recap.prevues === 340 && deuxieme.recap.controle === 1, "fichier partagé : tableau des lancements (prévues, contrôle)");
  verifier(deuxieme && deuxieme.problemes.some((x) => x.niveau === "corriger" && x.cle && x.type), "fichier partagé : problèmes pièce par pièce");
  fs.writeFileSync(path.join(captures, "sentinelle_partage.json.gz"), drive.get("sentinelle_partage.json.gz").octets);
  await A.page.waitForFunction(() => {
    const z = [...document.querySelectorAll(".carte-paire")].find((c) => c.innerText.includes("LAN2646CASSE.xlsx"));
    return z && z.querySelector(".zone-casse") && !/^\s*…\s*$/.test(z.querySelector(".zone-casse").innerText) && z.querySelector(".zone-casse").innerText.trim();
  }, null, { timeout: 60000 });
  const casse = await A.page.$$eval(".carte-paire", (cs) => cs.find((c) => c.innerText.includes("LAN2646CASSE.xlsx")).querySelector(".zone-casse").innerText);
  console.log("CASSE :", casse);
  verifier(!/chargez la semaine/.test(casse), "casse 46 : comparée à la bibliothèque (plus besoin de l'autre onglet)");
  verifier(/déjà lancée\(s\) en semaine|aucune pièce n'était lancée/.test(casse), "casse 46 : relancées / rajouts calculés");
  await A.page.screenshot({ path: `${captures}/web_bibliotheque_scan.png`, fullPage: true });

  // ---- Poste B : une autre machine, même dossier Drive ----
  const B = await poste("B");
  await ongletBibliotheque(B.page);
  await choisir(B.page, "drive");
  await B.page.click("#btnDossierBibliotheque");
  await B.page.waitForFunction(() => document.querySelector("#pageBibliotheque").innerText.includes("Fichier partagé à jour"), null, { timeout: 60000 });
  console.log(await compteRendu(B.page));
  const semainesB = await semainesAffichees(B.page);
  await ongletBibliotheque(A.page);
  const semainesA2 = await semainesAffichees(A.page);
  console.log("SEMAINES B", semainesB, "A", semainesA2);
  verifier(semainesB.length > 0 && JSON.stringify(semainesB) === JSON.stringify(semainesA2), "B : reçoit toute la bibliothèque de A");
  verifier(semainesB.includes("Semaine 46"), "B : la semaine 46 scannée sur A");

  // B retire la semaine 44 ; A le voit à sa synchronisation.
  const ligne44 = B.page.locator("#pageBibliotheque tr", { hasText: "Semaine 44" });
  await ligne44.locator("[data-retirer]").click();
  await B.page.click("#modaleConfirmationOk");
  await B.page.waitForFunction(() => !document.querySelector("#pageBibliotheque").innerText.includes("Semaine 44"), null, { timeout: 30000 });
  verifier(!(await semainesAffichees(B.page)).includes("Semaine 44"), "B : semaine 44 retirée");
  await A.page.click("#btnSynchroniser");
  await A.page.waitForFunction(() => !document.querySelector("#pageBibliotheque").innerText.includes("Semaine 44"), null, { timeout: 30000 }).catch(() => {});
  verifier(!(await semainesAffichees(A.page)).includes("Semaine 44"), "A : le retrait de la semaine 44 arrive par le fichier partagé");
  verifier(!partage().semaines.some((s) => s.id === "2026-44" && s.lancements.length), "fichier partagé : semaine 44 retirée");

  // A, rechargé : la bibliothèque est gardée dans le navigateur.
  await A.page.reload();
  await A.page.waitForSelector("#btnChoisirDossier");
  await ongletBibliotheque(A.page);
  const apres = await semainesAffichees(A.page);
  verifier(apres.length === semainesA2.length - 1 && apres.includes("Semaine 46"), "A : bibliothèque retrouvée après rechargement");
  await A.page.screenshot({ path: `${captures}/web_bibliotheque_fin.png`, fullPage: true });

  await navigateur.close();
  console.log(echecs.length ? `${echecs.length} ÉCHEC(S)` : "TOUT EST OK");
  process.exit(echecs.length ? 1 : 0);
})();
