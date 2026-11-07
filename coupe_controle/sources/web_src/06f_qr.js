// ---- QR code (pour relier le téléphone au PC d'un coup d'appareil photo) ----
// Générateur QR code « modèle 2 », correction M, versions 1 à 10, mode alphanumérique ou octets : de quoi écrire
// « SENTINELLE:ABCD-EFGH-JKLM-NPQR ». Tout est calculé ici (pas d'internet). Rendu en SVG.

const QR_ALPHANUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
// Correction M : codes de correction par bloc et nombre de blocs, versions 1 à 10.
const QR_ECC_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const QR_BLOCS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

function qrModulesBruts(v) {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const na = Math.floor(v / 7) + 2;
    n -= (25 * na - 10) * na - 55;
    if (v >= 7) n -= 36;
  }
  return n;
}
const qrOctetsDonnees = (v) => Math.floor(qrModulesBruts(v) / 8) - QR_ECC_M[v] * QR_BLOCS_M[v];

function qrMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function qrDiviseur(degre) {
  const r = new Array(degre).fill(0);
  r[degre - 1] = 1;
  let racine = 1;
  for (let i = 0; i < degre; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = qrMul(r[j], racine);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    racine = qrMul(racine, 0x02);
  }
  return r;
}
function qrReste(donnees, diviseur) {
  const r = diviseur.map(() => 0);
  for (const b of donnees) {
    const f = b ^ r.shift();
    r.push(0);
    diviseur.forEach((c, i) => (r[i] ^= qrMul(c, f)));
  }
  return r;
}

// Matrice du QR code : tableau de lignes de booléens (true = module noir).
function qrMatrice(texte) {
  const alnum = [...texte].every((c) => QR_ALPHANUM.includes(c));
  const octets = alnum ? null : [...new TextEncoder().encode(texte)];
  const longueur = alnum ? texte.length : octets.length;
  const bitsTaille = (v) => (alnum ? (v < 10 ? 9 : 11) : v < 10 ? 8 : 16);
  const bitsDonnees = (v) => 4 + bitsTaille(v) + (alnum ? 11 * Math.floor(longueur / 2) + 6 * (longueur % 2) : 8 * longueur);
  let v = 1;
  while (v <= 10 && bitsDonnees(v) > qrOctetsDonnees(v) * 8) v++;
  if (v > 10) throw new Error("texte trop long pour le QR code");
  const bits = [];
  const ajouter = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  ajouter(alnum ? 0b0010 : 0b0100, 4);
  ajouter(longueur, bitsTaille(v));
  if (alnum) {
    for (let i = 0; i + 1 < texte.length; i += 2) ajouter(QR_ALPHANUM.indexOf(texte[i]) * 45 + QR_ALPHANUM.indexOf(texte[i + 1]), 11);
    if (texte.length % 2) ajouter(QR_ALPHANUM.indexOf(texte[texte.length - 1]), 6);
  } else for (const b of octets) ajouter(b, 8);
  const capacite = qrOctetsDonnees(v) * 8;
  ajouter(0, Math.min(4, capacite - bits.length));
  ajouter(0, (8 - (bits.length % 8)) % 8);
  for (let p = 0xec; bits.length < capacite; p ^= 0xec ^ 0x11) ajouter(p, 8);
  const donnees = [];
  for (let i = 0; i < bits.length; i += 8) donnees.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Blocs, correction d'erreurs, entrelacement.
  const nbBlocs = QR_BLOCS_M[v];
  const ecc = QR_ECC_M[v];
  const brut = Math.floor(qrModulesBruts(v) / 8);
  const courts = nbBlocs - (brut % nbBlocs);
  const longCourt = Math.floor(brut / nbBlocs);
  const diviseur = qrDiviseur(ecc);
  const blocs = [];
  for (let i = 0, k = 0; i < nbBlocs; i++) {
    const d = donnees.slice(k, k + longCourt - ecc + (i < courts ? 0 : 1));
    k += d.length;
    const bloc = [...d, ...qrReste(d, diviseur)];
    if (i < courts) bloc.splice(d.length, 0, 0); // case vide : tous les blocs à la même longueur
    blocs.push(bloc);
  }
  const final = [];
  for (let i = 0; i < blocs[0].length; i++) blocs.forEach((b, j) => {
    if (i !== longCourt - ecc || j >= courts) final.push(b[i]);
  });

  // Motifs fixes.
  const n = v * 4 + 17;
  const m = Array.from({ length: n }, () => new Array(n).fill(false));
  const fixe = Array.from({ length: n }, () => new Array(n).fill(false));
  const poser = (x, y, noir) => {
    m[y][x] = noir;
    fixe[y][x] = true;
  };
  for (let i = 0; i < n; i++) {
    poser(6, i, i % 2 === 0);
    poser(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < n && y >= 0 && y < n) poser(x, y, Math.max(Math.abs(dx), Math.abs(dy)) !== 2 && Math.max(Math.abs(dx), Math.abs(dy)) !== 4);
      }
  if (v > 1) {
    const na = Math.floor(v / 7) + 2;
    const pas = Math.ceil((v * 4 + 4) / (na * 2 - 2)) * 2;
    const pos = [6];
    for (let p = n - 7; pos.length < na; p -= pas) pos.splice(1, 0, p);
    pos.forEach((x, i) =>
      pos.forEach((y, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) poser(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      })
    );
  }
  const format = (masque) => {
    const d = (0 << 3) | masque; // correction M = 00
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    const bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) poser(8, i, bit(i));
    poser(8, 7, bit(6));
    poser(8, 8, bit(7));
    poser(7, 8, bit(8));
    for (let i = 9; i < 15; i++) poser(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) poser(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) poser(8, n - 15 + i, bit(i));
    poser(8, n - 8, true);
  };
  format(0);
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) {
      const noir = ((b >>> i) & 1) === 1;
      poser(n - 11 + (i % 3), Math.floor(i / 3), noir);
      poser(Math.floor(i / 3), n - 11 + (i % 3), noir);
    }
  }

  // Données, en zigzag de droite à gauche.
  let k = 0;
  for (let droite = n - 1; droite >= 1; droite -= 2) {
    if (droite === 6) droite = 5;
    for (let vert = 0; vert < n; vert++)
      for (let j = 0; j < 2; j++) {
        const x = droite - j;
        const y = ((droite + 1) & 2) === 0 ? n - 1 - vert : vert;
        if (!fixe[y][x] && k < final.length * 8) {
          m[y][x] = ((final[k >>> 3] >>> (7 - (k & 7))) & 1) === 1;
          k++;
        }
      }
  }

  // Masque : celui qui donne le QR le plus facile à lire (pénalités de la norme).
  const masques = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const appliquer = (f) => {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fixe[y][x] && f(x, y)) m[y][x] = !m[y][x];
  };
  let meilleur = 0;
  let mini = Infinity;
  masques.forEach((f, i) => {
    appliquer(f);
    format(i);
    const p = qrPenalite(m);
    if (p < mini) {
      mini = p;
      meilleur = i;
    }
    appliquer(f); // annule
  });
  appliquer(masques[meilleur]);
  format(meilleur);
  return m;
}

function qrPenalite(m) {
  const n = m.length;
  let p = 0;
  let noirs = 0;
  const lignes = [];
  for (let y = 0; y < n; y++) lignes.push(m[y]);
  for (let x = 0; x < n; x++) lignes.push(m.map((l) => l[x]));
  const motif = [true, false, true, true, true, false, true];
  for (const l of lignes) {
    for (let i = 0, run = 1; i < n; i++) {
      run = i > 0 && l[i] === l[i - 1] ? run + 1 : 1;
      if (run === 5) p += 3;
      else if (run > 5) p += 1;
    }
    for (let i = 0; i + 7 <= n; i++) {
      if (!motif.every((b, j) => l[i + j] === b)) continue;
      const avant = i >= 4 && [1, 2, 3, 4].every((d) => !l[i - d]);
      const apres = i + 11 <= n && [7, 8, 9, 10].every((d) => !l[i + d]);
      if (avant || apres) p += 40;
    }
  }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (m[y][x]) noirs++;
      if (x + 1 < n && y + 1 < n && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    }
  p += Math.max(0, Math.ceil(Math.abs(noirs * 20 - n * n * 10) / (n * n)) - 1) * 10;
  return p;
}

// Le QR code en SVG (marge blanche de 4 modules, comme le veut la norme).
function qrSvg(texte, taillePx = 200) {
  const m = qrMatrice(texte);
  const n = m.length;
  const t = n + 8;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${x + 4},${y + 4}h1v1h-1z`;
  return `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" width="${taillePx}" height="${taillePx}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
