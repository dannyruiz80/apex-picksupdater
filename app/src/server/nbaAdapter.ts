import {
  NormalizedApexGame,
  NormalizedLiveScoreUpdate,
  SportAuditDiagnostic,
} from '../types.js';
import { normalizeStatus, sanitizeScheduleDate, getChicagoTodayDate } from './shared.js';

export const nbaAuditState: SportAuditDiagnostic = {
  sport: 'NBA',
  sourceName: 'ESPN NBA Public Scoreboard API',
  sourceStatus: 'UNINITIALIZED',
  lastScheduleFetch: {
    timestamp: null,
    requestedDate: null,
    gamesRetrieved: 0,
    upcomingCount: 0,
    liveCount: 0,
    finalCount: 0,
    postponedCount: 0,
    durationMs: null,
  },
  lastLiveScoreFetch: {
    timestamp: null,
    gamesUpdated: 0,
    liveCount: 0,
    durationMs: null,
  },
  recentErrors: [],
};

function recordError(endpoint: string, message: string) {
  nbaAuditState.sourceStatus = 'ERROR';
  nbaAuditState.recentErrors.unshift({
    timestamp: new Date().toISOString(),
    endpoint,
    message,
  });
  if (nbaAuditState.recentErrors.length > 10) {
    nbaAuditState.recentErrors.pop();
  }
}

export async function fetchNbaSchedule(dateInput?: string): Promise<{
  scheduleDate: string;
  source: 'ESPN';
  lastVerifiedAt: string;
  count: number;
  games: NormalizedApexGame[];
}> {
  const startTime = Date.now();
  const scheduleDate = sanitizeScheduleDate(dateInput);
  const espnDateParam = scheduleDate.replace(/-/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${espnDateParam}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ApexPicks/1.0 (SportsIntelligencePlatform)',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`ESPN NBA API returned HTTP ${response.status}: ${response.statusText}`);
    }

    const data: any = await response.json();
    const lastVerifiedAt = new Date().toISOString();
    const leagueName = data.leagues?.[0]?.abbreviation || data.leagues?.[0]?.name || 'NBA';
    const rawEvents = Array.isArray(data.events) ? data.events : [];

    const games: NormalizedApexGame[] = rawEvents.map((ev: any) => {
      const competition = ev.competitions?.[0] || {};
      const statusObj = competition.status || {};
      const statusType = statusObj.type || {};

      const apexStatus = normalizeStatus(
        statusType.name,
        statusType.state,
        statusType.completed,
        statusType.detail || statusType.description
      );

      const statusDetail =
        statusType.detail || statusType.shortDetail || statusType.description || apexStatus;

      const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
      const homeComp = competitors.find((c: any) => c.homeAway === 'home');
      const awayComp = competitors.find((c: any) => c.homeAway === 'away');

      const homeTeam = homeComp?.team?.displayName || homeComp?.team?.name || null;
      const homeAbbreviation = homeComp?.team?.abbreviation || null;
      const homeTeamId = homeComp?.team?.id
        ? String(homeComp.team.id)
        : homeComp?.id
        ? String(homeComp.id)
        : null;

      const awayTeam = awayComp?.team?.displayName || awayComp?.team?.name || null;
      const awayAbbreviation = awayComp?.team?.abbreviation || null;
      const awayTeamId = awayComp?.team?.id
        ? String(awayComp.team.id)
        : awayComp?.id
        ? String(awayComp.id)
        : null;

      let homeScore: number | null = null;
      let awayScore: number | null = null;

      if (apexStatus !== 'UPCOMING') {
        if (homeComp?.score !== undefined && homeComp?.score !== null && homeComp?.score !== '') {
          const parsed = Number(homeComp.score);
          if (!isNaN(parsed)) homeScore = parsed;
        }
        if (awayComp?.score !== undefined && awayComp?.score !== null && awayComp?.score !== '') {
          const parsed = Number(awayComp.score);
          if (!isNaN(parsed)) awayScore = parsed;
        }
      }

      const period = statusObj.period !== undefined ? Number(statusObj.period) || null : null;
      const displayClock = statusObj.displayClock || null;
      const venue = competition.venue?.fullName || null;

      return {
        eventId: String(ev.id),
        sport: 'NBA',
        league: leagueName,
        scheduleDate,
        startTime: ev.date || competition.date || lastVerifiedAt,
        awayTeamId,
        awayTeam,
        awayAbbreviation,
        homeTeamId,
        homeTeam,
        homeAbbreviation,
        status: apexStatus,
        statusDetail,
        awayScore,
        homeScore,
        period,
        periodType: 'quarter',
        displayClock,
        venue,
        source: 'ESPN',
        lastVerifiedAt,
      };
    });

    const elapsed = Date.now() - startTime;
    nbaAuditState.sourceStatus = 'OPERATIONAL';
    nbaAuditState.lastScheduleFetch = {
      timestamp: lastVerifiedAt,
      requestedDate: scheduleDate,
      gamesRetrieved: games.length,
      upcomingCount: games.filter((g) => g.status === 'UPCOMING').length,
      liveCount: games.filter((g) => g.status === 'LIVE').length,
      finalCount: games.filter((g) => g.status === 'FINAL').length,
      postponedCount: games.filter((g) => g.status === 'POSTPONED' || g.status === 'SUSPENDED').length,
      durationMs: elapsed,
    };

    return {
      scheduleDate,
      source: 'ESPN',
      lastVerifiedAt,
      count: games.length,
      games,
    };
  } catch (err: any) {
    recordError('/api/schedule?sport=NBA', err.message || 'Failed to fetch NBA schedule');
    throw err;
  }
}

export async function fetchNbaLiveScores(): Promise<{
  sport: 'NBA';
  lastVerifiedAt: string;
  count: number;
  liveCount: number;
  games: NormalizedLiveScoreUpdate[];
}> {
  const startTime = Date.now();
  const todayChicago = getChicagoTodayDate();
  const espnDateParam = todayChicago.replace(/-/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${espnDateParam}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ApexPicks/1.0 (LiveScorePolling)',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`ESPN NBA LiveScore HTTP ${response.status}: ${response.statusText}`);
    }

    const data: any = await response.json();
    const lastVerifiedAt = new Date().toISOString();
    const rawEvents = Array.isArray(data.events) ? data.events : [];

    const games: NormalizedLiveScoreUpdate[] = rawEvents.map((ev: any) => {
      const competition = ev.competitions?.[0] || {};
      const statusObj = competition.status || {};
      const statusType = statusObj.type || {};

      const apexStatus = normalizeStatus(
        statusType.name,
        statusType.state,
        statusType.completed,
        statusType.detail || statusType.description
      );

      const statusDetail =
        statusType.detail || statusType.shortDetail || statusType.description || apexStatus;

      const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
      const homeComp = competitors.find((c: any) => c.homeAway === 'home');
      const awayComp = competitors.find((c: any) => c.homeAway === 'away');

      let homeScore: number | null = null;
      let awayScore: number | null = null;

      if (apexStatus !== 'UPCOMING') {
        if (homeComp?.score !== undefined && homeComp?.score !== null && homeComp?.score !== '') {
          const parsed = Number(homeComp.score);
          if (!isNaN(parsed)) homeScore = parsed;
        }
        if (awayComp?.score !== undefined && awayComp?.score !== null && awayComp?.score !== '') {
          const parsed = Number(awayComp.score);
          if (!isNaN(parsed)) awayScore = parsed;
        }
      }

      const period = statusObj.period !== undefined ? Number(statusObj.period) || null : null;
      const displayClock = statusObj.displayClock || null;

      return {
        eventId: String(ev.id),
        sport: 'NBA',
        status: apexStatus,
        statusDetail,
        homeScore,
        awayScore,
        period,
        periodType: 'quarter',
        displayClock,
        lastVerifiedAt,
      };
    });

    const elapsed = Date.now() - startTime;
    const liveCount = games.filter((g) => g.status === 'LIVE').length;

    nbaAuditState.sourceStatus = 'OPERATIONAL';
    nbaAuditState.lastLiveScoreFetch = {
      timestamp: lastVerifiedAt,
      gamesUpdated: games.length,
      liveCount,
      durationMs: elapsed,
    };

    return {
      sport: 'NBA',
      lastVerifiedAt,
      count: games.length,
      liveCount,
      games,
    };
  } catch (err: any) {
    recordError('/api/live-scores?sport=NBA', err.message || 'Failed to fetch NBA live scores');
    throw err;
  }
}
