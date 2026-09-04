import { NormalizedApexGame } from '../types.js';
import { TeamHistorySummary, resolveSoccerLeagueCode } from './gameTeamHistoryService.js';

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
  homeStarterK9: number | null;
  awayStarterK9: number | null;
  homeStarterBb9: number | null;
  awayStarterBb9: number | null;
  homeStarterHr9: number | null;
  awayStarterHr9: number | null;
  temperatureF: number | null;
  windMph: number | null;
  weatherCondition: string | null;
  venueName: string | null;
  homeLineupCount: number | null;
  awayLineupCount: number | null;
  homeBullpenInningsLast3: number | null;
  awayBullpenInningsLast3: number | null;
  starterTotalRunSignal: number | null;
  bullpenTotalRunSignal: number | null;
  weatherTotalRunSignal: number | null;
  empiricalVenueRunFactor: number | null;
}


export interface SoccerChanceContextV1 {
  leagueCode: string | null;
  homeRecent5XgFor: number | null;
  homeRecent5XgAgainst: number | null;
  awayRecent5XgFor: number | null;
  awayRecent5XgAgainst: number | null;
  homeRecent5ShotsOnTargetFor: number | null;
  homeRecent5ShotsOnTargetAgainst: number | null;
  awayRecent5ShotsOnTargetFor: number | null;
  awayRecent5ShotsOnTargetAgainst: number | null;
  homeRecent5ShotsFor: number | null;
  homeRecent5ShotsAgainst: number | null;
  awayRecent5ShotsFor: number | null;
  awayRecent5ShotsAgainst: number | null;
  homeRecent5PossessionPct: number | null;
  awayRecent5PossessionPct: number | null;
  homeKeeperXgSuppression: number | null;
  awayKeeperXgSuppression: number | null;
  chanceSampleCountHome: number;
  chanceSampleCountAway: number;
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
  homeRecent5Total: number | null;
  awayRecent5Total: number | null;
  homeOffensivePlaysPerGame: number | null;
  awayOffensivePlaysPerGame: number | null;
  homeRedZoneTdRate: number | null;
  awayRedZoneTdRate: number | null;
  temperatureF: number | null;
  windMph: number | null;
  weatherCondition: string | null;
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
  homeEstimatedPossessions: number | null;
  awayEstimatedPossessions: number | null;
  homeOffensiveRating: number | null;
  awayOffensiveRating: number | null;
  homeDefensiveRating: number | null;
  awayDefensiveRating: number | null;
  homeFastBreakPoints: number | null;
  awayFastBreakPoints: number | null;
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
  ncaaf: NflStrengthContextV2 | null;
  wnba: WnbaProductionContextV1 | null;
  soccer: SoccerChanceContextV1 | null;
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

async function pitcherRateStats(playerId: number | null, eventStart: string): Promise<{ era: number | null; whip: number | null; k9: number | null; bb9: number | null; hr9: number | null }> {
  if (!playerId) return { era: null, whip: null, k9: null, bb9: null, hr9: null };
  const endDate = previousDate(eventStart);
  const raw = await fetchJson(`${MLB_API}/people/${playerId}/stats?stats=byDateRange&group=pitching&startDate=${seasonStart(eventStart)}&endDate=${endDate}`);
  const stat = raw?.stats?.[0]?.splits?.[0]?.stat ?? null;
  return {
    era: finite(stat?.era), whip: finite(stat?.whip),
    k9: finite(stat?.strikeoutsPer9Inn ?? stat?.strikeoutsPer9),
    bb9: finite(stat?.walksPer9Inn ?? stat?.walksPer9),
    hr9: finite(stat?.homeRunsPer9 ?? stat?.homeRunsPer9Inn),
  };
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

async function footballEfficiency(summary: TeamHistorySummary, sport: 'NFL' | 'NCAAF'): Promise<{
  netYpp: number | null; turnoverMargin: number | null; offensivePlays: number | null; redZoneTdRate: number | null;
}> {
  const rows = summary.records.slice(0, 5);
  const netYpp: number[] = [], turnoverMargins: number[] = [], offensivePlays: number[] = [], redZoneRates: number[] = [];
  const leaguePath = sport === 'NFL' ? 'nfl' : 'college-football';
  for (const row of rows) {
    const raw = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/${leaguePath}/summary?event=${encodeURIComponent(row.eventId)}`, 30 * 60 * 1000);
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
    const plays = statValue(mine.statistics, ['totalPlays', 'offensivePlays', 'plays']);
    if (plays !== null && plays > 0) offensivePlays.push(plays);
    for (const st of mine.statistics || []) {
      const key = String(st?.name ?? st?.label ?? st?.abbreviation ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!['redzoneattempts','redzoneefficiency','redzone'].includes(key)) continue;
      const text = String(st?.displayValue ?? st?.value ?? '');
      const m = text.match(/(\d+(?:\.\d+)?)\s*[-/]\s*(\d+(?:\.\d+)?)/);
      if (m && Number(m[2]) > 0) redZoneRates.push(Number(m[1]) / Number(m[2]));
      else {
        const n = Number(text.replace('%',''));
        if (Number.isFinite(n)) redZoneRates.push(n > 1 ? n / 100 : n);
      }
      break;
    }
  }
  return { netYpp: mean(netYpp), turnoverMargin: mean(turnoverMargins), offensivePlays: mean(offensivePlays), redZoneTdRate: mean(redZoneRates) };
}

async function footballPregameWeather(game: NormalizedApexGame, sport: 'NFL' | 'NCAAF'): Promise<{ temperatureF: number | null; windMph: number | null; weatherCondition: string | null }> {
  if (!game.eventId || Date.now() >= Date.parse(game.startTime)) return { temperatureF: null, windMph: null, weatherCondition: null };
  const leaguePath = sport === 'NFL' ? 'nfl' : 'college-football';
  const raw = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/${leaguePath}/summary?event=${encodeURIComponent(game.eventId)}`, 5 * 60 * 1000);
  const comp = raw?.header?.competitions?.[0] ?? raw?.gameInfo ?? {};
  const weather = comp?.weather ?? raw?.gameInfo?.weather ?? {};
  const temperatureF = finite(weather?.temperature ?? weather?.temperatureF ?? weather?.temp);
  const windMph = finite(weather?.windSpeed ?? weather?.windMph) ?? parseWind(weather?.displayValue ?? weather?.wind);
  const weatherCondition = weather?.displayValue ? String(weather.displayValue) : weather?.condition ? String(weather.condition) : null;
  return { temperatureF, windMph, weatherCondition };
}


function soccerStat(stats: any[], names: string[]): number | null {
  const targets = names.map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const st of stats || []) {
    const key = String(st?.name ?? st?.label ?? st?.abbreviation ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!targets.includes(key)) continue;
    const n = Number(String(st?.value ?? st?.displayValue ?? '').replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function recentSoccerChanceForTeam(summary: TeamHistorySummary, leagueCode: string): Promise<{
  xgFor: number | null; xgAgainst: number | null; sotFor: number | null; sotAgainst: number | null;
  shotsFor: number | null; shotsAgainst: number | null; possessionPct: number | null; keeperXgSuppression: number | null; sampleCount: number;
}> {
  const xgFor: number[] = [], xgAgainst: number[] = [], sotFor: number[] = [], sotAgainst: number[] = [];
  const shotsFor: number[] = [], shotsAgainst: number[] = [], possession: number[] = [], keeperSuppression: number[] = [];
  let sampleCount = 0;
  for (const row of summary.records.slice(0, 5)) {
    const raw = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/summary?event=${encodeURIComponent(row.eventId)}`, 30 * 60 * 1000);
    const teams = Array.isArray(raw?.boxscore?.teams) ? raw.boxscore.teams : [];
    const mine = teams.find((t: any) => String(t?.team?.id ?? '') === String(summary.teamId));
    const opp = teams.find((t: any) => t !== mine);
    if (!mine || !opp) continue;
    sampleCount++;
    const myXg = soccerStat(mine.statistics, ['expectedGoals', 'expectedgoals', 'xg']);
    const oppXg = soccerStat(opp.statistics, ['expectedGoals', 'expectedgoals', 'xg']);
    const mySot = soccerStat(mine.statistics, ['shotsOnGoal', 'shotsOnTarget', 'shotsongoal', 'shotsontarget']);
    const oppSot = soccerStat(opp.statistics, ['shotsOnGoal', 'shotsOnTarget', 'shotsongoal', 'shotsontarget']);
    const myShots = soccerStat(mine.statistics, ['totalShots', 'shots', 'shotAttempts']);
    const oppShots = soccerStat(opp.statistics, ['totalShots', 'shots', 'shotAttempts']);
    const poss = soccerStat(mine.statistics, ['possessionPct', 'possessionPercentage', 'possession']);
    if (myXg !== null) xgFor.push(myXg);
    if (oppXg !== null) { xgAgainst.push(oppXg); keeperSuppression.push(oppXg - row.pointsAgainst); }
    if (mySot !== null) sotFor.push(mySot);
    if (oppSot !== null) sotAgainst.push(oppSot);
    if (myShots !== null) shotsFor.push(myShots);
    if (oppShots !== null) shotsAgainst.push(oppShots);
    if (poss !== null) possession.push(poss > 1 ? poss / 100 : poss);
  }
  return {
    xgFor: mean(xgFor), xgAgainst: mean(xgAgainst), sotFor: mean(sotFor), sotAgainst: mean(sotAgainst),
    shotsFor: mean(shotsFor), shotsAgainst: mean(shotsAgainst), possessionPct: mean(possession),
    keeperXgSuppression: mean(keeperSuppression), sampleCount,
  };
}


async function getSoccerContext(game: NormalizedApexGame, home: TeamHistorySummary, away: TeamHistorySummary): Promise<SoccerChanceContextV1 | null> {
  const leagueCode = resolveSoccerLeagueCode(game);
  if (!leagueCode) return null;
  const [h, a] = await Promise.all([
    recentSoccerChanceForTeam(home, leagueCode),
    recentSoccerChanceForTeam(away, leagueCode),
  ]);
  return {
    leagueCode,
    homeRecent5XgFor: h.xgFor,
    homeRecent5XgAgainst: h.xgAgainst,
    awayRecent5XgFor: a.xgFor,
    awayRecent5XgAgainst: a.xgAgainst,
    homeRecent5ShotsOnTargetFor: h.sotFor,
    homeRecent5ShotsOnTargetAgainst: h.sotAgainst,
    awayRecent5ShotsOnTargetFor: a.sotFor,
    awayRecent5ShotsOnTargetAgainst: a.sotAgainst,
    homeRecent5ShotsFor: h.shotsFor,
    homeRecent5ShotsAgainst: h.shotsAgainst,
    awayRecent5ShotsFor: a.shotsFor,
    awayRecent5ShotsAgainst: a.shotsAgainst,
    homeRecent5PossessionPct: h.possessionPct,
    awayRecent5PossessionPct: a.possessionPct,
    homeKeeperXgSuppression: h.keeperXgSuppression,
    awayKeeperXgSuppression: a.keeperXgSuppression,
    chanceSampleCountHome: h.sampleCount,
    chanceSampleCountAway: a.sampleCount,
  };
}

async function getMlbContext(game: NormalizedApexGame, homeHistory: TeamHistorySummary): Promise<MlbStarterContextV2> {
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
    homeStarterK9: homeStats.k9,
    awayStarterK9: awayStats.k9,
    homeStarterBb9: homeStats.bb9,
    awayStarterBb9: awayStats.bb9,
    homeStarterHr9: homeStats.hr9,
    awayStarterHr9: awayStats.hr9,
    temperatureF,
    windMph,
    weatherCondition,
    venueName,
    homeLineupCount,
    awayLineupCount,
    homeBullpenInningsLast3,
    awayBullpenInningsLast3,
    starterTotalRunSignal: (() => {
      const eras = [homeStats.era, awayStats.era].filter((v): v is number => v !== null && Number.isFinite(v));
      const whips = [homeStats.whip, awayStats.whip].filter((v): v is number => v !== null && Number.isFinite(v));
      if (!eras.length && !whips.length) return null;
      const eraPart = eras.length ? Math.max(-0.75, Math.min(0.75, ((mean(eras) ?? 4.25) - 4.25) * 0.30)) : 0;
      const whipPart = whips.length ? Math.max(-0.45, Math.min(0.45, ((mean(whips) ?? 1.28) - 1.28) * 1.00)) : 0;
      return Number((eraPart + whipPart).toFixed(3));
    })(),
    bullpenTotalRunSignal: (() => {
      const vals = [homeBullpenInningsLast3, awayBullpenInningsLast3].filter((v): v is number => v !== null && Number.isFinite(v));
      if (!vals.length) return null;
      return Number(Math.max(-0.25, Math.min(0.45, ((mean(vals) ?? 9) - 9) * 0.05)).toFixed(3));
    })(),
    weatherTotalRunSignal: temperatureF === null ? null : Number(Math.max(-0.40, Math.min(0.40, (temperatureF - 70) * 0.02)).toFixed(3)),
    empiricalVenueRunFactor: (() => {
      const venueTotal = homeHistory.venuePointsFor !== null && homeHistory.venuePointsAgainst !== null
        ? homeHistory.venuePointsFor + homeHistory.venuePointsAgainst : null;
      const overall = homeHistory.weightedTotal;
      if (venueTotal === null || overall === null || overall <= 0 || homeHistory.venueSampleCount < 4) return null;
      return Number(Math.max(0.85, Math.min(1.15, venueTotal / overall)).toFixed(3));
    })(),
  };
}

async function buildFootballContext(game: NormalizedApexGame, home: TeamHistorySummary, away: TeamHistorySummary, sport: 'NFL' | 'NCAAF'): Promise<NflStrengthContextV2> {
  const homeRecent5Margin = recentMean(home, 'margin');
  const awayRecent5Margin = recentMean(away, 'margin');
  const homeTrend = homeRecent5Margin !== null && home.weightedMargin !== null ? homeRecent5Margin - home.weightedMargin : 0;
  const awayTrend = awayRecent5Margin !== null && away.weightedMargin !== null ? awayRecent5Margin - away.weightedMargin : 0;
  const [homeEff, awayEff, weather] = await Promise.all([footballEfficiency(home, sport), footballEfficiency(away, sport), footballPregameWeather(game, sport)]);
  return {
    homeStrengthIndex: home.weightedMargin === null ? null : home.weightedMargin + 0.25 * homeTrend,
    awayStrengthIndex: away.weightedMargin === null ? null : away.weightedMargin + 0.25 * awayTrend,
    homeRecent5Margin, awayRecent5Margin,
    homeRestDays: restDays(home, game.startTime), awayRestDays: restDays(away, game.startTime),
    homeNetYardsPerPlay: homeEff.netYpp, awayNetYardsPerPlay: awayEff.netYpp,
    homeTurnoverMarginPerGame: homeEff.turnoverMargin, awayTurnoverMarginPerGame: awayEff.turnoverMargin,
    homeRecent5Total: recentMean(home, 'total', 5), awayRecent5Total: recentMean(away, 'total', 5),
    homeOffensivePlaysPerGame: homeEff.offensivePlays, awayOffensivePlaysPerGame: awayEff.offensivePlays,
    homeRedZoneTdRate: homeEff.redZoneTdRate, awayRedZoneTdRate: awayEff.redZoneTdRate,
    temperatureF: weather.temperatureF, windMph: weather.windMph, weatherCondition: weather.weatherCondition,
  };
}

async function basketballEfficiency(summary: TeamHistorySummary): Promise<{ possessions: number | null; offensiveRating: number | null; defensiveRating: number | null; fastBreakPoints: number | null }> {
  const poss: number[] = [], ortg: number[] = [], drtg: number[] = [], fast: number[] = [];
  for (const row of summary.records.slice(0, 5)) {
    const raw = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${encodeURIComponent(row.eventId)}`, 30 * 60 * 1000);
    const teams = Array.isArray(raw?.boxscore?.teams) ? raw.boxscore.teams : [];
    const mine = teams.find((t: any) => String(t?.team?.id ?? '') === String(summary.teamId));
    const opp = teams.find((t: any) => t !== mine);
    if (!mine || !opp) continue;
    const fga = statValue(mine.statistics, ['fieldGoalAttempts','fieldGoalsAttempted','fga']);
    const orb = statValue(mine.statistics, ['offensiveRebounds','offRebounds','oreb']);
    const tov = statValue(mine.statistics, ['turnovers','totalTurnovers']);
    const fta = statValue(mine.statistics, ['freeThrowAttempts','freeThrowsAttempted','fta']);
    const ofga = statValue(opp.statistics, ['fieldGoalAttempts','fieldGoalsAttempted','fga']);
    const oorb = statValue(opp.statistics, ['offensiveRebounds','offRebounds','oreb']);
    const otov = statValue(opp.statistics, ['turnovers','totalTurnovers']);
    const ofta = statValue(opp.statistics, ['freeThrowAttempts','freeThrowsAttempted','fta']);
    if ([fga,orb,tov,fta,ofga,oorb,otov,ofta].every(v=>v!==null)) {
      const myPoss = fga! - orb! + tov! + 0.44 * fta!;
      const oppPoss = ofga! - oorb! + otov! + 0.44 * ofta!;
      const p = (myPoss + oppPoss) / 2;
      if (p > 0) { poss.push(p); ortg.push(row.pointsFor / p * 100); drtg.push(row.pointsAgainst / p * 100); }
    }
    const fb = statValue(mine.statistics, ['fastBreakPoints','fastbreakpoints','pointsFastBreak']);
    if (fb !== null) fast.push(fb);
  }
  return { possessions: mean(poss), offensiveRating: mean(ortg), defensiveRating: mean(drtg), fastBreakPoints: mean(fast) };
}


async function buildWnbaContext(home: TeamHistorySummary, away: TeamHistorySummary, eventStart: string): Promise<WnbaProductionContextV1> {
  const hr = restDays(home, eventStart), ar = restDays(away, eventStart);
  const [homeAdv, awayAdv] = await Promise.all([basketballEfficiency(home), basketballEfficiency(away)]);
  return {
    homeRecent5Margin: recentMean(home, 'margin', 5), awayRecent5Margin: recentMean(away, 'margin', 5),
    homeRecent10Margin: recentMean(home, 'margin', 10), awayRecent10Margin: recentMean(away, 'margin', 10),
    homeRecent5Total: recentMean(home, 'total', 5), awayRecent5Total: recentMean(away, 'total', 5),
    homeRecent10Total: recentMean(home, 'total', 10), awayRecent10Total: recentMean(away, 'total', 10),
    homeRestDays: hr, awayRestDays: ar, homeBackToBack: hr === null ? null : hr <= 1, awayBackToBack: ar === null ? null : ar <= 1,
    homeVenueSampleCount: home.venueSampleCount, awayVenueSampleCount: away.venueSampleCount,
    homeEstimatedPossessions: homeAdv.possessions, awayEstimatedPossessions: awayAdv.possessions,
    homeOffensiveRating: homeAdv.offensiveRating, awayOffensiveRating: awayAdv.offensiveRating,
    homeDefensiveRating: homeAdv.defensiveRating, awayDefensiveRating: awayAdv.defensiveRating,
    homeFastBreakPoints: homeAdv.fastBreakPoints, awayFastBreakPoints: awayAdv.fastBreakPoints,
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
    let ncaaf: NflStrengthContextV2 | null = null;
    let wnba: WnbaProductionContextV1 | null = null;
    let soccer: SoccerChanceContextV1 | null = null;
    if (game.sport === 'MLB') {
      mlb = await getMlbContext(game, home);
      if (!mlb.homeProbablePitcher || !mlb.awayProbablePitcher) notes.push('Probable starter identity is incomplete; starter adjustment remains partial.');
      if (mlb.temperatureF === null) notes.push('Pregame weather is unavailable or not yet posted; no weather adjustment is applied.');
      if ((mlb.homeLineupCount ?? 0) >= 9 && (mlb.awayLineupCount ?? 0) >= 9) notes.push('Both MLB batting orders are posted and captured as pregame context.');
      else notes.push('One or both MLB batting orders are not yet fully posted; no lineup-quality adjustment is inferred.');
      notes.push('Park identity, empirical point-in-time home-venue scoring, weather, starter quality and bullpen workload are frozen pregame for the totals context challenger. Context remains shadow-only until its postgame walk-forward MAE proves an out-of-sample gain.');
      if (mlb.homeBullpenInningsLast3 !== null && mlb.awayBullpenInningsLast3 !== null) notes.push(`Verified recent bullpen workload captured: home ${mlb.homeBullpenInningsLast3.toFixed(1)} IP / away ${mlb.awayBullpenInningsLast3.toFixed(1)} IP across up to three completed games.`);
      else notes.push('Bullpen workload could not be verified for both teams; no bullpen adjustment is applied where missing.');
    } else if (game.sport === 'NFL') {
      nfl = await buildFootballContext(game, home, away, 'NFL');
      notes.push('NFL context freezes recent totals, plays, red-zone efficiency, yards/play, turnover margin, rest and verified pregame weather when available.');
      notes.push('True EPA and pressure rate remain disabled until independently validated sources exist; Apex will not relabel proxy metrics as EPA/pressure.');
    } else if (game.sport === 'NCAAF') {
      ncaaf = await buildFootballContext(game, home, away, 'NCAAF');
      notes.push('NCAAF context freezes recent totals, plays, red-zone efficiency, yards/play, turnover margin, rest and verified pregame weather when available.');
      notes.push('College context remains shadow-only and uses wider bounds because roster/coaching variance is materially higher.');
    } else if (game.sport === 'WNBA') {
      wnba = await buildWnbaContext(home, away, game.startTime);
      notes.push('WNBA production context uses point-in-time completed games only: recent 5/10 form, venue samples and verified rest state.');
      notes.push('WNBA pace/possessions, offensive/defensive efficiency, fast-break scoring when available, rest and recent totals are frozen as shadow-only totals context.');
      notes.push('No WNBA lineup/injury variable is fabricated when a verified public pregame feed does not expose it.');
    } else if (game.sport === 'SOCCER') {
      soccer = await getSoccerContext(game, home, away);
      if (soccer?.homeRecent5XgFor !== null && soccer?.awayRecent5XgFor !== null) notes.push('Soccer recent xG/chance-creation context was verified from completed pregame ESPN summaries and frozen for the totals challenger.');
      else notes.push('Soccer xG is not consistently available for this competition; the totals challenger falls back to point-in-time recent scoring totals without fabricating xG.');
    }

    const specializedAvailable = game.sport === 'MLB'
      ? Boolean(mlb?.homeProbablePitcher || mlb?.awayProbablePitcher)
      : game.sport === 'NFL'
        ? Boolean(nfl?.homeStrengthIndex !== null && nfl?.awayStrengthIndex !== null)
        : game.sport === 'NCAAF'
          ? Boolean(ncaaf?.homeStrengthIndex !== null && ncaaf?.awayStrengthIndex !== null)
        : game.sport === 'WNBA'
          ? Boolean(wnba && home.sampleCount >= 6 && away.sampleCount >= 6)
          : game.sport === 'SOCCER'
            ? Boolean(soccer || (generic.homeRecent5Total !== null && generic.awayRecent5Total !== null))
            : false;

    return {
      contextVersion: 'APEX_GAME_CONTEXT_V2',
      observedAt: new Date().toISOString(),
      status: specializedAvailable ? 'AVAILABLE' : (home.records.length && away.records.length ? 'PARTIAL' : 'UNAVAILABLE'),
      ...generic,
      mlb,
      nfl,
      ncaaf,
      wnba,
      soccer,
      notes,
    };
  }
}

export const gameMarketContextService = new GameMarketContextService();
