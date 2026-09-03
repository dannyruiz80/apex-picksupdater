import { DurableHistoricalPropSnapshot } from '../types';

export interface WalkForwardFold {
  fold: number;
  trainSnapshotIds: string[];
  testSnapshotIds: string[];
  trainEnd: string;
  testStart: string;
  leakageFree: boolean;
}

export interface WalkForwardValidationPlan {
  totalEligibleSnapshots: number;
  folds: WalkForwardFold[];
  allLeakageFree: boolean;
  rejectedSnapshotIds: string[];
}

function ms(value: string | null | undefined): number | null {
  if (!value) return null;
  const out = Date.parse(value);
  return Number.isFinite(out) ? out : null;
}

export function isHistoricalSnapshotPointInTimeSafe(snapshot: DurableHistoricalPropSnapshot): boolean {
  const created = ms(snapshot.snapshotCreatedAt);
  const quote = ms(snapshot.sportsbookQuoteTimestamp);
  const stats = ms(snapshot.statisticsCutoffTimestamp);
  const start = ms(snapshot.eventStartTime);
  if ([created, quote, stats, start].some((x) => x === null)) return false;
  return Boolean(
    snapshot.snapshotType === 'REAL_PREGAME' &&
    snapshot.historicalEligibility === 'ELIGIBLE' &&
    snapshot.pointInTimeValid === true &&
    Boolean(snapshot.featureSnapshotId) &&
    quote! <= created! &&
    stats! <= created! &&
    created! < start!
  );
}

/** Chronological expanding-window folds. No random shuffling is permitted. */
export function buildWalkForwardPlan(
  snapshots: DurableHistoricalPropSnapshot[],
  minTrainSnapshots = 30,
  testSnapshotsPerFold = 10
): WalkForwardValidationPlan {
  const rejected = snapshots.filter((s) => !isHistoricalSnapshotPointInTimeSafe(s)).map((s) => s.snapshotId);
  const eligible = snapshots
    .filter(isHistoricalSnapshotPointInTimeSafe)
    .sort((a, b) => Date.parse(a.eventStartTime) - Date.parse(b.eventStartTime));

  const folds: WalkForwardFold[] = [];
  let fold = 1;
  for (let testStartIndex = minTrainSnapshots; testStartIndex < eligible.length; testStartIndex += testSnapshotsPerFold) {
    const train = eligible.slice(0, testStartIndex);
    const test = eligible.slice(testStartIndex, Math.min(eligible.length, testStartIndex + testSnapshotsPerFold));
    if (test.length === 0) break;
    const trainEnd = train.at(-1)!.eventStartTime;
    const testStart = test[0].eventStartTime;
    folds.push({
      fold: fold++,
      trainSnapshotIds: train.map((s) => s.snapshotId),
      testSnapshotIds: test.map((s) => s.snapshotId),
      trainEnd,
      testStart,
      leakageFree: Date.parse(trainEnd) < Date.parse(testStart),
    });
  }

  return {
    totalEligibleSnapshots: eligible.length,
    folds,
    allLeakageFree: folds.every((f) => f.leakageFree),
    rejectedSnapshotIds: rejected,
  };
}
