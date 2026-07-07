/* TableDesk Ledger service worker — cache the shell, never the API. */
var VERSION = "tdl-v1";
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

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return; // API goes to network
  e.respondWith(
    caches.match(e.request, { ignoreSearch: url.pathname.endsWith("/") }).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (res) {
        return res;
      });
    })
  );
});
