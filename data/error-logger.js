/**
 * error-logger.js — Global error logging & learning system for Phoneway
 * 
 * Logs all measurement errors from verified weighings across all users.
 * Anonymous aggregation enables crowd-sourced model improvements.
 * Self-learning: local device adapts based on its own error patterns.
 */

'use strict';

const ERROR_LOG_KEY = 'phoneway_errorLog';
const LEARNING_MODEL_KEY = 'phoneway_learningModel';
const SYNC_ENDPOINT = null; // Set to enable cloud learning

/**
 * ErrorLogEntry — single measurement error record
 */
class ErrorLogEntry {
  constructor({
    timestamp = Date.now(),
    expectedGrams,
    measuredGrams,
    errorGrams,
    errorPercent,
    sensorMode,
    calibrationPoints,
    phoneModel,
    surfaceQuality,
    temperature = null,
    humidity = null,
    barometricPressure = null,
    batteryLevel = null,
    activeSensors = [],
    fusionConfidence,
    ambientLight = null,
    deviceOrientation = null
  }) {
    this.timestamp = timestamp;
    this.expectedGrams = expectedGrams;
    this.measuredGrams = measuredGrams;
    this.errorGrams = errorGrams;
    this.errorPercent = errorPercent;
    this.sensorMode = sensorMode;
    this.calibrationPoints = calibrationPoints;
    this.phoneModel = phoneModel;
    this.surfaceQuality = surfaceQuality;
    this.temperature = temperature;
    this.humidity = humidity;
    this.barometricPressure = barometricPressure;
    this.batteryLevel = batteryLevel;
    this.activeSensors = activeSensors;
    this.fusionConfidence = fusionConfidence;
    this.ambientLight = ambientLight;
    this.deviceOrientation = deviceOrientation;
  }
}

/**
 * ErrorLogger — persistent error logging with pattern analysis
 */
class ErrorLogger {
  constructor() {
    this.entries = this._load();
    this._patterns = new Map();
    this._analyzePatterns();
  }

  /**
   * Log a measurement error for learning
   */
  logError(entryData) {
    const entry = new ErrorLogEntry(entryData);
    this.entries.push(entry);
    
    // Keep last 1000 entries locally
    if (this.entries.length > 1000) {
      this.entries.shift();
    }
    
    this._save();
    this._updatePatterns(entry);
    
    // Queue for cloud sync if enabled
    if (SYNC_ENDPOINT) {
      this._queueForSync(entry);
    }
    
    return entry;
  }

  /**
   * Get error statistics for a weight range
   */
  getErrorStats(minGrams = 0, maxGrams = 500) {
    const relevant = this.entries.filter(e => 
      e.expectedGrams >= minGrams && e.expectedGrams <= maxGrams
    );
    
    if (!relevant.length) return null;
    
    const errors = relevant.map(e => e.errorGrams);
    const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
    const variance = errors.reduce((a, b) => a + (b - meanError) ** 2, 0) / errors.length;
    const stdDev = Math.sqrt(variance);
    
    // Systematic bias (consistent over/under measurement)
    const systematicBias = meanError;
    
    // Random error component
    const randomError = stdDev;
    
    return {
      count: relevant.length,
      meanError,
      stdDev,
      systematicBias,
      randomError,
      maxError: Math.max(...errors.map(Math.abs)),
      withinTenthGram: errors.filter(e => Math.abs(e) < 0.1).length / errors.length,
      withinHalfGram: errors.filter(e => Math.abs(e) < 0.5).length / errors.length
    };
  }

  /**
   * Get error pattern by sensor mode
   */
  getPatternByMode(mode) {
    const modeEntries = this.entries.filter(e => e.sensorMode === mode);
    if (!modeEntries.length) return null;
    
    const errors = modeEntries.map(e => e.errorGrams);
    return {
      mode,
      count: modeEntries.length,
      meanBias: errors.reduce((a, b) => a + b, 0) / errors.length,
      stdDev: Math.sqrt(errors.reduce((a, b) => a + (b - errors.reduce((c, d) => c + d, 0) / errors.length) ** 2, 0) / errors.length)
    };
  }

  /**
   * Detect weight-specific error patterns (non-linearity)
   */
  getNonlinearityProfile() {
    // Bin errors by weight ranges
    const bins = new Map();
    
    for (const entry of this.entries) {
      const binSize = entry.expectedGrams < 5 ? 1 : entry.expectedGrams < 20 ? 5 : 10;
      const binKey = Math.floor(entry.expectedGrams / binSize) * binSize;
      
      if (!bins.has(binKey)) bins.set(binKey, []);
      bins.get(binKey).push(entry.errorGrams);
    }
    
    const profile = [];
    for (const [weight, errors] of bins) {
      const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
      profile.push({ weight, meanError: mean, count: errors.length });
    }
    
    return profile.sort((a, b) => a.weight - b.weight);
  }

  /**
   * Get suggested correction factor for a weight
   */
  getCorrection(grams) {
    const profile = this.getNonlinearityProfile();
    if (!profile.length) return 0;
    
    // Find nearest bins and interpolate
    let lower = profile[0];
    let upper = profile[profile.length - 1];
    
    for (let i = 0; i < profile.length - 1; i++) {
      if (grams >= profile[i].weight && grams <= profile[i + 1].weight) {
        lower = profile[i];
        upper = profile[i + 1];
        break;
      }
    }
    
    if (lower === upper) return -lower.meanError;
    
    // Linear interpolation
    const t = (grams - lower.weight) / (upper.weight - lower.weight);
    const interpolatedError = lower.meanError + t * (upper.meanError - lower.meanError);
    
    return -interpolatedError; // Return correction (inverse of error)
  }

  /**
   * Clear all error logs
   */
  clear() {
    this.entries = [];
    this._patterns.clear();
    localStorage.removeItem(ERROR_LOG_KEY);
  }

  _load() {
    try {
      return JSON.parse(localStorage.getItem(ERROR_LOG_KEY) || '[]')
        .map(e => new ErrorLogEntry(e));
    } catch {
      return [];
    }
  }

  _save() {
    try {
      localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(this.entries));
    } catch {}
  }

  _analyzePatterns() {
    for (const entry of this.entries) {
      this._updatePatterns(entry);
    }
  }

  _updatePatterns(entry) {
    // Pattern: error by weight range
    const key = `${Math.floor(entry.expectedGrams / 5) * 5}-${Math.floor(entry.expectedGrams / 5) * 5 + 5}g`;
    if (!this._patterns.has(key)) {
      this._patterns.set(key, { errors: [], count: 0 });
    }
    const p = this._patterns.get(key);
    p.errors.push(entry.errorGrams);
    p.count++;
    p.meanError = p.errors.reduce((a, b) => a + b, 0) / p.errors.length;
  }

  async _queueForSync(entry) {
    // Implementation for cloud sync
    const queue = JSON.parse(localStorage.getItem('phoneway_syncQueue') || '[]');
    queue.push(entry);
    if (queue.length > 100) queue.shift();
    localStorage.setItem('phoneway_syncQueue', JSON.stringify(queue));
  }

  /**
   * Generate calibration recommendations based on error patterns
   */
  getCalibrationRecommendations() {
    const recommendations = [];
    const stats = this.getErrorStats();
    
    if (!stats) return recommendations;
    
    // Check for systematic bias
    if (Math.abs(stats.systematicBias) > 0.05) {
      recommendations.push({
        type: 'sensitivity_adjustment',
        severity: Math.abs(stats.systematicBias) > 0.2 ? 'high' : 'medium',
        message: `Systematic ${stats.systematicBias > 0 ? 'over' : 'under'}reading detected. ` +
                 `Adjust sensitivity by ${(Math.abs(stats.systematicBias) / 5 * 100).toFixed(1)}%.`,
        suggestedMultiplier: 1 + stats.systematicBias / -5 // Rough estimate
      });
    }
    
    // Check for high random error
    if (stats.randomError > 0.1) {
      recommendations.push({
        type: 'surface_improvement',
        severity: stats.randomError > 0.3 ? 'high' : 'medium',
        message: `High measurement variance (±${stats.randomError.toFixed(2)}g). ` +
                 `Consider using a softer surface or adding calibration points.`,
        suggestedAction: 'recalibrate_with_more_points'
      });
    }
    
    // Check for non-linearity
    const profile = this.getNonlinearityProfile();
    if (profile.length > 2) {
      const variations = profile.map(p => Math.abs(p.meanError));
      const maxVar = Math.max(...variations);
      if (maxVar > 0.2) {
        recommendations.push({
          type: 'nonlinearity',
          severity: maxVar > 0.5 ? 'high' : 'medium',
          message: `Non-linear response detected across weight ranges. ` +
                   `Consider using quadratic calibration curve.`,
          suggestedAction: 'enable_quadratic_calibration'
        });
      }
    }
    
    return recommendations;
  }
}

/**
 * Global error logger instance
 */
export const globalErrorLogger = new ErrorLogger();

export { ErrorLogger, ErrorLogEntry };
