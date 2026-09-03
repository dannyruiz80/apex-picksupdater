import {
  ApexSport,
  ApexSportFilter,
  MultiSportAuditDiagnostics,
  NormalizedApexGame,
  NormalizedLiveScoreUpdate,
  ScheduleResponse,
  LiveScoresResponse,
  TennisTourFilter,
} from '../types.js';
import { fetchMlbSchedule, fetchMlbLiveScores, mlbAuditState } from './mlbAdapter.js';
import { fetchNflSchedule, fetchNflLiveScores, nflAuditState } from './nflAdapter.js';
import { fetchNbaSchedule, fetchNbaLiveScores, nbaAuditState } from './nbaAdapter.js';
import { fetchWnbaSchedule, fetchWnbaLiveScores, wnbaAuditState } from './wnbaAdapter.js';
import { fetchNhlSchedule, fetchNhlLiveScores, nhlAuditState } from './nhlAdapter.js';
import { fetchSoccerSchedule, fetchSoccerLiveScores, soccerAuditState } from './soccerAdapter.js';
import { fetchTennisSchedule, fetchTennisLiveScores, tennisAuditState } from './tennisAdapter.js';
import { sanitizeScheduleDate } from './shared.js';

export const ALL_SPORTS: ApexSport[] = ['MLB', 'NFL', 'NBA', 'WNBA', 'NHL', 'SOCCER', 'TENNIS'];

export async function fetchSchedule(
  sportFilter: ApexSportFilter = 'ALL',
  dateInput?: string,
  competition?: string,
  tour?: TennisTourFilter
): Promise<ScheduleResponse> {
  const scheduleDate = sanitizeScheduleDate(dateInput);
  const lastVerifiedAt = new Date().toISOString();

  if (sportFilter === 'MLB') {
    const res = await fetchMlbSchedule(scheduleDate);
    return {
      sport: 'MLB',
      scheduleDate,
      source: 'ESPN',
      lastVerifiedAt: res.lastVerifiedAt,
      count: res.games.length,
      games: res.games,
    };
  }

  if (sportFilter === 'NFL') {
    const res = await fetchNflSchedule(scheduleDate);
    return {
      sport: 'NFL',
      scheduleDate,
      source: 'ESPN',
      lastVerifiedAt: res.lastVerifiedAt,
      count: res.games.length,
      games: res.games,
    };
  }

  if (sportFilter === 'NBA') {
    const res = await fetchNbaSchedule(scheduleDate);
    return {
      sport: 'NBA',
      scheduleDate,
      source: 'ESPN',
      lastVerifiedAt: res.lastVerifiedAt,
      count: res.games.length,
      games: res.games,
    };
  }

  if (sportFilter === 'WNBA') {
    const res = await fetchWnbaSchedule(scheduleDate);
    return {
      sport: 'WNBA',
      scheduleDate,
      source: 'ESPN',
      lastVerifiedAt: res.lastVerifiedAt,
      count: res.games.length,
      games: res.games,
    };
  }

  if (sportFilter === 'NHL') {
    const res = await fetchNhlSchedule(scheduleDate);
    return {
      sport: 'NHL',
      scheduleDate,
      source: 'ESPN',
      lastVerifiedAt: res.lastVerifiedAt,
      count: res.games.length,
      games: res.games,
    };
  }

  if (sportFilter === 'SOCCER') {
    const res = await fetchSoccerSchedule(scheduleDate, competition);
    return {
      sport: 'SOCCER',
      scheduleDate,
      source: 'ESPN',
      lastVerifiedAt: res.lastVerifiedAt,
      count: res.games.length,
      games: res.games,
    };
  }

  if (sportFilter === 'TENNIS') {
    const res = await fetchTennisSchedule(scheduleDate, tour || 'ALL');
    return {
      sport: 'TENNIS',
      scheduleDate,
      source: 'ESPN',
      lastVerifiedAt: res.lastVerifiedAt,
      count: res.games.length,
      games: res.games,
    };
  }

  // Multi-sport query (ALL): fetch all 7 sports concurrently
  const [mlbRes, nflRes, nbaRes, wnbaRes, nhlRes, soccerRes, tennisRes] = await Promise.allSettled([
    fetchMlbSchedule(scheduleDate),
    fetchNflSchedule(scheduleDate),
    fetchNbaSchedule(scheduleDate),
    fetchWnbaSchedule(scheduleDate),
    fetchNhlSchedule(scheduleDate),
    fetchSoccerSchedule(scheduleDate, competition),
    fetchTennisSchedule(scheduleDate, tour || 'ALL'),
  ]);

  const allGames: NormalizedApexGame[] = [];

  if (mlbRes.status === 'fulfilled') allGames.push(...mlbRes.value.games);
  if (nflRes.status === 'fulfilled') allGames.push(...nflRes.value.games);
  if (nbaRes.status === 'fulfilled') allGames.push(...nbaRes.value.games);
  if (wnbaRes.status === 'fulfilled') allGames.push(...wnbaRes.value.games);
  if (nhlRes.status === 'fulfilled') allGames.push(...nhlRes.value.games);
  if (soccerRes.status === 'fulfilled') allGames.push(...soccerRes.value.games);
  if (tennisRes.status === 'fulfilled') allGames.push(...tennisRes.value.games);

  // Sort games chronologically by startTime
  allGames.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return {
    sport: 'ALL',
    scheduleDate,
    source: 'ESPN',
    lastVerifiedAt,
    count: allGames.length,
    games: allGames,
  };
}

export async function fetchLiveScores(
  sportFilter: ApexSportFilter = 'ALL',
  tour?: TennisTourFilter
): Promise<LiveScoresResponse> {
  const lastVerifiedAt = new Date().toISOString();

  if (sportFilter === 'MLB') {
    const res = await fetchMlbLiveScores();
    return {
      sport: 'MLB',
      source: 'ESPN',
      lastVerifiedAt: res.lastVerifiedAt,
      count: res.count,
      liveCount: res.liveCount,
      games: res.games,
    };
  }

  if (sportFilter === 'NFL') {
    const res = await fetchNflLiveScores();
    return {
      sport: 'NFL',
      source: 'ESPN',
      lastVerifiedAt: res.lastVerifiedAt,
      count: res.count,
      liveCount: res.liveCount,
      games: res.games,
    };
  }

  if (sportFilter === 'NBA') {
    const res = await fetchNbaLiveScores();
    return {
      sport: 'NBA',
      source: 'ESPN',
      lastVerifiedAt: res.lastVerifiedAt,
      count: res.count,
      liveCount: res.liveCount,
      games: res.games,
    };
  }

  if (sportFilter === 'WNBA') {
    const res = await fetchWnbaLiveScores();
    return {
      sport: 'WNBA',
      source: 'ESPN',
      lastVerifiedAt: res.lastVerifiedAt,
      count: res.count,
      liveCount: res.liveCount,
      games: res.games,
    };
  }

  if (sportFilter === 'NHL') {
    const res = await fetchNhlLiveScores();
    return {
      sport: 'NHL',
      source: 'ESPN',
      lastVerifiedAt: res.lastVerifiedAt,
      count: res.count,
      liveCount: res.liveCount,
      games: res.games,
    };
  }

  if (sportFilter === 'SOCCER') {
    const res = await fetchSoccerLiveScores();
    return {
      sport: 'SOCCER',
      source: 'ESPN',
      lastVerifiedAt: res.lastVerifiedAt,
      count: res.count,
      liveCount: res.liveCount,
      games: res.games,
    };
  }

  if (sportFilter === 'TENNIS') {
    const res = await fetchTennisLiveScores(tour || 'ALL');
    return {
      sport: 'TENNIS',
      source: 'ESPN',
      lastVerifiedAt: res.lastVerifiedAt,
      count: res.count,
      liveCount: res.liveCount,
      games: res.games,
    };
  }

  // ALL sports live score polling
  const [mlbRes, nflRes, nbaRes, wnbaRes, nhlRes, soccerRes, tennisRes] = await Promise.allSettled([
    fetchMlbLiveScores(),
    fetchNflLiveScores(),
    fetchNbaLiveScores(),
    fetchWnbaLiveScores(),
    fetchNhlLiveScores(),
    fetchSoccerLiveScores(),
    fetchTennisLiveScores(tour || 'ALL'),
  ]);

  const allUpdates: NormalizedLiveScoreUpdate[] = [];

  if (mlbRes.status === 'fulfilled') allUpdates.push(...mlbRes.value.games);
  if (nflRes.status === 'fulfilled') allUpdates.push(...nflRes.value.games);
  if (nbaRes.status === 'fulfilled') allUpdates.push(...nbaRes.value.games);
  if (wnbaRes.status === 'fulfilled') allUpdates.push(...wnbaRes.value.games);
  if (nhlRes.status === 'fulfilled') allUpdates.push(...nhlRes.value.games);
  if (soccerRes.status === 'fulfilled') allUpdates.push(...soccerRes.value.games);
  if (tennisRes.status === 'fulfilled') allUpdates.push(...tennisRes.value.games);

  const liveCount = allUpdates.filter((g) => g.status === 'LIVE').length;

  return {
    sport: 'ALL',
    source: 'ESPN',
    lastVerifiedAt,
    count: allUpdates.length,
    liveCount,
    games: allUpdates,
  };
}

export function getMultiSportAuditDiagnostics(): MultiSportAuditDiagnostics {
  const sportsDiagnostics = {
    MLB: mlbAuditState,
    NFL: nflAuditState,
    NBA: nbaAuditState,
    WNBA: wnbaAuditState,
    NHL: nhlAuditState,
    SOCCER: soccerAuditState,
    TENNIS: tennisAuditState,
  };

  const statuses = Object.values(sportsDiagnostics).map((s) => s.sourceStatus);
  let overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'ERROR' | 'UNINITIALIZED' = 'UNINITIALIZED';

  if (statuses.some((st) => st === 'ERROR')) {
    overallStatus = statuses.every((st) => st === 'ERROR') ? 'ERROR' : 'DEGRADED';
  } else if (statuses.some((st) => st === 'OPERATIONAL')) {
    overallStatus = 'OPERATIONAL';
  }

  return {
    timestamp: new Date().toISOString(),
    overallStatus,
    sports: sportsDiagnostics,
  };
}
