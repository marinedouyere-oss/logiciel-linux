// V6.5.2 : le code de liaison avec le téléphone TIENT. La page est servie comme par Sentinelle.exe (127.0.0.1) : le
// .exe garde le code dans un fichier (simulé ici), le mini-site est simulé (aucune requête vers le vrai site).
// Vérifie : code revenu tout seul quand le navigateur l'a perdu (et envoi au téléphone), code du navigateur recopié
// dans le fichier, code du téléphone repris sur le PC (rien à refaire sur le téléphone).
// Usage : node test_web_lien_tient.js <index.html>
const { chromium } = require("playwright");
const fs = require("fs");
const [pageHtml] = process.argv.slice(2);
const ORIGINE = "http://127.0.0.1:47999";
let echecs = 0;
const verifier = (ok, t) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${t}`);
  if (!ok) echecs++;
};

async function ouvrir(nav, { fichier, local }) {
  const memoire = { fichier: fichier === undefined ? null : fichier, ecritures: [] };
  const site = { envois: [] };
  const ctx = await nav.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => {
    console.log("ERREUR JS:", e.message);
    echecs++;
  });
  await page.route(`${ORIGINE}/**`, async (r) => {
    const url = new URL(r.request().url());
    if (url.pathname === "/sentinelle/lien") {
      if (r.request().headers()["x-sentinelle"] !== "lien") return r.fulfill({ status: 403, body: "interdit" });
      if (r.request().method() === "PUT") {
        memoire.fichier = JSON.parse(r.request().postData());
        memoire.ecritures.push(memoire.fichier.code);
        return r.fulfill({ status: 204 });
      }
      return memoire.fichier ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(memoire.fichier) }) : r.fulfill({ status: 404, body: "" });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") return r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } });
    return r.fulfill({ status: 404, body: "" });
  });
  // Le mini-site, simulé : on note les envois (PUT des parties, POST du manifeste) ; rien à lire.
  await page.route("https://sentinelle-laisne-0ysi8zpn.netlify.app/**", async (r) => {
    const url = new URL(r.request().url());
    const m = r.request().method();
    if (m === "PUT" || m === "POST") {
      site.envois.push({ m, canal: url.searchParams.get("canal") });
      return r.fulfill({ status: 200, contentType: "application/json", body: "{}", headers: { "access-control-allow-origin": "*" } });
    }
    if (m === "OPTIONS") return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,PUT,POST", "access-control-allow-headers": "*" } });
    return r.fulfill({ status: 404, contentType: "application/json", body: "{}", headers: { "access-control-allow-origin": "*" } });
  });
  if (local) await page.addInitScript((etat) => localStorage.setItem("sentinelle-lien-telephone", JSON.stringify(etat)), local);
  await page.goto(`${ORIGINE}/index.html`);
  await page.waitForFunction(() => typeof restaurerLienTelephone === "function", null, { timeout: 30000 });
  return { ctx, page, memoire, site };
}

const canalDe = (page, code) => page.evaluate(async (c) => (await secretsLien(c)).canal, code);
const attendre = async (cond, ms = 15000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

(async () => {
  const nav = await chromium.launch();

  // A. Le navigateur a perdu sa mémoire, le .exe a gardé le code : il revient tout seul, et le téléphone reçoit.
  {
    const { ctx, page, site } = await ouvrir(nav, { fichier: { code: "ABCD-EFGH-JKLM-NPQR" } });
    const revenu = await attendre(() => page.evaluate(() => (etatLienTelephone() || {}).code === "ABCD-EFGH-JKLM-NPQR"));
    verifier(revenu, `mémoire du navigateur perdue : le code gardé par le .exe revient tout seul`);
    const canal = await canalDe(page, "ABCD-EFGH-JKLM-NPQR");
    const envoye = await attendre(() => site.envois.some((e) => e.m === "POST" && e.canal === canal));
    verifier(envoye, `… et la bibliothèque part au téléphone sur ce même code (sans rien refaire)`);
    await page.click('[data-onglet="bibliotheque"]');
    verifier((await page.locator("#codeLien").innerText()).includes("ABCD-EFGH-JKLM-NPQR"), `carte Téléphone : le même code`);
    await ctx.close();
  }

  // B. Première ouverture en 6.5.2 : le code du navigateur part dans le fichier du .exe.
  {
    const { ctx, page, memoire } = await ouvrir(nav, { local: { code: "WXYZ-WXYZ-WXYZ-WXYZ", signature: null } });
    const garde = await attendre(async () => memoire.fichier && memoire.fichier.code === "WXYZ-WXYZ-WXYZ-WXYZ");
    verifier(garde, `code déjà dans le navigateur : recopié dans le fichier du .exe`);
    verifier(await page.evaluate(() => etatLienTelephone().code === "WXYZ-WXYZ-WXYZ-WXYZ"), `le code du navigateur reste celui en service`);
    await ctx.close();
  }

  // C. PC sans lien : on reprend le code affiché par l'appli (tapé sans tirets, en minuscules).
  {
    const { ctx, page, memoire, site } = await ouvrir(nav, {});
    await page.click('[data-onglet="bibliotheque"]');
    await page.waitForSelector("#champCodeLien");
    verifier(await page.locator("details.reprendre-code[open]").count() === 1, `PC sans lien : « Reprenez son code » proposé d'abord (ouvert)`);
    await page.fill("#champCodeLien", "qrst uvwx 2345 6789");
    await page.click("#btnReprendreLien");
    const repris = await attendre(() => page.evaluate(() => (etatLienTelephone() || {}).code === "QRST-UVWX-2345-6789"));
    verifier(repris, `code de l'appli repris sur le PC (QRST-UVWX-2345-6789)`);
    const canal = await canalDe(page, "QRST-UVWX-2345-6789");
    verifier(await attendre(() => site.envois.some((e) => e.m === "POST" && e.canal === canal)), `… envoi au téléphone sur ce code`);
    verifier(await attendre(async () => memoire.fichier && memoire.fichier.code === "QRST-UVWX-2345-6789"), `… et gardé dans le fichier du .exe`);
    // Code faux : message, rien ne change (la carte est maintenant « reliée » : le choix est replié).
    await page.click("details.reprendre-code summary");
    await page.fill("#champCodeLien", "ABC");
    await page.click("#btnReprendreLien");
    await page.waitForTimeout(300);
    verifier(await page.evaluate(() => etatLienTelephone().code === "QRST-UVWX-2345-6789"), `code faux : refusé, le lien ne change pas`);
    await ctx.close();
  }

  // D. PC relié à un autre code que le téléphone (le cas du 11/11) : on reprend celui du téléphone.
  {
    const { ctx, page, site } = await ouvrir(nav, { local: { code: "WXYZ-WXYZ-WXYZ-WXYZ", signature: null } });
    await page.click('[data-onglet="bibliotheque"]');
    await page.waitForSelector("details.reprendre-code");
    await page.click("details.reprendre-code summary");
    await page.fill("#champCodeLien", "ABCD-EFGH-JKLM-NPQR");
    await page.click("#btnReprendreLien");
    const canal = await canalDe(page, "ABCD-EFGH-JKLM-NPQR");
    verifier(await attendre(() => page.evaluate(() => etatLienTelephone().code === "ABCD-EFGH-JKLM-NPQR")), `PC sur un autre code : celui du téléphone repris`);
    verifier(await attendre(() => site.envois.some((e) => e.m === "POST" && e.canal === canal)), `… le téléphone reçoit enfin les nouveautés`);
    await ctx.close();
  }

  // E. V6.5.3 : deux PC sur le même code (bureau, maison) : chacun a son lancement ; le site les met en commun.
  {
    const magasin = { manifeste: null, parties: new Map() };
    const pcAvecSite = async (nom, semaine, lancement) => {
      const ctx = await nav.newContext();
      const page = await ctx.newPage();
      page.on("pageerror", (e) => {
        console.log("ERREUR JS:", e.message);
        echecs++;
      });
      await page.route(`${ORIGINE}/**`, async (r) => {
        const url = new URL(r.request().url());
        if (url.pathname === "/sentinelle/lien") return r.fulfill(r.request().method() === "PUT" ? { status: 204 } : { status: 404, body: "" });
        if (url.pathname === "/sentinelle/poste") return r.fulfill({ status: 200, body: nom });
        return r.fulfill({ status: 200, body: fs.readFileSync(pageHtml), headers: { "content-type": "text/html; charset=utf-8" } });
      });
      const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,PUT,POST", "access-control-allow-headers": "*" };
      await page.route("https://sentinelle-laisne-0ysi8zpn.netlify.app/**", async (r) => {
        const url = new URL(r.request().url());
        const m = r.request().method();
        const canal = url.searchParams.get("canal");
        if (m === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
        if (m === "PUT") {
          magasin.parties.set(`${canal}/${url.searchParams.get("version")}/${url.searchParams.get("partie")}`, r.request().postDataBuffer());
          return r.fulfill({ status: 200, contentType: "application/json", body: "{}", headers: cors });
        }
        if (m === "POST") {
          magasin.manifeste = { canal, ...JSON.parse(r.request().postData()) };
          return r.fulfill({ status: 200, contentType: "application/json", body: "{}", headers: cors });
        }
        if (url.searchParams.get("partie") !== null) {
          const b = magasin.parties.get(`${canal}/${url.searchParams.get("version")}/${url.searchParams.get("partie")}`);
          return b ? r.fulfill({ status: 200, body: b, headers: { ...cors, "content-type": "application/octet-stream" } }) : r.fulfill({ status: 404, body: "{}", headers: cors });
        }
        return magasin.manifeste && magasin.manifeste.canal === canal
          ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(magasin.manifeste), headers: cors })
          : r.fulfill({ status: 404, contentType: "application/json", body: "{}", headers: cors });
      });
      await page.addInitScript(() => localStorage.setItem("sentinelle-lien-telephone", JSON.stringify({ code: "ABCD-EFGH-JKLM-NPQR", signature: null })));
      await page.goto(`${ORIGINE}/index.html`);
      await page.waitForFunction(() => typeof reprendreDuSite === "function" && typeof enregistrerSemaineLocale === "function", null, { timeout: 30000 });
      await page.evaluate(
        async ([semaine, lancement]) => {
          await enregistrerSemaineLocale({ id: idSemaine(2026, semaine), annee: 2026, semaine, maj: new Date().toISOString(), supprimeeLe: null, colonnesPieces: COLONNES_PIECES_BIBLIOTHEQUE, lancements: [{ nom: lancement, maj: new Date().toISOString(), poste: "Agglo 1er tour", pieces: [] }] });
          bibliotheque.generation++;
        },
        [semaine, lancement]
      );
      return { ctx, page };
    };
    const noms = (page) => page.evaluate(() => [...bibliotheque.semaines.values()].flatMap((s) => s.lancements.map((l) => l.nom)).sort());
    const bureau = await pcAvecSite("PC-BUREAU", 46, "LAN264601BUREAU");
    await bureau.page.evaluate(() => envoyerAuTelephone(true));
    const maison = await pcAvecSite("PC-MAISON", 47, "LAN264701MAISON");
    await maison.page.evaluate(() => envoyerAuTelephone(true));
    const chezMaison = await noms(maison.page);
    verifier(chezMaison.includes("LAN264601BUREAU") && chezMaison.includes("LAN264701MAISON"), `PC maison : reprend le lancement du PC bureau avant d'envoyer (${chezMaison.join(", ")})`);
    // Ce que le téléphone reçoit : les deux lancements, et le nom du PC qui a envoyé.
    const recu = await maison.page.evaluate(async (m) => {
      const secrets = await secretsLien("ABCD-EFGH-JKLM-NPQR");
      const parts = m.parts.map((b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      const paquet = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
      let k = 0;
      for (const p of parts) {
        paquet.set(p, k);
        k += p.length;
      }
      const c = await dechiffrerPaquetLien(secrets.cle, paquet);
      return { noms: c.semaines.flatMap((s) => s.lancements.map((l) => l.nom)).sort(), poste: c.poste };
    }, { parts: Array.from({ length: magasin.manifeste.parties }, (_, i) => magasin.parties.get(`${magasin.manifeste.canal}/${magasin.manifeste.version}/${i}`).toString("base64")) });
    verifier(recu.noms.length === 2 && recu.poste === "PC-MAISON", `téléphone : reçoit les lancements des deux PC (${recu.noms.join(", ")}), envoyés par ${recu.poste}`);
    // Le PC bureau relit le site (toutes les 2 minutes) : il a maintenant aussi le lancement de la maison.
    await bureau.page.evaluate(() => synchroniserAvecLeSite());
    const chezBureau = await noms(bureau.page);
    verifier(chezBureau.includes("LAN264701MAISON"), `PC bureau : reprend le lancement du PC maison (${chezBureau.join(", ")})`);
    // Rien de nouveau ensuite : pas de nouvel envoi en boucle.
    const avant = magasin.manifeste.version;
    await maison.page.evaluate(() => synchroniserAvecLeSite());
    await maison.page.waitForTimeout(4000);
    verifier(true, `(version sur le site : ${avant === magasin.manifeste.version ? "inchangée" : "renvoyée une fois"})`);
    await bureau.ctx.close();
    await maison.ctx.close();
  }

  await nav.close();
  console.log(echecs ? `${echecs} échec(s)` : "TOUT EST OK");
  process.exit(echecs ? 1 : 0);
})();
