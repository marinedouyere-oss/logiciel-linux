// Règles d'harmonisation des bandes, sur des cas simples (fonction harmoniserLargeurs de la page).
const fs = require("fs"), vm = require("vm");
const src = fs.readFileSync(process.argv[2], "utf8");
const debut = src.indexOf("const ECART_BANDE");
const fin = src.indexOf("// Corrections agglo : bandes (jaune)");
const code = src.slice(debut, src.indexOf("\n", debut) + 1) + src.slice(src.indexOf("const PIECES_PAR_BANDE"), fin);
const ctx = {};
vm.runInNewContext(code + "\nthis.h = harmoniserLargeurs; this.nb = nombreBandes;", ctx);
let echecs = 0;
const cas = (nom, pieces, attendu) => {
  const r = ctx.h(pieces.map(([largeur, longueur, qte]) => ({ largeur, longueur, qte: qte || 1 })));
  const ok = JSON.stringify(r) === JSON.stringify(attendu);
  if (!ok) echecs++;
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${nom} : ${pieces.map((p) => p[0]).join(", ")} → ${r.join(", ")}${ok ? "" : `  (attendu ${attendu.join(", ")})`}`);
};
cas("exemple atelier (553 trop longue pour la 535)", [[510, 820], [510, 581], [535, 2380], [553, 2000], [660, 1670], [810, 1410], [1130, 2060]], [535, 535, 535, 553, 660, 810, 1130]);
cas("tolérance 2 mm : 602 → 600", [[600, 1000], [602, 1000]], [600, 600]);
cas("trop longues ensemble (3000 + 3000) : rien ne bouge", [[500, 3000], [540, 3000]], [500, 540]);
cas("pièce seule à sa largeur, sans partenaire : rien ne bouge", [[500, 1000]], [500]);
cas("plus de 6 cm : rien ne bouge", [[500, 1000], [561, 1000]], [500, 561]);
cas("6 cm pile : se couplent", [[500, 1000], [560, 1000]], [560, 560]);
cas("quantité 2 (2 × 2100) + 1000 : la 500 rejoint la 540", [[500, 2100, 2], [540, 1000]], [540, 540]);
cas("pièce trop longue au milieu : laissée, les autres se couplent", [[500, 1000], [520, 3900], [540, 1000]], [540, 520, 540]);
cas("déjà même largeur : rien à faire", [[700, 1000], [700, 1000], [700, 1000]], [700, 700, 700]);
cas("4060 pile : se couplent", [[500, 2030], [530, 2030]], [530, 530]);
cas("4061 : ne se couplent pas", [[500, 2031], [530, 2030]], [500, 530]);
console.log("bandes 2380+820+581 :", ctx.nb([2380, 820, 581]), "| 2380+2000 :", ctx.nb([2380, 2000]), "| 4 courtes :", ctx.nb([500, 500, 500, 500]));
console.log(echecs ? `${echecs} ÉCHEC(S)` : "TOUT EST BON");
process.exit(echecs ? 1 : 0);
