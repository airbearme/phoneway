/**
 * vibrationHammer.js — Vibration-exciter resonance mass detection
 *
 * NOVEL TECHNIQUE: Uses the phone's built-in vibration motor as a
 * controlled mechanical excitation source, then analyzes the ring-down
 * response captured by the accelerometer to find the system's natural
 * resonant frequency. Adding mass shifts the frequency down.
 *
 *   f_loaded = f_empty · √(m_phone / (m_phone + m_added))
 *   m_added  = m_phone · ((f_empty / f_loaded)² − 1)
 *
 * Why this works better than passive measurement:
 *  ✓ Known excitation force → higher SNR
 *  ✓ Repeatable → can average multiple strikes
 *  ✓ Works even in quiet environments
 *  ✓ Self-contained (no mic permission needed)
 */

'use strict';

import { fft, WindowFn, parabolicPeakFreq, AdaptiveKalmanFilter, MovingAverageFilter }
  from './kalman.js';

class VibrationHammer {
  constructor() {
    this.supported    = 'vibrate' in navigator;
    this.sampleRate   = 60;       // Hz — updated from actual DeviceMotion interval
    this.captureMs    = 600;      // ms of ring-down to capture
    this.vibrateDurMs = 80;       // ms of excitation vibration
    this.waitMs       = 95;       // ms to wait after vibrate() before capturing

    this.baselineFreq = null;     // Hz — resonance with empty phone
    this.phoneMass    = 170;      // g  — default, calibrate via user input

    this.kalman  = new AdaptiveKalmanFilter({ R: 4, Q: 0.5 });
    this.mavg    = new MovingAverageFilter(6);

    // Shared accelerometer buffer — app fills this
    this._buf    = [];
    this._active = false;
    this._resolve = null;

    this.weightG    = 0;
    this.confidence = 0;
    this.lastFreq   = null;

    this.onWeight = null;         // callback(grams, confidence)
  }

  /** Called by MotionSensor on every accelerometer reading */
  feedSample(ax, ay) {
    if (!this._active) return;
    // Store horizontal magnitude (perpendicular to gravity)
    this._buf.push(Math.sqrt(ax * ax + ay * ay));
    if (this._buf.length >= this._targetSamples) {
      this._active = false;
      this._resolve?.(this._analyze([...this._buf]));
      this._resolve = null;
    }
  }

  /** Single excitation cycle — returns { freq, confidence } or null */
  async excite() {
    if (!this.supported) return null;
    this._targetSamples = Math.ceil(this.captureMs * this.sampleRate / 1000);
    this._buf    = [];
    this._active = false;

    // Vibrate (fire-and-forget)
    navigator.vibrate(this.vibrateDurMs);

    // Wait for vibration to finish, then start capturing ring-down
    await _delay(this.waitMs);
    this._buf    = [];
    this._active = true;

    const result = await new Promise(res => { this._resolve = res; });
    return result;
  }

  /**
   * Multiple excitations averaged for higher SNR.
   * @param {number} n  number of strikes
   */
  async multiExcite(n = 6, onProgress = null) {
    const freqs      = [];
    const confs      = [];
    for (let i = 0; i < n; i++) {
      onProgress?.(i, n);
      const r = await this.excite();
      if (r && r.freq > 2 && r.confidence > 0.1) {
        freqs.push(r.freq);
        confs.push(r.confidence);
      }
      if (i < n - 1) await _delay(700);
    }
    if (!freqs.length) return null;

    // Weighted average
    let wSum = 0, fSum = 0;
    for (let i = 0; i < freqs.length; i++) {
      fSum += freqs[i] * confs[i];
      wSum += confs[i];
    }
    const avgFreq = fSum / wSum;
    const avgConf = Math.min(1, wSum / n);
    return { freq: avgFreq, confidence: avgConf };
  }

  /** Record baseline (phone empty, placed on weighing surface) */
  async calibrateBaseline(n = 6, onProgress = null) {
    const r = await this.multiExcite(n, onProgress);
    if (r) {
      this.baselineFreq = r.freq;
      return r;
    }
    return null;
  }

  /** Measure loaded frequency and return weight estimate */
  async measure(n = 4) {
    const r = await this.multiExcite(n);
    if (!r || !this.baselineFreq) return null;

    const freq = this.kalman.update(r.freq);
    this.lastFreq = freq;

    const rawG = this._freqToGrams(freq);
    const smoothG = this.mavg.update(rawG);
    this.weightG    = Math.max(0, smoothG);
    this.confidence = r.confidence;
    this.onWeight?.(this.weightG, this.confidence);
    return { grams: this.weightG, confidence: this.confidence, freq };
  }

  _freqToGrams(loadedFreq) {
    if (!this.baselineFreq || !this.phoneMass) return 0;
    const ratio = this.baselineFreq / loadedFreq;
    return this.phoneMass * (ratio * ratio - 1);
  }

  /** Analyze captured buffer → resonant frequency */
  _analyze(samples) {
    const N    = samples.length;
    if (N < 8) return { freq: 0, confidence: 0 };

    // Apply Blackman-Harris window (best sidelobe rejection)
    const win  = WindowFn.blackmanHarris(N);
    const data = samples.map((v, i) => v * win[i]);

    // Zero-pad to next power of 2 (better frequency interpolation)
    const fftSize = nextPow2(Math.max(N, 128));
    const re = new Array(fftSize).fill(0);
    const im = new Array(fftSize).fill(0);
    for (let i = 0; i < N; i++) re[i] = data[i];

    fft(re, im);

    // Magnitude spectrum
    const half   = fftSize / 2;
    const mag    = new Float64Array(half);
    for (let i = 0; i < half; i++) mag[i] = Math.sqrt(re[i]**2 + im[i]**2);

    const binHz  = this.sampleRate / fftSize;

    // Search range: 1–28 Hz (within Nyquist at 60 Hz, rocking modes)
    const lo = Math.max(1, Math.floor(1.0 / binHz));
    const hi = Math.min(half - 2, Math.ceil(28 / binHz));

    // Find peak
    let maxMag = 0, peakBin = lo;
    for (let i = lo; i <= hi; i++) {
      if (mag[i] > maxMag) { maxMag = mag[i]; peakBin = i; }
    }

    // SNR estimate
    let noiseSum = 0, noiseCnt = 0;
    for (let i = lo; i <= hi; i++) {
      if (i < peakBin - 2 || i > peakBin + 2) { noiseSum += mag[i]; noiseCnt++; }
    }
    const noise = noiseCnt > 0 ? noiseSum / noiseCnt : 1;
    const snr   = maxMag / (noise || 1);

    // Parabolic interpolation for sub-bin accuracy
    const peakFreq   = parabolicPeakFreq(mag, peakBin, binHz);
    const confidence = Math.min(1, Math.max(0, (snr - 1.5) / 5));

    return { freq: peakFreq, magnitude: maxMag, snr, confidence };
  }

  /** Update sample rate from DeviceMotion interval */
  setSampleRate(intervalMs) {
    if (intervalMs > 0) this.sampleRate = 1000 / intervalMs;
  }
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

export { VibrationHammer };
