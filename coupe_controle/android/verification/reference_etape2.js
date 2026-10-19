// Références de l'étape 2 (scan du dossier partagé, recherche, schéma de
// commande), calculées avec l'appli web elle-même, que l'appli native doit
// reproduire à l'identique.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const F = process.argv[2];
const SORTIE = process.argv[3];
const b64 = (nom) => fs.readFileSync(path.join(F, nom)).toString('base64');

const T0 = Date.UTC(2026, 8, 20, 8, 0, 0);
const f = (nom, minutes = 0) => ({ nom, date: T0 + minutes * 60000 });

const SCENARIOS = {
  semaine_complete: [
    f('LAN264001STRAT.xlsx', 5), f('CUTRITE_LAN264001STRAT.xlsx', 6), f('LAN264001STRAT_2026-09-23_0910_v12backup.bkp', 7),
    f('LAN264002STRAT.xlsx', 8), f('Liste de coupe 40.02.pdf', 9),
    f('LAN264003FENO.xlsx', 10), f('40-feno-coupe.pdf', 11), f('LAN264003_2026-09-23_0915_v12backup.bkp', 12),
    f('LAN264004CASSE.xlsx', 13), f('coupe casse 40.pdf', 14),
    f('LAN2640TRIGANO.xlsx', 15), f('CUTRITE_LAN2640TRIGANO.pdf', 16),
    f('LAN2640EQUI76.xlsx', 17), f('LAN2640EQUI76_2026-09-30_1010_v12backup.bkp', 18),
    f('LAN264101STRAT.xlsx', 19), f('LAN264101STRAT_2026-09-22_0923_v12backup.bkp', 20),
    f('photo.jpg', 21), f('notes.txt', 22), f('LAN264001START coupe.pdf', 23),
  ],
  deux_feno_meme_semaine: [
    f('LAN264003FENO.xlsx', 1), f('LAN264003FENOG-F.xlsx', 2), f('CUTRITE_LAN264003FENOG-F.xlsx', 3),
    f('LAN264003_2026-09-23_0910_v12backup.bkp', 4), f('CUTRITE_LAN264003FENO.xlsx', 5),
  ],
  deux_semaines_meme_parite: [
    f('LAN264001STRAT.xlsx', 50), f('LAN264201STRAT.xlsx', 10), f('CUTRITE_LAN264201STRAT.xlsx', 11),
    f('LAN264203CASSE.xlsx', 5), f('LAN264003CASSE.xlsx', 30),
  ],
  sans_code_ambigu: [
    f('LAN264001STRAT.xlsx'), f('LAN264002STRAT.xlsx'), f('LAN264003FENO.xlsx'), f('LAN264004CASSE.xlsx'),
    f('coupe 40.pdf'), f('coupe 40 01.pdf'), f('coupe feno 40.pdf'), f('coupe 40-02.pdf'), f('sauvegarde 40.bkp'),
    f('coupe 41.pdf'),
  ],
  dossier_sans_lancement: [f('photo.jpg'), f('Liste de coupe.pdf'), f('readme')],
  dossier_vide: [],
  casse_et_accents: [
    f('lan264101strat.xlsx', 1), f('Cutrite_LAN264102STRAT.XLSX', 2), f('LAN264102STRAT.xlsx', 3),
    f('LAN2641ÉQUIPE.xlsx', 4), f('LAN2641équipe coupe.pdf', 5), f('LAN2641chantier-b.xlsx', 6),
    f('LAN2641CHANTIER-B_2026-10-01_0800_v12backup.bkp', 7), f('LAN264105feno.xlsx', 8), f('LAN264106Casse.xlsm', 9),
  ],
  ordre_des_noms: [
    f('LAN2640TRIGANO.xlsx', 1), f('LAN2640TRIGANO (1).xlsx', 2), f('LAN2640TRIGANO-2.xlsx', 3), f('LAN2640_TRIGANO.xlsx', 4),
    f('lan2640trigano.xlsx', 5), f('LAN2640 TRIGANO.xlsx', 6), f('CUTRITE LAN2640TRIGANO.xlsx', 7), f('cutrite_lan2640trigano.xlsx', 8),
    f('LAN264001STRAT.xlsx', 9), f('LAN264001STRAT.xlsx.bak', 10), f('_LAN264001STRAT.xlsx', 11), f('~$LAN264001STRAT.xlsx', 12),
  ],
  dates_egales: [
    f('LAN264001STRAT.xlsx', 0), f('LAN264201STRAT.xlsx', 0), f('LAN264401STRAT.xlsx', 0),
    f('LAN264003FENO.xlsx', 0), f('LAN264203FENO.xlsx', 0),
  ],
};

const RECHERCHE_PAIRES = [
  // [poste, parité, strat, coupe, bkp] — noms réels donnés aux fichiers de test
  ['Agglo 1er tour', 'paire', ['strat_264001.xlsx', 'LAN264001STRAT.xlsx'], ['coupe_40_01.xlsx', 'CUTRITE_LAN264001STRAT.xlsx'], null],
  ['Feno', 'paire', ['strat_264001_v1.xlsx', 'LAN264001STRAT.xlsx'], ['coupe_40_01.pdf', 'Liste de coupe 40.01.pdf'], null],
  ['Casse', 'impaire', ['strat_264101.xlsx', 'LAN264101STRAT.xlsx'], null, ['LAN264101STRAT_2026-09-22_0923_v12backup.bkp', 'LAN264101STRAT_2026-09-22_0923_v12backup.bkp']],
  ['Agglo 2ème tour', 'impaire', ['strat_264201.xlsx', 'LAN264201STRAT.xlsx'], null, null],
  ['Agglo 2ème tour', 'paire', null, ['coupe_test.pdf', 'coupe_test.pdf'], null],
  ['Casse', 'paire', ['strat_264002.xlsx', 'LAN264002STRAT.xlsx'], null, ['LAN264201STRAT_2026-09-28_0949_v12backup.bkp', 'LAN264201STRAT_2026-09-28_0949_v12backup.bkp']],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  const ouvrir = async () => {
    await page.goto('http://localhost:8241/index.html');
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('sentinelle-memoire'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
    await page.goto('http://localhost:8241/index.html');
    await page.waitForTimeout(300);
  };

  // ---- A. scan du dossier partagé ----
  const scan = {};
  for (const [nomScenario, fichiers] of Object.entries(SCENARIOS)) {
    for (const parite of ['paire', 'impaire']) {
      await ouvrir();
      scan[`${nomScenario}|${parite}`] = await page.evaluate(async ({ fichiers, parite }) => {
        const log = [];
        window.assignerFichierScanneAPaire = async (paire, div, role, fichier) => {
          log.push(['fichier', paire.poste, paire.semaineParite, paire.poste === POSTE_CHANTIERS ? paire.codeLancement : null, role, fichier.name]);
        };
        window.lancerUnePaire = async (paire) => log.push(['go', paire.poste, paire.semaineParite, paire.codeLancement || null]);
        window.lancerControleScies = async (paire) => log.push(['scies', paire.poste, paire.semaineParite, paire.codeLancement || null]);
        window.majCompteurSemaine = async () => {};
        window.sauvegarderDansMemoire = async () => {};
        semaineActive = parite;
        dossierPartageHandles[parite] = {
          kind: 'directory',
          name: 'Partage',
          async *entries() {
            for (const x of fichiers) {
              yield [x.nom, { kind: 'file', name: x.nom, async getFile() { return new File([], x.nom, { lastModified: x.date }); } }];
            }
          },
        };
        await scannerDossierPartage();
        return { log, texte: document.getElementById('resultatScanPartage').innerText };
      }, { fichiers, parite });
    }
  }

  // ---- B. recherche ----
  await ouvrir();
  const donnees = {};
  for (const def of RECHERCHE_PAIRES) for (const x of def.slice(2)) if (x) donnees[x[0]] = b64(x[0]);
  const recherche = await page.evaluate(async ({ donnees, RECHERCHE_PAIRES }) => {
    const fichier = ([fixture, nom]) => {
      const bin = atob(donnees[fixture]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new File([arr], nom);
    };
    for (const [poste, parite, strat, coupe, bkp] of RECHERCHE_PAIRES) {
      const p = paires.find((x) => x.poste === poste && x.semaineParite === parite);
      if (strat) p.fichierStratRestaure = fichier(strat);
      if (coupe) p.fichierCoupeRestaure = fichier(coupe);
      if (bkp) p.fichierBkpRestaure = fichier(bkp);
      // clés du fichier de lancement, comme après un contrôle (GO)
      if (strat) {
        const lignes = lireStrat(await chargerClasseur(p.fichierStratRestaure)).lignes;
        p.clesStrat = new Set(lignes.map((l) => l.cle));
        p.qteAttendueParCle = new Map(lignes.map((l) => [l.cle, l.qte_attendue]));
      }
    }
    const lignes264001 = lireStrat(await chargerClasseur(paires.find((x) => x.poste === 'Agglo 1er tour' && x.semaineParite === 'paire').fichierStratRestaure)).lignes;
    const lignes264101 = lireStrat(await chargerClasseur(paires.find((x) => x.poste === 'Casse' && x.semaineParite === 'impaire').fichierStratRestaure)).lignes;
    const lignes264201 = lireStrat(await chargerClasseur(paires.find((x) => x.poste === 'Agglo 2ème tour' && x.semaineParite === 'impaire').fichierStratRestaure)).lignes;
    const requetes = [
      lignes264001[0].cle, lignes264001[0].commande, lignes264001[40].cle.toLowerCase(), ` ${lignes264001[77].commande} `,
      lignes264101[3].cle, lignes264101[10].commande, lignes264201[5].cle, lignes264201[20].commande,
      'T9', 'T9/1', 'LT3/1', 't 12', 'T1', 'ZZZ', 'CVC2609', '', 'CVC26',
    ];
    const zone = document.getElementById('resultatRechercheGlobale');
    const sorties = {};
    for (const q of requetes) {
      document.getElementById('rechercheGlobale').value = q;
      await rechercherGrainMatchingGlobal();
      const resultats = [...zone.querySelectorAll('.resultat-recherche')].map((r) => ({
        cle: r.querySelector('.resultat-cle').textContent,
        poste: r.querySelector('.resultat-poste').textContent,
        note: (r.querySelector('.scies-note') || {}).textContent || null,
        champs: [...r.querySelectorAll('.resultat-champ')].map((c) => [c.querySelector('.resultat-champ-label').textContent, c.querySelector('.resultat-champ-valeur').textContent]),
        puces: [...r.querySelectorAll('.grain-puce')].map((x) => x.textContent),
        schemaPiece: r.querySelector('svg.schema-piece') ? r.querySelector('svg.schema-piece').outerHTML.replace(/\s+/g, ' ') : null,
        donnees: [...r.querySelectorAll('.table-donnees-lan tr')].map((tr) => [tr.querySelector('th').textContent, tr.querySelector('td').textContent]),
      }));
      const schema = zone.querySelector('.schema-commande');
      sorties[q] = {
        texte: resultats.length === 0 ? zone.innerText : null,
        couleur: zone.style.color,
        resultats,
        erreurs: [...zone.querySelectorAll('div')].filter((d) => d.textContent.startsWith('Illisibles')).map((d) => d.textContent),
        schema: schema ? {
          titre: schema.querySelector('summary').textContent,
          ensembles: [...schema.querySelectorAll('.schema-ensemble')].map((e) => ({
            titre: e.querySelector('.schema-ensemble-titre').textContent,
            ouvert: e.querySelector('details') ? e.querySelector('details').open : null,
            pieces: [...e.querySelectorAll('.sc-piece')].map((p) => ({
              classe: p.className,
              num: p.querySelector('.sc-num').textContent,
              texte: p.querySelector('div').textContent.replace(/\s+/g, ' ').trim(),
              infos: [...p.querySelectorAll('.sc-info')].map((i) => i.textContent.trim()),
            })),
            svg: e.querySelector('svg') ? {
              viewBox: e.querySelector('svg').getAttribute('viewBox'),
              elements: [...e.querySelector('svg').children].map((x) => [x.tagName, x.getAttribute('class'),
                x.getAttribute('d') || x.getAttribute('points') || [x.getAttribute('x1'), x.getAttribute('y1'), x.getAttribute('x2'), x.getAttribute('y2'), x.getAttribute('cx'), x.getAttribute('cy'), x.getAttribute('x'), x.getAttribute('y'), x.getAttribute('r'), x.getAttribute('font-size')].filter((v) => v !== null).join(' '),
                x.tagName === 'text' ? x.textContent : (x.querySelector('title') || {}).textContent || null]),
            } : null,
          })),
        } : null,
      };
    }
    return sorties;
  }, { donnees, RECHERCHE_PAIRES });

  // ---- C. schéma de toutes les commandes des fichiers de lancement ----
  const STRATS = ['strat_264101.xlsx', 'strat_264001.xlsx', 'strat_264201.xlsx', 'strat_264002.xlsx'];
  const d2 = {};
  for (const n of STRATS) d2[n] = b64(n);
  const schemas = await page.evaluate(async ({ d2, STRATS }) => {
    const sortie = {};
    for (const nom of STRATS) {
      const bin = atob(d2[nom]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const lignes = lireStrat(await chargerClasseur(new File([arr], nom))).lignes;
      const commandes = [...new Set(lignes.map((l) => l.commande))];
      for (const commande of commandes) {
        const lc = [];
        const vues = new Set();
        for (const l of lignes) if (l.commande === commande && !vues.has(l.cle)) { vues.add(l.cle); lc.push(l); }
        const div = document.createElement('div');
        div.innerHTML = construireSchemaCommandeHtml(commande, lc, lc[0].cle);
        sortie[`${nom}|${commande}`] = {
          ensembles: [...div.querySelectorAll('.schema-ensemble')].map((e) => ({
            titre: e.querySelector('.schema-ensemble-titre').textContent,
            ouvert: e.querySelector('details') ? e.querySelector('details').open : null,
            pieces: [...e.querySelectorAll('.sc-piece')].map((p) => [p.className, p.querySelector('.sc-num').textContent,
              p.querySelector('div').textContent.replace(/\s+/g, ' ').trim()]),
            svg: e.querySelector('svg') ? [e.querySelector('svg').getAttribute('viewBox'),
              ...[...e.querySelector('svg').children].map((x) => `${x.tagName}|${x.getAttribute('class')}|${x.getAttribute('d') || x.getAttribute('points') || [x.getAttribute('x1'), x.getAttribute('y1'), x.getAttribute('x2'), x.getAttribute('y2'), x.getAttribute('cx'), x.getAttribute('cy'), x.getAttribute('r'), x.getAttribute('x'), x.getAttribute('y'), x.getAttribute('font-size')].filter((v) => v !== null).join(' ')}|${x.tagName === 'text' ? x.textContent : ''}`)] : null,
          })),
        };
      }
    }
    return sortie;
  }, { d2, STRATS });

  fs.writeFileSync(SORTIE, JSON.stringify({ scenarios: SCENARIOS, scan, recherchePaires: RECHERCHE_PAIRES, recherche, schemas }, null, 1));
  console.log('scan:', Object.keys(scan).length, 'cas ; recherche:', Object.keys(recherche).length, 'requêtes ; schémas:', Object.keys(schemas).length, 'commandes');
  for (const [k, v] of Object.entries(scan)) console.log(' ', k, '→', v.log.length, 'actions');
  for (const [k, v] of Object.entries(recherche)) console.log(' ', JSON.stringify(k), '→', v.resultats.length, 'résultat(s)', v.schema ? `+ schéma (${v.schema.ensembles.length} blocs)` : '', v.erreurs.join(' '));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
