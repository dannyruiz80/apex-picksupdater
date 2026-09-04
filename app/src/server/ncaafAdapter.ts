import {
  ApexGameStatus,
  NormalizedApexGame,
  NormalizedLiveScoreUpdate,
  SportAuditDiagnostic,
} from '../types.js';
import { normalizeStatus, sanitizeScheduleDate, getChicagoTodayDate } from './shared.js';
import { isStartTimeOnScheduleDate } from './scheduleDateIdentity.js';

const ESPN_NCAAF_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';
const FBS_QUERY = 'groups=80&limit=200';

export const ncaafAuditState: SportAuditDiagnostic = {
  sport: 'NCAAF',
  sourceName: 'ESPN NCAAF Public Scoreboard API (FBS)',
  sourceStatus: 'UNINITIALIZED',
  lastScheduleFetch: {
    timestamp: null, requestedDate: null, gamesRetrieved: 0, upcomingCount: 0,
    liveCount: 0, finalCount: 0, postponedCount: 0, durationMs: null,
  },
  lastLiveScoreFetch: { timestamp: null, gamesUpdated: 0, liveCount: 0, durationMs: null },
  recentErrors: [],
};

function recordError(endpoint: string, message: string) {
  ncaafAuditState.sourceStatus = 'ERROR';
  ncaafAuditState.recentErrors.unshift({ timestamp: new Date().toISOString(), endpoint, message });
  if (ncaafAuditState.recentErrors.length > 10) ncaafAuditState.recentErrors.pop();
}

function numericScore(raw: any): number | null {
  const candidate = raw?.value ?? raw?.displayValue ?? raw;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  const n = Number(candidate);
  return Number.isFinite(n) ? n : null;
}

export function ncaafStateFlags(status: ApexGameStatus, startTime: string, nowMs = Date.now()) {
  const startMs = Date.parse(startTime);
  return {
    pregameBetEligible: status === 'UPCOMING' && Number.isFinite(startMs) && startMs > nowMs,
    eventVisibleInLive: status === 'LIVE' || status === 'SUSPENDED',
  };
}

function competitionLabel(competition: any): string | null {
  const notes = Array.isArray(competition?.notes) ? competition.notes : [];
  const headline = notes.find((n: any) => String(n?.headline || '').trim())?.headline;
  return headline ? String(headline) : null;
}

export function parseNcaafScoreboard(raw: any, scheduleDate: string, lastVerifiedAt: string, nowMs = Date.now()): NormalizedApexGame[] {
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
    const flags = ncaafStateFlags(status, startTime, nowMs);
    const scoreVisible = status !== 'UPCOMING';
    return {
      eventId: String(ev?.id), sport: 'NCAAF' as const, league: 'NCAAF',
      competition: competitionLabel(competition), scheduleDate, startTime,
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
  }).filter((game: NormalizedApexGame) => game.homeTeamId && game.awayTeamId && game.homeTeam && game.awayTeam);
}

export function filterNcaafScheduleDate(games: NormalizedApexGame[], scheduleDate: string): NormalizedApexGame[] {
  return games.filter((game) => isStartTimeOnScheduleDate(game.startTime, scheduleDate));
}

export function ncaafGameToLiveUpdate(game: NormalizedApexGame): NormalizedLiveScoreUpdate {
  return {
    eventId: game.eventId, sport: 'NCAAF', status: game.status, statusDetail: game.statusDetail,
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
  if (!response.ok) throw new Error(`ESPN NCAAF scoreboard HTTP ${response.status}: ${response.statusText}`);
  return response.json();
}

function withQuery(extra?: string): string {
  return `${ESPN_NCAAF_SCOREBOARD}?${FBS_QUERY}${extra ? `&${extra}` : ''}`;
}

export async function fetchNcaafSchedule(dateInput?: string): Promise<{
  scheduleDate: string; source: 'ESPN'; lastVerifiedAt: string; count: number; games: NormalizedApexGame[];
}> {
  const started = Date.now();
  const scheduleDate = sanitizeScheduleDate(dateInput);
  const url = withQuery(`dates=${scheduleDate.replace(/-/g, '')}`);
  try {
    const data = await fetchScoreboard(url, 'ApexPicks/1.14.9 (NCAAF Schedule)');
    const lastVerifiedAt = new Date().toISOString();
    const parsedGames = parseNcaafScoreboard(data, scheduleDate, lastVerifiedAt);
    // FBS queries occasionally include neighboring-day/week spillover. Keep the selected
    // slate date authoritative before markets or models are evaluated.
    const games = filterNcaafScheduleDate(parsedGames, scheduleDate);
    ncaafAuditState.sourceStatus = 'OPERATIONAL';
    ncaafAuditState.lastScheduleFetch = {
      timestamp: lastVerifiedAt, requestedDate: scheduleDate, gamesRetrieved: games.length,
      upcomingCount: games.filter((g) => g.status === 'UPCOMING').length,
      liveCount: games.filter((g) => g.status === 'LIVE').length,
      finalCount: games.filter((g) => g.status === 'FINAL').length,
      postponedCount: games.filter((g) => g.status === 'POSTPONED' || g.status === 'SUSPENDED').length,
      durationMs: Date.now() - started,
    };
    return { scheduleDate, source: 'ESPN', lastVerifiedAt, count: games.length, games };
  } catch (err: any) {
    recordError('/api/schedule?sport=NCAAF', err?.message || 'Failed to fetch NCAAF schedule');
    throw err;
  }
}

export async function fetchNcaafLiveScores(): Promise<{
  sport: 'NCAAF'; lastVerifiedAt: string; count: number; liveCount: number; games: NormalizedLiveScoreUpdate[];
}> {
  const started = Date.now();
  const todayChicago = getChicagoTodayDate();
  try {
    // Current/live scoreboard is requested without a date first. The Chicago-date query is only a fallback,
    // preventing a UTC rollover from hiding an in-progress college football game.
    let data = await fetchScoreboard(withQuery(), 'ApexPicks/1.14.9 (NCAAF Live Poll)');
    let rawEvents = Array.isArray(data?.events) ? data.events : [];
    if (!rawEvents.length) {
      data = await fetchScoreboard(withQuery(`dates=${todayChicago.replace(/-/g, '')}`), 'ApexPicks/1.14.9 (NCAAF Live Fallback)');
      rawEvents = Array.isArray(data?.events) ? data.events : [];
    }
    const lastVerifiedAt = new Date().toISOString();
    const normalized = parseNcaafScoreboard({ ...data, events: rawEvents }, todayChicago, lastVerifiedAt);
    const games = normalized.map(ncaafGameToLiveUpdate);
    const liveCount = games.filter((g) => g.status === 'LIVE').length;
    ncaafAuditState.sourceStatus = 'OPERATIONAL';
    ncaafAuditState.lastLiveScoreFetch = { timestamp: lastVerifiedAt, gamesUpdated: games.length, liveCount, durationMs: Date.now() - started };
    return { sport: 'NCAAF', lastVerifiedAt, count: games.length, liveCount, games };
  } catch (err: any) {
    recordError('/api/live-scores?sport=NCAAF', err?.message || 'Failed to fetch NCAAF live scores');
    throw err;
  }
}
