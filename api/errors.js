/**
 * api/errors.js — Developer error dashboard for Phoneway
 *
 * Returns a live view of JS errors reported by all users.
 * Requires ?key=<ERROR_VIEWER_KEY> to prevent public access.
 *
 * Privacy: only error messages, file names, line numbers, and
 * browser category (android/ios/desktop) are stored — no IPs,
 * no user IDs, no personal data of any kind.
 *
 * GET /api/errors?key=SECRET         → HTML dashboard
 * GET /api/errors?key=SECRET&json=1  → raw JSON
 */

export const config = { runtime: 'edge' };

const BLOB_BASE = 'https://xxogfqf3bfaznkdp.public.blob.vercel-storage.com';

function viewerKey() {
  return typeof process !== 'undefined' ? process.env.ERROR_VIEWER_KEY : undefined;
}

async function fetchErrors() {
  try {
    const res = await fetch(`${BLOB_BASE}/phoneway-errors/recent.json`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
    });
    if (!res.ok) return { errors: [], total: 0 };
    return await res.json();
  } catch { return { errors: [], total: 0 }; }
}

function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s <    60) return `${s}s ago`;
  if (s <  3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function html(data) {
  const { errors = [], total = 0, lastUpdated } = data;
  const sorted = [...errors].sort((a, b) => b.count - a.count);

  const rows = sorted.length
    ? sorted.map((e, i) => {
        const browserBadges = Object.entries(e.browsers || {})
          .map(([b, n]) => `<span style="background:#1a2a3a;border:1px solid #234;padding:1px 5px;border-radius:3px;font-size:10px">${b}×${n}</span>`)
          .join(' ');
        const heat = e.count >= 10 ? '#ff4444' : e.count >= 3 ? '#ff8c00' : '#e8c84a';
        return `
        <tr style="border-bottom:1px solid #0d1a26">
          <td style="padding:10px 8px;color:${heat};font-weight:bold;text-align:center;white-space:nowrap">${e.count}</td>
          <td style="padding:10px 8px;word-break:break-all;color:#ff9999;font-size:12px">${e.msg}</td>
          <td style="padding:10px 8px;color:#39ff14;white-space:nowrap;font-size:12px">${e.src}:${e.line}</td>
          <td style="padding:10px 8px;font-size:11px">${browserBadges}</td>
          <td style="padding:10px 8px;color:#555;white-space:nowrap;font-size:11px">${timeAgo(e.lastTs)}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="5" style="padding:40px;text-align:center;color:#444">No errors recorded yet 🎉</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Phoneway — Error Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0d12; color: #ccc; font-family: monospace; padding: 16px; }
  h1 { color: #e8c84a; font-size: 18px; margin-bottom: 4px; }
  .sub { color: #555; font-size: 12px; margin-bottom: 20px; }
  .stats { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .stat { background: #0f1820; border: 1px solid #1a2a3a; border-radius: 8px; padding: 12px 20px; }
  .stat-val { color: #39ff14; font-size: 22px; font-weight: bold; }
  .stat-lbl { color: #555; font-size: 11px; letter-spacing: 1px; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; background: #0f1820; border-radius: 8px; overflow: hidden; }
  th { background: #0d1a26; color: #e8c84a; padding: 10px 8px; text-align: left; font-size: 11px; letter-spacing: 1px; }
  tr:hover td { background: #0d1a26; }
  a { color: #39ff14; text-decoration: none; }
  .refresh { margin-bottom: 12px; }
</style>
</head>
<body>
<h1>⚠ Phoneway Error Dashboard</h1>
<div class="sub">Live JS errors from all users · Privacy-safe: no IPs, no IDs, no PII</div>
<div class="stats">
  <div class="stat"><div class="stat-val">${sorted.length}</div><div class="stat-lbl">UNIQUE ERRORS</div></div>
  <div class="stat"><div class="stat-val">${total}</div><div class="stat-lbl">TOTAL OCCURRENCES</div></div>
  <div class="stat"><div class="stat-val">${timeAgo(lastUpdated)}</div><div class="stat-lbl">LAST UPDATE</div></div>
</div>
<div class="refresh"><a href="">↺ Refresh</a> &nbsp;·&nbsp; <a href="?key=${viewerKey()}&json=1">JSON</a></div>
<table>
<thead>
  <tr>
    <th style="width:50px">COUNT</th>
    <th>ERROR MESSAGE</th>
    <th style="width:160px">FILE:LINE</th>
    <th style="width:160px">BROWSERS</th>
    <th style="width:90px">LAST SEEN</th>
  </tr>
</thead>
<tbody>${rows}</tbody>
</table>
<p style="margin-top:16px;color:#333;font-size:11px">Showing top ${sorted.length} of ${total} total error events · Capped at 200 unique fingerprints</p>
</body></html>`;
}

export default async function handler(req) {
  const url    = new URL(req.url);
  const key    = url.searchParams.get('key') || '';
  const secret = viewerKey();

  if (!secret || key !== secret) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const data = await fetchErrors();

  if (url.searchParams.get('json') === '1') {
    return new Response(JSON.stringify(data, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(html(data), {
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
