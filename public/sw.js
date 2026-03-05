// vtpt/public/sw.js

const CACHE_NAME = "vtpt-v1";

// super small: cache the app shell so it feels app-y
const CORE_ASSETS = [
  "/",
  "/manifest.json",
  "/icons/icon-118.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// Install: cache core assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k)))
        )
      )
  );
  self.clients.claim();
});

// Fetch: cache-first for CORE assets; network-first for everything else
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // cache-first for core assets
  if (CORE_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches
        .match(event.request)
        .then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // network-first for other pages/data (so your meter data stays fresh)
  event.respondWith(
    fetch(event.request)
      .then((res) => res)
      .catch(() => caches.match(event.request))
  );
});
