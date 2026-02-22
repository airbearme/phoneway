/**
 * referenceWeights.js — Known-weight verification library for Phoneway
 *
 * Provides a database of everyday objects with precisely known weights
 * so the user can verify scale accuracy at any time without lab weights.
 *
 * Sub-gram references:
 *   A US Forever postage stamp (peel-off, no backing) ≈ 0.17 g
 *   A standard small paper clip (Gem #1)              ≈ 0.50 g  ← half gram
 *   A folded square of standard printer paper (1/4 A4)≈ 0.31 g
 *   A US dollar bill (any denomination)               = 1.00 g  ← exact
 *
 * Accuracy verification algorithm:
 *   error%  = |measured − expected| / expected × 100
 *   accuracy = 100 − error%  (clamped 0–100)
 *
 * "Recall" / "lock" feature:
 *   User saves a current reading as a reference.
 *   On re-measurement, app shows deviation from saved value.
 *   Useful for verifying the same object reads consistently over time.
 */

'use strict';

/* ── Reference weight database ───────────────────────────────── */
export const REF_WEIGHTS = [
  // Sub-gram
  {
    id: 'stamp',
    label: 'Postage Stamp',
    sublabel: 'US Forever (peeled off backing)',
    grams: 0.17,
    icon: '✉️',
    tolerance: 0.05,   // ±0.05 g  (varies by print run)
    confidence: 'low', // not super precise
    tip: 'Peel off the backing first. Single stamp only.',
  },
  {
    id: 'paperclip',
    label: 'Paper Clip',
    sublabel: 'Standard Gem #1 small clip ≈ 0.5 g',
    grams: 0.50,
    icon: '📎',
    tolerance: 0.08,
    confidence: 'medium',
    tip: 'Use a standard small silver paper clip — NOT jumbo or colored plastic ones.',
  },
  {
    id: 'quarter_dollar_bill',
    label: '¼ Dollar Bill',
    sublabel: 'Tear off exactly ¼ of a dollar bill',
    grams: 0.25,
    icon: '✂️',
    tolerance: 0.03,
    confidence: 'medium',
    tip: 'Fold in half twice, crease sharply, tear on fold. Each quarter = 0.25 g.',
  },
  {
    id: 'half_dollar_bill',
    label: '½ Dollar Bill',
    sublabel: 'Fold and tear a dollar bill in half',
    grams: 0.50,
    icon: '💵',
    tolerance: 0.02,
    confidence: 'high',
    tip: 'Fold a US dollar bill in half, tear on the crease. Exactly 0.50 g.',
  },
  // 1 gram
  {
    id: 'dollar_bill',
    label: 'Dollar Bill',
    sublabel: 'Any US paper currency',
    grams: 1.00,
    icon: '💵',
    tolerance: 0.03,
    confidence: 'high',
    tip: 'Any US bill (1, 5, 10, 20…) weighs exactly 1.00 g per Federal Reserve spec.',
  },
  // 2 gram range
  {
    id: 'two_bills',
    label: '2 Dollar Bills',
    sublabel: 'Stack two US paper bills',
    grams: 2.00,
    icon: '💵',
    tolerance: 0.04,
    confidence: 'high',
    tip: 'Stack any two US bills flat on each other. = 2.00 g.',
  },
  {
    id: 'dime',
    label: 'US Dime',
    sublabel: '10-cent coin',
    grams: 2.268,
    icon: '🪙',
    tolerance: 0.01,
    confidence: 'high',
    tip: 'US dime: 2.268 g. Mint-spec tolerance ±0.010 g.',
  },
  {
    id: 'penny',
    label: 'US Penny',
    sublabel: 'Post-1982 Lincoln cent',
    grams: 2.500,
    icon: '🪙',
    tolerance: 0.013,
    confidence: 'high',
    tip: 'Post-1982 penny: zinc core + copper plating = 2.500 g.',
  },
  // 3 gram range
  {
    id: 'penny_plus_bill',
    label: 'Penny + Dollar Bill',
    sublabel: '2.5 g + 1.0 g',
    grams: 3.500,
    icon: '🪙',
    tolerance: 0.03,
    confidence: 'high',
    tip: 'Place a penny and a dollar bill together = 3.500 g.',
  },
  // 5 gram range
  {
    id: 'nickel',
    label: 'US Nickel',
    sublabel: '5-cent coin — primary reference',
    grams: 5.000,
    icon: '🪙',
    tolerance: 0.008,
    confidence: 'high',
    tip: 'US nickel: 5.000 g. Tightest mint tolerance of any US coin.',
  },
  {
    id: 'quarter',
    label: 'US Quarter',
    sublabel: '25-cent coin',
    grams: 5.670,
    icon: '🪙',
    tolerance: 0.013,
    confidence: 'high',
    tip: 'US quarter: 5.670 g.',
  },
  {
    id: 'five_bills',
    label: '5 Dollar Bills',
    sublabel: 'Stack five US bills',
    grams: 5.00,
    icon: '💵',
    tolerance: 0.08,
    confidence: 'high',
    tip: 'Stack five US bills = 5.00 g. Matches a nickel for cross-check.',
  },
  // 10 gram range
  {
    id: 'two_nickels',
    label: '2 Nickels',
    sublabel: 'Stack two US nickels',
    grams: 10.00,
    icon: '🪙',
    tolerance: 0.015,
    confidence: 'high',
    tip: 'Two nickels stacked = exactly 10.00 g.',
  },
  {
    id: 'dollar_coin',
    label: 'US Dollar Coin',
    sublabel: 'Sacagawea / Presidential',
    grams: 8.100,
    icon: '🪙',
    tolerance: 0.013,
    confidence: 'high',
    tip: 'US dollar coin: 8.100 g.',
  },
  // Custom saved weight
  {
    id: 'saved',
    label: 'Saved Reference',
    sublabel: 'Your locked weight from a previous measurement',
    grams: null,      // filled at runtime
    icon: '⭐',
    tolerance: 0.05,
    confidence: 'medium',
    tip: 'This is a weight you locked earlier. Place the same object to verify.',
    isSaved: true,
  },
];

/* ══════════════════════════════════════════════════════════════
   ReferenceWeightVerifier
   ──────────────────────
   Core verification logic. Compares live measurement to expected.
══════════════════════════════════════════════════════════════ */
export class ReferenceWeightVerifier {
  constructor() {
    this.active       = false;
    this.expected     = null;    // g
    this.tolerance    = 0.05;    // g  ±
    this.windowSize   = 40;      // samples for stable read
    this._buf         = [];
    this.savedGrams   = null;    // user's locked reference weight
    this.history      = [];      // [{ts, expected, measured, error}]

    // Callbacks
    this.onResult = null;    // ({measured, expected, error, accuracy, pass})
    this.onSaved  = null;    // (grams) when user locks a weight
  }

  /** Begin verification against a specific reference weight */
  start(refWeight) {
    this.expected  = refWeight.grams;
    this.tolerance = refWeight.tolerance ?? 0.05;
    this._buf      = [];
    this.active    = true;
  }

  stop() {
    this.active   = false;
    this._buf     = [];
    this.expected = null;
  }

  /** Feed a live gram reading from the fused output */
  feed(grams) {
    if (!this.active || this.expected === null) return null;

    this._buf.push(grams);
    if (this._buf.length > this.windowSize) this._buf.shift();
    if (this._buf.length < 10) return null;   // need minimum samples

    // Reject outliers (2σ filter)
    const mean = this._buf.reduce((a, b) => a + b, 0) / this._buf.length;
    const std  = Math.sqrt(
      this._buf.reduce((a, b) => a + (b - mean) ** 2, 0) / this._buf.length
    );
    const clean = this._buf.filter(v => Math.abs(v - mean) < 2 * std);
    const measured = clean.reduce((a, b) => a + b, 0) / (clean.length || 1);

    const error    = measured - this.expected;
    const errorPct = Math.abs(error / this.expected) * 100;
    const accuracy = Math.max(0, Math.min(100, 100 - errorPct));
    const pass     = Math.abs(error) <= this.tolerance;

    const result = { measured, expected: this.expected, error, errorPct, accuracy, pass };
    this.onResult?.(result);
    return result;
  }

  /** Lock current weight as saved reference */
  lock(grams) {
    this.savedGrams = grams;
    try {
      localStorage.setItem('phoneway_savedRef', String(grams));
    } catch {}
    this.onSaved?.(grams);
  }

  /** Load previously saved reference */
  loadSaved() {
    try {
      const v = parseFloat(localStorage.getItem('phoneway_savedRef') ?? '');
      if (!isNaN(v) && v > 0) { this.savedGrams = v; return v; }
    } catch {}
    return null;
  }

  /** Record a completed verification in history */
  record(result) {
    this.history.unshift({ ts: Date.now(), ...result });
    if (this.history.length > 20) this.history.pop();
    try {
      localStorage.setItem('phoneway_verifyHistory',
        JSON.stringify(this.history.slice(0, 10)));
    } catch {}
  }

  loadHistory() {
    try {
      this.history = JSON.parse(localStorage.getItem('phoneway_verifyHistory') ?? '[]');
    } catch { this.history = []; }
    return this.history;
  }

  /** Summarize verification history: avg error, drift */
  get stats() {
    if (!this.history.length) return null;
    const errors = this.history.map(h => h.error);
    const avg    = errors.reduce((a, b) => a + b, 0) / errors.length;
    const maxErr = Math.max(...errors.map(Math.abs));
    return { avgError: avg, maxError: maxErr, count: errors.length };
  }
}
