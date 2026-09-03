import {
  ApexSport,
  MarketType,
  NormalizedApexEventMarkets,
  NormalizedApexGame,
  NormalizedMarketOutcome,
  SampleReliabilityTier,
} from '../types';
import { gameTeamHistoryService, TeamHistorySummary } from './gameTeamHistoryService';

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
  notes: string[];
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
  modelProbability: number;
  pushProbability: number;
  breakEvenProbability: number;
  marketConsensusProbability: number | null;
  edgePercentagePoints: number;
  expectedValuePercent: number;
  qualifies: boolean;
  reasonCodes: string[];
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

export class GameMarketModelService {
  async buildProjection(game: NormalizedApexGame): Promise<GameMarketProjectionV1> {
    const [homeHistory, awayHistory] = await Promise.all([
      gameTeamHistoryService.getTeamHistory(game, 'HOME'),
      gameTeamHistoryService.getTeamHistory(game, 'AWAY'),
    ]);
    const rel = reliability(homeHistory, awayHistory);
    const pointInTimeValid = homeHistory.pointInTimeValid && awayHistory.pointInTimeValid;
    const unavailable = game.sport === 'TENNIS' || homeHistory.status !== 'AVAILABLE' || awayHistory.status !== 'AVAILABLE' || !pointInTimeValid;
    const scores = unavailable ? null : expectedScores(homeHistory, awayHistory);
    const notes = [
      'Probability model uses public historical team results only; sportsbook odds do not enter the forecast.',
      'Current V1 game model is prospective/early-evidence and will be calibrated from newly logged predictions.',
      ...homeHistory.warnings,
      ...awayHistory.warnings,
    ];

    if (!scores) {
      return {
        modelVersion: 'APEX_GAME_MARKET_V1', generatedAt: new Date().toISOString(), asOf: game.startTime,
        sport: game.sport, eventId: game.eventId, status: game.sport === 'TENNIS' ? 'UNSUPPORTED' : 'INSUFFICIENT_DATA',
        reason: game.sport === 'TENNIS' ? 'Tennis uses a separate player model.' : 'At least six completed point-in-time games per team are required.',
        validationStatus: 'EARLY_EVIDENCE', source: 'ESPN_TEAM_SCHEDULE_HISTORY', pointInTimeValid, reliabilityTier: rel,
        homeSampleCount: homeHistory.sampleCount, awaySampleCount: awayHistory.sampleCount,
        expectedHomeScore: null, expectedAwayScore: null, expectedMargin: null, expectedTotal: null,
        marginStdDev: null, totalStdDev: null, homeWinProbability: null, awayWinProbability: null, drawProbability: null,
        homeHistory, awayHistory, notes,
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

    return {
      modelVersion: 'APEX_GAME_MARKET_V1', generatedAt: new Date().toISOString(), asOf: game.startTime,
      sport: game.sport, eventId: game.eventId, status: 'AVAILABLE', reason: null,
      validationStatus: 'EARLY_EVIDENCE', source: 'ESPN_TEAM_SCHEDULE_HISTORY', pointInTimeValid: true, reliabilityTier: rel,
      homeSampleCount: homeHistory.sampleCount, awaySampleCount: awayHistory.sampleCount,
      expectedHomeScore: scores.home, expectedAwayScore: scores.away, expectedMargin, expectedTotal,
      marginStdDev, totalStdDev, homeWinProbability, awayWinProbability, drawProbability,
      homeHistory, awayHistory, notes,
    };
  }

  evaluateMarkets(game: NormalizedApexGame, markets: NormalizedApexEventMarkets, model: GameMarketProjectionV1): GameMarketEvaluationV1 {
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
      let modelProbability: number | null = null;
      let pushProbability = 0;

      if (best.marketType === 'MONEYLINE') {
        if (side === 'HOME') modelProbability = model.homeWinProbability;
        else if (side === 'AWAY') modelProbability = model.awayWinProbability;
        else if (side === 'DRAW') modelProbability = model.drawProbability;
      } else if (point !== null) {
        const lineProb = game.sport === 'SOCCER'
          ? soccerLineProbability(model.expectedHomeScore!, model.expectedAwayScore!, best.marketType, side, point)
          : normalLineProbability(best.marketType === 'TOTAL' ? model.expectedTotal : model.expectedMargin, best.marketType === 'TOTAL' ? model.totalStdDev : model.marginStdDev, best.marketType, side, point);
        modelProbability = lineProb.win;
        pushProbability = lineProb.push;
      }
      if (modelProbability === null || !Number.isFinite(modelProbability)) continue;

      const breakEven = implied(best.americanOdds);
      const lossProbability = Math.max(0, 1 - modelProbability - pushProbability);
      const ev = modelProbability * (decimal(best.americanOdds) - 1) - lossProbability;
      const edge = modelProbability - breakEven;
      const noVigs = freshest.map(noVigForOutcome).filter((v): v is number => v !== null);
      const consensus = mean(noVigs);
      const depth = new Set(freshest.map((o) => o.sportsbook)).size;
      const reasons: string[] = [];
      if (model.reliabilityTier === 'VERY_LIMITED' || model.reliabilityTier === 'LIMITED') reasons.push('RELIABILITY_BELOW_MODERATE');
      if (depth < MIN_MARKET_DEPTH) reasons.push('MARKET_DEPTH_BELOW_2_BOOKS');
      if (edge < MIN_EDGE) reasons.push('EDGE_BELOW_3PP');
      if (ev * 100 < MIN_EV_PERCENT) reasons.push('EV_BELOW_3_PERCENT');
      if (ev <= 0) reasons.push('NON_POSITIVE_EV');
      if (!model.pointInTimeValid || Date.parse(game.startTime) <= Date.now() || game.status !== 'UPCOMING') reasons.push('POINT_IN_TIME_OR_PREGAME_INVALID');

      candidates.push({
        candidateId: `${game.eventId}|${identity}`,
        marketType: best.marketType,
        side,
        selectionLabel: best.marketType === 'TOTAL' ? `${side} ${point}` : best.marketType === 'SPREAD' ? `${best.name} ${(point as number) > 0 ? '+' : ''}${point}` : best.name,
        point,
        sportsbook: best.sportsbook,
        oddsAmerican: best.americanOdds,
        oddsDecimal: decimal(best.americanOdds),
        quoteTimestamp: best.timestamp,
        marketDepth: depth,
        modelProbability: clamp(modelProbability),
        pushProbability: clamp(pushProbability),
        breakEvenProbability: breakEven,
        marketConsensusProbability: consensus,
        edgePercentagePoints: edge * 100,
        expectedValuePercent: ev * 100,
        qualifies: reasons.length === 0,
        reasonCodes: reasons,
      });
    }

    candidates.sort((a,b) => b.expectedValuePercent - a.expectedValuePercent || b.modelProbability - a.modelProbability);
    return { model, candidates, qualified: candidates.filter((c)=>c.qualifies), evaluatedAt: new Date().toISOString() };
  }
}

export const gameMarketModelService = new GameMarketModelService();
