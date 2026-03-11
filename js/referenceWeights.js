/**
 * referenceWeights.js — Known weight database for verification
 * 
 * Comprehensive database of everyday objects with precise weights
 * for calibration and accuracy verification.
 */

'use strict';

/**
 * US Coins (very consistent, good for calibration)
 */
const US_COINS = [
  { id: 'penny', name: 'US Penny', grams: 2.5, tolerance: 0.1, icon: '🪙', category: 'coin' },
  { id: 'nickel', name: 'US Nickel', grams: 5.0, tolerance: 0.1, icon: '🪙', category: 'coin', recommended: true },
  { id: 'dime', name: 'US Dime', grams: 2.268, tolerance: 0.05, icon: '🪙', category: 'coin' },
  { id: 'quarter', name: 'US Quarter', grams: 5.67, tolerance: 0.1, icon: '🪙', category: 'coin', recommended: true },
  { id: 'half_dollar', name: 'US Half Dollar', grams: 11.34, tolerance: 0.2, icon: '🪙', category: 'coin' },
  { id: 'dollar_sacagawea', name: 'Sacagawea Dollar', grams: 8.1, tolerance: 0.15, icon: '🪙', category: 'coin' },
  { id: 'dollar_ike', name: 'Eisenhower Dollar', grams: 22.68, tolerance: 0.3, icon: '🪙', category: 'coin' },
];

/**
 * Currency (paper)
 */
const CURRENCY = [
  { id: 'usd_1', name: 'US $1 Bill', grams: 1.0, tolerance: 0.05, icon: '💵', category: 'currency', recommended: true },
  { id: 'usd_5', name: 'US $5 Bill', grams: 1.0, tolerance: 0.05, icon: '💵', category: 'currency' },
  { id: 'usd_10', name: 'US $10 Bill', grams: 1.0, tolerance: 0.05, icon: '💵', category: 'currency' },
  { id: 'usd_20', name: 'US $20 Bill', grams: 1.0, tolerance: 0.05, icon: '💵', category: 'currency' },
  { id: 'usd_100', name: 'US $100 Bill', grams: 1.0, tolerance: 0.05, icon: '💵', category: 'currency' },
  { id: 'credit_card', name: 'Credit Card', grams: 5.0, tolerance: 0.2, icon: '💳', category: 'currency' },
];

/**
 * Common small items (useful for verification)
 */
const COMMON_ITEMS = [
  { id: 'aa_battery', name: 'AA Battery', grams: 23.0, tolerance: 0.5, icon: '🔋', category: 'battery' },
  { id: 'aaa_battery', name: 'AAA Battery', grams: 11.5, tolerance: 0.3, icon: '🔋', category: 'battery' },
  { id: 'quarter_4', name: '4 Quarters', grams: 22.68, tolerance: 0.3, icon: '🪙', category: 'coin_stack' },
  { id: 'nickel_2', name: '2 Nickels', grams: 10.0, tolerance: 0.15, icon: '🪙', category: 'coin_stack', recommended: true },
  { id: 'penny_10', name: '10 Pennies', grams: 25.0, tolerance: 0.5, icon: '🪙', category: 'coin_stack' },
  { id: 'quarter_nickel', name: 'Quarter + Nickel', grams: 10.67, tolerance: 0.2, icon: '🪙', category: 'coin_stack' },
  { id: 'sd_card', name: 'SD Card', grams: 2.0, tolerance: 0.1, icon: '💾', category: 'electronics' },
  { id: 'usb_flash', name: 'USB Flash Drive', grams: 8.0, tolerance: 1.0, icon: '💾', category: 'electronics' },
  { id: 'earbuds', name: 'Wireless Earbuds (pair)', grams: 5.0, tolerance: 0.5, icon: '🎧', category: 'electronics' },
  { id: 'airpods', name: 'AirPods (pair)', grams: 4.0, tolerance: 0.2, icon: '🎧', category: 'electronics' },
];

/**
 * Standard calibration weights (if you have them)
 */
const CALIBRATION_WEIGHTS = [
  { id: 'cal_1g', name: 'Calibration Weight 1g', grams: 1.0, tolerance: 0.005, icon: '⚖️', category: 'calibration' },
  { id: 'cal_2g', name: 'Calibration Weight 2g', grams: 2.0, tolerance: 0.005, icon: '⚖️', category: 'calibration' },
  { id: 'cal_5g', name: 'Calibration Weight 5g', grams: 5.0, tolerance: 0.005, icon: '⚖️', category: 'calibration', recommended: true },
  { id: 'cal_10g', name: 'Calibration Weight 10g', grams: 10.0, tolerance: 0.01, icon: '⚖️', category: 'calibration', recommended: true },
  { id: 'cal_20g', name: 'Calibration Weight 20g', grams: 20.0, tolerance: 0.01, icon: '⚖️', category: 'calibration' },
  { id: 'cal_50g', name: 'Calibration Weight 50g', grams: 50.0, tolerance: 0.02, icon: '⚖️', category: 'calibration' },
];

/**
 * All reference weights combined
 */
const ALL_REFERENCE_WEIGHTS = [
  ...US_COINS,
  ...CURRENCY,
  ...COMMON_ITEMS,
  ...CALIBRATION_WEIGHTS
];

/**
 * Get recommended weights for initial calibration
 */
function getRecommendedWeights() {
  return ALL_REFERENCE_WEIGHTS.filter(w => w.recommended);
}

/**
 * Get weights by category
 */
function getWeightsByCategory(category) {
  return ALL_REFERENCE_WEIGHTS.filter(w => w.category === category);
}

/**
 * Find weight by ID
 */
function getWeightById(id) {
  return ALL_REFERENCE_WEIGHTS.find(w => w.id === id);
}

/**
 * Find weights in a range (for finding suitable verification weights)
 */
function getWeightsInRange(minGrams, maxGrams) {
  return ALL_REFERENCE_WEIGHTS.filter(w => w.grams >= minGrams && w.grams <= maxGrams);
}

/**
 * Get best verification weight for a measured value
 */
function getBestVerificationWeight(measuredGrams) {
  // Find the closest weight
  let closest = null;
  let minDiff = Infinity;
  
  for (const weight of ALL_REFERENCE_WEIGHTS) {
    const diff = Math.abs(weight.grams - measuredGrams);
    if (diff < minDiff) {
      minDiff = diff;
      closest = weight;
    }
  }
  
  return closest;
}

/**
 * Calculate verification result
 */
function calculateVerification(measuredGrams, referenceWeight) {
  const error = measuredGrams - referenceWeight.grams;
  const errorPercent = (error / referenceWeight.grams) * 100;
  const isWithinTolerance = Math.abs(error) <= referenceWeight.tolerance;
  const accuracy = Math.max(0, 100 - Math.abs(errorPercent));
  
  return {
    reference: referenceWeight,
    measured: measuredGrams,
    error,
    errorPercent,
    accuracy,
    isWithinTolerance,
    grade: accuracy >= 99 ? 'A+' : accuracy >= 98 ? 'A' : accuracy >= 95 ? 'B' : accuracy >= 90 ? 'C' : 'D'
  };
}

/**
 * Get weight combinations (for creating custom weights)
 */
function getWeightCombinations() {
  const combinations = [];
  const coins = US_COINS.filter(c => c.grams <= 10);
  
  // Simple combinations up to 3 items
  for (let i = 0; i < coins.length; i++) {
    for (let j = i; j < coins.length; j++) {
      const total = coins[i].grams + (i === j ? 0 : coins[j].grams);
      const name = i === j 
        ? `2× ${coins[i].name}`
        : `${coins[i].name} + ${coins[j].name}`;
      combinations.push({
        name,
        grams: total,
        components: i === j ? [coins[i], coins[i]] : [coins[i], coins[j]]
      });
    }
  }
  
  return combinations.sort((a, b) => a.grams - b.grams);
}

export {
  US_COINS,
  CURRENCY,
  COMMON_ITEMS,
  CALIBRATION_WEIGHTS,
  ALL_REFERENCE_WEIGHTS,
  getRecommendedWeights,
  getWeightsByCategory,
  getWeightById,
  getWeightsInRange,
  getBestVerificationWeight,
  calculateVerification,
  getWeightCombinations
};
