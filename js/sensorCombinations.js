/**
 * sensorCombinations.js — Advanced sensor combination algorithms for Phoneway
 *
 * Every class here represents a distinct physical phenomenon or cross-sensor
 * agreement that improves accuracy independently from the others:
 *
 *  • GyroGate          — Scale accel confidence by phone-motion magnitude
 *  • FrequencyConsensus — Cross-sensor resonant-frequency agreement boost
 *  • PassiveResonance   — Ambient accel FFT (no intentional excitation)
 *  • TiltCorrector      — Gravity-vector tilt compensation for deltaA
 *  • VerticalAccel      — Z-axis surface-compression signal
 */

'use strict';

import { fft, WindowFn, parabolicPeakFreq, MovingAverageFilter } from './kalman.js';

/* ═══════════════════════════════════════════════════════════════
   GyroGate
   Largest single accuracy win. When the gyroscope detects that
   the phone is moving, the accelerometer reading is contaminated
   by inertial forces unrelated to the object being weighed.

   Multiplier = exp(-6 × gyroMagnitude)
     gyroMag = 0.00 rad/s  →  multiplier = 1.00  (perfectly still)
     gyroMag = 0.10 rad/s  →  multiplier = 0.55
     gyroMag = 0.20 rad/s  →  multiplier = 0.30
     gyroMag = 0.50 rad/s  →  multiplier = 0.05
═══════════════════════════════════════════════════════════════ */
class GyroGate {
  constructor() {
    this._mavg      = new MovingAverageFilter(8);
    this.multiplier = 1.0;
  }

  feed(gx, gy, gz) {
    const mag     = Math.sqrt(gx * gx + gy * gy + gz * gz);
    const smooth  = this._mavg.update(mag);
    this.multiplier = Math.exp(-6 * smooth);
  }

  /** True when phone is effectively still (multiplier > 0.80). */
  get isStill() { return this.multiplier > 0.80; }
}

/* ═══════════════════════════════════════════════════════════════
   FrequencyConsensus
   When 2+ sensors independently measure the same resonant
   frequency (within 8%), this strongly confirms the mass estimate.
   Confidence: 0.80 for 2 sources, +0.08 per additional. Max 0.95.

   Uses same resonance formula as audio.js / vibrationHammer.js:
     m_added = m_phone × ((f_empty / f_loaded)² − 1)
═══════════════════════════════════════════════════════════════ */
class FrequencyConsensus {
  constructor() {
    this.baselineFreq = null;   // Hz — empty-phone resonant freq
    this.phoneMass    = 170;    // grams
    this._latestFreq  = new Map(); // sourceName → Hz
    this.onConsensus  = null;   // callback(grams, confidence)
  }

  /**
   * Feed a measured resonant frequency from one sensor.
   * @param {string} source  'audio' | 'hammer' | 'cam' | 'passive_res'
   * @param {number} freq    Hz — loaded resonant frequency
   */
  feed(source, freq) {
    if (!freq || freq <= 0) return;
    this._latestFreq.set(source, freq);
    this._check();
  }

  _check() {
    if (!this.baselineFreq || !this.phoneMass) return;
    const entries = [...this._latestFreq.values()].filter(f => f > 0);
    if (entries.length < 2) return;

    // Find the largest group of mutually-agreeing frequencies (within 8%)
    let best = [];
    for (const ref of entries) {
      const group = entries.filter(f => Math.abs(f - ref) / ref <= 0.08);
      if (group.length > best.length) best = group;
    }
    if (best.length < 2) return;

    const avgFreq = best.reduce((s, f) => s + f, 0) / best.length;
    const ratio   = this.baselineFreq / avgFreq;
    const massG   = Math.max(0, this.phoneMass * (ratio * ratio - 1));
    const conf    = Math.min(0.95, 0.80 + (best.length - 2) * 0.08);

    this.onConsensus?.(massG, conf);
  }
}

/* ═══════════════════════════════════════════════════════════════
   PassiveResonance
   FFTs the raw accelerometer magnitude stream to detect the
   phone's natural resonant frequency WITHOUT intentional vibration.
   Object mass shifts this frequency down — same physics as hammer.

   Ring buffer: 512 samples.  At 60 Hz ≈ 8.5 s of history.
   Analysis runs every 90 feeds (≈1.5 s).
   Frequency resolution: 60/512 ≈ 0.117 Hz/bin.
   Search range: 0.5–20 Hz.
═══════════════════════════════════════════════════════════════ */
const PR_SIZE = 512;   // must be power of 2

class PassiveResonance {
  constructor() {
    this.baselineFreq = null;
    this.phoneMass    = 170;
    this.sampleRate   = 60;     // Hz — updated after sensors start

    this._ring      = new Float64Array(PR_SIZE);
    this._wIdx      = 0;        // write index (wraps)
    this._count     = 0;        // total samples ever fed

    this.onWeight   = null;     // callback(grams, confidence)
  }

  feed(ax, ay, az) {
    const mag = Math.sqrt(ax * ax + ay * ay + az * az);
    this._ring[this._wIdx % PR_SIZE] = mag;
    this._wIdx = (this._wIdx + 1) % PR_SIZE;
    this._count++;

    // Analyse once the buffer is full, then every 90 samples
    if (this._count >= PR_SIZE && this._count % 90 === 0) {
      this._analyse();
    }
  }

  _analyse() {
    if (!this.baselineFreq || !this.phoneMass) return;

    // Read ring in chronological order (oldest → newest)
    const N     = PR_SIZE;
    const start = this._wIdx;      // next write position = oldest slot

    // DC removal + Blackman-Harris window
    let sum = 0;
    for (let i = 0; i < N; i++) sum += this._ring[(start + i) % N];
    const mean = sum / N;

    const win = WindowFn.blackmanHarris(N);
    const re  = new Array(N);
    const im  = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      re[i] = (this._ring[(start + i) % N] - mean) * win[i];
    }

    fft(re, im);

    const half = N / 2;
    const mag  = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    }

    const binHz = this.sampleRate / N;
    const lo    = Math.max(1, Math.floor(0.5 / binHz));
    const hi    = Math.min(half - 2, Math.ceil(20.0 / binHz));
    if (lo >= hi) return;

    // Peak search
    let peakMag = 0, peakBin = lo;
    for (let i = lo; i <= hi; i++) {
      if (mag[i] > peakMag) { peakMag = mag[i]; peakBin = i; }
    }

    // Noise floor (non-peak region)
    let noiseSum = 0, noiseCnt = 0;
    for (let i = lo; i <= hi; i++) {
      if (Math.abs(i - peakBin) > 3) { noiseSum += mag[i]; noiseCnt++; }
    }
    const noise  = noiseCnt ? noiseSum / noiseCnt : 1;
    const snrLin = peakMag / (noise || 1);
    const snrDb  = 20 * Math.log10(Math.max(1e-10, snrLin));
    if (snrDb < 4) return;

    const loadedFreq = parabolicPeakFreq(mag, peakBin, binHz);
    if (!loadedFreq || loadedFreq <= 0) return;

    const ratio = this.baselineFreq / loadedFreq;
    const massG = Math.max(0, this.phoneMass * (ratio * ratio - 1));

    // Low confidence — no forced excitation, scales with SNR
    const conf = Math.min(0.50, (snrDb - 4) / 25 * 0.40 + 0.10);

    if (massG < 500) this.onWeight?.(massG, conf);
  }
}

/* ═══════════════════════════════════════════════════════════════
   TiltCorrector
   When the phone tilts at angle θ from level, the measured
   horizontal ΔA is reduced by cos(θ). Divide by cos(tilt) to
   recover the true signal.

   At 0° (flat):  correction factor = 1.00 (no change)
   At 10°:        factor = 1/0.985  ≈ 1.015
   At 30°:        factor = 1/0.866  ≈ 1.155
   At 60°:        factor = 1/0.500  ≈ 2.000  ← cap here (too noisy)

   `flatness` (0–1) is also used to reduce accel confidence:
   a tilted phone gives a less reliable reading.
═══════════════════════════════════════════════════════════════ */
class TiltCorrector {
  constructor() {
    this._cosTilt = 1.0;   // assume flat until GravitySensor feeds
  }

  /**
   * Update tilt from GravitySensor reading.
   * @param {number} gx  m/s²
   * @param {number} gy  m/s²
   * @param {number} gz  m/s²  (≈+9.81 when phone is face-up flat)
   */
  feedGravity(gx, gy, gz) {
    const gMag = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (gMag < 1) return;
    this._cosTilt = Math.abs(gz) / gMag;
  }

  /**
   * Tilt-correct a grams estimate.
   * Skips correction if tilt > 60° to avoid noise amplification.
   */
  correctGrams(grams) {
    if (this._cosTilt < 0.50) return grams;
    return grams / this._cosTilt;
  }

  /** 1 = perfectly flat, 0.5 = 60° tilt.  Used to scale confidence. */
  get flatness() { return this._cosTilt; }
}

/* ═══════════════════════════════════════════════════════════════
   VerticalAccel
   A weight resting on the phone compresses the surface slightly,
   changing the Z-axis acceleration component. Baseline subtracted;
   smoothed |Δaz| treated as a mass-proportional signal.

   Confidence is capped at 0.35 — this is a weak secondary signal.
═══════════════════════════════════════════════════════════════ */
class VerticalAccel {
  constructor() {
    this.sensitivity = 180;    // g per m/s² — from MotionSensor calibration
    this._baselineAz = null;
    this._mavg       = new MovingAverageFilter(40);
    this.onWeight    = null;   // callback(grams, confidence)
  }

  /** Record the at-rest Z acceleration as the baseline. */
  setBaseline(az) {
    this._baselineAz = az;
    this._mavg.reset();
  }

  /** Feed a new raw Z accelerometer reading. */
  feed(az) {
    if (this._baselineAz === null) return;
    const delta   = Math.abs(az - this._baselineAz);
    const smoothed = this._mavg.update(delta);
    const massG   = Math.max(0, smoothed * this.sensitivity);
    const conf    = Math.min(0.35, 0.35 * smoothed / 0.005);
    if (conf > 0.01) this.onWeight?.(massG, conf);
  }
}

export { GyroGate, FrequencyConsensus, PassiveResonance, TiltCorrector, VerticalAccel };
