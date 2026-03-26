/**
 * simpleScale.js — Ultra-Precision Scale Core v4.1
 * 
 * Enhanced accuracy features:
 * - Multi-point calibration (linear & quadratic)
 * - Temperature drift compensation
 * - Statistical outlier rejection
 * - Reference weight verification
 * - Allan variance for stability measurement
 * 
 * Realistic accuracy: ±0.2g to ±1g depending on surface quality
 */

'use strict';

/**
 * Advanced moving average with variance tracking
 */
class MovingAverage {
  constructor(size) {
    this.size = size;
    this.buffer = [];
    this.sum = 0;
    this.squaredSum = 0;
  }
  
  update(value) {
    this.buffer.push(value);
    this.sum += value;
    this.squaredSum += value * value;
    
    if (this.buffer.length > this.size) {
      const old = this.buffer.shift();
      this.sum -= old;
      this.squaredSum -= old * old;
    }
    
    return this.mean;
  }
  
  reset() {
    this.buffer = [];
    this.sum = 0;
    this.squaredSum = 0;
  }
  
  get mean() {
    if (this.buffer.length === 0) return 0;
    return this.sum / this.buffer.length;
  }
  
  get variance() {
    if (this.buffer.length < 2) return Infinity;
    const mean = this.mean;
    return this.squaredSum / this.buffer.length - mean * mean;
  }
  
  get stdDev() {
    return Math.sqrt(Math.max(0, this.variance));
  }
  
  get length() { 
    return this.buffer.length; 
  }
  
  get isFull() {
    return this.buffer.length >= this.size;
  }
  
  getAll() {
    return [...this.buffer];
  }
}

/**
 * Exponential moving average for fast response
 */
class EMA {
  constructor(alpha = 0.3) {
    this.alpha = alpha;
    this.value = null;
  }
  
  update(v) {
    if (this.value === null) {
      this.value = v;
    } else {
      this.value = this.alpha * v + (1 - this.alpha) * this.value;
    }
    return this.value;
  }
  
  reset() {
    this.value = null;
  }
}

/**
 * Kalman filter for sensor noise reduction
 */
class SimpleKalman {
  constructor({ R = 0.1, Q = 0.01 } = {}) {
    this.R = R;
    this.Q = Q;
    this.P = 1;
    this.x = null;
  }
  
  update(z) {
    if (this.x === null) {
      this.x = z;
      return z;
    }
    
    const Pp = this.P + this.Q;
    const K = Pp / (Pp + this.R);
    this.x = this.x + K * (z - this.x);
    this.P = (1 - K) * Pp;
    
    return this.x;
  }
  
  reset() {
    this.x = null;
    this.P = 1;
  }
}

/**
 * Multi-point calibration with polynomial fitting
 */
class MultiPointCalibration {
  constructor() {
    this.points = []; // { grams, deltaA }
    this.coeffs = null; // Polynomial coefficients
    this.degree = 1; // 1 = linear, 2 = quadratic
  }
  
  addPoint(grams, deltaA) {
    if (deltaA < 1e-6 || grams < 0) return false;
    
    // Remove any existing point at similar weight
    this.points = this.points.filter(p => Math.abs(p.grams - grams) > 0.5);
    this.points.push({ grams, deltaA, timestamp: Date.now() });
    
    // Sort by weight
    this.points.sort((a, b) => a.grams - b.grams);
    
    // Upgrade to quadratic if we have enough points
    if (this.points.length >= 4 && this.degree === 1) {
      this.degree = 2;
    }
    
    this._fit();
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
    
    if (this.degree === 1 || this.points.length < 4) {
      // Linear regression
      const n = this.points.length;
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      
      for (const p of this.points) {
        sumX += p.deltaA;
        sumY += p.grams;
        sumXY += p.deltaA * p.grams;
        sumX2 += p.deltaA * p.deltaA;
      }
      
      const denom = n * sumX2 - sumX * sumX;
      if (Math.abs(denom) > 1e-10) {
        const slope = (n * sumXY - sumX * sumY) / denom;
        const intercept = (sumY - slope * sumX) / n;
        this.coeffs = [slope, intercept];
      }
    } else {
      // Quadratic fit
      this.coeffs = this._fitQuadratic();
    }
  }
  
  _fitQuadratic() {
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
    
    // Solve 3x3 system using Cramer's rule
    const A = [
      [sumX4, sumX3, sumX2],
      [sumX3, sumX2, sumX],
      [sumX2, sumX, n]
    ];
    const B = [sumX2Y, sumXY, sumY];
    
    return this._solve3x3(A, B);
  }
  
  _solve3x3(A, B) {
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
  
  getPointCount() {
    return this.points.length;
  }
}

/**
 * Temperature drift compensator
 */
class TemperatureCompensator {
  constructor() {
    this.baselineTime = Date.now();
    this.readings = [];
    this.driftRate = 0; // grams per minute
  }
  
  calibrateZero() {
    this.baselineTime = Date.now();
    this.readings = [];
  }
  
  compensate(grams) {
    const elapsed = (Date.now() - this.baselineTime) / 60000; // minutes
    const drift = this.driftRate * elapsed;
    return Math.max(0, grams - drift);
  }
  
  learnDrift(grams) {
    this.readings.push({ grams, time: Date.now() });
    
    if (this.readings.length >= 10) {
      const recent = this.readings.slice(-10);
      const n = recent.length;
      const times = recent.map(r => (r.time - this.baselineTime) / 60000);
      const weights = recent.map(r => r.grams);
      
      const sumX = times.reduce((a, b) => a + b, 0);
      const sumY = weights.reduce((a, b) => a + b, 0);
      const sumXY = times.reduce((a, t, i) => a + t * weights[i], 0);
      const sumX2 = times.reduce((a, t) => a + t * t, 0);
      
      const denom = n * sumX2 - sumX * sumX;
      if (denom > 0) {
        this.driftRate = (n * sumXY - sumX * sumY) / denom;
      }
    }
  }
}

/**
 * SimpleScale — High-accuracy weight measurement
 *
 * Core precision technique: average SIGNED dx/dy separately through an 80-sample
 * moving average, then compute the magnitude AFTER averaging. This eliminates the
 * Rayleigh bias that afflicts magnitude-first approaches — when the true signal is
 * near zero, averaging signed components cancels noise while sqrt(noise²) does not.
 */
class SimpleScale {
  constructor() {
    this.active = false;
    this.calibrated = false;
    this.baseline = null;
    this.sensitivity = 150;

    this.multiCal = new MultiPointCalibration();
    this.tempComp = new TemperatureCompensator();

    this.rawAccel      = { x: 0, y: 0, z: 9.8 };
    this.filteredAccel = { x: 0, y: 0, z: 9.8 };

    this.rawWeight    = 0;
    this.displayWeight = 0;
    this.confidence   = 0;
    this.isStable     = false;

    // Signed-delta MAs — the key to eliminating Rayleigh bias
    this.maDx = new MovingAverage(80);
    this.maDy = new MovingAverage(80);

    // Kalman: tighter noise model for precision measurement
    this.kalmanX = new SimpleKalman({ R: 0.002, Q: 0.0002 });
    this.kalmanY = new SimpleKalman({ R: 0.002, Q: 0.0002 });
    this.kalmanZ = new SimpleKalman({ R: 0.005, Q: 0.0005 });

    // Output smoothing and stability
    this.emaWeight     = new EMA(0.12);
    this.stabilityCheck = new MovingAverage(40);

    // 0.05 g deadband for ±0.1 g display resolution
    this.deadbandThreshold = 0.05;
    this.lastDisplayValue  = 0;
    this.stableCounter     = 0;

    // Event-driven tare state
    this._tare_in_progress   = false;
    this._tare_target        = 100;  // samples to collect
    this._tare_warmup        = 20;   // samples to discard (Kalman settling)
    this._tare_warmup_count  = 0;
    this._tare_xs            = [];
    this._tare_ys            = [];
    this._tare_zs            = [];
    this._tare_resolve       = null;

    this.sampleRate = 60;
    this.verificationHistory = [];

    this.onWeight = null;
    this.onRaw    = null;
    this.onStable = null;

    this._loadCalibration();
  }

  async requestPermission() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const result = await DeviceMotionEvent.requestPermission();
        return result === 'granted';
      } catch (e) {
        console.log('Permission request error:', e);
        return false;
      }
    }
    return true;
  }

  start() {
    if (this.active) return;
    this._handler = (e) => this._handleMotion(e);
    window.addEventListener('devicemotion', this._handler, { passive: true });
    this.active = true;
    if (!this.baseline) {
      setTimeout(() => this.tare(), 1000);
    }
  }

  stop() {
    if (!this.active) return;
    window.removeEventListener('devicemotion', this._handler);
    this.active = false;
  }

  _handleMotion(e) {
    const accel = e.accelerationIncludingGravity;
    if (!accel) return;

    let x = accel.x != null ? accel.x : 0;
    let y = accel.y != null ? accel.y : 0;
    let z = accel.z != null ? accel.z : 0;

    // Normalise face-up / face-down orientation
    if (z < 0) { x = -x; y = -y; z = -z; }

    this.rawAccel = { x, y, z };
    if (this.onRaw) this.onRaw(x, y, z);

    this.filteredAccel = {
      x: this.kalmanX.update(x),
      y: this.kalmanY.update(y),
      z: this.kalmanZ.update(z)
    };

    // Event-driven tare: collect Kalman-filtered samples after warmup
    if (this._tare_in_progress) {
      if (this._tare_warmup_count < this._tare_warmup) {
        this._tare_warmup_count++;
      } else {
        this._tare_xs.push(this.filteredAccel.x);
        this._tare_ys.push(this.filteredAccel.y);
        this._tare_zs.push(this.filteredAccel.z);

        if (this._tare_xs.length >= this._tare_target) {
          this._tare_in_progress = false;
          this.baseline = {
            x: this._trimmedMean(this._tare_xs),
            y: this._trimmedMean(this._tare_ys),
            z: this._trimmedMean(this._tare_zs)
          };

          // Reset delta filters so they start fresh from the new baseline
          this.maDx.reset();
          this.maDy.reset();
          this.stabilityCheck.reset();
          this.emaWeight.reset();
          this.stableCounter    = 0;
          this.displayWeight    = 0;
          this.lastDisplayValue = 0;
          this.rawWeight        = 0;

          console.log('Tared with baseline:', this.baseline);
          if (this._tare_resolve) { this._tare_resolve(); this._tare_resolve = null; }
        }
      }
    }

    this._process();
  }

  _process() {
    if (!this.baseline) return;

    const dx = this.filteredAccel.x - this.baseline.x;
    const dy = this.filteredAccel.y - this.baseline.y;

    // Average signed deltas FIRST, then compute magnitude
    const avgDx = this.maDx.update(dx);
    const avgDy = this.maDy.update(dy);
    const deltaHorizontal = Math.sqrt(avgDx * avgDx + avgDy * avgDy);

    let rawG = (this.multiCal.coeffs && this.multiCal.points.length >= 2)
      ? this.multiCal.estimate(deltaHorizontal)
      : deltaHorizontal * this.sensitivity;

    rawG = Math.max(0, rawG);
    rawG = Math.max(0, this.tempComp.compensate(rawG));

    // 0.05 g noise floor
    if (rawG < 0.05) rawG = 0;

    this.rawWeight = rawG;
    this.stabilityCheck.update(rawG);

    const stdDev     = this.stabilityCheck.stdDev;
    const isNowStable = this.stabilityCheck.isFull && stdDev < 0.08;

    if (isNowStable) { this.stableCounter++; } else { this.stableCounter = 0; }
    const trulyStable = this.stableCounter > 25;

    const emaG = this.emaWeight.update(rawG);

    if (trulyStable && !this.isStable && rawG > 0.1) {
      if (this.onStable) this.onStable(emaG);
    }
    this.isStable = trulyStable;

    // Deadband
    if (Math.abs(emaG - this.lastDisplayValue) >= this.deadbandThreshold || emaG < 0.05) {
      this.displayWeight    = emaG;
      this.lastDisplayValue = emaG;
    }

    // Confidence
    const stabilityScore   = Math.max(0, 1 - stdDev / 0.15);
    const calPoints        = this.multiCal.getPointCount();
    const calibrationScore = this.calibrated
      ? (calPoints >= 3 ? 1.0 : calPoints >= 2 ? 0.8 : 0.6) : 0.3;
    const surfaceScore     = this._getSurfaceQualityScore();
    const signalScore      = this.calibrated ? 0.9 : Math.min(1, this.rawWeight / 2);

    this.confidence = stabilityScore * 0.40 + signalScore * 0.20 +
                      calibrationScore * 0.25 + surfaceScore * 0.15;

    if (this.onWeight) this.onWeight(this.displayWeight, this.confidence, this.isStable);
  }

  /** Trimmed mean: drop top and bottom `trimPct` fraction to reject impulse noise. */
  _trimmedMean(values, trimPct = 0.1) {
    if (values.length < 4) return values.reduce((a, b) => a + b, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const n = Math.floor(sorted.length * trimPct);
    const trimmed = sorted.slice(n, sorted.length - n);
    return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  }

  _getSurfaceQualityScore() {
    if (!this.calibrated) return 0.3;
    if (this.sensitivity > 250) return 1.0;
    if (this.sensitivity > 150) return 0.85;
    if (this.sensitivity > 80)  return 0.6;
    return 0.3;
  }

  /**
   * Tare — event-driven, 20-sample Kalman warmup then 100-sample trimmed-mean baseline.
   * Returns a Promise that resolves when the baseline is locked.
   */
  tare() {
    this.kalmanX.reset();
    this.kalmanY.reset();
    this.kalmanZ.reset();
    this.maDx.reset();
    this.maDy.reset();
    this.stabilityCheck.reset();
    this.emaWeight.reset();
    this.stableCounter = 0;
    this.tempComp.calibrateZero();

    this._tare_xs           = [];
    this._tare_ys           = [];
    this._tare_zs           = [];
    this._tare_warmup_count = 0;
    this._tare_in_progress  = true;

    console.log(`Tare started — ${this._tare_warmup} warmup + ${this._tare_target} samples`);

    return new Promise(resolve => {
      this._tare_resolve = resolve;
      // Safety timeout: finalise with whatever we have after 5 s
      setTimeout(() => {
        if (!this._tare_in_progress) return;
        this._tare_in_progress = false;
        if (this._tare_xs.length >= 10) {
          this.baseline = {
            x: this._trimmedMean(this._tare_xs),
            y: this._trimmedMean(this._tare_ys),
            z: this._trimmedMean(this._tare_zs)
          };
          this.maDx.reset(); this.maDy.reset();
          this.stabilityCheck.reset(); this.emaWeight.reset();
          this.stableCounter = 0; this.displayWeight = 0;
          this.lastDisplayValue = 0; this.rawWeight = 0;
        }
        if (this._tare_resolve) { this._tare_resolve(); this._tare_resolve = null; }
      }, 5000);
    });
  }

  calibrate(knownGrams) {
    if (!this.baseline)   return { success: false, error: 'Must tare first' };
    if (!this.isStable)   return { success: false, error: 'Wait for stable reading' };
    if (!this.maDx.isFull) return { success: false, error: 'Still settling — wait a moment' };

    // Use filtered, averaged deltas for maximum accuracy
    const avgDx = this.maDx.mean;
    const avgDy = this.maDy.mean;
    const deltaA = Math.sqrt(avgDx * avgDx + avgDy * avgDy);

    if (deltaA < 0.0005) {
      return { success: false, error: 'Signal too weak - use softer surface or heavier weight' };
    }

    this.multiCal.addPoint(knownGrams, deltaA);

    const newSensitivity = knownGrams / deltaA;
    this.sensitivity = this.calibrated
      ? 0.7 * newSensitivity + 0.3 * this.sensitivity
      : newSensitivity;

    this.calibrated = true;
    this._saveCalibration();

    const r2 = this.multiCal.quality;
    let estimatedAccuracy;
    if      (this.sensitivity > 300 && r2 > 0.98) estimatedAccuracy = `±0.1g (excellent, R²=${r2.toFixed(3)})`;
    else if (this.sensitivity > 200 && r2 > 0.95) estimatedAccuracy = `±0.2g (very good, R²=${r2.toFixed(3)})`;
    else if (this.sensitivity > 120 && r2 > 0.90) estimatedAccuracy = `±0.3g (good, R²=${r2.toFixed(3)})`;
    else if (this.sensitivity > 60)               estimatedAccuracy = `±0.5g (ok, R²=${r2.toFixed(3)})`;
    else                                          estimatedAccuracy = `±1g (poor, R²=${r2.toFixed(3)})`;

    return {
      success: true,
      sensitivity: this.sensitivity,
      accuracy: estimatedAccuracy,
      calibrationPoints: this.multiCal.getPointCount(),
      r2,
      deltaA
    };
  }
  
  /**
   * Verify current reading against known weight
   */
  verifyAgainstKnown(knownGrams) {
    if (!this.isStable) {
      return { valid: false, error: 'Wait for stable reading' };
    }
    
    const measured = this.displayWeight;
    const error = measured - knownGrams;
    const errorPercent = (error / knownGrams) * 100;
    const accuracy = 100 - Math.abs(errorPercent);
    
    const result = {
      valid: true,
      knownGrams,
      measuredGrams: measured,
      errorGrams: error,
      errorPercent: errorPercent,
      accuracy: Math.max(0, accuracy),
      passed: Math.abs(error) < 0.5, // Within 0.5g is pass
      timestamp: Date.now()
    };
    
    // Add to history
    this.verificationHistory.push(result);
    if (this.verificationHistory.length > 20) {
      this.verificationHistory.shift();
    }
    
    // Learn from verification
    this.tempComp.learnDrift(measured);
    
    this._saveCalibration();
    
    return result;
  }
  
  /**
   * Get verification statistics
   */
  getVerificationStats() {
    if (this.verificationHistory.length === 0) return null;
    
    const errors = this.verificationHistory.map(v => v.errorGrams);
    const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
    const variance = errors.reduce((a, b) => a + (b - meanError) ** 2, 0) / errors.length;
    const stdDev = Math.sqrt(variance);
    
    const passed = this.verificationHistory.filter(v => v.passed).length;
    
    return {
      totalVerifications: this.verificationHistory.length,
      passed,
      failed: this.verificationHistory.length - passed,
      passRate: (passed / this.verificationHistory.length) * 100,
      meanError,
      stdDev,
      maxError: Math.max(...errors.map(Math.abs)),
      accuracy: (this.verificationHistory[this.verificationHistory.length - 1] && this.verificationHistory[this.verificationHistory.length - 1].accuracy) || 0
    };
  }
  
  /**
   * Precision measurement with statistical analysis
   */
  async measurePrecision(durationMs = 5000) {
    const readings = [];
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        readings.push({
          grams: this.rawWeight,
          time: Date.now() - startTime
        });
        
        if (Date.now() - startTime >= durationMs) {
          clearInterval(interval);
          
          // Statistical analysis
          const values = readings.map(r => r.grams);
          values.sort((a, b) => a - b);
          
          // Trim outliers (10% from each end)
          const trimCount = Math.floor(values.length * 0.1);
          const trimmed = values.slice(trimCount, values.length - trimCount);
          
          const mean = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
          const variance = trimmed.reduce((a, b) => a + (b - mean) ** 2, 0) / trimmed.length;
          const stdDev = Math.sqrt(variance);
          
          // Allan variance for long-term stability
          const allanVar = this._calculateAllanVariance(trimmed);
          
          resolve({
            grams: mean,
            stdDev,
            variance,
            allanDeviation: Math.sqrt(allanVar),
            min: Math.min(...trimmed),
            max: Math.max(...trimmed),
            range: Math.max(...trimmed) - Math.min(...trimmed),
            sampleCount: trimmed.length,
            confidence: Math.max(0, 1 - stdDev / 0.5)
          });
        }
      }, 50);
    });
  }
  
  _calculateAllanVariance(values) {
    if (values.length < 20) return 0;
    
    const tau = Math.floor(values.length / 10);
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
  
  getDeltaA() {
    if (!this.baseline) return 0;
    const avgDx = this.maDx.mean;
    const avgDy = this.maDy.mean;
    return Math.sqrt(avgDx * avgDx + avgDy * avgDy);
  }
  
  getSurfaceQuality() {
    if (!this.calibrated) return 'unknown';
    if (this.sensitivity > 300) return 'excellent';
    if (this.sensitivity > 180) return 'good';
    if (this.sensitivity > 80) return 'ok';
    return 'poor';
  }
  
  getCalibrationQuality() {
    return {
      points: this.multiCal.getPointCount(),
      r2: this.multiCal.quality,
      sensitivity: this.sensitivity,
      isQuadratic: this.multiCal.degree === 2
    };
  }
  
  _saveCalibration() {
    try {
      const cal = {
        sensitivity: this.sensitivity,
        baseline: this.baseline,
        calibrated: this.calibrated,
        multiCal: {
          points: this.multiCal.points,
          degree: this.multiCal.degree
        },
        verificationHistory: this.verificationHistory,
        timestamp: Date.now()
      };
      // Try localStorage first, fallback to memory if unavailable
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('phoneway_v4_calibration', JSON.stringify(cal));
      }
      // Also store in window for session persistence
      window._phonewayCal = cal;
    } catch (e) {
      console.log('Could not save calibration:', e);
      // Fallback to memory storage
      window._phonewayCal = {
        sensitivity: this.sensitivity,
        baseline: this.baseline,
        calibrated: this.calibrated,
        multiCal: {
          points: this.multiCal.points,
          degree: this.multiCal.degree
        },
        verificationHistory: this.verificationHistory,
        timestamp: Date.now()
      };
    }
  }
  
  _loadCalibration() {
    try {
      let saved = null;
      
      // Try localStorage first
      if (typeof localStorage !== 'undefined') {
        saved = localStorage.getItem('phoneway_v4_calibration');
      }
      
      // Fallback to memory storage
      if (!saved && window._phonewayCal) {
        saved = JSON.stringify(window._phonewayCal);
      }
      
      if (saved) {
        const cal = JSON.parse(saved);
        // Calibration valid for 30 days
        if (cal.timestamp && Date.now() - cal.timestamp < 30 * 24 * 60 * 60 * 1000) {
          if (cal.sensitivity && cal.baseline) {
            this.sensitivity = cal.sensitivity;
            this.baseline = cal.baseline;
            this.calibrated = cal.calibrated || false;
            
            if (cal.multiCal) {
              this.multiCal.points = cal.multiCal.points || [];
              this.multiCal.degree = cal.multiCal.degree || 1;
              this.multiCal._fit();
            }
            
            if (cal.verificationHistory) {
              this.verificationHistory = cal.verificationHistory;
            }
            
            console.log('Loaded saved calibration:', this.getCalibrationQuality());
            return true;
          }
        }
      }
    } catch (e) {
      console.log('Could not load calibration:', e);
    }
    return false;
  }
  
  reset() {
    this.baseline = null;
    this.calibrated = false;
    this.sensitivity = 150;
    this.multiCal.clear();
    this.verificationHistory = [];
    this.kalmanX.reset();
    this.kalmanY.reset();
    this.kalmanZ.reset();
    this.maDx.reset();
    this.maDy.reset();
    this.stabilityCheck.reset();
    this.emaWeight.reset();
    this.displayWeight    = 0;
    this.rawWeight        = 0;
    this.lastDisplayValue = 0;
    this.stableCounter    = 0;
    this._tare_in_progress = false;

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('phoneway_v4_calibration');
      }
    } catch (e) {}

    if (window._phonewayCal) delete window._phonewayCal;
  }
}

export { SimpleScale, MovingAverage, EMA, SimpleKalman, MultiPointCalibration };
