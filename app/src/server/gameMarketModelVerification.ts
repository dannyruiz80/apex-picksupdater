import { NormalizedApexGame, NormalizedApexEventMarkets } from '../types';
import { parseEspnTeamSchedule, summarizeTeamHistory } from './gameTeamHistoryService';
import { gameMarketModelService, GameMarketProjectionV1, normalCdf } from './gameMarketModelService';

function check(name: string, ok: boolean, details: string) {
  return { testName:name, status:(ok?'PASS':'FAIL') as 'PASS'|'FAIL', details };
}

function makeHistory(teamId: string, side: 'HOME'|'AWAY', n=20) {
  const now = Date.now() + 86400000;
  const records = Array.from({length:n},(_,i)=>({
    eventId:`${teamId}-${i}`, startTime:new Date(now-(i+2)*86400000).toISOString(), opponentId:`o-${i}`, opponentName:`Opp ${i}`,
    venueRole: side as 'HOME'|'AWAY', pointsFor:110+(i%5), pointsAgainst:103+(i%4), margin:7+(i%2), total:213+(i%6),
  }));
  return summarizeTeamHistory({sport:'NBA',teamId,teamName:teamId,asOf:new Date(now).toISOString(),records,targetVenueRole:side});
}

function fixtureModel(game: NormalizedApexGame, homeWin=0.53, shadowHome=0.535): GameMarketProjectionV1 {
  const h=makeHistory('H','HOME'), a=makeHistory('A','AWAY');
  return {
    modelVersion:'APEX_GAME_MARKET_V1', generatedAt:new Date().toISOString(), asOf:game.startTime, sport:'NBA', eventId:game.eventId,
    status:'AVAILABLE', reason:null, validationStatus:'EARLY_EVIDENCE', source:'ESPN_TEAM_SCHEDULE_HISTORY', pointInTimeValid:true, reliabilityTier:'STRONG',
    homeSampleCount:20, awaySampleCount:20, expectedHomeScore:108, expectedAwayScore:106, expectedMargin:2, expectedTotal:214, marginStdDev:11, totalStdDev:14,
    homeWinProbability:homeWin, awayWinProbability:1-homeWin, drawProbability:null, homeHistory:h, awayHistory:a, contextV2:null,
    shadowModelVersion:'APEX_GAME_MARKET_V2_SHADOW', shadowExpectedHomeScore:108.2, shadowExpectedAwayScore:105.8, shadowExpectedMargin:2.4,
    shadowExpectedTotal:214, shadowHomeWinProbability:shadowHome, shadowAwayWinProbability:1-shadowHome, notes:[],
  };
}

function book(name:string, homeOdds:number, awayOdds:number, now:string): any {
  return {
    key:name, title:name, lastUpdate:now,
    markets:[{
      key:'h2h', marketType:'MONEYLINE', lastUpdate:now,
      outcomes:[
        {name:'Home Team',price:homeOdds,americanOdds:homeOdds,decimalOdds:homeOdds>0?1+homeOdds/100:1+100/Math.abs(homeOdds),point:null},
        {name:'Away Team',price:awayOdds,americanOdds:awayOdds,decimalOdds:awayOdds>0?1+awayOdds/100:1+100/Math.abs(awayOdds),point:null},
      ],
    }],
  };
}

export function runGameMarketModelVerificationSuite() {
  const future = new Date(Date.now()+3600000).toISOString();
  const past = new Date(Date.now()-86400000).toISOString();
  const raw={events:[
    {id:'1',date:past,competitions:[{status:{type:{completed:true,state:'post'}},competitors:[{homeAway:'home',team:{id:'H',displayName:'Home'},score:'5'},{homeAway:'away',team:{id:'A'},score:'3'}]}]},
    {id:'2',date:future,competitions:[{status:{type:{completed:false,state:'pre'}},competitors:[{homeAway:'home',team:{id:'H'},score:'0'},{homeAway:'away',team:{id:'B'},score:'0'}]}]},
  ]};
  const parsed=parseEspnTeamSchedule(raw,'H',new Date(Date.now()+1000).toISOString());

  const game:NormalizedApexGame={
    eventId:'g1',sport:'NBA',league:'NBA',scheduleDate:future.slice(0,10),startTime:future,awayTeamId:'A',awayTeam:'Away Team',awayAbbreviation:'AWY',
    homeTeamId:'H',homeTeam:'Home Team',homeAbbreviation:'HOM',status:'UPCOMING',statusDetail:'Scheduled',awayScore:null,homeScore:null,venue:null,
    source:'ESPN',lastVerifiedAt:new Date().toISOString(),
  };
  const now=new Date().toISOString();
  const evidence={independentDecisiveObservations:0,calibrationGap:null};

  // A plausible early-evidence edge: best price is meaningfully better than the average no-vig market,
  // but raw model disagreement stays below the heightened-review threshold.
  const plausibleMarkets:NormalizedApexEventMarkets={
    apexEventId:'g1',providerEventId:'p1',sport:'NBA',league:'NBA',homeTeamOrPlayerA:'Home Team',awayTeamOrPlayerB:'Away Team',
    scheduledDate:future,bookmakers:[book('Book A',120,-140,now),book('Book B',-110,-110,now)],retrievedAt:now,cacheStatus:'HIT',source:'TEST',
  };
  const plausibleModel=fixtureModel(game,0.53,0.535);
  const evalGood=gameMarketModelService.evaluateMarkets(game,plausibleMarkets,plausibleModel,evidence);

  const oneBook={...plausibleMarkets,bookmakers:[book('Solo',120,-140,now)]};
  const evalDepth=gameMarketModelService.evaluateMarkets(game,oneBook,plausibleModel,evidence);

  const staleTs=new Date(Date.now()-20*60000).toISOString();
  const stale:any={...plausibleMarkets,bookmakers:[book('Old A',120,-140,staleTs),book('Old B',-110,-110,staleTs)]};
  const evalStale=gameMarketModelService.evaluateMarkets(game,stale,plausibleModel,evidence);

  // Recreate the kind of implausibly large edge surfaced by the first 1.12.0 screen.
  const extremeMarkets:NormalizedApexEventMarkets={
    ...plausibleMarkets,
    bookmakers:[book('Book A',120,-130,now),book('Book B',115,-130,now)],
  };
  const extremeModel=fixtureModel(game,0.738,0.745);
  const evalExtreme=gameMarketModelService.evaluateMarkets(game,extremeMarkets,extremeModel,evidence);
  const extremeHome=evalExtreme.candidates.find(c=>c.marketType==='MONEYLINE'&&c.side==='HOME');

  const goodHome=evalGood.candidates.find(c=>c.marketType==='MONEYLINE'&&c.side==='HOME');

  const learnedEvidence={independentDecisiveObservations:75,calibrationGap:0.06,expectedCalibrationError:0.04,brierScore:0.22,evidenceTier:'MODERATE' as const,recommendedModelWeight:0.50};
  const evalLearned=gameMarketModelService.evaluateMarkets(game,plausibleMarkets,plausibleModel,learnedEvidence);
  const learnedHome=evalLearned.candidates.find(c=>c.marketType==='MONEYLINE'&&c.side==='HOME');

  const tests=[
    check('Point-in-time parser excludes future/uncompleted games',parsed.length===1&&parsed[0].eventId==='1',`records=${parsed.length}`),
    check('Normal CDF is symmetric',Math.abs(normalCdf(1)+normalCdf(-1)-1)<1e-6,`sum=${normalCdf(1)+normalCdf(-1)}`),
    check('Plausible best-price candidate can still qualify after guardrails',!!goodHome&&goodHome.qualifies&&goodHome.sportsbook==='Book A',`status=${goodHome?.integrityStatus}; guardedEV=${goodHome?.expectedValuePercent}`),
    check('Early-evidence probability is shrunk without mutating raw model probability',!!goodHome&&goodHome.decisionProbability<goodHome.modelProbability&&Math.abs(goodHome.modelProbability-0.53)<1e-9,`raw=${goodHome?.modelProbability}; guarded=${goodHome?.decisionProbability}`),
    check('Prospective calibration learning corrects overconfidence without rewriting raw probability',!!learnedHome&&learnedHome.prospectiveCalibrationAdjustmentPP<0&&Math.abs(learnedHome.modelProbability-0.53)<1e-9&&learnedHome.calibrationAdjustedProbability<learnedHome.modelProbability,`raw=${learnedHome?.modelProbability}; calibrated=${learnedHome?.calibrationAdjustedProbability}; deltaPP=${learnedHome?.prospectiveCalibrationAdjustmentPP}`),
    check('Extreme model-vs-market disagreement is VERIFY, not BET',!!extremeHome&&extremeHome.integrityStatus==='VERIFY'&&!extremeHome.qualifies&&extremeHome.reasonCodes.includes('MODEL_MARKET_DISAGREEMENT_EXTREME'),`status=${extremeHome?.integrityStatus}; disagreement=${extremeHome?.modelMarketDisagreementPP}`),
    check('Extreme guarded EV is not auto-promoted',!!extremeHome&&extremeHome.evTier==='EXTREME'&&extremeHome.reasonCodes.includes('GUARDED_EV_EXTREME_VERIFY_REQUIRED'),`tier=${extremeHome?.evTier}; guardedEV=${extremeHome?.expectedValuePercent}`),
    check('Market depth gate blocks one-book price',evalDepth.qualified.length===0&&evalDepth.candidates.some(c=>c.reasonCodes.includes('MARKET_DEPTH_BELOW_2_BOOKS')),`qualified=${evalDepth.qualified.length}`),
    check('Stale quotes cannot qualify',evalStale.qualified.length===0&&evalStale.candidates.length===0,`candidates=${evalStale.candidates.length}`),
    check('Sportsbook consensus remains comparison/guardrail reference only',!!goodHome&&goodHome.marketConsensusProbability!==null&&goodHome.decisionReferenceProbability===goodHome.marketConsensusProbability,`consensus=${goodHome?.marketConsensusProbability}`),
    check('V2 contribution is explicitly labeled when immaterial',!!goodHome&&goodHome.v2ContributionStatus==='NO_MATERIAL_ADJUSTMENT',`v2Delta=${goodHome?.v2ContributionPP}`),
    check('Cross-market consistency flag remains true for coherent distribution',evalGood.candidates.every(c=>c.crossMarketConsistent),`candidates=${evalGood.candidates.length}`),
  ];

  return {
    allPassed:tests.every(t=>t.status==='PASS'),
    verificationTimestamp:new Date().toISOString(),
    modelVersion:'APEX_GAME_MARKET_V1',
    shadowModelVersion:'APEX_GAME_MARKET_V2_SHADOW',
    integrityVersion:'APEX_GAME_MARKET_INTEGRITY_V1_12_1',
    calibrationLearningVersion:'APEX_GAME_CALIBRATION_LEARNING_V1_13',
    keyedOddsRequestsConsumed:0,
    tests,
  };
}
