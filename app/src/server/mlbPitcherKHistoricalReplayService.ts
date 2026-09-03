import { MlbPitcherKHistoricalReplayRow } from '../types';
import { evaluateMlbPitcherKNegativeBinomial } from './mlbPitcherKNegativeBinomialService';
import { mlbPitcherKHistoricalReplayRepository } from './mlbPitcherKHistoricalReplayRepository';
import { mlbPitcherKPublicDataFeatureService } from './mlbPitcherKPublicDataFeatureService';

function parseDate(value: string): Date | null {
  const d = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function eachDate(start: Date, end: Date): string[] {
  const out: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export class MlbPitcherKHistoricalReplayService {
  async replayDateRange(startDate: string, endDate: string) {
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (!start || !end || end < start) throw new Error('Valid YYYY-MM-DD startDate/endDate required');
    const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    if (days > 31) throw new Error('Historical replay is limited to 31 days per request to protect public MLB endpoints');

    const dates = eachDate(start, end);
    const starterArrays = await mapLimit(dates, 2, (date) => mlbPitcherKPublicDataFeatureService.getScheduleStarters(date));
    // Replay only fully completed games. Elapsed time is not a substitute for final status:
    // extra-inning/delayed games could otherwise be labeled from a partial box score.
    const starters = starterArrays.flat().filter((s) => ['FINAL', 'COMPLETED'].some((x) => s.status.includes(x)));

    const rows = (await mapLimit(starters, 3, async (starter): Promise<MlbPitcherKHistoricalReplayRow | null> => {
      const actual = await mlbPitcherKPublicDataFeatureService.getActualStrikeouts(starter.eventId, starter.pitcherId);
      if (actual === null) return null;
      const eventMs = Date.parse(starter.eventStartTime);
      const asOf = new Date(eventMs - 3 * 60 * 60 * 1000).toISOString();
      const featureVector = await mlbPitcherKPublicDataFeatureService.buildCoreFeature({ ...starter, asOf });
      const negativeBinomial = evaluateMlbPitcherKNegativeBinomial(featureVector);
      const pointInTimeValid = featureVector.isPointInTimeValid && negativeBinomial.isAvailable;
      return {
        replayId: `MLBK-REPLAY-${starter.eventId}-${starter.pitcherId}`,
        source: 'MLB_STATS_API_POINT_IN_TIME_REPLAY',
        eventId: starter.eventId,
        eventStartTime: starter.eventStartTime,
        season: starter.season,
        pitcherId: starter.pitcherId,
        pitcherName: starter.pitcherName,
        team: starter.team,
        opponent: starter.opponent,
        teamVenueRole: starter.teamVenueRole,
        asOf,
        actualStrikeouts: actual,
        featureVector,
        negativeBinomial,
        pointInTimeValid,
        rejectionReasons: pointInTimeValid ? [] : [...featureVector.reasonCodes, negativeBinomial.reason ?? 'NB_UNAVAILABLE'].filter(Boolean),
        createdAt: new Date().toISOString(),
      };
    })).filter((x): x is MlbPitcherKHistoricalReplayRow => x !== null);

    const persisted = mlbPitcherKHistoricalReplayRepository.upsertMany(rows);
    return {
      replayVersion: 'APEX_MLB_K_HISTORICAL_PIT_REPLAY_V1',
      startDate,
      endDate,
      requestedDays: days,
      scheduleStartersFound: starters.length,
      replayRowsBuilt: rows.length,
      pointInTimeValidRows: rows.filter((r) => r.pointInTimeValid).length,
      rejectedRows: rows.filter((r) => !r.pointInTimeValid).length,
      persisted,
      keyedOddsApiRequestsConsumed: 0,
      note: 'Official MLB replay is count-model research evidence only; it never satisfies prospective promotion or CLV gates.',
    };
  }
}

export const mlbPitcherKHistoricalReplayService = new MlbPitcherKHistoricalReplayService();
