/**
 * ultraPrecision.js — Ultimate 0.1g accuracy engine for Phoneway
 * 
 * Combines:
 *   - Multi-stage adaptive filtering
 *   - Machine learning corrections
 *   - Environmental compensation
 *   - Statistical quality metrics
 *   - Auto-calibration triggers
 */

'use strict';

import { AdaptiveCalibration } from './mlCalibration.js';
import { AdvancedFusionEngine } from './advancedFusion.js';
import { EnvironmentalCompensator } from './environmentalSensors.js';
import { globalErrorLogger } from '../data/error-logger.js';

/**
 * UltraPrecisionMeasurement — single high-precision measurement session
 * Targets ±0.05g (0.1g total range) accuracy
 */
class UltraPrecisionMeasurement {
  constructor(options = {}) {
    this.targetPrecision = options.targetPrecision || 0.05; // 1σ target
    this.maxDuration = options.maxDuration || 15000; // 15s max
    this.minDuration = options.minDuration || 3000;  // 3s min
    
    this.samples = [];
    this.qualityLog = [];
    this.running = false;
    this.startTime = null;
    
    this._onProgress = options.onProgress || (() => {});
  }

  async measure(sampler, qualityChecker) {
    this.running = true;
    this.startTime = performance.now();
    this.samples = [];
    this.qualityLog = [];
    
    const sampleInterval = 50; // 20 Hz sampling
    
    while (this.running) {
      const elapsed = performance.now() - this.startTime;
      
      // Check quality continuously
      const quality = qualityChecker();
      this.qualityLog.push({ time: elapsed, ...quality });
      
      // Take sample
      const reading = await sampler();
      if (reading) {
        this.samples.push({
          time: elapsed,
          ...reading,
          quality: quality.overall
        });
      }
      
      // Calculate running statistics
      if (this.samples.length > 20 && elapsed > this.minDuration) {
        const stats = this._calculateStats();
        this._onProgress(stats, elapsed / this.maxDuration);
        
        // Check convergence
        if (stats.precision < this.targetPrecision && 
            stats.confidence > 0.8 &&
            quality.overall > 0.85) {
          return this._finalize(stats, 'converged');
        }
        
        // Check if we've plateaued
        if (this._hasPlateaued() && stats.precision < this.targetPrecision * 2) {
          return this._finalize(stats, 'plateau');
        }
      }
      
      // Timeout
      if (elapsed >= this.maxDuration) {
        const stats = this._calculateStats();
        return this._finalize(stats, 'timeout');
      }
      
      await this._sleep(sampleInterval);
    }
    
    return this._finalize(this._calculateStats(), 'cancelled');
  }

  _calculateStats() {
    if (this.samples.length < 10) {
      return { precision: Infinity, confidence: 0, grams: 0 };
    }
    
    // Discard first 20% (settling period)
    const discardCount = Math.floor(this.samples.length * 0.2);
    const usable = this.samples.slice(discardCount);
    
    if (usable.length < 10) {
      return { precision: Infinity, confidence: 0, grams: 0 };
    }
    
    const values = usable.map(s => s.grams);
    
    // Robust statistics using median absolute deviation
    const median = this._median(values);
    const mad = this._median(values.map(v => Math.abs(v - median)));
    const stdDev = mad * 1.4826; // Convert MAD to SD for normal distribution
    
    // Mean of inliers only (within 2 MAD)
    const inliers = usable.filter(s => Math.abs(s.grams - median) < 2 * mad);
    const meanGrams = inliers.reduce((a, s) => a + s.grams, 0) / inliers.length;
    
    // Confidence calculation
    const avgQuality = usable.reduce((a, s) => a + s.quality, 0) / usable.length;
    const qualityBonus = Math.min(0.15, avgQuality * 0.15);
    const sampleBonus = Math.min(0.1, (usable.length - 10) / 1000);
    const precisionFactor = Math.max(0, 1 - stdDev / 0.2);
    
    const confidence = 0.5 + qualityBonus + sampleBonus + precisionFactor * 0.35;
    
    // Allan variance for long-term stability
    const allanDev = this._calculateAllanDeviation(values);
    
    return {
      grams: meanGrams,
      median,
      precision: stdDev,
      allanDeviation: allanDev,
      confidence: Math.min(0.98, confidence),
      samples: usable.length,
      inliers: inliers.length,
      outliers: usable.length - inliers.length,
      min: Math.min(...values),
      max: Math.max(...values),
      range: Math.max(...values) - Math.min(...values)
    };
  }

  _hasPlateaued() {
    if (this.samples.length < 60) return false;
    
    // Check if precision stopped improving
    const window1 = this.samples.slice(-60, -30).map(s => s.grams);
    const window2 = this.samples.slice(-30).map(s => s.grams);
    
    const std1 = this._stdDev(window1);
    const std2 = this._stdDev(window2);
    
    // Plateau if no significant improvement
    return std2 > std1 * 0.9 && std2 < this.targetPrecision * 3;
  }

  _calculateAllanDeviation(values) {
    if (values.length < 40) return Infinity;
    
    // Allan variance at τ = 10 samples
    const tau = 10;
    const y = [];
    
    for (let i = 0; i < values.length - tau; i += tau) {
      const chunk = values.slice(i, i + tau);
      y.push(chunk.reduce((a, b) => a + b, 0) / chunk.length);
    }
    
    if (y.length < 2) return Infinity;
    
    let sum = 0;
    for (let i = 0; i < y.length - 1; i++) {
      sum += (y[i + 1] - y[i]) ** 2;
    }
    
    return Math.sqrt(sum / (2 * (y.length - 1)));
  }

  _finalize(stats, reason) {
    this.running = false;
    
    return {
      ...stats,
      reason,
      targetAchieved: stats.precision < this.targetPrecision,
      duration: performance.now() - this.startTime,
      qualityLog: this.qualityLog
    };
  }

  _median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  _stdDev(arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  cancel() {
    this.running = false;
  }
}

/**
 * UltraPrecisionEngine — Main 0.1g accuracy system
 */
class UltraPrecisionEngine {
  constructor() {
    this.adaptiveCal = new AdaptiveCalibration();
    this.advancedFusion = new AdvancedFusionEngine();
    this.environmental = new EnvironmentalCompensator();
    
    this.isInitialized = false;
    this.currentMeasurement = null;
    
    // Performance tracking
    this.measurementHistory = [];
    this.accuracyGrade = 'untested';
  }

  async init() {
    // Initialize environmental sensors
    await this.environmental.init();
    this.isInitialized = true;
    
    return this;
  }

  /**
   * Perform ultra-precision measurement
   */
  async measure(sampler, options = {}) {
    if (!this.isInitialized) {
      await this.init();
    }
    
    // Wait for optimal conditions if requested
    if (options.waitForOptimal) {
      await this._waitForOptimalConditions(options.maxWaitTime || 5000);
    }
    
    // Start measurement
    this.currentMeasurement = new UltraPrecisionMeasurement({
      targetPrecision: options.targetPrecision || 0.05,
      maxDuration: options.timeout || 15000,
      minDuration: options.minDuration || 3000,
      onProgress: options.onProgress
    });
    
    const samplerWrapper = async () => {
      const raw = await sampler();
      if (!raw) return null;
      
      // Apply all corrections
      const corrected = this._applyCorrections(raw);
      return corrected;
    };
    
    const qualityChecker = () => this._checkQuality();
    
    const result = await this.currentMeasurement.measure(samplerWrapper, qualityChecker);
    
    // Store for learning
    this.measurementHistory.push(result);
    if (this.measurementHistory.length > 100) {
      this.measurementHistory.shift();
    }
    
    // Update accuracy grade
    this._updateAccuracyGrade();
    
    return result;
  }

  /**
   * Apply all corrections to a raw measurement
   */
  _applyCorrections(raw) {
    // 1. Advanced fusion
    const fused = this.advancedFusion.getFusedEstimate();
    
    // 2. Environmental compensation
    const envComp = this.environmental.getCompensations();
    
    // 3. ML correction
    const mlCorrected = this.adaptiveCal.correct({
      fusedGrams: fused.grams,
      sensorReadings: raw.sensorReadings || {},
      confidence: fused.confidence,
      calibrationAge: Date.now() - (raw.calibrationTime || Date.now()),
      surfaceQuality: raw.surfaceQuality || 'unknown'
    });
    
    // Combine
    const correctedGrams = mlCorrected.correctedGrams + envComp.totalCorrection;
    
    return {
      grams: correctedGrams,
      confidence: mlCorrected.confidence * fused.confidence,
      rawFusion: fused,
      mlCorrection: mlCorrected,
      environmentalCorrection: envComp
    };
  }

  /**
   * Check current measurement quality
   */
  _checkQuality() {
    const envQuality = this.environmental.getStabilityScore();
    const fusionQuality = this.advancedFusion.getFusedEstimate().confidence;
    
    // Check sensor agreement
    const outliers = this.advancedFusion.getFusedEstimate().outliers;
    const agreementQuality = outliers.length === 0 ? 1.0 : 
                             outliers.length === 1 ? 0.8 : 0.6;
    
    const overall = envQuality * 0.3 + fusionQuality * 0.4 + agreementQuality * 0.3;
    
    return {
      environmental: envQuality,
      fusion: fusionQuality,
      agreement: agreementQuality,
      overall,
      isOptimal: overall > 0.9 && envQuality > 0.85
    };
  }

  async _waitForOptimalConditions(maxWait) {
    const start = Date.now();
    
    while (Date.now() - start < maxWait) {
      const quality = this._checkQuality();
      if (quality.isOptimal) return true;
      
      await new Promise(r => setTimeout(r, 100));
    }
    
    return false; // Timeout
  }

  /**
   * Learn from verified measurement
   */
  learn(measuredGrams, actualGrams, metadata = {}) {
    // Update advanced fusion
    this.advancedFusion.learn(actualGrams);
    
    // Update adaptive calibration
    const sensorReadings = metadata.sensorReadings || {};
    const result = this.adaptiveCal.learn(measuredGrams, actualGrams, sensorReadings, {
      ...metadata,
      surfaceQuality: metadata.surfaceQuality,
      confidence: metadata.confidence,
      calibrationAge: Date.now() - (metadata.calibrationTime || Date.now())
    });
    
    return result;
  }

  /**
   * Get comprehensive quality report
   */
  getQualityReport() {
    const mlMetrics = this.adaptiveCal.ensemble.getQualityMetrics();
    const envStatus = {
      barometer: this.environmental.data.pressure !== null,
      battery: this.environmental.data.battery !== null,
      orientation: this.environmental.data.orientation !== null,
      optimal: this.environmental.isOptimal()
    };
    
    const fusionStatus = this.advancedFusion.getFusedEstimate();
    
    // Calculate accuracy potential
    const accuracyPotential = this._calculateAccuracyPotential();
    
    return {
      mlMetrics,
      environmental: envStatus,
      fusion: fusionStatus,
      accuracyGrade: this.accuracyGrade,
      accuracyPotential,
      recommendations: this._generateRecommendations(mlMetrics, envStatus)
    };
  }

  _calculateAccuracyPotential() {
    const recent = this.measurementHistory.slice(-20);
    if (recent.length < 5) return { estimated: 'unknown', confidence: 0 };
    
    const precisions = recent.map(m => m.precision).filter(p => p !== Infinity);
    if (!precisions.length) return { estimated: 'unknown', confidence: 0 };
    
    const meanPrecision = precisions.reduce((a, b) => a + b, 0) / precisions.length;
    const targetMet = precisions.filter(p => p < 0.05).length / precisions.length;
    
    let estimated;
    if (meanPrecision < 0.05) estimated = '0.05g';
    else if (meanPrecision < 0.1) estimated = '0.1g';
    else if (meanPrecision < 0.2) estimated = '0.2g';
    else if (meanPrecision < 0.5) estimated = '0.5g';
    else estimated = '>0.5g';
    
    return {
      estimated,
      meanPrecision,
      targetMetRatio: targetMet,
      confidence: Math.min(1, precisions.length / 20)
    };
  }

  _updateAccuracyGrade() {
    const potential = this._calculateAccuracyPotential();
    
    if (potential.meanPrecision < 0.03) this.accuracyGrade = 'A+';
    else if (potential.meanPrecision < 0.05) this.accuracyGrade = 'A';
    else if (potential.meanPrecision < 0.1) this.accuracyGrade = 'B+';
    else if (potential.meanPrecision < 0.2) this.accuracyGrade = 'B';
    else if (potential.meanPrecision < 0.5) this.accuracyGrade = 'C';
    else this.accuracyGrade = 'D';
  }

  _generateRecommendations(mlMetrics, envStatus) {
    const recs = [];
    
    if (!mlMetrics.nnTrained) {
      recs.push({
        priority: 'high',
        type: 'calibration',
        message: 'Complete 5+ verified measurements to train ML model'
      });
    }
    
    if (!envStatus.optimal) {
      const guidance = this.environmental.getGuidance();
      if (guidance.length) {
        recs.push({
          priority: 'medium',
          type: 'environment',
          message: guidance[0]
        });
      }
    }
    
    const errorRecs = globalErrorLogger.getCalibrationRecommendations();
    for (const rec of errorRecs.slice(0, 2)) {
      recs.push({
        priority: rec.severity,
        type: rec.type,
        message: rec.message
      });
    }
    
    return recs;
  }

  /**
   * Update sensor readings
   */
  updateSensor(sensorName, grams, confidence) {
    this.advancedFusion.update(sensorName, grams, confidence);
  }

  reset() {
    this.advancedFusion.reset();
    if (this.currentMeasurement) this.currentMeasurement.cancel();
  }
}

export { UltraPrecisionEngine, UltraPrecisionMeasurement };
