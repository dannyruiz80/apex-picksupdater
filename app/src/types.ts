export interface HealthResponse {
  status: string;
  app: string;
}

export interface VersionResponse {
  version: string;
  build: string;
  environment: string;
  timestamp: string;
}

export type ApexSport = 'MLB' | 'NFL' | 'NBA' | 'WNBA' | 'NHL' | 'SOCCER' | 'TENNIS';

export type ApexSportFilter = 'ALL' | 'MLB' | 'NFL' | 'NBA' | 'WNBA' | 'NHL' | 'SOCCER' | 'TENNIS';

export type TennisTour = 'ATP' | 'WTA';

export type TennisTourFilter = 'ALL' | 'ATP' | 'WTA';

export interface TennisSetScore {
  setNumber: number;
  scoreA: number;
  scoreB: number;
  tiebreakA?: number | null;
  tiebreakB?: number | null;
}

export type ApexGameStatus =
  | 'UPCOMING'
  | 'LIVE'
  | 'FINAL'
  | 'POSTPONED'
  | 'SUSPENDED'
  | 'CANCELLED';

export interface NormalizedApexGame {
  eventId: string;
  sport: ApexSport;
  league: string;
  competition?: string | null;
  scheduleDate: string;
  startTime: string;
  awayTeamId: string | null;
  awayTeam: string | null;
  awayAbbreviation: string | null;
  homeTeamId: string | null;
  homeTeam: string | null;
  homeAbbreviation: string | null;
  status: ApexGameStatus;
  statusDetail: string;
  awayScore: number | null;
  homeScore: number | null;
  
  // Team sport period / clock details
  period?: number | null;
  periodType?: 'quarter' | 'period' | 'inning' | 'half' | null;
  displayClock?: string | null;
  inning?: number | null; // MLB specific
  inningState?: string | null; // MLB Top/Bottom/Mid/End

  // Soccer specific normalized details
  matchClock?: string | null;
  stoppageTime?: string | null;
  extraTime?: boolean;
  penalties?: {
    homeShootoutScore: number | null;
    awayShootoutScore: number | null;
  } | null;
  aggregateScore?: {
    homeAggregate: number | null;
    awayAggregate: number | null;
    note?: string | null;
  } | null;

  // Tennis specific normalized details (Tournament -> Match -> Player A vs Player B)
  tour?: TennisTour | null;
  tournamentId?: string | number | null;
  tournamentName?: string | null;
  round?: string | null;
  court?: string | null;
  surface?: string | null; // only when verified
  playerAId?: string | null;
  playerAName?: string | null;
  playerACountry?: string | null;
  playerBId?: string | null;
  playerBName?: string | null;
  playerBCountry?: string | null;
  setsWonA?: number | null;
  setsWonB?: number | null;
  setScores?: TennisSetScore[] | null;
  currentSet?: number | null;
  winner?: 'A' | 'B' | null;

  venue: string | null;
  source: 'ESPN';
  lastVerifiedAt: string;
}

export interface NormalizedLiveScoreUpdate {
  eventId: string;
  sport: ApexSport;
  status: ApexGameStatus;
  statusDetail: string;
  homeScore: number | null;
  awayScore: number | null;
  period?: number | null;
  periodType?: 'quarter' | 'period' | 'inning' | 'half' | null;
  displayClock?: string | null;
  inning?: number | null;
  inningState?: string | null;
  matchClock?: string | null;
  stoppageTime?: string | null;
  extraTime?: boolean;
  penalties?: {
    homeShootoutScore: number | null;
    awayShootoutScore: number | null;
  } | null;
  aggregateScore?: {
    homeAggregate: number | null;
    awayAggregate: number | null;
    note?: string | null;
  } | null;
  
  // Tennis live details
  tour?: TennisTour | null;
  setsWonA?: number | null;
  setsWonB?: number | null;
  setScores?: TennisSetScore[] | null;
  currentSet?: number | null;
  winner?: 'A' | 'B' | null;

  lastVerifiedAt: string;
}

export interface ScheduleResponse {
  sport: ApexSportFilter;
  scheduleDate: string;
  source: 'ESPN';
  lastVerifiedAt: string;
  count: number;
  games: NormalizedApexGame[];
}

export interface LiveScoresResponse {
  sport: ApexSportFilter;
  source: 'ESPN';
  lastVerifiedAt: string;
  count: number;
  liveCount: number;
  games: NormalizedLiveScoreUpdate[];
}

export interface SportAuditDiagnostic {
  sport: ApexSport;
  sourceName: string;
  sourceStatus: 'OPERATIONAL' | 'DEGRADED' | 'ERROR' | 'UNINITIALIZED';
  lastScheduleFetch: {
    timestamp: string | null;
    requestedDate: string | null;
    gamesRetrieved: number;
    upcomingCount: number;
    liveCount: number;
    finalCount: number;
    postponedCount: number;
    durationMs: number | null;
    competitionCounts?: Record<string, number>;
  };
  lastLiveScoreFetch: {
    timestamp: string | null;
    gamesUpdated: number;
    liveCount: number;
    durationMs: number | null;
  };
  recentErrors: Array<{
    timestamp: string;
    endpoint: string;
    message: string;
  }>;
}

export interface TennisAuditDiagnostic {
  sport: 'TENNIS';
  sourceName: string;
  sourceStatus: 'OPERATIONAL' | 'DEGRADED' | 'ERROR' | 'UNINITIALIZED';
  atpSourceStatus: 'OPERATIONAL' | 'DEGRADED' | 'ERROR' | 'UNINITIALIZED';
  wtaSourceStatus: 'OPERATIONAL' | 'DEGRADED' | 'ERROR' | 'UNINITIALIZED';
  lastScheduleFetch: {
    timestamp: string | null;
    requestedDate: string | null;
    gamesRetrieved: number;
    tournamentsDiscovered: number;
    atpCount: number;
    wtaCount: number;
    upcomingCount: number;
    liveCount: number;
    finalCount: number;
    postponedCount: number;
    parserFailures: number;
    durationMs: number | null;
  };
  lastLiveScoreFetch: {
    timestamp: string | null;
    gamesUpdated: number;
    liveCount: number;
    durationMs: number | null;
  };
  lastSuccessfulAtpRefresh: string | null;
  lastSuccessfulWtaRefresh: string | null;
  parserFailures: number;
  recentErrors: Array<{
    timestamp: string;
    endpoint: string;
    message: string;
  }>;
}

export interface MultiSportAuditDiagnostics {
  timestamp: string;
  overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'ERROR' | 'UNINITIALIZED';
  sports: {
    MLB: SportAuditDiagnostic;
    NFL: SportAuditDiagnostic;
    NBA: SportAuditDiagnostic;
    WNBA: SportAuditDiagnostic;
    NHL: SportAuditDiagnostic;
    SOCCER: SportAuditDiagnostic;
    TENNIS: TennisAuditDiagnostic;
  };
}

export interface MlbAuditDiagnostics extends SportAuditDiagnostic {}

// ==========================================
// STAGE 3A: MARKET PROVIDER & COST PROTECTION
// ==========================================

export type MarketType = 'MONEYLINE' | 'SPREAD' | 'TOTAL';

export interface NormalizedMarketOutcome {
  name: string; // Selection name e.g. "Kansas City Chiefs", "Over", "Carlos Alcaraz"
  price: number; // Raw price from provider
  americanOdds: number; // e.g. -110, +135
  decimalOdds: number; // e.g. 1.91, 2.35
  point?: number | null; // Spread or Total line e.g. -3.5, 47.5
}

export interface NormalizedMarketItem {
  key: 'h2h' | 'spreads' | 'totals';
  marketType: MarketType;
  lastUpdate: string;
  outcomes: NormalizedMarketOutcome[];
}

export interface NormalizedBookmakerMarkets {
  key: string;
  title: string;
  lastUpdate: string;
  markets: NormalizedMarketItem[];
}

export interface NormalizedApexEventMarkets {
  apexEventId: string;
  providerEventId: string;
  sport: ApexSport;
  league: string;
  homeTeamOrPlayerA: string;
  awayTeamOrPlayerB: string;
  scheduledDate: string;
  bookmakers: NormalizedBookmakerMarkets[];
  retrievedAt: string;
  cacheStatus: 'HIT' | 'MISS' | 'DEDUPED';
  source: string;
}

export type MarketProviderStatus =
  | 'NOT_CONFIGURED'
  | 'OPERATIONAL'
  | 'WARNING'
  | 'CRITICAL'
  | 'HARD_STOP_DAILY'
  | 'HARD_STOP_MONTHLY'
  | 'UNVERIFIED_STATE'
  | 'ERROR';

export interface MarketQuotaState {
  providerConfigured: boolean;
  providerName: string;
  status: MarketProviderStatus;
  statusMessage: string;
  budgetTimezone: 'America/Chicago';
  
  // Daily Tracking (America/Chicago)
  dailyDate: string; // YYYY-MM-DD
  dailyUsed: number;
  dailyHardLimit: number; // 500
  dailyRemaining: number;
  dailyWarningThreshold: number; // 400
  dailyCriticalThreshold: number; // 475
  
  // Monthly Tracking (America/Chicago)
  monthlyDate: string; // YYYY-MM
  monthlyUsed: number;
  monthlyHardLimit: number; // 20,000
  monthlyRemaining: number;

  // Provider Reported Headers
  providerReportedUsed: number | null;
  providerReportedRemaining: number | null;
  providerLastCost: number | null;
  lastReconciledAt: string | null;

  // Health
  lastSuccessfulRequestAt: string | null;
  lastError: {
    timestamp: string;
    message: string;
    statusCode?: number;
  } | null;
}

export interface MarketCacheStats {
  cacheHits: number;
  cacheMisses: number;
  duplicateRequestsPrevented: number;
  activeEntriesCount: number;
}

export interface MarketMatchingStats {
  providerEventsRetrieved: number;
  successfullyMatched: number;
  rejected: number;
  ambiguous: number;
  bySport: Record<
    ApexSport,
    {
      retrieved: number;
      matched: number;
      rejected: number;
      ambiguous: number;
    }
  >;
  recentRejections: Array<{
    timestamp: string;
    sport: ApexSport;
    reason: string;
    providerEvent: string;
    closestApexCandidate?: string;
  }>;
}

export interface MarketProviderAuditDiagnostic {
  quota: MarketQuotaState;
  cache: MarketCacheStats;
  matching: MarketMatchingStats;
  discovery: {
    lastDiscoveredAt: string | null;
    activeSportKeysCount: number;
    activeTennisTournaments: string[];
    activeSoccerCompetitions: string[];
  };
}

// ==========================================
// STAGE 3B: PROVIDER-FIRST PLAYER PROPS
// ==========================================

export interface NormalizedPlayerPropOutcome {
  outcomeType: 'OVER' | 'UNDER' | 'YES' | 'NO';
  americanOdds: number;
  decimalOdds: number;
  point?: number | null;
}

export interface NormalizedPlayerPropQuote {
  quoteId: string;
  apexEventId: string;
  providerEventId: string;
  sport: ApexSport;
  league: string;
  
  // Verified Player Identity
  playerId: string | null;
  playerDisplayName: string;
  verifiedTeam: string;
  verifiedOpponent: string;
  teamVenueRole?: 'HOME' | 'AWAY' | null;
  playerPosition?: string | null;
  playerJersey?: string | null;
  
  // Market Info
  marketCategory: string; // e.g. "Strikeouts", "Home Runs", "Passing Yards", "Points"
  providerMarketKey: string; // e.g. "pitcher_strikeouts", "batter_home_runs"
  line: number; // e.g. 5.5, 0.5, 24.5
  
  // Sportsbook & Pricing
  bookmakerKey: string; // e.g. "draftkings", "fanduel", "betmgm"
  bookmakerTitle: string; // e.g. "DraftKings", "FanDuel", "BetMGM"
  overOddsAmerican: number | null;
  overOddsDecimal: number | null;
  underOddsAmerican: number | null;
  underOddsDecimal: number | null;
  yesOddsAmerican?: number | null;
  yesOddsDecimal?: number | null;
  
  // Verification Badges & Provenance
  marketVerified: boolean;
  rosterVerified: boolean;
  rosterSource: string; // e.g. "ESPN Team Roster", "Tournament Draw Participant"
  marketSource: string; // e.g. "The-Odds-API v4 (US)"
  
  providerTimestamp: string;
  retrievedAt: string;
  cacheStatus: 'HIT' | 'MISS' | 'IN_FLIGHT';
  eventStatus?: string | null;
  eventStartTime?: string | null;

  // Stage 3C-1: Historical Performance & Statistics Enrichment
  historicalStats?: PlayerHistoricalStatsSummary | null;

  // MLB Pitcher K V3: public-data context. Missing fields remain null; no synthetic fallback.
  mlbPitcherKContext?: MlbPitcherKAdvancedContextV1 | null;

  // Stage 3C-2: Transparent Probability Model
  probabilityAnalysis?: ApexProbabilityResult | null;

  // Stage 3C-3: Edge, EV, Line Shopping & Recommendation Engine
  valueAnalysis?: PropValueAnalysis | null;
}

export type RecommendationStatus = 'QUALIFIES' | 'NO_BET';

export type ReasonCode =
  | 'NEGATIVE_EV'
  | 'EDGE_BELOW_THRESHOLD'
  | 'EV_BELOW_THRESHOLD'
  | 'INSUFFICIENT_DATA'
  | 'MODEL_UNAVAILABLE'
  | 'MARKET_UNVERIFIED'
  | 'PLAYER_UNVERIFIED'
  | 'STATS_UNAVAILABLE'
  | 'RELIABILITY_BELOW_MINIMUM'
  | 'INVALID_PROBABILITY'
  | 'PROVENANCE_INCOMPLETE'
  | 'STALE_PRICE'
  | 'EVENT_NOT_PREGAME'
  | 'POINT_IN_TIME_INVALID';

export interface RecommendationThresholds {
  minReliabilityTier: SampleReliabilityTier; // Default: 'MODERATE'
  minModelEdge: number; // Default: 0.03 (+3.0 percentage points)
  minEVPercent: number; // Default: 3.0 (+3.0%)
  positiveEVRequired: boolean; // Default: true
  maxQuoteAgeMs?: number; // Default: 10 minutes
  label: string; // "BASELINE RECOMMENDATION THRESHOLDS — NOT YET BACKTEST OPTIMIZED"
}

export interface SideValueAnalysis {
  side: 'OVER' | 'UNDER';
  line: number;
  sportsbook: string;
  oddsAmerican: number | null;
  oddsDecimal: number | null;
  apexProbability: number | null; // 0.0 - 1.0 (e.g. 0.5162)
  breakEvenProbability: number | null; // 0.0 - 1.0 (e.g. 0.5968)
  modelEdge: number | null; // apexProbability - breakEvenProbability (e.g. -0.0806)
  modelEdgePercentagePoints: number | null; // -8.06 pp
  expectedValue: number | null; // -0.1350 per 1-unit stake
  expectedValuePercent: number | null; // -13.50%
  netProfitIfWin: number | null; // decimalOdds - 1
  isBestAvailablePrice: boolean;
  bestSportsbook: string;
  bestOddsAmerican: number | null;
  bestOddsDecimal: number | null;
  recommendationStatus: RecommendationStatus;
  reasonCodes: ReasonCode[];
  gateMath: {
    minReliabilityMet: boolean;
    minEdgeMet: boolean;
    minEVMet: boolean;
    positiveEVMet: boolean;
    allVerificationsMet: boolean;
    probabilityValid?: boolean;
    provenanceComplete?: boolean;
    quoteFresh?: boolean;
    pregameEligible?: boolean;
    pointInTimeValid?: boolean;
  };
}

export interface LineShoppingComparison {
  exactLine: number;
  bestOverQuote: {
    sportsbook: string;
    oddsAmerican: number;
    oddsDecimal: number;
  } | null;
  bestUnderQuote: {
    sportsbook: string;
    oddsAmerican: number;
    oddsDecimal: number;
  } | null;
  availableBookmakers: Array<{
    sportsbook: string;
    line: number;
    overOddsAmerican: number | null;
    overOddsDecimal: number | null;
    underOddsAmerican: number | null;
    underOddsDecimal: number | null;
  }>;
}

export interface PropValueAnalysis {
  engineVersion: string; // "APEX_VALUE_V1"
  thresholdsLabel: string; // "BASELINE RECOMMENDATION THRESHOLDS — NOT YET BACKTEST OPTIMIZED"
  targetLine: number;
  overAnalysis: SideValueAnalysis | null;
  underAnalysis: SideValueAnalysis | null;
  bestRecommendation: {
    side: 'OVER' | 'UNDER' | null;
    recommendationStatus: RecommendationStatus;
    reasonCodes: ReasonCode[];
    selectedAnalysis: SideValueAnalysis | null;
  };
  lineShopping: LineShoppingComparison;
  thresholds: RecommendationThresholds;
  calculatedAt: string;
  predictionContracts?: Array<import('./server/predictionContract').PredictionContractV1>;
}

export interface ValueAuditTelemetry {
  totalEvaluations: number;
  qualifiesCount: number;
  noBetCount: number;
  reasonCodeCounts: Record<ReasonCode, number>;
  bySport: Record<
    ApexSport,
    {
      evaluations: number;
      qualifies: number;
      noBet: number;
    }
  >;
  lastEvaluatedAt: string;
}

export interface ValueVerifyResponse {
  allPassed: boolean;
  verificationTimestamp: string;
  keyedRequestsConsumed: number;
  engineVersion: string;
  validationCase: {
    player: string;
    sport: ApexSport;
    team: string;
    marketCategory: string;
    targetLine: number;
    sportsbook: string;
    // Over evaluation
    overOddsAmerican: number;
    overOddsDecimal: number;
    apexOverProbability: number;
    overBreakEvenProbability: number;
    overModelEdgePp: number;
    overNetProfit: number;
    overEVPercent: number;
    overRecommendation: RecommendationStatus;
    overReasonCodes: ReasonCode[];
    // Under evaluation
    underOddsAmerican: number;
    underOddsDecimal: number;
    apexUnderProbability: number;
    underBreakEvenProbability: number;
    underModelEdgePp: number;
    underNetProfit: number;
    underEVPercent: number;
    underRecommendation: RecommendationStatus;
    underReasonCodes: ReasonCode[];
    // Decision outcome
    finalDecision: RecommendationStatus;
    finalSide: 'OVER' | 'UNDER' | null;
    finalReasonCodes: ReasonCode[];
    thresholds: RecommendationThresholds;
  };
  criticalTests: Array<{
    testName: string;
    status: 'PASS' | 'FAIL';
    details: string;
  }>;
}

export type SampleReliabilityTier = 'VERY_LIMITED' | 'LIMITED' | 'MODERATE' | 'STRONG';

export interface MarketImpliedProbability {
  sportsbook: string;
  overOddsAmerican: number | null;
  underOddsAmerican: number | null;
  overOddsDecimal: number | null;
  underOddsDecimal: number | null;
  rawOverImplied: number | null; // 0.0 - 1.0 (e.g. 0.5968)
  rawUnderImplied: number | null; // 0.0 - 1.0 (e.g. 0.4630)
  bookmakerVig: number | null; // Total vig / hold (e.g. 0.0598 = 5.98%)
  noVigOverProbability: number | null; // Normalized 0.0 - 1.0 (e.g. 0.5631)
  noVigUnderProbability: number | null; // Normalized 0.0 - 1.0 (e.g. 0.4369)
  isSingleSided: boolean;
}

export interface ProbabilityComponentBreakdown {
  seasonBaselineOver: number;
  seasonEmpiricalHitRate: number;
  seasonDistributionEstimate: number;
  seasonMean: number;
  seasonStdDev: number;
  seasonSampleCount: number;

  l10Adjustment: number;
  l10EmpiricalHitRate: number;
  l10SampleCount: number;
  l10Weight: number;

  l5Adjustment: number;
  l5EmpiricalHitRate: number;
  l5SampleCount: number;
  l5Weight: number;

  historicalOverProbability: number;
  marketNoVigOverProbability: number;

  sampleReliabilityTier: SampleReliabilityTier;
  sampleReliabilityFactor: number;
  historicalWeight: number;
  marketWeight: number;

  rawBlendedOverProbability: number;
  boundsApplied: boolean;
  clampedMinBound: number;
  clampedMaxBound: number;

  isIntegerLine: boolean;
  pushProbability: number;
}

export type ProbabilityCalibrationStatus =
  | 'ACTIVE'
  | 'INSUFFICIENT_EVIDENCE'
  | 'VALIDATION_NOT_IMPROVED'
  | 'UNAVAILABLE';

export interface ProbabilityCalibrationInfo {
  calibrationVersion: 'APEX_PLATT_V1';
  status: ProbabilityCalibrationStatus;
  fittedAsOf: string;
  trainingSnapshots: number;
  trainingObservations: number;
  validationSnapshots: number;
  rawValidationLogLoss: number | null;
  calibratedValidationLogLoss: number | null;
  rawValidationBrier: number | null;
  calibratedValidationBrier: number | null;
  slope: number | null;
  intercept: number | null;
  reason: string | null;
}

export interface PointInTimeFeatureAudit {
  featureSnapshotVersion: 'APEX_FEATURE_SNAPSHOT_V1';
  featureSnapshotId: string;
  asOf: string;
  isValid: boolean;
  reasonCodes: string[];
  latestObservedAt: string | null;
  featureCount: number;
}

export type MlbPitcherKV3DataQuality = 'UNAVAILABLE' | 'CORE_VERIFIED' | 'ENRICHED';
export type MlbPitcherKBoostedStatus = 'INSUFFICIENT_EVIDENCE' | 'REJECTED_VALIDATION' | 'ACTIVE_SHADOW';

export interface MlbPitcherKAdvancedContextV1 {
  contextVersion: 'APEX_MLB_K_CONTEXT_V1';
  observedAt: string;
  sourceStatus: {
    mlbStats: 'AVAILABLE' | 'UNAVAILABLE';
    statcast: 'AVAILABLE' | 'UNAVAILABLE';
    gameEnvironment: 'AVAILABLE' | 'UNAVAILABLE';
  };
  mlbPlayerId: number | null;
  pitcherHandedness: 'L' | 'R' | null;
  opponentMlbTeamId: number | null;
  opponentStrikeoutRate: number | null;
  opponentPlateAppearances: number | null;
  officialWorkloadGames: ReadonlyArray<{
    gameDate: string;
    strikeouts: number;
    battersFaced: number;
    innings: number | null;
    pitches: number | null;
  }>;
  recentSwStrRate: number | null;
  recentCswRate: number | null;
  averageFastballVelocityMph: number | null;
  velocityDeltaMph: number | null;
  dominantPitchShare: number | null;
  daysRest: number | null;
  venueName: string | null;
  temperatureF: number | null;
  windMph: number | null;
  homePlateUmpire: string | null;
  parkFactor: number | null;
  umpireStrikeoutFactor: number | null;
  provenance: ReadonlyArray<{
    field: string;
    source: string;
    observedAt: string;
    authentic: boolean;
  }>;
  warnings: string[];
}

export interface MlbPitcherKFeatureVectorV3 {
  featureVersion: 'APEX_MLB_K_FEATURES_V3';
  featureVectorId: string;
  asOf: string;
  latestFeatureObservedAt: string | null;
  isPointInTimeValid: boolean;
  reasonCodes: string[];
  dataQuality: MlbPitcherKV3DataQuality;
  sampleStarts: number;
  workloadStarts: number;
  officialBattersFacedStarts: number;
  derivedBattersFacedStarts: number;
  workloadSource: 'OFFICIAL_BF' | 'MIXED' | 'DERIVED' | 'UNAVAILABLE';
  // V5 metadata for transparent opening-week cross-season supplementation.
  historySeasonsUsed?: number[];
  priorSeasonStartsUsed?: number;
  strikeoutRateBasis?: 'CURRENT_SEASON' | 'ROLLING_MULTI_SEASON' | 'UNAVAILABLE';
  expectedBattersFaced: number | null;
  expectedInnings: number | null;
  seasonStrikeoutsPerBF: number | null;
  l10StrikeoutsPerBF: number | null;
  l5StrikeoutsPerBF: number | null;
  workloadTrendBF: number | null;
  strikeoutMean: number | null;
  strikeoutVariance: number | null;
  opponentStrikeoutRate: number | null;
  pitcherTeamVenueRole: 'HOME' | 'AWAY' | null;
  pitcherHandedness: 'L' | 'R' | null;
  recentSwStrRate: number | null;
  recentCswRate: number | null;
  averageFastballVelocityMph: number | null;
  velocityDeltaMph: number | null;
  dominantPitchShare: number | null;
  daysRest: number | null;
  temperatureF: number | null;
  windMph: number | null;
  parkFactor: number | null;
  umpireStrikeoutFactor: number | null;
  line: number;
}

export interface MlbPitcherKNegativeBinomialResult {
  modelVersion: 'APEX_MLB_K_NB_V3';
  isAvailable: boolean;
  reason: string | null;
  expectedStrikeouts: number | null;
  dispersionR: number | null;
  predictiveVariance: number | null;
  overProbability: number | null;
  underProbability: number | null;
  pushProbability: number | null;
}

export interface MlbPitcherKBoostedValidation {
  trainingRows: number;
  validationRows: number;
  baselineLogLoss: number | null;
  boostedLogLoss: number | null;
  baselineBrier: number | null;
  boostedBrier: number | null;
  trainEndAt: string | null;
  validationStartAt: string | null;
}

export interface MlbPitcherKBoostedResult {
  modelVersion: 'APEX_MLB_K_GB_STUMPS_V3';
  status: MlbPitcherKBoostedStatus;
  probabilityBasis: 'OVER_GIVEN_NO_PUSH';
  probability: number | null;
  validation: MlbPitcherKBoostedValidation;
  reason: string;
}

export interface MlbPitcherKShadowResultV3 {
  shadowVersion: 'APEX_PITCHER_K_V3_SHADOW';
  evaluatedAt: string;
  productionModelVersion: string;
  productionOverProbability: number | null;
  featureVector: MlbPitcherKFeatureVectorV3;
  negativeBinomial: MlbPitcherKNegativeBinomialResult;
  boosted: MlbPitcherKBoostedResult;
  shadowOverProbability: number | null;
  shadowUnderProbability: number | null;
  shadowPushProbability: number | null;
  divergenceFromProduction: number | null;
  promotionEligible: boolean;
  promotionReason: string;
}


export type FastLearningEvidenceTier =
  | 'EARLY_EVIDENCE'
  | 'DEVELOPING_SIGNAL'
  | 'MODERATE_EVIDENCE'
  | 'STRONG_EVIDENCE'
  | 'PROMOTION_TEST';

export interface MlbPitcherKCountScoreMetrics {
  observations: number;
  meanNegativeLogLikelihood: number | null;
  meanCrps: number | null;
  meanAbsoluteError: number | null;
  rootMeanSquaredError: number | null;
  meanError: number | null;
  meanPredictedStrikeouts: number | null;
  meanActualStrikeouts: number | null;
}

export interface MlbPitcherKPairedEvidence {
  independentStarts: number;
  evaluatedLineThresholds: number;
  meanLogLossDelta: number | null;
  logLossDeltaStandardError: number | null;
  logLossDeltaCi95Low: number | null;
  logLossDeltaCi95High: number | null;
  probabilityChallengerBetter: number | null;
  meanBrierDelta: number | null;
  brierDeltaCi95Low: number | null;
  brierDeltaCi95High: number | null;
  evidenceTier: FastLearningEvidenceTier;
  interpretation: string;
}

export interface MlbPitcherKFastLearningEvidence {
  evidenceVersion: 'APEX_MLB_K_FAST_LEARNING_V1';
  generatedAt: string;
  prospective: {
    independentStarts: number;
    evaluatedLineThresholds: number;
    paired: MlbPitcherKPairedEvidence;
    challengerCountScore: MlbPitcherKCountScoreMetrics;
  };
  allStarterShadow: {
    totalForecasts: number;
    gradedForecasts: number;
    pendingForecasts: number;
    countScore: MlbPitcherKCountScoreMetrics;
  };
  historicalReplay: {
    totalRows: number;
    pointInTimeValidRows: number;
    rejectedRows: number;
    countScore: MlbPitcherKCountScoreMetrics;
    note: string;
  };
  learningSample: {
    prospectiveIndependentStarts: number;
    allStarterGradedStarts: number;
    historicalReplayStarts: number;
    totalCountScoredStarts: number;
  };
  notes: string[];
}

export interface MlbPitcherKHistoricalReplayRow {
  replayId: string;
  source: 'MLB_STATS_API_POINT_IN_TIME_REPLAY';
  eventId: string;
  eventStartTime: string;
  season: number;
  pitcherId: number;
  pitcherName: string;
  team: string;
  opponent: string;
  teamVenueRole: 'HOME' | 'AWAY';
  asOf: string;
  actualStrikeouts: number;
  featureVector: MlbPitcherKFeatureVectorV3;
  negativeBinomial: MlbPitcherKNegativeBinomialResult;
  pointInTimeValid: boolean;
  rejectionReasons: string[];
  createdAt: string;
}

export interface MlbPitcherKStarterShadowForecast {
  forecastId: string;
  forecastVersion: 'APEX_MLB_K_ALL_STARTERS_V1';
  eventId: string;
  eventStartTime: string;
  season: number;
  pitcherId: number;
  pitcherName: string;
  team: string;
  opponent: string;
  teamVenueRole: 'HOME' | 'AWAY';
  capturedAt: string;
  featureVector: MlbPitcherKFeatureVectorV3;
  negativeBinomial: MlbPitcherKNegativeBinomialResult;
  gradingStatus: 'PENDING' | 'GRADED' | 'REJECTED';
  actualStrikeouts: number | null;
  gradedAt: string | null;
  gradingSource: string | null;
  rejectionReason: string | null;
}

export type ChampionChallengerPromotionStatus =
  | 'COLLECTING_EVIDENCE'
  | 'HOLD_PRODUCTION'
  | 'REVIEW_ELIGIBLE';

export interface ChampionChallengerModelMetrics {
  modelLabel: 'PRODUCTION' | 'CHALLENGER';
  modelVersion: string;
  observations: number;
  decisiveObservations: number;
  pushes: number;
  overWins: number;
  underWins: number;
  meanPredictedOver: number | null;
  actualOverRate: number | null;
  calibrationGap: number | null;
  expectedCalibrationError: number | null;
  logLoss: number | null;
  brierScore: number | null;
  directionalAccuracy: number | null;
  hypotheticalQualifiedPlays: number;
  hypotheticalWins: number;
  hypotheticalLosses: number;
  hypotheticalPushes: number;
  netUnits: number;
  roiPercent: number | null;
  clvSamples: number;
  averageObservedClvProbabilityPoints: number | null;
}

export interface ChampionChallengerCohortComparison {
  cohortType: 'LINE' | 'OPPONENT_K_RATE' | 'WORKLOAD' | 'DATA_QUALITY' | 'HOME_AWAY';
  cohort: string;
  sampleSize: number;
  productionLogLoss: number | null;
  challengerLogLoss: number | null;
  logLossDelta: number | null;
  productionBrier: number | null;
  challengerBrier: number | null;
  challengerBetter: boolean | null;
}

export interface ChampionChallengerPromotionGate {
  gate: string;
  passed: boolean;
  actual: string;
  required: string;
  blocking: boolean;
}

export interface ChampionChallengerRecentObservation {
  snapshotId: string;
  eventStartTime: string;
  playerName: string;
  opponent: string;
  line: number;
  actualStatistic: number;
  outcome: 'OVER' | 'UNDER' | 'PUSH';
  productionOverProbability: number | null;
  challengerOverProbability: number | null;
  productionError: number | null;
  challengerError: number | null;
  productionQualifiedSide: 'OVER' | 'UNDER' | null;
  challengerQualifiedSide: 'OVER' | 'UNDER' | null;
}

export interface ChampionChallengerReport {
  reportVersion: 'APEX_CHAMPION_CHALLENGER_V1';
  generatedAt: string;
  sport: 'MLB';
  market: 'pitcher_strikeouts';
  championModelVersion: string;
  challengerModelVersion: 'APEX_PITCHER_K_V3_SHADOW';
  sourceSnapshotCount: number;
  deduplicatedObservationCount: number;
  skippedObservationCount: number;
  production: ChampionChallengerModelMetrics;
  challenger: ChampionChallengerModelMetrics;
  deltas: {
    logLoss: number | null;
    brierScore: number | null;
    calibrationGap: number | null;
    directionalAccuracy: number | null;
    roiPercent: number | null;
    observedClvProbabilityPoints: number | null;
  };
  cohorts: ChampionChallengerCohortComparison[];
  promotion: {
    status: ChampionChallengerPromotionStatus;
    automaticPromotionAllowed: false;
    gates: ChampionChallengerPromotionGate[];
    blockingFailures: string[];
    summary: string;
  };
  recentObservations: ChampionChallengerRecentObservation[];
  fastLearning?: MlbPitcherKFastLearningEvidence;
  notes: string[];
}

export interface ApexProbabilityResult {
  modelVersion: string; // "APEX_BASELINE_V1"
  modelStatus: 'BASELINE MODEL — NOT YET BACKTEST OPTIMIZED' | 'MODEL UNAVAILABLE — INSUFFICIENT VERIFIED DATA';
  isAvailable: boolean;
  unavailabilityReason?: string;
  targetLine: number;

  // Decision probabilities. When calibration is ACTIVE these are calibrated;
  // otherwise they equal the transparent raw baseline probabilities.
  apexOverProbability: number | null;
  apexUnderProbability: number | null;
  apexPushProbability: number | null;
  sumCheck: number | null;

  rawOverProbability?: number | null;
  rawUnderProbability?: number | null;
  calibratedOverProbability?: number | null;
  calibratedUnderProbability?: number | null;
  calibration?: ProbabilityCalibrationInfo | null;
  pointInTimeAudit?: PointInTimeFeatureAudit | null;
  mlbPitcherKShadow?: MlbPitcherKShadowResultV3 | null;

  marketImplied: MarketImpliedProbability | null;
  components: ProbabilityComponentBreakdown | null;
  calculatedAt: string;
}

export interface ProbabilityAuditTelemetry {
  totalCalculations: number;
  successfulCalculations: number;
  unavailableDueToInsufficientData: number;
  cacheHits: number;
  cacheMisses: number;
  lastCalculatedAt: string;
  bySport: Record<
    ApexSport,
    {
      calculations: number;
      successful: number;
      unavailable: number;
    }
  >;
  reliabilityDistribution: {
    VERY_LIMITED: number;
    LIMITED: number;
    MODERATE: number;
    STRONG: number;
  };
}

export interface ProbabilityVerifyResponse {
  allPassed: boolean;
  verificationTimestamp: string;
  keyedRequestsConsumed: number;
  modelVersion: string;
  validationCase: {
    player: string;
    sport: ApexSport;
    team: string;
    marketCategory: string;
    targetLine: number;
    sportsbook: string;
    overOddsAmerican: number;
    underOddsAmerican: number;
    rawOverImplied: number;
    rawUnderImplied: number;
    bookmakerVig: number;
    noVigOverProbability: number;
    noVigUnderProbability: number;
    seasonSampleCount: number;
    seasonAvg: number;
    seasonHitRate: number;
    l10HitRate: number;
    l5HitRate: number;
    seasonBaselineOver: number;
    l10Adjustment: number;
    l5Adjustment: number;
    historicalOverProbability: number;
    sampleReliabilityTier: SampleReliabilityTier;
    historicalWeight: number;
    marketWeight: number;
    rawBlendedOver: number;
    finalApexOverProbability: number;
    finalApexUnderProbability: number;
    finalApexPushProbability: number;
    sumCheck: number;
    manualReproducibilityMatches: boolean;
  };
  criticalTests: Array<{
    testName: string;
    status: 'PASS' | 'FAIL';
    details: string;
  }>;
}

export interface PlayerGameLogRecord {
  eventId: string;
  gameDate: string;
  opponent: string;
  homeAway?: 'home' | 'away' | 'neutral';
  statValue: number;
  statName: string;
  isDNP?: boolean;
  dnpReason?: string;
  resultAgainstLine?: 'OVER' | 'UNDER' | 'PUSH';
  rawStats: Record<string, string | number>;
}

export interface PlayerHistoricalStatsSummary {
  playerId: string;
  playerDisplayName: string;
  verifiedTeam: string;
  sport: ApexSport;
  season: string;
  providerMarketKey: string;
  statCategory: string;
  targetLine: number;
  status: 'STATS_VERIFIED' | 'LIMITED_SAMPLE' | 'STATS_UNAVAILABLE' | 'STAT_MAPPING_UNAVAILABLE';
  statusMessage: string;
  source: string; // e.g. "ESPN Historical Game Logs"
  
  totalGamesRetrieved: number;
  validGamesUsed: number;
  excludedDnpCount: number;
  
  // Sample & Averages
  l5SampleCount: number;
  l5Average: number | null;
  l5Values: number[];
  l5OverHitRate: number | null; // 0.0 - 1.0 (percentage)
  l5UnderHitRate: number | null;
  l5PushCount: number;
  l5OverCount: number;
  l5UnderCount: number;
  
  l10SampleCount: number;
  l10Average: number | null;
  l10Values: number[];
  l10OverHitRate: number | null;
  l10UnderHitRate: number | null;
  l10PushCount: number;
  l10OverCount: number;
  l10UnderCount: number;
  
  seasonSampleCount: number;
  seasonAverage: number | null;
  seasonOverHitRate: number | null;
  seasonUnderHitRate: number | null;
  seasonPushCount: number;
  seasonOverCount: number;
  seasonUnderCount: number;
  
  recentGameLogs: PlayerGameLogRecord[];
  // Up to 30 verified logs retained for model feature construction; UI may still show only recentGameLogs.
  modelGameLogs?: PlayerGameLogRecord[];
  calculationVerified: boolean;
  retrievedAt: string;
  cacheStatus: 'HIT' | 'MISS';
}

export interface PlayerStatsAuditTelemetry {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  successfulResolutions: number;
  sourceFailures: number;
  unavailableMappings: number;
  wrongPlayerRejections: number;
  dnpGamesExcluded: number;
  lastReconciledAt: string;
  bySport: Record<
    ApexSport,
    {
      requests: number;
      resolved: number;
      gamesRetrieved: number;
    }
  >;
}

export interface PlayerStatsVerifyResponse {
  allPassed: boolean;
  verificationTimestamp: string;
  keyedRequestsConsumed: number;
  validationCase: {
    sport: ApexSport;
    player: string;
    team: string;
    marketCategory: string;
    providerMarketKey: string;
    targetLine: number;
    totalGames: number;
    rawL5Values: number[];
    rawL10Values: number[];
    calculatedL5Avg: number;
    calculatedL10Avg: number;
    seasonAvg: number;
    l5OverHitRate: number;
    l5OverRecord: string;
    l10OverHitRate: number;
    l10OverRecord: string;
    calculationVerified: boolean;
  };
  criticalTests: Array<{
    testName: string;
    status: 'PASS' | 'FAIL';
    details: string;
  }>;
}

export interface PropRejectionRecord {
  timestamp: string;
  sport: ApexSport;
  apexEventId: string;
  providerPlayerName: string;
  providerMarketKey: string;
  reason: 'WRONG_TEAM' | 'UNKNOWN_PLAYER' | 'AMBIGUOUS_NAME' | 'UNSUPPORTED_MARKET' | 'EVENT_NOT_UPCOMING' | 'EVENT_MISMATCH' | 'SPORT_UNSUPPORTED';
  details: string;
}

export interface PropPipelineAuditDiagnostic {
  providerPropRequests: number;
  cacheHits: number;
  cacheMisses: number;
  quotesReceived: number;
  acceptedQuotes: number;
  rejectedQuotes: number;
  playersRosterResolved: number;
  unresolvedPlayers: number;
  ambiguousPlayers: number;
  wrongTeamRejections: number;
  unsupportedMarketKeysCount: number;
  supportedMarketKeysDiscovered: string[];
  bySport: Record<
    ApexSport,
    {
      propRequests: number;
      quotesReceived: number;
      acceptedQuotes: number;
      rejectedQuotes: number;
      playersResolved: number;
    }
  >;
  recentRejections: PropRejectionRecord[];
}

export interface EventPlayerPropsResponse {
  apexEventId: string;
  status: 'SUCCESS' | 'NOT_CONFIGURED' | 'NOT_ELIGIBLE' | 'NO_PROPS' | 'QUOTA_EXCEEDED' | 'ERROR';
  message?: string;
  eventTitle?: string;
  sport?: ApexSport;
  league?: string;
  scheduledDate?: string;
  propsCount: number;
  props: NormalizedPlayerPropQuote[];
  rejectionsCount: number;
  quotaState: MarketQuotaState;
}

export interface PropNegativeTestResponse {
  testName: string;
  status: 'PASS' | 'FAIL';
  inputPlayer: string;
  inputGame: string;
  expectedResult: 'REJECTED';
  actualResult: 'ACCEPTED' | 'REJECTED';
  rejectionReason: string;
  keyedRequestsConsumed: number;
  details: string;
}

export interface EventMarketsResponse {
  apexEventId: string;
  status: 'SUCCESS' | 'NOT_CONFIGURED' | 'NOT_ELIGIBLE' | 'NO_MARKETS' | 'QUOTA_EXCEEDED' | 'ERROR';
  message?: string;
  markets: NormalizedApexEventMarkets | null;
  quotaState: MarketQuotaState;
}

export interface FirewallTestResponse {
  test: 'LIVE_SCORE_FIREWALL';
  initialKeyedUsed: number;
  finalKeyedUsed: number;
  keyedRequestsConsumed: number;
  pollsExecuted: number;
  passed: boolean;
  timestamp: string;
  details: string;
}

export type SnapshotType = 'REAL_PREGAME' | 'TEST_FIXTURE';

export type HistoricalGradingStatus = 'PENDING' | 'GRADED' | 'REJECTED';

export type HistoricalEligibilityStatus = 'ELIGIBLE' | 'INELIGIBLE';

export type SnapshotProvenance = 'REAL_PREGAME_SNAPSHOT' | 'TEST_FIXTURE_VALIDATION_ONLY';

export type BacktestSampleQuality = 'VERIFIED' | 'LIMITED' | 'REJECTED';

export type HistoricalGradingOutcome = 'WIN' | 'LOSS' | 'PUSH' | 'UNGRADED' | 'REJECTED';

export type SampleEvidenceTier = 'VERY_LIMITED' | 'LIMITED' | 'MODERATE' | 'STRONGER_EVIDENCE';

export interface DurableHistoricalPropSnapshot {
  // Primary Keys & Provenance
  snapshotId: string;
  snapshotType: SnapshotType; // REAL_PREGAME vs TEST_FIXTURE
  dedupFingerprint: string; // Hash of core invariant tuple
  predictionId?: string | null;
  predictionContractVersion?: 'APEX_PREDICTION_CONTRACT_V1' | null;
  featureSnapshotId?: string | null;
  featureSnapshotVersion?: 'APEX_FEATURE_SNAPSHOT_V1' | null;
  featureAsOf?: string | null;
  pointInTimeValid?: boolean;
  calibrationVersion?: 'APEX_PLATT_V1' | null;
  calibrationStatus?: ProbabilityCalibrationStatus | null;
  
  // Event & Timing
  eventId: string;
  providerEventId: string;
  eventStartTime: string;
  snapshotCreatedAt: string;
  sportsbookQuoteTimestamp: string;
  statisticsCutoffTimestamp: string;
  
  // Athlete & Team
  playerId: string;
  playerName: string;
  team: string;
  opponent: string;
  sport: ApexSport;
  league: string;
  
  // Proposition & Market
  market: string;
  line: number;
  side: 'OVER' | 'UNDER' | null;
  sportsbook: string;
  americanOdds: number | null;
  decimalOdds: number | null;
  overOddsAmerican: number | null;
  underOddsAmerican: number | null;
  overAmericanOdds?: number | null;
  underAmericanOdds?: number | null;
  overDecimalOdds?: number | null;
  underDecimalOdds?: number | null;
  overApexProbability?: number | null;
  underApexProbability?: number | null;
  overRawProbability?: number | null;
  underRawProbability?: number | null;
  overCalibratedProbability?: number | null;
  underCalibratedProbability?: number | null;
  overBreakEvenProbability?: number | null;
  underBreakEvenProbability?: number | null;
  overEdge?: number | null;
  underEdge?: number | null;
  overEV?: number | null;
  underEV?: number | null;
  overDecision?: RecommendationStatus | null;
  underDecision?: RecommendationStatus | null;
  overReasonCodes?: ReasonCode[];
  underReasonCodes?: ReasonCode[];
  
  // Model & Valuation Versions & Outputs
  modelVersion: string; // 'APEX_BASELINE_V1'
  valueEngineVersion: string; // 'APEX_VALUE_V1'
  apexProbability: number | null;
  breakEvenProbability: number | null;
  modelEdge: number | null;
  expectedValue: number | null;
  reliabilityTier: SampleReliabilityTier;
  recommendation: RecommendationStatus; // 'QUALIFIES' | 'NO_BET'
  reasonCodes: ReasonCode[];
  
  // Verification & Eligibility
  verificationState: 'VERIFIED' | 'UNVERIFIED';
  historicalEligibility: HistoricalEligibilityStatus;
  rejectionReason?: string | null;
  
  // Grading State (Separated & Idempotent)
  gradingStatus: HistoricalGradingStatus;
  actualStatistic?: number | null;
  gradedSideOutcome?: HistoricalGradingOutcome;
  gradingTimestamp?: string | null;
  netUnits?: number | null;
  unitsRisked?: number;
  dataSource?: string | null;
  finalEventId?: string | null;
  
  // MLB Pitcher K V3 shadow payload. Never used to mutate the production decision retroactively.
  mlbPitcherKV3?: {
    featureVector: MlbPitcherKFeatureVectorV3;
    negativeBinomialOverProbability: number | null;
    negativeBinomialUnderProbability: number | null;
    negativeBinomialPushProbability: number | null;
    boostedConditionalOverProbability: number | null;
    shadowOverProbability: number | null;
    shadowUnderProbability?: number | null;
    shadowPushProbability?: number | null;
    productionPushProbability?: number | null;
  } | null;

  // Reproducibility model input payload
  modelInputs: {
    seasonMean: number;
    seasonHitRate: number;
    seasonSampleCount: number;
    l10Mean: number;
    l10HitRate: number;
    l10SampleCount: number;
    sampleReliabilityTier: SampleReliabilityTier;
    marketNoVigOver: number | null;
    marketNoVigUnder: number | null;
    isMarketBlended: boolean;
  };
}

export interface HistoricalPropSnapshot extends DurableHistoricalPropSnapshot {
  apexEventId: string;
  playerDisplayName: string;
  verifiedTeam: string;
  verifiedOpponent: string;
  propMarket: string;
  marketCategory: string;
  overOddsDecimal: number | null;
  underOddsDecimal: number | null;
  marketTimestamp: string;
  apexOverProbability: number | null;
  apexUnderProbability: number | null;
  noVigOverProbability: number | null;
  noVigUnderProbability: number | null;
  overBreakEvenProb: number | null;
  underBreakEvenProb: number | null;
  overEdgePp: number | null;
  underEdgePp: number | null;
  overEVPercent: number | null;
  underEVPercent: number | null;
  bestSide: 'OVER' | 'UNDER' | null;
  recommendationStatus: RecommendationStatus;
  clvStatus: 'CLV_UNAVAILABLE' | 'CLV_AVAILABLE';
  provenance: SnapshotProvenance;
  qualityStatus: BacktestSampleQuality;
}

export interface GradedPropRecord {
  snapshot: HistoricalPropSnapshot;
  
  // Actual Result Grading
  actualStatistic: number | null;
  overOutcome: HistoricalGradingOutcome; // WIN / LOSS / PUSH
  underOutcome: HistoricalGradingOutcome; // WIN / LOSS / PUSH
  gradedSide: 'OVER' | 'UNDER' | null;
  gradedSideOutcome: HistoricalGradingOutcome;
  
  // Financial realization (1-unit flat stake)
  unitsRisked: number; // 1.0 if qualified wager placed, 0 if NO_BET or push
  unitsWonLost: number; // +profit, -1.0 loss, 0 push
  netUnits: number;
  
  // Provenance & Audit
  dataSource: string; // e.g., 'ESPN_OFFICIAL_BOXSCORE'
  finalEventId: string;
  gradingTimestamp: string;
  isIdempotentGrade: boolean;
}

export interface ProbabilityCalibrationBucket {
  bucketRange: string; // e.g. '50-52.5%', '52.5-55%', etc.
  minProb: number;
  maxProb: number;
  predictionCount: number;
  wins: number;
  losses: number;
  pushes: number;
  observedWinRate: number | null; // non-push wins / (wins + losses)
  avgPredictedProbability: number | null;
  calibrationError: number | null; // observedWinRate - avgPredictedProbability
}

export interface EVRealizationBucket {
  bucketRange: string; // e.g. '0 to +3%', '+3 to +5%', '+5 to +10%', '+10%+', 'Negative EV'
  sampleSize: number;
  betsCount: number;
  wins: number;
  losses: number;
  pushes: number;
  unitsRisked: number;
  netUnits: number;
  realizedROI: number | null; // netUnits / unitsRisked
  avgPredictedEV: number | null;
}

export interface PropMarketBacktestBreakdown {
  propMarket: string;
  sport: ApexSport;
  sampleCount: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  unitsRisked: number;
  netUnits: number;
  realizedROI: number | null;
  brierScore: number | null;
}

export interface BacktestSummaryMetrics {
  modelVersion: string;
  valueEngineVersion: string;
  dateRange: {
    start: string;
    end: string;
  };
  
  totalSnapshots: number;
  realEligibleSampleCount: number;
  realTotal: number;
  realPending: number;
  realGraded: number;
  realRejected: number;
  testFixturesCount: number;
  testFixtureSampleCount: number;
  firstCaptureTime: string | null;
  latestCaptureTime: string | null;
  persistenceBackend: string;
  persistenceStatus:
    | 'DURABLE PERSISTENCE: ACTIVE (FIRESTORE)'
    | 'DURABLE PERSISTENCE VERIFICATION FAILED (EPHEMERAL DISK)'
    | 'DURABLE PERSISTENCE: ACTIVE (SERVER FILESTORE)'
    | 'DURABLE SNAPSHOT PERSISTENCE NOT YET CONFIRMED'
    | 'DURABLE_STORED';
  temporalProofVerifiedCount: number;
  verifiedSamples: number;
  limitedSamples: number;
  rejectedSamples: number;
  rejectionBreakdown: Record<string, number>;
  
  gradedSampleCount: number;
  evidenceTier: SampleEvidenceTier; // VERY_LIMITED (<30), LIMITED (30-99), MODERATE (100-299), STRONGER_EVIDENCE (300+)
  sampleSizeWarning: string;
  
  // Overall Predictions (Calibration & Scores)
  totalEvaluatedPredictions: number;
  brierScore: number | null;
  logLoss: number | null;
  pushesExcludedFromBinaryScore: number;
  
  // Decision Comparison: QUALIFIES vs NO_BET
  qualifiesMetrics: {
    count: number;
    betsPlaced: number;
    wins: number;
    losses: number;
    pushes: number;
    winRate: number | null;
    unitsRisked: number;
    netUnits: number;
    realizedROI: number | null;
    avgPredictedEV: number | null;
    avgPredictedEdge: number | null;
  };
  
  noBetMetrics: {
    count: number;
    winsIfTaken: number;
    lossesIfTaken: number;
    pushesIfTaken: number;
    hypotheticalWinRate: number | null;
    avgPredictedEV: number | null;
  };
  
  // Bucketed Analysis
  calibrationBuckets: ProbabilityCalibrationBucket[];
  evBuckets: EVRealizationBucket[];
  
  // Segmentations
  marketBreakdowns: PropMarketBacktestBreakdown[];
  reliabilityTierBreakdowns: Record<SampleReliabilityTier, {
    count: number;
    wins: number;
    losses: number;
    winRate: number | null;
    brierScore: number | null;
  }>;
  
  // Quota & Cost Firewall Confirmation
  keyedOddsApiRequestsConsumed: number;
  isRealHistoricalDataSufficient: boolean;
  profitabilityConclusionDisclaimer: string;
}

export interface BacktestAuditDiagnostic {
  summary: BacktestSummaryMetrics;
  recentGradedRecords: GradedPropRecord[];
  persistedSnapshotsCount: number;
  telemetry: {
    totalSnapshotsPersisted: number;
    totalGradedEvents: number;
    totalAutoGradedAttempts: number;
    lastAutoGradeTimestamp: string;
  };
}

export interface BacktestVerifyResponse {
  test: 'STAGE_4A_BACKTEST_FRAMEWORK';
  initialKeyedUsed: number;
  finalKeyedUsed: number;
  keyedRequestsConsumed: number;
  timestamp: string;
  status: 'SUCCESS' | 'FAILURE';
  benchmark: {
    sampleQualityCheck: 'PASS' | 'FAIL';
    leakageRejectionCheck: 'PASS' | 'FAIL';
    overUnderPushGrading: 'PASS' | 'FAIL';
    flatStakeProfitMath: 'PASS' | 'FAIL';
    brierScoreMath: 'PASS' | 'FAIL';
    logLossMath: 'PASS' | 'FAIL';
    reproducibilityCheck: 'PASS' | 'FAIL';
  };
  details: string;
  criticalTests: Array<{
    testName: string;
    status: 'PASS' | 'FAIL';
    details: string;
  }>;
}


export type NavTabId =
  | 'overview'
  | 'picks'
  | 'win-probability'
  | 'live'
  | 'props'
  | 'parlays'
  | 'sims'
  | 'ai-learn'
  | 'my-bets'
  | 'audit'
  | 'tools';

export interface NavItem {
  id: NavTabId;
  label: string;
  shortLabel?: string;
  iconName: string;
  description: string;
  category: 'Core' | 'Engine' | 'Account' | 'System';
}

// ==========================================
// DECISION-FIRST PICK BOARD
// ==========================================
export type DecisionBoardStatus =
  | 'SUCCESS'
  | 'NO_QUALIFIED_PICKS'
  | 'NO_UPCOMING_EVENTS'
  | 'NOT_CONFIGURED'
  | 'QUOTA_BLOCKED'
  | 'ERROR';

export interface DecisionBoardPick {
  rank: number;
  eventId: string;
  eventTitle: string;
  sport: ApexSport;
  league: string;
  startTime: string;
  pickType?: 'PLAYER_PROP' | 'GAME_MARKET';
  displayPick?: string;
  selectionLabel?: string;
  gameMarketType?: MarketType | null;
  playerName: string | null;
  playerId: string | null;
  marketKey: string;
  marketCategory: string;
  side: 'OVER' | 'UNDER' | 'HOME' | 'AWAY' | 'DRAW';
  line: number | null;
  sportsbook: string;
  oddsAmerican: number;
  apexProbability: number;
  breakEvenProbability: number;
  marketConsensusProbability?: number | null;
  edgePercentagePoints: number;
  expectedValuePercent: number;
  reliabilityTier: SampleReliabilityTier;
  marketDepth?: number | null;
  modelVersion: string;
  modelValidationStatus?: 'EARLY_EVIDENCE' | 'PROSPECTIVE_VALIDATED' | null;
  calibrationStatus: ProbabilityCalibrationStatus | null;
  quoteTimestamp: string;
  quoteAgeSeconds: number | null;
  pointInTimeValid: boolean;
  v3ShadowProbability: number | null;
  v3ShadowSupportsProduction: boolean | null;
  rationale: string[];
  source: 'LIVE_EVALUATION' | 'SAVED_SNAPSHOT' | 'GAME_MODEL_EVALUATION';
  shadowModelVersion?: string | null;
  shadowModelProbability?: number | null;
  shadowModelSupportsProduction?: boolean | null;
  rawModelProbability?: number | null;
  guardedDecisionProbability?: number | null;
  decisionReferenceProbability?: number | null;
  probabilityShrinkageWeight?: number | null;
  modelMarketDisagreementPP?: number | null;
  rawExpectedValuePercent?: number | null;
  gameIntegrityStatus?: 'QUALIFIED' | 'REVIEW' | 'VERIFY' | 'PASS' | null;
  gameIntegrityReasons?: string[];
  gameEvTier?: 'NORMAL' | 'HEIGHTENED' | 'EXTREME' | null;
  crossMarketConsistent?: boolean | null;
  modelEvidenceObservations?: number | null;
  v2ContributionPP?: number | null;
  v2ContributionStatus?: 'MATERIAL' | 'NO_MATERIAL_ADJUSTMENT' | 'UNAVAILABLE' | null;
}


export interface DecisionBoardResponse {
  status: DecisionBoardStatus;
  message: string;
  generatedAt: string;
  sportFilter: ApexSportFilter;
  scheduleDate: string;
  requestedMaxGames: number;
  gamesScanned: number;
  gamesWithModelData: number;
  qualifiedCount: number;
  picks: DecisionBoardPick[];
  notes: string[];
}


// ==========================================
// DEDICATED GAME MARKET / WIN PROBABILITY BOARD
// ==========================================
export interface GameMarketBoardEvent {
  eventId: string;
  eventTitle: string;
  sport: ApexSport;
  league: string;
  startTime: string;
  homeTeam: string;
  awayTeam: string;
  modelStatus: 'AVAILABLE' | 'INSUFFICIENT_DATA' | 'UNSUPPORTED';
  modelReason: string | null;
  modelVersion: string;
  validationStatus: 'EARLY_EVIDENCE';
  reliabilityTier: SampleReliabilityTier;
  homeSampleCount: number;
  awaySampleCount: number;
  expectedHomeScore: number | null;
  expectedAwayScore: number | null;
  expectedMargin: number | null;
  expectedTotal: number | null;
  homeWinProbability: number | null;
  awayWinProbability: number | null;
  drawProbability: number | null;
  shadowModelVersion: string | null;
  shadowExpectedHomeScore: number | null;
  shadowExpectedAwayScore: number | null;
  shadowHomeWinProbability: number | null;
  shadowAwayWinProbability: number | null;
  contextStatus: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | null;
  contextNotes: string[];
  qualifiedPicks: DecisionBoardPick[];
  reviewPicks: DecisionBoardPick[];
  candidateCount: number;
  rejectedCandidateCount: number;
}

export interface GameMarketBoardResponse {
  status: DecisionBoardStatus;
  message: string;
  generatedAt: string;
  sportFilter: ApexSportFilter;
  scheduleDate: string;
  requestedMaxGames: number;
  gamesScanned: number;
  modelsAvailable: number;
  qualifiedCount: number;
  topMoneyline: DecisionBoardPick | null;
  topSpread: DecisionBoardPick | null;
  topTotal: DecisionBoardPick | null;
  topMoneylineCandidate: DecisionBoardPick | null;
  topSpreadCandidate: DecisionBoardPick | null;
  topTotalCandidate: DecisionBoardPick | null;
  reviewCount: number;
  rankedGamePicks: DecisionBoardPick[];
  events: GameMarketBoardEvent[];
  notes: string[];
}
