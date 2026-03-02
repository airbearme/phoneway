/**
 * api/stats.js — Global accuracy stats endpoint for Phoneway
 *
 * Returns aggregated stats for a given device class, read from Vercel Blob.
 * Falls back to hardcoded defaults if Blob is unavailable or empty.
 *
 * GET /api/stats?class=android   → stats for Android devices
 * GET /api/stats?class=ios       → stats for iOS devices
 * GET /api/stats                 → defaults to android
 */

export const config = { runtime: 'edge' };

const BLOB_BASE = 'https://xxogfqf3bfaznkdp.public.blob.vercel-storage.com';

// Baseline defaults used before crowd data accumulates
const DEFAULTS = {
  android: {
    sensMap:  { excellent: 280, good: 160, ok: 80, poor: 40 },
    meanError: 8.5,
    passRate:  0.71,
  },
  ios: {
    sensMap:  { excellent: 220, good: 130, ok: 65, poor: 35 },
    meanError: 11.2,
    passRate:  0.64,
  },
  desktop: {
    sensMap:  { excellent: 180, good: 110, ok: 55, poor: 28 },
    meanError: 18.0,
    passRate:  0.48,
  },
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const cls = (url.searchParams.get('class') || 'android')
    .toLowerCase().replace(/[^a-z]/g, '').slice(0, 20);

  // Try reading live stats from Blob store
  let live = null;
  try {
    const res = await fetch(`${BLOB_BASE}/phoneway-stats/${cls}.json`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined,
    });
    if (res.ok) live = await res.json();
  } catch {}

  const def = DEFAULTS[cls] || DEFAULTS.android;

  const out = {
    deviceClass:    cls,
    sensMap:        live?.sensMap        || def.sensMap,
    meanError:      live?.meanError      ?? def.meanError,
    passRate:       live?.verifyCount > 0
      ? (live.passCount / live.verifyCount)
      : def.passRate,
    verifyCount:    live?.verifyCount    || 0,
    calibrations:   live?.calibrations   || 0,
    sensorErrors:   live?.sensorErrors   || {},
    accuracyGrades: live?.accuracyGrades || {},
    source:         live ? 'live' : 'default',
  };

  return new Response(JSON.stringify(out), {
    headers: {
      'Content-Type':    'application/json',
      'Cache-Control':   'public, max-age=300', // 5-min CDN cache
      'Access-Control-Allow-Origin': '*',
    },
  });
}
