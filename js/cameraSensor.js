/**
 * cameraSensor.js — Camera optical-flow resonance sensor for Phoneway
 *
 * Uses the phone camera to detect mass by monitoring micro-vibrations:
 *
 *  1. OPTICAL FLOW: Frame-to-frame luminance MAD (mean absolute difference)
 *     captures whole-body mechanical oscillations of the phone+surface system.
 *
 *  2. FREQUENCY ANALYSIS: FFT of the flow time series reveals the system's
 *     natural resonant frequency. Added mass shifts the frequency downward.
 *
 *  3. MASS ESTIMATION: same resonance formula as audio + hammer:
 *       m_added = m_phone × ((f_baseline / f_loaded)² − 1)
 *
 *  4. HAMMER SYNC: When VibrationHammer fires, app.js calls
 *     beginHammerCapture() / endHammerCapture() to analyse ONLY the
 *     vibration window — much higher SNR than passive monitoring.
 *     This is the camera+vibration "sonar" combination.
 *
 *  5. AUDIO SONAR CROSS-VALIDATION: When AudioAnalyzer plays its chirp,
 *     the phone body vibrates acoustically. Both the mic AND the camera
 *     see the response. If both agree on frequency → confidence boost
 *     (call validateWithAudio(freq) after audio measurement).
 *
 *  6. PRESENCE: Luminance + flow-ratio change detects whether an object
 *     is placed on the phone, boosting confidence of other sensors.
 *
 * Camera permission is requested alongside microphone during sensor start.
 * Fails gracefully on devices without a usable camera.
 *
 * Physics:
 *   f_loaded = f_empty · √(m_phone / (m_phone + m_added))
 *   m_added  = m_phone · ((f_empty / f_loaded)² − 1)
 */

'use strict';

import { fft, WindowFn, parabolicPeakFreq,
         AdaptiveKalmanFilter, MovingAverageFilter } from './kalman.js';

const CAM_W       = 160;
const CAM_H       = 120;
const FLOW_BUF    = 512;   // circular buffer length (frames)
const FFT_FRAMES  = 256;   // analysis window length (power of 2)
const MIN_SNR     = 4;     // minimum SNR to accept a frequency peak
const MAX_CONF    = 0.65;  // camera confidence cap (less reliable than accel)
const FPS_DEFAULT = 30;

class CameraSensor {
  constructor() {
    this.active       = false;
    this.supported    = false;
    this.stream       = null;
    this.phoneMass    = 170;   // g — updated from calibration settings
    this.baselineFreq = null;  // Hz — resonance with empty phone

    // Hidden video + off-screen canvas — never added to DOM
    this._video  = document.createElement('video');
    this._video.playsInline = true;
    this._video.muted       = true;
    this._video.setAttribute('playsinline', '');

    this._canvas = document.createElement('canvas');
    this._canvas.width  = CAM_W;
    this._canvas.height = CAM_H;
    this._ctx = null;

    // Running state
    this._prevGray     = null;
    this._flowBuf      = [];         // circular buffer of flow magnitudes (float)
    this._baselineFlow = null;       // mean flow at rest (no object)
    this._baselineLum  = null;       // mean luminance at rest
    this._frameTimer   = null;
    this._fps          = FPS_DEFAULT;

    // Camera + hammer sync burst
    this._hammerCapture = null;      // null = idle, [] = capturing frames

    // Audio cross-validation
    this._lastAudioFreq = null;      // most recent audio resonance frequency
    this._crossValConf  = 0;         // boost from audio+camera agreement

    // Filters
    this._freqKalman = new AdaptiveKalmanFilter({ R: 2, Q: 0.1 });
    this._massSmooth = new MovingAverageFilter(8);

    // Callbacks
    this.onWeight   = null;  // (grams, confidence)
    this.onPresence = null;  // (isPresent, confidence)
  }

  /* ── Public API ─────────────────────────────────────────────── */

  /** Request camera permission and start frame capture. Returns true on success. */
  async start() {
    if (this.active) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width:      { ideal: CAM_W },
          height:     { ideal: CAM_H },
          frameRate:  { ideal: this._fps, min: 10 },
          facingMode: 'environment'  // rear camera — best for table-top use
        }
      });
      this._video.srcObject = stream;
      await this._video.play().catch(() => {});
      this.stream    = stream;
      this._ctx      = this._canvas.getContext('2d', { willReadFrequently: true });
      this.supported = true;
      this.active    = true;
      this._frameTimer = setInterval(() => this._captureFrame(), 1000 / this._fps);
      return true;
    } catch (e) {
      console.warn('[CameraSensor] unavailable:', e.message);
      this.supported = false;
      return false;
    }
  }

  stop() {
    this.active = false;
    if (this._frameTimer) { clearInterval(this._frameTimer); this._frameTimer = null; }
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream    = null;
    this._prevGray = null;
  }

  /**
   * Camera + Vibration Hammer combo:
   * Call just before VibrationHammer starts striking.
   * Captures a burst of flow frames for higher-SNR analysis.
   */
  beginHammerCapture() {
    this._hammerCapture = [];
  }

  /**
   * Call after VibrationHammer finishes.
   * Analyses the captured burst and returns mass estimate, or null.
   * @returns {{ grams, confidence, freq, snr } | null}
   */
  endHammerCapture() {
    const frames = this._hammerCapture;
    this._hammerCapture = null;
    if (!frames || frames.length < 16 || !this.baselineFreq) return null;
    return this._analyze(frames, false);
  }

  /**
   * Camera + Audio sonar cross-validation:
   * When AudioAnalyzer reports a loaded resonant frequency, call this.
   * If camera's own estimate is within 15% → shared confidence boost.
   * @param {number} audioFreq  loaded resonant frequency from mic (Hz)
   */
  validateWithAudio(audioFreq) {
    this._lastAudioFreq = audioFreq;
    // Cross-validation happens next time _analyze runs
  }

  /**
   * Record baseline optical flow (phone empty and still).
   * Call from calibration sequence after phone settles.
   */
  recordBaseline() {
    if (this._flowBuf.length < 30) return false;
    const recent = this._flowBuf.slice(-60);
    this._baselineFlow = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (this._prevGray) {
      this._baselineLum = this._prevGray.reduce((a, b) => a + b, 0) / this._prevGray.length;
    }
    return true;
  }

  /* ── Private: frame capture ─────────────────────────────────── */

  _captureFrame() {
    if (!this._ctx) return;
    if (!this._video.readyState || this._video.readyState < 2) return;
    try {
      this._ctx.drawImage(this._video, 0, 0, CAM_W, CAM_H);
      const pix  = this._ctx.getImageData(0, 0, CAM_W, CAM_H).data;
      const gray = _toGray(pix, CAM_W * CAM_H);

      if (this._prevGray) {
        const flow = _computeMAD(this._prevGray, gray);

        // Circular buffer
        this._flowBuf.push(flow);
        if (this._flowBuf.length > FLOW_BUF) this._flowBuf.shift();

        // Hammer-sync burst capture
        if (this._hammerCapture !== null) this._hammerCapture.push(flow);

        // Presence detection
        if (this._baselineFlow !== null) this._detectPresence(flow, gray);

        // Passive resonance analysis every ~2 s once buffer is full
        if (this._flowBuf.length >= FFT_FRAMES &&
            this._flowBuf.length % Math.round(this._fps * 2) === 0) {
          this._analyze(this._flowBuf.slice(-FFT_FRAMES), true);
        }
      }
      this._prevGray = gray;
    } catch (_) {}
  }

  _detectPresence(flow, gray) {
    const lum     = gray.reduce((a, b) => a + b, 0) / gray.length;
    const fRatio  = flow / (this._baselineFlow + 0.1);
    const lumDiff = this._baselineLum !== null
      ? Math.abs(lum - this._baselineLum) / (this._baselineLum + 1)
      : 0;
    const isPresent  = fRatio > 1.7 || lumDiff > 0.12;
    const confidence = Math.min(0.55, Math.max(0, (fRatio - 1) * 0.35 + lumDiff * 1.8));
    if (this.onPresence) this.onPresence(isPresent, confidence);
  }

  /**
   * FFT the flow time series, find dominant mechanical resonance, compute mass.
   * @param {number[]} frames   optical-flow magnitudes
   * @param {boolean}  report   if true, fire onWeight callback
   * @returns {{ grams, confidence, freq, snr } | null}
   */
  _analyze(frames, report) {
    if (!this.baselineFreq || frames.length < 32) return null;

    // Largest power-of-2 ≤ frames.length for FFT
    const N    = 1 << Math.floor(Math.log2(frames.length));
    const data = frames.slice(-N);

    // Detrend
    const mean = data.reduce((a, b) => a + b, 0) / N;

    // Hann window + FFT
    const win = WindowFn.hann(N);
    const re  = new Array(N).fill(0);
    const im  = new Array(N).fill(0);
    for (let i = 0; i < N; i++) re[i] = (data[i] - mean) * win[i];
    fft(re, im);

    // Magnitude spectrum
    const half = N / 2;
    const mag  = new Float64Array(half);
    for (let i = 0; i < half; i++) mag[i] = Math.sqrt(re[i] ** 2 + im[i] ** 2);

    const binHz  = this._fps / N;
    const minBin = Math.max(1, Math.floor(0.5 / binHz));  // 0.5 Hz
    const maxBin = Math.min(half - 2, Math.ceil(20 / binHz)); // 20 Hz

    // Find spectral peak in range
    let peakMag = 0, peakBin = minBin;
    for (let i = minBin; i <= maxBin; i++) {
      if (mag[i] > peakMag) { peakMag = mag[i]; peakBin = i; }
    }

    // SNR estimation
    let noiseSum = 0, cnt = 0;
    for (let i = minBin; i <= maxBin; i++) {
      if (Math.abs(i - peakBin) > 3) { noiseSum += mag[i]; cnt++; }
    }
    const noise = cnt ? noiseSum / cnt : 1;
    const snr   = peakMag / (noise || 1);
    if (snr < MIN_SNR) return null;

    const peakFreq = parabolicPeakFreq(mag, peakBin, binHz);
    if (peakFreq < 0.5 || peakFreq > 20) return null;

    const filtFreq = this._freqKalman.update(peakFreq);
    const ratio    = this.baselineFreq / filtFreq;
    const rawG     = Math.max(0, this.phoneMass * (ratio * ratio - 1));
    const smoothG  = this._massSmooth.update(rawG);

    // Base confidence from SNR, capped at MAX_CONF
    let conf = Math.min(MAX_CONF, Math.max(0, (snr - MIN_SNR) / 20 * MAX_CONF));

    // Audio cross-validation bonus: if mic and camera agree on frequency → boost
    if (this._lastAudioFreq && Math.abs(filtFreq - this._lastAudioFreq) / filtFreq < 0.15) {
      conf = Math.min(MAX_CONF + 0.10, conf + 0.10);  // up to 10% bonus
      this._crossValConf = 0.10;
    } else {
      this._crossValConf = 0;
    }

    if (report && smoothG > 0 && conf > 0.08 && this.onWeight) {
      this.onWeight(smoothG, conf);
    }
    return { grams: smoothG, confidence: conf, freq: filtFreq, snr };
  }
}

/* ── Pure helpers ───────────────────────────────────────────── */

function _toGray(data, pixelCount) {
  const g = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return g;
}

function _computeMAD(prev, curr) {
  let s = 0;
  for (let i = 0; i < prev.length; i++) s += Math.abs(curr[i] - prev[i]);
  return s / prev.length;
}

export { CameraSensor };
