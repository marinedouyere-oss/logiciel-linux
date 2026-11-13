// Relève tous les champs « N.Libellé valeur » des listes de coupe PDF (import Cut Rite depuis le LAN).
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const [page_html, ...pdfs] = process.argv.slice(2);
  const nav = await chromium.launch();
  const page = await nav.newPage();
  await page.route("https://t.test/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(page_html), headers: { "content-type": "text/html; charset=utf-8" } }));
  await page.goto("https://t.test/index.html");
  const champs = {};
  for (const pdf of pdfs) {
    const octets = [...fs.readFileSync(pdf)];
    const res = await page.evaluate(async (octets) => {
      const doc = await chargerDocumentPDF(new File([new Uint8Array(octets)], "x.pdf"));
      const records = extraireRecordsPDF(await extraireLignesTextePDF(doc));
      const out = {};
      for (const r of records) {
        const t = " " + (r.detailTexte || "");
        const re = /(?:^|[\s,])(\d{1,2})\.([A-Za-zÀ-ÿ*+_][^,]*?)\s+([^,]*?)(?=,|$)/g;
        let m;
        while ((m = re.exec(t))) {
          const k = `${m[1].padStart(2, "0")}.${m[2].trim()}`;
          (out[k] = out[k] || []).push(m[3].trim());
        }
      }
      return out;
    }, octets);
    for (const [k, v] of Object.entries(res)) (champs[k] = champs[k] || []).push(...v);
  }
  for (const k of Object.keys(champs).sort()) {
    const c = {};
    for (const v of champs[k]) c[v] = (c[v] || 0) + 1;
    const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v, n]) => `${v.slice(0, 30)}×${n}`);
    console.log(`${k} (${champs[k].length}) : ${top.join(" | ")}`);
  }
  await nav.close();
})();
