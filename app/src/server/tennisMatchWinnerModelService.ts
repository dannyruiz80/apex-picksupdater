import {
  DecisionBoardPick,
  NormalizedApexEventMarkets,
  NormalizedApexGame,
  NormalizedBookmakerMarkets,
  SampleReliabilityTier,
  TennisTour,
} from '../types.js';

const ESPN_ATP_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard';
const ESPN_WTA_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard';

const INITIAL_HISTORY_DAYS = 30;
const MAX_HISTORY_DAYS = 120;
const HISTORY_WINDOW_DAYS = 30;
const HISTORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PROJECTION_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_QUOTE_AGE_MS = 10 * 60 * 1000;
const MIN_MARKET_DEPTH = 2;
const MIN_EDGE = 0.03;
const MIN_EV_PERCENT = 3.0;
const REVIEW_MARKET_DISAGREEMENT_PP = 8.0;
const VERIFY_MARKET_DISAGREEMENT_PP = 12.0;
const REVIEW_EV_PERCENT = 10.0;
const VERIFY_EV_PERCENT = 20.0;
const MAX_MARKET_CONSENSUS_DISPERSION_PP = 8.0;
const ALIGNMENT_COMPLEMENT_TOLERANCE = 0.005;

export interface TennisHistoryMatch {
  eventId: string;
  startTime: string;
  tour: TennisTour;
  surface: string | null;
  playerAId: string | null;
  playerAName: string;
  playerBId: string | null;
  playerBName: string;
  winner: 'A' | 'B';
}

export interface TennisPlayerHistorySummary {
  playerId: string | null;
  playerName: string;
  sampleCount: number;
  wins: number;
  losses: number;
  weightedWinRate: number | null;
  surfaceSampleCount: number;
  surfaceWeightedWinRate: number | null;
  latestCompletedMatchAt: string | null;
  pointInTimeValid: boolean;
}

export interface TennisMatchWinnerProjection {
  modelVersion: 'APEX_TENNIS_MATCH_WINNER_V1';
  generatedAt: string;
  asOf: string;
  eventId: string;
  status: 'AVAILABLE' | 'INSUFFICIENT_DATA' | 'UNSUPPORTED';
  reason: string | null;
  validationStatus: 'EARLY_EVIDENCE';
  source: 'ESPN_TENNIS_SCOREBOARD_HISTORY';
  pointInTimeValid: boolean;
  reliabilityTier: SampleReliabilityTier;
  playerAProbability: number | null;
  playerBProbability: number | null;
  playerAHistory: TennisPlayerHistorySummary;
  playerBHistory: TennisPlayerHistorySummary;
  targetSurface: string | null;
  notes: string[];
}

interface CachedRawHistory {
  fetchedAt: number;
  matches: TennisHistoryMatch[];
}

interface CachedProjection {
  generatedAtMs: number;
  projection: TennisMatchWinnerProjection;
}

export interface TennisModelMarketAlignmentAudit {
  status: 'PASS' | 'FAIL';
  reasons: string[];
  recognizedBookPairs: number;
  moneylineBookCount: number;
  ambiguousBookCount: number;
  modelProbabilitySum: number | null;
  marketConsensusAway: number | null;
  marketConsensusHome: number | null;
  marketConsensusSum: number | null;
  marketDispersionPP: number | null;
  eventDisagreementPP: number | null;
}

export interface TennisMoneylineEvaluation {
  picks: DecisionBoardPick[];
  rejectionReasons: Record<string, number>;
  candidateCount: number;
  alignmentAudit: TennisModelMarketAlignmentAudit;
}

const rawHistoryCache = new Map<string, CachedRawHistory>();
const projectionCache = new Map<string, CachedProjection>();

function clamp(x: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, x));
}

function addReason(target: Record<string, number>, reason: string): void {
  target[reason] = (target[reason] || 0) + 1;
}

function normalizeName(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tennisNameMatchConfidence(a: string | null | undefined, b: string | null | undefined): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) {
    const ratio = Math.min(x.length, y.length) / Math.max(x.length, y.length);
    return Math.max(0.88, ratio);
  }
  const xp = x.split(' ').filter(Boolean);
  const yp = y.split(' ').filter(Boolean);
  if (!xp.length || !yp.length) return 0;
  const xl = xp[xp.length - 1];
  const yl = yp[yp.length - 1];
  if (xl === yl && xl.length >= 3) {
    if (xp.length === 1 || yp.length === 1) return 0.88;
    if (xp[0][0] === yp[0][0]) return 0.95;
    return 0.70;
  }
  const xs = new Set(xp.filter((t) => t.length > 1));
  const ys = new Set(yp.filter((t) => t.length > 1));
  if (!xs.size || !ys.size) return 0;
  let matched = 0;
  for (const token of xs) if (ys.has(token)) matched++;
  return matched / Math.max(xs.size, ys.size);
}

function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return tennisNameMatchConfidence(a, b) >= 0.88;
}

function samePlayer(
  targetId: string | null | undefined,
  targetName: string | null | undefined,
  candidateId: string | null | undefined,
  candidateName: string | null | undefined,
): boolean {
  if (targetId && candidateId && String(targetId) === String(candidateId)) return true;
  return namesMatch(targetName, candidateName);
}

function americanImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 1;
}

function americanDecimal(odds: number): number {
  if (odds > 0) return 1 + odds / 100;
  if (odds < 0) return 1 + 100 / Math.abs(odds);
  return 1;
}

function expectedValuePercent(probability: number, odds: number): number {
  const decimal = americanDecimal(odds);
  return ((probability * decimal) - 1) * 100;
}

function quoteAgeSeconds(timestamp: string): number | null {
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? Math.max(0, Math.round((Date.now() - ms) / 1000)) : null;
}

function reliabilityTier(sampleCount: number): SampleReliabilityTier {
  if (sampleCount >= 12) return 'STRONG';
  if (sampleCount >= 6) return 'MODERATE';
  if (sampleCount >= 3) return 'LIMITED';
  return 'VERY_LIMITED';
}

function minimumReliability(a: SampleReliabilityTier, b: SampleReliabilityTier): SampleReliabilityTier {
  const order: Record<SampleReliabilityTier, number> = {
    VERY_LIMITED: 0,
    LIMITED: 1,
    MODERATE: 2,
    STRONG: 3,
  };
  return order[a] <= order[b] ? a : b;
}

function dateAddDays(isoDate: string, delta: number): string {
  const parts = isoDate.slice(0, 10).split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], Math.max(0, parts[1] - 1), parts[2]));
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function ymd(date: string): string {
  return date.replace(/-/g, '');
}

function extractCompetitions(event: any): any[] {
  const out: any[] = [];
  if (Array.isArray(event?.competitions)) out.push(...event.competitions);
  if (Array.isArray(event?.groupings)) {
    for (const group of event.groupings) {
      if (Array.isArray(group?.competitions)) out.push(...group.competitions);
    }
  }
  return out;
}

function rawCompetitorName(comp: any): string {
  return String(
    comp?.athlete?.displayName ||
    comp?.athlete?.fullName ||
    comp?.roster?.displayName ||
    comp?.name ||
    'Unknown Player'
  );
}

function historyCompetitionFormat(comp: any): 'SINGLES' | 'DOUBLES' | 'OTHER' {
  const slug = String(comp?.type?.slug || '').toLowerCase();
  const text = String(comp?.type?.text || '').toLowerCase();
  const combined = `${slug} ${text}`;
  if (combined.includes('double')) return 'DOUBLES';
  if (combined.includes('single')) return 'SINGLES';
  const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
  if (competitors.length >= 2 && competitors.every((c: any) => String(c?.type || '').toLowerCase() === 'athlete')) return 'SINGLES';
  if (competitors.some((c: any) => String(c?.type || '').toLowerCase() === 'team' || String(c?.roster?.displayName || '').includes('/'))) return 'DOUBLES';
  return 'OTHER';
}

function historyCompetitionTour(comp: any, fallback: TennisTour): TennisTour {
  const combined = `${String(comp?.type?.slug || '').toLowerCase()} ${String(comp?.type?.text || '').toLowerCase()}`;
  if (combined.includes('women')) return 'WTA';
  if (combined.includes('men')) return 'ATP';
  return fallback;
}

function unresolvedHistoryParticipant(name: string): boolean {
  const n = normalizeName(name);
  return !n || n === 'tbd' || n === 'unknown player';
}

function parseHistoryMatches(raw: any, tour: TennisTour, requestedDate: string): TennisHistoryMatch[] {
  const matches: TennisHistoryMatch[] = [];
  for (const event of Array.isArray(raw?.events) ? raw.events : []) {
    for (const comp of extractCompetitions(event)) {
      if (historyCompetitionFormat(comp) !== 'SINGLES') continue;
      if (historyCompetitionTour(comp, tour) !== tour) continue;
      const statusName = String(comp?.status?.type?.name || '').toUpperCase();
      const state = String(comp?.status?.type?.state || '').toLowerCase();
      const completed = comp?.status?.type?.completed === true || state === 'post';
      if (!completed) continue;
      if (statusName.includes('WALKOVER')) continue;

      const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
      if (competitors.length < 2) continue;
      const a = competitors[0];
      const b = competitors[1];
      const aName = rawCompetitorName(a);
      const bName = rawCompetitorName(b);
      if (unresolvedHistoryParticipant(aName) || unresolvedHistoryParticipant(bName) || aName.includes('/') || bName.includes('/')) continue;
      let winner: 'A' | 'B' | null = null;
      if (a?.winner === true) winner = 'A';
      else if (b?.winner === true) winner = 'B';
      if (!winner) continue;

      const startTime = String(comp?.date || comp?.startDate || event?.date || `${requestedDate}T12:00:00Z`);
      if (!Number.isFinite(Date.parse(startTime))) continue;
      const surface = String(comp?.surface || comp?.venue?.surface || event?.surface || event?.venue?.surface || '').trim() || null;

      matches.push({
        eventId: String(comp?.id || `${event?.id || requestedDate}-${rawCompetitorName(a)}-${rawCompetitorName(b)}`),
        startTime,
        tour,
        surface,
        playerAId: a?.athlete?.id ? String(a.athlete.id) : a?.id ? String(a.id) : null,
        playerAName: aName,
        playerBId: b?.athlete?.id ? String(b.athlete.id) : b?.id ? String(b.id) : null,
        playerBName: bName,
        winner,
      });
    }
  }
  return matches;
}

async function fetchHistoryDay(date: string, tour: TennisTour): Promise<TennisHistoryMatch[]> {
  const key = `${tour}|${date}`;
  const cached = rawHistoryCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < HISTORY_CACHE_TTL_MS) return cached.matches;

  const base = tour === 'ATP' ? ESPN_ATP_SCOREBOARD_URL : ESPN_WTA_SCOREBOARD_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${base}?dates=${ymd(date)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ApexPicks/1.14.7 TennisMatchWinner', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`ESPN tennis history HTTP ${res.status}`);
    const raw = await res.json();
    const matches = parseHistoryMatches(raw, tour, date);
    rawHistoryCache.set(key, { fetchedAt: Date.now(), matches });
    return matches;
  } finally {
    clearTimeout(timer);
  }
}

async function loadHistoryWindow(asOfDate: string, tour: TennisTour, startDay: number, dayCount: number): Promise<TennisHistoryMatch[]> {
  const dates = Array.from({ length: dayCount }, (_, i) => dateAddDays(asOfDate, -(startDay + i + 1)));
  const all: TennisHistoryMatch[] = [];

  // Six requests at a time keeps ESPN load controlled. Per-day results are cached for six hours.
  for (let i = 0; i < dates.length; i += 6) {
    const batch = dates.slice(i, i + 6);
    const settled = await Promise.allSettled(batch.map((d) => fetchHistoryDay(d, tour)));
    for (const result of settled) {
      if (result.status === 'fulfilled') all.push(...result.value);
    }
  }
  return all;
}

async function loadAdaptiveHistory(game: NormalizedApexGame): Promise<TennisHistoryMatch[]> {
  const asOfDate = (game.scheduleDate || game.startTime.slice(0, 10)).slice(0, 10);
  const all: TennisHistoryMatch[] = [];

  for (let startDay = 0; startDay < MAX_HISTORY_DAYS; startDay += HISTORY_WINDOW_DAYS) {
    const dayCount = startDay === 0 ? INITIAL_HISTORY_DAYS : Math.min(HISTORY_WINDOW_DAYS, MAX_HISTORY_DAYS - startDay);
    const window = await loadHistoryWindow(asOfDate, game.tour!, startDay, dayCount);
    all.push(...window);

    const unique = new Map<string, TennisHistoryMatch>();
    for (const match of all) unique.set(match.eventId, match);
    const rows = [...unique.values()].sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
    const a = summarizePlayer(rows, game.playerAId, game.playerAName, game.startTime, game.surface || null);
    const b = summarizePlayer(rows, game.playerBId, game.playerBName, game.startTime, game.surface || null);
    if (a.sampleCount >= 6 && b.sampleCount >= 6) return rows;
  }

  const unique = new Map<string, TennisHistoryMatch>();
  for (const match of all) unique.set(match.eventId, match);
  return [...unique.values()].sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
}

function weightedRate(records: Array<{ win: boolean }>, pseudoGames = 4): number | null {
  if (!records.length) return null;
  let weightedWins = 0;
  let weightedTotal = 0;
  for (let i = 0; i < records.length; i++) {
    const w = Math.pow(0.94, i);
    weightedWins += (records[i].win ? 1 : 0) * w;
    weightedTotal += w;
  }
  // Symmetric pseudo-games shrink small samples toward 50% without using sportsbook prices.
  return (weightedWins + pseudoGames / 2) / (weightedTotal + pseudoGames);
}

function summarizePlayer(
  matches: TennisHistoryMatch[],
  playerId: string | null | undefined,
  playerName: string | null | undefined,
  asOf: string,
  targetSurface: string | null,
): TennisPlayerHistorySummary {
  const asOfMs = Date.parse(asOf);
  const rows = matches
    .filter((m) => Date.parse(m.startTime) < asOfMs)
    .filter((m) =>
      samePlayer(playerId, playerName, m.playerAId, m.playerAName) ||
      samePlayer(playerId, playerName, m.playerBId, m.playerBName)
    )
    .slice(0, 30)
    .map((m) => {
      const isA = samePlayer(playerId, playerName, m.playerAId, m.playerAName);
      return { match: m, win: (isA && m.winner === 'A') || (!isA && m.winner === 'B') };
    });

  const normalizedTargetSurface = normalizeName(targetSurface);
  const surfaceRows = normalizedTargetSurface
    ? rows.filter((r) => normalizeName(r.match.surface) === normalizedTargetSurface)
    : [];

  return {
    playerId: playerId ? String(playerId) : null,
    playerName: String(playerName || 'Unknown Player'),
    sampleCount: rows.length,
    wins: rows.filter((r) => r.win).length,
    losses: rows.filter((r) => !r.win).length,
    weightedWinRate: weightedRate(rows),
    surfaceSampleCount: surfaceRows.length,
    surfaceWeightedWinRate: weightedRate(surfaceRows),
    latestCompletedMatchAt: rows[0]?.match.startTime ?? null,
    pointInTimeValid: rows.every((r) => Date.parse(r.match.startTime) < asOfMs),
  };
}

function logit(p: number): number {
  const bounded = clamp(p, 0.08, 0.92);
  return Math.log(bounded / (1 - bounded));
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function estimateTennisWinProbability(
  playerA: TennisPlayerHistorySummary,
  playerB: TennisPlayerHistorySummary,
): { playerA: number | null; playerB: number | null } {
  if (playerA.weightedWinRate === null || playerB.weightedWinRate === null) {
    return { playerA: null, playerB: null };
  }

  let rateA = playerA.weightedWinRate;
  let rateB = playerB.weightedWinRate;
  if (playerA.surfaceSampleCount >= 4 && playerA.surfaceWeightedWinRate !== null) {
    rateA = rateA * 0.75 + playerA.surfaceWeightedWinRate * 0.25;
  }
  if (playerB.surfaceSampleCount >= 4 && playerB.surfaceWeightedWinRate !== null) {
    rateB = rateB * 0.75 + playerB.surfaceWeightedWinRate * 0.25;
  }

  // Bradley-Terry/log5-style matchup transformation with tempering for an early-evidence model.
  const pA = clamp(logistic(0.72 * (logit(rateA) - logit(rateB))), 0.18, 0.82);
  return { playerA: pA, playerB: 1 - pA };
}

export function buildTennisProjectionFromHistory(
  game: NormalizedApexGame,
  matches: TennisHistoryMatch[],
): TennisMatchWinnerProjection {
  const empty = (id: string | null | undefined, name: string | null | undefined): TennisPlayerHistorySummary => ({
    playerId: id ? String(id) : null,
    playerName: String(name || 'Unknown Player'),
    sampleCount: 0,
    wins: 0,
    losses: 0,
    weightedWinRate: null,
    surfaceSampleCount: 0,
    surfaceWeightedWinRate: null,
    latestCompletedMatchAt: null,
    pointInTimeValid: true,
  });

  if (game.sport !== 'TENNIS' || !game.playerAName || !game.playerBName || !game.startTime) {
    return {
      modelVersion: 'APEX_TENNIS_MATCH_WINNER_V1', generatedAt: new Date().toISOString(), asOf: game.startTime,
      eventId: game.eventId, status: 'UNSUPPORTED', reason: 'TENNIS_PARTICIPANT_IDENTITY_UNAVAILABLE',
      validationStatus: 'EARLY_EVIDENCE', source: 'ESPN_TENNIS_SCOREBOARD_HISTORY', pointInTimeValid: false,
      reliabilityTier: 'VERY_LIMITED', playerAProbability: null, playerBProbability: null,
      playerAHistory: empty(game.playerAId, game.playerAName), playerBHistory: empty(game.playerBId, game.playerBName),
      targetSurface: game.surface || null, notes: ['Tennis match-winner model requires verified player A/player B identity.'],
    };
  }

  const a = summarizePlayer(matches, game.playerAId, game.playerAName, game.startTime, game.surface || null);
  const b = summarizePlayer(matches, game.playerBId, game.playerBName, game.startTime, game.surface || null);
  const rel = minimumReliability(reliabilityTier(a.sampleCount), reliabilityTier(b.sampleCount));
  const probs = estimateTennisWinProbability(a, b);
  const pointInTimeValid = a.pointInTimeValid && b.pointInTimeValid;
  const available = probs.playerA !== null && probs.playerB !== null && rel !== 'VERY_LIMITED' && rel !== 'LIMITED' && pointInTimeValid;

  return {
    modelVersion: 'APEX_TENNIS_MATCH_WINNER_V1',
    generatedAt: new Date().toISOString(),
    asOf: game.startTime,
    eventId: game.eventId,
    status: available ? 'AVAILABLE' : 'INSUFFICIENT_DATA',
    reason: available ? null : !pointInTimeValid ? 'POINT_IN_TIME_INVALID' : 'MINIMUM_6_COMPLETED_MATCHES_PER_PLAYER_REQUIRED',
    validationStatus: 'EARLY_EVIDENCE',
    source: 'ESPN_TENNIS_SCOREBOARD_HISTORY',
    pointInTimeValid,
    reliabilityTier: rel,
    playerAProbability: probs.playerA,
    playerBProbability: probs.playerB,
    playerAHistory: a,
    playerBHistory: b,
    targetSurface: game.surface || null,
    notes: [
      'Raw match-winner probability uses only completed ESPN singles history before the scheduled start time.',
      'History lookback expands adaptively from 30 up to 120 days only when needed to preserve the minimum six completed singles matches per player.',
      'Recent results are recency weighted and small samples are symmetrically shrunk toward 50%.',
      'Verified same-surface history contributes only when at least four prior matches exist for that player.',
      'Sportsbook prices are excluded from the raw tennis probability and enter only after forecasting for edge/EV evaluation.',
      'Tennis spreads, totals, doubles and player props remain fail-closed in v1.14.7.',
    ],
  };
}

function participantSide(game: NormalizedApexGame, name: string): 'AWAY' | 'HOME' | null {
  // Tennis adapter identity: player A is carried in awayTeam; player B in homeTeam.
  // Use a confidence margin so abbreviated book names can resolve without allowing ambiguous surnames to cross-map.
  const aScore = Math.max(tennisNameMatchConfidence(name, game.playerAName), tennisNameMatchConfidence(name, game.awayTeam));
  const bScore = Math.max(tennisNameMatchConfidence(name, game.playerBName), tennisNameMatchConfidence(name, game.homeTeam));
  const best = Math.max(aScore, bScore);
  if (best < 0.88 || Math.abs(aScore - bScore) < 0.06) return null;
  return aScore > bScore ? 'AWAY' : 'HOME';
}

interface TennisPricedOutcome {
  side: 'AWAY' | 'HOME';
  name: string;
  sportsbook: string;
  oddsAmerican: number;
  timestamp: string;
  noVigProbability: number | null;
}

interface FreshTennisMoneylineResult {
  outcomes: TennisPricedOutcome[];
  recognizedBookPairs: number;
  moneylineBookCount: number;
  ambiguousBookCount: number;
  awayNoVigProbabilities: number[];
  homeNoVigProbabilities: number[];
}

function emptyAlignmentAudit(reason: string): TennisModelMarketAlignmentAudit {
  return {
    status: 'FAIL',
    reasons: [reason],
    recognizedBookPairs: 0,
    moneylineBookCount: 0,
    ambiguousBookCount: 0,
    modelProbabilitySum: null,
    marketConsensusAway: null,
    marketConsensusHome: null,
    marketConsensusSum: null,
    marketDispersionPP: null,
    eventDisagreementPP: null,
  };
}

function freshMoneylineOutcomes(game: NormalizedApexGame, bookmakers: NormalizedBookmakerMarkets[]): FreshTennisMoneylineResult {
  const out: TennisPricedOutcome[] = [];
  const awayNoVigProbabilities: number[] = [];
  const homeNoVigProbabilities: number[] = [];
  let recognizedBookPairs = 0;
  let moneylineBookCount = 0;
  let ambiguousBookCount = 0;

  for (const book of bookmakers) {
    const moneyline = book.markets.find((m) => m.marketType === 'MONEYLINE');
    if (!moneyline) continue;
    moneylineBookCount++;

    const timestamp = moneyline.lastUpdate || book.lastUpdate;
    const quoteMs = Date.parse(timestamp);
    const age = Date.now() - quoteMs;
    if (!Number.isFinite(quoteMs) || !Number.isFinite(age) || age > MAX_QUOTE_AGE_MS) continue;

    const recognized = moneyline.outcomes
      .map((o) => ({ o, side: participantSide(game, o.name) }))
      .filter((x): x is { o: typeof moneyline.outcomes[number]; side: 'AWAY' | 'HOME' } => x.side !== null);
    const awayRows = recognized.filter((x) => x.side === 'AWAY');
    const homeRows = recognized.filter((x) => x.side === 'HOME');

    // A production tennis H2H quote must resolve to exactly one participant on each side.
    // Extra/duplicate/ambiguous outcomes are ignored for this book rather than guessed.
    if (moneyline.outcomes.length !== 2 || recognized.length !== 2 || awayRows.length !== 1 || homeRows.length !== 1) {
      ambiguousBookCount++;
      continue;
    }

    const a = awayRows[0];
    const b = homeRows[0];
    if (!Number.isFinite(a.o.americanOdds) || !Number.isFinite(b.o.americanOdds) || a.o.americanOdds === 0 || b.o.americanOdds === 0) {
      ambiguousBookCount++;
      continue;
    }

    const ia = americanImplied(a.o.americanOdds);
    const ib = americanImplied(b.o.americanOdds);
    const denom = ia + ib;
    if (!Number.isFinite(denom) || denom <= 0) {
      ambiguousBookCount++;
      continue;
    }
    const noVigA = ia / denom;
    const noVigB = ib / denom;
    if (!Number.isFinite(noVigA) || !Number.isFinite(noVigB)) {
      ambiguousBookCount++;
      continue;
    }

    recognizedBookPairs++;
    awayNoVigProbabilities.push(noVigA);
    homeNoVigProbabilities.push(noVigB);
    out.push({
      side: 'AWAY',
      name: a.o.name,
      sportsbook: book.title,
      oddsAmerican: a.o.americanOdds,
      timestamp,
      noVigProbability: noVigA,
    });
    out.push({
      side: 'HOME',
      name: b.o.name,
      sportsbook: book.title,
      oddsAmerican: b.o.americanOdds,
      timestamp,
      noVigProbability: noVigB,
    });
  }

  return {
    outcomes: out,
    recognizedBookPairs,
    moneylineBookCount,
    ambiguousBookCount,
    awayNoVigProbabilities,
    homeNoVigProbabilities,
  };
}

function marketRangePP(values: number[]): number | null {
  if (values.length < 2) return null;
  return (Math.max(...values) - Math.min(...values)) * 100;
}

function buildAlignmentAudit(
  game: NormalizedApexGame,
  projection: TennisMatchWinnerProjection,
  fresh: FreshTennisMoneylineResult,
): TennisModelMarketAlignmentAudit {
  const reasons: string[] = [];
  const pA = projection.playerAProbability;
  const pB = projection.playerBProbability;
  const modelProbabilitySum = pA !== null && pB !== null ? pA + pB : null;

  const aOwn = Math.max(tennisNameMatchConfidence(game.playerAName, game.awayTeam), tennisNameMatchConfidence(game.awayTeam, game.playerAName));
  const aCross = Math.max(tennisNameMatchConfidence(game.playerAName, game.homeTeam), tennisNameMatchConfidence(game.awayTeam, game.playerBName));
  const bOwn = Math.max(tennisNameMatchConfidence(game.playerBName, game.homeTeam), tennisNameMatchConfidence(game.homeTeam, game.playerBName));
  const bCross = Math.max(tennisNameMatchConfidence(game.playerBName, game.awayTeam), tennisNameMatchConfidence(game.homeTeam, game.playerAName));
  if (aOwn < 0.88 || bOwn < 0.88 || aOwn - aCross < 0.06 || bOwn - bCross < 0.06) {
    reasons.push('TENNIS_MODEL_SIDE_IDENTITY_UNVERIFIED');
  }

  if (
    pA === null || pB === null ||
    !Number.isFinite(pA) || !Number.isFinite(pB) ||
    pA <= 0 || pA >= 1 || pB <= 0 || pB >= 1 ||
    modelProbabilitySum === null || Math.abs(modelProbabilitySum - 1) > ALIGNMENT_COMPLEMENT_TOLERANCE
  ) {
    reasons.push('TENNIS_MODEL_COMPLEMENT_INVALID');
  }

  if (fresh.moneylineBookCount > 0 && fresh.recognizedBookPairs === 0) {
    reasons.push('TENNIS_MARKET_SIDE_IDENTITY_UNRESOLVED');
  }

  const marketConsensusAway = mean(fresh.awayNoVigProbabilities);
  const marketConsensusHome = mean(fresh.homeNoVigProbabilities);
  const marketConsensusSum = marketConsensusAway !== null && marketConsensusHome !== null
    ? marketConsensusAway + marketConsensusHome
    : null;
  if (
    marketConsensusSum !== null &&
    (!Number.isFinite(marketConsensusSum) || Math.abs(marketConsensusSum - 1) > ALIGNMENT_COMPLEMENT_TOLERANCE)
  ) {
    reasons.push('TENNIS_MARKET_COMPLEMENT_INVALID');
  }

  const marketDispersionPP = marketRangePP(fresh.awayNoVigProbabilities);
  if (marketDispersionPP !== null && marketDispersionPP > MAX_MARKET_CONSENSUS_DISPERSION_PP) {
    reasons.push('TENNIS_MARKET_CONSENSUS_DISPERSED');
  }

  const eventDisagreementPP =
    pA !== null && marketConsensusAway !== null && Number.isFinite(pA) && Number.isFinite(marketConsensusAway)
      ? Math.abs(pA - marketConsensusAway) * 100
      : null;

  return {
    status: reasons.length ? 'FAIL' : 'PASS',
    reasons,
    recognizedBookPairs: fresh.recognizedBookPairs,
    moneylineBookCount: fresh.moneylineBookCount,
    ambiguousBookCount: fresh.ambiguousBookCount,
    modelProbabilitySum,
    marketConsensusAway,
    marketConsensusHome,
    marketConsensusSum,
    marketDispersionPP,
    eventDisagreementPP,
  };
}

export function auditTennisModelMarketAlignment(
  game: NormalizedApexGame,
  markets: NormalizedApexEventMarkets,
  projection: TennisMatchWinnerProjection,
): TennisModelMarketAlignmentAudit {
  return buildAlignmentAudit(game, projection, freshMoneylineOutcomes(game, markets.bookmakers));
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function decisionWeight(reliability: SampleReliabilityTier): number {
  // Conservative early-evidence weight. It does not alter the 3pp edge / 3% EV production thresholds.
  return reliability === 'STRONG' ? 0.50 : reliability === 'MODERATE' ? 0.35 : 0.20;
}

export function evaluateTennisMoneylineMarkets(
  game: NormalizedApexGame,
  markets: NormalizedApexEventMarkets,
  projection: TennisMatchWinnerProjection,
): TennisMoneylineEvaluation {
  const rejectionReasons: Record<string, number> = {};
  if (projection.status !== 'AVAILABLE' || projection.playerAProbability === null || projection.playerBProbability === null) {
    addReason(rejectionReasons, `TENNIS_MODEL_${projection.status}`);
    return { picks: [], rejectionReasons, candidateCount: 0, alignmentAudit: emptyAlignmentAudit(`TENNIS_MODEL_${projection.status}`) };
  }

  const fresh = freshMoneylineOutcomes(game, markets.bookmakers);
  const outcomes = fresh.outcomes;
  const awayGroup = outcomes.filter((o) => o.side === 'AWAY');
  const homeGroup = outcomes.filter((o) => o.side === 'HOME');
  const candidateCount = (awayGroup.length ? 1 : 0) + (homeGroup.length ? 1 : 0);
  const alignmentAudit = buildAlignmentAudit(game, projection, fresh);

  // Structural identity/complement/market-dispersion failures are event-level and fail closed once.
  // This keeps coverage counts interpretable instead of double-counting the same match for both sides.
  for (const reason of alignmentAudit.reasons) addReason(rejectionReasons, reason);
  if (alignmentAudit.status === 'FAIL') {
    if (!candidateCount) addReason(rejectionReasons, 'TENNIS_MATCH_WINNER_MARKET_UNAVAILABLE');
    return { picks: [], rejectionReasons, candidateCount, alignmentAudit };
  }

  const eventIntegrityReasons: string[] = [];
  if (alignmentAudit.eventDisagreementPP !== null && alignmentAudit.eventDisagreementPP >= VERIFY_MARKET_DISAGREEMENT_PP) {
    eventIntegrityReasons.push('MODEL_MARKET_DISAGREEMENT_EXTREME');
  } else if (alignmentAudit.eventDisagreementPP !== null && alignmentAudit.eventDisagreementPP >= REVIEW_MARKET_DISAGREEMENT_PP) {
    eventIntegrityReasons.push('MODEL_MARKET_DISAGREEMENT_HEIGHTENED');
  }
  // Model-vs-market disagreement is symmetric for a valid two-way match, so count it once per event.
  for (const reason of eventIntegrityReasons) addReason(rejectionReasons, reason);

  const picks: DecisionBoardPick[] = [];
  for (const side of ['AWAY', 'HOME'] as const) {
    const group = side === 'AWAY' ? awayGroup : homeGroup;
    if (!group.length) continue;
    const sorted = [...group].sort((a, b) => b.oddsAmerican - a.oddsAmerican);
    const best = sorted[0];
    const depth = new Set(group.map((g) => g.sportsbook)).size;
    const consensus = side === 'AWAY' ? alignmentAudit.marketConsensusAway : alignmentAudit.marketConsensusHome;
    const rawProbability = side === 'AWAY' ? projection.playerAProbability : projection.playerBProbability;
    const breakEven = americanImplied(best.oddsAmerican);
    const reference = clamp(consensus ?? breakEven);
    const weight = decisionWeight(projection.reliabilityTier);
    const guarded = clamp(rawProbability * weight + reference * (1 - weight));
    const edge = guarded - breakEven;
    const evPercent = expectedValuePercent(guarded, best.oddsAmerican);
    const rawEvPercent = expectedValuePercent(rawProbability, best.oddsAmerican);
    const disagreement = alignmentAudit.eventDisagreementPP;

    const blockers: string[] = [];
    if (projection.reliabilityTier === 'VERY_LIMITED' || projection.reliabilityTier === 'LIMITED') blockers.push('RELIABILITY_BELOW_MODERATE');
    if (depth < MIN_MARKET_DEPTH) blockers.push('MARKET_DEPTH_BELOW_2_BOOKS');
    if (edge < MIN_EDGE) blockers.push('EDGE_BELOW_3PP');
    if (evPercent < MIN_EV_PERCENT) blockers.push('EV_BELOW_3_PERCENT');
    if (evPercent <= 0) blockers.push('NON_POSITIVE_EV');
    if (!projection.pointInTimeValid || game.status !== 'UPCOMING' || Date.parse(game.startTime) <= Date.now()) blockers.push('POINT_IN_TIME_OR_PREGAME_INVALID');

    const sideIntegrityReasons: string[] = [];
    let integrityStatus: 'QUALIFIED' | 'REVIEW' | 'VERIFY' | 'PASS' = blockers.length ? 'PASS' : 'QUALIFIED';
    if (eventIntegrityReasons.includes('MODEL_MARKET_DISAGREEMENT_EXTREME')) integrityStatus = 'VERIFY';
    else if (eventIntegrityReasons.includes('MODEL_MARKET_DISAGREEMENT_HEIGHTENED')) integrityStatus = 'REVIEW';

    if (evPercent >= VERIFY_EV_PERCENT) {
      integrityStatus = 'VERIFY';
      sideIntegrityReasons.push('GUARDED_EV_EXTREME_VERIFY_REQUIRED');
    } else if (evPercent >= REVIEW_EV_PERCENT && integrityStatus !== 'VERIFY') {
      integrityStatus = 'REVIEW';
      sideIntegrityReasons.push('GUARDED_EV_HEIGHTENED_REVIEW');
    }

    // Side-specific threshold/EV reasons remain side-level. Symmetric disagreement reasons were
    // already recorded once above, but they still block both sides from becoming a recommendation.
    blockers.forEach((reason) => addReason(rejectionReasons, reason));
    sideIntegrityReasons.forEach((reason) => addReason(rejectionReasons, reason));
    if (blockers.length || sideIntegrityReasons.length || eventIntegrityReasons.length) continue;

    const selectedPlayer = side === 'AWAY' ? game.playerAName! : game.playerBName!;
    picks.push({
      rank: 0,
      eventId: game.eventId,
      eventTitle: `${game.playerAName} vs ${game.playerBName}`,
      sport: 'TENNIS',
      league: game.tournamentName || game.league || game.tour || 'Tennis',
      startTime: game.startTime,
      pickType: 'GAME_MARKET',
      displayPick: `${selectedPlayer} — Match Winner`,
      selectionLabel: `${selectedPlayer} — Match Winner`,
      gameMarketType: 'MONEYLINE',
      playerName: null,
      playerId: null,
      marketKey: 'moneyline',
      marketCategory: 'MATCH_WINNER',
      side,
      line: null,
      sportsbook: best.sportsbook,
      oddsAmerican: best.oddsAmerican,
      apexProbability: guarded,
      breakEvenProbability: breakEven,
      marketConsensusProbability: consensus,
      edgePercentagePoints: edge * 100,
      expectedValuePercent: evPercent,
      reliabilityTier: projection.reliabilityTier,
      marketDepth: depth,
      modelVersion: projection.modelVersion,
      modelValidationStatus: 'EARLY_EVIDENCE',
      calibrationStatus: null,
      quoteTimestamp: best.timestamp,
      quoteAgeSeconds: quoteAgeSeconds(best.timestamp),
      pointInTimeValid: projection.pointInTimeValid,
      v3ShadowProbability: null,
      v3ShadowSupportsProduction: null,
      rationale: [
        `Raw independent tennis win probability ${(rawProbability * 100).toFixed(1)}%.`,
        `Guarded decision probability ${(guarded * 100).toFixed(1)}% vs ${(breakEven * 100).toFixed(1)}% executable break-even.`,
        `Guarded edge +${(edge * 100).toFixed(1)} pp with +${evPercent.toFixed(1)}% expected value across ${depth} fresh books.`,
        `${projection.reliabilityTier} historical reliability: ${projection.playerAHistory.sampleCount} ${game.playerAName} matches / ${projection.playerBHistory.sampleCount} ${game.playerBName} matches.`,
        `Early-evidence risk shrinkage uses ${(weight * 100).toFixed(0)}% model weight; sportsbook consensus is a decision guardrail only and never an input to the raw probability.`,
        `Alignment audit PASS: model complement ${(alignmentAudit.modelProbabilitySum ?? 0).toFixed(3)}, market complement ${(alignmentAudit.marketConsensusSum ?? 0).toFixed(3)}, ${alignmentAudit.recognizedBookPairs} verified two-way book pairs.`,
        alignmentAudit.marketDispersionPP === null ? 'Cross-book no-vig dispersion unavailable with fewer than two verified book pairs.' : `Cross-book no-vig dispersion ${alignmentAudit.marketDispersionPP.toFixed(1)} pp.`,
        projection.targetSurface ? `Verified target surface: ${projection.targetSurface}.` : 'Surface was not verified for this match, so no surface adjustment was used.',
        'Tennis spreads, totals, doubles and player props remain fail-closed in v1.14.7.',
      ],
      source: 'GAME_MODEL_EVALUATION',
      rawModelProbability: rawProbability,
      guardedDecisionProbability: guarded,
      decisionReferenceProbability: reference,
      probabilityShrinkageWeight: weight,
      modelMarketDisagreementPP: disagreement,
      rawExpectedValuePercent: rawEvPercent,
      gameIntegrityStatus: integrityStatus,
      gameIntegrityReasons: [...eventIntegrityReasons, ...sideIntegrityReasons],
      gameEvTier: evPercent >= VERIFY_EV_PERCENT ? 'EXTREME' : evPercent >= REVIEW_EV_PERCENT ? 'HEIGHTENED' : 'NORMAL',
      crossMarketConsistent: true,
      modelEvidenceObservations: Math.min(projection.playerAHistory.sampleCount, projection.playerBHistory.sampleCount),
      v2ContributionPP: null,
      v2ContributionStatus: 'UNAVAILABLE',
      bookOffers: sorted
        .filter((o, i, arr) => arr.findIndex((x) => x.sportsbook === o.sportsbook) === i)
        .map((o) => ({ sportsbook: o.sportsbook, oddsAmerican: o.oddsAmerican, quoteTimestamp: o.timestamp })),
    });
  }

  if (!candidateCount) addReason(rejectionReasons, 'TENNIS_MATCH_WINNER_MARKET_UNAVAILABLE');
  return { picks, rejectionReasons, candidateCount, alignmentAudit };
}

export class TennisMatchWinnerModelService {
  async buildProjection(game: NormalizedApexGame): Promise<TennisMatchWinnerProjection> {
    const cacheKey = `${game.eventId}|${game.startTime}`;
    const cached = projectionCache.get(cacheKey);
    if (cached && Date.now() - cached.generatedAtMs < PROJECTION_CACHE_TTL_MS) return cached.projection;

    if (game.sport === 'TENNIS' && (game.tennisMatchFormat === 'DOUBLES' || game.tennisMatchFormat === 'OTHER' || String(game.playerAName || '').includes('/') || String(game.playerBName || '').includes('/'))) {
      const projection = buildTennisProjectionFromHistory(game, []);
      projection.status = 'UNSUPPORTED';
      projection.reason = 'TENNIS_MATCH_WINNER_SINGLES_ONLY';
      projection.notes.push('Doubles and unresolved competition formats remain fail-closed for the production match-winner model.');
      projectionCache.set(cacheKey, { generatedAtMs: Date.now(), projection });
      return projection;
    }

    if (game.sport !== 'TENNIS' || !game.tour) {
      const projection = buildTennisProjectionFromHistory(game, []);
      projectionCache.set(cacheKey, { generatedAtMs: Date.now(), projection });
      return projection;
    }

    let matches: TennisHistoryMatch[] = [];
    try {
      matches = await loadAdaptiveHistory(game);
    } catch (err: any) {
      const projection = buildTennisProjectionFromHistory(game, []);
      projection.status = 'INSUFFICIENT_DATA';
      projection.reason = `TENNIS_HISTORY_FETCH_FAILED:${String(err?.message || err)}`;
      projection.notes.push('Historical ESPN tennis fetch failed closed; no recommendation was generated.');
      projectionCache.set(cacheKey, { generatedAtMs: Date.now(), projection });
      return projection;
    }

    const projection = buildTennisProjectionFromHistory(game, matches);
    projectionCache.set(cacheKey, { generatedAtMs: Date.now(), projection });
    return projection;
  }

  evaluateMoneyline(
    game: NormalizedApexGame,
    markets: NormalizedApexEventMarkets,
    projection: TennisMatchWinnerProjection,
  ): TennisMoneylineEvaluation {
    return evaluateTennisMoneylineMarkets(game, markets, projection);
  }
}

export const tennisMatchWinnerModelService = new TennisMatchWinnerModelService();
