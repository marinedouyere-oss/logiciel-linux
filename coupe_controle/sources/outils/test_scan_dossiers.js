// Test du scan par sous-dossiers avec les noms du dossier « Semaine 46 » du Drive.
const fs = require("fs");
const d = process.argv[2];
const code = ["01_moteur.js", "04b_scan.js", "04c_diakonos.js"].map((f) => fs.readFileSync(d + "/" + f, "utf8")).join("\n");
const ctx = {};
new Function("ctx", code + "\nctx.repartir = repartirFichiersDossier;")(ctx);
const arbo = {
  "": ["FOURNITURE CHANT s46.xlsx"],
  "1ER TOUR AGGLO": ["LAN264601START.xlsx", "LAN264601STARTDIAKONOS.xlsx", "liste de coupe LAN264601START.pdf", "LAN264601START backup.bkp",
    "SOMMAIRE LAN264601START.pdf", "LAN264601RECYCLAGE.xlsx", "LAN264601RECYCLAGE backup.bkp"],
  "2EME TOUR AGGLO": ["LAN264602START.xlsx", "LAN264602STARTDIAKONOS.xlsx", "liste de coupe LAN264602START.pdf", "LAN264602START 2backup.bkp",
    "SOMMAIRE LAN264602STRAT.pdf"],
  FENO: ["LAN264601FENO.xlsx", "LAN264601FENOBIS.xlsx", "LAN264601FENODIAKONOS.xlsx", "liste de coupe LAN264601FENO.pdf", "LAN264601FENObackup.bkp",
    "SOMMAIRE LAN264601FENO.pdf", "S.46.xlsx", "LISTE DE COUPE LAN264601RETARD6087.pdf", "SOMMAIRE LAN264601RETARD6087.pdf", "LAN264601RETARD6087 backup.bkp"],
  CASSE: ["LAN2646CASSE.xlsx", "LAN2646CASSE-DIAKONOS.xlsx", "liste de coupe LAN264601CASSE.pdf", "LAN2646CASSE backup.bkp", "SOMMAIRE LAN2646CASSE.pdf"],
  AIRDESIGN: ["LAN2646AIRDESIGN.xlsx", "LAN2646AIRDESIGN backup.bkp", "SOMMAIRE LAN2646 AIRDESIGN.pdf", "liste de coupe LAN264601AIRDESIGN.pdf"],
};
const fichiers = [];
for (const [dossier, noms] of Object.entries(arbo)) for (const nom of noms) fichiers.push({ nom, date: 1, chemin: dossier ? [dossier] : [] });
const r = ctx.repartir(fichiers, "paire", "Semaine 46");
const n = (f) => (f ? f.nom : "—");
for (const g of [...r.fixes, ...r.supplements, ...r.chantiers]) {
  console.log(`${(g.poste + (g.supplement ? " +" : "")).padEnd(16)} [${g.dossier}] ${n(g.strat)} | coupe ${n(g.coupe)} | bkp ${n(g.bkp)} | sommaire ${n(g.sommaire)} | diakonos ${n(g.diakonos)} | ${g.parite}`);
}
console.log("non reconnus :", r.nonReconnus.join(", "), "| autre semaine :", r.ignoresAutreSemaine, "| diakonos tours :", r.diakonos.length);
console.log("sans lancement :", r.sansLancement.join(", "));
// Vérifications : le second lancement du dossier FENO a sa case Feno (« Feno 2 »), pas un chantier ; les fichiers
// d'un lancement absent (RETARD6087) sont signalés, pas pris pour ceux du Feno ; un nom de code différent est rattaché.
let echecs = 0;
const verifier = (ok, message) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${message}`);
  if (!ok) echecs++;
};
const feno = r.fixes.find((g) => g.poste === "Feno");
const bis = r.supplements.find((g) => g.strat && g.strat.nom === "LAN264601FENOBIS.xlsx");
verifier(feno && feno.strat.nom === "LAN264601FENO.xlsx" && feno.coupe.nom === "liste de coupe LAN264601FENO.pdf" && feno.sommaire.nom === "SOMMAIRE LAN264601FENO.pdf",
  "Feno : son lancement, sa liste de coupe et son sommaire");
verifier(bis && bis.poste === "Feno" && !r.chantiers.some((g) => g.strat.nom === "LAN264601FENOBIS.xlsx"), "FENOBIS : un Feno de plus, pas un chantier");
verifier(["LISTE DE COUPE LAN264601RETARD6087.pdf", "SOMMAIRE LAN264601RETARD6087.pdf", "LAN264601RETARD6087 backup.bkp"].every((nom) => r.sansLancement.includes(`FENO/${nom}`)),
  "RETARD6087 sans fichier de lancement : signalé");
const air = r.chantiers.find((g) => g.strat.nom === "LAN2646AIRDESIGN.xlsx");
verifier(air && air.coupe && air.coupe.nom === "liste de coupe LAN264601AIRDESIGN.pdf", "AIRDESIGN : liste de coupe au code différent rattachée");
const casse = r.fixes.find((g) => g.poste === "Casse");
verifier(casse && casse.coupe && casse.coupe.nom === "liste de coupe LAN264601CASSE.pdf", "Casse : liste de coupe au code différent rattachée");
console.log(echecs ? `${echecs} ÉCHEC(S)` : "TOUT EST OK");
process.exitCode = echecs ? 1 : 0;
