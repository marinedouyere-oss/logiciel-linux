// Dans la WebView Android (APK), showDirectoryPicker n'existe pas : on
// passe alors par le pont natif AndroidDossierPartage (voir MainActivity.java),
// qui ouvre le sélecteur de dossier système d'Android (Storage Access
// Framework) — "Google Drive" y apparaît comme une source si l'appli Drive
// est installée et connectée sur l'appareil, exactement comme un dossier
// local.
function androidDossierPartageDisponible() {
  return typeof window.AndroidDossierPartage !== "undefined";
}

function scanPartageDisponible() {
  return typeof window.showDirectoryPicker === "function" || androidDossierPartageDisponible();
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// Construit un objet imitant un FileSystemDirectoryHandle (même forme que
// celui renvoyé par showDirectoryPicker : kind/name/entries()/queryPermission()/
// requestPermission()) à partir d'un dossier choisi côté natif Android, pour
// que scannerDossierPartage() fonctionne à l'identique sans distinguer les
// deux origines.
function creerPoigneeDossierAndroid(treeUri, nom) {
  return {
    kind: "directory",
    name: nom,
    async *entries() {
      const brut = window.AndroidDossierPartage.listerFichiers(treeUri);
      const fichiers = JSON.parse(brut || "[]");
      for (const f of fichiers) {
        yield [
          f.nom,
          {
            kind: "file",
            name: f.nom,
            async getFile() {
              const b64 = window.AndroidDossierPartage.lireFichierBase64(f.uri);
              return new File([b64ToBytes(b64)], f.nom, { lastModified: f.lastModified });
            },
          },
        ];
      }
    },
    async queryPermission() {
      return "granted";
    },
    async requestPermission() {
      return "granted";
    },
  };
}

// Mémorise la référence au dossier choisi (une "poignée" FileSystemHandle,
// clonable telle quelle dans IndexedDB) pour ne pas avoir à le rechoisir à
// chaque ouverture — le navigateur redemande juste une confirmation
// d'autorisation, sans reproposer l'Explorateur.
//
// Étanchéité totale entre les deux onglets semaine : un dossier partagé
// distinct par parité, mémorisé séparément, jamais partagé entre
// "Semaine paire" et "Semaine impaire".
const DB_DOSSIER_PARTAGE_NOM = "sentinelle-dossier-partage";
const MAGASIN_DOSSIER_PARTAGE = "poignee";
let dossierPartageHandles = { paire: null, impaire: null, paire2: null, impaire2: null };

function ouvrirBaseDossierPartage() {
  return new Promise((resolve, reject) => {
    const requete = indexedDB.open(DB_DOSSIER_PARTAGE_NOM, 1);
    requete.onupgradeneeded = () => requete.result.createObjectStore(MAGASIN_DOSSIER_PARTAGE);
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });
}

async function sauvegarderPoigneeDossierPartage(handle, parite) {
  try {
    const db = await ouvrirBaseDossierPartage();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(MAGASIN_DOSSIER_PARTAGE, "readwrite");
        tx.objectStore(MAGASIN_DOSSIER_PARTAGE).put(handle, `dossier-${parite}`);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch (_erreur) {
    // Mémorisation optionnelle : sans elle, il suffit de rechoisir le
    // dossier à la prochaine ouverture.
  }
}

async function chargerPoigneeDossierPartage(parite) {
  try {
    const db = await ouvrirBaseDossierPartage();
    try {
      return await new Promise((resolve, reject) => {
        const requete = db
          .transaction(MAGASIN_DOSSIER_PARTAGE, "readonly")
          .objectStore(MAGASIN_DOSSIER_PARTAGE)
          .get(`dossier-${parite}`);
        requete.onsuccess = () => resolve(requete.result || null);
        requete.onerror = () => reject(requete.error);
      });
    } finally {
      db.close();
    }
  } catch (_erreur) {
    return null;
  }
}

