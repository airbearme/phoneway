/**
 * api/telemetry.js — Crowd-sourced telemetry endpoint for Phoneway
 *
 * Receives anonymous measurement events from all devices.
 * Aggregates accuracy stats in Vercel Blob (phoneway-stats/{class}.json).
 * The BLOB_READ_WRITE_TOKEN env var is auto-wired by Vercel when the
 * phoneway-telemetry Blob store is linked to this project.
 */

export const config = { runtime: 'edge' };

const BLOB_BASE  = 'https://xxogfqf3bfaznkdp.public.blob.vercel-storage.com';
const BLOB_UPLOAD = 'https://blob.vercel-storage.com';
const EMA = 0.08; // ~12-event rolling average

function blobToken() {
  return typeof process !== 'undefined'
    ? process.env.BLOB_READ_WRITE_TOKEN
    : undefined;
}

/** Read current stats blob for a device class */
async function readStats(cls) {
  try {
    const res = await fetch(`${BLOB_BASE}/phoneway-stats/${cls}.json`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Write updated stats blob (overwrites the fixed pathname) */
async function writeStats(cls, stats) {
  const token = blobToken();
  if (!token) return;
  try {
    await fetch(`${BLOB_UPLOAD}/phoneway-stats/${cls}.json`, {
      method:  'PUT',
      headers: {
        Authorization:        `Bearer ${token}`,
        'Content-Type':       'application/json',
        'x-add-random-suffix': '0',
      },
      body: JSON.stringify(stats),
    });
  } catch {}
}

/** Merge a batch of new events into existing aggregated stats */
function aggregate(existing, events, deviceClass) {
  const s = {
    deviceClass,
    verifyCount:    existing.verifyCount    || 0,
    passCount:      existing.passCount      || 0,
    meanError:      existing.meanError      || 0,
    calibrations:   existing.calibrations   || 0,
    sensorErrors:   existing.sensorErrors   || {},
    sensMap:        existing.sensMap        || {},
    accuracyGrades: existing.accuracyGrades || {},
    lastUpdated:    Date.now(),
  };

  for (const evt of events) {
    switch (evt.type) {
      case 'verify': {
        s.verifyCount++;
        const ep = Math.abs(evt.data?.errorPct ?? 0);
        s.meanError = s.meanError * (1 - EMA) + ep * EMA;
        if (evt.data?.grade === 'PASS') s.passCount++;
        const ag = evt.data?.accuracyGrade;
        if (ag) s.accuracyGrades[ag] = (s.accuracyGrades[ag] || 0) + 1;
        break;
      }
      case 'calibration': {
        s.calibrations++;
        const sq   = evt.data?.surfaceQuality;
        const sens = evt.data?.sensitivity;
        if (sq && sens > 0) {
          s.sensMap[sq] = s.sensMap[sq]
            ? s.sensMap[sq] * (1 - EMA) + sens * EMA
            : sens;
        }
        break;
      }
      case 'sensor_error': {
        const name = evt.data?.sensor || 'unknown';
        s.sensorErrors[name] = (s.sensorErrors[name] || 0) + 1;
        break;
      }
    }
  }

  return s;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response('Bad Request', { status: 400 }); }

  const { events = [], deviceClass = 'android' } = body;
  const cls = String(deviceClass).toLowerCase().replace(/[^a-z]/g, '').slice(0, 20);

  if (!Array.isArray(events) || events.length === 0) {
    return new Response(JSON.stringify({ received: true, count: 0 }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // Sanitise: max 50 events per batch
  const safe = events.slice(0, 50).map(e => ({
    type:      String(e.type || '').slice(0, 32),
    data:      e.data || {},
    timestamp: e.timestamp || Date.now(),
  }));

  let globalStats = null;

  if (blobToken()) {
    try {
      const existing = await readStats(cls) || {};
      const updated  = aggregate(existing, safe, cls);
      await writeStats(cls, updated);
      globalStats = updated;
    } catch (e) {
      console.error('[telemetry] Blob error:', e?.message);
    }
  } else {
    // No token — log to Vercel structured logs so data isn't lost
    console.log(JSON.stringify({ type: 'phoneway_telemetry', deviceClass: cls, events: safe }));
  }

  return new Response(
    JSON.stringify({ received: true, count: safe.length, globalStats }),
    { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
  );
}
