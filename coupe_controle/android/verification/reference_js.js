// Calcule, avec le moteur JS de l'appli web, les résultats de référence que
// le moteur Java natif doit reproduire à l'identique.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const F = process.argv[2];
const SORTIE = process.argv[3];
const b64 = (nom) => fs.readFileSync(path.join(F, nom)).toString('base64');

const STRATS = ['strat_264101.xlsx', 'strat_264001.xlsx', 'strat_264201.xlsx', 'strat_264002.xlsx', 'strat_264001_v1.xlsx', 'strat_264101_doublon.xlsx'];
const COUPES = [
  ['strat_264001.xlsx', 'coupe_40_01.xlsx'],
  ['strat_264101.xlsx', 'coupe_41_01.xlsx'],
  ['strat_264001.xlsx', 'coupe_40_01.pdf'],
  ['strat_264101.xlsx', 'coupe_test.pdf'],
];
const BKPS = [
  ['strat_264101.xlsx', 'LAN264101STRAT_2026-09-22_0923_v12backup.bkp'],
  ['strat_264001.xlsx', 'LAN264001STRAT_2026-09-23_0910_v12backup.bkp'],
  ['strat_264201.xlsx', 'LAN264201STRAT_2026-09-28_0949_v12backup.bkp'],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto('http://localhost:8241/index.html');
  await page.waitForTimeout(400);

  const donnees = {};
  for (const n of new Set([...STRATS, ...COUPES.flat(), ...BKPS.flat()])) donnees[n] = b64(n);

  const resultat = await page.evaluate(async ({ donnees, STRATS, COUPES, BKPS }) => {
    const fichier = (nom) => {
      const bin = atob(donnees[nom]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new File([arr], nom);
    };
    const mapEnListe = (m) => [...m.entries()];
    const sortie = { strat: {}, scies: {}, coupe: {}, pdf: {}, bkp: {} };

    for (const nom of STRATS) {
      const wb = await chargerClasseur(fichier(nom));
      const r = lireStrat(wb);
      sortie.strat[nom] = {
        lignes: r.lignes.map((l) => ({
          cle: l.cle, qte: l.qte_attendue, commande: l.commande, ligne: l.ligne, article: l.article,
          lancement: l.lancement, assemblage: l.assemblage, longueurFinie: l.longueurFinie,
          largeurFinie: l.largeurFinie, epaisseurFinie: l.epaisseurFinie, toutesDonnees: l.toutesDonnees,
        })),
        doublons: r.doublons,
        semaines: r.semaines,
      };
      sortie.scies[nom] = mapEnListe(lireQuantitesAttenduesScies(wb));
    }

    for (const [nomStrat, nomCoupe] of COUPES) {
      const lignesStrat = lireStrat(await chargerClasseur(fichier(nomStrat))).lignes;
      const clesStrat = new Set(lignesStrat.map((l) => l.cle));
      const qte = new Map(lignesStrat.map((l) => [l.cle, l.qte_attendue]));
      let resCoupe;
      let grain;
      if (/\.pdf$/i.test(nomCoupe)) {
        const records = await lireRecordsPDF(fichier(nomCoupe));
        sortie.pdf[nomCoupe] = records.map((r) => ({ desc: r.desc, materiau: r.materiau, qte: r.qte, cle: r.cle, grain: r.grain }));
        resCoupe = lireCoupeDepuisRecordsPDF(records);
        grain = lireGrainMatchingDepuisRecordsPDF(records);
      } else {
        const wb = await chargerClasseur(fichier(nomCoupe));
        resCoupe = lireCoupe(wb, clesStrat, qte);
        grain = lireGrainMatching(wb, clesStrat);
      }
      const rapport = comparer(lignesStrat, resCoupe.compteur);
      sortie.coupe[`${nomStrat}|${nomCoupe}`] = {
        compteur: mapEnListe(resCoupe.compteur),
        nbUnitaires: resCoupe.nbUnitaires,
        nbPiecesTrouvees: resCoupe.nbPiecesTrouvees,
        grain: mapEnListe(grain),
        rapport,
      };
    }

    for (const [nomStrat, nomBkp] of BKPS) {
      const nomLancement = nomBkp.replace(/_\d{4}-\d{2}-\d{2}.*$/i, '').replace(/\.bkp$/i, '');
      const qteBkp = await lireBkp(fichier(nomBkp), nomLancement);
      const attendu = lireQuantitesAttenduesScies(await chargerClasseur(fichier(nomStrat)));
      const lignesStrat = lireStrat(await chargerClasseur(fichier(nomStrat))).lignes;
      sortie.bkp[nomBkp] = {
        qte: mapEnListe(qteBkp),
        ecarts: comparerScies(attendu, qteBkp),
        rapportSansCoupe: comparer(lignesStrat, qteBkp),
      };
    }
    return sortie;
  }, { donnees, STRATS, COUPES, BKPS });

  fs.writeFileSync(SORTIE, JSON.stringify(resultat, null, 1));
  const s = resultat;
  console.log('strat:', Object.entries(s.strat).map(([k, v]) => `${k}=${v.lignes.length} lignes/${v.doublons.length} doublons/${v.semaines.length} sem`).join(', '));
  console.log('coupe:', Object.entries(s.coupe).map(([k, v]) => `${k}: ${v.compteur.length} clés, ${v.rapport.nbAnomalies} anomalies, unitaires ${v.nbUnitaires}`).join('\n       '));
  console.log('pdf:', Object.entries(s.pdf).map(([k, v]) => `${k}=${v.length} enregistrements`).join(', '));
  console.log('bkp:', Object.entries(s.bkp).map(([k, v]) => `${k}=${v.qte.length} clés, ${v.ecarts.length} écarts`).join(', '));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
