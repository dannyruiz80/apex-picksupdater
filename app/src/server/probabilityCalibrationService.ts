import {
  ApexSport,
  DurableHistoricalPropSnapshot,
  ProbabilityCalibrationInfo,
  ProbabilityCalibrationStatus,
} from '../types';
import { snapshotPersistenceService } from './snapshotPersistenceService';

export interface CalibrationObservation {
  snapshotId: string;
  eventStartTime: string;
  gradingTimestamp: string;
  probability: number;
  label: 0 | 1;
}

export interface PlattModel {
  slope: number;
  intercept: number;
}

export interface CalibrationMetrics {
  logLoss: number;
  brier: number;
}

export interface CalibrationDecision {
  status: ProbabilityCalibrationStatus;
  overProbability: number;
  underProbability: number;
  info: ProbabilityCalibrationInfo;
}

const EPS = 1e-6;
const MIN_TRAIN_SNAPSHOTS = 30;
const MIN_VALIDATION_SNAPSHOTS = 10;
const MAX_SNAPSHOTS = 1200;

function clamp(p: number): number {
  return Math.min(1 - EPS, Math.max(EPS, p));
}

function logit(p: number): number {
  const c = clamp(p);
  return Math.log(c / (1 - c));
}

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

export function applyPlatt(model: PlattModel, probability: number): number {
  return clamp(sigmoid(model.slope * logit(probability) + model.intercept));
}

export function calculateCalibrationMetrics(
  observations: Array<Pick<CalibrationObservation, 'probability' | 'label'>>,
  transform?: (p: number) => number
): CalibrationMetrics {
  if (observations.length === 0) return { logLoss: Number.NaN, brier: Number.NaN };
  let ll = 0;
  let bs = 0;
  for (const obs of observations) {
    const p = clamp(transform ? transform(obs.probability) : obs.probability);
    ll += -(obs.label * Math.log(p) + (1 - obs.label) * Math.log(1 - p));
    bs += (p - obs.label) ** 2;
  }
  return { logLoss: ll / observations.length, brier: bs / observations.length };
}

/**
 * Two-parameter Platt calibration using damped Newton updates.
 * Slope is regularized toward 1 and intercept toward 0 so weak samples remain conservative.
 */
export function fitPlattModel(observations: CalibrationObservation[]): PlattModel {
  let slope = 1;
  let intercept = 0;
  const lambda = 0.02;

  for (let iter = 0; iter < 80; iter++) {
    let gA = lambda * (slope - 1);
    let gB = lambda * intercept;
    let hAA = lambda;
    let hAB = 0;
    let hBB = lambda;

    for (const obs of observations) {
      const x = logit(obs.probability);
      const q = sigmoid(slope * x + intercept);
      const err = q - obs.label;
      const w = Math.max(1e-6, q * (1 - q));
      gA += err * x;
      gB += err;
      hAA += w * x * x;
      hAB += w * x;
      hBB += w;
    }

    const det = hAA * hBB - hAB * hAB;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
    const deltaA = (hBB * gA - hAB * gB) / det;
    const deltaB = (-hAB * gA + hAA * gB) / det;
    const damp = 0.65;
    slope -= damp * deltaA;
    intercept -= damp * deltaB;

    slope = Math.max(0.15, Math.min(4.0, slope));
    intercept = Math.max(-3.0, Math.min(3.0, intercept));

    if (Math.abs(deltaA) + Math.abs(deltaB) < 1e-7) break;
  }

  return { slope, intercept };
}

function validTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function snapshotIsPointInTimeSafe(snapshot: DurableHistoricalPropSnapshot, asOfMs: number): boolean {
  const start = validTimestamp(snapshot.eventStartTime);
  const created = validTimestamp(snapshot.snapshotCreatedAt);
  const quote = validTimestamp(snapshot.sportsbookQuoteTimestamp);
  const stats = validTimestamp(snapshot.statisticsCutoffTimestamp);
  const graded = validTimestamp(snapshot.gradingTimestamp);
  if ([start, created, quote, stats, graded].some((x) => x === null)) return false;
  return Boolean(
    snapshot.snapshotType === 'REAL_PREGAME' &&
    snapshot.historicalEligibility === 'ELIGIBLE' &&
    snapshot.gradingStatus === 'GRADED' &&
    snapshot.pointInTimeValid === true &&
    Boolean(snapshot.featureSnapshotId) &&
    start! < asOfMs &&
    graded! <= asOfMs &&
    quote! <= created! &&
    stats! <= created! &&
    created! < start!
  );
}

function toObservations(snapshot: DurableHistoricalPropSnapshot): CalibrationObservation[] {
  if (snapshot.actualStatistic === null || snapshot.actualStatistic === undefined) return [];
  // Always train the calibrator on the raw model outputs. Once calibration is active,
  // feeding calibrated outputs back into training would create recursive self-calibration.
  const over = snapshot.overRawProbability ?? snapshot.overApexProbability ?? null;
  const under = snapshot.underRawProbability ?? snapshot.underApexProbability ?? null;
  if (over === null || under === null || !Number.isFinite(over) || !Number.isFinite(under)) return [];

  // Pushes have no binary outcome and are excluded from calibration.
  if (snapshot.actualStatistic === snapshot.line) return [];

  const push = Math.max(0, 1 - over - under);
  const decisiveMass = Math.max(EPS, 1 - push);
  const conditionalOver = clamp(over / decisiveMass);
  const conditionalUnder = clamp(under / decisiveMass);
  const overWon = snapshot.actualStatistic > snapshot.line;

  return [
    {
      snapshotId: snapshot.snapshotId,
      eventStartTime: snapshot.eventStartTime,
      gradingTimestamp: snapshot.gradingTimestamp!,
      probability: conditionalOver,
      label: overWon ? 1 : 0,
    },
    {
      snapshotId: snapshot.snapshotId,
      eventStartTime: snapshot.eventStartTime,
      gradingTimestamp: snapshot.gradingTimestamp!,
      probability: conditionalUnder,
      label: overWon ? 0 : 1,
    },
  ];
}

function emptyInfo(status: ProbabilityCalibrationStatus, asOf: Date, reason: string): ProbabilityCalibrationInfo {
  return {
    calibrationVersion: 'APEX_PLATT_V1',
    status,
    fittedAsOf: asOf.toISOString(),
    trainingSnapshots: 0,
    trainingObservations: 0,
    validationSnapshots: 0,
    rawValidationLogLoss: null,
    calibratedValidationLogLoss: null,
    rawValidationBrier: null,
    calibratedValidationBrier: null,
    slope: null,
    intercept: null,
    reason,
  };
}

export class ProbabilityCalibrationService {
  /**
   * Calibrates a two-sided probability only from real, graded, point-in-time-safe history
   * that was already settled and known before `asOf`.
   */
  public calibratePair(params: {
    sport: ApexSport;
    market: string;
    modelVersion: string;
    rawOverProbability: number;
    rawUnderProbability: number;
    pushProbability: number;
    asOf?: Date;
  }): CalibrationDecision {
    return this.calibratePairFromSnapshots(params, snapshotPersistenceService.getAllSnapshots());
  }

  /** Pure-data entry point used by walk-forward verification and deterministic tests. */
  public calibratePairFromSnapshots(params: {
    sport: ApexSport;
    market: string;
    modelVersion: string;
    rawOverProbability: number;
    rawUnderProbability: number;
    pushProbability: number;
    asOf?: Date;
  }, sourceSnapshots: DurableHistoricalPropSnapshot[]): CalibrationDecision {
    const asOf = params.asOf ?? new Date();
    const asOfMs = asOf.getTime();
    const rawOver = clamp(params.rawOverProbability);
    const rawUnder = clamp(params.rawUnderProbability);
    const push = Math.max(0, Math.min(0.25, params.pushProbability));

    const snapshots = sourceSnapshots
      .filter((s) =>
        s.sport === params.sport &&
        s.market === params.market &&
        s.modelVersion === params.modelVersion &&
        snapshotIsPointInTimeSafe(s, asOfMs)
      )
      .sort((a, b) => Date.parse(a.eventStartTime) - Date.parse(b.eventStartTime))
      .slice(-MAX_SNAPSHOTS);

    if (snapshots.length < MIN_TRAIN_SNAPSHOTS + MIN_VALIDATION_SNAPSHOTS) {
      return {
        status: 'INSUFFICIENT_EVIDENCE',
        overProbability: rawOver,
        underProbability: rawUnder,
        info: {
          ...emptyInfo('INSUFFICIENT_EVIDENCE', asOf, `Need at least ${MIN_TRAIN_SNAPSHOTS + MIN_VALIDATION_SNAPSHOTS} point-in-time-safe graded snapshots for this sport/market/model.`),
          trainingSnapshots: snapshots.length,
          trainingObservations: snapshots.flatMap(toObservations).length,
        },
      };
    }

    const validationCount = Math.max(MIN_VALIDATION_SNAPSHOTS, Math.floor(snapshots.length * 0.25));
    const trainSnapshots = snapshots.slice(0, snapshots.length - validationCount);
    const validationSnapshots = snapshots.slice(snapshots.length - validationCount);
    const train = trainSnapshots.flatMap(toObservations);
    const validation = validationSnapshots.flatMap(toObservations);

    if (trainSnapshots.length < MIN_TRAIN_SNAPSHOTS || validationSnapshots.length < MIN_VALIDATION_SNAPSHOTS || train.length < 2 || validation.length < 2) {
      return {
        status: 'INSUFFICIENT_EVIDENCE',
        overProbability: rawOver,
        underProbability: rawUnder,
        info: {
          ...emptyInfo('INSUFFICIENT_EVIDENCE', asOf, 'Insufficient decisive observations after push filtering.'),
          trainingSnapshots: trainSnapshots.length,
          trainingObservations: train.length,
          validationSnapshots: validationSnapshots.length,
        },
      };
    }

    const validationModel = fitPlattModel(train);
    const rawMetrics = calculateCalibrationMetrics(validation);
    const calibratedMetrics = calculateCalibrationMetrics(validation, (p) => applyPlatt(validationModel, p));

    const logLossNonWorse = calibratedMetrics.logLoss <= rawMetrics.logLoss + 0.0025;
    const brierNonWorse = calibratedMetrics.brier <= rawMetrics.brier + 0.0015;
    const meaningfulImprovement =
      calibratedMetrics.logLoss < rawMetrics.logLoss - 0.0005 ||
      calibratedMetrics.brier < rawMetrics.brier - 0.0005;

    if (!(logLossNonWorse && brierNonWorse && meaningfulImprovement)) {
      return {
        status: 'VALIDATION_NOT_IMPROVED',
        overProbability: rawOver,
        underProbability: rawUnder,
        info: {
          calibrationVersion: 'APEX_PLATT_V1',
          status: 'VALIDATION_NOT_IMPROVED',
          fittedAsOf: asOf.toISOString(),
          trainingSnapshots: trainSnapshots.length,
          trainingObservations: train.length,
          validationSnapshots: validationSnapshots.length,
          rawValidationLogLoss: rawMetrics.logLoss,
          calibratedValidationLogLoss: calibratedMetrics.logLoss,
          rawValidationBrier: rawMetrics.brier,
          calibratedValidationBrier: calibratedMetrics.brier,
          slope: validationModel.slope,
          intercept: validationModel.intercept,
          reason: 'Held-out chronological validation did not improve probability quality enough to activate calibration.',
        },
      };
    }

    // Validation passed. Refit using every point-in-time-safe snapshot available before asOf.
    const allObs = snapshots.flatMap(toObservations);
    const finalModel = fitPlattModel(allObs);
    const decisiveMass = Math.max(EPS, 1 - push);
    const overConditional = clamp(rawOver / decisiveMass);
    const underConditional = clamp(rawUnder / decisiveMass);
    const calibratedOverConditional = applyPlatt(finalModel, overConditional);
    const calibratedUnderConditional = applyPlatt(finalModel, underConditional);
    const totalConditional = calibratedOverConditional + calibratedUnderConditional;
    const normOver = calibratedOverConditional / totalConditional;
    const normUnder = calibratedUnderConditional / totalConditional;

    return {
      status: 'ACTIVE',
      overProbability: normOver * decisiveMass,
      underProbability: normUnder * decisiveMass,
      info: {
        calibrationVersion: 'APEX_PLATT_V1',
        status: 'ACTIVE',
        fittedAsOf: asOf.toISOString(),
        trainingSnapshots: snapshots.length,
        trainingObservations: allObs.length,
        validationSnapshots: validationSnapshots.length,
        rawValidationLogLoss: rawMetrics.logLoss,
        calibratedValidationLogLoss: calibratedMetrics.logLoss,
        rawValidationBrier: rawMetrics.brier,
        calibratedValidationBrier: calibratedMetrics.brier,
        slope: finalModel.slope,
        intercept: finalModel.intercept,
        reason: null,
      },
    };
  }
}

export const probabilityCalibrationService = new ProbabilityCalibrationService();
