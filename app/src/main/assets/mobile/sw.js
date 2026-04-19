self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("aftem-mobile-station-v2").then((cache) =>
      cache.addAll([
        "./index.html",
        "./styles.css",
        "./app.js",
        "./manifest.webmanifest",
        "./aftem_logo.png",
        "./icons/icon-192.png",
        "./icons/icon-512.png"
      ])
    )
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(caches.match(event.request).then((response) => response || fetch(event.request)));
});
