// Lit une liste de coupe PDF avec le moteur de la page et affiche les enregistrements des clés demandées.
// Usage : node lire_coupe.js <page html> <pdf> <motif de clé>
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const [page_html, pdf, motif] = process.argv.slice(2);
  const nav = await chromium.launch();
  const page = await nav.newPage();
  await page.route("https://t.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(page_html), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://t.test/index.html");
  const octets = [...fs.readFileSync(pdf)];
  const res = await page.evaluate(async ({ octets, motif }) => {
    const f = new File([new Uint8Array(octets)], "x.pdf");
    const doc = await chargerDocumentPDF(f);
    const lignes = await extraireLignesTextePDF(doc);
    const records = extraireRecordsPDF(lignes);
    const re = new RegExp(motif);
    return {
      premieres: lignes.slice(0, 14),
      records: records.filter((r) => re.test(r.cle || "") || re.test(r.detailTexte || "")).map((r) => ({ ...r, detailTexte: (r.detailTexte || "").slice(0, 120) })),
      nb: records.length,
    };
  }, { octets, motif });
  console.log(JSON.stringify(res, null, 1));
  await nav.close();
})();
