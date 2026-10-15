// Service worker: cache somente de ASSETS estÃ¡ticos. API Ã© sempre rede (o servidor Ã© a verdade).
const CACHE = 'mpdv13-v1';
const ASSETS = ['/', '/index.html', '/css/app.css', '/css/componentes.css', '/js/app.js', '/js/api.js', '/js/ui.js', '/js/ws.js', '/js/offdb.js',
  '/js/recibo.js', '/js/offline-bridge.js', '/js/a11y.js', '/js/theme.js', '/js/sound.js', '/js/pdfExport.js', '/js/icons.js',
  '/vendor/jspdf.umd.min.js', '/vendor/jspdf.plugin.autotable.min.js', '/manifest.webmanifest',
  '/js/views/login.js', '/js/views/pdv.js', '/js/views/mesas.js', '/js/views/kds.js', '/js/views/caixa.js', '/js/views/admin.js', '/js/views/combos.js', '/js/views/mobile.js',
  '/js/qrcode.js', '/js/personalizacao.js', '/js/views/comandas.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API e WebSocket: SEMPRE rede (nada financeiro offline)
  if (url.pathname.startsWith('/api') || url.pathname === '/ws' || url.pathname === '/health') return;
  if (e.request.method !== 'GET') return;
  const ehCodigo = /\.(js|css|html|webmanifest)$/.test(url.pathname) || url.pathname === '/';
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (ehCodigo) {
      // Codigo: rede primeiro (atualizacoes aplicam no refresh), cache como fallback offline
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        throw new Error('offline');
      }
    }
    // Demais estaticos (vendor pesado): cache-first com atualizacao em background
    const hit = await cache.match(e.request);
    const busca = fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => hit);
    return hit ?? busca;
  })());
});



