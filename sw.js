// Service worker: stores the whole game on the device so the home-screen app
// runs with no network. Each build gets its own cache (the build ID is
// stamped in at build time), and old builds are deleted once a new one is
// fully downloaded.
"use strict";

var BUILD = "20260926024239";
var CACHE = "realmz-" + BUILD;
var V = "?v=" + BUILD;

var ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "realmz-web.css" + V,
  "realmz-web.js" + V,
  "Realmz.js" + V,
  "Realmz.wasm" + V,
  "Realmz.data" + V,
  "stone.png" + V,
  "fonts/BlackChancery.ttf" + V,
  "fonts/ChicagoFLF.ttf" + V,
];

function tell(message) {
  return self.clients.matchAll({ includeUncontrolled: true }).then(function (clients) {
    clients.forEach(function (c) { c.postMessage(message); });
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      var done = 0;
      return Promise.all(ASSETS.map(function (url) {
        return fetch(url, { cache: "reload" }).then(function (response) {
          if (!response.ok) throw new Error(url + ": HTTP " + response.status);
          return cache.put(url, response);
        }).then(function () {
          done++;
          return tell({ type: "realmz-offline-progress", done: done, total: ASSETS.length });
        });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf("realmz-") === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () {
      return self.clients.claim();
    }).then(function () {
      return tell({ type: "realmz-offline-ready", build: BUILD });
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages: try the network so a newer build is picked up when online, and
  // fall back to the stored copy when offline.
  if (req.mode === "navigate") {
    var stored = function () {
      return caches.match("index.html", { cacheName: CACHE }).then(function (r) {
        return r || caches.match("./", { cacheName: CACHE });
      });
    };
    event.respondWith(
      // A dead tunnel answers with an error page rather than failing, so
      // treat any non-OK answer as offline too.
      fetch(req).then(function (r) {
        return r.ok ? r : stored().then(function (s) { return s || r; });
      }).catch(stored)
    );
    return;
  }

  // Everything else is versioned, so the stored copy is always right.
  event.respondWith(
    caches.match(req, { cacheName: CACHE }).then(function (hit) {
      return hit || caches.match(req).then(function (older) {
        return older || fetch(req);
      });
    })
  );
});
