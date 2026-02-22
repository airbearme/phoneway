/**
 * audio.js — Audio-resonance mass detection for Phoneway
 *
 * Method: The phone + surface form a mass-spring system.
 * Adding mass lowers the system's resonant frequency.
 *
 *   f_loaded = f_empty · √(m_phone / (m_phone + m_added))
 *   m_added  = m_phone · ((f_empty / f_loaded)² − 1)
 *
 * We excite the system with a chirp through the speaker, then
 * capture the response with the microphone via Web Audio API.
 * An FFT identifies the resonance peak.
 *
 * A secondary (passive) mode simply listens for ambient vibrations
 * (taps, HVAC, etc.) to extract the resonance peak continuously.
 */

'use strict';

import { KalmanFilter1D, MovingAverageFilter } from './kalman.js';

const FFT_SIZE      = 8192;
const CHIRP_DURATION = 0.8;   // seconds
const CHIRP_F_LOW   = 20;
const CHIRP_F_HIGH  = 600;
const MIN_PEAK_DB   = -60;    // dBFS threshold for valid peak

/* ═══════════════════════════════════════════════════════════════
   AudioAnalyzer
═══════════════════════════════════════════════════════════════ */
class AudioAnalyzer {
  constructor() {
    this.ctx         = null;
    this.analyser    = null;
    this.micStream   = null;
    this.active      = false;
    this.supported   = false;

    this.baselineFreq  = null;   // Hz — resonance with empty phone
    this.phoneMass     = 180;    // default phone mass (g); refined by user input
    this.sensitivity   = null;   // grams per Hz shift (set after calibration)

    this.kalman    = new KalmanFilter1D({ R: 2, Q: 0.1 });
    this.mavg      = new MovingAverageFilter(8);

    this.weightG   = 0;
    this.confidence = 0;
    this.onWeight  = null;       // callback(grams, confidence)
    this.onReady   = null;
    this.onError   = null;

    this._freqBuf  = new Float32Array(FFT_SIZE / 2);
    this._animFrame = null;
  }

  async init() {
    try {
      this.ctx      = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize         = FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0.75;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl:  false,
        sampleRate: 44100
      }});

      this.micStream = stream;
      const src = this.ctx.createMediaStreamSource(stream);
      src.connect(this.analyser);
      this.supported = true;
      this.onReady?.();
    } catch (err) {
      this.supported = false;
      this.onError?.(err);
    }
  }

  start() {
    if (!this.supported || this.active) return;
    this.active = true;
    this._loop();
  }

  stop() {
    this.active = false;
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
  }

  /** Play a log-chirp through the speaker to excite the resonance. */
  async playChirp() {
    if (!this.ctx) return;
    const dur = CHIRP_DURATION;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    const k = Math.log(CHIRP_F_HIGH / CHIRP_F_LOW) / dur;

    for (let i = 0; i < data.length; i++) {
      const t = i / this.ctx.sampleRate;
      const freq = CHIRP_F_LOW * Math.exp(k * t);
      // Tukey window to avoid clicks
      const win = this._tukey(t, dur, 0.1);
      data[i] = win * 0.4 * Math.sin(2 * Math.PI * freq * t);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.start();

    // Wait for chirp + a bit of ring-down
    return new Promise(res => setTimeout(res, (dur + 0.3) * 1000));
  }

  _tukey(t, T, alpha) {
    const half = alpha * T / 2;
    if (t < half) return 0.5 * (1 - Math.cos(Math.PI * t / half));
    if (t > T - half) return 0.5 * (1 - Math.cos(Math.PI * (T - t) / half));
    return 1;
  }

  _loop() {
    if (!this.active) return;
    this._animFrame = requestAnimationFrame(() => this._loop());

    this.analyser.getFloatFrequencyData(this._freqBuf);
    const peak = this._findResonancePeak();
    if (peak === null) return;

    const filtFreq = this.kalman.update(peak.freq);

    if (this.baselineFreq && this.phoneMass) {
      // m_added = m_phone * ((f0/f)^2 - 1)
      const ratio = this.baselineFreq / filtFreq;
      const rawG  = Math.max(0, this.phoneMass * (ratio * ratio - 1));
      const avg   = this.mavg.update(rawG);

      this.weightG    = avg;
      this.confidence = Math.min(1, peak.snr / 30); // SNR 0–30dB maps to 0–1
      this.onWeight?.(this.weightG, this.confidence);
    }
  }

  /**
   * Find dominant peak in 20–600 Hz band.
   * Returns { freq, magnitude, snr } or null.
   */
  _findResonancePeak() {
    const sr    = this.ctx.sampleRate;
    const binHz = sr / FFT_SIZE;
    const lo    = Math.floor(CHIRP_F_LOW  / binHz);
    const hi    = Math.ceil (CHIRP_F_HIGH / binHz);

    let max = -Infinity, maxIdx = -1, noise = 0, count = 0;

    for (let i = lo; i <= hi; i++) {
      const v = this._freqBuf[i];
      if (v > max) { max = v; maxIdx = i; }
      if (v > MIN_PEAK_DB) { noise += v; count++; }
    }

    if (max < MIN_PEAK_DB || maxIdx < 0) return null;

    const avgNoise = count > 0 ? noise / count : MIN_PEAK_DB;
    const snr = max - avgNoise;

    return { freq: maxIdx * binHz, magnitude: max, snr };
  }

  /** Call after phone is stable and empty to record baseline resonance. */
  async recordBaseline() {
    await this.playChirp();
    // Wait a bit then sample
    await new Promise(r => setTimeout(r, 300));
    this.analyser.getFloatFrequencyData(this._freqBuf);
    const peak = this._findResonancePeak();
    if (peak) {
      this.baselineFreq = peak.freq;
      return peak.freq;
    }
    return null;
  }

  destroy() {
    this.stop();
    this.micStream?.getTracks().forEach(t => t.stop());
    this.ctx?.close();
  }
}

export { AudioAnalyzer };
