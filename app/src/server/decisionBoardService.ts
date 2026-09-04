import {
  ApexSport,
  ApexSportFilter,
  NormalizedApexGame,
  NormalizedPlayerPropQuote,
  SampleReliabilityTier,
  DurableHistoricalPropSnapshot,
  DecisionBoardStatus,
  DecisionBoardPick,
  DecisionBoardResponse,
  DecisionBoardSportCoverage,
} from '../types.js';
import { playerPropProvider } from './playerPropProvider.js';
import { snapshotPersistenceService } from './snapshotPersistenceService.js';
import { marketProvider } from './marketProvider.js';
import { gameMarketModelService, GameMarketCandidateV1, GameMarketProjectionV1 } from './gameMarketModelService.js';
import { gameMarketPredictionRepository } from './gameMarketPredictionRepository.js';
import { formatPropSelectionLabel, humanizePropMarket } from '../propPresentation.js';
import { tennisMatchWinnerModelService } from './tennisMatchWinnerModelService.js';
import { wnbaBacktestMonteCarloService } from './wnbaBacktestMonteCarloService.js';

const RELIABILITY_ORDER: Record<SampleReliabilityTier, number> = {
  VERY_LIMITED: 0,
  LIMITED: 1,
  MODERATE: 2,
  STRONG: 3,
};

function normalizeDate(value: string): string { return value.slice(0, 10); }
function eventTitle(game: NormalizedApexGame): string {
  if (game.sport === 'TENNIS') return `${game.playerAName || 'Player A'} vs ${game.playerBName || 'Player B'}`;
  return `${game.awayTeam || 'Away'} @ ${game.homeTeam || 'Home'}`;
}
function quoteAgeSeconds(timestamp: string): number | null {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? Math.max(0, Math.round((Date.now() - parsed) / 1000)) : null;
}

function buildRationale(params: {
  probability: number; breakEven: number; edge: number; ev: number; reliability: SampleReliabilityTier;
  isBestPrice: boolean; v3Support: boolean | null;
}): string[] {
  const lines = [
    `Model probability ${(params.probability * 100).toFixed(1)}% vs ${(params.breakEven * 100).toFixed(1)}% break-even.`,
    `Verified edge +${params.edge.toFixed(1)} pp with +${params.ev.toFixed(1)}% expected value.`,
    `${params.reliability} verified historical-sample reliability.`,
  ];
  if (params.isBestPrice) lines.push('Current quote is the best verified price for this exact line.');
  if (params.v3Support === true) lines.push('MLB K V3 shadow direction agrees with the production side.');
  if (params.v3Support === false) lines.push('MLB K V3 shadow currently disagrees; production gate still controls the decision.');
  return lines;
}

function quoteToPick(game: NormalizedApexGame, quote: NormalizedPlayerPropQuote): DecisionBoardPick | null {
  const rec = quote.valueAnalysis?.bestRecommendation;
  const selected = rec?.selectedAnalysis;
  const probability = quote.probabilityAnalysis;
  if (!rec || rec.recommendationStatus !== 'QUALIFIES' || !rec.side || !selected) return null;
  if (selected.apexProbability === null || selected.breakEvenProbability === null) return null;
  if (selected.modelEdgePercentagePoints === null || selected.expectedValuePercent === null) return null;
  if (selected.bestOddsAmerican === null) return null;
  const reliabilityTier = probability?.components?.sampleReliabilityTier;
  if (!reliabilityTier) return null;

  const shadow = probability?.mlbPitcherKShadow ?? null;
  let v3Support: boolean | null = null;
  let v3ShadowProbability: number | null = null;
  if (shadow?.shadowOverProbability !== null && shadow?.shadowOverProbability !== undefined) {
    v3ShadowProbability = rec.side === 'OVER' ? shadow.shadowOverProbability : shadow.shadowUnderProbability;
    if (v3ShadowProbability !== null) v3Support = v3ShadowProbability >= 0.5;
  }
  const displayPick = formatPropSelectionLabel(quote.playerDisplayName, quote.providerMarketKey || quote.marketCategory, rec.side, quote.line);
  return {
    rank: 0, eventId: game.eventId, eventTitle: eventTitle(game), sport: game.sport,
    league: game.league || game.competition || game.tournamentName || game.sport, startTime: game.startTime,
    pickType: 'PLAYER_PROP', displayPick, selectionLabel: displayPick, gameMarketType: null,
    playerName: quote.playerDisplayName, playerId: quote.playerId, marketKey: quote.providerMarketKey,
    marketCategory: quote.marketCategory, side: rec.side, line: quote.line,
    sportsbook: selected.bestSportsbook || selected.sportsbook, oddsAmerican: selected.bestOddsAmerican,
    apexProbability: selected.apexProbability, breakEvenProbability: selected.breakEvenProbability,
    marketConsensusProbability: quote.probabilityAnalysis?.marketImplied?.noVigOverProbability ?? null,
    edgePercentagePoints: selected.modelEdgePercentagePoints, expectedValuePercent: selected.expectedValuePercent,
    reliabilityTier, marketDepth: quote.valueAnalysis?.lineShopping?.availableBookmakers?.length ?? null,
    modelVersion: probability?.modelVersion || 'UNKNOWN', modelValidationStatus: 'PROSPECTIVE_VALIDATED',
    calibrationStatus: probability?.calibration?.status ?? null, quoteTimestamp: quote.providerTimestamp,
    quoteAgeSeconds: quoteAgeSeconds(quote.providerTimestamp), pointInTimeValid: probability?.pointInTimeAudit?.isValid === true,
    v3ShadowProbability, v3ShadowSupportsProduction: v3Support,
    rationale: buildRationale({ probability: selected.apexProbability, breakEven: selected.breakEvenProbability,
      edge: selected.modelEdgePercentagePoints, ev: selected.expectedValuePercent, reliability: reliabilityTier,
      isBestPrice: selected.isBestAvailablePrice, v3Support }),
    bookOffers: (quote.valueAnalysis?.lineShopping?.availableBookmakers || [])
      .map((b) => ({
        sportsbook: b.sportsbook,
        oddsAmerican: rec.side === 'OVER' ? b.overOddsAmerican : b.underOddsAmerican,
        quoteTimestamp: quote.providerTimestamp,
      }))
      .filter((b): b is { sportsbook: string; oddsAmerican: number; quoteTimestamp: string } => typeof b.oddsAmerican === 'number' && Number.isFinite(b.oddsAmerican)),
    source: 'LIVE_EVALUATION',
  };
}

export function gameCandidateToPick(game: NormalizedApexGame, model: GameMarketProjectionV1, c: GameMarketCandidateV1): DecisionBoardPick {
  const projected = model.expectedHomeScore !== null && model.expectedAwayScore !== null
    ? `Independent projection: ${game.awayTeam || 'Away'} ${model.expectedAwayScore.toFixed(1)} – ${game.homeTeam || 'Home'} ${model.expectedHomeScore.toFixed(1)}.`
    : 'Independent score projection available.';
  const consensus = c.marketConsensusProbability !== null
    ? `Sportsbook no-vig consensus ${(c.marketConsensusProbability * 100).toFixed(1)}%; comparison-only and never an input to the raw sports model.`
    : 'Sportsbook price is comparison-only and is not an input to the raw sports model.';
  const v2 = c.v2ContributionStatus === 'NO_MATERIAL_ADJUSTMENT'
    ? 'V2 context produced NO MATERIAL ADJUSTMENT.'
    : c.v2ContributionStatus === 'MATERIAL' && c.v2ContributionPP !== null && c.v2ContributionPP !== undefined
      ? `V2 context moved the side probability ${c.v2ContributionPP >= 0 ? '+' : ''}${c.v2ContributionPP.toFixed(1)} pp; shadow remains audit-only.`
      : 'V2 context contribution is unavailable for this market.';

  const rationale = [
    `Raw independent model probability ${(c.modelProbability * 100).toFixed(1)}%.`,
    `Guarded decision probability ${(c.decisionProbability * 100).toFixed(1)}% vs ${(c.breakEvenProbability * 100).toFixed(1)}% executable break-even.`,
    `${projected}`,
    `Guarded edge ${c.edgePercentagePoints >= 0 ? '+' : ''}${c.edgePercentagePoints.toFixed(1)} pp with ${c.expectedValuePercent >= 0 ? '+' : ''}${c.expectedValuePercent.toFixed(1)}% EV across ${c.marketDepth} fresh book${c.marketDepth === 1 ? '' : 's'}.`,
    `Raw unshrunk EV would be ${c.rawExpectedValuePercent >= 0 ? '+' : ''}${c.rawExpectedValuePercent.toFixed(1)}%; it does not control qualification while V1 is early-evidence.`,
    consensus,
    c.modelMarketDisagreementPP !== null
      ? `Raw model vs market-consensus disagreement: ${c.modelMarketDisagreementPP.toFixed(1)} pp.`
      : 'Model-vs-market disagreement could not be computed.',
    `${model.reliabilityTier} team-history reliability (${model.homeSampleCount} home-team / ${model.awaySampleCount} away-team games).`,
    `Prospective game-model evidence: ${c.modelEvidenceObservations} independent decisive observation${c.modelEvidenceObservations === 1 ? '' : 's'}; model weight ${(c.probabilityShrinkageWeight * 100).toFixed(0)}%.`,
    v2,
    `Integrity state: ${c.integrityStatus}${c.integrityReasonCodes.length ? ` (${c.integrityReasonCodes.join(', ')})` : ''}.`,
  ];

  return {
    rank: 0, eventId: game.eventId, eventTitle: eventTitle(game), sport: game.sport,
    league: game.league || game.competition || game.sport, startTime: game.startTime,
    pickType: 'GAME_MARKET', displayPick: c.selectionLabel, selectionLabel: c.selectionLabel, gameMarketType: c.marketType,
    playerName: null, playerId: null, marketKey: c.marketType.toLowerCase(), marketCategory: c.marketType,
    side: c.side, line: c.point, sportsbook: c.sportsbook, oddsAmerican: c.oddsAmerican,
    // For bet ranking, apexProbability is the guarded decision probability. The raw independent
    // probability remains separately exposed below and on the Win Probability screen.
    apexProbability: c.decisionProbability, breakEvenProbability: c.breakEvenProbability,
    marketConsensusProbability: c.marketConsensusProbability, edgePercentagePoints: c.edgePercentagePoints,
    expectedValuePercent: c.expectedValuePercent, reliabilityTier: model.reliabilityTier, marketDepth: c.marketDepth,
    modelVersion: model.modelVersion, modelValidationStatus: 'EARLY_EVIDENCE', calibrationStatus: null,
    quoteTimestamp: c.quoteTimestamp, quoteAgeSeconds: quoteAgeSeconds(c.quoteTimestamp), pointInTimeValid: model.pointInTimeValid,
    v3ShadowProbability: null, v3ShadowSupportsProduction: null, rationale, source: 'GAME_MODEL_EVALUATION',
    shadowModelVersion: model.shadowModelVersion,
    shadowModelProbability: c.shadowModelProbability ?? null,
    shadowModelSupportsProduction: c.shadowSupportsProduction ?? null,
    rawModelProbability: c.modelProbability,
    guardedDecisionProbability: c.decisionProbability,
    decisionReferenceProbability: c.decisionReferenceProbability,
    probabilityShrinkageWeight: c.probabilityShrinkageWeight,
    modelMarketDisagreementPP: c.modelMarketDisagreementPP,
    rawExpectedValuePercent: c.rawExpectedValuePercent,
    gameIntegrityStatus: c.integrityStatus,
    gameIntegrityReasons: [...c.reasonCodes],
    gameEvTier: c.evTier,
    crossMarketConsistent: c.crossMarketConsistent,
    modelEvidenceObservations: c.modelEvidenceObservations,
    v2ContributionPP: c.v2ContributionPP ?? null,
    v2ContributionStatus: c.v2ContributionStatus ?? 'UNAVAILABLE',
    bookOffers: [...c.bookOffers],
    calibrationAdjustedProbability: c.calibrationAdjustedProbability,
    prospectiveCalibrationAdjustmentPP: c.prospectiveCalibrationAdjustmentPP,
    gameCalibrationEvidenceTier: c.calibrationEvidenceTier,
    gameCalibrationEce: c.calibrationExpectedError,
    gameCalibrationBrier: c.calibrationBrierScore,
  };
}

function snapshotToPick(snapshot: DurableHistoricalPropSnapshot): DecisionBoardPick | null {
  if (snapshot.snapshotType !== 'REAL_PREGAME' || snapshot.historicalEligibility !== 'ELIGIBLE' ||
      snapshot.verificationState !== 'VERIFIED' || snapshot.gradingStatus !== 'PENDING' || snapshot.pointInTimeValid !== true ||
      snapshot.recommendation !== 'QUALIFIES' || !snapshot.side || snapshot.apexProbability === null ||
      snapshot.breakEvenProbability === null || snapshot.modelEdge === null || snapshot.expectedValue === null || snapshot.americanOdds === null) return null;
  if (!snapshot.eventStartTime || Date.parse(snapshot.eventStartTime) <= Date.now()) return null;
  const age = quoteAgeSeconds(snapshot.sportsbookQuoteTimestamp);
  if (age === null || age > 10 * 60) return null;
  const shadow = snapshot.mlbPitcherKV3;
  const shadowSideProbability = snapshot.side === 'OVER' ? shadow?.shadowOverProbability ?? null : shadow?.shadowUnderProbability ?? null;
  const v3Support = shadowSideProbability === null ? null : shadowSideProbability >= 0.5;
  const displayPick = formatPropSelectionLabel(snapshot.playerName, snapshot.market, snapshot.side, snapshot.line);
  return {
    rank: 0, eventId: snapshot.eventId, eventTitle: `${snapshot.team || 'Team'} vs ${snapshot.opponent || 'Opponent'}`,
    sport: snapshot.sport, league: snapshot.league, startTime: snapshot.eventStartTime, pickType: 'PLAYER_PROP', displayPick,
    selectionLabel: displayPick, gameMarketType: null, playerName: snapshot.playerName, playerId: snapshot.playerId,
    marketKey: snapshot.market, marketCategory: humanizePropMarket(snapshot.market), side: snapshot.side, line: snapshot.line,
    sportsbook: snapshot.sportsbook, oddsAmerican: snapshot.americanOdds, apexProbability: snapshot.apexProbability,
    breakEvenProbability: snapshot.breakEvenProbability, edgePercentagePoints: snapshot.modelEdge,
    expectedValuePercent: snapshot.expectedValue, reliabilityTier: snapshot.reliabilityTier, modelVersion: snapshot.modelVersion,
    modelValidationStatus: 'PROSPECTIVE_VALIDATED', calibrationStatus: snapshot.calibrationStatus ?? null,
    quoteTimestamp: snapshot.sportsbookQuoteTimestamp, quoteAgeSeconds: age, pointInTimeValid: true,
    v3ShadowProbability: shadowSideProbability, v3ShadowSupportsProduction: v3Support,
    rationale: buildRationale({ probability: snapshot.apexProbability, breakEven: snapshot.breakEvenProbability,
      edge: snapshot.modelEdge, ev: snapshot.expectedValue, reliability: snapshot.reliabilityTier, isBestPrice: false, v3Support }),
    source: 'SAVED_SNAPSHOT',
  };
}

export function rankDecisionBoardPicks(picks: DecisionBoardPick[], limit = 10): DecisionBoardPick[] {
  const byIdentity = new Map<string, DecisionBoardPick>();
  for (const pick of picks) {
    const key = `${pick.eventId}|${pick.pickType || 'PLAYER_PROP'}|${pick.playerId || pick.selectionLabel || ''}|${pick.marketKey}|${pick.line}|${pick.side}`;
    const existing = byIdentity.get(key);
    if (!existing) { byIdentity.set(key, pick); continue; }
    const existingTs = Date.parse(existing.quoteTimestamp) || 0;
    const candidateTs = Date.parse(pick.quoteTimestamp) || 0;
    if (candidateTs > existingTs || (candidateTs === existingTs && pick.expectedValuePercent > existing.expectedValuePercent)) byIdentity.set(key, pick);
  }
  return [...byIdentity.values()].sort((a,b)=>{
    const r = RELIABILITY_ORDER[b.reliabilityTier] - RELIABILITY_ORDER[a.reliabilityTier]; if (r) return r;
    const maturity = (p: DecisionBoardPick) => p.modelValidationStatus === 'PROSPECTIVE_VALIDATED' ? 1 : 0;
    const m = maturity(b) - maturity(a); if (m) return m;
    if (b.apexProbability !== a.apexProbability) return b.apexProbability - a.apexProbability;
    if (b.expectedValuePercent !== a.expectedValuePercent) return b.expectedValuePercent - a.expectedValuePercent;
    return b.edgePercentagePoints - a.edgePercentagePoints;
  }).slice(0,limit).map((p,i)=>({...p,rank:i+1}));
}

export function diversifyDecisionBoardPicks(picks: DecisionBoardPick[], limit = 12): DecisionBoardPick[] {
  const ranked = rankDecisionBoardPicks(picks, Math.max(limit * 4, 24));
  if (ranked.length <= 1) return ranked.slice(0, limit).map((p,i)=>({...p,rank:i+1}));

  const out: DecisionBoardPick[] = [ranked[0]];
  const seenIds = new Set([`${ranked[0].eventId}|${ranked[0].selectionLabel}`]);
  const seenSports = new Set([ranked[0].sport]);

  // Give every other sport with a qualified pick one visible opportunity before
  // filling remaining slots by the normal production rank.
  for (const pick of ranked) {
    if (out.length >= Math.min(limit, 6)) break;
    if (seenSports.has(pick.sport)) continue;
    const id = `${pick.eventId}|${pick.selectionLabel}`;
    if (seenIds.has(id)) continue;
    out.push(pick);
    seenIds.add(id);
    seenSports.add(pick.sport);
  }

  for (const pick of ranked) {
    if (out.length >= limit) break;
    const id = `${pick.eventId}|${pick.selectionLabel}`;
    if (seenIds.has(id)) continue;
    out.push(pick);
    seenIds.add(id);
  }
  return out.map((p,i)=>({...p,rank:i+1}));
}

function addReason(target: Record<string, number>, reason: string, count = 1) {
  const key = (reason || 'UNKNOWN').trim() || 'UNKNOWN';
  target[key] = (target[key] || 0) + Math.max(1, count);
}

const INFORMATIONAL_COVERAGE_REASONS = new Set([
  'EARLY_EVIDENCE_SHRINKAGE_ACTIVE',
  'V2_NO_MATERIAL_ADJUSTMENT',
]);

export function isDisplayedCoverageBlocker(sport: ApexSport, reason: string): boolean {
  // Early-evidence shrinkage and no-material-shadow notes are risk-control diagnostics,
  // not the reason a candidate failed the production gate. Soccer and WNBA both use
  // these notes while their game models accumulate evidence.
  if ((sport === 'SOCCER' || sport === 'WNBA') && INFORMATIONAL_COVERAGE_REASONS.has(reason)) return false;
  return true;
}


function unresolvedTennisParticipant(name: string | null | undefined): boolean {
  const normalized = String(name || '').trim().toLowerCase();
  return !normalized || normalized === 'tbd' || normalized === 'unknown' || normalized === 'unknown player' || normalized === 'player a' || normalized === 'player b';
}

export function isTennisDecisionBoardEligible(game: NormalizedApexGame): boolean {
  if (game.sport !== 'TENNIS') return true;
  if (game.tennisMatchFormat === 'DOUBLES' || game.tennisMatchFormat === 'OTHER') return false;
  const a = String(game.playerAName || game.awayTeam || '').trim();
  const b = String(game.playerBName || game.homeTeam || '').trim();
  if (unresolvedTennisParticipant(a) || unresolvedTennisParticipant(b)) return false;
  if (a.includes('/') || b.includes('/')) return false;
  if (a.toLowerCase() === b.toLowerCase()) return false;
  return true;
}

export function selectDecisionBoardSlateRows(
  games: NormalizedApexGame[],
  sportFilter: ApexSportFilter,
  maxGamesRaw: number,
  nowMs = Date.now(),
): NormalizedApexGame[] {
  const maxGames = Math.max(1, Math.min(48, Math.floor(maxGamesRaw || (sportFilter === 'ALL' ? 48 : sportFilter === 'TENNIS' ? 30 : 12))));
  const sportOrder: ApexSport[] = ['MLB', 'NFL', 'NBA', 'WNBA', 'NHL', 'SOCCER', 'TENNIS'];
  const candidates = games.filter((g) => g.status === 'UPCOMING' && g.pregameBetEligible !== false && g.startTime && Date.parse(g.startTime) > nowMs &&
    (sportFilter === 'ALL' || g.sport === sportFilter) && isTennisDecisionBoardEligible(g))
    .sort((a,b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  if (sportFilter !== 'ALL') return candidates.slice(0, maxGames);

  const bySport = new Map<ApexSport, NormalizedApexGame[]>();
  for (const g of candidates) {
    const bucket = bySport.get(g.sport) || [];
    bucket.push(g);
    bySport.set(g.sport, bucket);
  }
  const out: NormalizedApexGame[] = [];
  let round = 0;
  while (out.length < maxGames) {
    let added = false;
    for (const sport of sportOrder) {
      const game = bySport.get(sport)?.[round];
      if (!game) continue;
      out.push(game);
      added = true;
      if (out.length >= maxGames) break;
    }
    if (!added) break;
    round++;
  }
  return out;
}

export class DecisionBoardService {
  private recentQualifiedSlateCache = new Map<string, { createdAtMs: number; picks: DecisionBoardPick[] }>();
  private readonly recentQualifiedSlateTtlMs = 10 * 60 * 1000;

  private recentSlateKey(sportFilter: ApexSportFilter, scheduleDate: string): string {
    return `${sportFilter}|${scheduleDate}`;
  }

  /**
   * Keep the full production-qualified slate in server memory so Parlay Lab can reuse
   * the exact picks the user just verified on the Picks board without spending more
   * provider credits or shrinking back to a tiny independent event sample.
   */
  cacheQualifiedSlatePicks(sportFilter: ApexSportFilter, scheduleDate: string, picks: DecisionBoardPick[]): void {
    const deduped = rankDecisionBoardPicks(picks, 500);
    this.recentQualifiedSlateCache.set(this.recentSlateKey(sportFilter, scheduleDate), {
      createdAtMs: Date.now(),
      picks: deduped,
    });
    if (sportFilter === 'ALL') {
      const bySport = new Map<ApexSport, DecisionBoardPick[]>();
      for (const pick of deduped) {
        const bucket = bySport.get(pick.sport) || [];
        bucket.push(pick);
        bySport.set(pick.sport, bucket);
      }
      for (const [sport, rows] of bySport.entries()) {
        this.recentQualifiedSlateCache.set(this.recentSlateKey(sport, scheduleDate), {
          createdAtMs: Date.now(),
          picks: rankDecisionBoardPicks(rows, 500),
        });
      }
    }
  }

  getRecentQualifiedPicks(sportFilter: ApexSportFilter, scheduleDate: string): DecisionBoardPick[] {
    const now = Date.now();
    const read = (filter: ApexSportFilter) => {
      const entry = this.recentQualifiedSlateCache.get(this.recentSlateKey(filter, scheduleDate));
      if (!entry) return [] as DecisionBoardPick[];
      if (now - entry.createdAtMs > this.recentQualifiedSlateTtlMs) {
        this.recentQualifiedSlateCache.delete(this.recentSlateKey(filter, scheduleDate));
        return [] as DecisionBoardPick[];
      }
      return entry.picks;
    };
    const exact = read(sportFilter);
    if (exact.length) return rankDecisionBoardPicks(exact, 500);
    if (sportFilter !== 'ALL') {
      return rankDecisionBoardPicks(read('ALL').filter((pick) => pick.sport === sportFilter), 500);
    }
    const sports: ApexSport[] = ['MLB', 'NFL', 'NBA', 'WNBA', 'NHL', 'SOCCER', 'TENNIS'];
    return rankDecisionBoardPicks(sports.flatMap((sport) => read(sport)), 500);
  }

  async evaluateEvent(game: NormalizedApexGame): Promise<{
    status: DecisionBoardStatus;
    message: string;
    picks: DecisionBoardPick[];
    modelDataAvailable: boolean;
    rejectionReasons: Record<string, number>;
  }> {
    const rejectionReasons: Record<string, number> = {};
    if (game.status !== 'UPCOMING' || game.pregameBetEligible === false || !game.startTime || Date.parse(game.startTime) <= Date.now()) {
      addReason(rejectionReasons, 'EVENT_NOT_PREGAME');
      return { status:'NO_UPCOMING_EVENTS', message:'Only verified pregame events can be analyzed for a pick.', picks:[], modelDataAvailable:false, rejectionReasons };
    }

    const picks: DecisionBoardPick[] = [];
    let modelDataAvailable = false;
    let providerConfigured = true;
    let quotaBlocked = false;

    // Team sports use the established independent game-market model. Tennis now has
    // its own independent match-winner model and intentionally does not reuse team-score logic.
    if (game.sport === 'TENNIS') {
      const tennisModel = await tennisMatchWinnerModelService.buildProjection(game);
      if (tennisModel.status === 'AVAILABLE') modelDataAvailable = true;
      else addReason(rejectionReasons, `TENNIS_MATCH_WINNER_MODEL_${tennisModel.status}`);

      const marketResult = await marketProvider.getMarketsForEvent(game);
      if (marketResult.status === 'NOT_CONFIGURED') {
        providerConfigured = false;
        addReason(rejectionReasons, 'ODDS_PROVIDER_NOT_CONFIGURED');
      } else if (marketResult.status === 'QUOTA_EXCEEDED') {
        quotaBlocked = true;
        addReason(rejectionReasons, 'ODDS_PROVIDER_QUOTA_BLOCKED');
      } else if (marketResult.status !== 'SUCCESS' || !marketResult.markets) {
        addReason(rejectionReasons, `TENNIS_MATCH_WINNER_MARKET_${marketResult.status}`);
      } else if (tennisModel.status === 'AVAILABLE') {
        const evaluation = tennisMatchWinnerModelService.evaluateMoneyline(game, marketResult.markets, tennisModel);
        picks.push(...evaluation.picks);
        Object.entries(evaluation.rejectionReasons).forEach(([reason, count]) => addReason(rejectionReasons, reason, count));
      }
    } else {
      const marketResult = await marketProvider.getMarketsForEvent(game);
      if (marketResult.status === 'NOT_CONFIGURED') {
        providerConfigured = false;
        addReason(rejectionReasons, 'ODDS_PROVIDER_NOT_CONFIGURED');
      } else if (marketResult.status === 'QUOTA_EXCEEDED') {
        quotaBlocked = true;
        addReason(rejectionReasons, 'ODDS_PROVIDER_QUOTA_BLOCKED');
      } else if (marketResult.status !== 'SUCCESS' || !marketResult.markets) {
        addReason(rejectionReasons, `GAME_MARKET_${marketResult.status}`);
      } else {
        const model = await gameMarketModelService.buildProjection(game);
        if (model.status === 'AVAILABLE') {
          modelDataAvailable = true;
          const sportEvidence = gameMarketPredictionRepository.getEvidenceFor(game.sport);
          const prospectiveMoneylineEvidence = gameMarketPredictionRepository.getEvidenceFor(game.sport, 'MONEYLINE');
          const historicalWnbaMoneylineEvidence = game.sport === 'WNBA' ? wnbaBacktestMonteCarloService.getMoneylineEvidence() : null;
          const moneylineEvidence = historicalWnbaMoneylineEvidence
            ? {
                independentDecisiveObservations: historicalWnbaMoneylineEvidence.independentDecisiveObservations + prospectiveMoneylineEvidence.independentDecisiveObservations,
                calibrationGap: prospectiveMoneylineEvidence.independentDecisiveObservations > 0
                  ? (historicalWnbaMoneylineEvidence.calibrationGap ?? prospectiveMoneylineEvidence.calibrationGap)
                  : historicalWnbaMoneylineEvidence.calibrationGap,
                expectedCalibrationError: prospectiveMoneylineEvidence.independentDecisiveObservations > 0
                  ? Math.max(historicalWnbaMoneylineEvidence.expectedCalibrationError ?? 0, prospectiveMoneylineEvidence.expectedCalibrationError ?? 0)
                  : historicalWnbaMoneylineEvidence.expectedCalibrationError,
                brierScore: prospectiveMoneylineEvidence.independentDecisiveObservations > 0
                  ? Math.max(historicalWnbaMoneylineEvidence.brierScore ?? 0, prospectiveMoneylineEvidence.brierScore ?? 0)
                  : historicalWnbaMoneylineEvidence.brierScore,
                logLoss: prospectiveMoneylineEvidence.logLoss ?? historicalWnbaMoneylineEvidence.logLoss,
                evidenceTier: historicalWnbaMoneylineEvidence.evidenceTier,
                recommendedModelWeight: prospectiveMoneylineEvidence.independentDecisiveObservations > 0
                  ? Math.min(historicalWnbaMoneylineEvidence.recommendedModelWeight, prospectiveMoneylineEvidence.recommendedModelWeight)
                  : historicalWnbaMoneylineEvidence.recommendedModelWeight,
              }
            : prospectiveMoneylineEvidence;
          const evaluation = gameMarketModelService.evaluateMarkets(game, marketResult.markets, model, {
            independentDecisiveObservations: sportEvidence.independentDecisiveObservations,
            calibrationGap: sportEvidence.calibrationGap,
            byMarket: {
              MONEYLINE: moneylineEvidence,
              SPREAD: gameMarketPredictionRepository.getEvidenceFor(game.sport, 'SPREAD'),
              TOTAL: gameMarketPredictionRepository.getEvidenceFor(game.sport, 'TOTAL'),
            },
          });
          gameMarketPredictionRepository.append(game, evaluation);
          picks.push(...evaluation.qualified.map((c)=>gameCandidateToPick(game, model, c)));
          for (const candidate of evaluation.candidates) {
            if (candidate.qualifies) continue;
            if (candidate.reasonCodes?.length) candidate.reasonCodes
              .filter((reason) => isDisplayedCoverageBlocker(game.sport, reason))
              .forEach((reason)=>addReason(rejectionReasons, reason));
            else addReason(rejectionReasons, 'GAME_MARKET_NOT_QUALIFIED');
          }
          if (!evaluation.candidates.length) addReason(rejectionReasons, 'NO_EXECUTABLE_GAME_MARKET_CANDIDATES');
        } else {
          addReason(rejectionReasons, `GAME_MODEL_${model.status}`);
        }
      }
    }

    // Existing player-prop production path remains active in parallel where provider markets exist.
    const propKeys = playerPropProvider.getPropMarketKeysForSport(game.sport);
    if (propKeys.length > 0 && !quotaBlocked) {
      const propResult = await playerPropProvider.getPlayerPropsForGame(game);
      if (propResult.status === 'NOT_CONFIGURED') {
        providerConfigured = false;
        addReason(rejectionReasons, 'PROP_PROVIDER_NOT_CONFIGURED');
      } else if (propResult.status === 'QUOTA_EXCEEDED') {
        quotaBlocked = true;
        addReason(rejectionReasons, 'PROP_PROVIDER_QUOTA_BLOCKED');
      } else if (propResult.status === 'SUCCESS') {
        modelDataAvailable = true;
        for (const quote of propResult.props || []) {
          const pick = quoteToPick(game, quote);
          if (pick) {
            picks.push(pick);
            continue;
          }
          const rec = quote.valueAnalysis?.bestRecommendation;
          if (rec?.reasonCodes?.length) rec.reasonCodes.forEach((reason)=>addReason(rejectionReasons, `PROP_${reason}`));
          else addReason(rejectionReasons, 'PROP_MODEL_OR_VALUE_UNAVAILABLE');
        }
        if (!(propResult.props || []).length) addReason(rejectionReasons, 'PROP_PROVIDER_RETURNED_ZERO_QUOTES');
      } else {
        addReason(rejectionReasons, `PROP_${propResult.status}`);
      }
    }

    if (!providerConfigured) return { status:'NOT_CONFIGURED', message:'Odds provider is not configured.', picks:[], modelDataAvailable:false, rejectionReasons };
    if (quotaBlocked) return { status:'QUOTA_BLOCKED', message:'Odds provider quota guard blocked the scan.', picks:rankDecisionBoardPicks(picks,5), modelDataAvailable, rejectionReasons };
    const ranked = rankDecisionBoardPicks(picks,5);
    if (!ranked.length && Object.keys(rejectionReasons).length === 0) addReason(rejectionReasons, 'NO_QUALIFIED_CANDIDATE');
    return {
      status: ranked.length ? 'SUCCESS' : 'NO_QUALIFIED_PICKS',
      message: ranked.length ? `${ranked.length} qualified recommendation${ranked.length===1?'':'s'} found.` :
        modelDataAvailable ? 'Models were evaluated, but no price cleared every recommendation gate.' : 'Independent model data was unavailable for this event.',
      picks: ranked, modelDataAvailable, rejectionReasons,
    };
  }

  async scanGames(games: NormalizedApexGame[], sportFilter: ApexSportFilter, scheduleDate: string, requestedMaxGames: number): Promise<DecisionBoardResponse> {
    const maxGames = Math.max(1, Math.min(48, Math.floor(requestedMaxGames || (sportFilter === 'ALL' ? 48 : sportFilter === 'TENNIS' ? 30 : 12))));
    const sportOrder: ApexSport[] = ['MLB', 'NFL', 'NBA', 'WNBA', 'NHL', 'SOCCER', 'TENNIS'];
    const candidates = games.filter((g) => g.status === 'UPCOMING' && g.pregameBetEligible !== false && g.startTime && Date.parse(g.startTime) > Date.now() &&
      (sportFilter === 'ALL' || g.sport === sportFilter) && isTennisDecisionBoardEligible(g))
      .sort((a,b) => Date.parse(a.startTime) - Date.parse(b.startTime));

    const coverage = new Map<ApexSport, DecisionBoardSportCoverage>();
    const ensureCoverage = (sport: ApexSport) => {
      let row = coverage.get(sport);
      if (!row) {
        const gameConnected = true;
        const propConnected = playerPropProvider.getPropMarketKeysForSport(sport).length > 0;
        row = {
          sport,
          scheduleEvents: 0,
          scannedEvents: 0,
          eventsWithModelData: 0,
          qualifiedPicks: 0,
          productionConnection: gameConnected && propConnected ? 'CONNECTED' : (gameConnected || propConnected ? 'PARTIAL' : 'NOT_CONNECTED'),
          rejectionReasons: {},
          lastStatus: null,
          lastMessage: null,
        };
        coverage.set(sport, row);
      }
      return row;
    };
    for (const g of candidates) ensureCoverage(g.sport).scheduleEvents++;
    if (sportFilter !== 'ALL') ensureCoverage(sportFilter);

    const upcoming = selectDecisionBoardSlateRows(games, sportFilter, maxGames);

    const coverageBySport = () => sportOrder.filter((sport) => coverage.has(sport)).map((sport) => coverage.get(sport)!);
    const scanMode: DecisionBoardResponse['scanMode'] = sportFilter === 'ALL' ? 'BROAD_MULTI_SPORT' : maxGames > 3 ? 'BROAD_SINGLE_SPORT' : 'NARROW';

    if (!upcoming.length) return {
      status:'NO_UPCOMING_EVENTS', message:'No verified upcoming events are available to scan.', generatedAt:new Date().toISOString(),
      sportFilter, scheduleDate, requestedMaxGames:maxGames, gamesScanned:0, gamesWithModelData:0, qualifiedCount:0, picks:[],
      coverageBySport: coverageBySport(), scanMode,
      notes:['No provider credits were used because there were no eligible events.'],
    };

    const picks: DecisionBoardPick[] = [];
    let modelData = 0;
    let status: DecisionBoardStatus = 'NO_QUALIFIED_PICKS';
    const notes: string[] = [];
    for (const game of upcoming) {
      const evaluated = await this.evaluateEvent(game);
      const row = ensureCoverage(game.sport);
      row.scannedEvents++;
      row.lastStatus = evaluated.status;
      row.lastMessage = evaluated.message;
      if (evaluated.modelDataAvailable) { modelData++; row.eventsWithModelData++; }
      row.qualifiedPicks += evaluated.picks.length;
      Object.entries(evaluated.rejectionReasons)
        .filter(([reason]) => isDisplayedCoverageBlocker(game.sport, reason))
        .forEach(([reason,count]) => addReason(row.rejectionReasons, reason, count));
      picks.push(...evaluated.picks);
      if (evaluated.status === 'NOT_CONFIGURED') { status='NOT_CONFIGURED'; notes.push('Scan stopped because ODDS_API_KEY is not configured.'); break; }
      if (evaluated.status === 'QUOTA_BLOCKED') { status='QUOTA_BLOCKED'; notes.push('Scan stopped by the provider quota guard.'); break; }
    }

    // Preserve the complete qualified slate in a short-lived in-memory handoff cache.
    // The visible board is still diversified/ranked to 12 cards, but Parlay Lab can
    // consume every verified leg from this exact scan instead of re-scanning a tiny slate.
    this.cacheQualifiedSlatePicks(sportFilter, scheduleDate, picks);

    const ranked = diversifyDecisionBoardPicks(picks, 12);
    if (ranked.length) status = 'SUCCESS';
    else if (status !== 'NOT_CONFIGURED' && status !== 'QUOTA_BLOCKED') status = 'NO_QUALIFIED_PICKS';

    notes.push('Decision-board scans now support up to 48 events in broad ALL SPORTS mode so large slates receive meaningful model coverage instead of a tiny sample.');
    if (sportFilter === 'ALL') notes.push('ALL SPORTS mode keeps round-robin fairness across active sports while allowing enough rounds for large Tennis slates to receive meaningful coverage.');
    else notes.push(`${sportFilter} filter is active; only ${sportFilter} events are eligible for this scan.`);
    notes.push('Per-sport coverage now shows decision-board-eligible scheduled events, scanned events, model-ready events, qualified picks, production-connection state and the leading rejection reasons.');
    notes.push('Tennis decision-board eligibility is singles-only with two resolved individual participants; doubles and TBD bracket placeholders remain visible in Tennis schedule/live views but are excluded before model/odds requests.');
    notes.push('Visible recommendations are sport-diversified only when another sport actually has a production-qualified pick; thresholds are never lowered to force representation.');
    notes.push('Game-market probabilities are produced independently from public historical team results; current sportsbook prices enter only after forecasting for EV/edge evaluation.');
    notes.push('APEX_GAME_MARKET_V1 remains EARLY EVIDENCE and is subject to calibration/integrity guardrails.');
    notes.push('Tennis match winner uses APEX_TENNIS_MATCH_WINNER_V1 from completed ESPN singles history; v1.14.7 adds side-identity, two-way complement, cross-book dispersion, and event-level model/market disagreement alignment audits before any recommendation can qualify.');
    notes.push('Existing player-prop production models remain ranked in the same board; future-date prop markets may not be posted yet, so a future slate can legitimately rely more heavily on game markets.');

    const coverageRows = coverageBySport();
    return {
      status,
      message: ranked.length
        ? `${ranked.length} qualified pick${ranked.length===1?'':'s'} found from ${upcoming.length} scanned event${upcoming.length===1?'':'s'}.`
        : status === 'NOT_CONFIGURED' ? 'The odds provider is not configured.'
        : status === 'QUOTA_BLOCKED' ? 'The quota guard stopped the scan before additional provider requests.'
        : 'No recommendation cleared the active gates in the scanned events. PASS is the correct output.',
      generatedAt:new Date().toISOString(), sportFilter, scheduleDate, requestedMaxGames:maxGames,
      gamesScanned:upcoming.length, gamesWithModelData:modelData, qualifiedCount:ranked.length, picks:ranked,
      coverageBySport:coverageRows, scanMode, notes,
    };
  }

  getSavedBoard(sportFilter:ApexSportFilter,scheduleDate:string):DecisionBoardResponse{
    const picks=snapshotPersistenceService.getRealPregameSnapshots().filter((s)=>(sportFilter==='ALL'||s.sport===sportFilter)&&normalizeDate(s.eventStartTime)===scheduleDate).map(snapshotToPick).filter((p):p is DecisionBoardPick=>p!==null);
    const ranked=rankDecisionBoardPicks(picks,10);
    return {status:ranked.length?'SUCCESS':'NO_QUALIFIED_PICKS',message:ranked.length?`${ranked.length} fresh saved qualified recommendation${ranked.length===1?'':'s'} available.`:'No fresh saved qualified recommendations are available for this slate yet.',generatedAt:new Date().toISOString(),sportFilter,scheduleDate,requestedMaxGames:0,gamesScanned:0,gamesWithModelData:0,qualifiedCount:ranked.length,picks:ranked,notes:['Saved-board lookup consumes zero provider credits.','Saved prop prices older than 10 minutes are excluded until the event is analyzed again. Game-model evaluations are intentionally refreshed against current executable prices.']};
  }
}
export const decisionBoardService=new DecisionBoardService();
