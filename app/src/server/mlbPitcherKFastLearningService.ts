import {
  DurableHistoricalPropSnapshot,
  FastLearningEvidenceTier,
  MlbPitcherKFastLearningEvidence,
  MlbPitcherKPairedEvidence,
} from '../types';
import { evaluateMlbPitcherKNegativeBinomial } from './mlbPitcherKNegativeBinomialService';
import { aggregateCountScores, countScoreRowFromNegativeBinomial, MlbPitcherKCountScoreRow } from './mlbPitcherKCountScoringService';
import { mlbPitcherKHistoricalReplayRepository } from './mlbPitcherKHistoricalReplayRepository';
import { mlbPitcherKStarterShadowRepository } from './mlbPitcherKStarterShadowRepository';

const EPS = 1e-9;

type ModelState = { over: number; under: number; push: number };
type PairedLine = { productionLogLoss: number; challengerLogLoss: number; productionBrier: number; challengerBrier: number };

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp(p: number) {
  return Math.max(EPS, Math.min(1 - EPS, p));
}

function round(v: number | null, digits = 6): number | null {
  return v === null || !Number.isFinite(v) ? null : Number(v.toFixed(digits));
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function normalize(over: unknown, under: unknown, push: unknown): ModelState | null {
  if (!finite(over) || over < 0 || over > 1) return null;
  const pPush = finite(push) && push >= 0 && push <= 1 ? push : 0;
  const pUnder = finite(under) && under >= 0 && under <= 1 ? under : Math.max(0, 1 - over - pPush);
  const total = over + pUnder + pPush;
  if (!Number.isFinite(total) || total <= 0 || Math.abs(total - 1) > 0.08) return null;
  return { over: over / total, under: pUnder / total, push: pPush / total };
}

function productionState(s: DurableHistoricalPropSnapshot): ModelState | null {
  return normalize(
    s.overApexProbability ?? (s.side === 'OVER' ? s.apexProbability : null),
    s.underApexProbability,
    s.mlbPitcherKV3?.productionPushProbability ?? 0,
  );
}

function challengerState(s: DurableHistoricalPropSnapshot): ModelState | null {
  return normalize(
    s.mlbPitcherKV3?.shadowOverProbability,
    s.mlbPitcherKV3?.shadowUnderProbability,
    s.mlbPitcherKV3?.shadowPushProbability ?? s.mlbPitcherKV3?.negativeBinomialPushProbability ?? 0,
  );
}

function conditionalOver(state: ModelState): number | null {
  const mass = state.over + state.under;
  return mass > 0 ? state.over / mass : null;
}

function lineKey(s: DurableHistoricalPropSnapshot) {
  return `${s.eventId}|${s.playerId}|${s.market}|${s.line}`;
}

function startKey(s: DurableHistoricalPropSnapshot) {
  return `${s.eventId}|${s.playerId}`;
}

function eligibleV3(s: DurableHistoricalPropSnapshot) {
  return s.snapshotType === 'REAL_PREGAME' &&
    s.sport === 'MLB' &&
    s.market === 'pitcher_strikeouts' &&
    s.historicalEligibility === 'ELIGIBLE' &&
    s.pointInTimeValid === true &&
    s.gradingStatus === 'GRADED' &&
    finite(s.actualStatistic) &&
    s.mlbPitcherKV3?.featureVector?.isPointInTimeValid === true;
}

function normalCdf(x: number): number {
  // Abramowitz-Stegun normal CDF approximation, deterministic and dependency-free.
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

function evidenceTier(n: number): FastLearningEvidenceTier {
  if (n >= 120) return 'PROMOTION_TEST';
  if (n >= 80) return 'STRONG_EVIDENCE';
  if (n >= 50) return 'MODERATE_EVIDENCE';
  if (n >= 25) return 'DEVELOPING_SIGNAL';
  return 'EARLY_EVIDENCE';
}

function pairedEvidence(snapshots: DurableHistoricalPropSnapshot[]): { paired: MlbPitcherKPairedEvidence; countRows: MlbPitcherKCountScoreRow[] } {
  const sorted = snapshots.filter(eligibleV3).sort((a, b) => Date.parse(a.sportsbookQuoteTimestamp) - Date.parse(b.sportsbookQuoteTimestamp));
  const firstByLine = new Map<string, DurableHistoricalPropSnapshot>();
  for (const s of sorted) if (!firstByLine.has(lineKey(s))) firstByLine.set(lineKey(s), s);

  const linesByStart = new Map<string, DurableHistoricalPropSnapshot[]>();
  for (const s of firstByLine.values()) {
    const key = startKey(s);
    if (!linesByStart.has(key)) linesByStart.set(key, []);
    linesByStart.get(key)!.push(s);
  }

  const startLogDeltas: number[] = [];
  const startBrierDeltas: number[] = [];
  const countRows: MlbPitcherKCountScoreRow[] = [];
  let evaluatedLineThresholds = 0;

  for (const rows of linesByStart.values()) {
    const pairedLines: PairedLine[] = [];
    for (const s of rows) {
      if (!finite(s.actualStatistic) || s.actualStatistic === s.line) continue;
      const prod = productionState(s);
      const chall = challengerState(s);
      if (!prod || !chall) continue;
      const pp = conditionalOver(prod);
      const cp = conditionalOver(chall);
      if (pp === null || cp === null) continue;
      const y = s.actualStatistic > s.line ? 1 : 0;
      const pll = -(y * Math.log(clamp(pp)) + (1 - y) * Math.log(1 - clamp(pp)));
      const cll = -(y * Math.log(clamp(cp)) + (1 - y) * Math.log(1 - clamp(cp)));
      pairedLines.push({
        productionLogLoss: pll,
        challengerLogLoss: cll,
        productionBrier: (pp - y) ** 2,
        challengerBrier: (cp - y) ** 2,
      });
      evaluatedLineThresholds++;
    }
    if (pairedLines.length) {
      startLogDeltas.push(mean(pairedLines.map((x) => x.challengerLogLoss - x.productionLogLoss))!);
      startBrierDeltas.push(mean(pairedLines.map((x) => x.challengerBrier - x.productionBrier))!);
    }

    const representative = [...rows].sort((a, b) => Date.parse(a.sportsbookQuoteTimestamp) - Date.parse(b.sportsbookQuoteTimestamp))[0];
    if (representative?.mlbPitcherKV3?.featureVector && finite(representative.actualStatistic)) {
      const nb = evaluateMlbPitcherKNegativeBinomial(representative.mlbPitcherKV3.featureVector);
      const row = countScoreRowFromNegativeBinomial(representative.actualStatistic, nb);
      if (row) countRows.push(row);
    }
  }

  const n = startLogDeltas.length;
  const pairedStats = (values: number[]) => {
    if (!values.length) return { mean: null, se: null, low: null, high: null };
    const m = mean(values)!;
    if (values.length < 2) return { mean: m, se: null, low: null, high: null };
    const variance = values.reduce((sum, x) => sum + (x - m) ** 2, 0) / (values.length - 1);
    const se = Math.sqrt(variance / values.length);
    return { mean: m, se, low: m - 1.96 * se, high: m + 1.96 * se };
  };
  const ll = pairedStats(startLogDeltas);
  const br = pairedStats(startBrierDeltas);
  let probabilityChallengerBetter: number | null = null;
  if (ll.mean !== null) {
    if (ll.se === null || ll.se < 1e-12) probabilityChallengerBetter = ll.mean < 0 ? 1 : ll.mean > 0 ? 0 : 0.5;
    else probabilityChallengerBetter = normalCdf((-ll.mean) / ll.se);
  }
  const tier = evidenceTier(n);
  const pct = probabilityChallengerBetter === null ? 'unknown' : `${(probabilityChallengerBetter * 100).toFixed(1)}%`;
  const interpretation = n === 0
    ? 'No prospective paired V3 starts have been graded yet.'
    : `${tier.replaceAll('_', ' ')}: ${n} independent starts, ${evaluatedLineThresholds} legitimate line thresholds, normal-approx P(V3 better on paired log loss) ${pct}.`;

  return {
    paired: {
      independentStarts: n,
      evaluatedLineThresholds,
      meanLogLossDelta: round(ll.mean),
      logLossDeltaStandardError: round(ll.se),
      logLossDeltaCi95Low: round(ll.low),
      logLossDeltaCi95High: round(ll.high),
      probabilityChallengerBetter: round(probabilityChallengerBetter),
      meanBrierDelta: round(br.mean),
      brierDeltaCi95Low: round(br.low),
      brierDeltaCi95High: round(br.high),
      evidenceTier: tier,
      interpretation,
    },
    countRows,
  };
}

export function buildMlbPitcherKFastLearningEvidence(
  snapshots: DurableHistoricalPropSnapshot[],
  now: Date = new Date(),
): MlbPitcherKFastLearningEvidence {
  const prospective = pairedEvidence(snapshots);
  const replay = mlbPitcherKHistoricalReplayRepository.getAll();
  const validReplay = replay.filter((r) => r.pointInTimeValid && r.featureVector.isPointInTimeValid);
  const replayCountRows = validReplay
    .map((r) => countScoreRowFromNegativeBinomial(r.actualStrikeouts, r.negativeBinomial))
    .filter((x): x is MlbPitcherKCountScoreRow => x !== null);

  const starter = mlbPitcherKStarterShadowRepository.getAll();
  const gradedStarter = starter.filter((r) => r.gradingStatus === 'GRADED' && finite(r.actualStrikeouts));
  const starterCountRows = gradedStarter
    .map((r) => countScoreRowFromNegativeBinomial(r.actualStrikeouts!, r.negativeBinomial))
    .filter((x): x is MlbPitcherKCountScoreRow => x !== null);

  return {
    evidenceVersion: 'APEX_MLB_K_FAST_LEARNING_V1',
    generatedAt: now.toISOString(),
    prospective: {
      independentStarts: prospective.paired.independentStarts,
      evaluatedLineThresholds: prospective.paired.evaluatedLineThresholds,
      paired: prospective.paired,
      challengerCountScore: aggregateCountScores(prospective.countRows),
    },
    allStarterShadow: {
      totalForecasts: starter.length,
      gradedForecasts: gradedStarter.length,
      pendingForecasts: starter.filter((r) => r.gradingStatus === 'PENDING').length,
      countScore: aggregateCountScores(starterCountRows),
    },
    historicalReplay: {
      totalRows: replay.length,
      pointInTimeValidRows: validReplay.length,
      rejectedRows: replay.length - validReplay.length,
      countScore: aggregateCountScores(replayCountRows),
      note: 'Historical replay is research/training evidence only. It cannot satisfy prospective promotion gates or create CLV evidence.',
    },
    learningSample: {
      prospectiveIndependentStarts: prospective.paired.independentStarts,
      allStarterGradedStarts: gradedStarter.length,
      historicalReplayStarts: validReplay.length,
      totalCountScoredStarts: prospective.countRows.length + starterCountRows.length + replayCountRows.length,
    },
    notes: [
      'Each pitcher start contributes at most one unit of paired-model evidence even when multiple legitimate sportsbook lines were observed.',
      'Multiple line thresholds are still scored inside each start and averaged before the paired champion/challenger comparison.',
      'Full-count Negative-Binomial scoring uses the exact final strikeout count with NLL, discrete CRPS, MAE, RMSE, and mean error.',
      'All-starter shadow forecasts are separated from sportsbook recommendations; they accelerate sports-model learning without inventing market prices.',
      'Historical point-in-time replay never counts toward live promotion or CLV gates.',
    ],
  };
}

export class MlbPitcherKFastLearningService {
  getEvidence(snapshots: DurableHistoricalPropSnapshot[], now: Date = new Date()) {
    return buildMlbPitcherKFastLearningEvidence(snapshots, now);
  }
}

export const mlbPitcherKFastLearningService = new MlbPitcherKFastLearningService();
