/**
 * quantumFusion.js — Quantum-Inspired Uncertainty Quantification for Phoneway
 * 
 * Implements advanced uncertainty quantification techniques inspired by quantum
 * mechanics and Bayesian probability theory to achieve sub-0.1g accuracy.
 * 
 * Key innovations:
 *   - Uncertainty wave functions for each sensor
 *   - Interference-based sensor fusion
 *   - Quantum-inspired superposition of measurement hypotheses
 *   - Decoherence tracking for environmental effects
 *   - Bayesian collapse for final measurement
 */

'use strict';

/**
 * UncertaintyWave — models a sensor's measurement as a probability wave
 * Think of it like quantum wave function: higher amplitude = more certain
 */
class UncertaintyWave {
  constructor(sensorName, initialPrecision = 0.1) {
    this.sensorName = sensorName;
    this.amplitude = new Map(); // weight value -> probability amplitude
    this.phase = 0; // interference phase
    this.precision = initialPrecision; // 1σ precision in grams
    this.coherence = 1.0; // how "quantum-like" the uncertainty is (0-1)
    this.lastUpdate = Date.now();
  }

  /**
   * Update the wave with a new measurement
   */
  update(measuredGrams, confidence, timestamp = Date.now()) {
    const dt = (timestamp - this.lastUpdate) / 1000; // seconds
    this.lastUpdate = timestamp;

    // Create Gaussian wave packet
    const sigma = this.precision / confidence; // Narrower with higher confidence
    const newAmplitude = new Map();

    // Sample points around measurement
    const range = sigma * 4;
    const step = sigma / 4;
    
    for (let g = measuredGrams - range; g <= measuredGrams + range; g += step) {
      // Gaussian envelope
      const envelope = Math.exp(-0.5 * Math.pow((g - measuredGrams) / sigma, 2));
      
      // Add interference pattern for uncertainty visualization
      const interference = 1 + 0.1 * Math.cos(this.phase + g * 2 * Math.PI / sigma);
      
      newAmplitude.set(
        Math.round(g * 1000) / 1000, // Quantize to mg
        envelope * interference * confidence
      );
    }

    // Wave function collapse/merge with previous state
    if (this.amplitude.size > 0 && this.coherence > 0.3) {
      // Quantum-like: interference between old and new
      this.amplitude = this._interfere(this.amplitude, newAmplitude, this.coherence);
    } else {
      // Classical: just replace (decoherence)
      this.amplitude = newAmplitude;
    }

    // Update phase (rotates with time, like quantum evolution)
    this.phase += dt * 0.5; // Slow rotation

    // Decay coherence over time (environmental decoherence)
    this.coherence *= Math.exp(-dt / 10); // 10-second coherence time
    this.coherence = Math.max(0.1, Math.min(1, this.coherence));
  }

  /**
   * Interfere two wave functions (quantum-style combination)
   */
  _interfere(wave1, wave2, coherence) {
    const result = new Map();
    const allKeys = new Set([...wave1.keys(), ...wave2.keys()]);

    for (const g of allKeys) {
      const a1 = wave1.get(g) || 0;
      const a2 = wave2.get(g) || 0;

      if (coherence > 0.5) {
        // Quantum: amplitude addition (can constructively/destructively interfere)
        const phaseDiff = this.phase;
        const real = a1 + a2 * Math.cos(phaseDiff);
        const imag = a2 * Math.sin(phaseDiff);
        result.set(g, Math.sqrt(real * real + imag * imag));
      } else {
        // Classical: probability addition
        result.set(g, Math.sqrt(a1 * a1 + a2 * a2));
      }
    }

    return result;
  }

  /**
   * Get the expected value (mean) of the wave function
   */
  getExpectedValue() {
    let sumAmp = 0;
    let sumWeight = 0;

    for (const [g, amp] of this.amplitude) {
      sumWeight += g * amp * amp; // |ψ|² weighting
      sumAmp += amp * amp;
    }

    return sumAmp > 0 ? sumWeight / sumAmp : 0;
  }

  /**
   * Get the uncertainty (standard deviation) of the wave function
   */
  getUncertainty() {
    const mean = this.getExpectedValue();
    let sumVar = 0;
    let sumAmp = 0;

    for (const [g, amp] of this.amplitude) {
      sumVar += Math.pow(g - mean, 2) * amp * amp;
      sumAmp += amp * amp;
    }

    return sumAmp > 0 ? Math.sqrt(sumVar / sumAmp) : Infinity;
  }

  /**
   * Get the measurement probability at a specific weight
   */
  getProbability(grams) {
    // Find nearest quantized value
    const quantized = Math.round(grams * 1000) / 1000;
    const amp = this.amplitude.get(quantized) || 0;
    return amp * amp; // |ψ|²
  }

  /**
   * Induce environmental decoherence (reduces quantum effects)
   */
  decohere(factor = 0.5) {
    this.coherence *= factor;
    this.coherence = Math.max(0.1, this.coherence);
  }

  /**
   * Collapse the wave function to a specific measurement
   * (simulates the act of "looking" at the scale)
   */
  collapse(toGrams) {
    // The wave function collapses to a sharp peak
    this.amplitude.clear();
    const sigma = this.precision / 4; // Very sharp
    for (let g = toGrams - sigma * 3; g <= toGrams + sigma * 3; g += sigma / 2) {
      const amp = Math.exp(-0.5 * Math.pow((g - toGrams) / sigma, 2));
      this.amplitude.set(Math.round(g * 1000) / 1000, amp);
    }
    this.coherence = 0.1; // Classical after measurement
  }
}

/**
 * QuantumFusionEngine — fuses multiple sensor waves using quantum-inspired methods
 */
class QuantumFusionEngine {
  constructor() {
    this.waves = new Map(); // sensor name -> UncertaintyWave
    this.globalCoherence = 1.0;
    this.entanglementMatrix = new Map(); // sensor pairs -> entanglement strength
    this.measurementHistory = [];
    this.lastFusion = null;
  }

  /**
   * Register a sensor with initial precision
   */
  registerSensor(name, precision = 0.1) {
    this.waves.set(name, new UncertaintyWave(name, precision));
  }

  /**
   * Update a sensor's wave function with new data
   */
  updateSensor(name, grams, confidence) {
    let wave = this.waves.get(name);
    if (!wave) {
      wave = new UncertaintyWave(name);
      this.waves.set(name, wave);
    }
    wave.update(grams, confidence);
  }

  /**
   * Entangle two sensors (their uncertainties become correlated)
   */
  entangle(sensor1, sensor2, strength = 0.5) {
    const key = [sensor1, sensor2].sort().join('|');
    this.entanglementMatrix.set(key, {
      sensors: [sensor1, sensor2],
      strength: Math.max(0, Math.min(1, strength))
    });
  }

  /**
   * Calculate the multi-sensor wave function (quantum superposition)
   */
  calculateSuperposition() {
    if (this.waves.size === 0) return null;

    // Start with first wave
    const waves = Array.from(this.waves.values());
    let superposition = new Map(waves[0].amplitude);

    // Add other waves with interference
    for (let i = 1; i < waves.length; i++) {
      const wave = waves[i];
      const newSuper = new Map();
      const allKeys = new Set([...superposition.keys(), ...wave.amplitude.keys()]);

      for (const g of allKeys) {
        const a1 = superposition.get(g) || 0;
        const a2 = wave.amplitude.get(g) || 0;

        // Weighted interference based on sensor coherence
        const weight = wave.coherence;
        const real = a1 * (1 - weight) + a2 * weight * Math.cos(wave.phase);
        const imag = a2 * weight * Math.sin(wave.phase);
        
        newSuper.set(g, Math.sqrt(real * real + imag * imag));
      }

      superposition = newSuper;
    }

    // Normalize
    const norm = Math.sqrt([...superposition.values()].reduce((a, b) => a + b * b, 0));
    if (norm > 0) {
      for (const [g, amp] of superposition) {
        superposition.set(g, amp / norm);
      }
    }

    return superposition;
  }

  /**
   * Perform Bayesian collapse to get final measurement
   */
  collapse() {
    const superposition = this.calculateSuperposition();
    if (!superposition || superposition.size === 0) {
      return { grams: 0, uncertainty: Infinity, confidence: 0 };
    }

    // Calculate statistics
    let mean = 0;
    let sumProb = 0;
    for (const [g, amp] of superposition) {
      const prob = amp * amp;
      mean += g * prob;
      sumProb += prob;
    }
    mean /= sumProb;

    let variance = 0;
    for (const [g, amp] of superposition) {
      const prob = amp * amp;
      variance += prob * Math.pow(g - mean, 2);
    }
    variance /= sumProb;
    const stdDev = Math.sqrt(variance);

    // Confidence based on sharpness of distribution
    const sharpness = 1 / (1 + stdDev * 10); // Higher = sharper peak
    const coherenceBonus = this.globalCoherence * 0.1;
    const confidence = Math.min(0.98, sharpness + coherenceBonus);

    // Find most probable value (mode)
    let mode = mean;
    let maxProb = 0;
    for (const [g, amp] of superposition) {
      const prob = amp * amp;
      if (prob > maxProb) {
        maxProb = prob;
        mode = g;
      }
    }

    const result = {
      grams: mean, // or use mode for discrete preference
      mode,
      uncertainty: stdDev,
      confidence,
      superposition,
      coherence: this.globalCoherence,
      timestamp: Date.now()
    };

    this.lastFusion = result;
    this.measurementHistory.push(result);
    if (this.measurementHistory.length > 100) {
      this.measurementHistory.shift();
    }

    return result;
  }

  /**
   * Get sensor agreement matrix (how well sensors agree with each other)
   */
  getAgreementMatrix() {
    const sensors = Array.from(this.waves.keys());
    const matrix = {};

    for (const s1 of sensors) {
      matrix[s1] = {};
      const w1 = this.waves.get(s1);
      const mean1 = w1.getExpectedValue();
      const std1 = w1.getUncertainty();

      for (const s2 of sensors) {
        if (s1 === s2) {
          matrix[s1][s2] = 1.0;
          continue;
        }

        const w2 = this.waves.get(s2);
        const mean2 = w2.getExpectedValue();
        const std2 = w2.getUncertainty();

        // Calculate overlap integral (probability that both sensors measure the same)
        const combinedStd = Math.sqrt(std1 * std1 + std2 * std2);
        const separation = Math.abs(mean1 - mean2);
        
        // Agreement: 1 = perfect agreement, 0 = complete disagreement
        const agreement = Math.exp(-0.5 * Math.pow(separation / (combinedStd + 0.001), 2));
        matrix[s1][s2] = agreement;
      }
    }

    return matrix;
  }

  /**
   * Identify outlier sensors (those that disagree with the consensus)
   */
  identifyOutliers(threshold = 0.3) {
    const matrix = this.getAgreementMatrix();
    const sensors = Object.keys(matrix);
    const outliers = [];

    for (const s1 of sensors) {
      let totalAgreement = 0;
      let count = 0;

      for (const s2 of sensors) {
        if (s1 !== s2) {
          totalAgreement += matrix[s1][s2];
          count++;
        }
      }

      const avgAgreement = count > 0 ? totalAgreement / count : 0;
      if (avgAgreement < threshold) {
        outliers.push({
          sensor: s1,
          agreement: avgAgreement,
          expectedValue: this.waves.get(s1).getExpectedValue(),
          uncertainty: this.waves.get(s1).getUncertainty()
        });
      }
    }

    return outliers;
  }

  /**
   * Get measurement stability score (how consistent readings are over time)
   */
  getStabilityScore(windowSize = 10) {
    if (this.measurementHistory.length < windowSize) return 0;

    const recent = this.measurementHistory.slice(-windowSize);
    const values = recent.map(r => r.grams);
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const cv = Math.sqrt(variance) / (mean + 0.001); // Coefficient of variation

    // Stability: 1 = perfectly stable, 0 = highly variable
    return Math.max(0, 1 - cv * 10);
  }

  /**
   * Simulate environmental decoherence (call when environment is noisy)
   */
  induceDecoherence(factor = 0.7) {
    this.globalCoherence *= factor;
    this.globalCoherence = Math.max(0.1, Math.min(1, this.globalCoherence));

    for (const wave of this.waves.values()) {
      wave.decohere(factor);
    }
  }

  /**
   * Restore coherence (call after calibration or stable period)
   */
  restoreCoherence() {
    this.globalCoherence = Math.min(1, this.globalCoherence * 1.2 + 0.1);
    
    for (const wave of this.waves.values()) {
      wave.coherence = Math.min(1, wave.coherence * 1.2 + 0.1);
    }
  }

  /**
   * Get detailed uncertainty report for UI
   */
  getUncertaintyReport() {
    const superposition = this.calculateSuperposition();
    const collapsed = this.collapse();
    const outliers = this.identifyOutliers();
    const stability = this.getStabilityScore();

    // Calculate confidence intervals
    const sorted = [...(superposition || new Map()).entries()]
      .sort((a, b) => b[1] - a[1]); // By amplitude descending

    let cumulativeProb = 0;
    const confidence68 = []; // 1 sigma
    const confidence95 = []; // 2 sigma

    for (const [g, amp] of sorted) {
      const prob = amp * amp;
      cumulativeProb += prob;

      if (cumulativeProb <= 0.683) confidence68.push(g);
      if (cumulativeProb <= 0.954) confidence95.push(g);
    }

    return {
      collapsed,
      outliers,
      stability,
      globalCoherence: this.globalCoherence,
      sensorCount: this.waves.size,
      activeSensors: Array.from(this.waves.keys()).filter(s => 
        this.waves.get(s).amplitude.size > 0
      ),
      confidenceIntervals: {
        sigma1: {
          min: Math.min(...confidence68),
          max: Math.max(...confidence68)
        },
        sigma2: {
          min: Math.min(...confidence95),
          max: Math.max(...confidence95)
        }
      },
      waveVisualization: superposition ? 
        [...superposition.entries()].map(([g, amp]) => ({ g, amp, prob: amp * amp })) :
        []
    };
  }

  reset() {
    this.waves.clear();
    this.globalCoherence = 1.0;
    this.entanglementMatrix.clear();
    this.measurementHistory = [];
    this.lastFusion = null;
  }
}

/**
 * HypothesisSpace — tracks multiple measurement hypotheses simultaneously
 * Inspired by quantum superposition: multiple possibilities coexist
 */
class HypothesisSpace {
  constructor() {
    this.hypotheses = new Map(); // hypothesis ID -> { weight, probability, evidence }
    this.evidenceWeights = new Map(); // sensor -> reliability
  }

  /**
   * Add evidence for a weight hypothesis
   */
  addEvidence(weight, sensor, confidence, evidence = {}) {
    const quantized = Math.round(weight * 100) / 100; // 10mg resolution
    
    if (!this.hypotheses.has(quantized)) {
      this.hypotheses.set(quantized, {
        weight: quantized,
        probability: 0,
        evidence: new Map(),
        timestamp: Date.now()
      });
    }

    const h = this.hypotheses.get(quantized);
    h.evidence.set(sensor, { confidence, ...evidence });
    h.timestamp = Date.now();

    // Recalculate probability using Bayes
    this._updateProbabilities();
  }

  /**
   * Bayesian update of all probabilities
   */
  _updateProbabilities() {
    // Prior: uniform over active hypotheses
    const prior = 1 / this.hypotheses.size;

    for (const [weight, h] of this.hypotheses) {
      let likelihood = 1;

      for (const [sensor, evidence] of h.evidence) {
        // Weight by sensor reliability
        const reliability = this.evidenceWeights.get(sensor) || 0.5;
        likelihood *= Math.pow(evidence.confidence, reliability);
      }

      // Unnormalized posterior
      h.probability = prior * likelihood;
    }

    // Normalize
    const total = [...this.hypotheses.values()].reduce((a, h) => a + h.probability, 0);
    if (total > 0) {
      for (const h of this.hypotheses.values()) {
        h.probability /= total;
      }
    }
  }

  /**
   * Get the most probable hypothesis
   */
  getMostProbable() {
    let best = null;
    let maxProb = 0;

    for (const h of this.hypotheses.values()) {
      if (h.probability > maxProb) {
        maxProb = h.probability;
        best = h;
      }
    }

    return best;
  }

  /**
   * Get probability distribution
   */
  getDistribution() {
    return [...this.hypotheses.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([weight, h]) => ({
        weight,
        probability: h.probability,
        evidenceCount: h.evidence.size
      }));
  }

  /**
   * Prune old/low-probability hypotheses
   */
  prune(minProbability = 0.01, maxAge = 5000) {
    const now = Date.now();
    
    for (const [weight, h] of this.hypotheses) {
      if (h.probability < minProbability || now - h.timestamp > maxAge) {
        this.hypotheses.delete(weight);
      }
    }

    this._updateProbabilities();
  }

  reset() {
    this.hypotheses.clear();
  }
}

export {
  UncertaintyWave,
  QuantumFusionEngine,
  HypothesisSpace
};
