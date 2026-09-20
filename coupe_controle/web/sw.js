// Service worker de Sentinelle : ne fonctionne que servi en http(s)/localhost
// (les navigateurs bloquent les service workers sur file://). Met en cache
// l'app shell pour un fonctionnement hors-ligne une fois installée, et sert
// le cache en secours si le réseau est indisponible.
const CACHE_NAME = "sentinelle-cache-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((clés) => Promise.all(clés.filter((clé) => clé !== CACHE_NAME).map((clé) => caches.delete(clé))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((reponseEnCache) => {
      const recuperation = fetch(event.request)
        .then((reponse) => {
          const copie = reponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copie));
          return reponse;
        })
        .catch(() => reponseEnCache);
      return reponseEnCache || recuperation;
    })
  );
});
