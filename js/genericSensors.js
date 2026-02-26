/**
 * genericSensors.js — Generic Sensor API manager for Phoneway
 *
 * Provides higher-accuracy sensor readings where available (Android Chrome).
 *
 * Sensors attempted:
 *  • LinearAccelerationSensor  — gravity-removed accel (best for weight)
 *  • GravitySensor             — hardware gravity vector
 *  • Gyroscope                 — raw angular velocity (up to 200 Hz!)
 *  • Magnetometer              — magnetic field (detects metal objects)
 *  • AbsoluteOrientationSensor — quaternion (fused IMU)
 *
 * Falls back gracefully if any sensor is unavailable or denied.
 *
 * Why LinearAccelerationSensor beats DeviceMotionEvent:
 *  • Hardware gravity removal (better than software high-pass filter)
 *  • Configurable frequency up to 200 Hz
 *  • Lower latency, no browser throttling
 */

'use strict';

import { AdaptiveKalmanFilter, KalmanFilter2D, MovingAverageFilter,
         ComplementaryFilter } from './kalman.js';

class GenericSensorManager {
  constructor() {
    this.linAccel    = null;   // LinearAccelerationSensor
    this.gravity     = null;   // GravitySensor
    this.gyro        = null;   // Gyroscope (fast)
    this.magnetometer = null;  // Magnetometer
    this.absOrientation = null;

    this.available   = {
      linAccel:     false,
      gravity:      false,
      gyro:         false,
      mag:          false,
      absOrientation: false,
      ambientLight: false,
    };

    // Outputs
    this.linX = 0; this.linY = 0; this.linZ = 0;
    this.gravX = 0; this.gravY = 0; this.gravZ = 9.81;
    this.gyroX = 0; this.gyroY = 0; this.gyroZ = 0;
    this.magX = 0; this.magY = 0; this.magZ = 0;
    this.magBaseline = null;  // recorded when phone empty

    // Kalman for each axis
    this._klX = new AdaptiveKalmanFilter({ R: 0.5, Q: 0.02 });
    this._klY = new AdaptiveKalmanFilter({ R: 0.5, Q: 0.02 });
    this._magKl = new AdaptiveKalmanFilter({ R: 2, Q: 0.1 });
    this._magMavg = new MovingAverageFilter(20);

    this.onLinAccel   = null;  // callback(ax, ay, az)
    this.onMagAnomaly = null;  // callback(deltaB_nT, confidence)
    this.onGyroMass   = null;  // callback(grams, confidence)
    this.onGyroRaw    = null;  // callback(gx, gy, gz) — raw gyro before derived
    this.onGravity    = null;  // callback(gx, gy, gz) — gravity vector
    this.onLight      = null;  // callback(lux)        — ambient illuminance

    // Complementary filter — gyro + gravity for tilt-based mass estimation
    this._compX = new ComplementaryFilter(0.96);
    this._compY = new ComplementaryFilter(0.96);
    this._tiltBuf      = [];     // rolling tilt magnitude samples
    this._tiltBaseline = null;   // tilt at rest (no object)
    this._gyroCalibration = null;// g per radian of tilt delta
  }

  /** Request all permissions and start all available sensors */
  async init(freq = 60) {
    // Check Permissions API first (required on Android)
    const sensorsToCheck = ['accelerometer', 'gyroscope', 'magnetometer'];
    for (const name of sensorsToCheck) {
      try {
        const perm = await navigator.permissions.query({ name });
        if (perm.state === 'denied') console.warn(`[GenericSensors] ${name} denied`);
      } catch {} // permissions API not available — try anyway
    }

    await Promise.allSettled([
      this._startLinAccel(freq),
      this._startGravity(freq),
      this._startGyro(Math.min(200, freq * 3)),  // gyro can go faster
      this._startMagnetometer(10),               // mag is slow (10 Hz is fine)
      this._startAmbientLight(5),                // shadow presence detection
    ]);

    return this.available;
  }

  async _startLinAccel(freq) {
    if (typeof LinearAccelerationSensor === 'undefined') return;
    try {
      const s = new LinearAccelerationSensor({ frequency: freq });
      s.addEventListener('reading', () => {
        this.linX = this._klX.update(s.x ?? 0);
        this.linY = this._klY.update(s.y ?? 0);
        this.linZ = s.z ?? 0;
        this.onLinAccel?.(this.linX, this.linY, this.linZ);
      });
      s.addEventListener('error', e => console.warn('[LinAccel]', e.error));
      s.start();
      this.linAccel = s;
      this.available.linAccel = true;
    } catch (e) { console.warn('[LinAccel] unavailable:', e.message); }
  }

  async _startGravity(freq) {
    if (typeof GravitySensor === 'undefined') return;
    try {
      const s = new GravitySensor({ frequency: freq });
      s.addEventListener('reading', () => {
        this.gravX = s.x ?? 0;
        this.gravY = s.y ?? 0;
        this.gravZ = s.z ?? 9.81;
        this.onGravity?.(this.gravX, this.gravY, this.gravZ);
      });
      s.addEventListener('error', () => {});
      s.start();
      this.gravity = s;
      this.available.gravity = true;
    } catch {}
  }

  async _startGyro(freq) {
    if (typeof Gyroscope === 'undefined') return;
    try {
      const s = new Gyroscope({ frequency: freq });
      s.addEventListener('reading', () => {
        this.gyroX = s.x ?? 0;
        this.gyroY = s.y ?? 0;
        this.gyroZ = s.z ?? 0;
        this.onGyroRaw?.(this.gyroX, this.gyroY, this.gyroZ);
        this._updateGyroDerived(performance.now());
      });
      s.addEventListener('error', () => {});
      s.start();
      this.gyro = s;
      this.available.gyro = true;
    } catch {}
  }

  async _startMagnetometer(freq) {
    if (typeof Magnetometer === 'undefined') return;
    try {
      const s = new Magnetometer({ frequency: freq });
      s.addEventListener('reading', () => {
        this.magX = s.x ?? 0;
        this.magY = s.y ?? 0;
        this.magZ = s.z ?? 0;

        const totalB = Math.sqrt(this.magX**2 + this.magY**2 + this.magZ**2);
        const filtered = this._magKl.update(totalB);
        const avg      = this._magMavg.update(filtered);

        if (this.magBaseline !== null) {
          const delta = avg - this.magBaseline;
          // Positive anomaly = ferromagnetic object placed nearby
          if (Math.abs(delta) > 2) {   // 2 µT threshold
            const confidence = Math.min(1, Math.abs(delta) / 50);
            this.onMagAnomaly?.(delta, confidence);
          }
        }
      });
      s.addEventListener('error', () => {});
      s.start();
      this.magnetometer = s;
      this.available.mag = true;
    } catch {}
  }

  /**
   * Complementary-filter tilt → mass estimation.
   * Runs on every gyroscope reading (200 Hz on Android Chrome).
   * Fuses gyro angular velocity with gravity sensor absolute tilt.
   */
  _updateGyroDerived(ts) {
    if (!this.available.gyro || !this.available.gravity) return;

    // Absolute tilt angles from gravity sensor (rad)
    const gMag       = Math.sqrt(this.gravX ** 2 + this.gravY ** 2 + this.gravZ ** 2) || 9.81;
    const accelAngX  = Math.atan2(this.gravY,  this.gravZ);
    const accelAngY  = Math.atan2(-this.gravX, this.gravZ);

    // Fused tilt via complementary filter
    const tiltX = this._compX.update(this.gyroX, accelAngX, ts);
    const tiltY = this._compY.update(this.gyroY, accelAngY, ts);
    const tilt  = Math.sqrt(tiltX * tiltX + tiltY * tiltY);

    this._tiltBuf.push(tilt);
    if (this._tiltBuf.length > 40) this._tiltBuf.shift();

    if (this._tiltBaseline === null || !this._gyroCalibration || this._tiltBuf.length < 15) return;

    const n       = this._tiltBuf.length;
    const avg     = this._tiltBuf.reduce((a, b) => a + b, 0) / n;
    const deltaTilt = Math.max(0, avg - this._tiltBaseline);
    const massG   = deltaTilt * this._gyroCalibration;

    if (massG < 0 || massG > 500) return;

    // Confidence from reading stability (low variance → high conf)
    const vari = this._tiltBuf.reduce((a, t) => a + (t - avg) ** 2, 0) / n;
    const conf = Math.min(0.75, 1 / (1 + Math.sqrt(vari) * 150));
    if (conf > 0.25) this.onGyroMass?.(massG, conf);
  }

  /** Record current tilt as the "no object" baseline. */
  recordTiltBaseline() {
    if (this._tiltBuf.length < 10) return;
    this._tiltBaseline = this._tiltBuf.reduce((a, b) => a + b, 0) / this._tiltBuf.length;
    this._compX.reset();
    this._compY.reset();
    this._tiltBuf = [];
  }

  /**
   * Set gyroscope sensitivity for mass estimation.
   * @param {number} motionSensitivity  g per m/s² from MotionSensor calibration
   */
  setGyroCalibration(motionSensitivity) {
    // tilt (rad) → horizontal acceleration: a = g·sin(θ) ≈ g·θ
    // mass = a · sensitivity = θ · g · sensitivity
    this._gyroCalibration = (motionSensitivity || 0) * 9.81;
  }

  /** Record baseline magnetic field (phone empty, stable) */
  recordMagBaseline() {
    const B = Math.sqrt(this.magX**2 + this.magY**2 + this.magZ**2);
    this.magBaseline = this._magMavg.mean || B;
  }

  async _startAmbientLight(freq = 5) {
    if (typeof AmbientLightSensor === 'undefined') return;
    try {
      const s = new AmbientLightSensor({ frequency: freq });
      s.addEventListener('reading', () => {
        this.onLight?.(s.illuminance ?? 0);
      });
      s.addEventListener('error', () => {});
      s.start();
      this.ambientLight = s;
      this.available.ambientLight = true;
    } catch {}
  }

  /** Compute total tilt (rad) from gravity sensor (more accurate than DeviceMotion) */
  get tiltAngle() {
    const g = Math.sqrt(this.gravX**2 + this.gravY**2 + this.gravZ**2) || 9.81;
    return Math.acos(Math.abs(this.gravZ) / g);
  }

  /** Is phone flat enough to measure (< 10 degrees tilt)? */
  get isFlat() { return this.tiltAngle < 0.175; } // 10 degrees in radians

  stop() {
    this.linAccel?.stop();
    this.gravity?.stop();
    this.gyro?.stop();
    this.magnetometer?.stop();
    this.ambientLight?.stop();
  }
}

export { GenericSensorManager };
