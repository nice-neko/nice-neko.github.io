const version = "17b87f59"
const cache_name = "hcsim-cache-" + version;
let assets = {};

async function cleanResponse(response) {
  const cloned_response = response.clone();
  if (cloned_response.redirected == false)
    return cloned_response;

  const bodyPromise = "body" in cloned_response ?
    Promise.resolve(cloned_response.body) :
    cloned_response.blob();

  return bodyPromise.then((body) => {
    return new Response(body, {
      headers: cloned_response.headers,
      status: cloned_response.status,
      statusText: cloned_response.statusText,
    });
  });
}

async function cacheAsset(request) {
  console.log(`[Service Worker] Searching for resource: ${request.url || request}`);
  const r = await caches.match(request);
  if (r) { return r; }
  const response = await fetch(request);
  const cache = await caches.open(cache_name);
  console.log(`[Service Worker] Caching new resource: ${request.url || request}`);
  const cloned_response = await cleanResponse(response);
  await cache.put(request, cloned_response);
  return response;
}

self.addEventListener("install", (e) => {
  console.log(`[Service Worker] Install`);
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", (e) => {
  e.respondWith(cacheAsset(e.request));
});

let cached_apps = [];

self.addEventListener("activate", (e) => {
  console.log(`[Service Worker] Activate`);
  e.waitUntil((async () => {
    cached_apps = [];
    const keys = await caches.keys();
    for (const key of keys)
      if (key !== cache_name)
        await caches.delete(key);
    await self.clients.claim();
  })());
});

async function broadcastMessage(mes) {
  const client_list = await self.clients.matchAll();
  if (client_list)
    for (const client of client_list)
      await client.postMessage(mes);
}

async function checkCachedApps() {
  const cache = await caches.open(cache_name);
  for (const [app_name, app_assets] of Object.entries(assets)) {
    if (cached_apps.includes(app_name)) continue;
    let completed = false;
    for (const asset of app_assets) {
      if (!await caches.match(asset)) {
        break;
      }
      completed = true;
    }
    if (completed)
      cached_apps.push(app_name);
  }
  await broadcastMessage({
    type: "complete",
    content: {
      cached: cached_apps,
      version: version,
    }
  });
}

function getAssetsList(asset_name) {
  if (!asset_name in assets) return [];
  if (asset_name == "ykm")
    return assets["ykm"].concat(assets["gwongzau-hc"]);
  else if (asset_name == "shandong-hc")
    return assets["shandong-hc"].concat(assets["weihai-hc"]);
  else
    return assets[asset_name];
}

self.addEventListener("message", (e) => {
  if (!e.data) return;
  if (e.data.type == "download") {
    (async () => {
      await checkCachedApps();
      let app_assets = [];
      if (typeof(e.data.content) == "string") {
        if (cached_apps.includes(e.data.content))
          return;
        app_assets = getAssetsList(e.data.content);
      } else {
        for (const item of e.data.content) {
          if (cached_apps.includes(item))
            continue;
          app_assets = app_assets.concat(getAssetsList(item));
        }
      }
      if (!app_assets) return;
    
      const cache = await caches.open(cache_name);
      let count = 0;
      for (const asset of app_assets) {
        try {
          await cacheAsset(asset);
          // if (!await caches.match(asset)) {
          //   console.log(`[Service Worker] Downloading ${asset}`);
          //   await cache.add(asset);
          // }
          count++;
        } catch (e) {
          console.log(`[Service Worker] Failed to download ${asset}`);
        }
        
        // broadcastMessage({
        //   type: "progress",
        //   content: (count / app_assets.length).toFixed(2)
        // });
      }
      if (count == app_assets.length) {
        if ("string" == typeof(e.data.content))
          cached_apps.push(e.data.content);
        else
          cached_apps = cached_apps.concat(e.data.content);
      }
      broadcastMessage({
        type: "complete",
        content: {
          cached: cached_apps,
          version: version,
        }
      });
    })();
  } else if (e.data.type == "clear") {
    (async () => {
      cached_apps = [];
      const keys = await caches.keys();
      for (const key of keys)
        await caches.delete(key);
      const client_list = await self.clients.matchAll();
      for (const client of client_list) {
        client.postMessage({
          type: "reload",
        });
      }
    })();
  } else if (e.data.type == "check") {
    checkCachedApps();
  }
});
