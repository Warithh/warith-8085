"use strict";

const CACHE_NAME = "warith-8085-v1.9.2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./calculator.html",
  "./calculator.css",
  "./calculator.js",
  "./nvis.html",
  "./nvis.css",
  "./nvis.js",
  "./lab-state.js",
  "./styles.css",
  "./app.js",
  "./core.js",
  "./assets/fonts/AtkinsonHyperlegible-Regular.ttf",
  "./assets/fonts/AtkinsonHyperlegible-Bold.ttf",
  "./manifest.webmanifest",
  "./assets/vendor/tabler.min.css",
  "./assets/8085-192.png",
  "./assets/8085-512.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("warith-8085-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      })
      .catch(async (error) => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") {
          const appShell = await caches.match("./index.html");
          if (appShell) return appShell;
        }
        throw error;
      }),
  );
});
