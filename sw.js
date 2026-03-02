/**
 * sw.js — Service Worker for Phoneway Precision Scale v3.1
 * Full offline capability via cache-first strategy.
 * 
 * NEW in v3.1:
 * - Quantum-inspired fusion engine
 * - Advanced thermal compensation
 * - Professional verification protocols
 * - Premium laboratory-grade UI
 */

const CACHE = 'phoneway-v3.9-runtimefix';
const BASE  = self.registration.scope;

const ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.json',
  BASE + 'css/style.css',
  BASE + 'css/premium-style.css',
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
  BASE + 'js/precisionEngine.js',
  BASE + 'js/mlCalibration.js',
  BASE + 'js/advancedFusion.js',
  BASE + 'js/environmentalSensors.js',
  BASE + 'js/ultraPrecision.js',
  BASE + 'js/quantumFusion.js',
  BASE + 'js/thermalCompensation.js',
  BASE + 'js/advancedVerification.js',
  BASE + 'data/community-priors.json',
  BASE + 'data/error-logger.js',
  BASE + 'js/adaptiveFilter.js',
  BASE + 'js/predictiveCalibration.js',
  BASE + 'js/telemetry.js',
  BASE + 'js/app.js',
  BASE + 'icons/icon.svg',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => {
      console.log('[SW] Caching', ASSETS.length, 'assets');
      return c.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
  console.log('[SW] Activated:', CACHE);
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  
  // Network-first for API calls (telemetry, stats) — never cache these
  const isAPI = e.request.url.includes('/api/') || e.request.url.includes('vercel');
  
  if (isAPI) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // Check for updates in background
        fetch(e.request).then(res => {
          if (res && res.ok) {
            caches.open(CACHE).then(c => c.put(e.request, res));
          }
        }).catch(() => {});
        return cached;
      }
      
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

// Handle messages from main thread
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
