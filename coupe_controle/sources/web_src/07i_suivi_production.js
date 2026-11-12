// ---- V6.2 : Suivi de production ----
// L'avancement de chaque lancement de la bibliothèque, d'après l'extraction « Suivi production » de Diakonos
// (suivi_production_JJMMAAAA.xlsx), comparée au lancement (la règle de l'atelier, V6.3.1) :
//   - un CVC du lancement qui n'est plus dans l'extraction : la pièce est faite ;
//   - un CVC encore dans l'extraction : il reste « Qte en cours » à faire, le reste est fait (lancée 10, en cours 8 :
//     8 à faire, 2 faites).
// Une pièce relancée (casse, retard repris dans un lancement suivant ; Diakonos lui donne un n° de lancement 2, 3…) ne
// compte que dans le lancement le plus récent qui l'a : elle est déduite du lancement d'origine. La casse est suivie dans
// la semaine écrite dans son nom (LAN2646CASSE : semaine 46).
// Un lancement d'une semaine que l'extraction ne contient pas du tout (ex. la 48 dans une extraction qui s'arrête à la
// 47) n'est pas compté (« pas dans cette extraction »).
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
    coloris: ["codecoloris"],
  };
  const perimetreDe = (catalogue) => (/r[ée]sine/i.test(catalogue) ? "resine" : /fourniture|dibond/i.test(catalogue) ? "fournitures" : "production");

  // Les lignes de l'extraction, en tableaux courts : [semaine, année, commande, ligne, catalogue, qté lancement,
  // qté en cours, transporteur, ville, n° de lancement Diakonos, code coloris, ligne brute du fichier, en-tête du fichier]
  // (V6.7.2 : la ligne brute et l'en-tête servent à la liste « Pas dans les lancements » et à son export Excel).
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
          txt(get("transporteur")) || txt(get("codeTransp")) || "(sans transporteur)", txt(get("ville")), txt(get("lancement")), txt(get("coloris")), l, brutes[iEntete]]);
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
  const CLE_VUE = "sentinelle-suivi-vue"; // suivi par semaine, transporteur, coloris ou client (choix retenu)
  const CLE_RESUME = "sentinelle-suivi-resume"; // dernier résumé (le nôtre ou celui du fichier partagé, le plus récent)
  // V6.7.3 : pièces de l'extraction comptées à la main dans un lancement (le fichier LAN n'est jamais modifié).
  const CLE_RAJOUTS = "sentinelle-suivi-rajouts";
  // V6.8.2 : lignes collées (copiées de Diakonos) pour des pièces qui ne sont pas dans l'extraction (ex. Trigano).
  const CLE_COLLEES = "sentinelle-suivi-collees";
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
    vue: lireLocal(CLE_VUE, "semaine"), // suivi par semaine, transporteur, coloris ou client
    filtreVue: "", // texte cherché dans le suivi par…
    groupesOuverts: new Set(), // lignes du suivi par… dont le détail est ouvert
    anciennesOuvertes: false,
    resume: null,
    cleResume: "",
    // V6.7.3 : [{ id, sid (semaine de la bibliothèque), lancement (cleNomLancement), nom, semaine, k, commande, ligne, n,
    // coloris, partiel, quand }] ; partiel = pièce déjà dans ce lancement, on ajoute le surplus de Diakonos.
    rajouts: (() => {
      const x = lireLocal(CLE_RAJOUTS, []);
      return Array.isArray(x) ? x.filter((a) => a && a.id && a.k && a.sid && a.lancement && Number(a.n) > 0) : [];
    })(),
    rajoutsRev: 0,
    rajoutsIgnores: new Set(), // ajouts entiers dont la pièce est arrivée dans un vrai fichier de lancement
    horsCoches: new Set(), // pièces cochées dans « Pas dans les lancements »
    horsLancement: "", // lancement choisi pour y compter les pièces cochées (« sid|cle », ou « __nouveau__ »)
    horsNomNouveau: "", // V6.7.5 : nouveau lancement nommé par l'utilisateur
    horsSemNouveau: "",
    horsPosteNouveau: "Chantiers",
    horsMessage: null, // { genre: bon | alerte, texte }
    // V6.8.2 : [{ k, commande, ligne, catalogue, article, designation, L, l, e, n, coloris, colorisNom, quand }]
    collees: (() => {
      const x = lireLocal(CLE_COLLEES, []);
      return Array.isArray(x) ? x.filter((c) => c && c.k && c.commande && Number(c.n) > 0) : [];
    })(),
    colleesRev: 0,
    texteColle: "",
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
        // La semaine la plus loin dans l'extraction : au-delà, l'extraction ne dit rien.
        let ordreMax = 0;
        for (const r of lignes) if (r[0] && r[1]) ordreMax = Math.max(ordreMax, ordreSemaine(r[1], r[0]));
        const modifie = Math.max(...fichiers.map((f) => f.modifie || 0));
        return { jour, courante, ordre: ordreSemaine(courante.annee, courante.semaine), ordreMax, modifie, fichiers: fichiers.map((f) => ({ nom: f.nom, chemin: f.chemin, id: f.id, genre: f.genre })), lignes, parCle };
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
  const TRANSPORTEUR_INCONNU = "Transporteur inconnu";

  // État d'un lancement : hors_extraction (sa semaine n'est pas dans l'extraction), casse (pas suivie dans Diakonos),
  // termine, retard (semaine passée, pas fini), en_cours.
  function etatLancement(f, r, ordre, courante, couvert, casse) {
    if (!couvert) return "hors_extraction";
    if (f + r === 0) return casse ? "casse" : "absent";
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
    // Étiquettes reçues en direct des PC de validation (une étiquette imprimée = une pièce faite).
    const rev = typeof validations !== "undefined" ? validations.rev : 0;
    const cle = `${bibliotheque.generation}|${etat.generation}|${JSON.stringify(etat.inclus)}|v${rev}|a${etat.rajoutsRev}|c${etat.colleesRev}`;
    if (etat.resume && etat.cleResume === cle) return etat.resume;
    const ex = etat.extractions;
    if (!ex.length) return null;
    const der = ex[ex.length - 1];
    const prec = ex.length > 1 ? ex[ex.length - 2] : null;
    // V6.5.6 : les semaines sont des semaines de LIVRAISON. En semaine 46 du calendrier, on fabrique la livraison 47 :
    // c'est elle la semaine « en fabrication » ; une semaine de livraison d'avant (46, 45…) pas finie est en retard.
    const fab = (() => {
      const d = lundiIso(der.courante.annee, der.courante.semaine);
      d.setUTCDate(d.getUTCDate() + 7 + 3);
      return semaineIso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    })();
    const ordreFab = ordreSemaine(fab.annee, fab.semaine);
    // Suivi en direct : seules comptent les étiquettes imprimées APRÈS la dernière extraction. Celles d'avant y sont
    // déjà : l'extraction fait foi (une dévalidation, une ré-impression, une relance en casse s'y voient).
    const heureExtraction = der.modifie || Date.parse(`${der.jour}T00:00:00`) || 0;
    const direct = typeof etiquettesEnDirect === "function" ? etiquettesEnDirect(heureExtraction) : new Map();
    // Les lancements de la bibliothèque (6 mois autour de la dernière extraction).
    const lancements = [];
    for (const s of bibliotheque.semaines.values()) {
      const actifs = lancementsActifs(s); // V6.7.4 : semaine retirée puis rescannée : ses lancements d'après le retrait
      if (!actifs.length) continue;
      if (Math.abs(ecartSemaines(der.courante, { annee: s.annee, semaine: Number(s.semaine) })) > 26) continue;
      const cols = s.colonnesPieces || COLONNES_PIECES_BIBLIOTHEQUE;
      const iCle = Math.max(0, cols.indexOf("cle"));
      const iQ = cols.indexOf("pieces") >= 0 ? cols.indexOf("pieces") : 4;
      const iCmd = cols.indexOf("commande");
      const iCol = cols.indexOf("coloris");
      const iTr = cols.indexOf("transporteur");
      const iCli = cols.indexOf("client");
      for (const l of actifs) {
        const pieces = new Map();
        const infos = new Map(); // pièce → [commande, coloris, transporteur, client] (suivi par transporteur, coloris, client)
        for (const p of l.pieces || []) {
          const k = p[iCle];
          if (!k) continue;
          pieces.set(k, (pieces.get(k) || 0) + Math.max(0, Number(p[iQ]) || 0));
          const val = (i) => (i >= 0 ? String(p[i] ?? "").trim() : "");
          if (!infos.has(k)) infos.set(k, [val(iCmd), val(iCol), val(iTr), val(iCli)]);
        }
        // La casse est suivie dans la semaine écrite dans son nom (LAN2646CASSE : semaine 46), même si la bibliothèque
        // la range dans la semaine suivante.
        const casse = Boolean(l.casse) || /CASSE/i.test(l.nom);
        let annee = s.annee;
        let semaine = Number(s.semaine);
        const code = casse && typeof semaineEtTourDuLancement === "function" ? semaineEtTourDuLancement(l.nom) : null;
        const n = code ? Number(code[0]) : 0;
        if (n >= 1 && n <= 53 && n !== semaine) {
          annee = n > semaine + 26 ? annee - 1 : n < semaine - 26 ? annee + 1 : annee;
          semaine = n;
        }
        lancements.push({ cle: cleNomLancement(l.nom), nom: l.nom, poste: l.poste || "", casse, id: idSemaine(annee, semaine), annee, semaine, sid: s.id, aj: 0, manuel: Boolean(l.manuel), collees: Array.isArray(l.collees) ? l.collees : null,
          ordre: ordreSemaine(annee, semaine), pieces, infos, deduites: new Map(), vus: new Set(), histo: [], presents: null, f: 0, r: 0, h: 0, fPrec: null, couvert: false });
      }
    }
    // V6.7.3 : les pièces comptées à la main dans un lancement (« Pas dans les lancements » → « Compter dans ce
    // lancement ») : ajoutées à ses pièces comme si elles étaient dans le fichier, qui, lui, n'est pas modifié. Une pièce
    // ajoutée entière qui arrive ensuite dans un vrai fichier de lancement n'est plus ajoutée (pas de double compte).
    etat.rajoutsIgnores = new Set();
    if (etat.rajouts.length) {
      const reelles = new Set();
      for (const L of lancements) for (const k of L.pieces.keys()) reelles.add(k);
      const parLancement = new Map(lancements.map((L) => [`${L.sid}|${L.cle}`, L]));
      for (const a of etat.rajouts) {
        const L = parLancement.get(`${a.sid}|${a.lancement}`);
        if (!L) continue;
        if (!a.partiel && reelles.has(a.k)) {
          etat.rajoutsIgnores.add(a.id);
          continue;
        }
        L.pieces.set(a.k, (L.pieces.get(a.k) || 0) + Number(a.n));
        if (!L.infos.has(a.k)) L.infos.set(a.k, [a.commande || "", a.coloris || "", "", ""]);
        L.aj += Number(a.n);
      }
    }
    // Les pièces de production que Diakonos connaît mais qui ne sont dans AUCUN lancement de la bibliothèque (lancement pas
    // scanné, pièces ajoutées après coup…) : une ligne « Pas dans un lancement » par semaine Diakonos, pour qu'elles
    // comptent dans les barres et dans toutes les vues (avec le coloris de l'extraction). Même règle qu'un lancement :
    // « Qte en cours » à faire, le reste fait ; une pièce qui sort de l'extraction est faite. Une pièce ne compte qu'à
    // partir de l'extraction où elle apparaît (pour l'historique et le « depuis »).
    const lancees = new Set();
    for (const L of lancements) for (const k of L.pieces.keys()) lancees.add(k);
    if (etat.inclus.production) {
      const parPiece = new Map(); // pièce → { annee, semaine, q, infos, debut } (la dernière extraction qui l'a gagne)
      ex.forEach((e, n) => {
        for (const [k, v] of e.parCle) {
          if (lancees.has(k)) continue;
          const r0 = v.lignes[0];
          if (!r0[0] || !r0[1] || perimetreDe(r0[4]) !== "production") continue;
          const avant = parPiece.get(k);
          parPiece.set(k, { annee: r0[1], semaine: Number(r0[0]), q: Math.max(0, v.lanc), infos: [r0[2], r0[10] || "", "", ""], debut: avant ? avant.debut : n });
        }
      });
      const parSem = new Map();
      for (const [k, x] of parPiece) {
        if (!x.q || Math.abs(ecartSemaines(der.courante, { annee: x.annee, semaine: x.semaine })) > 26) continue;
        const id = idSemaine(x.annee, x.semaine);
        if (!parSem.has(id))
          parSem.set(id, { cle: `hors-${id}`, nom: "Pas dans un lancement", poste: "Diakonos", casse: false, hors: true, id, annee: x.annee, semaine: x.semaine,
            ordre: ordreSemaine(x.annee, x.semaine), pieces: new Map(), infos: new Map(), debut: new Map(), deduites: new Map(), vus: new Set(), histo: [],
            presents: null, f: 0, r: 0, h: 0, fPrec: null, couvert: false });
        const L = parSem.get(id);
        L.pieces.set(k, x.q);
        L.infos.set(k, x.infos);
        L.debut.set(k, x.debut);
      }
      lancements.push(...parSem.values());
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
    // Une pièce relancée (casse, retard repris dans un lancement suivant) ne compte que dans le lancement le plus
    // récent qui l'a : elle est déduite du lancement d'origine (règle de l'atelier). Dans une même semaine, la casse
    // passe en dernier (c'est la relance), puis l'ordre des postes (1er tour, recyclage, Feno, 2ème tour, chantiers).
    const recence = (L) => [L.ordre, L.casse ? 1 : 0, rangPoste(L.poste)];
    const plusRecentQue = (a, b) => {
      const x = recence(a);
      const y = recence(b);
      for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] > y[k];
      return a.nom > b.nom;
    };
    const proprietaires = new Map();
    for (const [k, liste] of index) {
      let dernier = liste[0];
      for (const i of liste) if (plusRecentQue(lancements[i], lancements[dernier])) dernier = i;
      const garde = [dernier];
      proprietaires.set(k, garde);
      if (garde.length === liste.length) continue;
      const ou = [...new Set(garde.map((i) => lancements[i].nom))].join(", ");
      for (const i of liste) {
        if (garde.includes(i)) continue;
        const L = lancements[i];
        L.deduites.set(ou, (L.deduites.get(ou) || 0) + L.pieces.get(k));
        L.pieces.delete(k);
      }
    }
    // Extraction après extraction : une pièce encore dans l'extraction va au lancement le plus récent qui l'a.
    ex.forEach((e, n) => {
      const presents = new Map();
      for (const [k, v] of e.parCle) {
        const garde = proprietaires.get(k);
        if (!garde) continue;
        for (const i of garde) {
          if (!presents.has(i)) presents.set(i, new Map());
          presents.get(i).set(k, v);
          lancements[i].vus.add(k);
        }
      }
      const dernier = n === ex.length - 1; // seule l'extraction la plus récente profite des étiquettes en direct
      lancements.forEach((L, i) => {
        const p = presents.get(i) || new Map();
        // Sa semaine n'est pas dans l'extraction (et aucune de ses pièces) : l'extraction ne dit rien de lui…
        const couvertEx = p.size > 0 || L.ordre <= e.ordreMax;
        // …sauf s'il a des pièces étiquetées depuis : il est alors suivi (seules ces pièces sont faites).
        const aDirect = dernier && [...L.pieces.keys()].some((k) => direct.has(k));
        const couvert = couvertEx || aDirect;
        let f = 0;
        let r = 0;
        const detail = n >= ex.length - 2 ? new Map() : null; // par pièce (pour les totaux : une pièce comptée une fois)
        if (couvert)
          for (const [k, q] of L.pieces) {
            if (L.debut && L.debut.get(k) > n) continue; // pas encore dans Diakonos à cette extraction
            const v = p.get(k);
            let fk = 0;
            let rk = 0;
            if (v) {
              // Encore dans l'extraction : « Qte en cours » à faire, le reste du lancement est fait.
              rk = Math.min(q, Math.max(0, v.cours));
              fk = q - rk;
            } else if (couvertEx) fk = q; // le CVC n'est plus dans l'extraction : la pièce est faite (casse comprise)
            else rk = q; // lancement hors extraction (suivi par ses étiquettes) : à faire
            // Les étiquettes imprimées depuis l'extraction : une étiquette = une pièce faite (plafonné à la ligne).
            if (dernier && rk > 0) {
              const plus = Math.min(rk, direct.get(k) || 0);
              fk += plus;
              rk -= plus;
            }
            f += fk;
            r += rk;
            if (detail && (fk || rk)) detail.set(k, [fk, rk]);
          }
        if (n === ex.length - 2) {
          L.fPrec = couvert ? f : null;
          L.detailPrec = detail;
        }
        if (n === ex.length - 1) {
          L.f = f;
          L.r = r;
          L.presents = p;
          L.detail = detail;
          L.couvert = couvert;
        }
        if (couvert && f + r > 0) L.histo.push([e.jour, Math.round((100 * f) / (f + r))]);
      });
    });
    // V6.5.6 : Diakonos donne PLUS de pièces en cours que le lancement n'en contient (pièce relancée dont la relance
    // n'est dans aucun lancement scanné ; cas réel : CVC26100973 ligne 6, deux lignes Diakonos de 2, une seule pièce
    // dans le lancement). Le surplus compte « à faire » dans « Pas dans un lancement » de sa semaine de livraison : aucune
    // pièce en cours dans Diakonos n'est oubliée, et la barre du lancement reste juste.
    const horsDetail = []; // V6.7.2 : { r, n, partiel } — la liste « Pas dans les lancements »
    if (etat.inclus.production) {
      const dejaR = new Map(); // pièce → à faire déjà compté (tous lancements)
      for (const L of lancements) if (L.detail) for (const [k, [, rk]] of L.detail) dejaR.set(k, (dejaR.get(k) || 0) + rk);
      const horsParId = new Map(lancements.filter((L) => L.hors).map((L) => [L.id, L]));
      for (const [k, v] of der.parCle) {
        const r0 = v.lignes[0];
        if (!lancees.has(k) || !r0[0] || !r0[1] || perimetreDe(r0[4]) !== "production") continue;
        const surplus = Math.max(0, Math.max(0, v.cours) - (direct.get(k) || 0) - (dejaR.get(k) || 0));
        if (!surplus) continue;
        const iProprio = (proprietaires.get(k) || [])[0];
        const P = iProprio === undefined ? null : lancements[iProprio];
        horsDetail.push({ r: v.lignes[v.lignes.length - 1], n: surplus, partiel: true, k, nAjout: surplus, proprio: P && P.sid ? { sid: P.sid, cle: P.cle, nom: P.nom, semaine: P.semaine } : null });
        const annee = r0[1];
        const semaine = Number(r0[0]);
        const id = idSemaine(annee, semaine);
        let L = horsParId.get(id);
        if (!L) {
          L = { cle: `hors-${id}`, nom: "Pas dans un lancement", poste: "Diakonos", casse: false, hors: true, id, annee, semaine, ordre: ordreSemaine(annee, semaine),
            pieces: new Map(), infos: new Map(), debut: new Map(), deduites: new Map(), vus: new Set(), histo: [], presents: new Map(), detail: new Map(),
            f: 0, r: 0, h: 0, fPrec: null, couvert: true };
          horsParId.set(id, L);
          lancements.push(L);
        }
        L.pieces.set(k, (L.pieces.get(k) || 0) + surplus);
        if (!L.surplus) L.surplus = new Set();
        L.surplus.add(k);
        if (!L.infos.has(k)) L.infos.set(k, [r0[2], r0[10] || "", "", ""]);
        if (!L.detail) L.detail = new Map();
        const d = L.detail.get(k) || [0, 0];
        L.detail.set(k, [d[0], d[1] + surplus]);
        L.r += surplus;
        L.couvert = true;
        if (L.presents) L.presents.set(k, v); // ses commandes encore à faire
      }
      lancements.sort((a, b) => a.ordre - b.ordre || rangPoste(a.poste) - rangPoste(b.poste) || a.nom.localeCompare(b.nom));
    }
    etat.lancementsCalcul = lancements; // pour le contrôle « Sentinelle = Diakonos » (test_web_suivi_diakonos.js)
    const total = (L) => [...L.pieces.values()].reduce((t, q) => t + q, 0);
    for (const L of lancements) {
      L.h = Math.max(0, total(L) - L.f - L.r);
      L.x = [...L.deduites.values()].reduce((t, q) => t + q, 0);
      L.xd = [...L.deduites.keys()].join(", ");
    }
    // Les commandes encore à faire d'un lancement.
    const commandes = (L) => {
      const par = new Map();
      for (const [k, v] of L.presents || []) {
        const r0 = v.lignes[0];
        const reste = Math.max(0, Math.min(L.pieces.get(k), Math.max(0, v.cours)) - (direct.get(k) || 0));
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
      if (r === 0 && f > 0 && ecartSemaines({ annee: s.annee, semaine: s.semaine }, der.courante) > 3) {
        anciennes++;
        continue;
      }
      const couverte = s.lancements.some((L) => L.couvert);
      semaines.push({
        id: s.id, annee: s.annee, semaine: s.semaine, f, r, h, e: etatLancement(f, r, s.ordre, ordreFab, couverte, s.lancements.every((L) => L.casse)),
        lancements: s.lancements.map((L) => ({
          cle: L.cle, nom: L.nom, poste: L.poste, f: L.f, r: L.r, h: L.h, x: L.x, xd: L.xd, aj: L.aj || 0, m: L.manuel ? 1 : 0, e: etatLancement(L.f, L.r, L.ordre, ordreFab, L.couvert, L.casse),
          d: L.fPrec === null ? null : L.f - L.fPrec, p: L.histo.slice(-10), c: commandes(L),
        })),
      });
    }
    // Ce qui est compté (production, fournitures, résine) : pour « hors lancement » et le tableau des transporteurs.
    const comptee = (r) => Boolean(etat.inclus[perimetreDe(r[4])]);
    const dansLancement = lancees; // les vrais lancements (pas les lignes « Pas dans un lancement »)
    const hors = new Map();
    const tableau = new Map();
    const colonnes = new Map();
    for (const r of der.lignes) {
      if (!comptee(r)) continue;
      const { cle: cs, libelle } = libelleCle(r[0], r[1], fab);
      colonnes.set(cs, libelle);
      if (!dansLancement.has(cleLigne(r[2], r[3]))) {
        // Seulement la production : fournitures, Dibond et résine ne passent jamais par les fichiers de lancement.
        // nAjout (V6.7.3) : compter la pièce dans un lancement = toutes ses pièces Diakonos (lancées ou en cours).
        if (r[6] > 0 && perimetreDe(r[4]) === "production") {
          const k = cleLigne(r[2], r[3]);
          const v = der.parCle.get(k);
          horsDetail.push({ r, n: r[6], partiel: false, k, nAjout: Math.max(1, v ? Math.max(v.lanc, v.cours) : r[6]) });
        }
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
      const enPlus = [0, 0]; // V6.5.6 : le surplus Diakonos d'une pièce s'ajoute (ce n'est pas la même pièce comptée deux fois)
      for (const L of lancements) {
        if (!affiches.has(L.id) || !L[cle]) continue;
        for (const [k, v] of L[cle]) {
          if (L.surplus && L.surplus.has(k) && cle === "detail") {
            enPlus[0] += v[0];
            enPlus[1] += v[1];
            continue;
          }
          const a = m.get(k);
          m.set(k, a ? [Math.max(a[0], v[0]), Math.max(a[1], v[1])] : v);
        }
      }
      return [...m.values()].reduce((t, v) => [t[0] + v[0], t[1] + v[1]], enPlus);
    };
    // Suivi par semaine, par transporteur, par coloris : les mêmes pièces et le même calcul que les barres (faites =
    // lancées − « Qte en cours », CVC plus dans l'extraction = faite ; une pièce relancée compte dans le plus récent).
    // Transporteur : celui du fichier de lancement (trans_nomcourt) ; pour un lancement rangé avant la V6.3.3 (sans
    // cette colonne), celui de Diakonos (la pièce, sinon sa commande), ramené au nom du fichier de lancement quand on le
    // connaît. « LOG4 T3 » et « LOG 4 T3 » : le même transporteur (écrit comme le plus souvent).
    const transpCle = new Map();
    const transpCommande = new Map();
    // V6.5.6 : la semaine de LIVRAISON de chaque pièce (colonne Semaine de Diakonos, la dernière extraction qui l'a) :
    // les vues la rangent là, comme Diakonos (une pièce de livraison 46 dans un lancement casse ou d'une autre semaine
    // reste en semaine 46). Une pièce sortie de toutes les extractions garde la semaine de son lancement.
    const livraisonCle = new Map();
    const colorisCle = new Map(); // V6.5.6 : le code coloris de Diakonos (comme dans Diakonos)
    for (const e of ex)
      for (const r of e.lignes) {
        if (r[0] && r[1]) livraisonCle.set(cleLigne(r[2], r[3]), { annee: Number(r[1]), semaine: Number(r[0]) });
        if (r[10]) colorisCle.set(cleLigne(r[2], r[3]), r[10]);
        if (!r[7] || r[7] === "(sans transporteur)") continue;
        transpCle.set(cleLigne(r[2], r[3]), r[7]);
        transpCommande.set(r[2], r[7]);
      }
    const cleTr = (t) => t.toUpperCase().replace(/\s+/g, "");
    const ecritures = new Map(); // transporteur → { écriture : nombre de pièces }
    const compter = (m, a, b) => {
      if (!m.has(a)) m.set(a, new Map());
      m.get(a).set(b, (m.get(a).get(b) || 0) + 1);
    };
    const lePlusSouvent = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    // V6.5.6 : les noms de DIAKONOS (ceux que l'atelier voit et cherche dans Diakonos : « LOG 4 T1 LAISNE »,
    // « MULTICOURSES »…). Une pièce dans l'extraction : le transporteur Diakonos de la pièce, sinon de sa commande.
    // Une pièce déjà faite (sortie de l'extraction) : le nom du fichier de lancement, ramené au nom Diakonos qu'on lui
    // connaît (« LOG 4 T1 » → « LOG 4 T1 LAISNE »). Un « transporteur » qui est une dimension (« 3045 X 1305 X30 »,
    // colonne décalée dans un fichier de lancement) est ignoré.
    const nomValide = (t) => Boolean(t) && !/\d\s*[xX×]\s*\d/.test(t);
    const versDiakonos = new Map(); // nom du fichier de lancement → { nom Diakonos : nombre de pièces }
    for (const L of lancements) {
      if (!affiches.has(L.id) || !L.detail) continue;
      for (const k of L.detail.keys()) {
        const [commande, , tr] = L.infos.get(k) || ["", "", ""];
        if (!nomValide(tr)) continue;
        const diak = transpCle.get(k) || transpCommande.get(commande);
        compter(ecritures, cleTr(tr), tr.replace(/\s+/g, " "));
        if (diak) compter(versDiakonos, cleTr(tr), diak);
      }
    }
    const transporteurDe = (k, commande, tr) => {
      const diak = transpCle.get(k) || transpCommande.get(commande);
      if (diak) return diak;
      if (!nomValide(tr)) return TRANSPORTEUR_INCONNU;
      const c = versDiakonos.get(cleTr(tr));
      return c ? lePlusSouvent(c) : lePlusSouvent(ecritures.get(cleTr(tr)));
    };
    const groupes = { semaine: new Map(), transporteur: new Map(), coloris: new Map(), client: new Map() };
    const ajouter = (vue, cle, nom, ordre, sCle, sNom, sOrdre, fk, rk, enRetard) => {
      const m = groupes[vue];
      if (!m.has(cle)) m.set(cle, { nom, ordre, f: 0, r: 0, retard: false, sous: new Map() });
      const g = m.get(cle);
      g.f += fk;
      g.r += rk;
      if (enRetard) g.retard = true;
      if (!g.sous.has(sCle)) g.sous.set(sCle, { nom: sNom, ordre: sOrdre, f: 0, r: 0, retard: false });
      const x = g.sous.get(sCle);
      x.f += fk;
      x.r += rk;
      if (enRetard) x.retard = true;
    };
    for (const L of lancements) {
      if (!affiches.has(L.id) || !L.detail) continue;
      for (const [k, [fk, rk]] of L.detail) {
        const [commande, coloris, trLan, client] = L.infos.get(k) || ["", "", "", ""];
        const tr = transporteurDe(k, commande, trLan);
        const co = colorisCle.get(k) || coloris || "Sans coloris";
        const liv = livraisonCle.get(k) || { annee: L.annee, semaine: L.semaine };
        const sId = idSemaine(liv.annee, liv.semaine);
        const sOrdre = ordreSemaine(liv.annee, liv.semaine);
        const nomSem = `Semaine ${liv.semaine}`;
        const enRetard = rk > 0 && sOrdre < ordreFab;
        ajouter("semaine", sId, nomSem, sOrdre, tr, tr, 0, fk, rk, enRetard);
        ajouter("transporteur", tr, tr, 0, sId, nomSem, sOrdre, fk, rk, enRetard);
        ajouter("coloris", co, co, 0, sId, nomSem, sOrdre, fk, rk, enRetard);
        ajouter("client", client || "Sans client", client || "Sans client", 0, sId, nomSem, sOrdre, fk, rk, enRetard);
      }
    }
    const etatGroupe = (g) => (g.f + g.r === 0 ? "absent" : g.r === 0 ? "termine" : g.retard ? "retard" : "en_cours");
    // Par semaine : dans l'ordre ; ailleurs : le plus à faire d'abord (« Transporteur inconnu » à la fin).
    const trier = (a, b) => (a.ordre || b.ordre ? a.ordre - b.ordre : (a.nom === TRANSPORTEUR_INCONNU) - (b.nom === TRANSPORTEUR_INCONNU) || b.r - a.r || b.f - a.f || a.nom.localeCompare(b.nom));
    const ligneGroupe = (g) => [g.nom, g.f, g.r, etatGroupe(g), [...g.sous.values()].sort(trier).map((x) => [x.nom, x.f, x.r, etatGroupe(x)])];
    const vues = {
      // Par semaine de livraison des pièces ; chaque semaine de la bibliothèque affichée, même sans pièce suivie
      // (ex. « pas dans cette extraction »).
      semaine: [...new Set([...semaines.map((s) => s.id), ...groupes.semaine.keys()])]
        .map((id) => {
          const g = groupes.semaine.get(id);
          const s = semaines.find((x) => x.id === id);
          const ordre = g ? g.ordre : ordreSemaine(s.annee, s.semaine);
          return [ordre, g ? [g.nom, g.f, g.r, etatGroupe(g), [...g.sous.values()].sort(trier).map((x) => [x.nom, x.f, x.r, etatGroupe(x)])] : [`Semaine ${s.semaine}`, s.f, s.r, s.e, []]];
        })
        .sort((a, b) => a[0] - b[0])
        .map((x) => x[1]),
      transporteur: [...groupes.transporteur.values()].sort(trier).map(ligneGroupe),
      coloris: [...groupes.coloris.values()].sort(trier).map(ligneGroupe),
      client: [...groupes.client.values()].sort(trier).map(ligneGroupe),
    };
    const [faites, restantes] = unique("detail");
    const [faitesAvant] = unique("detailPrec");
    const resume = {
      version: 1,
      jour: der.jour,
      semaine: der.courante.semaine,
      annee: der.courante.annee,
      // V6.5.6 : la semaine de livraison en fabrication (semaine du calendrier + 1).
      fabrication: { semaine: fab.semaine, annee: fab.annee },
      fichiers: der.fichiers.map((f) => f.nom),
      // La semaine la plus loin dans l'extraction (au-delà : « pas dans cette extraction »).
      semaineMax: der.ordreMax ? der.ordreMax % 100 : null,
      anneeMax: der.ordreMax ? Math.floor(der.ordreMax / 100) : null,
      enregistre: der.modifie ? new Date(der.modifie).toISOString() : null,
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
      // Suivi par semaine / transporteur / coloris / client : [nom, faites, à faire, état, [[nom, faites, à faire, état], …]].
      vues,
    };
    etat.resume = resume;
    etat.cleResume = cle;
    // V6.8.2 : les lignes collées (pas dans l'extraction), sauf celles déjà dans un lancement ou dans l'extraction.
    for (const c of etat.collees) {
      if (lancees.has(c.k) || der.parCle.has(c.k)) continue;
      horsDetail.push({ r: ligneDeCollee(c), n: Number(c.n), partiel: false, k: c.k, nAjout: Number(c.n), collee: c });
    }
    etat.lanceesCalcul = lancees;
    etat.horsDetail = horsDetail.sort((a, b) => (a.r[1] || 0) * 100 + (a.r[0] || 0) - ((b.r[1] || 0) * 100 + (b.r[0] || 0)) || String(a.r[2]).localeCompare(String(b.r[2])) || Number(a.r[3]) - Number(b.r[3]));
    etat.horsLancements = lancees.size;
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
  const LIBELLES_ETAT = {
    termine: "Terminé", absent: "Rien à suivre", attente: "Pas encore dans Diakonos", hors_extraction: "Pas dans cette extraction",
    casse: "Casse : pas suivie dans Diakonos", retard: "En retard", en_cours: "En cours",
  };
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

  function texteChiffres(L, resume) {
    if (L.e === "hors_extraction")
      return `${pluriel(L.h, "pièce", "pièces")} · sa semaine n'est pas dans l'extraction du ${echapper(jourCourt(resume.jour))}${resume.semaineMax ? ` (elle va jusqu'à la semaine ${resume.semaineMax})` : ""}`;
    const relancees =
      (L.x ? ` <span class="pale">· ${pluriel(L.x, "pièce relancée", "pièces relancées")} dans ${echapper(L.xd)} (comptée${L.x > 1 ? "s" : ""} là-bas)</span>` : "") +
      (L.aj ? ` <span class="pale">· dont ${pluriel(L.aj, "pièce ajoutée", "pièces ajoutées")} à la main</span>` : "") +
      (L.m ? ` <span class="pale">· lancement créé dans Sentinelle</span>` : "");
    if (L.f + L.r === 0) return `rien à suivre${relancees}`;
    return `<strong>${fmt(L.f)}</strong> faite${L.f > 1 ? "s" : ""} · <strong>${fmt(L.r)}</strong> à faire${relancees}`;
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
        }</div>`;
    return `<div class="sv-lan${ouvert ? " ouvert" : ""}" data-sv-lan="${echapper(L.cle)}">
      <button type="button" class="sv-ligne" aria-expanded="${ouvert}">
        <span class="sv-nom"><span class="sv-poste">${echapper(L.poste || "Lancement")}</span><span class="sv-fichier">${echapper(L.nom)}</span></span>
        <span class="sv-milieu">${barre(L.f, L.r, L.e)}<span class="sv-chiffres">${texteChiffres(L, resume)}</span></span>
        <span class="sv-droite"><span class="sv-pct sv-t-${L.e}">${p === null ? echapper(LIBELLES_ETAT[L.e]) : `${p} %`}</span>${p !== null ? `<span class="sv-etat sv-t-${L.e}">${echapper(L.e === "en_cours" && !L.f ? "À faire" : LIBELLES_ETAT[L.e])}</span>` : ""}${texteEvolution(L, resume)}${courbe(L.p)}</span>
      </button>${detail}</div>`;
  }

  function htmlSemaine(s, resume) {
    const p = pct(s.f, s.r);
    const enFab = resume.fabrication || { semaine: resume.semaine, annee: resume.annee };
    const courante = s.annee === enFab.annee && s.semaine === enFab.semaine;
    return `<div class="sv-semaine">
      <div class="sv-sem-tete"><div><span class="sv-sem-nom">Semaine ${s.semaine}</span>${courante ? ' <span class="sv-badge">en fabrication</span>' : ""}<span class="sv-sem-dates">${echapper(datesDeLaSemaine(s.annee, s.semaine))}</span></div>
        <div class="sv-sem-barre">${barre(s.f, s.r, s.e)}<span class="sv-pct sv-t-${s.e}">${p === null ? echapper(LIBELLES_ETAT[s.e]) : `${p} %`}</span></div></div>
      ${s.lancements.map((L) => htmlLancement(L, resume)).join("")}</div>`;
  }

  // L'avancement est celui du jour de l'extraction : si elle date, on le dit (et la date du fichier si elle diffère).
  function avertissementAge(jour, modifie) {
    const jours = Math.floor((Date.now() - dateDuJour(jour).getTime()) / 86400000);
    const enregistre = modifie ? jourIso(new Date(modifie)) : "";
    let t = "";
    if (jours >= 2) t = `⚠ Cette extraction date du ${jourLong(jour)} (il y a ${jours} jours) : l'avancement montré est celui de ce jour-là. Mettez la dernière extraction de Diakonos dans le dossier (ou chargez-la), puis « Actualiser ».`;
    if (enregistre && enregistre > jour && Math.floor((dateDuJour(enregistre) - dateDuJour(jour)) / 86400000) >= 1)
      t += `${t ? " " : "⚠ "}Le nom du fichier dit ${jourLong(jour)}, mais il a été enregistré le ${jourLong(enregistre)} : si c'est l'extraction du ${jourLong(enregistre)}, mettez cette date dans son nom (suivi_production_${enregistre.slice(8, 10)}${enregistre.slice(5, 7)}${enregistre.slice(0, 4)}.xlsx).`;
    return t ? `<div class="sv-message alerte">${echapper(t)}</div>` : "";
  }

  function htmlCarteExtraction(resume, local) {
    const d = etat.dossier;
    const i = etat.infoDossier || {};
    const der = etat.extractions[etat.extractions.length - 1];
    let html = `<div class="carte" id="svCarteExtraction"><div class="carte-titre">Extraction Diakonos</div>`;
    if (der) {
      html += `<div class="sv-source">Dernière extraction : <strong>${echapper(jourLong(der.jour))}</strong> (semaine ${der.courante.semaine}) · ${der.fichiers.map((f) => `<span class="sv-fichier-lu">${echapper(f.nom)}</span>`).join(" + ")}${
        der.ordreMax ? ` · <span class="pale">semaines jusqu'à la ${der.ordreMax % 100}</span>` : ""
      }${etat.extractions.length > 1 ? ` · <span class="pale">${etat.extractions.length} extractions gardées pour l'évolution</span>` : ""}</div>`;
      html += avertissementAge(der.jour, der.modifie);
    } else if (resume && !local) {
      html += `<div class="sv-source">Avancement reçu du fichier partagé : extraction du <strong>${echapper(jourLong(resume.jour))}</strong>, lue sur un autre PC.</div>`;
      html += avertissementAge(resume.jour, 0);
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

  // Suivi par semaine, par transporteur, par coloris, par client : une barre par ligne, le même calcul que les lancements.
  const VUES = [
    ["semaine", "Semaine", "transporteur"],
    ["transporteur", "Transporteur", "semaine"],
    ["coloris", "Coloris", "semaine"],
    ["client", "Client", "semaine"],
  ];
  function chiffresGroupe(f, r, e, resume) {
    if (e === "hors_extraction") return `pas dans l'extraction du ${echapper(jourCourt(resume.jour))}`;
    if (f + r === 0) return "rien à suivre";
    return `<strong>${fmt(f)}</strong> faite${f > 1 ? "s" : ""} · <strong>${fmt(r)}</strong> à faire`;
  }
  function droiteGroupe(f, r, e) {
    const p = pct(f, r);
    return `<span class="sv-pct sv-t-${e}">${p === null ? echapper(LIBELLES_ETAT[e]) : `${p} %`}</span>${p !== null ? `<span class="sv-etat sv-t-${e}">${echapper(e === "en_cours" && !f ? "À faire" : LIBELLES_ETAT[e])}</span>` : ""}`;
  }
  function htmlVues(resume) {
    const v = resume.vues;
    if (!v) return "";
    const [vue, nomVue, nomSous] = VUES.find(([k]) => k === etat.vue) || VUES[0];
    const lignes = v[vue] || [];
    const groupe = (g) => {
      const cle = `${vue}|${g[0]}`;
      const ouvert = etat.groupesOuverts.has(cle);
      const sous = g[4] || [];
      const detail = !ouvert
        ? ""
        : `<div class="sv-detail">${
            sous.length
              ? sous.map((x) => `<div class="sv-sous"><span class="sv-sous-nom">${echapper(x[0])}</span><span class="sv-milieu">${barre(x[1], x[2], x[3])}<span class="sv-chiffres">${chiffresGroupe(x[1], x[2], x[3], resume)}</span></span><span class="sv-droite">${droiteGroupe(x[1], x[2], x[3])}</span></div>`).join("")
              : `<div class="note">Aucune pièce suivie.</div>`
          }</div>`;
      const cache = etat.filtreVue && !sansAccents(g[0]).includes(sansAccents(etat.filtreVue));
      return `<div class="sv-lan${ouvert ? " ouvert" : ""}" data-sv-groupe="${echapper(cle)}" data-sv-nom="${echapper(sansAccents(g[0]))}"${cache ? " hidden" : ""}>
        <button type="button" class="sv-ligne" aria-expanded="${ouvert}">
          <span class="sv-nom"><span class="sv-poste">${echapper(g[0])}</span></span>
          <span class="sv-milieu">${barre(g[1], g[2], g[3])}<span class="sv-chiffres">${chiffresGroupe(g[1], g[2], g[3], resume)}</span></span>
          <span class="sv-droite">${droiteGroupe(g[1], g[2], g[3])}</span>
        </button>${detail}</div>`;
    };
    return `<div class="carte" id="svVues"><div class="carte-titre">Suivi par ${nomVue.toLowerCase()}</div>
      <div class="sv-vues"><div class="choix-semaine" role="group" aria-label="Suivi par">${VUES.map(([k, n]) => `<button type="button" data-sv-vue="${k}"${k === vue ? ' class="actif" aria-pressed="true"' : ' aria-pressed="false"'}>${n}</button>`).join("")}</div>
        ${vue !== "semaine" ? `<input type="search" id="svFiltreVue" placeholder="Chercher un ${nomVue.toLowerCase()}…" aria-label="Chercher" value="${echapper(etat.filtreVue)}">` : ""}</div>
      <div class="note">Les pièces des lancements, comptées comme les barres : faites = lancées − « Qte en cours » (CVC plus dans l'extraction = faite). Un clic sur une ligne : le détail par ${nomSous}.</div>
      ${vue === "transporteur" && lignes.some((g) => g[0] === TRANSPORTEUR_INCONNU) ? `<div class="sv-message">« ${TRANSPORTEUR_INCONNU} » : pièces de lancements rangés dans la bibliothèque avant la version 6.3.3, déjà faites (plus dans l'extraction). Scannez de nouveau leur semaine dans « Contrôler la coupe » : le transporteur sera pris dans le fichier de lancement.</div>` : ""}
      ${lignes.length ? lignes.map(groupe).join("") : '<div class="note">Aucune pièce suivie.</div>'}</div>`;
  }

  function htmlTableau(resume, local) {
    const t = resume.tableau;
    if (!t || !t.lignes.length) return "";
    const totaux = t.colonnes.map((_, i) => t.lignes.reduce((s, l) => s + (Number(l[i + 1]) || 0), 0));
    return `<div class="carte"><div class="carte-titre">Qté en cours par transporteur et par semaine (comme dans Excel)</div>
      ${local ? htmlInclus(resume) : ""}
      <div class="defile"><table class="sv-table sv-croise"><thead><tr><th>Transporteur</th>${t.colonnes.map((c) => `<th class="nombre">${echapper(c)}</th>`).join("")}</tr></thead>
      <tbody>${t.lignes.map((l) => `<tr><td>${echapper(l[0])}</td>${l.slice(1).map((v, i) => `<td class="nombre${i === l.length - 2 ? " total" : ""}">${v ? fmt(v) : ""}</td>`).join("")}</tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td>${totaux.map((v) => `<td class="nombre total">${fmt(v)}</td>`).join("")}</tr></tfoot></table></div>
      <div class="note">Somme de « Qté en cours » de toute l'extraction du ${echapper(jourLong(resume.jour))} (lancements ou pas), comme dans Excel : pour contrôler avec Diakonos.</div></div>`;
  }

  // V6.7.2 : « Pas dans les lancements » — toutes les lignes de la dernière extraction (ce qui est compté : production,
  // et fournitures / résine si cochées) dont la pièce (commande + ligne) n'est dans aucun fichier de lancement de la
  // bibliothèque, plus le surplus d'une pièce lancée (Diakonos en a plus en cours que le lancement). Fond jaune ; filtre
  // par semaine de livraison et recherche ; export Excel avec les colonnes du fichier de suivi, lignes en jaune.
  const champBrut = (r, ...noms) => {
    if (!r[11] || !r[12]) return null;
    const i = r[12].findIndex((v) => noms.includes(sansAccents(v)));
    return i < 0 ? null : r[11][i];
  };
  const texteBrut = (r, ...noms) => {
    const v = champBrut(r, ...noms);
    return v === null || v === undefined ? "" : String(v).trim();
  };
  // ---------- V6.8.2 : lignes collées (copiées de Diakonos), pour les pièces qui ne sont pas dans l'extraction ----------
  // Cas réel : les pièces Trigano (articles TRI-…) ne passent pas par le chemin standard des lancements ; certaines ne
  // sont pas encore dans l'extraction. Format collé (tabulations, comme une copie de Diakonos ou d'Excel) :
  // commande, ligne, catalogue, article, désignation, longueur, largeur, épaisseur, quantité, code coloris, coloris.
  const ENTETE_COLLEE = ["Commande", "Ligne", "Catalogue", "Article", "Désignation", "Longueur", "Largeur", "Epaisseur", "Qte", "Code Coloris", "Coloris"];
  function ligneDeCollee(c) {
    const brut = [c.commande, c.ligne, c.catalogue, c.article, c.designation, c.L, c.l, c.e, Number(c.n), c.coloris, c.colorisNom];
    return [null, null, c.commande, String(c.ligne), c.catalogue || "(sans catalogue)", Number(c.n), Number(c.n), "", "", "", c.coloris || "", brut, ENTETE_COLLEE];
  }
  function lireLignesCollees(texte) {
    const lignes = [];
    const refus = [];
    const nombre = (t) => {
      const v = String(t ?? "").replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
      return /^\d+(\.\d+)?$/.test(v) ? Number(v) : null;
    };
    String(texte || "")
      .split(/\r?\n/)
      .forEach((brut, i) => {
        if (!brut.trim()) return;
        let t = brut.split("\t").map((x) => x.trim());
        if (t.length < 6) t = brut.split(";").map((x) => x.trim());
        const iCmd = t.findIndex((x) => /^CVC[0-9A-Z]{5,}$/i.test(x));
        if (iCmd < 0) {
          refus.push(`ligne ${i + 1} : pas de n° de commande (CVC + 8 chiffres)`);
          return;
        }
        const commande = t[iCmd].toUpperCase();
        const ligne = nombre(t[iCmd + 1]);
        // Après la désignation : longueur, largeur, épaisseur, quantité (nombres), puis code coloris et coloris.
        const nums = [];
        let j = iCmd + 5;
        for (; j < t.length && nums.length < 4; j++) {
          const v = nombre(t[j]);
          if (v !== null) nums.push(v);
        }
        if (!Number.isInteger(ligne) || nums.length < 4 || !Number.isInteger(nums[3]) || nums[3] < 1) {
          refus.push(`ligne ${i + 1} (${commande}) : il faut ligne, longueur, largeur, épaisseur et quantité`);
          return;
        }
        lignes.push({ k: cleLigne(commande, String(ligne)), commande, ligne: String(ligne), catalogue: t[iCmd + 2] || "", article: t[iCmd + 3] || "", designation: t[iCmd + 4] || "",
          L: nums[0], l: nums[1], e: nums[2], n: nums[3], coloris: (t[j] || "").toUpperCase(), colorisNom: t[j + 1] || "", quand: new Date().toISOString() });
      });
    return { lignes, refus };
  }
  function ajouterLignesCollees() {
    const { lignes, refus } = lireLignesCollees(etat.texteColle);
    const der = etat.extractions[etat.extractions.length - 1];
    const lancees = etat.lanceesCalcul || new Set();
    let n = 0;
    const deja = [];
    for (const c of lignes) {
      if (lancees.has(c.k)) {
        deja.push(`${c.commande} l.${c.ligne} : déjà dans un lancement`);
        continue;
      }
      if (der && der.parCle.has(c.k)) {
        deja.push(`${c.commande} l.${c.ligne} : déjà dans la liste (extraction)`);
        continue;
      }
      etat.collees = etat.collees.filter((x) => x.k !== c.k);
      etat.collees.push(c);
      n++;
    }
    ecrireLocal(CLE_COLLEES, etat.collees);
    etat.colleesRev++;
    if (n) {
      etat.texteColle = "";
      etat.horsSemaine = "collees";
    }
    const morceaux = [n ? `✔ ${n} ligne${n > 1 ? "s" : ""} ajoutée${n > 1 ? "s" : ""} à la liste : cochez-les et choisissez le lancement` : "Aucune ligne ajoutée", ...deja, ...refus];
    etat.horsMessage = { genre: n && !refus.length ? "bon" : "alerte", texte: morceaux.join(" ; ") };
    afficher();
  }
  function retirerCollee(k) {
    etat.collees = etat.collees.filter((x) => x.k !== k);
    etat.horsCoches.delete(k);
    ecrireLocal(CLE_COLLEES, etat.collees);
    etat.colleesRev++;
    afficher();
  }

  function horsFiltres() {
    const q = sansAccents(etat.horsRecherche || "");
    return (etat.horsDetail || []).filter((x) => {
      if (etat.horsSemaine === "collees") {
        if (!x.collee) return false;
      } else if (etat.horsSemaine && `${x.r[1]}-${x.r[0]}` !== etat.horsSemaine) return false;
      if (!q) return true;
      return sansAccents([x.r[2], x.r[3], x.r[4], x.r[7], x.r[8], x.r[10], texteBrut(x.r, "article"), texteBrut(x.r, "designation"), texteBrut(x.r, "coloris"), texteBrut(x.r, "groupement")].join(" ")).includes(q);
    });
  }

  function htmlHors(resume, local) {
    if (!local || !etat.horsDetail) {
      if (!resume.hors || !resume.hors.length) return "";
      return `<div class="carte"><div class="carte-titre">Pas dans les lancements</div>
      <div class="note">Pièces de l'extraction qui ne sont dans aucun lancement de la bibliothèque (pas encore lancées, ou lancement pas scanné). Chargez l'extraction sur ce PC pour en voir la liste.</div>
      <table class="sv-table"><thead><tr><th>Semaine Diakonos</th><th class="nombre">Pièces à faire</th><th class="nombre">Lignes</th><th class="nombre">Commandes</th></tr></thead>
      <tbody>${resume.hors.map((h) => `<tr><td>${echapper(h[0])}</td><td class="nombre">${fmt(h[1])}</td><td class="nombre">${fmt(h[2])}</td><td class="nombre">${fmt(h[3])}</td></tr>`).join("")}</tbody></table></div>`;
    }
    const tout = etat.horsDetail;
    const parSem = new Map();
    for (const x of tout) {
      if (x.collee) continue;
      const id = `${x.r[1]}-${x.r[0]}`;
      const g = parSem.get(id) || { id, annee: x.r[1], semaine: x.r[0], pieces: 0, lignes: 0 };
      g.pieces += x.n;
      g.lignes++;
      parSem.set(id, g);
    }
    const semaines = [...parSem.values()].sort((a, b) => (a.annee || 0) * 100 + (a.semaine || 0) - ((b.annee || 0) * 100 + (b.semaine || 0)));
    const nbCollees = tout.filter((x) => x.collee).reduce((t, x) => t + x.n, 0);
    if (etat.horsSemaine && !parSem.has(etat.horsSemaine) && !(etat.horsSemaine === "collees" && nbCollees)) etat.horsSemaine = "";
    const liste = horsFiltres();
    const total = liste.reduce((t, x) => t + x.n, 0);
    const puces = [`<button type="button" class="sv-puce${etat.horsSemaine ? "" : " actif"}" data-sv-hors-sem="">Toutes · ${fmt(tout.reduce((t, x) => t + x.n, 0))}</button>`]
      .concat(semaines.map((g) => `<button type="button" class="sv-puce${etat.horsSemaine === g.id ? " actif" : ""}" data-sv-hors-sem="${echapper(g.id)}">S${g.semaine || "?"} · ${fmt(g.pieces)}</button>`))
      .concat(nbCollees ? [`<button type="button" class="sv-puce${etat.horsSemaine === "collees" ? " actif" : ""}" data-sv-hors-sem="collees">Collées · ${fmt(nbCollees)}</button>`] : [])
      .join("");
    const dims = (r) => [texteBrut(r, "longueur"), texteBrut(r, "largeur"), texteBrut(r, "epaisseur")].filter(Boolean).join(" × ");
    const lignes = liste
      .map(
        (x) => `<tr class="sv-hors-ligne"><td><input type="checkbox" data-sv-hors-coche="${echapper(x.k)}"${etat.horsCoches.has(x.k) ? " checked" : ""} aria-label="Cocher"></td><td>${x.collee ? `<span class="pale">collée</span><div><button type="button" class="texte" data-sv-collee-retirer="${echapper(x.k)}">Retirer</button></div>` : `S${x.r[0] || "?"}`}</td><td><strong>${echapper(x.r[2])}</strong></td><td class="nombre">${echapper(x.r[3])}</td><td>${echapper(x.r[4])}</td>
        <td>${echapper(texteBrut(x.r, "article"))}<div class="pale">${echapper(texteBrut(x.r, "designation"))}</div></td>
        <td class="nombre"><strong>${fmt(x.n)}</strong>${x.partiel ? `<div class="pale">en plus du lancement${x.proprio ? ` ${echapper(x.proprio.nom)}` : ""}</div>` : ""}</td><td class="nombre">${echapper(dims(x.r))}</td>
        <td>${echapper(x.r[10] || "")}<div class="pale">${echapper(texteBrut(x.r, "coloris"))}</div></td><td>${echapper(x.r[7])}</td><td>${echapper(x.r[8])}</td><td>${echapper(texteBrut(x.r, "groupement"))}</td></tr>`
      )
      .join("");
    return `<div class="carte" id="svHors"><div class="carte-titre">Pas dans les lancements</div>
      <div class="note">Les pièces de production de l'extraction du ${echapper(jourLong(resume.jour))} qui ne sont dans <strong>aucun fichier de lancement</strong> de la bibliothèque : pas encore lancées, lancement pas encore scanné, ou plus de pièces en cours dans Diakonos que dans le lancement. Toutes sont listées. Fournitures, Dibond et résine ne passent pas par les fichiers de lancement : pas listés.</div>
      ${tout.length ? `<div class="sv-puces">${puces}</div>
      <div class="sv-hors-outils"><input type="search" id="svHorsRecherche" placeholder="Chercher : commande, article, coloris, transporteur…" value="${echapper(etat.horsRecherche || "")}" autocomplete="off">
        <button type="button" id="svHorsExport">Exporter en Excel (format du fichier de suivi)</button></div>
      <div class="sv-hors-outils"><select id="svHorsLancement" aria-label="Lancement">${optionsLancements()}</select>
        <span id="svHorsNouveau" class="sv-hors-nouveau"${etat.horsLancement === NOUVEAU ? "" : " hidden"}>
          <input type="text" id="svHorsNomNouveau" placeholder="Nom du lancement (ex. LAN2648LONGUES)" value="${echapper(etat.horsNomNouveau || "")}" autocomplete="off" aria-label="Nom du nouveau lancement">
          <label>Semaine <select id="svHorsSemNouveau">${optionsSemainesNouveau()}</select></label>
          <label>Poste <select id="svHorsPosteNouveau">${POSTES_NOUVEAU.map((x) => `<option${x === (etat.horsPosteNouveau || "Chantiers") ? " selected" : ""}>${echapper(x)}</option>`).join("")}</select></label>
        </span>
        <button type="button" id="svHorsAjouter"${boutonAjouterActif() ? "" : " disabled"}>${texteBoutonAjouter()}</button></div>
      ${etat.horsMessage ? `<div class="sv-message ${etat.horsMessage.genre}">${echapper(etat.horsMessage.texte)}</div>` : ""}
      <div class="note">Cochez des lignes, puis choisissez un lancement, ou « Nouveau lancement » en lui donnant le nom que vous voulez. Un nouveau lancement entre dans la bibliothèque et compte comme un lancement normal (suivi, vues, téléphone, recherche) ; dans un lancement existant, les pièces comptent dans son suivi. Aucun fichier de lancement n'est créé ni modifié. Une ligne « en plus du lancement » va toujours dans le lancement qui a déjà la pièce.</div>
      <div class="note">${fmt(liste.length)} ligne${liste.length > 1 ? "s" : ""}, ${fmt(total)} pièce${total > 1 ? "s" : ""}${etat.horsSemaine ? ` en semaine ${echapper(etat.horsSemaine.split("-")[1])}` : ""}.</div>
      <div class="defile"><table class="sv-table sv-hors"><thead><tr><th><input type="checkbox" id="svHorsTout" title="Tout cocher" aria-label="Tout cocher"></th><th>Sem.</th><th>Commande</th><th class="nombre">Ligne</th><th>Catalogue</th><th>Article</th><th class="nombre">Pièces</th><th class="nombre">Dimensions</th><th>Coloris</th><th>Transporteur</th><th>Ville</th><th>Groupement</th></tr></thead>
      <tbody>${lignes || '<tr><td colspan="12" class="pale">Rien ne correspond.</td></tr>'}</tbody></table></div>` : `<div class="sv-message">✔ Toutes les pièces de l'extraction sont dans un lancement.</div>${etat.horsMessage ? `<div class="sv-message ${etat.horsMessage.genre}">${echapper(etat.horsMessage.texte)}</div>` : ""}`}
      <details class="sv-coller"${etat.texteColle || !tout.length ? " open" : ""}><summary>Coller des lignes (pièces qui ne sont pas dans l'extraction, ex. Trigano)</summary>
        <div class="note">Copiez les lignes dans Diakonos ou Excel (commande, ligne, catalogue, article, désignation, longueur, largeur, épaisseur, quantité, code coloris, coloris) et collez-les ici. Elles s'ajoutent à la liste ci-dessus : cochez-les, puis choisissez un lancement ou « Nouveau lancement » (ex. LAN2648TRIGANO). Elle compte comme les autres : à faire si elle est dans le suivi de production, faite si elle n'y est pas.</div>
        <textarea id="svColler" rows="4" spellcheck="false" placeholder="CVC26100002&#9;1&#9;Stratifié&#9;TRI-229532-H1242&#9;2114 X 600 X 29 MM&#9;2 114&#9;600&#9;29&#9;15&#9;H1242-ST10&#9;Acacia Sheffield Naturel">${echapper(etat.texteColle || "")}</textarea>
        <div class="sv-hors-outils"><button type="button" id="svCollerLire">Ajouter à la liste</button></div></details>${htmlRajouts()}</div>`;
  }

  // V6.7.3 : la liste des lancements où compter des pièces (la semaine choisie d'abord, puis les plus récentes).
  function optionsLancements() {
    const ls = (etat.lancementsCalcul || []).filter((L) => !L.hors && L.sid);
    const parSem = new Map();
    for (const L of ls) {
      const g = parSem.get(L.id) || { id: L.id, semaine: L.semaine, ordre: L.ordre, ls: [] };
      g.ls.push(L);
      parSem.set(L.id, g);
    }
    const [a, sem] = (etat.horsSemaine || "").split("-");
    const choisie = etat.horsSemaine ? idSemaine(a, sem) : "";
    const groupes = [...parSem.values()].sort((x, y) => (y.id === choisie) - (x.id === choisie) || y.ordre - x.ordre);
    const valeurs = new Set(ls.map((L) => `${L.sid}|${L.cle}`));
    if (etat.horsLancement && etat.horsLancement !== NOUVEAU && !valeurs.has(etat.horsLancement)) etat.horsLancement = "";
    return `<option value="">Choisir un lancement…</option><option value="${NOUVEAU}"${etat.horsLancement === NOUVEAU ? " selected" : ""}>+ Nouveau lancement (nom au choix)…</option>${groupes
      .map((g) => `<optgroup label="Semaine ${echapper(g.semaine)}">${g.ls
        .map((L) => { const v = `${L.sid}|${L.cle}`; return `<option value="${echapper(v)}"${v === etat.horsLancement ? " selected" : ""}>${echapper(L.nom)}${L.poste && L.poste !== L.nom ? ` · ${echapper(L.poste)}` : ""}${L.manuel ? " · créé dans Sentinelle" : ""}</option>`; })
        .join("")}</optgroup>`)
      .join("")}`;
  }
  // Les pièces cochées parmi les lignes affichées (filtre de semaine et recherche).
  const cochesVisibles = () => new Set(horsFiltres().filter((x) => etat.horsCoches.has(x.k)).map((x) => x.k)).size;
  function texteBoutonAjouter() {
    const n = cochesVisibles();
    const quoi = n > 1 ? `les ${fmt(n)} pièces cochées` : n ? "la pièce cochée" : "les pièces cochées";
    if (etat.horsLancement === NOUVEAU) {
      const nom = nomNouveau();
      return `Créer le lancement${nom ? ` « ${nom} »` : ""} avec ${quoi}`;
    }
    return `Compter ${quoi} dans ce lancement`;
  }
  const nomNouveau = () => String(etat.horsNomNouveau || "").trim().replace(/\s+/g, " ");
  const boutonAjouterActif = () => Boolean(cochesVisibles() && etat.horsLancement && (etat.horsLancement !== NOUVEAU || nomNouveau()));

  // V6.7.5 : « Nouveau lancement » — un lancement nommé par l'utilisateur, rangé dans la bibliothèque comme les autres.
  const NOUVEAU = "__nouveau__";
  const POSTES_NOUVEAU = ["Chantiers", "Agglo 1er tour", "Agglo 2ème tour", "Recyclage", "Feno"];
  // Les semaines proposées : celles des pièces de la liste, des lancements suivis et la semaine en fabrication.
  function semainesNouveau() {
    const par = new Map();
    const ajouter = (a, n) => {
      if (a && n) par.set(`${Number(a)}-${Number(n)}`, { a: Number(a), n: Number(n) });
    };
    for (const x of etat.horsDetail || []) ajouter(x.r[1], x.r[0]);
    for (const L of etat.lancementsCalcul || []) if (!L.hors) ajouter(L.annee, L.semaine);
    if (etat.resume && etat.resume.fabrication) ajouter(etat.resume.fabrication.annee, etat.resume.fabrication.semaine);
    return [...par.entries()].sort((x, y) => x[1].a * 100 + x[1].n - (y[1].a * 100 + y[1].n));
  }
  // Par défaut : la semaine choisie, sinon celle de la plupart des pièces cochées (ou affichées).
  function semaineNouveauParDefaut() {
    if (etat.horsSemNouveau) return etat.horsSemNouveau;
    if (etat.horsSemaine) return etat.horsSemaine;
    const liste = horsFiltres();
    const cochees = liste.filter((x) => etat.horsCoches.has(x.k));
    const compte = new Map();
    for (const x of cochees.length ? cochees : liste) if (x.r[0] && x.r[1]) compte.set(`${x.r[1]}-${x.r[0]}`, (compte.get(`${x.r[1]}-${x.r[0]}`) || 0) + 1);
    const best = [...compte.entries()].sort((x, y) => y[1] - x[1])[0];
    if (best) return best[0];
    const f = etat.resume && etat.resume.fabrication;
    return f ? `${f.annee}-${f.semaine}` : "";
  }
  function optionsSemainesNouveau() {
    const choisie = semaineNouveauParDefaut();
    return semainesNouveau().map(([v, x]) => `<option value="${v}"${v === choisie ? " selected" : ""}>S${x.n} ${x.a}</option>`).join("");
  }
  // Une ligne de pièce de la bibliothèque, depuis la ligne de l'extraction.
  function ligneBibliotheque(x, n) {
    const r = x.r;
    const c = COLONNES_PIECES_BIBLIOTHEQUE;
    const ligne = c.map(() => "");
    const met = (nom, v) => {
      const i = c.indexOf(nom);
      if (i >= 0) ligne[i] = v === null || v === undefined ? "" : v;
    };
    const nombre = (v) => {
      const t = String(v ?? "").trim().replace(",", ".");
      return t && Number.isFinite(Number(t)) ? Number(t) : "";
    };
    met("cle", x.k);
    met("commande", r[2]);
    met("ligne", String(r[3]));
    met("article", texteBrut(r, "article"));
    met("pieces", n);
    met("longueur", nombre(champBrut(r, "longueur")));
    met("largeur", nombre(champBrut(r, "largeur")));
    met("epaisseur", nombre(champBrut(r, "epaisseur")));
    met("coloris", r[10] || "");
    met("livraison", r[0] && r[1] ? `${r[1]}-${r[0]}` : "");
    met("transporteur", r[7] && r[7] !== "(sans transporteur)" ? r[7] : "");
    return ligne;
  }
  // Les lancements créés dans Sentinelle (toutes les semaines de la bibliothèque).
  function lancementsManuels() {
    const out = [];
    for (const w of bibliotheque.semaines.values())
      for (const l of lancementsActifs(w)) if (l.manuel) out.push({ w, l });
    return out.sort((x, y) => ordreSemaine(y.w.annee, y.w.semaine) - ordreSemaine(x.w.annee, x.w.semaine) || x.l.nom.localeCompare(y.l.nom));
  }

  // Les lancements créés dans Sentinelle et les pièces comptées à la main dans un lancement, avec « Retirer ».
  function htmlRajouts() {
    const manuels = lancementsManuels();
    if (!etat.rajouts.length && !manuels.length) return "";
    let html = "";
    if (manuels.length) {
      const lignes = manuels
        .map(({ w, l }) => {
          const cols = w.colonnesPieces || COLONNES_PIECES_BIBLIOTHEQUE;
          const iCmd = cols.indexOf("commande");
          const iLig = cols.indexOf("ligne");
          const iQ = cols.indexOf("pieces") >= 0 ? cols.indexOf("pieces") : 4;
          const total = (l.pieces || []).reduce((t, x) => t + (Number(x[iQ]) || 0), 0);
          const cleL = `${w.id}|${cleNomLancement(l.nom)}`;
          const tete = `<tr class="sv-manuel-tete"><td colspan="3"><strong>${echapper(l.nom)}</strong> <span class="pale">S${echapper(w.semaine)} · ${echapper(l.poste || "")}</span></td>
            <td class="nombre"><strong>${fmt(total)}</strong></td><td>${echapper(l.creeLe ? new Date(l.creeLe).toLocaleDateString("fr-FR") : "")}</td><td></td>
            <td><button type="button" class="texte" data-sv-manuel-supprimer="${echapper(cleL)}">Supprimer le lancement</button></td></tr>`;
          const pieces = (l.pieces || [])
            .map((x) => `<tr><td></td><td>${echapper(x[iCmd])}</td><td class="nombre">${echapper(x[iLig])}</td><td class="nombre">${fmt(Number(x[iQ]) || 0)}</td><td></td><td></td>
              <td><button type="button" class="texte" data-sv-manuel-retirer="${echapper(cleL)}" data-k="${echapper(x[0])}">Retirer</button></td></tr>`)
            .join("");
          return tete + pieces;
        })
        .join("");
      html += `<div class="sv-rajouts" id="svManuels"><div class="carte-titre">Lancements créés dans Sentinelle · ${fmt(manuels.length)}</div>
      <div class="note">Rangés dans la bibliothèque comme les autres lancements (suivi, vues, téléphone, recherche). Aucun fichier de lancement : ils n'existent que dans Sentinelle. « Retirer » remet la pièce dans la liste ci-dessus.</div>
      <div class="defile"><table class="sv-table"><thead><tr><th>Lancement</th><th>Commande</th><th class="nombre">Ligne</th><th class="nombre">Pièces</th><th>Créé le</th><th></th><th></th></tr></thead>
      <tbody>${lignes}</tbody></table></div></div>`;
    }
    if (!etat.rajouts.length) return html;
    const presents = new Set((etat.lancementsCalcul || []).filter((L) => !L.hors).map((L) => `${L.sid}|${L.cle}`));
    const tri = [...etat.rajouts].sort((x, y) => String(y.sid).localeCompare(String(x.sid)) || String(x.nom).localeCompare(String(y.nom)) || String(x.commande).localeCompare(String(y.commande)) || Number(x.ligne) - Number(y.ligne));
    const lignes = tri
      .map((a) => {
        const note = etat.rajoutsIgnores.has(a.id)
          ? "maintenant dans un fichier de lancement : ne compte plus ici"
          : !presents.has(`${a.sid}|${a.lancement}`)
            ? "lancement absent de la bibliothèque : ne compte pas"
            : a.partiel
              ? "en plus des pièces du fichier"
              : "";
        return `<tr><td><strong>${echapper(a.nom)}</strong> <span class="pale">S${echapper(a.semaine)}</span></td><td>${echapper(a.commande)}</td><td class="nombre">${echapper(a.ligne)}</td>
          <td class="nombre">${fmt(a.n)}</td><td>${echapper(a.quand ? new Date(a.quand).toLocaleDateString("fr-FR") : "")}</td><td class="pale">${echapper(note)}</td>
          <td><button type="button" class="texte" data-sv-rajout-retirer="${echapper(a.id)}">Retirer</button></td></tr>`;
      })
      .join("");
    const total = etat.rajouts.reduce((t, a) => t + Number(a.n), 0);
    return `${html}<div class="sv-rajouts" id="svRajouts"><div class="carte-titre">Pièces ajoutées à la main dans un lancement existant · ${fmt(total)}</div>
      <div class="note">Comptées par Sentinelle dans le suivi de ces lancements ; les fichiers de lancement ne sont pas modifiés. « Retirer » les remet dans la liste ci-dessus.</div>
      <div class="defile"><table class="sv-table"><thead><tr><th>Lancement</th><th>Commande</th><th class="nombre">Ligne</th><th class="nombre">Pièces</th><th>Ajoutée le</th><th></th><th></th></tr></thead>
      <tbody>${lignes}</tbody></table></div></div>`;
  }

  // Compte les pièces cochées (visibles) dans le lancement choisi :
  // - nouveau lancement, ou lancement déjà créé dans Sentinelle : ses pièces vont dans la bibliothèque (lancement normal) ;
  // - lancement d'un fichier : les pièces s'ajoutent à son suivi (V6.7.3), le fichier n'est pas touché ;
  // - une ligne « en plus du lancement » va toujours dans le lancement qui a déjà la pièce (sinon la règle des pièces
  //   relancées la compterait dans un seul des deux et le décompte serait faux).
  async function ajouterRajouts() {
    const choix = etat.horsLancement || "";
    const coches = [];
    const vues = new Set();
    for (const x of horsFiltres()) {
      if (!etat.horsCoches.has(x.k) || vues.has(x.k)) continue;
      vues.add(x.k);
      coches.push(x);
    }
    if (!coches.length || !choix) return;
    const ls = (etat.lancementsCalcul || []).filter((L) => !L.hors && L.sid);
    const trouver = (sid, cle) => ls.find((L) => L.sid === sid && L.cle === cle);
    let cible;
    if (choix === NOUVEAU) {
      const nom = nomNouveau();
      const [an, sem] = String(semaineNouveauParDefaut()).split("-").map(Number);
      if (!nom || !an || !sem) return;
      const sid = idSemaine(an, sem);
      const cle = cleNomLancement(nom);
      const ailleurs = [...bibliotheque.semaines.values()].find((w) => w.id !== sid && lancementsActifs(w).some((l) => cleNomLancement(l.nom) === cle));
      if (ailleurs) {
        etat.horsMessage = { genre: "alerte", texte: `Le lancement ${nom} existe déjà en semaine ${ailleurs.semaine} : choisissez-le dans la liste ou donnez un autre nom.` };
        afficher();
        return;
      }
      const L = trouver(sid, cle);
      cible = L ? { sid, cle, nom: L.nom, semaine: sem, annee: an, manuel: L.manuel } : { sid, cle, nom, semaine: sem, annee: an, manuel: true, nouveau: true, poste: etat.horsPosteNouveau || "Chantiers" };
    } else {
      const i = choix.indexOf("|");
      const L = i < 0 ? null : trouver(choix.slice(0, i), choix.slice(i + 1));
      if (!L) return;
      const w = bibliotheque.semaines.get(L.sid);
      cible = { sid: L.sid, cle: L.cle, nom: L.nom, semaine: w ? w.semaine : L.semaine, annee: w ? w.annee : L.annee, manuel: L.manuel };
    }
    const quand = new Date().toISOString();
    const nouvelId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${etat.rajouts.length}`;
    const rajout = (x, c, partiel) =>
      etat.rajouts.push({ id: nouvelId(), sid: c.sid, lancement: c.cle, nom: c.nom, semaine: c.semaine, k: x.k, commande: x.r[2], ligne: x.r[3], n: x.nAjout, coloris: x.r[10] || "", partiel, quand,
        ...(x.collee ? { collee: true, donnees: x.collee } : {}) });
    const colleesAjoutees = new Set(coches.filter((x) => x.collee && !x.partiel).map((x) => x.k));
    let n = 0;
    let surplus = 0;
    let suivi = false;
    const versBibliotheque = [];
    for (const x of coches) {
      if (x.partiel) {
        if (!x.proprio) continue;
        rajout(x, x.proprio, true);
        surplus++;
        suivi = true;
      } else if (cible.manuel) versBibliotheque.push(x);
      else {
        rajout(x, cible, false);
        n++;
        suivi = true;
      }
    }
    etat.horsCoches.clear();
    if (versBibliotheque.length) {
      const w = bibliotheque.semaines.get(cible.sid);
      const existant = w ? lancementsActifs(w).find((l) => cleNomLancement(l.nom) === cible.cle) : null;
      const iQ = COLONNES_PIECES_BIBLIOTHEQUE.indexOf("pieces");
      const pieces = existant ? (existant.pieces || []).map((p) => [...p]) : [];
      for (const x of versBibliotheque) {
        const deja = pieces.find((p) => p[0] === x.k);
        if (deja) deja[iQ] = (Number(deja[iQ]) || 0) + x.nAjout;
        else pieces.push(ligneBibliotheque(x, x.nAjout));
        n++;
      }
      const nbPieces = pieces.reduce((t, p) => t + (Number(p[iQ]) || 0), 0);
      const collees = [...new Set([...((existant && existant.collees) || []), ...versBibliotheque.filter((x) => x.collee).map((x) => x.k)])];
      const fiche = existant
        ? { ...existant, pieces, nbPieces, collees }
        : { nom: cible.nom, fichier: "", poste: cible.poste, dossier: "Créé dans Sentinelle", casse: false, manuel: true, creeLe: quand, fichiers: {}, recap: null, controle: null, problemes: [], plans: null, nbPieces, pieces, collees };
      await archiverLancements([{ annee: w ? w.annee : cible.annee, semaine: w ? w.semaine : cible.semaine, lancement: fiche }]);
      etat.horsLancement = `${cible.sid}|${cible.cle}`;
      etat.horsNomNouveau = "";
      etat.horsSemNouveau = "";
    }
    if (suivi) {
      ecrireLocal(CLE_RAJOUTS, etat.rajouts);
      etat.rajoutsRev++;
    }
    if (colleesAjoutees.size) {
      etat.collees = etat.collees.filter((c) => !colleesAjoutees.has(c.k));
      ecrireLocal(CLE_COLLEES, etat.collees);
      etat.colleesRev++;
    }
    if (!n && !surplus) return;
    const morceaux = [];
    if (n) morceaux.push(`${pluriel(n, "ligne comptée", "lignes comptées")} dans ${cible.nom} (semaine ${cible.semaine})${cible.nouveau ? " : lancement créé" : ""}`);
    if (surplus) morceaux.push(`${pluriel(surplus, "ligne « en plus du lancement » comptée", "lignes « en plus du lancement » comptées")} dans le lancement qui a déjà la pièce`);
    etat.horsMessage = { genre: "bon", texte: `✔ ${morceaux.join(" ; ")}.` };
    apresChangementInclus();
  }
  // Retire une pièce d'un lancement créé dans Sentinelle (le lancement disparaît avec sa dernière pièce).
  async function retirerPieceManuelle(cleL, k) {
    const i = cleL.indexOf("|");
    const w = bibliotheque.semaines.get(cleL.slice(0, i));
    const l = w ? lancementsActifs(w).find((x) => x.manuel && cleNomLancement(x.nom) === cleL.slice(i + 1)) : null;
    if (!l) return;
    const pieces = (l.pieces || []).filter((p) => p[0] !== k);
    if (pieces.length === l.pieces.length) return;
    const iQ = COLONNES_PIECES_BIBLIOTHEQUE.indexOf("pieces");
    if ((l.collees || []).includes(k)) {
      // Pièce collée (pas dans l'extraction) : elle revient dans les lignes collées, sinon elle disparaîtrait.
      const cols = w.colonnesPieces || COLONNES_PIECES_BIBLIOTHEQUE;
      const p = l.pieces.find((x) => x[0] === k);
      const v = (nom) => (cols.indexOf(nom) >= 0 ? p[cols.indexOf(nom)] : "");
      etat.collees = etat.collees.filter((x) => x.k !== k);
      etat.collees.push({ k, commande: String(v("commande")), ligne: String(v("ligne")), catalogue: "", article: String(v("article") || ""), designation: "", L: v("longueur"), l: v("largeur"), e: v("epaisseur"), n: Number(v("pieces")) || 1, coloris: String(v("coloris") || ""), colorisNom: "", quand: new Date().toISOString() });
      ecrireLocal(CLE_COLLEES, etat.collees);
      etat.colleesRev++;
    }
    const resteCollees = (l.collees || []).filter((x) => x !== k);
    if (pieces.length) await archiverLancements([{ annee: w.annee, semaine: w.semaine, lancement: { ...l, pieces, nbPieces: pieces.reduce((t, p) => t + (Number(p[iQ]) || 0), 0), collees: resteCollees } }]);
    else await retirerLancementBibliotheque(w.id, l.nom);
    etat.horsMessage = null;
    apresChangementInclus();
  }
  async function supprimerLancementManuel(cleL) {
    const i = cleL.indexOf("|");
    const w = bibliotheque.semaines.get(cleL.slice(0, i));
    const l = w ? lancementsActifs(w).find((x) => x.manuel && cleNomLancement(x.nom) === cleL.slice(i + 1)) : null;
    if (!l || !window.confirm(`Supprimer le lancement ${l.nom} (semaine ${w.semaine}) ? Ses pièces reviennent dans « Pas dans les lancements ».`)) return;
    if ((l.collees || []).length) {
      const cols = w.colonnesPieces || COLONNES_PIECES_BIBLIOTHEQUE;
      for (const p of l.pieces || []) {
        if (!l.collees.includes(p[0])) continue;
        const v = (nom) => (cols.indexOf(nom) >= 0 ? p[cols.indexOf(nom)] : "");
        etat.collees = etat.collees.filter((x) => x.k !== p[0]);
        etat.collees.push({ k: p[0], commande: String(v("commande")), ligne: String(v("ligne")), catalogue: "", article: String(v("article") || ""), designation: "", L: v("longueur"), l: v("largeur"), e: v("epaisseur"), n: Number(v("pieces")) || 1, coloris: String(v("coloris") || ""), colorisNom: "", quand: new Date().toISOString() });
      }
      ecrireLocal(CLE_COLLEES, etat.collees);
      etat.colleesRev++;
    }
    await retirerLancementBibliotheque(w.id, l.nom);
    etat.horsMessage = null;
    apresChangementInclus();
  }
  function retirerRajout(id) {
    const avant = etat.rajouts.length;
    const a = etat.rajouts.find((x) => x.id === id);
    etat.rajouts = etat.rajouts.filter((x) => x.id !== id);
    if (etat.rajouts.length === avant) return;
    if (a && a.collee && a.donnees) {
      etat.collees = etat.collees.filter((x) => x.k !== a.k);
      etat.collees.push(a.donnees);
      ecrireLocal(CLE_COLLEES, etat.collees);
      etat.colleesRev++;
    }
    ecrireLocal(CLE_RAJOUTS, etat.rajouts);
    etat.rajoutsRev++;
    apresChangementInclus();
  }

  // Export : les colonnes du fichier de suivi Diakonos (en-tête de l'extraction), seulement les lignes de la liste, en jaune.
  async function exporterHors() {
    const liste = horsFiltres();
    if (!liste.length) return;
    // Les colonnes du fichier de suivi (celles de l'extraction), même si on n'exporte que des lignes collées.
    const derniere = etat.extractions[etat.extractions.length - 1];
    const entete =
      ((etat.horsDetail || []).find((x) => x.r[12] && !x.collee) || {}).r?.[12] ||
      (derniere && derniere.lignes.length && derniere.lignes[0][12]) ||
      (liste.find((x) => x.collee) || {}).r?.[12] ||
      null;
    const valeurCollee = (x, h) => {
      const n = sansAccents(h);
      if (n === "qtelancement" || n === "qteencours") return x.n;
      const v = champBrut(x.r, n);
      return v === undefined ? null : v;
    };
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Pas dans les lancements");
    const jaune = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
    if (entete) {
      ws.addRow(entete.map((v) => (v === null || v === undefined ? "" : v)));
      for (const x of liste) {
        const brut = x.r[11] || [];
        if (x.collee && entete !== x.r[12]) ws.addRow(entete.map((h) => valeurCollee(x, h)));
        else ws.addRow(entete.map((_, i) => (brut[i] === undefined ? null : brut[i])));
      }
    } else {
      ws.addRow(["Semaine", "Commande", "Ligne", "Catalogue", "Qte Lancement", "Qte en cours", "Transporteur", "Ville", "Code Coloris"]);
      for (const x of liste) ws.addRow([x.r[0], x.r[2], Number(x.r[3]) || x.r[3], x.r[4], x.r[5], x.r[6], x.r[7], x.r[8], x.r[10]]);
    }
    ws.getRow(1).font = { bold: true };
    for (let i = 2; i <= ws.rowCount; i++) ws.getRow(i).eachCell({ includeEmpty: true }, (c) => (c.fill = jaune));
    ws.columns.forEach((c) => (c.width = 14));
    ws.views = [{ state: "frozen", ySplit: 1 }];
    const octets = new Uint8Array(await wb.xlsx.writeBuffer());
    const jour = String((etat.resume && etat.resume.jour) || "").replace(/-/g, "");
    const nom = `pas_dans_les_lancements_${jour}${etat.horsSemaine ? `_S${etat.horsSemaine.split("-")[1]}` : ""}.xlsx`;
    telecharger(nom, octets, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
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
    if (typeof htmlBandeauValidations === "function") html += htmlBandeauValidations();
    if (resume) {
      html += htmlTuiles(resume);
      html += htmlVues(resume);
      html += `<div class="carte"><div class="carte-titre">Avancement par lancement</div>
        <div class="note">L'extraction donne les pièces qui restent à valider. Comparée au lancement : un CVC qui n'y est plus = pièce faite ; un CVC encore là = « Qte en cours » à faire, le reste est fait (lancée 10, en cours 8 : 8 à faire, 2 faites). Une pièce relancée (casse, retard) compte dans le lancement le plus récent, et elle est déduite du lancement d'origine. Un clic sur un lancement : les commandes encore à faire.</div>
        <div class="sv-legende"><span><i class="sv-l-en_cours"></i>En cours</span><span><i class="sv-l-termine"></i>Terminé</span><span><i class="sv-l-retard"></i>En retard (semaine passée)</span><span><i class="sv-l-attente"></i>Pas dans cette extraction</span></div>
        ${resume.semaines.length ? resume.semaines.map((s) => htmlSemaine(s, resume)).join("") : '<div class="note">Aucun lancement dans la bibliothèque des semaines autour de cette extraction : scannez les semaines dans « Contrôler la coupe ».</div>'}
        ${resume.anciennes ? `<div class="note">${pluriel(resume.anciennes, "semaine plus ancienne : finie", "semaines plus anciennes : finies")}.</div>` : ""}</div>`;
      html += htmlHors(resume, Boolean(local));
      html += htmlTableau(resume, Boolean(local));
    }
    html += htmlExtractions();
    page.innerHTML = html;
    brancher(page);
  }

  function brancher(page) {
    const q = (id) => page.querySelector(`#${id}`);
    if (q("svReinitValidations"))
      q("svReinitValidations").addEventListener("click", () => {
        if (window.confirm("Remettre à zéro le suivi en direct ? Les pièces reviendront à l'état de la dernière extraction (les nouvelles validations seront de nouveau comptées).") && typeof reinitialiserValidations === "function") reinitialiserValidations();
      });
    q("svDossier").addEventListener("click", choisirDossier);
    page.querySelectorAll("[data-sv-hors-sem]").forEach((b) =>
      b.addEventListener("click", () => {
        etat.horsSemaine = b.dataset.svHorsSem;
        afficher();
        const c = page.querySelector("#svHors");
        if (c) c.scrollIntoView({ block: "start" });
      })
    );
    if (q("svHorsRecherche"))
      q("svHorsRecherche").addEventListener("input", (e) => {
        etat.horsRecherche = e.target.value;
        const pos = e.target.selectionStart;
        afficher();
        const c = page.querySelector("#svHorsRecherche");
        if (c) {
          c.focus();
          c.setSelectionRange(pos, pos);
        }
      });
    if (q("svHorsExport")) q("svHorsExport").addEventListener("click", () => exporterHors());
    // V6.7.3 : cocher des pièces et les compter dans un lancement (sans tout redessiner à chaque case).
    const majBouton = () => {
      const b = q("svHorsAjouter");
      if (!b) return;
      b.disabled = !boutonAjouterActif();
      b.textContent = texteBoutonAjouter();
      // La semaine du nouveau lancement suit les pièces cochées tant qu'elle n'a pas été choisie.
      const sem = q("svHorsSemNouveau");
      if (sem && !etat.horsSemNouveau) {
        const v = semaineNouveauParDefaut();
        if ([...sem.options].some((o) => o.value === v)) sem.value = v;
      }
    };
    page.querySelectorAll("[data-sv-hors-coche]").forEach((c) =>
      c.addEventListener("change", () => {
        if (c.checked) etat.horsCoches.add(c.dataset.svHorsCoche);
        else etat.horsCoches.delete(c.dataset.svHorsCoche);
        page.querySelectorAll("[data-sv-hors-coche]").forEach((d) => (d.checked = etat.horsCoches.has(d.dataset.svHorsCoche)));
        majBouton();
      })
    );
    if (q("svHorsTout"))
      q("svHorsTout").addEventListener("change", (e) => {
        const cases = [...page.querySelectorAll("[data-sv-hors-coche]")];
        for (const c of cases) {
          c.checked = e.target.checked;
          if (e.target.checked) etat.horsCoches.add(c.dataset.svHorsCoche);
          else etat.horsCoches.delete(c.dataset.svHorsCoche);
        }
        majBouton();
      });
    if (q("svHorsLancement"))
      q("svHorsLancement").addEventListener("change", (e) => {
        etat.horsLancement = e.target.value;
        etat.horsMessage = null;
        if (q("svHorsNouveau")) q("svHorsNouveau").hidden = etat.horsLancement !== NOUVEAU;
        majBouton();
        if (etat.horsLancement === NOUVEAU && q("svHorsNomNouveau")) q("svHorsNomNouveau").focus();
      });
    if (q("svHorsNomNouveau"))
      q("svHorsNomNouveau").addEventListener("input", (e) => {
        etat.horsNomNouveau = e.target.value;
        majBouton();
      });
    if (q("svHorsSemNouveau")) q("svHorsSemNouveau").addEventListener("change", (e) => (etat.horsSemNouveau = e.target.value));
    if (q("svHorsPosteNouveau")) q("svHorsPosteNouveau").addEventListener("change", (e) => (etat.horsPosteNouveau = e.target.value));
    if (q("svColler")) q("svColler").addEventListener("input", (e) => (etat.texteColle = e.target.value));
    if (q("svCollerLire"))
      q("svCollerLire").addEventListener("click", () => {
        etat.texteColle = q("svColler").value;
        ajouterLignesCollees();
      });
    page.querySelectorAll("[data-sv-collee-retirer]").forEach((b) => b.addEventListener("click", () => retirerCollee(b.dataset.svColleeRetirer)));
    page.querySelectorAll("[data-sv-manuel-retirer]").forEach((b) => b.addEventListener("click", () => retirerPieceManuelle(b.dataset.svManuelRetirer, b.dataset.k)));
    page.querySelectorAll("[data-sv-manuel-supprimer]").forEach((b) => b.addEventListener("click", () => supprimerLancementManuel(b.dataset.svManuelSupprimer)));
    if (q("svHorsAjouter"))
      q("svHorsAjouter").addEventListener("click", () => {
        q("svHorsAjouter").disabled = true;
        ajouterRajouts().catch((e) => {
          etat.horsMessage = { genre: "alerte", texte: `Ajout impossible : ${e && e.message ? e.message : e}` };
          afficher();
        });
      });
    page.querySelectorAll("[data-sv-rajout-retirer]").forEach((b) => b.addEventListener("click", () => retirerRajout(b.dataset.svRajoutRetirer)));
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
    page.querySelectorAll("[data-sv-vue]").forEach((b) =>
      b.addEventListener("click", () => {
        etat.vue = b.dataset.svVue;
        etat.filtreVue = "";
        ecrireLocal(CLE_VUE, etat.vue);
        afficher();
      })
    );
    if (q("svFiltreVue"))
      q("svFiltreVue").addEventListener("input", (e) => {
        etat.filtreVue = e.target.value;
        const t = sansAccents(etat.filtreVue);
        page.querySelectorAll("#svVues [data-sv-groupe]").forEach((d) => (d.hidden = Boolean(t) && !d.dataset.svNom.includes(t)));
      });
    page.querySelectorAll("[data-sv-groupe] > .sv-ligne").forEach((b) =>
      b.addEventListener("click", () => {
        const cle = b.parentElement.dataset.svGroupe;
        if (etat.groupesOuverts.has(cle)) etat.groupesOuverts.delete(cle);
        else etat.groupesOuverts.add(cle);
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

  // De nouvelles pièces faites reçues des PC de validation : on recalcule et on réaffiche.
  function rafraichirValidations() {
    etat.resume = null;
    pourPartage();
    if (typeof planifierEnvoiTelephone === "function") planifierEnvoiTelephone();
    rafraichir();
  }

  return { afficher, demarrer, pourPartage, signature, recevoir, chargerFichiers, lireDossier, etat, calculer, rafraichirValidations };
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
