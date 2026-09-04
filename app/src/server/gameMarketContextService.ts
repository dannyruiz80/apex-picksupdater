import { NormalizedApexGame } from '../types.js';
import { TeamHistorySummary } from './gameTeamHistoryService.js';

export interface MlbStarterContextV2 {
  gamePk: number | null;
  homeProbablePitcher: string | null;
  awayProbablePitcher: string | null;
  homeProbablePitcherId: number | null;
  awayProbablePitcherId: number | null;
  homeStarterEra: number | null;
  awayStarterEra: number | null;
  homeStarterWhip: number | null;
  awayStarterWhip: number | null;
  temperatureF: number | null;
  windMph: number | null;
  weatherCondition: string | null;
  venueName: string | null;
  homeLineupCount: number | null;
  awayLineupCount: number | null;
  homeBullpenInningsLast3: number | null;
  awayBullpenInningsLast3: number | null;
}



export interface NflStrengthContextV2 {
  homeStrengthIndex: number | null;
  awayStrengthIndex: number | null;
  homeRecent5Margin: number | null;
  awayRecent5Margin: number | null;
  homeRestDays: number | null;
  awayRestDays: number | null;
  homeNetYardsPerPlay: number | null;
  awayNetYardsPerPlay: number | null;
  homeTurnoverMarginPerGame: number | null;
  awayTurnoverMarginPerGame: number | null;
}



export interface WnbaProductionContextV1 {
  homeRecent5Margin: number | null;
  awayRecent5Margin: number | null;
  homeRecent10Margin: number | null;
  awayRecent10Margin: number | null;
  homeRecent5Total: number | null;
  awayRecent5Total: number | null;
  homeRecent10Total: number | null;
  awayRecent10Total: number | null;
  homeRestDays: number | null;
  awayRestDays: number | null;
  homeBackToBack: boolean | null;
  awayBackToBack: boolean | null;
  homeVenueSampleCount: number;
  awayVenueSampleCount: number;
}

export interface GameMarketContextV2 {
  contextVersion: 'APEX_GAME_CONTEXT_V2';
  observedAt: string;
  status: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  homeRecent5Margin: number | null;
  awayRecent5Margin: number | null;
  homeRecent5Total: number | null;
  awayRecent5Total: number | null;
  homeRestDays: number | null;
  awayRestDays: number | null;
  mlb: MlbStarterContextV2 | null;
  nfl: NflStrengthContextV2 | null;
  wnba: WnbaProductionContextV1 | null;
  notes: string[];
}

const MLB_API = 'https://statsapi.mlb.com/api/v1';
const CACHE_TTL_MS = 20 * 60 * 1000;
const rawCache = new Map<string, { value: any; fetchedAt: number }>();

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function norm(value: string | null | undefined): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function recentMean(summary: TeamHistorySummary, key: 'margin' | 'total', n = 5): number | null {
  return mean(summary.records.slice(0, n).map((r) => r[key]).filter(Number.isFinite));
}

function restDays(summary: TeamHistorySummary, eventStart: string): number | null {
  if (!summary.latestCompletedGameAt) return null;
  const eventMs = Date.parse(eventStart);
  const priorMs = Date.parse(summary.latestCompletedGameAt);
  if (!Number.isFinite(eventMs) || !Number.isFinite(priorMs) || eventMs <= priorMs) return null;
  return Math.max(0, Math.floor((eventMs - priorMs) / 86400000));
}

async function fetchJson(url: string, ttl = CACHE_TTL_MS): Promise<any | null> {
  const cached = rawCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < ttl) return cached.value;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ApexPicks-GameContextV2/1.0', Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const value = await res.json();
    rawCache.set(url, { value, fetchedAt: Date.now() });
    return value;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function previousDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso.slice(0, 10);
  return new Date(ms - 86400000).toISOString().slice(0, 10);
}

function seasonStart(iso: string): string {
  const y = new Date(iso).getUTCFullYear();
  return `${y}-01-01`;
}

async function pitcherRateStats(playerId: number | null, eventStart: string): Promise<{ era: number | null; whip: number | null }> {
  if (!playerId) return { era: null, whip: null };
  const endDate = previousDate(eventStart);
  const raw = await fetchJson(`${MLB_API}/people/${playerId}/stats?stats=byDateRange&group=pitching&startDate=${seasonStart(eventStart)}&endDate=${endDate}`);
  const stat = raw?.stats?.[0]?.splits?.[0]?.stat ?? null;
  return { era: finite(stat?.era), whip: finite(stat?.whip) };
}

function parseWind(wind: unknown): number | null {
  const match = String(wind || '').match(/(\d+(?:\.\d+)?)\s*mph/i);
  return match ? Number(match[1]) : null;
}


function inningsNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const [wholeText, fracText = '0'] = String(raw).split('.');
  const whole = Number(wholeText), frac = Number(fracText);
  if (!Number.isFinite(whole) || !Number.isFinite(frac) || frac < 0 || frac > 2) return null;
  return whole + frac / 3;
}

function dateOffset(iso: string, days: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso.slice(0, 10);
  return new Date(ms + days * 86400000).toISOString().slice(0, 10);
}

async function recentBullpenInnings(teamId: number | null, eventStart: string): Promise<number | null> {
  if (!teamId) return null;
  const endDate = previousDate(eventStart);
  const startDate = dateOffset(eventStart, -6);
  const raw = await fetchJson(`${MLB_API}/schedule?sportId=1&teamId=${teamId}&startDate=${startDate}&endDate=${endDate}`, 5 * 60 * 1000);
  const games = (raw?.dates?.flatMap((d: any) => d.games ?? []) ?? [])
    .filter((g: any) => String(g?.status?.abstractGameState || '').toUpperCase() === 'FINAL')
    .sort((a: any, b: any) => Date.parse(b.gameDate || '') - Date.parse(a.gameDate || ''))
    .slice(0, 3);
  if (!games.length) return null;
  let total = 0;
  let usable = 0;
  for (const g of games) {
    const box = await fetchJson(`${MLB_API}/game/${g.gamePk}/boxscore`, 30 * 60 * 1000);
    const blocks = [box?.teams?.home, box?.teams?.away].filter(Boolean);
    const block = blocks.find((b: any) => Number(b?.team?.id) === teamId) ?? null;
    const pitcherIds: number[] = Array.isArray(block?.pitchers) ? block.pitchers.map(Number).filter(Number.isFinite) : [];
    if (pitcherIds.length < 2) continue;
    let gameBullpen = 0;
    for (const id of pitcherIds.slice(1)) {
      const stat = block?.players?.[`ID${id}`]?.stats?.pitching;
      const ip = inningsNumber(stat?.inningsPitched);
      if (ip !== null) gameBullpen += ip;
    }
    total += gameBullpen;
    usable++;
  }
  return usable ? Number(total.toFixed(3)) : null;
}

function statValue(stats: any[], names: string[]): number | null {
  const targets = names.map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const st of stats || []) {
    const key = String(st?.name ?? st?.label ?? st?.abbreviation ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!targets.includes(key)) continue;
    const n = Number(String(st?.value ?? st?.displayValue ?? '').replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function nflEfficiency(summary: TeamHistorySummary): Promise<{ netYpp: number | null; turnoverMargin: number | null }> {
  const rows = summary.records.slice(0, 5);
  const netYpp: number[] = [];
  const turnoverMargins: number[] = [];
  for (const row of rows) {
    const raw = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(row.eventId)}`, 30 * 60 * 1000);
    const teams = Array.isArray(raw?.boxscore?.teams) ? raw.boxscore.teams : [];
    const mine = teams.find((t: any) => String(t?.team?.id ?? '') === String(summary.teamId));
    const opp = teams.find((t: any) => t !== mine);
    if (!mine || !opp) continue;
    const myYpp = statValue(mine.statistics, ['yardsPerPlay', 'yards/play', 'yardsperplay']);
    const oppYpp = statValue(opp.statistics, ['yardsPerPlay', 'yards/play', 'yardsperplay']);
    if (myYpp !== null && oppYpp !== null) netYpp.push(myYpp - oppYpp);
    const myTo = statValue(mine.statistics, ['turnovers', 'totalTurnovers']);
    const oppTo = statValue(opp.statistics, ['turnovers', 'totalTurnovers']);
    if (myTo !== null && oppTo !== null) turnoverMargins.push(oppTo - myTo);
  }
  return { netYpp: mean(netYpp), turnoverMargin: mean(turnoverMargins) };
}

async function getMlbContext(game: NormalizedApexGame): Promise<MlbStarterContextV2> {
  const date = game.startTime.slice(0, 10);
  const schedule = await fetchJson(`${MLB_API}/schedule?sportId=1&date=${encodeURIComponent(date)}&hydrate=probablePitcher,venue`, 5 * 60 * 1000);
  const games = schedule?.dates?.flatMap((d: any) => d.games ?? []) ?? [];
  const match = games.find((g: any) =>
    namesMatch(g?.teams?.home?.team?.name, game.homeTeam) && namesMatch(g?.teams?.away?.team?.name, game.awayTeam)
  ) ?? null;
  const homePitcher = match?.teams?.home?.probablePitcher ?? null;
  const awayPitcher = match?.teams?.away?.probablePitcher ?? null;
  const homeId = finite(homePitcher?.id);
  const awayId = finite(awayPitcher?.id);
  const homeTeamId = finite(match?.teams?.home?.team?.id);
  const awayTeamId = finite(match?.teams?.away?.team?.id);
  const [homeStats, awayStats, homeBullpenInningsLast3, awayBullpenInningsLast3] = await Promise.all([
    pitcherRateStats(homeId, game.startTime),
    pitcherRateStats(awayId, game.startTime),
    recentBullpenInnings(homeTeamId, game.startTime),
    recentBullpenInnings(awayTeamId, game.startTime),
  ]);

  let temperatureF: number | null = null;
  let windMph: number | null = null;
  let weatherCondition: string | null = null;
  let venueName: string | null = match?.venue?.name ? String(match.venue.name) : game.venue;
  let homeLineupCount: number | null = null;
  let awayLineupCount: number | null = null;

  // Weather is captured only for a genuinely future/pregame event. It is never reconstructed after the fact.
  if (match?.gamePk && Date.now() < Date.parse(game.startTime)) {
    const feed = await fetchJson(`${MLB_API}/game/${match.gamePk}/feed/live`, 2 * 60 * 1000);
    temperatureF = finite(feed?.gameData?.weather?.temp);
    windMph = parseWind(feed?.gameData?.weather?.wind);
    weatherCondition = feed?.gameData?.weather?.condition ? String(feed.gameData.weather.condition) : null;
    venueName = feed?.gameData?.venue?.name ? String(feed.gameData.venue.name) : venueName;
    const homeOrder = feed?.liveData?.boxscore?.teams?.home?.battingOrder;
    const awayOrder = feed?.liveData?.boxscore?.teams?.away?.battingOrder;
    homeLineupCount = Array.isArray(homeOrder) ? homeOrder.length : null;
    awayLineupCount = Array.isArray(awayOrder) ? awayOrder.length : null;
  }

  return {
    gamePk: finite(match?.gamePk),
    homeProbablePitcher: homePitcher?.fullName ? String(homePitcher.fullName) : null,
    awayProbablePitcher: awayPitcher?.fullName ? String(awayPitcher.fullName) : null,
    homeProbablePitcherId: homeId,
    awayProbablePitcherId: awayId,
    homeStarterEra: homeStats.era,
    awayStarterEra: awayStats.era,
    homeStarterWhip: homeStats.whip,
    awayStarterWhip: awayStats.whip,
    temperatureF,
    windMph,
    weatherCondition,
    venueName,
    homeLineupCount,
    awayLineupCount,
    homeBullpenInningsLast3,
    awayBullpenInningsLast3,
  };
}

async function buildNflContext(home: TeamHistorySummary, away: TeamHistorySummary, eventStart: string): Promise<NflStrengthContextV2> {
  const homeRecent5Margin = recentMean(home, 'margin');
  const awayRecent5Margin = recentMean(away, 'margin');
  const homeTrend = homeRecent5Margin !== null && home.weightedMargin !== null ? homeRecent5Margin - home.weightedMargin : 0;
  const awayTrend = awayRecent5Margin !== null && away.weightedMargin !== null ? awayRecent5Margin - away.weightedMargin : 0;
  const [homeEff, awayEff] = await Promise.all([nflEfficiency(home), nflEfficiency(away)]);
  return {
    homeStrengthIndex: home.weightedMargin === null ? null : home.weightedMargin + 0.25 * homeTrend,
    awayStrengthIndex: away.weightedMargin === null ? null : away.weightedMargin + 0.25 * awayTrend,
    homeRecent5Margin,
    awayRecent5Margin,
    homeRestDays: restDays(home, eventStart),
    awayRestDays: restDays(away, eventStart),
    homeNetYardsPerPlay: homeEff.netYpp,
    awayNetYardsPerPlay: awayEff.netYpp,
    homeTurnoverMarginPerGame: homeEff.turnoverMargin,
    awayTurnoverMarginPerGame: awayEff.turnoverMargin,
  };
}


function buildWnbaContext(home: TeamHistorySummary, away: TeamHistorySummary, eventStart: string): WnbaProductionContextV1 {
  const hr = restDays(home, eventStart);
  const ar = restDays(away, eventStart);
  return {
    homeRecent5Margin: recentMean(home, 'margin', 5),
    awayRecent5Margin: recentMean(away, 'margin', 5),
    homeRecent10Margin: recentMean(home, 'margin', 10),
    awayRecent10Margin: recentMean(away, 'margin', 10),
    homeRecent5Total: recentMean(home, 'total', 5),
    awayRecent5Total: recentMean(away, 'total', 5),
    homeRecent10Total: recentMean(home, 'total', 10),
    awayRecent10Total: recentMean(away, 'total', 10),
    homeRestDays: hr,
    awayRestDays: ar,
    homeBackToBack: hr === null ? null : hr <= 1,
    awayBackToBack: ar === null ? null : ar <= 1,
    homeVenueSampleCount: home.venueSampleCount,
    awayVenueSampleCount: away.venueSampleCount,
  };
}

export class GameMarketContextService {
  async build(game: NormalizedApexGame, home: TeamHistorySummary, away: TeamHistorySummary): Promise<GameMarketContextV2> {
    const notes: string[] = [];
    const generic = {
      homeRecent5Margin: recentMean(home, 'margin'),
      awayRecent5Margin: recentMean(away, 'margin'),
      homeRecent5Total: recentMean(home, 'total'),
      awayRecent5Total: recentMean(away, 'total'),
      homeRestDays: restDays(home, game.startTime),
      awayRestDays: restDays(away, game.startTime),
    };

    let mlb: MlbStarterContextV2 | null = null;
    let nfl: NflStrengthContextV2 | null = null;
    let wnba: WnbaProductionContextV1 | null = null;
    if (game.sport === 'MLB') {
      mlb = await getMlbContext(game);
      if (!mlb.homeProbablePitcher || !mlb.awayProbablePitcher) notes.push('Probable starter identity is incomplete; starter adjustment remains partial.');
      if (mlb.temperatureF === null) notes.push('Pregame weather is unavailable or not yet posted; no weather adjustment is applied.');
      if ((mlb.homeLineupCount ?? 0) >= 9 && (mlb.awayLineupCount ?? 0) >= 9) notes.push('Both MLB batting orders are posted and captured as pregame context.');
      else notes.push('One or both MLB batting orders are not yet fully posted; no lineup-quality adjustment is inferred.');
      notes.push('Park identity and weather are captured for audit, but park-factor/umpire effects remain disabled until validated.');
      if (mlb.homeBullpenInningsLast3 !== null && mlb.awayBullpenInningsLast3 !== null) notes.push(`Verified recent bullpen workload captured: home ${mlb.homeBullpenInningsLast3.toFixed(1)} IP / away ${mlb.awayBullpenInningsLast3.toFixed(1)} IP across up to three completed games.`);
      else notes.push('Bullpen workload could not be verified for both teams; no bullpen adjustment is applied where missing.');
    } else if (game.sport === 'NFL') {
      nfl = await buildNflContext(home, away, game.startTime);
      notes.push('NFL V2 shadow uses recent scoring-margin form, rest, net yards/play and turnover-margin context from completed prior games.');
      notes.push('True EPA remains disabled until a separately validated expected-points model is available; Apex will not relabel yards/play as EPA.');
    } else if (game.sport === 'WNBA') {
      wnba = buildWnbaContext(home, away, game.startTime);
      notes.push('WNBA production context uses point-in-time completed games only: recent 5/10 form, venue samples and verified rest state.');
      notes.push('WNBA rest/back-to-back state is audit context in v1.14.8 and does not independently manufacture an edge.');
    }

    const specializedAvailable = game.sport === 'MLB'
      ? Boolean(mlb?.homeProbablePitcher || mlb?.awayProbablePitcher)
      : game.sport === 'NFL'
        ? Boolean(nfl?.homeStrengthIndex !== null && nfl?.awayStrengthIndex !== null)
        : game.sport === 'WNBA'
          ? Boolean(wnba && home.sampleCount >= 6 && away.sampleCount >= 6)
          : false;

    return {
      contextVersion: 'APEX_GAME_CONTEXT_V2',
      observedAt: new Date().toISOString(),
      status: specializedAvailable ? 'AVAILABLE' : (home.records.length && away.records.length ? 'PARTIAL' : 'UNAVAILABLE'),
      ...generic,
      mlb,
      nfl,
      wnba,
      notes,
    };
  }
}

export const gameMarketContextService = new GameMarketContextService();
