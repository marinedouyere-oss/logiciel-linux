// ---- Claustra : fichier de lancement des claustras, à partir de la confirmation de commande ----
// Règles (fichiers faits à la main par l'atelier, ex. LAN26CLAUSTRAbis = CVC26100432) :
//  - 2 lisses : longueur du claustra × profondeur des lisses, 4 chants ;
//  - lames (droites, obliques) : hauteur − 60 (2 lisses de 30) × largeur des lames, chants avant et arrière ;
//  - surcote 25 (débit = fini + 25), idPlan C, agglo SAG28HYBR (29 mm), double face (CBD), chants PVC ;
//  - commentaire « A MONTER » (montage inclus) ou « ENKIT » (montage non inclus) ;
//  - emballage : 2 panneaux (H+50)×(L+50), 2 bandes (H+50)×85, 2 bandes (L−38)×85 en PROTECTION (19 mm).

const COLONNES_LAN = [
  "conf_commande", "conf_ligne", "conf_article", "conf_epaisseur", "conf_longueur", "conf_largeur", "longueur", "largeur", "surepaisseur",
  "coloris", "agglo", "coloris_inf", "comdet_qte", "com_livsem", "com_livan", "comprod_lancement", "com_clientcom", "com_reference",
  "conf_chantavant", "conf_chantarriere", "conf_chantgauche", "conf_chantdroit", "idPlan", "commentaire", "commande+ligne",
  "info atelier assemblage", "Type chant", "CBD", "info 2 atelier", "info 3 atelier", "Usinage angle avant gauche", "Usinage angle avant droit",
  "Usinage angle arrière gauche", "Usinage angle arrière droit", "LongueurxLargeur debit", "LongueurxLargeurxEpaisseur fini", "trans_nomcourt",
];
const SURCOTE_CLAUSTRA = 25;
const LISSE_HAUTEUR = 30; // les lames vont entre les deux lisses : hauteur − 2 × 30
const ID_PLAN_CLAUSTRA = "C";
const CLE_BROUILLON = "claustra-brouillon";

const $ = (id) => document.getElementById(id);
const echapper = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nombre = (v) => {
  const t = String(v ?? "").trim().replace(",", ".");
  return t === "" ? null : Number(t);
};

const nouveauClaustra = (ligne) => ({
  ligne, coloris: "", epaisseur: "29", longueur: "", hauteur: "", droites: "", largeurDroites: "", obliques: "", largeurObliques: "",
  profondeurLisses: "", montage: true, protection: true, agglo: "SAG28HYBR",
});

let etat = { commande: { numero: "", client: "", representant: "", reference: "", semaine: "", annee: String(new Date().getFullYear()) }, claustras: [nouveauClaustra(1)], nomFichier: "" };

function lireBrouillon() {
  try {
    const b = JSON.parse(localStorage.getItem(CLE_BROUILLON) || "null");
    if (b && b.commande && Array.isArray(b.claustras) && b.claustras.length) etat = b;
  } catch (_e) {
    // pas de brouillon
  }
}
function garderBrouillon() {
  try {
    localStorage.setItem(CLE_BROUILLON, JSON.stringify(etat));
  } catch (_e) {
    // sans stockage : rien de gardé
  }
}

// « 1047 Chêne Halifax » → « 1047 » (le code de la couleur).
const codeCouleur = (c) => String(c || "").trim().split(/\s+/)[0].toUpperCase();

// Les pièces d'un claustra (et ce qui manque pour les calculer).
function piecesDuClaustra(c) {
  const erreurs = [];
  const L = nombre(c.longueur);
  const H = nombre(c.hauteur);
  const ep = nombre(c.epaisseur);
  const prof = nombre(c.profondeurLisses);
  const nd = nombre(c.droites) || 0;
  const no = nombre(c.obliques) || 0;
  const ld = nombre(c.largeurDroites);
  const lo = nombre(c.largeurObliques);
  const positif = (v) => v !== null && Number.isFinite(v) && v > 0;
  if (!codeCouleur(c.coloris)) erreurs.push("coloris");
  if (!positif(L)) erreurs.push("longueur");
  if (!positif(H) || H <= 2 * LISSE_HAUTEUR) erreurs.push("hauteur");
  if (!positif(ep)) erreurs.push("épaisseur");
  if (!positif(prof)) erreurs.push("profondeur des lisses");
  if (nd + no < 1) erreurs.push("nombre de lames");
  if (nd > 0 && !positif(ld)) erreurs.push("largeur des lames droites");
  if (no > 0 && !positif(lo)) erreurs.push("largeur des lames obliques");
  if (!Number.isInteger(nd) || !Number.isInteger(no) || nd < 0 || no < 0) erreurs.push("nombre de lames (entier)");
  if (erreurs.length) return { pieces: [], erreurs };
  const pieces = [{ nom: "Lisse", L, l: prof, e: ep, qte: 2, chants: 4 }];
  if (no > 0) pieces.push({ nom: "Lame oblique", L: H - 2 * LISSE_HAUTEUR, l: lo, e: ep, qte: no, chants: 2 });
  if (nd > 0) pieces.push({ nom: "Lame droite", L: H - 2 * LISSE_HAUTEUR, l: ld, e: ep, qte: nd, chants: 2 });
  if (c.protection) {
    pieces.push({ nom: "Protection", L: H + 50, l: L + 50, e: 19, qte: 2, protection: true });
    pieces.push({ nom: "Protection", L: H + 50, l: 85, e: 19, qte: 2, protection: true });
    pieces.push({ nom: "Protection", L: L - 38, l: 85, e: 19, qte: 2, protection: true });
  }
  return { pieces, erreurs };
}

const texteNombre = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

// Une ligne du fichier de lancement (dans l'ordre des 37 colonnes).
function ligneLancement(p, c, cmd) {
  const code = codeCouleur(c.coloris);
  const couleur = code;
  const chant = /^\d+$/.test(code) ? Number(code) : code;
  const surcote = p.protection ? 0 : SURCOTE_CLAUSTRA;
  const v = {
    conf_commande: cmd.numero.trim().toUpperCase(),
    conf_ligne: Number(c.ligne) || 1,
    conf_article: "CLAUSTRA",
    conf_epaisseur: nombre(c.epaisseur),
    conf_longueur: p.L,
    conf_largeur: p.l,
    longueur: p.L + surcote,
    largeur: p.l + surcote,
    surepaisseur: surcote,
    agglo: p.protection ? "PROTECTION" : c.agglo || "SAG28HYBR",
    comdet_qte: p.qte,
    com_livsem: nombre(cmd.semaine),
    com_livan: nombre(cmd.annee),
    comprod_lancement: cmd.representant.trim().toUpperCase(),
    com_clientcom: cmd.client.trim().toUpperCase(),
    com_reference: cmd.reference.trim(),
    commentaire: c.montage ? "A MONTER" : "ENKIT",
    "commande+ligne": `${cmd.numero.trim().toUpperCase()}${String(Number(c.ligne) || 1).padStart(3, "0")}`,
    "LongueurxLargeurxEpaisseur fini": `${texteNombre(p.L)} X ${texteNombre(p.l)} X ${texteNombre(p.e)}`,
  };
  if (!p.protection) {
    Object.assign(v, { coloris: couleur, coloris_inf: couleur, conf_chantavant: chant, conf_chantarriere: chant, idPlan: ID_PLAN_CLAUSTRA, "Type chant": "PVC", CBD: "CBD" });
    if (p.chants === 4) Object.assign(v, { conf_chantgauche: chant, conf_chantdroit: chant });
  }
  v["LongueurxLargeur debit"] = `${texteNombre(v.longueur)} X ${texteNombre(v.largeur)}`;
  return COLONNES_LAN.map((n) => (v[n] === undefined || v[n] === "" ? null : v[n]));
}

function erreursCommande(cmd) {
  const e = [];
  if (!/^CVC\d{8}$/i.test(cmd.numero.trim())) e.push("n° de commande (CVC + 8 chiffres)");
  if (!cmd.client.trim()) e.push("code client");
  if (!cmd.representant.trim()) e.push("représentant");
  const s = nombre(cmd.semaine);
  if (!Number.isInteger(s) || s < 1 || s > 53) e.push("semaine de livraison");
  const a = nombre(cmd.annee);
  if (!Number.isInteger(a) || a < 2020 || a > 2100) e.push("année");
  return e;
}

// Toutes les lignes du fichier, ou ce qui manque.
function lignesDuFichier() {
  const manque = erreursCommande(etat.commande).map((x) => `Commande : ${x}`);
  const lignes = [];
  const noms = [];
  etat.claustras.forEach((c, i) => {
    const r = piecesDuClaustra(c);
    if (r.erreurs.length) manque.push(`Claustra ${i + 1} (ligne ${c.ligne || "?"}) : ${r.erreurs.join(", ")}`);
    for (const p of r.pieces) {
      lignes.push(ligneLancement(p, c, etat.commande));
      noms.push(p.nom);
    }
  });
  return { lignes, noms, manque };
}

const nomParDefaut = () => {
  const a = String(nombre(etat.commande.annee) || "").slice(-2);
  const s = String(nombre(etat.commande.semaine) || "").padStart(2, "0");
  return a && s !== "00" ? `LAN${a}${s}CLAUSTRA` : "LANCLAUSTRA";
};

// ---- Classeur Excel (.xlsx) : une feuille « Feuil1 », en-têtes des 37 colonnes puis une ligne par pièce ----

const xml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const lettresColonne = (n) => {
  let s = "";
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

async function classeurLancement(lignes) {
  const chaines = [];
  const index = new Map();
  const chaine = (t) => {
    if (!index.has(t)) {
      index.set(t, chaines.length);
      chaines.push(t);
    }
    return index.get(t);
  };
  const cellule = (ref, v, style) => {
    const s = style ? ` s="${style}"` : "";
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return `<c r="${ref}"${s}><v>${v}</v></c>`;
    return `<c r="${ref}"${s} t="s"><v>${chaine(String(v))}</v></c>`;
  };
  const rangees = [[COLONNES_LAN, 1], ...lignes.map((l) => [l, 0])].map(
    ([valeurs, style], i) => `<row r="${i + 1}">${valeurs.map((v, j) => cellule(`${lettresColonne(j)}${i + 1}`, v, style)).join("")}</row>`
  );
  const largeurs = COLONNES_LAN.map((n, j) => `<col min="${j + 1}" max="${j + 1}" width="${Math.max(9, Math.min(34, n.length + 3))}" customWidth="1"/>`).join("");
  const feuille = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lettresColonne(COLONNES_LAN.length - 1)}${lignes.length + 1}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${largeurs}</cols><sheetData>${rangees.join("")}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
  const partage = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${chaines.length}" uniqueCount="${chaines.length}">${chaines.map((t) => `<si><t xml:space="preserve">${xml(t)}</t></si>`).join("")}</sst>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF808080"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const enc = new TextEncoder();
  const parties = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Feuil1" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml", feuille],
    ["xl/sharedStrings.xml", partage],
    ["xl/styles.xml", styles],
  ].map(([nom, texte]) => [nom, enc.encode(texte)]);
  return ecrireZip(parties);
}

// Enregistrement : l'emplacement au choix (Edge), sinon le dossier des téléchargements.
async function enregistrer(nom, octets) {
  const type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (typeof window.showSaveFilePicker === "function") {
    let fh;
    try {
      fh = await window.showSaveFilePicker({ suggestedName: nom, types: [{ description: "Classeur Excel", accept: { [type]: [".xlsx"] } }] });
    } catch (e) {
      if (e && e.name === "AbortError") return null;
      fh = null;
    }
    if (fh) {
      const w = await fh.createWritable();
      await w.write(octets);
      await w.close();
      return fh.name;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([octets], { type }));
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
  return nom;
}

// ---- Écran ----

const champ = (id, libelle, valeur, attrs = "") =>
  `<label class="champ"><span>${libelle}</span><input id="${id}" value="${echapper(valeur)}" autocomplete="off" ${attrs}></label>`;

function afficher() {
  const cmd = etat.commande;
  let html = `<section class="carte"><div class="carte-titre">Commande</div>
    <div class="note">Recopiez la confirmation de commande.</div>
    <div class="grille">
      ${champ("cmdNumero", "N° de commande", cmd.numero, 'placeholder="CVC26100432" data-maj')}
      ${champ("cmdClient", "Code client", cmd.client, 'placeholder="GASR22CUCA" data-maj')}
      ${champ("cmdRepresentant", "Représentant", cmd.representant, 'placeholder="HILLION" data-maj')}
      ${champ("cmdReference", "Référence (facultatif)", cmd.reference, 'placeholder="GILBERT-CLAUSTRA"')}
      ${champ("cmdSemaine", "Livraison : semaine", cmd.semaine, 'inputmode="numeric" placeholder="45"')}
      ${champ("cmdAnnee", "Année", cmd.annee, 'inputmode="numeric"')}
    </div></section>`;
  etat.claustras.forEach((c, i) => {
    const r = piecesDuClaustra(c);
    html += `<section class="carte claustra" data-i="${i}"><div class="carte-titre ligne-titre"><span>Claustra ${i + 1}</span>
      ${etat.claustras.length > 1 ? `<button type="button" class="texte" data-retirer="${i}">✕ Retirer</button>` : ""}</div>
      <div class="grille">
        ${champ(`c${i}ligne`, "Ligne de la commande", c.ligne, 'inputmode="numeric"')}
        ${champ(`c${i}coloris`, "Coloris", c.coloris, 'placeholder="1047" data-maj')}
        ${champ(`c${i}epaisseur`, "Épaisseur (mm)", c.epaisseur, 'inputmode="numeric"')}
        ${champ(`c${i}longueur`, "Longueur (mm)", c.longueur, 'inputmode="numeric" placeholder="600"')}
        ${champ(`c${i}hauteur`, "Hauteur (mm)", c.hauteur, 'inputmode="numeric" placeholder="1400"')}
        ${champ(`c${i}profondeurLisses`, "Profondeur des lisses (mm)", c.profondeurLisses, 'inputmode="numeric" placeholder="78"')}
        ${champ(`c${i}droites`, "Lames droites : nombre", c.droites, 'inputmode="numeric" placeholder="1"')}
        ${champ(`c${i}largeurDroites`, "Lames droites : largeur (mm)", c.largeurDroites, 'inputmode="numeric" placeholder="78"')}
        ${champ(`c${i}obliques`, "Lames obliques : nombre", c.obliques, 'inputmode="numeric" placeholder="0"')}
        ${champ(`c${i}largeurObliques`, "Lames obliques : largeur (mm)", c.largeurObliques, 'inputmode="numeric" placeholder="75"')}
        ${champ(`c${i}agglo`, "Agglo", c.agglo, "data-maj")}
      </div>
      <div class="options">
        <span class="libelle-options">Montage :</span>
        <label><input type="radio" name="c${i}montage" value="1" ${c.montage ? "checked" : ""}> inclus (A MONTER)</label>
        <label><input type="radio" name="c${i}montage" value="0" ${c.montage ? "" : "checked"}> non inclus (ENKIT)</label>
        <label class="separe"><input type="checkbox" id="c${i}protection" ${c.protection ? "checked" : ""}> Protection (emballage)</label>
      </div>
      ${r.erreurs.length ? `<div class="manque">À remplir : ${echapper(r.erreurs.join(", "))}</div>` : ""}
    </section>`;
  });
  html += `<div class="boutons"><button type="button" class="contour" id="btnAjouter">+ Ajouter un claustra (autre ligne)</button>
    <button type="button" class="texte" id="btnNouveau">Nouvelle commande</button></div>`;

  const { lignes, noms, manque } = lignesDuFichier();
  const nom = etat.nomFichier || nomParDefaut();
  nomAffiche = nom;
  html += `<section class="carte"><div class="carte-titre">Fichier de lancement</div>`;
  if (lignes.length) {
    const col = (n) => COLONNES_LAN.indexOf(n);
    html += `<div class="defile"><table class="apercu"><thead><tr><th>Ligne</th><th>Pièce</th><th class="droite">Fini</th><th class="droite">Débit</th><th class="droite">Qté</th><th>Agglo</th><th>Couleur</th><th>Commentaire</th></tr></thead><tbody>`;
    lignes.forEach((l, k) => {
      html += `<tr class="${k % 2 ? "impaire" : ""}"><td>${echapper(l[col("commande+ligne")])}</td><td>${echapper(noms[k])}</td>
        <td class="droite">${echapper(l[col("LongueurxLargeurxEpaisseur fini")])}</td><td class="droite">${echapper(l[col("LongueurxLargeur debit")])}</td>
        <td class="droite">${echapper(l[col("comdet_qte")])}</td><td>${echapper(l[col("agglo")])}</td><td>${echapper(l[col("coloris")] || "")}</td><td>${echapper(l[col("commentaire")])}</td></tr>`;
    });
    html += "</tbody></table></div>";
  }
  if (manque.length) html += `<div class="manque">Pour fabriquer le fichier, il manque : ${echapper(manque.join(" · "))}</div>`;
  html += `<div class="ligne-fichier">${champ("nomFichier", "Nom du fichier", nom)}<span class="extension">.xlsx</span>
    <button type="button" id="btnFabriquer" ${manque.length || !lignes.length ? "disabled" : ""}>Enregistrer le fichier de lancement</button></div>
    <div class="compte-rendu" id="compteRendu"></div></section>`;
  $("contenu").innerHTML = html;
  brancher();
}

function lireFormulaire() {
  const v = (id) => ($(id) ? $(id).value : "");
  Object.assign(etat.commande, {
    numero: v("cmdNumero"), client: v("cmdClient"), representant: v("cmdRepresentant"), reference: v("cmdReference"), semaine: v("cmdSemaine"), annee: v("cmdAnnee"),
  });
  etat.claustras.forEach((c, i) => {
    for (const k of ["ligne", "coloris", "epaisseur", "longueur", "hauteur", "profondeurLisses", "droites", "largeurDroites", "obliques", "largeurObliques", "agglo"]) c[k] = v(`c${i}${k}`);
    const m = document.querySelector(`input[name="c${i}montage"]:checked`);
    const montage = m ? m.value === "1" : c.montage;
    // La protection suit le montage (A MONTER : emballée), sauf si on l'a changée à la main.
    if (montage !== c.montage && $(`c${i}protection`).checked === c.montage) $(`c${i}protection`).checked = montage;
    c.montage = montage;
    c.protection = $(`c${i}protection`).checked;
  });
  if ($("nomFichier")) {
    const n = $("nomFichier").value.trim();
    // Nom proposé non changé à la main : il suit la semaine et l'année.
    etat.nomFichier = n === nomAffiche || n === nomParDefaut() ? "" : n;
  }
}

let minuteur = null;
let nomAffiche = "";
function brancher() {
  const page = $("contenu");
  page.querySelectorAll("input").forEach((x) =>
    x.addEventListener(x.type === "radio" || x.type === "checkbox" ? "change" : "input", () => {
      lireFormulaire();
      garderBrouillon();
      // Réaffiche après la frappe (sans perdre la saisie en cours).
      clearTimeout(minuteur);
      const actif = document.activeElement && document.activeElement.id;
      const debut = document.activeElement && document.activeElement.selectionStart;
      minuteur = setTimeout(() => {
        afficher();
        const x2 = actif && $(actif);
        if (x2) {
          x2.focus();
          try {
            if (debut != null) x2.setSelectionRange(debut, debut);
          } catch (_e) {
            // champ sans curseur
          }
        }
      }, x.type === "radio" || x.type === "checkbox" ? 0 : 500);
    })
  );
  page.querySelectorAll("[data-retirer]").forEach((b) =>
    b.addEventListener("click", () => {
      lireFormulaire();
      etat.claustras.splice(Number(b.dataset.retirer), 1);
      garderBrouillon();
      afficher();
    })
  );
  $("btnAjouter").addEventListener("click", () => {
    lireFormulaire();
    const dernier = etat.claustras[etat.claustras.length - 1];
    const c = nouveauClaustra((Number(dernier.ligne) || etat.claustras.length) + 1);
    c.coloris = dernier.coloris;
    etat.claustras.push(c);
    garderBrouillon();
    afficher();
  });
  $("btnNouveau").addEventListener("click", () => {
    if (!confirm("Effacer la commande et repartir de zéro ?")) return;
    etat = { commande: { numero: "", client: "", representant: "", reference: "", semaine: "", annee: String(new Date().getFullYear()) }, claustras: [nouveauClaustra(1)], nomFichier: "" };
    garderBrouillon();
    afficher();
  });
  $("btnFabriquer").addEventListener("click", async () => {
    lireFormulaire();
    const { lignes, manque } = lignesDuFichier();
    if (manque.length || !lignes.length) return afficher();
    const nom = `${(etat.nomFichier || nomParDefaut()).replace(/\.xlsx$/i, "")}.xlsx`;
    try {
      const enregistre = await enregistrer(nom, await classeurLancement(lignes));
      if (enregistre) $("compteRendu").textContent = `✔ Enregistré : ${enregistre} (${lignes.length} ligne(s)).`;
    } catch (e) {
      $("compteRendu").textContent = `Impossible d'enregistrer : ${e && e.message ? e.message : e}`;
    }
  });
}

document.querySelectorAll("img[data-logo]").forEach((img) => (img.src = LOGO_BLANC_PNG));
lireBrouillon();
afficher();
