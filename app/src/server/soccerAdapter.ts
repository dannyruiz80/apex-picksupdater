import {
  NormalizedApexGame,
  NormalizedLiveScoreUpdate,
  SportAuditDiagnostic,
} from '../types.js';
import { normalizeStatus, sanitizeScheduleDate, getChicagoTodayDate } from './shared.js';

export interface SoccerCompetitionConfig {
  code: string;
  name: string;
  category: 'Domestic League' | 'European Cup' | 'International';
}

export const SUPPORTED_SOCCER_COMPETITIONS: SoccerCompetitionConfig[] = [
  { code: 'eng.1', name: 'English Premier League', category: 'Domestic League' },
  { code: 'esp.1', name: 'Spanish LALIGA', category: 'Domestic League' },
  { code: 'ita.1', name: 'Italian Serie A', category: 'Domestic League' },
  { code: 'ger.1', name: 'German Bundesliga', category: 'Domestic League' },
  { code: 'fra.1', name: 'French Ligue 1', category: 'Domestic League' },
  { code: 'usa.1', name: 'MLS', category: 'Domestic League' },
  { code: 'uefa.champions', name: 'UEFA Champions League', category: 'European Cup' },
  { code: 'uefa.europa', name: 'UEFA Europa League', category: 'European Cup' },
  { code: 'uefa.euro', name: 'UEFA European Championship', category: 'International' },
  { code: 'conmebol.copa_america', name: 'Copa America', category: 'International' },
  { code: 'fifa.world', name: 'FIFA World Cup', category: 'International' },
  { code: 'fifa.friendly', name: 'International Friendly', category: 'International' },
];

export const soccerAuditState: SportAuditDiagnostic = {
  sport: 'SOCCER',
  sourceName: 'ESPN Soccer Multi-Competition Public Scoreboard API',
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
    competitionCounts: {},
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
  soccerAuditState.sourceStatus = 'ERROR';
  soccerAuditState.recentErrors.unshift({
    timestamp: new Date().toISOString(),
    endpoint,
    message,
  });
  if (soccerAuditState.recentErrors.length > 10) {
    soccerAuditState.recentErrors.pop();
  }
}

/**
 * Parses stoppage time from display clock (e.g. "90'+7'" -> "+7", "45'+2'" -> "+2")
 */
function extractStoppageTime(displayClock?: string): string | null {
  if (!displayClock) return null;
  const match = displayClock.match(/\+(\d+)/);
  return match ? `+${match[1]}` : null;
}

/**
 * Normalizes raw ESPN soccer event
 */
function normalizeSoccerEvent(
  ev: any,
  defaultCompetitionName: string,
  scheduleDate: string,
  lastVerifiedAt: string
): NormalizedApexGame {
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

  // Soccer specific details
  const period = statusObj.period !== undefined ? Number(statusObj.period) || null : null;
  const displayClock = statusObj.displayClock || null;
  const stoppageTime = extractStoppageTime(displayClock);

  // Extra time detection
  const isAet =
    (statusType.name && statusType.name.includes('AET')) ||
    (statusType.detail && statusType.detail.toLowerCase().includes('aet')) ||
    period === 3 ||
    period === 4;

  // Penalties detection
  let penalties: {
    homeShootoutScore: number | null;
    awayShootoutScore: number | null;
  } | null = null;

  if (
    homeComp?.shootoutScore !== undefined ||
    awayComp?.shootoutScore !== undefined ||
    statusType.name === 'STATUS_FINAL_PEN' ||
    statusType.name === 'STATUS_PENALTY_SHOOTOUT' ||
    period === 5
  ) {
    penalties = {
      homeShootoutScore:
        homeComp?.shootoutScore !== undefined && homeComp?.shootoutScore !== null
          ? Number(homeComp.shootoutScore)
          : null,
      awayShootoutScore:
        awayComp?.shootoutScore !== undefined && awayComp?.shootoutScore !== null
          ? Number(awayComp.shootoutScore)
          : null,
    };
  }

  // Aggregate score detection (genuinely available in 2-legged UEFA/playoff ties)
  let aggregateScore: {
    homeAggregate: number | null;
    awayAggregate: number | null;
    note?: string | null;
  } | null = null;

  if (homeComp?.aggregateScore !== undefined || awayComp?.aggregateScore !== undefined) {
    const noteText =
      competition.notes?.[0]?.text ||
      competition.notes?.[0]?.headline ||
      null;

    aggregateScore = {
      homeAggregate:
        homeComp?.aggregateScore !== undefined && homeComp?.aggregateScore !== null
          ? Number(homeComp.aggregateScore)
          : null,
      awayAggregate:
        awayComp?.aggregateScore !== undefined && awayComp?.aggregateScore !== null
          ? Number(awayComp.aggregateScore)
          : null,
      note: noteText,
    };
  }

  const venue = competition.venue?.fullName || null;
  const competitionName =
    ev.league?.name ||
    competition.league?.name ||
    defaultCompetitionName;

  return {
    eventId: String(ev.id),
    sport: 'SOCCER',
    league: competitionName,
    competition: competitionName,
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
    periodType: 'half',
    displayClock,
    matchClock: displayClock,
    stoppageTime,
    extraTime: isAet,
    penalties,
    aggregateScore,
    venue,
    source: 'ESPN',
    lastVerifiedAt,
  };
}

/**
 * Fetches soccer schedule for all supported competitions (or a specific one)
 */
export async function fetchSoccerSchedule(
  dateInput?: string,
  competitionCode?: string
): Promise<{
  scheduleDate: string;
  source: 'ESPN';
  lastVerifiedAt: string;
  count: number;
  games: NormalizedApexGame[];
}> {
  const startTime = Date.now();
  const scheduleDate = sanitizeScheduleDate(dateInput);
  const espnDateParam = scheduleDate.replace(/-/g, '');
  const lastVerifiedAt = new Date().toISOString();

  // Determine target competitions
  let targetCompetitions = SUPPORTED_SOCCER_COMPETITIONS;
  if (competitionCode) {
    const matched = SUPPORTED_SOCCER_COMPETITIONS.filter(
      (c) => c.code.toLowerCase() === competitionCode.toLowerCase() || c.name.toLowerCase() === competitionCode.toLowerCase()
    );
    if (matched.length > 0) {
      targetCompetitions = matched;
    }
  }

  try {
    const results = await Promise.allSettled(
      targetCompetitions.map(async (compConfig) => {
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${compConfig.code}/scoreboard?dates=${espnDateParam}`;
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'ApexPicks/1.0 (SportsIntelligencePlatform)',
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${compConfig.name}`);
        }

        const data: any = await response.json();
        const leagueOfficialName = data.leagues?.[0]?.name || compConfig.name;
        const rawEvents = Array.isArray(data.events) ? data.events : [];

        const normalizedGames: NormalizedApexGame[] = rawEvents.map((ev: any) =>
          normalizeSoccerEvent(ev, leagueOfficialName, scheduleDate, lastVerifiedAt)
        );

        return {
          competitionName: leagueOfficialName,
          games: normalizedGames,
        };
      })
    );

    const allGames: NormalizedApexGame[] = [];
    const competitionCounts: Record<string, number> = {};
    const seenEventIds = new Set<string>();

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      const compConfig = targetCompetitions[i];
      if (res.status === 'fulfilled') {
        const { competitionName, games } = res.value;
        competitionCounts[competitionName] = games.length;
        for (const game of games) {
          if (!seenEventIds.has(game.eventId)) {
            seenEventIds.add(game.eventId);
            allGames.push(game);
          }
        }
      } else {
        competitionCounts[compConfig.name] = 0;
        recordError(`/api/schedule?sport=SOCCER&competition=${compConfig.code}`, res.reason?.message || 'Fetch failed');
      }
    }

    // Sort games chronologically by startTime
    allGames.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    const elapsed = Date.now() - startTime;
    soccerAuditState.sourceStatus = 'OPERATIONAL';
    soccerAuditState.lastScheduleFetch = {
      timestamp: lastVerifiedAt,
      requestedDate: scheduleDate,
      gamesRetrieved: allGames.length,
      upcomingCount: allGames.filter((g) => g.status === 'UPCOMING').length,
      liveCount: allGames.filter((g) => g.status === 'LIVE').length,
      finalCount: allGames.filter((g) => g.status === 'FINAL').length,
      postponedCount: allGames.filter((g) => g.status === 'POSTPONED' || g.status === 'SUSPENDED').length,
      durationMs: elapsed,
      competitionCounts,
    };

    return {
      scheduleDate,
      source: 'ESPN',
      lastVerifiedAt,
      count: allGames.length,
      games: allGames,
    };
  } catch (err: any) {
    recordError('/api/schedule?sport=SOCCER', err.message || 'Failed to fetch soccer schedule');
    throw err;
  }
}

/**
 * Fetches soccer live scores for ~30s polling
 */
export async function fetchSoccerLiveScores(): Promise<{
  sport: 'SOCCER';
  lastVerifiedAt: string;
  count: number;
  liveCount: number;
  games: NormalizedLiveScoreUpdate[];
}> {
  const startTime = Date.now();
  const todayChicago = getChicagoTodayDate();
  const espnDateParam = todayChicago.replace(/-/g, '');
  const lastVerifiedAt = new Date().toISOString();

  try {
    const results = await Promise.allSettled(
      SUPPORTED_SOCCER_COMPETITIONS.map(async (compConfig) => {
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${compConfig.code}/scoreboard?dates=${espnDateParam}`;
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'ApexPicks/1.0 (LiveScorePolling)',
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${compConfig.code}`);
        }

        const data: any = await response.json();
        const rawEvents = Array.isArray(data.events) ? data.events : [];

        return rawEvents.map((ev: any): NormalizedLiveScoreUpdate => {
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
          const stoppageTime = extractStoppageTime(displayClock);

          const isAet =
            (statusType.name && statusType.name.includes('AET')) ||
            (statusType.detail && statusType.detail.toLowerCase().includes('aet')) ||
            period === 3 ||
            period === 4;

          let penalties: {
            homeShootoutScore: number | null;
            awayShootoutScore: number | null;
          } | null = null;

          if (
            homeComp?.shootoutScore !== undefined ||
            awayComp?.shootoutScore !== undefined ||
            statusType.name === 'STATUS_FINAL_PEN' ||
            statusType.name === 'STATUS_PENALTY_SHOOTOUT' ||
            period === 5
          ) {
            penalties = {
              homeShootoutScore:
                homeComp?.shootoutScore !== undefined && homeComp?.shootoutScore !== null
                  ? Number(homeComp.shootoutScore)
                  : null,
              awayShootoutScore:
                awayComp?.shootoutScore !== undefined && awayComp?.shootoutScore !== null
                  ? Number(awayComp.shootoutScore)
                  : null,
            };
          }

          let aggregateScore: {
            homeAggregate: number | null;
            awayAggregate: number | null;
            note?: string | null;
          } | null = null;

          if (homeComp?.aggregateScore !== undefined || awayComp?.aggregateScore !== undefined) {
            aggregateScore = {
              homeAggregate:
                homeComp?.aggregateScore !== undefined && homeComp?.aggregateScore !== null
                  ? Number(homeComp.aggregateScore)
                  : null,
              awayAggregate:
                awayComp?.aggregateScore !== undefined && awayComp?.aggregateScore !== null
                  ? Number(awayComp.aggregateScore)
                  : null,
              note: competition.notes?.[0]?.text || competition.notes?.[0]?.headline || null,
            };
          }

          return {
            eventId: String(ev.id),
            sport: 'SOCCER',
            status: apexStatus,
            statusDetail,
            homeScore,
            awayScore,
            period,
            periodType: 'half',
            displayClock,
            matchClock: displayClock,
            stoppageTime,
            extraTime: isAet,
            penalties,
            aggregateScore,
            lastVerifiedAt,
          };
        });
      })
    );

    const allUpdates: NormalizedLiveScoreUpdate[] = [];
    const seenEventIds = new Set<string>();

    for (const res of results) {
      if (res.status === 'fulfilled') {
        for (const update of res.value) {
          if (!seenEventIds.has(update.eventId)) {
            seenEventIds.add(update.eventId);
            allUpdates.push(update);
          }
        }
      }
    }

    const elapsed = Date.now() - startTime;
    const liveCount = allUpdates.filter((g) => g.status === 'LIVE').length;

    soccerAuditState.sourceStatus = 'OPERATIONAL';
    soccerAuditState.lastLiveScoreFetch = {
      timestamp: lastVerifiedAt,
      gamesUpdated: allUpdates.length,
      liveCount,
      durationMs: elapsed,
    };

    return {
      sport: 'SOCCER',
      lastVerifiedAt,
      count: allUpdates.length,
      liveCount,
      games: allUpdates,
    };
  } catch (err: any) {
    recordError('/api/live-scores?sport=SOCCER', err.message || 'Failed to fetch soccer live scores');
    throw err;
  }
}
