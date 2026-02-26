/**
 * sw.js — Service Worker for Phoneway Precision Scale v2
 * Full offline capability via cache-first strategy.
 */

const CACHE = 'phoneway-v3.2';
// Dynamic scope works on both root (localhost) and sub-path (GitHub Pages)
const BASE  = self.registration.scope;

const ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.json',
  BASE + 'css/style.css',
  BASE + 'js/kalman.js',
  BASE + 'js/sensors.js',
  BASE + 'js/audio.js',
  BASE + 'js/display.js',
  BASE + 'js/vibrationHammer.js',
  BASE + 'js/genericSensors.js',
  BASE + 'js/cameraSensor.js',
  BASE + 'js/learningEngine.js',
  BASE + 'js/sensorCombinations.js',
  BASE + 'js/referenceWeights.js',
  BASE + 'data/community-priors.json',
  BASE + 'js/app.js',
  BASE + 'icons/icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
