import { MlbPitcherKStarterShadowForecast } from '../types';
import { evaluateMlbPitcherKNegativeBinomial } from './mlbPitcherKNegativeBinomialService';
import { mlbPitcherKPublicDataFeatureService } from './mlbPitcherKPublicDataFeatureService';
import { mlbPitcherKStarterShadowRepository } from './mlbPitcherKStarterShadowRepository';

function chicagoDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

export class MlbPitcherKStarterShadowCaptureService {
  private cycleInFlight: Promise<any> | null = null;
  private lastCycleAt: string | null = null;
  private lastCycleResult: any | null = null;

  async captureDate(date = chicagoDate()) {
    const now = new Date();
    const starters = (await mlbPitcherKPublicDataFeatureService.getScheduleStarters(date))
      .filter((s) => Date.parse(s.eventStartTime) > now.getTime());

    const existing = new Map(
      mlbPitcherKStarterShadowRepository.getAll().map((row) => [row.forecastId, row])
    );
    const rejectedRetryCooldownMs = 6 * 60 * 60 * 1000;
    let skippedFrozen = 0;
    let skippedRejectedCooldown = 0;

    const eligibleStarters = starters.filter((starter) => {
      const forecastId = `MLBK-STARTER-${starter.eventId}-${starter.pitcherId}`;
      const previous = existing.get(forecastId);
      if (!previous) return true;
      if (previous.gradingStatus === 'PENDING' || previous.gradingStatus === 'GRADED') {
        skippedFrozen++;
        return false;
      }
      const previousAt = Date.parse(previous.capturedAt);
      if (Number.isFinite(previousAt) && now.getTime() - previousAt < rejectedRetryCooldownMs) {
        skippedRejectedCooldown++;
        return false;
      }
      return true;
    });

    const forecasts = (await mapLimit(eligibleStarters, 3, async (starter): Promise<MlbPitcherKStarterShadowForecast | null> => {
      // As-of is the actual capture time. If the game is less than a second away, fail closed.
      if (Date.parse(starter.eventStartTime) <= now.getTime()) return null;
      const featureVector = await mlbPitcherKPublicDataFeatureService.buildCoreFeature({ ...starter, asOf: now.toISOString() });
      const negativeBinomial = evaluateMlbPitcherKNegativeBinomial(featureVector);
      return {
        forecastId: `MLBK-STARTER-${starter.eventId}-${starter.pitcherId}`,
        forecastVersion: 'APEX_MLB_K_ALL_STARTERS_V1',
        eventId: starter.eventId,
        eventStartTime: starter.eventStartTime,
        season: starter.season,
        pitcherId: starter.pitcherId,
        pitcherName: starter.pitcherName,
        team: starter.team,
        opponent: starter.opponent,
        teamVenueRole: starter.teamVenueRole,
        capturedAt: now.toISOString(),
        featureVector,
        negativeBinomial,
        gradingStatus: featureVector.isPointInTimeValid && negativeBinomial.isAvailable ? 'PENDING' : 'REJECTED',
        actualStrikeouts: null,
        gradedAt: null,
        gradingSource: null,
        rejectionReason: featureVector.isPointInTimeValid && negativeBinomial.isAvailable ? null : [...featureVector.reasonCodes, negativeBinomial.reason].filter(Boolean).join(', '),
      };
    })).filter((x): x is MlbPitcherKStarterShadowForecast => x !== null);
    const persisted = mlbPitcherKStarterShadowRepository.upsertMany(forecasts);
    return {
      captureVersion: 'APEX_MLB_K_ALL_STARTERS_V1',
      date,
      startersFound: starters.length,
      eligibleForFeatureBuild: eligibleStarters.length,
      forecastsBuilt: forecasts.length,
      skippedFrozen,
      skippedRejectedCooldown,
      rejectedRetryCooldownHours: 6,
      persisted,
      keyedOddsApiRequestsConsumed: 0,
    };
  }

  getLearningStatus() {
    return {
      cycleInFlight: this.cycleInFlight !== null,
      lastCycleAt: this.lastCycleAt,
      lastCycleResult: this.lastCycleResult,
      keyedOddsApiRequestsConsumed: 0,
    };
  }

  async runLearningCycle(date?: string) {
    if (this.cycleInFlight) return this.cycleInFlight;
    this.cycleInFlight = (async () => {
      const grading = await this.gradePending();
      const capture = await this.captureDate(date);
      const result = { cycleVersion: 'APEX_MLB_K_ALL_STARTERS_V1', grading, capture, keyedOddsApiRequestsConsumed: 0 };
      this.lastCycleAt = new Date().toISOString();
      this.lastCycleResult = result;
      return result;
    })();
    try {
      return await this.cycleInFlight;
    } finally {
      this.cycleInFlight = null;
    }
  }

  async gradePending() {
    const all = mlbPitcherKStarterShadowRepository.getAll();
    const now = Date.now();
    const due = all.filter((r) => r.gradingStatus === 'PENDING' && Date.parse(r.eventStartTime) < now - 2 * 60 * 60 * 1000);
    const updated = (await mapLimit(due, 3, async (row) => {
      const actual = await mlbPitcherKPublicDataFeatureService.getActualStrikeouts(row.eventId, row.pitcherId);
      if (actual === null) return row;
      return { ...row, gradingStatus: 'GRADED' as const, actualStrikeouts: actual, gradedAt: new Date().toISOString(), gradingSource: 'MLB_STATS_API_BOXSCORE' };
    }));
    const persisted = mlbPitcherKStarterShadowRepository.upsertMany(updated);
    return { gradingVersion: 'APEX_MLB_K_ALL_STARTERS_V1', pendingDue: due.length, gradedNow: updated.filter((r, i) => r.gradingStatus === 'GRADED' && due[i].gradingStatus !== 'GRADED').length, persisted, keyedOddsApiRequestsConsumed: 0 };
  }
}

export const mlbPitcherKStarterShadowCaptureService = new MlbPitcherKStarterShadowCaptureService();
