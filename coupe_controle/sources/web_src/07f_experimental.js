// ---- Partie expérimentale ----
// 1. Générer une liste de coupe Cut Rite plus économe (06e_liste_coupe.js) : écrite sous un autre nom, la liste de
//    Cut Rite reste intacte et le fichier de lancement (LAN) n'est jamais touché.
// 2. Connexion woodStore : le serveur du stock répond-il ? (Sentinelle.exe seulement, lecture seule.)

const etatListeOpt = { source: null, resultat: null, avant: null, apres: null, erreur: null };

const avertissementEssai = (texte) => `<div class="essai-avertissement"><strong>Expérimental.</strong> ${texte}</div>`;

// Les cases avec un .bkp, sources possibles de la liste de coupe de Cut Rite.
function optionsSourcesListe(source) {
  const options = casesAvecBkp().map((p) => `<option value="${p.id}" ${source && source.p === p ? "selected" : ""}>${echapper(nomSourcePlans({ p, bkp: p.bkp }))}</option>`);
  if (source && !source.p) options.unshift(`<option value="" selected>${echapper(source.fichier.name)}</option>`);
  return options;
}

function afficherListeOpt() {
  const page = $("pageListeOpt");
  if (!etatListeOpt.source) {
    const p = casesAvecBkp()[0];
    if (p) etatListeOpt.source = { p, fichier: p.bkp };
  }
  const s = etatListeOpt.source;
  const options = optionsSourcesListe(s);
  const avecLan = Boolean(s && s.p && s.p.strat);
  page.innerHTML = `${entetePage("Expérimental", "Générer une liste de coupe", "La liste de coupe de Cut Rite d'un lancement, refaite avec moins de pertes : bandes et modules resserrés.")}
    ${avertissementEssai("Le fichier de lancement (LAN) n'est jamais modifié. La liste de Cut Rite reste intacte : la nouvelle liste porte un autre nom. À vérifier dans Cut Rite avant toute découpe ; ne pas envoyer à la scie sans contrôle.")}
    <div class="carte"><div class="carte-titre">Liste de coupe de départ</div>
      <div class="pl-choix">${options.length ? `<select id="choixSourceListe" aria-label="Lancement">${options.join("")}</select>` : '<span class="note">Aucun .bkp chargé dans les semaines.</span>'}
        <button type="button" class="contour" id="btnOuvrirListe">Ouvrir un .bkp ou un .ctt…</button></div>
      <div class="note" style="margin-top:6px">La liste de Cut Rite est lue dans la sauvegarde .bkp (ou dans le .ctt exporté).</div>
      <div class="ligne-cotes" style="margin-top:12px">
        <label>Nom de la nouvelle liste<input type="text" id="champNomListe" autocomplete="off" placeholder="LAN…_OPT"></label>
      </div>
      <label class="case-option"><input type="checkbox" id="caseRetirerHorsLan" ${avecLan ? "checked" : "disabled"}> Retirer les pièces qui ne sont plus dans le fichier de lancement${avecLan ? "" : " (pas de fichier de lancement pour cette source)"}</label>
      <details class="donnees"><summary>Les règles</summary><ul class="essai-regles">
        <li>Bandes : règle des 6 cm (agglo de 28 et plus, mêmes couleurs ; une largeur commune prise parmi celles des pièces, au plus +60 mm et jamais plus que la cote finie + 61 mm ; 3 pièces au plus ; bande de 4060 mm au plus).</li>
        <li>Modules : regroupés par agglo, couleur dessus et couleur dessous ; pièces rangées serrées (trait de 5 mm) ; au plus 4060 × 1050 en agglo, 4070 × 1060 en stratifié (10 mm de plus).</li>
        <li>Pièces seules et protections : inchangées. Mêmes pièces, mêmes quantités : sinon la liste n'est pas écrite.</li>
      </ul></details>
      <div class="pl-boutons" style="justify-content:flex-start"><button type="button" id="btnGenererListe" ${s ? "" : "disabled"}>Générer la liste</button></div>
      <div id="zoneListeOpt"></div></div>`;
  const choix = $("choixSourceListe");
  if (choix)
    choix.addEventListener("change", () => {
      const p = paires.find((x) => String(x.id) === choix.value);
      if (p) Object.assign(etatListeOpt, { source: { p, fichier: p.bkp }, resultat: null, erreur: null });
      afficherListeOpt();
    });
  $("btnOuvrirListe").addEventListener("click", () => {
    const champ = document.createElement("input");
    champ.type = "file";
    champ.accept = ".bkp,.ctt";
    champ.addEventListener("change", () => {
      if (!champ.files || !champ.files[0]) return;
      Object.assign(etatListeOpt, { source: { p: null, fichier: champ.files[0] }, resultat: null, erreur: null });
      afficherListeOpt();
    });
    champ.click();
  });
  $("btnGenererListe").addEventListener("click", genererListeEcran);
  if (s) texteSourceListe(s).then((t) => {
    const champ = $("champNomListe");
    if (champ && !champ.value && etatListeOpt.source === s) champ.value = `${lireCttListe(t).nom}_OPT`;
  }).catch(() => {});
  if (etatListeOpt.resultat || etatListeOpt.erreur) afficherResultatListe();
}

async function texteSourceListe(s) {
  if (/\.ctt$/i.test(s.fichier.name)) return new TextDecoder("iso-8859-1").decode(await s.fichier.arrayBuffer());
  return texteCttBkp(s.fichier);
}

async function genererListeEcran() {
  const s = etatListeOpt.source;
  const zone = $("zoneListeOpt");
  const nom = $("champNomListe").value.trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(nom)) {
    zone.innerHTML = '<div class="message-alerte">Nom de liste : lettres, chiffres, « _ » ou « - » seulement (40 au plus).</div>';
    return;
  }
  $("btnGenererListe").disabled = true;
  zone.innerHTML = '<div class="note">Calcul en cours…</div>';
  await tick();
  try {
    const texte = await texteSourceListe(s);
    if (nom === lireCttListe(texte).nom) throw new Error("choisissez un autre nom que celui de la liste de Cut Rite (elle doit rester intacte)");
    let retirees = new Set();
    if ($("caseRetirerHorsLan").checked && s.p && s.p.strat) {
      const lan = new Set(lireQuantitesAttenduesScies(await classeurEnCache(s.p.strat)).keys());
      retirees = new Set(lireCttListe(texte).recs.filter((r) => r.face === "TC" && r.p2[5] && !lan.has(r.p2[5])).map((r) => r.p2[5]));
    }
    const resultat = genererListeOptimisee(texte, nom, retirees);
    Object.assign(etatListeOpt, { resultat, avant: mesurerListe(texte, retirees), apres: mesurerListe(resultat.texte), erreur: null, nom, sourceNom: s.fichier.name });
  } catch (e) {
    Object.assign(etatListeOpt, { resultat: null, erreur: e && e.message ? e.message : String(e) });
  }
  afficherResultatListe();
}

const m2 = (v) => `${v < -0.05 ? "−" : ""}${Math.abs(v).toFixed(1).replace(".", ",")} m²`;
const ecartPourcent = (a, b) => (a ? `${b - a <= 0 ? "−" : "+"}${Math.abs((100 * (b - a)) / a).toFixed(1).replace(".", ",")} %` : "");

// Un module de la nouvelle liste, dessiné (pièces à leur place).
function svgModuleListe(m) {
  const rects = m.pieces
    .map((p) => `<rect x="${p.x.toFixed(0)}" y="${p.y.toFixed(0)}" width="${p.L.toFixed(0)}" height="${p.W.toFixed(0)}" fill="#eac2b7" stroke="#78140c" stroke-width="5"/>
      ${p.L > m.L * 0.18 && p.W > 90 ? `<text x="${(p.x + p.L / 2).toFixed(0)}" y="${(p.y + p.W / 2 + 22).toFixed(0)}" font-size="${Math.min(70, p.W * 0.4).toFixed(0)}" text-anchor="middle" font-family="Lato,Arial" fill="#22231d">${echapper(String(p.cle).replace(/^[A-Z]+/, ""))}</text>` : ""}`)
    .join("");
  return `<svg class="svg-plan" viewBox="0 0 ${m.L} ${m.W}" xmlns="http://www.w3.org/2000/svg"><rect width="${m.L}" height="${m.W}" fill="#f4f3f1" stroke="#797978" stroke-width="10"/>${rects}</svg>`;
}

const remplissageModule = (m) => (100 * m.pieces.reduce((t, p) => t + p.L * p.W, 0)) / (m.L * m.W);

function afficherResultatListe() {
  const zone = $("zoneListeOpt");
  if (!zone) return;
  const btn = $("btnGenererListe");
  if (btn) btn.disabled = false;
  if (etatListeOpt.erreur) {
    zone.innerHTML = `<div class="message-alerte">Liste non écrite : ${echapper(etatListeOpt.erreur)}</div>`;
    return;
  }
  const { resultat: r, avant: a, apres: b, nom } = etatListeOpt;
  const lignes = [
    ["Bandes", `${a.bandes} (${a.piecesEn_bandes} pièces)`, `${b.bandes} (${b.piecesEn_bandes} pièces)`],
    ["Modules", `${a.modules} · ${m2(a.trousModules)} de trous`, `${b.modules} · ${m2(b.trousModules)} de trous`],
    ["Remplissage des modules", `${a.remplissage.toFixed(0)} %`, `${b.remplissage.toFixed(0)} %`],
    ["Agglo à débiter", m2(a.agglo), m2(b.agglo)],
    ["Stratifié à débiter", m2(a.stratifie), m2(b.stratifie)],
    ["Pièces élargies en bande", `${a.elargies}`, `${b.elargies} (+${m2(b.surfaceElargie)})`],
  ];
  zone.innerHTML = `
    <div class="pl-puces" style="margin-top:12px">
      <span class="pl-puce bon">${m2(b.agglo - a.agglo).replace(/^/, b.agglo <= a.agglo ? "" : "+")} d'agglo (${ecartPourcent(a.agglo, b.agglo)})</span>
      <span class="pl-puce bon">${m2(b.stratifie - a.stratifie).replace(/^/, b.stratifie <= a.stratifie ? "" : "+")} de stratifié (${ecartPourcent(a.stratifie, b.stratifie)})</span>
      <span class="pl-puce">modules remplis ${a.remplissage.toFixed(0)} → ${b.remplissage.toFixed(0)} %</span>
      <span class="pl-puce">${b.pieces} pièces, les mêmes</span>
    </div>
    ${r.retirees.length ? `<div class="note">${r.retirees.length} pièce(s) retirée(s) : plus dans le fichier de lancement (${r.retirees.map(echapper).join(", ")}).</div>` : ""}
    <div class="defilement"><table class="fp-table"><thead><tr><th></th><th class="c">Cut Rite</th><th class="c">${echapper(nom)}</th></tr></thead>
      <tbody>${lignes.map(([t, x, y]) => `<tr><td>${t}</td><td class="c">${x}</td><td class="c">${y}</td></tr>`).join("")}</tbody></table></div>
    <div class="pl-boutons" style="justify-content:flex-start">
      <button type="button" id="btnEnregistrerListe">Enregistrer ${echapper(nom)}.ctt</button>
      <button type="button" class="contour" id="btnRapportListe">Rapport (PDF)</button>
    </div>
    <div class="note">Dans Cut Rite : importer ${echapper(nom)}.ctt comme une liste de coupe, puis l'optimiser. Après l'optimisation, la sauvegarde .bkp se contrôle dans Sentinelle comme d'habitude (pièces placées dans les plans).</div>
    <details class="donnees"><summary>Les ${r.modules.length} modules de la nouvelle liste</summary>
      <div class="pl-grille">${r.modules
        .map((m) => `<div class="pl-carte"><div class="pl-titre"><span>${echapper(m.nom)} · ${echapper(m.agglo)}</span><span class="pl-pdc">${remplissageModule(m).toFixed(0)} %</span></div>
          <div class="pl-sous">${dimsPlan(m.L, m.W)} · dessus ${echapper(m.dessus || "—")} · dessous ${echapper(m.dessous || "—")}</div>${svgModuleListe(m)}</div>`)
        .join("")}</div></details>`;
  $("btnEnregistrerListe").addEventListener("click", () => telecharger(`${nom}.ctt`, octetsLatin1(r.texte), "application/octet-stream"));
  $("btnRapportListe").addEventListener("click", () => telecharger(`Rapport_liste_de_coupe_${nom}.pdf`, rapportListePdf(), "application/pdf"));
}

// Rapport PDF : les chiffres, le tableau Cut Rite / nouvelle liste, puis chaque module dessiné.
function rapportListePdf() {
  const { resultat: r, avant: a, apres: b, nom, sourceNom } = etatListeOpt;
  const titre = `Liste de coupe ${nom}`;
  const pdf = new PdfSimple(titre);
  const M = RAPPORT_MARGE;
  const U = RAPPORT_UTILE;
  bandeauPdf(pdf);
  const hLogo = pdf.logo(PDF_LARGEUR - M - 30 * PDF_MM, RAPPORT_BANDEAU + 6 * PDF_MM, 30 * PDF_MM);
  let y = RAPPORT_BANDEAU + 6 * PDF_MM + 6;
  pdf.texte(M, y, "EXPÉRIMENTAL · LISTE DE COUPE REFAITE PAR SENTINELLE", 7.5, POLICE.GRAS, CHARTE.GRIS, 0.8);
  y += 26;
  pdf.texte(M, y, titre, 17, POLICE.TITRE, CHARTE.NOIR);
  y += 16;
  pdf.texte(M, y, `Comparée à la liste de Cut Rite ${r.nomOrigine} (${sourceNom}) · fichier de lancement non modifié`, 8.5, POLICE.TEXTE, CHARTE.NOIR);
  y = Math.max(y + 14, RAPPORT_BANDEAU + 6 * PDF_MM + hLogo + 8);
  let x = chiffreClePdf(pdf, M, y, m2(b.agglo - a.agglo).replace(",", ","), `Agglo à débiter (${ecartPourcent(a.agglo, b.agglo)})`, null);
  x = chiffreClePdf(pdf, x, y, m2(b.stratifie - a.stratifie), `Stratifié à débiter (${ecartPourcent(a.stratifie, b.stratifie)})`, null);
  y += 15 * PDF_MM + 10;
  chiffreClePdf(pdf, M, y, `${a.remplissage.toFixed(0)} → ${b.remplissage.toFixed(0)} %`, "Remplissage des modules", null);
  chiffreClePdf(pdf, M + 54 * PDF_MM + 5 * PDF_MM, y, String(b.pieces), "Pièces, les mêmes", null);
  y += 15 * PDF_MM + 14;
  const lignes = [
    ["", "Cut Rite", nom],
    ["Bandes", `${a.bandes} (${a.piecesEn_bandes} pièces)`, `${b.bandes} (${b.piecesEn_bandes} pièces)`],
    ["Modules", `${a.modules} · ${m2(a.trousModules)} de trous`, `${b.modules} · ${m2(b.trousModules)} de trous`],
    ["Agglo à débiter", m2(a.agglo), m2(b.agglo)],
    ["Stratifié à débiter", m2(a.stratifie), m2(b.stratifie)],
    ["Pièces élargies en bande", String(a.elargies), `${b.elargies} (+${m2(b.surfaceElargie)})`],
  ];
  for (const [k, ligne] of lignes.entries()) {
    const police = k === 0 ? POLICE.GRAS : POLICE.TEXTE;
    pdf.texte(M, y, ligne[0], 9, police, CHARTE.NOIR);
    pdf.texte(M + U * 0.4, y, ligne[1], 9, police, CHARTE.NOIR);
    pdf.texte(M + U * 0.7, y, ligne[2], 9, police, CHARTE.NOIR);
    pdf.filet(M, M + U, y + 4, k === 0 ? CHARTE.NOIR : CHARTE.GRIS_FILET, k === 0 ? 0.6 : 0.4);
    y += 15;
  }
  if (r.retirees.length) {
    y += 6;
    for (const t of couperTextePdf(`${r.retirees.length} pièce(s) retirée(s) (plus dans le fichier de lancement) : ${r.retirees.join(", ")}`, U, 8, POLICE.ITALIQUE)) {
      pdf.texte(M, y, t, 8, POLICE.ITALIQUE, CHARTE.GRIS);
      y += 11;
    }
  }
  y += 10;
  pdf.texte(M, y, "Modules de la nouvelle liste", 11, POLICE.TITRE, CHARTE.BORDEAUX);
  y += 14;
  for (const m of r.modules) {
    const ech = Math.min(U / m.L, (40 * PDF_MM) / m.W);
    if (y + 14 + m.W * ech > RAPPORT_BAS) {
      pdf.nouvellePage();
      bandeauPdf(pdf);
      y = RAPPORT_BANDEAU + 9 * PDF_MM;
    }
    pdf.texte(M, y, `${m.nom} · ${m.agglo} · dessus ${m.dessus || "—"} · dessous ${m.dessous || "—"} · ${dimsPlan(m.L, m.W)} · rempli ${remplissageModule(m).toFixed(0)} %`, 8, POLICE.GRAS, CHARTE.NOIR);
    y += 5;
    pdf.rectangle(M, y, m.L * ech, m.W * ech, CHARTE.GRIS_CLAIR, CHARTE.NOIR, 0.6);
    for (const p of m.pieces) {
      pdf.rectangle(M + p.x * ech, y + p.y * ech, p.L * ech, p.W * ech, CHARTE.SAUMON, CHARTE.NOIR, 0.4);
      const t = String(p.cle).replace(/^[A-Z]+/, "");
      if (p.L * ech > 50 && p.W * ech > 8) texteCentrePdf(pdf, M + (p.x + p.L / 2) * ech, y + (p.y + p.W / 2) * ech + 2.5, t, Math.min(7, p.W * ech * 0.45), POLICE.TEXTE, CHARTE.NOIR);
    }
    y += m.W * ech + 12;
  }
  piedsDePagePdf(pdf, `${titre} — Sentinelle ${versionSentinelle()} (expérimental)`);
  return pdf.octets();
}

// ---- Connexion woodStore ----

const CLE_WOODSTORE = "sentinelle-woodstore";
const PORTS_WOODSTORE = [
  [1433, "base de données SQL Server"],
  [80, "page web (http)"],
  [443, "page web sécurisée (https)"],
];
const lireReglagesWoodstore = () => {
  try {
    return { hote: "10.101.50.1", ...JSON.parse(localStorage.getItem(CLE_WOODSTORE) || "{}") };
  } catch (_e) {
    return { hote: "10.101.50.1" };
  }
};
// Le test passe par Sentinelle.exe (une page web seule ne peut pas ouvrir de connexion réseau).
const dansSentinelleExe = () => location.protocol === "http:" && /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.port === "47815";

function afficherWoodstore() {
  const page = $("pageWoodstore");
  const r = lireReglagesWoodstore();
  page.innerHTML = `${entetePage("Expérimental", "Connexion woodStore", "Relier Sentinelle au stock de panneaux et de chutes (woodStore), par l'adresse IP du serveur, comme dans Cut Rite.")}
    ${avertissementEssai("Lecture seule : Sentinelle n'écrit jamais dans woodStore (pas de réservation, pas de mise à jour du stock). Aujourd'hui, seul le test de connexion est fait : aucune donnée n'est lue.")}
    <div class="carte"><div class="carte-titre">Serveur woodStore</div>
      <div class="note">Dans Cut Rite : Paramètres du système › Mise à jour du stock › woodStore › « Nom de l'hôte ou adresse IP serveur ».</div>
      <div class="ligne-cotes" style="margin-top:10px">
        <label>Nom de l'hôte ou adresse IP<input type="text" id="champHoteWoodstore" autocomplete="off" value="${echapper(r.hote)}"></label>
        <button type="button" id="btnTesterWoodstore">Tester la connexion</button>
      </div>
      <div id="zoneWoodstore"></div>
    </div>
    <div class="carte"><div class="carte-titre">La suite</div>
      <ul class="essai-regles">
        <li>But : avant l'optimisation, voir dans Sentinelle si les panneaux et les chutes prévus existent en stock (et le stock d'une couleur depuis la recherche).</li>
        <li>Pour lire le stock, il faut l'accord du service informatique et savoir comment woodStore donne ses données (base SQL Server, service web, ou export de fichier). Les identifiants restent à eux : Sentinelle ne les lit pas dans Cut Rite.</li>
      </ul></div>`;
  $("btnTesterWoodstore").addEventListener("click", testerWoodstore);
  $("champHoteWoodstore").addEventListener("keydown", (e) => {
    if (e.key === "Enter") testerWoodstore();
  });
}

async function testerWoodstore() {
  const zone = $("zoneWoodstore");
  const hote = $("champHoteWoodstore").value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(hote)) {
    zone.innerHTML = '<div class="message-alerte">Adresse illisible (exemple : 10.101.50.1).</div>';
    return;
  }
  try {
    localStorage.setItem(CLE_WOODSTORE, JSON.stringify({ hote }));
  } catch (_e) {
    // réglage non gardé
  }
  if (!dansSentinelleExe()) {
    zone.innerHTML = '<div class="message-alerte">Le test se fait dans Sentinelle.exe, sur un PC du réseau de l\'atelier (une page ouverte dans le navigateur ne peut pas se connecter à un serveur).</div>';
    return;
  }
  $("btnTesterWoodstore").disabled = true;
  zone.innerHTML = `<div class="note">Test de ${echapper(hote)}…</div>`;
  try {
    const rep = await fetch("/sentinelle/reseau/tester", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sentinelle": "reseau" },
      body: JSON.stringify({ hote, ports: PORTS_WOODSTORE.map(([p]) => p) }),
    });
    if (!rep.ok) throw new Error((await rep.text()).trim() || `réponse ${rep.status}`);
    const res = await rep.json();
    const service = new Map(PORTS_WOODSTORE);
    const unOk = res.some((x) => x.repond);
    zone.innerHTML = `<div class="pl-puces" style="margin-top:10px"><span class="pl-puce ${unOk ? "bon" : "alerte"}">${unOk ? `✔ Le serveur ${echapper(hote)} répond` : `⚠ Le serveur ${echapper(hote)} ne répond pas`}</span></div>
      <div class="defilement"><table class="fp-table"><thead><tr><th>Port</th><th>Service habituel</th><th>Réponse</th></tr></thead><tbody>${res
        .map((x) => `<tr><td>${x.port}</td><td>${echapper(service.get(x.port) || "")}</td><td class="${x.repond ? "ok" : "alerte"}">${x.repond ? `✔ répond (${x.ms} ms)` : "✗ ne répond pas"}</td></tr>`)
        .join("")}</tbody></table></div>
      <div class="note">Seule une connexion est ouverte puis refermée : rien n'est lu ni écrit.</div>`;
  } catch (e) {
    zone.innerHTML = `<div class="message-alerte">Test impossible : ${echapper(e && e.message ? e.message : String(e))}</div>`;
  } finally {
    $("btnTesterWoodstore").disabled = false;
  }
}
