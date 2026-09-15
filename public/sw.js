// Minimal service worker — required for the app to be installable as a
// desktop/standalone app. We deliberately keep the shell network-first so the
// app is never stale (all data lives on the server / Shopify / Sheets).

const CACHE = "buying-desk-v1";
const SHELL = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Static icons/manifest: cache-first. Everything else: network-first.
  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
    return;
  }

  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});
