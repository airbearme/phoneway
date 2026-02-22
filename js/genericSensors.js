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

import { AdaptiveKalmanFilter, KalmanFilter2D, MovingAverageFilter } from './kalman.js';

class GenericSensorManager {
  constructor() {
    this.linAccel    = null;   // LinearAccelerationSensor
    this.gravity     = null;   // GravitySensor
    this.gyro        = null;   // Gyroscope (fast)
    this.magnetometer = null;  // Magnetometer
    this.absOrientation = null;

    this.available   = {
      linAccel: false,
      gravity:  false,
      gyro:     false,
      mag:      false,
      absOrientation: false
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

    this.onLinAccel = null;    // callback(ax, ay, az)
    this.onMagAnomaly = null;  // callback(deltaB_nT, confidence)
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

  /** Record baseline magnetic field (phone empty, stable) */
  recordMagBaseline() {
    const B = Math.sqrt(this.magX**2 + this.magY**2 + this.magZ**2);
    this.magBaseline = this._magMavg.mean || B;
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
  }
}

export { GenericSensorManager };
