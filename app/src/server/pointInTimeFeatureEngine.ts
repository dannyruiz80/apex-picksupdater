import crypto from 'crypto';
import { NormalizedPlayerPropQuote, PointInTimeFeatureAudit } from '../types';

export interface PointInTimeFeatureObservation {
  name: string;
  value: number | string | boolean | null;
  source: string;
  observedAt: string;
}

export interface PointInTimeFeatureSnapshotV1 extends PointInTimeFeatureAudit {
  apexEventId: string;
  providerEventId: string;
  playerId: string | null;
  providerMarketKey: string;
  line: number;
  observations: ReadonlyArray<PointInTimeFeatureObservation>;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function stableId(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 20);
}

/**
 * Builds an immutable feature audit at a specific prediction instant.
 * The engine never claims a feature was point-in-time safe unless its source
 * timestamp is known and no supplied game log occurs after the prediction instant.
 */
export function buildPointInTimeFeatureSnapshot(
  quote: NormalizedPlayerPropQuote,
  asOf: Date = new Date()
): PointInTimeFeatureSnapshotV1 {
  const asOfMs = asOf.getTime();
  const reasons: string[] = [];
  const observations: PointInTimeFeatureObservation[] = [];

  const add = (
    name: string,
    value: number | string | boolean | null,
    source: string,
    observedAt: string | null | undefined,
    missingReason: string
  ) => {
    const ms = parseTime(observedAt);
    if (ms === null) {
      reasons.push(missingReason);
      return;
    }
    if (ms > asOfMs) reasons.push(`FUTURE_OBSERVATION:${name}`);
    observations.push({ name, value, source, observedAt: new Date(ms).toISOString() });
  };

  add('market.line', quote.line, quote.marketSource || 'UNKNOWN_MARKET_SOURCE', quote.providerTimestamp, 'MARKET_TIMESTAMP_MISSING');
  add('market.overOddsAmerican', quote.overOddsAmerican, quote.marketSource || 'UNKNOWN_MARKET_SOURCE', quote.providerTimestamp, 'MARKET_TIMESTAMP_MISSING');
  add('market.underOddsAmerican', quote.underOddsAmerican, quote.marketSource || 'UNKNOWN_MARKET_SOURCE', quote.providerTimestamp, 'MARKET_TIMESTAMP_MISSING');
  add('roster.playerId', quote.playerId, quote.rosterSource || 'UNKNOWN_ROSTER_SOURCE', quote.retrievedAt, 'ROSTER_TIMESTAMP_MISSING');

  const startMs = parseTime(quote.eventStartTime);
  if (startMs === null) reasons.push('EVENT_START_TIMESTAMP_MISSING');
  else if (asOfMs >= startMs) reasons.push('EVENT_STARTED_BEFORE_PREDICTION');
  const status = (quote.eventStatus ?? 'UPCOMING').toUpperCase();
  if (!['UPCOMING', 'SCHEDULED', 'PRE'].includes(status)) reasons.push(`EVENT_STATUS_NOT_PREGAME:${status}`);

  const stats = quote.historicalStats;
  if (!stats) {
    reasons.push('HISTORICAL_STATS_MISSING');
  } else {
    add('stats.seasonAverage', stats.seasonAverage, stats.source, stats.retrievedAt, 'STATS_TIMESTAMP_MISSING');
    add('stats.seasonOverHitRate', stats.seasonOverHitRate, stats.source, stats.retrievedAt, 'STATS_TIMESTAMP_MISSING');
    add('stats.seasonSampleCount', stats.seasonSampleCount, stats.source, stats.retrievedAt, 'STATS_TIMESTAMP_MISSING');
    add('stats.l10Average', stats.l10Average, stats.source, stats.retrievedAt, 'STATS_TIMESTAMP_MISSING');
    add('stats.l10OverHitRate', stats.l10OverHitRate, stats.source, stats.retrievedAt, 'STATS_TIMESTAMP_MISSING');
    add('stats.l5Average', stats.l5Average, stats.source, stats.retrievedAt, 'STATS_TIMESTAMP_MISSING');
    add('stats.l5OverHitRate', stats.l5OverHitRate, stats.source, stats.retrievedAt, 'STATS_TIMESTAMP_MISSING');

    for (const game of stats.recentGameLogs ?? []) {
      const gameMs = parseTime(game.gameDate);
      if (gameMs === null) {
        reasons.push(`GAME_LOG_DATE_INVALID:${game.eventId}`);
      } else if (gameMs >= asOfMs) {
        reasons.push(`FUTURE_GAME_LOG:${game.eventId}`);
      }
      if (startMs !== null && gameMs !== null && gameMs >= startMs) {
        reasons.push(`GAME_LOG_NOT_BEFORE_EVENT:${game.eventId}`);
      }
    }
  }

  const retrievedMs = parseTime(quote.retrievedAt);
  if (retrievedMs === null) reasons.push('QUOTE_RETRIEVAL_TIMESTAMP_MISSING');
  else if (retrievedMs > asOfMs) reasons.push('QUOTE_RETRIEVED_IN_FUTURE');

  const providerMs = parseTime(quote.providerTimestamp);
  if (providerMs !== null && retrievedMs !== null && providerMs > retrievedMs) {
    reasons.push('PROVIDER_TIMESTAMP_AFTER_RETRIEVAL');
  }

  const dedupedReasons = Array.from(new Set(reasons)).sort();
  const latestObservedAt = observations.length
    ? observations.map((o) => o.observedAt).sort().at(-1) ?? null
    : null;

  const identity = {
    version: 'APEX_FEATURE_SNAPSHOT_V1',
    asOf: asOf.toISOString(),
    apexEventId: quote.apexEventId,
    providerEventId: quote.providerEventId,
    playerId: quote.playerId,
    market: quote.providerMarketKey,
    line: quote.line,
    observations,
    reasons: dedupedReasons,
  };

  return Object.freeze({
    featureSnapshotVersion: 'APEX_FEATURE_SNAPSHOT_V1',
    featureSnapshotId: `FS-${stableId(identity)}`,
    asOf: asOf.toISOString(),
    isValid: dedupedReasons.length === 0,
    reasonCodes: dedupedReasons,
    latestObservedAt,
    featureCount: observations.length,
    apexEventId: quote.apexEventId,
    providerEventId: quote.providerEventId,
    playerId: quote.playerId,
    providerMarketKey: quote.providerMarketKey,
    line: quote.line,
    observations: Object.freeze(observations.map((x) => Object.freeze({ ...x }))),
  });
}
