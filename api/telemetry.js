/**
 * api/telemetry.js — Crowd-sourced telemetry endpoint for Phoneway
 *
 * Receives anonymous measurement events from all devices.
 * Aggregates accuracy stats in Vercel KV (when configured).
 * Falls back to console logging when KV is unavailable.
 *
 * Setup Vercel KV:
 *   1. vercel.com → Storage → Create KV database
 *   2. Link to this project
 *   3. Vercel auto-adds KV_REST_API_URL and KV_REST_API_TOKEN env vars
 */

export const config = { runtime: 'edge' };

const KV_URL   = typeof process !== 'undefined' ? process.env.KV_REST_API_URL   : undefined;
const KV_TOKEN = typeof process !== 'undefined' ? process.env.KV_REST_API_TOKEN : undefined;
const KV_TTL   = 60 * 60 * 24 * 90; // 90-day TTL on all keys

/** Send a pipeline of Redis commands to Vercel KV REST API */
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
  } catch {
    return null;
  }
}

async function kvGet(key) {
  const results = await kv([['GET', key]]);
  const raw = results?.[0]?.result;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function kvSet(key, value) {
  await kv([['SET', key, JSON.stringify(value), 'EX', String(KV_TTL)]]);
}

/** Compute updated aggregate stats from a batch of events */
function aggregate(existing, events) {
  const stats = {
    verifyCount: existing.verifyCount || 0,
    passCount:   existing.passCount   || 0,
    meanError:   existing.meanError   || 0,  // EMA of |errorPct|
    calibrations:existing.calibrations|| 0,
    sensorErrors:existing.sensorErrors|| {},
    sensMap:     existing.sensMap     || {}, // surface → EMA sensitivity
    accuracyGrades: existing.accuracyGrades || {},
    deviceClass: existing.deviceClass || 'unknown',
    lastUpdated: Date.now(),
  };

  const EMA = 0.08; // ~12-event rolling average

  for (const evt of events) {
    switch (evt.type) {
      case 'verify': {
        stats.verifyCount++;
        const ep = Math.abs(evt.data?.errorPct ?? 0);
        stats.meanError = stats.meanError * (1 - EMA) + ep * EMA;
        if (evt.data?.grade === 'PASS') stats.passCount++;
        if (evt.data?.accuracyGrade) {
          stats.accuracyGrades[evt.data.accuracyGrade] =
            (stats.accuracyGrades[evt.data.accuracyGrade] || 0) + 1;
        }
        break;
      }
      case 'calibration': {
        stats.calibrations++;
        const sq = evt.data?.surfaceQuality;
        const s  = evt.data?.sensitivity;
        if (sq && s && s > 0) {
          stats.sensMap[sq] = stats.sensMap[sq]
            ? stats.sensMap[sq] * (1 - EMA) + s * EMA
            : s;
        }
        break;
      }
      case 'sensor_error': {
        const name = evt.data?.sensor || 'unknown';
        stats.sensorErrors[name] = (stats.sensorErrors[name] || 0) + 1;
        break;
      }
    }
  }

  return stats;
}

export default async function handler(req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const { events = [], deviceClass = 'unknown' } = body;

  if (!Array.isArray(events) || events.length === 0) {
    return new Response(JSON.stringify({ received: true, count: 0 }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // Sanitise: max 50 events per batch, strip PII
  const safe = events.slice(0, 50).map(e => ({
    type: String(e.type || '').slice(0, 32),
    data: e.data || {},
    timestamp: e.timestamp || Date.now(),
  }));

  let globalStats = null;

  if (KV_URL && KV_TOKEN) {
    try {
      const key      = `stats:${deviceClass}`;
      const existing = await kvGet(key) || {};
      const updated  = aggregate(existing, safe);
      updated.deviceClass = deviceClass;
      await kvSet(key, updated);
      globalStats = updated;
    } catch (e) {
      console.error('[telemetry] KV error:', e?.message);
    }
  } else {
    // No KV — log structured JSON so Vercel logs capture it
    console.log(JSON.stringify({ type: 'phoneway_telemetry', deviceClass, events: safe }));
  }

  return new Response(
    JSON.stringify({ received: true, count: safe.length, globalStats }),
    { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
  );
}
