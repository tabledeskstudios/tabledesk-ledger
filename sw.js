/* TableDesk Ledger service worker — cache the shell, never the API.
   Bump VERSION on every deploy so phones pick up new assets. */
var VERSION = "tdl-v3";
var SHELL = [
  "./", "index.html", "app.css", "app.js", "calc.js", "manifest.webmanifest",
  "fonts/silkscreen-400.woff2", "fonts/silkscreen-700.woff2",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Network-first with cache fallback for the whole shell: the app is ~30KB, so
   every online open gets the latest deploy instantly, and the last good copy
   serves offline. */
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return; // API goes to network
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (e.request.mode === "navigate") return caches.match("index.html");
        return Response.error();
      });
    })
  );
});
