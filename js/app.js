/**
 * app.js — Main application for Phoneway Precision Scale
 *
 * State machine:
 *   IDLE → ONBOARD → ZEROING → CALIBRATING → READY → MEASURING → STABLE
 *   Any state → HOLD (frozen display)
 *
 * Calibration with everyday objects:
 *   US Dollar bill  = 1.00 g
 *   US Penny        = 2.50 g
 *   US Nickel       = 5.00 g
 *   US Dime         = 2.27 g
 *   US Quarter      = 5.67 g
 *   US Dollar coin  = 8.10 g
 */

'use strict';

import { BaselineRecorder, MotionSensor, TouchSensor, SensorFusion }
  from './sensors.js';
import { AudioAnalyzer }                    from './audio.js';
import { SevenSegmentDisplay, StabilityBar, LED, delay } from './display.js';

/* ─── Known calibration weights ──────────────────────────────── */
const CAL_WEIGHTS = [
  { label: 'US Dollar bill',  grams: 1.00, icon: '💵', tip: 'Any US paper bill (any denomination)' },
  { label: 'US Penny',        grams: 2.50, icon: '🪙', tip: 'Post-1982 Lincoln penny' },
  { label: 'US Dime',         grams: 2.27, icon: '🪙', tip: 'US 10-cent coin' },
  { label: 'US Nickel',       grams: 5.00, icon: '🪙', tip: 'US 5-cent coin (most common ref)' },
  { label: 'US Quarter',      grams: 5.67, icon: '🪙', tip: 'US 25-cent coin' },
  { label: 'US Dollar coin',  grams: 8.10, icon: '🪙', tip: 'Sacagawea / Presidential dollar' },
  { label: 'Euro (1€)',       grams: 7.50, icon: '🪙', tip: '1 euro coin' },
  { label: 'UK 10p',          grams: 6.50, icon: '🪙', tip: 'UK 10 pence coin' },
  { label: 'Canadian Loonie', grams: 7.00, icon: '🪙', tip: 'Canadian $1 coin' },
  { label: 'Custom…',         grams: null, icon: '⚖️', tip: 'Enter your own known weight' },
];

const UNITS = [
  { key: 'g',   label: 'g',   factor: 1 },
  { key: 'oz',  label: 'oz',  factor: 0.035274 },
  { key: 'ct',  label: 'ct',  factor: 5.0 },      // carats
  { key: 'dwt', label: 'dwt', factor: 0.643015 },  // pennyweight
];

const MODES = ['FUSION', 'ACCEL', 'AUDIO', 'TOUCH'];

/* ═══════════════════════════════════════════════════════════════
   PhonewayApp
═══════════════════════════════════════════════════════════════ */
class PhonewayApp {
  constructor() {
    this.state    = 'IDLE';
    this.unitIdx  = 0;
    this.modeIdx  = 0;
    this.held     = false;
    this.calWeightG = null;

    // Sensors
    this.motion   = new MotionSensor();
    this.touch    = new TouchSensor();
    this.audio    = new AudioAnalyzer();
    this.baseline = new BaselineRecorder(150);
    this.fusion   = new SensorFusion();

    // Display
    this.display  = null;
    this.stabBar  = null;
    this.ledPower = null;
    this.ledStable = null;

    // Calibration data (multi-point)
    this.calPoints = [];   // [{ deltaA, grams }, ...]

    // Settings
    this.settings = this._loadSettings();

    // Realtime weight state
    this.currentG = 0;
    this.stableCount = 0;
    this.STABLE_THRESHOLD = 0.3;   // g variance to declare stable
    this.STABLE_SAMPLES   = 25;

    this._stableBuf = [];
  }

  /* ── Bootstrap ─────────────────────────────────────────────── */
  async boot() {
    this._bindUI();
    this._initDisplay();
    await this.display.startup();
    this._setState('IDLE');

    // Register fusion sources
    this.fusion.register('accel', 1.0);
    this.fusion.register('audio', 0.8);
    this.fusion.register('touch', 0.4);

    this.fusion.onFused = (g, conf) => this._onFused(g, conf);

    // Wire up sensors → fusion
    this.motion.onWeight = (g, c) => {
      if (this.modeIdx === 0 || this.modeIdx === 1) // FUSION or ACCEL
        this.fusion.update('accel', g, c);
    };
    this.audio.onWeight = (g, c) => {
      if (this.modeIdx === 0 || this.modeIdx === 2) // FUSION or AUDIO
        this.fusion.update('audio', g, c);
    };
    this.touch.onWeight = (g, c) => {
      if (this.modeIdx === 0 || this.modeIdx === 3) // FUSION or TOUCH
        this.fusion.update('touch', g, c);
    };
    this.motion.onRaw = (ax, ay, az) => this._updateSensorUI(ax, ay, az);

    // Check if already calibrated
    if (this.settings.calibrated) {
      await this._showMessage('READY');
      this._setState('READY');
      this._startSensors();
    } else {
      this._showOnboard();
    }
  }

  /* ── UI Binding ─────────────────────────────────────────────── */
  _bindUI() {
    this._btn('btnTare',  () => this._tare());
    this._btn('btnMode',  () => this._cycleMode());
    this._btn('btnUnits', () => this._cycleUnits());
    this._btn('btnCal',   () => this._startCalibration());
    this._btn('btnHold',  () => this._toggleHold());
    this._btn('btnPower', () => this._togglePower());
    this._btn('btnLight', () => this._toggleBacklight());

    // Touch pad for touch-force weighing
    const pad = document.getElementById('touchPad');
    if (pad) this.touch.start(pad);

    // Haptic on all buttons
    document.querySelectorAll('.btn').forEach(b => {
      b.addEventListener('pointerdown', () => this._haptic([10]));
    });
  }

  _btn(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }

  _initDisplay() {
    const dispEl   = document.getElementById('digitDisplay');
    const stabEl   = document.getElementById('stabilityBar');
    const ledPwr   = document.getElementById('ledPower');
    const ledStb   = document.getElementById('ledStable');

    this.display   = new SevenSegmentDisplay(dispEl, 5, 1);
    this.stabBar   = new StabilityBar(stabEl);
    this.ledPower  = new LED(ledPwr);
    this.ledStable = new LED(ledStb);

    this.ledPower.on('green');
  }

  /* ── State Machine ──────────────────────────────────────────── */
  _setState(s) {
    this.state = s;
    document.getElementById('statusText').textContent = s;

    switch (s) {
      case 'READY':
        this.display.setValue(0);
        this.ledStable.on('green');
        break;
      case 'MEASURING':
        this.ledStable.on('orange');
        break;
      case 'STABLE':
        this.ledStable.on('green');
        this._haptic([30, 20, 30]);
        break;
      case 'ZEROING':
        this.display.showTare();
        this.ledStable.off();
        break;
      case 'CALIBRATING':
        this.display.showCalibrate();
        break;
      case 'HOLD':
        this.display.showHold();
        break;
    }
  }

  /* ── Sensor Start/Stop ─────────────────────────────────────── */
  async _startSensors() {
    try {
      await this.motion.request();
      this.motion.start();
    } catch (e) {
      this._showToast('Motion sensor denied — tap screen to enable', 4000);
    }

    try {
      await this.audio.init();
      this.audio.start();
    } catch (e) {
      this._showToast('Microphone not available — audio mode disabled', 3000);
    }

    // Restore calibration
    if (this.settings.calibrated) {
      this.motion.sensitivity = this.settings.motionSensitivity;
      this.motion.baseline    = this.settings.motionBaseline;
    }
  }

  /* ── Onboarding ─────────────────────────────────────────────── */
  _showOnboard() {
    const modal = document.getElementById('onboardModal');
    if (!modal) return;
    modal.style.display = 'flex';

    // Populate weight picker
    const list = modal.querySelector('.cal-weight-list');
    list.innerHTML = '';
    CAL_WEIGHTS.forEach((w, i) => {
      const item = document.createElement('div');
      item.className = 'cal-item';
      item.innerHTML = `
        <span class="cal-icon">${w.icon}</span>
        <div class="cal-info">
          <strong>${w.label}</strong>
          <small>${w.grams ? w.grams.toFixed(2) + ' g' : '?'} — ${w.tip}</small>
        </div>`;
      item.addEventListener('click', () => {
        list.querySelectorAll('.cal-item').forEach(e => e.classList.remove('selected'));
        item.classList.add('selected');
        if (w.grams) {
          this.calWeightG = w.grams;
          modal.querySelector('.custom-weight-row').style.display = 'none';
        } else {
          modal.querySelector('.custom-weight-row').style.display = 'flex';
        }
      });
      list.appendChild(item);
      // Pre-select nickel
      if (i === 3) item.click();
    });

    // Custom weight input
    const customInput = modal.querySelector('#customWeightInput');
    customInput?.addEventListener('input', () => {
      const v = parseFloat(customInput.value);
      if (!isNaN(v) && v > 0) this.calWeightG = v;
    });

    // Start calibration button in modal
    modal.querySelector('#startCalBtn')?.addEventListener('click', () => {
      modal.style.display = 'none';
      this._runCalibration();
    });

    // Skip (less accurate)
    modal.querySelector('#skipCalBtn')?.addEventListener('click', () => {
      modal.style.display = 'none';
      this.calWeightG = null;
      this.motion.sensitivity = 200; // rough default
      this._startSensors().then(() => this._setState('READY'));
    });
  }

  /* ── Calibration ────────────────────────────────────────────── */
  async _startCalibration() {
    if (this.state === 'IDLE') { this._showOnboard(); return; }
    this._showCalModal();
  }

  _showCalModal() {
    const overlay = document.getElementById('calOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      overlay.querySelector('#calConfirmBtn')?.addEventListener('click', () => {
        overlay.style.display = 'none';
        this._runCalibration();
      }, { once: true });
      overlay.querySelector('#calCancelBtn')?.addEventListener('click', () => {
        overlay.style.display = 'none';
      }, { once: true });
    }
  }

  async _runCalibration() {
    await this._startSensors();
    this._setState('ZEROING');

    // Step 1: Zero / baseline
    await this._showMessage('Place phone on a soft surface.\nRemove all objects.\nHold still…');

    const progressEl = document.getElementById('calProgress');
    const msgEl      = document.getElementById('calMessage');

    this.baseline.reset();
    this.baseline.onComplete = async (b) => {
      this.motion.setBaseline(b);
      await this._calibrateSpan();
    };

    // Poll progress
    const ticker = setInterval(() => {
      const p = this.baseline.progress * 100;
      if (progressEl) progressEl.style.width = p + '%';
    }, 50);

    // Feed baseline recorder from motion sensor
    const origOnRaw = this.motion.onRaw;
    this.motion.onRaw = (ax, ay, az) => {
      origOnRaw?.(ax, ay, az);
      this.baseline.feed(ax, ay, az);
    };

    // Wait until baseline complete
    await new Promise(res => {
      const check = setInterval(() => {
        if (this.baseline.done) { clearInterval(check); res(); }
      }, 100);
    });

    clearInterval(ticker);
    this.motion.onRaw = origOnRaw;
  }

  async _calibrateSpan() {
    this._setState('CALIBRATING');

    const weightG = this.calWeightG ?? 5.0;
    const msg = `Now place your calibration weight on the CENTER of the screen.\n\n` +
                `Selected: ${weightG.toFixed(2)} g\n\nHold steady…`;
    await this._showMessage(msg);

    await delay(3000); // wait for user to place weight

    // Sample deltaA for 3 seconds
    const samples = [];
    const dur = 3000;
    const t0  = Date.now();

    await new Promise(res => {
      const iv = setInterval(() => {
        samples.push(this.motion.deltaA);
        if (Date.now() - t0 >= dur) { clearInterval(iv); res(); }
      }, 50);
    });

    const avgDeltaA = samples.reduce((a, b) => a + b, 0) / samples.length;

    if (avgDeltaA < 0.0005) {
      this._showToast('Signal too weak — try a softer surface or heavier weight', 4000);
      this._setState('READY');
      return;
    }

    // Store calibration point
    this.calPoints.push({ deltaA: avgDeltaA, grams: weightG });
    this.motion.calibrate(weightG, avgDeltaA);

    // Multi-point: ask for second weight if possible
    if (this.calPoints.length < 2) {
      const wantSecond = await this._askSecondCalibration();
      if (wantSecond) {
        // Pick a different known weight
        await this._secondCalPoint();
      }
    }

    // Save settings
    this.settings.calibrated        = true;
    this.settings.motionSensitivity = this.motion.sensitivity;
    this.settings.motionBaseline    = this.motion.baseline;
    this._saveSettings();

    this._haptic([50, 40, 50, 40, 200]);
    await this._showMessage(`✓ Calibrated!\nSensitivity: ${this.motion.sensitivity?.toFixed(1)} g/(m/s²)`);
    await delay(1500);
    this._setState('READY');
  }

  async _askSecondCalibration() {
    return new Promise(res => {
      const toast = document.createElement('div');
      toast.className = 'second-cal-toast';
      toast.innerHTML = `
        <p>Add a second calibration point for better accuracy?</p>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button id="secCalYes" class="btn btn-sm">Yes</button>
          <button id="secCalNo"  class="btn btn-sm">Skip</button>
        </div>`;
      document.body.appendChild(toast);
      toast.querySelector('#secCalYes').onclick = () => { toast.remove(); res(true); };
      toast.querySelector('#secCalNo').onclick  = () => { toast.remove(); res(false); };
      setTimeout(() => { toast.remove(); res(false); }, 10000);
    });
  }

  async _secondCalPoint() {
    // Suggest complementary weight
    const usedG   = this.calPoints[0].grams;
    const suggest = CAL_WEIGHTS.find(w => w.grams && Math.abs(w.grams - usedG) > 1);
    const newG    = suggest?.grams ?? 2.5;

    await this._showMessage(
      `Remove previous weight.\nPlace: ${suggest?.label ?? 'another weight'} (${newG.toFixed(2)} g)\nHold steady…`
    );
    await delay(3000);

    const samples = [];
    await new Promise(res => {
      const iv = setInterval(() => {
        samples.push(this.motion.deltaA);
        if (samples.length >= 60) { clearInterval(iv); res(); }
      }, 50);
    });

    const avgDeltaA = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (avgDeltaA > 0.001) {
      this.calPoints.push({ deltaA: avgDeltaA, grams: newG });
      // Refit sensitivity using least squares through origin
      const num = this.calPoints.reduce((a, p) => a + p.grams * p.deltaA, 0);
      const den = this.calPoints.reduce((a, p) => a + p.deltaA * p.deltaA, 0);
      this.motion.sensitivity = num / den;
    }
  }

  /* ── Tare ───────────────────────────────────────────────────── */
  async _tare() {
    if (this.state === 'IDLE') return;
    this._haptic([20, 20, 100]);
    this._setState('ZEROING');
    this.display.showTare();
    await delay(800);
    this.fusion.setTare(this.currentG);
    this.motion.setBaseline(this.motion.raw);
    this._setState('READY');
    this.display.setValue(0);
    this._haptic([200]);
  }

  /* ── Hold ───────────────────────────────────────────────────── */
  _toggleHold() {
    this.held = !this.held;
    const btn = document.getElementById('btnHold');
    if (btn) btn.classList.toggle('btn-active', this.held);
    if (!this.held) this._setState('READY');
    this._haptic([15]);
  }

  /* ── Power ──────────────────────────────────────────────────── */
  _togglePower() {
    const off = this.state === 'OFF';
    if (off) {
      this.ledPower.on('green');
      this._setState('READY');
      this._startSensors();
    } else {
      this.motion.stop();
      this.audio.stop();
      this.display.setValue(null);
      this.ledPower.off();
      this.ledStable.off();
      this.state = 'OFF';
      document.getElementById('statusText').textContent = 'OFF';
    }
    this._haptic([30]);
  }

  /* ── Backlight ──────────────────────────────────────────────── */
  _toggleBacklight() {
    document.documentElement.classList.toggle('dim-mode');
    this._haptic([10]);
  }

  /* ── Units & Mode cycles ────────────────────────────────────── */
  _cycleUnits() {
    this.unitIdx = (this.unitIdx + 1) % UNITS.length;
    const u = UNITS[this.unitIdx];
    document.getElementById('unitLabel').textContent = u.label;
    this._haptic([15]);
    this._updateReadout(this.currentG);
  }

  _cycleMode() {
    this.modeIdx = (this.modeIdx + 1) % MODES.length;
    document.getElementById('modeLabel').textContent = MODES[this.modeIdx];
    this._haptic([15]);
    // Reset fusion confidence weights for new mode
    this.fusion.reset();
  }

  /* ── Measurement output ─────────────────────────────────────── */
  _onFused(g, conf) {
    if (this.held || this.state === 'OFF' || this.state === 'ZEROING' ||
        this.state === 'CALIBRATING') return;

    this.currentG = g;
    this._updateReadout(g);

    // Stability detection
    this._stableBuf.push(g);
    if (this._stableBuf.length > this.STABLE_SAMPLES) this._stableBuf.shift();

    const variance = this._variance(this._stableBuf);
    const pct      = Math.min(100, (1 / (1 + variance * 50)) * 100);
    const stable   = variance < this.STABLE_THRESHOLD * 0.1 &&
                     this._stableBuf.length === this.STABLE_SAMPLES;

    this.stabBar.set(pct, stable);

    if (g > 0.09) {
      this._setState(stable ? 'STABLE' : 'MEASURING');
    } else {
      this._setState('READY');
      this._stableBuf = [];
    }
  }

  _updateReadout(g) {
    const unit = UNITS[this.unitIdx];
    const converted = g * unit.factor;
    const negative  = converted < 0;
    this.display.setValue(converted, negative);
  }

  _variance(arr) {
    if (arr.length < 2) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
  }

  /* ── Sensor status UI ───────────────────────────────────────── */
  _updateSensorUI(ax, ay, az) {
    const accelBar = document.getElementById('accelBar');
    if (accelBar) {
      const mag = Math.sqrt(ax * ax + ay * ay) * 20; // scale for display
      accelBar.style.width = Math.min(100, mag * 100) + '%';
    }

    const confEl = document.getElementById('confLabel');
    if (confEl) {
      const c = Math.round(this.fusion.fusedConfidence * 100);
      confEl.textContent = `CONF: ${c}%`;
    }
  }

  /* ── Haptics ────────────────────────────────────────────────── */
  _haptic(pattern) {
    if ('vibrate' in navigator) navigator.vibrate(pattern);
  }

  /* ── Utility ────────────────────────────────────────────────── */
  async _showMessage(text) {
    const el = document.getElementById('messageOverlay');
    if (!el) return;
    el.innerHTML = `<div class="msg-box"><pre>${text}</pre></div>`;
    el.style.display = 'flex';
    await delay(2200);
    el.style.display = 'none';
  }

  _showToast(text, ms = 3000) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = text;
    t.className = 'toast toast-show';
    setTimeout(() => { t.className = 'toast'; }, ms);
  }

  /* ── Persistence ────────────────────────────────────────────── */
  _loadSettings() {
    try {
      return JSON.parse(localStorage.getItem('phoneway') ?? '{}');
    } catch { return {}; }
  }

  _saveSettings() {
    try { localStorage.setItem('phoneway', JSON.stringify(this.settings)); } catch {}
  }
}

/* ── Boot ──────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const app = new PhonewayApp();
  window.__phoneway = app;
  app.boot().catch(console.error);

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
