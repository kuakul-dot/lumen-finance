// Lumen Finance service worker — app-shell + static asset caching.
//
// Strategy:
//   navigations  → network-first, fall back to cached shell when offline
//   /assets/*    → cache-first (Vite content-hashed: immutable once cached)
//   other static → stale-while-revalidate (icons, favicon, manifest)
//   /api/*, cross-origin (Supabase, Yahoo, fonts) → not intercepted
//
// Bump VERSION to invalidate all caches on deploy of a new SW.
const VERSION      = 'lumen-v1'
const SHELL_CACHE  = `${VERSION}-shell`
const STATIC_CACHE = `${VERSION}-static`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(c => c.add('/')).catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return   // Supabase / Yahoo / fonts → network
  if (url.pathname.startsWith('/api/')) return       // live data → network

  // App navigations: network-first so deploys show up immediately,
  // cached shell keeps the app opening when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then(c => c.put('/', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/', { cacheName: SHELL_CACHE }))
    )
    return
  }

  // Hashed build assets never change for a given URL → cache-first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(cache =>
        cache.match(req).then(hit => hit || fetch(req).then(res => {
          if (res.ok) cache.put(req, res.clone())
          return res
        }))
      )
    )
    return
  }

  // Icons / manifest / favicon → stale-while-revalidate
  if (['image', 'manifest', 'font', 'style', 'script'].includes(req.destination) || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.open(STATIC_CACHE).then(cache =>
        cache.match(req).then(hit => {
          const refetch = fetch(req).then(res => {
            if (res.ok) cache.put(req, res.clone())
            return res
          }).catch(() => hit)
          return hit || refetch
        })
      )
    )
  }
})
