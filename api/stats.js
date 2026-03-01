/**
 * api/stats.js — Global accuracy stats endpoint for Phoneway
 *
 * Returns aggregated stats for a given device class so devices can
 * seed their local accuracy model with crowd-sourced data.
 *
 * GET /api/stats?class=android   → stats for Android devices
 * GET /api/stats?class=ios       → stats for iOS devices
 * GET /api/stats                 → global aggregate across all classes
 */

export const config = { runtime: 'edge' };

const KV_URL   = typeof process !== 'undefined' ? process.env.KV_REST_API_URL   : undefined;
const KV_TOKEN = typeof process !== 'undefined' ? process.env.KV_REST_API_TOKEN : undefined;

async function kv(commands) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

async function kvGet(key) {
  const results = await kv([['GET', key]]);
  const raw = results?.[0]?.result;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Default stats when KV is unavailable or key doesn't exist yet
const DEFAULTS = {
  android: { sensMap: { excellent: 280, good: 160, ok: 80, poor: 40 }, meanError: 8.5, passRate: 0.71 },
  ios:     { sensMap: { excellent: 220, good: 130, ok: 65, poor: 35 }, meanError: 11.2, passRate: 0.64 },
  desktop: { sensMap: { excellent: 180, good: 110, ok: 55, poor: 28 }, meanError: 18.0, passRate: 0.48 },
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const url   = new URL(req.url);
  const cls   = (url.searchParams.get('class') || 'android').toLowerCase().replace(/[^a-z]/g, '');
  const key   = `stats:${cls}`;

  let stats = null;

  if (KV_URL && KV_TOKEN) {
    stats = await kvGet(key);
  }

  // Merge KV data with defaults (KV wins)
  const def  = DEFAULTS[cls] || DEFAULTS.android;
  const out  = {
    deviceClass:  cls,
    sensMap:      stats?.sensMap     || def.sensMap,
    meanError:    stats?.meanError   ?? def.meanError,
    passRate:     stats?.verifyCount
      ? (stats.passCount / stats.verifyCount)
      : def.passRate,
    verifyCount:  stats?.verifyCount  || 0,
    calibrations: stats?.calibrations || 0,
    sensorErrors: stats?.sensorErrors || {},
    accuracyGrades: stats?.accuracyGrades || {},
    source: stats ? 'live' : 'default',
  };

  return new Response(JSON.stringify(out), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300', // 5-min CDN cache
      'Access-Control-Allow-Origin': '*',
    },
  });
}
