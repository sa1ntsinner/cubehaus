/// <reference lib="webworker" />

declare const __CUBEHAUS_BUILD__: string;
declare const __CUBEHAUS_FILES__: Record<string, string>;

const worker = globalThis as unknown as ServiceWorkerGlobalScope;
const scope = worker.registration.scope;
const cachePrefix = `cubehaus:${scope}:`;
const cacheName = cachePrefix + __CUBEHAUS_BUILD__;
const files = new Map(
  Object.entries(__CUBEHAUS_FILES__).map(([path, integrity]) => [
    new URL(path, scope).href,
    integrity,
  ]),
);
const shell = new URL("index.html", scope).href;

// Every file is fetched and checked before any is stored, so an install with a missing or
// altered file leaves no cache. A host may answer `index.html` with a redirect to `/`; a
// redirected response cannot answer a navigation, so its body is stored as a plain one.
worker.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const fetched = await Promise.all(
        Array.from(files, async ([url, integrity]) => {
          const response = await fetch(
            new Request(url, { cache: "reload", integrity }),
          );
          if (!response.ok) throw new TypeError(`Precache failed: ${url}`);
          const plain = response.redirected
            ? new Response(await response.blob(), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              })
            : response;
          return [url, plain] as const;
        }),
      );
      const cache = await caches.open(cacheName);
      await Promise.all(fetched.map(([url, body]) => cache.put(url, body)));
    })(),
  );
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(cachePrefix) && name !== cacheName)
          .map((name) => caches.delete(name)),
      );
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const key =
    request.mode === "navigate" && request.url.startsWith(scope)
      ? shell
      : request.url;
  if (!files.has(key)) return;
  event.respondWith(
    caches
      .match(key, { cacheName })
      .then((response) =>
        response && !response.redirected ? response : fetch(request),
      ),
  );
});

worker.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") event.waitUntil(worker.skipWaiting());
});
