// ---- V6.2 : Suivi de production ----
// L'avancement de chaque lancement de la bibliothèque, d'après l'extraction « Suivi production » de Diakonos
// (suivi_production_JJMMAAAA.xlsx). Une pièce du lancement encore dans l'extraction est à faire (sa « Qté en cours ») ;
// vue dans une extraction d'avant puis sortie, elle est faite. Une pièce jamais vue dans les extractions lues n'est pas
// comptée dans la barre (« pas dans Diakonos » : bandes ajoutées, casse, rajouts…).
// Les extractions sont lues sur ce PC (le dossier choisi une fois, ou un fichier chargé) et gardées dans le navigateur
// pour suivre l'évolution. Le résumé va dans le fichier partagé et au téléphone. L'extraction n'est jamais modifiée.

const SUIVI = (() => {
  // ---------- Lecture d'un .xlsx (zip + XML), la même que l'outil « Suivi de production » ----------

  async function lireZip(octets) {
    const dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
    let fin = -1;
    for (let i = octets.length - 22; i >= Math.max(0, octets.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        fin = i;
        break;
      }
    }
    if (fin < 0) throw new Error("ce n'est pas un fichier Excel (.xlsx)");
    const nb = dv.getUint16(fin + 10, true);
    let p = dv.getUint32(fin + 16, true);
    const entrees = new Map();
    const dec = new TextDecoder();
    for (let k = 0; k < nb && dv.getUint32(p, true) === 0x02014b50; k++) {
      const lNom = dv.getUint16(p + 28, true);
      entrees.set(dec.decode(octets.subarray(p + 46, p + 46 + lNom)), {
        methode: dv.getUint16(p + 10, true),
        taille: dv.getUint32(p + 20, true),
        local: dv.getUint32(p + 42, true),
      });
      p += 46 + lNom + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    return {
      noms: [...entrees.keys()],
      async texte(nom) {
        const e = entrees.get(nom);
        const debut = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
        let donnees = octets.subarray(debut, debut + e.taille);
        if (e.methode === 8) donnees = new Uint8Array(await new Response(new Blob([donnees]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
        else if (e.methode !== 0) throw new Error("fichier Excel compressé d'une façon inconnue");
        return new TextDecoder("utf-8").decode(donnees).replace(/^﻿/, "");
      },
    };
  }

  const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const tous = (n, local) => [...n.getElementsByTagNameNS("*", local)];
  const indexColonne = (ref) => {
    let n = 0;
    for (const c of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + c.charCodeAt(0) - 64;
    return n - 1;
  };

  async function lireClasseur(fichier) {
    if (/\.xls$/i.test(fichier.name)) throw new Error("ancien format Excel (.xls) : ouvrez-le dans Excel et enregistrez-le en .xlsx");
    const zip = await lireZip(new Uint8Array(await fichier.arrayBuffer()));
    const trouver = (nom) => zip.noms.find((n) => n.toLowerCase() === nom.toLowerCase());
    const xml = async (nom) => {
      const n = nom && trouver(nom.replace(/^\//, ""));
      return n ? new DOMParser().parseFromString(await zip.texte(n), "application/xml") : null;
    };
    const wb = await xml("xl/workbook.xml");
    if (!wb) throw new Error("classeur illisible (pas de « xl/workbook.xml »)");
    const rels = await xml("xl/_rels/workbook.xml.rels");
    const ss = await xml("xl/sharedStrings.xml");
    const chaines = ss ? tous(ss, "si").map((si) => tous(si, "t").filter((t) => t.parentNode.localName !== "rPh").map((t) => t.textContent).join("")) : [];
    const feuilles = [];
    const declarees = tous(wb, "sheet");
    for (let k = 0; k < Math.max(1, declarees.length); k++) {
      const f = declarees[k];
      const rid = f && (f.getAttributeNS(NS_REL, "id") || f.getAttribute("r:id"));
      const rel = rels && tous(rels, "Relationship").find((r) => r.getAttribute("Id") === rid);
      const cible = rel ? rel.getAttribute("Target") : `worksheets/sheet${k + 1}.xml`;
      const doc = await xml(cible.startsWith("/") ? cible : `xl/${cible}`);
      if (doc) feuilles.push({ nom: f ? f.getAttribute("name") : `Feuille ${k + 1}`, lignes: lireFeuille(doc, chaines) });
    }
    if (!feuilles.length) throw new Error("aucune feuille lisible dans le classeur");
    return feuilles;
  }

  function lireFeuille(doc, chaines) {
    const lignes = [];
    for (const row of tous(doc, "row")) {
      const vals = [];
      let col = 0;
      for (const c of tous(row, "c")) {
        const ref = c.getAttribute("r");
        if (ref) col = indexColonne(ref);
        const t = c.getAttribute("t");
        const v = tous(c, "v")[0];
        let val = null;
        if (t === "s") val = v ? chaines[Number(v.textContent)] ?? "" : "";
        else if (t === "inlineStr") val = tous(c, "t").map((x) => x.textContent).join("");
        else if (t === "str" || t === "e") val = v ? v.textContent : "";
        else if (t === "b") val = v ? v.textContent === "1" : null;
        else if (v) {
          const n = Number(v.textContent);
          val = Number.isFinite(n) ? n : v.textContent;
        }
        vals[col++] = val;
      }
      const r = Number(row.getAttribute("r"));
      lignes[r > 0 ? r - 1 : lignes.length] = vals;
    }
    return lignes.filter(Boolean);
  }

  // ---------- Semaines ----------

  function semaineIso(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const jour = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - jour);
    const debut = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return { annee: d.getUTCFullYear(), semaine: Math.ceil(((d - debut) / 86400000 + 1) / 7) };
  }
  function lundiIso(annee, semaine) {
    const j4 = new Date(Date.UTC(annee, 0, 4));
    const lundi1 = new Date(j4);
    lundi1.setUTCDate(j4.getUTCDate() - ((j4.getUTCDay() || 7) - 1));
    lundi1.setUTCDate(lundi1.getUTCDate() + (semaine - 1) * 7);
    return lundi1;
  }
  const ecartSemaines = (a, b) => Math.round((lundiIso(b.annee, b.semaine) - lundiIso(a.annee, a.semaine)) / (7 * 86400000));

  // Semaine écrite de toutes les façons : 47, « S47 », « 2026-47 », « 47/2026 », une date. null si vide ou à 0.
  function lireSemaine(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") {
      if (v >= 1 && v <= 53 && Number.isInteger(v)) return { semaine: v, annee: null };
      if (v > 20000 && v < 80000) return semaineIso(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000 + 43200000));
      return null;
    }
    const t = String(v).trim().toUpperCase();
    let m;
    if ((m = /^S?\s*0*(\d{1,2})(?:[.,]0+)?$/.exec(t))) return Number(m[1]) >= 1 && Number(m[1]) <= 53 ? { semaine: Number(m[1]), annee: null } : null;
    if ((m = /^(20\d{2})\s*[-/ ]\s*S?\s*(\d{1,2})$/.exec(t))) return { semaine: Number(m[2]), annee: Number(m[1]) };
    if ((m = /^S?\s*(\d{1,2})\s*[-/ ]\s*(20\d{2})$/.exec(t))) return { semaine: Number(m[1]), annee: Number(m[2]) };
    if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t))) {
      const a = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
      return semaineIso(new Date(a, Number(m[2]) - 1, Number(m[1])));
    }
    if ((m = /^(20\d{2})-(\d{2})-(\d{2})/.exec(t))) return semaineIso(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return null;
  }

  // L'année d'une semaine : celle de la commande (« CVC26090100 » : 2026, septembre), l'année suivante si la semaine
  // tombe avant la commande. Sans numéro lisible : la semaine la plus proche de l'extraction.
  function anneeDeLaSemaine(semaine, commande, courante) {
    const m = /^[A-Z]*(\d{2})(\d{2})\d/.exec(commande || "");
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
      const an = 2000 + Number(m[1]);
      const semCommande = Math.round((Number(m[2]) - 1) * 4.345) + 1;
      return semaine + 3 < semCommande ? an + 1 : an;
    }
    const d = semaine - courante.semaine;
    return d > 26 ? courante.annee - 1 : d < -26 ? courante.annee + 1 : courante.annee;
  }

  // Date de l'extraction : dans le nom (« suivi_production_07112026.xlsx »), sinon la date du fichier.
  function dateExtraction(fichier) {
    const m = /(\d{2})(\d{2})(20\d{2})/.exec(fichier.name);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      if (d.getDate() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1) return d;
    }
    return new Date(fichier.lastModified || Date.now());
  }
  const jourIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const dateDuJour = (j) => {
    const [a, m, d] = j.split("-").map(Number);
    return new Date(a, m - 1, d);
  };
  const jourCourt = (j) => (j ? dateDuJour(j).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : "");
  const jourLong = (j) => (j ? dateDuJour(j).toLocaleDateString("fr-FR") : "");

  // ---------- Analyse de l'extraction : chaque ligne du fichier compte, comme dans Excel ----------

  const sansAccents = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const COLONNES = {
    semaine: ["semaine"], commande: ["commande"], ligne: ["ligne"], catalogue: ["catalogue"], qteLanc: ["qtelancement"], qteCours: ["qteencours"],
    ville: ["ville"], codeTransp: ["codeptransporteur", "codetransporteur"], transporteur: ["transporteur"], lancement: ["lancement"],
  };
  const perimetreDe = (catalogue) => (/r[ée]sine/i.test(catalogue) ? "resine" : /fourniture|dibond/i.test(catalogue) ? "fournitures" : "production");

  // Les lignes de l'extraction, en tableaux courts : [semaine, année, commande, ligne, catalogue, qté lancement,
  // qté en cours, transporteur, ville, n° de lancement Diakonos].
  function lignesExtraction(feuilles, date) {
    const courante = semaineIso(date);
    const txt = (v) => (v === null || v === undefined ? "" : String(v).trim());
    const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".")) || 0);
    const lignes = [];
    let lue = false;
    for (const feuille of feuilles) {
      const brutes = feuille.lignes;
      const iEntete = brutes.findIndex((l) => l && l.some((v) => sansAccents(v) === "semaine") && l.some((v) => sansAccents(v) === "commande"));
      if (iEntete < 0) continue;
      lue = true;
      const idx = {};
      brutes[iEntete].forEach((v, i) => {
        const n = sansAccents(v);
        for (const [cle, noms] of Object.entries(COLONNES)) if (idx[cle] === undefined && noms.includes(n)) idx[cle] = i;
      });
      for (const l of brutes.slice(iEntete + 1)) {
        if (!l || !l.some((v) => v !== null && v !== undefined && String(v).trim() !== "")) continue;
        const get = (cle) => (idx[cle] === undefined ? null : l[idx[cle]]);
        const sem = lireSemaine(get("semaine"));
        const commande = txt(get("commande")) || "(sans commande)";
        const annee = sem ? sem.annee || anneeDeLaSemaine(sem.semaine, commande, courante) : null;
        lignes.push([sem ? sem.semaine : null, annee, commande, txt(get("ligne")), txt(get("catalogue")) || "(sans catalogue)", num(get("qteLanc")), num(get("qteCours")),
          txt(get("transporteur")) || txt(get("codeTransp")) || "(sans transporteur)", txt(get("ville")), txt(get("lancement"))]);
      }
    }
    if (!lue) throw new Error("colonnes « Semaine » et « Commande » introuvables : est-ce bien l'extraction « Suivi production » de Diakonos ?");
    return lignes;
  }

  // Le genre d'extraction d'après le nom du fichier (null : pas une extraction Diakonos).
  function genreExtraction(nom) {
    if (!/\.xlsx$/i.test(nom) || nom.startsWith("~$")) return null;
    const n = sansAccents(nom);
    if (/fourniture/.test(n)) return "fournitures";
    if (/resine/.test(n)) return "resine";
    if (/suivi.*prod|production/.test(n)) return "production";
    return null;
  }

  // ---------- Rangement (navigateur) ----------

  const BASE = "sentinelle-suivi-production";
  const GARDER_JOURS = 180; // les extractions plus anciennes que la dernière de 6 mois sont oubliées
  const CLE_INCLUS = "sentinelle-suivi-inclus";
  const CLE_RESUME = "sentinelle-suivi-resume"; // dernier résumé (le nôtre ou celui du fichier partagé, le plus récent)
  let base = null;
  function ouvrirBase() {
    if (!base) {
      base = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          reject(new Error("IndexedDB indisponible"));
          return;
        }
        const q = indexedDB.open(BASE, 1);
        q.onupgradeneeded = () => {
          q.result.createObjectStore("fichiers", { keyPath: "id" });
          q.result.createObjectStore("reglages");
        };
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
      base.catch(() => (base = null));
    }
    return base;
  }
  async function magasin(nom, mode, action) {
    const db = await ouvrirBase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(nom, mode);
      const q = action(tx.objectStore(nom));
      tx.oncomplete = () => resolve(q && "result" in q ? q.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  function lireLocal(cle, defaut) {
    try {
      const v = JSON.parse(localStorage.getItem(cle) || "null");
      return v === null ? defaut : v;
    } catch (_e) {
      return defaut;
    }
  }
  function ecrireLocal(cle, v) {
    try {
      localStorage.setItem(cle, JSON.stringify(v));
    } catch (_e) {
      // sans stockage : le choix dure le temps de la page
    }
  }

  const etat = {
    charge: false,
    fichiers: new Map(), // id → fichier lu { id, nom, chemin, genre, jour, modifie, taille, lu, lignes }
    extractions: [], // une par jour, la plus ancienne d'abord
    generation: 0,
    dossier: null,
    infoDossier: null,
    lecture: false,
    message: null, // { texte, genre: bon | alerte | "" }
    inclus: (() => {
      const x = lireLocal(CLE_INCLUS, null);
      return x && typeof x === "object" ? { production: x.production !== false, fournitures: x.fournitures !== false, resine: x.resine !== false } : { production: true, fournitures: true, resine: true };
    })(),
    ouverts: new Set(), // lancements dont le détail est ouvert
    anciennesOuvertes: false,
    resume: null,
    cleResume: "",
  };

  const idFichier = (f) => `${f.name}|${f.size}|${f.lastModified || 0}`;

  // Une extraction par jour : pour chaque genre (production, fournitures, résine…), le fichier le plus récent du jour.
  // Une même ligne (commande + ligne + n° de lancement) présente dans deux fichiers n'est comptée qu'une fois.
  function construireExtractions() {
    const parJour = new Map();
    for (const f of etat.fichiers.values()) {
      if (!parJour.has(f.jour)) parJour.set(f.jour, new Map());
      const g = parJour.get(f.jour);
      const a = g.get(f.genre);
      if (!a || f.modifie > a.modifie) g.set(f.genre, f);
    }
    etat.extractions = [...parJour.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([jour, g]) => {
        const fichiers = [...g.values()].sort((a, b) => a.nom.localeCompare(b.nom));
        const vues = new Set();
        const lignes = [];
        for (const f of fichiers) {
          const nb = new Map();
          for (const r of f.lignes) {
            const base = `${r[2]}|${r[3]}|${r[9]}`;
            const n = (nb.get(base) || 0) + 1;
            nb.set(base, n);
            const cle = `${base}#${n}`;
            if (vues.has(cle)) continue;
            vues.add(cle);
            lignes.push(r);
          }
        }
        const courante = semaineIso(dateDuJour(jour));
        // Par pièce (commande + ligne) : quantités de toutes ses lignes (une ligne relancée en a deux).
        const parCle = new Map();
        for (const r of lignes) {
          const k = cleLigne(r[2], r[3]);
          if (!parCle.has(k)) parCle.set(k, { lanc: 0, cours: 0, lignes: [] });
          const x = parCle.get(k);
          x.lanc += r[5];
          x.cours += r[6];
          x.lignes.push(r);
        }
        return { jour, courante, ordre: ordreSemaine(courante.annee, courante.semaine), fichiers: fichiers.map((f) => ({ nom: f.nom, chemin: f.chemin, id: f.id, genre: f.genre })), lignes, parCle };
      });
    etat.generation++;
  }

  async function lireFichier(fichier, genre, chemin) {
    const date = dateExtraction(fichier);
    const lignes = lignesExtraction(await lireClasseur(fichier), date);
    return {
      id: idFichier(fichier), nom: fichier.name, chemin: chemin || "", genre: genre || genreExtraction(fichier.name) || `autre:${fichier.name}`, jour: jourIso(date),
      modifie: fichier.lastModified || 0, taille: fichier.size, lu: new Date().toISOString(), lignes,
    };
  }

  // Garde un fichier lu ; oublie les versions plus anciennes du même jour et du même genre, et les trop vieilles.
  async function garderFichier(rec) {
    etat.fichiers.set(rec.id, rec);
    const plusRecent = [...etat.fichiers.values()].reduce((m, f) => (f.jour > m ? f.jour : m), "");
    const limite = jourIso(new Date(dateDuJour(plusRecent).getTime() - GARDER_JOURS * 86400000));
    const oublier = [...etat.fichiers.values()].filter((f) => f.jour < limite || (f.jour === rec.jour && f.genre === rec.genre && f.id !== rec.id && f.modifie <= rec.modifie));
    for (const f of oublier) etat.fichiers.delete(f.id);
    try {
      await magasin("fichiers", "readwrite", (m) => {
        m.put(rec);
        for (const f of oublier) m.delete(f.id);
      });
    } catch (_e) {
      // sans IndexedDB : l'extraction est gardée le temps de la page
    }
  }

  // ---------- Avancement des lancements ----------

  const ORDRE_POSTES = ["Agglo 1er tour", "Recyclage", "Feno", "Casse", "Agglo 2ème tour"];
  const rangPoste = (p) => {
    const i = ORDRE_POSTES.indexOf(p);
    return i < 0 ? ORDRE_POSTES.length : i;
  };
  const MAX_COMMANDES = 200;

  // État d'un lancement : termine, absent (plus rien dans Diakonos), attente (pas encore dans Diakonos), retard, en_cours.
  function etatLancement(f, r, ordre, courante) {
    if (f + r === 0) return ordre <= courante ? "absent" : "attente";
    if (r === 0) return "termine";
    return ordre < courante ? "retard" : "en_cours";
  }

  const libelleCle = (sem, annee, courante) => {
    if (!sem) return { cle: "sans", libelle: "Sans semaine" };
    const ecart = ecartSemaines(courante, { annee, semaine: sem });
    if (ecart < 0) return { cle: "retard", libelle: "En retard" };
    return { cle: `${annee}-${String(sem).padStart(2, "0")}`, libelle: `S${sem}` };
  };

  // Le résumé complet (écran du PC, fichier partagé, téléphone). null sans extraction.
  function calculer() {
    const cle = `${bibliotheque.generation}|${etat.generation}|${JSON.stringify(etat.inclus)}`;
    if (etat.resume && etat.cleResume === cle) return etat.resume;
    const ex = etat.extractions;
    if (!ex.length) return null;
    const der = ex[ex.length - 1];
    const prec = ex.length > 1 ? ex[ex.length - 2] : null;
    // Les lancements de la bibliothèque (6 mois autour de la dernière extraction).
    const lancements = [];
    for (const s of bibliotheque.semaines.values()) {
      if (s.supprimeeLe || !s.lancements.length) continue;
      if (Math.abs(ecartSemaines(der.courante, { annee: s.annee, semaine: Number(s.semaine) })) > 26) continue;
      const cols = s.colonnesPieces || COLONNES_PIECES_BIBLIOTHEQUE;
      const iCle = Math.max(0, cols.indexOf("cle"));
      const iQ = cols.indexOf("pieces") >= 0 ? cols.indexOf("pieces") : 4;
      for (const l of s.lancements) {
        const pieces = new Map();
        for (const p of l.pieces || []) {
          const k = p[iCle];
          if (!k) continue;
          pieces.set(k, (pieces.get(k) || 0) + Math.max(0, Number(p[iQ]) || 0));
        }
        lancements.push({ cle: cleNomLancement(l.nom), nom: l.nom, poste: l.poste || "", casse: Boolean(l.casse), id: s.id, annee: s.annee, semaine: Number(s.semaine),
          ordre: ordreSemaine(s.annee, Number(s.semaine)), pieces, vus: new Set(), histo: [], presents: null, f: 0, r: 0, h: 0, fPrec: null });
      }
    }
    lancements.sort((a, b) => a.ordre - b.ordre || rangPoste(a.poste) - rangPoste(b.poste) || a.nom.localeCompare(b.nom));
    // Pièce → lancements qui la contiennent (dans l'ordre des semaines).
    const index = new Map();
    lancements.forEach((L, i) => {
      for (const k of L.pieces.keys()) {
        if (!index.has(k)) index.set(k, []);
        index.get(k).push(i);
      }
    });
    // Extraction après extraction : une pièce présente va aux lancements de la première semaine qui la contient à
    // partir de celle de l'extraction (une pièce cassée puis relancée va à la casse ; une pièce d'une semaine à venir
    // attend dans Diakonos). Deux lancements de cette même semaine qui ont la pièce la comptent tous les deux.
    ex.forEach((e, n) => {
      const presents = new Map();
      for (const [k, v] of e.parCle) {
        const liste = index.get(k);
        if (!liste) continue;
        const premier = liste.find((x) => lancements[x].ordre >= e.ordre) ?? liste[liste.length - 1];
        for (const i of liste) {
          if (lancements[i].ordre !== lancements[premier].ordre) continue;
          if (!presents.has(i)) presents.set(i, new Map());
          presents.get(i).set(k, v);
          lancements[i].vus.add(k);
        }
      }
      lancements.forEach((L, i) => {
        if (!L.vus.size) return;
        const p = presents.get(i) || new Map();
        let f = 0;
        let r = 0;
        const detail = n >= ex.length - 2 ? new Map() : null; // par pièce (pour les totaux : une pièce comptée une fois)
        for (const [k, q] of L.pieces) {
          const v = p.get(k);
          let fk = 0;
          let rk = 0;
          if (v) {
            rk = Math.min(q, Math.max(0, v.cours));
            fk = Math.min(q - rk, Math.max(0, v.lanc - v.cours));
          } else if (L.vus.has(k)) fk = q;
          f += fk;
          r += rk;
          if (detail && (fk || rk)) detail.set(k, [fk, rk]);
        }
        if (n === ex.length - 2) {
          L.fPrec = f;
          L.detailPrec = detail;
        }
        if (n === ex.length - 1) {
          L.f = f;
          L.r = r;
          L.presents = p;
          L.detail = detail;
        }
        if (f + r > 0) L.histo.push([e.jour, Math.round((100 * f) / (f + r))]);
      });
    });
    const total = (L) => [...L.pieces.values()].reduce((t, q) => t + q, 0);
    for (const L of lancements) L.h = Math.max(0, total(L) - L.f - L.r);
    // Les commandes encore à faire d'un lancement.
    const commandes = (L) => {
      const par = new Map();
      for (const [k, v] of L.presents || []) {
        const r0 = v.lignes[0];
        const reste = Math.min(L.pieces.get(k), Math.max(0, v.cours));
        if (reste <= 0) continue;
        const c = par.get(r0[2]) || { commande: r0[2], transporteur: r0[7], ville: r0[8], reste: 0, semaines: new Set() };
        c.reste += reste;
        if (r0[0]) c.semaines.add(r0[0]);
        par.set(r0[2], c);
      }
      return [...par.values()]
        .sort((a, b) => a.transporteur.localeCompare(b.transporteur) || a.commande.localeCompare(b.commande))
        .slice(0, MAX_COMMANDES)
        .map((c) => [c.commande, c.transporteur, c.ville, c.reste, [...c.semaines].sort((a, b) => a - b).map((s) => `S${s}`).join(" ")]);
    };
    // Par semaine de la bibliothèque.
    const parSemaine = new Map();
    for (const L of lancements) {
      if (!parSemaine.has(L.id)) parSemaine.set(L.id, { id: L.id, annee: L.annee, semaine: L.semaine, ordre: L.ordre, lancements: [] });
      parSemaine.get(L.id).lancements.push(L);
    }
    const semaines = [];
    let anciennes = 0;
    for (const s of [...parSemaine.values()].sort((a, b) => a.ordre - b.ordre)) {
      const f = s.lancements.reduce((t, L) => t + L.f, 0);
      const r = s.lancements.reduce((t, L) => t + L.r, 0);
      const h = s.lancements.reduce((t, L) => t + L.h, 0);
      // Les semaines finies depuis plus de 3 semaines : seulement comptées (« N semaines plus anciennes : finies »).
      if (r === 0 && ecartSemaines({ annee: s.annee, semaine: s.semaine }, der.courante) > 3) {
        anciennes++;
        continue;
      }
      semaines.push({
        id: s.id, annee: s.annee, semaine: s.semaine, f, r, h, e: etatLancement(f, r, s.ordre, der.ordre),
        lancements: s.lancements.map((L) => ({
          cle: L.cle, nom: L.nom, poste: L.poste, f: L.f, r: L.r, h: L.h, e: etatLancement(L.f, L.r, L.ordre, der.ordre),
          d: L.fPrec === null ? null : L.f - L.fPrec, p: L.histo.slice(-10), c: commandes(L),
        })),
      });
    }
    // Ce qui est compté (production, fournitures, résine) : pour « hors lancement » et le tableau des transporteurs.
    const comptee = (r) => Boolean(etat.inclus[perimetreDe(r[4])]);
    const dansLancement = new Set(index.keys());
    const hors = new Map();
    const tableau = new Map();
    const colonnes = new Map();
    for (const r of der.lignes) {
      if (!comptee(r)) continue;
      const { cle: cs, libelle } = libelleCle(r[0], r[1], der.courante);
      colonnes.set(cs, libelle);
      if (!dansLancement.has(cleLigne(r[2], r[3]))) {
        const x = hors.get(cs) || { libelle, pieces: 0, lignes: 0, commandes: new Set() };
        x.pieces += r[6];
        x.lignes++;
        x.commandes.add(r[2]);
        hors.set(cs, x);
      }
      if (!tableau.has(r[7])) tableau.set(r[7], new Map());
      const t = tableau.get(r[7]);
      t.set(cs, (t.get(cs) || 0) + r[6]);
    }
    const ordreCles = (a, b) => (a === "retard" ? -1 : b === "retard" ? 1 : a === "sans" ? 1 : b === "sans" ? -1 : a < b ? -1 : a > b ? 1 : 0);
    const clesCol = [...colonnes.keys()].sort(ordreCles);
    const arrondi = (v) => Math.round(v * 100) / 100;
    const lignesTableau = [...tableau.entries()]
      .map(([tr, m]) => [tr, ...clesCol.map((c) => arrondi(m.get(c) || 0)), arrondi([...m.values()].reduce((a, b) => a + b, 0))])
      .sort((a, b) => b[b.length - 1] - a[a.length - 1] || String(a[0]).localeCompare(String(b[0])));
    const toutes = semaines.flatMap((s) => s.lancements);
    // Totaux : une pièce présente dans deux lancements (ex. recyclage et 2ème tour) n'est comptée qu'une fois.
    const affiches = new Set(semaines.map((s) => s.id));
    const unique = (cle) => {
      const m = new Map();
      for (const L of lancements) {
        if (!affiches.has(L.id) || !L[cle]) continue;
        for (const [k, v] of L[cle]) {
          const a = m.get(k);
          m.set(k, a ? [Math.max(a[0], v[0]), Math.max(a[1], v[1])] : v);
        }
      }
      return [...m.values()].reduce((t, v) => [t[0] + v[0], t[1] + v[1]], [0, 0]);
    };
    const [faites, restantes] = unique("detail");
    const [faitesAvant] = unique("detailPrec");
    const resume = {
      version: 1,
      jour: der.jour,
      semaine: der.courante.semaine,
      annee: der.courante.annee,
      fichiers: der.fichiers.map((f) => f.nom),
      precedente: prec ? prec.jour : null,
      nbExtractions: ex.length,
      inclus: { ...etat.inclus },
      totaux: {
        lancements: toutes.length,
        faites,
        restantes,
        retard: toutes.filter((L) => L.e === "retard").length,
        depuis: prec ? faites - faitesAvant : null,
      },
      semaines,
      anciennes,
      hors: [...hors.entries()].sort(([a], [b]) => ordreCles(a, b)).map(([, x]) => [x.libelle, arrondi(x.pieces), x.lignes, x.commandes.size]),
      tableau: { colonnes: [...clesCol.map((c) => colonnes.get(c)), "Total"], lignes: lignesTableau },
    };
    etat.resume = resume;
    etat.cleResume = cle;
    return resume;
  }

  // ---------- Partage (fichier partagé, téléphone) ----------

  function signature(resume) {
    if (!resume) return "";
    const texte = JSON.stringify({ ...resume, genere: undefined });
    let h = 0x811c9dc5;
    for (let i = 0; i < texte.length; i++) h = Math.imul(h ^ texte.charCodeAt(i), 0x01000193) >>> 0;
    return `${resume.jour}:${h.toString(16)}`;
  }

  // Le résumé à partager : le nôtre, ou celui reçu du fichier partagé s'il vient d'une extraction plus récente.
  function pourPartage() {
    const garde = lireLocal(CLE_RESUME, null);
    const local = etat.charge ? calculer() : null;
    if (local && (!garde || !garde.jour || local.jour >= garde.jour)) {
      if (signature(garde) !== signature(local)) ecrireLocal(CLE_RESUME, local);
      return local;
    }
    return garde && garde.version ? garde : null;
  }

  // Résumé lu dans le fichier partagé (écrit par un autre PC) : gardé s'il est plus récent que le nôtre.
  function recevoir(distant) {
    if (!distant || !distant.version || !distant.jour) return;
    const garde = lireLocal(CLE_RESUME, null);
    const local = etat.charge && etat.extractions.length ? etat.extractions[etat.extractions.length - 1].jour : "";
    if (distant.jour > local && (!garde || !garde.jour || distant.jour > garde.jour)) {
      ecrireLocal(CLE_RESUME, distant);
      rafraichir();
    }
  }

  // Une nouvelle extraction : le fichier partagé et le téléphone sont mis à jour.
  function apresChangement() {
    construireExtractions();
    pourPartage();
    if (typeof planifierEnvoiTelephone === "function") planifierEnvoiTelephone();
    if (bibliotheque.dossier) synchroniserBibliotheque(false).then(() => rafraichirBibliotheque()).catch(() => {});
  }

  // ---------- Dossier des extractions ----------

  async function chercherExtractions(dossier, chemin = [], profondeur = 0, res = []) {
    for await (const [nom, h] of dossier.entries()) {
      if (h.kind === "directory") {
        if (profondeur < 3 && !nom.startsWith(".")) await chercherExtractions(h, [...chemin, nom], profondeur + 1, res);
        continue;
      }
      const genre = genreExtraction(nom);
      if (!genre) continue;
      const fichier = await h.getFile();
      res.push({ genre, chemin, fichier, jour: jourIso(dateExtraction(fichier)) });
    }
    return res;
  }

  async function lireDossier(interactif) {
    const d = etat.dossier;
    if (!d || etat.lecture) return;
    etat.lecture = true;
    try {
      let acces = d.queryPermission ? await d.queryPermission({ mode: "read" }) : "granted";
      if (acces !== "granted" && interactif && d.requestPermission) acces = await d.requestPermission({ mode: "read" });
      if (acces !== "granted") {
        etat.infoDossier = { texte: "Cliquez sur « Actualiser » pour lire les extractions (le navigateur redemande l'accès au dossier à chaque ouverture).", alerte: false };
        return;
      }
      const trouves = await chercherExtractions(d);
      if (!trouves.length) {
        etat.infoDossier = { texte: `Aucune extraction Diakonos dans « ${d.name} » (fichiers « suivi_production_JJMMAAAA.xlsx »).`, alerte: true };
        return;
      }
      // Pour chaque jour et chaque genre : la version la plus récente ; 6 mois au plus.
      const garder = new Map();
      for (const x of trouves) {
        const k = `${x.jour}|${x.genre}`;
        const a = garder.get(k);
        if (!a || x.fichier.lastModified > a.fichier.lastModified) garder.set(k, x);
      }
      const plusRecent = [...garder.values()].reduce((m, x) => (x.jour > m ? x.jour : m), "");
      const limite = jourIso(new Date(dateDuJour(plusRecent).getTime() - GARDER_JOURS * 86400000));
      const aLire = [...garder.values()].filter((x) => x.jour >= limite && !etat.fichiers.has(idFichier(x.fichier))).sort((a, b) => (a.jour < b.jour ? -1 : 1));
      const erreurs = [];
      let n = 0;
      for (const x of aLire) {
        n++;
        etat.message = { texte: `Lecture des extractions : ${n} / ${aLire.length} (${x.fichier.name})…`, genre: "" };
        rafraichir();
        try {
          await garderFichier(await lireFichier(x.fichier, x.genre, x.chemin.join(" / ")));
        } catch (e) {
          erreurs.push(`${x.fichier.name} : ${e && e.message ? e.message : e}`);
        }
      }
      etat.infoDossier = { trouves: trouves.length, lus: aLire.length - erreurs.length };
      etat.message = erreurs.length ? { texte: `⚠ Illisible : ${erreurs.join(" · ")}`, genre: "alerte" } : aLire.length ? { texte: `✔ ${aLire.length} extraction(s) lue(s) dans le dossier.`, genre: "bon" } : null;
      if (aLire.length) apresChangement();
    } catch (e) {
      etat.infoDossier = { texte: `Dossier illisible : ${e && e.message ? e.message : e}`, alerte: true };
    } finally {
      etat.lecture = false;
      rafraichir();
    }
  }

  async function choisirDossier() {
    if (!window.showDirectoryPicker) {
      etat.message = { texte: "Ce navigateur ne sait pas ouvrir un dossier : utilisez Chrome (ou chargez le fichier à la main).", genre: "alerte" };
      rafraichir();
      return;
    }
    let h;
    try {
      h = await window.showDirectoryPicker({ id: "extractions-diakonos", mode: "read" });
    } catch (_e) {
      return; // fenêtre fermée
    }
    etat.dossier = h;
    try {
      await magasin("reglages", "readwrite", (m) => m.put(h, "dossier"));
    } catch (_e) {
      // le dossier sera redemandé à la prochaine ouverture
    }
    await lireDossier(true);
  }

  // Fichiers choisis à la main (ou déposés) : gardés comme ceux du dossier.
  async function chargerFichiers(liste) {
    const fichiers = [...(liste || [])].filter((f) => /\.xlsx$/i.test(f.name));
    if (!fichiers.length) {
      etat.message = { texte: "Choisissez l'extraction Diakonos en .xlsx (suivi_production_JJMMAAAA.xlsx).", genre: "alerte" };
      rafraichir();
      return;
    }
    const erreurs = [];
    let lus = 0;
    for (const f of fichiers) {
      etat.message = { texte: `Lecture de ${f.name}…`, genre: "" };
      rafraichir();
      try {
        await garderFichier(await lireFichier(f, genreExtraction(f.name), ""));
        lus++;
      } catch (e) {
        erreurs.push(`${f.name} : ${e && e.message ? e.message : e}`);
      }
    }
    etat.message = erreurs.length ? { texte: `⚠ Illisible : ${erreurs.join(" · ")}`, genre: "alerte" } : { texte: `✔ ${lus} fichier(s) lu(s).`, genre: "bon" };
    if (lus) apresChangement();
    rafraichir();
  }

  async function oublierExtraction(jour) {
    const e = etat.extractions.find((x) => x.jour === jour);
    if (!e) return;
    if (!(await demanderConfirmation(`Oublier l'extraction du ${jourLong(jour)} ?`, "Elle ne comptera plus dans l'avancement. Le fichier Diakonos n'est pas touché ; il sera relu s'il est encore dans le dossier.", "Oublier"))) return;
    for (const f of e.fichiers) etat.fichiers.delete(f.id);
    try {
      await magasin("fichiers", "readwrite", (m) => {
        for (const f of e.fichiers) m.delete(f.id);
      });
    } catch (_e) {
      // sans IndexedDB
    }
    apresChangement();
    rafraichir();
  }

  // ---------- Écran ----------

  const fmt = (v) => Number(v || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  const pluriel = (n, un, plusieurs) => `${fmt(n)} ${n > 1 ? plusieurs : un}`;
  const LIBELLES_ETAT = { termine: "Terminé", absent: "Plus rien dans Diakonos", attente: "Pas encore dans Diakonos", retard: "En retard", en_cours: "En cours" };
  const pct = (f, r) => (f + r > 0 ? Math.round((100 * f) / (f + r)) : null);

  // « Du lundi 16 au vendredi 20 novembre » (comme le téléphone et le compte rendu).
  function datesDeLaSemaine(annee, semaine) {
    const lundi = lundiIso(annee, semaine);
    const vendredi = new Date(lundi.getTime() + 4 * 86400000);
    const jour = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
    const debut = lundi.getUTCMonth() === vendredi.getUTCMonth() ? String(lundi.getUTCDate()) : jour(lundi);
    return `Du lundi ${debut} au vendredi ${jour(vendredi)}`;
  }

  function barre(f, r, e) {
    const p = pct(f, r);
    const largeur = e === "absent" ? 100 : p ?? 0;
    return `<div class="sv-barre sv-${e}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p ?? 0}"><span style="width:${largeur}%"></span></div>`;
  }

  // Petite courbe de l'avancement, extraction après extraction.
  function courbe(points) {
    if (!points || points.length < 2) return "";
    const l = 64;
    const h = 18;
    const pas = l / (points.length - 1);
    const xy = points.map(([, v], i) => `${(i * pas).toFixed(1)},${(h - 1 - (v / 100) * (h - 2)).toFixed(1)}`).join(" ");
    const titre = points.map(([j, v]) => `${jourCourt(j)} : ${v} %`).join(" · ");
    return `<svg class="sv-courbe" viewBox="0 0 ${l} ${h}" width="${l}" height="${h}" aria-label="Évolution"><title>${echapper(titre)}</title><polyline points="${xy}"/></svg>`;
  }

  function texteChiffres(L) {
    if (L.f + L.r === 0) return L.e === "absent" ? `${pluriel(L.h, "pièce", "pièces")} · aucune dans l'extraction` : `${pluriel(L.h, "pièce", "pièces")} · pas encore dans l'extraction`;
    return `<strong>${fmt(L.f)}</strong> faite${L.f > 1 ? "s" : ""} · <strong>${fmt(L.r)}</strong> à faire`;
  }

  function texteEvolution(L, resume) {
    if (L.d === null || L.d === undefined || !resume.precedente) return "";
    if (L.d === 0) return `<span class="sv-evo pale">= depuis le ${echapper(jourCourt(resume.precedente))}</span>`;
    return `<span class="sv-evo ${L.d > 0 ? "plus" : "moins"}">${L.d > 0 ? "+" : "−"}${fmt(Math.abs(L.d))} pièce${Math.abs(L.d) > 1 ? "s" : ""} depuis le ${echapper(jourCourt(resume.precedente))}</span>`;
  }

  function htmlLancement(L, resume) {
    const p = pct(L.f, L.r);
    const ouvert = etat.ouverts.has(L.cle);
    const detail = !ouvert
      ? ""
      : `<div class="sv-detail">${
          L.c.length
            ? `<table class="sv-table"><thead><tr><th>Commande</th><th>Transporteur</th><th>Ville</th><th>Semaine Diakonos</th><th class="nombre">Pièces à faire</th></tr></thead><tbody>${L.c
                .map((c) => `<tr><td>${echapper(c[0])}</td><td>${echapper(c[1])}</td><td>${echapper(c[2])}</td><td>${echapper(c[4])}</td><td class="nombre">${fmt(c[3])}</td></tr>`)
                .join("")}</tbody></table>`
            : `<div class="note">Plus aucune pièce de ce lancement dans l'extraction du ${echapper(jourLong(resume.jour))}.</div>`
        }${L.h ? `<div class="note">${pluriel(L.h, "pièce du lancement n'a", "pièces du lancement n'ont")} jamais été vue${L.h > 1 ? "s" : ""} dans les extractions lues (pas comptée${L.h > 1 ? "s" : ""} dans la barre).</div>` : ""}</div>`;
    return `<div class="sv-lan${ouvert ? " ouvert" : ""}" data-sv-lan="${echapper(L.cle)}">
      <button type="button" class="sv-ligne" aria-expanded="${ouvert}">
        <span class="sv-nom"><span class="sv-poste">${echapper(L.poste || "Lancement")}</span><span class="sv-fichier">${echapper(L.nom)}</span></span>
        <span class="sv-milieu">${barre(L.f, L.r, L.e)}<span class="sv-chiffres">${texteChiffres(L)}${L.h && L.f + L.r ? ` <span class="pale">· ${fmt(L.h)} pas dans Diakonos</span>` : ""}</span></span>
        <span class="sv-droite"><span class="sv-pct sv-t-${L.e}">${p === null ? echapper(LIBELLES_ETAT[L.e]) : `${p} %`}</span>${p !== null ? `<span class="sv-etat sv-t-${L.e}">${echapper(L.e === "en_cours" && !L.f ? "À faire" : LIBELLES_ETAT[L.e])}</span>` : ""}${texteEvolution(L, resume)}${courbe(L.p)}</span>
      </button>${detail}</div>`;
  }

  function htmlSemaine(s, resume) {
    const p = pct(s.f, s.r);
    const courante = s.annee === resume.annee && s.semaine === resume.semaine;
    return `<div class="sv-semaine">
      <div class="sv-sem-tete"><div><span class="sv-sem-nom">Semaine ${s.semaine}</span>${courante ? ' <span class="sv-badge">en cours</span>' : ""}<span class="sv-sem-dates">${echapper(datesDeLaSemaine(s.annee, s.semaine))}</span></div>
        <div class="sv-sem-barre">${barre(s.f, s.r, s.e)}<span class="sv-pct sv-t-${s.e}">${p === null ? echapper(LIBELLES_ETAT[s.e]) : `${p} %`}</span></div></div>
      ${s.lancements.map((L) => htmlLancement(L, resume)).join("")}</div>`;
  }

  function htmlCarteExtraction(resume, local) {
    const d = etat.dossier;
    const i = etat.infoDossier || {};
    const der = etat.extractions[etat.extractions.length - 1];
    let html = `<div class="carte" id="svCarteExtraction"><div class="carte-titre">Extraction Diakonos</div>`;
    if (der) {
      html += `<div class="sv-source">Dernière extraction : <strong>${echapper(jourLong(der.jour))}</strong> (semaine ${der.courante.semaine}) · ${der.fichiers.map((f) => `<span class="sv-fichier-lu">${echapper(f.nom)}</span>`).join(" + ")}${
        etat.extractions.length > 1 ? ` · <span class="pale">${etat.extractions.length} extractions gardées pour l'évolution</span>` : ""
      }</div>`;
    } else if (resume && !local) {
      html += `<div class="sv-source">Avancement reçu du fichier partagé : extraction du <strong>${echapper(jourLong(resume.jour))}</strong>, lue sur un autre PC.</div>`;
    } else {
      html += `<div class="note">Choisissez une fois le dossier où arrivent les extractions « suivi_production_JJMMAAAA.xlsx » : Sentinelle y lit toute seule les nouvelles, à chaque ouverture. Ou chargez le fichier à la main. Le fichier est lu sur ce PC et n'est jamais modifié.</div>`;
    }
    if (d) html += `<div class="sv-dossier${i.alerte ? " alerte" : ""}">📁 Dossier <strong>${echapper(d.name)}</strong>${i.texte ? ` · ${echapper(i.texte)}` : i.trouves ? ` · ${pluriel(i.trouves, "extraction trouvée", "extractions trouvées")}` : ""}</div>`;
    if (etat.message) html += `<div class="sv-message ${etat.message.genre || ""}">${echapper(etat.message.texte)}</div>`;
    html += `<div class="sv-boutons">
      <button type="button" id="svDossier"${d ? ' class="contour"' : ""}>${d ? "Changer de dossier…" : "Choisir le dossier des extractions…"}</button>
      ${d ? `<button type="button" id="svActualiser"${etat.lecture ? " disabled" : ""}>↻ Actualiser</button>` : ""}
      <button type="button" class="contour" id="svFichier">Charger un fichier…</button>
      <input type="file" id="svChampFichier" accept=".xlsx,.xlsm" multiple hidden></div></div>`;
    return html;
  }

  function htmlTuiles(resume) {
    const t = resume.totaux;
    return `<div class="tuiles">
      <div class="tuile"><span class="tuile-legende">Lancements suivis</span><span class="tuile-valeur">${fmt(t.lancements)}</span></div>
      <div class="tuile"><span class="tuile-legende">Pièces faites</span><span class="tuile-valeur">${fmt(t.faites)}</span>${t.depuis !== null && resume.precedente ? `<span class="tuile-legende">${t.depuis >= 0 ? "+" : "−"}${fmt(Math.abs(t.depuis))} depuis le ${echapper(jourCourt(resume.precedente))}</span>` : ""}</div>
      <div class="tuile"><span class="tuile-legende">Pièces à faire</span><span class="tuile-valeur">${fmt(t.restantes)}</span></div>
      <div class="tuile${t.retard ? " souci" : ""}"><span class="tuile-legende">Lancements en retard</span><span class="tuile-valeur">${fmt(t.retard)}</span></div></div>`;
  }

  function htmlInclus(resume) {
    const noms = { production: "Production", fournitures: "Fournitures & Dibond", resine: "Résine (m²)" };
    return `<div class="sv-inclus">Compter : ${Object.entries(noms)
      .map(([k, n]) => `<label><input type="checkbox" data-sv-inclus="${k}"${(resume.inclus || etat.inclus)[k] ? " checked" : ""}> ${n}</label>`)
      .join("")}</div>`;
  }

  function htmlTableau(resume, local) {
    const t = resume.tableau;
    if (!t || !t.lignes.length) return "";
    const totaux = t.colonnes.map((_, i) => t.lignes.reduce((s, l) => s + (Number(l[i + 1]) || 0), 0));
    return `<div class="carte"><div class="carte-titre">Pièces à faire par transporteur et par semaine</div>
      ${local ? htmlInclus(resume) : ""}
      <div class="defile"><table class="sv-table sv-croise"><thead><tr><th>Transporteur</th>${t.colonnes.map((c) => `<th class="nombre">${echapper(c)}</th>`).join("")}</tr></thead>
      <tbody>${t.lignes.map((l) => `<tr><td>${echapper(l[0])}</td>${l.slice(1).map((v, i) => `<td class="nombre${i === l.length - 2 ? " total" : ""}">${v ? fmt(v) : ""}</td>`).join("")}</tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td>${totaux.map((v) => `<td class="nombre total">${fmt(v)}</td>`).join("")}</tr></tfoot></table></div>
      <div class="note">« Qté en cours » de l'extraction du ${echapper(jourLong(resume.jour))}, comme dans Excel.</div></div>`;
  }

  function htmlHors(resume) {
    if (!resume.hors || !resume.hors.length) return "";
    return `<div class="carte"><div class="carte-titre">Dans Diakonos, dans aucun lancement</div>
      <div class="note">Pièces de l'extraction qui ne sont dans aucun lancement de la bibliothèque (pas encore lancées, ou lancement pas scanné).</div>
      <table class="sv-table"><thead><tr><th>Semaine Diakonos</th><th class="nombre">Pièces à faire</th><th class="nombre">Lignes</th><th class="nombre">Commandes</th></tr></thead>
      <tbody>${resume.hors.map((h) => `<tr><td>${echapper(h[0])}</td><td class="nombre">${fmt(h[1])}</td><td class="nombre">${fmt(h[2])}</td><td class="nombre">${fmt(h[3])}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function htmlExtractions() {
    if (!etat.extractions.length) return "";
    const lignes = [...etat.extractions].reverse().map((e) => {
      const cours = e.lignes.reduce((t, r) => t + r[6], 0);
      return `<tr><td>${echapper(jourLong(e.jour))}</td><td>S${e.courante.semaine}</td><td>${e.fichiers.map((f) => echapper(f.nom)).join("<br>")}</td><td class="nombre">${fmt(e.lignes.length)}</td><td class="nombre">${fmt(cours)}</td>
        <td><button type="button" class="texte" data-sv-oublier="${echapper(e.jour)}">Oublier</button></td></tr>`;
    });
    return `<div class="carte"><div class="carte-titre">Extractions gardées</div>
      <div class="note">Une par jour (la plus récente du jour). Chaque ligne du fichier compte, comme dans Excel ; une ligne présente dans deux fichiers du même jour n'est comptée qu'une fois.</div>
      <div class="defile"><table class="sv-table"><thead><tr><th>Jour</th><th>Semaine</th><th>Fichier(s)</th><th class="nombre">Lignes</th><th class="nombre">Qté en cours</th><th></th></tr></thead><tbody>${lignes.join("")}</tbody></table></div></div>`;
  }

  function afficher() {
    const page = $("pageSuivi");
    if (!page) return;
    const local = etat.charge ? calculer() : null;
    const resume = local || pourPartage();
    let html = entetePage("Outils", "Suivi de production", "L'avancement de chaque lancement, d'après l'extraction « Suivi production » de Diakonos.");
    html += htmlCarteExtraction(resume, Boolean(local));
    if (resume) {
      html += htmlTuiles(resume);
      html += `<div class="carte"><div class="carte-titre">Avancement par lancement</div>
        <div class="note">Une pièce du lancement encore dans l'extraction est à faire ; sortie de l'extraction, elle est faite. Les pièces jamais vues dans les extractions (bandes, casse, rajouts…) ne comptent pas dans la barre. Un clic sur un lancement : les commandes encore à faire.</div>
        <div class="sv-legende"><span><i class="sv-l-en_cours"></i>En cours</span><span><i class="sv-l-termine"></i>Terminé</span><span><i class="sv-l-retard"></i>En retard (semaine passée)</span><span><i class="sv-l-attente"></i>Pas encore dans Diakonos</span></div>
        ${resume.semaines.length ? resume.semaines.map((s) => htmlSemaine(s, resume)).join("") : '<div class="note">Aucun lancement dans la bibliothèque des semaines autour de cette extraction : scannez les semaines dans « Contrôler la coupe ».</div>'}
        ${resume.anciennes ? `<div class="note">${pluriel(resume.anciennes, "semaine plus ancienne : finie", "semaines plus anciennes : finies")}.</div>` : ""}</div>`;
      html += htmlHors(resume);
      html += htmlTableau(resume, Boolean(local));
    }
    html += htmlExtractions();
    page.innerHTML = html;
    brancher(page);
  }

  function brancher(page) {
    const q = (id) => page.querySelector(`#${id}`);
    q("svDossier").addEventListener("click", choisirDossier);
    if (q("svActualiser")) q("svActualiser").addEventListener("click", () => lireDossier(true));
    q("svFichier").addEventListener("click", () => q("svChampFichier").click());
    q("svChampFichier").addEventListener("change", (e) => chargerFichiers(e.target.files));
    page.querySelectorAll("[data-sv-lan] > .sv-ligne").forEach((b) =>
      b.addEventListener("click", () => {
        const cle = b.parentElement.dataset.svLan;
        if (etat.ouverts.has(cle)) etat.ouverts.delete(cle);
        else etat.ouverts.add(cle);
        afficher();
      })
    );
    page.querySelectorAll("[data-sv-inclus]").forEach((c) =>
      c.addEventListener("change", () => {
        etat.inclus[c.dataset.svInclus] = c.checked;
        ecrireLocal(CLE_INCLUS, etat.inclus);
        apresChangementInclus();
      })
    );
    page.querySelectorAll("[data-sv-oublier]").forEach((b) => b.addEventListener("click", () => oublierExtraction(b.dataset.svOublier)));
    // Fichier déposé sur la page.
    if (!page.dataset.svDepot) {
      page.dataset.svDepot = "1";
      page.addEventListener("dragover", (e) => e.preventDefault());
      page.addEventListener("drop", (e) => {
        e.preventDefault();
        chargerFichiers(e.dataTransfer.files);
      });
    }
  }

  function apresChangementInclus() {
    pourPartage();
    if (typeof planifierEnvoiTelephone === "function") planifierEnvoiTelephone();
    if (bibliotheque.dossier) synchroniserBibliotheque(false).catch(() => {});
    afficher();
  }

  function rafraichir() {
    if (typeof onglet !== "undefined" && onglet === "suivi") afficher();
  }

  // Au démarrage : les extractions gardées, puis les nouvelles du dossier (s'il est déjà autorisé).
  async function demarrer() {
    try {
      const fichiers = await magasin("fichiers", "readonly", (m) => m.getAll());
      for (const f of fichiers || []) etat.fichiers.set(f.id, f);
      etat.dossier = (await magasin("reglages", "readonly", (m) => m.get("dossier"))) || null;
    } catch (_e) {
      // sans IndexedDB : rien de gardé
    }
    etat.charge = true;
    construireExtractions();
    rafraichir();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && etat.dossier) lireDossier(false);
    });
    if (etat.dossier) await lireDossier(false);
  }

  return { afficher, demarrer, pourPartage, signature, recevoir, chargerFichiers, lireDossier, etat, calculer };
})();

function afficherSuiviProduction() {
  SUIVI.afficher();
}
// Le résumé du suivi de production pour le fichier partagé et le téléphone (null : aucune extraction lue).
function suiviPourPartage() {
  return SUIVI.pourPartage();
}
function signatureSuivi(resume) {
  return SUIVI.signature(resume);
}
