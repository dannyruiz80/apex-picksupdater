import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { NormalizedApexGame } from '../types';
import {
  TeamGameHistoryRecord,
  TeamHistorySummary,
  summarizeTeamHistory,
} from './gameTeamHistoryService';
import {
  buildWnbaHistoricalProjection,
  GameMarketProjectionV1,
} from './gameMarketModelService';

export interface WnbaHistoricalGame {
  eventId: string;
  season: number;
  startTime: string;
  homeTeamId: string;
  homeTeam: string;
  awayTeamId: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  neutralSite: boolean;
}

export interface WnbaCalibrationBucket {
  minProbability: number;
  maxProbability: number;
  observations: number;
  meanPredictedHomeWinProbability: number | null;
  actualHomeWinRate: number | null;
  absoluteGap: number | null;
}

export interface WnbaBacktestRow {
  eventId: string;
  season: number;
  startTime: string;
  matchup: string;
  homeSampleCount: number;
  awaySampleCount: number;
  pointInTimeValid: boolean;
  expectedHomeScore: number;
  expectedAwayScore: number;
  expectedMargin: number;
  expectedTotal: number;
  marginStdDev: number;
  totalStdDev: number;
  analyticHomeWinProbability: number;
  monteCarloHomeWinProbability: number;
  actualHomeWin: boolean;
  actualHomeScore: number;
  actualAwayScore: number;
  actualMargin: number;
  actualTotal: number;
  absoluteHomeScoreError: number;
  absoluteAwayScoreError: number;
  absoluteMarginError: number;
  absoluteTotalError: number;
  latestHomeHistoryAt: string | null;
  latestAwayHistoryAt: string | null;
}

export interface WnbaHistoricalBacktestReport {
  reportVersion: 'APEX_WNBA_WALK_FORWARD_BACKTEST_V1';
  simulationVersion: 'APEX_WNBA_MONTE_CARLO_V1';
  generatedAt: string;
  source: 'ESPN_WNBA_TEAM_SCHEDULE_HISTORY';
  startSeason: number;
  endSeason: number;
  warmupSeason: number;
  teamCount: number;
  totalCompletedGamesFetched: number;
  targetSeasonGames: number;
  evaluatedGames: number;
  insufficientHistoryGames: number;
  leakageRejectedGames: number;
  monteCarloTrialsPerGame: number;
  evidenceUnit: 'REAL_COMPLETED_GAMES';
  simulationTrialsAreEvidence: false;
  metrics: {
    analyticBrierScore: number | null;
    analyticLogLoss: number | null;
    monteCarloBrierScore: number | null;
    monteCarloLogLoss: number | null;
    meanPredictedHomeWinProbability: number | null;
    actualHomeWinRate: number | null;
    calibrationGap: number | null;
    expectedCalibrationError: number | null;
    meanAbsoluteHomeScoreError: number | null;
    meanAbsoluteAwayScoreError: number | null;
    meanAbsoluteMarginError: number | null;
    meanAbsoluteTotalError: number | null;
    rootMeanSquaredMarginError: number | null;
    rootMeanSquaredTotalError: number | null;
  };
  evidence: {
    independentDecisiveObservations: number;
    evidenceTier: 'EARLY' | 'DEVELOPING' | 'MODERATE' | 'MATURE';
    recommendedMoneylineModelWeight: number;
    status: 'ACTIVE' | 'INSUFFICIENT_EVIDENCE' | 'UNSTABLE';
    reason: string;
  };
  calibrationBuckets: WnbaCalibrationBucket[];
  bySeason: Array<{
    season: number;
    evaluatedGames: number;
    brierScore: number | null;
    logLoss: number | null;
    meanAbsoluteMarginError: number | null;
    meanAbsoluteTotalError: number | null;
  }>;
  historicalMarketBacktest: {
    status: 'UNAVAILABLE';
    reason: string;
  };
  rows: WnbaBacktestRow[];
  notes: string[];
}

export interface WnbaMonteCarloResult {
  simulationVersion: 'APEX_WNBA_MONTE_CARLO_V1';
  generatedAt: string;
  trials: number;
  seed: string;
  eventId: string;
  matchup: string;
  modelVersion: 'APEX_GAME_MARKET_V1';
  pointInTimeValid: boolean;
  reliabilityTier: string;
  expectedHomeScore: number;
  expectedAwayScore: number;
  expectedMargin: number;
  expectedTotal: number;
  marginStdDev: number;
  totalStdDev: number;
  analyticHomeWinProbability: number;
  simulatedHomeWinProbability: number;
  simulatedAwayWinProbability: number;
  simulatedMeanHomeScore: number;
  simulatedMeanAwayScore: number;
  simulatedMedianTotal: number;
  simulatedP10Total: number;
  simulatedP90Total: number;
  simulatedMedianMargin: number;
  simulatedP10Margin: number;
  simulatedP90Margin: number;
  status: 'SIMULATED';
  note: string;
}

const ESPN_TEAMS = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams?limit=50';
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_BACKTEST_ROWS = 1200;

function dataDir() { return process.env.APEX_DATA_DIR || path.join(process.cwd(), 'data'); }
function reportPath() { return path.join(dataDir(), 'wnbaHistoricalBacktest.json'); }
function clamp(x: number, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, x)); }
function mean(values: number[]): number | null { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function rmse(values: number[]): number | null { return values.length ? Math.sqrt(values.reduce((s, v) => s + v * v, 0) / values.length) : null; }
function score(raw: any): number | null {
  const n = Number(raw?.value ?? raw?.displayValue ?? raw);
  return Number.isFinite(n) ? n : null;
}
function logLoss(p: number, y: number) {
  const q = Math.max(1e-6, Math.min(1 - 1e-6, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
}
function evidenceTier(n: number): 'EARLY' | 'DEVELOPING' | 'MODERATE' | 'MATURE' {
  if (n >= 150) return 'MATURE';
  if (n >= 75) return 'MODERATE';
  if (n >= 30) return 'DEVELOPING';
  return 'EARLY';
}
function recommendedWeight(n: number, ece: number | null, brier: number | null, gap: number | null): number {
  let w = n >= 300 ? 0.82 : n >= 150 ? 0.74 : n >= 75 ? 0.62 : n >= 30 ? 0.48 : 0.35;
  if (ece !== null && ece >= 0.08) w -= 0.12;
  else if (ece !== null && ece >= 0.06) w -= 0.08;
  if (brier !== null && brier >= 0.28) w -= 0.12;
  else if (brier !== null && brier >= 0.25) w -= 0.08;
  if (gap !== null && Math.abs(gap) >= 0.07) w -= 0.08;
  return Math.max(0.30, Math.min(0.82, w));
}
function hashSeed(text: string): number {
  const digest = crypto.createHash('sha256').update(text).digest();
  const value = digest.readUInt32LE(0);
  return value === 0 ? 0x9e3779b9 : value;
}
function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return (state + 0.5) / 4294967296;
  };
}
function gaussianPair(rng: () => number): [number, number] {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  const r = Math.sqrt(-2 * Math.log(u1));
  const theta = 2 * Math.PI * u2;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}
function round(value: number, digits = 4) { return Number(value.toFixed(digits)); }

export function simulateWnbaProjection(
  projection: Pick<GameMarketProjectionV1,
    'eventId' | 'pointInTimeValid' | 'reliabilityTier' | 'expectedHomeScore' | 'expectedAwayScore' |
    'expectedMargin' | 'expectedTotal' | 'marginStdDev' | 'totalStdDev' | 'homeWinProbability'>,
  matchup: string,
  trials = 25000,
  seedBasis?: string,
): WnbaMonteCarloResult {
  if (
    projection.expectedHomeScore === null || projection.expectedAwayScore === null ||
    projection.expectedMargin === null || projection.expectedTotal === null ||
    projection.marginStdDev === null || projection.totalStdDev === null ||
    projection.homeWinProbability === null
  ) throw new Error('WNBA projection is incomplete and cannot be simulated.');

  const actualTrials = Math.max(2000, Math.min(50000, Math.floor(trials)));
  const seedText = seedBasis || `${projection.eventId}|${projection.expectedMargin}|${projection.expectedTotal}|${actualTrials}`;
  const rng = xorshift32(hashSeed(seedText));
  const totals = new Array<number>(actualTrials);
  const margins = new Array<number>(actualTrials);
  let homeWins = 0;
  let homeScoreSum = 0;
  let awayScoreSum = 0;

  for (let i = 0; i < actualTrials; i++) {
    const [zMargin, zTotal] = gaussianPair(rng);
    const sampledMargin = projection.expectedMargin + projection.marginStdDev * zMargin;
    const sampledTotal = Math.max(80, projection.expectedTotal + projection.totalStdDev * zTotal);
    const sampledHome = Math.max(0, (sampledTotal + sampledMargin) / 2);
    const sampledAway = Math.max(0, (sampledTotal - sampledMargin) / 2);
    if (sampledMargin > 0) homeWins++;
    homeScoreSum += sampledHome;
    awayScoreSum += sampledAway;
    totals[i] = sampledTotal;
    margins[i] = sampledMargin;
  }
  totals.sort((a, b) => a - b);
  margins.sort((a, b) => a - b);
  const homeP = homeWins / actualTrials;

  return {
    simulationVersion: 'APEX_WNBA_MONTE_CARLO_V1',
    generatedAt: new Date().toISOString(),
    trials: actualTrials,
    seed: crypto.createHash('sha256').update(seedText).digest('hex').slice(0, 12),
    eventId: projection.eventId,
    matchup,
    modelVersion: 'APEX_GAME_MARKET_V1',
    pointInTimeValid: projection.pointInTimeValid,
    reliabilityTier: projection.reliabilityTier,
    expectedHomeScore: round(projection.expectedHomeScore, 2),
    expectedAwayScore: round(projection.expectedAwayScore, 2),
    expectedMargin: round(projection.expectedMargin, 2),
    expectedTotal: round(projection.expectedTotal, 2),
    marginStdDev: round(projection.marginStdDev, 2),
    totalStdDev: round(projection.totalStdDev, 2),
    analyticHomeWinProbability: round(projection.homeWinProbability, 6),
    simulatedHomeWinProbability: round(homeP, 6),
    simulatedAwayWinProbability: round(1 - homeP, 6),
    simulatedMeanHomeScore: round(homeScoreSum / actualTrials, 2),
    simulatedMeanAwayScore: round(awayScoreSum / actualTrials, 2),
    simulatedMedianTotal: round(percentile(totals, 0.5), 1),
    simulatedP10Total: round(percentile(totals, 0.1), 1),
    simulatedP90Total: round(percentile(totals, 0.9), 1),
    simulatedMedianMargin: round(percentile(margins, 0.5), 1),
    simulatedP10Margin: round(percentile(margins, 0.1), 1),
    simulatedP90Margin: round(percentile(margins, 0.9), 1),
    status: 'SIMULATED',
    note: 'Monte Carlo trials increase scenario resolution only. They are not counted as historical evidence; only completed real WNBA games count toward calibration.',
  };
}

function calibrationBuckets(rows: WnbaBacktestRow[]): WnbaCalibrationBucket[] {
  const buckets: WnbaCalibrationBucket[] = [];
  for (let i = 0; i < 10; i++) {
    const lo = i / 10;
    const hi = (i + 1) / 10;
    const subset = rows.filter((r) => {
      const p = r.analyticHomeWinProbability;
      return i === 9 ? p >= lo && p <= hi : p >= lo && p < hi;
    });
    const pred = mean(subset.map((r) => r.analyticHomeWinProbability));
    const actual = mean(subset.map((r) => r.actualHomeWin ? 1 : 0));
    buckets.push({
      minProbability: lo,
      maxProbability: hi,
      observations: subset.length,
      meanPredictedHomeWinProbability: pred,
      actualHomeWinRate: actual,
      absoluteGap: pred === null || actual === null ? null : Math.abs(pred - actual),
    });
  }
  return buckets;
}

function expectedCalibrationError(buckets: WnbaCalibrationBucket[], total: number): number | null {
  if (!total) return null;
  let sum = 0;
  for (const b of buckets) if (b.absoluteGap !== null) sum += (b.observations / total) * b.absoluteGap;
  return sum;
}

function toRecord(game: WnbaHistoricalGame, teamId: string): TeamGameHistoryRecord {
  const home = game.homeTeamId === teamId;
  return {
    eventId: game.eventId,
    startTime: game.startTime,
    opponentId: home ? game.awayTeamId : game.homeTeamId,
    opponentName: home ? game.awayTeam : game.homeTeam,
    venueRole: game.neutralSite ? 'NEUTRAL' : home ? 'HOME' : 'AWAY',
    pointsFor: home ? game.homeScore : game.awayScore,
    pointsAgainst: home ? game.awayScore : game.homeScore,
    margin: home ? game.homeScore - game.awayScore : game.awayScore - game.homeScore,
    total: game.homeScore + game.awayScore,
  };
}

export function buildWnbaWalkForwardBacktest(params: {
  games: WnbaHistoricalGame[];
  startSeason: number;
  endSeason: number;
  teamCount?: number;
  monteCarloTrialsPerGame?: number;
}): WnbaHistoricalBacktestReport {
  const all = [...params.games]
    .filter((g) => Number.isFinite(Date.parse(g.startTime)))
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const histories = new Map<string, TeamGameHistoryRecord[]>();
  const rows: WnbaBacktestRow[] = [];
  let insufficientHistoryGames = 0;
  let leakageRejectedGames = 0;
  const trials = Math.max(1000, Math.min(5000, Math.floor(params.monteCarloTrialsPerGame ?? 2000)));

  for (const game of all) {
    const homeRecords = histories.get(game.homeTeamId) || [];
    const awayRecords = histories.get(game.awayTeamId) || [];
    const inTarget = game.season >= params.startSeason && game.season <= params.endSeason;

    if (inTarget) {
      const homeHistory = summarizeTeamHistory({
        sport: 'WNBA', teamId: game.homeTeamId, teamName: game.homeTeam, asOf: game.startTime,
        records: [...homeRecords].sort((a,b)=>Date.parse(b.startTime)-Date.parse(a.startTime)), targetVenueRole: 'HOME',
      });
      const awayHistory = summarizeTeamHistory({
        sport: 'WNBA', teamId: game.awayTeamId, teamName: game.awayTeam, asOf: game.startTime,
        records: [...awayRecords].sort((a,b)=>Date.parse(b.startTime)-Date.parse(a.startTime)), targetVenueRole: 'AWAY',
      });
      const latestHome = homeHistory.records[0]?.startTime ?? null;
      const latestAway = awayHistory.records[0]?.startTime ?? null;
      const pointInTimeValid = homeHistory.pointInTimeValid && awayHistory.pointInTimeValid &&
        (!latestHome || Date.parse(latestHome) < Date.parse(game.startTime)) &&
        (!latestAway || Date.parse(latestAway) < Date.parse(game.startTime));

      if (!pointInTimeValid) leakageRejectedGames++;
      else if (homeHistory.sampleCount < 6 || awayHistory.sampleCount < 6) insufficientHistoryGames++;
      else {
        const p = buildWnbaHistoricalProjection(homeHistory, awayHistory);
        if (!p) insufficientHistoryGames++;
        else {
          const simulation = simulateWnbaProjection({
            eventId: game.eventId,
            pointInTimeValid: true,
            reliabilityTier: p.reliabilityTier,
            expectedHomeScore: p.expectedHomeScore,
            expectedAwayScore: p.expectedAwayScore,
            expectedMargin: p.expectedMargin,
            expectedTotal: p.expectedTotal,
            marginStdDev: p.marginStdDev,
            totalStdDev: p.totalStdDev,
            homeWinProbability: p.homeWinProbability,
          }, `${game.awayTeam} @ ${game.homeTeam}`, trials, `${game.eventId}|walk-forward|${trials}`);
          const actualMargin = game.homeScore - game.awayScore;
          const actualTotal = game.homeScore + game.awayScore;
          rows.push({
            eventId: game.eventId, season: game.season, startTime: game.startTime,
            matchup: `${game.awayTeam} @ ${game.homeTeam}`,
            homeSampleCount: homeHistory.sampleCount, awaySampleCount: awayHistory.sampleCount, pointInTimeValid,
            expectedHomeScore: p.expectedHomeScore, expectedAwayScore: p.expectedAwayScore,
            expectedMargin: p.expectedMargin, expectedTotal: p.expectedTotal,
            marginStdDev: p.marginStdDev, totalStdDev: p.totalStdDev,
            analyticHomeWinProbability: p.homeWinProbability,
            monteCarloHomeWinProbability: simulation.simulatedHomeWinProbability,
            actualHomeWin: game.homeScore > game.awayScore,
            actualHomeScore: game.homeScore, actualAwayScore: game.awayScore,
            actualMargin, actualTotal,
            absoluteHomeScoreError: Math.abs(p.expectedHomeScore - game.homeScore),
            absoluteAwayScoreError: Math.abs(p.expectedAwayScore - game.awayScore),
            absoluteMarginError: Math.abs(p.expectedMargin - actualMargin),
            absoluteTotalError: Math.abs(p.expectedTotal - actualTotal),
            latestHomeHistoryAt: latestHome, latestAwayHistoryAt: latestAway,
          });
        }
      }
    }

    const homeList = histories.get(game.homeTeamId) || [];
    homeList.push(toRecord(game, game.homeTeamId));
    histories.set(game.homeTeamId, homeList);
    const awayList = histories.get(game.awayTeamId) || [];
    awayList.push(toRecord(game, game.awayTeamId));
    histories.set(game.awayTeamId, awayList);
  }

  const analyticBrier = mean(rows.map((r) => Math.pow(r.analyticHomeWinProbability - (r.actualHomeWin ? 1 : 0), 2)));
  const analyticLL = mean(rows.map((r) => logLoss(r.analyticHomeWinProbability, r.actualHomeWin ? 1 : 0)));
  const mcBrier = mean(rows.map((r) => Math.pow(r.monteCarloHomeWinProbability - (r.actualHomeWin ? 1 : 0), 2)));
  const mcLL = mean(rows.map((r) => logLoss(r.monteCarloHomeWinProbability, r.actualHomeWin ? 1 : 0)));
  const predicted = mean(rows.map((r) => r.analyticHomeWinProbability));
  const actual = mean(rows.map((r) => r.actualHomeWin ? 1 : 0));
  const buckets = calibrationBuckets(rows);
  const ece = expectedCalibrationError(buckets, rows.length);
  const gap = predicted === null || actual === null ? null : predicted - actual;
  const weight = recommendedWeight(rows.length, ece, analyticBrier, gap);
  const tier = evidenceTier(rows.length);
  const unstable = rows.length >= 30 && ((ece ?? 0) >= 0.10 || (analyticBrier ?? 0) >= 0.30);
  const status = rows.length < 30 ? 'INSUFFICIENT_EVIDENCE' : unstable ? 'UNSTABLE' : 'ACTIVE';

  const seasons = [...new Set(rows.map((r) => r.season))].sort((a,b)=>a-b);
  const bySeason = seasons.map((season) => {
    const s = rows.filter((r) => r.season === season);
    return {
      season,
      evaluatedGames: s.length,
      brierScore: mean(s.map((r) => Math.pow(r.analyticHomeWinProbability - (r.actualHomeWin ? 1 : 0), 2))),
      logLoss: mean(s.map((r) => logLoss(r.analyticHomeWinProbability, r.actualHomeWin ? 1 : 0))),
      meanAbsoluteMarginError: mean(s.map((r) => r.absoluteMarginError)),
      meanAbsoluteTotalError: mean(s.map((r) => r.absoluteTotalError)),
    };
  });

  return {
    reportVersion: 'APEX_WNBA_WALK_FORWARD_BACKTEST_V1',
    simulationVersion: 'APEX_WNBA_MONTE_CARLO_V1',
    generatedAt: new Date().toISOString(),
    source: 'ESPN_WNBA_TEAM_SCHEDULE_HISTORY',
    startSeason: params.startSeason,
    endSeason: params.endSeason,
    warmupSeason: params.startSeason - 1,
    teamCount: params.teamCount ?? new Set(all.flatMap((g) => [g.homeTeamId, g.awayTeamId])).size,
    totalCompletedGamesFetched: all.length,
    targetSeasonGames: all.filter((g) => g.season >= params.startSeason && g.season <= params.endSeason).length,
    evaluatedGames: rows.length,
    insufficientHistoryGames,
    leakageRejectedGames,
    monteCarloTrialsPerGame: trials,
    evidenceUnit: 'REAL_COMPLETED_GAMES',
    simulationTrialsAreEvidence: false,
    metrics: {
      analyticBrierScore: analyticBrier,
      analyticLogLoss: analyticLL,
      monteCarloBrierScore: mcBrier,
      monteCarloLogLoss: mcLL,
      meanPredictedHomeWinProbability: predicted,
      actualHomeWinRate: actual,
      calibrationGap: gap,
      expectedCalibrationError: ece,
      meanAbsoluteHomeScoreError: mean(rows.map((r) => r.absoluteHomeScoreError)),
      meanAbsoluteAwayScoreError: mean(rows.map((r) => r.absoluteAwayScoreError)),
      meanAbsoluteMarginError: mean(rows.map((r) => r.absoluteMarginError)),
      meanAbsoluteTotalError: mean(rows.map((r) => r.absoluteTotalError)),
      rootMeanSquaredMarginError: rmse(rows.map((r) => r.expectedMargin - r.actualMargin)),
      rootMeanSquaredTotalError: rmse(rows.map((r) => r.expectedTotal - r.actualTotal)),
    },
    evidence: {
      independentDecisiveObservations: rows.length,
      evidenceTier: tier,
      recommendedMoneylineModelWeight: weight,
      status,
      reason: status === 'ACTIVE'
        ? 'Historical WNBA moneyline calibration is active. Only real completed games count as evidence.'
        : status === 'UNSTABLE'
          ? 'Historical WNBA evidence exists but calibration quality is unstable; decision weight remains conservative.'
          : 'At least 30 leakage-free historical WNBA games are required before historical calibration can affect live moneyline decisions.',
    },
    calibrationBuckets: buckets,
    bySeason,
    historicalMarketBacktest: {
      status: 'UNAVAILABLE',
      reason: 'Authentic archived sportsbook lines/prices are not guaranteed in the public schedule history. Apex does not fabricate -110 lines or historical EV/ROI.',
    },
    rows: rows.slice(-MAX_BACKTEST_ROWS),
    notes: [
      'Strict expanding-window replay: each game is predicted only from games completed before its scheduled start time.',
      'The prior season is fetched as warm-up history but is not graded unless it falls inside the requested target season range.',
      'Monte Carlo trials estimate scenario distributions; trial count never increases the historical evidence sample size.',
      'Historical calibration is permitted to inform WNBA moneyline decision shrinkage only. Spread/total betting calibration stays prospective until authentic archived market lines are available.',
    ],
  };
}

function parseTeamIds(raw: any): Array<{ id: string; name: string }> {
  const sports = Array.isArray(raw?.sports) ? raw.sports : [];
  const leagues = sports.flatMap((s: any) => Array.isArray(s?.leagues) ? s.leagues : []);
  const teams = leagues.flatMap((l: any) => Array.isArray(l?.teams) ? l.teams : []);
  const out = new Map<string, string>();
  for (const wrapper of teams) {
    const t = wrapper?.team || wrapper;
    const id = t?.id ? String(t.id) : '';
    if (!id) continue;
    out.set(id, String(t?.displayName || t?.name || id));
  }
  return [...out.entries()].map(([id, name]) => ({ id, name }));
}

export function parseWnbaHistoricalGames(raw: any, season: number): WnbaHistoricalGame[] {
  const events = Array.isArray(raw?.events) ? raw.events : [];
  const out: WnbaHistoricalGame[] = [];
  for (const ev of events) {
    const comp = ev?.competitions?.[0] || {};
    const completed = comp?.status?.type?.completed === true || String(comp?.status?.type?.state || '').toLowerCase() === 'post';
    if (!completed) continue;
    const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
    const home = competitors.find((c: any) => String(c?.homeAway || '').toLowerCase() === 'home');
    const away = competitors.find((c: any) => String(c?.homeAway || '').toLowerCase() === 'away');
    if (!home || !away) continue;
    const hs = score(home?.score), as = score(away?.score);
    const homeId = home?.team?.id ? String(home.team.id) : home?.id ? String(home.id) : '';
    const awayId = away?.team?.id ? String(away.team.id) : away?.id ? String(away.id) : '';
    const startTime = String(ev?.date || comp?.date || '');
    if (!homeId || !awayId || hs === null || as === null || !Number.isFinite(Date.parse(startTime))) continue;
    out.push({
      eventId: String(ev?.id || `${season}-${homeId}-${awayId}-${startTime}`),
      season,
      startTime,
      homeTeamId: homeId,
      homeTeam: String(home?.team?.displayName || home?.team?.name || homeId),
      awayTeamId: awayId,
      awayTeam: String(away?.team?.displayName || away?.team?.name || awayId),
      homeScore: hs,
      awayScore: as,
      neutralSite: comp?.neutralSite === true,
    });
  }
  return out;
}

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'ApexPicks/1.14.8 WNBA Backtest', Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;
  async function worker() {
    while (true) {
      const i = index++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export class WnbaBacktestMonteCarloService {
  getSavedReport(): WnbaHistoricalBacktestReport | null {
    try {
      const p = reportPath();
      if (!fs.existsSync(p)) return null;
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      return parsed?.reportVersion === 'APEX_WNBA_WALK_FORWARD_BACKTEST_V1' ? parsed : null;
    } catch { return null; }
  }

  getMoneylineEvidence() {
    const report = this.getSavedReport();
    if (!report || report.evidence.status === 'INSUFFICIENT_EVIDENCE') return null;
    return {
      independentDecisiveObservations: report.evidence.independentDecisiveObservations,
      calibrationGap: report.metrics.calibrationGap,
      expectedCalibrationError: report.metrics.expectedCalibrationError,
      brierScore: report.metrics.analyticBrierScore,
      logLoss: report.metrics.analyticLogLoss,
      evidenceTier: report.evidence.evidenceTier,
      recommendedModelWeight: report.evidence.status === 'UNSTABLE'
        ? Math.min(0.42, report.evidence.recommendedMoneylineModelWeight)
        : report.evidence.recommendedMoneylineModelWeight,
      source: 'WNBA_HISTORICAL_WALK_FORWARD',
      generatedAt: report.generatedAt,
    };
  }

  async runHistoricalBacktest(startSeason = new Date().getUTCFullYear() - 2, endSeason = new Date().getUTCFullYear(), trialsPerGame = 2000) {
    if (!Number.isInteger(startSeason) || !Number.isInteger(endSeason) || startSeason < 1997 || endSeason < startSeason || endSeason - startSeason > 5) {
      throw new Error('WNBA backtest season range must be valid and span no more than six seasons.');
    }
    const teamsRaw = await fetchJson(ESPN_TEAMS);
    const teams = parseTeamIds(teamsRaw);
    if (!teams.length) throw new Error('WNBA team list could not be resolved from ESPN.');
    const seasons = Array.from({ length: endSeason - (startSeason - 1) + 1 }, (_, i) => startSeason - 1 + i);
    const tasks = seasons.flatMap((season) => teams.map((team) => ({ season, team })));
    const chunks = await mapLimit(tasks, 4, async ({ season, team }) => {
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/${encodeURIComponent(team.id)}/schedule?season=${season}`;
        const raw = await fetchJson(url);
        return parseWnbaHistoricalGames(raw, season);
      } catch (err: any) {
        console.warn(`[Apex Picks] WNBA historical schedule skipped ${team.name} ${season}: ${err?.message || err}`);
        return [] as WnbaHistoricalGame[];
      }
    });
    const dedup = new Map<string, WnbaHistoricalGame>();
    for (const game of chunks.flat()) dedup.set(game.eventId, game);
    const games = [...dedup.values()].sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime));
    const report = buildWnbaWalkForwardBacktest({ games, startSeason, endSeason, teamCount: teams.length, monteCarloTrialsPerGame: trialsPerGame });
    fs.mkdirSync(dataDir(), { recursive: true });
    const p = reportPath(), tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(report, null, 2));
    fs.renameSync(tmp, p);
    return report;
  }

  async simulateGame(game: NormalizedApexGame, trials = 25000): Promise<WnbaMonteCarloResult> {
    if (game.sport !== 'WNBA' || game.status !== 'UPCOMING' || game.pregameBetEligible === false || Date.parse(game.startTime) <= Date.now()) {
      throw new Error('A verified upcoming WNBA game is required for pregame Monte Carlo simulation.');
    }
    const { gameMarketModelService } = await import('./gameMarketModelService.js');
    const projection = await gameMarketModelService.buildProjection(game);
    if (projection.status !== 'AVAILABLE' || !projection.pointInTimeValid) throw new Error(projection.reason || 'WNBA production projection is unavailable.');
    return simulateWnbaProjection(projection, `${game.awayTeam} @ ${game.homeTeam}`, trials);
  }
}

export const wnbaBacktestMonteCarloService = new WnbaBacktestMonteCarloService();
