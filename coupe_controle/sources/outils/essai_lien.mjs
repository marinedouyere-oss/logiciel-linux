// Essai du mini-site : chiffre un fichier partagé avec un code, l'envoie, le relit, le déchiffre, compare.
// Usage : node essai_lien.mjs <adresse du site> <fichier .json.gz> [code]
import fs from "node:fs";
const [adresse, fichier, codeDonne] = process.argv.slice(2);
const { subtle } = globalThis.crypto;
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((o) => o.toString(16).padStart(2, "0")).join("");
const normaliser = (c) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = codeDonne || Array.from(crypto.getRandomValues(new Uint8Array(16)), (o) => ALPHABET[o % 32]).join("").replace(/(.{4})(?!$)/g, "$1-");
const n = normaliser(code);
const canal = hex(await subtle.digest("SHA-256", enc.encode("sentinelle-canal:" + n))).slice(0, 32);
const jeton = hex(await subtle.digest("SHA-256", enc.encode("sentinelle-ecriture:" + n)));
const base = await subtle.importKey("raw", enc.encode(n), "PBKDF2", false, ["deriveKey"]);
const cle = await subtle.deriveKey({ name: "PBKDF2", salt: enc.encode("sentinelle-laisne-industrie"), iterations: 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
const clair = fs.readFileSync(fichier);
const iv = crypto.getRandomValues(new Uint8Array(12));
const chiffre = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, cle, clair));
const paquet = new Uint8Array(4 + 12 + chiffre.length);
paquet.set(enc.encode("SNT1"), 0); paquet.set(iv, 4); paquet.set(chiffre, 16);
const version = Date.now().toString(36) + hex(crypto.getRandomValues(new Uint8Array(4)));
const TAILLE = 4 * 1024 * 1024;
const parties = Math.max(1, Math.ceil(paquet.length / TAILLE));
const api = `${adresse}/api/partage?canal=${canal}`;
for (let i = 0; i < parties; i++) {
  const r = await fetch(`${api}&version=${version}&partie=${i}`, { method: "PUT", headers: { "X-Sentinelle-Jeton": jeton, "Content-Type": "application/octet-stream" }, body: paquet.slice(i * TAILLE, (i + 1) * TAILLE) });
  console.log("PUT partie", i, r.status, await r.text());
}
let r = await fetch(api, { method: "POST", headers: { "X-Sentinelle-Jeton": jeton, "Content-Type": "application/json" }, body: JSON.stringify({ version, parties, taille: paquet.length, genere: new Date().toISOString() }) });
console.log("POST manifeste", r.status, await r.text());
// Un autre jeton ne peut pas écraser.
r = await fetch(api, { method: "POST", headers: { "X-Sentinelle-Jeton": "0".repeat(64), "Content-Type": "application/json" }, body: JSON.stringify({ version, parties, taille: 1 }) });
console.log("POST avec un autre jeton (attendu 403)", r.status);
// Lecture comme le téléphone.
const m = await (await fetch(api)).json();
console.log("manifeste", JSON.stringify(m));
const morceaux = [];
for (let i = 0; i < m.parties; i++) morceaux.push(new Uint8Array(await (await fetch(`${api}&version=${m.version}&partie=${i}`)).arrayBuffer()));
const recu = new Uint8Array(morceaux.reduce((t, x) => t + x.length, 0));
let k = 0; for (const x of morceaux) { recu.set(x, k); k += x.length; }
const dechiffre = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: recu.slice(4, 16) }, cle, recu.slice(16)));
console.log("identique :", Buffer.compare(Buffer.from(dechiffre), clair) === 0, "| taille", clair.length, "| code", code, "| canal", canal);
fs.writeFileSync(fichier + ".code.txt", code);
