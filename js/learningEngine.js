/**
 * learningEngine.js — On-device ML for Phoneway Precision Scale
 *
 * ReadingLog      : circular ring buffer (max 500) → localStorage
 * SensitivityLearner : EMA sensitivity refinement from verify PASS events
 * CommunityPriors : loads static sensitivity priors by phone mass bucket
 */

'use strict';

const LOG_KEY    = 'phoneway_readingLog';
const STATS_KEY  = 'phoneway_learnStats';
const LOG_MAX    = 500;
const EMA_ALPHA  = 0.12;   // slow-enough EMA: ~8 verifications to converge

/* ─── ReadingLog ──────────────────────────────────────────────── */
class ReadingLog {
  constructor() {
    this._entries = this._load();
  }

  push({ grams, accuracy, sensors, timestamp = Date.now() }) {
    this._entries.push({ grams, accuracy, sensors, timestamp });
    if (this._entries.length > LOG_MAX) this._entries.shift();
    this._save();
  }

  stats() {
    const n = this._entries.length;
    if (!n) return { count: 0, meanAccuracy: 0, p50: 0, p95: 0 };
    const sorted = [...this._entries].sort((a, b) => a.accuracy - b.accuracy);
    const mean   = sorted.reduce((s, e) => s + e.accuracy, 0) / n;
    return {
      count:        n,
      meanAccuracy: Math.round(mean),
      p50:          Math.round(sorted[Math.floor(n * 0.50)]?.accuracy ?? 0),
      p95:          Math.round(sorted[Math.floor(n * 0.95)]?.accuracy ?? 0),
    };
  }

  clear() { this._entries = []; this._save(); }

  _load()  { try { return JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]'); } catch { return []; } }
  _save()  { try { localStorage.setItem(LOG_KEY, JSON.stringify(this._entries)); } catch {} }
}

/* ─── SensitivityLearner ──────────────────────────────────────── */
class SensitivityLearner {
  constructor() {
    const s = this._load();
    this.learnedSensitivity = s.learnedSensitivity ?? null;
    this.verifyCount        = s.verifyCount        ?? 0;
    this.lastError          = s.lastError          ?? null;
  }

  /**
   * Called on each PASS verification event.
   * @param {number} expected  — known reference weight in grams
   * @param {number} measured  — what the scale reported in grams
   * @param {number} currentSens — current motion.sensitivity (g per m/s²)
   */
  learn(expected, measured, currentSens) {
    if (!currentSens || expected <= 0 || measured <= 0) return;
    this.lastError = ((measured - expected) / expected * 100).toFixed(2);

    // Correct sensitivity proportionally and blend via EMA
    const corrected = currentSens * (expected / measured);
    if (this.learnedSensitivity == null) {
      this.learnedSensitivity = corrected;
    } else {
      this.learnedSensitivity = EMA_ALPHA * corrected + (1 - EMA_ALPHA) * this.learnedSensitivity;
    }
    this.verifyCount++;
    this._save();
  }

  /** Confidence threshold: trust learned value after 3+ verifies */
  get confident() { return this.verifyCount >= 3; }

  reset() {
    this.learnedSensitivity = null;
    this.verifyCount        = 0;
    this.lastError          = null;
    this._save();
  }

  _load() { try { return JSON.parse(localStorage.getItem(STATS_KEY) ?? '{}'); } catch { return {}; } }
  _save() {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify({
        learnedSensitivity: this.learnedSensitivity,
        verifyCount:        this.verifyCount,
        lastError:          this.lastError,
      }));
    } catch {}
  }
}

/* ─── CommunityPriors ─────────────────────────────────────────── */
class CommunityPriors {
  constructor() { this._priors = null; }

  /** Fetch static community-priors.json; silently fails if offline */
  async load(baseUrl = '') {
    try {
      const res = await fetch(baseUrl + 'data/community-priors.json', {
        cache:  'no-cache',
        signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined,
      });
      if (res.ok) this._priors = await res.json();
    } catch { /* offline or timeout — not critical */ }
    return this._priors;
  }

  /**
   * Suggest a starting sensitivity for a given phone mass.
   * Buckets: 60-120, 121-160, 161-185, 186-220, 221+
   */
  getSuggested(phoneMassG) {
    if (!this._priors?.buckets) return null;
    const m      = phoneMassG || 170;
    const buckets = this._priors.buckets;
    const bucket = buckets.find(b => m >= b.min && m <= b.max)
                ?? buckets[buckets.length - 1];
    return bucket?.sensitivity ?? null;
  }

  /**
   * Contribute this session's aggregate stats back to a sync endpoint.
   * SYNC_ENDPOINT is null by default — set it to enable crowd learning.
   */
  async contribute({ phoneMass, sensitivity, verifyCount }, endpoint = null) {
    if (!endpoint) return;
    try {
      await fetch(endpoint, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ phoneMass, sensitivity, verifyCount, ts: Date.now() }),
        signal:  AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      });
    } catch { /* best-effort */ }
  }
}

/* ─── LearningEngine (facade) ─────────────────────────────────── */
class LearningEngine {
  constructor() {
    this.log     = new ReadingLog();
    this.learner = new SensitivityLearner();
    this.priors  = new CommunityPriors();
  }

  /** Log a stable measurement */
  logReading(grams, accuracy, activeSensorCount) {
    this.log.push({ grams, accuracy, sensors: activeSensorCount });
  }

  /**
   * Call on each PASS verify. Returns new sensitivity if confident, else null.
   */
  learn(expected, measured, currentSensitivity) {
    this.learner.learn(expected, measured, currentSensitivity);
    return this.learner.confident ? this.learner.learnedSensitivity : null;
  }

  get stats()      { return this.log.stats(); }
  get learnStats() {
    return {
      verifyCount: this.learner.verifyCount,
      lastError:   this.learner.lastError,
    };
  }

  resetAll() {
    this.log.clear();
    this.learner.reset();
  }
}

export { LearningEngine };
