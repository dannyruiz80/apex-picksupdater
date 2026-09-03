import { MlbPitcherKFeatureVectorV3, MlbPitcherKNegativeBinomialResult } from '../types';

function round6(x: number): number {
  return Number(x.toFixed(6));
}

function nestedRate(features: MlbPitcherKFeatureVectorV3): number | null {
  const season = features.seasonStrikeoutsPerBF;
  if (season === null) return null;
  const l10 = features.l10StrikeoutsPerBF ?? season;
  const l5 = features.l5StrikeoutsPerBF ?? l10;
  // Recency is expressed as bounded nested deviations so L5/L10 do not get counted as independent samples.
  const rate = season + 0.25 * (l10 - season) + 0.15 * (l5 - l10);
  return Math.max(0.03, Math.min(0.60, rate));
}

function distribution(mu: number, r: number, line: number): { over: number; under: number; push: number } {
  const maxK = Math.max(40, Math.ceil(mu + 10 * Math.sqrt(mu + (mu * mu) / r)));
  const probs: number[] = [];
  const q = mu / (mu + r);
  let pk = Math.pow(r / (r + mu), r);
  probs.push(pk);
  for (let k = 0; k < maxK; k++) {
    pk = pk * q * ((k + r) / (k + 1));
    probs.push(pk);
  }
  const total = probs.reduce((a, b) => a + b, 0);
  if (total <= 0 || !Number.isFinite(total)) return { over: 0, under: 0, push: 0 };
  const normalized = probs.map((p) => p / total);

  let over = 0;
  let under = 0;
  let push = 0;
  normalized.forEach((p, k) => {
    if (k > line) over += p;
    else if (k < line) under += p;
    else push += p;
  });
  return { over, under, push };
}

export function evaluateMlbPitcherKNegativeBinomial(
  features: MlbPitcherKFeatureVectorV3
): MlbPitcherKNegativeBinomialResult {
  if (!features.isPointInTimeValid || features.dataQuality === 'UNAVAILABLE') {
    return {
      modelVersion: 'APEX_MLB_K_NB_V3',
      isAvailable: false,
      reason: features.reasonCodes.join(', ') || 'V3 features unavailable',
      expectedStrikeouts: null,
      dispersionR: null,
      predictiveVariance: null,
      overProbability: null,
      underProbability: null,
      pushProbability: null,
    };
  }

  const expectedBF = features.expectedBattersFaced;
  const kRate = nestedRate(features);
  if (expectedBF === null || kRate === null) {
    return {
      modelVersion: 'APEX_MLB_K_NB_V3',
      isAvailable: false,
      reason: 'Verified expected workload or K/BF rate missing',
      expectedStrikeouts: null,
      dispersionR: null,
      predictiveVariance: null,
      overProbability: null,
      underProbability: null,
      pushProbability: null,
    };
  }

  const mu = expectedBF * kRate;
  if (!Number.isFinite(mu) || mu <= 0 || mu > 20) {
    return {
      modelVersion: 'APEX_MLB_K_NB_V3',
      isAvailable: false,
      reason: 'Expected strikeout mean outside safe range',
      expectedStrikeouts: null,
      dispersionR: null,
      predictiveVariance: null,
      overProbability: null,
      underProbability: null,
      pushProbability: null,
    };
  }

  const observedMean = features.strikeoutMean ?? mu;
  const observedVariance = features.strikeoutVariance ?? observedMean;
  let r = 1000; // Near-Poisson fallback only when verified count variance is not overdispersed.
  if (observedVariance > observedMean + 1e-6) {
    r = (observedMean * observedMean) / (observedVariance - observedMean);
    r = Math.max(1.5, Math.min(1000, r));
  }

  const predictiveVariance = mu + (mu * mu) / r;
  const p = distribution(mu, r, features.line);
  const sum = p.over + p.under + p.push;
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > 0.002) {
    return {
      modelVersion: 'APEX_MLB_K_NB_V3',
      isAvailable: false,
      reason: 'Count distribution normalization failed',
      expectedStrikeouts: round6(mu),
      dispersionR: round6(r),
      predictiveVariance: round6(predictiveVariance),
      overProbability: null,
      underProbability: null,
      pushProbability: null,
    };
  }

  return {
    modelVersion: 'APEX_MLB_K_NB_V3',
    isAvailable: true,
    reason: null,
    expectedStrikeouts: round6(mu),
    dispersionR: round6(r),
    predictiveVariance: round6(predictiveVariance),
    overProbability: round6(p.over),
    underProbability: round6(p.under),
    pushProbability: round6(p.push),
  };
}
