"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const STORAGE_KEY = "planTravailSchema:v1";

const SHAPE_LABELS = { droit: "Droit", L: "En L", U: "En U" };

const SEGMENT_FIELDS = {
  droit: [
    { key: "L", label: "Longueur" },
    { key: "D", label: "Profondeur" },
  ],
  L: [
    { key: "La", label: "Longueur bras A" },
    { key: "Da", label: "Profondeur bras A" },
    { key: "Lb", label: "Longueur bras B" },
    { key: "Db", label: "Profondeur bras B" },
  ],
  U: [
    { key: "Ll", label: "Longueur bras gauche" },
    { key: "Dl", label: "Profondeur bras gauche" },
    { key: "Lf", label: "Longueur du fond" },
    { key: "Df", label: "Profondeur du fond" },
    { key: "Lr", label: "Longueur bras droit" },
    { key: "Dr", label: "Profondeur bras droit" },
  ],
};

const CUTOUT_TYPES = [
  { value: "evier", label: "Évier" },
  { value: "plaque", label: "Plaque de cuisson" },
  { value: "autre", label: "Autre" },
];

function defaultState() {
  return {
    client: { nom: "", adresse: "", reference: "", date: "" },
    forme: "droit",
    segments: {
      droit: { L: 3000, D: 600 },
      L: { La: 3000, Da: 600, Lb: 2000, Db: 600 },
      U: { Ll: 2000, Dl: 600, Lf: 3000, Df: 600, Lr: 2000, Dr: 600 },
    },
    walls: {},
    epaisseur: 38,
    materiau: "",
    chant: "",
    uniteAffichage: "mm",
    decoupes: [],
    notes: "",
  };
}

function mergeState(parsed) {
  const base = defaultState();
  return {
    ...base,
    ...parsed,
    client: { ...base.client, ...(parsed.client || {}) },
    segments: {
      droit: { ...base.segments.droit, ...((parsed.segments || {}).droit || {}) },
      L: { ...base.segments.L, ...((parsed.segments || {}).L || {}) },
      U: { ...base.segments.U, ...((parsed.segments || {}).U || {}) },
    },
    walls: { ...(parsed.walls || {}) },
    decoupes: Array.isArray(parsed.decoupes) ? parsed.decoupes : [],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return mergeState(JSON.parse(raw));
  } catch (err) {
    console.warn("Impossible de restaurer la dernière session :", err);
    return defaultState();
  }
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("Impossible d'enregistrer automatiquement :", err);
  }
}

let state = loadState();
let cutoutSeq = 0;
let refObjectUrl = null;

function byId(id) { return document.getElementById(id); }

function edgeDesc(p1, p2, kind, id, label) {
  return { p1, p2, kind, id, label, defaultWall: kind === "wall" };
}

// Toutes les formes sont des polygones rectilignes tracés dans le sens horaire
// (repère écran, y vers le bas) : la normale sortante d'une arête de direction
// (dx,dy) est (dy,-dx). Cette convention est utilisée pour placer les lignes
// de cote et les hachures de mur vers l'extérieur de la matière.
function computeGeometry(s) {
  const seg = s.segments[s.forme];

  if (s.forme === "droit") {
    const { L, D } = seg;
    if (!(L > 0 && D > 0)) return { error: "Renseignez une longueur et une profondeur supérieures à zéro." };
    const p = [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: D }, { x: 0, y: D }];
    return {
      polygon: p,
      arms: [{ id: "a", label: "Segment", origin: { x: 0, y: 0 }, length: L, depth: D, lengthAxis: "x", lengthSign: 1, depthAxis: "y", depthSign: 1 }],
      edges: [
        edgeDesc(p[0], p[1], "wall", "fond", "Fond"),
        edgeDesc(p[1], p[2], "end", "extDroite", "Extrémité droite"),
        edgeDesc(p[2], p[3], "front", "frontA", "Avant"),
        edgeDesc(p[3], p[0], "end", "extGauche", "Extrémité gauche"),
      ],
    };
  }

  if (s.forme === "L") {
    const { La, Da, Lb, Db } = seg;
    if (!(La > 0 && Da > 0 && Lb > 0 && Db > 0)) return { error: "Toutes les cotes doivent être supérieures à zéro." };
    if (!(La > Db && Lb > Da)) {
      return { error: "Pour former un L valide : la longueur du bras A doit dépasser la profondeur du bras B, et la longueur du bras B doit dépasser la profondeur du bras A." };
    }
    const p = [
      { x: 0, y: 0 }, { x: La, y: 0 }, { x: La, y: Da }, { x: Db, y: Da }, { x: Db, y: Lb }, { x: 0, y: Lb },
    ];
    return {
      polygon: p,
      arms: [
        { id: "a", label: "Bras A", origin: { x: 0, y: 0 }, length: La, depth: Da, lengthAxis: "x", lengthSign: 1, depthAxis: "y", depthSign: 1 },
        { id: "b", label: "Bras B", origin: { x: 0, y: 0 }, length: Lb, depth: Db, lengthAxis: "y", lengthSign: 1, depthAxis: "x", depthSign: 1 },
      ],
      edges: [
        edgeDesc(p[0], p[1], "wall", "mursA", "Mur bras A"),
        edgeDesc(p[1], p[2], "end", "extA", "Extrémité bras A"),
        edgeDesc(p[2], p[3], "front", "frontA", "Avant bras A"),
        edgeDesc(p[3], p[4], "front", "frontB", "Avant bras B"),
        edgeDesc(p[4], p[5], "end", "extB", "Extrémité bras B"),
        edgeDesc(p[5], p[0], "wall", "mursB", "Mur bras B"),
      ],
    };
  }

  if (s.forme === "U") {
    const { Ll, Dl, Lf, Df, Lr, Dr } = seg;
    if (!(Ll > 0 && Dl > 0 && Lf > 0 && Df > 0 && Lr > 0 && Dr > 0)) return { error: "Toutes les cotes doivent être supérieures à zéro." };
    const W = Lf;
    if (!(Ll > Df && Lr > Df && W > Dl + Dr)) {
      return { error: "Vérifiez les cotes : chaque bras doit être plus long que la profondeur du fond, et la longueur du fond doit dépasser la somme des profondeurs des deux bras." };
    }
    const p = [
      { x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: Lr }, { x: W - Dr, y: Lr },
      { x: W - Dr, y: Df }, { x: Dl, y: Df }, { x: Dl, y: Ll }, { x: 0, y: Ll },
    ];
    return {
      polygon: p,
      arms: [
        { id: "g", label: "Bras gauche", origin: { x: 0, y: 0 }, length: Ll, depth: Dl, lengthAxis: "y", lengthSign: 1, depthAxis: "x", depthSign: 1 },
        { id: "f", label: "Fond", origin: { x: 0, y: 0 }, length: Lf, depth: Df, lengthAxis: "x", lengthSign: 1, depthAxis: "y", depthSign: 1 },
        { id: "d", label: "Bras droit", origin: { x: W, y: 0 }, length: Lr, depth: Dr, lengthAxis: "y", lengthSign: 1, depthAxis: "x", depthSign: -1 },
      ],
      edges: [
        edgeDesc(p[0], p[1], "wall", "mursFond", "Mur du fond"),
        edgeDesc(p[1], p[2], "wall", "mursDroit", "Mur bras droit"),
        edgeDesc(p[2], p[3], "end", "extDroit", "Extrémité bras droit"),
        edgeDesc(p[3], p[4], "front", "frontD", "Avant bras droit"),
        edgeDesc(p[4], p[5], "front", "frontF", "Avant du fond"),
        edgeDesc(p[5], p[6], "front", "frontG", "Avant bras gauche"),
        edgeDesc(p[6], p[7], "end", "extGauche", "Extrémité bras gauche"),
        edgeDesc(p[7], p[0], "wall", "mursGauche", "Mur bras gauche"),
      ],
    };
  }

  return { error: "Forme inconnue." };
}

function cutoutRect(arm, c) {
  const along0 = Number(c.along) || 0;
  const along1 = along0 + (Number(c.longueur) || 0);
  const across0 = Number(c.across) || 0;
  const across1 = across0 + (Number(c.profondeur) || 0);
  let x0, x1, y0, y1;
  if (arm.lengthAxis === "x") {
    x0 = arm.origin.x + arm.lengthSign * along0;
    x1 = arm.origin.x + arm.lengthSign * along1;
    y0 = arm.origin.y + arm.depthSign * across0;
    y1 = arm.origin.y + arm.depthSign * across1;
  } else {
    y0 = arm.origin.y + arm.lengthSign * along0;
    y1 = arm.origin.y + arm.lengthSign * along1;
    x0 = arm.origin.x + arm.depthSign * across0;
    x1 = arm.origin.x + arm.depthSign * across1;
  }
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

function cutoutTypeLabel(type) {
  const found = CUTOUT_TYPES.find((t) => t.value === type);
  return found ? found.label : "Découpe";
}

function formatLength(mm, unite) {
  const v = Math.round(mm);
  if (unite === "cm") return (v / 10).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " cm";
  return v.toLocaleString("fr-FR") + " mm";
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function drawWallHatch(svg, p1, p2, strokeW, maxDim) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const ux = dx / len, uy = dy / len;
  const nx = uy, ny = -ux;
  const step = Math.max(maxDim * 0.035, strokeW * 8);
  const count = Math.max(2, Math.round(len / step));
  const hatchLen = (len / count) * 0.85;
  const group = svgEl("g", { stroke: "#1c2733", "stroke-width": strokeW * 0.5 });
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) * (len / count);
    const bx = p1.x + ux * t, by = p1.y + uy * t;
    group.appendChild(svgEl("line", {
      x1: bx, y1: by,
      x2: bx - nx * hatchLen + ux * hatchLen * 0.5,
      y2: by - ny * hatchLen + uy * hatchLen * 0.5,
    }));
  }
  svg.appendChild(group);
}

function drawDimension(svg, p1, p2, offset, strokeW, fontSize, unite) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const ux = dx / len, uy = dy / len;
  const nx = uy, ny = -ux;

  const o1 = { x: p1.x + nx * offset, y: p1.y + ny * offset };
  const o2 = { x: p2.x + nx * offset, y: p2.y + ny * offset };

  const group = svgEl("g", { stroke: "#5b6b7c", "stroke-width": strokeW });
  group.appendChild(svgEl("line", { x1: p1.x, y1: p1.y, x2: o1.x, y2: o1.y }));
  group.appendChild(svgEl("line", { x1: p2.x, y1: p2.y, x2: o2.x, y2: o2.y }));
  group.appendChild(svgEl("line", { x1: o1.x, y1: o1.y, x2: o2.x, y2: o2.y }));

  const tick = offset * 0.16;
  [o1, o2].forEach((pt) => {
    group.appendChild(svgEl("line", {
      x1: pt.x - nx * tick - ux * tick, y1: pt.y - ny * tick - uy * tick,
      x2: pt.x + nx * tick + ux * tick, y2: pt.y + ny * tick + uy * tick,
    }));
  });
  svg.appendChild(group);

  const mid = { x: (o1.x + o2.x) / 2, y: (o1.y + o2.y) / 2 };
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle > 90 || angle < -90) angle += 180;
  const tx = mid.x + nx * fontSize * 1.1;
  const ty = mid.y + ny * fontSize * 1.1;

  const text = svgEl("text", {
    x: tx, y: ty, "font-size": fontSize, fill: "#1c2733",
    "text-anchor": "middle", "dominant-baseline": "middle",
    transform: `rotate(${angle} ${tx} ${ty})`,
    "font-family": "Arial, sans-serif",
  });
  text.textContent = formatLength(len, unite);
  svg.appendChild(text);
}

function renderSVG() {
  const svg = byId("schemaSvg");
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const errBox = byId("schemaError");

  const geo = computeGeometry(state);
  if (geo.error) {
    errBox.textContent = geo.error;
    errBox.hidden = false;
    svg.removeAttribute("viewBox");
    return geo;
  }
  errBox.hidden = true;

  const xs = geo.polygon.map((p) => p.x);
  const ys = geo.polygon.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const maxDim = Math.max(w, h);

  const strokeMain = maxDim * 0.006;
  const strokeFront = strokeMain * 1.8;
  const strokeDim = Math.max(maxDim * 0.0018, 0.6);
  const fontSize = maxDim * 0.026;
  const dimOffset = maxDim * 0.11;
  const margin = maxDim * 0.24;

  svg.setAttribute("viewBox", `${minX - margin} ${minY - margin} ${w + margin * 2} ${h + margin * 2}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  svg.appendChild(svgEl("polygon", {
    points: geo.polygon.map((p) => `${p.x},${p.y}`).join(" "),
    fill: "#e8edf3", stroke: "none",
  }));

  for (const e of geo.edges) {
    const isFront = e.kind === "front";
    const wallOn = state.walls[e.id] ?? e.defaultWall;
    svg.appendChild(svgEl("line", {
      x1: e.p1.x, y1: e.p1.y, x2: e.p2.x, y2: e.p2.y,
      stroke: "#1c2733",
      "stroke-width": isFront ? strokeFront : strokeMain,
      "stroke-linecap": "square",
    }));
    if (e.kind === "wall" && wallOn) drawWallHatch(svg, e.p1, e.p2, strokeMain, maxDim);
    drawDimension(svg, e.p1, e.p2, dimOffset, strokeDim, fontSize, state.uniteAffichage);
  }

  for (const c of state.decoupes) {
    const arm = geo.arms.find((a) => a.id === c.segment) || geo.arms[0];
    const rect = cutoutRect(arm, c);
    if (rect.w <= 0 || rect.h <= 0) continue;
    svg.appendChild(svgEl("rect", {
      x: rect.x, y: rect.y, width: rect.w, height: rect.h,
      fill: "#ffffff", stroke: "#b5321f",
      "stroke-width": strokeDim * 2,
      "stroke-dasharray": `${strokeDim * 4},${strokeDim * 2.5}`,
    }));
    const label = svgEl("text", {
      x: rect.x + rect.w / 2, y: rect.y + rect.h / 2,
      "font-size": Math.max(fontSize * 0.8, 4), fill: "#b5321f",
      "text-anchor": "middle", "dominant-baseline": "middle",
      "font-family": "Arial, sans-serif",
    });
    label.textContent = c.label && c.label.trim() ? c.label : cutoutTypeLabel(c.type);
    svg.appendChild(label);
  }

  return geo;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function updateHeaderDisplay() {
  const el = byId("schemaHeader");
  const c = state.client;
  const parts = [
    ["Client", c.nom || "—"],
    ["Chantier", c.adresse || "—"],
    ["Référence", c.reference || "—"],
    ["Date", c.date || "—"],
    ["Forme", SHAPE_LABELS[state.forme]],
    ["Épaisseur", `${state.epaisseur || 0} mm`],
    ["Matériau", state.materiau || "—"],
    ["Chant", state.chant || "—"],
  ];
  el.innerHTML = parts.map(([k, v]) => `<div class="block"><strong>${k}</strong>${escapeHtml(String(v))}</div>`).join("");
  if (state.notes && state.notes.trim()) {
    const notesDiv = document.createElement("div");
    notesDiv.className = "block";
    notesDiv.style.flexBasis = "100%";
    notesDiv.innerHTML = `<strong>Notes</strong>${escapeHtml(state.notes)}`;
    el.appendChild(notesDiv);
  }
}

function rerender() {
  persistState();
  updateHeaderDisplay();
  renderSVG();
}

function renderSegmentFields() {
  const container = byId("segmentsFields");
  container.innerHTML = "";
  for (const f of SEGMENT_FIELDS[state.forme]) {
    const label = document.createElement("label");
    label.textContent = f.label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.step = "10";
    input.value = state.segments[state.forme][f.key];
    input.addEventListener("input", () => {
      state.segments[state.forme][f.key] = parseFloat(input.value) || 0;
      rerender();
    });
    label.appendChild(input);
    container.appendChild(label);
  }
}

function renderWallFields() {
  const container = byId("wallsFields");
  container.innerHTML = "";
  const geo = computeGeometry(state);
  if (geo.error || !geo.edges) return;
  for (const e of geo.edges.filter((edge) => edge.kind !== "front")) {
    const label = document.createElement("label");
    label.style.display = "flex";
    label.style.alignItems = "center";
    label.style.gap = "6px";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.walls[e.id] ?? e.defaultWall;
    input.addEventListener("change", () => {
      state.walls[e.id] = input.checked;
      rerender();
    });
    label.appendChild(input);
    label.appendChild(document.createTextNode(e.label));
    container.appendChild(label);
  }
}

function makeSelect(options, value, onChange, ariaLabel) {
  const select = document.createElement("select");
  if (ariaLabel) select.setAttribute("aria-label", ariaLabel);
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function makeNumberField(labelText, value, onChange) {
  const label = document.createElement("label");
  label.style.flex = "1";
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "10";
  input.value = value;
  input.addEventListener("input", () => onChange(parseFloat(input.value) || 0));
  label.appendChild(input);
  return label;
}

function makeTextField(labelText, value, onChange) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.addEventListener("input", () => onChange(input.value));
  label.appendChild(input);
  return label;
}

function renderDecoupesList() {
  const container = byId("decoupesList");
  container.innerHTML = "";
  const geo = computeGeometry(state);
  const arms = geo.arms || [];

  state.decoupes.forEach((c) => {
    const row = document.createElement("div");
    row.className = "decoupe-row";

    const row1 = document.createElement("div");
    row1.className = "field-row";
    row1.appendChild(makeSelect(CUTOUT_TYPES, c.type, (v) => { c.type = v; rerender(); }, "Type de découpe"));
    row1.appendChild(makeSelect(
      arms.map((a) => ({ value: a.id, label: a.label })),
      arms.some((a) => a.id === c.segment) ? c.segment : (arms[0] && arms[0].id),
      (v) => { c.segment = v; rerender(); },
      "Segment"
    ));
    row.appendChild(row1);

    const row2 = document.createElement("div");
    row2.className = "field-row";
    row2.appendChild(makeNumberField("Depuis début segment (mm)", c.along, (v) => { c.along = v; rerender(); }));
    row2.appendChild(makeNumberField("Depuis le mur (mm)", c.across, (v) => { c.across = v; rerender(); }));
    row.appendChild(row2);

    const row3 = document.createElement("div");
    row3.className = "field-row";
    row3.appendChild(makeNumberField("Largeur découpe (mm)", c.longueur, (v) => { c.longueur = v; rerender(); }));
    row3.appendChild(makeNumberField("Profondeur découpe (mm)", c.profondeur, (v) => { c.profondeur = v; rerender(); }));
    row.appendChild(row3);

    const row4 = document.createElement("div");
    row4.className = "field-row";
    const labelField = makeTextField("Étiquette (optionnel)", c.label, (v) => { c.label = v; rerender(); });
    labelField.style.flex = "1";
    row4.appendChild(labelField);
    row.appendChild(row4);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Supprimer";
    del.addEventListener("click", () => {
      state.decoupes = state.decoupes.filter((x) => x.id !== c.id);
      renderDecoupesList();
      rerender();
    });
    actions.appendChild(del);
    row.appendChild(actions);

    container.appendChild(row);
  });
}

function addDecoupe() {
  const geo = computeGeometry(state);
  const firstArm = geo.arms && geo.arms[0];
  cutoutSeq += 1;
  state.decoupes.push({
    id: `c${Date.now()}_${cutoutSeq}`,
    type: "evier",
    label: "",
    segment: firstArm ? firstArm.id : "a",
    along: 200,
    across: 50,
    longueur: 800,
    profondeur: 500,
  });
  renderDecoupesList();
  rerender();
}

function syncStaticFieldsFromState() {
  byId("clientNom").value = state.client.nom || "";
  byId("clientAdresse").value = state.client.adresse || "";
  byId("reference").value = state.client.reference || "";
  byId("dateProjet").value = state.client.date || "";
  byId("epaisseur").value = state.epaisseur;
  byId("uniteAffichage").value = state.uniteAffichage;
  byId("materiau").value = state.materiau || "";
  byId("chant").value = state.chant || "";
  byId("notes").value = state.notes || "";
  document.querySelectorAll('input[name="forme"]').forEach((r) => { r.checked = r.value === state.forme; });
}

function bindClientFieldListeners() {
  byId("clientNom").addEventListener("input", (e) => { state.client.nom = e.target.value; rerender(); });
  byId("clientAdresse").addEventListener("input", (e) => { state.client.adresse = e.target.value; rerender(); });
  byId("reference").addEventListener("input", (e) => { state.client.reference = e.target.value; rerender(); });
  byId("dateProjet").addEventListener("input", (e) => { state.client.date = e.target.value; rerender(); });
}

function bindMaterialFieldListeners() {
  byId("epaisseur").addEventListener("input", (e) => { state.epaisseur = parseFloat(e.target.value) || 0; rerender(); });
  byId("uniteAffichage").addEventListener("change", (e) => { state.uniteAffichage = e.target.value; rerender(); });
  byId("materiau").addEventListener("input", (e) => { state.materiau = e.target.value; rerender(); });
  byId("chant").addEventListener("input", (e) => { state.chant = e.target.value; rerender(); });
  byId("notes").addEventListener("input", (e) => { state.notes = e.target.value; rerender(); });
}

function bindShapeChoiceListeners() {
  document.querySelectorAll('input[name="forme"]').forEach((r) => {
    r.addEventListener("change", () => {
      if (!r.checked) return;
      state.forme = r.value;
      renderSegmentFields();
      renderWallFields();
      renderDecoupesList();
      rerender();
    });
  });
}

function bindRefFileListener() {
  const input = byId("refFile");
  const preview = byId("refPreview");
  input.addEventListener("change", () => {
    if (refObjectUrl) { URL.revokeObjectURL(refObjectUrl); refObjectUrl = null; }
    preview.innerHTML = "";
    const file = input.files && input.files[0];
    if (!file) { preview.hidden = true; return; }
    refObjectUrl = URL.createObjectURL(file);
    if (file.type === "application/pdf") {
      const embed = document.createElement("embed");
      embed.src = refObjectUrl;
      embed.type = "application/pdf";
      embed.style.width = "100%";
      embed.style.height = "200px";
      preview.appendChild(embed);
    } else {
      const img = document.createElement("img");
      img.src = refObjectUrl;
      img.alt = "Plan reçu du client";
      preview.appendChild(img);
    }
    preview.hidden = false;
  });
}

function exportFilename(ext) {
  const base = (state.client.nom || "plan-de-travail").trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "plan-de-travail";
  const date = state.client.date || new Date().toISOString().slice(0, 10);
  return `${base}_${date}.${ext}`;
}

function exportPng() {
  const svg = byId("schemaSvg");
  if (!svg.hasAttribute("viewBox")) {
    alert("Corrigez les cotes avant d'exporter : le schéma n'est pas valide.");
    return;
  }
  const vb = svg.viewBox.baseVal;
  const outW = 1600;
  const outH = Math.round(outW * (vb.height / vb.width));
  const clone = svg.cloneNode(true);
  clone.setAttribute("width", outW);
  clone.setAttribute("height", outH);
  const xml = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const headerH = 110;
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = outW * scale;
    canvas.height = (outH + headerH) * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outW, outH + headerH);
    ctx.fillStyle = "#1c2733";
    ctx.font = "bold 22px Arial, sans-serif";
    const c = state.client;
    ctx.fillText(`Client : ${c.nom || "—"}    Chantier : ${c.adresse || "—"}`, 20, 30);
    ctx.font = "16px Arial, sans-serif";
    ctx.fillText(`Réf : ${c.reference || "—"}    Date : ${c.date || "—"}    Forme : ${SHAPE_LABELS[state.forme]}`, 20, 56);
    ctx.fillText(`Épaisseur : ${state.epaisseur || 0} mm    Matériau : ${state.materiau || "—"}    Chant : ${state.chant || "—"}`, 20, 80);
    ctx.drawImage(img, 0, headerH, outW, outH);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      link.download = exportFilename("png");
      link.href = URL.createObjectURL(blob);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    });
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert("Export impossible. Réessayez après avoir vérifié les cotes.");
  };
  img.src = url;
}

function saveJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.download = exportFilename("json");
  link.href = URL.createObjectURL(blob);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

function loadJsonFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state = mergeState(JSON.parse(String(reader.result)));
      initForm();
      rerender();
    } catch (err) {
      alert("Fichier JSON invalide : " + err.message);
    }
  };
  reader.readAsText(file);
}

function initForm() {
  syncStaticFieldsFromState();
  renderSegmentFields();
  renderWallFields();
  renderDecoupesList();
}

function wireActionsOnce() {
  byId("btnAddDecoupe").addEventListener("click", addDecoupe);
  byId("btnPng").addEventListener("click", exportPng);
  byId("btnPrint").addEventListener("click", () => window.print());
  byId("btnSave").addEventListener("click", saveJson);
  const fileLoad = byId("fileLoad");
  byId("btnLoad").addEventListener("click", () => fileLoad.click());
  fileLoad.addEventListener("change", () => {
    const file = fileLoad.files && fileLoad.files[0];
    if (file) loadJsonFile(file);
    fileLoad.value = "";
  });
  byId("btnReset").addEventListener("click", () => {
    if (!confirm("Démarrer un nouveau plan ? Les cotes actuelles seront remplacées (pensez à exporter avant si besoin).")) return;
    state = defaultState();
    initForm();
    rerender();
  });
  bindRefFileListener();
}

document.addEventListener("DOMContentLoaded", () => {
  bindClientFieldListeners();
  bindShapeChoiceListeners();
  bindMaterialFieldListeners();
  wireActionsOnce();
  initForm();
  rerender();
});
