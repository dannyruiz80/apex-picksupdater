/**
 * Apex Picks — Edge, EV, Line Shopping & Recommendation Engine (Stage 3C-3)
 *
 * Transparent decision layer on top of verified sportsbook markets and APEX_BASELINE_V1 model probabilities.
 *
 * STRICT ARCHITECTURAL PRINCIPLES:
 * 1. A directional model lean is NOT automatically a bet. Price determines whether a probability has betting value.
 * 2. Over and Under are evaluated independently against their respective real sportsbook prices.
 * 3. 100% Deterministic & Cost Firewalled (0 keyed Odds API requests consumed).
 * 4. Distinct separation: Model Probability vs Break-Even Probability vs Model Edge vs Expected Value (EV%).
 * 5. Conservative Recommendation Gate: Only 'QUALIFIES' or 'NO_BET' (no promotional jargon).
 * 6. Detailed reason codes for every NO BET decision.
 */

import {
  ApexSport,
  LineShoppingComparison,
  NormalizedPlayerPropQuote,
  PropValueAnalysis,
  ReasonCode,
  RecommendationStatus,
  RecommendationThresholds,
  SampleReliabilityTier,
  SideValueAnalysis,
  ValueAuditTelemetry,
  ValueVerifyResponse,
} from '../types';
import { buildPredictionContractV1 } from './predictionContract';
import { evaluateRecommendationGate } from './recommendationGate';

export class ValueEngineService {
  public static readonly ENGINE_VERSION = 'APEX_VALUE_V1';

  // Server-side explicit recommendation thresholds (Not yet backtest optimized)
  public static readonly THRESHOLDS: RecommendationThresholds = {
    minReliabilityTier: 'MODERATE',
    minModelEdge: 0.03, // +3.0 percentage points (+0.03)
    minEVPercent: 3.0, // +3.0% EV
    positiveEVRequired: true,
    maxQuoteAgeMs: 10 * 60 * 1000,
    label: 'BASELINE RECOMMENDATION THRESHOLDS — NOT YET BACKTEST OPTIMIZED',
  };

  private telemetry: ValueAuditTelemetry = {
    totalEvaluations: 0,
    qualifiesCount: 0,
    noBetCount: 0,
    reasonCodeCounts: {
      NEGATIVE_EV: 0,
      EDGE_BELOW_THRESHOLD: 0,
      EV_BELOW_THRESHOLD: 0,
      INSUFFICIENT_DATA: 0,
      MODEL_UNAVAILABLE: 0,
      MARKET_UNVERIFIED: 0,
      PLAYER_UNVERIFIED: 0,
      STATS_UNAVAILABLE: 0,
      RELIABILITY_BELOW_MINIMUM: 0,
      INVALID_PROBABILITY: 0,
      PROVENANCE_INCOMPLETE: 0,
      STALE_PRICE: 0,
      EVENT_NOT_PREGAME: 0,
      POINT_IN_TIME_INVALID: 0,
      BETTER_PRICE_AVAILABLE: 0,
      SINGLE_SIDED_MARKET: 0,
      MODEL_BOUND_DRIVEN: 0,
    },
    bySport: {
      MLB: { evaluations: 0, qualifies: 0, noBet: 0 },
      NFL: { evaluations: 0, qualifies: 0, noBet: 0 },
      NBA: { evaluations: 0, qualifies: 0, noBet: 0 },
      WNBA: { evaluations: 0, qualifies: 0, noBet: 0 },
      NHL: { evaluations: 0, qualifies: 0, noBet: 0 },
      SOCCER: { evaluations: 0, qualifies: 0, noBet: 0 },
      TENNIS: { evaluations: 0, qualifies: 0, noBet: 0 },
    },
    lastEvaluatedAt: new Date().toISOString(),
  };

  /**
   * Main Entry Point: Evaluates Edge, EV, Line Shopping, and Recommendation Gate for a prop quote.
   */
  evaluatePropValue(
    quote: NormalizedPlayerPropQuote,
    allQuotesForEventAndPlayer: NormalizedPlayerPropQuote[] = []
  ): PropValueAnalysis {
    this.telemetry.totalEvaluations++;
    if (this.telemetry.bySport[quote.sport]) {
      this.telemetry.bySport[quote.sport].evaluations++;
    }
    this.telemetry.lastEvaluatedAt = new Date().toISOString();

    const lineShopping = this.computeLineShopping(quote, allQuotesForEventAndPlayer);

    const overAnalysis = this.evaluateSide(
      'OVER',
      quote,
      quote.overOddsAmerican ?? null,
      quote.overOddsDecimal ?? null,
      quote.probabilityAnalysis?.apexOverProbability ?? null,
      quote.probabilityAnalysis?.apexPushProbability ?? 0,
      lineShopping
    );

    const underAnalysis = this.evaluateSide(
      'UNDER',
      quote,
      quote.underOddsAmerican ?? null,
      quote.underOddsDecimal ?? null,
      quote.probabilityAnalysis?.apexUnderProbability ?? null,
      quote.probabilityAnalysis?.apexPushProbability ?? 0,
      lineShopping
    );

    // Determine Best Recommendation
    const bestRec = this.selectBestRecommendation(overAnalysis, underAnalysis);

    if (bestRec.recommendationStatus === 'QUALIFIES') {
      this.telemetry.qualifiesCount++;
      if (this.telemetry.bySport[quote.sport]) {
        this.telemetry.bySport[quote.sport].qualifies++;
      }
    } else {
      this.telemetry.noBetCount++;
      if (this.telemetry.bySport[quote.sport]) {
        this.telemetry.bySport[quote.sport].noBet++;
      }
      for (const code of bestRec.reasonCodes) {
        this.telemetry.reasonCodeCounts[code] = (this.telemetry.reasonCodeCounts[code] || 0) + 1;
      }
    }

    const predictionContracts = [
      overAnalysis && overAnalysis.oddsAmerican !== null && overAnalysis.oddsDecimal !== null
        ? buildPredictionContractV1({
            quote,
            side: 'OVER',
            oddsAmerican: overAnalysis.oddsAmerican,
            oddsDecimal: overAnalysis.oddsDecimal,
            probability: overAnalysis.apexProbability,
            marketNoVigProbability: quote.probabilityAnalysis?.marketImplied?.noVigOverProbability ?? null,
            pushProbability: quote.probabilityAnalysis?.apexPushProbability ?? 0,
            modelEdge: overAnalysis.modelEdge,
            expectedValue: overAnalysis.expectedValue,
            expectedValuePercent: overAnalysis.expectedValuePercent,
            decision: overAnalysis.recommendationStatus,
            reasonCodes: overAnalysis.reasonCodes,
            quoteFresh: overAnalysis.gateMath.quoteFresh ?? false,
            pregameEligible: overAnalysis.gateMath.pregameEligible ?? false,
          })
        : null,
      underAnalysis && underAnalysis.oddsAmerican !== null && underAnalysis.oddsDecimal !== null
        ? buildPredictionContractV1({
            quote,
            side: 'UNDER',
            oddsAmerican: underAnalysis.oddsAmerican,
            oddsDecimal: underAnalysis.oddsDecimal,
            probability: underAnalysis.apexProbability,
            marketNoVigProbability: quote.probabilityAnalysis?.marketImplied?.noVigUnderProbability ?? null,
            pushProbability: quote.probabilityAnalysis?.apexPushProbability ?? 0,
            modelEdge: underAnalysis.modelEdge,
            expectedValue: underAnalysis.expectedValue,
            expectedValuePercent: underAnalysis.expectedValuePercent,
            decision: underAnalysis.recommendationStatus,
            reasonCodes: underAnalysis.reasonCodes,
            quoteFresh: underAnalysis.gateMath.quoteFresh ?? false,
            pregameEligible: underAnalysis.gateMath.pregameEligible ?? false,
          })
        : null,
    ].filter((x): x is NonNullable<typeof x> => x !== null);

    return {
      engineVersion: ValueEngineService.ENGINE_VERSION,
      thresholdsLabel: ValueEngineService.THRESHOLDS.label,
      targetLine: quote.line,
      overAnalysis,
      underAnalysis,
      bestRecommendation: bestRec,
      lineShopping,
      thresholds: ValueEngineService.THRESHOLDS,
      calculatedAt: new Date().toISOString(),
      predictionContracts,
    };
  }

  /**
   * Evaluates a single side (OVER or UNDER) of a prop quote.
   */
  evaluateSide(
    side: 'OVER' | 'UNDER',
    quote: NormalizedPlayerPropQuote,
    oddsAmerican: number | null,
    oddsDecimal: number | null,
    apexProbability: number | null,
    pushProbability: number,
    lineShopping: LineShoppingComparison
  ): SideValueAnalysis | null {
    const sportsbook = quote.bookmakerTitle || quote.bookmakerKey || 'Consensus Bookmaker';
    const line = quote.line;

    if (oddsAmerican === null) {
      return null;
    }

    const calculatedDecimal = oddsDecimal ?? this.americanToDecimal(oddsAmerican);

    // Find Best Available Price for this line/side from Line Shopping
    const bestQuote = side === 'OVER' ? lineShopping.bestOverQuote : lineShopping.bestUnderQuote;
    const isBestAvailablePrice =
      bestQuote === null ||
      bestQuote.sportsbook === sportsbook ||
      bestQuote.oddsAmerican === oddsAmerican ||
      oddsAmerican >= bestQuote.oddsAmerican;

    // Central fail-closed recommendation gate. All paths must satisfy the same integrity checks.
    const breakEvenProb = this.americanToBreakEven(oddsAmerican);
    const netProfitIfWin = this.round4(calculatedDecimal - 1.0);

    const probabilityForMath = typeof apexProbability === 'number' && Number.isFinite(apexProbability)
      ? apexProbability
      : null;
    const edge = probabilityForMath !== null ? this.round4(probabilityForMath - breakEvenProb) : null;
    const edgePercentagePoints = edge !== null ? this.round2(edge * 100) : null;
    const pLoss = probabilityForMath !== null
      ? Math.max(0, 1.0 - probabilityForMath - pushProbability)
      : null;
    const ev = probabilityForMath !== null && pLoss !== null
      ? this.round4(probabilityForMath * netProfitIfWin - pLoss)
      : null;
    const evPercent = ev !== null ? this.round2(ev * 100) : null;

    const reliabilityTier = quote.probabilityAnalysis?.components?.sampleReliabilityTier ?? null;
    const gate = evaluateRecommendationGate({
      quote,
      probability: probabilityForMath,
      modelEdge: edge,
      expectedValue: ev,
      expectedValuePercent: evPercent,
      reliabilityTier,
      thresholds: {
        minReliabilityTier: ValueEngineService.THRESHOLDS.minReliabilityTier,
        minModelEdge: ValueEngineService.THRESHOLDS.minModelEdge,
        minEVPercent: ValueEngineService.THRESHOLDS.minEVPercent,
        positiveEVRequired: ValueEngineService.THRESHOLDS.positiveEVRequired,
        maxQuoteAgeMs: ValueEngineService.THRESHOLDS.maxQuoteAgeMs ?? 10 * 60 * 1000,
      },
    });

    // Additional production-integrity guards for provider-first props.
    // 1) Over/under count markets must be two-sided to derive a defensible executable
    //    market comparison. Naturally one-sided yes/no markets are exempt.
    // 2) A recommendation may never qualify only because the baseline model's generic
    //    probability clamp artificially raised the selected low-probability side.
    const naturallySingleSidedMarkets = new Set(['player_anytime_td', 'player_goal_scorer_anytime']);
    const marketIsSingleSided = quote.probabilityAnalysis?.marketImplied?.isSingleSided === true;
    const singleSidedBlocked = marketIsSingleSided && !naturallySingleSidedMarkets.has(quote.providerMarketKey);

    const components = quote.probabilityAnalysis?.components ?? null;
    const rawOver = components?.rawBlendedOverProbability ?? null;
    const minBound = components?.clampedMinBound ?? null;
    const maxBound = components?.clampedMaxBound ?? null;
    const boundDriven = Boolean(
      components?.boundsApplied &&
      rawOver !== null && minBound !== null && maxBound !== null &&
      ((side === 'OVER' && rawOver < minBound) || (side === 'UNDER' && rawOver > maxBound))
    );

    // Provider-first execution integrity: a production recommendation is attached only
    // to the best available price for the exact player/market/line/side. A worse quote
    // may still have positive EV, but it is not a separate Apex recommendation.
    const qualifiesWithExecutionIntegrity =
      gate.qualifies && isBestAvailablePrice && !singleSidedBlocked && !boundDriven;
    const recommendationStatus: RecommendationStatus = qualifiesWithExecutionIntegrity ? 'QUALIFIES' : 'NO_BET';
    const reasonCodes: ReasonCode[] = [...gate.reasonCodes];
    if (gate.qualifies && !isBestAvailablePrice) reasonCodes.push('BETTER_PRICE_AVAILABLE');
    if (singleSidedBlocked) reasonCodes.push('SINGLE_SIDED_MARKET');
    if (boundDriven) reasonCodes.push('MODEL_BOUND_DRIVEN');
    const gateMath = {
      minReliabilityMet: gate.checks.minReliabilityMet,
      minEdgeMet: gate.checks.minEdgeMet,
      minEVMet: gate.checks.minEVMet,
      positiveEVMet: gate.checks.positiveEVMet,
      allVerificationsMet:
        gate.checks.marketVerified &&
        gate.checks.playerVerified &&
        gate.checks.statsVerified &&
        gate.checks.modelAvailable &&
        gate.checks.probabilityValid &&
        gate.checks.provenanceComplete &&
        gate.checks.quoteFresh &&
        gate.checks.pregameEligible &&
        gate.checks.pointInTimeValid,
      probabilityValid: gate.checks.probabilityValid,
      provenanceComplete: gate.checks.provenanceComplete,
      quoteFresh: gate.checks.quoteFresh,
      pregameEligible: gate.checks.pregameEligible,
      pointInTimeValid: gate.checks.pointInTimeValid,
    };

    return {
      side,
      line,
      sportsbook,
      oddsAmerican,
      oddsDecimal: this.round4(calculatedDecimal),
      apexProbability: probabilityForMath !== null ? this.round4(probabilityForMath) : null,
      breakEvenProbability: this.round4(breakEvenProb),
      modelEdge: edge,
      modelEdgePercentagePoints: edgePercentagePoints,
      expectedValue: ev,
      expectedValuePercent: evPercent,
      netProfitIfWin,
      isBestAvailablePrice,
      bestSportsbook: bestQuote?.sportsbook || sportsbook,
      bestOddsAmerican: bestQuote?.oddsAmerican ?? oddsAmerican,
      bestOddsDecimal: bestQuote?.oddsDecimal ?? this.round4(calculatedDecimal),
      recommendationStatus,
      reasonCodes,
      gateMath,
    };
  }

  /**
   * Compares quotes for the exact line across sportsbooks to determine best available prices.
   */
  computeLineShopping(
    quote: NormalizedPlayerPropQuote,
    allQuotes: NormalizedPlayerPropQuote[]
  ): LineShoppingComparison {
    const exactLine = quote.line;
    const targetKey = quote.providerMarketKey;
    const targetPlayer = quote.playerId;

    // Filter quotes for exact player, market, and line
    const exactQuotes = allQuotes.filter(
      (q) =>
        q.playerId === targetPlayer &&
        q.providerMarketKey === targetKey &&
        q.line === exactLine
    );

    // If no sibling quotes provided, use current quote
    const pool = exactQuotes.length > 0 ? exactQuotes : [quote];

    let bestOver: { sportsbook: string; oddsAmerican: number; oddsDecimal: number } | null = null;
    let bestUnder: { sportsbook: string; oddsAmerican: number; oddsDecimal: number } | null = null;

    const availableBookmakers: Array<{
      sportsbook: string;
      line: number;
      overOddsAmerican: number | null;
      overOddsDecimal: number | null;
      underOddsAmerican: number | null;
      underOddsDecimal: number | null;
    }> = [];

    for (const q of pool) {
      const book = q.bookmakerTitle || q.bookmakerKey || 'Consensus';
      const overAm = q.overOddsAmerican ?? null;
      const underAm = q.underOddsAmerican ?? null;
      const overDec = q.overOddsDecimal ?? (overAm !== null ? this.americanToDecimal(overAm) : null);
      const underDec = q.underOddsDecimal ?? (underAm !== null ? this.americanToDecimal(underAm) : null);

      availableBookmakers.push({
        sportsbook: book,
        line: q.line,
        overOddsAmerican: overAm,
        overOddsDecimal: overDec !== null ? this.round4(overDec) : null,
        underOddsAmerican: underAm,
        underOddsDecimal: underDec !== null ? this.round4(underDec) : null,
      });

      if (overAm !== null && overDec !== null) {
        if (!bestOver || overAm > bestOver.oddsAmerican) {
          bestOver = { sportsbook: book, oddsAmerican: overAm, oddsDecimal: this.round4(overDec) };
        }
      }

      if (underAm !== null && underDec !== null) {
        if (!bestUnder || underAm > bestUnder.oddsAmerican) {
          bestUnder = { sportsbook: book, oddsAmerican: underAm, oddsDecimal: this.round4(underDec) };
        }
      }
    }

    return {
      exactLine,
      bestOverQuote: bestOver,
      bestUnderQuote: bestUnder,
      availableBookmakers,
    };
  }

  /**
   * Selects the best recommendation between Over and Under for a proposition.
   */
  private selectBestRecommendation(
    over: SideValueAnalysis | null,
    under: SideValueAnalysis | null
  ): {
    side: 'OVER' | 'UNDER' | null;
    recommendationStatus: RecommendationStatus;
    reasonCodes: ReasonCode[];
    selectedAnalysis: SideValueAnalysis | null;
  } {
    const overQualifies = over?.recommendationStatus === 'QUALIFIES';
    const underQualifies = under?.recommendationStatus === 'QUALIFIES';

    if (overQualifies && underQualifies) {
      // Pick higher EV%
      if ((over?.expectedValuePercent ?? 0) >= (under?.expectedValuePercent ?? 0)) {
        return {
          side: 'OVER',
          recommendationStatus: 'QUALIFIES',
          reasonCodes: [],
          selectedAnalysis: over,
        };
      } else {
        return {
          side: 'UNDER',
          recommendationStatus: 'QUALIFIES',
          reasonCodes: [],
          selectedAnalysis: under,
        };
      }
    }

    if (overQualifies) {
      return {
        side: 'OVER',
        recommendationStatus: 'QUALIFIES',
        reasonCodes: [],
        selectedAnalysis: over,
      };
    }

    if (underQualifies) {
      return {
        side: 'UNDER',
        recommendationStatus: 'QUALIFIES',
        reasonCodes: [],
        selectedAnalysis: under,
      };
    }

    // Neither qualifies -> NO BET
    // Select the side with higher EV as reference for why it failed
    const overEV = over?.expectedValue ?? -999;
    const underEV = under?.expectedValue ?? -999;
    const selected = overEV >= underEV ? over : under;

    const reasons = selected?.reasonCodes ?? ['INSUFFICIENT_DATA'];

    return {
      side: selected?.side ?? null,
      recommendationStatus: 'NO_BET',
      reasonCodes: reasons,
      selectedAnalysis: selected,
    };
  }

  /**
   * American Odds -> Break-Even Probability (0.0 to 1.0)
   * Formula:
   *   If Odds > 0: P = 100 / (Odds + 100)
   *   If Odds < 0: P = |Odds| / (|Odds| + 100)
   */
  americanToBreakEven(odds: number): number {
    if (odds === 0 || isNaN(odds)) return 0.50;
    if (odds > 0) {
      return 100.0 / (odds + 100.0);
    } else {
      const absOdds = Math.abs(odds);
      return absOdds / (absOdds + 100.0);
    }
  }

  /**
   * American Odds -> Decimal Odds
   * Formula:
   *   If Odds > 0: Decimal = 1.0 + (Odds / 100.0)
   *   If Odds < 0: Decimal = 1.0 + (100.0 / |Odds|)
   */
  americanToDecimal(odds: number): number {
    if (odds === 0 || isNaN(odds)) return 2.0;
    if (odds > 0) {
      return 1.0 + odds / 100.0;
    } else {
      return 1.0 + 100.0 / Math.abs(odds);
    }
  }

  private round4(val: number): number {
    return Math.round(val * 10000) / 10000;
  }

  private round2(val: number): number {
    return Math.round(val * 100) / 100;
  }

  /**
   * Telemetry accessor
   */
  getAuditTelemetry(): ValueAuditTelemetry {
    return { ...this.telemetry };
  }

  /**
   * Programmatic Accuracy Verification & Deterministic Test Suite (Stage 3C-3)
   */
  runVerificationSuite(): ValueVerifyResponse {
    const criticalTests: Array<{ testName: string; status: 'PASS' | 'FAIL'; details: string }> = [];

    // Base Benchmark Quote: Rhett Lowder (Pitcher Strikeouts 3.5, FanDuel Over -148, Under +116)
    const mockLowderQuote: NormalizedPlayerPropQuote = {
      quoteId: 'verify_lowder_3.5',
      apexEventId: 'verify_mlb_cin_mil',
      providerEventId: 'odds_api_mlb_cin_mil',
      sport: 'MLB',
      league: 'mlb',
      playerId: '4758873',
      playerDisplayName: 'Rhett Lowder',
      verifiedTeam: 'CIN',
      verifiedOpponent: 'MIL',
      bookmakerKey: 'fanduel',
      bookmakerTitle: 'FanDuel',
      providerMarketKey: 'pitcher_strikeouts',
      marketCategory: 'PITCHER_STRIKEOUTS',
      line: 3.5,
      overOddsAmerican: -148,
      underOddsAmerican: +116,
      overOddsDecimal: 1.6757,
      underOddsDecimal: 2.16,
      marketVerified: true,
      rosterVerified: true,
      rosterSource: 'ESPN Team Roster',
      marketSource: 'The-Odds-API v4 (US)',
      providerTimestamp: new Date().toISOString(),
      retrievedAt: new Date().toISOString(),
      cacheStatus: 'HIT',
      eventStatus: 'UPCOMING',
      eventStartTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      historicalStats: {
        playerId: '4758873',
        playerDisplayName: 'Rhett Lowder',
        verifiedTeam: 'CIN',
        sport: 'MLB',
        season: '2024',
        providerMarketKey: 'pitcher_strikeouts',
        statCategory: 'Pitching',
        targetLine: 3.5,
        status: 'STATS_VERIFIED',
        statusMessage: 'Verified 23 games',
        source: 'ESPN Historical Game Logs',
        totalGamesRetrieved: 23,
        validGamesUsed: 23,
        excludedDnpCount: 0,
        l5SampleCount: 5,
        l5Average: 3.60,
        l5Values: [1, 5, 4, 3, 5],
        l5OverHitRate: 0.60,
        l5UnderHitRate: 0.40,
        l5PushCount: 0,
        l5OverCount: 3,
        l5UnderCount: 2,
        l10SampleCount: 10,
        l10Average: 2.70,
        l10Values: [1, 5, 4, 3, 5, 1, 1, 3, 2, 2],
        l10OverHitRate: 0.40,
        l10UnderHitRate: 0.60,
        l10PushCount: 0,
        l10OverCount: 4,
        l10UnderCount: 6,
        seasonSampleCount: 23,
        seasonAverage: 3.61,
        seasonOverHitRate: 0.4783,
        seasonUnderHitRate: 0.5217,
        seasonPushCount: 0,
        seasonOverCount: 11,
        seasonUnderCount: 12,
        recentGameLogs: [],
        calculationVerified: true,
        retrievedAt: new Date().toISOString(),
        cacheStatus: 'HIT',
      },
      probabilityAnalysis: {
        modelVersion: 'APEX_BASELINE_V1',
        modelStatus: 'BASELINE MODEL — NOT YET BACKTEST OPTIMIZED',
        isAvailable: true,
        targetLine: 3.5,
        apexOverProbability: 0.5162,
        apexUnderProbability: 0.4838,
        apexPushProbability: 0.0,
        sumCheck: 1.0,
        marketImplied: {
          sportsbook: 'FanDuel',
          overOddsAmerican: -148,
          underOddsAmerican: +116,
          overOddsDecimal: 1.6757,
          underOddsDecimal: 2.16,
          rawOverImplied: 0.5968,
          rawUnderImplied: 0.4630,
          bookmakerVig: 0.0598,
          noVigOverProbability: 0.5631,
          noVigUnderProbability: 0.4369,
          isSingleSided: false,
        },
        components: {
          seasonBaselineOver: 0.4931,
          seasonEmpiricalHitRate: 0.4783,
          seasonDistributionEstimate: 0.5277,
          seasonMean: 3.61,
          seasonStdDev: 1.57,
          seasonSampleCount: 23,
          l10Adjustment: -0.0106,
          l10EmpiricalHitRate: 0.40,
          l10SampleCount: 10,
          l10Weight: 0.135,
          l5Adjustment: 0.0180,
          l5EmpiricalHitRate: 0.60,
          l5SampleCount: 5,
          l5Weight: 0.090,
          historicalOverProbability: 0.5005,
          marketNoVigOverProbability: 0.5631,
          sampleReliabilityTier: 'STRONG',
          sampleReliabilityFactor: 0.90,
          historicalWeight: 0.75,
          marketWeight: 0.25,
          rawBlendedOverProbability: 0.5162,
          boundsApplied: false,
          clampedMinBound: 0.12,
          clampedMaxBound: 0.88,
          isIntegerLine: false,
          pushProbability: 0.0,
        },
        calculatedAt: new Date().toISOString(),
        pointInTimeAudit: {
          featureSnapshotVersion: 'APEX_FEATURE_SNAPSHOT_V1',
          featureSnapshotId: 'FS_value_verify_lowder',
          asOf: new Date().toISOString(),
          isValid: true,
          reasonCodes: [],
          latestObservedAt: new Date().toISOString(),
          featureCount: 11,
        },
      },
    };

    // Test 1: Negative American Odds Break-Even Math (-148 -> 148 / 248 = 0.5968)
    const beNeg148 = this.americanToBreakEven(-148);
    const test1Passed = Math.abs(beNeg148 - 0.5968) < 0.001;
    criticalTests.push({
      testName: 'NEGATIVE_AMERICAN_ODDS_BREAK_EVEN_MATH',
      status: test1Passed ? 'PASS' : 'FAIL',
      details: `-148 -> ${beNeg148.toFixed(4)} (Expected: 0.5968 = 59.68%)`,
    });

    // Test 2: Positive American Odds Break-Even Math (+116 -> 100 / 216 = 0.4630)
    const bePos116 = this.americanToBreakEven(+116);
    const test2Passed = Math.abs(bePos116 - 0.4630) < 0.001;
    criticalTests.push({
      testName: 'POSITIVE_AMERICAN_ODDS_BREAK_EVEN_MATH',
      status: test2Passed ? 'PASS' : 'FAIL',
      details: `+116 -> ${bePos116.toFixed(4)} (Expected: 0.4630 = 46.30%)`,
    });

    // Test 3: Decimal Conversion Math
    const decNeg148 = this.americanToDecimal(-148); // 1 + 100/148 = 1.6757
    const decPos116 = this.americanToDecimal(+116); // 1 + 116/100 = 2.1600
    const test3Passed = Math.abs(decNeg148 - 1.6757) < 0.001 && Math.abs(decPos116 - 2.1600) < 0.001;
    criticalTests.push({
      testName: 'DECIMAL_CONVERSION_MATH',
      status: test3Passed ? 'PASS' : 'FAIL',
      details: `-148 -> ${decNeg148.toFixed(4)} (exp: 1.6757), +116 -> ${decPos116.toFixed(4)} (exp: 2.1600)`,
    });

    // Test 4: Negative EV Math (Rhett Lowder Over: P=0.5162, Odds -148 -> EV% = -13.50%)
    // EV = 0.5162 * (1.6757 - 1) - 0.4838 * 1 = 0.5162 * 0.6757 - 0.4838 = 0.3488 - 0.4838 = -0.1350 (-13.50%)
    const lowderValuation = this.evaluatePropValue(mockLowderQuote, [mockLowderQuote]);
    const overEVPercent = lowderValuation.overAnalysis?.expectedValuePercent ?? 0;
    const test4Passed = Math.abs(overEVPercent - (-13.50)) < 0.15;
    criticalTests.push({
      testName: 'NEGATIVE_EV_MATH',
      status: test4Passed ? 'PASS' : 'FAIL',
      details: `Lowder Over EV% = ${overEVPercent}% (Expected: -13.50%), Status = ${lowderValuation.overAnalysis?.recommendationStatus}`,
    });

    // Test 5: Positive EV Math (Rhett Lowder Under: P=0.4838, Odds +116 -> EV% = +4.50%)
    // EV = 0.4838 * (2.16 - 1) - 0.5162 * 1 = 0.4838 * 1.16 - 0.5162 = 0.5612 - 0.5162 = +0.0450 (+4.50%)
    const underEVPercent = lowderValuation.underAnalysis?.expectedValuePercent ?? 0;
    const test5Passed = Math.abs(underEVPercent - 4.50) < 0.15;
    criticalTests.push({
      testName: 'POSITIVE_EV_MATH',
      status: test5Passed ? 'PASS' : 'FAIL',
      details: `Lowder Under EV% = ${underEVPercent}% (Expected: +4.50%)`,
    });

    // Test 6: Zero EV Math (P(win)=0.50, Odds +100 / Decimal 2.0 -> EV = 0.0%)
    // EV = 0.50 * 1.0 - 0.50 * 1.0 = 0.0
    const zeroEVQuote = {
      ...mockLowderQuote,
      overOddsAmerican: +100,
      overOddsDecimal: 2.0,
      probabilityAnalysis: {
        ...mockLowderQuote.probabilityAnalysis!,
        apexOverProbability: 0.50,
        apexUnderProbability: 0.50,
      },
    };
    const zeroEval = this.evaluatePropValue(zeroEVQuote);
    const test6Passed = Math.abs(zeroEval.overAnalysis?.expectedValue ?? 0) < 0.001;
    criticalTests.push({
      testName: 'ZERO_EV_MATH',
      status: test6Passed ? 'PASS' : 'FAIL',
      details: `P=50% at +100 EV = ${zeroEval.overAnalysis?.expectedValue} (Expected: 0.0000)`,
    });

    // Test 7: Integer-Line Push EV (Line 4.0, P(win)=0.50, P(loss)=0.35, P(push)=0.15, Odds +100)
    // EV = 0.50 * 1.0 - 0.35 * 1.0 = +0.15 (+15.0%)
    const integerQuote = {
      ...mockLowderQuote,
      line: 4.0,
      overOddsAmerican: +100,
      overOddsDecimal: 2.0,
      probabilityAnalysis: {
        ...mockLowderQuote.probabilityAnalysis!,
        targetLine: 4.0,
        apexOverProbability: 0.50,
        apexUnderProbability: 0.35,
        apexPushProbability: 0.15,
      },
    };
    const intEval = this.evaluatePropValue(integerQuote);
    const intEV = intEval.overAnalysis?.expectedValue ?? 0;
    const test7Passed = Math.abs(intEV - 0.15) < 0.005;
    criticalTests.push({
      testName: 'INTEGER_LINE_PUSH_EV_MATH',
      status: test7Passed ? 'PASS' : 'FAIL',
      details: `Push 15% EV = ${intEV} (Expected: 0.1500 = +15.00%)`,
    });

    // Test 8: Independent Over / Under Evaluation (Over has P>50% but NO BET; Under has positive EV)
    const overStatus = lowderValuation.overAnalysis?.recommendationStatus;
    const underStatus = lowderValuation.underAnalysis?.recommendationStatus;
    const test8Passed =
      overStatus === 'NO_BET' &&
      lowderValuation.overAnalysis?.reasonCodes.includes('NEGATIVE_EV') === true &&
      lowderValuation.underAnalysis?.expectedValuePercent! > 0;
    criticalTests.push({
      testName: 'INDEPENDENT_OVER_UNDER_EVALUATION',
      status: test8Passed ? 'PASS' : 'FAIL',
      details: `Over (P=51.6%): ${overStatus} (Reason: ${lowderValuation.overAnalysis?.reasonCodes.join(',')}), Under (P=48.4%): EV=+${underEVPercent}%`,
    });

    // Test 9: Multi-Bookmaker Line Shopping Same Line (DraftKings -140 vs FanDuel -148 -> DraftKings Best)
    const dkQuote: NormalizedPlayerPropQuote = {
      ...mockLowderQuote,
      quoteId: 'verify_lowder_dk',
      bookmakerKey: 'draftkings',
      bookmakerTitle: 'DraftKings',
      overOddsAmerican: -140, // better payout than -148
      overOddsDecimal: 1.7143,
      underOddsAmerican: +110,
      underOddsDecimal: 2.10,
    };
    const shoppingEval = this.evaluatePropValue(mockLowderQuote, [mockLowderQuote, dkQuote]);
    const test9Passed =
      shoppingEval.lineShopping.bestOverQuote?.sportsbook === 'DraftKings' &&
      shoppingEval.lineShopping.bestOverQuote?.oddsAmerican === -140;
    criticalTests.push({
      testName: 'LINE_SHOPPING_SAME_LINE_BEST_PRICE',
      status: test9Passed ? 'PASS' : 'FAIL',
      details: `FD (-148) vs DK (-140) -> Best Over: ${shoppingEval.lineShopping.bestOverQuote?.sportsbook} (${shoppingEval.lineShopping.bestOverQuote?.oddsAmerican})`,
    });

    // Test 9B: a worse sportsbook quote is not emitted as a second production recommendation.
    const highProbFdQuote: NormalizedPlayerPropQuote = {
      ...mockLowderQuote,
      quoteId: 'verify_execution_fd',
      probabilityAnalysis: {
        ...mockLowderQuote.probabilityAnalysis!,
        apexOverProbability: 0.72,
        apexUnderProbability: 0.28,
      },
    };
    const highProbDkQuote: NormalizedPlayerPropQuote = {
      ...dkQuote,
      quoteId: 'verify_execution_dk',
      probabilityAnalysis: highProbFdQuote.probabilityAnalysis,
    };
    const worseExecutionEval = this.evaluatePropValue(highProbFdQuote, [highProbFdQuote, highProbDkQuote]);
    const bestExecutionEval = this.evaluatePropValue(highProbDkQuote, [highProbFdQuote, highProbDkQuote]);
    const test9bPassed =
      worseExecutionEval.overAnalysis?.recommendationStatus === 'NO_BET' &&
      worseExecutionEval.overAnalysis?.reasonCodes.includes('BETTER_PRICE_AVAILABLE') === true &&
      bestExecutionEval.overAnalysis?.recommendationStatus === 'QUALIFIES' &&
      bestExecutionEval.overAnalysis?.isBestAvailablePrice === true;
    criticalTests.push({
      testName: 'PROVIDER_FIRST_BEST_EXECUTION_ONLY',
      status: test9bPassed ? 'PASS' : 'FAIL',
      details: `Worse=${worseExecutionEval.overAnalysis?.recommendationStatus}/${worseExecutionEval.overAnalysis?.reasonCodes.join(',')}; best=${bestExecutionEval.overAnalysis?.recommendationStatus} ${bestExecutionEval.overAnalysis?.bestSportsbook} ${bestExecutionEval.overAnalysis?.bestOddsAmerican}`,
    });

    // Test 10: Multi-Bookmaker Differing Lines Evaluated Independently
    const diffLineQuote: NormalizedPlayerPropQuote = {
      ...mockLowderQuote,
      quoteId: 'verify_lowder_diff_line',
      bookmakerKey: 'betmgm',
      bookmakerTitle: 'BetMGM',
      line: 4.5,
      overOddsAmerican: +140,
      underOddsAmerican: -180,
    };
    const diffShoppingEval = this.evaluatePropValue(mockLowderQuote, [mockLowderQuote, diffLineQuote]);
    // The exact line shopping for 3.5 should NOT confuse 4.5
    const test10Passed =
      diffShoppingEval.lineShopping.exactLine === 3.5 &&
      diffShoppingEval.lineShopping.bestOverQuote?.oddsAmerican === -148;
    criticalTests.push({
      testName: 'DIFFERING_LINES_EVALUATED_INDEPENDENTLY',
      status: test10Passed ? 'PASS' : 'FAIL',
      details: `Shopping for line 3.5 isolated from line 4.5 quotes. ExactLine = ${diffShoppingEval.lineShopping.exactLine}`,
    });

    // Test 11: Threshold Boundary (Lowder Under: Edge = +2.08% < +3.0% -> Fails with EDGE_BELOW_THRESHOLD)
    const test11Passed =
      underStatus === 'NO_BET' &&
      lowderValuation.underAnalysis?.reasonCodes.includes('EDGE_BELOW_THRESHOLD') === true;
    criticalTests.push({
      testName: 'THRESHOLD_BOUNDARY_GATE',
      status: test11Passed ? 'PASS' : 'FAIL',
      details: `Under Edge = +${lowderValuation.underAnalysis?.modelEdgePercentagePoints}pp (Threshold: +3.0pp) -> Status: ${underStatus}, Reasons: ${lowderValuation.underAnalysis?.reasonCodes.join(',')}`,
    });

    // Test 12: NO BET Behavior on Qualifying EV but Sub-Threshold Edge
    const highEVLowEdgeQuote = {
      ...mockLowderQuote,
      underOddsAmerican: +118,
      probabilityAnalysis: {
        ...mockLowderQuote.probabilityAnalysis!,
        apexUnderProbability: 0.4750, // break-even is 45.87%, edge is +1.63%, EV is +3.55%
      },
    };
    const test12Eval = this.evaluatePropValue(highEVLowEdgeQuote);
    const test12Passed =
      test12Eval.underAnalysis?.recommendationStatus === 'NO_BET' &&
      test12Eval.underAnalysis.reasonCodes.includes('EDGE_BELOW_THRESHOLD');
    criticalTests.push({
      testName: 'NO_BET_ON_SUB_THRESHOLD_EDGE',
      status: test12Passed ? 'PASS' : 'FAIL',
      details: `EV=+3.55% (Passes >=3%) but Edge=+1.63pp (Fails >=3pp) -> Status: ${test12Eval.underAnalysis?.recommendationStatus}`,
    });

    // Test 13: Missing Probability Fail-Closed
    const nullProbQuote = { ...mockLowderQuote, probabilityAnalysis: null };
    const test13Eval = this.evaluatePropValue(nullProbQuote);
    const test13Passed =
      test13Eval.bestRecommendation.recommendationStatus === 'NO_BET' &&
      test13Eval.bestRecommendation.reasonCodes.includes('MODEL_UNAVAILABLE');
    criticalTests.push({
      testName: 'MISSING_PROBABILITY_FAIL_CLOSED',
      status: test13Passed ? 'PASS' : 'FAIL',
      details: `Null probabilityAnalysis -> Status: ${test13Eval.bestRecommendation.recommendationStatus}, Reasons: ${test13Eval.bestRecommendation.reasonCodes.join(',')}`,
    });

    // Test 14: Missing Market Verification Fail-Closed
    const unverifiedMarketQuote = { ...mockLowderQuote, marketVerified: false };
    const test14Eval = this.evaluatePropValue(unverifiedMarketQuote);
    const test14Passed =
      test14Eval.bestRecommendation.recommendationStatus === 'NO_BET' &&
      test14Eval.bestRecommendation.reasonCodes.includes('MARKET_UNVERIFIED');
    criticalTests.push({
      testName: 'MISSING_MARKET_VERIFICATION_FAIL_CLOSED',
      status: test14Passed ? 'PASS' : 'FAIL',
      details: `marketVerified=false -> Status: ${test14Eval.bestRecommendation.recommendationStatus}, Reasons: ${test14Eval.bestRecommendation.reasonCodes.join(',')}`,
    });

    // Test 15: Insufficient Reliability Tier Fail-Closed (LIMITED sample fails with RELIABILITY_BELOW_MINIMUM)
    const limitedSampleQuote = {
      ...mockLowderQuote,
      probabilityAnalysis: {
        ...mockLowderQuote.probabilityAnalysis!,
        components: {
          ...mockLowderQuote.probabilityAnalysis!.components!,
          sampleReliabilityTier: 'LIMITED' as SampleReliabilityTier,
        },
      },
    };
    const test15Eval = this.evaluatePropValue(limitedSampleQuote);
    const test15Passed =
      test15Eval.bestRecommendation.recommendationStatus === 'NO_BET' &&
      test15Eval.bestRecommendation.reasonCodes.includes('RELIABILITY_BELOW_MINIMUM');
    criticalTests.push({
      testName: 'INSUFFICIENT_RELIABILITY_TIER_FAIL_CLOSED',
      status: test15Passed ? 'PASS' : 'FAIL',
      details: `Reliability=LIMITED (Minimum: MODERATE) -> Status: ${test15Eval.bestRecommendation.recommendationStatus}, Reasons: ${test15Eval.bestRecommendation.reasonCodes.join(',')}`,
    });

    // Test 16: Rare-event longshot props cannot auto-qualify from a single-sided
    // market or because the generic model floor inflated the selected side.
    const suspiciousLongshotQuote: NormalizedPlayerPropQuote = {
      ...mockLowderQuote,
      quoteId: 'verify_rare_hr_longshot',
      providerMarketKey: 'batter_home_runs',
      marketCategory: 'HOME_RUNS',
      line: 1.5,
      overOddsAmerican: +42500,
      overOddsDecimal: 426.0,
      underOddsAmerican: null,
      underOddsDecimal: null,
      probabilityAnalysis: {
        ...mockLowderQuote.probabilityAnalysis!,
        targetLine: 1.5,
        apexOverProbability: 0.12,
        apexUnderProbability: 0.88,
        marketImplied: {
          sportsbook: 'BetRivers',
          overOddsAmerican: +42500,
          underOddsAmerican: null,
          overOddsDecimal: 426.0,
          underOddsDecimal: null,
          rawOverImplied: 0.0023,
          rawUnderImplied: null,
          bookmakerVig: null,
          noVigOverProbability: 0.0023,
          noVigUnderProbability: null,
          isSingleSided: true,
        },
        components: {
          ...mockLowderQuote.probabilityAnalysis!.components!,
          rawBlendedOverProbability: 0.004,
          boundsApplied: true,
          clampedMinBound: 0.12,
          clampedMaxBound: 0.88,
          sampleReliabilityTier: 'STRONG',
        },
      },
    };
    const suspiciousLongshotEval = this.evaluatePropValue(suspiciousLongshotQuote);
    const test16Passed =
      suspiciousLongshotEval.overAnalysis?.recommendationStatus === 'NO_BET' &&
      suspiciousLongshotEval.overAnalysis.reasonCodes.includes('SINGLE_SIDED_MARKET') &&
      suspiciousLongshotEval.overAnalysis.reasonCodes.includes('MODEL_BOUND_DRIVEN');
    criticalTests.push({
      testName: 'RARE_EVENT_LONGSHOT_FAILS_EXECUTION_INTEGRITY',
      status: test16Passed ? 'PASS' : 'FAIL',
      details: `Status=${suspiciousLongshotEval.overAnalysis?.recommendationStatus}; reasons=${suspiciousLongshotEval.overAnalysis?.reasonCodes.join(',')}`,
    });

    // Test 17: Deterministic Reproducibility
    const run1 = this.evaluatePropValue(mockLowderQuote);
    const run2 = this.evaluatePropValue(mockLowderQuote);
    const test17Passed =
      run1.overAnalysis?.expectedValue === run2.overAnalysis?.expectedValue &&
      run1.underAnalysis?.expectedValue === run2.underAnalysis?.expectedValue &&
      run1.bestRecommendation.recommendationStatus === run2.bestRecommendation.recommendationStatus;
    criticalTests.push({
      testName: 'DETERMINISTIC_REPRODUCIBILITY',
      status: test17Passed ? 'PASS' : 'FAIL',
      details: `Run 1 == Run 2 (Over EV: ${run1.overAnalysis?.expectedValue}, Under EV: ${run1.underAnalysis?.expectedValue})`,
    });

    const allPassed = criticalTests.every((t) => t.status === 'PASS');

    return {
      allPassed,
      verificationTimestamp: new Date().toISOString(),
      keyedRequestsConsumed: 0,
      engineVersion: ValueEngineService.ENGINE_VERSION,
      validationCase: {
        player: 'Rhett Lowder',
        sport: 'MLB',
        team: 'CIN',
        marketCategory: 'PITCHER_STRIKEOUTS',
        targetLine: 3.5,
        sportsbook: 'FanDuel',
        // Over evaluation
        overOddsAmerican: -148,
        overOddsDecimal: 1.6757,
        apexOverProbability: 0.5162,
        overBreakEvenProbability: lowderValuation.overAnalysis?.breakEvenProbability ?? 0.5968,
        overModelEdgePp: lowderValuation.overAnalysis?.modelEdgePercentagePoints ?? -8.06,
        overNetProfit: lowderValuation.overAnalysis?.netProfitIfWin ?? 0.6757,
        overEVPercent: lowderValuation.overAnalysis?.expectedValuePercent ?? -13.50,
        overRecommendation: lowderValuation.overAnalysis?.recommendationStatus ?? 'NO_BET',
        overReasonCodes: lowderValuation.overAnalysis?.reasonCodes ?? ['NEGATIVE_EV', 'EDGE_BELOW_THRESHOLD', 'EV_BELOW_THRESHOLD'],
        // Under evaluation
        underOddsAmerican: +116,
        underOddsDecimal: 2.1600,
        apexUnderProbability: 0.4838,
        underBreakEvenProbability: lowderValuation.underAnalysis?.breakEvenProbability ?? 0.4630,
        underModelEdgePp: lowderValuation.underAnalysis?.modelEdgePercentagePoints ?? +2.08,
        underNetProfit: lowderValuation.underAnalysis?.netProfitIfWin ?? 1.1600,
        underEVPercent: lowderValuation.underAnalysis?.expectedValuePercent ?? +4.50,
        underRecommendation: lowderValuation.underAnalysis?.recommendationStatus ?? 'NO_BET',
        underReasonCodes: lowderValuation.underAnalysis?.reasonCodes ?? ['EDGE_BELOW_THRESHOLD'],
        // Final Decision
        finalDecision: lowderValuation.bestRecommendation.recommendationStatus,
        finalSide: lowderValuation.bestRecommendation.side,
        finalReasonCodes: lowderValuation.bestRecommendation.reasonCodes,
        thresholds: ValueEngineService.THRESHOLDS,
      },
      criticalTests,
    };
  }
}

export const valueEngineService = new ValueEngineService();
