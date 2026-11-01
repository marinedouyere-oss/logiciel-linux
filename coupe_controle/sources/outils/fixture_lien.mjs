// Paquet chiffré de référence (comme le PC) pour le test de l'appli : node fixture_lien.mjs <json> <code>
import fs from "node:fs"; import zlib from "node:zlib";
const [fichier, code] = process.argv.slice(2);
const { subtle } = globalThis.crypto; const enc = new TextEncoder();
const n = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
const base = await subtle.importKey("raw", enc.encode(n), "PBKDF2", false, ["deriveKey"]);
const cle = await subtle.deriveKey({ name: "PBKDF2", salt: enc.encode("sentinelle-laisne-industrie"), iterations: 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
const iv = crypto.getRandomValues(new Uint8Array(12));
const chiffre = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, cle, zlib.gzipSync(fs.readFileSync(fichier))));
const paquet = Buffer.concat([Buffer.from("SNT1"), Buffer.from(iv), Buffer.from(chiffre)]);
const hex = (b) => [...new Uint8Array(b)].map((o) => o.toString(16).padStart(2, "0")).join("");
console.log("CANAL", hex(await subtle.digest("SHA-256", enc.encode("sentinelle-canal:" + n))).slice(0, 32));
console.log("PAQUET", paquet.toString("base64"));
