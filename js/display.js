/**
 * display.js — 7-segment display renderer for Phoneway
 *
 * Creates authentic-looking digital scale readouts using
 * CSS-positioned segment divs with neon green glow effects.
 *
 * Segment layout (per digit):
 *
 *    ┌─ a ─┐
 *    f     b
 *    ├─ g ─┤
 *    e     c
 *    └─ d ─┘
 */

'use strict';

// [a, b, c, d, e, f, g]  — 1 = on, 0 = off
const SEG = {
  '0': [1,1,1,1,1,1,0],
  '1': [0,1,1,0,0,0,0],
  '2': [1,1,0,1,1,0,1],
  '3': [1,1,1,1,0,0,1],
  '4': [0,1,1,0,0,1,1],
  '5': [1,0,1,1,0,1,1],
  '6': [1,0,1,1,1,1,1],
  '7': [1,1,1,0,0,0,0],
  '8': [1,1,1,1,1,1,1],
  '9': [1,1,1,1,0,1,1],
  '-': [0,0,0,0,0,0,1],
  'E': [1,0,0,1,1,1,1],
  'r': [0,0,0,0,1,0,1],
  'L': [0,0,0,1,1,1,0],
  'o': [0,0,1,1,1,0,1],
  'n': [0,0,1,0,1,0,1],
  ' ': [0,0,0,0,0,0,0],
  '_': [0,0,0,1,0,0,0],
};

const NAMES = ['a','b','c','d','e','f','g'];

/* ═══════════════════════════════════════════════════════════════
   SevenSegmentDisplay
═══════════════════════════════════════════════════════════════ */
class SevenSegmentDisplay {
  /**
   * @param {HTMLElement} container  — target element to build into
   * @param {number}      digits     — total integer+decimal digit count
   * @param {number}      decimals   — decimal places (decimal point after digit[digits-decimals-1])
   */
  constructor(container, digits = 4, decimals = 1) {
    this.container = container;
    this.digits    = digits;
    this.decimals  = decimals;
    this._els      = [];   // Array of { segs: {a-g: el}, dot: el }
    this._current  = Array(digits).fill(' ');
    this._dotPos   = digits - decimals - 1;  // digit index after which decimal point shows
    this._build();
  }

  _build() {
    this.container.innerHTML = '';
    this.container.classList.add('seg-display');

    for (let i = 0; i < this.digits; i++) {
      const wrap = document.createElement('div');
      wrap.className = 'seg-digit';

      const segs = {};
      for (const name of NAMES) {
        const el = document.createElement('div');
        el.className = `seg seg-${name} seg-off`;
        segs[name] = el;
        wrap.appendChild(el);
      }

      // Decimal point
      const dot = document.createElement('div');
      dot.className = 'seg-dot' + (i === this._dotPos ? '' : ' seg-dot-hidden');
      wrap.appendChild(dot);

      this._els.push({ segs, dot });
      this.container.appendChild(wrap);
    }
  }

  /**
   * Set display to a numeric value.
   * @param {number|null} value  — null shows "----"
   * @param {boolean} negative
   */
  setValue(value, negative = false) {
    if (value === null || isNaN(value)) {
      this._showString('----');
      return;
    }

    // Clamp and format
    const maxVal = Math.pow(10, this.digits - this.decimals) - Math.pow(10, -this.decimals);
    value = Math.min(Math.abs(value), maxVal);

    let str = value.toFixed(this.decimals);
    // Remove decimal point for character array (handled by CSS)
    str = str.replace('.', '');

    // Pad left
    while (str.length < this.digits) str = ' ' + str;
    if (negative && str[0] === ' ') {
      // Insert minus sign in first blank slot
      const firstDigit = str.search(/[0-9]/);
      const pos = Math.max(0, firstDigit - 1);
      str = str.substring(0, pos) + '-' + str.substring(pos + 1);
    }

    this._showString(str);
  }

  /** Show a raw string (spaces, letters, digits, '-') */
  _showString(s) {
    for (let i = 0; i < this.digits; i++) {
      const ch   = s[i] ?? ' ';
      const pat  = SEG[ch] ?? SEG[' '];
      const { segs } = this._els[i];
      NAMES.forEach((name, idx) => {
        segs[name].classList.toggle('seg-off', !pat[idx]);
        segs[name].classList.toggle('seg-on',  !!pat[idx]);
      });
    }
  }

  /** Flash all segments briefly (startup animation) */
  async startup() {
    this._showString('88888'.slice(0, this.digits));
    await delay(600);
    this._showString(' '.repeat(this.digits));
    await delay(200);
    this._showString('88888'.slice(0, this.digits));
    await delay(300);
    this._showString(' '.repeat(this.digits));
    await delay(150);
    this.setValue(0);
  }

  /** Flicker effect for unstable reading */
  flicker() {
    this.container.classList.add('display-flicker');
    setTimeout(() => this.container.classList.remove('display-flicker'), 400);
  }

  /** Error message */
  showError(code = 'Err') {
    const s = ('  ' + code).slice(-this.digits);
    this._showString(s);
  }

  showOverload() { this._showString(' OL '); }
  showHold()     { this._showString('HoLd'); }
  showCalibrate(){ this._showString('CAL '); }
  showTare()     { this._showString('tArE'); }
  showReady()    { this._showString('rdy '); }
}

/* ═══════════════════════════════════════════════════════════════
   StabilityBar  —  graphical stability indicator
═══════════════════════════════════════════════════════════════ */
class StabilityBar {
  constructor(el) {
    this.el = el;
    this._pct = 0;
    this._label = el.querySelector('.stability-label');
    this._bar   = el.querySelector('.stability-fill');
  }

  set(pct, stable) {
    this._pct = Math.min(100, Math.max(0, pct));
    if (this._bar)   this._bar.style.width = this._pct + '%';
    if (this._label) this._label.textContent = stable ? 'STABLE' : 'MEASURING';
    this.el.classList.toggle('stable', stable);
    this.el.classList.toggle('measuring', !stable);
  }
}

/* ═══════════════════════════════════════════════════════════════
   LED indicator helper
═══════════════════════════════════════════════════════════════ */
class LED {
  constructor(el) { this.el = el; }
  on(color)  { this.el.className = `led led-${color || 'green'}`; }
  off()      { this.el.className = 'led led-off'; }
  blink(ms = 500) {
    this.on();
    setTimeout(() => this.off(), ms / 2);
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ═══════════════════════════════════════════════════════════════
   AccuracyDisplay  —  mini 7-segment readout for accuracy %
   Updates in real-time, same segment rendering as main display,
   with color-coded bar and flash animation on significant changes.
═══════════════════════════════════════════════════════════════ */
class AccuracyDisplay {
  /**
   * @param {HTMLElement} digitContainer  — .acc-seg-wrap element
   * @param {HTMLElement} barEl           — .acc-bar-fill element
   */
  constructor(digitContainer, barEl) {
    this.digitEl = digitContainer;
    this.barEl   = barEl;
    this._prev   = -1;
    this._digits = 3;   // up to "100"
    this._els    = [];
    this._build();
  }

  _build() {
    this.digitEl.innerHTML = '';
    for (let i = 0; i < this._digits; i++) {
      const wrap = document.createElement('div');
      wrap.className = 'acc-digit seg-digit';
      const segs = {};
      for (const name of NAMES) {
        const el = document.createElement('div');
        el.className = `seg seg-${name} seg-off`;
        segs[name] = el;
        wrap.appendChild(el);
      }
      this._els.push({ segs });
      this.digitEl.appendChild(wrap);
    }
  }

  /**
   * Set accuracy percentage (0–100). Animates digits in real-time.
   * @param {number} pct
   */
  set(pct) {
    const clamped = Math.min(100, Math.max(0, Math.round(pct)));

    // Flash if change is significant (> 3%)
    if (Math.abs(clamped - this._prev) >= 3 && this._prev >= 0) {
      this.digitEl.classList.add('acc-flash');
      setTimeout(() => this.digitEl.classList.remove('acc-flash'), 320);
    }
    this._prev = clamped;

    // Render digits
    const str = String(clamped).padStart(this._digits, ' ');
    for (let i = 0; i < this._digits; i++) {
      const ch  = str[i] ?? ' ';
      const pat = SEG[ch] ?? SEG[' '];
      const { segs } = this._els[i];
      NAMES.forEach((name, idx) => {
        segs[name].classList.toggle('seg-off',  !pat[idx]);
        segs[name].classList.toggle('seg-on',   !!pat[idx]);
      });
    }

    // Color-coded bar
    if (this.barEl) {
      this.barEl.style.width = clamped + '%';
      this.barEl.className = 'acc-bar-fill ' + (
        clamped >= 80 ? 'acc-high' :
        clamped >= 60 ? 'acc-good' :
        clamped >= 35 ? 'acc-mid'  : 'acc-low'
      );
    }
  }

  /** Startup flash matching main display */
  async startup() {
    this.set(88);
    await delay(600);
    this.set(0);
    await delay(200);
    this.set(88);
    await delay(300);
    this.set(0);
    await delay(150);
  }
}

export { SevenSegmentDisplay, StabilityBar, LED, AccuracyDisplay, delay };
