import {
  NormalizedApexGame,
  NormalizedLiveScoreUpdate,
  TennisAuditDiagnostic,
  TennisTour,
  TennisTourFilter,
  TennisSetScore,
  ApexGameStatus,
} from '../types.js';
import { normalizeStatus, sanitizeScheduleDate } from './shared.js';

const ESPN_ATP_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard';
const ESPN_WTA_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard';

// In-memory cache for live polling preservation
let lastKnownTennisGames: Map<string, NormalizedApexGame> = new Map();

export const tennisAuditState: TennisAuditDiagnostic = {
  sport: 'TENNIS',
  sourceName: 'ESPN Public Tennis Scoreboards (ATP & WTA)',
  sourceStatus: 'UNINITIALIZED',
  atpSourceStatus: 'UNINITIALIZED',
  wtaSourceStatus: 'UNINITIALIZED',
  lastScheduleFetch: {
    timestamp: null,
    requestedDate: null,
    gamesRetrieved: 0,
    tournamentsDiscovered: 0,
    atpCount: 0,
    wtaCount: 0,
    upcomingCount: 0,
    liveCount: 0,
    finalCount: 0,
    postponedCount: 0,
    parserFailures: 0,
    durationMs: null,
  },
  lastLiveScoreFetch: {
    timestamp: null,
    gamesUpdated: 0,
    liveCount: 0,
    durationMs: null,
  },
  lastSuccessfulAtpRefresh: null,
  lastSuccessfulWtaRefresh: null,
  parserFailures: 0,
  recentErrors: [],
};

function recordError(endpoint: string, message: string) {
  tennisAuditState.recentErrors.unshift({
    timestamp: new Date().toISOString(),
    endpoint,
    message,
  });
  if (tennisAuditState.recentErrors.length > 10) {
    tennisAuditState.recentErrors.pop();
  }
}

const chicagoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getChicagoDateString(dateIsoOrTimestamp?: string): string | null {
  if (!dateIsoOrTimestamp) return null;
  try {
    const d = new Date(dateIsoOrTimestamp);
    if (isNaN(d.getTime())) return null;
    return chicagoDateFormatter.format(d);
  } catch {
    return null;
  }
}

interface RawCompetitor {
  id?: string;
  order?: number;
  winner?: boolean;
  score?: string | number;
  linescores?: Array<{
    value?: number;
    tiebreak?: number;
    winner?: boolean;
  }>;
  athlete?: {
    id?: string;
    displayName?: string;
    fullName?: string;
    shortName?: string;
    flag?: { alt?: string; href?: string };
    country?: { abbrev?: string; name?: string };
  };
  roster?: {
    displayName?: string;
    shortDisplayName?: string;
    athletes?: Array<{
      displayName?: string;
      fullName?: string;
      flag?: { alt?: string };
    }>;
  };
  name?: string;
}

interface RawCompetition {
  id: string;
  uid?: string;
  date?: string;
  startDate?: string;
  timeValid?: boolean;
  status?: {
    period?: number;
    displayClock?: string;
    type?: {
      id?: string;
      name?: string;
      state?: string;
      completed?: boolean;
      description?: string;
      detail?: string;
      shortDetail?: string;
    };
  };
  venue?: {
    fullName?: string;
    court?: string;
    surface?: string;
  };
  court?: string;
  surface?: string;
  type?: {
    id?: string;
    text?: string;
    slug?: string;
  };
  round?: {
    id?: string | number;
    displayName?: string;
  };
  notes?: Array<{ text?: string; type?: string }>;
  competitors?: RawCompetitor[];
  tournamentId?: string | number;
}

interface RawTennisEvent {
  id: string | number;
  name: string;
  date?: string;
  surface?: string;
  venue?: {
    displayName?: string;
    surface?: string;
  };
  competitions?: RawCompetition[];
  groupings?: Array<{
    id?: string;
    name?: string;
    competitions?: RawCompetition[];
  }>;
}

function parseCompetition(
  comp: RawCompetition,
  tournament: RawTennisEvent,
  defaultTour: TennisTour,
  scheduleDate: string
): NormalizedApexGame | null {
  try {
    const eventId = String(comp.id || `${tournament.id}-${comp.round?.displayName || 'match'}`);
    const matchDateStr = comp.date || comp.startDate || tournament.date || new Date().toISOString();
    const matchChicagoDate = getChicagoDateString(matchDateStr) || scheduleDate;

    // Classify Tour: ATP vs WTA
    const typeSlug = (comp.type?.slug || '').toLowerCase();
    const typeText = (comp.type?.text || '').toLowerCase();
    let tour: TennisTour = defaultTour;
    if (typeSlug.includes('women') || typeText.includes('women')) {
      tour = 'WTA';
    } else if (typeSlug.includes('men') || typeText.includes('men')) {
      tour = 'ATP';
    }

    // Determine status strictly from individual competition
    const statusType = comp.status?.type;
    const statusName = (statusType?.name || '').toUpperCase();
    const state = (statusType?.state || '').toLowerCase();
    const completed = statusType?.completed || false;
    let detail = statusType?.shortDetail || statusType?.detail || statusType?.description || 'Scheduled';

    let apexStatus = normalizeStatus(statusName, state, completed, detail);

    if (statusName === 'STATUS_RETIRED' || detail.toLowerCase().includes('retired')) {
      apexStatus = 'FINAL';
      if (!detail.toLowerCase().includes('retired')) {
        detail = `${detail} (Retired)`;
      }
    } else if (statusName === 'STATUS_WALKOVER' || detail.toLowerCase().includes('walkover')) {
      apexStatus = 'FINAL';
      if (!detail.toLowerCase().includes('walkover')) {
        detail = `${detail} (Walkover)`;
      }
    }

    // Extract Competitors strictly from this individual competition
    const competitors = comp.competitors || [];
    const compA = competitors[0];
    const compB = competitors[1];

    const playerAId = compA?.athlete?.id || compA?.id || 'player-a';
    const playerAName =
      compA?.athlete?.displayName ||
      compA?.athlete?.fullName ||
      compA?.roster?.displayName ||
      compA?.name ||
      'TBD';
    const playerACountry =
      compA?.athlete?.flag?.alt ||
      compA?.athlete?.country?.name ||
      compA?.athlete?.country?.abbrev ||
      null;

    const playerBId = compB?.athlete?.id || compB?.id || 'player-b';
    const playerBName =
      compB?.athlete?.displayName ||
      compB?.athlete?.fullName ||
      compB?.roster?.displayName ||
      compB?.name ||
      'TBD';
    const playerBCountry =
      compB?.athlete?.flag?.alt ||
      compB?.athlete?.country?.name ||
      compB?.athlete?.country?.abbrev ||
      null;

    // Parse set scores & linescores
    const isUpcoming = apexStatus === 'UPCOMING' || apexStatus === 'POSTPONED' || apexStatus === 'CANCELLED';
    const linesA = compA?.linescores || [];
    const linesB = compB?.linescores || [];
    const maxSets = Math.max(linesA.length, linesB.length);

    const setScores: TennisSetScore[] = [];
    let setsWonA = 0;
    let setsWonB = 0;

    if (!isUpcoming && maxSets > 0) {
      for (let i = 0; i < maxSets; i++) {
        const setA = linesA[i];
        const setB = linesB[i];
        const scoreA = typeof setA?.value === 'number' ? setA.value : 0;
        const scoreB = typeof setB?.value === 'number' ? setB.value : 0;

        if (setA?.winner === true || scoreA > scoreB) {
          setsWonA++;
        } else if (setB?.winner === true || scoreB > scoreA) {
          setsWonB++;
        }

        setScores.push({
          setNumber: i + 1,
          scoreA,
          scoreB,
          tiebreakA: typeof setA?.tiebreak === 'number' ? setA.tiebreak : null,
          tiebreakB: typeof setB?.tiebreak === 'number' ? setB.tiebreak : null,
        });
      }
    }

    // Determine match winner only for FINAL matches
    let winner: 'A' | 'B' | null = null;
    if (apexStatus === 'FINAL') {
      if (compA?.winner === true) {
        winner = 'A';
      } else if (compB?.winner === true) {
        winner = 'B';
      } else if (setsWonA > setsWonB) {
        winner = 'A';
      } else if (setsWonB > setsWonA) {
        winner = 'B';
      }
    }

    // Verified court and surface (strictly only when provided by ESPN)
    const court = comp.venue?.court || comp.court || null;
    const surface = comp.surface || comp.venue?.surface || tournament.surface || tournament.venue?.surface || null;

    const round = comp.round?.displayName || (comp.type?.text ? `${comp.type.text}` : 'Match');

    const lastVerifiedAt = new Date().toISOString();

    // currentSet is ONLY applicable for LIVE or SUSPENDED matches in progress
    let currentSet: number | null = null;
    if (apexStatus === 'LIVE') {
      currentSet = typeof comp.status?.period === 'number' && comp.status.period > 0
        ? comp.status.period
        : Math.max(1, setScores.length);
    } else if (apexStatus === 'SUSPENDED') {
      currentSet = typeof comp.status?.period === 'number' && comp.status.period > 0
        ? comp.status.period
        : (setScores.length > 0 ? setScores.length : null);
    }

    return {
      eventId,
      sport: 'TENNIS',
      tour,
      league: tour === 'ATP' ? 'ATP Tour' : 'WTA Tour',
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      round,
      court,
      surface,
      scheduleDate: matchChicagoDate,
      startTime: matchDateStr,
      awayTeamId: playerAId,
      awayTeam: playerAName,
      awayAbbreviation: playerACountry || 'PLA',
      homeTeamId: playerBId,
      homeTeam: playerBName,
      homeAbbreviation: playerBCountry || 'PLB',
      playerAId,
      playerAName,
      playerACountry,
      playerBId,
      playerBName,
      playerBCountry,
      status: apexStatus,
      statusDetail: detail,
      awayScore: isUpcoming ? null : setsWonA,
      homeScore: isUpcoming ? null : setsWonB,
      setsWonA: isUpcoming ? null : setsWonA,
      setsWonB: isUpcoming ? null : setsWonB,
      setScores: setScores.length > 0 ? setScores : null,
      currentSet,
      winner,
      venue: tournament.venue?.displayName || (tournament.name ? `${tournament.name}` : null),
      source: 'ESPN',
      lastVerifiedAt,
    };
  } catch (err: any) {
    tennisAuditState.parserFailures++;
    console.error(`[Apex Picks] Failed to parse tennis competition:`, err.message);
    return null;
  }
}

export async function fetchTennisSchedule(
  scheduleDate: string,
  tourFilter: TennisTourFilter = 'ALL'
): Promise<{ games: NormalizedApexGame[]; lastVerifiedAt: string }> {
  const startTime = Date.now();
  const ymd = scheduleDate.replace(/-/g, '');
  const lastVerifiedAt = new Date().toISOString();

  let atpEvents: RawTennisEvent[] = [];
  let wtaEvents: RawTennisEvent[] = [];

  const shouldFetchAtp = tourFilter === 'ALL' || tourFilter === 'ATP';
  const shouldFetchWta = tourFilter === 'ALL' || tourFilter === 'WTA';

  const fetchPromises: Promise<any>[] = [];

  if (shouldFetchAtp) {
    const atpUrl = `${ESPN_ATP_SCOREBOARD_URL}?dates=${ymd}`;
    fetchPromises.push(
      fetch(atpUrl)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
          const json = await res.json();
          atpEvents = json.events || [];
          tennisAuditState.atpSourceStatus = 'OPERATIONAL';
          tennisAuditState.lastSuccessfulAtpRefresh = new Date().toISOString();
        })
        .catch((err) => {
          tennisAuditState.atpSourceStatus = 'ERROR';
          recordError(atpUrl, err.message);
          console.error(`[Apex Picks] ATP Schedule fetch failed:`, err.message);
        })
    );
  }

  if (shouldFetchWta) {
    const wtaUrl = `${ESPN_WTA_SCOREBOARD_URL}?dates=${ymd}`;
    fetchPromises.push(
      fetch(wtaUrl)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
          const json = await res.json();
          wtaEvents = json.events || [];
          tennisAuditState.wtaSourceStatus = 'OPERATIONAL';
          tennisAuditState.lastSuccessfulWtaRefresh = new Date().toISOString();
        })
        .catch((err) => {
          tennisAuditState.wtaSourceStatus = 'ERROR';
          recordError(wtaUrl, err.message);
          console.error(`[Apex Picks] WTA Schedule fetch failed:`, err.message);
        })
    );
  }

  await Promise.allSettled(fetchPromises);

  // Determine overall status
  if (tennisAuditState.atpSourceStatus === 'OPERATIONAL' || tennisAuditState.wtaSourceStatus === 'OPERATIONAL') {
    tennisAuditState.sourceStatus =
      tennisAuditState.atpSourceStatus === 'OPERATIONAL' && tennisAuditState.wtaSourceStatus === 'OPERATIONAL'
        ? 'OPERATIONAL'
        : 'DEGRADED';
  } else {
    tennisAuditState.sourceStatus = 'ERROR';
  }

  const allParsedMatches: NormalizedApexGame[] = [];
  const discoveredTournaments = new Set<string>();

  // Process ATP Events
  for (const ev of atpEvents) {
    discoveredTournaments.add(String(ev.id));
    let rawComps: RawCompetition[] = [];
    if (Array.isArray(ev.competitions)) rawComps.push(...ev.competitions);
    if (Array.isArray(ev.groupings)) {
      for (const g of ev.groupings) {
        if (Array.isArray(g.competitions)) rawComps.push(...g.competitions);
      }
    }

    for (const comp of rawComps) {
      const matchDateStr = comp.date || comp.startDate;
      const matchChicagoDate = getChicagoDateString(matchDateStr);
      // Filter strictly by the requested scheduleDate in America/Chicago timezone
      if (matchChicagoDate === scheduleDate) {
        const parsed = parseCompetition(comp, ev, 'ATP', scheduleDate);
        if (parsed) {
          allParsedMatches.push(parsed);
          lastKnownTennisGames.set(parsed.eventId, parsed);
        }
      }
    }
  }

  // Process WTA Events
  for (const ev of wtaEvents) {
    discoveredTournaments.add(String(ev.id));
    let rawComps: RawCompetition[] = [];
    if (Array.isArray(ev.competitions)) rawComps.push(...ev.competitions);
    if (Array.isArray(ev.groupings)) {
      for (const g of ev.groupings) {
        if (Array.isArray(g.competitions)) rawComps.push(...g.competitions);
      }
    }

    for (const comp of rawComps) {
      const matchDateStr = comp.date || comp.startDate;
      const matchChicagoDate = getChicagoDateString(matchDateStr);
      // Filter strictly by the requested scheduleDate in America/Chicago timezone
      if (matchChicagoDate === scheduleDate) {
        // Skip duplicate competitions if already parsed from shared event
        if (allParsedMatches.some((m) => m.eventId === String(comp.id))) {
          continue;
        }
        const parsed = parseCompetition(comp, ev, 'WTA', scheduleDate);
        if (parsed) {
          allParsedMatches.push(parsed);
          lastKnownTennisGames.set(parsed.eventId, parsed);
        }
      }
    }
  }

  // Filter by Tour if requested
  const filteredMatches =
    tourFilter === 'ALL'
      ? allParsedMatches
      : allParsedMatches.filter((m) => m.tour === tourFilter);

  // Chronological sort
  filteredMatches.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  // Update audit telemetry
  const durationMs = Date.now() - startTime;
  const atpCount = allParsedMatches.filter((m) => m.tour === 'ATP').length;
  const wtaCount = allParsedMatches.filter((m) => m.tour === 'WTA').length;
  const upcomingCount = filteredMatches.filter((m) => m.status === 'UPCOMING').length;
  const liveCount = filteredMatches.filter((m) => m.status === 'LIVE').length;
  const finalCount = filteredMatches.filter((m) => m.status === 'FINAL').length;
  const postponedCount = filteredMatches.filter((m) => m.status === 'POSTPONED' || m.status === 'SUSPENDED').length;

  tennisAuditState.lastScheduleFetch = {
    timestamp: lastVerifiedAt,
    requestedDate: scheduleDate,
    gamesRetrieved: filteredMatches.length,
    tournamentsDiscovered: discoveredTournaments.size,
    atpCount,
    wtaCount,
    upcomingCount,
    liveCount,
    finalCount,
    postponedCount,
    parserFailures: tennisAuditState.parserFailures,
    durationMs,
  };

  return {
    games: filteredMatches,
    lastVerifiedAt,
  };
}

export async function fetchTennisLiveScores(
  tourFilter: TennisTourFilter = 'ALL'
): Promise<{ games: NormalizedLiveScoreUpdate[]; count: number; liveCount: number; lastVerifiedAt: string }> {
  const startTime = Date.now();
  const lastVerifiedAt = new Date().toISOString();

  let atpEvents: RawTennisEvent[] = [];
  let wtaEvents: RawTennisEvent[] = [];

  const shouldFetchAtp = tourFilter === 'ALL' || tourFilter === 'ATP';
  const shouldFetchWta = tourFilter === 'ALL' || tourFilter === 'WTA';

  const fetchPromises: Promise<any>[] = [];

  if (shouldFetchAtp) {
    fetchPromises.push(
      fetch(ESPN_ATP_SCOREBOARD_URL)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
          const json = await res.json();
          atpEvents = json.events || [];
          tennisAuditState.atpSourceStatus = 'OPERATIONAL';
          tennisAuditState.lastSuccessfulAtpRefresh = new Date().toISOString();
        })
        .catch((err) => {
          tennisAuditState.atpSourceStatus = 'ERROR';
          recordError(ESPN_ATP_SCOREBOARD_URL, err.message);
        })
    );
  }

  if (shouldFetchWta) {
    fetchPromises.push(
      fetch(ESPN_WTA_SCOREBOARD_URL)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
          const json = await res.json();
          wtaEvents = json.events || [];
          tennisAuditState.wtaSourceStatus = 'OPERATIONAL';
          tennisAuditState.lastSuccessfulWtaRefresh = new Date().toISOString();
        })
        .catch((err) => {
          tennisAuditState.wtaSourceStatus = 'ERROR';
          recordError(ESPN_WTA_SCOREBOARD_URL, err.message);
        })
    );
  }

  await Promise.allSettled(fetchPromises);

  const liveUpdates: NormalizedLiveScoreUpdate[] = [];
  const processedEventIds = new Set<string>();

  const processEvents = (events: RawTennisEvent[], defaultTour: TennisTour) => {
    for (const ev of events) {
      let rawComps: RawCompetition[] = [];
      if (Array.isArray(ev.competitions)) rawComps.push(...ev.competitions);
      if (Array.isArray(ev.groupings)) {
        for (const g of ev.groupings) {
          if (Array.isArray(g.competitions)) rawComps.push(...g.competitions);
        }
      }

      for (const comp of rawComps) {
        const eventId = String(comp.id || `${ev.id}-${comp.round?.displayName || 'match'}`);
        if (processedEventIds.has(eventId)) continue;
        processedEventIds.add(eventId);

        const typeSlug = (comp.type?.slug || '').toLowerCase();
        let tour: TennisTour = defaultTour;
        if (typeSlug.includes('women')) tour = 'WTA';
        else if (typeSlug.includes('men')) tour = 'ATP';

        if (tourFilter !== 'ALL' && tour !== tourFilter) continue;

        const statusType = comp.status?.type;
        const statusName = (statusType?.name || '').toUpperCase();
        const state = (statusType?.state || '').toLowerCase();
        const completed = statusType?.completed || false;
        let detail = statusType?.shortDetail || statusType?.detail || 'Scheduled';

        let apexStatus = normalizeStatus(statusName, state, completed, detail);
        if (statusName === 'STATUS_RETIRED' || detail.toLowerCase().includes('retired')) {
          apexStatus = 'FINAL';
        } else if (statusName === 'STATUS_WALKOVER' || detail.toLowerCase().includes('walkover')) {
          apexStatus = 'FINAL';
        }

        const competitors = comp.competitors || [];
        const compA = competitors[0];
        const compB = competitors[1];

        const isUpcoming = apexStatus === 'UPCOMING' || apexStatus === 'POSTPONED' || apexStatus === 'CANCELLED';
        const linesA = compA?.linescores || [];
        const linesB = compB?.linescores || [];
        const maxSets = Math.max(linesA.length, linesB.length);

        const setScores: TennisSetScore[] = [];
        let setsWonA = 0;
        let setsWonB = 0;

        if (!isUpcoming && maxSets > 0) {
          for (let i = 0; i < maxSets; i++) {
            const setA = linesA[i];
            const setB = linesB[i];
            const scoreA = typeof setA?.value === 'number' ? setA.value : 0;
            const scoreB = typeof setB?.value === 'number' ? setB.value : 0;
            if (setA?.winner === true || scoreA > scoreB) setsWonA++;
            else if (setB?.winner === true || scoreB > scoreA) setsWonB++;

            setScores.push({
              setNumber: i + 1,
              scoreA,
              scoreB,
              tiebreakA: typeof setA?.tiebreak === 'number' ? setA.tiebreak : null,
              tiebreakB: typeof setB?.tiebreak === 'number' ? setB.tiebreak : null,
            });
          }
        }

        let winner: 'A' | 'B' | null = null;
        if (apexStatus === 'FINAL') {
          if (compA?.winner === true) winner = 'A';
          else if (compB?.winner === true) winner = 'B';
          else if (setsWonA > setsWonB) winner = 'A';
          else if (setsWonB > setsWonA) winner = 'B';
        }

        let currentSet: number | null = null;
        if (apexStatus === 'LIVE') {
          currentSet = typeof comp.status?.period === 'number' && comp.status.period > 0
            ? comp.status.period
            : Math.max(1, setScores.length);
        } else if (apexStatus === 'SUSPENDED') {
          currentSet = typeof comp.status?.period === 'number' && comp.status.period > 0
            ? comp.status.period
            : (setScores.length > 0 ? setScores.length : null);
        }

        liveUpdates.push({
          eventId,
          sport: 'TENNIS',
          tour,
          status: apexStatus,
          statusDetail: detail,
          awayScore: isUpcoming ? null : setsWonA,
          homeScore: isUpcoming ? null : setsWonB,
          setsWonA: isUpcoming ? null : setsWonA,
          setsWonB: isUpcoming ? null : setsWonB,
          setScores: setScores.length > 0 ? setScores : null,
          currentSet,
          winner,
          lastVerifiedAt,
        });
      }
    }
  };

  processEvents(atpEvents, 'ATP');
  processEvents(wtaEvents, 'WTA');

  const liveCount = liveUpdates.filter((g) => g.status === 'LIVE').length;
  const durationMs = Date.now() - startTime;

  tennisAuditState.lastLiveScoreFetch = {
    timestamp: lastVerifiedAt,
    gamesUpdated: liveUpdates.length,
    liveCount,
    durationMs,
  };

  return {
    games: liveUpdates,
    count: liveUpdates.length,
    liveCount,
    lastVerifiedAt,
  };
}
