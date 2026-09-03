import crypto from 'crypto';
import {
  MlbPitcherKFeatureVectorV3,
  NormalizedPlayerPropQuote,
  PlayerGameLogRecord,
} from '../types';
import { buildPointInTimeFeatureSnapshot } from './pointInTimeFeatureEngine';

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function pick(stats: Record<string, string | number>, aliases: string[]): number | null {
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(stats, key)) {
      const value = n(stats[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

function inningsToOuts(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  const text = String(v).trim();
  const [wholeText, fracText = '0'] = text.split('.');
  const whole = Number(wholeText);
  const frac = Number(fracText);
  if (!Number.isFinite(whole) || !Number.isFinite(frac) || frac < 0 || frac > 2) return null;
  return whole * 3 + frac;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function variance(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  return values.reduce((acc, x) => acc + (x - m) ** 2, 0) / (values.length - 1);
}

function ratio(sumNum: number, sumDen: number): number | null {
  return sumDen > 0 ? sumNum / sumDen : null;
}

function weightedRecent(values: number[]): number | null {
  if (!values.length) return null;
  let weighted = 0;
  let weightSum = 0;
  values.forEach((value, index) => {
    const weight = Math.pow(0.86, index);
    weighted += value * weight;
    weightSum += weight;
  });
  return weightSum > 0 ? weighted / weightSum : null;
}

interface WorkloadRow {
  gameDate: string;
  strikeouts: number;
  battersFaced: number | null;
  innings: number | null;
  bfSource: 'OFFICIAL' | 'DERIVED' | null;
}

function toWorkloadRow(game: PlayerGameLogRecord): WorkloadRow {
  const stats = game.rawStats || {};
  const strikeouts = game.statValue;
  let bf = pick(stats, ['battersFaced', 'batters_faced', 'BF', 'Batters Faced']);
  let bfSource: WorkloadRow['bfSource'] = bf !== null ? 'OFFICIAL' : null;
  const inningsRaw = stats['innings'] ?? stats['inningsPitched'] ?? stats['IP'] ?? null;
  const outs = inningsToOuts(inningsRaw);
  const innings = outs !== null ? outs / 3 : null;

  // Transparent derived opportunity count only when official BF is absent.
  // This is not labeled as official BF; it is an approximation from verified box-score components.
  if (bf === null && outs !== null) {
    const hits = pick(stats, ['hits', 'hitsAllowed', 'H']) ?? 0;
    const walks = pick(stats, ['walks', 'baseOnBalls', 'BB']) ?? 0;
    const hbp = pick(stats, ['hitByPitch', 'hitBatsmen', 'HBP']) ?? 0;
    bf = outs + hits + walks + hbp;
    bfSource = 'DERIVED';
  }

  return {
    gameDate: game.gameDate,
    strikeouts,
    battersFaced: bf,
    innings,
    bfSource,
  };
}

function subsetRate(rows: WorkloadRow[], count: number): number | null {
  const subset = rows.slice(0, count).filter((r) => r.battersFaced !== null && r.battersFaced > 0);
  return ratio(
    subset.reduce((s, r) => s + r.strikeouts, 0),
    subset.reduce((s, r) => s + (r.battersFaced ?? 0), 0)
  );
}

export function buildMlbPitcherKFeatureVectorV3(
  quote: NormalizedPlayerPropQuote,
  asOf: Date = new Date()
): MlbPitcherKFeatureVectorV3 {
  const reasons: string[] = [];
  const pit = buildPointInTimeFeatureSnapshot(quote, asOf);
  if (!pit.isValid) reasons.push(...pit.reasonCodes.map((x) => `PIT:${x}`));

  if (quote.sport !== 'MLB') reasons.push('NOT_MLB');
  if (quote.providerMarketKey !== 'pitcher_strikeouts') reasons.push('NOT_PITCHER_STRIKEOUTS');

  const stats = quote.historicalStats;
  const logs = [...(stats?.modelGameLogs ?? stats?.recentGameLogs ?? [])]
    .filter((g) => !g.isDNP && Number.isFinite(g.statValue))
    .sort((a, b) => Date.parse(b.gameDate) - Date.parse(a.gameDate));

  for (const log of logs) {
    const t = Date.parse(log.gameDate);
    if (!Number.isFinite(t) || t >= asOf.getTime()) reasons.push(`FUTURE_OR_INVALID_LOG:${log.eventId}`);
  }

  const context = quote.mlbPitcherKContext ?? null;
  if (context) {
    const observedMs = Date.parse(context.observedAt);
    if (!Number.isFinite(observedMs)) reasons.push('CONTEXT_TIMESTAMP_INVALID');
    else if (observedMs > asOf.getTime()) reasons.push('CONTEXT_FROM_FUTURE');
  }

  const officialRows: WorkloadRow[] = (context?.officialWorkloadGames ?? [])
    .filter((g) => {
      const t = Date.parse(g.gameDate);
      if (!Number.isFinite(t) || t >= asOf.getTime()) {
        reasons.push(`FUTURE_OR_INVALID_OFFICIAL_WORKLOAD:${g.gameDate}`);
        return false;
      }
      return Number.isFinite(g.strikeouts) && Number.isFinite(g.battersFaced) && g.battersFaced > 0;
    })
    .map((g) => ({
      gameDate: g.gameDate,
      strikeouts: g.strikeouts,
      battersFaced: g.battersFaced,
      innings: g.innings,
      bfSource: 'OFFICIAL' as const,
    }))
    .sort((a, b) => Date.parse(b.gameDate) - Date.parse(a.gameDate));

  // Prefer official MLB batters-faced history when available. Otherwise use the verified
  // historical feed and transparently mark any BF reconstructed from box-score components.
  const rows = officialRows.length >= 5 ? officialRows : logs.map(toWorkloadRow);
  const workloadRows = rows.filter((r) => r.battersFaced !== null && (r.battersFaced ?? 0) > 0);
  const officialBattersFacedStarts = workloadRows.filter((r) => r.bfSource === 'OFFICIAL').length;
  const derivedBattersFacedStarts = workloadRows.filter((r) => r.bfSource === 'DERIVED').length;
  const workloadSource: MlbPitcherKFeatureVectorV3['workloadSource'] = workloadRows.length === 0
    ? 'UNAVAILABLE'
    : officialBattersFacedStarts === workloadRows.length
      ? 'OFFICIAL_BF'
      : derivedBattersFacedStarts === workloadRows.length
        ? 'DERIVED'
        : 'MIXED';
  if (derivedBattersFacedStarts > 0) reasons.push(`DERIVED_BF_USED:${derivedBattersFacedStarts}`);

  const strikeoutValues = rows.map((r) => r.strikeouts);
  const bfValues = workloadRows.map((r) => r.battersFaced!);
  const ipValues = workloadRows.map((r) => r.innings).filter((x): x is number => x !== null);

  const expectedBattersFaced = weightedRecent(bfValues);
  const expectedInnings = weightedRecent(ipValues);
  const seasonStrikeoutsPerBF = ratio(
    workloadRows.reduce((s, r) => s + r.strikeouts, 0),
    workloadRows.reduce((s, r) => s + (r.battersFaced ?? 0), 0)
  );
  const l10StrikeoutsPerBF = subsetRate(workloadRows, 10);
  const l5StrikeoutsPerBF = subsetRate(workloadRows, 5);

  const recent5BF = mean(bfValues.slice(0, 5));
  const prior5BF = mean(bfValues.slice(5, 10));
  const workloadTrendBF = recent5BF !== null && prior5BF !== null ? recent5BF - prior5BF : null;

  const coreAvailable =
    rows.length >= 5 &&
    workloadRows.length >= 5 &&
    expectedBattersFaced !== null &&
    seasonStrikeoutsPerBF !== null;

  if (!coreAvailable) reasons.push('INSUFFICIENT_VERIFIED_WORKLOAD_HISTORY');
  if (expectedBattersFaced !== null && (expectedBattersFaced < 10 || expectedBattersFaced > 40)) {
    reasons.push('WORKLOAD_OUT_OF_RANGE');
  }
  if (seasonStrikeoutsPerBF !== null && (seasonStrikeoutsPerBF <= 0 || seasonStrikeoutsPerBF >= 0.7)) {
    reasons.push('STRIKEOUT_RATE_OUT_OF_RANGE');
  }

  const enrichedFields = context
    ? [
        context.opponentStrikeoutRate,
        context.recentSwStrRate,
        context.recentCswRate,
        context.averageFastballVelocityMph,
        context.velocityDeltaMph,
        context.daysRest,
        context.temperatureF,
        context.windMph,
        context.officialWorkloadGames.length >= 5 ? 1 : null,
      ].filter((x) => x !== null).length
    : 0;

  const hardFailures = reasons.filter((r) =>
    r.startsWith('PIT:') ||
    r.startsWith('FUTURE_OR_INVALID_LOG:') ||
    r.startsWith('FUTURE_OR_INVALID_OFFICIAL_WORKLOAD:') ||
    r === 'CONTEXT_FROM_FUTURE' ||
    r === 'CONTEXT_TIMESTAMP_INVALID' ||
    r === 'INSUFFICIENT_VERIFIED_WORKLOAD_HISTORY' ||
    r === 'WORKLOAD_OUT_OF_RANGE' ||
    r === 'STRIKEOUT_RATE_OUT_OF_RANGE' ||
    r === 'NOT_MLB' ||
    r === 'NOT_PITCHER_STRIKEOUTS'
  );

  const latestFeatureObservedAt = [pit.latestObservedAt, context?.observedAt ?? null]
    .filter((x): x is string => Boolean(x))
    .sort()
    .at(-1) ?? null;

  const dataQuality: MlbPitcherKFeatureVectorV3['dataQuality'] = !coreAvailable ? 'UNAVAILABLE' : enrichedFields >= 2 ? 'ENRICHED' : 'CORE_VERIFIED';
  const payload: Omit<MlbPitcherKFeatureVectorV3, 'featureVectorId'> = {
    featureVersion: 'APEX_MLB_K_FEATURES_V3',
    asOf: asOf.toISOString(),
    latestFeatureObservedAt,
    isPointInTimeValid: hardFailures.length === 0,
    reasonCodes: Array.from(new Set(reasons)).sort(),
    dataQuality,
    sampleStarts: rows.length,
    workloadStarts: workloadRows.length,
    officialBattersFacedStarts,
    derivedBattersFacedStarts,
    workloadSource,
    expectedBattersFaced: expectedBattersFaced === null ? null : Number(expectedBattersFaced.toFixed(3)),
    expectedInnings: expectedInnings === null ? null : Number(expectedInnings.toFixed(3)),
    seasonStrikeoutsPerBF: seasonStrikeoutsPerBF === null ? null : Number(seasonStrikeoutsPerBF.toFixed(5)),
    l10StrikeoutsPerBF: l10StrikeoutsPerBF === null ? null : Number(l10StrikeoutsPerBF.toFixed(5)),
    l5StrikeoutsPerBF: l5StrikeoutsPerBF === null ? null : Number(l5StrikeoutsPerBF.toFixed(5)),
    workloadTrendBF: workloadTrendBF === null ? null : Number(workloadTrendBF.toFixed(3)),
    strikeoutMean: mean(strikeoutValues) === null ? null : Number(mean(strikeoutValues)!.toFixed(4)),
    strikeoutVariance: variance(strikeoutValues) === null ? null : Number(variance(strikeoutValues)!.toFixed(4)),
    opponentStrikeoutRate: context?.opponentStrikeoutRate ?? null,
    pitcherTeamVenueRole: quote.teamVenueRole ?? null,
    pitcherHandedness: context?.pitcherHandedness ?? null,
    recentSwStrRate: context?.recentSwStrRate ?? null,
    recentCswRate: context?.recentCswRate ?? null,
    averageFastballVelocityMph: context?.averageFastballVelocityMph ?? null,
    velocityDeltaMph: context?.velocityDeltaMph ?? null,
    dominantPitchShare: context?.dominantPitchShare ?? null,
    daysRest: context?.daysRest ?? null,
    temperatureF: context?.temperatureF ?? null,
    windMph: context?.windMph ?? null,
    parkFactor: context?.parkFactor ?? null,
    umpireStrikeoutFactor: context?.umpireStrikeoutFactor ?? null,
    line: quote.line,
  };

  const featureVectorId = `MLBK3-${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 20)}`;
  return { featureVectorId, ...payload };
}
