/**
 * sensors.js — Sensor management & fusion for Phoneway Precision Scale
 *
 * Handles:
 *   • DeviceMotionEvent  (accelerometer + gyroscope)
 *   • DeviceOrientationEvent (tilt angles)
 *   • Touch force / contact area
 *   • Magnetometer (via Sensor API where available)
 *   • Sensor fusion: weighted combination of all available estimates
 *
 * Weight estimation physics
 * ─────────────────────────
 * When a phone sits face-up on a compliant surface (mouse-pad, notepad…),
 * adding mass m causes the surface to compress and the phone to tilt.
 *
 *   tilt change  Δθ  =  m·g / (k · d)     (spring model, k=surface stiffness)
 *   horizontal accel change  ΔA  =  g · sin(Δθ) ≈ g · Δθ  (small angles)
 *
 * After a two-point calibration (zero + known weight W_cal):
 *
 *   sensitivity  = W_cal / ΔA_cal   [g / (m·s⁻²)]
 *   weight       = ΔA · sensitivity
 *
 * Where  ΔA = √(Δax² + Δay²)  — the horizontal vector magnitude change.
 */

'use strict';

import { KalmanFilter2D, MovingAverageFilter, MedianFilter, ExpSmooth }
  from './kalman.js';

/* ═══════════════════════════════════════════════════════════════
   BaselineRecorder  —  captures quiet-phone baseline
═══════════════════════════════════════════════════════════════ */
class BaselineRecorder {
  constructor(samples = 120) {        // ~2s at 60Hz
    this.required = samples;
    this.bufX = [];
    this.bufY = [];
    this.bufZ = [];
    this.done = false;
    this.onComplete = null;           // called with { ax, ay, az }
  }

  feed(ax, ay, az) {
    if (this.done) return;
    this.bufX.push(ax);
    this.bufY.push(ay);
    this.bufZ.push(az);
    if (this.bufX.length >= this.required) {
      this.done = true;
      const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
      this.onComplete?.({ ax: avg(this.bufX), ay: avg(this.bufY), az: avg(this.bufZ) });
    }
  }

  get progress() {
    return Math.min(this.bufX.length / this.required, 1);
  }

  reset() {
    this.bufX = []; this.bufY = []; this.bufZ = [];
    this.done = false;
  }
}

/* ═══════════════════════════════════════════════════════════════
   MotionSensor  —  wraps DeviceMotionEvent
═══════════════════════════════════════════════════════════════ */
class MotionSensor {
  constructor() {
    this.kalman   = new KalmanFilter2D({ R: 0.8, Q: 0.02 });
    this.mavg     = new MovingAverageFilter(40);
    this.median   = new MedianFilter(9);
    this.smooth   = new ExpSmooth(0.12);

    this.baseline = null;             // { ax, ay, az }
    this.sensitivity = null;          // g/( m·s⁻² )  — set by calibration
    this.active   = false;
    this._handler = null;

    this.raw      = { ax: 0, ay: 0, az: 0 };
    this.filtered = { ax: 0, ay: 0 };
    this.weightG  = 0;
    this.confidence = 0;              // 0–1

    this.onWeight = null;             // callback(grams, confidence)
    this.onRaw    = null;             // callback(ax, ay, az)
  }

  async request() {
    // iOS 13+ requires explicit permission
    if (typeof DeviceMotionEvent?.requestPermission === 'function') {
      const perm = await DeviceMotionEvent.requestPermission();
      if (perm !== 'granted') throw new Error('Motion permission denied');
    }
  }

  start() {
    if (this.active) return;
    this._handler = (e) => this._onMotion(e);
    window.addEventListener('devicemotion', this._handler, { passive: true });
    this.active = true;
  }

  stop() {
    if (!this.active) return;
    window.removeEventListener('devicemotion', this._handler);
    this.active = false;
  }

  _onMotion(e) {
    // Use accelerationIncludingGravity (always available) as fallback
    const src = e.accelerationIncludingGravity || e.acceleration;
    if (!src) return;

    let ax = src.x ?? 0;
    let ay = src.y ?? 0;
    let az = src.z ?? 0;

    // Normalise sign conventions across platforms
    // Android: z ≈ +9.81 face-up   iOS: z ≈ -9.81 face-up
    if (az < 0) { ax = -ax; ay = -ay; az = -az; }

    this.raw = { ax, ay, az };
    this.onRaw?.(ax, ay, az);

    // Kalman filter the horizontal components
    const f = this.kalman.update(ax, ay);
    this.filtered = f;

    if (!this.baseline) return;

    // Horizontal deviation from baseline
    const dax = f.x - this.baseline.ax;
    const day = f.y - this.baseline.ay;
    const dA  = Math.sqrt(dax * dax + day * day);  // m·s⁻²

    // Stabilize through median → moving average
    const medVal = this.median.update(dA);
    const mavVal = this.mavg.update(medVal);
    const smVal  = this.smooth.update(mavVal);

    if (this.sensitivity !== null) {
      // Raw gram estimate
      const rawG = smVal * this.sensitivity;
      this.weightG = Math.max(0, rawG);

      // Confidence based on signal stability (low σ = high confidence)
      const sigma = this.mavg.stdDev;
      this.confidence = Math.min(1, 1 / (1 + sigma * 20));

      this.onWeight?.(this.weightG, this.confidence);
    }
  }

  setBaseline(b) {
    this.baseline = b;
    this.kalman.reset();
    this.mavg.reset();
    this.median.reset();
    this.smooth.reset();
  }

  calibrate(knownWeightG, currentDeltaA) {
    if (currentDeltaA < 0.001) return false;
    this.sensitivity = knownWeightG / currentDeltaA;
    return true;
  }

  /** Return current horizontal ΔA (for use during calibration) */
  get deltaA() {
    if (!this.baseline) return 0;
    const dax = this.filtered.x - this.baseline.ax;
    const day = this.filtered.y - this.baseline.ay;
    return Math.sqrt(dax * dax + day * day);
  }

  get isStable() {
    return this.mavg.isFull && this.mavg.stdDev < 0.003;
  }
}

/* ═══════════════════════════════════════════════════════════════
   TouchSensor  —  pressure / force via touch events
═══════════════════════════════════════════════════════════════ */
class TouchSensor {
  constructor() {
    this.supported  = false;
    this.forceValue = 0;     // 0–1 normalized
    this.weightG    = 0;
    this.confidence = 0;
    this.active     = false;
    this._handlers  = {};
    this.sensitivity = 100;  // g per unit force (calibrated separately)
    this.onWeight   = null;
    this.mavg = new MovingAverageFilter(20);
  }

  start(el) {
    this._target = el || document.body;
    this._handlers.start = (e) => this._onTouch(e);
    this._handlers.move  = (e) => this._onTouch(e);
    this._handlers.end   = ()  => this._onTouchEnd();
    this._target.addEventListener('touchstart', this._handlers.start, { passive: true });
    this._target.addEventListener('touchmove',  this._handlers.move,  { passive: true });
    this._target.addEventListener('touchend',   this._handlers.end,   { passive: true });
    this.active = true;
  }

  stop() {
    if (!this._target) return;
    this._target.removeEventListener('touchstart', this._handlers.start);
    this._target.removeEventListener('touchmove',  this._handlers.move);
    this._target.removeEventListener('touchend',   this._handlers.end);
    this.active = false;
  }

  _onTouch(e) {
    if (!e.touches.length) return;
    const t = e.touches[0];

    // iOS 3D Touch / Force Touch  — force is 0–1 (light) to 6.667 (max)
    let force = t.force ?? 0;
    if (force === 0) {
      // Fallback: use touch contact area as proxy for force
      const area = Math.PI * (t.radiusX ?? 10) * (t.radiusY ?? 10);
      // Typical finger area ~200–400 px²; map to 0–1
      force = Math.min(area / 600, 1);
    }

    this.supported  = (t.force !== undefined && t.force > 0);
    this.forceValue = force;
    const avg = this.mavg.update(force);
    this.weightG    = avg * this.sensitivity;
    this.confidence = this.supported ? 0.7 : 0.2;
    this.onWeight?.(this.weightG, this.confidence);
  }

  _onTouchEnd() {
    this.forceValue = 0;
    this.weightG    = 0;
    this.confidence = 0;
    this.mavg.reset();
    this.onWeight?.(0, 0);
  }
}

/* ═══════════════════════════════════════════════════════════════
   SensorFusion  —  weighted combination of all estimates
═══════════════════════════════════════════════════════════════ */
class SensorFusion {
  constructor() {
    this.sources = {};        // name → { weight, estimate, confidence }
    this.fusedWeight = 0;
    this.fusedConfidence = 0;
    this.tare = 0;
    this.onFused = null;      // callback(grams)
    this._smooth = new ExpSmooth(0.18);
  }

  register(name, baseWeight = 1) {
    this.sources[name] = { baseWeight, estimate: 0, confidence: 0 };
  }

  update(name, estimateG, confidence) {
    if (!this.sources[name]) return;
    this.sources[name].estimate   = estimateG;
    this.sources[name].confidence = confidence;
    this._fuse();
  }

  _fuse() {
    let numerator = 0, denominator = 0;
    for (const [, s] of Object.entries(this.sources)) {
      const w = s.baseWeight * s.confidence;
      numerator   += s.estimate * w;
      denominator += w;
    }

    if (denominator < 0.001) {
      this.fusedWeight     = 0;
      this.fusedConfidence = 0;
    } else {
      const raw = numerator / denominator;
      this.fusedWeight     = Math.max(0, this._smooth.update(raw) - this.tare);
      this.fusedConfidence = Math.min(1, denominator / Object.keys(this.sources).length);
    }

    this.onFused?.(this.fusedWeight, this.fusedConfidence);
  }

  setTare(g) { this.tare = g; }

  reset() {
    for (const k of Object.keys(this.sources)) {
      this.sources[k].estimate   = 0;
      this.sources[k].confidence = 0;
    }
    this._smooth.reset();
    this.fusedWeight     = 0;
    this.fusedConfidence = 0;
  }
}

export { BaselineRecorder, MotionSensor, TouchSensor, SensorFusion };
