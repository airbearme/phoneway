/**
 * deviceCompat.js — Cross-Device Compatibility Layer for Phoneway
 * 
 * Handles device detection, capability checking, and graceful fallbacks
 * for maximum compatibility across iOS, Android, and Desktop devices.
 */

'use strict';

/**
 * Device capability detection
 */
const DeviceCapabilities = {
  // Motion sensors
  hasDeviceMotion: 'DeviceMotionEvent' in window,
  hasAcceleration: 'DeviceMotionEvent' in window,
  
  // Generic Sensor API (Android/Chrome)
  hasGenericSensors: 'Accelerometer' in window && 'Gyroscope' in window,
  hasLinearAcceleration: 'LinearAccelerationSensor' in window,
  
  // Permissions API (iOS 13+)
  hasMotionPermission: typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function',
  
  // Vibration
  hasVibration: 'vibrate' in navigator,
  
  // Audio
  hasAudioContext: 'AudioContext' in window || 'webkitAudioContext' in window,
  hasGetUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  
  // Touch
  hasTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
  hasForceTouch: 'Touch' in window && 'force' in Touch.prototype,
  
  // Battery
  hasBattery: 'getBattery' in navigator,
  
  // Storage
  hasLocalStorage: (() => {
    try {
      const test = '__test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  })(),
  
  // Service Worker
  hasServiceWorker: 'serviceWorker' in navigator,
  
  // PWA install
  hasBeforeInstallPrompt: false, // Set to true when event fires
  
  // Detect specific platforms
  platform: (() => {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Mac/i.test(ua)) return 'mac';
    if (/Linux/i.test(ua)) return 'linux';
    return 'unknown';
  })(),
  
  isStandalone: window.matchMedia('(display-mode: standalone)').matches || 
                navigator.standalone === true,
  
  isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
  
  // Feature quality scores (0-1)
  sensorQuality: 0,
  
  init() {
    // Calculate sensor quality score
    let score = 0;
    if (this.hasLinearAcceleration) score += 0.4;
    else if (this.hasGenericSensors) score += 0.3;
    else if (this.hasDeviceMotion) score += 0.2;
    
    if (this.hasVibration) score += 0.1;
    if (this.hasAudioContext) score += 0.1;
    if (this.hasTouch) score += 0.1;
    if (this.hasBattery) score += 0.05;
    if (this.hasGetUserMedia) score += 0.05;
    
    this.sensorQuality = Math.min(1, score);
    
    // Listen for beforeinstallprompt
    window.addEventListener('beforeinstallprompt', () => {
      this.hasBeforeInstallPrompt = true;
    });
  }
};

DeviceCapabilities.init();

/**
 * Permission helper with fallbacks
 */
class PermissionHelper {
  constructor() {
    this.granted = new Set();
    this.denied = new Set();
  }
  
  /**
   * Request motion sensor permission (iOS 13+)
   */
  async requestMotionPermission() {
    if (!DeviceCapabilities.hasMotionPermission) {
      // Android or older iOS - no explicit permission needed
      return true;
    }
    
    if (this.granted.has('motion')) return true;
    if (this.denied.has('motion')) return false;
    
    try {
      const result = await DeviceMotionEvent.requestPermission();
      if (result === 'granted') {
        this.granted.add('motion');
        return true;
      } else {
        this.denied.add('motion');
        return false;
      }
    } catch (e) {
      console.warn('Motion permission request failed:', e);
      return false;
    }
  }
  
  /**
   * Request microphone permission
   */
  async requestMicrophonePermission() {
    if (this.granted.has('microphone')) return true;
    if (this.denied.has('microphone')) return false;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      this.granted.add('microphone');
      return true;
    } catch (e) {
      this.denied.add('microphone');
      return false;
    }
  }
  
  /**
   * Request camera permission
   */
  async requestCameraPermission() {
    if (this.granted.has('camera')) return true;
    if (this.denied.has('camera')) return false;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop());
      this.granted.add('camera');
      return true;
    } catch (e) {
      this.denied.add('camera');
      return false;
    }
  }
}

/**
 * Feature fallback manager
 */
class FeatureFallback {
  constructor() {
    this.fallbacks = new Map();
    this.enabled = new Set();
  }
  
  /**
   * Register a fallback for a feature
   */
  register(feature, fallbackFn, checkFn) {
    this.fallbacks.set(feature, { fallback: fallbackFn, check: checkFn });
  }
  
  /**
   * Check if feature is available, use fallback if not
   */
  async ensure(feature) {
    if (this.enabled.has(feature)) return true;
    
    const config = this.fallbacks.get(feature);
    if (!config) return false;
    
    if (config.check()) {
      this.enabled.add(feature);
      return true;
    }
    
    // Try fallback
    const result = await config.fallback();
    if (result) {
      this.enabled.add(feature);
      return true;
    }
    
    return false;
  }
}

/**
 * Error recovery system
 */
class ErrorRecovery {
  constructor() {
    this.errors = [];
    this.recoveryStrategies = new Map();
    this.maxErrors = 10;
  }
  
  /**
   * Register a recovery strategy
   */
  register(errorType, recoveryFn) {
    this.recoveryStrategies.set(errorType, recoveryFn);
  }
  
  /**
   * Handle an error and attempt recovery
   */
  async handle(error, context = {}) {
    const errorInfo = {
      message: error.message,
      type: error.name,
      stack: error.stack,
      context,
      timestamp: Date.now()
    };
    
    this.errors.push(errorInfo);
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }
    
    console.error('[Phoneway Error]', errorInfo);
    
    // Try recovery
    const strategy = this.recoveryStrategies.get(error.name);
    if (strategy) {
      try {
        return await strategy(error, context);
      } catch (recoveryError) {
        console.error('Recovery failed:', recoveryError);
      }
    }
    
    return null;
  }
  
  /**
   * Get recent errors
   */
  getRecentErrors(count = 5) {
    return this.errors.slice(-count);
  }
}

/**
 * Cross-device sensor adapter
 */
class UniversalSensorAdapter {
  constructor() {
    this.callbacks = {
      motion: null,
      orientation: null,
      error: null
    };
    
    this.active = false;
    this.lastReading = { x: 0, y: 0, z: 9.8 };
  }
  
  /**
   * Start listening for motion data
   */
  async start(options = {}) {
    if (this.active) return true;
    
    // Try Generic Sensor API first (best quality on Android)
    if (DeviceCapabilities.hasLinearAcceleration && !options.forceDeviceMotion) {
      try {
        return await this._startGenericSensors(options);
      } catch (e) {
        console.log('Generic sensors failed, falling back to DeviceMotion');
      }
    }
    
    // Fall back to DeviceMotionEvent (universal)
    return await this._startDeviceMotion(options);
  }
  
  async _startGenericSensors(options) {
    const accel = new LinearAccelerationSensor({ frequency: options.frequency || 60 });
    
    accel.addEventListener('reading', () => {
      this.lastReading = { x: accel.x, y: accel.y, z: accel.z };
      if (this.callbacks && this.callbacks.motion) this.callbacks.motion(this.lastReading);
    });
    
    accel.addEventListener('error', (e) => {
      if (this.callbacks.error) this.callbacks.error(e.error);
    });
    
    await accel.start();
    this.active = true;
    this._genericSensor = accel;
    return true;
  }
  
  async _startDeviceMotion(options) {
    // Request permission on iOS
    if (DeviceCapabilities.hasMotionPermission) {
      const permitted = await new PermissionHelper().requestMotionPermission();
      if (!permitted) {
        throw new Error('Motion permission denied');
      }
    }
    
    this._motionHandler = (e) => {
      const accel = e.accelerationIncludingGravity || e.acceleration;
      if (!accel) return;
      
      let x = accel.x != null ? accel.x : 0;
      let y = accel.y != null ? accel.y : 0;
      let z = accel.z != null ? accel.z : 0;
      
      // Normalize orientation
      if (z < 0) {
        x = -x;
        y = -y;
        z = -z;
      }
      
      this.lastReading = { x, y, z };
      if (this.callbacks && this.callbacks.motion) this.callbacks.motion(this.lastReading);
    };
    
    window.addEventListener('devicemotion', this._motionHandler, { passive: true });
    this.active = true;
    return true;
  }
  
  /**
   * Stop listening
   */
  stop() {
    if (!this.active) return;
    
    if (this._genericSensor) {
      this._genericSensor.stop();
      this._genericSensor = null;
    }
    
    if (this._motionHandler) {
      window.removeEventListener('devicemotion', this._motionHandler);
      this._motionHandler = null;
    }
    
    this.active = false;
  }
  
  onMotion(callback) {
    this.callbacks.motion = callback;
  }
  
  onError(callback) {
    this.callbacks.error = callback;
  }
}

/**
 * Storage adapter with fallbacks
 */
class UniversalStorage {
  constructor() {
    this.memory = new Map();
    this.type = DeviceCapabilities.hasLocalStorage ? 'localStorage' : 'memory';
  }
  
  get(key) {
    if (this.type === 'localStorage') {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return this.memory.get(key) || null;
      }
    }
    return this.memory.get(key) || null;
  }
  
  set(key, value) {
    if (this.type === 'localStorage') {
      try {
        localStorage.setItem(key, value);
        return;
      } catch (e) {
        // Fall through to memory
      }
    }
    this.memory.set(key, value);
  }
  
  remove(key) {
    if (this.type === 'localStorage') {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    }
    this.memory.delete(key);
  }
  
  getObject(key) {
    const raw = this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  
  setObject(key, value) {
    this.set(key, JSON.stringify(value));
  }
}

/**
 * Haptic feedback with fallbacks
 */
function hapticFeedback(pattern) {
  if (DeviceCapabilities.hasVibration) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      // Ignore vibration errors
    }
  }
}

/**
 * Get device info for debugging
 */
function getDeviceInfo() {
  return {
    userAgent: navigator.userAgent,
    platform: DeviceCapabilities.platform,
    isMobile: DeviceCapabilities.isMobile,
    isStandalone: DeviceCapabilities.isStandalone,
    capabilities: {
      motion: DeviceCapabilities.hasDeviceMotion,
      linearAccel: DeviceCapabilities.hasLinearAcceleration,
      vibration: DeviceCapabilities.hasVibration,
      audio: DeviceCapabilities.hasAudioContext,
      camera: DeviceCapabilities.hasGetUserMedia,
      touch: DeviceCapabilities.hasTouch,
      storage: DeviceCapabilities.hasLocalStorage,
      serviceWorker: DeviceCapabilities.hasServiceWorker
    },
    sensorQuality: DeviceCapabilities.sensorQuality,
    screen: {
      width: screen.width,
      height: screen.height,
      dpr: window.devicePixelRatio
    }
  };
}

export {
  DeviceCapabilities,
  PermissionHelper,
  FeatureFallback,
  ErrorRecovery,
  UniversalSensorAdapter,
  UniversalStorage,
  hapticFeedback,
  getDeviceInfo
};
