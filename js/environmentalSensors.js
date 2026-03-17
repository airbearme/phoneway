/**
 * environmentalSensors.js — Environmental sensor fusion for accuracy
 * 
 * Uses:
 *   - Barometer: Detects pressure changes (minimal but measurable)
 *   - Battery: Thermal compensation, voltage stability
 *   - Device orientation: Optimal positioning detection
 *   - Time-of-day: Temperature model
 *   - Screen brightness: Ambient light proxy
 */

'use strict';

/**
 * BarometerSensor — Uses pressure changes as supplementary data
 * Weight on phone can cause tiny pressure changes in sealed chambers
 */
class BarometerSensor {
  constructor() {
    this.supported = false;
    this.sensor = null;
    this.pressure = null;
    this.baseline = null;
    this.history = [];
    this.maxHistory = 100;
    
    this.onReading = null;
  }

  async init() {
    if (typeof Barometer === 'undefined') {
      // Try alternative API names
      if (typeof AbsolutePressureSensor !== 'undefined') {
        return this._initAbsolutePressure();
      }
      return false;
    }
    
    try {
      this.sensor = new Barometer({ frequency: 1 });
      this.sensor.addEventListener('reading', () => this._onReading());
      this.sensor.addEventListener('error', (e) => console.warn('[Barometer]', e));
      this.sensor.start();
      this.supported = true;
      return true;
    } catch (e) {
      console.warn('Barometer init failed:', e.message);
      return false;
    }
  }

  async _initAbsolutePressure() {
    try {
      this.sensor = new AbsolutePressureSensor({ frequency: 1 });
      this.sensor.addEventListener('reading', () => this._onReading());
      this.sensor.start();
      this.supported = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  _onReading() {
    if (!this.sensor) return;
    
    const pressure = this.sensor.pressure || (this.sensor.reading && this.sensor.reading.pressure) || null;
    if (pressure === null) return;
    
    this.pressure = pressure;
    
    this.history.push({
      pressure,
      timestamp: Date.now()
    });
    
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    
    // Calculate rate of change (pressure trend)
    const trend = this._calculateTrend();
    
    if (this.onReading) {
      this.onReading({
        pressure,
        trend,
        isStable: Math.abs(trend) < 0.1,
        deltaFromBaseline: this.baseline ? pressure - this.baseline : 0
      });
    }
  }

  _calculateTrend() {
    if (this.history.length < 10) return 0;
    
    const recent = this.history.slice(-10);
    const first = recent[0].pressure;
    const last = recent[recent.length - 1].pressure;
    const duration = (recent[recent.length - 1].timestamp - recent[0].timestamp) / 1000;
    
    return duration > 0 ? (last - first) / duration : 0; // hPa/s
  }

  recordBaseline() {
    if (this.history.length >= 10) {
      const recent = this.history.slice(-10);
      this.baseline = recent.reduce((a, b) => a + b.pressure, 0) / recent.length;
    }
  }

  /**
   * Get stability score based on pressure consistency
   * High pressure variance indicates environmental instability
   */
  getStabilityScore() {
    if (this.history.length < 20) return 0.5;
    
    const recent = this.history.slice(-20);
    const mean = recent.reduce((a, b) => a + b.pressure, 0) / recent.length;
    const variance = recent.reduce((a, b) => a + (b.pressure - mean) ** 2, 0) / recent.length;
    
    // Lower variance = higher stability
    return 1 / (1 + variance * 1000);
  }

  stop() {
    if (this.sensor) this.sensor.stop();
    this.supported = false;
  }
}

/**
 * BatteryMonitor — Tracks battery for thermal compensation
 */
class BatteryMonitor {
  constructor() {
    this.supported = false;
    this.battery = null;
    this.thermalModel = new ThermalModel();
    
    this.onUpdate = null;
  }

  async init() {
    if (!navigator.getBattery) return false;
    
    try {
      this.battery = await navigator.getBattery();
      this.supported = true;
      
      // Initial reading
      this._update();
      
      // Listeners
      this.battery.addEventListener('levelchange', () => this._update());
      this.battery.addEventListener('chargingchange', () => this._update());
      
      return true;
    } catch (e) {
      return false;
    }
  }

  _update() {
    if (!this.battery) return;
    
    const data = {
      level: this.battery.level, // 0-1
      charging: this.battery.charging,
      chargingTime: this.battery.chargingTime,
      dischargingTime: this.battery.dischargingTime,
      
      // Derived metrics
      thermalStability: this.thermalModel.getStability(this.battery),
      voltageEstimate: this._estimateVoltage(),
      recommendedRestTime: this._getRecommendedRestTime()
    };
    
    if (this.onUpdate) this.onUpdate(data);
  }

  _estimateVoltage() {
    // Rough estimate based on Li-ion discharge curve
    // 4.2V at 100%, 3.0V at 0%
    if (!this.battery) return 3.7;
    return 3.0 + this.battery.level * 1.2;
  }

  _getRecommendedRestTime() {
    // After charging stops, recommend waiting for thermal equilibrium
    if (!this.battery) return 0;
    
    if (this.battery.charging) {
      return 300; // 5 minutes after charging starts
    }
    
    // Recently unplugged - check if we have that data
    const lastCharging = this.thermalModel.lastChargingChange;
    if (lastCharging && !this.battery.charging) {
      const timeSince = (Date.now() - lastCharging) / 1000;
      return Math.max(0, 300 - timeSince); // 5 min rest
    }
    
    return 0;
  }

  /**
   * Check if device is in thermally stable state for measurement
   */
  isThermallyStable() {
    return this._getRecommendedRestTime() === 0 && 
           this.thermalModel.getStability(this.battery) > 0.7;
  }

  getData() {
    if (!this.battery) return null;
    
    return {
      level: this.battery.level,
      charging: this.battery.charging,
      thermalStability: this.thermalModel.getStability(this.battery),
      isStable: this.isThermallyStable()
    };
  }
}

/**
 * Thermal model for battery temperature effects
 */
class ThermalModel {
  constructor() {
    this.lastChargingChange = Date.now();
    this.temperatureHistory = [];
  }

  getStability(battery) {
    // Higher stability when:
    // - Not charging
    // - Battery level stable (not changing rapidly)
    // - Time since state change > 5 minutes
    
    let stability = 1.0;
    
    if (battery.charging) {
      stability *= 0.6; // Charging generates heat
    }
    
    const timeSinceChange = (Date.now() - this.lastChargingChange) / 1000;
    const timeFactor = Math.min(1, timeSinceChange / 300); // Full stability after 5 min
    stability *= 0.5 + 0.5 * timeFactor;
    
    return stability;
  }
}

/**
 * OrientationSensor — Ensures optimal device positioning
 */
class OrientationSensor {
  constructor() {
    this.supported = false;
    this.absolute = null;
    this.relative = null;
    
    this.currentOrientation = null;
    this.optimalOrientation = null;
    this.stabilityHistory = [];
    
    this.onQualityUpdate = null;
  }

  async init() {
    const results = await Promise.allSettled([
      this._initAbsolute(),
      this._initRelative()
    ]);
    
    return results.some(r => r.status === 'fulfilled' && r.value);
  }

  async _initAbsolute() {
    if (typeof AbsoluteOrientationSensor === 'undefined') return false;
    
    try {
      const sensor = new AbsoluteOrientationSensor({ frequency: 10 });
      sensor.addEventListener('reading', () => {
        this._updateOrientation(sensor.quaternion, 'absolute');
      });
      sensor.start();
      this.absolute = sensor;
      this.supported = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  async _initRelative() {
    if (typeof RelativeOrientationSensor === 'undefined') return false;
    
    try {
      const sensor = new RelativeOrientationSensor({ frequency: 10 });
      sensor.addEventListener('reading', () => {
        this._updateOrientation(sensor.quaternion, 'relative');
      });
      sensor.start();
      this.relative = sensor;
      this.supported = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  _updateOrientation(quaternion, type) {
    // Quaternion [x, y, z, w] represents rotation
    const [x, y, z, w] = quaternion;
    
    // Calculate tilt angles
    // Roll (x-axis rotation)
    const sinr_cosp = 2 * (w * x + y * z);
    const cosr_cosp = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);
    
    // Pitch (y-axis rotation)
    const sinp = 2 * (w * y - z * x);
    const pitch = Math.abs(sinp) >= 1 ? 
      Math.sign(sinp) * Math.PI / 2 : 
      Math.asin(sinp);
    
    // Yaw (z-axis rotation)
    const siny_cosp = 2 * (w * z + x * y);
    const cosy_cosp = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);
    
    this.currentOrientation = { roll, pitch, yaw, quaternion, type };
    
    // Calculate quality score
    const quality = this._calculateQuality();
    
    this.stabilityHistory.push({
      timestamp: Date.now(),
      quality,
      orientation: this.currentOrientation
    });
    
    if (this.stabilityHistory.length > 50) {
      this.stabilityHistory.shift();
    }
    
    if (this.onQualityUpdate) this.onQualityUpdate(quality, this.currentOrientation);
  }

  _calculateQuality() {
    if (!this.currentOrientation) return 0;
    
    const { pitch, roll } = this.currentOrientation;
    
    // Ideal: flat on surface (pitch ≈ 0, roll ≈ 0)
    // Convert to degrees for easier reasoning
    const pitchDeg = Math.abs(pitch) * 180 / Math.PI;
    const rollDeg = Math.abs(roll) * 180 / Math.PI;
    
    // Quality decreases with tilt
    const pitchQuality = Math.max(0, 1 - pitchDeg / 15);
    const rollQuality = Math.max(0, 1 - rollDeg / 15);
    
    // Combined quality
    let quality = pitchQuality * rollQuality;
    
    // Bonus for being very flat
    if (pitchDeg < 2 && rollDeg < 2) quality = Math.min(1, quality * 1.2);
    
    return quality;
  }

  /**
   * Get orientation stability over time
   */
  getStability() {
    if (this.stabilityHistory.length < 10) return { stable: false, variance: Infinity };
    
    const recent = this.stabilityHistory.slice(-20);
    const qualities = recent.map(h => h.quality);
    const mean = qualities.reduce((a, b) => a + b, 0) / qualities.length;
    const variance = qualities.reduce((a, b) => a + (b - mean) ** 2, 0) / qualities.length;
    
    return {
      stable: variance < 0.01 && mean > 0.9,
      variance,
      meanQuality: mean
    };
  }

  /**
   * Check if device is optimally positioned
   */
  isOptimal() {
    const quality = this._calculateQuality();
    const stability = this.getStability();
    return quality > 0.95 && stability.stable;
  }

  /**
   * Get guidance for user to improve positioning
   */
  getPositioningGuidance() {
    if (!this.currentOrientation) return 'Initializing orientation sensor...';
    
    const { pitch, roll } = this.currentOrientation;
    const pitchDeg = pitch * 180 / Math.PI;
    const rollDeg = roll * 180 / Math.PI;
    
    const guidance = [];
    
    if (Math.abs(pitchDeg) > 5) {
      guidance.push(pitchDeg > 0 ? 'Tilt down (top of phone)' : 'Tilt up (top of phone)');
    }
    
    if (Math.abs(rollDeg) > 5) {
      guidance.push(rollDeg > 0 ? 'Tilt left' : 'Tilt right');
    }
    
    if (guidance.length === 0) {
      return 'Position optimal ✓';
    }
    
    return 'Adjust: ' + guidance.join(', ');
  }

  stop() {
    if (this.absolute) this.absolute.stop();
    if (this.relative) this.relative.stop();
  }
}

/**
 * EnvironmentalCompensator — Combines all environmental data
 */
class EnvironmentalCompensator {
  constructor() {
    this.barometer = new BarometerSensor();
    this.battery = new BatteryMonitor();
    this.orientation = new OrientationSensor();
    
    this.data = {
      pressure: null,
      battery: null,
      orientation: null
    };
    
    this.compensationFactors = {
      pressure: 0,      // Minimal direct effect
      thermal: 0,       // Battery temperature effect on sensors
      orientation: 0    // Tilt compensation
    };
  }

  async init() {
    // Initialize all sensors
    this.barometer.onReading = (data) => {
      this.data.pressure = data;
    };
    
    this.battery.onUpdate = (data) => {
      this.data.battery = data;
    };
    
    this.orientation.onQualityUpdate = (quality, orientation) => {
      this.data.orientation = { quality, orientation };
    };
    
    const results = await Promise.all([
      this.barometer.init(),
      this.battery.init(),
      this.orientation.init()
    ]);
    
    return {
      barometer: results[0],
      battery: results[1],
      orientation: results[2]
    };
  }

  /**
   * Get overall environmental stability score
   */
  getStabilityScore() {
    let score = 1.0;
    let factors = 0;
    
    if (this.data.pressure) {
      score *= 0.8 + 0.2 * this.barometer.getStabilityScore();
      factors++;
    }
    
    if (this.data.battery) {
      score *= this.data.battery.thermalStability;
      factors++;
    }
    
    if (this.data.orientation) {
      score *= this.data.orientation.quality;
      factors++;
    }
    
    return factors > 0 ? score : 0.5;
  }

  /**
   * Check if all environmental conditions are optimal
   */
  isOptimal() {
    return this.getStabilityScore() > 0.9 &&
           (!this.data.battery || this.data.battery.isStable) &&
           (!this.data.orientation || this.data.orientation.quality > 0.95);
  }

  /**
   * Get compensation adjustments for measurement
   */
  getCompensations() {
    const comps = {
      pressureDrift: 0,
      thermalDrift: 0,
      tiltError: 0,
      totalCorrection: 0
    };
    
    // Pressure compensation (very small effect, mainly for stability flag)
    if (this.data.pressure && this.data.pressure.deltaFromBaseline) {
      // Negligible direct weight effect, but flag if pressure changing rapidly
      comps.pressureDrift = 0; 
    }
    
    // Thermal compensation
    if (this.data.battery) {
      // Estimate thermal drift based on charging state and time
      const restTime = this.battery._getRecommendedRestTime();
      if (restTime > 0) {
        comps.thermalDrift = -0.02 * (1 - restTime / 300); // Small negative drift
      }
    }
    
    // Orientation compensation
    if (this.data.orientation && this.data.orientation.orientation) {
      const { pitch, roll } = this.data.orientation.orientation;
      // Small correction for slight tilt (cosine error)
      const tiltAngle = Math.sqrt(pitch * pitch + roll * roll);
      comps.tiltError = Math.cos(tiltAngle) - 1; // Negative = apparent weight loss
    }
    
    comps.totalCorrection = comps.pressureDrift + comps.thermalDrift + comps.tiltError;
    
    return comps;
  }

  /**
   * Get user guidance based on environmental conditions
   */
  getGuidance() {
    const guidance = [];
    
    if (this.data.battery && !this.data.battery.isStable) {
      const restTime = Math.ceil(this.battery._getRecommendedRestTime() / 60);
      guidance.push(`Wait ${restTime}min for thermal equilibrium`);
    }
    
    if (this.data.orientation) {
      const posGuidance = this.orientation.getPositioningGuidance();
      if (!posGuidance.includes('optimal')) {
        guidance.push(posGuidance);
      }
    }
    
    if (this.data.pressure && !this.data.pressure.isStable) {
      guidance.push('Pressure changing - wait for stability');
    }
    
    return guidance;
  }

  stop() {
    this.barometer.stop();
    this.orientation.stop();
  }
}

export {
  BarometerSensor,
  BatteryMonitor,
  OrientationSensor,
  EnvironmentalCompensator,
  ThermalModel
};
