const CACHE_NAME = "basha-pos-v8";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/assets/basha-logo.jpeg",
  "/assets/basha_bw.png"
];

// Install Event
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[Service Worker] Caching app shell and static assets...");
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[Service Worker] Removing old cache:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event (Stale-While-Revalidate Strategy for Assets)
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip API calls - let the browser handle them directly on the network-only stack
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Handle client-side routing for /billing
  if (url.pathname === "/billing" || url.pathname.startsWith("/billing/")) {
    const isNavigation = event.request.mode === "navigate" || event.request.headers.get("accept")?.includes("text/html");
    const hasExtension = url.pathname.includes(".");
    
    if (isNavigation || !hasExtension) {
      event.respondWith(
        caches.match("/index.html").then((cachedResponse) => {
          return cachedResponse || fetch(event.request);
        })
      );
      return;
    }
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Detect and self-heal incorrect caches (e.g. index.html cached for JS, CSS, or image files)
        const isJsReq = /\.js/i.test(event.request.url);
        const isCssReq = /\.css/i.test(event.request.url);
        const isImageReq = /\.(jpg|jpeg|png|gif|svg|webp)/i.test(event.request.url);
        const contentType = cachedResponse.headers.get("content-type") || "";
        
        if ((isJsReq || isCssReq || isImageReq) && contentType.includes("text/html")) {
          console.warn("[Service Worker] Detected invalid cached resource (type text/html). Deleting from cache and fetching from network:", event.request.url);
          caches.open(CACHE_NAME).then((cache) => {
            cache.delete(event.request);
          });
          return fetch(event.request);
        }

        // Fetch fresh copy in background to update cache (Stale-While-Revalidate)
        fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => { /* ignore background fetch failure when offline */ });
        
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
