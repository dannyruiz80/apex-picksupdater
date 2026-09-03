import {
  DurableHistoricalPropSnapshot,
  MlbPitcherKBoostedResult,
  MlbPitcherKFeatureVectorV3,
} from '../types';
import { snapshotPersistenceService } from './snapshotPersistenceService';

const MIN_ROWS = 80;
const MIN_VALIDATION_ROWS = 20;
const ITERATIONS = 36;
const LEARNING_RATE = 0.08;
const L2 = 2.0;
const MAX_LEAF = 1.25;
const EPS = 1e-6;

const FEATURE_NAMES = [
  'expectedBattersFaced',
  'expectedInnings',
  'seasonStrikeoutsPerBF',
  'l10StrikeoutsPerBF',
  'l5StrikeoutsPerBF',
  'workloadTrendBF',
  'strikeoutMean',
  'strikeoutVariance',
  'opponentStrikeoutRate',
  'recentSwStrRate',
  'recentCswRate',
  'averageFastballVelocityMph',
  'velocityDeltaMph',
  'dominantPitchShare',
  'daysRest',
  'temperatureF',
  'windMph',
  'parkFactor',
  'umpireStrikeoutFactor',
  'line',
] as const;

type FeatureName = typeof FEATURE_NAMES[number];

export type MlbPitcherKBoostedTrainingRow = {
  at: string;
  y: 0 | 1;
  baseProbability: number;
  features: MlbPitcherKFeatureVectorV3;
  weight?: number;
  clusterId?: string;
};

type Stump = {
  feature: FeatureName;
  threshold: number;
  left: number;
  right: number;
};

type TrainedModel = {
  medians: Record<FeatureName, number>;
  stumps: Stump[];
};

function clampProbability(p: number): number {
  return Math.min(1 - EPS, Math.max(EPS, p));
}

function logit(p: number): number {
  p = clampProbability(p);
  return Math.log(p / (1 - p));
}

function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function valueOf(features: MlbPitcherKFeatureVectorV3, name: FeatureName): number | null {
  const value = features[name] as unknown;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeMedians(rows: MlbPitcherKBoostedTrainingRow[]): Record<FeatureName, number> {
  return Object.fromEntries(
    FEATURE_NAMES.map((name) => [name, median(rows.map((r) => valueOf(r.features, name)).filter((x): x is number => x !== null))])
  ) as Record<FeatureName, number>;
}

function getX(row: MlbPitcherKBoostedTrainingRow | { features: MlbPitcherKFeatureVectorV3 }, name: FeatureName, medians: Record<FeatureName, number>): number {
  return valueOf(row.features, name) ?? medians[name];
}

function thresholds(values: number[]): number[] {
  if (values.length < 4) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const out = new Set<number>();
  for (const q of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
    out.add(sorted[idx]);
  }
  return [...out];
}

function predictWithModel(model: TrainedModel, features: MlbPitcherKFeatureVectorV3, baseProbability: number): number {
  let score = logit(baseProbability);
  for (const stump of model.stumps) {
    const x = valueOf(features, stump.feature) ?? model.medians[stump.feature];
    score += LEARNING_RATE * (x <= stump.threshold ? stump.left : stump.right);
  }
  return clampProbability(sigmoid(score));
}

function train(rows: MlbPitcherKBoostedTrainingRow[]): TrainedModel {
  const medians = computeMedians(rows);
  const scores = rows.map((r) => logit(r.baseProbability));
  const stumps: Stump[] = [];

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const probs = scores.map(sigmoid);
    let best: { stump: Stump; gain: number } | null = null;

    for (const feature of FEATURE_NAMES) {
      const xs = rows.map((r) => getX(r, feature, medians));
      for (const threshold of thresholds(xs)) {
        let gl = 0, hl = 0, gr = 0, hr = 0, g = 0, h = 0;
        for (let i = 0; i < rows.length; i++) {
          const weight = rows[i].weight ?? 1;
          const grad = weight * (rows[i].y - probs[i]);
          const hess = weight * Math.max(EPS, probs[i] * (1 - probs[i]));
          g += grad; h += hess;
          if (xs[i] <= threshold) { gl += grad; hl += hess; }
          else { gr += grad; hr += hess; }
        }
        if (hl < 1 || hr < 1) continue;
        const gain = 0.5 * ((gl * gl) / (hl + L2) + (gr * gr) / (hr + L2) - (g * g) / (h + L2));
        if (!best || gain > best.gain) {
          const left = Math.max(-MAX_LEAF, Math.min(MAX_LEAF, gl / (hl + L2)));
          const right = Math.max(-MAX_LEAF, Math.min(MAX_LEAF, gr / (hr + L2)));
          best = { stump: { feature, threshold, left, right }, gain };
        }
      }
    }

    if (!best || best.gain <= 1e-5) break;
    stumps.push(best.stump);
    for (let i = 0; i < rows.length; i++) {
      const x = getX(rows[i], best.stump.feature, medians);
      scores[i] += LEARNING_RATE * (x <= best.stump.threshold ? best.stump.left : best.stump.right);
    }
  }

  return { medians, stumps };
}

function logLoss(rows: MlbPitcherKBoostedTrainingRow[], probabilities: number[]): number {
  if (!rows.length) return NaN;
  let weighted = 0;
  let weightSum = 0;
  rows.forEach((r, i) => {
    const w = r.weight ?? 1;
    const p = clampProbability(probabilities[i]);
    weighted -= w * (r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p));
    weightSum += w;
  });
  return weightSum > 0 ? weighted / weightSum : NaN;
}

function brier(rows: MlbPitcherKBoostedTrainingRow[], probabilities: number[]): number {
  if (!rows.length) return NaN;
  let weighted = 0;
  let weightSum = 0;
  rows.forEach((r, i) => {
    const w = r.weight ?? 1;
    weighted += w * (probabilities[i] - r.y) ** 2;
    weightSum += w;
  });
  return weightSum > 0 ? weighted / weightSum : NaN;
}

function trainingRowsFromSnapshots(snapshots: DurableHistoricalPropSnapshot[], asOf: Date): MlbPitcherKBoostedTrainingRow[] {
  const asOfMs = asOf.getTime();
  const eligible = snapshots
    .filter((s) => {
      const featureAsOf = Date.parse(s.mlbPitcherKV3?.featureVector?.asOf ?? '');
      const snapshotAt = Date.parse(s.snapshotCreatedAt);
      const eventAt = Date.parse(s.eventStartTime);
      const gradedAt = Date.parse(s.gradingTimestamp ?? '');
      const chronologyValid =
        Number.isFinite(featureAsOf) && Number.isFinite(snapshotAt) && Number.isFinite(eventAt) && Number.isFinite(gradedAt) &&
        featureAsOf <= snapshotAt && featureAsOf < eventAt && gradedAt > eventAt && gradedAt < asOfMs;
      return s.snapshotType === 'REAL_PREGAME' &&
        s.sport === 'MLB' &&
        s.market === 'pitcher_strikeouts' &&
        s.historicalEligibility === 'ELIGIBLE' &&
        s.pointInTimeValid === true &&
        s.gradingStatus === 'GRADED' &&
        typeof s.actualStatistic === 'number' &&
        s.actualStatistic !== s.line &&
        chronologyValid &&
        Boolean(s.mlbPitcherKV3?.featureVector?.isPointInTimeValid) &&
        typeof s.mlbPitcherKV3?.negativeBinomialOverProbability === 'number' &&
        typeof s.mlbPitcherKV3?.negativeBinomialUnderProbability === 'number';
    })
    .sort((a, b) => Date.parse(a.sportsbookQuoteTimestamp) - Date.parse(b.sportsbookQuoteTimestamp));

  // One earliest row per legitimate line prevents repeated refreshes from multiplying training weight.
  const firstByLine = new Map<string, DurableHistoricalPropSnapshot>();
  for (const s of eligible) {
    const key = `${s.eventId}|${s.playerId}|${s.market}|${s.line}`;
    if (!firstByLine.has(key)) firstByLine.set(key, s);
  }
  const byStart = new Map<string, DurableHistoricalPropSnapshot[]>();
  for (const s of firstByLine.values()) {
    const key = `${s.eventId}|${s.playerId}`;
    if (!byStart.has(key)) byStart.set(key, []);
    byStart.get(key)!.push(s);
  }

  const rows: MlbPitcherKBoostedTrainingRow[] = [];
  for (const [clusterId, startRows] of byStart.entries()) {
    const weight = 1 / startRows.length;
    for (const s of startRows) {
      const over = s.mlbPitcherKV3!.negativeBinomialOverProbability!;
      const under = s.mlbPitcherKV3!.negativeBinomialUnderProbability!;
      const decisiveMass = over + under;
      if (!(decisiveMass > 0)) continue;
      rows.push({
        at: s.eventStartTime,
        y: (s.actualStatistic! > s.line ? 1 : 0) as 0 | 1,
        baseProbability: clampProbability(over / decisiveMass),
        features: s.mlbPitcherKV3!.featureVector,
        weight,
        clusterId,
      });
    }
  }
  return rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// Exported pure helper for deterministic tests and future persisted model artifacts.
export function trainMlbPitcherKBoostedForVerification(rows: MlbPitcherKBoostedTrainingRow[], currentFeatures: MlbPitcherKFeatureVectorV3, baseProbability: number): MlbPitcherKBoostedResult {
  return evaluateRows(rows, currentFeatures, baseProbability);
}

function evaluateRows(rows: MlbPitcherKBoostedTrainingRow[], currentFeatures: MlbPitcherKFeatureVectorV3, baseProbability: number): MlbPitcherKBoostedResult {
  const clusters = new Map<string, MlbPitcherKBoostedTrainingRow[]>();
  rows.forEach((row, index) => {
    const id = row.clusterId ?? `ROW-${index}`;
    if (!clusters.has(id)) clusters.set(id, []);
    clusters.get(id)!.push(row);
  });
  const orderedClusters = [...clusters.values()].sort((a, b) => Date.parse(a[0].at) - Date.parse(b[0].at));
  const effectiveRows = orderedClusters.length;
  if (effectiveRows < MIN_ROWS) {
    return {
      modelVersion: 'APEX_MLB_K_GB_STUMPS_V3',
      probabilityBasis: 'OVER_GIVEN_NO_PUSH',
      status: 'INSUFFICIENT_EVIDENCE',
      probability: null,
      validation: {
        trainingRows: effectiveRows,
        validationRows: 0,
        baselineLogLoss: null,
        boostedLogLoss: null,
        baselineBrier: null,
        boostedBrier: null,
        trainEndAt: orderedClusters.at(-1)?.[0]?.at ?? null,
        validationStartAt: null,
      },
      reason: `Requires at least ${MIN_ROWS} independent graded V3 pitcher starts; found ${effectiveRows}`,
    };
  }

  const validationClusterCount = Math.max(MIN_VALIDATION_ROWS, Math.floor(effectiveRows * 0.25));
  const trainClusters = orderedClusters.slice(0, effectiveRows - validationClusterCount);
  const validationClusters = orderedClusters.slice(effectiveRows - validationClusterCount);
  const trainRows = trainClusters.flat();
  const validationRows = validationClusters.flat();
  const positives = trainRows.reduce((n, r) => n + (r.y === 1 ? (r.weight ?? 1) : 0), 0);
  const negatives = trainRows.reduce((n, r) => n + (r.y === 0 ? (r.weight ?? 1) : 0), 0);
  if (trainClusters.length < 50 || positives < 15 || negatives < 15) {
    return {
      modelVersion: 'APEX_MLB_K_GB_STUMPS_V3',
      probabilityBasis: 'OVER_GIVEN_NO_PUSH',
      status: 'INSUFFICIENT_EVIDENCE',
      probability: null,
      validation: {
        trainingRows: trainClusters.length,
        validationRows: validationClusters.length,
        baselineLogLoss: null,
        boostedLogLoss: null,
        baselineBrier: null,
        boostedBrier: null,
        trainEndAt: trainRows.at(-1)?.at ?? null,
        validationStartAt: validationRows[0]?.at ?? null,
      },
      reason: 'Training sample does not contain enough outcomes on both sides',
    };
  }

  const model = train(trainRows);
  const baseline = validationRows.map((r) => r.baseProbability);
  const boosted = validationRows.map((r) => predictWithModel(model, r.features, r.baseProbability));
  const baselineLogLoss = logLoss(validationRows, baseline);
  const boostedLogLoss = logLoss(validationRows, boosted);
  const baselineBrier = brier(validationRows, baseline);
  const boostedBrier = brier(validationRows, boosted);

  const chronological = Date.parse(trainRows.at(-1)!.at) < Date.parse(validationRows[0].at);
  const improves = chronological && boostedLogLoss <= baselineLogLoss - 0.003 && boostedBrier <= baselineBrier;
  const currentProbability = improves ? predictWithModel(model, currentFeatures, baseProbability) : null;

  return {
    modelVersion: 'APEX_MLB_K_GB_STUMPS_V3',
    probabilityBasis: 'OVER_GIVEN_NO_PUSH',
    status: improves ? 'ACTIVE_SHADOW' : 'REJECTED_VALIDATION',
    probability: currentProbability === null ? null : Number(currentProbability.toFixed(6)),
    validation: {
      trainingRows: trainClusters.length,
      validationRows: validationClusters.length,
      baselineLogLoss: Number(baselineLogLoss.toFixed(6)),
      boostedLogLoss: Number(boostedLogLoss.toFixed(6)),
      baselineBrier: Number(baselineBrier.toFixed(6)),
      boostedBrier: Number(boostedBrier.toFixed(6)),
      trainEndAt: trainRows.at(-1)?.at ?? null,
      validationStartAt: validationRows[0]?.at ?? null,
    },
    reason: improves
      ? `Chronological holdout improved log loss by ${(baselineLogLoss - boostedLogLoss).toFixed(4)} without worsening Brier score`
      : 'Challenger rejected: chronological validation did not clear the required probability-quality improvement',
  };
}

export class MlbPitcherKBoostedShadowService {
  evaluate(features: MlbPitcherKFeatureVectorV3, baseProbability: number, asOf: Date = new Date()): MlbPitcherKBoostedResult {
    const rows = trainingRowsFromSnapshots(snapshotPersistenceService.getAllSnapshots(), asOf);
    return evaluateRows(rows, features, baseProbability);
  }
}

export const mlbPitcherKBoostedShadowService = new MlbPitcherKBoostedShadowService();
