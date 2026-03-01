/**
 * predictiveCalibration.js — AI-Powered Predictive Calibration for Phoneway
 * 
 * Uses machine learning to:
 *   - Predict optimal calibration parameters before measurement
 *   - Learn from user behavior patterns
 *   - Auto-calibrate based on environmental conditions
 *   - Detect and correct for non-linear sensor response
 */

'use strict';

import { globalErrorLogger } from '../data/error-logger.js';

/**
 * CalibrationPredictor — predicts optimal calibration for current conditions
 */
class CalibrationPredictor {
  constructor() {
    // Historical calibration data
    this.calibrationHistory = [];
    
    // Feature weights for prediction
    this.weights = {
      surface: 0.25,
      temperature: 0.15,
      orientation: 0.10,
      timeOfDay: 0.05,
      battery: 0.05,
      previousCalibration: 0.40
    };
    
    // Surface type models
    this.surfaceModels = new Map();
    
    // Load saved data
    this._loadData();
  }

  /**
   * Predict optimal sensitivity for current conditions
   */
  predictSensitivity(environmentalData) {
    const features = this._extractFeatures(environmentalData);
    
    // Find similar historical calibrations
    const similar = this._findSimilarCalibrations(features, 5);
    
    if (similar.length === 0) {
      // No history, use defaults based on surface
      return this._getDefaultSensitivity(features.surfaceType);
    }
    
    // Weighted average of similar calibrations
    let totalWeight = 0;
    let weightedSensitivity = 0;
    
    for (const cal of similar) {
      const distance = this._calculateDistance(features, cal.features);
      const weight = 1 / (distance + 0.1);
      
      weightedSensitivity += cal.sensitivity * weight;
      totalWeight += weight;
    }
    
    const predicted = weightedSensitivity / totalWeight;
    
    // Add confidence based on similarity
    const avgDistance = similar.reduce((a, c) => a + this._calculateDistance(features, c.features), 0) / similar.length;
    const confidence = 1 / (1 + avgDistance * 5);
    
    return {
      sensitivity: predicted,
      confidence,
      basedOn: similar.length,
      surfaceMatch: similar.filter(s => s.features.surfaceType === features.surfaceType).length
    };
  }

  /**
   * Record a successful calibration for learning
   */
  recordCalibration(sensitivity, surfaceQuality, environmentalData, accuracy = null) {
    const calibration = {
      timestamp: Date.now(),
      sensitivity,
      surfaceQuality,
      features: this._extractFeatures(environmentalData),
      accuracy,
      timeOfDay: new Date().getHours()
    };
    
    this.calibrationHistory.push(calibration);
    
    // Keep last 100 calibrations
    if (this.calibrationHistory.length > 100) {
      this.calibrationHistory.shift();
    }
    
    // Update surface model
    this._updateSurfaceModel(calibration);
    
    this._saveData();
  }

  /**
   * Extract features from environmental data
   */
  _extractFeatures(data) {
    return {
      surfaceType: data.surface || 'unknown',
      temperature: data.temperature || 25,
      orientation: data.orientation || { tilt: 0, confidence: 0 },
      batteryLevel: data.battery || 1.0,
      isCharging: data.isCharging || false,
      barometricPressure: data.pressure || 1013,
      dayOfWeek: new Date().getDay(),
      hourOfDay: new Date().getHours()
    };
  }

  /**
   * Calculate feature distance
   */
  _calculateDistance(f1, f2) {
    let distance = 0;
    
    // Surface type (0 if same, 1 if different)
    distance += (f1.surfaceType !== f2.surfaceType) ? this.weights.surface : 0;
    
    // Temperature difference (normalized)
    distance += Math.abs(f1.temperature - f2.temperature) / 20 * this.weights.temperature;
    
    // Orientation difference
    const tiltDiff = Math.abs((f1.orientation.tilt || 0) - (f2.orientation.tilt || 0));
    distance += tiltDiff / 10 * this.weights.orientation;
    
    // Battery difference
    distance += Math.abs(f1.batteryLevel - f2.batteryLevel) * this.weights.battery;
    
    // Time of day (circular distance)
    const hourDiff = Math.abs(f1.hourOfDay - f2.hourOfDay);
    const circularHourDiff = Math.min(hourDiff, 24 - hourDiff);
    distance += circularHourDiff / 12 * this.weights.timeOfDay;
    
    return distance;
  }

  /**
   * Find similar historical calibrations
   */
  _findSimilarCalibrations(features, k = 5) {
    const scored = this.calibrationHistory.map(cal => ({
      ...cal,
      distance: this._calculateDistance(features, cal.features)
    }));
    
    scored.sort((a, b) => a.distance - b.distance);
    
    return scored.slice(0, k);
  }

  /**
   * Get default sensitivity based on surface type
   */
  _getDefaultSensitivity(surfaceType) {
    const defaults = {
      'mouse_pad': 400,
      'notebook': 250,
      'magazine': 120,
      'towel': 300,
      'carpet': 150,
      'wood': 50,
      'glass': 20,
      'metal': 15,
      'unknown': 180
    };
    
    return {
      sensitivity: defaults[surfaceType] || 180,
      confidence: 0.3,
      basedOn: 0,
      surfaceMatch: 0
    };
  }

  /**
   * Update surface-specific models
   */
  _updateSurfaceModel(calibration) {
    const surface = calibration.features.surfaceType;
    
    if (!this.surfaceModels.has(surface)) {
      this.surfaceModels.set(surface, {
        calibrations: [],
        avgSensitivity: 0,
        stdDev: 0
      });
    }
    
    const model = this.surfaceModels.get(surface);
    model.calibrations.push(calibration);
    
    if (model.calibrations.length > 20) {
      model.calibrations.shift();
    }
    
    // Recalculate statistics
    const sensitivities = model.calibrations.map(c => c.sensitivity);
    model.avgSensitivity = sensitivities.reduce((a, b) => a + b, 0) / sensitivities.length;
    
    const variance = sensitivities.reduce((a, b) => a + Math.pow(b - model.avgSensitivity, 2), 0) / sensitivities.length;
    model.stdDev = Math.sqrt(variance);
  }

  /**
   * Get surface recommendations
   */
  getSurfaceRecommendation(availableSurfaces) {
    const scores = availableSurfaces.map(surface => {
      const model = this.surfaceModels.get(surface);
      if (!model) return { surface, score: 0.5, confidence: 0 };
      
      // Higher score for surfaces with low standard deviation (consistent)
      const consistencyScore = 1 / (1 + model.stdDev / 50);
      const experienceScore = Math.min(1, model.calibrations.length / 10);
      
      return {
        surface,
        score: consistencyScore * 0.6 + experienceScore * 0.4,
        confidence: experienceScore,
        avgSensitivity: model.avgSensitivity,
        stdDev: model.stdDev
      };
    });
    
    scores.sort((a, b) => b.score - a.score);
    return scores[0];
  }

  /**
   * Detect if recalibration is needed based on condition changes
   */
  shouldRecalibrate(lastCalibrationTime, currentEnvironment, threshold = 0.3) {
    const age = Date.now() - lastCalibrationTime;
    const ageHours = age / (60 * 60 * 1000);
    
    // Always recalibrate after 7 days
    if (ageHours > 168) return { needed: true, reason: 'Calibration too old (>7 days)' };
    
    if (this.calibrationHistory.length === 0) {
      return { needed: true, reason: 'No calibration history' };
    }
    
    const lastCal = this.calibrationHistory[this.calibrationHistory.length - 1];
    const currentFeatures = this._extractFeatures(currentEnvironment);
    const distance = this._calculateDistance(currentFeatures, lastCal.features);
    
    if (distance > threshold) {
      return {
        needed: true,
        reason: `Environment changed significantly (${(distance * 100).toFixed(0)}%)`,
        changes: this._identifyChanges(currentFeatures, lastCal.features)
      };
    }
    
    return { needed: false, confidence: 1 - distance };
  }

  _identifyChanges(current, previous) {
    const changes = [];
    
    if (current.surfaceType !== previous.surfaceType) {
      changes.push(`Surface: ${previous.surfaceType} → ${current.surfaceType}`);
    }
    if (Math.abs(current.temperature - previous.temperature) > 5) {
      changes.push(`Temperature: ${previous.temperature}°C → ${current.temperature}°C`);
    }
    if (Math.abs(current.batteryLevel - previous.batteryLevel) > 0.3) {
      changes.push('Battery level changed significantly');
    }
    
    return changes;
  }

  _saveData() {
    try {
      const data = {
        calibrationHistory: this.calibrationHistory.slice(-50),
        surfaceModels: [...this.surfaceModels.entries()],
        weights: this.weights
      };
      localStorage.setItem('phoneway_predictive_cal', JSON.stringify(data));
    } catch {}
  }

  _loadData() {
    try {
      const saved = localStorage.getItem('phoneway_predictive_cal');
      if (saved) {
        const data = JSON.parse(saved);
        this.calibrationHistory = data.calibrationHistory || [];
        if (data.surfaceModels) {
          this.surfaceModels = new Map(data.surfaceModels);
        }
        if (data.weights) {
          this.weights = data.weights;
        }
      }
    } catch {}
  }
}

/**
 * NonlinearCalibration — handles non-linear sensor response
 */
class NonlinearCalibration {
  constructor() {
    // Polynomial coefficients (3rd order)
    this.coefficients = [0, 1, 0, 0]; // Linear by default
    this.calibrationPoints = [];
    this.isCalibrated = false;
  }

  /**
   * Add a calibration point
   */
  addPoint(knownWeight, measuredSignal) {
    this.calibrationPoints.push({ x: measuredSignal, y: knownWeight });
    
    // Fit polynomial when we have enough points
    if (this.calibrationPoints.length >= 3) {
      this._fitPolynomial();
    }
  }

  /**
   * Fit 3rd order polynomial using least squares
   */
  _fitPolynomial() {
    const n = this.calibrationPoints.length;
    if (n < 3) return;
    
    // Build Vandermonde matrix
    const X = this.calibrationPoints.map(p => [
      1, p.x, p.x * p.x, p.x * p.x * p.x
    ]);
    const Y = this.calibrationPoints.map(p => p.y);
    
    // Normal equation: (X^T X)^-1 X^T Y
    const Xt = this._transpose(X);
    const XtX = this._multiply(Xt, X);
    const XtY = this._multiplyVector(Xt, Y);
    
    // Solve using Gaussian elimination (simplified)
    this.coefficients = this._solveLinearSystem(XtX, XtY);
    this.isCalibrated = true;
  }

  _transpose(matrix) {
    return matrix[0].map((_, i) => matrix.map(row => row[i]));
  }

  _multiply(A, B) {
    const result = [];
    for (let i = 0; i < A.length; i++) {
      result[i] = [];
      for (let j = 0; j < B[0].length; j++) {
        let sum = 0;
        for (let k = 0; k < B.length; k++) {
          sum += A[i][k] * B[k][j];
        }
        result[i][j] = sum;
      }
    }
    return result;
  }

  _multiplyVector(matrix, vector) {
    return matrix.map(row => 
      row.reduce((sum, val, i) => sum + val * vector[i], 0)
    );
  }

  _solveLinearSystem(A, b) {
    // Simplified Gaussian elimination for 4x4
    const n = b.length;
    const aug = A.map((row, i) => [...row, b[i]]);
    
    // Forward elimination
    for (let i = 0; i < n; i++) {
      const pivot = aug[i][i];
      for (let j = i; j <= n; j++) {
        aug[i][j] /= pivot;
      }
      for (let k = i + 1; k < n; k++) {
        const factor = aug[k][i];
        for (let j = i; j <= n; j++) {
          aug[k][j] -= factor * aug[i][j];
        }
      }
    }
    
    // Back substitution
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      x[i] = aug[i][n];
      for (let j = i + 1; j < n; j++) {
        x[i] -= aug[i][j] * x[j];
      }
    }
    
    return x;
  }

  /**
   * Convert measured signal to weight using calibration curve
   */
  convert(signal) {
    if (!this.isCalibrated) return signal; // Linear fallback
    
    const [a0, a1, a2, a3] = this.coefficients;
    return a0 + a1 * signal + a2 * signal * signal + a3 * signal * signal * signal;
  }

  /**
   * Get calibration quality metrics
   */
  getQuality() {
    if (!this.isCalibrated || this.calibrationPoints.length < 3) {
      return { r2: 0, rmse: Infinity, status: 'insufficient_data' };
    }
    
    // Calculate R²
    const yMean = this.calibrationPoints.reduce((a, p) => a + p.y, 0) / this.calibrationPoints.length;
    let ssTotal = 0, ssResidual = 0;
    
    for (const point of this.calibrationPoints) {
      const predicted = this.convert(point.x);
      ssTotal += Math.pow(point.y - yMean, 2);
      ssResidual += Math.pow(point.y - predicted, 2);
    }
    
    const r2 = 1 - (ssResidual / (ssTotal + 1e-10));
    const rmse = Math.sqrt(ssResidual / this.calibrationPoints.length);
    
    return {
      r2,
      rmse,
      status: r2 > 0.99 ? 'excellent' : r2 > 0.95 ? 'good' : r2 > 0.9 ? 'acceptable' : 'poor',
      points: this.calibrationPoints.length,
      coefficients: this.coefficients
    };
  }

  reset() {
    this.coefficients = [0, 1, 0, 0];
    this.calibrationPoints = [];
    this.isCalibrated = false;
  }
}

/**
 * AutoCalibrator — automatically calibrates based on known references
 */
class AutoCalibrator {
  constructor(predictor, nonlinear) {
    this.predictor = predictor;
    this.nonlinear = nonlinear;
    this.isCalibrating = false;
    this.calibrationProgress = 0;
  }

  /**
   * Start auto-calibration sequence
   */
  async startAutoCalibration(knownWeights, measureFn, onProgress) {
    if (this.isCalibrating) return null;
    this.isCalibrating = true;
    this.calibrationProgress = 0;
    
    const results = [];
    
    for (let i = 0; i < knownWeights.length; i++) {
      const weight = knownWeights[i];
      onProgress?.(i / knownWeights.length, `Measuring ${weight}g...`);
      
      // Take multiple measurements for accuracy
      const measurements = [];
      for (let j = 0; j < 5; j++) {
        const m = await measureFn();
        measurements.push(m);
        await new Promise(r => setTimeout(r, 200));
      }
      
      const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length;
      const stdDev = Math.sqrt(measurements.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / measurements.length);
      
      results.push({
        known: weight,
        measured: avg,
        stdDev,
        signal: avg // The raw signal value
      });
      
      // Add to nonlinear calibration
      this.nonlinear.addPoint(weight, avg);
      
      this.calibrationProgress = (i + 1) / knownWeights.length;
    }
    
    this.isCalibrating = false;
    
    return {
      results,
      quality: this.nonlinear.getQuality(),
      sensitivity: this._calculateSensitivity(results)
    };
  }

  _calculateSensitivity(results) {
    if (results.length < 2) return results[0]?.measured / results[0]?.known || 150;
    
    // Linear regression for sensitivity
    const n = results.length;
    const sumX = results.reduce((a, r) => a + r.known, 0);
    const sumY = results.reduce((a, r) => a + r.measured, 0);
    const sumXY = results.reduce((a, r) => a + r.known * r.measured, 0);
    const sumX2 = results.reduce((a, r) => a + r.known * r.known, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    return slope;
  }
}

export {
  CalibrationPredictor,
  NonlinearCalibration,
  AutoCalibrator
};
