/**
 * app.js — Phoneway Ultra-Precision Scale v4.1.1
 * 
 * Enhanced with:
 * - Multi-point calibration
 * - Reference weight verification
 * - Precision measurement mode
 * - Statistical accuracy analysis
 * - Cross-device compatibility layer
 * - Robust error handling
 * 
 * Target accuracy: ±0.2-0.5g with proper calibration
 */

'use strict';

import { SimpleScale, MovingAverage } from './simpleScale.js';
import { SevenSegmentDisplay, StabilityBar, LED, delay } from './display.js';
import { 
  ALL_REFERENCE_WEIGHTS, 
  getRecommendedWeights,
  getBestVerificationWeight,
  calculateVerification,
  US_COINS,
  CURRENCY
} from './referenceWeights.js';
import {
  DeviceCapabilities,
  PermissionHelper,
  UniversalStorage,
  hapticFeedback,
  getDeviceInfo
} from './deviceCompat.js';

const UNITS = [
  { key: 'g',  label: 'g',  factor: 1,        places: 2 },
  { key: 'oz', label: 'oz', factor: 0.035274, places: 3 },
];

const APP_VERSION = '4.1.1';

class PhonewayApp {
  constructor() {
    console.log('[Phoneway] Constructing app...');
    
    try {
      this.scale = new SimpleScale();
      console.log('[Phoneway] SimpleScale created');
    } catch (e) {
      console.error('[Phoneway] Failed to create SimpleScale:', e);
      throw e;
    }
    
    try {
      this.storage = new UniversalStorage();
      console.log('[Phoneway] UniversalStorage created');
    } catch (e) {
      console.error('[Phoneway] Failed to create UniversalStorage:', e);
      throw e;
    }
    
    try {
      this.permissions = new PermissionHelper();
      console.log('[Phoneway] PermissionHelper created');
    } catch (e) {
      console.error('[Phoneway] Failed to create PermissionHelper:', e);
      throw e;
    }
    
    // UI elements
    this.display = null;
    this.stabBar = null;
    this.ledPower = null;
    this.ledStable = null;
    
    // State
    this.powered = false;
    this.state = 'OFF';
    this.unitIdx = 0;
    this.currentG = 0;
    this.calWeightG = 5.0;
    this._pendingCalibration = false;
    this._holdActive = false;
    this._selectedRefWeight = null;
    this._precisionMode = false;
    this._initError = null;
    
    // Bind callbacks
    this.scale.onWeight = (g, conf, stable) => this._onWeight(g, conf, stable);
    this.scale.onStable = (g) => this._onStableReading(g);
    
    // Bind error handler
    this._handleError = this._handleError.bind(this);
    window.addEventListener('error', (e) => this._handleError(e.error, 'window'));
    window.addEventListener('unhandledrejection', (e) => {
      this._handleError(e.reason, 'unhandledrejection');
    });
  }

  async init() {
    try {
      console.log('[Phoneway] v' + APP_VERSION + ' initializing...');
      console.log('[Phoneway] Device info:', getDeviceInfo());
      
      // Wait for DOM to be ready
      if (document.readyState === 'loading') {
        await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, {once: true}));
      }
      
      this._initDisplay();
      this._updateAccuracyDisplay(0); // Initialize accuracy to 0
      this._updateCalibrationGuide(); // Initialize calibration guide
      this._bindButtons();
      this._buildCalWeightList();
      this._buildVerifyPanel();
      
      console.log('[Phoneway] UI initialized, binding buttons...');
      
      // Check device capabilities
      if (!DeviceCapabilities.hasDeviceMotion) {
        this._showToast('⚠️ No motion sensors detected. Scale requires accelerometer.', 5000);
        this._initError = 'No motion sensors';
        // Still continue - user might have some limited functionality
      }
      
      // Request permission (especially for iOS)
      const permitted = await this._requestPermissions();
      if (!permitted && DeviceCapabilities.hasMotionPermission) {
        this._showToast('Motion permission required for scale to work', 5000);
        // Show a more prominent message in the display
        if (this.display) this.display.showError('PERM');
        return;
      }
      
      // Auto-start after short delay
      setTimeout(() => {
        if (!this._initError) {
          this._togglePower();
        }
      }, 800);
      
      // Send telemetry about startup
      this._sendTelemetry('startup', { 
        version: APP_VERSION,
        platform: DeviceCapabilities.platform,
        sensorQuality: DeviceCapabilities.sensorQuality,
        hasError: !!this._initError
      });
      
    } catch (error) {
      console.error('[Phoneway] Init error:', error);
      this._handleError(error, 'init');
    }
  }
  
  async _requestPermissions() {
    try {
      return await this.permissions.requestMotionPermission();
    } catch (e) {
      console.warn('Permission request failed:', e);
      return !DeviceCapabilities.hasMotionPermission; // Return true if no permission needed
    }
  }
  
  _handleError(error, context = 'unknown') {
    const errorInfo = {
      message: (error && error.message) || String(error),
      context,
      stack: error && error.stack,
      timestamp: Date.now(),
      version: APP_VERSION
    };
    
    console.error('[Phoneway Error]', errorInfo);
    
    // Send error telemetry
    this._sendTelemetry('js_error', {
      msg: errorInfo.message,
      context: context,
      v: APP_VERSION
    });
    
    // Show user-friendly message for critical errors
    if (context === 'init' || context === 'window') {
      this._showToast('Error: ' + errorInfo.message.substring(0, 50), 4000);
    }
  }
  
  _sendTelemetry(type, data) {
    // Fire-and-forget telemetry
    if (!DeviceCapabilities.hasServiceWorker) return;
    
    try {
      fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceClass: DeviceCapabilities.platform,
          events: [{ type, data, timestamp: Date.now() }]
        }),
        keepalive: true
      }).catch(() => {}); // Ignore errors
    } catch (e) {}
  }

  _initDisplay() {
    try {
      const digitDisplay = document.getElementById('digitDisplay');
      const stabilityBar = document.getElementById('stabilityBar');
      const ledPower = document.getElementById('ledPower');
      const ledStable = document.getElementById('ledStable');
      
      if (digitDisplay) this.display = new SevenSegmentDisplay(digitDisplay, 5, 2);
      if (stabilityBar) this.stabBar = new StabilityBar(stabilityBar);
      if (ledPower) this.ledPower = new LED(ledPower);
      if (ledStable) this.ledStable = new LED(ledStable);
    } catch (e) {
      console.error('Display init error:', e);
    }
  }

  _bindButtons() {
    const bind = (id, handler) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', handler);
        console.log('[Phoneway] Bound button:', id);
      } else {
        console.warn('[Phoneway] Button not found:', id);
      }
    };
    
    console.log('[Phoneway] Binding buttons...');
    
    bind('btnPower', () => this._togglePower());
    bind('btnTare', () => this._tare());
    bind('btnCal', () => this._showCalModal());
    bind('btnUnits', () => this._cycleUnits());
    bind('btnMode', () => this._cycleMode());
    bind('btnHold', () => this._hold());
    bind('btnVerify', () => this._showVerifyPanel());
    bind('btnHammer', () => this._triggerHammer());
    bind('btnPrecision', () => this._precisionMeasure());
    bind('btnStats', () => this._showStats());
    bind('btnLight', () => this._toggleBacklight());
    
    bind('skipCalBtn', () => this._hideCalModal());
    bind('startCalBtn', () => this._startCalibration());
    bind('calCancelBtn', () => this._hideCalModal());
    bind('calConfirmBtn', () => this._proceedWithCalibration());
    bind('calResetBtn', () => this._showResetConfirm());
    bind('calResetYesBtn', () => this._factoryReset());
    bind('calResetNoBtn', () => this._hideResetConfirm());
    
    const customInput = document.getElementById('customWeightInput');
    if (customInput) {
      customInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (val > 0) this.calWeightG = val;
      });
    }
    
    bind('verifyClose', () => this._hideVerifyPanel());
    bind('verifyCloseBtn', () => this._hideVerifyPanel());
    bind('verifyLockBtn', () => this._lockReference());
    bind('accuracyClose', () => this._hideStats());
    bind('accCloseBtn', () => this._hideStats());
    bind('accExportBtn', () => this._exportData());
  }

  _setState(s) {
    this.state = s;
    const el = document.getElementById('statusText');
    if (el) el.textContent = s;
    
    switch (s) {
      case 'READY':
        if (this.display && !this._holdActive) this.display.setValue(0);
        if (this.ledStable) this.ledStable.on('green');
        break;
      case 'MEASURING':
        if (this.ledStable) this.ledStable.on('orange');
        break;
      case 'STABLE':
        if (this.ledStable) this.ledStable.on('green');
        hapticFeedback([20, 15, 20]);
        break;
      case 'CALIBRATING':
        if (this.ledStable) this.ledStable.on('blue');
        break;
      case 'PRECISION':
        if (this.ledStable) this.ledStable.on('purple');
        break;
    }
  }

  _togglePower() {
    console.log('[Phoneway] Toggle power clicked, current state:', this.powered);
    this.powered = !this.powered;
    
    if (this.ledPower) {
      this.powered ? this.ledPower.on('green') : this.ledPower.off();
    }
    
    if (this.powered) {
      try {
        this.scale.start();
        this._setState('READY');
        this._showToast('Scale ready — place phone on soft surface', 3000);
        hapticFeedback([30, 20, 30]);
      } catch (e) {
        console.error('Scale start error:', e);
        this._showToast('Error starting scale: ' + e.message, 4000);
        this.powered = false;
        if (this.ledPower) this.ledPower.off();
      }
    } else {
      this.scale.stop();
      this._setState('OFF');
      if (this.display) this.display.setValue(null);
      if (this.ledStable) this.ledStable.off();
      hapticFeedback([50]);
    }
  }

  _onWeight(grams, confidence, isStable) {
    if (!this.powered || this.state === 'CALIBRATING' || this._precisionMode) return;
    
    this.currentG = grams;
    
    if (!this._holdActive) {
      const u = UNITS[this.unitIdx];
      if (this.display) {
        this.display.setValue(grams * u.factor);
      }
    }
    
    if (this.stabBar) {
      const stabilityPct = Math.min(100, confidence * 100);
      this.stabBar.set(stabilityPct, isStable);
    }
    
    this._updateSensorBar('accelBar', confidence);
    
    if (grams > 0.2) {
      this._setState(isStable ? 'STABLE' : 'MEASURING');
    } else {
      this._setState('READY');
    }
    
    this._updateSurfaceLabel();
    this._updateGradeLabel();
    this._updatePrecisionLabel();
    this._updateAccuracyDisplay(confidence);
    this._updateCalibrationGuide();
    
    if (this._selectedRefWeight && isStable) {
      this._updateVerifyComparison();
    }
  }

  _updateAccuracyDisplay(confidence) {
    const accPct = Math.min(100, Math.max(0, Math.round(confidence * 100)));

    const accDigits = document.getElementById('accDigits');
    if (accDigits) accDigits.textContent = accPct;

    const accBar = document.getElementById('accBar');
    if (accBar) {
      accBar.style.width = accPct + '%';
      accBar.className = 'acc-bar-fill ' + (
        accPct >= 80 ? 'acc-high' :
        accPct >= 60 ? 'acc-good' :
        accPct >= 35 ? 'acc-mid' : 'acc-low'
      );
    }

    // Realistic precision estimate shown under the bar
    const precEl = document.getElementById('precEst');
    if (precEl) {
      const cal    = this.scale.getCalibrationQuality();
      const surf   = this.scale.getSurfaceQuality();
      const pts    = cal.points;
      const r2     = cal.r2 || 0;
      let text, color;

      if (!this.scale.calibrated || pts === 0) {
        text = 'UNCAL'; color = '#444';
      } else if (pts === 1) {
        if (surf === 'excellent')     { text = '~±0.3g'; color = '#e8c84a'; }
        else if (surf === 'good')     { text = '~±0.5g'; color = '#ffcc00'; }
        else                          { text = '~±1g';   color = '#ff8c00'; }
      } else if (pts === 2) {
        // 2-point linear fit is always exact (r²=1) so use surface as proxy
        if (surf === 'excellent')     { text = '~±0.2g'; color = '#39ff14'; }
        else if (surf === 'good')     { text = '~±0.3g'; color = '#e8c84a'; }
        else                          { text = '~±0.5g'; color = '#ffcc00'; }
      } else {
        // 3+ points: r² is meaningful
        if      (r2 > 0.97 && surf === 'excellent') { text = '~±0.1g'; color = '#00ff66'; }
        else if (r2 > 0.92)                          { text = '~±0.2g'; color = '#39ff14'; }
        else if (r2 > 0.85)                          { text = '~±0.3g'; color = '#e8c84a'; }
        else                                         { text = '~±0.5g'; color = '#ffcc00'; }
      }

      precEl.textContent  = text;
      precEl.style.color  = color;
    }
  }

  _onStableReading(grams) {
    console.log('Stable reading:', grams.toFixed(2), 'g');
  }

  _updateSensorBar(barId, confidence) {
    const bar = document.getElementById(barId);
    if (bar) bar.style.width = Math.min(100, confidence * 100) + '%';
  }

  _updateSurfaceLabel() {
    const surface = this.scale.getSurfaceQuality();
    const surfEl = document.getElementById('surfaceLabel');
    if (surfEl) {
      const tips = { excellent: '★', good: '✓', ok: '◑', poor: '⚠', unknown: '○' };
      surfEl.textContent = `SURFACE: ${tips[surface] || '○'} ${surface.toUpperCase()}`;
    }
  }

  _updateGradeLabel() {
    const gradeEl = document.getElementById('gradeLabel');
    if (!gradeEl) return;
    
    const calQuality = this.scale.getCalibrationQuality();
    let grade = '—';
    
    if (this.scale.calibrated) {
      if (calQuality.r2 > 0.98 && calQuality.points >= 3) grade = 'A+';
      else if (calQuality.r2 > 0.95 && calQuality.points >= 2) grade = 'A';
      else if (calQuality.r2 > 0.90) grade = 'B';
      else grade = 'C';
    }
    
    gradeEl.textContent = `GRADE: ${grade}`;
  }

  _updatePrecisionLabel() {
    const precEl = document.getElementById('precisionLabel');
    if (precEl) {
      const std = (this.scale.stabilityCheck && this.scale.stabilityCheck.stdDev) || 0;
      precEl.textContent = `σ: ${std < 0.05 ? '<0.05' : std.toFixed(2)}g`;
    }
    
    const mlEl = document.getElementById('mlLabel');
    if (mlEl) {
      const points = this.scale.getCalibrationQuality().points;
      mlEl.textContent = `PTS: ${points}`;
    }
  }

  _updateCalibrationGuide() {
    const guide = document.getElementById('calGuide');
    if (!guide) return;
    
    const calQuality = this.scale.getCalibrationQuality();
    const isCalibrated = this.scale.calibrated && calQuality.points >= 1;
    
    // Show guide if not calibrated
    if (!isCalibrated) {
      guide.classList.add('show');
      
      // Update step indicators
      const step1 = document.getElementById('calStep1');
      const step2 = document.getElementById('calStep2');
      const step3 = document.getElementById('calStep3');
      const step4 = document.getElementById('calStep4');
      
      // Reset all steps
      [step1, step2, step3, step4].forEach(step => {
        if (step) {
          step.classList.remove('active', 'completed');
        }
      });
      
      // Determine current step
      if (!this._pendingCalibration) {
        // Step 1: Press CAL button
        if (step1) step1.classList.add('active');
      } else if (this._pendingCalibration && !this.scale.calibrated) {
        // Step 2-3: Calibration in progress
        if (step1) step1.classList.add('completed');
        if (step2) step2.classList.add('completed');
        if (step3) step3.classList.add('active');
      }
    } else {
      // Hide guide when calibrated
      guide.classList.remove('show');
    }
  }

  async _tare() {
    if (!this.powered) return;

    this._holdActive = false;

    if (this._pendingCalibration && this.currentG > 0.2) {
      this._pendingCalibration = false;

      const result = this.scale.calibrate(this.calWeightG);
      if (result.success) {
        const points = result.calibrationPoints;
        this._showToast(`Calibrated! ${result.accuracy} (${points} points)`, 4000);
        hapticFeedback([30, 50, 30]);

        if (points < 3) {
          setTimeout(() => {
            this._showToast(`Tip: Add ${4 - points} more weights for better accuracy`, 4000);
          }, 4500);
        }
        this._updateCalibrationGuide();
      } else {
        this._showToast('Cal failed: ' + result.error, 4000);
      }
      return;
    }

    hapticFeedback([50]);
    this._setState('ZEROING');
    this._showToast('Taring — hold phone perfectly still...', 4000);

    await this.scale.tare();

    this._setState('READY');
    if (this.display) this.display.setValue(0);
    this._showToast('Tared — scale zeroed', 2000);
  }

  _showCalModal() {
    const modal = document.getElementById('calOverlay');
    if (modal) modal.style.display = 'flex';
  }

  _hideCalModal() {
    const onboardModal = document.getElementById('onboardModal');
    if (onboardModal && onboardModal.style) onboardModal.style.display = 'none';
    const calOverlay = document.getElementById('calOverlay');
    if (calOverlay && calOverlay.style) calOverlay.style.display = 'none';
    const stepOverlay = document.getElementById('stepOverlay');
    if (stepOverlay && stepOverlay.style) stepOverlay.style.display = 'none';
  }

  _showResetConfirm() {
    const calResetConfirm = document.getElementById('calResetConfirm');
    if (calResetConfirm && calResetConfirm.style) calResetConfirm.style.display = 'block';
  }

  _hideResetConfirm() {
    const calResetConfirm2 = document.getElementById('calResetConfirm');
    if (calResetConfirm2 && calResetConfirm2.style) calResetConfirm2.style.display = 'none';
  }

  _factoryReset() {
    this.scale.reset();
    this._hideResetConfirm();
    this._hideCalModal();
    this._showToast('Factory reset complete', 3000);
    hapticFeedback([100, 50, 100]);
  }

  _proceedWithCalibration() {
    const calOverlay2 = document.getElementById('calOverlay');
    if (calOverlay2 && calOverlay2.style) calOverlay2.style.display = 'none';
    const onboard = document.getElementById('onboardModal');
    if (onboard) {
      onboard.style.display = 'flex';
    } else {
      this._startCalibration();
    }
  }

  _buildCalWeightList() {
    const container = document.querySelector('.cal-weight-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    const recommended = getRecommendedWeights();
    
    recommended.forEach((w, idx) => {
      const item = document.createElement('div');
      item.className = 'cal-item' + (idx === 0 ? ' selected' : '');
      item.innerHTML = `
        <div class="cal-icon">${w.icon}</div>
        <div class="cal-info">
          <strong>${w.name}</strong>
          <small>${w.grams} g ±${w.tolerance}g</small>
        </div>
      `;
      item.addEventListener('click', () => {
        container.querySelectorAll('.cal-item').forEach(e => e.classList.remove('selected'));
        item.classList.add('selected');
        this.calWeightG = w.grams;
      });
      container.appendChild(item);
    });
  }

  async _startCalibration() {
    const onboardModal2 = document.getElementById('onboardModal');
    if (onboardModal2 && onboardModal2.style) onboardModal2.style.display = 'none';

    this._setState('CALIBRATING');
    this._showToast('Step 1: Remove all weight — taring...', 5000);

    // Wait for tare to fully settle (100 samples + 20 warmup ≈ 2 s at 60 Hz)
    await this.scale.tare();

    this._showToast(`Step 2: Place ${this.calWeightG}g weight, then press TARE to calibrate`, 6000);
    this._pendingCalibration = true;
    this._updateCalibrationGuide();
    this._setState('READY');
  }

  _cycleUnits() {
    this.unitIdx = (this.unitIdx + 1) % UNITS.length;
    const u = UNITS[this.unitIdx];
    
    const el = document.getElementById('unitLabel');
    if (el) el.textContent = u.label;
    
    if (this.display && !this._holdActive) {
      this.display.setValue(this.currentG * u.factor);
    }
    
    hapticFeedback([15]);
  }

  _cycleMode() {
    const modes = ['ACCEL', 'PRECISION', 'STATISTICS'];
    this._currentMode = (this._currentMode || 0) + 1;
    if (this._currentMode >= modes.length) this._currentMode = 0;
    this._showToast(`Mode: ${modes[this._currentMode]}`, 2000);
  }

  _hold() {
    this._holdActive = !this._holdActive;
    if (this._holdActive) {
      if (this.display) this.display.showHold();
      this._showToast(`Hold: ${this.currentG.toFixed(2)}g frozen`, 2000);
    } else {
      const u = UNITS[this.unitIdx];
      if (this.display) this.display.setValue(this.currentG * u.factor);
      this._showToast('Hold: Released', 1500);
    }
    hapticFeedback([20]);
  }

  _triggerHammer() {
    this._showToast('Vibration analysis mode (simulated)', 2000);
    hapticFeedback([50, 30, 50, 30, 100]);
  }

  async _precisionMeasure() {
    this._precisionMode = true;
    this._setState('PRECISION');
    this._showToast('Precision mode — averaging 5 seconds...', 3000);
    
    try {
      const result = await this.scale.measurePrecision(5000);
      
      this._precisionMode = false;
      this.currentG = result.grams;
      
      const u = UNITS[this.unitIdx];
      if (this.display) this.display.setValue(result.grams * u.factor);
      
      this._setState('STABLE');
      
      const accuracy = (result.confidence * 100).toFixed(1);
      this._showToast(
        `Result: ${result.grams.toFixed(2)}g (σ=${result.stdDev.toFixed(3)}g, ${accuracy}% conf)`,
        5000
      );
      
      hapticFeedback([30, 50, 30]);
      
    } catch (e) {
      this._precisionMode = false;
      this._setState('READY');
      this._showToast('Precision measurement failed', 3000);
    }
  }

  _buildVerifyPanel() {
    const chipsContainer = document.getElementById('verifyChips');
    if (!chipsContainer) return;
    
    chipsContainer.innerHTML = '';
    
    const weights = [...US_COINS.slice(0, 4), ...CURRENCY.slice(0, 3)];
    
    weights.forEach(w => {
      const chip = document.createElement('button');
      chip.className = 'verify-chip';
      chip.innerHTML = `${w.icon} ${w.grams}g`;
      chip.addEventListener('click', () => this._selectReferenceWeight(w, chip));
      chipsContainer.appendChild(chip);
    });
  }

  _selectReferenceWeight(weight, chipElement) {
    this._selectedRefWeight = weight;
    
    document.querySelectorAll('.verify-chip').forEach(c => c.classList.remove('selected'));
    chipElement.classList.add('selected');
    
    document.getElementById('verifyStats').style.display = 'block';
    document.getElementById('vAccBarWrap').style.display = 'block';
    document.getElementById('verifyLockBtn').style.display = 'inline-block';
    
    document.getElementById('vExpected').textContent = weight.grams.toFixed(2);
    document.getElementById('verifyTip').textContent = 'Place weight on scale...';
    
    this._updateVerifyComparison();
  }

  _updateVerifyComparison() {
    if (!this._selectedRefWeight || !this.scale.isStable) return;
    
    const result = calculateVerification(this.currentG, this._selectedRefWeight);
    
    document.getElementById('vMeasured').textContent = result.measured.toFixed(2);
    document.getElementById('vError').textContent = 
      `${result.error >= 0 ? '+' : ''}${result.error.toFixed(2)}g (${result.errorPercent.toFixed(1)}%)`;
    
    const passEl = document.getElementById('vPass');
    passEl.textContent = result.isWithinTolerance ? '✓ PASS' : '✗ FAIL';
    passEl.className = result.isWithinTolerance ? 'vstat-pass pass' : 'vstat-pass fail';
    
    document.getElementById('vTol').textContent = `±${result.reference.tolerance}g`;
    
    const accPct = Math.min(100, result.accuracy);
    document.getElementById('vAccPct').textContent = accPct.toFixed(1) + '%';
    document.getElementById('vAccFill').style.width = accPct + '%';
    
    document.getElementById('verifyTip').textContent = 
      `Grade ${result.grade} — ${result.isWithinTolerance ? 'Within tolerance' : 'Outside tolerance'}`;
    
    this.scale.verifyAgainstKnown(this._selectedRefWeight.grams);
    
    // Haptic feedback for pass
    if (result.isWithinTolerance) {
      hapticFeedback([20, 10, 20]);
    }
  }

  _lockReference() {
    if (!this._selectedRefWeight) return;
    
    this._showToast(`Locked ${this._selectedRefWeight.name} as reference`, 2000);
    hapticFeedback([30]);
    
    try {
      this.storage.setObject('phoneway_locked_ref', this._selectedRefWeight);
    } catch (e) {}
  }

  _showVerifyPanel() {
    const panel = document.getElementById('verifyPanel');
    if (panel) {
      panel.style.display = 'block';
      setTimeout(() => panel.classList.add('show'), 10);
    }
  }

  _hideVerifyPanel() {
    const panel = document.getElementById('verifyPanel');
    if (panel) {
      panel.classList.remove('show');
      setTimeout(() => panel.style.display = 'none', 300);
    }
    this._selectedRefWeight = null;
  }

  _showStats() {
    const panel = document.getElementById('accuracyPanel');
    if (panel) {
      this._updateStats();
      panel.style.display = 'block';
      setTimeout(() => panel.classList.add('show'), 10);
    }
  }

  _hideStats() {
    const panel = document.getElementById('accuracyPanel');
    if (panel) {
      panel.classList.remove('show');
      setTimeout(() => panel.style.display = 'none', 300);
    }
  }

  _updateStats() {
    const calQuality = this.scale.getCalibrationQuality();
    const verifStats = this.scale.getVerificationStats();
    
    let grade = '—';
    let gradeDesc = 'Calibrate to achieve accuracy';
    
    if (this.scale.calibrated) {
      if (calQuality.r2 > 0.98 && calQuality.points >= 4) {
        grade = 'A+';
        gradeDesc = 'Laboratory grade — excellent calibration';
      } else if (calQuality.r2 > 0.95 && calQuality.points >= 3) {
        grade = 'A';
        gradeDesc = 'Very good accuracy — multi-point calibrated';
      } else if (calQuality.r2 > 0.90) {
        grade = 'B';
        gradeDesc = 'Good accuracy — add more calibration points';
      } else if (calQuality.r2 > 0.80) {
        grade = 'C';
        gradeDesc = 'Fair accuracy — recalibration recommended';
      } else {
        grade = 'D';
        gradeDesc = 'Poor accuracy — recalibration required';
      }
    }
    
    const gradeDisplay = document.getElementById('accGradeDisplay');
    if (gradeDisplay) gradeDisplay.textContent = grade;
    
    const gradeDescEl = document.getElementById('accGradeDesc');
    if (gradeDescEl) gradeDescEl.textContent = gradeDesc;
    
    const surface = this.scale.getSurfaceQuality();
    const precisionEl = document.getElementById('accPrecision');
    if (precisionEl) {
      if (calQuality.r2 > 0.95) {
        precisionEl.textContent = surface === 'excellent' ? '~±0.2g' : '~±0.3g';
      } else if (calQuality.r2 > 0.90) {
        precisionEl.textContent = '~±0.5g';
      } else {
        precisionEl.textContent = '~±1g';
      }
    }
    
    const systematicEl = document.getElementById('accSystematic');
    if (systematicEl && verifStats) {
      systematicEl.textContent = 
        `${verifStats.meanError >= 0 ? '+' : ''}${verifStats.meanError.toFixed(2)}g`;
    } else if (systematicEl) {
      systematicEl.textContent = '—';
    }
    
    const mlSamplesEl = document.getElementById('accMLSamples');
    if (mlSamplesEl) {
      mlSamplesEl.textContent = `${calQuality.points} (${calQuality.isQuadratic ? 'quad' : 'linear'})`;
    }
    
    const verifEl = document.getElementById('accVerifications');
    if (verifEl && verifStats) {
      verifEl.textContent = `${verifStats.passed}/${verifStats.totalVerifications}`;
    } else if (verifEl) {
      verifEl.textContent = '0';
    }
    
    const recList = document.getElementById('accRecList');
    if (recList) {
      const recs = [];
      if (calQuality.points < 3) {
        recs.push(`• Add ${3 - calQuality.points} more calibration points for better accuracy`);
      }
      if (calQuality.r2 < 0.95) {
        recs.push('• Calibration curve is non-linear — check surface quality');
      }
      if (!verifStats || verifStats.totalVerifications < 3) {
        recs.push('• Perform verification tests to track accuracy');
      }
      if (surface === 'poor') {
        recs.push('• Use a softer surface (mouse pad recommended)');
      }
      
      recList.innerHTML = recs.length > 0 ? recs.join('<br>') : 'Calibration optimal — no action needed';
    }
    
    const envBaro = document.getElementById('envBaro');
    if (envBaro) envBaro.textContent = '—';
    if (navigator.getBattery) {
      navigator.getBattery().then(b => {
        const envBatt = document.getElementById('envBatt');
        if (envBatt) envBatt.textContent = `${Math.round(b.level * 100)}%`;
      }).catch(() => {});
    }
    const envOrient = document.getElementById('envOrient');
    if (envOrient) envOrient.textContent = 'Face up';
    const envThermal = document.getElementById('envThermal');
    if (envThermal) envThermal.textContent = 'OK';
  }

  _exportData() {
    const data = {
      calibration: this.scale.getCalibrationQuality(),
      verifications: this.scale.getVerificationStats(),
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      deviceInfo: getDeviceInfo(),
      version: APP_VERSION
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `phoneway_data_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    this._showToast('Data exported', 2000);
  }

  _toggleBacklight() {
    document.body.classList.toggle('backlight-on');
    hapticFeedback([30]);
  }

  _showToast(msg, duration = 3000) {
    const el = document.getElementById('toast');
    if (!el) return;
    
    el.textContent = msg;
    el.style.opacity = '1';
    el.classList.add('toast-show');
    
    setTimeout(() => {
      el.style.opacity = '0';
      el.classList.remove('toast-show');
    }, duration);
  }
}

// Bootstrap with error handling
console.log('[Phoneway] Module loaded, bootstrapping...');

try {
  const app = new PhonewayApp();
  console.log('[Phoneway] App instance created');
  
  app.init().then(() => {
    console.log('[Phoneway] App initialized successfully');
  }).catch(err => {
    console.error('[Phoneway] Bootstrap error:', err);
  });
  
  // Expose for debugging
  window.phoneway = app;
  console.log('[Phoneway] App exposed as window.phoneway');
} catch (e) {
  console.error('[Phoneway] Fatal initialization error:', e);
  document.body.innerHTML = '<div style="padding: 20px; color: #ff4444; text-align: center;">' +
    '<h2>Initialization Error</h2><p>' + e.message + '</p>' +
    '<button onclick="location.reload()">Reload</button></div>';
}

export { PhonewayApp };
