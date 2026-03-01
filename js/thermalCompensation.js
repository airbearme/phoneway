/**
 * thermalCompensation.js — Advanced Thermal Drift Compensation for Phoneway
 * 
 * Temperature affects scale accuracy through:
 *   - Sensor drift (MEMS sensors are temperature sensitive)
 *   - Surface compliance changes (materials soften/stiffen)
 *   - Battery voltage changes affecting electronics
 * 
 * This module implements predictive thermal modeling using:
 *   - Exponential thermal time constants
 *   - Machine learning drift prediction
 *   - Real-time compensation
 */

'use strict';

import { globalErrorLogger } from '../data/error-logger.js';

/**
 * ThermalModel — predicts sensor behavior at different temperatures
 */
class ThermalModel {
  constructor() {
    // Thermal time constants (seconds)
    this.TAU_SENSOR = 300;     // Sensor warms up over ~5 minutes
    this.TAU_SURFACE = 1200;   // Surface takes ~20 minutes
    this.TAU_BATTERY = 600;    // Battery thermal mass
    
    // Temperature coefficients (per degree C)
    this.COEF_ACCEL = -0.002;   // -0.2% per degree (typical MEMS)
    this.COEF_SURFACE = 0.005;  // Surface compliance increases with temp
    this.COEF_BATTERY = -0.01;  // Battery voltage drops with temp
    
    // State
    this.ambientTemp = 25;      // Reference temperature
    this.stabilizedTemp = 25;
    this.temperatureHistory = [];
    this.driftHistory = [];
    
    // Machine learning model for drift prediction
    this.driftPredictor = new ThermalDriftPredictor();
    
    this._loadModel();
  }

  /**
   * Record current temperature from available sensors
   */
  recordTemperature(source = 'battery', tempC) {
    const entry = {
      timestamp: Date.now(),
      source,
      temperature: tempC,
      uptime: performance.now()
    };
    
    this.temperatureHistory.push(entry);
    
    // Keep last 24 hours
    const oneDay = 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - oneDay;
    this.temperatureHistory = this.temperatureHistory.filter(e => e.timestamp > cutoff);
    
    // Update ambient reference
    if (this.temperatureHistory.length > 10) {
      const recent = this.temperatureHistory.slice(-10);
      this.ambientTemp = recent.reduce((a, e) => a + e.temperature, 0) / recent.length;
    }
  }

  /**
   * Calculate thermal drift compensation
   */
  calculateCompensation(currentTemp, uptime, calibrationAge) {
    const deltaT = currentTemp - this.ambientTemp;
    const drift = { total: 0, components: {} };
    
    // Sensor thermal drift (exponential approach to steady-state)
    const sensorStabilization = 1 - Math.exp(-uptime / (this.TAU_SENSOR * 1000));
    const sensorDrift = deltaT * this.COEF_ACCEL * sensorStabilization;
    drift.components.sensor = sensorDrift;
    
    // Surface thermal drift (slower)
    const surfaceStabilization = 1 - Math.exp(-uptime / (this.TAU_SURFACE * 1000));
    const surfaceDrift = deltaT * this.COEF_SURFACE * surfaceStabilization;
    drift.components.surface = surfaceDrift;
    
    // Battery thermal effects
    const batteryStabilization = 1 - Math.exp(-uptime / (this.TAU_BATTERY * 1000));
    const batteryDrift = deltaT * this.COEF_BATTERY * batteryStabilization;
    drift.components.battery = batteryDrift;
    
    // ML-predicted drift based on historical patterns
    const mlDrift = this.driftPredictor.predict(currentTemp, uptime, calibrationAge);
    drift.components.mlPredicted = mlDrift;
    
    // Weighted combination
    drift.total = sensorDrift * 0.4 + surfaceDrift * 0.35 + batteryDrift * 0.15 + mlDrift * 0.1;
    
    return drift;
  }

  /**
   * Learn from a verified measurement error
   */
  learn(measuredGrams, actualGrams, currentTemp, uptime) {
    const error = actualGrams - measuredGrams;
    const errorPercent = (error / actualGrams) * 100;
    
    this.driftHistory.push({
      timestamp: Date.now(),
      temperature: currentTemp,
      uptime,
      error,
      errorPercent
    });
    
    // Keep manageable history
    if (this.driftHistory.length > 200) {
      this.driftHistory.shift();
    }
    
    // Update ML model
    this.driftPredictor.train(currentTemp, uptime, errorPercent);
    
    // Recalibrate coefficients if we have enough data
    if (this.driftHistory.length > 50) {
      this._recalibrateCoefficients();
    }
    
    this._saveModel();
  }

  /**
   * Recalibrate thermal coefficients based on historical data
   */
  _recalibrateCoefficients() {
    // Simple linear regression to find actual temperature coefficient
    const validData = this.driftHistory.filter(d => 
      Math.abs(d.temperature - this.ambientTemp) > 1 &&
      d.uptime > 60000 // At least 1 minute of uptime
    );
    
    if (validData.length < 20) return;
    
    // Calculate correlation between temperature and error
    const temps = validData.map(d => d.temperature - this.ambientTemp);
    const errors = validData.map(d => d.errorPercent);
    
    const meanT = temps.reduce((a, b) => a + b, 0) / temps.length;
    const meanE = errors.reduce((a, b) => a + b, 0) / errors.length;
    
    let num = 0, den = 0;
    for (let i = 0; i < temps.length; i++) {
      num += (temps[i] - meanT) * (errors[i] - meanE);
      den += Math.pow(temps[i] - meanT, 2);
    }
    
    if (den > 0) {
      const estimatedCoef = num / den;
      // Smooth update
      this.COEF_ACCEL = 0.9 * this.COEF_ACCEL + 0.1 * estimatedCoef;
    }
  }

  /**
   * Get thermal stability status
   */
  getStabilityStatus(currentTemp, uptime) {
    const deltaT = Math.abs(currentTemp - this.ambientTemp);
    
    // Check if temperature is changing rapidly
    const recent = this.temperatureHistory.slice(-5);
    let tempChanging = false;
    if (recent.length >= 5) {
      const tempVariance = this._variance(recent.map(e => e.temperature));
      tempChanging = tempVariance > 0.25; // > 0.5°C variance
    }
    
    // Check stabilization progress
    const sensorStabilized = uptime > this.TAU_SENSOR * 1000;
    const surfaceStabilized = uptime > this.TAU_SURFACE * 1000;
    
    let status, recommendation;
    
    if (tempChanging) {
      status = 'unstable';
      recommendation = 'Temperature changing - wait for thermal equilibrium';
    } else if (!sensorStabilized) {
      status = 'warming_up';
      recommendation = `Sensor warming up - ${Math.ceil((this.TAU_SENSOR * 1000 - uptime) / 60000)} min to stable`;
    } else if (!surfaceStabilized) {
      status = 'surface_adjusting';
      recommendation = 'Surface temperature stabilizing';
    } else if (deltaT > 10) {
      status = 'high_temp_offset';
      recommendation = 'High temperature differential - accuracy may be reduced';
    } else {
      status = 'stable';
      recommendation = 'Thermal conditions optimal';
    }
    
    return {
      status,
      recommendation,
      deltaT,
      sensorStabilized,
      surfaceStabilized,
      tempChanging,
      predictedDrift: this.calculateCompensation(currentTemp, uptime, 0).total
    };
  }

  _variance(arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
  }

  _saveModel() {
    try {
      const data = {
        COEF_ACCEL: this.COEF_ACCEL,
        COEF_SURFACE: this.COEF_SURFACE,
        COEF_BATTERY: this.COEF_BATTERY,
        ambientTemp: this.ambientTemp,
        driftHistory: this.driftHistory.slice(-50)
      };
      localStorage.setItem('phoneway_thermal_model', JSON.stringify(data));
    } catch {}
  }

  _loadModel() {
    try {
      const saved = localStorage.getItem('phoneway_thermal_model');
      if (saved) {
        const data = JSON.parse(saved);
        this.COEF_ACCEL = data.COEF_ACCEL ?? this.COEF_ACCEL;
        this.COEF_SURFACE = data.COEF_SURFACE ?? this.COEF_SURFACE;
        this.COEF_BATTERY = data.COEF_BATTERY ?? this.COEF_BATTERY;
        this.ambientTemp = data.ambientTemp ?? this.ambientTemp;
        if (data.driftHistory) {
          this.driftHistory = data.driftHistory;
        }
      }
    } catch {}
  }
}

/**
 * ThermalDriftPredictor — ML-based thermal drift prediction
 */
class ThermalDriftPredictor {
  constructor() {
    this.features = []; // Training data
    this.weights = { temp: 0, uptime: 0, bias: 0 };
    this.learningRate = 0.01;
  }

  predict(temp, uptime, calibrationAge) {
    const tempNorm = (temp - 20) / 20; // Normalize to -0.25 to 2.0 (0-60°C range)
    const uptimeNorm = Math.log10(uptime / 1000 + 1) / 4; // Log scale
    const ageNorm = Math.log10(calibrationAge / 86400000 + 1) / 2; // Days
    
    return this.weights.temp * tempNorm + 
           this.weights.uptime * uptimeNorm + 
           this.weights.bias * ageNorm;
  }

  train(temp, uptime, actualError) {
    const prediction = this.predict(temp, uptime, 0);
    const error = actualError - prediction;
    
    const tempNorm = (temp - 20) / 20;
    const uptimeNorm = Math.log10(uptime / 1000 + 1) / 4;
    
    // Gradient descent update
    this.weights.temp += this.learningRate * error * tempNorm;
    this.weights.uptime += this.learningRate * error * uptimeNorm;
    this.weights.bias += this.learningRate * error * 0.1;
    
    // Store for batch learning
    this.features.push({ temp, uptime, error: actualError });
    if (this.features.length > 100) this.features.shift();
  }
}

/**
 * RealTimeCompensator — applies corrections in real-time
 */
class RealTimeCompensator {
  constructor() {
    this.thermalModel = new ThermalModel();
    this.activeCompensations = new Map();
    this.compensationHistory = [];
  }

  /**
   * Register a sensor for compensation
   */
  registerSensor(name, type = 'accel') {
    this.activeCompensations.set(name, {
      type,
      baseValue: null,
      corrections: []
    });
  }

  /**
   * Apply compensation to a sensor reading
   */
  compensate(sensorName, rawValue, temperature, uptime, calibrationAge) {
    const comp = this.activeCompensations.get(sensorName);
    if (!comp) return rawValue;

    // Get thermal drift
    const drift = this.thermalModel.calculateCompensation(temperature, uptime, calibrationAge);
    
    // Apply compensation based on sensor type
    let compensated = rawValue;
    
    switch (comp.type) {
      case 'accel':
        // Accelerometer: correct for sensitivity drift
        compensated = rawValue * (1 - drift.components.sensor);
        break;
      case 'surface':
        // Surface compliance: inverse relationship
        compensated = rawValue * (1 - drift.components.surface);
        break;
      case 'battery':
        // Battery-based sensors
        compensated = rawValue * (1 - drift.components.battery);
        break;
      default:
        compensated = rawValue * (1 - drift.total);
    }

    // Record for learning
    this.compensationHistory.push({
      timestamp: Date.now(),
      sensor: sensorName,
      raw: rawValue,
      compensated,
      drift: drift.total
    });

    if (this.compensationHistory.length > 500) {
      this.compensationHistory.shift();
    }

    return compensated;
  }

  /**
   * Learn from verified measurement
   */
  learn(measuredGrams, actualGrams, temperature, uptime) {
    this.thermalModel.learn(measuredGrams, actualGrams, temperature, uptime);
  }

  /**
   * Get current thermal status
   */
  getStatus(currentTemp, uptime) {
    return this.thermalModel.getStabilityStatus(currentTemp, uptime);
  }
}

export {
  ThermalModel,
  ThermalDriftPredictor,
  RealTimeCompensator
};
