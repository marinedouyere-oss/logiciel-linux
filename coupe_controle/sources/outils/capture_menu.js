const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const [site, sortie] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.route("https://sentinelle.test/**", (r) => {
    const f = path.join(site, decodeURIComponent(new URL(r.request().url()).pathname));
    return fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f), headers: { "content-type": "text/html; charset=utf-8" } }) : r.fulfill({ status: 404, body: "" });
  });
  await p.goto("https://sentinelle.test/index.html");
  await p.waitForTimeout(1200);
  await p.screenshot({ path: sortie, clip: { x: 0, y: 0, width: 720, height: 420 } });
  await b.close();
})();
