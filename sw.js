const CACHE_NAME = 'elmeks-cache-v79'; 
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './script.js',
  './practice.html',
  './js/modules/ui.js',
  './js/modules/avatar.js',
  './js/modules/data.js',
  './js/modules/audio-sim.js',
  './js/modules/vr-mode.js',
  './audio/speech.ogg',
  './audio/music.ogg',
  './audio/noise.ogg',
  './audio/braille_click.ogg',
  './audio/braille_success.ogg',
  './audio/braille_error.ogg',
  './videos/Input-Assistive_Technologien.webm',
  './videos/captions_assistive.vtt',
  './videos/Audiogramm_Video.webm',
  './videos/captions_audiogramm.vtt',
  './videos/Input_Tactonom_Reader_Showcase.webm',
  './videos/captions_tactonom.vtt',
  './videos/AVA_Lernvideo.webm',
  './videos/captions_ava.vtt',
  './videos/Video-Ursachen_und_Einflussfaktoren.webm',
  './videos/captions_ursachen.vtt',
  './videos/Input-Nonverbale_Kommunikation.webm',
  './videos/captions_nonverbal.vtt',
  './manifest.json',
  './lib/jspdf.umd.min.js',
  './lib/jspdf.plugin.autotable.min.js',
  './lib/three/three.module.js',
  './lib/three/OrbitControls.js',
  './lib/three/GLTFLoader.js',
  './lib/three/OBJLoader.js',
  './lib/three/DRACOLoader.js',
  './lib/utils/BufferGeometryUtils.js',
  './fonts/Inter-Regular.woff2', 
  './fonts/Inter-Bold.woff2',    
  './lib/draco/draco_decoder.js',
  './lib/draco/draco_decoder.wasm',
  './lib/draco/draco_wasm_wrapper.js'
];

// 1. Installieren: Fehlertolerantes Caching jeder einzelnen Datei
self.addEventListener('install', (event) => {
  self.skipWaiting(); 
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Lädt jede Datei einzeln. Scheitert eine, werden die anderen trotzdem gespeichert!
      return Promise.all(
        ASSETS_TO_CACHE.map(url => {
          return cache.add(url).catch(err => {
            console.warn(`[SW] Konnte nicht gecacht werden (übersprungen): ${url}`, err);
          });
        })
      );
    })
  );
});

// 2. Aktivieren: Alte Caches aufräumen
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keyList) => {
        return Promise.all(keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Lösche alten Cache:', key);
            return caches.delete(key);
          }
        }));
      }),
      self.clients.claim() 
    ])
  );
});

// 3. Fetch: Offline-First mit Fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // NEU: Video-Dateien, Range-Requests und externe CDNs vom SW ignorieren
  if (event.request.headers.has('range') || event.request.url.match(/\.(webm|mp4|ogg)$/i) || event.request.url.includes('unpkg.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      // Treffer im Cache? Direkt zurückgeben!
      if (cachedResponse) {
        return cachedResponse;
      }

      // Root-URL Fallback: Wenn offline "/" aufgerufen wird, gib index.html zurück
      const url = new URL(event.request.url);
      if (url.pathname === '/') {
        return caches.match('./index.html').then(idxResponse => {
            if (idxResponse) return idxResponse;
        });
      }

      // Nicht im Cache? Aus dem Netz laden und dynamisch dem Cache hinzufügen
      return fetch(event.request).then((networkResponse) => {
        return caches.open(CACHE_NAME).then((cache) => {
          if(event.request.url.startsWith('http') && !event.request.url.includes('chrome-extension')) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        });
      }).catch((err) => {
         console.warn('[SW] Offline und Datei nicht im Cache:', event.request.url);
         // Hier könnte man theoretisch eine Offline-Fehlerseite zurückgeben
      });
    })
  );
});