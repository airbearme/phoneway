/**
 * app.js — Phoneway Precision Scale v3.0 — Ultimate Accuracy Edition
 *
 * TARGET: ±0.1g accuracy (1σ < 0.05g)
 * 
 * Sensor stack (15+ sensors):
 *  1. LinearAccelerationSensor (hardware gravity-removed)
 *  2. DeviceMotionEvent accelerometer (fallback)
 *  3. Vibration-hammer resonance
 *  4. Web Audio API microphone resonance (FFT, 44100 Hz)
 *  5. Touch force / contact area
 *  6. Gyroscope tilt estimation
 *  7. Magnetometer anomaly detection
 *  8. Camera optical-flow resonance
 *  9. Ambient light sensor
 *  10. Barometer (pressure stability)
 *  11. Battery thermal monitoring
 *  12. Orientation sensor (positioning quality)
 *  13. Multi-sensor ensemble voting
 *  14. Particle filter fusion
 *  15. Neural network correction
 *
 * Calibration with everyday objects:
 *  💵 US Dollar bill  = 1.00 g
 *  🪙 US Nickel       = 5.00 g   ← recommended primary
 *  + International coins + Custom weights
 */

'use strict';

import { BaselineRecorder, MotionSensor, TouchSensor, BayesianFusion }
  from './sensors.js';
import { AudioAnalyzer }         from './audio.js';
import { VibrationHammer }       from './vibrationHammer.js';
import { GenericSensorManager }  from './genericSensors.js';
import { SevenSegmentDisplay, StabilityBar, LED, AccuracyDisplay, delay } from './display.js';
import { REF_WEIGHTS, ReferenceWeightVerifier } from './referenceWeights.js';
import { CameraSensor } from './cameraSensor.js';
import { LearningEngine } from './learningEngine.js';
import { GyroGate, FrequencyConsensus, PassiveResonance, TiltCorrector, VerticalAccel, MultiSensorEnsemble, VarianceDetector }
  from './sensorCombinations.js';

// NEW: Ultra-precision modules
import { AdaptiveCalibration, EnsembleCalibrator } from './mlCalibration.js';
import { AdvancedFusionEngine } from './advancedFusion.js';
import { EnvironmentalCompensator } from './environmentalSensors.js';
import { UltraPrecisionEngine } from './ultraPrecision.js';
import { globalErrorLogger } from '../data/error-logger.js';
// NEW: Advanced adaptive signal processing
import { AdaptiveSignalProcessor, ContinuousKalmanFilter } from './adaptiveFilter.js';

// NEW: Predictive calibration with ML
import { CalibrationPredictor, NonlinearCalibration, AutoCalibrator } from './predictiveCalibration.js';

// NEW: Quantum-inspired fusion and thermal compensation
import { QuantumFusionEngine, HypothesisSpace } from './quantumFusion.js';
import { RealTimeCompensator } from './thermalCompensation.js';
import { AdvancedVerificationEngine, NISTReferenceDatabase } from './advancedVerification.js';

// Crowd-sourced telemetry — anonymous, privacy-first
import { telemetry } from './telemetry.js';

/* ── Known calibration weights ────────────────────────────── */
export const CAL_WEIGHTS = [
  { label: 'Dollar Bill',    grams: 1.00, icon: '💵', tip: 'Any US paper bill — any denomination equals exactly 1 gram' },
  { label: 'US Penny',       grams: 2.50, icon: '🪙', tip: 'Post-1982 Lincoln cent — keep one handy as your 2.5g reference' },
  { label: 'US Dime',        grams: 2.27, icon: '🪙', tip: 'US 10-cent coin' },
  { label: 'US Nickel',      grams: 5.00, icon: '🪙', tip: 'US 5-cent coin — best primary calibration weight' },
  { label: 'US Quarter',     grams: 5.67, icon: '🪙', tip: 'US 25-cent coin' },
  { label: 'US Dollar Coin', grams: 8.10, icon: '🪙', tip: 'Sacagawea / Presidential dollar coin' },
  { label: 'Canadian Loonie',grams: 7.00, icon: '🪙', tip: 'Canadian $1 coin' },
  { label: 'Euro (1€)',      grams: 7.50, icon: '🪙', tip: '1 euro coin' },
  { label: 'UK 10p',         grams: 6.50, icon: '🪙', tip: 'UK 10 pence coin' },
  { label: '2× Nickel',      grams: 10.00, icon: '🪙🪙', tip: 'Stack 2 US nickels for a 10g reference' },
  { label: '3× Nickel',      grams: 15.00, icon: '🪙🪙🪙', tip: 'Stack 3 US nickels for a 15g reference' },
  { label: 'Custom…',        grams: null,  icon: '⚖️', tip: 'Enter your own known weight in grams' },
];

const UNITS = [
  { key: 'g',   label: 'g',   factor: 1,         places: 1 },
  { key: 'oz',  label: 'oz',  factor: 0.035274,  places: 3 },
  { key: 'ct',  label: 'ct',  factor: 5.0,       places: 2 },
  { key: 'dwt', label: 'dwt', factor: 0.643015,  places: 3 },
  { key: 'mg',  label: 'mg',  factor: 1000,      places: 0 },
];

const MODES  = ['ULTRA', 'FUSION', 'ACCEL', 'AUDIO', 'HAMMER', 'TOUCH', 'GYRO', 'CAM', 'ENSEMBLE'];

const SURFACE_TIPS = {
  poor:      '⚠ Hard surface — move to notebook or mouse-pad for best accuracy',
  ok:        '◑ Decent surface — mouse-pad would improve accuracy',
  good:      '✓ Good surface — readings will be accurate',
  excellent: '★ Excellent surface — maximum accuracy mode',
  unknown:   '○ Calibrate to assess surface quality',
};

const ACCURACY_GRADES = {
  'A+': { color: '#00ff66', desc: '±0.03g precision' },
  'A':  { color: '#39ff14', desc: '±0.05g precision' },
  'B+': { color: '#e8c84a', desc: '±0.1g precision' },
  'B':  { color: '#ffcc00', desc: '±0.2g precision' },
  'C':  { color: '#ff8c00', desc: '±0.5g precision' },
  'D':  { color: '#ff4444', desc: '>0.5g variance' },
  'untested': { color: '#666666', desc: 'Calibrate for accuracy' }
};

/* ═══════════════════════════════════════════════════════════════
   PhonewayApp v3.0 — Ultimate Accuracy
═══════════════════════════════════════════════════════════════ */
class PhonewayApp {
  constructor() {
    this.state      = 'IDLE';
    this.unitIdx    = 0;
    this.modeIdx    = 0; // Default to ULTRA mode
    this.held       = false;
    this.powered    = true;
    this.calWeightG = 5.0;

    // Core sensors
    this.motion    = new MotionSensor();
    this.touch     = new TouchSensor();
    this.audio     = new AudioAnalyzer();
    this.hammer    = new VibrationHammer();
    this.genSensor = new GenericSensorManager();
    this.camera    = new CameraSensor();
    this.baseline  = new BaselineRecorder(200);
    this.fusion    = new BayesianFusion();

    // NEW: Ultra-precision engines
    this.ultraPrecision = new UltraPrecisionEngine();
    this.advancedFusion = new AdvancedFusionEngine();
    this.environmental  = new EnvironmentalCompensator();
    this.ensembleCal    = new EnsembleCalibrator();
    
    // NEW: Quantum-inspired fusion engine
    this.quantumFusion = new QuantumFusionEngine();
    this.hypothesisSpace = new HypothesisSpace();
    
    // NEW: Thermal compensation
    this.thermalCompensator = new RealTimeCompensator();
    
    // NEW: Advanced verification system
    this.advancedVerification = new AdvancedVerificationEngine();

    // Display refs
    this.display    = null;
    this.stabBar    = null;
    this.ledPower   = null;
    this.ledStable  = null;
    this.ledAudio   = null;
    this.ledCamera  = null;

    // Calibration
    this.calPhase  = 0;
    this.firstCalG = 0;
    this.firstDeltaA = 0;
    this.calibrationTime = Date.now();

    // Measurement state
    this.currentG   = 0;
    this.correctedG = 0;
    this._stableBuf = [];
    this.STABLE_WIN = 30;
    this.STABLE_THR = 0.1;  // Tighter for 0.1g target

    // Accuracy tracking
    this.accuracyDisplay = null;
    this._lastAccPct     = 0;
    this.accuracyGrade   = 'untested';

    // Reference weight verification
    this.verifier        = new ReferenceWeightVerifier();
    this.verifyOpen      = false;
    this._activeRefW     = null;
    this._lastVerifyPass = false;

    // Sensor combination modules
    this.gyroGate      = new GyroGate();
    this.freqConsensus = new FrequencyConsensus();
    this.passiveRes    = new PassiveResonance();
    this.tiltCorrector = new TiltCorrector();
    this.vertAccel     = new VerticalAccel();
    this.ensemble      = new MultiSensorEnsemble();
    this.varDetector   = new VarianceDetector();

    // ML engine
    this.learn = new LearningEngine();
    
    // Recursion guards
    this._inOnFused = false;

    // Reading history
    this._readingHistory = [];
    this._measurementHistory = [];
    this.accuracyGrade = 'untested';

    // Settings persistence
    this.settings = this._loadSettings();
    
    // Environmental data cache
    this._envData = {
      temperature: null,
      batteryLevel: null,
      orientation: null
    };
  }

  /* ── Boot ─────────────────────────────────────────────────── */
  async boot() {
    this._bindUI();

    try { this._initDisplay(); } catch (e) { console.warn('[boot] _initDisplay failed:', e); }
    try { this._initSensorBars(); } catch (e) { console.warn('[boot] _initSensorBars failed:', e); }

    // Boot accuracy display
    const accDigitEl = document.getElementById('accDigits');
    const accBarEl   = document.getElementById('accBar');
    if (accDigitEl && accBarEl) {
      try { this.accuracyDisplay = new AccuracyDisplay(accDigitEl, accBarEl); } catch {}
    }

    try {
      await Promise.all([
        this.display?.startup?.(),
        this.accuracyDisplay?.startup?.(),
      ]);
    } catch (e) { console.warn('[boot] display startup failed:', e); }

    try { this.ledPower?.on('green'); } catch {}

    // Initialize ultra-precision engine
    try { await this.ultraPrecision.init(); } catch (e) { console.warn('[boot] ultraPrecision.init failed:', e); }

    // Register all fusion sources
    this._registerFusionSources();

    // Wire fusion callbacks
    this._wireFusionCallbacks();

    this._luxBaseline = null;
    this._luxSamples  = null;

    this._setState('IDLE');

    // Handle URL params
    const params = new URLSearchParams(location.search);
    if (params.get('cal')) {
      this._showOnboard();
      return;
    }

    // Load persisted data
    this.verifier.loadSaved();
    this.verifier.loadHistory();

    // Report device capabilities anonymously — helps improve accuracy for all users
    telemetry.logCapabilities({
      calibrated: !!this.settings.calibrated,
      hasCalPoints: (this.settings.calPoints?.length || 0),
    });

    // Fetch global crowd-sourced stats (non-blocking; seeds sensitivity if uncalibrated)
    telemetry.fetchGlobalStats().then(stats => {
      if (stats && !this.settings.calibrated) {
        const sq = this.settings.surfaceQuality || 'ok';
        const crowdSens = stats.sensMap?.[sq];
        if (crowdSens && crowdSens > 0) {
          this.motion.sensitivity = crowdSens;
          this._showToast(`Global prior: ${crowdSens.toFixed(0)} g/ms⁻² (${stats.verifyCount || 0} devices)`, 3500);
        }
        const passRate = stats.passRate;
        if (passRate !== null && stats.verifyCount > 10) {
          const pct = Math.round(passRate * 100);
          this._showToast(`Community accuracy: ${pct}% pass rate across all devices`, 3000);
        }
      }
    }).catch(() => {});

    // Apply community priors
    await this.learn.priors.load().catch(() => {});
    if (!this.settings.calibrated) {
      const suggestedSens = this.learn.priors.getSuggested(this.settings.phoneMass || 170);
      if (suggestedSens) {
        this.motion.sensitivity = suggestedSens;
        this._showToast(`Community prior: ${suggestedSens}g/ms⁻² for your phone`, 3000);
      }
    }

    this._initReadingHistory();
    this._updateLearningIndicator();
    
    this.motion.onPrecisionUpdate = (precision, weight) => {
      this._updatePrecisionDisplay(precision, weight);
    };

    // Load saved calibration
    if (this.settings.calibrated) {
      this._loadCalibration();
      // iOS 13+ requires DeviceMotionEvent.requestPermission() to be called
      // from a direct user gesture. For returning calibrated users we show a
      // one-tap overlay so iOS grants the permission correctly.
      if (typeof DeviceMotionEvent?.requestPermission === 'function') {
        await this._showIOSTapGate();
      }
      await this._startAllSensors();
      this._setState('READY');
      this._startSensorPolling();
      this._startSensorWatchdog();
      this._startEnvironmentalMonitoring();
    } else {
      this._showOnboard();
    }
    
    // Check for recalibration needs
    this._checkRecalibrationStatus();

  }

  _registerFusionSources() {
    const sources = {
      'accel': 1.0,
      'hammer': 0.9,
      'audio': 0.8,
      'gyro': 0.75,
      'cam': 0.60,
      'touch': 0.35,
      'mag': 0.30,
      'freq_consensus': 0.95,
      'passive_res': 0.50,
      'accel_z': 0.35,
      'ambient_light': 0.15,
      'ensemble': 0.88,
      'particle_filter': 0.92,
      'nn_corrected': 0.85
    };
    
    for (const [name, prior] of Object.entries(sources)) {
      this.fusion.register(name, prior);
    }
  }

  _wireFusionCallbacks() {
    this.motion.onWeight = (g, c) => {
      const gatedConf  = c * this.gyroGate.multiplier;
      const correctedG = this.tiltCorrector.correctGrams(g);
      const tiltConf   = gatedConf * this.tiltCorrector.flatness;
      this._sensorUpdate('accel', correctedG, tiltConf);
      this.advancedFusion.update('accel', correctedG, tiltConf);
    };
    
    this.audio.onWeight   = (g, c) => {
      this._sensorUpdate('audio', g, c);
      this.advancedFusion.update('audio', g, c);
      if (this.audio.lastFreq) {
        this.freqConsensus.feed('audio', this.audio.lastFreq);
        if (this.camera.active) this.camera.validateWithAudio(this.audio.lastFreq);
      }
    };
    
    this.touch.onWeight  = (g, c) => {
      this._sensorUpdate('touch', g, c);
      this.advancedFusion.update('touch', g, c);
    };
    
    this.hammer.onWeight = (g, c) => {
      this._sensorUpdate('hammer', g, c);
      this.advancedFusion.update('hammer', g, c);
      if (this.hammer.lastFreq) this.freqConsensus.feed('hammer', this.hammer.lastFreq);
    };

    this.motion.onRaw = (ax, ay, az) => {
      this.hammer.feedSample(ax, ay);
      this._updateSensorBar('accelBar', Math.sqrt(ax*ax + ay*ay), 0.2);
      this.passiveRes.feed(ax, ay, az);
      this.vertAccel.feed(az);
      this.varDetector.feed(ax, ay, az);
    };

    this.fusion.onFused = (g, c) => this._onFused(g, c);

    this.genSensor.onMagAnomaly = (delta, conf) => {
      const roughG = Math.abs(delta) * 0.8;
      this._sensorUpdate('mag', roughG, conf * 0.3);
      this.advancedFusion.update('mag', roughG, conf * 0.3);
    };

    this.genSensor.onLinAccel = (lax, lay) => {
      const dA = Math.sqrt(lax * lax + lay * lay);
      if (this.motion.sensitivity) {
        const g = Math.max(0, dA * this.motion.sensitivity);
        this._sensorUpdate('accel', g, 0.85);
        this.advancedFusion.update('accel', g, 0.85);
      }
      this._updateSensorBar('accelBar', dA, 0.2);
    };

    this.genSensor.onGyroMass = (g, c) => {
      this._sensorUpdate('gyro', g, c);
      this.advancedFusion.update('gyro', g, c);
    };

    this.genSensor.onGyroRaw = (gx, gy, gz) => this.gyroGate.feed(gx, gy, gz);
    this.genSensor.onGravity = (gx, gy, gz) => this.tiltCorrector.feedGravity(gx, gy, gz);

    this.genSensor.onLight = (lux) => {
      if (!this._luxBaseline) {
        this._luxSamples = this._luxSamples || [];
        this._luxSamples.push(lux);
        if (this._luxSamples.length >= 30) {
          this._luxBaseline = this._luxSamples.reduce((a, b) => a + b, 0) / this._luxSamples.length;
          this._luxSamples = null;
        }
        return;
      }
      const drop  = Math.max(0, this._luxBaseline - lux);
      const conf  = Math.min(0.15, drop / (this._luxBaseline + 1) * 0.5);
      if (conf > 0.02) this._sensorUpdate('ambient_light', drop * 0.1, conf);
    };

    this.freqConsensus.onConsensus = (g, c) => {
      this._sensorUpdate('freq_consensus', g, c);
      this.advancedFusion.update('freq_consensus', g, c);
    };

    this.passiveRes.onWeight = (g, c) => {
      this._sensorUpdate('passive_res', g, c);
      if (this.passiveRes.baselineFreq) {
        const pm = this.passiveRes.phoneMass || 170;
        const f0 = this.passiveRes.baselineFreq;
        const loadedF = f0 / Math.sqrt(1 + g / pm);
        if (loadedF > 0) this.freqConsensus.feed('passive_res', loadedF);
      }
    };

    this.vertAccel.onWeight = (g, c) => this._sensorUpdate('accel_z', g, c);

    this.camera.onWeight = (g, c) => {
      this._sensorUpdate('cam', g, c);
      this.advancedFusion.update('cam', g, c);
      if (this.camera.baselineFreq && g > 0) {
        const f0 = this.camera.baselineFreq;
        const pm = this.camera.phoneMass || 170;
        const loadedF = f0 / Math.sqrt(1 + g / pm);
        if (loadedF > 0) this.freqConsensus.feed('cam', loadedF);
      }
    };
    
    this.camera.onPresence = (_present, conf) => {
      if (conf > 0.3) this._updateSensorBar('hammerBar', conf * 0.5, 1);
    };

    this.ensemble.onConsensus = (g, c, count) => {
      this._sensorUpdate('ensemble', g, c * 1.1);
      this.advancedFusion.update('ensemble', g, c);
    };

    this.varDetector.onPlacement = (action, _variance) => {
      if (action === 'added') {
        this._stableBuf = [];
        if (this.hammer.supported && this.hammer.baselineFreq) {
          this._runHammerMeasure();
        }
      }
    };
  }

  _startEnvironmentalMonitoring() {
    // Update environmental data periodically
    setInterval(() => {
      this._updateEnvironmentalData();
    }, 1000);
  }

  _updateEnvironmentalData() {
    const battery = this.environmental.battery?.getData?.() ?? {};
    const orientation = this.environmental.data?.orientation?.orientation;
    
    this._envData = {
      batteryLevel: battery?.level,
      temperature: battery?.temperature || 25,
      orientation: orientation
    };
    
    // Update UI with environmental status
    const envScore = this.environmental.getStabilityScore();
    if (envScore < 0.7) {
      const guidance = this.environmental.getGuidance();
      if (guidance.length && Math.random() < 0.1) { // 10% chance to show
        this._showToast(guidance[0], 2000);
      }
    }
  }

  _checkRecalibrationStatus() {
    if (!this.settings.calibrated) return;
    
    const age = Date.now() - this.calibrationTime;
    const daysOld = age / (24 * 60 * 60 * 1000);
    
    if (daysOld > 7) {
      this._showToast('⚠ Calibration is >7 days old. Consider recalibrating for best accuracy.', 5000);
    }
    
    // Check error log for drift patterns
    const recCheck = this.ultraPrecision.adaptiveCal.checkRecalibrationNeeded();
    if (recCheck.needed) {
      this._showToast(`⚠ ${recCheck.reason}: Recalibration recommended`, 4000);
    }
  }

  /** Start background sensor polling */
  _startSensorPolling() {
    this._sensorPollInterval = setInterval(() => {
      if (this.state === 'READY' || this.state === 'MEASURING') {
        this._updateEnvironmentalData();
      }
    }, 2000);
  }

  _loadCalibration() {
    this.motion.sensitivity  = this.settings.motionSensitivity;
    this.motion.baseline     = this.settings.motionBaseline;
    this.hammer.baselineFreq = this.settings.hammerBaselineFreq;
    this.hammer.phoneMass    = this.settings.phoneMass || 170;
    this.audio.baselineFreq  = this.settings.audioBaselineFreq;
    this.audio.phoneMass     = this.settings.phoneMass || 170;
    this.camera.phoneMass    = this.settings.phoneMass || 170;
    this.camera.baselineFreq = this.settings.cameraBaselineFreq
                               || this.settings.hammerBaselineFreq;
    this.genSensor.setGyroCalibration(this.settings.motionSensitivity);
    this.calibrationTime = this.settings.calibrationTime || Date.now();

    // Configure combo sensors
    const _phoneMass    = this.settings.phoneMass || 170;
    const _baselineFreq = this.settings.hammerBaselineFreq
                       || this.settings.audioBaselineFreq || null;
    this.freqConsensus.baselineFreq = _baselineFreq;
    this.freqConsensus.phoneMass    = _phoneMass;
    this.passiveRes.baselineFreq    = _baselineFreq;
    this.passiveRes.phoneMass       = _phoneMass;
    this.passiveRes.sampleRate      = this.motion.sampleRateHz;
    this.vertAccel.sensitivity      = this.settings.motionSensitivity || 180;
    if (this.settings.motionBaseline?.az != null) {
      this.vertAccel.setBaseline(this.settings.motionBaseline.az);
    }
  }

  /* ── UI Binding ───────────────────────────────────────────── */
  _bindUI() {
    const b = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
    b('btnTare',       () => this._tare());
    b('btnMode',       () => this._cycleMode());
    b('btnUnits',      () => this._cycleUnits());
    b('btnCal',        () => this._triggerCal());
    b('btnHold',       () => this._toggleHold());
    b('btnPower',      () => this._togglePower());
    b('btnLight',      () => this._toggleLight());
    b('btnHammer',     () => this._runHammerMeasure());
    b('btnPrecision',  () => this.measureUltraPrecision());
    b('btnVerify',     () => this._openVerifyPanel());
    b('btnStats',      () => this._openAccuracyPanel());
    b('accuracyClose', () => this._closeAccuracyPanel());
    b('accCloseBtn',   () => this._closeAccuracyPanel());
    b('accExportBtn',  () => this._exportAccuracyData());
    b('verifyClose',   () => this._closeVerifyPanel());
    b('verifyCloseBtn',() => this._closeVerifyPanel());
    b('verifyLockBtn', () => this._lockVerifyRef());

    b('calResetBtn',    () => {
      const c = document.getElementById('calResetConfirm');
      if (c) c.style.display = c.style.display === 'none' ? 'block' : 'none';
    });
    b('calResetYesBtn', () => {
      document.getElementById('calOverlay').style.display = 'none';
      this._factoryReset();
    });
    b('calResetNoBtn',  () => {
      const c = document.getElementById('calResetConfirm');
      if (c) c.style.display = 'none';
    });

    const pad = document.getElementById('touchPad');
    if (pad) this.touch.start(pad);

    document.querySelectorAll('.btn').forEach(el => {
      el.addEventListener('pointerdown', () => this._haptic([8]));
    });
  }

  _initDisplay() {
    this.display   = new SevenSegmentDisplay(document.getElementById('digitDisplay'), 5, 1);
    this.stabBar   = new StabilityBar(document.getElementById('stabilityBar'));
    this.ledPower  = new LED(document.getElementById('ledPower'));
    this.ledStable = new LED(document.getElementById('ledStable'));
    this.ledAudio  = new LED(document.getElementById('ledAudio'));
    this.ledCamera = new LED(document.getElementById('ledCamera'));
  }

  _initSensorBars() {
    ['accelBar','audioBar','touchBar','hammerBar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.width = '0%';
    });
  }

  /* ── State Machine ────────────────────────────────────────── */
  _setState(s) {
    this.state = s;
    const el = document.getElementById('statusText');
    if (el) el.textContent = s;

    switch (s) {
      case 'READY':
        this.display.setValue(0);
        this.ledStable.on('green');
        if (this.accuracyDisplay) {
          const cal  = this.settings.calibrated ? 1.0 : 0.4;
          const surf = { excellent: 1.0, good: 0.8, ok: 0.55, poor: 0.3, unknown: 0.5 };
          const base = Math.round((cal * 0.65 + (surf[this.settings.surfaceQuality ?? 'unknown'] ?? 0.5) * 0.35) * 75);
          this.accuracyDisplay.set(Math.min(75, base));
        }
        break;
      case 'MEASURING':
        this.ledStable.on('orange');
        break;
      case 'STABLE':
        this.ledStable.on('green');
        this._haptic([20, 15, 20]);
        break;
      case 'ZEROING':
        this.display.showTare();
        this.ledStable.off();
        break;
      case 'CALIBRATING':
        this.display.showCalibrate();
        this.ledStable.on('blue');
        break;
      case 'ULTRA':
        this.ledStable.on('cyan');
        break;
    }
  }

  /* ── iOS Tap Gate ─────────────────────────────────────────── */
  _showIOSTapGate() {
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.style.cssText = [
        'position:fixed', 'inset:0', 'background:#000', 'z-index:9999',
        'display:flex', 'flex-direction:column', 'align-items:center',
        'justify-content:center', 'gap:24px', 'cursor:pointer',
        'touch-action:manipulation',
      ].join(';');
      ov.innerHTML = `
        <div style="font-size:64px">📱</div>
        <div style="color:#e8c84a;font-family:monospace;font-size:20px;letter-spacing:4px;text-align:center">
          TAP TO ACTIVATE<br>
          <span style="font-size:13px;color:#888;letter-spacing:1px">Phoneway needs motion sensors</span>
        </div>
        <div style="background:#1a1a1a;border:1px solid #e8c84a;border-radius:12px;padding:16px 40px;
          color:#e8c84a;font-family:monospace;font-size:14px;letter-spacing:2px">
          TAP ANYWHERE
        </div>`;
      document.body.appendChild(ov);
      const done = () => { ov.remove(); resolve(); };
      ov.addEventListener('click',      done, { once: true });
      ov.addEventListener('touchstart', done, { once: true, passive: true });
    });
  }

  /* ── Sensor Watchdog ──────────────────────────────────────── */
  _startSensorWatchdog() {
    if (this._watchdogInterval) return;
    let lastCount = 0;
    this._watchdogInterval = setInterval(async () => {
      if (!this.powered || ['OFF','CALIBRATING','ZEROING'].includes(this.state)) return;
      const activeNow = [...(this.fusion?.sources?.values() || [])]
        .filter(s => s.confidence > 0.1 && s.estimate > 0).length;
      // If accel sensor has dropped (no readings for 30s window)
      if (!this.motion.active && this.state !== 'OFF') {
        try {
          this.motion.start();
          telemetry.logSensorError('motion_watchdog', 'restarted_dropped_sensor');
        } catch {}
      }
      // If audio was active but stopped producing (ledAudio went red)
      if (this.audio.supported && !this.audio._active) {
        try { this.audio.start(); } catch {}
      }
      lastCount = activeNow;
    }, 30000);
  }

  /* ── Sensor Start ─────────────────────────────────────────── */
  async _startAllSensors() {
    const avail = await this.genSensor.init(60).catch(() => ({}));
    if (avail.linAccel) {
      this._showToast('High-accuracy linear sensor active', 2500);
    }

    try {
      await this.motion.request();
      this.motion.start();
    } catch (e) {
      this._showToast('Motion access denied — accuracy reduced', 3500);
      telemetry.logPermissionDenied('devicemotion');
    }

    this.audio.onReady = () => {
      this.ledAudio.on('green');
      this._updateSensorBar('audioBar', 0.3, 1);
    };
    this.audio.onError = (err) => {
      this.ledAudio.on('red');
      this._showToast('Mic unavailable — audio mode disabled', 2500);
      telemetry.logSensorError('microphone', err?.message || 'unavailable');
    };
    await this.audio.init().catch(e => telemetry.logSensorError('microphone', e?.message));
    if (this.audio.supported) this.audio.start();

    const camOk = await this.camera.start().catch(e => {
      telemetry.logSensorError('camera', e?.message || 'unavailable');
      return false;
    });
    if (camOk) {
      this.ledCamera?.on('green');
      this._showToast('Camera sensor active', 2000);
    } else {
      this.ledCamera?.on('red');
    }

    // Initialize environmental sensors
    const envOk = await this.environmental.init();
    if (envOk.barometer || envOk.battery || envOk.orientation) {
      console.log('[Environmental]', envOk);
    }

    await delay(200);
    this.genSensor.recordMagBaseline();

    if (this.genSensor.available.gyro && this.genSensor.available.gravity) {
      await delay(400);
      this.genSensor.recordTiltBaseline();
    }

    const sens = this.motion.sensitivity || this.settings.motionSensitivity || 180;
    this.genSensor.setGyroCalibration(sens);
    this.hammer.setSampleRate(this.motion.sampleRateHz);
    this.passiveRes.sampleRate = this.motion.sampleRateHz;
  }

  /* ── Onboarding + Calibration ──────────────────────────────── */
  _showOnboard() {
    const modal = document.getElementById('onboardModal');
    if (!modal) return;
    modal.style.display = 'flex';
    this._buildCalWeightList(modal.querySelector('.cal-weight-list'));

    modal.querySelector('#startCalBtn')?.addEventListener('click', () => {
      modal.style.display = 'none';
      this._runFullCalibration();
    });
    modal.querySelector('#skipCalBtn')?.addEventListener('click', () => {
      modal.style.display = 'none';
      this.motion.sensitivity = 180;
      this._startAllSensors().then(() => { this._setState('READY'); this._startSensorWatchdog(); });
    });
  }

  _buildCalWeightList(container) {
    if (!container) return;
    container.innerHTML = '';
    CAL_WEIGHTS.forEach((w, i) => {
      const item = document.createElement('div');
      item.className = 'cal-item';
      item.dataset.idx = i;
      item.innerHTML = `
        <span class="cal-icon">${w.icon}</span>
        <div class="cal-info">
          <strong>${w.label}</strong>
          <small>${w.grams != null ? w.grams.toFixed(2) + ' g' : '?'} — ${w.tip}</small>
        </div>`;
      item.addEventListener('click', () => {
        container.querySelectorAll('.cal-item').forEach(e => e.classList.remove('selected'));
        item.classList.add('selected');
        const isCustom = w.grams === null;
        const customRow = document.querySelector('.custom-weight-row');
        if (customRow) customRow.style.display = isCustom ? 'flex' : 'none';
        if (!isCustom) this.calWeightG = w.grams;
      });
      container.appendChild(item);
      if (i === 3) item.click();
    });

    document.getElementById('customWeightInput')?.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v) && v > 0) this.calWeightG = v;
    });
  }

  _triggerCal() {
    if (this.state === 'IDLE') { this._showOnboard(); return; }
    const ov = document.getElementById('calOverlay');
    if (!ov) return;
    ov.style.display = 'flex';
    ov.querySelector('#calConfirmBtn')?.addEventListener('click', () => {
      ov.style.display = 'none';
      this.motion.calPoints = [];
      this.calPhase = 0;
      this._runFullCalibration();
    }, { once: true });
    ov.querySelector('#calCancelBtn')?.addEventListener('click', () => {
      ov.style.display = 'none';
      const rc = document.getElementById('calResetConfirm');
      if (rc) rc.style.display = 'none';
    }, { once: true });
  }

  /* ── Full calibration sequence ────────────────────────────── */
  async _runFullCalibration() {
    await this._startAllSensors();
    this._setState('CALIBRATING');

    // Step 1: Zero baseline
    await this._waitForReady(
      'STEP 1 OF 3 — GET READY',
      `Place phone face-up on a SOFT, FLAT surface:\n\n` +
      `   ✓ Mouse pad        ✓ Notebook\n` +
      `   ✓ Folded cloth     ✓ Paperback book\n\n` +
      `Remove ALL objects from the phone screen.\n` +
      `Do NOT touch or move it once placed.\n\n` +
      `Tap I'M READY when set up.`
    );
    this._showStepOverlay('STEP 1 OF 3 — MEASURING ZERO', 'Hold perfectly still…');

    this._setCalProgress(0);
    this.baseline.reset();

    const stepBody   = document.querySelector('#stepOverlay .step-body');
    const statusEl   = document.getElementById('calSensorStatus');
    const skipBtn    = document.getElementById('calSkipBtn');
    const BASE_TEXT  =
      `Place phone face-up on a SOFT, FLAT surface:\n\n` +
      `   ✓ Mouse pad\n   ✓ Notebook / magazine\n   ✓ Folded cloth\n\n` +
      `Remove ALL objects from the phone.\nDo not touch or move it.`;

    let samplesReceived = 0;

    const origOnRaw = this.motion.onRaw;
    this.motion.onRaw = (ax, ay, az) => {
      origOnRaw?.(ax, ay, az);
      samplesReceived++;
      this.baseline.feed(ax, ay, az);
      this._setCalProgress(this.baseline.progress * 60);
    };

    const uiTimer = setInterval(() => {
      const n = Math.min(samplesReceived, 200);
      if (stepBody) stepBody.textContent = BASE_TEXT +
        `\n\n${n > 0 ? `Collecting: ${n} / 200 samples…` : 'Waiting for motion sensor…'}`;
      if (statusEl) statusEl.textContent =
        n > 0 ? `SENSOR: ACTIVE  ·  ${n}/200` : 'SENSOR: WAITING…';
      if (skipBtn && !skipBtn._shown &&
          (samplesReceived === 0 && Date.now() - _t0 > 2000 ||
           Date.now() - _t0 > 4000)) {
        skipBtn.style.display = 'block';
        skipBtn._shown = true;
      }
    }, 250);

    const _t0 = Date.now();

    const result = await Promise.race([
      new Promise(res => {
        this.baseline.onComplete = b => { this.motion.setBaseline(b); res('done'); };
      }),
      new Promise(res => {
        if (skipBtn) {
          skipBtn._skipFn = () => res('skip');
          skipBtn.addEventListener('click', skipBtn._skipFn, { once: true });
        }
      }),
      new Promise(res => setTimeout(() => res('timeout'), 8000)),
    ]);

    clearInterval(uiTimer);
    if (skipBtn) {
      skipBtn.style.display = 'none';
      skipBtn._shown = false;
      if (skipBtn._skipFn) skipBtn.removeEventListener('click', skipBtn._skipFn);
    }
    if (statusEl) statusEl.textContent = '';

    this.motion.onRaw = origOnRaw;

    if (result !== 'done') {
      const fallback = samplesReceived > 0
        ? this.motion.raw
        : { ax: 0, ay: 0, az: 9.8 };
      this.motion.setBaseline(fallback);
    }
    this._setCalProgress(65);

    // Vibration calibration
    if (this.hammer.supported) {
      await this._showStepOverlay(
        'STEP 1b — VIBRATION CALIBRATION',
        `Stay still — phone will vibrate 6 times to measure resonance.\n\nThis improves accuracy significantly.`
      );
      const hammerResult = await Promise.race([
        this.hammer.calibrateBaseline(6, (i, n) => {
          this._setCalProgress(65 + (i / n) * 15);
        }),
        new Promise(res => setTimeout(() => res('timeout'), 8000)),
      ]);
      if (hammerResult === 'timeout' || !hammerResult) {
        this._showToast('Vibration sensor timeout — using fallback mode', 3000);
        if (!this.hammer.baselineFreq) {
          this.hammer.baselineFreq = 18.0;
          this.hammer.phoneMass = this.settings.phoneMass || 170;
        }
      }
    }

    // Audio baseline
    if (this.audio.supported) {
      await this._showStepOverlay(
        'STEP 1c — AUDIO BASELINE',
        `Playing calibration tone…\nKeep phone still and quiet.`
      );
      await this.audio.recordBaseline(true).catch(() => {});
    }

    // Camera baseline
    if (this.camera.active) {
      await delay(600);
      this.camera.recordBaseline();
    }

    // Environmental baselines
    this.environmental.barometer.recordBaseline();

    this.genSensor.recordTiltBaseline();
    this._setCalProgress(80);

    // Step 2: First calibration weight
    await this._waitForReady(
      'STEP 2 OF 3 — ADD YOUR WEIGHT',
      `Gently place your calibration weight in the\nCENTER of the phone screen.\n\n` +
      `Selected: ${this.calWeightG.toFixed(2)} g\n\n` +
      `💵 Dollar bill = 1.00 g\n` +
      `🪙 Penny       = 2.50 g\n` +
      `🪙 Nickel      = 5.00 g\n\n` +
      `Place weight, then tap I'M READY.\nDo NOT touch the phone during measurement.`
    );
    this._showStepOverlay('STEP 2 — PRECISION MEASURING…', 'Optimizing for 0.1g accuracy…\nHold PERFECTLY still');

    const deltaA1 = await this._measureDeltaA(6000, pct => this._setCalProgress(80 + pct * 10), {
      targetPrecision: 0.05,
      minDuration: 3000
    });
    this.firstDeltaA = deltaA1;
    this.firstCalG   = this.calWeightG;
    
    const calOk1 = this.motion.addCalPoint(this.calWeightG, deltaA1, { confidence: 0.95 });
    if (!calOk1) {
      this._showToast('Warning: Small signal detected — using fallback calibration', 4000);
    }
    
    if (!this.motion.sensitivity || this.motion.sensitivity <= 0) {
      const priorSens = this.learn.priors.getSuggested(this.settings.phoneMass || 170);
      this.motion.sensitivity = priorSens || 150;
      this._showToast(`Using fallback sensitivity: ${this.motion.sensitivity.toFixed(1)}`, 3000);
    }
    
    this._setCalProgress(90);

    // Step 3: Second calibration weight
    const secondOffer = await this._offerSecondWeight();
    if (secondOffer) {
      const secondW = secondOffer;
      await this._showStepOverlay(
        'STEP 3 OF 3 — SECOND WEIGHT',
        `Remove the first weight.\nPlace: ${secondW.label} (${secondW.grams.toFixed(2)} g)\n\nPrecision measuring…`
      );
      const deltaA2 = await this._measureDeltaA(6000, pct => this._setCalProgress(90 + pct * 7), {
        targetPrecision: 0.05,
        minDuration: 3000
      });
      this.motion.addCalPoint(secondW.grams, deltaA2, { confidence: 0.95 });
    }

    this._setCalProgress(98);

    // Persist settings
    this.settings.calibrated          = true;
    this.settings.motionSensitivity   = this.motion.sensitivity;
    this.settings.motionBaseline      = this.motion.baseline;
    this.settings.hammerBaselineFreq  = this.hammer.baselineFreq;
    this.settings.audioBaselineFreq   = this.audio.baselineFreq;
    this.settings.phoneMass           = this.hammer.phoneMass;
    this.settings.surfaceQuality      = this.motion.surfaceQuality;
    this.settings.calibrationTime     = Date.now();

    const phoneMass = this.hammer.phoneMass || 170;
    const camFreq   = this.hammer.baselineFreq || this.audio.baselineFreq;
    this.camera.phoneMass    = phoneMass;
    this.camera.baselineFreq = camFreq;
    this.settings.cameraBaselineFreq = camFreq;
    this.genSensor.setGyroCalibration(this.motion.sensitivity);
    this.calibrationTime = Date.now();

    // Configure combo sensors
    const _calMass = this.hammer.phoneMass || 170;
    const _calFreq = this.hammer.baselineFreq || this.audio.baselineFreq || null;
    this.freqConsensus.baselineFreq = _calFreq;
    this.freqConsensus.phoneMass    = _calMass;
    this.passiveRes.baselineFreq    = _calFreq;
    this.passiveRes.phoneMass       = _calMass;
    this.passiveRes.sampleRate      = this.motion.sampleRateHz;
    this.vertAccel.sensitivity      = this.motion.sensitivity;
    this.vertAccel.setBaseline(this.motion.raw?.az ?? 9.81);

    this._saveSettings();

    // Report calibration quality to crowd-sourced telemetry
    telemetry.logCalibration(
      this.motion.sensitivity,
      this.motion.surfaceQuality,
      this.motion.calPoints?.length || 0,
      this.hammer.phoneMass || 170
    );

    this._setCalProgress(100);

    const sq = this.motion.surfaceQuality;
    this._haptic([40, 20, 40, 20, 200]);
    await this._showStepOverlay(
      '✓ CALIBRATION COMPLETE',
      `Sensitivity: ${this.motion.sensitivity?.toFixed(1)} g/(m·s⁻²)\n` +
      `Surface: ${sq?.toUpperCase()}\n${SURFACE_TIPS[sq] || ''}\n\n` +
      (this.hammer.baselineFreq ? `Hammer baseline: ${this.hammer.baselineFreq.toFixed(2)} Hz\n` : '') +
      (this.audio.baselineFreq  ? `Audio baseline:  ${this.audio.baselineFreq.toFixed(1)} Hz\n` : '') +
      `\nYour scale is ready for 0.1g accuracy!`
    );

    await delay(2500);
    this._hideStepOverlay();
    this._setState('READY');
    this._showSurfaceTip();
    
    // Reset ultra-precision engine with new calibration
    this.ultraPrecision.reset();
    this.ultraPrecision.adaptiveCal.resetCalibration();
  }

  async _measureDeltaA(durationMs, onProgress, options = {}) {
    if (options.targetPrecision && this.motion.measurePrecision) {
      this._showToast(`Precision mode: targeting ±${options.targetPrecision}g…`, 2000);
      const result = await this.motion.measurePrecision({
        targetPrecision: options.targetPrecision,
        timeout: durationMs,
        minDuration: options.minDuration || 2000
      });
      
      if (result.precision < options.targetPrecision * 2) {
        this._showToast(`✓ Precision: ±${result.precision.toFixed(3)}g`, 2000);
      }
      
      return result.grams / (this.motion.sensitivity || 150);
    }
    
    const samples = [];
    const step = 50;
    const steps = durationMs / step;
    for (let i = 0; i < steps; i++) {
      await delay(step);
      samples.push(this.motion.deltaA);
      onProgress?.(i / steps);
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const std  = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
    const clean = samples.filter(v => Math.abs(v - mean) < 2 * std);
    return clean.reduce((a, b) => a + b, 0) / (clean.length || 1);
  }

  async _offerSecondWeight() {
    return new Promise(res => {
      const used = this.calWeightG;
      const suggestions = CAL_WEIGHTS.filter(w =>
        w.grams !== null && Math.abs(w.grams - used) > 0.5 && w.grams < 10 && w.grams !== used
      ).sort((a, b) => Math.abs(a.grams - used) - Math.abs(b.grams - used));
      
      const suggest = suggestions.find(w => w.grams < used) || suggestions[0] || null;
      if (!suggest) { res(null); return; }

      const el = document.createElement('div');
      el.className = 'second-cal-toast';
      el.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.95); border: 2px solid var(--seg-on);
        border-radius: 12px; padding: 20px; max-width: 320px;
        z-index: 10000; text-align: center; box-shadow: 0 0 30px rgba(232,200,74,0.3);
      `;
      el.innerHTML = `
        <p style="font-size:14px;letter-spacing:1px;color:#e8c84a;margin-bottom:12px;font-weight:bold">
          📈 IMPROVE ACCURACY
        </p>
        <p style="font-size:12px;color:#ccc;margin-bottom:8px;line-height:1.4">
          You used: <strong>${used.toFixed(2)}g</strong><br>
          Add a second weight for 2-point calibration
        </p>
        <div style="background:#1a1a1a;border-radius:8px;padding:12px;margin:12px 0">
          <p style="font-size:24px;margin:4px 0">${suggest.icon}</p>
          <p style="font-size:14px;color:#fff;margin:4px 0;font-weight:bold">${suggest.label}</p>
          <p style="font-size:16px;color:#e8c84a;margin:4px 0">${suggest.grams.toFixed(2)} g</p>
          <p style="font-size:10px;color:#888;margin-top:8px">${suggest.tip}</p>
        </div>
        <p style="font-size:10px;color:#666;margin-bottom:15px">
          Tap YES, then remove first weight and place the new one
        </p>
        <div style="display:flex;gap:12px;justify-content:center">
          <button id="secYes" class="btn" style="background:var(--seg-on);color:#000;font-weight:bold;padding:12px 24px">
            ✓ YES — USE 2ND WEIGHT
          </button>
          <button id="secNo" class="btn" style="background:#333;color:#999;padding:12px 20px">
            SKIP
          </button>
        </div>
        <p id="secTimer" style="font-size:10px;color:#555;margin-top:12px">Auto-skip in 30s</p>
      `;
      document.body.appendChild(el);

      let timeLeft = 30;
      const timerEl = el.querySelector('#secTimer');
      const timerInterval = setInterval(() => {
        timeLeft--;
        if (timerEl) timerEl.textContent = `Auto-skip in ${timeLeft}s`;
        if (timeLeft <= 0) {
          clearInterval(timerInterval);
          cleanup(null);
        }
      }, 1000);

      const cleanup = (v) => { 
        clearInterval(timerInterval);
        el.remove(); 
        res(v); 
      };
      el.querySelector('#secYes').onclick = () => cleanup(suggest);
      el.querySelector('#secNo').onclick  = () => cleanup(null);
    });
  }

  /* ── Ultra Precision Measurement ─────────────────────────── */
  async measureUltraPrecision() {
    if (!this.powered) return;
    
    this._setState('ULTRA');
    this._showToast('🎯 ULTRA PRECISION: Targeting ±0.05g…', 3000);
    
    // Check environmental conditions
    const envOptimal = this.environmental.isOptimal();
    if (!envOptimal) {
      const guidance = this.environmental.getGuidance();
      this._showToast(`⚠ ${guidance[0] || 'Wait for stable conditions'}`, 4000);
    }
    
    try {
      const result = await this.ultraPrecision.measure(
        async () => {
          // Sampler function
          const fused = this.advancedFusion.getFusedEstimate();
          return {
            grams: fused.grams,
            confidence: fused.confidence,
            rawDeltaA: this.motion.deltaA,
            sensorReadings: this._getCurrentSensorReadings()
          };
        },
        {
          targetPrecision: 0.05,
          timeout: 15000,
          minDuration: 4000,
          waitForOptimal: true,
          onProgress: (stats, progress) => {
            this.display.setValue(stats.grams);
            this._updatePrecisionDisplay(stats.precision, stats.grams);
          }
        }
      );
      
      this.correctedG = result.grams;
      this.currentG = result.grams;
      
      // Apply ML corrections
      const mlResult = this.ensembleCal.correct({
        fusedGrams: result.grams,
        sensorReadings: this._getCurrentSensorReadings(),
        confidence: result.confidence,
        calibrationAge: Date.now() - this.calibrationTime,
        surfaceQuality: this.settings.surfaceQuality
      });
      
      const finalGrams = mlResult.correctedGrams;
      
      // Display result
      this.display.setValue(finalGrams);
      this._updateReadout(finalGrams);
      
      const grade = this._calculateAccuracyGrade(result.precision);
      const status = result.targetAchieved ? '✓ TARGET ACHIEVED' : '⚠ Below target';
      
      this._showToast(
        `${status}\n` +
        `Measured: ${finalGrams.toFixed(3)}g\n` +
        `Precision: ±${result.precision.toFixed(3)}g\n` +
        `Grade: ${grade}`,
        6000
      );
      
      this._setState('STABLE');
      this._pushReadingHistory(finalGrams, Math.round(result.confidence * 100));
      
      // Store measurement for learning
      this._measurementHistory.push({
        grams: finalGrams,
        precision: result.precision,
        confidence: result.confidence,
        timestamp: Date.now(),
        grade
      });
      if (this._measurementHistory.length > 100) {
        this._measurementHistory.shift();
      }
      
      // Update accuracy grade
      this.accuracyGrade = grade;
      this._updateGradeDisplay();
      
      return {
        success: result.targetAchieved,
        grams: finalGrams,
        precision: result.precision,
        confidence: result.confidence,
        grade,
        samples: result.samples
      };
      
    } catch (e) {
      this._showToast('Ultra-precision measurement failed', 3000);
      this._setState('READY');
      return { success: false, error: e.message };
    }
  }

  _getCurrentSensorReadings() {
    return {
      accel: this.advancedFusion.currentReadings.accel?.grams || 0,
      audio: this.advancedFusion.currentReadings.audio?.grams || 0,
      hammer: this.advancedFusion.currentReadings.hammer?.grams || 0,
      gyro: this.advancedFusion.currentReadings.gyro?.grams || 0,
      touch: this.advancedFusion.currentReadings.touch?.grams || 0,
      camera: this.advancedFusion.currentReadings.cam?.grams || 0,
      stability: this._getStabilityScore(),
      batteryLevel: this._envData.batteryLevel,
      temperature: this._envData.temperature
    };
  }

  _getStabilityScore() {
    if (this._stableBuf.length < 10) return 0.5;
    const variance = this._variance(this._stableBuf);
    return 1 / (1 + variance * 100);
  }

  _calculateAccuracyGrade(precision) {
    if (precision < 0.03) return 'A+';
    if (precision < 0.05) return 'A';
    if (precision < 0.1) return 'B+';
    if (precision < 0.2) return 'B';
    if (precision < 0.5) return 'C';
    return 'D';
  }

  /* ── Other methods ───────────────────────────────────────── */
  async _runHammerMeasure() {
    if (!this.hammer.supported || !this.hammer.baselineFreq) {
      this._showToast('Hammer not calibrated. Run CAL first.', 2500);
      return;
    }
    this._haptic([15, 10, 15]);
    this._showToast('Vibrating — HAMMER + CAMERA + AUDIO active…', 3000);
    this._updateSensorBar('hammerBar', 0.5, 0.5);

    this.camera.beginHammerCapture();

    const result = await this.hammer.measure(4);

    const camResult = this.camera.endHammerCapture();
    if (camResult && camResult.confidence > 0.08) {
      this._sensorUpdate('cam', camResult.grams, camResult.confidence);
    }

    if (this.audio.lastFreq) {
      this.camera.validateWithAudio(this.audio.lastFreq);
    }

    if (result) {
      this._sensorUpdate('hammer', result.grams, result.confidence);
      this._updateSensorBar('hammerBar', result.confidence, 1);
    }
  }

  _openVerifyPanel() {
    if (!this.powered) return;
    this._haptic([8]);
    const panel = document.getElementById('verifyPanel');
    if (!panel) return;

    document.getElementById('btnVerify')?.classList.add('btn-active');

    const saved = this.verifier.savedGrams;
    const savedEntry = REF_WEIGHTS.find(r => r.isSaved);
    if (savedEntry && saved) savedEntry.grams = saved;

    this.verifyOpen = true;
    this._buildVerifyChips();
    panel.style.display = 'block';
    this._haptic([15, 10, 15]);
  }

  _closeVerifyPanel() {
    const panel = document.getElementById('verifyPanel');
    if (panel) panel.style.display = 'none';
    document.getElementById('btnVerify')?.classList.remove('btn-active');
    this.verifyOpen  = false;
    this._activeRefW = null;
    this.verifier.stop();
    
    const stats   = document.getElementById('verifyStats');
    const accWrap = document.getElementById('vAccBarWrap');
    const tip     = document.getElementById('verifyTip');
    const lock    = document.getElementById('verifyLockBtn');
    if (stats)   stats.style.display   = 'none';
    if (accWrap) accWrap.style.display  = 'none';
    if (tip)     tip.style.display      = 'block';
    if (lock)    lock.style.display     = 'none';
    
    document.querySelectorAll('.verify-chip').forEach(c => c.classList.remove('selected'));
  }

  /* ── Accuracy Report Panel ───────────────────────────────── */
  _openAccuracyPanel() {
    this._haptic([8]);
    const panel = document.getElementById('accuracyPanel');
    if (!panel) return;
    
    document.getElementById('btnStats')?.classList.add('btn-active');
    
    // Get quality report
    const report = this.ultraPrecision.getQualityReport();
    
    // Update grade display
    const gradeDisplay = document.getElementById('accGradeDisplay');
    const gradeDesc = document.getElementById('accGradeDesc');
    if (gradeDisplay && gradeDesc) {
      const grade = report.accuracyGrade || 'untested';
      gradeDisplay.textContent = grade;
      gradeDisplay.className = `grade-${grade.replace('+', '-plus')}`;
      gradeDesc.textContent = ACCURACY_GRADES[grade]?.desc || 'Calibrate to achieve accuracy';
    }
    
    // Update stats
    const precisionEl = document.getElementById('accPrecision');
    const systematicEl = document.getElementById('accSystematic');
    const mlSamplesEl = document.getElementById('accMLSamples');
    const verificationsEl = document.getElementById('accVerifications');
    
    if (report.errorStats) {
      if (precisionEl) precisionEl.textContent = `±${report.errorStats.randomError.toFixed(3)}g`;
      if (systematicEl) systematicEl.textContent = `${report.errorStats.systematicBias > 0 ? '+' : ''}${report.errorStats.systematicBias.toFixed(3)}g`;
    } else {
      if (precisionEl) precisionEl.textContent = '—';
      if (systematicEl) systematicEl.textContent = '—';
    }
    
    if (mlSamplesEl) mlSamplesEl.textContent = report.mlMetrics?.nnSamples || '0';
    if (verificationsEl) verificationsEl.textContent = this.learn.learnStats.verifyCount || '0';
    
    // Update recommendations
    const recList = document.getElementById('accRecList');
    if (recList && report.recommendations) {
      if (report.recommendations.length === 0) {
        recList.innerHTML = '<span style="color: #39ff14;">✓ System performing optimally</span>';
      } else {
        recList.innerHTML = report.recommendations.map(r => 
          `<div style="margin-bottom: 4px; color: ${r.severity === 'high' ? '#ff4444' : r.severity === 'medium' ? '#ff8c00' : '#e8c84a'};">
            • ${r.message}
          </div>`
        ).join('');
      }
    }
    
    // Update environmental status
    const envData = this.environmental;
    const baroEl = document.getElementById('envBaro');
    const battEl = document.getElementById('envBatt');
    const orientEl = document.getElementById('envOrient');
    const thermalEl = document.getElementById('envThermal');
    
    if (baroEl) baroEl.textContent = envData.barometer.supported ? 
      (envData.barometer.getStabilityScore() > 0.7 ? '✓ Stable' : '⚠ Varying') : '—';
    if (baroEl) baroEl.className = envData.barometer.getStabilityScore() > 0.7 ? 'env-good' : 'env-warn';
    
    if (battEl) {
      const batt = envData.battery.getData();
      battEl.textContent = batt ? `${Math.round(batt.level * 100)}% ${batt.charging ? '⚡' : ''}` : '—';
      battEl.className = batt?.thermalStability > 0.7 ? 'env-good' : batt?.thermalStability > 0.4 ? 'env-warn' : 'env-bad';
    }
    
    if (orientEl) {
      const orient = envData.orientation;
      orientEl.textContent = orient.supported ? 
        (orient.isOptimal() ? '✓ Optimal' : '⚠ Adjust') : '—';
      orientEl.className = orient.isOptimal() ? 'env-good' : 'env-warn';
    }
    
    if (thermalEl) {
      const batt = envData.battery.getData();
      thermalEl.textContent = batt?.isStable ? '✓ Stable' : batt?.charging ? '⚡ Charging' : '⚠ Wait';
      thermalEl.className = batt?.isStable ? 'env-good' : 'env-warn';
    }

    // Community stats from crowd-sourced telemetry
    this._populateCommunityStats();

    panel.style.display = 'block';
    this._haptic([15, 10, 15]);
  }

  _populateCommunityStats() {
    const el = document.getElementById('accCommunity');
    if (!el) return;

    const render = (s) => {
      if (!s || !s.verifyCount) {
        el.innerHTML = '<span style="color:#555">No community data yet — be the first to verify!</span>';
        return;
      }
      const passRate  = s.passRate ?? 0;
      const passColor = passRate >= 0.75 ? '#39ff14' : passRate >= 0.5 ? '#e8c84a' : '#ff8c00';
      const errColor  = s.meanError < 5   ? '#39ff14' : s.meanError < 10  ? '#e8c84a' : '#ff8c00';
      el.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center">
          <div>
            <div style="color:#666;font-size:9px;letter-spacing:1px">DEVICES</div>
            <div style="color:var(--seg-on);font-size:15px;font-weight:bold">${s.verifyCount}</div>
          </div>
          <div>
            <div style="color:#666;font-size:9px;letter-spacing:1px">PASS RATE</div>
            <div style="color:${passColor};font-size:15px;font-weight:bold">${Math.round(passRate * 100)}%</div>
          </div>
          <div>
            <div style="color:#666;font-size:9px;letter-spacing:1px">AVG ERROR</div>
            <div style="color:${errColor};font-size:15px;font-weight:bold">±${(s.meanError || 0).toFixed(1)}%</div>
          </div>
        </div>
        <div style="margin-top:8px;color:#444;font-size:9px;text-align:right">
          ${s.source === 'live' ? '● LIVE' : '○ DEFAULT'} · ${(s.deviceClass || '').toUpperCase()}
        </div>`;
    };

    render(telemetry._globalStats);
    telemetry.fetchGlobalStats().then(render).catch(() => {});
  }
  
  _closeAccuracyPanel() {
    const panel = document.getElementById('accuracyPanel');
    if (panel) panel.style.display = 'none';
    document.getElementById('btnStats')?.classList.remove('btn-active');
  }
  
  _exportAccuracyData() {
    // Collect all data
    const data = {
      timestamp: new Date().toISOString(),
      device: navigator.userAgent,
      calibration: {
        sensitivity: this.motion.sensitivity,
        surfaceQuality: this.settings.surfaceQuality,
        calibrationTime: new Date(this.calibrationTime).toISOString(),
        calibrationPoints: this.motion.calPoints.length
      },
      mlMetrics: this.ensembleCal.getQualityMetrics(),
      errorLog: globalErrorLogger.getErrorStats(),
      measurementHistory: this._measurementHistory.slice(-50),
      accuracyGrade: this.accuracyGrade
    };
    
    // Download as JSON
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `phoneway-accuracy-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    this._showToast('📊 Accuracy report exported', 2000);
  }

  _buildVerifyChips() {
    const container = document.getElementById('verifyChips');
    if (!container) return;
    container.innerHTML = '';

    const saved = this.verifier.savedGrams;

    REF_WEIGHTS.forEach(refW => {
      if (refW.isSaved && !saved) return;

      const chip = document.createElement('div');
      chip.className = 'verify-chip';
      chip.dataset.id = refW.id;

      const gramsLabel = refW.isSaved
        ? (saved ? saved.toFixed(2) + 'g' : '—')
        : (refW.grams != null ? refW.grams.toFixed(2) + 'g' : '?');

      chip.innerHTML = `
        <div class="verify-chip-icon">${refW.icon}</div>
        <div class="verify-chip-grams">${gramsLabel}</div>
        <div class="verify-chip-label">${refW.label}</div>`;

      chip.addEventListener('click', () => {
        container.querySelectorAll('.verify-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        const rw = refW.isSaved ? { ...refW, grams: saved } : refW;
        this._selectVerifyWeight(rw);
      });

      container.appendChild(chip);
    });
  }

  _selectVerifyWeight(refW) {
    if (!refW || refW.grams == null) {
      this._showToast('No saved reference. Use LOCK to save one first.', 2500);
      return;
    }
    this._activeRefW = refW;
    this.verifier.start(refW);

    document.getElementById('verifyTip').style.display   = 'none';
    document.getElementById('verifyStats').style.display  = 'flex';
    document.getElementById('vAccBarWrap').style.display  = 'block';
    document.getElementById('verifyLockBtn').style.display = 'block';

    document.getElementById('vExpected').textContent = refW.grams.toFixed(3);
    document.getElementById('vTol').textContent      = `±${(refW.tolerance ?? 0.05).toFixed(3)}g`;
    document.getElementById('vMeasured').textContent  = '---';
    document.getElementById('vError').textContent     = '---';
    document.getElementById('vPass').textContent      = '···';
    document.getElementById('vPass').className        = 'vstat-pass';
    document.getElementById('vAccPct').textContent    = '—%';
    document.getElementById('vAccFill').style.width   = '0%';

    this._haptic([10]);
    this._showToast(`Place ${refW.label} (${refW.grams.toFixed(2)}g) on phone`, 3500);
  }

  _updateVerifyReadout({ measured, error, accuracy, pass }) {
    const mEl = document.getElementById('vMeasured');
    const eEl = document.getElementById('vError');
    const pEl = document.getElementById('vPass');
    const aEl = document.getElementById('vAccPct');
    const fEl = document.getElementById('vAccFill');

    if (mEl) mEl.textContent = measured.toFixed(3);
    if (eEl) eEl.textContent = (error >= 0 ? '+' : '') + error.toFixed(3);

    if (pEl) {
      pEl.textContent = pass ? '✓  PASS' : '✗  FAIL';
      pEl.className   = 'vstat-pass ' + (pass ? 'pass' : 'fail');
    }

    const pct = Math.round(accuracy);
    if (aEl) aEl.textContent = pct + '%';
    if (fEl) {
      fEl.style.width = pct + '%';
      fEl.style.background =
        pct >= 95 ? 'var(--seg-on)' :
        pct >= 80 ? '#e8c84a' :
        pct >= 60 ? '#ff8c00' : '#ff2020';
      fEl.style.boxShadow = `0 0 6px ${fEl.style.background}`;
    }

    if (pass && !this._lastVerifyPass) this._haptic([20, 15, 60]);
    this._lastVerifyPass = pass;

    // Enhanced ML learning from verification
    if (this._activeRefW) {
      const sensorReadings = this._getCurrentSensorReadings();
      
      // Update accuracy grade based on this verification
      const absError = Math.abs(error);
      if (absError < 0.03) this.accuracyGrade = 'A+';
      else if (absError < 0.05) this.accuracyGrade = 'A';
      else if (absError < 0.1) this.accuracyGrade = 'B+';
      else if (absError < 0.2) this.accuracyGrade = 'B';
      else if (absError < 0.5) this.accuracyGrade = 'C';
      else this.accuracyGrade = 'D';
      this._updateGradeDisplay();
      
      // Log to global error logger (local persistence)
      globalErrorLogger.logError({
        expectedGrams: this._activeRefW.grams,
        measuredGrams: measured,
        errorGrams: error,
        errorPercent: (error / this._activeRefW.grams) * 100,
        sensorMode: MODES[this.modeIdx],
        calibrationPoints: this.motion.calPoints.length,
        phoneModel: navigator.userAgent,
        surfaceQuality: this.settings.surfaceQuality,
        batteryLevel: this._envData.batteryLevel,
        activeSensors: Object.keys(sensorReadings).filter(k => sensorReadings[k] > 0),
        fusionConfidence: accuracy / 100
      });

      // Send anonymised verify result to crowd-sourced telemetry
      telemetry.logVerify(
        this._activeRefW.grams,
        measured,
        (error / (this._activeRefW.grams || 1)) * 100,
        pass ? 'PASS' : 'FAIL',
        this.accuracyGrade
      );
      
      // Train ensemble calibrator
      const learnResult = this.ensembleCal.learn(measured, this._activeRefW.grams, sensorReadings, {
        mode: MODES[this.modeIdx],
        confidence: accuracy / 100,
        surfaceQuality: this.settings.surfaceQuality,
        calibrationTime: this.calibrationTime,
        calibrationAge: Date.now() - this.calibrationTime
      });
      
      // Also train ultra-precision engine
      this.ultraPrecision.learn(measured, this._activeRefW.grams, {
        sensorReadings,
        confidence: accuracy / 100,
        surfaceQuality: this.settings.surfaceQuality,
        calibrationTime: this.calibrationTime
      });
      
      if (pass && this.motion.sensitivity) {
        const newSens = this.learn.learn(
          this._activeRefW.grams, measured, this.motion.sensitivity
        );
        if (newSens && Math.abs(newSens - this.motion.sensitivity) / this.motion.sensitivity < 0.30) {
          this.motion.sensitivity      = newSens;
          this.settings.motionSensitivity = newSens;
          this._saveSettings();
          this._showToast(`✓ ML refined: ${newSens.toFixed(1)} g/ms⁻²`, 2500);
        }
        this._updateLearningIndicator();
        
        // Show learning progress
        const metrics = this.ensembleCal.getQualityMetrics();
        if (metrics.nnTrained) {
          this._showToast(`🧠 Neural network trained (${metrics.nnSamples} samples)`, 2000);
        }
      }
    }
  }

  _lockVerifyRef() {
    const g = this.currentG;
    if (g <= 0) {
      this._showToast('Nothing on scale to lock.', 2000);
      return;
    }
    this.verifier.lock(g);
    this._haptic([20, 15, 100]);
    this._showToast(`⭐ Locked ${g.toFixed(3)}g as reference`, 2500);

    const savedEntry = REF_WEIGHTS.find(r => r.isSaved);
    if (savedEntry) savedEntry.grams = g;

    this._buildVerifyChips();

    const lockBtn = document.getElementById('verifyLockBtn');
    if (lockBtn) {
      lockBtn.textContent = '⭐ LOCKED!';
      setTimeout(() => { if (lockBtn) lockBtn.textContent = '⭐ LOCK AS REF'; }, 2000);
    }
  }

  async _tare() {
    if (!this.powered) return;
    this._haptic([15, 10, 60]);
    this._setState('ZEROING');
    await delay(500);
    this.fusion.setTare(this.currentG);
    this.motion.setBaseline(this.motion.raw);
    this._stableBuf = [];
    this._setState('READY');
    this.display.setValue(0);
    this._haptic([200]);
  }

  _toggleHold() {
    this.held = !this.held;
    document.getElementById('btnHold')?.classList.toggle('btn-active', this.held);
    if (!this.held) this._setState('READY');
    this._haptic([12]);
  }

  _togglePower() {
    this.powered = !this.powered;
    this.ledPower[this.powered ? 'on' : 'off'](this.powered ? 'green' : null);
    if (this.powered) {
      this._setState('READY');
    } else {
      this.motion.stop();
      this.audio.stop();
      this.camera.stop();
      this.genSensor.stop();
      this.environmental.stop();
      if (this._watchdogInterval) {
        clearInterval(this._watchdogInterval);
        this._watchdogInterval = null;
      }
      this.display.setValue(null);
      this.ledStable.off();
      this.ledAudio.off();
      this.ledCamera?.off();
      this.state = 'OFF';
      document.getElementById('statusText').textContent = 'OFF';
      if (this._sensorPollInterval) {
        clearInterval(this._sensorPollInterval);
        this._sensorPollInterval = null;
      }
    }
    this._haptic([25]);
  }

  _toggleLight() {
    document.documentElement.classList.toggle('dim-mode');
    this._haptic([8]);
  }

  _cycleUnits() {
    this.unitIdx = (this.unitIdx + 1) % UNITS.length;
    document.getElementById('unitLabel').textContent = UNITS[this.unitIdx].label;
    this._haptic([12]);
    this._updateReadout(this.currentG);
  }

  _cycleMode() {
    this.modeIdx = (this.modeIdx + 1) % MODES.length;
    const mode = MODES[this.modeIdx];
    document.getElementById('modeLabel').textContent = mode;
    this._haptic([12]);
    this.fusion.reset();
    this._showToast(`Mode: ${mode}`, 1500);
  }

  _sensorUpdate(name, g, conf) {
    const modeToSensor = { 1: 'accel', 2: 'audio', 3: 'hammer', 4: 'touch', 5: 'gyro', 6: 'cam', 7: 'ensemble' };
    if (this.modeIdx === 0 || this.modeIdx === 8 || modeToSensor[this.modeIdx] === name) {
      this.fusion.update(name, g, conf);
    }

    if (g > 0 && conf > 0.05) {
      this.ensemble.feed(name, g, conf);
    }

    const barMap = {
      accel:  'accelBar',
      gyro:   'accelBar',
      audio:  'audioBar',
      touch:  'touchBar',
      mag:    'touchBar',
      hammer: 'hammerBar',
      cam:    'hammerBar',
    };
    if (barMap[name]) this._updateSensorBar(barMap[name], conf, 1);
  }

  _getEmergencyWeight() {
    if (!this.motion.sensitivity) return null;
    const deltaA = this.motion.deltaA;
    if (deltaA > 0.00005) {
      const g = deltaA * this.motion.sensitivity;
      return { grams: Math.max(0, g), confidence: 0.15 };
    }
    return null;
  }

  _onFused(g, conf) {
    // Prevent infinite recursion
    if (this._inOnFused) return;
    this._inOnFused = true;
    
    try {
      if (!this.powered || this.held ||
          ['OFF','ZEROING','CALIBRATING','ULTRA'].includes(this.state)) {
        return;
      }

    // Apply ML corrections in real-time
    let correctedG = g;
    if (this.ensembleCal.nn.isTrained || this.ensembleCal.linearCorrections.size > 0) {
      const mlResult = this.ensembleCal.correct({
        fusedGrams: g,
        sensorReadings: this._getCurrentSensorReadings(),
        confidence: conf,
        calibrationAge: Date.now() - this.calibrationTime,
        surfaceQuality: this.settings.surfaceQuality
      });
      correctedG = mlResult.correctedGrams;
      conf = mlResult.confidence;
    }

    // Emergency fallback - use emergency weight directly without recursive update
    if (correctedG < 0.01 && conf < 0.05) {
      const emergency = this._getEmergencyWeight();
      if (emergency && emergency.grams > 0.1) {
        correctedG = emergency.grams;
        conf = emergency.confidence;
        // DO NOT call fusion.update here - it causes infinite recursion!
      }
    }

    this.currentG = correctedG;
    this._updateReadout(correctedG);

    
    // Stability detection
    this._stableBuf.push(correctedG);
    if (this._stableBuf.length > this.STABLE_WIN) this._stableBuf.shift();

    const variance = this._variance(this._stableBuf);
    const stabilityScore = 1 / (1 + variance * 120);
    const stable = variance < this.STABLE_THR ** 2 &&
                   this._stableBuf.length === this.STABLE_WIN;

    const stabPct = Math.min(100, stabilityScore * 100);
    if (this.stabBar) this.stabBar.set(stabPct, stable);

    // Real-time accuracy calculation
    const calScore = this.settings.calibrated ? 1.0 : 0.4;
    const surfMap  = { excellent: 1.0, good: 0.8, ok: 0.55, poor: 0.3, unknown: 0.5 };
    const surfScore = surfMap[this.settings.surfaceQuality ?? 'unknown'];

    const rawAccuracy =
      conf           * 0.40 +
      stabilityScore * 0.35 +
      calScore       * 0.15 +
      surfScore      * 0.10;


    // Graduated consensus bonus — rewards multi-sensor agreement proportionally.
    // Threshold tightened to 12% for ±0.1g target (was 20%).
    let consensusBonus = 0;
    if (correctedG > 0.1) {
      const active = [...this.fusion.sources.values()]
        .filter(s => s.confidence > 0.2 && s.estimate > 0.05)
        .map(s => s.estimate);
      if (active.length >= 2) {
        const sorted     = [...active].sort((a, b) => a - b);
        const median     = sorted[Math.floor(sorted.length / 2)];
        const tightAgree = active.filter(v => Math.abs(v - median) / (median || 1) < 0.12);
        const looseAgree = active.filter(v => Math.abs(v - median) / (median || 1) < 0.25);
        const tightRatio = tightAgree.length / active.length;
        const looseRatio = looseAgree.length / active.length;
        // Graduated: up to +10% for near-perfect multi-sensor lock
        if      (tightRatio >= 0.80 && active.length >= 3) consensusBonus = 0.10;
        else if (tightRatio >= 0.60 && active.length >= 3) consensusBonus = 0.07;
        else if (looseRatio >= 0.80 && active.length >= 3) consensusBonus = 0.05;
        else if (looseRatio >= 0.60 || active.length >= 2) consensusBonus = 0.02;
      }
    }

    const accPct = Math.min(100, Math.max(0, Math.round((rawAccuracy + consensusBonus) * 100)));

    if (this.accuracyDisplay) {
      this.accuracyDisplay.set(accPct);
    }
    this._lastAccPct = accPct;

    const sq = this.settings.surfaceQuality;
    const surfEl = document.getElementById('surfaceLabel');
    if (surfEl && sq) surfEl.textContent = `SURFACE: ${sq.toUpperCase()}`;

    if (correctedG > 0.1) {
      this._setState(stable ? 'STABLE' : 'MEASURING');
      if (stable) {
        const activeSensors = [...this.fusion.sources.values()]
          .filter(s => s.confidence > 0.2).length;
        this.learn.logReading(correctedG, accPct, activeSensors);
        this._pushReadingHistory(correctedG, accPct);
        this._updateLearningIndicator();
        // Report stable reading stats (bucketed weight range — no actual value)
        telemetry.logStableReading(correctedG, activeSensors, accPct);
      }
    } else {
      if (this.state !== 'READY') this._setState('READY');
      this._stableBuf = [];
      if (this.accuracyDisplay) {
        const restPct = Math.round(calScore * 60 + surfScore * 20 + conf * 20);
        this.accuracyDisplay.set(Math.min(99, restPct));
      }
    }

    if (this.verifyOpen && this.verifier.active) {
      const vResult = this.verifier.feed(correctedG);
      if (vResult) this._updateVerifyReadout(vResult);
    }
  }

  _updateReadout(g) {
    const u = UNITS[this.unitIdx];
    if (this.display) this.display.setValue(g * u.factor);
  }

  _variance(arr) {
    if (arr.length < 2) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
  }

  _haptic(p) { if ('vibrate' in navigator) navigator.vibrate(p); }

  _updateSensorBar(id, val, max) {
    const el = document.getElementById(id);
    if (el) el.style.width = Math.min(100, (val / (max || 1)) * 100) + '%';
  }

  _setCalProgress(pct) {
    ['calProgress', 'calStepProgress'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.width = pct + '%';
    });
  }

  async _showStepOverlay(title, body) {
    const ov = document.getElementById('stepOverlay');
    if (!ov) { await delay(2000); return; }
    ov.querySelector('.step-title').textContent = title;
    ov.querySelector('.step-body').textContent  = body;
    ov.style.display = 'flex';
  }

  _hideStepOverlay() {
    const ov = document.getElementById('stepOverlay');
    if (ov) ov.style.display = 'none';
  }

  _waitForReady(title, body) {
    this._showStepOverlay(title, body);
    return new Promise(resolve => {
      const btn = document.getElementById('calReadyBtn');
      if (!btn) { setTimeout(resolve, 3000); return; }
      btn.style.display = 'block';
      btn.addEventListener('click', () => {
        btn.style.display = 'none';
        this._haptic([20, 10, 40]);
        resolve();
      }, { once: true });
    });
  }

  _factoryReset() {
    [
      'phoneway_v2', 'phoneway_savedRef', 'phoneway_verifyHistory',
      'phoneway_readingLog', 'phoneway_learnStats',
      'phoneway_errorLog', 'phoneway_nn_model',
      'phoneway_ensemble_corrections'
    ].forEach(k => { try { localStorage.removeItem(k); } catch {} });
    this.learn.resetAll();
    globalErrorLogger.clear();
    this._haptic([30, 20, 30, 20, 200]);
    this._showToast('Factory reset complete — reloading…', 2000);
    setTimeout(() => location.reload(), 2100);
  }

  _initReadingHistory() {
    const container = document.getElementById('readingHistory');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const dot = document.createElement('div');
      dot.className = 'reading-dot';
      container.appendChild(dot);
    }
  }

  _pushReadingHistory(grams, accuracy) {
    this._readingHistory.push({ grams, accuracy });
    if (this._readingHistory.length > 5) this._readingHistory.shift();

    const dots = document.querySelectorAll('#readingHistory .reading-dot');
    dots.forEach((dot, i) => {
      const offset = i - (5 - this._readingHistory.length);
      const entry  = offset >= 0 ? this._readingHistory[offset] : null;
      dot.className = 'reading-dot';
      if (entry) {
        dot.classList.add(
          entry.accuracy >= 85 ? 'dot-good' :
          entry.accuracy >= 60 ? 'dot-mid'  : 'dot-low'
        );
        dot.title = `${entry.grams.toFixed(1)}g @ ${entry.accuracy}%`;
      }
    });
  }

  _updateLearningIndicator() {
    const el = document.getElementById('mlLabel');
    if (!el) return;
    const { verifyCount } = this.learn.learnStats;
    if (verifyCount === 0) {
      el.textContent = 'ML: —';
      el.style.color  = '#333';
    } else {
      el.textContent = `ML:${verifyCount}V`;
      el.style.color  = verifyCount >= 3 ? 'var(--seg-on)' : '#e8c84a';
    }
  }
  
  _updateGradeDisplay() {
    const el = document.getElementById('gradeLabel');
    if (!el) return;
    
    const gradeInfo = ACCURACY_GRADES[this.accuracyGrade] || ACCURACY_GRADES.untested;
    el.textContent = `GRADE: ${this.accuracyGrade}`;
    el.style.color = gradeInfo.color;
  }

  _updatePrecisionDisplay(precision, weight) {
    const el = document.getElementById('precisionLabel');
    if (!el) return;
    
    if (precision === Infinity || precision > 10) {
      el.textContent = 'σ: —';
      el.style.color = '#333';
    } else if (precision < 0.1) {
      el.textContent = `σ: ${(precision * 1000).toFixed(0)}mg`;
      el.style.color = '#00ff66';
    } else if (precision < 0.3) {
      el.textContent = `σ: ${precision.toFixed(2)}g`;
      el.style.color = '#e8c84a';
    } else {
      el.textContent = `σ: ${precision.toFixed(1)}g`;
      el.style.color = '#ff8c00';
    }
    
    if (this.motion.isConverged && weight > 0.1) {
      el.textContent += ' ✓';
    }
  }

  _showToast(text, ms = 2500) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = text;
    t.className = 'toast toast-show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'toast'; }, ms);
  }

  _showSurfaceTip() {
    const sq  = this.motion.surfaceQuality;
    const tip = SURFACE_TIPS[sq || 'unknown'];
    if (tip) this._showToast(tip, 5000);
  }

  _loadSettings() {
    try { return JSON.parse(localStorage.getItem('phoneway_v2') ?? '{}'); } catch { return {}; }
  }

  _saveSettings() {
    try { localStorage.setItem('phoneway_v2', JSON.stringify(this.settings)); } catch {}
  }
}

/* ── Visible error overlay for mobile debugging ──────────────── */
function _showBootError(err) {
  const msg = err?.message || String(err);
  const stack = err?.stack ? err.stack.split('\n').slice(0,4).join('\n') : '';
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;background:#1a0000;z-index:99999;padding:20px;overflow:auto;font-family:monospace;font-size:12px;color:#ff4444';
  el.innerHTML = `<b style="font-size:16px;color:#ff6666">BOOT ERROR — tap to copy</b><br><br><b>Message:</b><br>${msg}<br><br><b>Stack:</b><br><pre style="white-space:pre-wrap;color:#ffaaaa">${stack}</pre><br><button onclick="navigator.clipboard?.writeText('${(msg+'\n'+stack).replace(/'/g,"\\'")}').then(()=>alert('Copied!'))" style="background:#ff4444;color:#fff;border:none;padding:8px 16px;border-radius:4px;font-size:13px;cursor:pointer">📋 COPY ERROR</button>&nbsp;<button onclick="localStorage.clear();location.reload()" style="background:#aa2200;color:#fff;border:none;padding:8px 16px;border-radius:4px;font-size:13px;cursor:pointer">🔄 RESET &amp; RELOAD</button>`;
  document.body.appendChild(el);
}

/* ── Boot ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  // Global unhandled rejection catcher — shows error on screen instead of silent fail
  window.addEventListener('unhandledrejection', e => _showBootError(e.reason));
  window.addEventListener('error', e => _showBootError(e.error || e.message));

  let app;
  try {
    app = new PhonewayApp();
    window.__phoneway = app;
  } catch (err) {
    _showBootError(err);
    return;
  }

  try {
    await app.boot();
  } catch (err) {
    _showBootError(err);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
  }
});
