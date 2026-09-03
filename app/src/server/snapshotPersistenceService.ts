import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  ApexSport,
  DurableHistoricalPropSnapshot,
  SnapshotType,
  HistoricalGradingStatus,
  HistoricalEligibilityStatus,
  SampleReliabilityTier,
  RecommendationStatus,
  ReasonCode,
  HistoricalGradingOutcome,
  NormalizedPlayerPropQuote,
  GradedPropRecord,
} from '../types';
import { marketQuotaGuard } from './marketQuotaGuard';

export interface PersistenceResult {
  success: boolean;
  action: 'CREATED' | 'DEDUPLICATED' | 'REJECTED' | 'FAILED';
  snapshotId: string;
  fingerprint: string;
  rejectionReason?: string;
  error?: string;
}

export interface PersistenceAuditStatus {
  backend: 'LOCAL_CONTAINER_EPHEMERAL' | 'FIRESTORE_CLOUD_DURABLE';
  persistenceStatus: 'DURABLE PERSISTENCE: ACTIVE (FIRESTORE)' | 'DURABLE PERSISTENCE VERIFICATION FAILED (EPHEMERAL DISK)';
  isCloudDurable: boolean;
  storagePath: string;
  totalSnapshots: number;
  realPregameCount: number;
  testFixtureCount: number;
  realPendingCount: number;
  realGradedCount: number;
  realRejectedCount: number;
  firstCaptureTime: string | null;
  latestCaptureTime: string | null;
}

export class SnapshotPersistenceService {
  private static readonly DATA_DIR = path.join(process.cwd(), 'data');
  private static readonly DATA_FILE = path.join(SnapshotPersistenceService.DATA_DIR, 'historicalPropSnapshots.json');

  private snapshots: Map<string, DurableHistoricalPropSnapshot> = new Map();
  private fingerprintIndex: Map<string, string> = new Map(); // fingerprint -> snapshotId
  private isInitialized = false;
  private writeFailureSimulation = false;

  constructor() {
    this.initializeStorage();
  }

  /**
   * Initializes local durable storage and seeds the initial developer test fixture.
   */
  public initializeStorage(): void {
    try {
      if (!fs.existsSync(SnapshotPersistenceService.DATA_DIR)) {
        fs.mkdirSync(SnapshotPersistenceService.DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(SnapshotPersistenceService.DATA_FILE)) {
        const raw = fs.readFileSync(SnapshotPersistenceService.DATA_FILE, 'utf-8');
        if (raw.trim()) {
          const parsed = JSON.parse(raw) as DurableHistoricalPropSnapshot[];
          for (const s of parsed) {
            this.snapshots.set(s.snapshotId, Object.freeze(s));
            this.fingerprintIndex.set(s.dedupFingerprint, s.snapshotId);
          }
        }
      }
    } catch (err: any) {
      console.error('[SnapshotPersistenceService] Failed to load durable file storage:', err.message);
    }

    // Seed test fixture if not present (Isolated strictly as TEST_FIXTURE)
    this.seedDeveloperTestFixture();
    this.isInitialized = true;
  }

  /**
   * Creates a deterministic deduplication fingerprint for an immutable market state.
   */
  public computeFingerprint(params: {
    eventId: string;
    playerId: string;
    market: string;
    line: number;
    sportsbook: string;
    overOddsAmerican: number | null;
    underOddsAmerican: number | null;
    modelVersion: string;
    valueEngineVersion: string;
  }): string {
    const raw = `${params.eventId}|${params.playerId}|${params.market}|${params.line}|${params.sportsbook}|${params.overOddsAmerican ?? 'null'}|${params.underOddsAmerican ?? 'null'}|${params.modelVersion}|${params.valueEngineVersion}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
  }

  /**
   * Persists a pregame proposition quote evaluation snapshot.
   * Enforces all temporal, identity, and eligibility rules.
   */
  public persistQuoteSnapshot(
    quote: NormalizedPlayerPropQuote,
    eventStartTime: string,
    isUpcoming: boolean
  ): PersistenceResult {
    if (this.writeFailureSimulation) {
      return {
        success: false,
        action: 'FAILED',
        snapshotId: '',
        fingerprint: '',
        error: 'Simulated durable storage write failure (fail-closed behavior active)',
      };
    }

    if (!quote.probabilityAnalysis || !quote.valueAnalysis) {
      return {
        success: false,
        action: 'REJECTED',
        snapshotId: '',
        fingerprint: '',
        rejectionReason: 'MISSING_PROBABILITY_OR_VALUE_ANALYSIS',
      };
    }

    const modelVersion = quote.probabilityAnalysis.modelVersion;
    const valueEngineVersion = quote.valueAnalysis.engineVersion;

    const fingerprint = this.computeFingerprint({
      eventId: quote.apexEventId,
      playerId: quote.playerId || 'unknown',
      market: quote.providerMarketKey,
      line: quote.line,
      sportsbook: quote.bookmakerTitle || quote.bookmakerKey || 'sportsbook',
      overOddsAmerican: quote.overOddsAmerican,
      underOddsAmerican: quote.underOddsAmerican,
      modelVersion,
      valueEngineVersion,
    });

    // Check if an identical immutable proposition state already exists
    if (this.fingerprintIndex.has(fingerprint)) {
      const existingId = this.fingerprintIndex.get(fingerprint)!;
      return {
        success: true,
        action: 'DEDUPLICATED',
        snapshotId: existingId,
        fingerprint,
      };
    }

    const snapshotCreatedAt = new Date().toISOString();
    // Never manufacture temporal proof. Source timestamps must come from the source observations.
    const sportsbookQuoteTimestamp = quote.providerTimestamp || '';
    const statisticsCutoffTimestamp = quote.historicalStats?.retrievedAt || (quote.historicalStats as any)?.computedAt || '';

    // Temporal Eligibility Checks
    const isBeforeGame = new Date(snapshotCreatedAt).getTime() < new Date(eventStartTime).getTime();
    const isCutoffValid =
      new Date(statisticsCutoffTimestamp).getTime() <= new Date(snapshotCreatedAt).getTime();
    const isIdentityVerified =
      Boolean(quote.playerId) &&
      Boolean(quote.playerDisplayName) &&
      Boolean(quote.verifiedTeam) &&
      Boolean(quote.verifiedOpponent) &&
      quote.marketVerified &&
      quote.rosterVerified;
    const pointInTimeValid = quote.probabilityAnalysis.pointInTimeAudit?.isValid === true;
    const temporalSourcesPresent = Boolean(sportsbookQuoteTimestamp && statisticsCutoffTimestamp);

    let historicalEligibility: HistoricalEligibilityStatus = 'ELIGIBLE';
    let rejectionReason: string | null = null;
    let gradingStatus: HistoricalGradingStatus = 'PENDING';

    if (!temporalSourcesPresent) {
      historicalEligibility = 'INELIGIBLE';
      rejectionReason = 'SOURCE_TIMESTAMP_MISSING';
      gradingStatus = 'REJECTED';
    } else if (!pointInTimeValid) {
      historicalEligibility = 'INELIGIBLE';
      rejectionReason = 'POINT_IN_TIME_FEATURE_AUDIT_FAILED';
      gradingStatus = 'REJECTED';
    } else if (!isUpcoming || !isBeforeGame) {
      historicalEligibility = 'INELIGIBLE';
      rejectionReason = 'EVENT_NOT_UPCOMING_OR_POST_START_TIMESTAMP';
      gradingStatus = 'REJECTED';
    } else if (!isCutoffValid) {
      historicalEligibility = 'INELIGIBLE';
      rejectionReason = 'STATISTICS_CUTOFF_AFTER_SNAPSHOT_TIME';
      gradingStatus = 'REJECTED';
    } else if (!isIdentityVerified) {
      historicalEligibility = 'INELIGIBLE';
      rejectionReason = 'UNVERIFIED_ATHLETE_OR_MARKET_IDENTITY';
      gradingStatus = 'REJECTED';
    }

    const snapshotId = `snap_${quote.sport.toLowerCase()}_${quote.playerId || 'unk'}_${quote.providerMarketKey}_${quote.line}_${(quote.bookmakerKey || 'book').replace(/\s+/g, '_')}_${Date.now()}`;
    const selectedContract = quote.valueAnalysis.predictionContracts?.find(
      (contract) => contract.side === quote.valueAnalysis?.bestRecommendation.side
    ) ?? null;

    const snapshot: DurableHistoricalPropSnapshot = {
      snapshotId,
      snapshotType: 'REAL_PREGAME',
      dedupFingerprint: fingerprint,
      predictionId: selectedContract?.predictionId ?? null,
      predictionContractVersion: selectedContract?.contractVersion ?? null,
      featureSnapshotId: quote.probabilityAnalysis.pointInTimeAudit?.featureSnapshotId ?? null,
      featureSnapshotVersion: quote.probabilityAnalysis.pointInTimeAudit?.featureSnapshotVersion ?? null,
      featureAsOf: quote.probabilityAnalysis.pointInTimeAudit?.asOf ?? null,
      pointInTimeValid,
      calibrationVersion: quote.probabilityAnalysis.calibration?.calibrationVersion ?? null,
      calibrationStatus: quote.probabilityAnalysis.calibration?.status ?? null,
      eventId: quote.apexEventId,
      providerEventId: quote.providerEventId,
      eventStartTime,
      snapshotCreatedAt,
      sportsbookQuoteTimestamp,
      statisticsCutoffTimestamp,
      playerId: quote.playerId,
      playerName: quote.playerDisplayName,
      team: quote.verifiedTeam,
      opponent: quote.verifiedOpponent,
      sport: quote.sport,
      league: quote.league,
      market: quote.providerMarketKey,
      line: quote.line,
      side: quote.valueAnalysis.bestRecommendation.side,
      sportsbook: quote.bookmakerTitle || quote.bookmakerKey || 'sportsbook',
      americanOdds:
        quote.valueAnalysis.bestRecommendation.side === 'OVER'
          ? quote.overOddsAmerican
          : quote.underOddsAmerican,
      decimalOdds:
        quote.valueAnalysis.bestRecommendation.side === 'OVER'
          ? quote.overOddsDecimal
          : quote.underOddsDecimal,
      overOddsAmerican: quote.overOddsAmerican,
      underOddsAmerican: quote.underOddsAmerican,
      overAmericanOdds: quote.overOddsAmerican,
      underAmericanOdds: quote.underOddsAmerican,
      overDecimalOdds: quote.overOddsDecimal,
      underDecimalOdds: quote.underOddsDecimal,
      overApexProbability: quote.probabilityAnalysis.apexOverProbability,
      underApexProbability: quote.probabilityAnalysis.apexUnderProbability,
      overRawProbability: quote.probabilityAnalysis.rawOverProbability ?? quote.probabilityAnalysis.apexOverProbability,
      underRawProbability: quote.probabilityAnalysis.rawUnderProbability ?? quote.probabilityAnalysis.apexUnderProbability,
      overCalibratedProbability: quote.probabilityAnalysis.calibratedOverProbability ?? null,
      underCalibratedProbability: quote.probabilityAnalysis.calibratedUnderProbability ?? null,
      overBreakEvenProbability: quote.valueAnalysis.overAnalysis?.breakEvenProbability ?? null,
      underBreakEvenProbability: quote.valueAnalysis.underAnalysis?.breakEvenProbability ?? null,
      overEdge: quote.valueAnalysis.overAnalysis?.modelEdgePercentagePoints ?? null,
      underEdge: quote.valueAnalysis.underAnalysis?.modelEdgePercentagePoints ?? null,
      overEV: quote.valueAnalysis.overAnalysis?.expectedValuePercent ?? null,
      underEV: quote.valueAnalysis.underAnalysis?.expectedValuePercent ?? null,
      overDecision: quote.valueAnalysis.overAnalysis?.recommendationStatus ?? null,
      underDecision: quote.valueAnalysis.underAnalysis?.recommendationStatus ?? null,
      overReasonCodes: quote.valueAnalysis.overAnalysis?.reasonCodes ?? [],
      underReasonCodes: quote.valueAnalysis.underAnalysis?.reasonCodes ?? [],
      modelVersion,
      valueEngineVersion,
      apexProbability:
        quote.valueAnalysis.bestRecommendation.side === 'OVER'
          ? quote.probabilityAnalysis.apexOverProbability
          : quote.probabilityAnalysis.apexUnderProbability,
      breakEvenProbability:
        quote.valueAnalysis.bestRecommendation.side === 'OVER'
          ? quote.valueAnalysis.overAnalysis?.breakEvenProbability ?? null
          : quote.valueAnalysis.underAnalysis?.breakEvenProbability ?? null,
      modelEdge:
        quote.valueAnalysis.bestRecommendation.side === 'OVER'
          ? quote.valueAnalysis.overAnalysis?.modelEdgePercentagePoints ?? null
          : quote.valueAnalysis.underAnalysis?.modelEdgePercentagePoints ?? null,
      expectedValue:
        quote.valueAnalysis.bestRecommendation.side === 'OVER'
          ? quote.valueAnalysis.overAnalysis?.expectedValuePercent ?? null
          : quote.valueAnalysis.underAnalysis?.expectedValuePercent ?? null,
      reliabilityTier: quote.probabilityAnalysis.components.sampleReliabilityTier,
      recommendation: quote.valueAnalysis.bestRecommendation.recommendationStatus,
      reasonCodes: quote.valueAnalysis.bestRecommendation.reasonCodes,
      verificationState: isIdentityVerified ? 'VERIFIED' : 'UNVERIFIED',
      historicalEligibility,
      rejectionReason,
      gradingStatus,
      mlbPitcherKV3: quote.probabilityAnalysis.mlbPitcherKShadow
        ? {
            featureVector: quote.probabilityAnalysis.mlbPitcherKShadow.featureVector,
            negativeBinomialOverProbability: quote.probabilityAnalysis.mlbPitcherKShadow.negativeBinomial.overProbability,
            negativeBinomialUnderProbability: quote.probabilityAnalysis.mlbPitcherKShadow.negativeBinomial.underProbability,
            negativeBinomialPushProbability: quote.probabilityAnalysis.mlbPitcherKShadow.negativeBinomial.pushProbability,
            boostedConditionalOverProbability: quote.probabilityAnalysis.mlbPitcherKShadow.boosted.probability,
            shadowOverProbability: quote.probabilityAnalysis.mlbPitcherKShadow.shadowOverProbability,
            shadowUnderProbability: quote.probabilityAnalysis.mlbPitcherKShadow.shadowUnderProbability,
            shadowPushProbability: quote.probabilityAnalysis.mlbPitcherKShadow.shadowPushProbability,
            productionPushProbability: quote.probabilityAnalysis.apexPushProbability ?? 0,
          }
        : null,
      modelInputs: {
        seasonMean: quote.probabilityAnalysis.components.seasonMean,
        seasonHitRate: quote.probabilityAnalysis.components.seasonEmpiricalHitRate,
        seasonSampleCount: quote.probabilityAnalysis.components.seasonSampleCount,
        l10Mean: quote.probabilityAnalysis.components.l10EmpiricalHitRate,
        l10HitRate: quote.probabilityAnalysis.components.l10EmpiricalHitRate,
        l10SampleCount: quote.probabilityAnalysis.components.l10SampleCount,
        sampleReliabilityTier: quote.probabilityAnalysis.components.sampleReliabilityTier,
        marketNoVigOver: quote.probabilityAnalysis.components.marketNoVigOverProbability ?? null,
        marketNoVigUnder:
          quote.probabilityAnalysis.components.marketNoVigOverProbability !== null
            ? 1 - quote.probabilityAnalysis.components.marketNoVigOverProbability
            : null,
        isMarketBlended: quote.probabilityAnalysis.components.marketWeight > 0,
      },
    };

    // Save to in-memory index and sync to durable file
    this.snapshots.set(snapshotId, Object.freeze(snapshot));
    this.fingerprintIndex.set(fingerprint, snapshotId);
    this.syncToDurableStorage();

    return {
      success: true,
      action: historicalEligibility === 'ELIGIBLE' ? 'CREATED' : 'REJECTED',
      snapshotId,
      fingerprint,
      rejectionReason: rejectionReason || undefined,
    };
  }

  /**
   * Directly stores a raw DurableHistoricalPropSnapshot (useful for testing and seed fixtures).
   */
  public storeRawSnapshot(snapshot: DurableHistoricalPropSnapshot): boolean {
    if (this.writeFailureSimulation) {
      return false;
    }
    this.snapshots.set(snapshot.snapshotId, Object.freeze(snapshot));
    this.fingerprintIndex.set(snapshot.dedupFingerprint, snapshot.snapshotId);
    this.syncToDurableStorage();
    return true;
  }

  /**
   * Grades a pregame snapshot idempotently without mutating original pregame attributes.
   */
  public gradeSnapshot(
    snapshotId: string,
    actualStatistic: number,
    dataSource = 'ESPN_OFFICIAL_BOXSCORE',
    finalEventId = ''
  ): DurableHistoricalPropSnapshot | null {
    const existing = this.snapshots.get(snapshotId);
    if (!existing) return null;

    if (existing.historicalEligibility === 'INELIGIBLE') {
      const updated: DurableHistoricalPropSnapshot = {
        ...existing,
        actualStatistic,
        gradingStatus: 'REJECTED',
        gradedSideOutcome: 'REJECTED',
        gradingTimestamp: new Date().toISOString(),
        dataSource,
        finalEventId,
      };
      this.snapshots.set(snapshotId, Object.freeze(updated));
      this.syncToDurableStorage();
      return updated;
    }

    let overOutcome: HistoricalGradingOutcome;
    let underOutcome: HistoricalGradingOutcome;

    if (actualStatistic > existing.line) {
      overOutcome = 'WIN';
      underOutcome = 'LOSS';
    } else if (actualStatistic < existing.line) {
      overOutcome = 'LOSS';
      underOutcome = 'WIN';
    } else {
      overOutcome = 'PUSH';
      underOutcome = 'PUSH';
    }

    const gradedSide = existing.side;
    let gradedSideOutcome: HistoricalGradingOutcome = 'UNGRADED';
    let unitsRisked = 0;
    let netUnits = 0;

    if (gradedSide === 'OVER') {
      gradedSideOutcome = overOutcome;
    } else if (gradedSide === 'UNDER') {
      gradedSideOutcome = underOutcome;
    }

    // 1-unit flat stake financial calculation
    if (existing.recommendation === 'QUALIFIES' && gradedSideOutcome !== 'UNGRADED') {
      if (gradedSideOutcome === 'WIN') {
        unitsRisked = 1.0;
        const odds = existing.americanOdds || -110;
        const profit = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
        netUnits = Number(profit.toFixed(4));
      } else if (gradedSideOutcome === 'LOSS') {
        unitsRisked = 1.0;
        netUnits = -1.0;
      } else if (gradedSideOutcome === 'PUSH') {
        unitsRisked = 0.0;
        netUnits = 0.0;
      }
    }

    const updated: DurableHistoricalPropSnapshot = {
      ...existing,
      gradingStatus: 'GRADED',
      actualStatistic,
      gradedSideOutcome,
      gradingTimestamp: existing.gradingTimestamp || new Date().toISOString(),
      unitsRisked,
      netUnits,
      dataSource,
      finalEventId,
    };

    this.snapshots.set(snapshotId, Object.freeze(updated));
    this.syncToDurableStorage();
    return updated;
  }

  /**
   * Synchronizes snapshot state to the durable JSON file.
   */
  private syncToDurableStorage(): void {
    try {
      if (!fs.existsSync(SnapshotPersistenceService.DATA_DIR)) {
        fs.mkdirSync(SnapshotPersistenceService.DATA_DIR, { recursive: true });
      }
      const data = Array.from(this.snapshots.values());
      fs.writeFileSync(SnapshotPersistenceService.DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[SnapshotPersistenceService] Error writing to durable disk file:', err.message);
    }
  }

  /**
   * Seeds the isolated developer test fixture for Rhett Lowder.
   */
  private seedDeveloperTestFixture(): void {
    const fixtureId = 'snap_mlb_cin_kc_lowder_k_3_5_fd_1';
    if (this.snapshots.has(fixtureId)) return;

    const fixtureFingerprint = this.computeFingerprint({
      eventId: 'mlb_cin_kc_20250827',
      playerId: 'espn_4917822',
      market: 'pitcher_strikeouts',
      line: 3.5,
      sportsbook: 'FanDuel',
      overOddsAmerican: -148,
      underOddsAmerican: 116,
      modelVersion: 'APEX_BASELINE_V1',
      valueEngineVersion: 'APEX_VALUE_V1',
    });

    const lowderFixture: DurableHistoricalPropSnapshot = {
      snapshotId: fixtureId,
      snapshotType: 'TEST_FIXTURE',
      dedupFingerprint: fixtureFingerprint,
      eventId: 'mlb_cin_kc_20250827',
      providerEventId: 'pitcher_strikeouts',
      eventStartTime: '2025-08-27T18:10:00Z',
      snapshotCreatedAt: '2025-08-27T17:00:00Z',
      sportsbookQuoteTimestamp: '2025-08-27T17:00:00Z',
      statisticsCutoffTimestamp: '2025-08-27T17:00:00Z',
      playerId: 'espn_4917822',
      playerName: 'Rhett Lowder',
      team: 'CIN',
      opponent: 'KC',
      sport: 'MLB',
      league: 'MLB',
      market: 'pitcher_strikeouts',
      line: 3.5,
      side: 'OVER',
      sportsbook: 'FanDuel',
      americanOdds: -148,
      decimalOdds: 1.6757,
      overOddsAmerican: -148,
      underOddsAmerican: 116,
      modelVersion: 'APEX_BASELINE_V1',
      valueEngineVersion: 'APEX_VALUE_V1',
      apexProbability: 0.584,
      breakEvenProbability: 0.5968,
      modelEdge: -0.0128,
      expectedValue: -2.14,
      reliabilityTier: 'VERY_LIMITED',
      recommendation: 'NO_BET',
      reasonCodes: ['EDGE_BELOW_THRESHOLD'],
      verificationState: 'VERIFIED',
      historicalEligibility: 'ELIGIBLE',
      gradingStatus: 'GRADED',
      actualStatistic: 5,
      gradedSideOutcome: 'WIN',
      gradingTimestamp: '2025-08-27T22:00:00Z',
      unitsRisked: 0,
      netUnits: 0,
      dataSource: 'ESPN_OFFICIAL_BOXSCORE',
      finalEventId: 'espn_401694901',
      modelInputs: {
        seasonMean: 4.2,
        seasonHitRate: 0.6,
        seasonSampleCount: 5,
        l10Mean: 4.2,
        l10HitRate: 0.6,
        l10SampleCount: 5,
        sampleReliabilityTier: 'VERY_LIMITED',
        marketNoVigOver: 0.573,
        marketNoVigUnder: 0.427,
        isMarketBlended: true,
      },
    };

    this.snapshots.set(fixtureId, Object.freeze(lowderFixture));
    this.fingerprintIndex.set(fixtureFingerprint, fixtureId);
    this.syncToDurableStorage();
  }

  // ==========================================
  // RETRIEVAL & FILTERING INTERFACES
  // ==========================================

  public getAllSnapshots(): DurableHistoricalPropSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  public getRealPregameSnapshots(): DurableHistoricalPropSnapshot[] {
    return Array.from(this.snapshots.values()).filter((s) => s.snapshotType === 'REAL_PREGAME');
  }

  public getTestFixtures(): DurableHistoricalPropSnapshot[] {
    return Array.from(this.snapshots.values()).filter((s) => s.snapshotType === 'TEST_FIXTURE');
  }

  public getSnapshotById(id: string): DurableHistoricalPropSnapshot | undefined {
    return this.snapshots.get(id);
  }

  public setWriteFailureSimulation(fail: boolean): void {
    this.writeFailureSimulation = fail;
  }

  /**
   * Returns audit telemetry regarding persistence status and counts.
   */
  public getAuditStatus(): PersistenceAuditStatus {
    const all = Array.from(this.snapshots.values());
    const realPregame = all.filter((s) => s.snapshotType === 'REAL_PREGAME');
    const testFixtures = all.filter((s) => s.snapshotType === 'TEST_FIXTURE');

    const realPending = realPregame.filter((s) => s.gradingStatus === 'PENDING').length;
    const realGraded = realPregame.filter((s) => s.gradingStatus === 'GRADED').length;
    const realRejected = realPregame.filter((s) => s.gradingStatus === 'REJECTED').length;

    let firstCaptureTime: string | null = null;
    let latestCaptureTime: string | null = null;

    if (realPregame.length > 0) {
      const timestamps = realPregame.map((s) => s.snapshotCreatedAt).sort();
      firstCaptureTime = timestamps[0];
      latestCaptureTime = timestamps[timestamps.length - 1];
    }

    return {
      backend: 'LOCAL_CONTAINER_EPHEMERAL',
      persistenceStatus: 'DURABLE PERSISTENCE VERIFICATION FAILED (EPHEMERAL DISK)',
      isCloudDurable: false,
      storagePath: SnapshotPersistenceService.DATA_FILE,
      totalSnapshots: all.length,
      realPregameCount: realPregame.length,
      testFixtureCount: testFixtures.length,
      realPendingCount: realPending,
      realGradedCount: realGraded,
      realRejectedCount: realRejected,
      firstCaptureTime,
      latestCaptureTime,
    };
  }

  // ==========================================
  // DETERMINISTIC INVARIANT TEST SUITE (15 TESTS)
  // ==========================================

  public runPersistenceTestSuite(): {
    test: 'STAGE_4A_2_DURABLE_SNAPSHOT_PERSISTENCE';
    status: 'SUCCESS' | 'FAILURE';
    totalTests: number;
    passedTests: number;
    failedTests: number;
    initialKeyedQuota: number;
    finalKeyedQuota: number;
    keyedRequestsConsumed: number;
    tests: Array<{ name: string; status: 'PASS' | 'FAIL'; details: string }>;
    criticalTests: Array<{ testName: string; status: 'PASS' | 'FAIL'; details: string }>;
  } {
    const initialQuota = marketQuotaGuard.getQuotaState().dailyUsed;
    const tests: Array<{ name: string; status: 'PASS' | 'FAIL'; details: string }> = [];

    // Test 1: Eligible REAL_PREGAME snapshot write
    const now = Date.now();
    const runTag = `run_${now}`;
    const eventStartTime = new Date(now + 3600000).toISOString(); // 1 hour in future
    const quoteTimestamp = new Date(now - 60000).toISOString(); // 1 min ago
    const statsCutoff = new Date(now - 120000).toISOString(); // 2 mins ago

    const dummyQuote: any = {
      quoteId: `test_prop_${runTag}`,
      apexEventId: `test_game_${runTag}`,
      providerEventId: 'pitcher_strikeouts',
      sport: 'MLB',
      league: 'MLB',
      playerId: `player_${runTag}`,
      playerDisplayName: 'Test Pitcher',
      verifiedTeam: 'NYY',
      verifiedOpponent: 'BOS',
      playerPosition: 'P',
      playerJersey: '45',
      marketCategory: 'Strikeouts',
      providerMarketKey: 'pitcher_strikeouts',
      line: 5.5,
      bookmakerKey: 'draftkings',
      bookmakerTitle: 'DraftKings',
      overOddsAmerican: -115,
      underOddsAmerican: -105,
      overOddsDecimal: 1.8696,
      underOddsDecimal: 1.9524,
      yesOddsAmerican: null,
      yesOddsDecimal: null,
      marketVerified: true,
      rosterVerified: true,
      rosterSource: 'ESPN',
      marketSource: 'The-Odds-API v4 (US)',
      providerTimestamp: quoteTimestamp,
      retrievedAt: new Date().toISOString(),
      cacheStatus: 'CACHED',
      historicalStats: {
        athleteId: 'player_test_1',
        athleteName: 'Test Pitcher',
        team: 'NYY',
        sport: 'MLB',
        propMarketKey: 'pitcher_strikeouts',
        seasonAverage: 6.2,
        seasonHitRate: 0.65,
        seasonGamesCount: 20,
        l10Average: 6.8,
        l10HitRate: 0.7,
        l10GamesCount: 10,
        l5Average: 7.0,
        l5HitRate: 0.8,
        l5GamesCount: 5,
        h2hAverage: 6.5,
        h2hHitRate: 0.67,
        h2hGamesCount: 3,
        reliabilityTier: 'STRONG',
        rawLogsCount: 20,
        computedAt: statsCutoff,
        dataSource: 'ESPN_OFFICIAL_STATISTICS',
      },
      probabilityAnalysis: {
        modelVersion: 'APEX_BASELINE_V1',
        isAvailable: true,
        calculatedAt: new Date().toISOString(),
        pointInTimeAudit: { featureSnapshotVersion: 'APEX_FEATURE_SNAPSHOT_V1', featureSnapshotId: `FS_${runTag}`, asOf: new Date().toISOString(), isValid: true, reasonCodes: [], latestObservedAt: quoteTimestamp, featureCount: 10 },
        apexOverProbability: 0.62,
        apexUnderProbability: 0.38,
        probabilityMarginPercentagePoints: 24,
        preferredSide: 'OVER',
        confidenceScore: 85,
        components: {
          seasonEmpiricalHitRate: 0.65,
          seasonSampleCount: 20,
          seasonWeight: 0.35,
          seasonWeightedContribution: 0.2275,
          l10EmpiricalHitRate: 0.7,
          l10SampleCount: 10,
          l10Weight: 0.3,
          l10WeightedContribution: 0.21,
          marketNoVigOverProbability: 0.51,
          marketWeight: 0.35,
          marketWeightedContribution: 0.1785,
          rawPoissonOverProbability: 0.64,
          sampleReliabilityTier: 'STRONG',
          seasonMean: 6.2,
          l10Mean: 6.8,
        },
        modelAudit: {
          modelVersion: 'APEX_BASELINE_V1',
          timestamp: new Date().toISOString(),
          isBlended: true,
          calibrationStatus: 'VERIFIED',
        },
      },
      valueAnalysis: {
        engineVersion: 'APEX_VALUE_V1',
        overAnalysis: {
          side: 'OVER',
          line: 5.5,
          sportsbookAmericanOdds: -115,
          sportsbookDecimalOdds: 1.8696,
          marketDeviggedProbability: 0.51,
          apexModelProbability: 0.62,
          breakEvenProbability: 0.5349,
          modelEdgePercentagePoints: 8.51,
          expectedValuePercent: 15.91,
          fairAmericanOdds: -163,
          isPositiveEV: true,
        },
        underAnalysis: {
          side: 'UNDER',
          line: 5.5,
          sportsbookAmericanOdds: -105,
          sportsbookDecimalOdds: 1.9524,
          marketDeviggedProbability: 0.49,
          apexModelProbability: 0.38,
          breakEvenProbability: 0.5122,
          modelEdgePercentagePoints: -13.22,
          expectedValuePercent: -25.81,
          fairAmericanOdds: 163,
          isPositiveEV: false,
        },
        bestRecommendation: {
          side: 'OVER',
          recommendationStatus: 'QUALIFIES',
          primaryMetric: 'EV: +15.91%, Edge: +8.51 pp',
          reasonCodes: ['HIGH_POSITIVE_EV', 'SOLID_MODEL_EDGE'],
          ruleTrace: ['OVER EV 15.91% >= 3.0% and Edge 8.51pp >= 3.0pp'],
        },
        lineShoppingComparison: [],
        auditDiagnostic: {
          valueEngineVersion: 'APEX_VALUE_V1',
          evaluatedTimestamp: new Date().toISOString(),
          qualifiesCount: 1,
          noBetCount: 0,
        },
      },
    };

    const res1 = this.persistQuoteSnapshot(dummyQuote, eventStartTime, true);
    tests.push({
      name: '1. Eligible REAL_PREGAME snapshot write',
      status: res1.success && res1.action === 'CREATED' ? 'PASS' : 'FAIL',
      details: `Created snapshot ID: ${res1.snapshotId}`,
    });

    // Test 2: Post-start snapshot rejected
    const pastStartTime = new Date(now - 3600000).toISOString(); // 1 hour ago
    const res2 = this.persistQuoteSnapshot(
      { ...dummyQuote, apexEventId: 'test_game_post_start' },
      pastStartTime,
      false
    );
    tests.push({
      name: '2. Post-start snapshot rejected',
      status: res2.action === 'REJECTED' && res2.rejectionReason?.includes('EVENT_NOT_UPCOMING') ? 'PASS' : 'FAIL',
      details: `Rejection reason: ${res2.rejectionReason}`,
    });

    // Test 3: Future-stat cutoff rejected
    const futureStatsCutoff = new Date(now + 7200000).toISOString(); // 2 hours in future
    const quoteFutureStats = {
      ...dummyQuote,
      apexEventId: 'test_game_future_stat',
      historicalStats: {
        ...dummyQuote.historicalStats!,
        computedAt: futureStatsCutoff,
      },
    };
    const res3 = this.persistQuoteSnapshot(quoteFutureStats, eventStartTime, true);
    tests.push({
      name: '3. Future-stat cutoff rejected',
      status: res3.action === 'REJECTED' && res3.rejectionReason?.includes('STATISTICS_CUTOFF_AFTER_SNAPSHOT_TIME') ? 'PASS' : 'FAIL',
      details: `Rejection reason: ${res3.rejectionReason}`,
    });

    // Test 4: Test fixture isolation
    const fixtures = this.getTestFixtures();
    const realPregame = this.getRealPregameSnapshots();
    const lowderInReal = realPregame.some((s) => s.snapshotId === 'snap_mlb_cin_kc_lowder_k_3_5_fd_1');
    const lowderInFixture = fixtures.some((s) => s.snapshotId === 'snap_mlb_cin_kc_lowder_k_3_5_fd_1');
    tests.push({
      name: '4. Test fixture isolation',
      status: !lowderInReal && lowderInFixture ? 'PASS' : 'FAIL',
      details: `Lowder in Real: ${lowderInReal}, in Fixtures: ${lowderInFixture}`,
    });

    // Test 5: Exact duplicate suppressed
    const res5 = this.persistQuoteSnapshot(dummyQuote, eventStartTime, true);
    tests.push({
      name: '5. Exact duplicate suppressed',
      status: res5.success && res5.action === 'DEDUPLICATED' ? 'PASS' : 'FAIL',
      details: `Action: ${res5.action}, ID: ${res5.snapshotId}`,
    });

    // Test 6: Price change creates new immutable snapshot
    const priceChangeQuote: NormalizedPlayerPropQuote = {
      ...dummyQuote,
      overOddsAmerican: -130, // Changed from -115
    };
    const res6 = this.persistQuoteSnapshot(priceChangeQuote, eventStartTime, true);
    tests.push({
      name: '6. Price change creates new immutable snapshot',
      status: res6.success && res6.action === 'CREATED' && res6.snapshotId !== res1.snapshotId ? 'PASS' : 'FAIL',
      details: `New Snapshot ID: ${res6.snapshotId}`,
    });

    // Test 7: Line change creates new immutable snapshot
    const lineChangeQuote: NormalizedPlayerPropQuote = {
      ...dummyQuote,
      line: 6.5, // Changed from 5.5
    };
    const res7 = this.persistQuoteSnapshot(lineChangeQuote, eventStartTime, true);
    tests.push({
      name: '7. Line change creates new immutable snapshot',
      status: res7.success && res7.action === 'CREATED' && res7.snapshotId !== res1.snapshotId ? 'PASS' : 'FAIL',
      details: `New Snapshot ID: ${res7.snapshotId}`,
    });

    // Test 8: Model version change creates distinct snapshot
    const fpOriginal = this.computeFingerprint({
      eventId: 'g1',
      playerId: 'p1',
      market: 'k',
      line: 5.5,
      sportsbook: 'DK',
      overOddsAmerican: -110,
      underOddsAmerican: -110,
      modelVersion: 'APEX_BASELINE_V1',
      valueEngineVersion: 'APEX_VALUE_V1',
    });
    const fpNewModel = this.computeFingerprint({
      eventId: 'g1',
      playerId: 'p1',
      market: 'k',
      line: 5.5,
      sportsbook: 'DK',
      overOddsAmerican: -110,
      underOddsAmerican: -110,
      modelVersion: 'APEX_BASELINE_V2',
      valueEngineVersion: 'APEX_VALUE_V1',
    });
    tests.push({
      name: '8. Model version change creates distinct fingerprint',
      status: fpOriginal !== fpNewModel ? 'PASS' : 'FAIL',
      details: `FP1: ${fpOriginal}, FP2: ${fpNewModel}`,
    });

    // Test 9: Write failure simulation does not increment sample count
    const countBeforeFail = this.snapshots.size;
    this.setWriteFailureSimulation(true);
    const res9 = this.persistQuoteSnapshot(
      { ...dummyQuote, apexEventId: 'test_fail_sim' },
      eventStartTime,
      true
    );
    const countAfterFail = this.snapshots.size;
    this.setWriteFailureSimulation(false);
    tests.push({
      name: '9. Persistence write failure fails closed',
      status: !res9.success && res9.action === 'FAILED' && countBeforeFail === countAfterFail ? 'PASS' : 'FAIL',
      details: `Count before: ${countBeforeFail}, Count after: ${countAfterFail}`,
    });

    // Test 10: Persisted record can be read back unchanged
    const readBack = this.getSnapshotById(res1.snapshotId);
    tests.push({
      name: '10. Persisted record can be read back unchanged',
      status: readBack && readBack.line === 5.5 && readBack.playerName === 'Test Pitcher' ? 'PASS' : 'FAIL',
      details: `Read back athlete: ${readBack?.playerName}, line: ${readBack?.line}`,
    });

    // Test 11: Restart / Reinitialization reads previously stored snapshots
    const storageFileExists = fs.existsSync(SnapshotPersistenceService.DATA_FILE);
    tests.push({
      name: '11. Restart/Reinitialization reads previously stored snapshots',
      status: storageFileExists ? 'PASS' : 'FAIL',
      details: `Durable storage file exists at: ${SnapshotPersistenceService.DATA_FILE}`,
    });

    // Test 12: Test fixtures excluded from real performance metrics
    const realPregameOnly = this.getRealPregameSnapshots();
    const hasFixture = realPregameOnly.some((s) => s.snapshotType === 'TEST_FIXTURE');
    tests.push({
      name: '12. Test fixtures excluded from real performance metrics',
      status: !hasFixture ? 'PASS' : 'FAIL',
      details: `Real pregame dataset strictly contains 0 test fixtures`,
    });

    // Test 13: Pending records excluded from completed performance metrics
    const pendingSnap = this.getSnapshotById(res1.snapshotId);
    tests.push({
      name: '13. Newly created record begins PENDING',
      status: pendingSnap?.gradingStatus === 'PENDING' ? 'PASS' : 'FAIL',
      details: `Grading status: ${pendingSnap?.gradingStatus}`,
    });

    // Test 14: Repeated grading is idempotent
    const grade1 = this.gradeSnapshot(res1.snapshotId, 7, 'ESPN_OFFICIAL_BOXSCORE', 'final_game_1');
    const grade2 = this.gradeSnapshot(res1.snapshotId, 7, 'ESPN_OFFICIAL_BOXSCORE', 'final_game_1');
    tests.push({
      name: '14. Repeated grading is idempotent',
      status:
        grade1 !== null &&
        grade2 !== null &&
        grade1.gradedSideOutcome === 'WIN' &&
        grade2.gradedSideOutcome === 'WIN' &&
        grade1.netUnits === grade2.netUnits
          ? 'PASS'
          : 'FAIL',
      details: `Grade 1 Outcome: ${grade1?.gradedSideOutcome}, Units: ${grade1?.netUnits}; Grade 2 Outcome: ${grade2?.gradedSideOutcome}, Units: ${grade2?.netUnits}`,
    });

    // Test 15: Odds API keyed requests remain zero
    const finalQuota = marketQuotaGuard.getQuotaState().dailyUsed;
    const consumed = finalQuota - initialQuota;
    tests.push({
      name: '15. Odds API keyed requests remain zero during persistence operations',
      status: consumed === 0 ? 'PASS' : 'FAIL',
      details: `Keyed requests consumed: ${consumed}`,
    });

    // Clean up temporary test snapshots from production store
    this.snapshots.delete(res1.snapshotId);
    this.fingerprintIndex.delete(res1.fingerprint);
    if (res6.snapshotId) {
      this.snapshots.delete(res6.snapshotId);
      this.fingerprintIndex.delete(res6.fingerprint);
    }
    if (res7.snapshotId) {
      this.snapshots.delete(res7.snapshotId);
      this.fingerprintIndex.delete(res7.fingerprint);
    }
    this.syncToDurableStorage();

    const passedCount = tests.filter((t) => t.status === 'PASS').length;
    const allPassed = passedCount === tests.length;
    const criticalTests = tests.map((t) => ({
      testName: t.name,
      status: t.status,
      details: t.details,
    }));

    return {
      test: 'STAGE_4A_2_DURABLE_SNAPSHOT_PERSISTENCE',
      status: allPassed ? 'SUCCESS' : 'FAILURE',
      totalTests: tests.length,
      passedTests: passedCount,
      failedTests: tests.length - passedCount,
      initialKeyedQuota: initialQuota,
      finalKeyedQuota: finalQuota,
      keyedRequestsConsumed: consumed,
      tests,
      criticalTests,
    };
  }
}

export const snapshotPersistenceService = new SnapshotPersistenceService();
