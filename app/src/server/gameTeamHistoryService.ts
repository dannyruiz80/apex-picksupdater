import { ApexSport, NormalizedApexGame, SampleReliabilityTier } from '../types';

export interface TeamGameHistoryRecord {
  eventId: string;
  startTime: string;
  opponentId: string | null;
  opponentName: string;
  venueRole: 'HOME' | 'AWAY' | 'NEUTRAL';
  pointsFor: number;
  pointsAgainst: number;
  margin: number;
  total: number;
}

export interface TeamHistorySummary {
  teamId: string;
  teamName: string;
  sport: ApexSport;
  asOf: string;
  source: 'ESPN_TEAM_SCHEDULE_HISTORY';
  retrievedAt: string;
  pointInTimeValid: boolean;
  status: 'AVAILABLE' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
  sampleCount: number;
  reliabilityTier: SampleReliabilityTier;
  weightedPointsFor: number | null;
  weightedPointsAgainst: number | null;
  weightedMargin: number | null;
  weightedTotal: number | null;
  marginStdDev: number | null;
  totalStdDev: number | null;
  venuePointsFor: number | null;
  venuePointsAgainst: number | null;
  venueSampleCount: number;
  latestCompletedGameAt: string | null;
  records: TeamGameHistoryRecord[];
  warnings: string[];
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_MODEL_GAMES = 30;
const MIN_MODEL_GAMES = 6;

interface CacheEntry { data: any; fetchedAt: number; }
const rawCache = new Map<string, CacheEntry>();

function scoreValue(raw: any): number | null {
  const candidate = raw?.value ?? raw?.displayValue ?? raw;
  const n = Number(candidate);
  return Number.isFinite(n) ? n : null;
}

function weightedMean(values: number[], decay = 0.94): number | null {
  if (!values.length) return null;
  let weighted = 0;
  let weightTotal = 0;
  for (let i = 0; i < values.length; i++) {
    const w = Math.pow(decay, i);
    weighted += values[i] * w;
    weightTotal += w;
  }
  return weightTotal > 0 ? weighted / weightTotal : null;
}

function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function reliabilityTier(sampleCount: number): SampleReliabilityTier {
  if (sampleCount >= 20) return 'STRONG';
  if (sampleCount >= 12) return 'MODERATE';
  if (sampleCount >= 6) return 'LIMITED';
  return 'VERY_LIMITED';
}

export function resolveSoccerLeagueCode(game: NormalizedApexGame): string | null {
  const raw = `${game.competition || ''} ${game.league || ''}`.toLowerCase();
  if (raw.includes('premier') || raw.includes('epl')) return 'eng.1';
  if (raw.includes('laliga') || raw.includes('la liga') || raw.includes('spanish')) return 'esp.1';
  if (raw.includes('serie a') || raw.includes('italian')) return 'ita.1';
  if (raw.includes('bundesliga') || raw.includes('german')) return 'ger.1';
  if (raw.includes('ligue 1') || raw.includes('french')) return 'fra.1';
  if (raw.includes('major league') || raw.includes('mls')) return 'usa.1';
  if (raw.includes('liga mx') || raw.includes('mexico')) return 'mex.1';
  if (raw.includes('champions league')) return 'uefa.champions';
  if (raw.includes('europa')) return 'uefa.europa';
  return null;
}

function espnPath(game: NormalizedApexGame): string | null {
  switch (game.sport) {
    case 'MLB': return 'baseball/mlb';
    case 'NFL': return 'football/nfl';
    case 'NBA': return 'basketball/nba';
    case 'WNBA': return 'basketball/wnba';
    case 'NHL': return 'hockey/nhl';
    case 'SOCCER': {
      const league = resolveSoccerLeagueCode(game);
      return league ? `soccer/${league}` : null;
    }
    default: return null;
  }
}

function espnSeasonForDate(sport: ApexSport, iso: string): number {
  const d = new Date(iso);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  if ((sport === 'NBA' || sport === 'NHL') && month >= 9) return year + 1;
  return year;
}

async function fetchJson(url: string): Promise<any> {
  const cached = rawCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ApexPicks/1.11 GameModel', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`ESPN team schedule HTTP ${res.status}`);
    const data = await res.json();
    rawCache.set(url, { data, fetchedAt: Date.now() });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export function parseEspnTeamSchedule(
  raw: any,
  teamId: string,
  asOfIso: string,
): TeamGameHistoryRecord[] {
  const asOfMs = Date.parse(asOfIso);
  if (!Number.isFinite(asOfMs)) return [];
  const events = Array.isArray(raw?.events) ? raw.events : [];
  const records: TeamGameHistoryRecord[] = [];

  for (const ev of events) {
    const startTime = String(ev?.date || ev?.competitions?.[0]?.date || '');
    const startMs = Date.parse(startTime);
    if (!Number.isFinite(startMs) || startMs >= asOfMs) continue;

    const comp = ev?.competitions?.[0] || {};
    const completed = comp?.status?.type?.completed === true || String(comp?.status?.type?.state || '').toLowerCase() === 'post';
    if (!completed) continue;

    const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
    const teamComp = competitors.find((c: any) => String(c?.team?.id ?? c?.id ?? '') === String(teamId));
    if (!teamComp) continue;
    const oppComp = competitors.find((c: any) => c !== teamComp);
    if (!oppComp) continue;

    const pointsFor = scoreValue(teamComp?.score);
    const pointsAgainst = scoreValue(oppComp?.score);
    if (pointsFor === null || pointsAgainst === null) continue;

    const roleRaw = String(teamComp?.homeAway || '').toLowerCase();
    const venueRole: 'HOME' | 'AWAY' | 'NEUTRAL' = comp?.neutralSite
      ? 'NEUTRAL'
      : roleRaw === 'home' ? 'HOME' : roleRaw === 'away' ? 'AWAY' : 'NEUTRAL';

    records.push({
      eventId: String(ev?.id || `${startTime}-${teamId}`),
      startTime,
      opponentId: oppComp?.team?.id ? String(oppComp.team.id) : oppComp?.id ? String(oppComp.id) : null,
      opponentName: String(oppComp?.team?.displayName || oppComp?.team?.name || 'Opponent'),
      venueRole,
      pointsFor,
      pointsAgainst,
      margin: pointsFor - pointsAgainst,
      total: pointsFor + pointsAgainst,
    });
  }

  return records.sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
}

export function summarizeTeamHistory(params: {
  sport: ApexSport;
  teamId: string;
  teamName: string;
  asOf: string;
  records: TeamGameHistoryRecord[];
  targetVenueRole: 'HOME' | 'AWAY';
  retrievedAt?: string;
  warnings?: string[];
}): TeamHistorySummary {
  const records = params.records
    .filter((r) => Date.parse(r.startTime) < Date.parse(params.asOf))
    .slice(0, MAX_MODEL_GAMES);
  const venueRecords = records.filter((r) => r.venueRole === params.targetVenueRole);
  const sampleCount = records.length;
  const latest = records[0]?.startTime ?? null;
  const pointInTimeValid = records.every((r) => Date.parse(r.startTime) < Date.parse(params.asOf));

  return {
    teamId: params.teamId,
    teamName: params.teamName,
    sport: params.sport,
    asOf: params.asOf,
    source: 'ESPN_TEAM_SCHEDULE_HISTORY',
    retrievedAt: params.retrievedAt ?? new Date().toISOString(),
    pointInTimeValid,
    status: sampleCount >= MIN_MODEL_GAMES && pointInTimeValid ? 'AVAILABLE' : sampleCount > 0 ? 'INSUFFICIENT_DATA' : 'UNAVAILABLE',
    sampleCount,
    reliabilityTier: reliabilityTier(sampleCount),
    weightedPointsFor: weightedMean(records.map((r) => r.pointsFor)),
    weightedPointsAgainst: weightedMean(records.map((r) => r.pointsAgainst)),
    weightedMargin: weightedMean(records.map((r) => r.margin)),
    weightedTotal: weightedMean(records.map((r) => r.total)),
    marginStdDev: stdDev(records.map((r) => r.margin)),
    totalStdDev: stdDev(records.map((r) => r.total)),
    venuePointsFor: venueRecords.length >= 4 ? weightedMean(venueRecords.map((r) => r.pointsFor)) : null,
    venuePointsAgainst: venueRecords.length >= 4 ? weightedMean(venueRecords.map((r) => r.pointsAgainst)) : null,
    venueSampleCount: venueRecords.length,
    latestCompletedGameAt: latest,
    records,
    warnings: params.warnings ?? [],
  };
}

export class GameTeamHistoryService {
  async getTeamHistory(game: NormalizedApexGame, side: 'HOME' | 'AWAY'): Promise<TeamHistorySummary> {
    const teamId = side === 'HOME' ? game.homeTeamId : game.awayTeamId;
    const teamName = side === 'HOME' ? game.homeTeam : game.awayTeam;
    const targetVenueRole = side;
    const asOf = game.startTime;
    const warnings: string[] = [];

    if (!teamId || !teamName || !asOf || game.sport === 'TENNIS') {
      return summarizeTeamHistory({
        sport: game.sport,
        teamId: teamId || 'UNKNOWN',
        teamName: teamName || 'Unknown Team',
        asOf: asOf || new Date().toISOString(),
        records: [],
        targetVenueRole,
        warnings: ['Team identity or event start time is unavailable for independent game modeling.'],
      });
    }

    const path = espnPath(game);
    if (!path) {
      return summarizeTeamHistory({
        sport: game.sport,
        teamId,
        teamName,
        asOf,
        records: [],
        targetVenueRole,
        warnings: ['No verified ESPN team-history path is configured for this competition.'],
      });
    }

    const currentSeason = espnSeasonForDate(game.sport, asOf);
    const seasons = [currentSeason, currentSeason - 1];
    const merged = new Map<string, TeamGameHistoryRecord>();

    for (const season of seasons) {
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${encodeURIComponent(teamId)}/schedule?season=${season}`;
        const raw = await fetchJson(url);
        for (const record of parseEspnTeamSchedule(raw, teamId, asOf)) merged.set(record.eventId, record);
        if (merged.size >= 20) break;
      } catch (err: any) {
        warnings.push(`ESPN ${season} team history unavailable: ${err?.message || String(err)}`);
      }
    }

    return summarizeTeamHistory({
      sport: game.sport,
      teamId,
      teamName,
      asOf,
      records: [...merged.values()].sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime)),
      targetVenueRole,
      warnings,
    });
  }
}

export const gameTeamHistoryService = new GameTeamHistoryService();
