import crypto from 'crypto';
import { MlbPitcherKFeatureVectorV3 } from '../types';

const MLB_API = 'https://statsapi.mlb.com/api/v1';

function finite(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const responseCache = new Map<string, { expiresAt: number; value: any | null }>();

async function fetchJson(url: string, timeoutMs = 12000, cacheTtlMs = 0): Promise<any | null> {
  if (cacheTtlMs > 0) {
    const cached = responseCache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const value = await res.json();
    if (cacheTtlMs > 0) responseCache.set(url, { expiresAt: Date.now() + cacheTtlMs, value });
    return value;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function inningsToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const [wholeText, fracText = '0'] = String(value).split('.');
  const whole = Number(wholeText);
  const frac = Number(fracText);
  if (!Number.isFinite(whole) || !Number.isFinite(frac) || frac < 0 || frac > 2) return null;
  return whole + frac / 3;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function variance(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  return values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1);
}

function weightedRecent(values: number[]): number | null {
  if (!values.length) return null;
  let weighted = 0;
  let weights = 0;
  values.forEach((value, index) => {
    const w = Math.pow(0.86, index);
    weighted += value * w;
    weights += w;
  });
  return weights ? weighted / weights : null;
}

function subsetRate(rows: WorkloadRow[], count: number): number | null {
  const subset = rows.slice(0, count);
  const bf = subset.reduce((s, r) => s + r.battersFaced, 0);
  return bf > 0 ? subset.reduce((s, r) => s + r.strikeouts, 0) / bf : null;
}

type WorkloadRow = {
  gameDate: string;
  season: number;
  strikeouts: number;
  battersFaced: number;
  innings: number | null;
};

export interface PublicStarterFeatureInput {
  eventId: string;
  eventStartTime: string;
  season: number;
  pitcherId: number;
  pitcherName: string;
  teamId: number;
  team: string;
  opponentTeamId: number;
  opponent: string;
  teamVenueRole: 'HOME' | 'AWAY';
  asOf: string;
}

export interface PublicMlbGameStarter {
  eventId: string;
  eventStartTime: string;
  season: number;
  status: string;
  teamVenueRole: 'HOME' | 'AWAY';
  pitcherId: number;
  pitcherName: string;
  teamId: number;
  team: string;
  opponentTeamId: number;
  opponent: string;
}

export class MlbPitcherKPublicDataFeatureService {
  async getScheduleStarters(date: string): Promise<PublicMlbGameStarter[]> {
    const raw = await fetchJson(`${MLB_API}/schedule?sportId=1&date=${encodeURIComponent(date)}&hydrate=probablePitcher`, 12000, 60_000);
    const games = raw?.dates?.flatMap((d: any) => d.games ?? []) ?? [];
    const rows: PublicMlbGameStarter[] = [];
    for (const game of games) {
      const eventStartTime = game.gameDate;
      const season = Number(String(eventStartTime ?? date).slice(0, 4));
      const status = String(game.status?.abstractGameState ?? game.status?.detailedState ?? 'UNKNOWN').toUpperCase();
      const home = game.teams?.home;
      const away = game.teams?.away;
      const homePitcher = home?.probablePitcher;
      const awayPitcher = away?.probablePitcher;
      if (homePitcher?.id && home?.team?.id && away?.team?.id) {
        rows.push({
          eventId: String(game.gamePk), eventStartTime, season, status, teamVenueRole: 'HOME',
          pitcherId: Number(homePitcher.id), pitcherName: String(homePitcher.fullName ?? `MLB ${homePitcher.id}`),
          teamId: Number(home.team.id), team: String(home.team.name ?? ''),
          opponentTeamId: Number(away.team.id), opponent: String(away.team.name ?? ''),
        });
      }
      if (awayPitcher?.id && away?.team?.id && home?.team?.id) {
        rows.push({
          eventId: String(game.gamePk), eventStartTime, season, status, teamVenueRole: 'AWAY',
          pitcherId: Number(awayPitcher.id), pitcherName: String(awayPitcher.fullName ?? `MLB ${awayPitcher.id}`),
          teamId: Number(away.team.id), team: String(away.team.name ?? ''),
          opponentTeamId: Number(home.team.id), opponent: String(home.team.name ?? ''),
        });
      }
    }
    return rows;
  }

  async getActualStrikeouts(eventId: string, pitcherId: number): Promise<number | null> {
    // Never grade from an in-progress box score. A partial strikeout total would create false labels.
    const statusRaw = await fetchJson(`${MLB_API}/schedule?gamePk=${encodeURIComponent(eventId)}`, 12000, 60_000);
    const game = statusRaw?.dates?.flatMap((d: any) => d.games ?? [])?.[0] ?? null;
    const state = String(game?.status?.abstractGameState ?? game?.status?.detailedState ?? '').toUpperCase();
    if (!['FINAL', 'COMPLETED'].some((x) => state.includes(x))) return null;

    const raw = await fetchJson(`${MLB_API}/game/${encodeURIComponent(eventId)}/boxscore`, 12000, 5 * 60_000);
    const key = `ID${pitcherId}`;
    const home = raw?.teams?.home?.players?.[key]?.stats?.pitching;
    const away = raw?.teams?.away?.players?.[key]?.stats?.pitching;
    return finite(home?.strikeOuts ?? home?.strikeouts ?? away?.strikeOuts ?? away?.strikeouts);
  }

  private async seasonWorkload(playerId: number, season: number, asOf: Date): Promise<WorkloadRow[]> {
    // The endpoint may contain games after historical asOf. We cache the raw season response but
    // always filter every row locally to the prediction cutoff before any feature is computed.
    const raw = await fetchJson(`${MLB_API}/people/${playerId}/stats?stats=gameLog&group=pitching&season=${season}`, 12000, 10 * 60_000);
    const splits = raw?.stats?.[0]?.splits ?? [];
    const cutoff = asOf.getTime();
    return splits.map((split: any) => {
      const stat = split?.stat ?? {};
      return {
        gameDate: String(split?.date ?? split?.game?.gameDate ?? ''),
        season,
        strikeouts: finite(stat?.strikeOuts ?? stat?.strikeouts),
        battersFaced: finite(stat?.battersFaced),
        innings: inningsToNumber(stat?.inningsPitched),
      };
    }).filter((r: any) =>
      r.gameDate && Date.parse(r.gameDate) < cutoff && r.strikeouts !== null && r.battersFaced !== null && r.battersFaced > 0
    ).map((r: any) => ({ ...r, strikeouts: r.strikeouts as number, battersFaced: r.battersFaced as number }))
      .sort((a: WorkloadRow, b: WorkloadRow) => Date.parse(b.gameDate) - Date.parse(a.gameDate));
  }

  private async workload(playerId: number, season: number, asOf: Date): Promise<WorkloadRow[]> {
    const current = await this.seasonWorkload(playerId, season, asOf);
    if (current.length >= 10) return current.slice(0, 30);

    // Opening-week models should not be forced to wait for five new-season starts. Previous-season
    // official game logs may supplement the rolling window, while the feature vector explicitly
    // records that cross-season history was used.
    const prior = await this.seasonWorkload(playerId, season - 1, asOf);
    return [...current, ...prior]
      .sort((a, b) => Date.parse(b.gameDate) - Date.parse(a.gameDate))
      .slice(0, 30);
  }

  private async opponentKRate(teamId: number, season: number, asOf: Date): Promise<number | null> {
    const prior = new Date(asOf.getTime() - 24 * 60 * 60 * 1000);
    const raw = await fetchJson(`${MLB_API}/teams/${teamId}/stats?stats=byDateRange&group=hitting&startDate=${season}-01-01&endDate=${isoDate(prior)}`, 12000, 10 * 60_000);
    const stat = raw?.stats?.[0]?.splits?.[0]?.stat ?? null;
    const k = finite(stat?.strikeOuts ?? stat?.strikeouts);
    const pa = finite(stat?.plateAppearances);
    return k !== null && pa !== null && pa > 0 ? k / pa : null;
  }

  private async handedness(playerId: number): Promise<'L' | 'R' | null> {
    const raw = await fetchJson(`${MLB_API}/people/${playerId}`, 12000, 24 * 60 * 60_000);
    const code = raw?.people?.[0]?.pitchHand?.code;
    return code === 'L' || code === 'R' ? code : null;
  }

  async buildCoreFeature(input: PublicStarterFeatureInput, canonicalLine = 5.5): Promise<MlbPitcherKFeatureVectorV3> {
    const asOf = new Date(input.asOf);
    const eventAt = Date.parse(input.eventStartTime);
    const reasons: string[] = [];
    if (!Number.isFinite(asOf.getTime()) || !Number.isFinite(eventAt) || asOf.getTime() >= eventAt) reasons.push('PUBLIC_REPLAY_ASOF_NOT_PREGAME');
    const [rows, opponentStrikeoutRate, pitcherHandedness] = await Promise.all([
      this.workload(input.pitcherId, input.season, asOf),
      this.opponentKRate(input.opponentTeamId, input.season, asOf),
      this.handedness(input.pitcherId),
    ]);
    if (rows.length < 5) reasons.push('INSUFFICIENT_OFFICIAL_MLB_WORKLOAD_HISTORY');
    const currentSeasonRows = rows.filter((r) => r.season === input.season);
    const priorSeasonRows = rows.filter((r) => r.season !== input.season);
    if (priorSeasonRows.length) reasons.push(`PRIOR_SEASON_HISTORY_USED:${priorSeasonRows.length}`);
    const bfs = rows.map((r) => r.battersFaced);
    const ips = rows.map((r) => r.innings).filter((x): x is number => x !== null);
    const ks = rows.map((r) => r.strikeouts);
    const rateRows = currentSeasonRows.length >= 5 ? currentSeasonRows : rows;
    const totalBf = rateRows.reduce((a, b) => a + b.battersFaced, 0);
    const seasonRate = totalBf > 0 ? rateRows.reduce((a, b) => a + b.strikeouts, 0) / totalBf : null;
    const expectedBattersFaced = weightedRecent(bfs);
    const expectedInnings = weightedRecent(ips);
    if (expectedBattersFaced === null || expectedBattersFaced < 10 || expectedBattersFaced > 40) reasons.push('WORKLOAD_OUT_OF_RANGE_OR_MISSING');
    if (seasonRate === null || seasonRate <= 0 || seasonRate >= 0.7) reasons.push('STRIKEOUT_RATE_OUT_OF_RANGE_OR_MISSING');
    const recent5 = mean(bfs.slice(0, 5));
    const prior5 = mean(bfs.slice(5, 10));
    const hardFailure = reasons.length > 0;
    const payload: Omit<MlbPitcherKFeatureVectorV3, 'featureVectorId'> = {
      featureVersion: 'APEX_MLB_K_FEATURES_V3',
      asOf: asOf.toISOString(),
      latestFeatureObservedAt: asOf.toISOString(),
      isPointInTimeValid: !hardFailure,
      reasonCodes: [...reasons].sort(),
      dataQuality: !hardFailure ? (opponentStrikeoutRate !== null ? 'ENRICHED' : 'CORE_VERIFIED') : 'UNAVAILABLE',
      sampleStarts: rows.length,
      workloadStarts: rows.length,
      officialBattersFacedStarts: rows.length,
      derivedBattersFacedStarts: 0,
      workloadSource: rows.length ? 'OFFICIAL_BF' : 'UNAVAILABLE',
      historySeasonsUsed: Array.from(new Set(rows.map((r) => r.season))).sort((a, b) => b - a),
      priorSeasonStartsUsed: priorSeasonRows.length,
      strikeoutRateBasis: currentSeasonRows.length >= 5 ? 'CURRENT_SEASON' : (rows.length ? 'ROLLING_MULTI_SEASON' : 'UNAVAILABLE'),
      expectedBattersFaced: expectedBattersFaced === null ? null : Number(expectedBattersFaced.toFixed(3)),
      expectedInnings: expectedInnings === null ? null : Number(expectedInnings.toFixed(3)),
      seasonStrikeoutsPerBF: seasonRate === null ? null : Number(seasonRate.toFixed(5)),
      l10StrikeoutsPerBF: subsetRate(rows, 10),
      l5StrikeoutsPerBF: subsetRate(rows, 5),
      workloadTrendBF: recent5 !== null && prior5 !== null ? Number((recent5 - prior5).toFixed(3)) : null,
      strikeoutMean: mean(ks) === null ? null : Number(mean(ks)!.toFixed(4)),
      strikeoutVariance: variance(ks) === null ? null : Number(variance(ks)!.toFixed(4)),
      opponentStrikeoutRate: opponentStrikeoutRate === null ? null : Number(opponentStrikeoutRate.toFixed(6)),
      pitcherTeamVenueRole: input.teamVenueRole,
      pitcherHandedness,
      recentSwStrRate: null,
      recentCswRate: null,
      averageFastballVelocityMph: null,
      velocityDeltaMph: null,
      dominantPitchShare: null,
      daysRest: rows[0]?.gameDate ? Math.max(0, Math.floor((asOf.getTime() - Date.parse(rows[0].gameDate)) / 86400000)) : null,
      temperatureF: null,
      windMph: null,
      parkFactor: null,
      umpireStrikeoutFactor: null,
      line: canonicalLine,
    };
    const featureVectorId = `MLBK3-PUBLIC-${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 20)}`;
    return { featureVectorId, ...payload };
  }
}

export const mlbPitcherKPublicDataFeatureService = new MlbPitcherKPublicDataFeatureService();
