import { MlbPitcherKAdvancedContextV1, NormalizedPlayerPropQuote } from '../types';

const MLB_API = 'https://statsapi.mlb.com/api/v1';
const SAVANT_CSV = 'https://baseballsavant.mlb.com/statcast_search/csv';
const CACHE_TTL_MS = 30 * 60 * 1000;

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ApexPicks-MLB-K-V3/1.0', Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string, timeoutMs = 10000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ApexPicks-MLB-K-V3/1.0', Accept: 'text/csv,*/*' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.length)) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((x) => x.trim());
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function chicagoSlateDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function parseWindMph(wind: unknown): number | null {
  if (typeof wind !== 'string') return null;
  const m = wind.match(/(\d+(?:\.\d+)?)\s*mph/i);
  return m ? Number(m[1]) : null;
}

interface CacheEntry<T> { value: T; expires: number }

export class MlbPitcherKContextService {
  private contextCache = new Map<string, CacheEntry<MlbPitcherKAdvancedContextV1>>();
  private rosterCache = new Map<number, CacheEntry<any[]>>();
  private teamsCache = new Map<number, CacheEntry<any[]>>();

  private async playersForSeason(season: number): Promise<any[]> {
    const cached = this.rosterCache.get(season);
    if (cached && cached.expires > Date.now()) return cached.value;
    const raw = await fetchJson(`${MLB_API}/sports/1/players?season=${season}&hydrate=currentTeam`);
    const value = Array.isArray(raw?.people) ? raw.people : [];
    this.rosterCache.set(season, { value, expires: Date.now() + 12 * 60 * 60 * 1000 });
    return value;
  }

  private async teamsForSeason(season: number): Promise<any[]> {
    const cached = this.teamsCache.get(season);
    if (cached && cached.expires > Date.now()) return cached.value;
    const raw = await fetchJson(`${MLB_API}/teams?sportId=1&season=${season}`);
    const value = Array.isArray(raw?.teams) ? raw.teams : [];
    this.teamsCache.set(season, { value, expires: Date.now() + 12 * 60 * 60 * 1000 });
    return value;
  }

  private async resolvePlayerId(name: string, team: string, season: number): Promise<number | null> {
    const players = await this.playersForSeason(season);
    const target = norm(name);
    const exact = players.filter((p) => norm(p.fullName ?? '') === target);
    if (exact.length === 1) return finite(exact[0].id);
    if (exact.length > 1) {
      const teamNorm = norm(team);
      const onTeam = exact.filter((p) => {
        const candidates = [p.currentTeam?.name, p.currentTeam?.teamName, p.currentTeam?.abbreviation].filter(Boolean).map(norm);
        return candidates.some((x) => x === teamNorm || x.includes(teamNorm) || teamNorm.includes(x));
      });
      if (onTeam.length === 1) return finite(onTeam[0].id);
    }
    return null;
  }

  private async resolveTeamId(name: string, season: number): Promise<number | null> {
    const teams = await this.teamsForSeason(season);
    const target = norm(name);
    const scored = teams.map((team) => {
      const candidates = [team.name, team.teamName, team.clubName, team.shortName, team.abbreviation, team.fileCode]
        .filter(Boolean)
        .map((x: string) => norm(x));
      const exact = candidates.some((x: string) => x === target);
      const partial = candidates.some((x: string) => x.length > 3 && (x.includes(target) || target.includes(x)));
      return { id: finite(team.id), score: exact ? 2 : partial ? 1 : 0 };
    }).filter((x) => x.id !== null && x.score > 0).sort((a, b) => b.score - a.score);
    return scored.length && (scored.length === 1 || scored[0].score > scored[1].score) ? scored[0].id : null;
  }

  private async fetchOfficialPitcherWorkload(playerId: number, season: number, asOf: Date): Promise<MlbPitcherKAdvancedContextV1['officialWorkloadGames']> {
    const raw = await fetchJson(`${MLB_API}/people/${playerId}/stats?stats=gameLog&group=pitching&season=${season}`);
    const splits = raw?.stats?.[0]?.splits ?? [];
    const asOfMs = asOf.getTime();
    const rows = splits.map((split: any) => {
      const stat = split?.stat ?? {};
      const gameDate = split?.date ?? split?.game?.gameDate ?? null;
      const strikeouts = finite(stat?.strikeOuts ?? stat?.strikeouts);
      const battersFaced = finite(stat?.battersFaced);
      const inningsText = stat?.inningsPitched;
      let innings: number | null = null;
      if (inningsText !== undefined && inningsText !== null) {
        const [wholeText, fracText = '0'] = String(inningsText).split('.');
        const whole = Number(wholeText);
        const frac = Number(fracText);
        if (Number.isFinite(whole) && Number.isFinite(frac) && frac >= 0 && frac <= 2) innings = whole + frac / 3;
      }
      const pitches = finite(stat?.numberOfPitches ?? stat?.pitchesThrown);
      return { gameDate, strikeouts, battersFaced, innings, pitches };
    }).filter((row: any) =>
      typeof row.gameDate === 'string' &&
      Date.parse(row.gameDate) < asOfMs &&
      row.strikeouts !== null &&
      row.battersFaced !== null &&
      row.battersFaced > 0
    ).sort((a: any, b: any) => Date.parse(b.gameDate) - Date.parse(a.gameDate)).slice(0, 30);
    return rows.map((row: any) => Object.freeze({
      gameDate: row.gameDate,
      strikeouts: row.strikeouts,
      battersFaced: row.battersFaced,
      innings: row.innings,
      pitches: row.pitches,
    }));
  }

  private async fetchOpponentKRate(teamId: number, season: number, asOf: Date): Promise<{ rate: number | null; pa: number | null }> {
    // Use only team batting data from dates strictly before the prediction date.
    // A full-season aggregate is not point-in-time safe for historical reconstruction.
    const end = new Date(asOf.getTime() - 24 * 60 * 60 * 1000);
    const startDate = `${season}-01-01`;
    const endDate = isoDate(end);
    const raw = await fetchJson(`${MLB_API}/teams/${teamId}/stats?stats=byDateRange&group=hitting&startDate=${startDate}&endDate=${endDate}`);
    const stat = raw?.stats?.[0]?.splits?.[0]?.stat ?? null;
    const k = finite(stat?.strikeOuts ?? stat?.strikeouts);
    const pa = finite(stat?.plateAppearances);
    return { rate: k !== null && pa !== null && pa > 0 ? k / pa : null, pa };
  }

  private async fetchStatcast(playerId: number, asOf: Date): Promise<Partial<MlbPitcherKAdvancedContextV1>> {
    // Exclude the current calendar day so a pregame evaluation cannot accidentally ingest same-day pitches.
    const end = new Date(asOf.getTime() - 24 * 60 * 60 * 1000);
    const start = new Date(end.getTime() - 34 * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      all: 'true',
      type: 'details',
      player_type: 'pitcher',
      game_date_gt: isoDate(start),
      game_date_lt: isoDate(end),
      sort_col: 'game_date',
      sort_order: 'desc',
      min_pitches: '0',
      min_results: '0',
    });
    params.append('pitchers_lookup[]', String(playerId));
    const text = await fetchText(`${SAVANT_CSV}?${params.toString()}`);
    if (!text) return {};
    const rows = parseCsv(text).filter((r) => r.game_date && r.pitch_type);
    if (!rows.length) return {};

    let misses = 0;
    let called = 0;
    let total = 0;
    const pitchCounts = new Map<string, number>();
    const velocities: Array<{ date: string; speed: number; pitchType: string }> = [];
    let handedness: 'L' | 'R' | null = null;

    for (const row of rows) {
      total++;
      const desc = row.description;
      if (['swinging_strike', 'swinging_strike_blocked', 'missed_bunt'].includes(desc)) misses++;
      if (desc === 'called_strike') called++;
      pitchCounts.set(row.pitch_type, (pitchCounts.get(row.pitch_type) ?? 0) + 1);
      const speed = finite(row.release_speed);
      if (speed !== null) velocities.push({ date: row.game_date, speed, pitchType: row.pitch_type });
      if (!handedness && (row.p_throws === 'L' || row.p_throws === 'R')) handedness = row.p_throws;
    }

    const hardFastballs = new Set(['FF', 'SI', 'FC']);
    const fastballs = velocities.filter((x) => hardFastballs.has(x.pitchType));
    const avgFastball = fastballs.length ? fastballs.reduce((s, x) => s + x.speed, 0) / fastballs.length : null;
    const cutoffRecent = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000).getTime();
    const cutoffPrior = new Date(end.getTime() - 21 * 24 * 60 * 60 * 1000).getTime();
    const recent = fastballs.filter((x) => Date.parse(x.date) >= cutoffRecent);
    const prior = fastballs.filter((x) => Date.parse(x.date) >= cutoffPrior && Date.parse(x.date) < cutoffRecent);
    const recentAvg = recent.length >= 10 ? recent.reduce((s, x) => s + x.speed, 0) / recent.length : null;
    const priorAvg = prior.length >= 10 ? prior.reduce((s, x) => s + x.speed, 0) / prior.length : null;
    const velocityDelta = recentAvg !== null && priorAvg !== null ? recentAvg - priorAvg : null;
    const dominant = total > 0 ? Math.max(...pitchCounts.values()) / total : null;
    const distinctDates = [...new Set(rows.map((r) => r.game_date))].sort().reverse();
    const lastDate = distinctDates[0] ? Date.parse(`${distinctDates[0]}T12:00:00Z`) : NaN;
    const daysRest = Number.isFinite(lastDate) ? Math.max(0, Math.floor((asOf.getTime() - lastDate) / 86400000)) : null;

    return {
      pitcherHandedness: handedness,
      recentSwStrRate: total ? misses / total : null,
      recentCswRate: total ? (misses + called) / total : null,
      averageFastballVelocityMph: avgFastball,
      velocityDeltaMph: velocityDelta,
      dominantPitchShare: dominant,
      daysRest,
    };
  }

  private async fetchGameEnvironment(quote: NormalizedPlayerPropQuote, asOf: Date): Promise<Partial<MlbPitcherKAdvancedContextV1>> {
    if (!quote.eventStartTime) return {};
    const eventStartMs = Date.parse(quote.eventStartTime);
    if (!Number.isFinite(eventStartMs) || eventStartMs <= asOf.getTime()) return {};
    // Live game feeds are safe for current pregame evaluation, but they are NOT an as-of archive.
    // Refuse to use today's fetched feed to reconstruct weather/umpire context for old predictions.
    if (Math.abs(Date.now() - asOf.getTime()) > 15 * 60 * 1000) return {};
    const date = chicagoSlateDate(quote.eventStartTime);
    const schedule = await fetchJson(`${MLB_API}/schedule?sportId=1&date=${date}&hydrate=probablePitcher,venue`);
    const games = schedule?.dates?.flatMap((d: any) => d.games ?? []) ?? [];
    const team = norm(quote.verifiedTeam);
    const opponent = norm(quote.verifiedOpponent);
    const game = games.find((g: any) => {
      const home = norm(g.teams?.home?.team?.name ?? '');
      const away = norm(g.teams?.away?.team?.name ?? '');
      return [home, away].some((x) => x === team || x.includes(team) || team.includes(x)) &&
        [home, away].some((x) => x === opponent || x.includes(opponent) || opponent.includes(x));
    });
    if (!game?.gamePk) return {};

    const feed = await fetchJson(`https://statsapi.mlb.com/api/v1.1/game/${game.gamePk}/feed/live`);
    const weather = feed?.gameData?.weather ?? game.weather ?? null;
    const officials = feed?.liveData?.boxscore?.officials ?? [];
    const homePlate = officials.find((o: any) => String(o.officialType ?? '').toLowerCase().includes('home plate'));
    return {
      venueName: feed?.gameData?.venue?.name ?? game.venue?.name ?? null,
      temperatureF: finite(weather?.temp),
      windMph: parseWindMph(weather?.wind),
      homePlateUmpire: homePlate?.official?.fullName ?? null,
    };
  }

  async enrichQuote(quote: NormalizedPlayerPropQuote, asOf: Date = new Date()): Promise<NormalizedPlayerPropQuote> {
    if (quote.sport !== 'MLB' || quote.providerMarketKey !== 'pitcher_strikeouts') return quote;
    const season = Number((quote.eventStartTime ?? asOf.toISOString()).slice(0, 4)) || asOf.getUTCFullYear();
    const cacheKey = `${quote.playerDisplayName}|${quote.verifiedTeam}|${quote.verifiedOpponent}|${season}|${isoDate(asOf)}`;
    const cached = this.contextCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return { ...quote, mlbPitcherKContext: cached.value };

    const observedAt = asOf.toISOString();
    const warnings: string[] = [];
    const provenance: MlbPitcherKAdvancedContextV1['provenance'][number][] = [];
    const mlbPlayerId = await this.resolvePlayerId(quote.playerDisplayName, quote.verifiedTeam, season);
    const opponentMlbTeamId = await this.resolveTeamId(quote.verifiedOpponent, season);

    const [officialWorkloadGames, opp, statcast, env] = await Promise.all([
      mlbPlayerId ? this.fetchOfficialPitcherWorkload(mlbPlayerId, season, asOf) : Promise.resolve([] as MlbPitcherKAdvancedContextV1['officialWorkloadGames']),
      opponentMlbTeamId ? this.fetchOpponentKRate(opponentMlbTeamId, season, asOf) : Promise.resolve({ rate: null, pa: null }),
      mlbPlayerId ? this.fetchStatcast(mlbPlayerId, asOf) : Promise.resolve({} as Partial<MlbPitcherKAdvancedContextV1>),
      this.fetchGameEnvironment(quote, asOf),
    ]);

    if (!mlbPlayerId) warnings.push('MLB_PLAYER_ID_UNRESOLVED');
    if (officialWorkloadGames.length < 5) warnings.push('OFFICIAL_MLB_WORKLOAD_HISTORY_LIMITED');
    if (!opponentMlbTeamId) warnings.push('MLB_OPPONENT_ID_UNRESOLVED');
    if (opp.rate === null) warnings.push('OPPONENT_K_RATE_UNAVAILABLE');
    if (statcast.recentSwStrRate === undefined) warnings.push('STATCAST_CONTEXT_UNAVAILABLE');
    const gameEnvironmentAvailable = env.venueName != null || env.temperatureF != null || env.windMph != null || env.homePlateUmpire != null;
    if (!gameEnvironmentAvailable) warnings.push('GAME_ENVIRONMENT_UNAVAILABLE');
    // No trustworthy automatic park/umpire K factor is used until a validated source is connected.
    warnings.push('PARK_FACTOR_NOT_CONNECTED');
    warnings.push('UMPIRE_K_FACTOR_NOT_CONNECTED');

    const addProv = (field: string, value: unknown, source: string) => {
      if (value !== null && value !== undefined) provenance.push({ field, source, observedAt, authentic: true });
    };
    if (officialWorkloadGames.length) provenance.push({ field: 'officialWorkloadGames', source: 'MLB Stats API pitcher game log', observedAt, authentic: true });
    addProv('opponentStrikeoutRate', opp.rate, 'MLB Stats API team hitting stats through prior date');
    addProv('opponentPlateAppearances', opp.pa, 'MLB Stats API team hitting stats through prior date');
    addProv('recentSwStrRate', statcast.recentSwStrRate, 'MLB Baseball Savant Statcast Search');
    addProv('recentCswRate', statcast.recentCswRate, 'MLB Baseball Savant Statcast Search');
    addProv('averageFastballVelocityMph', statcast.averageFastballVelocityMph, 'MLB Baseball Savant Statcast Search');
    addProv('velocityDeltaMph', statcast.velocityDeltaMph, 'MLB Baseball Savant Statcast Search');
    addProv('dominantPitchShare', statcast.dominantPitchShare, 'MLB Baseball Savant Statcast Search');
    addProv('daysRest', statcast.daysRest, 'MLB Baseball Savant Statcast Search');
    addProv('venueName', env.venueName, 'MLB Stats API game feed');
    addProv('temperatureF', env.temperatureF, 'MLB Stats API game feed');
    addProv('windMph', env.windMph, 'MLB Stats API game feed');
    addProv('homePlateUmpire', env.homePlateUmpire, 'MLB Stats API game feed');

    const sourceStatus: MlbPitcherKAdvancedContextV1['sourceStatus'] = {
      mlbStats: officialWorkloadGames.length > 0 || opp.rate !== null ? 'AVAILABLE' : 'UNAVAILABLE',
      statcast: statcast.recentSwStrRate !== undefined ? 'AVAILABLE' : 'UNAVAILABLE',
      gameEnvironment: gameEnvironmentAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
    };

    const context: MlbPitcherKAdvancedContextV1 = Object.freeze({
      contextVersion: 'APEX_MLB_K_CONTEXT_V1',
      observedAt,
      sourceStatus,
      mlbPlayerId,
      pitcherHandedness: statcast.pitcherHandedness ?? null,
      opponentMlbTeamId,
      opponentStrikeoutRate: opp.rate === null ? null : Number(opp.rate.toFixed(6)),
      opponentPlateAppearances: opp.pa,
      officialWorkloadGames: Object.freeze(officialWorkloadGames.map((g) => Object.freeze({ ...g }))),
      recentSwStrRate: statcast.recentSwStrRate === undefined || statcast.recentSwStrRate === null ? null : Number(statcast.recentSwStrRate.toFixed(6)),
      recentCswRate: statcast.recentCswRate === undefined || statcast.recentCswRate === null ? null : Number(statcast.recentCswRate.toFixed(6)),
      averageFastballVelocityMph: statcast.averageFastballVelocityMph === undefined || statcast.averageFastballVelocityMph === null ? null : Number(statcast.averageFastballVelocityMph.toFixed(3)),
      velocityDeltaMph: statcast.velocityDeltaMph === undefined || statcast.velocityDeltaMph === null ? null : Number(statcast.velocityDeltaMph.toFixed(3)),
      dominantPitchShare: statcast.dominantPitchShare === undefined || statcast.dominantPitchShare === null ? null : Number(statcast.dominantPitchShare.toFixed(6)),
      daysRest: statcast.daysRest ?? null,
      venueName: env.venueName ?? null,
      temperatureF: env.temperatureF ?? null,
      windMph: env.windMph ?? null,
      homePlateUmpire: env.homePlateUmpire ?? null,
      parkFactor: null,
      umpireStrikeoutFactor: null,
      provenance: Object.freeze(provenance.map((p) => Object.freeze({ ...p }))),
      warnings: Array.from(new Set(warnings)).sort(),
    });

    this.contextCache.set(cacheKey, { value: context, expires: Date.now() + CACHE_TTL_MS });
    return { ...quote, mlbPitcherKContext: context };
  }
}

export const mlbPitcherKContextService = new MlbPitcherKContextService();
