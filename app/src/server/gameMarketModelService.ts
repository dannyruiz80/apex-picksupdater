import {
  ApexSport,
  MarketType,
  NormalizedApexEventMarkets,
  NormalizedApexGame,
  NormalizedMarketOutcome,
  SampleReliabilityTier,
} from '../types';
import { gameTeamHistoryService, TeamHistorySummary } from './gameTeamHistoryService';
import { gameMarketContextService, GameMarketContextV2 } from './gameMarketContextService.js';

export type GameModelSelectionSide = 'HOME' | 'AWAY' | 'DRAW' | 'OVER' | 'UNDER';
export type GameModelValidationStatus = 'EARLY_EVIDENCE';

export interface GameMarketProjectionV1 {
  modelVersion: 'APEX_GAME_MARKET_V1';
  generatedAt: string;
  asOf: string;
  sport: ApexSport;
  eventId: string;
  status: 'AVAILABLE' | 'INSUFFICIENT_DATA' | 'UNSUPPORTED';
  reason: string | null;
  validationStatus: GameModelValidationStatus;
  source: 'ESPN_TEAM_SCHEDULE_HISTORY';
  pointInTimeValid: boolean;
  reliabilityTier: SampleReliabilityTier;
  homeSampleCount: number;
  awaySampleCount: number;
  expectedHomeScore: number | null;
  expectedAwayScore: number | null;
  expectedMargin: number | null;
  expectedTotal: number | null;
  marginStdDev: number | null;
  totalStdDev: number | null;
  homeWinProbability: number | null;
  awayWinProbability: number | null;
  drawProbability: number | null;
  homeHistory: TeamHistorySummary;
  awayHistory: TeamHistorySummary;
  contextV2: GameMarketContextV2 | null;
  shadowModelVersion: 'APEX_GAME_MARKET_V2_SHADOW' | null;
  shadowExpectedHomeScore: number | null;
  shadowExpectedAwayScore: number | null;
  shadowExpectedMargin: number | null;
  shadowExpectedTotal: number | null;
  shadowHomeWinProbability: number | null;
  shadowAwayWinProbability: number | null;
  notes: string[];
}

export type GameMarketIntegrityStatus = 'QUALIFIED' | 'REVIEW' | 'VERIFY' | 'PASS';
export type GameMarketEvTier = 'NORMAL' | 'HEIGHTENED' | 'EXTREME';
export type V2ContributionStatus = 'MATERIAL' | 'NO_MATERIAL_ADJUSTMENT' | 'UNAVAILABLE';

export interface GameMarketEvidenceSlice {
  independentDecisiveObservations: number;
  calibrationGap: number | null;
  expectedCalibrationError?: number | null;
  brierScore?: number | null;
  logLoss?: number | null;
  evidenceTier?: 'EARLY' | 'DEVELOPING' | 'MODERATE' | 'MATURE';
  recommendedModelWeight?: number;
}

export interface GameMarketEvidenceContext extends GameMarketEvidenceSlice {
  byMarket?: Partial<Record<MarketType, GameMarketEvidenceSlice>>;
}

export interface GameMarketCandidateV1 {
  candidateId: string;
  marketType: MarketType;
  side: GameModelSelectionSide;
  selectionLabel: string;
  point: number | null;
  sportsbook: string;
  oddsAmerican: number;
  oddsDecimal: number;
  quoteTimestamp: string;
  marketDepth: number;
  // Raw independent model probability. Sportsbook information never enters this number.
  modelProbability: number;
  // Conservative probability used only for bet qualification while V1 is early-evidence.
  decisionProbability: number;
  decisionReferenceProbability: number;
  probabilityShrinkageWeight: number;
  modelEvidenceObservations: number;
  calibrationAdjustedProbability: number;
  prospectiveCalibrationAdjustmentPP: number;
  calibrationEvidenceTier: 'EARLY' | 'DEVELOPING' | 'MODERATE' | 'MATURE';
  calibrationExpectedError: number | null;
  calibrationBrierScore: number | null;
  bookOffers: Array<{ sportsbook: string; oddsAmerican: number; quoteTimestamp: string }>;
  pushProbability: number;
  breakEvenProbability: number;
  marketConsensusProbability: number | null;
  modelMarketDisagreementPP: number | null;
  rawEdgePercentagePoints: number;
  rawExpectedValuePercent: number;
  edgePercentagePoints: number;
  expectedValuePercent: number;
  evTier: GameMarketEvTier;
  integrityStatus: GameMarketIntegrityStatus;
  integrityReasonCodes: string[];
  crossMarketConsistent: boolean;
  qualifies: boolean;
  reasonCodes: string[];
  shadowModelProbability?: number | null;
  shadowSupportsProduction?: boolean | null;
  v2ContributionPP?: number | null;
  v2ContributionStatus?: V2ContributionStatus;
}


export interface GameMarketEvaluationV1 {
  model: GameMarketProjectionV1;
  candidates: GameMarketCandidateV1[];
  qualified: GameMarketCandidateV1[];
  evaluatedAt: string;
}

const MIN_EDGE = 0.03;
const MIN_EV_PERCENT = 3.0;
const MAX_QUOTE_AGE_MS = 10 * 60 * 1000;
const MIN_MARKET_DEPTH = 2;

// Integrity thresholds intentionally sit above the normal value gate.
// They are not tuned to maximize historical ROI; they exist to suppress implausibly large early-model edges.
const REVIEW_MARKET_DISAGREEMENT_PP = 8.0;
const VERIFY_MARKET_DISAGREEMENT_PP = 12.0;
const REVIEW_EV_PERCENT = 10.0;
const VERIFY_EV_PERCENT = 20.0;
const REVIEW_CALIBRATION_GAP = 0.05;
const MATERIAL_V2_DELTA_PP = 1.0;
const VERIFY_V2_FLIP_DELTA_PP = 8.0;

function clamp(x: number, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, x)); }
function mean(values: number[]): number | null { return values.length ? values.reduce((a,b)=>a+b,0)/values.length : null; }

// Abramowitz-Stegun approximation, deterministic and dependency-free.
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  let p = 1 - d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  if (x < 0) p = 1 - p;
  return clamp(p);
}

function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function reliability(home: TeamHistorySummary, away: TeamHistorySummary): SampleReliabilityTier {
  const n = Math.min(home.sampleCount, away.sampleCount);
  if (n >= 20) return 'STRONG';
  if (n >= 12) return 'MODERATE';
  if (n >= 6) return 'LIMITED';
  return 'VERY_LIMITED';
}

function pooledScoringMean(home: TeamHistorySummary, away: TeamHistorySummary): number | null {
  const vals = [
    home.weightedPointsFor, home.weightedPointsAgainst,
    away.weightedPointsFor, away.weightedPointsAgainst,
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return mean(vals);
}

function shrink(value: number | null, prior: number, n: number, k = 8): number {
  if (value === null || !Number.isFinite(value)) return prior;
  const w = n / (n + k);
  return value * w + prior * (1 - w);
}

function adjustedRate(summary: TeamHistorySummary, side: 'FOR' | 'AGAINST', venue: 'HOME' | 'AWAY', prior: number): number {
  const overall = side === 'FOR' ? summary.weightedPointsFor : summary.weightedPointsAgainst;
  const venueValue = side === 'FOR' ? summary.venuePointsFor : summary.venuePointsAgainst;
  const shrunkOverall = shrink(overall, prior, summary.sampleCount);
  if (venueValue === null || summary.venueSampleCount < 4) return shrunkOverall;
  // Venue split is useful but deliberately capped to 25% of the final rate to reduce small-sample volatility.
  const shrunkVenue = shrink(venueValue, prior, summary.venueSampleCount, 6);
  return 0.75 * shrunkOverall + 0.25 * shrunkVenue;
}

function sportUncertaintyFloor(sport: ApexSport): { margin: number; total: number } {
  switch (sport) {
    case 'MLB': return { margin: 3.0, total: 4.2 };
    case 'NFL': return { margin: 10.5, total: 12.0 };
    case 'NBA': return { margin: 11.5, total: 15.0 };
    case 'WNBA': return { margin: 10.5, total: 13.5 };
    case 'NHL': return { margin: 2.0, total: 2.2 };
    default: return { margin: 1.4, total: 2.0 };
  }
}

function expectedScores(home: TeamHistorySummary, away: TeamHistorySummary): { home: number; away: number } | null {
  const prior = pooledScoringMean(home, away);
  if (prior === null) return null;
  const homeOff = adjustedRate(home, 'FOR', 'HOME', prior);
  const homeDef = adjustedRate(home, 'AGAINST', 'HOME', prior);
  const awayOff = adjustedRate(away, 'FOR', 'AWAY', prior);
  const awayDef = adjustedRate(away, 'AGAINST', 'AWAY', prior);
  // Offense and opponent defense get equal weight. No sportsbook number enters this projection.
  return {
    home: Math.max(0.01, (homeOff + awayDef) / 2),
    away: Math.max(0.01, (awayOff + homeDef) / 2),
  };
}

export function buildWnbaExpectedScores(home: TeamHistorySummary, away: TeamHistorySummary): { home: number; away: number; recentBlendWeight: number } | null {
  const base = expectedScores(home, away);
  if (!base) return null;
  if (home.records.length < 5 || away.records.length < 5) return { ...base, recentBlendWeight: 0 };
  const avg = (xs: number[]) => xs.reduce((a,b)=>a+b,0) / xs.length;
  const h5 = home.records.slice(0,5), a5 = away.records.slice(0,5);
  const recentHome = (avg(h5.map(r=>r.pointsFor)) + avg(a5.map(r=>r.pointsAgainst))) / 2;
  const recentAway = (avg(a5.map(r=>r.pointsFor)) + avg(h5.map(r=>r.pointsAgainst))) / 2;
  // Prospective, bounded WNBA recency blend. The base model already contains a decayed season sample
  // and venue splits; this only lets the five most recent completed games contribute modestly.
  const recentBlendWeight = Math.min(home.sampleCount, away.sampleCount) >= 12 ? 0.20 : 0.12;
  const boundedRecentHome = base.home + clampValue(recentHome - base.home, -10, 10);
  const boundedRecentAway = base.away + clampValue(recentAway - base.away, -10, 10);
  return {
    home: Math.max(0.01, base.home * (1 - recentBlendWeight) + boundedRecentHome * recentBlendWeight),
    away: Math.max(0.01, base.away * (1 - recentBlendWeight) + boundedRecentAway * recentBlendWeight),
    recentBlendWeight,
  };
}


export interface WnbaHistoricalProjectionCore {
  reliabilityTier: SampleReliabilityTier;
  expectedHomeScore: number;
  expectedAwayScore: number;
  expectedMargin: number;
  expectedTotal: number;
  marginStdDev: number;
  totalStdDev: number;
  homeWinProbability: number;
  awayWinProbability: number;
  recentBlendWeight: number;
}

export function buildWnbaHistoricalProjection(home: TeamHistorySummary, away: TeamHistorySummary): WnbaHistoricalProjectionCore | null {
  const scores = buildWnbaExpectedScores(home, away);
  if (!scores) return null;
  const expectedMargin = scores.home - scores.away;
  const expectedTotal = scores.home + scores.away;
  const floor = sportUncertaintyFloor('WNBA');
  const marginObserved = mean([home.marginStdDev, away.marginStdDev].filter((v): v is number => v !== null));
  const totalObserved = mean([home.totalStdDev, away.totalStdDev].filter((v): v is number => v !== null));
  const marginStdDev = Math.max(floor.margin, marginObserved ?? floor.margin);
  const totalStdDev = Math.max(floor.total, totalObserved ?? floor.total);
  const homeWinProbability = normalCdf(expectedMargin / marginStdDev);
  return {
    reliabilityTier: reliability(home, away),
    expectedHomeScore: scores.home,
    expectedAwayScore: scores.away,
    expectedMargin,
    expectedTotal,
    marginStdDev,
    totalStdDev,
    homeWinProbability,
    awayWinProbability: 1 - homeWinProbability,
    recentBlendWeight: scores.recentBlendWeight,
  };
}

function soccerOutcomeProbabilities(lambdaHome: number, lambdaAway: number) {
  let home = 0, draw = 0, away = 0;
  const maxGoals = 12;
  for (let h = 0; h <= maxGoals; h++) {
    const ph = poissonPmf(h, lambdaHome);
    for (let a = 0; a <= maxGoals; a++) {
      const p = ph * poissonPmf(a, lambdaAway);
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }
  const sum = home + draw + away;
  return sum > 0 ? { home: home/sum, draw: draw/sum, away: away/sum } : { home: 1/3, draw: 1/3, away: 1/3 };
}

function soccerLineProbability(lambdaHome: number, lambdaAway: number, type: MarketType, side: GameModelSelectionSide, point: number): { win: number; push: number } {
  let win = 0, push = 0, totalMass = 0;
  const maxGoals = 12;
  for (let h = 0; h <= maxGoals; h++) {
    const ph = poissonPmf(h, lambdaHome);
    for (let a = 0; a <= maxGoals; a++) {
      const p = ph * poissonPmf(a, lambdaAway);
      totalMass += p;
      let result = 0;
      if (type === 'TOTAL') result = side === 'OVER' ? (h+a)-point : point-(h+a);
      else if (type === 'SPREAD') result = side === 'HOME' ? (h-a)+point : (a-h)+point;
      if (result > 1e-9) win += p;
      else if (Math.abs(result) <= 1e-9) push += p;
    }
  }
  return totalMass > 0 ? { win: win/totalMass, push: push/totalMass } : { win: 0.5, push: 0 };
}

function normalLineProbability(mu: number, sigma: number, type: MarketType, side: GameModelSelectionSide, point: number): { win: number; push: number } {
  if (type === 'TOTAL') {
    const transformedMean = side === 'OVER' ? mu - point : point - mu;
    const win = normalCdf(transformedMean / sigma);
    const isInteger = Math.abs(point - Math.round(point)) < 1e-9;
    if (!isInteger) return { win, push: 0 };
    const pAt = normalCdf((point + 0.5 - mu)/sigma) - normalCdf((point - 0.5 - mu)/sigma);
    return { win: Math.max(0, win - pAt/2), push: clamp(pAt) };
  }
  const transformedMean = side === 'HOME' ? mu + point : -mu + point;
  const win = normalCdf(transformedMean / sigma);
  const isInteger = Math.abs(point - Math.round(point)) < 1e-9;
  if (!isInteger) return { win, push: 0 };
  const threshold = side === 'HOME' ? -point : point;
  const pAt = normalCdf((threshold + 0.5 - mu)/sigma) - normalCdf((threshold - 0.5 - mu)/sigma);
  return { win: Math.max(0, win - pAt/2), push: clamp(pAt) };
}

function implied(american: number): number {
  return american < 0 ? Math.abs(american)/(Math.abs(american)+100) : 100/(american+100);
}
function decimal(american: number): number {
  return american > 0 ? 1 + american/100 : 1 + 100/Math.abs(american);
}
function quoteAgeMs(timestamp: string) {
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? Math.max(0, Date.now() - ms) : Number.POSITIVE_INFINITY;
}
function normName(v: string) { return v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

function probabilityEvidenceWeight(
  evidence: GameMarketEvidenceContext | undefined,
  reliabilityTier: SampleReliabilityTier,
): number {
  const n = Math.max(0, Math.floor(evidence?.independentDecisiveObservations ?? 0));
  const profileWeightProvided = typeof evidence?.recommendedModelWeight === 'number';
  let weight = profileWeightProvided
    ? evidence!.recommendedModelWeight!
    : n >= 300 ? 0.88 : n >= 150 ? 0.78 : n >= 75 ? 0.62 : n >= 30 ? 0.48 : 0.35;
  const gap = evidence?.calibrationGap;
  const ece = evidence?.expectedCalibrationError;
  const brier = evidence?.brierScore;
  // Repository-provided weights already include calibration penalties. Only derive
  // those penalties here for callers that supply the older evidence shape.
  if (!profileWeightProvided) {
    if (gap !== null && gap !== undefined && Number.isFinite(gap) && Math.abs(gap) >= REVIEW_CALIBRATION_GAP) weight = Math.max(0.25, weight - 0.12);
    if (ece !== null && ece !== undefined && Number.isFinite(ece) && ece >= 0.06) weight = Math.max(0.25, weight - 0.10);
    if (brier !== null && brier !== undefined && Number.isFinite(brier) && brier >= 0.25) weight = Math.max(0.25, weight - 0.08);
  }
  if (reliabilityTier === 'MODERATE') weight = Math.min(weight, 0.50);
  if (reliabilityTier === 'LIMITED') weight = Math.min(weight, 0.30);
  if (reliabilityTier === 'VERY_LIMITED') weight = Math.min(weight, 0.20);
  return Math.max(0.20, Math.min(0.90, weight));
}

function prospectiveCalibrationAdjust(rawProbability: number, evidence: GameMarketEvidenceContext | undefined): { probability: number; adjustmentPP: number } {
  const n = Math.max(0, Math.floor(evidence?.independentDecisiveObservations ?? 0));
  const gap = evidence?.calibrationGap;
  if (n < 30 || gap === null || gap === undefined || !Number.isFinite(gap)) return { probability: rawProbability, adjustmentPP: 0 };
  // Prospective-only bias correction. Positive gap means historical predictions were overconfident.
  // The correction grows gradually with sample size and is capped at 5 pp to prevent overfitting.
  const learningRate = Math.min(1, n / 150);
  const correction = clampValue(gap * learningRate, -0.05, 0.05);
  const probability = clamp(rawProbability - correction);
  return { probability, adjustmentPP: (probability - rawProbability) * 100 };
}

function evFromProbability(probability: number, pushProbability: number, oddsDecimal: number): number {
  const win = clamp(probability, 0, Math.max(0, 1 - pushProbability));
  const loss = Math.max(0, 1 - win - pushProbability);
  return win * (oddsDecimal - 1) - loss;
}

function evTier(evPercent: number): GameMarketEvTier {
  if (evPercent >= VERIFY_EV_PERCENT) return 'EXTREME';
  if (evPercent >= REVIEW_EV_PERCENT) return 'HEIGHTENED';
  return 'NORMAL';
}

function v2Contribution(
  productionProbability: number,
  shadowProbability: number | null,
): { deltaPP: number | null; status: V2ContributionStatus; supports: boolean | null } {
  if (shadowProbability === null || !Number.isFinite(shadowProbability)) {
    return { deltaPP: null, status: 'UNAVAILABLE', supports: null };
  }
  const deltaPP = (shadowProbability - productionProbability) * 100;
  return {
    deltaPP,
    status: Math.abs(deltaPP) >= MATERIAL_V2_DELTA_PP ? 'MATERIAL' : 'NO_MATERIAL_ADJUSTMENT',
    supports: (productionProbability >= 0.5) === (shadowProbability >= 0.5),
  };
}

function markIntegrity(
  baseReasonCodes: string[],
  modelProbability: number,
  decisionProbability: number,
  consensus: number | null,
  decisionEvPercent: number,
  evidence: GameMarketEvidenceContext | undefined,
  shadowProbability: number | null,
): {
  status: GameMarketIntegrityStatus;
  integrityReasonCodes: string[];
  marketDisagreementPP: number | null;
  tier: GameMarketEvTier;
  v2DeltaPP: number | null;
  v2Status: V2ContributionStatus;
  v2Supports: boolean | null;
} {
  const reasons: string[] = [];
  let severity: 'NONE' | 'REVIEW' | 'VERIFY' = 'NONE';
  const disagreement = consensus === null ? null : Math.abs(modelProbability - consensus) * 100;
  if (disagreement !== null && disagreement >= VERIFY_MARKET_DISAGREEMENT_PP) {
    severity = 'VERIFY';
    reasons.push('MODEL_MARKET_DISAGREEMENT_EXTREME');
  } else if (disagreement !== null && disagreement >= REVIEW_MARKET_DISAGREEMENT_PP) {
    severity = 'REVIEW';
    reasons.push('MODEL_MARKET_DISAGREEMENT_HEIGHTENED');
  }

  const tier = evTier(decisionEvPercent);
  if (tier === 'EXTREME') {
    severity = 'VERIFY';
    reasons.push('GUARDED_EV_EXTREME_VERIFY_REQUIRED');
  } else if (tier === 'HEIGHTENED' && severity !== 'VERIFY') {
    severity = 'REVIEW';
    reasons.push('GUARDED_EV_HEIGHTENED_REVIEW');
  }

  const gap = evidence?.calibrationGap;
  const n = Math.max(0, Math.floor(evidence?.independentDecisiveObservations ?? 0));
  if (n >= 25 && gap !== null && gap !== undefined && Number.isFinite(gap) && Math.abs(gap) >= REVIEW_CALIBRATION_GAP) {
    if (severity !== 'VERIFY') severity = 'REVIEW';
    reasons.push('PROSPECTIVE_CALIBRATION_GAP_ELEVATED');
  }
  if (n < 25) reasons.push('EARLY_EVIDENCE_SHRINKAGE_ACTIVE');

  const v2 = v2Contribution(modelProbability, shadowProbability);
  if (v2.supports === false) {
    if (Math.abs(v2.deltaPP ?? 0) >= VERIFY_V2_FLIP_DELTA_PP) {
      severity = 'VERIFY';
      reasons.push('V2_SHADOW_LARGE_DIRECTIONAL_FLIP');
    } else if (severity !== 'VERIFY') {
      severity = 'REVIEW';
      reasons.push('V2_SHADOW_DIRECTION_DISAGREES');
    }
  }
  if (v2.status === 'NO_MATERIAL_ADJUSTMENT') reasons.push('V2_NO_MATERIAL_ADJUSTMENT');

  const status: GameMarketIntegrityStatus =
    severity === 'VERIFY' ? 'VERIFY' :
    severity === 'REVIEW' ? 'REVIEW' :
    baseReasonCodes.length ? 'PASS' :
    'QUALIFIED';

  return {
    status,
    integrityReasonCodes: reasons,
    marketDisagreementPP: disagreement,
    tier,
    v2DeltaPP: v2.deltaPP,
    v2Status: v2.status,
    v2Supports: v2.supports,
  };
}

function namesMatch(a: string | null, b: string) {
  if (!a) return false;
  const x = normName(a), y = normName(b);
  return x === y || x.includes(y) || y.includes(x);
}

interface PricedOutcome {
  marketType: MarketType;
  name: string;
  point: number | null;
  americanOdds: number;
  decimalOdds: number;
  sportsbook: string;
  timestamp: string;
  rawMarketOutcomes: NormalizedMarketOutcome[];
}

function collectOutcomes(markets: NormalizedApexEventMarkets): PricedOutcome[] {
  const out: PricedOutcome[] = [];
  for (const book of markets.bookmakers) {
    for (const market of book.markets) {
      for (const outcome of market.outcomes) {
        out.push({
          marketType: market.marketType,
          name: outcome.name,
          point: outcome.point ?? null,
          americanOdds: outcome.americanOdds,
          decimalOdds: outcome.decimalOdds,
          sportsbook: book.title,
          timestamp: market.lastUpdate || book.lastUpdate,
          rawMarketOutcomes: market.outcomes,
        });
      }
    }
  }
  return out;
}

function candidateSide(game: NormalizedApexGame, outcome: PricedOutcome): GameModelSelectionSide | null {
  if (outcome.marketType === 'TOTAL') {
    const n = normName(outcome.name);
    if (n.startsWith('over')) return 'OVER';
    if (n.startsWith('under')) return 'UNDER';
    return null;
  }
  if (normName(outcome.name) === 'draw') return 'DRAW';
  if (namesMatch(game.homeTeam, outcome.name)) return 'HOME';
  if (namesMatch(game.awayTeam, outcome.name)) return 'AWAY';
  return null;
}

function exactIdentity(side: GameModelSelectionSide, type: MarketType, point: number | null) {
  return `${type}|${side}|${point === null ? 'NA' : point.toFixed(3)}`;
}

function noVigForOutcome(outcome: PricedOutcome): number | null {
  const probs = outcome.rawMarketOutcomes.map((o) => implied(o.americanOdds));
  const total = probs.reduce((a,b)=>a+b,0);
  if (total <= 0) return null;
  const idx = outcome.rawMarketOutcomes.findIndex((o) => normName(o.name) === normName(outcome.name) && (o.point ?? null) === outcome.point);
  if (idx < 0) return null;
  return probs[idx] / total;
}

function applyCrossMarketConsistency(candidates: GameMarketCandidateV1[]): void {
  const mark = (c: GameMarketCandidateV1) => {
    c.crossMarketConsistent = false;
    if (!c.reasonCodes.includes('CROSS_MARKET_INCONSISTENT')) c.reasonCodes.push('CROSS_MARKET_INCONSISTENT');
    if (!c.integrityReasonCodes.includes('CROSS_MARKET_INCONSISTENT')) c.integrityReasonCodes.push('CROSS_MARKET_INCONSISTENT');
    c.integrityStatus = 'VERIFY';
    c.qualifies = false;
  };

  const moneyline = candidates.filter((c) => c.marketType === 'MONEYLINE');
  const home = moneyline.find((c) => c.side === 'HOME');
  const away = moneyline.find((c) => c.side === 'AWAY');
  const draw = moneyline.find((c) => c.side === 'DRAW');
  if (home && away) {
    const sum = home.modelProbability + away.modelProbability + (draw?.modelProbability ?? 0);
    if (Math.abs(sum - 1) > 0.02) [home, away, ...(draw ? [draw] : [])].forEach(mark);
  }

  for (const side of ['HOME', 'AWAY'] as const) {
    const rows = candidates
      .filter((c) => c.marketType === 'SPREAD' && c.side === side && c.point !== null)
      .sort((a, b) => (a.point ?? 0) - (b.point ?? 0));
    for (let i = 1; i < rows.length; i++) {
      // A more favorable spread point must not reduce cover probability.
      if (rows[i].modelProbability + 0.015 < rows[i - 1].modelProbability) {
        mark(rows[i - 1]); mark(rows[i]);
      }
    }
  }

  for (const side of ['OVER', 'UNDER'] as const) {
    const rows = candidates
      .filter((c) => c.marketType === 'TOTAL' && c.side === side && c.point !== null)
      .sort((a, b) => (a.point ?? 0) - (b.point ?? 0));
    for (let i = 1; i < rows.length; i++) {
      const prior = rows[i - 1].modelProbability;
      const current = rows[i].modelProbability;
      const invalid = side === 'OVER' ? current > prior + 0.015 : current + 0.015 < prior;
      if (invalid) { mark(rows[i - 1]); mark(rows[i]); }
    }
  }
}

function clampValue(x: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, x)); }

function buildShadowProjection(
  game: NormalizedApexGame,
  baseHome: number,
  baseAway: number,
  marginStdDev: number,
  context: GameMarketContextV2,
): { home: number; away: number; margin: number; total: number; homeWin: number; awayWin: number } | null {
  if (game.sport !== 'MLB' && game.sport !== 'NFL') return null;
  let home = baseHome;
  let away = baseAway;

  if (game.sport === 'MLB') {
    const hEra = context.mlb?.homeStarterEra ?? null;
    const aEra = context.mlb?.awayStarterEra ?? null;
    if (hEra !== null && aEra !== null && hEra > 0 && aEra > 0) {
      // Shadow-only starter differential. The adjustment is deliberately bounded and never controls production gating.
      const shift = clampValue(0.30 * (aEra - hEra), -1.5, 1.5);
      home = Math.max(0.01, home + shift / 2);
      away = Math.max(0.01, away - shift / 2);
    }
    const hBullpen = context.mlb?.homeBullpenInningsLast3 ?? null;
    const aBullpen = context.mlb?.awayBullpenInningsLast3 ?? null;
    if (hBullpen !== null && aBullpen !== null) {
      // More recent reliever workload is treated as a small shadow-only fatigue signal.
      const bullpenShift = clampValue((aBullpen - hBullpen) * 0.06, -0.75, 0.75);
      home = Math.max(0.01, home + bullpenShift / 2);
      away = Math.max(0.01, away - bullpenShift / 2);
    }
  }

  if (game.sport === 'NFL') {
    const h5 = context.nfl?.homeRecent5Margin ?? null;
    const a5 = context.nfl?.awayRecent5Margin ?? null;
    const hs = context.nfl?.homeStrengthIndex ?? null;
    const as = context.nfl?.awayStrengthIndex ?? null;
    let shift = 0;
    if (hs !== null && as !== null && h5 !== null && a5 !== null) {
      const formDifferential = (hs - as) - ((h5 - a5) * 0.25);
      shift += clampValue(0.12 * formDifferential, -2.5, 2.5);
    }
    const hr = context.nfl?.homeRestDays ?? null;
    const ar = context.nfl?.awayRestDays ?? null;
    if (hr !== null && ar !== null) shift += clampValue((hr - ar) * 0.12, -1.25, 1.25);
    const hNetYpp = context.nfl?.homeNetYardsPerPlay ?? null;
    const aNetYpp = context.nfl?.awayNetYardsPerPlay ?? null;
    if (hNetYpp !== null && aNetYpp !== null) shift += clampValue((hNetYpp - aNetYpp) * 0.8, -2.0, 2.0);
    const hTom = context.nfl?.homeTurnoverMarginPerGame ?? null;
    const aTom = context.nfl?.awayTurnoverMarginPerGame ?? null;
    if (hTom !== null && aTom !== null) shift += clampValue((hTom - aTom) * 0.35, -1.5, 1.5);
    home = Math.max(0.01, home + shift / 2);
    away = Math.max(0.01, away - shift / 2);
  }

  const margin = home - away;
  const total = home + away;
  const homeWin = normalCdf(margin / marginStdDev);
  return { home, away, margin, total, homeWin, awayWin: 1 - homeWin };
}

export class GameMarketModelService {
  async buildProjection(game: NormalizedApexGame): Promise<GameMarketProjectionV1> {
    const [homeHistory, awayHistory] = await Promise.all([
      gameTeamHistoryService.getTeamHistory(game, 'HOME'),
      gameTeamHistoryService.getTeamHistory(game, 'AWAY'),
    ]);
    const contextV2 = await gameMarketContextService.build(game, homeHistory, awayHistory);
    const rel = reliability(homeHistory, awayHistory);
    const pointInTimeValid = homeHistory.pointInTimeValid && awayHistory.pointInTimeValid;
    const unavailable = game.sport === 'TENNIS' || homeHistory.status !== 'AVAILABLE' || awayHistory.status !== 'AVAILABLE' || !pointInTimeValid;
    const wnbaScores = !unavailable && game.sport === 'WNBA' ? buildWnbaExpectedScores(homeHistory, awayHistory) : null;
    const scores = unavailable ? null : (wnbaScores ?? expectedScores(homeHistory, awayHistory));
    const notes = [
      'Probability model uses public historical team results only; sportsbook odds do not enter the forecast.',
      'Current V1 game model is prospective/early-evidence and will be calibrated from newly logged predictions.',
      ...homeHistory.warnings,
      ...awayHistory.warnings,
    ];
    if (game.sport === 'WNBA' && wnbaScores) {
      notes.push(`WNBA production scoring projection uses a ${(wnbaScores.recentBlendWeight * 100).toFixed(0)}% bounded recent-five blend on top of the point-in-time season/venue baseline.`);
      notes.push('WNBA market prices do not enter expected score or raw win probability; odds remain decision/economic inputs only.');
    }

    if (!scores) {
      return {
        modelVersion: 'APEX_GAME_MARKET_V1', generatedAt: new Date().toISOString(), asOf: game.startTime,
        sport: game.sport, eventId: game.eventId, status: game.sport === 'TENNIS' ? 'UNSUPPORTED' : 'INSUFFICIENT_DATA',
        reason: game.sport === 'TENNIS' ? 'Tennis uses a separate player model.' : 'At least six completed point-in-time games per team are required.',
        validationStatus: 'EARLY_EVIDENCE', source: 'ESPN_TEAM_SCHEDULE_HISTORY', pointInTimeValid, reliabilityTier: rel,
        homeSampleCount: homeHistory.sampleCount, awaySampleCount: awayHistory.sampleCount,
        expectedHomeScore: null, expectedAwayScore: null, expectedMargin: null, expectedTotal: null,
        marginStdDev: null, totalStdDev: null, homeWinProbability: null, awayWinProbability: null, drawProbability: null,
        homeHistory, awayHistory, contextV2, shadowModelVersion: null, shadowExpectedHomeScore: null, shadowExpectedAwayScore: null,
        shadowExpectedMargin: null, shadowExpectedTotal: null, shadowHomeWinProbability: null, shadowAwayWinProbability: null, notes,
      };
    }

    const expectedMargin = scores.home - scores.away;
    const expectedTotal = scores.home + scores.away;
    let homeWinProbability: number;
    let awayWinProbability: number;
    let drawProbability: number | null = null;
    let marginStdDev: number;
    let totalStdDev: number;

    if (game.sport === 'SOCCER') {
      const probs = soccerOutcomeProbabilities(scores.home, scores.away);
      homeWinProbability = probs.home;
      awayWinProbability = probs.away;
      drawProbability = probs.draw;
      marginStdDev = Math.sqrt(scores.home + scores.away);
      totalStdDev = Math.sqrt(scores.home + scores.away);
    } else {
      const floor = sportUncertaintyFloor(game.sport);
      const marginObserved = mean([homeHistory.marginStdDev, awayHistory.marginStdDev].filter((v): v is number => v !== null));
      const totalObserved = mean([homeHistory.totalStdDev, awayHistory.totalStdDev].filter((v): v is number => v !== null));
      marginStdDev = Math.max(floor.margin, marginObserved ?? floor.margin);
      totalStdDev = Math.max(floor.total, totalObserved ?? floor.total);
      homeWinProbability = normalCdf(expectedMargin / marginStdDev);
      awayWinProbability = 1 - homeWinProbability;
    }

    const shadow = buildShadowProjection(game, scores.home, scores.away, marginStdDev, contextV2);
    if (shadow) notes.push('APEX_GAME_MARKET_V2_SHADOW is audit-only and cannot promote or override a V1 production recommendation.');

    return {
      modelVersion: 'APEX_GAME_MARKET_V1', generatedAt: new Date().toISOString(), asOf: game.startTime,
      sport: game.sport, eventId: game.eventId, status: 'AVAILABLE', reason: null,
      validationStatus: 'EARLY_EVIDENCE', source: 'ESPN_TEAM_SCHEDULE_HISTORY', pointInTimeValid: true, reliabilityTier: rel,
      homeSampleCount: homeHistory.sampleCount, awaySampleCount: awayHistory.sampleCount,
      expectedHomeScore: scores.home, expectedAwayScore: scores.away, expectedMargin, expectedTotal,
      marginStdDev, totalStdDev, homeWinProbability, awayWinProbability, drawProbability,
      homeHistory, awayHistory, contextV2,
      shadowModelVersion: shadow ? 'APEX_GAME_MARKET_V2_SHADOW' : null,
      shadowExpectedHomeScore: shadow?.home ?? null, shadowExpectedAwayScore: shadow?.away ?? null,
      shadowExpectedMargin: shadow?.margin ?? null, shadowExpectedTotal: shadow?.total ?? null,
      shadowHomeWinProbability: shadow?.homeWin ?? null, shadowAwayWinProbability: shadow?.awayWin ?? null, notes,
    };
  }

  evaluateMarkets(
    game: NormalizedApexGame,
    markets: NormalizedApexEventMarkets,
    model: GameMarketProjectionV1,
    evidence?: GameMarketEvidenceContext,
  ): GameMarketEvaluationV1 {
    if (model.status !== 'AVAILABLE' || model.expectedMargin === null || model.expectedTotal === null || model.marginStdDev === null || model.totalStdDev === null) {
      return { model, candidates: [], qualified: [], evaluatedAt: new Date().toISOString() };
    }

    const all = collectOutcomes(markets);
    const groups = new Map<string, PricedOutcome[]>();
    for (const outcome of all) {
      const side = candidateSide(game, outcome);
      if (!side) continue;
      const key = exactIdentity(side, outcome.marketType, outcome.point);
      const list = groups.get(key) || [];
      list.push(outcome);
      groups.set(key, list);
    }

    const candidates: GameMarketCandidateV1[] = [];

    for (const [identity, group] of groups.entries()) {
      const freshest = group.filter((o) => quoteAgeMs(o.timestamp) <= MAX_QUOTE_AGE_MS);
      if (!freshest.length) continue;
      const best = [...freshest].sort((a,b)=>b.americanOdds-a.americanOdds)[0];
      const side = candidateSide(game, best)!;
      const point = best.point;
      const candidateEvidence = evidence?.byMarket?.[best.marketType] ?? evidence;
      const evidenceWeight = probabilityEvidenceWeight(candidateEvidence, model.reliabilityTier);
      const evidenceObservations = Math.max(0, Math.floor(candidateEvidence?.independentDecisiveObservations ?? 0));
      let rawModelProbability: number | null = null;
      let pushProbability = 0;

      if (best.marketType === 'MONEYLINE') {
        if (side === 'HOME') rawModelProbability = model.homeWinProbability;
        else if (side === 'AWAY') rawModelProbability = model.awayWinProbability;
        else if (side === 'DRAW') rawModelProbability = model.drawProbability;
      } else if (point !== null) {
        const lineProb = game.sport === 'SOCCER'
          ? soccerLineProbability(model.expectedHomeScore!, model.expectedAwayScore!, best.marketType, side, point)
          : normalLineProbability(
              best.marketType === 'TOTAL' ? model.expectedTotal : model.expectedMargin,
              best.marketType === 'TOTAL' ? model.totalStdDev : model.marginStdDev,
              best.marketType,
              side,
              point,
            );
        rawModelProbability = lineProb.win;
        pushProbability = lineProb.push;
      }
      if (rawModelProbability === null || !Number.isFinite(rawModelProbability)) continue;
      rawModelProbability = clamp(rawModelProbability);

      let shadowModelProbability: number | null = null;
      if (model.shadowModelVersion && model.shadowExpectedMargin !== null && model.shadowExpectedTotal !== null && model.marginStdDev !== null && model.totalStdDev !== null) {
        if (best.marketType === 'MONEYLINE') {
          if (side === 'HOME') shadowModelProbability = model.shadowHomeWinProbability;
          else if (side === 'AWAY') shadowModelProbability = model.shadowAwayWinProbability;
        } else if (point !== null && game.sport !== 'SOCCER') {
          const sh = normalLineProbability(
            best.marketType === 'TOTAL' ? model.shadowExpectedTotal : model.shadowExpectedMargin,
            best.marketType === 'TOTAL' ? model.totalStdDev : model.marginStdDev,
            best.marketType,
            side,
            point,
          );
          shadowModelProbability = sh.win;
        }
      }

      const breakEven = implied(best.americanOdds);
      const noVigs = freshest.map(noVigForOutcome).filter((v): v is number => v !== null);
      const consensus = mean(noVigs);
      const depth = new Set(freshest.map((o) => o.sportsbook)).size;

      // V1 remains an independent sports model. The guardrail probability below is a
      // decision-risk adjustment only: early evidence is shrunk toward multi-book no-vig
      // consensus (or executable break-even if consensus is unavailable). This reference
      // never feeds expected score or the raw model probability.
      const decisionReference = clamp(consensus ?? breakEven);
      const maxDecisionProbability = Math.max(0, 1 - pushProbability);
      const calibration = prospectiveCalibrationAdjust(rawModelProbability, candidateEvidence);
      const decisionProbability = clamp(
        calibration.probability * evidenceWeight + decisionReference * (1 - evidenceWeight),
        0,
        maxDecisionProbability,
      );

      const rawEdge = rawModelProbability - breakEven;
      const rawEv = evFromProbability(rawModelProbability, pushProbability, decimal(best.americanOdds));
      const guardedEdge = decisionProbability - breakEven;
      const guardedEv = evFromProbability(decisionProbability, pushProbability, decimal(best.americanOdds));

      const baseReasons: string[] = [];
      if (model.reliabilityTier === 'VERY_LIMITED' || model.reliabilityTier === 'LIMITED') baseReasons.push('RELIABILITY_BELOW_MODERATE');
      if (depth < MIN_MARKET_DEPTH) baseReasons.push('MARKET_DEPTH_BELOW_2_BOOKS');
      if (guardedEdge < MIN_EDGE) baseReasons.push('EDGE_BELOW_3PP');
      if (guardedEv * 100 < MIN_EV_PERCENT) baseReasons.push('EV_BELOW_3_PERCENT');
      if (guardedEv <= 0) baseReasons.push('NON_POSITIVE_EV');
      if (!model.pointInTimeValid || Date.parse(game.startTime) <= Date.now() || game.status !== 'UPCOMING' || game.pregameBetEligible === false) baseReasons.push('POINT_IN_TIME_OR_PREGAME_INVALID');

      const integrity = markIntegrity(
        baseReasons,
        rawModelProbability,
        decisionProbability,
        consensus,
        guardedEv * 100,
        candidateEvidence,
        shadowModelProbability,
      );

      const allReasons = [...baseReasons, ...integrity.integrityReasonCodes];
      const qualifies = baseReasons.length === 0 && integrity.status === 'QUALIFIED';

      candidates.push({
        candidateId: `${game.eventId}|${identity}`,
        marketType: best.marketType,
        side,
        selectionLabel: best.marketType === 'TOTAL'
          ? `${side} ${point}`
          : best.marketType === 'SPREAD'
            ? `${best.name} ${(point as number) > 0 ? '+' : ''}${point}`
            : best.name,
        point,
        sportsbook: best.sportsbook,
        oddsAmerican: best.americanOdds,
        oddsDecimal: decimal(best.americanOdds),
        quoteTimestamp: best.timestamp,
        marketDepth: depth,
        modelProbability: rawModelProbability,
        decisionProbability,
        decisionReferenceProbability: decisionReference,
        probabilityShrinkageWeight: evidenceWeight,
        modelEvidenceObservations: evidenceObservations,
        calibrationAdjustedProbability: calibration.probability,
        prospectiveCalibrationAdjustmentPP: calibration.adjustmentPP,
        calibrationEvidenceTier: candidateEvidence?.evidenceTier ?? (evidenceObservations >= 150 ? 'MATURE' : evidenceObservations >= 75 ? 'MODERATE' : evidenceObservations >= 30 ? 'DEVELOPING' : 'EARLY'),
        calibrationExpectedError: candidateEvidence?.expectedCalibrationError ?? null,
        calibrationBrierScore: candidateEvidence?.brierScore ?? null,
        bookOffers: [...freshest]
          .sort((a,b)=>b.americanOdds-a.americanOdds)
          .filter((o,i,arr)=>arr.findIndex(x=>x.sportsbook===o.sportsbook)===i)
          .map((o)=>({sportsbook:o.sportsbook,oddsAmerican:o.americanOdds,quoteTimestamp:o.timestamp})),
        pushProbability: clamp(pushProbability),
        breakEvenProbability: breakEven,
        marketConsensusProbability: consensus,
        modelMarketDisagreementPP: integrity.marketDisagreementPP,
        rawEdgePercentagePoints: rawEdge * 100,
        rawExpectedValuePercent: rawEv * 100,
        edgePercentagePoints: guardedEdge * 100,
        expectedValuePercent: guardedEv * 100,
        evTier: integrity.tier,
        integrityStatus: qualifies ? 'QUALIFIED' : integrity.status,
        integrityReasonCodes: integrity.integrityReasonCodes,
        crossMarketConsistent: true,
        qualifies,
        reasonCodes: allReasons,
        shadowModelProbability,
        shadowSupportsProduction: integrity.v2Supports,
        v2ContributionPP: integrity.v2DeltaPP,
        v2ContributionStatus: integrity.v2Status,
      });
    }

    applyCrossMarketConsistency(candidates);
    candidates.sort((a,b) => {
      const severity = (c: GameMarketCandidateV1) =>
        c.integrityStatus === 'QUALIFIED' ? 4 : c.integrityStatus === 'REVIEW' ? 3 : c.integrityStatus === 'VERIFY' ? 2 : 1;
      const s = severity(b) - severity(a);
      if (s) return s;
      return b.expectedValuePercent - a.expectedValuePercent || b.decisionProbability - a.decisionProbability;
    });

    return {
      model,
      candidates,
      qualified: candidates.filter((c)=>c.qualifies),
      evaluatedAt: new Date().toISOString(),
    };
  }

}

export const gameMarketModelService = new GameMarketModelService();
