import {
  ApexSport,
  ApexSportFilter,
  NormalizedApexGame,
  NormalizedPlayerPropQuote,
  SampleReliabilityTier,
  ProbabilityCalibrationStatus,
  DurableHistoricalPropSnapshot,
  DecisionBoardStatus,
  DecisionBoardPick,
  DecisionBoardResponse,
} from '../types.js';
import { playerPropProvider } from './playerPropProvider.js';
import { snapshotPersistenceService } from './snapshotPersistenceService.js';

const RELIABILITY_ORDER: Record<SampleReliabilityTier, number> = {
  VERY_LIMITED: 0,
  LIMITED: 1,
  MODERATE: 2,
  STRONG: 3,
};

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

function eventTitle(game: NormalizedApexGame): string {
  if (game.sport === 'TENNIS') {
    return `${game.playerAName || 'Player A'} vs ${game.playerBName || 'Player B'}`;
  }
  return `${game.awayTeam || 'Away'} @ ${game.homeTeam || 'Home'}`;
}

function quoteAgeSeconds(timestamp: string): number | null {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((Date.now() - parsed) / 1000));
}

function buildRationale(params: {
  probability: number;
  breakEven: number;
  edge: number;
  ev: number;
  reliability: SampleReliabilityTier;
  isBestPrice: boolean;
  v3Support: boolean | null;
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

  return {
    rank: 0,
    eventId: game.eventId,
    eventTitle: eventTitle(game),
    sport: game.sport,
    league: game.league || game.competition || game.tournamentName || game.sport,
    startTime: game.startTime,
    playerName: quote.playerDisplayName,
    playerId: quote.playerId,
    marketKey: quote.providerMarketKey,
    marketCategory: quote.marketCategory,
    side: rec.side,
    line: quote.line,
    sportsbook: selected.bestSportsbook || selected.sportsbook,
    oddsAmerican: selected.bestOddsAmerican,
    apexProbability: selected.apexProbability,
    breakEvenProbability: selected.breakEvenProbability,
    edgePercentagePoints: selected.modelEdgePercentagePoints,
    expectedValuePercent: selected.expectedValuePercent,
    reliabilityTier,
    modelVersion: probability?.modelVersion || 'UNKNOWN',
    calibrationStatus: probability?.calibration?.status ?? null,
    quoteTimestamp: quote.providerTimestamp,
    quoteAgeSeconds: quoteAgeSeconds(quote.providerTimestamp),
    pointInTimeValid: probability?.pointInTimeAudit?.isValid === true,
    v3ShadowProbability,
    v3ShadowSupportsProduction: v3Support,
    rationale: buildRationale({
      probability: selected.apexProbability,
      breakEven: selected.breakEvenProbability,
      edge: selected.modelEdgePercentagePoints,
      ev: selected.expectedValuePercent,
      reliability: reliabilityTier,
      isBestPrice: selected.isBestAvailablePrice,
      v3Support,
    }),
    source: 'LIVE_EVALUATION',
  };
}

function snapshotToPick(snapshot: DurableHistoricalPropSnapshot): DecisionBoardPick | null {
  if (
    snapshot.snapshotType !== 'REAL_PREGAME' ||
    snapshot.historicalEligibility !== 'ELIGIBLE' ||
    snapshot.verificationState !== 'VERIFIED' ||
    snapshot.gradingStatus !== 'PENDING' ||
    snapshot.pointInTimeValid !== true ||
    snapshot.recommendation !== 'QUALIFIES' ||
    !snapshot.side ||
    snapshot.apexProbability === null ||
    snapshot.breakEvenProbability === null ||
    snapshot.modelEdge === null ||
    snapshot.expectedValue === null ||
    snapshot.americanOdds === null
  ) return null;

  if (!snapshot.eventStartTime || Date.parse(snapshot.eventStartTime) <= Date.now()) return null;
  const age = quoteAgeSeconds(snapshot.sportsbookQuoteTimestamp);
  // Saved recommendations are displayable only while the underlying price remains reasonably fresh.
  if (age === null || age > 10 * 60) return null;

  const shadow = snapshot.mlbPitcherKV3;
  const shadowSideProbability = snapshot.side === 'OVER'
    ? shadow?.shadowOverProbability ?? null
    : shadow?.shadowUnderProbability ?? null;
  const v3Support = shadowSideProbability === null ? null : shadowSideProbability >= 0.5;

  return {
    rank: 0,
    eventId: snapshot.eventId,
    eventTitle: `${snapshot.team || 'Team'} vs ${snapshot.opponent || 'Opponent'}`,
    sport: snapshot.sport,
    league: snapshot.league,
    startTime: snapshot.eventStartTime,
    playerName: snapshot.playerName,
    playerId: snapshot.playerId,
    marketKey: snapshot.market,
    marketCategory: snapshot.market,
    side: snapshot.side,
    line: snapshot.line,
    sportsbook: snapshot.sportsbook,
    oddsAmerican: snapshot.americanOdds,
    apexProbability: snapshot.apexProbability,
    breakEvenProbability: snapshot.breakEvenProbability,
    edgePercentagePoints: snapshot.modelEdge,
    expectedValuePercent: snapshot.expectedValue,
    reliabilityTier: snapshot.reliabilityTier,
    modelVersion: snapshot.modelVersion,
    calibrationStatus: snapshot.calibrationStatus ?? null,
    quoteTimestamp: snapshot.sportsbookQuoteTimestamp,
    quoteAgeSeconds: age,
    pointInTimeValid: true,
    v3ShadowProbability: shadowSideProbability,
    v3ShadowSupportsProduction: v3Support,
    rationale: buildRationale({
      probability: snapshot.apexProbability,
      breakEven: snapshot.breakEvenProbability,
      edge: snapshot.modelEdge,
      ev: snapshot.expectedValue,
      reliability: snapshot.reliabilityTier,
      isBestPrice: false,
      v3Support,
    }),
    source: 'SAVED_SNAPSHOT',
  };
}

export function rankDecisionBoardPicks(picks: DecisionBoardPick[], limit = 10): DecisionBoardPick[] {
  const byIdentity = new Map<string, DecisionBoardPick>();
  for (const pick of picks) {
    const key = `${pick.eventId}|${pick.playerId}|${pick.marketKey}|${pick.line}|${pick.side}`;
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, pick);
      continue;
    }
    const existingTs = Date.parse(existing.quoteTimestamp) || 0;
    const candidateTs = Date.parse(pick.quoteTimestamp) || 0;
    if (candidateTs > existingTs || (candidateTs === existingTs && pick.expectedValuePercent > existing.expectedValuePercent)) {
      byIdentity.set(key, pick);
    }
  }

  return [...byIdentity.values()]
    .sort((a, b) => {
      const r = RELIABILITY_ORDER[b.reliabilityTier] - RELIABILITY_ORDER[a.reliabilityTier];
      if (r !== 0) return r;
      if (b.apexProbability !== a.apexProbability) return b.apexProbability - a.apexProbability;
      if (b.expectedValuePercent !== a.expectedValuePercent) return b.expectedValuePercent - a.expectedValuePercent;
      return b.edgePercentagePoints - a.edgePercentagePoints;
    })
    .slice(0, limit)
    .map((pick, idx) => ({ ...pick, rank: idx + 1 }));
}

export class DecisionBoardService {
  async evaluateEvent(game: NormalizedApexGame): Promise<{ status: DecisionBoardStatus; message: string; picks: DecisionBoardPick[]; modelDataAvailable: boolean }> {
    if (game.status !== 'UPCOMING' || !game.startTime || Date.parse(game.startTime) <= Date.now()) {
      return { status: 'NO_UPCOMING_EVENTS', message: 'Only verified pregame events can be analyzed for a pick.', picks: [], modelDataAvailable: false };
    }

    const result = await playerPropProvider.getPlayerPropsForGame(game);
    if (result.status === 'NOT_CONFIGURED') {
      return { status: 'NOT_CONFIGURED', message: result.message || 'Odds provider is not configured.', picks: [], modelDataAvailable: false };
    }
    if (result.status === 'QUOTA_EXCEEDED') {
      return { status: 'QUOTA_BLOCKED', message: result.message || 'Odds provider quota guard blocked the scan.', picks: [], modelDataAvailable: false };
    }
    if (result.status !== 'SUCCESS') {
      return { status: 'NO_QUALIFIED_PICKS', message: result.message || 'No verified prop model data was available for this event.', picks: [], modelDataAvailable: false };
    }

    const converted = (result.props || []).map((q) => quoteToPick(game, q)).filter((p): p is DecisionBoardPick => p !== null);
    const picks = rankDecisionBoardPicks(converted, 5);
    return {
      status: picks.length > 0 ? 'SUCCESS' : 'NO_QUALIFIED_PICKS',
      message: picks.length > 0
        ? `${picks.length} production-qualified recommendation${picks.length === 1 ? '' : 's'} found.`
        : 'Model data was evaluated, but no recommendation cleared every production gate.',
      picks,
      modelDataAvailable: true,
    };
  }

  async scanGames(games: NormalizedApexGame[], sportFilter: ApexSportFilter, scheduleDate: string, requestedMaxGames: number): Promise<DecisionBoardResponse> {
    const maxGames = Math.max(1, Math.min(5, Math.floor(requestedMaxGames || 3)));
    const candidates = games
      .filter((g) =>
        g.status === 'UPCOMING' &&
        g.startTime &&
        Date.parse(g.startTime) > Date.now() &&
        playerPropProvider.getPropMarketKeysForSport(g.sport).length > 0
      )
      .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

    // On ALL SPORTS, inspect distinct sports first before taking another event from the same sport.
    // This improves cross-sport discovery without increasing the provider-request cap.
    const upcoming: NormalizedApexGame[] = [];
    if (sportFilter === 'ALL') {
      const usedSports = new Set<ApexSport>();
      for (const game of candidates) {
        if (!usedSports.has(game.sport)) {
          upcoming.push(game);
          usedSports.add(game.sport);
          if (upcoming.length >= maxGames) break;
        }
      }
      if (upcoming.length < maxGames) {
        for (const game of candidates) {
          if (upcoming.some((g) => g.eventId === game.eventId)) continue;
          upcoming.push(game);
          if (upcoming.length >= maxGames) break;
        }
      }
    } else {
      upcoming.push(...candidates.slice(0, maxGames));
    }

    if (upcoming.length === 0) {
      return {
        status: 'NO_UPCOMING_EVENTS',
        message: 'No verified upcoming events are available to scan.',
        generatedAt: new Date().toISOString(),
        sportFilter,
        scheduleDate,
        requestedMaxGames: maxGames,
        gamesScanned: 0,
        gamesWithModelData: 0,
        qualifiedCount: 0,
        picks: [],
        notes: ['No provider credits were used because there were no eligible events.'],
      };
    }

    const picks: DecisionBoardPick[] = [];
    let modelData = 0;
    let status: DecisionBoardStatus = 'NO_QUALIFIED_PICKS';
    const notes: string[] = [];

    // Sequential by design: prevents a broad slate scan from bursting provider requests.
    for (const game of upcoming) {
      const evaluated = await this.evaluateEvent(game);
      if (evaluated.modelDataAvailable) modelData++;
      picks.push(...evaluated.picks);
      if (evaluated.status === 'NOT_CONFIGURED') {
        status = 'NOT_CONFIGURED';
        notes.push('Scan stopped because ODDS_API_KEY is not configured.');
        break;
      }
      if (evaluated.status === 'QUOTA_BLOCKED') {
        status = 'QUOTA_BLOCKED';
        notes.push('Scan stopped by the provider quota guard.');
        break;
      }
    }

    const ranked = rankDecisionBoardPicks(picks, 10);
    if (ranked.length > 0) status = 'SUCCESS';
    else if (status !== 'NOT_CONFIGURED' && status !== 'QUOTA_BLOCKED') status = 'NO_QUALIFIED_PICKS';

    notes.push('Only production-gate QUALIFIES recommendations are ranked. NO_BET results are never promoted.');
    notes.push(`Slate scan is capped at ${maxGames} model-supported event${maxGames === 1 ? '' : 's'} and runs sequentially to limit keyed-provider usage.`);
    if (sportFilter === 'ALL') notes.push('ALL SPORTS mode samples distinct supported sports first before repeating a sport.');

    return {
      status,
      message: ranked.length > 0
        ? `${ranked.length} qualified pick${ranked.length === 1 ? '' : 's'} found from ${upcoming.length} scanned event${upcoming.length === 1 ? '' : 's'}.`
        : status === 'NOT_CONFIGURED'
          ? 'The odds provider is not configured.'
          : status === 'QUOTA_BLOCKED'
            ? 'The quota guard stopped the scan before additional provider requests.'
            : 'No recommendation cleared the production gate in the scanned events. PASS is the correct output.',
      generatedAt: new Date().toISOString(),
      sportFilter,
      scheduleDate,
      requestedMaxGames: maxGames,
      gamesScanned: upcoming.length,
      gamesWithModelData: modelData,
      qualifiedCount: ranked.length,
      picks: ranked,
      notes,
    };
  }

  getSavedBoard(sportFilter: ApexSportFilter, scheduleDate: string): DecisionBoardResponse {
    const snapshots = snapshotPersistenceService.getRealPregameSnapshots();
    const picks = snapshots
      .filter((s) => (sportFilter === 'ALL' || s.sport === sportFilter) && normalizeDate(s.eventStartTime) === scheduleDate)
      .map(snapshotToPick)
      .filter((p): p is DecisionBoardPick => p !== null);
    const ranked = rankDecisionBoardPicks(picks, 10);

    return {
      status: ranked.length > 0 ? 'SUCCESS' : 'NO_QUALIFIED_PICKS',
      message: ranked.length > 0
        ? `${ranked.length} fresh saved qualified recommendation${ranked.length === 1 ? '' : 's'} available.`
        : 'No fresh saved qualified recommendations are available for this slate yet.',
      generatedAt: new Date().toISOString(),
      sportFilter,
      scheduleDate,
      requestedMaxGames: 0,
      gamesScanned: 0,
      gamesWithModelData: 0,
      qualifiedCount: ranked.length,
      picks: ranked,
      notes: [
        'Saved-board lookup consumes zero provider credits.',
        'Saved prices older than 10 minutes are excluded until the event is analyzed again.',
      ],
    };
  }
}

export const decisionBoardService = new DecisionBoardService();
