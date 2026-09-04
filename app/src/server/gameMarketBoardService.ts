import {
  ApexSport,
  ApexSportFilter,
  DecisionBoardPick,
  DecisionBoardStatus,
  GameMarketBoardEvent,
  GameMarketBoardResponse,
  MarketType,
  NormalizedApexGame,
} from '../types.js';
import { marketProvider } from './marketProvider.js';
import { gameMarketModelService } from './gameMarketModelService.js';
import { gameMarketPredictionRepository } from './gameMarketPredictionRepository.js';
import { gameCandidateToPick, rankDecisionBoardPicks } from './decisionBoardService.js';

function eventTitle(game: NormalizedApexGame): string {
  return `${game.awayTeam || 'Away'} @ ${game.homeTeam || 'Home'}`;
}

function bestOfType(picks: DecisionBoardPick[], type: MarketType): DecisionBoardPick | null {
  return rankDecisionBoardPicks(picks.filter((p) => p.gameMarketType === type), 1)[0] ?? null;
}

function bestCandidateOfType(picks: DecisionBoardPick[], type: MarketType): DecisionBoardPick | null {
  const priority = (p: DecisionBoardPick) => {
    switch (p.gameIntegrityStatus) {
      case 'QUALIFIED': return 4;
      case 'REVIEW': return 3;
      case 'VERIFY': return 2;
      default: return 1;
    }
  };
  return [...picks]
    .filter((p) => p.gameMarketType === type)
    .sort((a, b) =>
      priority(b) - priority(a) ||
      b.expectedValuePercent - a.expectedValuePercent ||
      b.apexProbability - a.apexProbability
    )[0] ?? null;
}

function eligibleGames(games: NormalizedApexGame[], sport: ApexSportFilter, limit: number): NormalizedApexGame[] {
  const rows = games
    .filter((g) => g.sport !== 'TENNIS' && g.status === 'UPCOMING' && g.startTime && Date.parse(g.startTime) > Date.now())
    .filter((g) => sport === 'ALL' || g.sport === sport)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  if (sport !== 'ALL') return rows.slice(0, limit);

  const firstBySport: NormalizedApexGame[] = [];
  const used = new Set<ApexSport>();
  for (const g of rows) {
    if (used.has(g.sport)) continue;
    used.add(g.sport);
    firstBySport.push(g);
    if (firstBySport.length >= limit) return firstBySport;
  }
  for (const g of rows) {
    if (firstBySport.some((x) => x.eventId === g.eventId)) continue;
    firstBySport.push(g);
    if (firstBySport.length >= limit) break;
  }
  return firstBySport;
}

export class GameMarketBoardService {
  async scan(
    games: NormalizedApexGame[],
    sportFilter: ApexSportFilter,
    scheduleDate: string,
    requestedMaxGames: number,
  ): Promise<GameMarketBoardResponse> {
    const maxGames = Math.max(1, Math.min(8, Math.floor(requestedMaxGames || 5)));
    const selected = eligibleGames(games, sportFilter, maxGames);
    if (!selected.length) {
      return {
        status: 'NO_UPCOMING_EVENTS',
        message: 'No supported verified upcoming team events are available for game-market modeling.',
        generatedAt: new Date().toISOString(), sportFilter, scheduleDate, requestedMaxGames: maxGames,
        gamesScanned: 0, modelsAvailable: 0, qualifiedCount: 0,
        topMoneyline: null, topSpread: null, topTotal: null,
        topMoneylineCandidate: null, topSpreadCandidate: null, topTotalCandidate: null,
        reviewCount: 0, rankedGamePicks: [], events: [],
        notes: ['Tennis is intentionally excluded because it uses a separate player/match model.'],
      };
    }

    const evidenceStatus = gameMarketPredictionRepository.getStatus();

    const events: GameMarketBoardEvent[] = [];
    const allQualified: DecisionBoardPick[] = [];
    const allCandidates: DecisionBoardPick[] = [];
    let modelsAvailable = 0;
    let status: DecisionBoardStatus = 'NO_QUALIFIED_PICKS';
    const notes: string[] = [];

    for (const game of selected) {
      const marketResult = await marketProvider.getMarketsForEvent(game);
      if (marketResult.status === 'NOT_CONFIGURED') {
        status = 'NOT_CONFIGURED';
        notes.push('Scan stopped because the Odds API provider is not configured at runtime.');
        break;
      }
      if (marketResult.status === 'QUOTA_EXCEEDED') {
        status = 'QUOTA_BLOCKED';
        notes.push('Scan stopped by the provider quota guard.');
        break;
      }

      const model = await gameMarketModelService.buildProjection(game);
      let qualifiedPicks: DecisionBoardPick[] = [];
      let reviewPicks: DecisionBoardPick[] = [];
      let candidateCount = 0;

      if (model.status === 'AVAILABLE') {
        modelsAvailable++;
        if (marketResult.status === 'SUCCESS' && marketResult.markets) {
          const sportEvidence = gameMarketPredictionRepository.getEvidenceFor(game.sport);
          const evaluation = gameMarketModelService.evaluateMarkets(game, marketResult.markets, model, {
            independentDecisiveObservations: sportEvidence.independentDecisiveObservations,
            calibrationGap: sportEvidence.calibrationGap,
            byMarket: {
              MONEYLINE: gameMarketPredictionRepository.getEvidenceFor(game.sport, 'MONEYLINE'),
              SPREAD: gameMarketPredictionRepository.getEvidenceFor(game.sport, 'SPREAD'),
              TOTAL: gameMarketPredictionRepository.getEvidenceFor(game.sport, 'TOTAL'),
            },
          });
          gameMarketPredictionRepository.append(game, evaluation);
          candidateCount = evaluation.candidates.length;

          const candidatePicks = evaluation.candidates.map((c) => gameCandidateToPick(game, model, c));
          qualifiedPicks = rankDecisionBoardPicks(candidatePicks.filter((p) => p.gameIntegrityStatus === 'QUALIFIED'), 12);
          reviewPicks = candidatePicks
            .filter((p) => p.gameIntegrityStatus === 'REVIEW' || p.gameIntegrityStatus === 'VERIFY')
            .sort((a,b) => b.expectedValuePercent - a.expectedValuePercent)
            .slice(0, 8);

          allCandidates.push(...candidatePicks);
          allQualified.push(...qualifiedPicks);
        }
      }

      events.push({
        eventId: game.eventId,
        eventTitle: eventTitle(game),
        sport: game.sport,
        league: game.league || game.competition || game.sport,
        startTime: game.startTime,
        homeTeam: game.homeTeam || 'Home',
        awayTeam: game.awayTeam || 'Away',
        modelStatus: model.status,
        modelReason: model.reason,
        modelVersion: model.modelVersion,
        validationStatus: model.validationStatus,
        reliabilityTier: model.reliabilityTier,
        homeSampleCount: model.homeSampleCount,
        awaySampleCount: model.awaySampleCount,
        expectedHomeScore: model.expectedHomeScore,
        expectedAwayScore: model.expectedAwayScore,
        expectedMargin: model.expectedMargin,
        expectedTotal: model.expectedTotal,
        homeWinProbability: model.homeWinProbability,
        awayWinProbability: model.awayWinProbability,
        drawProbability: model.drawProbability,
        shadowModelVersion: model.shadowModelVersion,
        shadowExpectedHomeScore: model.shadowExpectedHomeScore,
        shadowExpectedAwayScore: model.shadowExpectedAwayScore,
        shadowHomeWinProbability: model.shadowHomeWinProbability,
        shadowAwayWinProbability: model.shadowAwayWinProbability,
        contextStatus: model.contextV2?.status ?? null,
        contextNotes: [...(model.contextV2?.notes ?? [])],
        qualifiedPicks,
        reviewPicks,
        candidateCount,
        rejectedCandidateCount: Math.max(0, candidateCount - qualifiedPicks.length),
      });
    }

    const rankedGamePicks = rankDecisionBoardPicks(allQualified, 20);
    const reviewCount = allCandidates.filter((p) => p.gameIntegrityStatus === 'REVIEW' || p.gameIntegrityStatus === 'VERIFY').length;
    if (rankedGamePicks.length) status = 'SUCCESS';
    else if (status !== 'NOT_CONFIGURED' && status !== 'QUOTA_BLOCKED') status = 'NO_QUALIFIED_PICKS';

    notes.push('Raw independent model probability and guarded decision probability are now separate. Early-evidence shrinkage cannot change the raw sports forecast.');
    notes.push('Extreme model-vs-market disagreement and extreme guarded EV are VERIFY states, not automatic bets.');
    notes.push('Heightened EV/disagreement is held for REVIEW rather than being promoted to Best Pick.');
    notes.push('Cross-market monotonicity is verified across moneyline/spread/total candidates from the same event distribution.');
    notes.push(`Game-model evidence currently contains ${Number(evidenceStatus.independentDecisiveObservations || 0)} independent decisive observations overall. Shrinkage is applied by sport and market type so MLB totals cannot mature an NFL moneyline model.`);
    notes.push('APEX_GAME_MARKET_V2_SHADOW remains audit-only. Its contribution is labeled MATERIAL, NO MATERIAL ADJUSTMENT, or UNAVAILABLE.');

    return {
      status,
      message: rankedGamePicks.length
        ? `${rankedGamePicks.length} integrity-qualified game-market play${rankedGamePicks.length === 1 ? '' : 's'} found. ${reviewCount} additional candidate${reviewCount === 1 ? '' : 's'} require review/verification.`
        : status === 'NOT_CONFIGURED'
          ? 'The Odds API provider is not configured at runtime.'
          : status === 'QUOTA_BLOCKED'
            ? 'The quota guard stopped the game-market scan.'
            : `Win probabilities were modeled, but no current moneyline/spread/total price cleared every integrity gate. ${reviewCount} candidate${reviewCount === 1 ? '' : 's'} require review/verification.`,
      generatedAt: new Date().toISOString(), sportFilter, scheduleDate, requestedMaxGames: maxGames,
      gamesScanned: events.length, modelsAvailable, qualifiedCount: rankedGamePicks.length,
      topMoneyline: bestOfType(rankedGamePicks, 'MONEYLINE'),
      topSpread: bestOfType(rankedGamePicks, 'SPREAD'),
      topTotal: bestOfType(rankedGamePicks, 'TOTAL'),
      topMoneylineCandidate: bestCandidateOfType(allCandidates, 'MONEYLINE'),
      topSpreadCandidate: bestCandidateOfType(allCandidates, 'SPREAD'),
      topTotalCandidate: bestCandidateOfType(allCandidates, 'TOTAL'),
      reviewCount,
      rankedGamePicks,
      events,
      notes,
    };
  }
}

export const gameMarketBoardService = new GameMarketBoardService();
