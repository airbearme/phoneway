/**
 * kalman.js — Advanced filter algorithms for Phoneway Precision Scale
 *
 * Includes:
 *  • AdaptiveKalmanFilter  (Sage-Husa adaptive noise estimation)
 *  • ParticleFilter        (robust non-linear estimation, 300 particles)
 *  • ComplementaryFilter   (accel + gyro fusion)
 *  • MovingAverageFilter   (with variance / stddev)
 *  • MedianFilter          (spike rejection)
 *  • ExpSmooth             (fast exponential IIR)
 *  • KalmanFilter2D        (x/y together)
 *  • FFT                   (Cooley-Tukey, power-of-2 in-place)
 *  • windowFunctions       (Hann, Blackman-Harris, flat-top)
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   Adaptive Kalman Filter  (Sage-Husa algorithm)
   Automatically adjusts measurement noise R from residuals
────────────────────────────────────────────────────────────── */
class AdaptiveKalmanFilter {
  constructor({ R = 1, Q = 0.05, P0 = 1, epsilon = 0.02 } = {}) {
    this.R = R;             // measurement noise covariance
    this.Q = Q;             // process noise covariance
    this.P = P0;            // estimation error
    this.x = null;
    this.epsilon = epsilon; // forgetting factor for R adaptation (0.01–0.1)
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
    // Innovation
    const innovation = z - this.x;
    // Adapt R (Sage-Husa)
    const S = Pp + this.R;
    this.R = (1 - this.epsilon) * this.R +
              this.epsilon * (innovation * innovation - S + this.R);
    this.R = Math.max(1e-6, this.R);   // keep positive
    // Kalman gain & update
    const K = Pp / (Pp + this.R);
    this.x  = this.x + K * innovation;
    this.P  = (1 - K) * Pp;
    return this.x;
  }

  reset(v = 0) {
    this.x = v;
    this.P = 1;
    this.initialized = false;
  }

  get value() { return this.x; }
}

/* ─────────────────────────────────────────────────────────────
   Particle Filter  (Sequential Monte Carlo, 300 particles)
   Best for non-Gaussian noise and multi-modal distributions
────────────────────────────────────────────────────────────── */
class ParticleFilter {
  constructor({ N = 300, sigmaProcess = 0.15, sigmaMeasure = 0.6 } = {}) {
    this.N             = N;
    this.sigmaProcess  = sigmaProcess;
    this.sigmaMeasure  = sigmaMeasure;
    this.particles     = new Float64Array(N);
    this.weights       = new Float64Array(N).fill(1 / N);
    this.initialized   = false;
  }

  init(mean, spread = 2) {
    for (let i = 0; i < this.N; i++) {
      this.particles[i] = mean + this._randn() * spread;
    }
    this.weights.fill(1 / this.N);
    this.initialized = true;
  }

  update(z) {
    if (!this.initialized) { this.init(z); return z; }

    // Propagate through process model (random walk)
    for (let i = 0; i < this.N; i++) {
      this.particles[i] += this._randn() * this.sigmaProcess;
    }

    // Weight by Gaussian likelihood
    let sum = 0;
    const inv2s2 = 1 / (2 * this.sigmaMeasure * this.sigmaMeasure);
    for (let i = 0; i < this.N; i++) {
      const e = z - this.particles[i];
      this.weights[i] *= Math.exp(-e * e * inv2s2);
      sum += this.weights[i];
    }

    // Normalize
    if (sum < 1e-300) {
      // Weight collapse — reinitialize near measurement
      this.init(z, this.sigmaMeasure * 3);
      return z;
    }
    for (let i = 0; i < this.N; i++) this.weights[i] /= sum;

    // Resample if Neff < N/2  (systematic resampling)
    if (this._nEff() < this.N * 0.5) this._resample();

    return this.mean;
  }

  get mean() {
    let m = 0;
    for (let i = 0; i < this.N; i++) m += this.particles[i] * this.weights[i];
    return m;
  }

  get stdDev() {
    const m = this.mean;
    let v = 0;
    for (let i = 0; i < this.N; i++) v += this.weights[i] * (this.particles[i] - m) ** 2;
    return Math.sqrt(v);
  }

  _nEff() {
    let s = 0;
    for (let i = 0; i < this.N; i++) s += this.weights[i] ** 2;
    return 1 / s;
  }

  _resample() {
    const N = this.N;
    const cumW = new Float64Array(N);
    cumW[0] = this.weights[0];
    for (let i = 1; i < N; i++) cumW[i] = cumW[i-1] + this.weights[i];

    const newP = new Float64Array(N);
    const step = 1 / N;
    let u = Math.random() * step;
    let j = 0;
    for (let i = 0; i < N; i++) {
      while (j < N - 1 && cumW[j] < u) j++;
      newP[i] = this.particles[j];
      u += step;
    }
    this.particles = newP;
    this.weights.fill(1 / N);
  }

  _randn() {
    const u = Math.max(1e-10, Math.random());
    const v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  reset() { this.initialized = false; }
}

/* ─────────────────────────────────────────────────────────────
   Complementary Filter  (accel + gyro angle fusion)
────────────────────────────────────────────────────────────── */
class ComplementaryFilter {
  constructor(alpha = 0.96) {
    this.alpha  = alpha;
    this.angle  = 0;
    this._lastTs = null;
  }

  update(gyroRate, accelAngle, ts) {
    if (this._lastTs === null) { this.angle = accelAngle; this._lastTs = ts; return this.angle; }
    const dt = (ts - this._lastTs) / 1000;
    this._lastTs = ts;
    this.angle = this.alpha * (this.angle + gyroRate * dt) + (1 - this.alpha) * accelAngle;
    return this.angle;
  }

  reset() { this.angle = 0; this._lastTs = null; }
}

/* ─────────────────────────────────────────────────────────────
   Moving Average + variance  (circular buffer)
────────────────────────────────────────────────────────────── */
class MovingAverageFilter {
  constructor(size = 40) {
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

  get variance() {
    if (this.buf.length < 2) return 0;
    const m = this.mean;
    return this.buf.reduce((a, b) => a + (b - m) ** 2, 0) / this.buf.length;
  }

  get stdDev() { return Math.sqrt(this.variance); }
  get isFull()  { return this.buf.length === this.size; }
  reset() { this.buf = []; }
}

/* ─────────────────────────────────────────────────────────────
   Median Filter  (spike/outlier rejection)
────────────────────────────────────────────────────────────── */
class MedianFilter {
  constructor(size = 9) {
    this.size = size;
    this.buf  = [];
  }

  update(v) {
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
    const s = [...this.buf].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  reset() { this.buf = []; }
}

/* ─────────────────────────────────────────────────────────────
   Exponential Smoother  (fast single-pole IIR)
────────────────────────────────────────────────────────────── */
class ExpSmooth {
  constructor(alpha = 0.15) { this.alpha = alpha; this.s = null; }
  update(v) { this.s = (this.s === null) ? v : this.alpha * v + (1 - this.alpha) * this.s; return this.s; }
  get value() { return this.s; }
  reset() { this.s = null; }
}

/* ─────────────────────────────────────────────────────────────
   2-D Kalman (x/y paired, useful for horizontal accel)
────────────────────────────────────────────────────────────── */
class KalmanFilter2D {
  constructor({ R = 1, Q = 0.05 } = {}) {
    this.kx = new AdaptiveKalmanFilter({ R, Q });
    this.ky = new AdaptiveKalmanFilter({ R, Q });
  }

  update(x, y) {
    return { x: this.kx.update(x), y: this.ky.update(y) };
  }

  reset() { this.kx.reset(); this.ky.reset(); }
}

/* ─────────────────────────────────────────────────────────────
   Cooley-Tukey FFT  (in-place, power-of-2 only)
────────────────────────────────────────────────────────────── */
function fft(re, im) {
  const N = re.length;
  if (N <= 1) return;

  // Bit-reversal
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Butterfly stages
  for (let len = 2; len <= N; len <<= 1) {
    const ang  = -2 * Math.PI / len;
    const wRe  = Math.cos(ang);
    const wIm  = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cRe = 1, cIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + half] * cRe - im[i + k + half] * cIm;
        const vIm = re[i + k + half] * cIm + im[i + k + half] * cRe;
        re[i + k]        = uRe + vRe;
        im[i + k]        = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;
        const nRe = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = nRe;
      }
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   Window functions  (for FFT spectral leakage reduction)
────────────────────────────────────────────────────────────── */
const WindowFn = {
  hann(N) {
    return Array.from({ length: N }, (_, i) => 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1))));
  },
  blackmanHarris(N) {
    const a = [0.35875, 0.48829, 0.14128, 0.01168];
    return Array.from({ length: N }, (_, i) => {
      const x = 2 * Math.PI * i / (N - 1);
      return a[0] - a[1]*Math.cos(x) + a[2]*Math.cos(2*x) - a[3]*Math.cos(3*x);
    });
  },
  flatTop(N) {
    const a = [0.21557895, 0.41663158, 0.27726316, 0.08357895, 0.00694737];
    return Array.from({ length: N }, (_, i) => {
      const x = 2 * Math.PI * i / (N - 1);
      return a[0] - a[1]*Math.cos(x) + a[2]*Math.cos(2*x) - a[3]*Math.cos(3*x) + a[4]*Math.cos(4*x);
    });
  }
};

/**
 * Peak frequency via parabolic interpolation (better than bin-nearest)
 * @param {Float64Array} magnitudes
 * @param {number}       peakIdx
 * @param {number}       binHz
 * @returns {number}     interpolated frequency
 */
function parabolicPeakFreq(magnitudes, peakIdx, binHz) {
  const i = peakIdx;
  if (i <= 0 || i >= magnitudes.length - 1) return i * binHz;
  const y1 = magnitudes[i - 1];
  const y2 = magnitudes[i];
  const y3 = magnitudes[i + 1];
  const denom = y1 - 2 * y2 + y3;
  if (Math.abs(denom) < 1e-10) return i * binHz;
  const delta = 0.5 * (y1 - y3) / denom;
  return (i + delta) * binHz;
}

export {
  AdaptiveKalmanFilter, ParticleFilter, ComplementaryFilter,
  MovingAverageFilter, MedianFilter, ExpSmooth, KalmanFilter2D,
  fft, WindowFn, parabolicPeakFreq
};
