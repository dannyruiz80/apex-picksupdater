import {
  ChampionChallengerCohortComparison,
  ChampionChallengerModelMetrics,
  ChampionChallengerPromotionGate,
  ChampionChallengerRecentObservation,
  ChampionChallengerReport,
  DurableHistoricalPropSnapshot,
  SampleReliabilityTier,
} from '../types';
import { snapshotPersistenceService } from './snapshotPersistenceService';
import { ValueEngineService } from './valueEngineService';
import { mlbPitcherKFastLearningService } from './mlbPitcherKFastLearningService';

const EPS = 1e-9;
const MIN_OBSERVATIONS = 120;
const MIN_DECISIVE = 100;
const MIN_HYPOTHETICAL_PLAYS = 30;
const MIN_CLV_SAMPLES = 20;
const MIN_MATURE_COHORTS = 3;

const RELIABILITY_RANK: Record<SampleReliabilityTier, number> = {
  VERY_LIMITED: 0,
  LIMITED: 1,
  MODERATE: 2,
  STRONG: 3,
};

type Side = 'OVER' | 'UNDER';

type ModelState = {
  over: number | null;
  under: number | null;
  push: number;
};

type Observation = {
  snapshot: DurableHistoricalPropSnapshot;
  production: ModelState;
  challenger: ModelState;
  actual: number;
  outcome: 'OVER' | 'UNDER' | 'PUSH';
  laterPregameSnapshots: DurableHistoricalPropSnapshot[];
};

type HypotheticalPlay = {
  side: Side | null;
  netUnits: number;
  outcome: 'WIN' | 'LOSS' | 'PUSH' | 'NO_BET';
  clvProbabilityPoints: number | null;
};

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validProbability(v: unknown): v is number {
  return finite(v) && v >= 0 && v <= 1;
}

function clampProbability(p: number): number {
  return Math.min(1 - EPS, Math.max(EPS, p));
}

function round(v: number | null, digits = 6): number | null {
  return v === null || !Number.isFinite(v) ? null : Number(v.toFixed(digits));
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function americanToDecimal(odds: number | null | undefined): number | null {
  if (!finite(odds) || odds === 0) return null;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

function noVigPair(overOdds: number | null | undefined, underOdds: number | null | undefined): { over: number; under: number } | null {
  const overDec = americanToDecimal(overOdds);
  const underDec = americanToDecimal(underOdds);
  if (overDec === null || underDec === null) return null;
  const overRaw = 1 / overDec;
  const underRaw = 1 / underDec;
  const total = overRaw + underRaw;
  if (!Number.isFinite(total) || total <= 0) return null;
  return { over: overRaw / total, under: underRaw / total };
}

function normalizeModel(over: unknown, under: unknown, push: unknown): ModelState | null {
  if (!validProbability(over)) return null;
  const pushValue = validProbability(push) ? push : 0;
  let underValue: number;
  if (validProbability(under)) underValue = under;
  else underValue = Math.max(0, 1 - over - pushValue);
  if (!validProbability(underValue)) return null;
  const total = over + underValue + pushValue;
  if (!Number.isFinite(total) || total <= 0 || Math.abs(total - 1) > 0.08) return null;
  return {
    over: Math.max(0, over / total),
    under: Math.max(0, underValue / total),
    push: Math.max(0, pushValue / total),
  };
}

function getProductionState(s: DurableHistoricalPropSnapshot): ModelState | null {
  const over = s.overApexProbability ?? (s.side === 'OVER' ? s.apexProbability : null);
  const push = s.mlbPitcherKV3?.productionPushProbability ?? null;
  const under = s.underApexProbability ?? null;
  return normalizeModel(over, under, push);
}

function getChallengerState(s: DurableHistoricalPropSnapshot): ModelState | null {
  const over = s.mlbPitcherKV3?.shadowOverProbability ?? null;
  const push = s.mlbPitcherKV3?.shadowPushProbability ?? s.mlbPitcherKV3?.negativeBinomialPushProbability ?? 0;
  const under = s.mlbPitcherKV3?.shadowUnderProbability ?? null;
  return normalizeModel(over, under, push);
}

function conditionalOver(state: ModelState): number | null {
  if (state.over === null || state.under === null) return null;
  const decisive = state.over + state.under;
  return decisive > 0 ? state.over / decisive : null;
}

function outcomeFor(s: DurableHistoricalPropSnapshot): 'OVER' | 'UNDER' | 'PUSH' | null {
  if (!finite(s.actualStatistic)) return null;
  if (s.actualStatistic > s.line) return 'OVER';
  if (s.actualStatistic < s.line) return 'UNDER';
  return 'PUSH';
}

function uniqueKey(s: DurableHistoricalPropSnapshot): string {
  return `${s.eventId}|${s.playerId}|${s.market}|${s.line}`;
}

function samePriceTrack(a: DurableHistoricalPropSnapshot, b: DurableHistoricalPropSnapshot): boolean {
  return uniqueKey(a) === uniqueKey(b) && a.sportsbook === b.sportsbook;
}

function buildObservations(snapshots: DurableHistoricalPropSnapshot[]): { observations: Observation[]; sourceCount: number; skipped: number } {
  const allV3 = snapshots
    .filter((s) =>
      s.snapshotType === 'REAL_PREGAME' &&
      s.sport === 'MLB' &&
      s.market === 'pitcher_strikeouts' &&
      s.historicalEligibility === 'ELIGIBLE' &&
      s.pointInTimeValid === true &&
      s.mlbPitcherKV3?.featureVector?.isPointInTimeValid === true &&
      Boolean(s.mlbPitcherKV3)
    )
    .sort((a, b) => Date.parse(a.snapshotCreatedAt) - Date.parse(b.snapshotCreatedAt));

  const source = allV3.filter((s) => s.gradingStatus === 'GRADED' && finite(s.actualStatistic));
  const firstByOutcome = new Map<string, DurableHistoricalPropSnapshot>();
  for (const s of source) {
    if (!firstByOutcome.has(uniqueKey(s))) firstByOutcome.set(uniqueKey(s), s);
  }

  const observations: Observation[] = [];
  let skipped = 0;
  for (const first of firstByOutcome.values()) {
    const production = getProductionState(first);
    const challenger = getChallengerState(first);
    const outcome = outcomeFor(first);
    if (!production || !challenger || !outcome || !finite(first.actualStatistic)) {
      skipped++;
      continue;
    }
    const eventMs = Date.parse(first.eventStartTime);
    const firstQuoteMs = Date.parse(first.sportsbookQuoteTimestamp);
    const laterPregameSnapshots = allV3
      .filter((s) => {
        const quoteMs = Date.parse(s.sportsbookQuoteTimestamp);
        return samePriceTrack(first, s) &&
          Number.isFinite(firstQuoteMs) &&
          Number.isFinite(quoteMs) &&
          quoteMs > firstQuoteMs &&
          Number.isFinite(eventMs) &&
          quoteMs < eventMs;
      })
      .sort((a, b) => Date.parse(a.sportsbookQuoteTimestamp) - Date.parse(b.sportsbookQuoteTimestamp));

    observations.push({
      snapshot: first,
      production,
      challenger,
      actual: first.actualStatistic,
      outcome,
      laterPregameSnapshots,
    });
  }

  return { observations, sourceCount: allV3.length, skipped };
}

function logLoss(rows: Observation[], stateSelector: (o: Observation) => ModelState): number | null {
  const decisive = rows.filter((o) => o.outcome !== 'PUSH');
  if (!decisive.length) return null;
  let sum = 0;
  for (const row of decisive) {
    const p = conditionalOver(stateSelector(row));
    if (p === null) return null;
    const y = row.outcome === 'OVER' ? 1 : 0;
    const cp = clampProbability(p);
    sum += -(y * Math.log(cp) + (1 - y) * Math.log(1 - cp));
  }
  return sum / decisive.length;
}

function brier(rows: Observation[], stateSelector: (o: Observation) => ModelState): number | null {
  const decisive = rows.filter((o) => o.outcome !== 'PUSH');
  if (!decisive.length) return null;
  let sum = 0;
  for (const row of decisive) {
    const p = conditionalOver(stateSelector(row));
    if (p === null) return null;
    const y = row.outcome === 'OVER' ? 1 : 0;
    sum += (p - y) ** 2;
  }
  return sum / decisive.length;
}

function expectedCalibrationError(rows: Observation[], stateSelector: (o: Observation) => ModelState): number | null {
  const decisive = rows.filter((o) => o.outcome !== 'PUSH');
  if (!decisive.length) return null;
  const bins = Array.from({ length: 5 }, () => [] as Array<{ p: number; y: number }>);
  for (const row of decisive) {
    const p = conditionalOver(stateSelector(row));
    if (p === null) continue;
    const idx = Math.min(4, Math.floor(p * 5));
    bins[idx].push({ p, y: row.outcome === 'OVER' ? 1 : 0 });
  }
  let ece = 0;
  for (const bin of bins) {
    if (!bin.length) continue;
    const avgP = mean(bin.map((x) => x.p))!;
    const avgY = mean(bin.map((x) => x.y))!;
    ece += (bin.length / decisive.length) * Math.abs(avgP - avgY);
  }
  return ece;
}

function evalSide(state: ModelState, side: Side, snapshot: DurableHistoricalPropSnapshot) {
  const pWin = side === 'OVER' ? state.over : state.under;
  const pLoss = side === 'OVER' ? state.under : state.over;
  const american = side === 'OVER' ? snapshot.overOddsAmerican : snapshot.underOddsAmerican;
  const decimal = americanToDecimal(american);
  if (pWin === null || pLoss === null || decimal === null) return null;
  const breakEven = 1 / decimal;
  const edge = pWin - breakEven;
  const ev = pWin * (decimal - 1) - pLoss;
  const reliabilityPass = RELIABILITY_RANK[snapshot.reliabilityTier] >= RELIABILITY_RANK[ValueEngineService.THRESHOLDS.minReliabilityTier];
  const qualifies =
    reliabilityPass &&
    edge >= ValueEngineService.THRESHOLDS.minModelEdge &&
    ev > 0 &&
    ev * 100 >= ValueEngineService.THRESHOLDS.minEVPercent;
  return { side, pWin, pLoss, decimal, breakEven, edge, ev, qualifies };
}

function clvForSide(o: Observation, side: Side): number | null {
  const entry = noVigPair(o.snapshot.overOddsAmerican, o.snapshot.underOddsAmerican);
  const latest = o.laterPregameSnapshots.at(-1);
  if (!entry || !latest) return null;
  const close = noVigPair(latest.overOddsAmerican, latest.underOddsAmerican);
  if (!close) return null;
  // Positive value means the latest observed pregame market assigned a higher fair probability
  // to the side than at our original entry observation (a favorable closing-line movement proxy).
  return ((side === 'OVER' ? close.over - entry.over : close.under - entry.under) * 100);
}

function hypotheticalPlay(o: Observation, state: ModelState): HypotheticalPlay {
  const over = evalSide(state, 'OVER', o.snapshot);
  const under = evalSide(state, 'UNDER', o.snapshot);
  const qualifying = [over, under].filter((x): x is NonNullable<typeof x> => Boolean(x?.qualifies));
  if (!qualifying.length) return { side: null, netUnits: 0, outcome: 'NO_BET', clvProbabilityPoints: null };
  qualifying.sort((a, b) => b.ev - a.ev);
  const best = qualifying[0];
  let outcome: HypotheticalPlay['outcome'];
  if (o.outcome === 'PUSH') outcome = 'PUSH';
  else if (o.outcome === best.side) outcome = 'WIN';
  else outcome = 'LOSS';
  const netUnits = outcome === 'WIN' ? best.decimal - 1 : outcome === 'LOSS' ? -1 : 0;
  return {
    side: best.side,
    netUnits,
    outcome,
    clvProbabilityPoints: clvForSide(o, best.side),
  };
}

function metricsFor(
  observations: Observation[],
  label: 'PRODUCTION' | 'CHALLENGER',
  modelVersion: string,
  stateSelector: (o: Observation) => ModelState
): ChampionChallengerModelMetrics {
  const decisive = observations.filter((o) => o.outcome !== 'PUSH');
  const probs = decisive.map((o) => conditionalOver(stateSelector(o))).filter((x): x is number => x !== null);
  const actual = decisive.map((o) => (o.outcome === 'OVER' ? 1 : 0));
  const plays = observations.map((o) => hypotheticalPlay(o, stateSelector(o)));
  const actualOverRate = mean(actual);
  const meanPredictedOver = mean(probs);
  const calibrationGap = actualOverRate !== null && meanPredictedOver !== null
    ? Math.abs(meanPredictedOver - actualOverRate)
    : null;
  const directionalAccuracy = decisive.length
    ? decisive.reduce((n, o) => {
        const p = conditionalOver(stateSelector(o));
        if (p === null) return n;
        return n + (((p >= 0.5) ? 'OVER' : 'UNDER') === o.outcome ? 1 : 0);
      }, 0) / decisive.length
    : null;
  const qualified = plays.filter((p) => p.side !== null);
  const netUnits = qualified.reduce((s, p) => s + p.netUnits, 0);
  const clv = qualified.map((p) => p.clvProbabilityPoints).filter((x): x is number => x !== null);

  return {
    modelLabel: label,
    modelVersion,
    observations: observations.length,
    decisiveObservations: decisive.length,
    pushes: observations.length - decisive.length,
    overWins: observations.filter((o) => o.outcome === 'OVER').length,
    underWins: observations.filter((o) => o.outcome === 'UNDER').length,
    meanPredictedOver: round(meanPredictedOver),
    actualOverRate: round(actualOverRate),
    calibrationGap: round(calibrationGap),
    expectedCalibrationError: round(expectedCalibrationError(observations, stateSelector)),
    logLoss: round(logLoss(observations, stateSelector)),
    brierScore: round(brier(observations, stateSelector)),
    directionalAccuracy: round(directionalAccuracy),
    hypotheticalQualifiedPlays: qualified.length,
    hypotheticalWins: qualified.filter((p) => p.outcome === 'WIN').length,
    hypotheticalLosses: qualified.filter((p) => p.outcome === 'LOSS').length,
    hypotheticalPushes: qualified.filter((p) => p.outcome === 'PUSH').length,
    netUnits: round(netUnits, 4) ?? 0,
    roiPercent: qualified.length ? round((netUnits / qualified.length) * 100, 2) : null,
    clvSamples: clv.length,
    averageObservedClvProbabilityPoints: round(mean(clv), 3),
  };
}

function lineCohort(o: Observation): string {
  const line = o.snapshot.line;
  if (line <= 4.5) return '<= 4.5';
  if (line <= 5.5) return '5.0–5.5';
  if (line <= 6.5) return '6.0–6.5';
  return '>= 7.0';
}

function opponentKCohort(o: Observation): string | null {
  const rate = o.snapshot.mlbPitcherKV3?.featureVector.opponentStrikeoutRate;
  if (!finite(rate)) return null;
  if (rate < 0.22) return '< 22%';
  if (rate <= 0.25) return '22–25%';
  return '> 25%';
}

function workloadCohort(o: Observation): string | null {
  const bf = o.snapshot.mlbPitcherKV3?.featureVector.expectedBattersFaced;
  if (!finite(bf)) return null;
  if (bf < 22) return '< 22 BF';
  if (bf <= 25) return '22–25 BF';
  return '> 25 BF';
}

function dataQualityCohort(o: Observation): string | null {
  return o.snapshot.mlbPitcherKV3?.featureVector.dataQuality ?? null;
}

function homeAwayCohort(o: Observation): string | null {
  return o.snapshot.mlbPitcherKV3?.featureVector.pitcherTeamVenueRole ?? null;
}

function cohortComparisons(observations: Observation[]): ChampionChallengerCohortComparison[] {
  const definitions: Array<{
    type: ChampionChallengerCohortComparison['cohortType'];
    getter: (o: Observation) => string | null;
  }> = [
    { type: 'LINE', getter: lineCohort },
    { type: 'OPPONENT_K_RATE', getter: opponentKCohort },
    { type: 'WORKLOAD', getter: workloadCohort },
    { type: 'DATA_QUALITY', getter: dataQualityCohort },
    { type: 'HOME_AWAY', getter: homeAwayCohort },
  ];
  const out: ChampionChallengerCohortComparison[] = [];
  for (const def of definitions) {
    const groups = new Map<string, Observation[]>();
    for (const o of observations) {
      if (o.outcome === 'PUSH') continue;
      const label = def.getter(o);
      if (!label) continue;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(o);
    }
    for (const [cohort, rows] of groups.entries()) {
      const pLL = logLoss(rows, (o) => o.production);
      const cLL = logLoss(rows, (o) => o.challenger);
      const pB = brier(rows, (o) => o.production);
      const cB = brier(rows, (o) => o.challenger);
      out.push({
        cohortType: def.type,
        cohort,
        sampleSize: rows.length,
        productionLogLoss: round(pLL),
        challengerLogLoss: round(cLL),
        logLossDelta: pLL !== null && cLL !== null ? round(cLL - pLL) : null,
        productionBrier: round(pB),
        challengerBrier: round(cB),
        challengerBetter: pLL !== null && cLL !== null ? cLL < pLL : null,
      });
    }
  }
  return out.sort((a, b) => a.cohortType.localeCompare(b.cohortType) || b.sampleSize - a.sampleSize || a.cohort.localeCompare(b.cohort));
}

function gate(gate: string, passed: boolean, actual: string, required: string, blocking = true): ChampionChallengerPromotionGate {
  return { gate, passed, actual, required, blocking };
}

function promotionGates(
  production: ChampionChallengerModelMetrics,
  challenger: ChampionChallengerModelMetrics,
  cohorts: ChampionChallengerCohortComparison[],
  independentStarts: number
): ChampionChallengerPromotionGate[] {
  const mature = cohorts.filter((c) => c.sampleSize >= 20 && c.logLossDelta !== null);
  const severeDegradation = mature.filter((c) => (c.logLossDelta ?? 0) > 0.03);
  const llImprovement = production.logLoss !== null && challenger.logLoss !== null
    ? production.logLoss - challenger.logLoss
    : null;
  const brierImprovement = production.brierScore !== null && challenger.brierScore !== null
    ? production.brierScore - challenger.brierScore
    : null;

  return [
    gate('Independent prospective V3 starts', independentStarts >= MIN_OBSERVATIONS, `${independentStarts}`, `>= ${MIN_OBSERVATIONS}`),
    gate('Independent decisive starts', independentStarts >= MIN_DECISIVE, `${independentStarts}`, `>= ${MIN_DECISIVE}`),
    gate('Log-loss improvement', llImprovement !== null && llImprovement >= 0.005, llImprovement === null ? 'N/A' : llImprovement.toFixed(4), '>= 0.005 lower than production'),
    gate('Brier improvement', brierImprovement !== null && brierImprovement >= 0.002, brierImprovement === null ? 'N/A' : brierImprovement.toFixed(4), '>= 0.002 lower than production'),
    gate(
      'Calibration stability',
      challenger.expectedCalibrationError !== null &&
        challenger.calibrationGap !== null &&
        challenger.expectedCalibrationError <= 0.06 &&
        challenger.calibrationGap <= 0.03,
      challenger.expectedCalibrationError === null || challenger.calibrationGap === null
        ? 'N/A'
        : `ECE ${challenger.expectedCalibrationError.toFixed(4)}; mean gap ${challenger.calibrationGap.toFixed(4)}`,
      'ECE <= 0.060 and mean calibration gap <= 0.030'
    ),
    gate('Challenger actionable sample', challenger.hypotheticalQualifiedPlays >= MIN_HYPOTHETICAL_PLAYS, `${challenger.hypotheticalQualifiedPlays}`, `>= ${MIN_HYPOTHETICAL_PLAYS}`),
    gate('Challenger flat-stake ROI', challenger.roiPercent !== null && challenger.roiPercent >= 0, challenger.roiPercent === null ? 'N/A' : `${challenger.roiPercent.toFixed(2)}%`, '>= 0%', false),
    gate('Observed-close CLV coverage', challenger.clvSamples >= MIN_CLV_SAMPLES, `${challenger.clvSamples}`, `>= ${MIN_CLV_SAMPLES}`),
    gate(
      'Observed-close CLV direction',
      challenger.averageObservedClvProbabilityPoints !== null && challenger.averageObservedClvProbabilityPoints >= 0,
      challenger.averageObservedClvProbabilityPoints === null ? 'N/A' : `${challenger.averageObservedClvProbabilityPoints.toFixed(3)} pp`,
      '>= 0.000 pp'
    ),
    gate('Mature cohort coverage', mature.length >= MIN_MATURE_COHORTS, `${mature.length}`, `>= ${MIN_MATURE_COHORTS}`),
    gate('No severe cohort regression', severeDegradation.length === 0 && mature.length >= MIN_MATURE_COHORTS, `${severeDegradation.length} severe regressions`, '0 cohorts with log-loss degradation > 0.03'),
  ];
}

function recentRows(observations: Observation[]): ChampionChallengerRecentObservation[] {
  return [...observations]
    .sort((a, b) => Date.parse(b.snapshot.eventStartTime) - Date.parse(a.snapshot.eventStartTime))
    .slice(0, 20)
    .map((o) => {
      const pp = conditionalOver(o.production);
      const cp = conditionalOver(o.challenger);
      const y = o.outcome === 'PUSH' ? null : o.outcome === 'OVER' ? 1 : 0;
      return {
        snapshotId: o.snapshot.snapshotId,
        eventStartTime: o.snapshot.eventStartTime,
        playerName: o.snapshot.playerName,
        opponent: o.snapshot.opponent,
        line: o.snapshot.line,
        actualStatistic: o.actual,
        outcome: o.outcome,
        productionOverProbability: round(pp),
        challengerOverProbability: round(cp),
        productionError: y === null || pp === null ? null : round(Math.abs(pp - y)),
        challengerError: y === null || cp === null ? null : round(Math.abs(cp - y)),
        productionQualifiedSide: hypotheticalPlay(o, o.production).side,
        challengerQualifiedSide: hypotheticalPlay(o, o.challenger).side,
      };
    });
}

export function buildChampionChallengerReportFromSnapshots(
  snapshots: DurableHistoricalPropSnapshot[],
  now: Date = new Date()
): ChampionChallengerReport {
  const built = buildObservations(snapshots);
  const championVersion = built.observations[0]?.snapshot.modelVersion ?? 'APEX_BASELINE_V1';
  const production = metricsFor(built.observations, 'PRODUCTION', championVersion, (o) => o.production);
  const challenger = metricsFor(built.observations, 'CHALLENGER', 'APEX_PITCHER_K_V3_SHADOW', (o) => o.challenger);
  const cohorts = cohortComparisons(built.observations);
  const fastLearning = mlbPitcherKFastLearningService.getEvidence(snapshots, now);
  const independentStarts = fastLearning.prospective.independentStarts;
  const gates = promotionGates(production, challenger, cohorts, independentStarts);
  const blockingFailures = gates.filter((g) => g.blocking && !g.passed).map((g) => g.gate);

  let status: ChampionChallengerReport['promotion']['status'];
  if (independentStarts < MIN_OBSERVATIONS || challenger.clvSamples < MIN_CLV_SAMPLES) status = 'COLLECTING_EVIDENCE';
  else if (blockingFailures.length === 0) status = 'REVIEW_ELIGIBLE';
  else status = 'HOLD_PRODUCTION';

  const delta = (c: number | null, p: number | null, digits = 6) => c !== null && p !== null ? round(c - p, digits) : null;

  return {
    reportVersion: 'APEX_CHAMPION_CHALLENGER_V1',
    generatedAt: now.toISOString(),
    sport: 'MLB',
    market: 'pitcher_strikeouts',
    championModelVersion: championVersion,
    challengerModelVersion: 'APEX_PITCHER_K_V3_SHADOW',
    sourceSnapshotCount: built.sourceCount,
    deduplicatedObservationCount: built.observations.length,
    skippedObservationCount: built.skipped,
    production,
    challenger,
    deltas: {
      logLoss: delta(challenger.logLoss, production.logLoss),
      brierScore: delta(challenger.brierScore, production.brierScore),
      calibrationGap: delta(challenger.calibrationGap, production.calibrationGap),
      directionalAccuracy: delta(challenger.directionalAccuracy, production.directionalAccuracy),
      roiPercent: delta(challenger.roiPercent, production.roiPercent, 2),
      observedClvProbabilityPoints: delta(challenger.averageObservedClvProbabilityPoints, production.averageObservedClvProbabilityPoints, 3),
    },
    cohorts,
    promotion: {
      status,
      automaticPromotionAllowed: false,
      gates,
      blockingFailures,
      summary: status === 'REVIEW_ELIGIBLE'
        ? 'Challenger has cleared the configured evidence gates. Manual model review is allowed; automatic production promotion remains prohibited.'
        : status === 'COLLECTING_EVIDENCE'
          ? 'V3 is still accumulating prospective graded and observed-close evidence. Production remains champion.'
          : 'The sample is mature enough to evaluate, but one or more blocking quality gates failed. Production remains champion.',
    },
    recentObservations: recentRows(built.observations),
    fastLearning,
    notes: [
      'Only the earliest V3 point-in-time snapshot per event/player/market/line is scored; promotion sample gates use independent pitcher starts so multiple lines cannot inflate evidence.',
      'Later snapshots from the same sportsbook are used only as a latest-observed-pregame closing-line proxy; they are not counted as new prediction outcomes.',
      'Log loss, Brier score, calibration, and directional accuracy exclude pushes and normalize Over probability over decisive (Over/Under) mass.',
      'Hypothetical ROI applies the same baseline reliability, edge, and EV thresholds to both models. ROI is diagnostic and is not sufficient for promotion by itself.',
      'No automatic promotion path exists. REVIEW_ELIGIBLE means manual review may begin; it does not switch the production model.',
    ],
  };
}

export class ChampionChallengerService {
  getReport(now: Date = new Date()): ChampionChallengerReport {
    return buildChampionChallengerReportFromSnapshots(snapshotPersistenceService.getRealPregameSnapshots(), now);
  }
}

export const championChallengerService = new ChampionChallengerService();
