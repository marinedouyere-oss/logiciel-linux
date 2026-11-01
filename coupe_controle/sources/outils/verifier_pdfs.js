// Pour chaque PDF : les lignes qui ressemblent à une en-tête de pièce (« 12. … ») mais que le lecteur ne reconnaît pas.
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const [page_html, ...pdfs] = process.argv.slice(2);
  const nav = await chromium.launch();
  const page = await nav.newPage();
  await page.route("https://t.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(page_html), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://t.test/index.html");
  for (const pdf of pdfs) {
    const octets = [...fs.readFileSync(pdf)];
    const res = await page.evaluate(async (octets) => {
      const doc = await chargerDocumentPDF(new File([new Uint8Array(octets)], "x.pdf"));
      const lignes = await extraireLignesTextePDF(doc);
      const ratees = lignes.filter((l) => /^\d+\.\s+\S/.test(l) && !MOTIF_ENTETE_PIECE_PDF.test(l));
      const records = extraireRecordsPDF(lignes);
      const reelles = records.filter((r) => !r.cle && estRecordPieceReellePDF(r)); return { ratees: ratees.slice(0, 8), nbRatees: ratees.length, nbRecords: records.length, piecesSansCle: reelles.length, exemples: reelles.slice(0, 4).map((r) => `${r.desc} ${r.materiau} ${r.qte} :: ${r.detailTexte.slice(0, 150)}`) };
    }, octets);
    console.log(pdf.split("/").slice(-2).join("/"), JSON.stringify(res));
  }
  await nav.close();
})();
