/**
 * telemetry.js — Anonymous crowd-sourced telemetry for Phoneway
 *
 * Collects anonymous sensor events (errors, calibration quality, verify
 * results) and flushes them to /api/telemetry. The server aggregates
 * these across all devices so the whole PWA gets more accurate over time.
 *
 * Privacy: NO location, NO photos, NO PII. Only numeric accuracy data
 * and sensor availability flags (same as any analytics tool).
 *
 * Global stats are fetched on boot and used to seed the local accuracy
 * model, especially on uncalibrated or freshly-installed devices.
 */

'use strict';

const QUEUE_KEY   = 'phoneway_telemetryQueue';
const STATS_KEY   = 'phoneway_globalStats';
const STATS_TTL   = 6 * 60 * 60 * 1000;  // refresh every 6 h
const MAX_QUEUE   = 200;
const FLUSH_EVERY = 20 * 1000; // flush every 20 s while active

/** Classify device without PII */
function _deviceClass() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua))          return 'android';
  return 'desktop';
}

/** Summarise available sensor APIs — no identifiers, just capability flags */
function _capabilitySnapshot() {
  return {
    deviceMotion:       typeof DeviceMotionEvent !== 'undefined',
    linearAccel:        typeof LinearAccelerationSensor !== 'undefined',
    gyroscope:          typeof Gyroscope !== 'undefined',
    magnetometer:       typeof Magnetometer !== 'undefined',
    vibration:          'vibrate' in navigator,
    microphone:         !!(navigator.mediaDevices?.getUserMedia),
    camera:             !!(navigator.mediaDevices?.enumerateDevices),
    touch:              navigator.maxTouchPoints > 0,
    deviceClass:        _deviceClass(),
    standalone:         window.matchMedia('(display-mode: standalone)').matches,
  };
}

export class Telemetry {
  constructor() {
    this._sessionId   = Math.random().toString(36).slice(2, 10);
    this._deviceClass = _deviceClass();
    this._queue       = this._loadQueue();
    this._sending     = false;
    this._globalStats = null;

    // Flush periodically while page is open
    this._interval = setInterval(() => this.flush(), FLUSH_EVERY);

    // Flush on page unload (sendBeacon survives page close)
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
  }

  // ── Public API ────────────────────────────────────────────────

  /** Log a raw event (type + data object) */
  log(type, data = {}) {
    this._queue.push({ type, data, timestamp: Date.now() });
    if (this._queue.length > MAX_QUEUE) this._queue.shift(); // ring buffer
    this._saveQueue();
    if (this._queue.length >= 15) this.flush();
  }

  /** Sensor became unavailable or threw an error */
  logSensorError(sensor, message = '') {
    this.log('sensor_error', { sensor, message: String(message).slice(0, 120) });
  }

  /** Permission was denied for a sensor */
  logPermissionDenied(sensor) {
    this.log('permission_denied', { sensor });
  }

  /** Calibration completed */
  logCalibration(sensitivity, surfaceQuality, calPoints, phoneMass) {
    this.log('calibration', {
      sensitivity:    Math.round(sensitivity * 10) / 10,
      surfaceQuality: String(surfaceQuality || 'unknown'),
      calPoints:      Number(calPoints)  || 0,
      phoneMass:      Math.round(phoneMass || 0),
    });
  }

  /** Verify panel result */
  logVerify(expected, measured, errorPct, grade, accuracyGrade) {
    this.log('verify', {
      expected:      Math.round(expected * 100)  / 100,
      measured:      Math.round(measured * 100)  / 100,
      errorPct:      Math.round(errorPct * 10)   / 10,
      grade:         String(grade),           // PASS or FAIL
      accuracyGrade: String(accuracyGrade || 'untested'),
    });
  }

  /** Device capabilities on boot */
  logCapabilities(extra = {}) {
    this.log('capabilities', { ..._capabilitySnapshot(), ...extra });
  }

  /**
   * JavaScript runtime error — sanitised, no PII.
   * Sent immediately (doesn't wait for the 20-second flush interval).
   */
  logJSError(msg, src, line, col) {
    this.log('js_error', {
      msg:  String(msg  || '').slice(0, 150).replace(/https?:\/\/\S+/g, '[url]'),
      src:  String(src  || '').split('/').pop().replace(/\?.*$/, '').slice(0, 50),
      line: Number(line) || 0,
      col:  Number(col)  || 0,
      v:    '3.7',
    });
    this.flush(); // send right away so crashes are captured before page closes
  }

  /** Active sensor count when a stable reading was achieved */
  logStableReading(grams, activeSensors, accPct) {
    this.log('stable_reading', {
      range:         grams < 1 ? '<1g' : grams < 5 ? '1-5g' : grams < 20 ? '5-20g' : '>20g',
      activeSensors: Number(activeSensors),
      accPct:        Math.round(accPct),
    });
  }

  /**
   * Flush queued events to /api/telemetry.
   * Uses sendBeacon when available (survives page close), falls back to fetch.
   */
  async flush() {
    if (this._sending || this._queue.length === 0) return;
    this._sending = true;
    const batch = this._queue.splice(0);
    this._saveQueue();

    const payload = JSON.stringify({
      events:      batch,
      deviceClass: this._deviceClass,
      sessionId:   this._sessionId,
    });

    try {
      let sent = false;
      if (navigator.sendBeacon) {
        sent = navigator.sendBeacon('/api/telemetry', new Blob([payload], { type: 'application/json' }));
      }
      if (!sent) {
        const res = await fetch('/api/telemetry', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    payload,
          keepalive: true,
        });
        if (res.ok) {
          const json = await res.json().catch(() => null);
          if (json?.globalStats) this._cacheGlobalStats(json.globalStats);
        }
      }
    } catch {
      // Re-queue unsent events (capped to avoid unbounded growth)
      this._queue.unshift(...batch.slice(0, 30));
      this._saveQueue();
    } finally {
      this._sending = false;
    }
  }

  /**
   * Fetch global aggregated stats from the server.
   * Returns null if offline or endpoint unavailable.
   * Caches in localStorage for 6 h so we don't re-fetch every boot.
   */
  async fetchGlobalStats() {
    // Serve from cache if fresh enough
    try {
      const cached = JSON.parse(localStorage.getItem(STATS_KEY) || 'null');
      if (cached && (Date.now() - cached._fetchedAt) < STATS_TTL) {
        this._globalStats = cached;
        return cached;
      }
    } catch {}

    try {
      const res = await fetch(`/api/stats?class=${encodeURIComponent(this._deviceClass)}`, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      });
      if (!res.ok) return null;
      const data = await res.json();
      data._fetchedAt = Date.now();
      this._globalStats = data;
      this._cacheGlobalStats(data);
      return data;
    } catch {
      return null;
    }
  }

  /** Suggested sensitivity for a surface quality based on global stats */
  globalSensitivity(surfaceQuality) {
    return this._globalStats?.sensMap?.[surfaceQuality] ?? null;
  }

  /** Mean verify error % across all devices (useful for UI display) */
  globalMeanError() {
    return this._globalStats?.meanError ?? null;
  }

  /** Global pass rate (0-1) */
  globalPassRate() {
    return this._globalStats?.passRate ?? null;
  }

  // ── Private ───────────────────────────────────────────────────

  _loadQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
  }

  _saveQueue() {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(this._queue)); } catch {}
  }

  _cacheGlobalStats(stats) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch {}
    this._globalStats = stats;
  }
}

export const telemetry = new Telemetry();
