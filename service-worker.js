const CACHE_NAME = "rowing-manual-cache-v4";
const APP_SHELL_URLS = [
  "/",
  "/index.html",
  "/styles.css?v=35",
  "/sidebar.css?v=5",
  "/utils.js?v=5",
  "/pwa.js?v=3",
  "/script.js?v=44",
  "/sidebar.js?v=2",
  "/markdown-to-section.js?v=43",
  "/editor.css?v=9",
  "/editor.js?v=27",
  "/sections/section-order.md",
  "/sections/introduction.md",
  "/favicon/site.webmanifest",
  "/favicon/favicon.svg",
  "/favicon/favicon.ico",
  "/favicon/favicon-96x96.png",
  "/favicon/apple-touch-icon.png",
  "/favicon/web-app-manifest-192x192.png?v=2",
  "/favicon/web-app-manifest-512x512.png",
  "https://cdn.jsdelivr.net/npm/marked/marked.min.js",
];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);

  await Promise.all(APP_SHELL_URLS.map(async (url) => {
    try {
      const request = new Request(url, { cache: "reload" });
      const response = await fetch(request);
      if (response && response.ok) {
        await cache.put(request, response);
      }
    } catch (error) {
      console.warn("Failed to pre-cache asset", url, error);
    }
  }));
}

async function cleanupOldCaches() {
  const names = await caches.keys();
  await Promise.all(names.map((name) => {
    if (name !== CACHE_NAME) {
      return caches.delete(name);
    }
    return Promise.resolve(false);
  }));
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    const fallback = await cache.match("/index.html") || await cache.match("/");
    if (fallback) {
      return fallback;
    }
    throw error;
  }
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  const networkPromise = fetch(request).then(async (response) => {
    if (
      response
      && response.ok
      && (response.type === "basic" || response.type === "cors")
    ) {
      await cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  if (cachedResponse) {
    event.waitUntil(networkPromise);
    return cachedResponse;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) {
    return networkResponse;
  }

  return Response.error();
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(cleanupOldCaches().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.href === "https://cdn.jsdelivr.net/npm/marked/marked.min.js") {
    event.respondWith(staleWhileRevalidate(request, event));
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate" || request.destination === "document" || request.cache === "no-store") {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, event));
});
