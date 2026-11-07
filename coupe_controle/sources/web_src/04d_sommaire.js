// ---- Sommaire des matériaux Cut Rite → 3 rapports PDF ----
// Le sommaire (imprimé en PDF depuis Cut Rite) donne, pour chaque matière du
// lancement, le nombre de panneaux et de restes. On en tire trois rapports :
// agglo (panneaux et restes), strats, et couleurs de la feuille de réception
// (+ hors gamme), avec le nombre de pièces et la couleur de la semaine.

// Couleurs de la feuille de réception (La Chapelle), dans son ordre ; largeur de leur format.
const COULEURS_FEUILLE = ["1136", "1132", "1109", "1065", "1062", "1048", "1047", "1136-PF", "1132-PF", "1065-PF", "1062-PF", "1048-PF", "1047-PF"];
const LARGEUR_FEUILLE = "2060";
// Couleurs des semaines, dans l'ordre du cycle (46 : rose, 47 : bleu, 48 : blanc…) ; la casse est en jaune.
const CYCLE_COULEURS = ["BLANC", "ROSE", "BLEU"];
const COULEUR_CASSE = "JAUNE";

const couleurSemaine = (semaine, casse) => (casse ? COULEUR_CASSE : CYCLE_COULEURS[((semaine % 3) + 3) % 3]);

function epaisseurMateriau(m) {
  const e = /Epaisseur\s+(\d+(?:\.\d+)?)/.exec(m.description) || /(\d+)\s*MM\b/.exec(m.description);
  return e ? parseFloat(e[1]) : null;
}
// Panneau d'agglo (ou mélaminé, martyr) : tout ce qui n'est pas un stratifié.
const estAggloMateriau = (m) => (epaisseurMateriau(m) || 0) >= 2 || /^(SAG|SMEL|PROTECTION)/.test(m.code);
const designationMateriau = (m) =>
  m.description
    .replace(/\s*Epaiss.*$/, "")
    .replace(/^STRAT\s+/, "")
    .replace(/\.\.\./g, "")
    .trim();
// « 4110 × 2060 » ; largeur coupée dans le sommaire : celle de la feuille de réception.
function formatMateriau(m) {
  const f = /(\d{4})\*(\d*)/.exec(m.description);
  if (!f) return "—";
  return `${f[1]} × ${f[2].length === 4 ? f[2] : LARGEUR_FEUILLE}`;
}

// Le texte arrive ligne par ligne : « CODE DESCRIPTION… Epaisseur x Pqt. n », puis
// « [CODE] [STRAT] panneaux restes » ; à la fin, le total.
function lireSommaireCutRite(lignes) {
  const s = { lancement: "", date: "", materiaux: [], totalPanneaux: 0, totalRestes: 0, sansQuantites: [], ecartTotal: null };
  const parCode = new Map();
  let courant = null;
  let total = null;
  for (const brute of lignes) {
    const l = String(brute).replace(/\s+/g, " ").trim();
    const lancement = /(LAN\w+?)-Code/.exec(l);
    if (!s.lancement && lancement) s.lancement = lancement[1];
    const date = /(?:Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche) (\d+ \S+ \d{4}) (\d\d:\d\d)/.exec(l);
    if (!s.date && date) s.date = `${date[1]} ${date[2]}`;
    const q = /^(?:(\S+)\s+)?(?:STRAT\s+)?(\d+)\s+(\d+)$/.exec(l);
    if (q) {
      const code = q[1];
      if (courant && courant.panneaux < 0 && (!code || code === courant.code || code === "STRAT")) {
        courant.panneaux = parseInt(q[2], 10);
        courant.restes = parseInt(q[3], 10);
        courant.sansCode = !code;
      } else if (!code) {
        total = [parseInt(q[2], 10), parseInt(q[3], 10)];
      }
      continue;
    }
    const mots = l.split(" ");
    // Une suite de description (« 38.0 Pqt. 1 ») ne commence pas par un code matière.
    if (mots.length < 3 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(mots[0])) continue; // RCB_0003_PORTES : tiret bas permis
    if (["LAISNE", "Sommaire", "Code"].includes(mots[0]) || parCode.has(mots[0])) continue;
    courant = { code: mots[0], description: l.slice(mots[0].length).trim(), panneaux: -1, restes: -1 };
    parCode.set(courant.code, courant);
  }
  // Dernier panneau sans ses quantités : la ligne du total (sans code) lui a été donnée. Elle se reconnaît :
  // elle vaut au moins la somme de tous les autres panneaux.
  const tous = [...parCode.values()];
  const dernier = tous[tous.length - 1];
  const autres = tous.slice(0, -1).filter((m) => m.panneaux >= 0);
  if (!total && dernier && dernier.sansCode && autres.length >= 3) {
    const [p, r] = [totalMateriaux(autres, "panneaux"), totalMateriaux(autres, "restes")];
    if (p > 0 && dernier.panneaux >= p && dernier.restes >= r) {
      total = [dernier.panneaux, dernier.restes];
      dernier.panneaux = -1;
    }
  }
  for (const m of tous) {
    delete m.sansCode;
    // Panneau à zéro dont Cut Rite n'a pas imprimé les quantités comme d'habitude : compté 0, signalé dans le rapport
    // (le rapport sort quand même).
    if (m.panneaux < 0) {
      m.panneaux = 0;
      m.restes = 0;
      s.sansQuantites.push(m.code);
    }
    s.materiaux.push(m);
    s.totalPanneaux += m.panneaux;
    s.totalRestes += m.restes;
  }
  if (!s.materiaux.length) throw new Error("Ce PDF n'est pas un sommaire des matériaux Cut Rite.");
  if (total && (total[0] !== s.totalPanneaux || total[1] !== s.totalRestes)) {
    s.ecartTotal = `total du sommaire ${total[0]} panneaux / ${total[1]} restes, lu ${s.totalPanneaux} / ${s.totalRestes}`;
  }
  return s;
}

// Ce qui n'a pas pu être lu normalement dans le sommaire (null si tout est lu).
function avertissementSommaire(s) {
  const a = [];
  if (s.sansQuantites.length) a.push(`quantités illisibles pour ${s.sansQuantites.join(", ")} (comptées 0 : vérifiez sur le sommaire)`);
  if (s.ecartTotal) a.push(s.ecartTotal);
  return a.length ? `Sommaire Cut Rite : ${a.join(" ; ")}.` : null;
}

const aggloSommaire = (s) => s.materiaux.filter(estAggloMateriau);
const stratsSommaire = (s) => s.materiaux.filter((m) => !estAggloMateriau(m));
const couleursFeuilleSommaire = (s) => COULEURS_FEUILLE.map((c) => s.materiaux.find((m) => m.code === c)).filter(Boolean);
const couleursAbsentesSommaire = (s) => COULEURS_FEUILLE.filter((c) => !s.materiaux.some((m) => m.code === c));
// Hors gamme : couleur dont le code commence par une lettre (le contrebalancement RCB n'en est pas une).
const horsGammeSommaire = (s) => stratsSommaire(s).filter((m) => /^[A-Za-z]/.test(m.code) && !m.code.startsWith("RCB"));
const totalMateriaux = (liste, champ) => liste.reduce((t, m) => t + m[champ], 0);
// « LAN264601START » → « LAN264601 ».
const baseSommaire = (s) => s.lancement.replace(/(STRAT|START)$/, "") || "Sommaire";

// ---- Petit générateur de PDF (A4, polices de la charte Laisné Industrie intégrées —
// Raleway pour les titres, Lato pour le texte —, texte, rectangles, filets, pastilles et logo) ----

const PDF_LARGEUR = 595.28;
const PDF_HAUTEUR = 841.89;
const PDF_MM = 72 / 25.4;
// Polices, dans l'ordre de POLICES_PDF.
const POLICE = { TITRE: 0, TEXTE: 1, GRAS: 2, ITALIQUE: 3 };
const WINANSI_SPECIAUX = { "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f };

// Signes absents des polices du PDF : écrits autrement (sinon « ? »).
const PDF_REMPLACES = { "→": "->", "←": "<-", "⇒": "=>", "✔": "OK", "✓": "OK", "✗": "x", "✘": "x", "⚠": "!", "✎": "", "▸": ">", "▾": "v", "≥": ">=", "≤": "<=", "−": "-", "≠": "<>" };

function codesWinAnsi(texte) {
  const codes = [];
  for (const c of String(texte)) {
    if (PDF_REMPLACES[c] !== undefined) {
      for (const r of PDF_REMPLACES[c]) codes.push(r.codePointAt(0));
      continue;
    }
    const n = c.codePointAt(0);
    if (n < 0x80 || (n >= 0xa0 && n <= 0xff)) codes.push(n);
    else codes.push(WINANSI_SPECIAUX[c] ?? 0x3f);
  }
  return codes;
}

// Largeur du texte en points (espacement : espace ajouté après chaque lettre).
function largeurTextePdf(texte, taille, police, espacement = 0) {
  const l = POLICES_PDF[police].largeurs;
  const codes = codesWinAnsi(texte);
  return (codes.reduce((t, c) => t + (c >= 32 ? l[c - 32] : 0), 0) * taille) / 1000 + espacement * codes.length;
}

const nombrePdf = (v) => {
  const s = v.toFixed(2);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
};
const couleurPdf = (rgb) => `${nombrePdf(((rgb >> 16) & 0xff) / 255)} ${nombrePdf(((rgb >> 8) & 0xff) / 255)} ${nombrePdf((rgb & 0xff) / 255)}`;

// Coupe un texte en lignes qui tiennent dans largeurMax (mot à mot, mot trop long coupé).
function couperTextePdf(texte, largeurMax, taille, police) {
  const lignes = [];
  let courante = "";
  for (let mot of String(texte).split(" ")) {
    if (!mot) continue;
    const essai = courante ? `${courante} ${mot}` : mot;
    if (largeurTextePdf(essai, taille, police) <= largeurMax) {
      courante = essai;
      continue;
    }
    if (courante) lignes.push(courante);
    courante = "";
    while (largeurTextePdf(mot, taille, police) > largeurMax && mot.length > 1) {
      let k = mot.length - 1;
      while (k > 1 && largeurTextePdf(mot.slice(0, k), taille, police) > largeurMax) k--;
      lignes.push(mot.slice(0, k));
      mot = mot.slice(k);
    }
    courante = mot;
  }
  if (courante || !lignes.length) lignes.push(courante);
  return lignes;
}

const octetsBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const octetsLatin1 = (texte) => Uint8Array.from(texte, (c) => c.charCodeAt(0) & 0xff);

class PdfSimple {
  constructor(titre) {
    this.titre = titre;
    this.pages = [];
    this.nouvellePage();
  }

  nouvellePage() {
    this.page = [];
    this.pages.push(this.page);
  }

  // Reprend l'écriture sur une page déjà créée (pieds de page, une fois le nombre de pages connu).
  allerPage(index) {
    this.page = this.pages[index];
  }

  // Texte dont la ligne de base est à y points du haut de la page.
  texte(x, y, texte, taille, police, rgb, espacement = 0) {
    const chaine = codesWinAnsi(texte)
      .map((c) => (c === 40 || c === 41 || c === 92 ? `\\${String.fromCharCode(c)}` : c < 32 || c > 126 ? `\\${c.toString(8).padStart(3, "0")}` : String.fromCharCode(c)))
      .join("");
    this.page.push(`BT /F${police + 1} ${nombrePdf(taille)} Tf ${nombrePdf(espacement)} Tc ${couleurPdf(rgb)} rg ${nombrePdf(x)} ${nombrePdf(PDF_HAUTEUR - y)} Td (${chaine}) Tj ET\n`);
  }

  // Rectangle dont le coin haut gauche est en (x, y) ; fond et trait facultatifs (null).
  rectangle(x, y, l, h, fond, trait, epaisseur) {
    const r = `${nombrePdf(x)} ${nombrePdf(PDF_HAUTEUR - y - h)} ${nombrePdf(l)} ${nombrePdf(h)} re `;
    if (fond !== null) this.page.push(`${couleurPdf(fond)} rg ${r}f\n`);
    if (trait !== null) this.page.push(`${couleurPdf(trait)} RG ${nombrePdf(epaisseur)} w ${r}S\n`);
  }

  // Hachures à 45° dans un rectangle (coin haut gauche en x, y) : lisibles en noir et blanc.
  hachures(x, y, l, h, rgb, pas, epaisseur) {
    const n = nombrePdf;
    const yb = PDF_HAUTEUR - y - h;
    let s = `q ${n(x)} ${n(yb)} ${n(l)} ${n(h)} re W n ${couleurPdf(rgb)} RG ${n(epaisseur)} w `;
    for (let d = -h; d < l; d += pas) s += `${n(x + d)} ${n(yb)} m ${n(x + d + h)} ${n(yb + h)} l `;
    this.page.push(`${s}S Q\n`);
  }

  // Contour en pointillés (place laissée vide).
  pointilles(x, y, l, h, rgb, epaisseur, tiret) {
    this.page.push(`q [${nombrePdf(tiret)} ${nombrePdf(tiret * 0.7)}] 0 d ${couleurPdf(rgb)} RG ${nombrePdf(epaisseur)} w ${nombrePdf(x)} ${nombrePdf(PDF_HAUTEUR - y - h)} ${nombrePdf(l)} ${nombrePdf(h)} re S Q\n`);
  }

  // Filet horizontal à y points du haut, de x1 à x2.
  filet(x1, x2, y, rgb, epaisseur) {
    this.page.push(`${couleurPdf(rgb)} RG ${nombrePdf(epaisseur)} w ${nombrePdf(x1)} ${nombrePdf(PDF_HAUTEUR - y)} m ${nombrePdf(x2)} ${nombrePdf(PDF_HAUTEUR - y)} l S\n`);
  }

  // Disque plein de centre (cx, cy) (quatre arcs de Bézier).
  disque(cx, cy, r, fond) {
    const k = 0.5523 * r;
    const y = PDF_HAUTEUR - cy;
    const n = nombrePdf;
    this.page.push(
      `${couleurPdf(fond)} rg ${n(cx + r)} ${n(y)} m ${n(cx + r)} ${n(y + k)} ${n(cx + k)} ${n(y + r)} ${n(cx)} ${n(y + r)} c ` +
        `${n(cx - k)} ${n(y + r)} ${n(cx - r)} ${n(y + k)} ${n(cx - r)} ${n(y)} c ${n(cx - r)} ${n(y - k)} ${n(cx - k)} ${n(y - r)} ${n(cx)} ${n(y - r)} c ` +
        `${n(cx + k)} ${n(y - r)} ${n(cx + r)} ${n(y - k)} ${n(cx + r)} ${n(y)} c f\n`
    );
  }

  // Logo Laisné Industrie (version couleur, fond blanc) : coin haut gauche en (x, y), largeur donnée ; renvoie sa hauteur.
  logo(x, y, largeur) {
    const h = (largeur * LOGO_PDF.hauteur) / LOGO_PDF.largeur;
    this.page.push(`q ${nombrePdf(largeur)} 0 0 ${nombrePdf(h)} ${nombrePdf(x)} ${nombrePdf(PDF_HAUTEUR - y - h)} cm /Logo Do Q\n`);
    return h;
  }

  octets() {
    // 1 catalogue, 2 pages, 3 informations, 4 logo, puis 3 objets par police (police, descripteur, fichier),
    // puis page + contenu pour chaque page. Chaque objet : [dictionnaire, flux binaire ou null].
    const premierePage = 5 + 3 * POLICES_PDF.length;
    const objets = [
      ["<< /Type /Catalog /Pages 2 0 R >>", null],
      [`<< /Type /Pages /Kids [${this.pages.map((_, i) => `${premierePage + 2 * i} 0 R`).join(" ")}] /Count ${this.pages.length} >>`, null],
      // Titre en UTF-16 (les informations du PDF ne sont pas en WinAnsi).
      [`<< /Producer (Sentinelle) /Author (LAISNE INDUSTRIE) /Title <FEFF${this.titre.split("").map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")).join("")}> >>`, null],
    ];
    const logo = octetsBase64(LOGO_PDF.jpeg);
    objets.push([`<< /Type /XObject /Subtype /Image /Width ${LOGO_PDF.largeur} /Height ${LOGO_PDF.hauteur} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.length} >>`, logo]);
    const polices = [];
    POLICES_PDF.forEach((p, i) => {
      const num = 5 + 3 * i;
      objets.push([`<< /Type /Font /Subtype /TrueType /BaseFont /${p.nom} /FirstChar 32 /LastChar 255 /Widths [${p.largeurs.join(" ")}] /Encoding /WinAnsiEncoding /FontDescriptor ${num + 1} 0 R >>`, null]);
      const [ascent, descent, capHeight, angle] = p.metriques;
      objets.push([
        `<< /Type /FontDescriptor /FontName /${p.nom} /Flags ${p.italique ? 96 : 32} /FontBBox [${p.bbox.join(" ")}] /ItalicAngle ${angle} /Ascent ${ascent} /Descent ${descent} /CapHeight ${capHeight} /StemV ${i === 1 || i === 3 ? 80 : 140} /FontFile2 ${num + 2} 0 R >>`,
        null,
      ]);
      const ttf = octetsBase64(p.ttf);
      objets.push([`<< /Length ${ttf.length} /Length1 ${ttf.length} >>`, ttf]);
      polices.push(`/F${i + 1} ${num} 0 R`);
    });
    this.pages.forEach((page, i) => {
      objets.push([
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${nombrePdf(PDF_LARGEUR)} ${nombrePdf(PDF_HAUTEUR)}] /Resources << /Font << ${polices.join(" ")} >> /XObject << /Logo 4 0 R >> >> /Contents ${premierePage + 2 * i + 1} 0 R >>`,
        null,
      ]);
      const contenu = octetsLatin1(page.join(""));
      objets.push([`<< /Length ${contenu.length} >>`, contenu]);
    });

    const morceaux = [];
    let taille = 0;
    const ecrire = (o) => {
      const b = typeof o === "string" ? octetsLatin1(o) : o;
      morceaux.push(b);
      taille += b.length;
    };
    ecrire("%PDF-1.4\n%âãÏÓ\n");
    const positions = [];
    objets.forEach(([dictionnaire, flux], i) => {
      positions.push(taille);
      ecrire(`${i + 1} 0 obj\n${dictionnaire}`);
      if (flux) {
        ecrire("\nstream\n");
        ecrire(flux);
        ecrire("\nendstream");
      }
      ecrire("\nendobj\n");
    });
    const xref = taille;
    ecrire(`xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`);
    ecrire(`trailer\n<< /Size ${objets.length + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const sortie = new Uint8Array(taille);
    let pos = 0;
    for (const b of morceaux) {
      sortie.set(b, pos);
      pos += b.length;
    }
    return sortie;
  }
}

// ---- Rapports : une partie = un tableau (avec, sauf exception, sa ligne de total
// panneaux / restes), une ligne d'état facultative au-dessus, des notes en dessous ----

// Charte graphique Laisné Industrie : A4, marges de 18 mm, bandeau bordeaux de 7 mm, pied de page à 12 mm du bord.
const CHARTE = { BORDEAUX: 0x78140c, SAUMON: 0xeac2b7, SAUMON_PALE: 0xfaf0ec, GRIS: 0x797978, GRIS_CLAIR: 0xf4f3f1, GRIS_FILET: 0xe9e7e3, NOIR: 0x22231d, BLANC: 0xffffff };
const RAPPORT_MARGE = 18 * PDF_MM;
const RAPPORT_UTILE = PDF_LARGEUR - 2 * RAPPORT_MARGE;
const RAPPORT_BANDEAU = 7 * PDF_MM;
const RAPPORT_LOGO = 38 * PDF_MM;
const RAPPORT_BAS = PDF_HAUTEUR - 20 * PDF_MM;
const RAPPORT_TAILLE = 8.8;
const RAPPORT_TAILLE_ENTETE = 8;
const RAPPORT_INTERLIGNE = 11;
const RAPPORT_REMPLISSAGE = 4.5;
// État d'une partie : tout va bien (encadré gris) ; les autres états sont mis en avant (encadré bordeaux).
const STATUT = { OK: 0x2e7d32, ATTENTION: 0xe65100, ALERTE: 0xc62828 };
// Pastille de la couleur de la semaine (étiquettes de l'atelier).
const couleurDuNom = (c) => ({ ROSE: 0xe58fb0, BLEU: 0x3d7cc9, JAUNE: 0xf2c230 })[c] ?? CHARTE.BLANC;

const partieRapport = (nom, titre, entete, largeursMm, nbColonnesTexte) => ({
  nom, titre, entete, largeursMm, nbColonnesTexte, total: true, statut: null, couleurStatut: CHARTE.NOIR, rangees: [], notes: [],
});
// « LAN264601START.xlsx » → « LAN264601 ».
const baseLancement = (nom) => nom.replace(/\.[A-Za-z]+$/, "").replace(/(STRAT|START)$/, "") || "Sommaire";
const sousTitreSommaire = (s) => `${s.lancement} · sommaire Cut Rite du ${s.date}`;

// Les trois listes du sommaire : agglo, strats, couleurs de la feuille.
function partiesSommaire(s) {
  const base = baseSommaire(s);
  const agglo = partieRapport("Agglo", `${base} — Agglo : panneaux et restes`, ["Code", "Désignation", "Ép. (mm)", "Panneaux", "Restes"], [38, 86, 16, 22, 20], 3);
  for (const m of aggloSommaire(s)) {
    const e = epaisseurMateriau(m);
    agglo.rangees.push([m.code, designationMateriau(m), e === null ? "" : String(e), String(m.panneaux), String(m.restes)]);
  }
  const strats = partieRapport("Strats", `${base} — Strats : panneaux et restes`, ["Code", "Désignation", "Panneaux", "Restes"], [26, 114, 22, 20], 2);
  for (const m of stratsSommaire(s)) strats.rangees.push([m.code, designationMateriau(m), String(m.panneaux), String(m.restes)]);
  const couleurs = partieRapport("Couleurs", `${base} — Couleurs de la feuille`, ["Couleur", "Désignation", "Format", "Panneaux", "Restes"], [22, 90, 30, 22, 18], 3);
  for (const m of couleursFeuilleSommaire(s)) couleurs.rangees.push([m.code, designationMateriau(m), formatMateriau(m), String(m.panneaux), String(m.restes)]);
  const absentes = couleursAbsentesSommaire(s);
  if (absentes.length) couleurs.notes.push(["Pas dans ce lancement : ", absentes.join(", ")]);
  const horsGamme = horsGammeSommaire(s).map((m) => `${m.code} (${m.panneaux} panneau(x), ${m.restes} reste(s))`);
  couleurs.notes.push(["Hors gamme : ", horsGamme.length ? horsGamme.join(", ") : "aucune dans ce lancement"]);
  const avertissement = avertissementSommaire(s);
  if (avertissement) [agglo.statut, agglo.couleurStatut] = [avertissement, STATUT.ATTENTION];
  return [agglo, strats, couleurs];
}

function avecTotal(p) {
  const total = p.entete.map(() => "");
  total[0] = "Total";
  total[total.length - 2] = String(p.rangees.reduce((t, r) => t + parseInt(r[r.length - 2], 10), 0));
  total[total.length - 1] = String(p.rangees.reduce((t, r) => t + parseInt(r[r.length - 1], 10), 0));
  return [...p.rangees, total];
}

// Bandeau bordeaux pleine largeur en tête de page, sans texte.
const bandeauPdf = (pdf) => pdf.rectangle(0, 0, PDF_LARGEUR, RAPPORT_BANDEAU, CHARTE.BORDEAUX, null, 0);

// Confidentialité à gauche, nom du document au centre, pagination à droite (7,5 pt, gris).
function piedsDePagePdf(pdf, nomDocument) {
  const y = PDF_HAUTEUR - 12 * PDF_MM;
  const n = pdf.pages.length;
  for (let i = 0; i < n; i++) {
    pdf.allerPage(i);
    pdf.texte(RAPPORT_MARGE, y, "Document interne — LAISNÉ INDUSTRIE", 7.5, POLICE.TEXTE, CHARTE.GRIS);
    const nom = couperTextePdf(nomDocument, RAPPORT_UTILE / 2, 7.5, POLICE.TEXTE)[0];
    pdf.texte(PDF_LARGEUR / 2 - largeurTextePdf(nom, 7.5, POLICE.TEXTE) / 2, y, nom, 7.5, POLICE.TEXTE, CHARTE.GRIS);
    const page = `${i + 1} / ${n}`;
    pdf.texte(PDF_LARGEUR - RAPPORT_MARGE - largeurTextePdf(page, 7.5, POLICE.TEXTE), y, page, 7.5, POLICE.TEXTE, CHARTE.GRIS);
  }
}

// Chiffre clé : valeur en Raleway bordeaux, légende en Lato gris, fond saumon pâle et barre bordeaux à gauche.
function chiffreClePdf(pdf, x, y, valeur, legende, pastille) {
  const l = 54 * PDF_MM;
  const h = 15 * PDF_MM;
  pdf.rectangle(x, y, l, h, CHARTE.SAUMON_PALE, null, 0);
  pdf.rectangle(x, y, 3, h, CHARTE.BORDEAUX, null, 0);
  let xv = x + 12;
  if (pastille !== null) {
    pdf.rectangle(xv, y + 9, 13, 13, pastille, CHARTE.GRIS_FILET, 0.8);
    xv += 19;
  }
  pdf.texte(xv, y + 21, valeur, 17, POLICE.TITRE, CHARTE.BORDEAUX);
  pdf.texte(x + 12, y + h - 7, legende, 7.8, POLICE.TEXTE, CHARTE.GRIS);
  return x + l + 5 * PDF_MM;
}

// Pastille numérotée (cercle saumon de 6 mm, chiffre bordeaux à deux chiffres) ; renvoie la fin de la pastille.
function pastillePdf(pdf, x, yBase, numero) {
  const r = 3 * PDF_MM;
  const n = String(numero).padStart(2, "0");
  pdf.disque(x + r, yBase - 4, r, CHARTE.SAUMON);
  pdf.texte(x + r - largeurTextePdf(n, 8, POLICE.TITRE) / 2, yBase - 1.2, n, 8, POLICE.TITRE, CHARTE.BORDEAUX);
  return x + 2 * r;
}

// Encadré de mise en avant : fond saumon pâle, barre bordeaux à gauche, texte bordeaux gras (gris pour un état normal).
function encadrePdf(pdf, y, texte, enAvant) {
  const lignes = couperTextePdf(texte, RAPPORT_UTILE - 24, 9.5, POLICE.GRAS);
  const h = lignes.length * 13 + 14;
  pdf.rectangle(RAPPORT_MARGE, y, RAPPORT_UTILE, h, enAvant ? CHARTE.SAUMON_PALE : CHARTE.GRIS_CLAIR, null, 0);
  pdf.rectangle(RAPPORT_MARGE, y, 3, h, enAvant ? CHARTE.BORDEAUX : CHARTE.GRIS, null, 0);
  lignes.forEach((ligne, k) => pdf.texte(RAPPORT_MARGE + 12, y + 7 + 9.5 + 13 * k, ligne, 9.5, POLICE.GRAS, enAvant ? CHARTE.BORDEAUX : CHARTE.NOIR));
  return y + h;
}

// Largeurs des colonnes, ramenées à la largeur utile de la page.
function largeursPdf(p) {
  const somme = p.largeursMm.reduce((t, v) => t + v, 0);
  return p.largeursMm.map((v) => (v * RAPPORT_UTILE) / somme);
}

// Colonne alignée à droite : à partir de nbColonnesTexte (nombre) ou dans la liste donnée.
const aDroitePdf = (nbColonnesTexte, j) => (Array.isArray(nbColonnesTexte) ? nbColonnesTexte.includes(j) : j >= nbColonnesTexte);

// En-tête de tableau : fond bordeaux, texte blanc en capitales espacées.
function enteteTableauPdf(pdf, y, entete, l, nbColonnesTexte) {
  const capitales = entete.map((e) => e.toLocaleUpperCase("fr"));
  const morceaux = capitales.map((c, j) => couperTextePdf(c, l[j] - 2 * RAPPORT_REMPLISSAGE - 6, RAPPORT_TAILLE_ENTETE, POLICE.GRAS));
  const h = Math.max(1, ...morceaux.map((m) => m.length)) * 10 + 12;
  pdf.rectangle(RAPPORT_MARGE, y, RAPPORT_UTILE, h, CHARTE.BORDEAUX, null, 0);
  let x = RAPPORT_MARGE;
  morceaux.forEach((m, j) => {
    const haut = y + (h - m.length * 10) / 2 + 7.5;
    m.forEach((t, k) => {
      const lt = largeurTextePdf(t, RAPPORT_TAILLE_ENTETE, POLICE.GRAS, 0.6);
      const xt = aDroitePdf(nbColonnesTexte, j) ? x + l[j] - RAPPORT_REMPLISSAGE - lt : x + RAPPORT_REMPLISSAGE;
      pdf.texte(xt, haut + k * 10, t, RAPPORT_TAILLE_ENTETE, POLICE.GRAS, CHARTE.BLANC, 0.6);
    });
    x += l[j];
  });
  return y + h;
}

const policeCellulePdf = (police, colonne) => (colonne === 0 ? POLICE.GRAS : police);

function hauteurRangeePdf(cellules, l, police) {
  let n = 1;
  cellules.forEach((c, j) => (n = Math.max(n, couperTextePdf(c, l[j] - 2 * RAPPORT_REMPLISSAGE, RAPPORT_TAILLE, policeCellulePdf(police, j)).length)));
  return n * RAPPORT_INTERLIGNE + 2 * RAPPORT_REMPLISSAGE;
}

// Dessine une rangée (texte à gauche, nombres à droite, sans filets verticaux) et renvoie le bas de la rangée.
function rangeePdf(pdf, y, cellules, l, nbColonnesTexte, fond, police, rgb, filet) {
  const h = hauteurRangeePdf(cellules, l, police);
  if (fond !== null) pdf.rectangle(RAPPORT_MARGE, y, RAPPORT_UTILE, h, fond, null, 0);
  let x = RAPPORT_MARGE;
  cellules.forEach((c, j) => {
    const pj = policeCellulePdf(police, j);
    const morceaux = couperTextePdf(c, l[j] - 2 * RAPPORT_REMPLISSAGE, RAPPORT_TAILLE, pj);
    const haut = y + (h - morceaux.length * RAPPORT_INTERLIGNE) / 2 + RAPPORT_INTERLIGNE - 2.5;
    morceaux.forEach((t, k) => {
      const xt = aDroitePdf(nbColonnesTexte, j) ? x + l[j] - RAPPORT_REMPLISSAGE - largeurTextePdf(t, RAPPORT_TAILLE, pj) : x + RAPPORT_REMPLISSAGE;
      pdf.texte(xt, haut + k * RAPPORT_INTERLIGNE, t, RAPPORT_TAILLE, pj, rgb);
    });
    x += l[j];
  });
  if (filet) pdf.filet(RAPPORT_MARGE, RAPPORT_MARGE + RAPPORT_UTILE, y + h, CHARTE.GRIS_FILET, 0.5);
  return y + h;
}

// Dessine une partie à partir du haut de la page courante.
function dessinerPartie(pdf, enTete, sousTitre, p, numero, semaine, nbPieces, couleur) {
  bandeauPdf(pdf);
  const hLogo = pdf.logo(PDF_LARGEUR - RAPPORT_MARGE - RAPPORT_LOGO, RAPPORT_BANDEAU + 7 * PDF_MM, RAPPORT_LOGO);
  const largeurTitres = RAPPORT_UTILE - RAPPORT_LOGO - 8 * PDF_MM;
  let y = RAPPORT_BANDEAU + 7 * PDF_MM - 8;
  for (const ligne of couperTextePdf(enTete, largeurTitres, 26, POLICE.TITRE)) {
    y += 30;
    pdf.texte(RAPPORT_MARGE, y, ligne, 26, POLICE.TITRE, CHARTE.GRIS);
  }
  for (const ligne of couperTextePdf(sousTitre, largeurTitres, 11.5, POLICE.TITRE)) {
    y += 16;
    pdf.texte(RAPPORT_MARGE, y, ligne, 11.5, POLICE.TITRE, CHARTE.BORDEAUX);
  }
  y = Math.max(y + 10, RAPPORT_BANDEAU + 7 * PDF_MM + hLogo + 8);
  pdf.filet(RAPPORT_MARGE, PDF_LARGEUR - RAPPORT_MARGE, y, CHARTE.SAUMON, 1);
  y += 12;

  if (semaine !== null || nbPieces !== null || couleur !== null) {
    let x = RAPPORT_MARGE;
    if (semaine !== null) x = chiffreClePdf(pdf, x, y, semaine, "Semaine", null);
    if (nbPieces !== null) x = chiffreClePdf(pdf, x, y, nbPieces, "Nombre de pièces", null);
    if (couleur !== null) chiffreClePdf(pdf, x, y, couleur, "Couleurs semaine", couleurDuNom(couleur));
    y += 15 * PDF_MM + 14;
  }

  y += 14;
  const xTitre = pastillePdf(pdf, RAPPORT_MARGE, y, numero) + 8;
  for (const ligne of couperTextePdf(p.titre, PDF_LARGEUR - RAPPORT_MARGE - xTitre, 11.5, POLICE.TITRE)) {
    pdf.texte(xTitre, y, ligne, 11.5, POLICE.TITRE, CHARTE.BORDEAUX);
    y += 15;
  }
  y += 2;

  if (p.statut) y = encadrePdf(pdf, y, p.statut, p.couleurStatut !== STATUT.OK && p.couleurStatut !== CHARTE.NOIR) + 10;
  else y += 4;

  const l = largeursPdf(p);
  const lignes = p.total ? avecTotal(p) : p.rangees;
  if (lignes.length) y = enteteTableauPdf(pdf, y, p.entete, l, p.nbColonnesTexte);
  lignes.forEach((r, i) => {
    const estTotal = p.total && i === lignes.length - 1;
    const police = estTotal ? POLICE.GRAS : POLICE.TEXTE;
    if (y + hauteurRangeePdf(r, l, police) > RAPPORT_BAS) {
      pdf.nouvellePage();
      bandeauPdf(pdf);
      y = enteteTableauPdf(pdf, RAPPORT_BANDEAU + 12 * PDF_MM, p.entete, l, p.nbColonnesTexte);
    }
    const fond = estTotal ? CHARTE.BORDEAUX : i % 2 === 1 ? CHARTE.GRIS_CLAIR : null;
    y = rangeePdf(pdf, y, r, l, p.nbColonnesTexte, fond, police, estTotal ? CHARTE.BLANC : CHARTE.NOIR, !estTotal);
  });
  if (p.notes.length) {
    y += 14;
    for (const [libelle, valeur] of p.notes) {
      for (const ligne of couperTextePdf(libelle + valeur, RAPPORT_UTILE, 7.8, POLICE.ITALIQUE)) {
        if (y > RAPPORT_BAS + 10) {
          pdf.nouvellePage();
          bandeauPdf(pdf);
          y = RAPPORT_BANDEAU + 12 * PDF_MM;
        }
        pdf.texte(RAPPORT_MARGE, y, ligne, 7.8, POLICE.ITALIQUE, CHARTE.GRIS);
        y += 11;
      }
    }
  }
}

// Rapport d'un lancement : un seul PDF, chaque partie sur sa page (agglo, strats, couleurs, Diakonos…),
// avec en en-tête la case du lancement (« Agglo 1er tour », « Casse », « Feno », le chantier…).
function rapportLancementPdf(titre, enTete, sousTitre, semaine, nbPieces, couleur, parties) {
  const pdf = new PdfSimple(titre);
  parties.forEach((p, i) => {
    if (i > 0) pdf.nouvellePage();
    dessinerPartie(pdf, enTete, sousTitre, p, i + 1, semaine, nbPieces, couleur);
  });
  piedsDePagePdf(pdf, titre);
  return pdf.octets();
}
