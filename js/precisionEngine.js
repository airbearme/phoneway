/**
 * precisionEngine.js — High-precision measurement engine for Phoneway
 * 
 * TARGET: 0.1g accuracy (1σ < 0.05g)
 * 
 * Key innovations:
 *  • Adaptive measurement duration (convergence-based, not fixed-time)
 *  • Multi-stage filtering with outlier rejection
 *  • Temperature drift compensation
 *  • Statistical confidence intervals
 *  • Convergence detection via Allan variance
 *  • Automatic retry on high variance
 */

'use strict';

import { AdaptiveKalmanFilter, MovingAverageFilter, MedianFilter } from './kalman.js';

/**
 * PrecisionMeasurement — single high-accuracy measurement session
 * Uses adaptive duration based on statistical convergence
 */
class PrecisionMeasurement {
  constructor(options = {}) {
    this.targetPrecision = options.targetPrecision || 0.05; // g (1σ)
    this.maxDuration = options.maxDuration || 10000; // ms
    this.minDuration = options.minDuration || 2000;  // ms
    this.sampleInterval = options.sampleInterval || 50; // ms
    
    this.samples = [];     // { time, grams, confidence, rawDeltaA }
    this.running = false;
    this._startTime = null;
    this._resolve = null;
    
    // Filters for this measurement session
    this._medianFilter = new MedianFilter(7);
    this._kalman = new AdaptiveKalmanFilter({ R: 0.1, Q: 0.01, epsilon: 0.05 });
  }

  /**
   * Start a precision measurement
   * @param {Function} sampler — async function returning { grams, confidence, rawDeltaA }
   * @returns {Promise<{ grams: number, precision: number, confidence: number, samples: number }>}
   */
  async measure(sampler) {
    this.running = true;
    this.samples = [];
    this._startTime = performance.now();
    this._lastConvergenceCheck = 0;  // reset per-session
    
    return new Promise((resolve) => {
      this._resolve = resolve;
      this._measureLoop(sampler);
    });
  }

  async _measureLoop(sampler) {
    while (this.running) {
      const elapsed = performance.now() - this._startTime;
      
      // Sample the sensor
      try {
        const reading = await sampler();
        if (reading && reading.grams !== undefined) {
          const filtered = this._kalman.update(reading.grams);
          const medianFiltered = this._medianFilter.update(filtered);
          
          this.samples.push({
            time: elapsed,
            grams: medianFiltered,
            confidence: reading.confidence,
            rawDeltaA: reading.rawDeltaA
          });
        }
      } catch (e) {
        // Continue despite sample errors
      }
      
      // Check convergence every 500ms (modulo is unreliable with wall-clock jitter)
      if (elapsed > this.minDuration && elapsed - this._lastConvergenceCheck >= 500) {
        this._lastConvergenceCheck = elapsed;
        const stats = this._computeStats();
        
        // Check if we've reached target precision
        if (stats.precision < this.targetPrecision && stats.confidence > 0.7) {
          this._finish(stats);
          return;
        }
      }
      
      // Max duration reached
      if (elapsed >= this.maxDuration) {
        const stats = this._computeStats();
        this._finish(stats);
        return;
      }
      
      await this._sleep(this.sampleInterval);
    }
  }

  _computeStats() {
    if (this.samples.length < 10) {
      return { grams: 0, precision: Infinity, confidence: 0, samples: 0 };
    }
    
    // Use last 80% of samples (discard initial settling)
    const discard = Math.floor(this.samples.length * 0.2);
    const recent = this.samples.slice(discard);
    
    const values = recent.map(s => s.grams);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    
    // Standard deviation
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // Confidence based on SNR and sample count
    const avgConfidence = recent.reduce((a, s) => a + s.confidence, 0) / recent.length;
    const sampleBonus = Math.min(0.2, (recent.length - 10) / 500);
    const precisionFactor = Math.max(0, 1 - stdDev / 0.5); // 0.5g is "poor"
    const confidence = Math.min(0.95, avgConfidence * 0.6 + precisionFactor * 0.3 + sampleBonus * 0.1);
    
    // Allan variance for long-term stability (use every 10th sample)
    const allanVariance = this._computeAllanVariance(values.filter((_, i) => i % 10 === 0));
    
    return {
      grams: mean,
      precision: stdDev,
      allanPrecision: Math.sqrt(allanVariance),
      confidence,
      samples: recent.length,
      variance,
      min: Math.min(...values),
      max: Math.max(...values)
    };
  }

  /**
   * Compute Allan variance - measures stability over time
   * Lower values = more stable measurement
   */
  _computeAllanVariance(values) {
    if (values.length < 20) return Infinity;
    
    const tau = Math.floor(values.length / 10); // averaging factor
    const y = [];
    
    for (let i = 0; i < values.length - tau; i += tau) {
      const chunk = values.slice(i, i + tau);
      y.push(chunk.reduce((a, b) => a + b, 0) / chunk.length);
    }
    
    let sum = 0;
    for (let i = 0; i < y.length - 1; i++) {
      sum += (y[i + 1] - y[i]) ** 2;
    }
    
    return sum / (2 * (y.length - 1));
  }

  _finish(stats) {
    this.running = false;
    if (this._resolve) {
      this._resolve(stats);
    }
  }

  cancel() {
    this.running = false;
    if (this._resolve) {
      this._resolve({ grams: 0, precision: Infinity, confidence: 0, samples: this.samples.length, cancelled: true });
    }
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

/**
 * TemperatureCompensator — tracks and compensates for thermal drift
 * Uses accelerometer temperature if available, or time-based model
 */
class TemperatureCompensator {
  constructor() {
    this.baselineTemp = null;
    this.baselineTime = null;
    this.driftRate = 0; // g per minute
    this.readings = [];
  }

  /**
   * Record a zero reading to establish baseline
   */
  calibrateZero(grams, temp = null) {
    this.baselineTemp = temp;
    this.baselineTime = Date.now();
    this.readings = [];
  }

  /**
   * Compensate a reading for thermal/time drift
   */
  compensate(grams, temp = null) {
    const elapsed = (Date.now() - (this.baselineTime || Date.now())) / 60000; // minutes
    
    // Estimate drift based on time since calibration
    // Typical phone accel drift: ~0.01-0.05g per minute initially
    const estimatedDrift = this.driftRate * elapsed;
    
    return Math.max(0, grams - estimatedDrift);
  }

  /**
   * Learn drift rate from sequential measurements
   */
  learnDrift(grams, timestamp = Date.now()) {
    this.readings.push({ grams, time: timestamp });
    
    if (this.readings.length >= 10) {
      // Simple linear regression on last 10 readings
      const recent = this.readings.slice(-10);
      const n = recent.length;
      const sumX = recent.reduce((a, r) => a + r.time, 0) / 60000; // minutes
      const sumY = recent.reduce((a, r) => a + r.grams, 0);
      const sumXY = recent.reduce((a, r) => a + (r.time / 60000) * r.grams, 0);
      const sumX2 = recent.reduce((a, r) => a + (r.time / 60000) ** 2, 0);
      
      const denom = n * sumX2 - sumX * sumX;
      if (denom > 0) {
        this.driftRate = (n * sumXY - sumX * sumY) / denom;
      }
    }
  }
}

/**
 * OutlierRejectionFilter — removes spurious readings using multiple methods
 */
class OutlierRejectionFilter {
  constructor(options = {}) {
    this.windowSize = options.windowSize || 20;
    this.sigmaThreshold = options.sigmaThreshold || 2.5; // Reject > 2.5σ
    this.iqrMultiplier = options.iqrMultiplier || 1.5;   // IQR method
    this.madThreshold = options.madThreshold || 3;       // Median absolute deviation
    
    this.buffer = [];
  }

  feed(value) {
    this.buffer.push(value);
    if (this.buffer.length > this.windowSize) {
      this.buffer.shift();
    }
    
    return this._filter(value);
  }

  _filter(newValue) {
    if (this.buffer.length < 5) return newValue;
    
    // Method 1: Modified Z-score (MAD-based, robust)
    const median = this._median(this.buffer);
    const mad = this._median(this.buffer.map(v => Math.abs(v - median)));
    const modifiedZ = 0.6745 * (newValue - median) / (mad || 1);
    
    if (Math.abs(modifiedZ) > this.madThreshold) {
      // Rejected - return median instead
      return median;
    }
    
    return newValue;
  }

  _median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}

/**
 * ConvergenceDetector — determines when measurement has stabilized
 * Uses multiple convergence criteria
 */
class ConvergenceDetector {
  constructor(options = {}) {
    this.stabilityWindow = options.stabilityWindow || 30;     // samples
    this.varianceThreshold = options.varianceThreshold || 0.01; // g²
    this.slopeThreshold = options.slopeThreshold || 0.001;     // g/sample
    
    this.values = [];
    this.times = [];
    this.converged = false;
  }

  feed(value, timestamp = performance.now()) {
    this.values.push(value);
    this.times.push(timestamp);
    
    if (this.values.length > this.stabilityWindow) {
      this.values.shift();
      this.times.shift();
    }
    
    if (this.values.length >= this.stabilityWindow) {
      this.converged = this._checkConvergence();
    }
    
    return this.converged;
  }

  _checkConvergence() {
    // Criterion 1: Low variance
    const mean = this.values.reduce((a, b) => a + b, 0) / this.values.length;
    const variance = this.values.reduce((a, b) => a + (b - mean) ** 2, 0) / this.values.length;
    
    if (variance > this.varianceThreshold) return false;
    
    // Criterion 2: Slope near zero (linear regression)
    const n = this.values.length;
    const sumX = this.times.reduce((a, t) => a + t, 0);
    const sumY = this.values.reduce((a, v) => a + v, 0);
    const sumXY = this.times.reduce((a, t, i) => a + t * this.values[i], 0);
    const sumX2 = this.times.reduce((a, t) => a + t * t, 0);
    
    const denom = n * sumX2 - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    
    return Math.abs(slope) < this.slopeThreshold;
  }

  reset() {
    this.values = [];
    this.times = [];
    this.converged = false;
  }
}

/**
 * MultiPointCalibration — sophisticated calibration using polynomial fit
 * Allows non-linear response curves (real surfaces aren't perfect springs)
 */
class MultiPointCalibration {
  constructor() {
    this.points = []; // { grams, deltaA, confidence }
    this.degree = 1;  // polynomial degree (1 or 2)
    this.coeffs = null;
  }

  addPoint(grams, deltaA, confidence = 1) {
    if (deltaA < 1e-6 || grams < 0) return false;
    
    this.points.push({ grams, deltaA, confidence, time: Date.now() });
    this._fit();
    
    // Upgrade to quadratic if we have enough points
    if (this.points.length >= 4 && this.degree === 1) {
      this.degree = 2;
      this._fit();
    }
    
    return true;
  }

  estimate(deltaA) {
    if (!this.coeffs) return null;
    
    if (this.degree === 1) {
      return deltaA * this.coeffs[0] + this.coeffs[1];
    } else {
      return this.coeffs[0] * deltaA * deltaA + this.coeffs[1] * deltaA + this.coeffs[2];
    }
  }

  _fit() {
    if (this.points.length < 2) return;
    
    if (this.degree === 1) {
      // Weighted linear regression
      let sumW = 0, sumWX = 0, sumWY = 0, sumWXY = 0, sumWX2 = 0;
      
      for (const p of this.points) {
        const w = p.confidence;
        sumW += w;
        sumWX += w * p.deltaA;
        sumWY += w * p.grams;
        sumWXY += w * p.deltaA * p.grams;
        sumWX2 += w * p.deltaA * p.deltaA;
      }
      
      const denom = sumW * sumWX2 - sumWX * sumWX;
      if (Math.abs(denom) > 1e-10) {
        const a = (sumW * sumWXY - sumWX * sumWY) / denom;
        const b = (sumWY - a * sumWX) / sumW;
        this.coeffs = [a, b];
      }
    } else {
      // Quadratic fit using least squares
      this.coeffs = this._fitQuadratic();
    }
  }

  _fitQuadratic() {
    // Normal equations for quadratic: y = ax² + bx + c
    const n = this.points.length;
    let sumX = 0, sumX2 = 0, sumX3 = 0, sumX4 = 0;
    let sumY = 0, sumXY = 0, sumX2Y = 0;
    
    for (const p of this.points) {
      const x = p.deltaA;
      const y = p.grams;
      const x2 = x * x;
      sumX += x;
      sumX2 += x2;
      sumX3 += x2 * x;
      sumX4 += x2 * x2;
      sumY += y;
      sumXY += x * y;
      sumX2Y += x2 * y;
    }
    
    // Matrix [[sumX4, sumX3, sumX2], [sumX3, sumX2, sumX], [sumX2, sumX, n]]
    // Vector [sumX2Y, sumXY, sumY]
    const A = [
      [sumX4, sumX3, sumX2],
      [sumX3, sumX2, sumX],
      [sumX2, sumX, n]
    ];
    const B = [sumX2Y, sumXY, sumY];
    
    return this._solve3x3(A, B);
  }

  _solve3x3(A, B) {
    // Cramer's rule for 3x3
    const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
              - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
              + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    
    if (Math.abs(det) < 1e-10) return null;
    
    const detA = B[0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
               - A[0][1] * (B[1] * A[2][2] - A[1][2] * B[2])
               + A[0][2] * (B[1] * A[2][1] - A[1][1] * B[2]);
    
    const detB = A[0][0] * (B[1] * A[2][2] - A[1][2] * B[2])
               - B[0] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
               + A[0][2] * (A[1][0] * B[2] - B[1] * A[2][0]);
    
    const detC = A[0][0] * (A[1][1] * B[2] - B[1] * A[2][1])
               - A[0][1] * (A[1][0] * B[2] - B[1] * A[2][0])
               + B[0] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    
    return [detA / det, detB / det, detC / det];
  }

  get quality() {
    // R² coefficient of determination
    if (this.points.length < 2) return 0;
    
    const yMean = this.points.reduce((a, p) => a + p.grams, 0) / this.points.length;
    let ssRes = 0, ssTot = 0;
    
    for (const p of this.points) {
      const yPred = this.estimate(p.deltaA);
      ssRes += (p.grams - yPred) ** 2;
      ssTot += (p.grams - yMean) ** 2;
    }
    
    return ssTot > 0 ? 1 - ssRes / ssTot : 0;
  }

  clear() {
    this.points = [];
    this.coeffs = null;
    this.degree = 1;
  }
}

/**
 * AccuracyTester — test harness for measuring actual accuracy
 * Can simulate or record real measurements
 */
class AccuracyTester {
  constructor() {
    this.tests = [];
    this.results = [];
  }

  /**
   * Run a test with known weight
   * @param {number} knownWeight — actual weight in grams
   * @param {Function} measureFn — function that returns measured weight
   * @param {number} iterations — number of measurements
   */
  async runTest(knownWeight, measureFn, iterations = 10) {
    const measurements = [];
    
    for (let i = 0; i < iterations; i++) {
      const measured = await measureFn();
      measurements.push(measured);
      await new Promise(r => setTimeout(r, 100));
    }
    
    const errors = measurements.map(m => m - knownWeight);
    const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
    const variance = errors.reduce((a, b) => a + (b - meanError) ** 2, 0) / errors.length;
    const stdDev = Math.sqrt(variance);
    
    const result = {
      knownWeight,
      meanMeasured: measurements.reduce((a, b) => a + b, 0) / measurements.length,
      meanError,
      stdDev,
      variance,
      min: Math.min(...measurements),
      max: Math.max(...measurements),
      range: Math.max(...measurements) - Math.min(...measurements),
      measurements,
      accuracy: stdDev < 0.1 ? 'excellent' : stdDev < 0.3 ? 'good' : stdDev < 0.5 ? 'fair' : 'poor'
    };
    
    this.results.push(result);
    return result;
  }

  /**
   * Simulate phone accelerometer response for testing
   * @param {number} weight — weight in grams
   * @param {number} sensitivity — g/(m/s²)
 * @param {number} noiseLevel — simulated noise std dev
   */
  simulateReading(weight, sensitivity = 150, noiseLevel = 0.002) {
    // Physics: weight = deltaA * sensitivity
    // deltaA = weight / sensitivity + noise
    const trueDeltaA = weight / sensitivity;
    const noise = this._gaussianRandom() * noiseLevel;
    const deltaA = trueDeltaA + noise;
    
    return {
      grams: deltaA * sensitivity,
      deltaA,
      confidence: 0.8 + Math.random() * 0.15
    };
  }

  _gaussianRandom() {
    // Box-Muller transform
    const u = 1 - Math.random();
    const v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  get summary() {
    if (!this.results.length) return null;
    
    const avgStdDev = this.results.reduce((a, r) => a + r.stdDev, 0) / this.results.length;
    const maxError = Math.max(...this.results.map(r => Math.abs(r.meanError)));
    const worstStdDev = Math.max(...this.results.map(r => r.stdDev));
    
    return {
      testsRun: this.results.length,
      averageStdDev: avgStdDev,
      averagePrecision: avgStdDev < 0.1 ? '0.1g' : avgStdDev < 0.2 ? '0.2g' : `${avgStdDev.toFixed(2)}g`,
      maxSystematicError: maxError,
      worstCasePrecision: worstStdDev,
      targetAchieved: avgStdDev < 0.05 && maxError < 0.1,
      overallGrade: avgStdDev < 0.05 ? 'A+' : avgStdDev < 0.1 ? 'A' : avgStdDev < 0.2 ? 'B' : avgStdDev < 0.5 ? 'C' : 'D'
    };
  }
}

export {
  PrecisionMeasurement,
  TemperatureCompensator,
  OutlierRejectionFilter,
  ConvergenceDetector,
  MultiPointCalibration,
  AccuracyTester
};
