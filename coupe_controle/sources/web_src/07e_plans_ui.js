// ---- Plans de coupe à l'écran ----
// 1. Recherche d'une pièce : une fiche simple (ce qu'est la pièce, où elle est lancée, où elle va, ses plans de coupe).
// 2. Un plan ouvert en grand : toutes ses pièces numérotées, cote finie comme dans Cut Rite.
// 3. Les plans imprimés (PDF A4, lisible en noir et blanc : la pièce cherchée est hachurée).
// 4. L'outil « Plans de coupe » : tous les plans d'un lancement, et un plan modifié à la scie (avant / après).
// Tout est lu dans la sauvegarde .bkp du lancement (voir 03b_plans.js) : rien n'est écrit dans les fichiers.

const versionSentinelle = () => ((document.querySelector(".badge-version") || {}).textContent || "").trim();
const semaineDeLaCase = (p) => p.semaine || numeroSemaine(p.parite);
const nomCasePlans = (p) => (caseAjoutee(p) ? libelleCase(p) : p.poste);
const dimsPlan = (L, W) => `${fmtDim(L)} × ${fmtDim(W)}`;

// Ce que montre un plan dans la fiche d'une pièce : titre, numéro Pdc, panneau, et ce qui est en jaune.
function textesPlanPiece(x, pp, donnees) {
  const { plan, rang } = x;
  const m = donnees.matieres.get(plan.matiere);
  const desc = m && m.desc ? ` · ${m.desc}` : "";
  const fois = plan.fois > 1 ? ` · coupé ${plan.fois} fois` : "";
  const piece = pp.piece;
  const g = pp.groupe;
  let titre;
  if (rang === 0) titre = `Dans le module ${plan.nom}`;
  else if (rang === 1) titre = `Agglo ${plan.matiere}`;
  else if (rang === 2) titre = `Stratifié ${piece && piece.dessus === piece.dessous ? "dessus et dessous" : "dessus"} ${plan.matiere}`;
  else titre = piece && plan.matiere === piece.dessous ? `Stratifié dessous ${plan.matiere}` : `Plan ${plan.matiere}`;
  let quoi;
  if (rang === 0) quoi = "la pièce";
  else if (pp.module) quoi = rang === 1 ? `le module ${g}` : `le stratifié du module ${g}`;
  else if (pp.bande) quoi = rang === 1 ? `la bande ${g} (la pièce est coupée dedans)` : `le stratifié de la bande ${g}`;
  else quoi = rang === 1 ? "la pièce" : "son stratifié";
  const visees = plan.rects.filter((r) => !r.chute && x.visee(r));
  const r = visees[0];
  const position = r
    ? `En jaune : ${quoi} — à ${fmtDim(r.x)} mm du bord gauche, ${fmtDim(r.y)} mm du haut${visees.length > 1 ? ` (et ${visees.length - 1} autre(s))` : ""}`
    : `En jaune : ${quoi}`;
  return {
    titre,
    badge: rang === 0 ? `Pdc ${plan.pdc}` : `Pdc ${plan.pdc} · ${plan.matiere}`,
    sous: rang === 0 ? `module · ${dimsPlan(plan.L, plan.W)}${desc}${fois}` : `${plan.sorte} ${plan.nom} · ${dimsPlan(plan.L, plan.W)}${desc}${fois}`,
    position,
  };
}

// Où la pièce est-elle lancée : une ligne par case (fichier de lancement, liste de coupe, .bkp), et Diakonos à part.
function lancementsDeLaPiece(l) {
  const parCase = new Map();
  const diakonos = [];
  for (const t of l.trouvee ? l.trouvee.sources : []) {
    if (t.base === BASE_DIAKONOS) {
      diakonos.push(t);
      continue;
    }
    const p = t.source.paire;
    if (!parCase.has(p)) parCase.set(p, { p, source: t.source, lan: undefined, liste: undefined, bkp: undefined });
    const g = parCase.get(p);
    const cle = t.base === BASE_LAN ? "lan" : t.base === BASE_BKP ? "bkp" : "liste";
    // quantité inconnue (liste de coupe non comptée) : null, la pièce est quand même là
    if (t.quantite === null || t.quantite === undefined) {
      if (g[cle] === undefined) g[cle] = null;
    } else g[cle] = (g[cle] || 0) + t.quantite;
  }
  return { cases: [...parCase.values()], diakonos };
}

const nomLancementPiece = (g) => `${nomCasePlans(g.p)} · S${semaineDeLaCase(g.p)}`;

// Le verdict en une phrase (vert : tout va bien ; ambre : à vérifier).
function verdictPiece(l, lancements, plans) {
  if (!l.trouvee) return { ok: false, titre: "Introuvable dans les fichiers chargés", texte: "Ni dans un fichier de lancement, ni dans une liste de coupe, un .bkp ou un Diakonos chargé." };
  const avecLan = lancements.cases.filter((g) => g.lan !== undefined);
  if (!avecLan.length) {
    const debitee = lancements.cases.filter((g) => g.liste !== undefined || g.bkp !== undefined);
    if (debitee.length) return { ok: false, titre: "Débitée, mais dans aucun fichier de lancement", texte: `Dans ${debitee.map(nomLancementPiece).join(", ")} (liste de coupe ou .bkp), pas dans le fichier de lancement.` };
    return { ok: false, titre: "Commandée, mais lancée nulle part", texte: "Dans Diakonos, mais dans aucun fichier de lancement chargé." };
  }
  if (avecLan.length > 1) {
    const casse = avecLan.filter((g) => g.p.poste === "Casse");
    if (casse.length && casse.length < avecLan.length)
      return { ok: false, titre: `Lancée en ${avecLan.filter((g) => g.p.poste !== "Casse").map(nomLancementPiece).join(", ")}, refaite en casse`, texte: "Une pièce cassée, relancée : à vérifier si ce n'est pas voulu." };
    return { ok: false, titre: `Lancée ${avecLan.length} fois`, texte: `Dans ${avecLan.map(nomLancementPiece).join(" et ")} : risque de la fabriquer deux fois.` };
  }
  const g = avecLan[0];
  const ecarts = [];
  const accord = ["fichier de lancement"];
  if (g.source.coupe) {
    if (g.liste === undefined) ecarts.push("absente de la liste de coupe");
    else if (g.liste !== null && g.lan !== null && g.liste !== g.lan) ecarts.push(`${fmtNombre(g.liste)} dans la liste de coupe au lieu de ${fmtNombre(g.lan)}`);
    else accord.push("liste de coupe");
  }
  if (g.source.bkp) {
    if (g.bkp === undefined) ecarts.push("absente du .bkp");
    else if (g.bkp !== null && g.lan !== null && g.bkp !== g.lan) ecarts.push(`${fmtNombre(g.bkp)} dans le .bkp au lieu de ${fmtNombre(g.lan)}`);
    else if (!g.source.coupe) accord.push(".bkp");
  }
  const pl = plans && plans.get(g.p);
  if (pl && pl.donnees) {
    if (!pl.place) ecarts.push("dans aucun plan de coupe : elle ne sera pas coupée");
    else if (g.lan && pl.place < g.lan) ecarts.push(`${pl.place} seulement dans les plans de coupe`);
    else accord.push("plans de coupe");
  }
  const ou = `${nomCasePlans(g.p)}, semaine ${semaineDeLaCase(g.p)}`;
  if (ecarts.length) return { ok: false, titre: `Lancée — ${ou}`, texte: `À vérifier : ${ecarts.join(" ; ")}.` };
  const dans = pl && pl.pp && pl.pp.groupe ? ` Dans ${pl.pp.module ? "le module" : pl.pp.bande ? "la bande" : ""} ${pl.pp.groupe}.` : "";
  const quoi = accord.length > 1 ? `${accord.slice(0, -1).join(", ")} et ${accord[accord.length - 1]} d'accord` : "fichier de lancement";
  return { ok: true, titre: `${pl && pl.place ? "Lancée et placée" : "Lancée"} — ${ou}`, texte: `Une seule fois. ${quoi.charAt(0).toUpperCase()}${quoi.slice(1)}.${dans}` };
}

const htmlVerdict = (v) =>
  `<div class="fp-verdict ${v.ok ? "bon" : "att"}"><div class="ico">${v.ok ? "✔" : "⚠"}</div><div class="txt"><b>${echapper(v.titre)}</b><span>${echapper(v.texte)}</span></div></div>`;

// Plans de coupe de la pièce dans chaque case qui a un .bkp : { donnees, pp, place } par case.
async function plansDeLaPieceParCase(cle, lancements) {
  const res = new Map();
  for (const g of lancements.cases) {
    if (!g.source.bkp) continue;
    try {
      const donnees = await lirePlansBkp(g.source.bkp);
      res.set(g.p, { donnees, pp: plansDeLaPiece(donnees, cle), place: donnees.placees.get(cle) || 0 });
    } catch (e) {
      res.set(g.p, { erreur: e && e.message ? e.message : String(e) });
    }
  }
  return res;
}

// La fiche simple de la pièce cherchée (au-dessus de la commande).
function fichePieceSimple(a) {
  const f = a.fiches.find((x) => x.lignes.some((l) => l.cle === a.cleCherchee));
  const l = f && f.lignes.find((x) => x.cle === a.cleCherchee);
  if (!l) return null;
  const cle = l.cle;
  const c = l.trouvee ? l.trouvee.champs : null;
  const d = (c && c.toutesDonneesLan) || {};
  const commande = d.conf_commande || d.Commande || f.commande;
  const ligne = d.conf_ligne ?? d.Ligne ?? (parseInt(cle.slice(-3), 10) || "");
  const type = l.piece && l.piece.type !== "autre" ? LIBELLE_TYPE_PIECE[l.piece.type] : d.conf_article || d.Article || "Pièce";
  const dims = c && c.longueurFinie != null && c.largeurFinie != null
    ? `${fmtDim(c.longueurFinie)} × ${fmtDim(c.largeurFinie)}${c.epaisseurFinie != null ? ` × ${fmtDim(c.epaisseurFinie)}` : ""} mm`
    : "";
  const sous = [d.agglo ? `Agglo ${d.agglo}` : "", d.coloris ? `dessus ${d.coloris}` : d.Coloris ? `coloris ${d.Coloris}` : "", d.coloris_inf ? `dessous ${d.coloris_inf}` : "", d.conf_article || ""]
    .filter(Boolean)
    .join(" · ");
  const lancements = lancementsDeLaPiece(l);
  const carte = document.createElement("div");
  carte.className = "carte fiche-piece";
  const ligneCle = [cle, `commande ${commande}, ligne ${ligne}`, d.com_clientcom || "", d.com_reference ? `réf. ${d.com_reference}` : ""].filter(Boolean).join(" · ");

  // Où va la pièce : l'ensemble de la commande (la pièce en jaune) et la pièce seule, avec sa position.
  let ouVa = "";
  if (c) {
    const bloc = f.blocs ? f.blocs.find((b) => b.ensemble && b.lignes.some((lp) => lp.piece.cle === cle) && ensembleADessiner(f.schema, b.ensemble)) : null;
    const infos = l.infos.map((i) => `<div class="info${i.alerte ? " alerte" : ""}">${echapper(i.texte)}</div>`).join("");
    const legende = bloc ? bloc.titre : "";
    ouVa = `<div class="fp-h3">Où va la pièce</div><div class="fp-ou-va${bloc ? "" : " seule"}">
      ${bloc ? `<div class="fp-ensemble">${svgEnsembleCommande(f.schema, bloc.ensemble, cle)}<div class="note">${echapper(legende)} — la pièce cherchée est en jaune</div></div>` : ""}
      <div class="fp-seule">${construireSchemaPieceSvg(c)}${infos}</div></div>`;
  }

  // Où est la pièce : une ligne par lancement.
  const cellule = (q, fichier) => {
    if (q === undefined) return fichier ? '<td class="c alerte">✗ absente</td>' : '<td class="c pale">—</td>';
    return `<td class="c ok">✔ ${q === null ? "" : fmtNombre(q)}</td>`;
  };
  const lignes = lancements.cases
    .map((g) => `<tr><td><strong>${echapper(nomCasePlans(g.p))}</strong> · S${echapper(semaineDeLaCase(g.p))}${g.p.strat ? ` · ${echapper(g.p.strat.name.replace(/\.[^.]*$/, ""))}` : ""}</td>
      ${cellule(g.lan, g.p.strat)}${cellule(g.liste, g.source.coupe)}${cellule(g.bkp, g.source.bkp)}<td class="c" data-plan-case="${g.p.id}">${g.source.bkp ? "…" : '<span class="pale">—</span>'}</td></tr>`)
    .join("");
  let commandee = "";
  if (lancements.diakonos.length) commandee = `<div class="note">Commandée : <span class="ok">✔ oui</span>, dans Diakonos (${echapper([...new Set(lancements.diakonos.map(nomSourceRecherche))].join(", "))}).</div>`;
  else if (paires.some((p) => (estDiakonos(p) ? p.strat : p.diakonos))) commandee = '<div class="note">Commandée : dans aucun Diakonos chargé.</div>';
  const donnees = Object.entries(d);

  carte.innerHTML = `
    <div class="fp-cle">${echapper(ligneCle)}</div>
    <div class="fp-nom">${echapper(type)} ${echapper(dims)}</div>
    ${sous ? `<div class="fp-sous">${echapper(sous)}</div>` : ""}
    <div class="fp-zone-verdict">${htmlVerdict(verdictPiece(l, lancements, null))}</div>
    ${ouVa}
    ${lancements.cases.length ? `<div class="fp-h3">Où est la pièce</div>
    <div class="defilement"><table class="fp-table"><thead><tr><th>Lancement</th><th class="c">Fichier LAN</th><th class="c">Liste de coupe</th><th class="c">Optimisation .bkp</th><th class="c">Plan de coupe</th></tr></thead><tbody>${lignes}</tbody></table></div>` : ""}
    ${commandee}
    <div class="fp-plans"></div>
    ${donnees.length ? `<details class="donnees fp-donnees"><summary>Toutes les données ${c && c.toutesDonneesLan && d.conf_commande ? "du LAN" : ""} <span class="note">(${donnees.length} colonnes)</span></summary><table class="table-donnees-lan">${donnees
      .map(([k, v]) => `<tr><th>${echapper(k)}</th><td>${echapper(v)}</td></tr>`)
      .join("")}</table></details>` : ""}`;
  remplirPlansFiche(carte, l, lancements);
  return carte;
}

// Les plans de la pièce, lus après l'affichage (quelques dixièmes de seconde par .bkp) : verdict et tableau complétés.
async function remplirPlansFiche(carte, l, lancements) {
  if (!lancements.cases.some((g) => g.source.bkp)) return;
  const plans = await remplirPlansPiece(carte.querySelector(".fp-plans"), l, lancements);
  carte.querySelector(".fp-zone-verdict").innerHTML = htmlVerdict(verdictPiece(l, lancements, plans));
  for (const [p, x] of plans) {
    const td = carte.querySelector(`[data-plan-case="${p.id}"]`);
    if (!td) continue;
    if (x.erreur) {
      td.innerHTML = '<span class="alerte">illisible</span>';
      continue;
    }
    const premier = x.pp.plans.find((y) => y.rang === 0) || x.pp.plans.find((y) => y.rang === 1);
    td.className = `c ${x.place ? "ok" : "alerte"}`;
    td.textContent = x.place
      ? `✔ placée${premier ? ` · Pdc ${premier.plan.pdc}${premier.rang === 0 ? ` (module ${premier.plan.nom})` : ` · ${premier.plan.matiere}`}` : ""}`
      : "✗ dans aucun plan";
  }
}

// Les vignettes des plans de coupe d'une pièce (fiche de la pièce, ou une pièce de la commande dans la recherche).
// Un plan modifié dans Sentinelle est montré modifié (badge « ✎ modifié »). Rend les plans lus, par case.
async function remplirPlansPiece(zone, l, lancements) {
  zone.innerHTML = '<div class="note">Lecture des plans de coupe…</div>';
  const plans = await plansDeLaPieceParCase(l.cle, lancements);
  const dessiner = () => {
    let html = "";
    const groupes = [];
    for (const [p, x] of plans) {
      if (x.erreur) {
        html += `<div class="message-alerte">${echapper(nomCasePlans(p))} : plans illisibles (${echapper(x.erreur)})</div>`;
        continue;
      }
      if (x.pp.plans.length) groupes.push({ p, x });
    }
    for (const { p, x } of groupes) {
      const n = x.pp.plans.length;
      const bande = x.pp.bande && !x.pp.module ? `<div class="note">Pièce de la bande ${echapper(x.pp.groupe)} : elle est coupée dans la bande (pas de plan à part).</div>` : "";
      html += `<div class="fp-h3 fp-titre-plans"><span>Plans de coupe${groupes.length > 1 ? ` — ${echapper(nomCasePlans(p))}` : ""}</span>
        <span class="note">${n} plan(s), mêmes numéros « Pdc » que dans Cut Rite</span>
        <button type="button" class="contour petit" data-imprimer-case="${p.id}">Imprimer les plans (PDF)</button></div>${bande}
        <div class="pl-grille">${x.pp.plans
          .map((y, i) => {
            const t = textesPlanPiece(y, x.pp, x.donnees);
            const v = versionDuPlan(x.donnees.lancement, y.plan);
            return `<div class="pl-carte${v.rt ? " modifie" : ""}" role="button" tabindex="0" data-case="${p.id}" data-i="${i}" title="Ouvrir le plan en grand (et le modifier)">
              <div class="pl-titre"><span>${i + 1} · ${echapper(t.titre)}</span><span class="pl-pdc">${echapper(t.badge)}</span></div>
              <div class="pl-sous">${echapper(t.sous)}${v.rt ? ' · <span class="pl-modifie">✎ modifié dans Sentinelle</span>' : ""}</div>
              ${svgPlan(v.plan, { visee: y.visee, etats: v.etats, textes: v.textes })}
              <div class="pl-pos">${echapper(t.position)}</div></div>`;
          })
          .join("")}</div>`;
    }
    if (groupes.length) html += '<div class="note">Cliquer un plan l\'ouvre en grand avec toutes ses pièces numérotées (cote finie comme dans Cut Rite) : on peut y modifier les pièces et imprimer le plan d\'origine ou modifié. Plans lus dans la sauvegarde .bkp du lancement.</div>';
    zone.innerHTML = html;
    for (const b of zone.querySelectorAll(".pl-carte")) {
      const { x } = groupes.find((gr) => String(gr.p.id) === b.dataset.case);
      const y = x.pp.plans[Number(b.dataset.i)];
      activerCartePlan(b, () => ouvrirPlanEnGrand({ plan: y.plan, donnees: x.donnees, visee: y.visee, ...textesPlanPiece(y, x.pp, x.donnees), apresModification: dessiner }));
    }
    for (const b of zone.querySelectorAll("[data-imprimer-case]")) {
      const { p, x } = groupes.find((gr) => String(gr.p.id) === b.dataset.imprimerCase);
      b.addEventListener("click", () => imprimerPlansPiece(l, p, x));
    }
  };
  dessiner();
  return plans;
}

// Un plan pour le PDF : la version modifiée s'il l'a été (bien marquée), sinon d'origine.
function planPourPdf(x) {
  const v = versionDuPlan(x.donnees.lancement, x.plan);
  if (!v.rt) return x;
  return { ...x, plan: v.plan, etats: v.etats, textes: v.textes, marques: v.marques, titre: `${x.titre || `Plan ${x.plan.pdc}`} — MODIFIÉ`, legende: `Modifié dans Sentinelle${v.rt.date ? ` le ${new Date(v.rt.date).toLocaleDateString("fr-FR")}` : ""} : ${changementsRetouche(x.plan, v.rt).length} changement(s)` };
}
const NOTE_PDF_MODIFIES = " Plans marqués « MODIFIÉ » : bleu = pièce modifiée, vert = pièce posée, pointillés rouges = pièce retirée (ne pas couper) ; modifiés dans Sentinelle, le .bkp ne change pas.";

function imprimerPlansPiece(l, p, x) {
  const c = l.trouvee ? l.trouvee.champs : null;
  const d = (c && c.toutesDonneesLan) || {};
  const dims = c && c.longueurFinie != null ? `${fmtDim(c.longueurFinie)} × ${fmtDim(c.largeurFinie)}${c.epaisseurFinie != null ? ` × ${fmtDim(c.epaisseurFinie)}` : ""} mm` : "";
  const lancement = p.strat ? p.strat.name.replace(/\.[^.]*$/, "") : x.donnees.lancement;
  const plans = x.pp.plans.map((y) => planPourPdf({ plan: y.plan, donnees: x.donnees, visee: y.visee, ...textesPlanPiece(y, x.pp, x.donnees) }));
  const octets = pdfPlansDeCoupe({
    surtitre: `Plans de coupe de la pièce · lancement ${lancement} · semaine ${semaineDeLaCase(p)}`,
    titre: `${d.conf_article || ""} ${dims}`.trim() || l.cle,
    lignes: [
      [l.cle, d.conf_commande ? `commande ${d.conf_commande}, ligne ${d.conf_ligne}` : "", d.com_clientcom || "", d.com_reference ? `réf. ${d.com_reference}` : ""].filter(Boolean).join(" · "),
      [d.agglo ? `Agglo ${d.agglo}` : "", d.coloris ? `dessus ${d.coloris}` : "", d.coloris_inf ? `dessous ${d.coloris_inf}` : "", x.pp.groupe ? `${x.pp.module ? "module" : "bande"} ${x.pp.groupe}` : ""].filter(Boolean).join(" · "),
    ],
    note: `La pièce cherchée (ou le module et les stratifiés qui la portent) est hachurée, avec un bord épais et un numéro sur fond noir. Les numéros « Pdc » sont ceux de Cut Rite. Cotes finies en mm.${plans.some((y) => y.marques) ? NOTE_PDF_MODIFIES : ""}`,
    plans,
    document: `Plans de coupe de ${l.cle}`,
  });
  telecharger(`Plans_de_coupe_${l.cle}.pdf`, octets, "application/pdf");
}

// ---- Un plan en grand ----

// Une vignette de plan s'ouvre d'un clic ou au clavier (Entrée, espace).
function activerCartePlan(el, ouvrir) {
  el.addEventListener("click", ouvrir);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      ouvrir();
    }
  });
}

// Les morceaux d'un plan, numérotés comme sur le dessin (les chutes à part).
function morceauxNumerotes(plan) {
  const morceaux = [];
  const chutes = [];
  for (const r of plan.rects) {
    if (r.chute) chutes.push(r);
    else morceaux.push(r);
  }
  return { morceaux, chutes };
}

// Le plan en grand (et ses modifications) : voir 07g_retouche_plans.js.

// ---- Les plans en PDF (A4 portrait, lisible en noir et blanc) ----
// options : { surtitre, titre, lignes: [texte], note, plans: [{ plan, donnees, visee, titre, badge, sous, etats, textes, legende }],
//             document (pied de page) }
function pdfPlansDeCoupe(o) {
  const pdf = new PdfSimple(o.document || o.titre);
  const M = RAPPORT_MARGE;
  const U = RAPPORT_UTILE;
  const HAUT_SUITE = RAPPORT_BANDEAU + 9 * PDF_MM;
  bandeauPdf(pdf);
  const hLogo = pdf.logo(PDF_LARGEUR - M - 30 * PDF_MM, RAPPORT_BANDEAU + 6 * PDF_MM, 30 * PDF_MM);
  const largeurTitre = U - 36 * PDF_MM;
  let y = RAPPORT_BANDEAU + 6 * PDF_MM + 6;
  for (const t of couperTextePdf(String(o.surtitre || "").toLocaleUpperCase("fr"), largeurTitre, 7.5, POLICE.GRAS)) {
    pdf.texte(M, y, t, 7.5, POLICE.GRAS, CHARTE.GRIS, 0.8);
    y += 10;
  }
  y += 8;
  for (const t of couperTextePdf(o.titre, largeurTitre, 17, POLICE.TITRE)) {
    pdf.texte(M, y, t, 17, POLICE.TITRE, CHARTE.NOIR);
    y += 20;
  }
  for (const ligne of o.lignes || []) {
    if (!ligne) continue;
    for (const t of couperTextePdf(ligne, largeurTitre, 8.5, POLICE.TEXTE)) {
      pdf.texte(M, y - 4, t, 8.5, POLICE.TEXTE, CHARTE.NOIR);
      y += 11;
    }
  }
  y = Math.max(y, RAPPORT_BANDEAU + 6 * PDF_MM + hLogo + 6);
  if (o.note) y = encadrePdf(pdf, y, o.note, true) + 12;
  const nouvellePage = () => {
    pdf.nouvellePage();
    bandeauPdf(pdf);
    return HAUT_SUITE;
  };
  o.plans.forEach((x, i) => {
    const { plan, donnees } = x;
    const visee = x.visee || (() => false);
    const { morceaux } = morceauxNumerotes(plan);
    // Dessin à la largeur de la page, au plus 85 mm de haut.
    const ech = Math.min(U / plan.L, (85 * PDF_MM) / plan.W);
    const hDessin = plan.W * ech;
    const hTete = 34;
    if (y + hTete + hDessin + 40 > RAPPORT_BAS) y = nouvellePage();
    // En-tête du plan : numéro, titre, Pdc.
    pdf.disque(M + 7, y + 6, 7, CHARTE.BORDEAUX);
    const num = String(i + 1);
    pdf.texte(M + 7 - largeurTextePdf(num, 8.5, POLICE.GRAS) / 2, y + 9, num, 8.5, POLICE.GRAS, CHARTE.BLANC);
    pdf.texte(M + 20, y + 10, x.titre || `Plan ${plan.pdc}`, 11, POLICE.TITRE, CHARTE.NOIR);
    const badge = x.badge || `Pdc ${plan.pdc}`;
    const lb = largeurTextePdf(badge, 8.5, POLICE.GRAS) + 14;
    pdf.rectangle(M + U - lb, y, lb, 14, CHARTE.SAUMON_PALE, CHARTE.NOIR, 0.6);
    pdf.texte(M + U - lb + 7, y + 10, badge, 8.5, POLICE.GRAS, CHARTE.NOIR);
    pdf.texte(M, y + 24, couperTextePdf(x.sous || "", U, 7.5, POLICE.TEXTE)[0], 7.5, POLICE.TEXTE, CHARTE.GRIS);
    if (x.legende) pdf.texte(M, y + 33, x.legende, 7.5, POLICE.GRAS, CHARTE.BORDEAUX);
    y += hTete + (x.legende ? 6 : 0);
    dessinerPlanPdf(pdf, M, y, ech, plan, donnees, visee, x.etats, x.textes);
    y += hDessin + 10;
    // Tableau des pièces.
    const colonnes = [[M, "N°"], [M + 22, "Pièce"], [M + 250, "Article"], [M + 330, "Cote finie"], [M + 410, "Commande / ligne"]];
    const entete = () => {
      for (const [cx, t] of colonnes) pdf.texte(cx, y, t.toLocaleUpperCase("fr"), 6.5, POLICE.GRAS, CHARTE.GRIS, 0.4);
      pdf.filet(M, M + U, y + 4, CHARTE.NOIR, 0.6);
      y += 13;
    };
    entete();
    morceaux.forEach((r, k) => {
      if (y + 11 > RAPPORT_BAS) {
        y = nouvellePage();
        entete();
      }
      const v = visee(r);
      const etat = x.etats ? x.etats.get(plan.rects.indexOf(r)) : null;
      if (v) pdf.rectangle(M, y - 8.5, U, 11, 0xfff3c4, null, 0);
      const police = v ? POLICE.GRAS : POLICE.TEXTE;
      const piece = r.cle && !MOTIF_NOYAU_PLAN.test(r.nom || "") && !MOTIF_STRATIFIE_PLAN.test(r.nom || "");
      const marque = x.marques ? x.marques.get(plan.rects.indexOf(r)) : null;
      const nom = `${nomMorceauPlan(r)}${v ? " ← pièce cherchée" : ""}${marque ? ` (${marque})` : etat === "ajoutee" ? " (ajoutée)" : etat === "deplacee" ? " (part sur un autre plan)" : ""}`;
      pdf.texte(M + 4, y, String(k + 1), 7.5, police, CHARTE.NOIR);
      const morceauxNom = couperTextePdf(nom, 222, 7.5, police);
      pdf.texte(M + 22, y, morceauxNom[0], 7.5, police, CHARTE.NOIR);
      pdf.texte(M + 250, y, couperTextePdf(r.article || "", 76, 7.5, police)[0], 7.5, police, CHARTE.NOIR);
      pdf.texte(M + 330, y, dimsPlan(r.fini[0], r.fini[1]), 7.5, police, CHARTE.NOIR);
      if (piece) pdf.texte(M + 410, y, `${r.commande} / ${r.ligne}`, 7.5, police, CHARTE.NOIR);
      for (const suite of morceauxNom.slice(1, 3)) {
        y += 9;
        pdf.texte(M + 22, y, suite, 7.5, police, CHARTE.NOIR);
      }
      pdf.filet(M, M + U, y + 2.5, CHARTE.GRIS_FILET, 0.4);
      y += 11;
    });
    y += 16;
  });
  piedsDePagePdf(pdf, `${o.document || o.titre} — Sentinelle ${versionSentinelle()}`);
  return pdf.octets();
}

// Un plan dessiné à l'échelle dans le PDF : coin haut gauche (x0, y0), ech points par mm.
function dessinerPlanPdf(pdf, x0, y0, ech, plan, donnees, visee, etats, textes) {
  const X = (v) => x0 + v * ech;
  const Y = (v) => y0 + v * ech;
  pdf.rectangle(x0, y0, plan.L * ech, plan.W * ech, CHARTE.BLANC, CHARTE.NOIR, 0.8);
  let n = 0;
  plan.rects.forEach((r, idx) => {
    const etat = etats ? etats.get(idx) : null;
    const [x, y, l, h] = [X(r.x), Y(r.y), r.L * ech, r.W * ech];
    if (r.chute) {
      if (etat === "chute_perdue") {
        pdf.rectangle(x, y, l, h, 0xfff3c4, null, 0);
        pdf.hachures(x, y, l, h, 0xc98a00, 5, 0.5);
        pdf.rectangle(x, y, l, h, null, 0xc98a00, 1.2);
      } else pdf.pointilles(x, y, l, h, CHARTE.GRIS, 0.4, 3);
      if (l > 70 && h > 14) texteCentrePdf(pdf, x + l / 2, y + h / 2 + 2.5, `chute ${dimsPlan(r.L, r.W)}`, Math.min(7, h * 0.4), POLICE.ITALIQUE, CHARTE.GRIS);
      return;
    }
    n++;
    if (etat === "partie") {
      pdf.pointilles(x, y, l, h, 0xc62828, 1, 4);
      if (l > 60 && h > 12) texteCentrePdf(pdf, x + l / 2, y + h / 2 + 2.5, (textes && textes.get(idx)) || "partie sur un autre plan", Math.min(7.5, h * 0.4), POLICE.GRAS, 0xc62828);
      return;
    }
    const v = visee(r);
    const fond = etat === "ajoutee" ? 0xc8e6c9 : etat === "modifiee" ? 0xbbdefb : etat === "deplacee" ? 0xfde2df : v ? 0xffe082 : 0xf1f0ee;
    pdf.rectangle(x, y, l, h, fond, null, 0);
    if (v || etat === "deplacee") pdf.hachures(x, y, l, h, etat === "deplacee" ? 0xc62828 : CHARTE.NOIR, 5, 0.6);
    const nom = (r.nom || "").split("/")[0];
    const mod = !plan.module && MOTIF_NOYAU_PLAN.test(r.nom || "") ? donnees.modules.get(nom) : null;
    if (mod && !etat) {
      for (const q of mod.rects) {
        if (q.chute) continue;
        const [qx, qy, ql, qw] = r.tourne ? [q.y, q.x, q.W, q.L] : [q.x, q.y, q.L, q.W];
        const qv = visee(q);
        if (qv) {
          pdf.rectangle(x + qx * ech, y + qy * ech, ql * ech, qw * ech, 0xffe082, null, 0);
          pdf.hachures(x + qx * ech, y + qy * ech, ql * ech, qw * ech, CHARTE.NOIR, 4, 0.5);
        }
        pdf.rectangle(x + qx * ech, y + qy * ech, ql * ech, qw * ech, null, CHARTE.NOIR, qv ? 1 : 0.3);
      }
      if (l > 40 && h > 10) pdf.texte(x + 14, y + 8, `module ${nom}`, 6, POLICE.GRAS, CHARTE.BORDEAUX);
    } else if (l > 34 && h > 9) {
      const t = `${fmtDim(r.fini[0])} × ${fmtDim(r.fini[1])}`;
      const taille = Math.min(9, h * 0.45, (l / Math.max(1, t.length)) * 1.7);
      if (taille >= 4.5) {
        const lt = largeurTextePdf(t, taille, POLICE.GRAS);
        if (v) pdf.rectangle(x + l / 2 - lt / 2 - 2, y + h / 2 - taille * 0.75, lt + 4, taille * 1.15, CHARTE.BLANC, null, 0);
        texteCentrePdf(pdf, x + l / 2, y + h / 2 + taille * 0.35, t, taille, POLICE.GRAS, CHARTE.NOIR);
      }
    }
    const trait = etat === "ajoutee" ? 0x2e7d32 : etat === "modifiee" ? 0x1565c0 : etat === "deplacee" ? 0xc62828 : CHARTE.NOIR;
    pdf.rectangle(x, y, l, h, null, trait, v || etat ? 1.8 : 0.5);
    if ((etat === "ajoutee" || etat === "modifiee") && l > 44 && h > 22) texteCentrePdf(pdf, x + l / 2, y + h - 3.5, etat === "ajoutee" ? "POSÉE" : "MODIFIÉE", 5.5, POLICE.GRAS, trait);
    // Numéro : sur fond noir pour la pièce cherchée.
    const rr = Math.max(3.2, Math.min(5.5, h * 0.3, l * 0.2));
    pdf.disque(x + rr + 1.5, y + rr + 1.5, rr, CHARTE.NOIR);
    if (!v) pdf.disque(x + rr + 1.5, y + rr + 1.5, rr - 0.6, CHARTE.BLANC);
    texteCentrePdf(pdf, x + rr + 1.5, y + rr + 1.5 + rr * 0.38, String(n), rr * 1.05, POLICE.GRAS, v ? CHARTE.BLANC : CHARTE.NOIR);
  });
}

function texteCentrePdf(pdf, cx, yBase, texte, taille, police, rgb) {
  pdf.texte(cx - largeurTextePdf(texte, taille, police) / 2, yBase, texte, taille, police, rgb);
}

// ---- Outil « Plans de coupe » : tous les plans d'un lancement, et un plan modifié à la scie ----

const etatPlans = { source: null, donnees: null, matiere: null, erreur: null, modif: null };

// Les cases qui ont un .bkp (toutes les semaines chargées).
const casesAvecBkp = () => paires.filter((p) => p.bkp && !estDiakonos(p));
const nomSourcePlans = (s) => (s.p ? `${nomCasePlans(s.p)} · S${semaineDeLaCase(s.p)} · ${s.bkp.name}` : s.bkp.name);

function ouvrirOutilPlans(p) {
  choisirSourcePlans({ p, bkp: p.bkp });
  onglet = "plans";
  afficher();
  window.scrollTo(0, 0);
}

function choisirSourcePlans(source) {
  if (etatPlans.source && source && etatPlans.source.bkp === source.bkp) return;
  Object.assign(etatPlans, { source, donnees: null, matiere: null, erreur: null, modif: null });
}

// Choisir un fichier .bkp sur le PC (un champ fichier temporaire).
function demanderBkp(action) {
  const champ = document.createElement("input");
  champ.type = "file";
  champ.accept = ".bkp";
  champ.addEventListener("change", () => {
    if (champ.files && champ.files[0]) action(champ.files[0]);
  });
  champ.click();
}

async function afficherOutilPlans() {
  const page = $("pagePlans");
  if (!etatPlans.source) {
    const cases = casesAvecBkp();
    if (cases.length) choisirSourcePlans({ p: cases[0], bkp: cases[0].bkp });
  } else if (etatPlans.source.p && etatPlans.source.p.bkp !== etatPlans.source.bkp) {
    // le .bkp de la case a changé depuis
    const p = etatPlans.source.p;
    Object.assign(etatPlans, { source: p.bkp ? { p, bkp: p.bkp } : null, donnees: null, matiere: null, erreur: null, modif: null });
  }
  const cases = casesAvecBkp();
  const s = etatPlans.source;
  const options = cases.map((p) => `<option value="${p.id}" ${s && s.p === p ? "selected" : ""}>${echapper(nomSourcePlans({ p, bkp: p.bkp }))}</option>`);
  if (s && !s.p) options.unshift(`<option value="" selected>${echapper(s.bkp.name)}</option>`);
  page.innerHTML = `${entetePage("Outils", "Plans de coupe", "Les plans de l'optimisation Cut Rite d'un lancement (sauvegarde .bkp), avec les mêmes numéros « Pdc » que dans Cut Rite.")}
    <div class="carte"><div class="carte-titre">Lancement</div>
      <div class="pl-choix">${options.length ? `<select id="choixPlansLancement" aria-label="Lancement">${options.join("")}</select>` : '<span class="note">Aucun .bkp chargé dans les semaines.</span>'}
        <button type="button" class="contour" id="btnOuvrirBkpPlans">Ouvrir un .bkp…</button></div>
      <div id="zonePlansLancement"></div></div>
    <div class="carte"><div class="carte-titre">Plan modifié à la scie</div>
      <div class="note">Comparer l'optimisation à une autre version du même lancement (le .bkp sauvegardé après la modification). Les plans sont comparés un à un, même numéro « Pdc ».</div>
      <div class="pl-choix" style="margin-top:8px"><button type="button" class="contour" id="btnBkpModifie" ${s ? "" : "disabled"}>Choisir le .bkp modifié…</button></div>
      <div id="zonePlansModifies"></div></div>`;
  const choix = $("choixPlansLancement");
  if (choix)
    choix.addEventListener("change", () => {
      const p = paires.find((x) => String(x.id) === choix.value);
      if (p) {
        choisirSourcePlans({ p, bkp: p.bkp });
        afficherOutilPlans();
      }
    });
  $("btnOuvrirBkpPlans").addEventListener("click", () =>
    demanderBkp((f) => {
      choisirSourcePlans({ p: null, bkp: f });
      afficherOutilPlans();
    })
  );
  $("btnBkpModifie").addEventListener("click", () => demanderBkp((f) => comparerPlanModifie(f)));
  if (!s) return;
  const zone = $("zonePlansLancement");
  if (!etatPlans.donnees && !etatPlans.erreur) {
    zone.innerHTML = '<div class="note">Lecture des plans…</div>';
    try {
      etatPlans.donnees = await lirePlansBkp(s.bkp);
    } catch (e) {
      etatPlans.erreur = e && e.message ? e.message : String(e);
    }
    if (etatPlans.source !== s) return; // autre lancement choisi entre-temps
  }
  if (etatPlans.erreur) {
    zone.innerHTML = `<div class="message-alerte">Plans illisibles : ${echapper(etatPlans.erreur)}</div>`;
    return;
  }
  afficherPlansLancement(zone);
  if (etatPlans.modif) afficherPlansModifies();
}

function afficherPlansLancement(zone) {
  const d = etatPlans.donnees;
  const mats = [...d.matieres.values()].filter((m) => m.plans.some((p) => !p.module)).sort((a, b) => a.mat.localeCompare(b.mat));
  if (!etatPlans.matiere) etatPlans.matiere = mats.length ? mats[0].mat : "*modules";
  const pasOk = [...d.matieres.values()].flatMap((m) => m.plans).filter((p) => !p.ok).length;
  const options = [
    ...mats.map((m) => `<option value="${echapper(m.mat)}" ${etatPlans.matiere === m.mat ? "selected" : ""}>${echapper(m.mat)}${m.desc ? ` — ${echapper(m.desc)}` : ""} (${m.plans.filter((p) => !p.module).length} plans)</option>`),
    d.nbModules ? `<option value="*modules" ${etatPlans.matiere === "*modules" ? "selected" : ""}>Modules (${d.nbModules})</option>` : "",
  ];
  const plans = etatPlans.matiere === "*modules" ? [...d.modules.values()] : (d.matieres.get(etatPlans.matiere) || { plans: [] }).plans.filter((p) => !p.module);
  zone.innerHTML = `<div class="pl-resume">${echapper(d.lancement)} · ${d.matieres.size} matières · ${fmtNombre(d.nbPlans)} plans de panneaux · ${fmtNombre(d.nbModules)} modules</div>
    ${pasOk ? `<div class="message-alerte">${pasOk} plan(s) mal lu(s) : à vérifier dans Cut Rite.</div>` : ""}
    <div class="pl-choix"><select id="choixPlansMatiere" aria-label="Matière">${options.join("")}</select>
      <button type="button" class="contour" id="btnImprimerMatiere">Imprimer les plans de la matière (PDF)</button></div>
    <div class="pl-grille">${plans
      .map((p, i) => {
        const n = p.rects.filter((r) => !r.chute).length;
        const v = versionDuPlan(d.lancement, p);
        return `<div class="pl-carte${v.rt ? " modifie" : ""}" role="button" tabindex="0" data-i="${i}" title="Ouvrir le plan en grand (et le modifier)">
          <div class="pl-titre"><span>${p.module ? `Module ${echapper(p.nom)}` : `Pdc ${p.pdc}`}</span><span class="pl-pdc">${p.module ? `Pdc ${p.pdc} · ${echapper(p.matiere)}` : echapper(p.sorte)}</span></div>
          <div class="pl-sous">${p.module ? "module" : echapper(p.nom)} · ${dimsPlan(p.L, p.W)}${p.fois > 1 ? ` · coupé ${p.fois} fois` : ""} · ${n} morceau(x)${p.ok ? "" : " · ⚠ mal lu"}${v.rt ? ' · <span class="pl-modifie">✎ modifié dans Sentinelle</span>' : ""}</div>
          ${svgPlan(v.plan, { etats: v.etats, textes: v.textes })}</div>`;
      })
      .join("")}</div>`;
  const texteDe = (p) => ({
    plan: p,
    donnees: d,
    titre: p.module ? `Module ${p.nom}` : `${p.matiere} — Pdc ${p.pdc}`,
    badge: `Pdc ${p.pdc} · ${p.matiere}`,
    sous: `${p.module ? "module" : `${p.sorte} ${p.nom}`} · ${dimsPlan(p.L, p.W)}${p.fois > 1 ? ` · coupé ${p.fois} fois` : ""}`,
    apresModification: () => afficherPlansLancement(zone),
  });
  zone.querySelectorAll(".pl-carte").forEach((b) => activerCartePlan(b, () => ouvrirPlanEnGrand(texteDe(plans[Number(b.dataset.i)]))));
  $("choixPlansMatiere").addEventListener("change", (e) => {
    etatPlans.matiere = e.target.value;
    afficherPlansLancement(zone);
  });
  $("btnImprimerMatiere").addEventListener("click", () => {
    const m = d.matieres.get(etatPlans.matiere);
    const titre = etatPlans.matiere === "*modules" ? "Modules" : `${etatPlans.matiere}${m && m.desc ? ` — ${m.desc}` : ""}`;
    const aImprimer = plans.map((p) => planPourPdf(texteDe(p)));
    const nbModifies = aImprimer.filter((y) => y.marques).length;
    const octets = pdfPlansDeCoupe({
      surtitre: `Plans de coupe · lancement ${d.lancement}`,
      titre,
      lignes: [`${plans.length} plan(s) · lus dans ${etatPlans.source.bkp.name}${nbModifies ? ` · ${nbModifies} modifié(s) dans Sentinelle` : ""}`],
      note: `Les numéros « Pdc » sont ceux de Cut Rite. Cotes finies en mm.${nbModifies ? NOTE_PDF_MODIFIES : ""}`,
      plans: aImprimer,
      document: `Plans de coupe ${d.lancement} ${etatPlans.matiere === "*modules" ? "modules" : etatPlans.matiere}`,
    });
    telecharger(`Plans_${d.lancement}_${etatPlans.matiere === "*modules" ? "modules" : etatPlans.matiere}.pdf`, octets, "application/pdf");
  });
}

// ---- Plan modifié à la scie ----

const CLE_PLANS_VALIDES = "sentinelle-plans-modifies-valides";
const lireValidationsPlans = () => {
  try {
    return JSON.parse(localStorage.getItem(CLE_PLANS_VALIDES) || "{}");
  } catch (_e) {
    return {};
  }
};
const cleModification = (m) => `${m.avant.lancement}|${m.fichier.name}|${m.fichier.size}`;

async function comparerPlanModifie(fichier) {
  const zone = $("zonePlansModifies");
  zone.innerHTML = '<div class="note">Lecture du .bkp modifié…</div>';
  try {
    const avant = etatPlans.donnees || (await lirePlansBkp(etatPlans.source.bkp));
    const apres = await lirePlansBkp(fichier);
    const m = { fichier, avant, apres, comparaison: null, controle: null, autreLancement: avant.lancement !== apres.lancement };
    if (!m.autreLancement) {
      m.comparaison = comparerPlans(avant, apres);
      // Contrôle refait sur le nouveau fichier : chaque pièce du lancement doit encore être dans un plan.
      const p = etatPlans.source.p;
      if (p && p.strat) {
        const attendues = lireQuantitesAttenduesScies(await classeurEnCache(p.strat));
        m.controle = await controlerPlans(attendues, fichier, await lireBkp(fichier));
      }
    }
    etatPlans.modif = m;
  } catch (e) {
    zone.innerHTML = `<div class="message-alerte">.bkp modifié illisible : ${echapper(e && e.message ? e.message : String(e))}</div>`;
    return;
  }
  afficherPlansModifies();
}

// Le plan « après » avec les places laissées vides par les pièces parties (si rien d'autre n'y est posé).
function planApresAffiche(c, deplacements) {
  const etats = new Map();
  const textes = new Map();
  if (!c.apres) return { plan: null, etats, textes };
  c.ajoutes.forEach((idx) => {
    if (!c.apres.rects[idx].chute) etats.set(idx, "ajoutee");
  });
  const rects = [...c.apres.rects];
  // Occupée si plus de 5 % de sa surface est prise (une bande de chute recalculée peut décaler un peu les voisines).
  const recouvre = (r, q) => Math.max(0, Math.min(r.x + r.L, q.x + q.L) - Math.max(r.x, q.x)) * Math.max(0, Math.min(r.y + r.W, q.y + q.W) - Math.max(r.y, q.y));
  const occupe = (r) => c.apres.rects.reduce((t, q) => t + (q.chute ? 0 : recouvre(r, q)), 0) > 0.05 * r.L * r.W;
  for (const idx of c.partis) {
    const r = c.avant.rects[idx];
    if (r.chute || occupe(r)) continue;
    const vers = r.cle && deplacements.get(r.cle) ? deplacements.get(r.cle).vers : null;
    etats.set(rects.length, "partie");
    textes.set(rects.length, vers ? `partie sur le Pdc ${vers.pdc}${vers.mat !== c.mat ? ` · ${vers.mat}` : ""}` : "plus dans aucun plan");
    rects.push({ ...r });
  }
  return { plan: { ...c.apres, rects }, etats, textes };
}

function etatsAvant(c) {
  const etats = new Map();
  if (c.avant) for (const idx of c.partis) etats.set(idx, c.avant.rects[idx].chute ? "chute_perdue" : "deplacee");
  return etats;
}

// Ce qui a changé dans un plan, en une ligne.
function changementsDuPlan(c, deplacements) {
  const morceaux = [];
  if (!c.avant) morceaux.push("nouveau plan");
  if (!c.apres) morceaux.push("plan supprimé dans le fichier modifié");
  if (c.panneauChange) morceaux.push(`panneau changé : ${c.avant.nom} → ${c.apres.nom}`);
  if (c.avant && c.apres && c.avant.fois !== c.apres.fois) morceaux.push(`coupé ${c.apres.fois} fois au lieu de ${c.avant.fois}`);
  const nom = (r) => (r.cle && !MOTIF_NOYAU_PLAN.test(r.nom) && !MOTIF_STRATIFIE_PLAN.test(r.nom) ? r.cle : nomMorceauPlan(r));
  for (const idx of c.ajoutes) {
    const r = c.apres.rects[idx];
    if (r.chute) morceaux.push(`nouvelle chute gardée ${dimsPlan(r.L, r.W)}`);
    else {
      const de = r.cle && deplacements.get(r.cle) ? deplacements.get(r.cle).de : null;
      morceaux.push(`<span class="pl-plus">+ ${echapper(nom(r))}</span> (${echapper(r.article || "")} ${dimsPlan(r.fini[0], r.fini[1])})${de ? ` venue du Pdc ${de.pdc}${de.mat !== c.mat ? ` · ${echapper(de.mat)}` : ""}` : ""}`);
    }
  }
  for (const idx of c.partis) {
    const r = c.avant.rects[idx];
    if (r.chute) morceaux.push(`la chute ${dimsPlan(r.L, r.W)} n'est plus gardée`);
    else {
      const vers = r.cle && deplacements.get(r.cle) ? deplacements.get(r.cle).vers : null;
      morceaux.push(`<span class="pl-moins">− ${echapper(nom(r))}</span> ${vers ? `partie sur le Pdc ${vers.pdc}${vers.mat !== c.mat ? ` · ${echapper(vers.mat)}` : ""}` : "plus dans aucun plan"}`);
    }
  }
  return morceaux.map((t) => (t.includes("<span") ? t : echapper(t))).join(" · ");
}

function afficherPlansModifies() {
  const zone = $("zonePlansModifies");
  const m = etatPlans.modif;
  if (!zone || !m) return;
  if (m.autreLancement) {
    zone.innerHTML = `<div class="message-alerte">Ce n'est pas le même lancement : ${echapper(m.avant.lancement)} et ${echapper(m.apres.lancement)} (${echapper(m.fichier.name)}).</div>`;
    return;
  }
  const c = m.comparaison;
  const total = m.avant.nbPlans + m.avant.nbModules;
  if (!c.changes.length) {
    zone.innerHTML = `<div class="pl-puces"><span class="pl-puce bon">✔ Aucun plan changé sur ${total}</span></div><div class="note">${echapper(m.fichier.name)} : mêmes plans que l'optimisation.</div>`;
    return;
  }
  const deplacees = [...c.deplacements.values()].filter((x) => x.de && x.vers).length;
  const chutes = c.changes.reduce((t, x) => t + x.partis.filter((i) => x.avant.rects[i].chute).length - x.ajoutes.filter((i) => x.apres.rects[i].chute).length, 0);
  const valide = lireValidationsPlans()[cleModification(m)];
  const pieces = m.controle
    ? m.controle.nonPlacees.length
      ? `<div class="message-alerte">⚠ ${m.controle.nonPlacees.length} pièce(s) du lancement dans aucun plan du fichier modifié : ${m.controle.nonPlacees.map((n) => echapper(n.cle)).join(", ")}.</div>`
      : '<div class="note">Toutes les pièces du lancement restent placées (contrôle refait sur le fichier modifié).</div>'
    : "";
  zone.innerHTML = `
    <div class="note" style="margin-top:8px">${echapper(etatPlans.source.bkp.name)} (optimisation) comparé à ${echapper(m.fichier.name)} (modifié).</div>
    <div class="pl-puces">
      <span class="pl-puce att">${c.changes.length} plan(s) changé(s) sur ${total}</span>
      ${deplacees ? `<span class="pl-puce">${deplacees} pièce(s) déplacée(s)</span>` : ""}
      ${chutes > 0 ? `<span class="pl-puce att">${chutes} chute(s) gardée(s) en moins</span>` : chutes < 0 ? `<span class="pl-puce">${-chutes} chute(s) gardée(s) en plus</span>` : ""}
      ${c.perdues.length ? `<span class="pl-puce alerte">⚠ ${c.perdues.length} pièce(s) perdue(s)</span>` : '<span class="pl-puce bon">✔ aucune pièce perdue</span>'}
    </div>
    <div class="defilement"><table class="fp-table"><thead><tr><th>Plan</th><th>Ce qui a changé</th></tr></thead><tbody>${c.changes
      .map((x) => `<tr><td style="white-space:nowrap"><strong>Pdc ${x.pdc}</strong> · ${echapper(x.mat)}</td><td>${changementsDuPlan(x, c.deplacements)}</td></tr>`)
      .join("")}</tbody></table></div>
    <div class="pl-legende"><span><i style="background:#c8e6c9;border-color:#2e7d32"></i>pièce ajoutée</span><span><i style="background:#fde2df;border-color:#c62828"></i>pièce qui part sur un autre plan</span>
      <span><i style="background:#fff;border-color:#c62828;border-style:dashed"></i>place laissée vide</span><span><i style="background:#ffe082;border-color:#c98a00"></i>chute gardée qui disparaît</span></div>
    ${c.changes
      .map((x, i) => {
        const ap = planApresAffiche(x, c.deplacements);
        const ref = x.apres || x.avant;
        return `<div class="pl-change-titre">Pdc ${x.pdc} · ${echapper(x.mat)} <span class="pl-pdc">${echapper(ref.module ? `module ${ref.nom}` : `${ref.nom} · ${dimsPlan(ref.L, ref.W)}`)}</span></div>
          <div class="pl-avap" data-change="${i}">
            <div><div class="lab">Avant — optimisation</div>${x.avant ? svgPlan(x.avant, { etats: etatsAvant(x), modules: x.avant.module ? null : m.avant.modules }) : '<div class="note">Pas de plan.</div>'}</div>
            <div><div class="lab">Après — fichier modifié</div>${ap.plan ? svgPlan(ap.plan, { etats: ap.etats, textes: ap.textes, modules: ap.plan.module ? null : m.apres.modules }) : '<div class="note">Plan supprimé.</div>'}</div>
          </div>`;
      })
      .join("")}
    ${pieces}
    <div class="pl-boutons" style="justify-content:flex-start">
      ${valide ? `<span class="pl-puce bon">✔ Modification validée le ${new Date(valide).toLocaleDateString("fr-FR")}</span><button type="button" class="texte" id="btnAnnulerModif">Annuler la validation</button>`
        : '<button type="button" id="btnValiderModif">✔ Valider la modification</button>'}
      <button type="button" class="contour" id="btnImprimerModif">Imprimer avant / après (PDF)</button>
    </div>`;
  const valider = (oui) => {
    const v = lireValidationsPlans();
    if (oui) v[cleModification(m)] = new Date().toISOString();
    else delete v[cleModification(m)];
    try {
      localStorage.setItem(CLE_PLANS_VALIDES, JSON.stringify(v));
    } catch (_e) {
      // stockage indisponible
    }
    afficherPlansModifies();
  };
  if ($("btnValiderModif")) $("btnValiderModif").addEventListener("click", () => valider(true));
  if ($("btnAnnulerModif")) $("btnAnnulerModif").addEventListener("click", () => valider(false));
  $("btnImprimerModif").addEventListener("click", () => {
    const plans = [];
    for (const x of c.changes) {
      const ap = planApresAffiche(x, c.deplacements);
      const legende = changementsDuPlan(x, c.deplacements).replace(/<[^>]+>/g, "");
      if (x.avant) plans.push({ plan: x.avant, donnees: m.avant, etats: etatsAvant(x), titre: `Pdc ${x.pdc} · ${x.mat} — AVANT (optimisation)`, badge: `Pdc ${x.pdc}`, sous: `${x.avant.sorte} ${x.avant.nom} · ${dimsPlan(x.avant.L, x.avant.W)}`, legende: couperTextePdf(legende, RAPPORT_UTILE, 7.5, POLICE.GRAS)[0] });
      if (ap.plan) plans.push({ plan: ap.plan, donnees: m.apres, etats: ap.etats, textes: ap.textes, titre: `Pdc ${x.pdc} · ${x.mat} — APRÈS (fichier modifié)`, badge: `Pdc ${x.pdc}`, sous: `${ap.plan.sorte} ${ap.plan.nom} · ${dimsPlan(ap.plan.L, ap.plan.W)}` });
    }
    const octets = pdfPlansDeCoupe({
      surtitre: `Plans modifiés · lancement ${m.avant.lancement}`,
      titre: `${c.changes.length} plan(s) changé(s) sur ${total}`,
      lignes: [`Avant : ${etatPlans.source.bkp.name} · après : ${m.fichier.name}`, c.perdues.length ? `${c.perdues.length} pièce(s) perdue(s)` : "Aucune pièce perdue"],
      note: "Vert : pièce ajoutée. Rouge hachuré : pièce qui part sur un autre plan. Pointillés rouges : place laissée vide. Jaune hachuré : chute gardée qui disparaît.",
      plans,
      document: `Plans modifiés ${m.avant.lancement}`,
    });
    telecharger(`Plans_modifies_${m.avant.lancement}.pdf`, octets, "application/pdf");
  });
}
