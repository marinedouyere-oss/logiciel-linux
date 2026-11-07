import re, sys
chemin = sys.argv[1]
s = open(chemin, encoding="utf-8").read()

def remplacer(ancien, nouveau, n=1):
    global s
    assert s.count(ancien) == n, (s.count(ancien), ancien[:80])
    s = s.replace(ancien, nouveau)

def remplacer_bloc(debut, fin, nouveau):
    """Remplace de `debut` (inclus) jusqu'à `fin` (exclu)."""
    global s
    i = s.index(debut)
    j = s.index(fin, i)
    assert s.count(debut) == 1
    s = s[:i] + nouveau + s[j:]

remplacer("const LIMITE_LIGNES = 60;\n", "")
remplacer("    listeDepliee: false,\n", "")
remplacer("  p.listeDepliee = false;\n}\n", "}\n")
remplacer("    p.etatErreur = false;\n    p.listeDepliee = false;\n    enregistrer(p);", "    p.etatErreur = false;\n    enregistrer(p);")

# Casse : le bandeau seul, les pièces sont dans le fichier des problèmes.
remplacer("""    html += bandeau(`🔁 ${r.dejaLancees.length} pièce(s) de la casse déjà lancée(s) en semaine ${echapper(r.semaineAvant)}`, "attention");
    for (const t of r.dejaLancees) html += `<div class="ligne-diakonos">${echapper(descriptionCasse(t.ligne, " · "))} — ${echapper(t.lancement)}</div>`;
    if (r.nbAutres)""", """    html += bandeau(`🔁 ${r.dejaLancees.length} pièce(s) de la casse déjà lancée(s) en semaine ${echapper(r.semaineAvant)}`, "attention");
    if (r.nbAutres)""")

# Contrôle : bandeaux courts ; le détail est dans le fichier des problèmes du lancement.
remplacer_bloc("function afficherRapport(zone, p) {", "// Nouveau fichier de lancement sans les lignes en double", """function afficherRapport(zone, p) {
  const r = p.rapport;
  // En pièces finies : une pièce assemblée (Feno : compact + support) compte une fois.
  const enPieces = r.piecesAttendues > 0 || r.piecesTrouvees > 0;
  const attendu = Math.trunc(enPieces ? r.piecesAttendues : r.totalAttendu);
  let html = '<div class="separateur"></div>';
  html += r.nbAnomalies === 0 ? bandeau(`✔ Tout est correct — ${attendu} pièces`, "ok") : bandeau(`⚠ ${r.nbAnomalies} pièce(s) à vérifier dans ${sourceControle(p)}`, "alerte");
  const details = [];
  if (p.source === "bkp") details.push("Pas de liste de coupe : lancement comparé au .bkp");
  if (p.nbUnitaires !== null && p.nbPiecesTrouvees) {
    const unitaire = (p.nbUnitaires * 100) / p.nbPiecesTrouvees;
    details.push(`Liste de coupe : ${pourcent(unitaire)} % des pièces en unitaire, ${pourcent(100 - unitaire)} % en grain matching`);
  }
  if (details.length) html += `<div class="note">${details.join(" · ")}</div>`;
  html += htmlSemainesLivraison(p);
  if (p.doublons.length) {
    html += bandeau(`⚠ ${p.doublons.length} doublon(s) dans le lancement`, "attention");
    if (p.strat) html += '<button type="button" class="contour pleine" data-action="sans-doublons">✂ Créer le lancement sans doublons (.xlsx)</button>';
  }
  zone.innerHTML = html;
  const sansDoublons = zone.querySelector('[data-action="sans-doublons"]');
  if (sansDoublons)
    sansDoublons.addEventListener("click", async () => {
      sansDoublons.disabled = true;
      try {
        await creerSansDoublons(p);
      } finally {
        sansDoublons.disabled = false;
      }
    });
}

""")

remplacer_bloc("// Une pièce à vérifier, en une phrase", "// Pièces d'un lancement à livrer une autre semaine", "")

remplacer_bloc("function htmlSemainesLivraison(p) {", "function afficherScies(zone, p) {", """function htmlSemainesLivraison(p) {
  if (p.semainesLivraison.length <= 1 || p.poste === "Casse") return "";
  const principale = semainePrincipale(p);
  const n = p.semainesLivraison.filter((s) => s !== principale).reduce((t, s) => t + s.nbPieces, 0);
  return bandeau(`⚠ ${n} pièce(s) à livrer une autre semaine que la semaine ${echapper(principale.semaine)}`, "attention");
}

""")

remplacer("""    html += bandeau(`⚠ Scies : ${p.ecartsScies.length} pièce(s) différente(s) entre le lancement et le .bkp (${panneaux} vérifiés)`, "alerte");
    for (const e of p.ecartsScies) {
      const texte =
        e.attendu === 0
          ? `${fmtNombre(e.trouve)} dans le .bkp, mais rien dans le lancement (en trop)`
          : e.trouve === 0
            ? `${fmtNombre(e.attendu)} prévue(s) dans le lancement, absente du .bkp (pas optimisée)`
            : `${fmtNombre(e.attendu)} prévue(s) dans le lancement, ${fmtNombre(e.trouve)} dans le .bkp`;
      html += `<div class="ligne-detail"><strong>${echapper(e.cle)}</strong> : ${texte}</div>`;
    }
  }""", """    html += bandeau(`⚠ Scies : ${p.ecartsScies.length} pièce(s) différente(s) entre le lancement et le .bkp (${panneaux} vérifiés)`, "alerte");
  }""")

remplacer("""  let html = bandeau(`⚠ Couleurs : ${c.absentes.length} couleur(s) du lancement absente(s) du .bkp — ces panneaux ne sont pas optimisés`, "alerte");
  for (const a of c.absentes) {
    const n = a.cles.length;
    const pieces = n <= 4 ? a.cles.join(", ") : `${a.cles.slice(0, 4).join(", ")}… (${n})`;
    html += `<div class="ligne-detail">Couleur <strong>${echapper(a.couleur)}</strong> (face ${echapper(a.face)}) : ${fmtNombre(a.nbPieces)} pièce(s) — ${echapper(pieces)}</div>`;
  }
  return html;
}""", """  return bandeau(`⚠ Couleurs : ${c.absentes.length} couleur(s) du lancement absente(s) du .bkp — ces panneaux ne sont pas optimisés`, "alerte");
}""")

remplacer_bloc("const descriptionDiakonos = (m, separateur) =>", "function htmlDiakonos(r) {", "")
remplacer("""  let html = r.manquantes.length
    ? bandeau(`⚠ ${r.manquantes.length} pièce(s) Diakonos absente(s) ${echapper(portee.de)}`, "alerte")
    : bandeau(`✔ Les ${r.nbPieces} pièces Diakonos sont ${echapper(portee.dans)}`, "ok");
  for (const m of r.manquantes.slice(0, LIMITE_LIGNES)) {
    const ailleurs = r.ailleurs.get(m.cle);
    html += `<div class="ligne-diakonos">${echapper(descriptionDiakonos(m, " · "))}${ailleurs ? ` — lancée dans ${echapper(ailleurs)}` : ""}</div>`;
  }
  if (r.manquantes.length > LIMITE_LIGNES) html += `<div class="note">… et ${r.manquantes.length - LIMITE_LIGNES} autre(s) (voir le rapport exporté)</div>`;
  html += """, """  let html = r.manquantes.length
    ? bandeau(`⚠ ${r.manquantes.length} pièce(s) Diakonos absente(s) ${echapper(portee.de)}`, "alerte")
    : bandeau(`✔ Les ${r.nbPieces} pièces Diakonos sont ${echapper(portee.dans)}`, "ok");
  html += """)

# Tableau des lancements : une ligne courte par alerte, sans la liste des pièces.
remplacer("const listeClesRecap = (cles) => (cles.length <= 3 ? cles.join(\", \") : `${cles.length} pièces (${cles.slice(0, 3).join(\", \")}…)`);\n", "")
remplacer_bloc("// Pièces présentes dans plusieurs lancements de l'onglet", "// ---- Fichiers ----", """const alerteRecap = (texte, genre) => `<div class="alertes-recap"><div class="titre-alerte ${genre}">${texte}</div></div>`;

// Pièces présentes dans plusieurs lancements de l'onglet : risque de les fabriquer deux fois.
function htmlDoublonsRecap(lignes) {
  if (lignes.some((l) => l.cles === null)) return "";
  const groupes = doublonsEntreLancements(new Map(lignes.map((l) => [nomLancementRecap(l), l.cles])));
  const n = groupes.reduce((t, g) => t + g.cles.length, 0);
  return n ? alerteRecap(`⚠ ${n} pièce(s) lancée(s) deux fois : elles sont dans deux lancements`, "alerte") : "";
}

// Pièces déjà présentes dans un lancement de l'autre onglet semaine (relancées, ou lancées en double).
// La casse reprend par nature des pièces déjà lancées : elle a sa propre analyse, dans sa case.
function htmlDejaLancees(lignes, autres, libelleAutre) {
  lignes = lignes.filter((l) => l.paire.poste !== "Casse");
  autres = autres.filter((l) => l.paire.poste !== "Casse");
  if (lignes.some((l) => l.cles === null) || autres.some((l) => l.cles === null)) return "";
  const communes = new Set();
  for (const l of lignes) for (const o of autres) for (const cle of l.cles) if (o.cles.has(cle) && cle.length > 3) communes.add(cle);
  return communes.size ? alerteRecap(`⚠ ${communes.size} pièce(s) déjà lancée(s) en ${echapper(libelleAutre)}`, "alerte") : "";
}

// Pièces à livrer une autre semaine que le reste de leur lancement (hors casse, qui en reprend toujours).
function htmlAutresSemainesLivraison(lignes) {
  let n = 0;
  for (const l of lignes) {
    const p = l.paire;
    if (p.semainesLivraison.length <= 1 || p.poste === "Casse") continue;
    const principale = semainePrincipale(p);
    for (const s of p.semainesLivraison) if (s !== principale) n += s.nbPieces;
  }
  return n ? alerteRecap(`⚠ ${n} pièce(s) à livrer une autre semaine que leur lancement`, "attention") : "";
}

""")
open(chemin, "w", encoding="utf-8").write(s)
print("ok")
