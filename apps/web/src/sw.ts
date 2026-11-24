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
// Remembers which build served pages last, so the next one keeps that build's files.
const buildsName = `${cachePrefix}builds`;
const servingKey = new URL("cubehaus-serving", scope).href;
const assets = new URL("assets/", scope).href;
// The static pages beside the app answer a page load as themselves, under either address:
// the host redirects `privacy.html` to `privacy`. Every other page load is the app.
const pages = new Map(
  ["privacy", "support"].flatMap((name) => {
    const file = new URL(`${name}.html`, scope).href;
    return [
      [file, file],
      [new URL(name, scope).href, file],
    ];
  }),
);

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
      try {
        await Promise.all(fetched.map(([url, body]) => cache.put(url, body)));
      } catch (error) {
        await caches.delete(cacheName);
        throw error;
      }
    })(),
  );
});

// The build that served pages until now is kept for one more version. A page still
// running it (another tab, or one that was opened while this worker took over) asks for
// its own hashed files, a lazy screen for example, and the host no longer has them.
// Older builds are deleted.
worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const builds = await caches.open(buildsName);
      const serving = await (await builds.match(servingKey))?.text();
      const names = (await caches.keys()).filter(
        (name) =>
          name.startsWith(cachePrefix) &&
          name !== cacheName &&
          name !== buildsName,
      );
      // Without a record (the first version that keeps one), every older build is kept
      // this once.
      const keep = serving ? [serving] : names;
      await Promise.all(
        names
          .filter((name) => !keep.includes(name))
          .map((name) => caches.delete(name)),
      );
      await builds.put(servingKey, new Response(cacheName));
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const key =
    request.mode === "navigate" && request.url.startsWith(scope)
      ? (pages.get(request.url.replace(/[?#].*$/, "")) ?? shell)
      : request.url;
  if (!files.has(key)) {
    if (request.url.startsWith(assets))
      event.respondWith(
        caches
          .match(request.url)
          .then((response) => response ?? fetch(request)),
      );
    return;
  }
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
  // A page asks whether its entry script belongs to this build (see offline.ts).
  else if (event.data?.type === "HAS_FILE")
    event.ports[0]?.postMessage(files.has(String(event.data.url)));
});
