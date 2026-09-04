import {
  ApexGameStatus,
  NormalizedApexGame,
  NormalizedLiveScoreUpdate,
  SportAuditDiagnostic,
} from '../types.js';
import { normalizeStatus, sanitizeScheduleDate, getChicagoTodayDate } from './shared.js';

const ESPN_WNBA_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard';

export const wnbaAuditState: SportAuditDiagnostic = {
  sport: 'WNBA',
  sourceName: 'ESPN WNBA Public Scoreboard API',
  sourceStatus: 'UNINITIALIZED',
  lastScheduleFetch: {
    timestamp: null, requestedDate: null, gamesRetrieved: 0, upcomingCount: 0,
    liveCount: 0, finalCount: 0, postponedCount: 0, durationMs: null,
  },
  lastLiveScoreFetch: { timestamp: null, gamesUpdated: 0, liveCount: 0, durationMs: null },
  recentErrors: [],
};

function recordError(endpoint: string, message: string) {
  wnbaAuditState.sourceStatus = 'ERROR';
  wnbaAuditState.recentErrors.unshift({ timestamp: new Date().toISOString(), endpoint, message });
  if (wnbaAuditState.recentErrors.length > 10) wnbaAuditState.recentErrors.pop();
}

function numericScore(raw: any): number | null {
  const candidate = raw?.value ?? raw?.displayValue ?? raw;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  const n = Number(candidate);
  return Number.isFinite(n) ? n : null;
}

export function wnbaStateFlags(status: ApexGameStatus, startTime: string, nowMs = Date.now()) {
  const startMs = Date.parse(startTime);
  return {
    pregameBetEligible: status === 'UPCOMING' && Number.isFinite(startMs) && startMs > nowMs,
    eventVisibleInLive: status === 'LIVE' || status === 'SUSPENDED',
  };
}

export function parseWnbaScoreboard(raw: any, scheduleDate: string, lastVerifiedAt: string, nowMs = Date.now()): NormalizedApexGame[] {
  const leagueName = raw?.leagues?.[0]?.abbreviation || raw?.leagues?.[0]?.name || 'WNBA';
  const rawEvents = Array.isArray(raw?.events) ? raw.events : [];
  return rawEvents.map((ev: any) => {
    const competition = ev?.competitions?.[0] || {};
    const statusObj = competition?.status || {};
    const statusType = statusObj?.type || {};
    const status = normalizeStatus(statusType.name, statusType.state, statusType.completed, statusType.detail || statusType.description);
    const statusDetail = statusType.detail || statusType.shortDetail || statusType.description || status;
    const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
    const homeComp = competitors.find((c: any) => c?.homeAway === 'home');
    const awayComp = competitors.find((c: any) => c?.homeAway === 'away');
    const startTime = String(ev?.date || competition?.date || lastVerifiedAt);
    const flags = wnbaStateFlags(status, startTime, nowMs);
    const scoreVisible = status !== 'UPCOMING';
    return {
      eventId: String(ev?.id), sport: 'WNBA' as const, league: String(leagueName), scheduleDate, startTime,
      awayTeamId: awayComp?.team?.id ? String(awayComp.team.id) : awayComp?.id ? String(awayComp.id) : null,
      awayTeam: awayComp?.team?.displayName || awayComp?.team?.name || null,
      awayAbbreviation: awayComp?.team?.abbreviation || null,
      homeTeamId: homeComp?.team?.id ? String(homeComp.team.id) : homeComp?.id ? String(homeComp.id) : null,
      homeTeam: homeComp?.team?.displayName || homeComp?.team?.name || null,
      homeAbbreviation: homeComp?.team?.abbreviation || null,
      status, statusDetail, ...flags,
      awayScore: scoreVisible ? numericScore(awayComp?.score) : null,
      homeScore: scoreVisible ? numericScore(homeComp?.score) : null,
      period: statusObj?.period !== undefined ? Number(statusObj.period) || null : null,
      periodType: 'quarter' as const,
      displayClock: statusObj?.displayClock || null,
      venue: competition?.venue?.fullName || null,
      source: 'ESPN' as const, lastVerifiedAt,
    };
  });
}

export function wnbaGameToLiveUpdate(game: NormalizedApexGame): NormalizedLiveScoreUpdate {
  return {
    eventId: game.eventId, sport: 'WNBA', status: game.status, statusDetail: game.statusDetail,
    league: game.league, scheduleDate: game.scheduleDate, startTime: game.startTime,
    homeTeamId: game.homeTeamId, homeTeam: game.homeTeam, homeAbbreviation: game.homeAbbreviation,
    awayTeamId: game.awayTeamId, awayTeam: game.awayTeam, awayAbbreviation: game.awayAbbreviation,
    venue: game.venue, pregameBetEligible: game.pregameBetEligible, eventVisibleInLive: game.eventVisibleInLive,
    homeScore: game.homeScore, awayScore: game.awayScore, period: game.period, periodType: 'quarter',
    displayClock: game.displayClock, lastVerifiedAt: game.lastVerifiedAt,
  };
}

async function fetchScoreboard(url: string, userAgent: string): Promise<any> {
  const response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`ESPN WNBA scoreboard HTTP ${response.status}: ${response.statusText}`);
  return response.json();
}

export async function fetchWnbaSchedule(dateInput?: string): Promise<{
  scheduleDate: string; source: 'ESPN'; lastVerifiedAt: string; count: number; games: NormalizedApexGame[];
}> {
  const started = Date.now();
  const scheduleDate = sanitizeScheduleDate(dateInput);
  const url = `${ESPN_WNBA_SCOREBOARD}?dates=${scheduleDate.replace(/-/g, '')}`;
  try {
    const data = await fetchScoreboard(url, 'ApexPicks/1.14.8 (WNBA Schedule)');
    const lastVerifiedAt = new Date().toISOString();
    const games = parseWnbaScoreboard(data, scheduleDate, lastVerifiedAt);
    wnbaAuditState.sourceStatus = 'OPERATIONAL';
    wnbaAuditState.lastScheduleFetch = {
      timestamp: lastVerifiedAt, requestedDate: scheduleDate, gamesRetrieved: games.length,
      upcomingCount: games.filter((g) => g.status === 'UPCOMING').length,
      liveCount: games.filter((g) => g.status === 'LIVE').length,
      finalCount: games.filter((g) => g.status === 'FINAL').length,
      postponedCount: games.filter((g) => g.status === 'POSTPONED' || g.status === 'SUSPENDED').length,
      durationMs: Date.now() - started,
    };
    return { scheduleDate, source: 'ESPN', lastVerifiedAt, count: games.length, games };
  } catch (err: any) {
    recordError('/api/schedule?sport=WNBA', err?.message || 'Failed to fetch WNBA schedule');
    throw err;
  }
}

export async function fetchWnbaLiveScores(): Promise<{
  sport: 'WNBA'; lastVerifiedAt: string; count: number; liveCount: number; games: NormalizedLiveScoreUpdate[];
}> {
  const started = Date.now();
  const todayChicago = getChicagoTodayDate();
  try {
    // Current/live scoreboard is intentionally requested without a forced date first. This avoids
    // UTC rollover hiding an in-progress game. A Chicago-date request is only the fallback.
    let data = await fetchScoreboard(ESPN_WNBA_SCOREBOARD, 'ApexPicks/1.14.8 (WNBA Live Poll)');
    let rawEvents = Array.isArray(data?.events) ? data.events : [];
    if (!rawEvents.length) {
      data = await fetchScoreboard(`${ESPN_WNBA_SCOREBOARD}?dates=${todayChicago.replace(/-/g, '')}`, 'ApexPicks/1.14.8 (WNBA Live Fallback)');
      rawEvents = Array.isArray(data?.events) ? data.events : [];
    }
    const lastVerifiedAt = new Date().toISOString();
    const normalized = parseWnbaScoreboard({ ...data, events: rawEvents }, todayChicago, lastVerifiedAt);
    const games = normalized.map(wnbaGameToLiveUpdate);
    const liveCount = games.filter((g) => g.status === 'LIVE').length;
    wnbaAuditState.sourceStatus = 'OPERATIONAL';
    wnbaAuditState.lastLiveScoreFetch = { timestamp: lastVerifiedAt, gamesUpdated: games.length, liveCount, durationMs: Date.now() - started };
    return { sport: 'WNBA', lastVerifiedAt, count: games.length, liveCount, games };
  } catch (err: any) {
    recordError('/api/live-scores?sport=WNBA', err?.message || 'Failed to fetch WNBA live scores');
    throw err;
  }
}
