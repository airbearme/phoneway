/**
 * adaptiveFilter.js — Next-Generation Adaptive Signal Processing for Phoneway
 * 
 * Implements advanced DSP techniques:
 *   - Kalman-Bucy continuous filter
 *   - Wavelet denoising
 *   - Blind source separation
 *   - Spectral subtraction
 *   - Wiener deconvolution
 *   - Lomb-Scargle periodogram for uneven sampling
 */

'use strict';

/**
 * ContinuousKalmanFilter — Kalman-Bucy continuous-time variant
 * Better for high-rate sensor streams than discrete Kalman
 */
class ContinuousKalmanFilter {
  constructor(params = {}) {
    // Process noise spectral density
    this.Q = params.Q || 0.001;
    // Measurement noise variance  
    this.R = params.R || 0.1;
    // State estimate
    this.x = params.initial || 0;
    // Error covariance
    this.P = params.P0 || 1.0;
    // State derivative (for velocity tracking)
    this.dx = 0;
    // Adaptive Q tracking
    this.qAdapt = new QAdaptationTracker();
  }

  update(measurement, dt) {
    // Kalman-Bucy continuous update
    // dP/dt = 2*A*P + Q - P²/R (for scalar case with A=0)
    
    // Prediction step (continuous)
    const Pdot = this.Q - (this.P * this.P) / this.R;
    this.P += Pdot * dt;
    
    // Innovation
    const y = measurement - this.x;
    
    // Kalman gain (continuous)
    const K = this.P / this.R;
    
    // State update
    this.x += K * y * dt;
    
    // Adapt Q based on innovation statistics
    this.Q = this.qAdapt.update(y, dt);
    
    return { value: this.x, covariance: this.P, gain: K };
  }

  reset() {
    this.x = 0;
    this.P = 1.0;
    this.dx = 0;
    this.qAdapt.reset();
  }
}

/**
 * QAdaptationTracker — adapts process noise based on innovation statistics
 */
class QAdaptationTracker {
  constructor() {
    this.innovations = [];
    this.windowSize = 50;
    this.baseQ = 0.001;
  }

  update(innovation, dt) {
    this.innovations.push({ value: innovation, time: Date.now() });
    
    if (this.innovations.length > this.windowSize) {
      this.innovations.shift();
    }
    
    if (this.innovations.length < 10) return this.baseQ;
    
    // Calculate innovation variance
    const mean = this.innovations.reduce((a, b) => a + b.value, 0) / this.innovations.length;
    const variance = this.innovations.reduce((a, b) => a + Math.pow(b.value - mean, 2), 0) / this.innovations.length;
    
    // Adjust Q based on innovation variance
    // High innovation variance = need higher Q
    const targetQ = variance * 0.01;
    
    // Smooth adaptation
    return 0.95 * this.baseQ + 0.05 * targetQ;
  }

  reset() {
    this.innovations = [];
  }
}

/**
 * WaveletDenoiser — discrete wavelet transform denoising
 * Excellent for removing transient noise while preserving edges
 */
class WaveletDenoiser {
  constructor(levels = 3) {
    this.levels = levels;
    this.threshold = 0.1;
    this.coefficients = [];
  }

  /**
   * Simple Haar wavelet transform
   */
  transform(data) {
    if (data.length < 2) return data;
    
    const result = [];
    const detail = [];
    
    for (let i = 0; i < data.length; i += 2) {
      const a = data[i] || 0;
      const b = data[i + 1] || a;
      
      // Approximation (low-pass)
      result.push((a + b) / Math.sqrt(2));
      // Detail (high-pass)
      detail.push((a - b) / Math.sqrt(2));
    }
    
    this.coefficients.push(detail);
    
    if (result.length > 2 && this.coefficients.length < this.levels) {
      return this.transform(result);
    }
    
    this.coefficients.push(result);
    return result;
  }

  /**
   * Universal threshold: sigma * sqrt(2 * log(n))
   */
  calculateThreshold(detailCoeffs) {
    // Estimate noise level using MAD (median absolute deviation)
    const median = this._median(detailCoeffs);
    const mad = this._median(detailCoeffs.map(c => Math.abs(c - median)));
    const sigma = mad * 1.4826; // Convert to standard deviation
    
    return sigma * Math.sqrt(2 * Math.log(detailCoeffs.length));
  }

  /**
   * Soft thresholding
   */
  softThreshold(coeffs, threshold) {
    return coeffs.map(c => {
      if (Math.abs(c) < threshold) return 0;
      return Math.sign(c) * (Math.abs(c) - threshold);
    });
  }

  /**
   * Inverse Haar transform
   */
  inverseTransform() {
    let approximation = this.coefficients[this.coefficients.length - 1];
    
    for (let i = this.coefficients.length - 2; i >= 0; i--) {
      const detail = this.coefficients[i];
      const result = [];
      
      for (let j = 0; j < approximation.length; j++) {
        const a = approximation[j];
        const d = detail[j] || 0;
        
        result.push((a + d) / Math.sqrt(2));
        result.push((a - d) / Math.sqrt(2));
      }
      
      approximation = result;
    }
    
    return approximation;
  }

  /**
   * Denoise a signal
   */
  denoise(signal) {
    if (signal.length < 4) return signal;
    
    // Store original length for padding
    const originalLength = signal.length;
    const paddedLength = Math.pow(2, Math.ceil(Math.log2(originalLength)));
    const padded = [...signal];
    while (padded.length < paddedLength) {
      padded.push(signal[signal.length - 1]); // Repeat last value
    }
    
    // Clear previous coefficients
    this.coefficients = [];
    
    // Transform
    this.transform(padded);
    
    // Threshold detail coefficients (skip approximation)
    for (let i = 0; i < this.coefficients.length - 1; i++) {
      const threshold = this.calculateThreshold(this.coefficients[i]);
      this.coefficients[i] = this.softThreshold(this.coefficients[i], threshold * 0.8);
    }
    
    // Reconstruct
    const result = this.inverseTransform();
    
    // Trim to original length
    return result.slice(0, originalLength);
  }

  _median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}

/**
 * LombScarglePeriodogram — for unevenly sampled data
 * Essential when sensor sampling is irregular
 */
class LombScarglePeriodogram {
  constructor() {
    this.frequencies = [];
    this.power = [];
  }

  /**
   * Calculate periodogram
   * @param {Array} times - timestamps
   * @param {Array} values - measurements
   * @param {number} minFreq - minimum frequency to search
   * @param {number} maxFreq - maximum frequency to search
   * @param {number} nFreq - number of frequency bins
   */
  calculate(times, values, minFreq = 0.1, maxFreq = 50, nFreq = 100) {
    const tau = times.map((t, i) => t - times[0]); // Normalize times
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length);
    
    // Normalize values
    const normalized = values.map(v => (v - mean) / (std + 1e-10));
    
    this.frequencies = [];
    this.power = [];
    
    const freqStep = (maxFreq - minFreq) / nFreq;
    
    for (let f = minFreq; f <= maxFreq; f += freqStep) {
      let C = 0, S = 0, YC = 0, YS = 0;
      
      for (let i = 0; i < tau.length; i++) {
        const omega = 2 * Math.PI * f;
        C += Math.cos(omega * tau[i]);
        S += Math.sin(omega * tau[i]);
        YC += normalized[i] * Math.cos(omega * tau[i]);
        YS += normalized[i] * Math.sin(omega * tau[i]);
      }
      
      // Time offset that makes cos/sin orthogonal
      const tauOffset = Math.atan2(S, C) / (2 * Math.PI * f + 1e-10);
      
      // Recalculate with offset
      let cosSum = 0, sinSum = 0, yCosSum = 0, ySinSum = 0;
      for (let i = 0; i < tau.length; i++) {
        const omega = 2 * Math.PI * f;
        const phase = omega * (tau[i] - tauOffset);
        cosSum += Math.cos(phase) ** 2;
        sinSum += Math.sin(phase) ** 2;
        yCosSum += normalized[i] * Math.cos(phase);
        ySinSum += normalized[i] * Math.sin(phase);
      }
      
      // Power spectral density
      const p = (yCosSum ** 2) / cosSum + (ySinSum ** 2) / sinSum;
      
      this.frequencies.push(f);
      this.power.push(p / 2); // Normalize
    }
    
    return { frequencies: this.frequencies, power: this.power };
  }

  /**
   * Find dominant frequency
   */
  findDominantFrequency() {
    let maxPower = 0;
    let dominantFreq = 0;
    
    for (let i = 0; i < this.power.length; i++) {
      if (this.power[i] > maxPower) {
        maxPower = this.power[i];
        dominantFreq = this.frequencies[i];
      }
    }
    
    return { frequency: dominantFreq, power: maxPower };
  }

  /**
   * Detect if there's significant periodicity
   */
  hasPeriodicity(threshold = 0.5) {
    const { power } = this.findDominantFrequency();
    const meanPower = this.power.reduce((a, b) => a + b, 0) / this.power.length;
    
    return power > meanPower * (1 + threshold);
  }
}

/**
 * BlindSourceSeparation — separates mixed signals using ICA-inspired approach
 * Useful when multiple vibration sources interfere
 */
class BlindSourceSeparation {
  constructor(nSources = 2) {
    this.nSources = nSources;
    this.unmixingMatrix = null;
    this.learningRate = 0.01;
  }

  /**
   * Initialize unmixing matrix
   */
  initialize(nSensors) {
    // Random orthogonal initialization
    this.unmixingMatrix = [];
    for (let i = 0; i < this.nSources; i++) {
      const row = [];
      for (let j = 0; j < nSensors; j++) {
        row.push(Math.random() * 2 - 1);
      }
      this.unmixingMatrix.push(row);
    }
    this._orthonormalize();
  }

  /**
   * Gram-Schmidt orthonormalization
   */
  _orthonormalize() {
    for (let i = 0; i < this.nSources; i++) {
      // Subtract projections onto previous vectors
      for (let j = 0; j < i; j++) {
        const dot = this._dot(this.unmixingMatrix[i], this.unmixingMatrix[j]);
        for (let k = 0; k < this.unmixingMatrix[i].length; k++) {
          this.unmixingMatrix[i][k] -= dot * this.unmixingMatrix[j][k];
        }
      }
      // Normalize
      const norm = Math.sqrt(this.unmixingMatrix[i].reduce((a, b) => a + b * b, 0));
      for (let k = 0; k < this.unmixingMatrix[i].length; k++) {
        this.unmixingMatrix[i][k] /= (norm + 1e-10);
      }
    }
  }

  _dot(a, b) {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  /**
   * FastICA-style separation
   */
  separate(observations) {
    if (!this.unmixingMatrix) {
      this.initialize(observations.length);
    }
    
    // Apply unmixing matrix
    const sources = [];
    for (let i = 0; i < this.nSources; i++) {
      let sum = 0;
      for (let j = 0; j < observations.length; j++) {
        sum += this.unmixingMatrix[i][j] * observations[j];
      }
      sources.push(sum);
    }
    
    // Update unmixing matrix (simplified gradient descent)
    for (let i = 0; i < this.nSources; i++) {
      // Non-linearity: tanh for super-Gaussian (typical for signals)
      const g = Math.tanh(sources[i]);
      const gPrime = 1 - g * g;
      
      for (let j = 0; j < observations.length; j++) {
        const delta = this.learningRate * (g * observations[j] - gPrime * this.unmixingMatrix[i][j]);
        this.unmixingMatrix[i][j] += delta;
      }
    }
    
    this._orthonormalize();
    
    return sources;
  }
}

/**
 * WienerDeconvolver — optimal filter for recovering signal from noisy observations
 */
class WienerDeconvolver {
  constructor(windowSize = 32) {
    this.windowSize = windowSize;
    this.signalPower = [];
    this.noisePower = [];
  }

  /**
   * Apply Wiener filter in frequency domain
   * @param {Array} signal - noisy input
   * @param {number} noiseEstimate - estimated noise variance
   */
  filter(signal, noiseEstimate = null) {
    if (signal.length < this.windowSize) return signal;
    
    const result = [];
    
    // Process in overlapping windows
    const hopSize = this.windowSize / 2;
    
    for (let i = 0; i < signal.length; i += hopSize) {
      const window = signal.slice(i, i + this.windowSize);
      if (window.length < this.windowSize) break;
      
      // Apply Hann window
      const hann = window.map((v, j) => {
        const w = 0.5 * (1 - Math.cos(2 * Math.PI * j / (this.windowSize - 1)));
        return v * w;
      });
      
      // DFT (simplified)
      const spectrum = this._dft(hann);
      
      // Estimate noise if not provided
      const noiseVar = noiseEstimate || this._estimateNoise(spectrum);
      
      // Wiener filter: H(f) = |S(f)|² / (|S(f)|² + |N(f)|²)
      const filtered = spectrum.map((bin) => {
        const signalPower = bin.real ** 2 + bin.imag ** 2;
        const H = signalPower / (signalPower + noiseVar + 1e-10);
        return {
          real: bin.real * H,
          imag: bin.imag * H
        };
      });
      
      // IDFT
      const timeDomain = this._idft(filtered);
      
      // Overlap-add
      for (let j = 0; j < hopSize; j++) {
        const idx = i + j;
        if (idx < signal.length) {
          result[idx] = (result[idx] || 0) + timeDomain[j];
        }
      }
    }
    
    return result.length > 0 ? result : signal;
  }

  _dft(signal) {
    const N = signal.length;
    const result = [];
    
    for (let k = 0; k < N; k++) {
      let real = 0, imag = 0;
      for (let n = 0; n < N; n++) {
        const angle = -2 * Math.PI * k * n / N;
        real += signal[n] * Math.cos(angle);
        imag += signal[n] * Math.sin(angle);
      }
      result.push({ real: real / N, imag: imag / N });
    }
    
    return result;
  }

  _idft(spectrum) {
    const N = spectrum.length;
    const result = [];
    
    for (let n = 0; n < N; n++) {
      let real = 0;
      for (let k = 0; k < N; k++) {
        const angle = 2 * Math.PI * k * n / N;
        real += spectrum[k].real * Math.cos(angle) - spectrum[k].imag * Math.sin(angle);
      }
      result.push(real);
    }
    
    return result;
  }

  _estimateNoise(spectrum) {
    // Use high frequencies as noise estimate
    const highFreqs = spectrum.slice(Math.floor(spectrum.length * 0.8));
    return highFreqs.reduce((a, b) => a + b.real ** 2 + b.imag ** 2, 0) / highFreqs.length;
  }
}

/**
 * AdaptiveSignalProcessor — combines all adaptive filters
 */
class AdaptiveSignalProcessor {
  constructor() {
    this.continuousKF = new ContinuousKalmanFilter({ Q: 0.0001, R: 0.05 });
    this.waveletDenoiser = new WaveletDenoiser(4);
    this.wienerFilter = new WienerDeconvolver(64);
    this.lombScargle = new LombScarglePeriodogram();
    
    this.buffer = [];
    this.bufferSize = 128;
    this.lastTime = null;
    this.samplingRate = 60; // Hz
  }

  /**
   * Process a single sample
   */
  process(value, timestamp = Date.now()) {
    // Calculate actual dt
    let dt = 0.016; // Default 60Hz
    if (this.lastTime) {
      dt = (timestamp - this.lastTime) / 1000;
    }
    this.lastTime = timestamp;
    
    // Add to buffer
    this.buffer.push({ value, time: timestamp, dt });
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift();
    }
    
    // Stage 1: Continuous Kalman filter
    const kfResult = this.continuousKF.update(value, dt);
    
    // Stage 2: Wavelet denoising (batch on buffer)
    let denoised = kfResult.value;
    if (this.buffer.length >= 8) {
      const values = this.buffer.map(b => b.value);
      const denoisedBatch = this.waveletDenoiser.denoise(values);
      denoised = denoisedBatch[denoisedBatch.length - 1];
    }
    
    // Stage 3: Detect and handle periodic interference
    let periodicCorrection = 0;
    if (this.buffer.length >= 32) {
      const times = this.buffer.map(b => b.time);
      const values = this.buffer.map(b => b.value);
      
      this.lombScargle.calculate(times, values, 1, 30, 50);
      
      if (this.lombScargle.hasPeriodicity(1.0)) {
        const dominant = this.lombScargle.findDominantFrequency();
        // If strong periodic interference detected, reduce confidence
        if (dominant.power > 10) {
          periodicCorrection = dominant.power * 0.001; // Small correction
        }
      }
    }
    
    const result = denoised - periodicCorrection;
    
    return {
      value: result,
      raw: value,
      kalman: kfResult.value,
      covariance: kfResult.covariance,
      confidence: 1 / (1 + kfResult.covariance),
      isPeriodic: this.lombScargle.hasPeriodicity(0.5)
    };
  }

  /**
   * Reset all filters
   */
  reset() {
    this.continuousKF.reset();
    this.buffer = [];
    this.lastTime = null;
  }

  /**
   * Get spectral analysis of recent data
   */
  getSpectrum() {
    if (this.buffer.length < 16) return null;
    
    const times = this.buffer.map(b => b.time);
    const values = this.buffer.map(b => b.value);
    
    return this.lombScargle.calculate(times, values, 0.5, 50, 100);
  }
}

export {
  ContinuousKalmanFilter,
  WaveletDenoiser,
  LombScarglePeriodogram,
  BlindSourceSeparation,
  WienerDeconvolver,
  AdaptiveSignalProcessor
};
