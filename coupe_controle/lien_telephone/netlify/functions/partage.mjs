// Sentinelle : le fichier partagé, CHIFFRÉ par le PC (AES-GCM, clé tirée du code de liaison que seuls le PC et le
// téléphone connaissent). Ce site ne peut pas le lire : il le garde et le rend.
//   GET  ?canal=…                       → le manifeste { version, parties, taille, genere }
//   GET  ?canal=…&version=…&partie=i    → une partie (octets)
//   PUT  ?canal=…&version=…&partie=i    → dépose une partie (en-tête X-Sentinelle-Jeton)
//   POST ?canal=…                       → publie le manifeste (en-tête X-Sentinelle-Jeton), efface l'ancienne version
// Le premier envoi d'un canal fixe son jeton d'écriture (empreinte gardée) : personne d'autre ne peut l'écraser.
import { getStore } from "@netlify/blobs";

const ENTETES = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Sentinelle-Jeton",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
};
const PARTIE_MAX = 5 * 1024 * 1024;
const PARTIES_MAX = 60;

const json = (objet, status = 200) => new Response(JSON.stringify(objet), { status, headers: { ...ENTETES, "Content-Type": "application/json" } });
const hex = (tampon) => [...new Uint8Array(tampon)].map((o) => o.toString(16).padStart(2, "0")).join("");
const empreinte = async (texte) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte)));
const versionValide = (v) => /^[a-z0-9]{6,40}$/.test(v || "");
const partieValide = (p) => /^\d{1,2}$/.test(p || "") && Number(p) < PARTIES_MAX;

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ENTETES });
  const url = new URL(req.url);
  const canal = url.searchParams.get("canal") || "";
  if (!/^[0-9a-f]{32}$/.test(canal)) return json({ erreur: "canal invalide" }, 400);
  const magasin = getStore({ name: "sentinelle", consistency: "strong" });
  const version = url.searchParams.get("version");
  const partie = url.searchParams.get("partie");

  if (req.method === "GET") {
    if (version === null) {
      const m = await magasin.get(`${canal}/manifeste`, { type: "json" });
      return m ? json(m) : json({ erreur: "rien pour ce code" }, 404);
    }
    if (!versionValide(version) || !partieValide(partie)) return json({ erreur: "demande invalide" }, 400);
    const octets = await magasin.get(`${canal}/${version}/${partie}`, { type: "arrayBuffer" });
    if (!octets) return json({ erreur: "partie absente" }, 404);
    return new Response(octets, { status: 200, headers: { ...ENTETES, "Content-Type": "application/octet-stream" } });
  }

  // Écriture : le jeton du canal (le premier envoi le fixe).
  const jeton = req.headers.get("x-sentinelle-jeton") || "";
  if (!/^[0-9a-f]{64}$/.test(jeton)) return json({ erreur: "jeton manquant" }, 403);
  const e = await empreinte(jeton);
  const acces = await magasin.get(`${canal}/acces`);
  if (acces && acces !== e) return json({ erreur: "jeton refusé" }, 403);
  if (!acces) await magasin.set(`${canal}/acces`, e);

  if (req.method === "PUT") {
    if (!versionValide(version) || !partieValide(partie)) return json({ erreur: "demande invalide" }, 400);
    const octets = await req.arrayBuffer();
    if (!octets.byteLength || octets.byteLength > PARTIE_MAX) return json({ erreur: "partie trop grosse ou vide" }, 413);
    await magasin.set(`${canal}/${version}/${partie}`, octets);
    return json({ ok: true });
  }

  if (req.method === "POST") {
    let m;
    try {
      m = await req.json();
    } catch (_e) {
      return json({ erreur: "manifeste illisible" }, 400);
    }
    if (!m || !versionValide(m.version) || !Number.isInteger(m.parties) || m.parties < 1 || m.parties > PARTIES_MAX) return json({ erreur: "manifeste invalide" }, 400);
    for (let i = 0; i < m.parties; i++) {
      const meta = await magasin.getMetadata(`${canal}/${m.version}/${i}`);
      if (!meta) return json({ erreur: `partie ${i} absente` }, 409);
    }
    const ancien = await magasin.get(`${canal}/manifeste`, { type: "json" });
    const nouveau = { version: m.version, parties: m.parties, taille: Number(m.taille) || 0, genere: String(m.genere || ""), recu: new Date().toISOString() };
    await magasin.setJSON(`${canal}/manifeste`, nouveau);
    if (ancien && ancien.version !== nouveau.version)
      for (let i = 0; i < (ancien.parties || 0); i++) await magasin.delete(`${canal}/${ancien.version}/${i}`);
    return json({ ok: true, ...nouveau });
  }
  return json({ erreur: "méthode" }, 405);
};

export const config = { path: "/api/partage" };
