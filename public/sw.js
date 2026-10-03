// Minimal service worker.
//
// It exists so the app registers cleanly and is installable as a PWA. It
// deliberately does NOT cache anything: this is a live, multi-user ERP, and a
// cache-first shell would keep serving an old build after each deploy.
// Any caches left by earlier versions are cleared on activate.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Pass-through: let every request go straight to the network.
self.addEventListener("fetch", () => {});
