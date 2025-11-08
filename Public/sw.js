self.addEventListener("install", (evt) => {
  evt.waitUntil(
    caches.open("cake-tower-v1").then(cache => cache.addAll(["/", "/index.html"]))
  );
});
self.addEventListener("fetch", (evt) => {
  evt.respondWith(caches.match(evt.request).then(res => res || fetch(evt.request)));
});