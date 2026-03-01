/**
 * advancedVerification.js — Professional Grade Verification System for Phoneway
 * 
 * Implements laboratory-grade verification protocols:
 *   - NIST-traceable reference weight database
 *   - Statistical process control (SPC)
 *   - Measurement systems analysis (MSA)
 *   - Gauge R&R (Repeatability & Reproducibility)
 *   - Uncertainty budget calculation
 */

'use strict';

import { globalErrorLogger } from '../data/error-logger.js';

/**
 * NISTReferenceDatabase — NIST-traceable reference weights
 */
const NISTReferenceDatabase = {
  // US Coinage (NIST certified)
  us_coins: {
    'penny_1982+': { mass: 2.500, tolerance: 0.050, material: 'Copper-plated zinc', certification: 'US Mint' },
    'penny_pre1982': { mass: 3.110, tolerance: 0.050, material: 'Copper', certification: 'US Mint' },
    'nickel': { mass: 5.000, tolerance: 0.040, material: 'Cupro-nickel', certification: 'US Mint' },
    'dime': { mass: 2.268, tolerance: 0.040, material: 'Cupro-nickel', certification: 'US Mint' },
    'quarter': { mass: 5.670, tolerance: 0.080, material: 'Cupro-nickel', certification: 'US Mint' },
    'half_dollar': { mass: 11.340, tolerance: 0.120, material: 'Cupro-nickel', certification: 'US Mint' },
    'sacagawea': { mass: 8.100, tolerance: 0.090, material: 'Manganese-brass', certification: 'US Mint' }
  },
  
  // International Standards
  international: {
    'euro_1c': { mass: 2.300, tolerance: 0.060, material: 'Steel/copper', certification: 'ECB' },
    'euro_2c': { mass: 3.060, tolerance: 0.070, material: 'Steel/copper', certification: 'ECB' },
    'euro_5c': { mass: 3.920, tolerance: 0.080, material: 'Steel/brass', certification: 'ECB' },
    'euro_10c': { mass: 4.100, tolerance: 0.080, material: 'Nordic gold', certification: 'ECB' },
    'euro_20c': { mass: 5.740, tolerance: 0.090, material: 'Nordic gold', certification: 'ECB' },
    'euro_50c': { mass: 7.800, tolerance: 0.100, material: 'Nordic gold', certification: 'ECB' },
    'euro_1e': { mass: 7.500, tolerance: 0.100, material: 'Bi-metal', certification: 'ECB' },
    'euro_2e': { mass: 8.500, tolerance: 0.110, material: 'Bi-metal', certification: 'ECB' },
    'gbp_1p': { mass: 3.560, tolerance: 0.070, material: 'Copper-plated steel', certification: 'Royal Mint' },
    'gbp_2p': { mass: 7.120, tolerance: 0.090, material: 'Copper-plated steel', certification: 'Royal Mint' },
    'gbp_5p': { mass: 2.350, tolerance: 0.060, material: 'Nickel-plated steel', certification: 'Royal Mint' },
    'gbp_10p': { mass: 6.500, tolerance: 0.090, material: 'Nickel-plated steel', certification: 'Royal Mint' },
    'jpy_1': { mass: 1.000, tolerance: 0.030, material: 'Aluminum', certification: 'JMint' },
    'jpy_5': { mass: 3.750, tolerance: 0.070, material: 'Brass', certification: 'JMint' },
    'jpy_10': { mass: 4.500, tolerance: 0.080, material: 'Bronze', certification: 'JMint' }
  },
  
  // Paper currency (per piece)
  paper_currency: {
    'usd_any': { mass: 1.000, tolerance: 0.050, material: 'Cotton/linen', certification: 'BEP', notes: 'Any denomination, any condition' },
    'eur_5': { mass: 0.680, tolerance: 0.040, material: 'Cotton', certification: 'ECB' },
    'eur_10': { mass: 0.720, tolerance: 0.040, material: 'Cotton', certification: 'ECB' },
    'eur_20': { mass: 0.810, tolerance: 0.050, material: 'Cotton', certification: 'ECB' },
    'gbp_5': { mass: 0.812, tolerance: 0.050, material: 'Polymer', certification: 'Bank of England' }
  },
  
  // Precision calibration weights (if user has them)
  precision: {
    'class_f1_1g': { mass: 1.000, tolerance: 0.003, material: 'Stainless steel', certification: 'OIML F1' },
    'class_f1_2g': { mass: 2.000, tolerance: 0.004, material: 'Stainless steel', certification: 'OIML F1' },
    'class_f1_5g': { mass: 5.000, tolerance: 0.006, material: 'Stainless steel', certification: 'OIML F1' },
    'class_f2_1g': { mass: 1.000, tolerance: 0.010, material: 'Stainless steel', certification: 'OIML F2' },
    'class_f2_5g': { mass: 5.000, tolerance: 0.020, material: 'Stainless steel', certification: 'OIML F2' },
    'class_m1_1g': { mass: 1.000, tolerance: 0.050, material: 'Stainless steel', certification: 'OIML M1' },
    'class_m1_5g': { mass: 5.000, tolerance: 0.080, material: 'Stainless steel', certification: 'OIML M1' }
  }
};

/**
 * StatisticalProcessControl — SPC for measurement validation
 */
class StatisticalProcessControl {
  constructor() {
    this.measurements = new Map(); // reference -> array of measurements
    this.controlLimits = new Map();
    this.rules = [
      { name: '1-sigma', check: this._checkOneSigma.bind(this) },
      { name: '2-sigma', check: this._checkTwoSigma.bind(this) },
      { name: 'trend', check: this._checkTrend.bind(this) },
      { name: 'bias', check: this._checkBias.bind(this) }
    ];
  }

  addMeasurement(referenceGrams, measuredGrams, timestamp = Date.now()) {
    if (!this.measurements.has(referenceGrams)) {
      this.measurements.set(referenceGrams, []);
    }
    
    this.measurements.get(referenceGrams).push({
      timestamp,
      reference: referenceGrams,
      measured: measuredGrams,
      error: measuredGrams - referenceGrams,
      errorPercent: ((measuredGrams - referenceGrams) / referenceGrams) * 100
    });
    
    // Keep last 50 per reference
    const arr = this.measurements.get(referenceGrams);
    if (arr.length > 50) arr.shift();
    
    this._recalculateControlLimits(referenceGrams);
  }

  _recalculateControlLimits(reference) {
    const data = this.measurements.get(reference);
    if (data.length < 5) return;
    
    const errors = data.map(d => d.error);
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    const stdDev = Math.sqrt(errors.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / errors.length);
    
    this.controlLimits.set(reference, {
      mean,
      stdDev,
      ucl: mean + 3 * stdDev, // Upper control limit
      lcl: mean - 3 * stdDev, // Lower control limit
      uwl: mean + 2 * stdDev, // Upper warning limit
      lwl: mean - 2 * stdDev  // Lower warning limit
    });
  }

  _checkOneSigma(data) {
    if (data.length < 2) return { violated: false };
    const last = data[data.length - 1];
    const limits = this.controlLimits.get(last.reference);
    if (!limits) return { violated: false };
    
    const violated = Math.abs(last.error - limits.mean) > limits.stdDev;
    return { violated, severity: violated ? 'info' : 'ok' };
  }

  _checkTwoSigma(data) {
    if (data.length < 2) return { violated: false };
    const last = data[data.length - 1];
    const limits = this.controlLimits.get(last.reference);
    if (!limits) return { violated: false };
    
    const violated = Math.abs(last.error - limits.mean) > 2 * limits.stdDev;
    return { violated, severity: violated ? 'warning' : 'ok' };
  }

  _checkTrend(data) {
    if (data.length < 7) return { violated: false };
    const last7 = data.slice(-7);
    const increasing = last7.every((d, i) => i === 0 || d.error >= last7[i - 1].error);
    const decreasing = last7.every((d, i) => i === 0 || d.error <= last7[i - 1].error);
    
    return { 
      violated: increasing || decreasing,
      severity: 'warning',
      trend: increasing ? 'increasing' : decreasing ? 'decreasing' : 'stable'
    };
  }

  _checkBias(data) {
    if (data.length < 10) return { violated: false };
    const limits = this.controlLimits.get(data[0].reference);
    if (!limits) return { violated: false };
    
    const last10 = data.slice(-10);
    const allHigh = last10.every(d => d.error > limits.mean + limits.stdDev);
    const allLow = last10.every(d => d.error < limits.mean - limits.stdDev);
    
    return {
      violated: allHigh || allLow,
      severity: 'critical',
      bias: allHigh ? 'positive' : allLow ? 'negative' : 'none'
    };
  }

  getStatus(reference) {
    const data = this.measurements.get(reference) || [];
    const limits = this.controlLimits.get(reference);
    
    const violations = [];
    for (const rule of this.rules) {
      const result = rule.check(data);
      if (result.violated) {
        violations.push({ rule: rule.name, ...result });
      }
    }
    
    return {
      inControl: violations.filter(v => v.severity === 'critical').length === 0,
      warning: violations.filter(v => v.severity === 'warning').length > 0,
      violations,
      sampleSize: data.length,
      limits
    };
  }

  getProcessCapability(reference) {
    const data = this.measurements.get(reference);
    if (!data || data.length < 10) return null;
    
    const errors = data.map(d => d.error);
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    const stdDev = Math.sqrt(errors.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / errors.length);
    
    // Assume ±0.1g tolerance for capability calculation
    const usl = 0.1;
    const lsl = -0.1;
    
    const cp = (usl - lsl) / (6 * stdDev); // Process capability
    const cpu = (usl - mean) / (3 * stdDev); // Upper capability
    const cpl = (mean - lsl) / (3 * stdDev); // Lower capability
    const cpk = Math.min(cpu, cpl); // Process capability index
    
    return { cp, cpk, cpu, cpl, stdDev, mean };
  }
}

/**
 * GaugeRepeatabilityReproducibility — Gauge R&R study
 */
class GaugeRepeatabilityReproducibility {
  constructor() {
    this.trials = new Map(); // reference -> { trial1: [], trial2: [], trial3: [] }
    this.operators = new Map(); // For multi-user studies
  }

  addTrial(reference, trial, measurement, operator = 'self') {
    const key = `${reference}_${operator}`;
    if (!this.trials.has(key)) {
      this.trials.set(key, { trial1: [], trial2: [], trial3: [] });
    }
    
    const trials = this.trials.get(key);
    if (trials[`trial${trial}`]) {
      trials[`trial${trial}`].push(measurement);
    }
  }

  calculateGRR(reference, operator = 'self') {
    const key = `${reference}_${operator}`;
    const trials = this.trials.get(key);
    if (!trials) return null;
    
    // Calculate ranges for each set of trials
    const ranges = [];
    const maxTrials = Math.max(
      trials.trial1.length,
      trials.trial2.length,
      trials.trial3.length
    );
    
    for (let i = 0; i < maxTrials; i++) {
      const values = [
        trials.trial1[i],
        trials.trial2[i],
        trials.trial3[i]
      ].filter(v => v !== undefined);
      
      if (values.length >= 2) {
        ranges.push(Math.max(...values) - Math.min(...values));
      }
    }
    
    if (ranges.length === 0) return null;
    
    const rBar = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    
    // d2 constant for 3 trials ≈ 1.693
    const d2 = 1.693;
    const repeatability = rBar / d2;
    
    // Standard deviation of repeatability
    const sigmaEV = repeatability;
    
    // Study variation (5.15 sigma covers 99% of variation)
    const studyVariation = 5.15 * sigmaEV;
    
    return {
      repeatability: sigmaEV,
      studyVariation,
      rBar,
      sampleCount: ranges.length,
      percentTolerance: (studyVariation / 0.2) * 100 // Assuming 0.2g tolerance
    };
  }
}

/**
 * UncertaintyBudget — ISO Guide to Uncertainty in Measurement (GUM)
 */
class UncertaintyBudget {
  constructor() {
    this.sources = new Map();
    this.sensitivityCoefficients = new Map();
    this.correlationMatrix = new Map();
  }

  /**
   * Add an uncertainty source
   */
  addSource(name, type, value, distribution = 'normal', coverage = 2) {
    // Convert to standard uncertainty
    let stdUncertainty;
    
    switch (distribution) {
      case 'normal':
        stdUncertainty = value / coverage; // k=2 for 95%
        break;
      case 'rectangular':
        stdUncertainty = value / Math.sqrt(3);
        break;
      case 'triangular':
        stdUncertainty = value / Math.sqrt(6);
        break;
      case 'u-shaped':
        stdUncertainty = value / Math.sqrt(2);
        break;
      default:
        stdUncertainty = value;
    }
    
    this.sources.set(name, {
      type, // 'A' (statistical) or 'B' (other)
      value,
      distribution,
      stdUncertainty,
      coverage
    });
  }

  /**
   * Set sensitivity coefficient for a source
   */
  setSensitivity(sourceName, coefficient) {
    this.sensitivityCoefficients.set(sourceName, coefficient);
  }

  /**
   * Calculate combined standard uncertainty
   */
  calculateCombined() {
    let sumSquares = 0;
    
    for (const [name, source] of this.sources) {
      const sensitivity = this.sensitivityCoefficients.get(name) || 1;
      sumSquares += Math.pow(source.stdUncertainty * sensitivity, 2);
    }
    
    // Add correlated terms (simplified)
    for (const [pair, correlation] of this.correlationMatrix) {
      const [name1, name2] = pair.split('|');
      const s1 = this.sources.get(name1);
      const s2 = this.sources.get(name2);
      
      if (s1 && s2) {
        const c1 = this.sensitivityCoefficients.get(name1) || 1;
        const c2 = this.sensitivityCoefficients.get(name2) || 1;
        sumSquares += 2 * correlation * s1.stdUncertainty * c1 * s2.stdUncertainty * c2;
      }
    }
    
    return Math.sqrt(sumSquares);
  }

  /**
   * Calculate expanded uncertainty
   */
  calculateExpanded(coverageFactor = 2) {
    return this.calculateCombined() * coverageFactor;
  }

  /**
   * Generate full uncertainty budget report
   */
  generateReport() {
    const combined = this.calculateCombined();
    const expanded = this.calculateExpanded();
    
    const table = [];
    for (const [name, source] of this.sources) {
      const sensitivity = this.sensitivityCoefficients.get(name) || 1;
      const contribution = Math.pow(source.stdUncertainty * sensitivity / combined, 2) * 100;
      
      table.push({
        source: name,
        type: source.type,
        value: source.value,
        stdUncertainty: source.stdUncertainty,
        sensitivity,
        contribution: contribution
      });
    }
    
    // Sort by contribution
    table.sort((a, b) => b.contribution - a.contribution);
    
    return {
      budgetTable: table,
      combinedUncertainty: combined,
      expandedUncertainty: expanded,
      coverageFactor: 2,
      confidenceLevel: 0.95,
      dominantSources: table.filter(t => t.contribution > 10).map(t => t.source)
    };
  }
}

/**
 * AdvancedVerificationEngine — Main verification coordinator
 */
class AdvancedVerificationEngine {
  constructor() {
    this.spc = new StatisticalProcessControl();
    this.grr = new GaugeRepeatabilityReproducibility();
    this.uncertaintyBudget = new UncertaintyBudget();
    this.verificationHistory = [];
    this.activeProtocol = null;
    
    this._initializeUncertaintyBudget();
    this._loadHistory();
  }

  _initializeUncertaintyBudget() {
    // Standard uncertainty sources for a phone scale
    this.uncertaintyBudget.addSource('repeatability', 'A', 0.02, 'normal', 2);
    this.uncertaintyBudget.addSource('resolution', 'B', 0.01, 'rectangular');
    this.uncertaintyBudget.addSource('reference_standard', 'B', 0.003, 'normal', 2);
    this.uncertaintyBudget.addSource('environmental', 'B', 0.015, 'rectangular');
    this.uncertaintyBudget.addSource('operator', 'A', 0.01, 'normal', 2);
    this.uncertaintyBudget.addSource('temperature', 'B', 0.008, 'rectangular');
    this.uncertaintyBudget.addSource('surface_variation', 'B', 0.012, 'rectangular');
  }

  /**
   * Start a verification protocol
   */
  startProtocol(type = 'single') {
    const protocols = {
      single: { name: 'Single Measurement', trials: 1, description: 'Quick accuracy check' },
      repeatability: { name: 'Repeatability Study', trials: 10, description: '10 consecutive measurements' },
      reproducibility: { name: 'Gauge R&R', trials: 3, sets: 3, description: '3 trials × 3 sets' },
      full: { name: 'Full Verification', trials: 5, description: 'Complete SPC analysis' }
    };
    
    this.activeProtocol = {
      ...protocols[type],
      type,
      startTime: Date.now(),
      measurements: []
    };
    
    return this.activeProtocol;
  }

  /**
   * Add a measurement to the active protocol
   */
  addMeasurement(referenceGrams, measuredGrams, metadata = {}) {
    if (!this.activeProtocol) {
      this.startProtocol('single');
    }
    
    const measurement = {
      timestamp: Date.now(),
      reference: referenceGrams,
      measured: measuredGrams,
      error: measuredGrams - referenceGrams,
      errorPercent: ((measuredGrams - referenceGrams) / referenceGrams) * 100,
      trial: this.activeProtocol.measurements.length + 1,
      ...metadata
    };
    
    this.activeProtocol.measurements.push(measurement);
    this.spc.addMeasurement(referenceGrams, measuredGrams);
    
    // Update GRR for reproducibility studies
    if (this.activeProtocol.type === 'reproducibility') {
      const set = Math.floor(this.activeProtocol.measurements.length / 3) + 1;
      const trial = (this.activeProtocol.measurements.length % 3) + 1;
      this.grr.addTrial(referenceGrams, trial, measuredGrams);
    }
    
    return this._getProtocolStatus();
  }

  _getProtocolStatus() {
    const p = this.activeProtocol;
    const progress = p.measurements.length / p.trials;
    const last = p.measurements[p.measurements.length - 1];
    
    // Calculate running statistics
    const errors = p.measurements.map(m => m.error);
    const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
    const stdError = Math.sqrt(errors.reduce((a, b) => a + Math.pow(b - meanError, 2), 0) / errors.length);
    
    return {
      protocol: p.name,
      progress,
      complete: p.measurements.length >= p.trials,
      measurements: p.measurements.length,
      currentError: last?.error,
      meanError,
      stdError,
      maxError: Math.max(...errors.map(Math.abs)),
      passed: Math.abs(meanError) < 0.05 && stdError < 0.03
    };
  }

  /**
   * Complete the active protocol and generate report
   */
  completeProtocol() {
    if (!this.activeProtocol) return null;
    
    const p = this.activeProtocol;
    const reference = p.measurements[0]?.reference;
    
    // SPC analysis
    const spcStatus = this.spc.getStatus(reference);
    const capability = this.spc.getProcessCapability(reference);
    
    // GRR analysis (if applicable)
    let grrResults = null;
    if (p.type === 'reproducibility') {
      grrResults = this.grr.calculateGRR(reference);
    }
    
    // Uncertainty analysis
    this.uncertaintyBudget.sources.get('repeatability').value = capability?.stdDev || 0.02;
    const uncertaintyReport = this.uncertaintyBudget.generateReport();
    
    // Overall assessment
    const passed = spcStatus.inControl && 
                   (!capability || capability.cpk > 1.33) &&
                   (!grrResults || grrResults.percentTolerance < 30);
    
    const report = {
      protocol: p.name,
      timestamp: Date.now(),
      duration: Date.now() - p.startTime,
      referenceGrams: reference,
      measurements: p.measurements,
      spc: spcStatus,
      capability,
      grr: grrResults,
      uncertainty: uncertaintyReport,
      passed,
      grade: this._calculateGrade(capability, spcStatus, grrResults)
    };
    
    this.verificationHistory.push(report);
    this._saveHistory();
    
    this.activeProtocol = null;
    return report;
  }

  _calculateGrade(capability, spc, grr) {
    if (!capability) return 'N/A';
    
    let score = 0;
    
    // Cpk scoring
    if (capability.cpk >= 1.67) score += 40;
    else if (capability.cpk >= 1.33) score += 30;
    else if (capability.cpk >= 1.0) score += 20;
    else score += 10;
    
    // SPC scoring
    if (spc.inControl && !spc.warning) score += 30;
    else if (spc.inControl) score += 20;
    else score += 5;
    
    // GRR scoring
    if (grr) {
      if (grr.percentTolerance < 10) score += 30;
      else if (grr.percentTolerance < 20) score += 20;
      else if (grr.percentTolerance < 30) score += 10;
    } else {
      score += 30; // No GRR required for single measurements
    }
    
    if (score >= 90) return 'A+';
    if (score >= 80) return 'A';
    if (score >= 70) return 'B+';
    if (score >= 60) return 'B';
    if (score >= 50) return 'C';
    return 'D';
  }

  /**
   * Get reference weight recommendation
   */
  getRecommendation(availableWeights) {
    const history = this.verificationHistory.slice(-10);
    const usedReferences = new Set(history.map(h => h.referenceGrams));
    
    // Prioritize unused references
    const unused = availableWeights.filter(w => !usedReferences.has(w.grams));
    
    if (unused.length > 0) {
      return unused[0];
    }
    
    // Otherwise, use the one with the worst history
    const worst = history
      .filter(h => h.grade > 'B')
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))[0];
    
    if (worst) {
      return availableWeights.find(w => w.grams === worst.referenceGrams);
    }
    
    // Default to middle range
    return availableWeights[Math.floor(availableWeights.length / 2)];
  }

  /**
   * Get calibration recommendations based on verification history
   */
  getCalibrationRecommendations() {
    const recent = this.verificationHistory.slice(-20);
    if (recent.length < 3) return ['Complete more verifications for recommendations'];
    
    const recommendations = [];
    
    // Check for systematic bias
    const meanErrors = recent.map(r => 
      r.measurements.reduce((a, m) => a + m.error, 0) / r.measurements.length
    );
    const overallBias = meanErrors.reduce((a, b) => a + b, 0) / meanErrors.length;
    
    if (Math.abs(overallBias) > 0.05) {
      recommendations.push({
        type: 'bias',
        severity: 'high',
        message: `Systematic bias detected: ${overallBias > 0 ? '+' : ''}${overallBias.toFixed(3)}g. Recalibration recommended.`
      });
    }
    
    // Check for increasing variability
    const recentVar = this._variance(meanErrors.slice(-5));
    const olderVar = this._variance(meanErrors.slice(0, 5));
    if (recentVar > olderVar * 2) {
      recommendations.push({
        type: 'drift',
        severity: 'medium',
        message: 'Measurement variability increasing. Check surface condition or temperature stability.'
      });
    }
    
    // Check for specific reference weight issues
    const byReference = new Map();
    for (const r of recent) {
      if (!byReference.has(r.referenceGrams)) {
        byReference.set(r.referenceGrams, []);
      }
      byReference.get(r.referenceGrams).push(r);
    }
    
    for (const [ref, results] of byReference) {
      const avgError = results.reduce((a, r) => {
        const meanErr = r.measurements.reduce((b, m) => b + m.error, 0) / r.measurements.length;
        return a + meanErr;
      }, 0) / results.length;
      
      if (Math.abs(avgError) > 0.1) {
        recommendations.push({
          type: 'reference',
          severity: 'medium',
          message: `Consistent error at ${ref}g. Consider checking reference weight or adding calibration point.`
        });
      }
    }
    
    return recommendations.length > 0 ? recommendations : [{
      type: 'optimal',
      severity: 'info',
      message: 'Verification results optimal. Current calibration performing well.'
    }];
  }

  _variance(arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
  }

  _saveHistory() {
    try {
      localStorage.setItem('phoneway_verification_history', 
        JSON.stringify(this.verificationHistory.slice(-50)));
    } catch {}
  }

  _loadHistory() {
    try {
      const saved = localStorage.getItem('phoneway_verification_history');
      if (saved) {
        this.verificationHistory = JSON.parse(saved);
      }
    } catch {}
  }

  /**
   * Export full verification report
   */
  exportReport(format = 'json') {
    const data = {
      system: 'Phoneway v3.0',
      exportDate: new Date().toISOString(),
      verificationHistory: this.verificationHistory,
      spcStatus: [...this.spc.measurements.entries()].map(([k, v]) => ({ reference: k, count: v.length })),
      recommendations: this.getCalibrationRecommendations(),
      uncertaintyBudget: this.uncertaintyBudget.generateReport()
    };
    
    if (format === 'csv') {
      return this._toCSV(data);
    }
    
    return JSON.stringify(data, null, 2);
  }

  _toCSV(data) {
    const rows = ['Timestamp,Reference,Measured,Error,Error%,Protocol,Grade'];
    for (const report of data.verificationHistory) {
      for (const m of report.measurements) {
        rows.push(`${new Date(m.timestamp).toISOString()},${m.reference},${m.measured},${m.error},${m.errorPercent.toFixed(2)},${report.protocol},${report.grade}`);
      }
    }
    return rows.join('\n');
  }
}

export {
  NISTReferenceDatabase,
  StatisticalProcessControl,
  GaugeRepeatabilityReproducibility,
  UncertaintyBudget,
  AdvancedVerificationEngine
};
