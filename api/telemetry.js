/**
 * api/telemetry.js — Crowd-sourced telemetry endpoint for Phoneway
 *
 * Receives anonymous measurement events from all devices.
 * Aggregates accuracy stats in Vercel Blob (phoneway-stats/{class}.json).
 * The BLOB_READ_WRITE_TOKEN env var is auto-wired by Vercel when the
 * phoneway-telemetry Blob store is linked to this project.
 */

export const config = { runtime: 'edge' };

const BLOB_BASE   = 'https://xxogfqf3bfaznkdp.public.blob.vercel-storage.com';
const BLOB_UPLOAD = 'https://blob.vercel-storage.com';
const EMA         = 0.08;  // ~12-event rolling average
const MAX_ERRORS  = 200;   // rolling error log cap

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

/** Read the JS error log blob */
async function readErrors() {
  try {
    const res = await fetch(`${BLOB_BASE}/phoneway-errors/recent.json`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return { errors: [], total: 0 };
    return await res.json();
  } catch { return { errors: [], total: 0 }; }
}

/** Write the JS error log blob */
async function writeErrors(data) {
  const token = blobToken();
  if (!token) return;
  try {
    await fetch(`${BLOB_UPLOAD}/phoneway-errors/recent.json`, {
      method:  'PUT',
      headers: {
        Authorization:         `Bearer ${token}`,
        'Content-Type':        'application/json',
        'x-add-random-suffix': '0',
      },
      body: JSON.stringify(data),
    });
  } catch {}
}

/**
 * Append new JS error events to the rolling error log.
 * Deduplicates by (msg, src, line) — just increments count for repeats.
 * Privacy: only error message, filename, line number, browser category.
 */
async function appendErrors(jsErrors, deviceClass) {
  const existing = await readErrors();
  const log = existing.errors || [];

  for (const evt of jsErrors) {
    const d    = evt.data || {};
    const msg  = String(d.msg  || '').slice(0, 150);
    const src  = String(d.src  || '').slice(0, 50);
    const line = Number(d.line) || 0;
    const key  = `${msg}|${src}|${line}`;

    const found = log.find(e => `${e.msg}|${e.src}|${e.line}` === key);
    if (found) {
      found.count++;
      found.lastTs = evt.timestamp || Date.now();
      found.browsers = found.browsers || {};
      found.browsers[deviceClass] = (found.browsers[deviceClass] || 0) + 1;
    } else {
      log.push({
        msg, src, line,
        v:        String(d.v || '?'),
        count:    1,
        firstTs:  evt.timestamp || Date.now(),
        lastTs:   evt.timestamp || Date.now(),
        browsers: { [deviceClass]: 1 },
      });
    }
  }

  // Sort by most recent, cap size
  log.sort((a, b) => b.lastTs - a.lastTs);
  if (log.length > MAX_ERRORS) log.length = MAX_ERRORS;

  await writeErrors({
    errors:      log,
    total:       (existing.total || 0) + jsErrors.length,
    lastUpdated: Date.now(),
  });
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

  // Split JS errors into their own log; everything else goes to stats aggregate
  const jsErrors    = safe.filter(e => e.type === 'js_error');
  const otherEvents = safe.filter(e => e.type !== 'js_error');

  let globalStats = null;

  if (blobToken()) {
    // Write JS errors to privacy-safe error log (fire-and-forget)
    if (jsErrors.length > 0) {
      appendErrors(jsErrors, cls).catch(e => console.error('[telemetry] errors blob:', e?.message));
    }
    // Aggregate accuracy/calibration/verify stats
    if (otherEvents.length > 0) {
      try {
        const existing = await readStats(cls) || {};
        const updated  = aggregate(existing, otherEvents, cls);
        await writeStats(cls, updated);
        globalStats = updated;
      } catch (e) {
        console.error('[telemetry] stats blob:', e?.message);
      }
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
