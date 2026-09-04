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
} from '../types.js';
import { playerPropProvider } from './playerPropProvider.js';
import { snapshotPersistenceService } from './snapshotPersistenceService.js';
import { marketProvider } from './marketProvider.js';
import { gameMarketModelService, GameMarketCandidateV1, GameMarketProjectionV1 } from './gameMarketModelService.js';
import { gameMarketPredictionRepository } from './gameMarketPredictionRepository.js';

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
  const displayPick = `${quote.playerDisplayName} ${rec.side} ${quote.line}`;
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
  const displayPick = `${snapshot.playerName} ${snapshot.side} ${snapshot.line}`;
  return {
    rank: 0, eventId: snapshot.eventId, eventTitle: `${snapshot.team || 'Team'} vs ${snapshot.opponent || 'Opponent'}`,
    sport: snapshot.sport, league: snapshot.league, startTime: snapshot.eventStartTime, pickType: 'PLAYER_PROP', displayPick,
    selectionLabel: displayPick, gameMarketType: null, playerName: snapshot.playerName, playerId: snapshot.playerId,
    marketKey: snapshot.market, marketCategory: snapshot.market, side: snapshot.side, line: snapshot.line,
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

export class DecisionBoardService {
  async evaluateEvent(game: NormalizedApexGame): Promise<{ status: DecisionBoardStatus; message: string; picks: DecisionBoardPick[]; modelDataAvailable: boolean }> {
    if (game.status !== 'UPCOMING' || !game.startTime || Date.parse(game.startTime) <= Date.now())
      return { status:'NO_UPCOMING_EVENTS', message:'Only verified pregame events can be analyzed for a pick.', picks:[], modelDataAvailable:false };

    const picks: DecisionBoardPick[] = [];
    let modelDataAvailable = false;
    let providerConfigured = true;
    let quotaBlocked = false;

    // Independent team-game market path. Tennis is intentionally excluded because it uses a separate player model.
    if (game.sport !== 'TENNIS') {
      const marketResult = await marketProvider.getMarketsForEvent(game);
      if (marketResult.status === 'NOT_CONFIGURED') providerConfigured = false;
      else if (marketResult.status === 'QUOTA_EXCEEDED') quotaBlocked = true;
      else if (marketResult.status === 'SUCCESS' && marketResult.markets) {
        const model = await gameMarketModelService.buildProjection(game);
        if (model.status === 'AVAILABLE') {
          modelDataAvailable = true;
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
          picks.push(...evaluation.qualified.map((c)=>gameCandidateToPick(game, model, c)));
        }
      }
    }

    // Existing player-prop production path remains active in parallel where provider markets exist.
    if (playerPropProvider.getPropMarketKeysForSport(game.sport).length > 0 && !quotaBlocked) {
      const propResult = await playerPropProvider.getPlayerPropsForGame(game);
      if (propResult.status === 'NOT_CONFIGURED') providerConfigured = false;
      else if (propResult.status === 'QUOTA_EXCEEDED') quotaBlocked = true;
      else if (propResult.status === 'SUCCESS') {
        modelDataAvailable = true;
        picks.push(...(propResult.props || []).map((q)=>quoteToPick(game,q)).filter((p):p is DecisionBoardPick=>p!==null));
      }
    }

    if (!providerConfigured) return { status:'NOT_CONFIGURED', message:'Odds provider is not configured.', picks:[], modelDataAvailable:false };
    if (quotaBlocked) return { status:'QUOTA_BLOCKED', message:'Odds provider quota guard blocked the scan.', picks:rankDecisionBoardPicks(picks,5), modelDataAvailable };
    const ranked = rankDecisionBoardPicks(picks,5);
    return {
      status: ranked.length ? 'SUCCESS' : 'NO_QUALIFIED_PICKS',
      message: ranked.length ? `${ranked.length} qualified recommendation${ranked.length===1?'':'s'} found.` :
        modelDataAvailable ? 'Models were evaluated, but no price cleared every recommendation gate.' : 'Independent model data was unavailable for this event.',
      picks: ranked, modelDataAvailable,
    };
  }

  async scanGames(games: NormalizedApexGame[], sportFilter: ApexSportFilter, scheduleDate: string, requestedMaxGames: number): Promise<DecisionBoardResponse> {
    const maxGames = Math.max(1,Math.min(5,Math.floor(requestedMaxGames||3)));
    const candidates = games.filter((g)=>g.status==='UPCOMING' && g.startTime && Date.parse(g.startTime)>Date.now() &&
      (g.sport !== 'TENNIS' || playerPropProvider.getPropMarketKeysForSport(g.sport).length>0))
      .sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime));
    const upcoming: NormalizedApexGame[]=[];
    if (sportFilter==='ALL') {
      const used=new Set<ApexSport>();
      for (const g of candidates) if(!used.has(g.sport)){upcoming.push(g);used.add(g.sport);if(upcoming.length>=maxGames)break;}
      if(upcoming.length<maxGames) for(const g of candidates){if(upcoming.some(x=>x.eventId===g.eventId))continue;upcoming.push(g);if(upcoming.length>=maxGames)break;}
    } else upcoming.push(...candidates.slice(0,maxGames));
    if(!upcoming.length) return {status:'NO_UPCOMING_EVENTS',message:'No verified upcoming events are available to scan.',generatedAt:new Date().toISOString(),sportFilter,scheduleDate,requestedMaxGames:maxGames,gamesScanned:0,gamesWithModelData:0,qualifiedCount:0,picks:[],notes:['No provider credits were used because there were no eligible events.']};

    const picks:DecisionBoardPick[]=[]; let modelData=0; let status:DecisionBoardStatus='NO_QUALIFIED_PICKS'; const notes:string[]=[];
    for(const game of upcoming){const evaluated=await this.evaluateEvent(game);if(evaluated.modelDataAvailable)modelData++;picks.push(...evaluated.picks);if(evaluated.status==='NOT_CONFIGURED'){status='NOT_CONFIGURED';notes.push('Scan stopped because ODDS_API_KEY is not configured.');break;}if(evaluated.status==='QUOTA_BLOCKED'){status='QUOTA_BLOCKED';notes.push('Scan stopped by the provider quota guard.');break;}}
    const ranked=rankDecisionBoardPicks(picks,10); if(ranked.length)status='SUCCESS';else if(status!=='NOT_CONFIGURED'&&status!=='QUOTA_BLOCKED')status='NO_QUALIFIED_PICKS';
    notes.push('Game-market probabilities are produced independently from public historical team results; current sportsbook prices enter only after forecasting for EV/edge evaluation.');
    notes.push('APEX_GAME_MARKET_V1 is EARLY EVIDENCE. Its prospective predictions are logged separately for calibration and challenger testing.');
    notes.push('Existing player-prop production models remain ranked in the same board; NO_BET results are never promoted.');
    notes.push(`Slate scan is capped at ${maxGames} event${maxGames===1?'':'s'} and runs sequentially to limit keyed-provider usage.`);
    if(sportFilter==='ALL')notes.push('ALL SPORTS mode samples distinct sports first before repeating a sport.');
    return {status,message:ranked.length?`${ranked.length} qualified pick${ranked.length===1?'':'s'} found from ${upcoming.length} scanned event${upcoming.length===1?'':'s'}.`:status==='NOT_CONFIGURED'?'The odds provider is not configured.':status==='QUOTA_BLOCKED'?'The quota guard stopped the scan before additional provider requests.':'No recommendation cleared the active gates in the scanned events. PASS is the correct output.',generatedAt:new Date().toISOString(),sportFilter,scheduleDate,requestedMaxGames:maxGames,gamesScanned:upcoming.length,gamesWithModelData:modelData,qualifiedCount:ranked.length,picks:ranked,notes};
  }

  getSavedBoard(sportFilter:ApexSportFilter,scheduleDate:string):DecisionBoardResponse{
    const picks=snapshotPersistenceService.getRealPregameSnapshots().filter((s)=>(sportFilter==='ALL'||s.sport===sportFilter)&&normalizeDate(s.eventStartTime)===scheduleDate).map(snapshotToPick).filter((p):p is DecisionBoardPick=>p!==null);
    const ranked=rankDecisionBoardPicks(picks,10);
    return {status:ranked.length?'SUCCESS':'NO_QUALIFIED_PICKS',message:ranked.length?`${ranked.length} fresh saved qualified recommendation${ranked.length===1?'':'s'} available.`:'No fresh saved qualified recommendations are available for this slate yet.',generatedAt:new Date().toISOString(),sportFilter,scheduleDate,requestedMaxGames:0,gamesScanned:0,gamesWithModelData:0,qualifiedCount:ranked.length,picks:ranked,notes:['Saved-board lookup consumes zero provider credits.','Saved prop prices older than 10 minutes are excluded until the event is analyzed again. Game-model evaluations are intentionally refreshed against current executable prices.']};
  }
}
export const decisionBoardService=new DecisionBoardService();
