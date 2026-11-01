// Bandes (grain matching) d'une liste de coupe : largeur de débit Cut Rite des pièces de chaque bande, et largeur finie.
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const [page_html, pdf] = process.argv.slice(2);
  const nav = await chromium.launch();
  const page = await nav.newPage();
  await page.route("https://t.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(page_html), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://t.test/index.html");
  const res = await page.evaluate(async (octets) => {
    const doc = await chargerDocumentPDF(new File([new Uint8Array(octets)], "x.pdf"));
    const lignes = await extraireLignesTextePDF(doc);
    const pieces = [];
    let cour = null;
    for (const l of lignes) {
      const m = /^(\d+)\.\s*(\S+)\s+(?:(\S+)\s+)?(\d+[.,]\d+)\s+(\d+[.,]\d+)\s+(\d+)\b/.exec(l);
      if (m) { cour = { desc: m[2], mat: m[3], L: parseFloat(m[4]), W: parseFloat(m[5]), q: +m[6], t: "" }; pieces.push(cour); continue; }
      if (cour) cour.t += " " + l;
    }
    const out = [];
    for (const p of pieces) {
      const g = /18\.Grain matching (T\d+):(\d+):(\d+)/.exec(p.t);
      const fini = /52\.L\*l\*ep fini (\d+) X (\d+)/.exec(p.t);
      const erp = /51\.L\*l debit (\d+) X (\d+)/.exec(p.t);
      const cle = /5\.num commande\+ligne (\S+?)[,\s]/.exec(p.t);
      if (g) out.push({ bande: g[1], pos: `${g[2]}:${g[3]}`, desc: p.desc, mat: p.mat, L: p.L, W: p.W, fini: fini ? `${fini[1]}x${fini[2]}` : "", erp: erp ? `${erp[1]}x${erp[2]}` : "", cle: cle ? cle[1] : "" });
    }
    return out;
  }, [...fs.readFileSync(pdf)]);
  const parBande = {};
  for (const r of res) (parBande[r.bande] = parBande[r.bande] || []).push(r);
  for (const [b, rs] of Object.entries(parBande).slice(0, 14)) {
    console.log(`${b} (${rs[0].mat}) : ` + rs.map((r) => `${r.desc} fini ${r.fini} ERP ${r.erp} CutRite ${r.L}x${r.W}`).join(" | "));
  }
  const memeLargeur = Object.values(parBande).filter((rs) => new Set(rs.map((r) => r.W)).size === 1).length;
  console.log(`\n${Object.keys(parBande).length} bandes ; ${memeLargeur} avec une seule largeur Cut Rite`);
  await nav.close();
})();
