/**
 * kalman.js — Filter algorithms for Phoneway Precision Scale
 *
 * Implements Kalman filtering, complementary filtering, and support
 * filters for multi-sensor fusion-based weight estimation.
 */

'use strict';

/* ─────────────────────────────────────────
   1-D Kalman Filter
   ───────────────────────────────────────── */
class KalmanFilter1D {
  /**
   * @param {object} opts
   * @param {number} opts.R  Measurement noise variance (trust sensors less → higher)
   * @param {number} opts.Q  Process noise variance    (system changes fast → higher)
   * @param {number} opts.P0 Initial estimation error covariance
   */
  constructor({ R = 1, Q = 0.05, P0 = 1 } = {}) {
    this.R = R;
    this.Q = Q;
    this.P = P0;
    this.x = null;       // state estimate
    this.initialized = false;
  }

  update(z) {
    if (!this.initialized) {
      this.x = z;
      this.initialized = true;
      return this.x;
    }
    // Predict
    const Pp = this.P + this.Q;
    // Kalman gain
    const K = Pp / (Pp + this.R);
    // Update state
    this.x = this.x + K * (z - this.x);
    this.P = (1 - K) * Pp;
    return this.x;
  }

  reset(value = 0) {
    this.x = value;
    this.P = 1;
    this.initialized = value !== null;
  }

  get value() { return this.x; }
}

/* ─────────────────────────────────────────
   Complementary Filter (accel + gyro)
   ───────────────────────────────────────── */
class ComplementaryFilter {
  /**
   * @param {number} alpha  Weight for gyroscope integration (0–1)
   *                        Higher = smoother but slower to respond to real tilt
   */
  constructor(alpha = 0.96) {
    this.alpha = alpha;
    this.angle = 0;
    this._lastTs = null;
  }

  /**
   * @param {number} gyroRate   rad/s from gyroscope around one axis
   * @param {number} accelAngle rad derived from accelerometer for same axis
   * @param {number} ts         timestamp in ms
   */
  update(gyroRate, accelAngle, ts) {
    if (this._lastTs === null) {
      this.angle = accelAngle;
      this._lastTs = ts;
      return this.angle;
    }
    const dt = (ts - this._lastTs) / 1000;
    this._lastTs = ts;
    this.angle = this.alpha * (this.angle + gyroRate * dt) +
                 (1 - this.alpha) * accelAngle;
    return this.angle;
  }

  reset() {
    this.angle = 0;
    this._lastTs = null;
  }
}

/* ─────────────────────────────────────────
   Moving Average + Std-Dev
   ───────────────────────────────────────── */
class MovingAverageFilter {
  constructor(size = 30) {
    this.size = size;
    this.buf  = [];
  }

  update(v) {
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
    return this.mean;
  }

  get mean() {
    if (!this.buf.length) return 0;
    return this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
  }

  get stdDev() {
    if (this.buf.length < 2) return 0;
    const m = this.mean;
    const v = this.buf.reduce((a, b) => a + (b - m) ** 2, 0) / this.buf.length;
    return Math.sqrt(v);
  }

  get isFull() { return this.buf.length === this.size; }

  reset() { this.buf = []; }
}

/* ─────────────────────────────────────────
   Median Filter  (good for spike rejection)
   ───────────────────────────────────────── */
class MedianFilter {
  constructor(size = 7) {
    this.size = size;
    this.buf  = [];
  }

  update(v) {
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
    const sorted = [...this.buf].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  reset() { this.buf = []; }
}

/* ─────────────────────────────────────────
   Exponential Smoothing
   ───────────────────────────────────────── */
class ExpSmooth {
  constructor(alpha = 0.15) {
    this.alpha = alpha;
    this.s = null;
  }

  update(v) {
    this.s = (this.s === null) ? v : this.alpha * v + (1 - this.alpha) * this.s;
    return this.s;
  }

  reset() { this.s = null; }
  get value() { return this.s; }
}

/* ─────────────────────────────────────────
   2-D Vector Kalman (for accel x/y together)
   ───────────────────────────────────────── */
class KalmanFilter2D {
  constructor({ R = 1.5, Q = 0.05 } = {}) {
    this.kx = new KalmanFilter1D({ R, Q });
    this.ky = new KalmanFilter1D({ R, Q });
  }

  update(x, y) {
    return {
      x: this.kx.update(x),
      y: this.ky.update(y)
    };
  }

  reset() { this.kx.reset(); this.ky.reset(); }
}

export { KalmanFilter1D, KalmanFilter2D, ComplementaryFilter,
         MovingAverageFilter, MedianFilter, ExpSmooth };
