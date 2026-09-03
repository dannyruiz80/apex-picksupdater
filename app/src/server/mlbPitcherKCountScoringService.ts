import { MlbPitcherKCountScoreMetrics, MlbPitcherKNegativeBinomialResult } from '../types';

const EPS = 1e-12;

export interface MlbPitcherKCountScoreRow {
  actualStrikeouts: number;
  expectedStrikeouts: number;
  dispersionR: number;
}

function round(v: number | null, digits = 6): number | null {
  return v === null || !Number.isFinite(v) ? null : Number(v.toFixed(digits));
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function negativeBinomialPmf(mu: number, r: number, k: number): number {
  if (!finite(mu) || !finite(r) || !Number.isInteger(k) || mu <= 0 || r <= 0 || k < 0) return 0;
  const q = mu / (mu + r);
  let pk = Math.pow(r / (r + mu), r);
  if (k === 0) return pk;
  for (let i = 0; i < k; i++) pk *= q * ((i + r) / (i + 1));
  return Math.max(0, pk);
}

function support(mu: number, r: number, actual: number): number[] {
  const variance = mu + (mu * mu) / r;
  const maxK = Math.max(actual + 15, 40, Math.ceil(mu + 12 * Math.sqrt(Math.max(variance, 1))));
  const raw: number[] = [];
  let pk = Math.pow(r / (r + mu), r);
  raw.push(pk);
  const q = mu / (mu + r);
  for (let k = 0; k < maxK; k++) {
    pk = pk * q * ((k + r) / (k + 1));
    raw.push(pk);
  }
  const total = raw.reduce((a, b) => a + b, 0);
  return total > 0 ? raw.map((p) => p / total) : raw;
}

export function scoreNegativeBinomialCount(row: MlbPitcherKCountScoreRow): {
  negativeLogLikelihood: number;
  crps: number;
  absoluteError: number;
  squaredError: number;
  meanError: number;
} | null {
  const { actualStrikeouts: actual, expectedStrikeouts: mu, dispersionR: r } = row;
  if (!Number.isInteger(actual) || actual < 0 || !finite(mu) || !finite(r) || mu <= 0 || r <= 0) return null;
  const probs = support(mu, r, actual);
  const observedP = probs[actual] ?? negativeBinomialPmf(mu, r, actual);
  const negativeLogLikelihood = -Math.log(Math.max(EPS, observedP));

  // Discrete CRPS: sum_k (F(k) - 1{k >= actual})^2.
  let cdf = 0;
  let crps = 0;
  for (let k = 0; k < probs.length; k++) {
    cdf += probs[k];
    const observedCdf = k >= actual ? 1 : 0;
    crps += (cdf - observedCdf) ** 2;
  }
  const error = mu - actual;
  return {
    negativeLogLikelihood,
    crps,
    absoluteError: Math.abs(error),
    squaredError: error * error,
    meanError: error,
  };
}

export function countScoreRowFromNegativeBinomial(
  actualStrikeouts: number,
  result: MlbPitcherKNegativeBinomialResult
): MlbPitcherKCountScoreRow | null {
  if (!result.isAvailable || !finite(result.expectedStrikeouts) || !finite(result.dispersionR)) return null;
  return {
    actualStrikeouts,
    expectedStrikeouts: result.expectedStrikeouts,
    dispersionR: result.dispersionR,
  };
}

export function aggregateCountScores(rows: MlbPitcherKCountScoreRow[]): MlbPitcherKCountScoreMetrics {
  const scores = rows
    .map((row) => ({ row, score: scoreNegativeBinomialCount(row) }))
    .filter((x): x is { row: MlbPitcherKCountScoreRow; score: NonNullable<ReturnType<typeof scoreNegativeBinomialCount>> } => x.score !== null);
  if (!scores.length) {
    return {
      observations: 0,
      meanNegativeLogLikelihood: null,
      meanCrps: null,
      meanAbsoluteError: null,
      rootMeanSquaredError: null,
      meanError: null,
      meanPredictedStrikeouts: null,
      meanActualStrikeouts: null,
    };
  }
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  return {
    observations: scores.length,
    meanNegativeLogLikelihood: round(mean(scores.map((x) => x.score.negativeLogLikelihood))),
    meanCrps: round(mean(scores.map((x) => x.score.crps))),
    meanAbsoluteError: round(mean(scores.map((x) => x.score.absoluteError))),
    rootMeanSquaredError: round(Math.sqrt(mean(scores.map((x) => x.score.squaredError)))),
    meanError: round(mean(scores.map((x) => x.score.meanError))),
    meanPredictedStrikeouts: round(mean(scores.map((x) => x.row.expectedStrikeouts))),
    meanActualStrikeouts: round(mean(scores.map((x) => x.row.actualStrikeouts))),
  };
}
