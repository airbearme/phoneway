/**
 * sensors.js — Motion sensor management & Bayesian fusion for Phoneway
 *
 * Weight estimation physics:
 * ──────────────────────────
 * Phone on compliant surface (mouse-pad, notepad) = spring-mass system.
 * Added mass → surface compresses → phone tilts slightly.
 *
 *   tilt  Δθ  = m·g / (k · d)        (spring model)
 *   ΔAhoriz   = g · sin(Δθ) ≈ g · Δθ  (small angles)
 *
 * With 2-point calibration:
 *   sensitivity  = W_cal / ΔA_cal   [g / (m·s⁻²)]
 *   weight       = ΔA · sensitivity
 *
 * Sensor pipeline:
 *   raw accel → Adaptive Kalman → baseline subtract →
 *   Median → Moving Average → Particle Filter → weight estimate
 */

'use strict';

import {
  AdaptiveKalmanFilter, KalmanFilter2D, ParticleFilter,
  MovingAverageFilter, MedianFilter, ExpSmooth
} from './kalman.js';
import { 
  PrecisionMeasurement, TemperatureCompensator, OutlierRejectionFilter,
  ConvergenceDetector, MultiPointCalibration 
} from './precisionEngine.js';

/* ═══════════════════════════════════════════════════════════════
   BaselineRecorder  —  captures quiet-phone average
═══════════════════════════════════════════════════════════════ */
class BaselineRecorder {
  constructor(samples = 180) {
    this.required = samples;
    this._bufX = []; this._bufY = []; this._bufZ = [];
    this.done  = false;
    this.onComplete = null;
  }

  feed(ax, ay, az) {
    if (this.done) return;
    this._bufX.push(ax);
    this._bufY.push(ay);
    this._bufZ.push(az);
    if (this._bufX.length >= this.required) {
      this.done = true;
      const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
      if (this.onComplete) this.onComplete({ ax: avg(this._bufX), ay: avg(this._bufY), az: avg(this._bufZ) });
    }
  }

  get progress() { return Math.min(this._bufX.length / this.required, 1); }
  reset() { this._bufX = []; this._bufY = []; this._bufZ = []; this.done = false; }
}

/* ═══════════════════════════════════════════════════════════════
   MotionSensor  —  wraps DeviceMotionEvent (universal fallback)
   Uses Generic Sensor API values if fed externally by app.js
═══════════════════════════════════════════════════════════════ */
class MotionSensor {
  constructor() {
    // Filtering pipeline  (order matters!)
    this.kalman  = new KalmanFilter2D({ R: 0.3, Q: 0.008 });  // Tighter for precision
    this.median  = new MedianFilter(11);
    this.mavg    = new MovingAverageFilter(80);  // ~1.3s window at 60Hz — smoother signal
    this.particle = new ParticleFilter({ N: 300, sigmaProcess: 0.05, sigmaMeasure: 0.25 });
    
    // NEW: Precision components
    this.outlierFilter = new OutlierRejectionFilter({ sigmaThreshold: 2.0, windowSize: 15 });
    this.tempCompensator = new TemperatureCompensator();
    this.convergenceDetector = new ConvergenceDetector({ varianceThreshold: 0.005 });
    this.multiPointCal = new MultiPointCalibration();

    this.baseline    = null;
    this.sensitivity = null;   // g/(m·s⁻²) — from calibration
    this.calPoints   = [];     // [{deltaA, grams}] for least-squares
    
    // Precision tracking
    this._precisionHistory = [];
    this._currentPrecision = Infinity;

    this.active  = false;
    this._handler = null;
    this._interval = 16;       // ms, updated from event

    this.raw      = { ax: 0, ay: 0, az: 0 };
    this.filtered = { ax: 0, ay: 0 };
    this.weightG  = 0;
    this.confidence = 0;
    this.surfaceQuality = 'unknown';  // 'poor'|'ok'|'good'|'excellent'
    this.isConverged = false;

    this.onWeight = null;
    this.onRaw    = null;
    this.onPrecisionUpdate = null;
  }

  async request() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      const perm = await DeviceMotionEvent.requestPermission();
      if (perm !== 'granted') throw new Error('Motion permission denied');
    }
  }

  start() {
    if (this.active) return;
    let lastTs = null;
    this._handler = (e) => {
      // Track sample rate from event intervals
      if (e.interval) this._interval = e.interval;

      const src = e.accelerationIncludingGravity || e.acceleration || {};
      let ax = src.x != null ? src.x : 0, ay = src.y != null ? src.y : 0, az = src.z != null ? src.z : 0;

      // Normalise: ensure z > 0 when face-up (Android) vs < 0 (iOS)
      if (az < 0) { ax = -ax; ay = -ay; az = -az; }

      this.raw = { ax, ay, az };
      if (this.onRaw) this.onRaw(ax, ay, az);
      this._process(ax, ay, az);
    };
    window.addEventListener('devicemotion', this._handler, { passive: true });
    this.active = true;
  }

  stop() {
    if (!this.active) return;
    window.removeEventListener('devicemotion', this._handler);
    this.active = false;
  }

  /**
   * Allow external override from Generic Sensor API (higher quality).
   * app.js calls this when LinearAccelerationSensor fires.
   */
  injectLinearAccel(lax, lay, laz) {
    // Linear accel = hardware-gravity-removed: no baseline needed for gravity
    // Use directly as the signal (no need to subtract baseline gravity)
    const dA = Math.sqrt(lax * lax + lay * lay);
    this._applyDeltaA(dA);
  }

  _process(ax, ay, az) {
    const f = this.kalman.update(ax, ay);
    this.filtered = f;
    if (!this.baseline) return;

    const dax = f.x - this.baseline.ax;
    const day = f.y - this.baseline.ay;
    const dA  = Math.sqrt(dax * dax + day * day);
    this._applyDeltaA(dA);
  }

  _applyDeltaA(dA) {
    // Stage 1: Outlier rejection
    const cleanDA = this.outlierFilter.feed(dA);
    
    // Stage 2: Median filter for spike removal
    const medVal = this.median.update(cleanDA);
    
    // Stage 3: Moving average for smoothing
    const mavVal = this.mavg.update(medVal);
    
    // Stage 4: Particle filter for non-Gaussian noise
    const pfVal  = this.particle.update(mavVal);

    if (this.sensitivity !== null) {
      // Stage 5: Convert to grams with multi-point calibration if available
      let rawG;
      if (this.multiPointCal.coeffs) {
        rawG = this.multiPointCal.estimate(pfVal);
      } else {
        rawG = pfVal * this.sensitivity;
      }
      
      // Stage 6: Temperature compensation
      rawG = this.tempCompensator.compensate(rawG);
      
      this.weightG = Math.max(0, rawG);

      // Stage 7: Calculate confidence based on multiple factors
      const sigma = this.mavg.stdDev;
      const snr = this.weightG / (sigma * this.sensitivity + 0.001);
      const convergenceBonus = this.isConverged ? 0.15 : 0;
      this.confidence = Math.min(0.95, (1 / (1 + sigma * 50)) * 0.7 + Math.min(1, snr / 10) * 0.3 + convergenceBonus);

      // Stage 8: Track convergence
      this.isConverged = this.convergenceDetector.feed(this.weightG);
      
      // Stage 9: Track precision
      if (this.isConverged) {
        this._precisionHistory.push({
          weight: this.weightG,
          stdDev: sigma * this.sensitivity,
          time: Date.now()
        });
        if (this._precisionHistory.length > 100) this._precisionHistory.shift();
        this._currentPrecision = sigma * this.sensitivity;
        if (this.onPrecisionUpdate) this.onPrecisionUpdate(this._currentPrecision, this.weightG);
      }

      if (this.onWeight) this.onWeight(this.weightG, this.confidence);
    }
  }

  setBaseline(b) {
    this.baseline = { ax: b.ax, ay: b.ay, az: b.az };
    this._resetFilters();
  }

  _resetFilters() {
    this.kalman.reset();
    this.median.reset();
    this.mavg.reset();
    this.particle.reset();
  }

  /** Add calibration point and refit sensitivity */
  addCalPoint(knownWeightG, deltaA, options = {}) {
    const confidence = options.confidence || 0.8;
    
    // Lower threshold: 0.00005 for maximum sensitivity on hard surfaces
    if (deltaA < 0.00005) {
      console.warn('Calibration deltaA too small:', deltaA, '- using fallback sensitivity');
      deltaA = 0.0005; // Minimum viable signal
    }
    
    // Add to both linear calibration and multi-point calibration
    this.calPoints.push({ deltaA, grams: knownWeightG, confidence });
    this.multiPointCal.addPoint(knownWeightG, deltaA, confidence);
    this._fitSensitivity();

    // Classify surface quality from sensitivity
    if      (this.sensitivity < 30)  this.surfaceQuality = 'poor';
    else if (this.sensitivity < 100) this.surfaceQuality = 'ok';
    else if (this.sensitivity < 300) this.surfaceQuality = 'good';
    else                              this.surfaceQuality = 'excellent';

    return true;
  }

  /** Least-squares fit through origin for sensitivity */
  _fitSensitivity() {
    if (!this.calPoints.length) return;
    // Weighted least-squares through origin — higher-confidence points count more
    const num = this.calPoints.reduce((a, p) => a + p.confidence * p.grams * p.deltaA, 0);
    const den = this.calPoints.reduce((a, p) => a + p.confidence * p.deltaA * p.deltaA, 0);
    
    if (den > 0) {
      this.sensitivity = num / den;
    }
    
    // Fallback: ensure sensitivity is always set to a reasonable value
    if (!this.sensitivity || this.sensitivity <= 0 || !isFinite(this.sensitivity)) {
      // Default fallback based on typical phone mass (170g) and expected response
      // This ensures weighing works even if calibration partially fails
      this.sensitivity = 150; // g/(m·s²) - typical value for phones on soft surfaces
      console.warn('Using fallback sensitivity:', this.sensitivity);
    }
    
    // Clamp to reasonable range to prevent insane values
    this.sensitivity = Math.max(10, Math.min(2000, this.sensitivity));
  }

  /** Current horizontal ΔA for calibration reads */
  get deltaA() {
    if (!this.baseline) return 0;
    const dax = this.filtered.x - this.baseline.ax;
    const day = this.filtered.y - this.baseline.ay;
    return Math.sqrt(dax * dax + day * day);
  }

  get isStable() {
    return this.mavg.isFull && this.mavg.stdDev < 0.004;
  }

  get sampleRateHz() { return 1000 / (this._interval || 16); }
  
  /**
   * High-precision measurement with adaptive duration
   * @param {Object} options
   * @param {number} options.targetPrecision — target std dev in grams (default 0.05)
   * @param {number} options.timeout — max duration in ms (default 8000)
   * @param {number} options.minDuration — minimum duration in ms (default 2000)
   * @returns {Promise<{ grams: number, precision: number, confidence: number }>}
   */
  async measurePrecision(options = {}) {
    const target = options.targetPrecision || 0.05;
    const timeout = options.timeout || 8000;
    const minDuration = options.minDuration || 2000;
    
    const pm = new PrecisionMeasurement({
      targetPrecision: target,
      maxDuration: timeout,
      minDuration: minDuration
    });
    
    // Sampler function that reads current deltaA
    const sampler = async () => {
      return {
        grams: this.deltaA * (this.sensitivity || 150),
        confidence: this.confidence,
        rawDeltaA: this.deltaA
      };
    };
    
    const result = await pm.measure(sampler);
    
    // Learn temperature drift from this measurement
    this.tempCompensator.learnDrift(result.grams);
    
    return {
      grams: result.grams,
      precision: result.precision,
      confidence: result.confidence,
      samples: result.samples
    };
  }
  
  /**
   * Get current measurement precision (standard deviation in grams)
   */
  get currentPrecision() {
    return this._currentPrecision;
  }
  
  /**
   * Reset calibration and precision tracking
   */
  resetPrecisionTracking() {
    this._precisionHistory = [];
    this._currentPrecision = Infinity;
    this.convergenceDetector.reset();
    this.tempCompensator.calibrateZero(0);
  }
}

/* ═══════════════════════════════════════════════════════════════
   TouchSensor  —  pressure / area via pointer/touch events
═══════════════════════════════════════════════════════════════ */
class TouchSensor {
  constructor() {
    this.supported   = false;
    this.forceValue  = 0;
    this.weightG     = 0;
    this.confidence  = 0;
    this.active      = false;
    this._handlers   = {};
    this.sensitivity = 100;   // g per normalized force unit
    this.mavg = new MovingAverageFilter(25);
    this.onWeight = null;
  }

  start(el = document.body) {
    this._el = el;
    this._handlers.start = e => this._handle(e);
    this._handlers.move  = e => this._handle(e);
    this._handlers.end   = ()  => this._end();
    el.addEventListener('touchstart', this._handlers.start, { passive: true });
    el.addEventListener('touchmove',  this._handlers.move,  { passive: true });
    el.addEventListener('touchend',   this._handlers.end,   { passive: true });
    this.active = true;
  }

  stop() {
    if (!this._el) return;
    this._el.removeEventListener('touchstart', this._handlers.start);
    this._el.removeEventListener('touchmove',  this._handlers.move);
    this._el.removeEventListener('touchend',   this._handlers.end);
    this.active = false;
  }

  _handle(e) {
    if (!e.touches.length) return;
    const t = e.touches[0];
    let force = t.force != null ? t.force : 0;
    const hasForce = t.force !== undefined && t.force > 0;
    if (!hasForce) {
      // Fallback: contact ellipse area as proxy
      const rx = t.radiusX != null ? t.radiusX : 12;
      const ry = t.radiusY != null ? t.radiusY : 12;
      force = Math.min(Math.PI * rx * ry / 700, 1);
    }
    this.supported  = hasForce;
    this.forceValue = force;
    const avg = this.mavg.update(force);
    this.weightG    = avg * this.sensitivity;
    this.confidence = hasForce ? 0.65 : 0.2;
    if (this.onWeight) this.onWeight(this.weightG, this.confidence);
  }

  _end() {
    this.forceValue = 0;
    this.weightG    = 0;
    this.confidence = 0;
    this.mavg.reset();
    if (this.onWeight) this.onWeight(0, 0);
  }
}

/* ═══════════════════════════════════════════════════════════════
   BayesianFusion  —  proper weighted combination of all estimates
   Each source has a prior reliability weight + observed confidence
═══════════════════════════════════════════════════════════════ */
class BayesianFusion {
  constructor() {
    this.sources = new Map();  // name → { prior, estimate, confidence }
    this.smooth  = new ExpSmooth(0.07);  // Slow enough to damp per-sensor noise
    this.tare    = 0;
    this._fusing = false;  // Stack protection

    this.fusedWeight     = 0;
    this.fusedConfidence = 0;
    this.onFused = null;
  }

  register(name, prior = 1.0) {
    this.sources.set(name, { prior, estimate: 0, confidence: 0 });
  }

  update(name, estimateG, confidence) {
    const s = this.sources.get(name);
    if (!s) return;
    s.estimate   = estimateG;
    s.confidence = Math.max(0, Math.min(1, confidence));
    this._fuse();
  }

  _fuse() {
    // Prevent stack overflow from rapid sensor updates
    if (this._fusing) return;
    this._fusing = true;
    
    try {
      let num = 0, den = 0;
      for (const s of this.sources.values()) {
        const w = s.prior * s.confidence;
        num += s.estimate * w;
        den += w;
      }

      if (den < 0.0001) {
        this.fusedWeight     = 0;
        this.fusedConfidence = 0;
      } else {
        const raw            = num / den;
        this.fusedWeight     = Math.max(0, this.smooth.update(raw) - this.tare);
        this.fusedConfidence = Math.min(1, den / this.sources.size);
      }
      if (this.onFused) this.onFused(this.fusedWeight, this.fusedConfidence);
    } finally {
      this._fusing = false;
    }
  }

  setTare(g)  { this.tare = g; }
  clearTare() { this.tare = 0; }

  reset() {
    for (const s of this.sources.values()) { s.estimate = 0; s.confidence = 0; }
    this.smooth.reset();
    this.fusedWeight     = 0;
    this.fusedConfidence = 0;
  }
}

export { BaselineRecorder, MotionSensor, TouchSensor, BayesianFusion };
