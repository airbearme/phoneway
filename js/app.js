/**
 * app.js — Phoneway Precision Scale — Main application
 *
 * Sensor stack (priority order):
 *  1. Generic Sensor API / LinearAccelerationSensor  (best, Android Chrome)
 *  2. DeviceMotionEvent accelerometer                (universal fallback)
 *  3. Vibration-hammer resonance                     (novel! vibrate + capture)
 *  4. Web Audio API microphone resonance             (FFT, 44100 Hz)
 *  5. Touch force / contact area                     (secondary)
 *  6. Magnetometer anomaly                           (metal objects only)
 *
 * Calibration with everyday objects:
 *  💵 US Dollar bill  = 1.00 g   (any denomination)
 *  🪙 US Penny        = 2.50 g
 *  🪙 US Dime         = 2.27 g
 *  🪙 US Nickel       = 5.00 g   ← recommended primary
 *  🪙 US Quarter      = 5.67 g
 *  🪙 US Dollar coin  = 8.10 g
 *  (+ more international coins)
 *
 * For maximum accuracy: use BOTH a nickel (5g) AND a dollar bill (1g)
 * — two calibration points give a least-squares fit through origin.
 */

'use strict';

import { BaselineRecorder, MotionSensor, TouchSensor, BayesianFusion }
  from './sensors.js';
import { AudioAnalyzer }         from './audio.js';
import { VibrationHammer }       from './vibrationHammer.js';
import { GenericSensorManager }  from './genericSensors.js';
import { SevenSegmentDisplay, StabilityBar, LED, AccuracyDisplay, delay } from './display.js';
import { REF_WEIGHTS, ReferenceWeightVerifier } from './referenceWeights.js';

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
  { label: 'Custom…',        grams: null,  icon: '⚖️', tip: 'Enter your own known weight in grams' },
];

const UNITS = [
  { key: 'g',   label: 'g',   factor: 1,         places: 1 },
  { key: 'oz',  label: 'oz',  factor: 0.035274,  places: 3 },
  { key: 'ct',  label: 'ct',  factor: 5.0,       places: 2 },
  { key: 'dwt', label: 'dwt', factor: 0.643015,  places: 3 },
];

const MODES  = ['FUSION', 'ACCEL', 'AUDIO', 'HAMMER', 'TOUCH'];

const SURFACE_TIPS = {
  poor:      '⚠ Hard surface — move to notebook or mouse-pad for best accuracy',
  ok:        '◑ Decent surface — mouse-pad would improve accuracy',
  good:      '✓ Good surface — readings will be accurate',
  excellent: '★ Excellent surface — maximum accuracy mode',
  unknown:   '○ Calibrate to assess surface quality',
};

/* ═══════════════════════════════════════════════════════════════
   PhonewayApp
═══════════════════════════════════════════════════════════════ */
class PhonewayApp {
  constructor() {
    this.state      = 'IDLE';
    this.unitIdx    = 0;
    this.modeIdx    = 0;
    this.held       = false;
    this.powered    = true;
    this.calWeightG = 5.0;    // default: nickel

    // Sensors
    this.motion    = new MotionSensor();
    this.touch     = new TouchSensor();
    this.audio     = new AudioAnalyzer();
    this.hammer    = new VibrationHammer();
    this.genSensor = new GenericSensorManager();
    this.baseline  = new BaselineRecorder(200);
    this.fusion    = new BayesianFusion();

    // Display refs
    this.display   = null;
    this.stabBar   = null;
    this.ledPower  = null;
    this.ledStable = null;
    this.ledAudio  = null;

    // Calibration
    this.calPhase  = 0;   // 0=not done, 1=first weight done, 2=complete
    this.firstCalG = 0;
    this.firstDeltaA = 0;

    // Measurement state
    this.currentG   = 0;
    this._stableBuf = [];
    this.STABLE_WIN = 30;
    this.STABLE_THR = 0.15;  // g variance below which = stable

    // Accuracy tracking
    this.accuracyDisplay = null;
    this._lastAccPct     = 0;

    // Reference weight verification
    this.verifier        = new ReferenceWeightVerifier();
    this.verifyOpen      = false;
    this._activeRefW     = null;
    this._lastVerifyPass = false;

    // Settings persistence
    this.settings = this._loadSettings();
  }

  /* ── Boot ─────────────────────────────────────────────────── */
  async boot() {
    this._bindUI();
    this._initDisplay();
    this._initSensorBars();

    // Boot accuracy display simultaneously with main display
    const accDigitEl = document.getElementById('accDigits');
    const accBarEl   = document.getElementById('accBar');
    if (accDigitEl && accBarEl) {
      this.accuracyDisplay = new AccuracyDisplay(accDigitEl, accBarEl);
    }

    await Promise.all([
      this.display.startup(),
      this.accuracyDisplay?.startup(),
    ]);
    this.ledPower.on('green');

    // Register all fusion sources with prior reliability weights
    this.fusion.register('accel',  1.0);   // primary
    this.fusion.register('hammer', 0.9);   // almost as good
    this.fusion.register('audio',  0.8);   // good when calibrated
    this.fusion.register('touch',  0.35);  // coarse
    this.fusion.register('mag',    0.3);   // metal objects only

    // Wire fusion callbacks
    this.motion.onWeight  = (g, c) => this._sensorUpdate('accel',  g, c);
    this.audio.onWeight   = (g, c) => this._sensorUpdate('audio',  g, c);
    this.touch.onWeight   = (g, c) => this._sensorUpdate('touch',  g, c);
    this.hammer.onWeight  = (g, c) => this._sensorUpdate('hammer', g, c);

    this.motion.onRaw     = (ax, ay, az) => {
      this.hammer.feedSample(ax, ay);  // vibration hammer needs raw accel
      this._updateSensorBar('accelBar', Math.sqrt(ax*ax + ay*ay), 0.2);
    };

    this.fusion.onFused = (g, c) => this._onFused(g, c);

    // Generic Sensor API (mag anomaly → fusion)
    this.genSensor.onMagAnomaly = (delta, conf) => {
      // Convert magnetic anomaly to rough mass estimate
      // ~1 µT per gram for ferromagnetic objects (very rough)
      const roughG = Math.abs(delta) * 0.8;
      this._sensorUpdate('mag', roughG, conf * 0.3);
    };

    this.genSensor.onLinAccel = (lax, lay) => {
      // Higher-quality linear acceleration from Generic Sensor API
      // Inject into motion sensor's pipeline (bypasses DeviceMotion baseline)
      const dA = Math.sqrt(lax * lax + lay * lay);
      if (this.motion.sensitivity) {
        const g = Math.max(0, dA * this.motion.sensitivity);
        this._sensorUpdate('accel', g, 0.85);  // higher confidence
      }
      this._updateSensorBar('accelBar', dA, 0.2);
    };

    this._setState('IDLE');

    // Handle URL params
    const params = new URLSearchParams(location.search);
    if (params.get('cal')) {
      this._showOnboard();
      return;
    }

    // Load persisted reference weight
    this.verifier.loadSaved();
    this.verifier.loadHistory();

    if (this.settings.calibrated) {
      this.motion.sensitivity = this.settings.motionSensitivity;
      this.motion.baseline    = this.settings.motionBaseline;
      this.hammer.baselineFreq = this.settings.hammerBaselineFreq;
      this.hammer.phoneMass    = this.settings.phoneMass || 170;
      this.audio.baselineFreq  = this.settings.audioBaselineFreq;
      this.audio.phoneMass     = this.settings.phoneMass || 170;
      await this._startAllSensors();
      this._setState('READY');
    } else {
      this._showOnboard();
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
    b('btnVerify',     () => this._openVerifyPanel());
    b('verifyClose',   () => this._closeVerifyPanel());
    b('verifyCloseBtn',() => this._closeVerifyPanel());
    b('verifyLockBtn', () => this._lockVerifyRef());

    // Touch pad for contact-pressure weighing
    const pad = document.getElementById('touchPad');
    if (pad) this.touch.start(pad);

    // Haptic feedback on all buttons
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
        // Show calibration-based baseline accuracy when at rest
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
    }
  }

  /* ── Sensor Start ─────────────────────────────────────────── */
  async _startAllSensors() {
    // Generic Sensor API first (best accuracy on Android)
    const avail = await this.genSensor.init(60).catch(() => ({}));
    if (avail.linAccel) {
      this._showToast('High-accuracy linear sensor active', 2500);
    }

    // DeviceMotion fallback (always try)
    try {
      await this.motion.request();
      this.motion.start();
    } catch {
      this._showToast('Motion access denied — accuracy reduced', 3500);
    }

    // Audio (mic)
    this.audio.onReady = () => {
      this.ledAudio.on('green');
      this._updateSensorBar('audioBar', 0.3, 1);
    };
    this.audio.onError = () => {
      this.ledAudio.off();
      this._showToast('Mic unavailable — audio mode disabled', 2500);
    };
    await this.audio.init().catch(() => {});
    if (this.audio.supported) this.audio.start();

    // Magnetometer
    await delay(200);
    this.genSensor.recordMagBaseline();

    // Update hammer sample rate from motion sensor
    this.hammer.setSampleRate(this.motion.sampleRateHz);
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
      this._startAllSensors().then(() => this._setState('READY'));
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
      if (i === 3) item.click(); // pre-select nickel
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
    }, { once: true });
  }

  /* ── Full calibration sequence ────────────────────────────── */
  async _runFullCalibration() {
    await this._startAllSensors();
    this._setState('CALIBRATING');

    // ─── Step 1: Zero baseline ───────────────────────────────
    await this._showStepOverlay(
      'STEP 1 OF 3 — ZERO',
      `Place phone face-up on a SOFT, FLAT surface:\n\n` +
      `   ✓ Mouse pad\n   ✓ Notebook / magazine\n   ✓ Folded cloth\n\n` +
      `Remove ALL objects from the phone.\nDo not touch or move it.\n\nHolding still…`
    );

    this._setCalProgress(0);
    this.baseline.reset();

    // ── Live progress + sensor-status label ───────────────────
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

    // Update UI every 250 ms while waiting
    const uiTimer = setInterval(() => {
      const n = Math.min(samplesReceived, 200);
      if (stepBody) stepBody.textContent = BASE_TEXT +
        `\n\n${n > 0 ? `Collecting: ${n} / 200 samples…` : 'Waiting for motion sensor…'}`;
      if (statusEl) statusEl.textContent =
        n > 0 ? `SENSOR: ACTIVE  ·  ${n}/200` : 'SENSOR: WAITING…';
      // Show skip button after 3 s with no data, or 5 s total
      if (skipBtn && !skipBtn._shown &&
          (samplesReceived === 0 && Date.now() - _t0 > 3000 ||
           Date.now() - _t0 > 5000)) {
        skipBtn.style.display = 'block';
        skipBtn._shown = true;
      }
    }, 250);

    const _t0 = Date.now();

    // Race: baseline complete  vs  skip button  vs  12 s timeout
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
      new Promise(res => setTimeout(() => res('timeout'), 12000)),
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
      // Use whatever raw reading we have, or safe zeros
      const fallback = samplesReceived > 0
        ? this.motion.raw
        : { ax: 0, ay: 0, az: 9.8 };
      this.motion.setBaseline(fallback);
      if (result === 'timeout') {
        this._showToast(
          samplesReceived === 0
            ? 'Motion sensor unavailable — using defaults (rough mode)'
            : 'Baseline short — using partial data',
          4000
        );
      }
    }
    this._setCalProgress(65);

    // Record hammer baseline while we're at it
    if (this.hammer.supported) {
      await this._showStepOverlay(
        'STEP 1b — VIBRATION CALIBRATION',
        `Stay still — phone will vibrate ${6} times to measure resonance.\n\nThis improves accuracy significantly.`
      );
      await this.hammer.calibrateBaseline(6, (i, n) => {
        this._setCalProgress(65 + (i / n) * 15);
      });
    }

    // Record audio baseline
    if (this.audio.supported) {
      await this._showStepOverlay(
        'STEP 1c — AUDIO BASELINE',
        `Playing calibration tone…\nKeep phone still and quiet.`
      );
      await this.audio.recordBaseline(true).catch(() => {});
    }

    this._setCalProgress(80);

    // ─── Step 2: First calibration weight ─────────────────────
    await this._showStepOverlay(
      'STEP 2 OF 3 — FIRST WEIGHT',
      `Gently place your calibration weight in the\nCENTER of the phone screen.\n\n` +
      `Selected: ${this.calWeightG.toFixed(2)} g\n\n` +
      `💵 Dollar bill = 1.00 g\n` +
      `🪙 Penny       = 2.50 g\n` +
      `🪙 Nickel      = 5.00 g\n\n` +
      `Hold PERFECTLY still for 4 seconds…`
    );

    const deltaA1 = await this._measureDeltaA(4000, pct => this._setCalProgress(80 + pct * 10));
    this.firstDeltaA = deltaA1;
    this.firstCalG   = this.calWeightG;
    this.motion.addCalPoint(this.calWeightG, deltaA1);
    this._setCalProgress(90);

    // ─── Step 3: Second calibration weight for accuracy ───────
    const secondOffer = await this._offerSecondWeight();
    if (secondOffer) {
      const secondW = secondOffer;
      await this._showStepOverlay(
        'STEP 3 OF 3 — SECOND WEIGHT',
        `Remove the first weight.\nPlace: ${secondW.label} (${secondW.grams.toFixed(2)} g)\n\nHold still for 4 seconds…`
      );
      const deltaA2 = await this._measureDeltaA(4000, pct => this._setCalProgress(90 + pct * 7));
      this.motion.addCalPoint(secondW.grams, deltaA2);
    }

    this._setCalProgress(98);

    // ─── Persist settings ─────────────────────────────────────
    this.settings.calibrated          = true;
    this.settings.motionSensitivity   = this.motion.sensitivity;
    this.settings.motionBaseline      = this.motion.baseline;
    this.settings.hammerBaselineFreq  = this.hammer.baselineFreq;
    this.settings.audioBaselineFreq   = this.audio.baselineFreq;
    this.settings.phoneMass           = this.hammer.phoneMass;
    this.settings.surfaceQuality      = this.motion.surfaceQuality;
    this._saveSettings();

    this._setCalProgress(100);

    const sq = this.motion.surfaceQuality;
    this._haptic([40, 20, 40, 20, 200]);
    await this._showStepOverlay(
      '✓ CALIBRATION COMPLETE',
      `Sensitivity: ${this.motion.sensitivity?.toFixed(1)} g/(m·s⁻²)\n` +
      `Surface: ${sq?.toUpperCase()}\n${SURFACE_TIPS[sq] || ''}\n\n` +
      (this.hammer.baselineFreq ? `Hammer baseline: ${this.hammer.baselineFreq.toFixed(2)} Hz\n` : '') +
      (this.audio.baselineFreq  ? `Audio baseline:  ${this.audio.baselineFreq.toFixed(1)} Hz\n` : '') +
      `\nYour scale is ready!`
    );

    await delay(2500);
    this._hideStepOverlay();
    this._setState('READY');
    this._showSurfaceTip();
  }

  async _measureDeltaA(durationMs, onProgress) {
    const samples = [];
    const step = 50;
    const steps = durationMs / step;
    for (let i = 0; i < steps; i++) {
      await delay(step);
      samples.push(this.motion.deltaA);
      onProgress?.(i / steps);
    }
    // Reject outliers (> 2σ from mean)
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const std  = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
    const clean = samples.filter(v => Math.abs(v - mean) < 2 * std);
    return clean.reduce((a, b) => a + b, 0) / (clean.length || 1);
  }

  async _offerSecondWeight() {
    return new Promise(res => {
      const used = this.calWeightG;
      // Suggest a complementary weight (different from first)
      const suggestions = CAL_WEIGHTS.filter(w =>
        w.grams !== null && Math.abs(w.grams - used) > 0.8 && w.grams < 10
      );
      const suggest = suggestions[0];
      if (!suggest) { res(null); return; }

      const el = document.createElement('div');
      el.className = 'second-cal-toast';
      el.innerHTML = `
        <p style="font-size:9px;letter-spacing:1px;color:#bbb;margin-bottom:8px">
          Add a 2nd weight for <strong style="color:#e8c84a">higher accuracy?</strong>
        </p>
        <p style="font-size:8px;color:#888;margin-bottom:10px">
          ${suggest.icon} ${suggest.label} (${suggest.grams.toFixed(2)} g)
        </p>
        <div style="display:flex;gap:8px">
          <button id="secYes" class="btn-sm">YES — MORE ACCURATE</button>
          <button id="secNo"  class="btn-sm" style="background:#222;color:#666;border:1px solid #333">SKIP</button>
        </div>`;
      document.body.appendChild(el);

      const cleanup = (v) => { el.remove(); res(v); };
      el.querySelector('#secYes').onclick = () => cleanup(suggest);
      el.querySelector('#secNo').onclick  = () => cleanup(null);
      setTimeout(() => cleanup(null), 12000);
    });
  }

  /* ── Vibration Hammer on-demand ───────────────────────────── */
  async _runHammerMeasure() {
    if (!this.hammer.supported || !this.hammer.baselineFreq) {
      this._showToast('Hammer not calibrated. Run CAL first.', 2500);
      return;
    }
    this._haptic([15, 10, 15]);
    this._showToast('Vibrating to measure — hold still…', 3000);
    this._updateSensorBar('hammerBar', 0.5, 0.5);
    const result = await this.hammer.measure(4);
    if (result) {
      this._sensorUpdate('hammer', result.grams, result.confidence);
      this._updateSensorBar('hammerBar', result.confidence, 1);
    }
  }

  /* ── Reference Weight Verify Panel ───────────────────────── */
  _openVerifyPanel() {
    if (!this.powered) return;
    this._haptic([8]);
    const panel = document.getElementById('verifyPanel');
    if (!panel) return;

    // Mark button active
    document.getElementById('btnVerify')?.classList.add('btn-active');

    // Sync saved grams into the REF_WEIGHTS array for the chip
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

    // Reset readout UI
    const stats   = document.getElementById('verifyStats');
    const accWrap = document.getElementById('vAccBarWrap');
    const tip     = document.getElementById('verifyTip');
    const lock    = document.getElementById('verifyLockBtn');
    if (stats)   stats.style.display   = 'none';
    if (accWrap) accWrap.style.display  = 'none';
    if (tip)     tip.style.display      = 'block';
    if (lock)    lock.style.display     = 'none';

    // Deselect chips
    document.querySelectorAll('.verify-chip').forEach(c => c.classList.remove('selected'));
  }

  _buildVerifyChips() {
    const container = document.getElementById('verifyChips');
    if (!container) return;
    container.innerHTML = '';

    const saved = this.verifier.savedGrams;

    REF_WEIGHTS.forEach(refW => {
      // Hide "Saved Reference" chip if no weight has been locked yet
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

    // Show stats + accuracy bar
    document.getElementById('verifyTip').style.display   = 'none';
    document.getElementById('verifyStats').style.display  = 'flex';
    document.getElementById('vAccBarWrap').style.display  = 'block';
    document.getElementById('verifyLockBtn').style.display = 'block';

    // Populate expected / tolerance
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

    // Haptic pulse on first PASS
    if (pass && !this._lastVerifyPass) this._haptic([20, 15, 60]);
    this._lastVerifyPass = pass;
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

    // Persist into saved chip
    const savedEntry = REF_WEIGHTS.find(r => r.isSaved);
    if (savedEntry) savedEntry.grams = g;

    // Rebuild chip list so saved chip appears / updates
    this._buildVerifyChips();

    const lockBtn = document.getElementById('verifyLockBtn');
    if (lockBtn) {
      lockBtn.textContent = '⭐ LOCKED!';
      setTimeout(() => { if (lockBtn) lockBtn.textContent = '⭐ LOCK AS REF'; }, 2000);
    }
  }

  /* ── Tare ─────────────────────────────────────────────────── */
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

  /* ── Hold / Power / Light ─────────────────────────────────── */
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
      this.genSensor.stop();
      this.display.setValue(null);
      this.ledStable.off();
      this.ledAudio.off();
      this.state = 'OFF';
      document.getElementById('statusText').textContent = 'OFF';
    }
    this._haptic([25]);
  }

  _toggleLight() {
    document.documentElement.classList.toggle('dim-mode');
    this._haptic([8]);
  }

  /* ── Cycles ───────────────────────────────────────────────── */
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
    const modeToSensor = { 1: 'accel', 2: 'audio', 3: 'hammer', 4: 'touch' };
    if (this.modeIdx === 0 || modeToSensor[this.modeIdx] === name) {
      this.fusion.update(name, g, conf);
    }

    // Update sensor bars
    const barMap = { accel: 'accelBar', audio: 'audioBar', touch: 'touchBar', hammer: 'hammerBar' };
    if (barMap[name]) this._updateSensorBar(barMap[name], conf, 1);
  }

  /* ── Fused output ─────────────────────────────────────────── */
  _onFused(g, conf) {
    if (!this.powered || this.held ||
        ['OFF','ZEROING','CALIBRATING'].includes(this.state)) return;

    this.currentG = g;
    this._updateReadout(g);

    // ── Stability detection (rolling variance) ─────────────────
    this._stableBuf.push(g);
    if (this._stableBuf.length > this.STABLE_WIN) this._stableBuf.shift();

    const variance = this._variance(this._stableBuf);
    const stabilityScore = 1 / (1 + variance * 120);   // 0–1
    const stable = variance < this.STABLE_THR ** 2 &&
                   this._stableBuf.length === this.STABLE_WIN;

    const stabPct = Math.min(100, stabilityScore * 100);
    this.stabBar.set(stabPct, stable);

    // ── Real-time accuracy % ───────────────────────────────────
    // Composite of:
    //   40% sensor fusion confidence (how much sensors agree)
    //   35% reading stability        (low variance = more accurate)
    //   15% calibration status       (calibrated vs guessed)
    //   10% surface quality          (softer surface = better deflection)
    const calScore = this.settings.calibrated ? 1.0 : 0.4;
    const surfMap  = { excellent: 1.0, good: 0.8, ok: 0.55, poor: 0.3, unknown: 0.5 };
    const surfScore = surfMap[this.settings.surfaceQuality ?? 'unknown'];

    const rawAccuracy =
      conf           * 0.40 +
      stabilityScore * 0.35 +
      calScore       * 0.15 +
      surfScore      * 0.10;

    // Clamp, round to nearest integer, update display
    const accPct = Math.min(100, Math.max(0, Math.round(rawAccuracy * 100)));

    if (this.accuracyDisplay) {
      this.accuracyDisplay.set(accPct);
    }
    this._lastAccPct = accPct;

    // Also update surface quality label in status bar
    const sq = this.settings.surfaceQuality;
    const surfEl = document.getElementById('surfaceLabel');
    if (surfEl && sq) surfEl.textContent = `SURFACE: ${sq.toUpperCase()}`;

    if (g > 0.1) {
      this._setState(stable ? 'STABLE' : 'MEASURING');
    } else {
      if (this.state !== 'READY') this._setState('READY');
      this._stableBuf = [];
      // Show accuracy even at rest (sensor health)
      if (this.accuracyDisplay) {
        const restPct = Math.round(calScore * 60 + surfScore * 20 + conf * 20);
        this.accuracyDisplay.set(Math.min(99, restPct));
      }
    }

    // Feed verifier if panel is open and a reference is selected
    if (this.verifyOpen && this.verifier.active) {
      const vResult = this.verifier.feed(g);
      if (vResult) this._updateVerifyReadout(vResult);
    }
  }

  _updateReadout(g) {
    const u = UNITS[this.unitIdx];
    this.display.setValue(g * u.factor);
  }

  _variance(arr) {
    if (arr.length < 2) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
  }

  /* ── Haptics ──────────────────────────────────────────────── */
  _haptic(p) { if ('vibrate' in navigator) navigator.vibrate(p); }

  /* ── UI helpers ───────────────────────────────────────────── */
  _updateSensorBar(id, val, max) {
    const el = document.getElementById(id);
    if (el) el.style.width = Math.min(100, (val / (max || 1)) * 100) + '%';
  }

  _setCalProgress(pct) {
    // Update both IDs — onboard modal + step overlay each have their own bar
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

  /* ── Persistence ──────────────────────────────────────────── */
  _loadSettings() {
    try { return JSON.parse(localStorage.getItem('phoneway_v2') ?? '{}'); } catch { return {}; }
  }

  _saveSettings() {
    try { localStorage.setItem('phoneway_v2', JSON.stringify(this.settings)); } catch {}
  }
}

/* ── Boot ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const app = new PhonewayApp();
  window.__phoneway = app;
  app.boot().catch(console.error);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
  }
});
