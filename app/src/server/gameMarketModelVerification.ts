import { NormalizedApexGame, NormalizedApexEventMarkets } from '../types';
import { parseEspnTeamSchedule, summarizeTeamHistory } from './gameTeamHistoryService';
import { gameMarketModelService, GameMarketProjectionV1, normalCdf } from './gameMarketModelService';

function check(name: string, ok: boolean, details: string) { return { testName:name, status:ok?'PASS':'FAIL' as 'PASS'|'FAIL', details }; }

function makeHistory(teamId: string, side: 'HOME'|'AWAY', n=20) {
  const now = Date.now() + 86400000;
  const records = Array.from({length:n},(_,i)=>({
    eventId:`${teamId}-${i}`, startTime:new Date(now-(i+2)*86400000).toISOString(), opponentId:`o-${i}`, opponentName:`Opp ${i}`,
    venueRole: side as 'HOME'|'AWAY', pointsFor:110+(i%5), pointsAgainst:103+(i%4), margin:7+(i%2), total:213+(i%6),
  }));
  return summarizeTeamHistory({sport:'NBA',teamId,teamName:teamId,asOf:new Date(now).toISOString(),records,targetVenueRole:side});
}

function fixtureModel(game: NormalizedApexGame): GameMarketProjectionV1 {
  const h=makeHistory('H','HOME'), a=makeHistory('A','AWAY');
  return { modelVersion:'APEX_GAME_MARKET_V1',generatedAt:new Date().toISOString(),asOf:game.startTime,sport:'NBA',eventId:game.eventId,
    status:'AVAILABLE',reason:null,validationStatus:'EARLY_EVIDENCE',source:'ESPN_TEAM_SCHEDULE_HISTORY',pointInTimeValid:true,reliabilityTier:'STRONG',
    homeSampleCount:20,awaySampleCount:20,expectedHomeScore:112,expectedAwayScore:105,expectedMargin:7,expectedTotal:217,marginStdDev:11,totalStdDev:14,
    homeWinProbability:0.738,awayWinProbability:0.262,drawProbability:null,homeHistory:h,awayHistory:a,notes:[] };
}

export function runGameMarketModelVerificationSuite() {
  const future = new Date(Date.now()+3600000).toISOString();
  const past = new Date(Date.now()-86400000).toISOString();
  const raw={events:[
    {id:'1',date:past,competitions:[{status:{type:{completed:true,state:'post'}},competitors:[{homeAway:'home',team:{id:'H',displayName:'Home'},score:'5'},{homeAway:'away',team:{id:'A'},score:'3'}]}]},
    {id:'2',date:future,competitions:[{status:{type:{completed:false,state:'pre'}},competitors:[{homeAway:'home',team:{id:'H'},score:'0'},{homeAway:'away',team:{id:'B'},score:'0'}]}]},
  ]};
  const parsed=parseEspnTeamSchedule(raw,'H',new Date(Date.now()+1000).toISOString());
  const game:NormalizedApexGame={eventId:'g1',sport:'NBA',league:'NBA',scheduleDate:future.slice(0,10),startTime:future,awayTeamId:'A',awayTeam:'Away Team',awayAbbreviation:'AWY',homeTeamId:'H',homeTeam:'Home Team',homeAbbreviation:'HOM',status:'UPCOMING',statusDetail:'Scheduled',awayScore:null,homeScore:null,venue:null,source:'ESPN',lastVerifiedAt:new Date().toISOString()};
  const model=fixtureModel(game);
  const now=new Date().toISOString();
  const mk=(book:string,odds:number):any=>({key:book,title:book,lastUpdate:now,markets:[{key:'h2h',marketType:'MONEYLINE',lastUpdate:now,outcomes:[{name:'Home Team',price:odds,americanOdds:odds,decimalOdds:odds>0?1+odds/100:1+100/Math.abs(odds),point:null},{name:'Away Team',price:-130,americanOdds:-130,decimalOdds:1+100/130,point:null}]}]});
  const markets:NormalizedApexEventMarkets={apexEventId:'g1',providerEventId:'p1',sport:'NBA',league:'NBA',homeTeamOrPlayerA:'Home Team',awayTeamOrPlayerB:'Away Team',scheduledDate:future,bookmakers:[mk('Book A',120),mk('Book B',115)],retrievedAt:now,cacheStatus:'HIT',source:'TEST'};
  const evalGood=gameMarketModelService.evaluateMarkets(game,markets,model);
  const oneBook={...markets,bookmakers:[mk('Solo',120)]};
  const evalDepth=gameMarketModelService.evaluateMarkets(game,oneBook,model);
  const staleTs=new Date(Date.now()-20*60000).toISOString();
  const stale:any={...markets,bookmakers:[{...mk('Old A',120),lastUpdate:staleTs,markets:[{...mk('Old A',120).markets[0],lastUpdate:staleTs}]},{...mk('Old B',115),lastUpdate:staleTs,markets:[{...mk('Old B',115).markets[0],lastUpdate:staleTs}]}]};
  const evalStale=gameMarketModelService.evaluateMarkets(game,stale,model);
  const tests=[
    check('Point-in-time parser excludes future/uncompleted games',parsed.length===1&&parsed[0].eventId==='1',`records=${parsed.length}`),
    check('Normal CDF is symmetric',Math.abs(normalCdf(1)+(normalCdf(-1))-1)<1e-6,`sum=${normalCdf(1)+normalCdf(-1)}`),
    check('Independent model produces qualified best-price game candidate',evalGood.qualified.some(c=>c.marketType==='MONEYLINE'&&c.side==='HOME'&&c.sportsbook==='Book A'),`qualified=${evalGood.qualified.length}`),
    check('Market depth gate blocks one-book price',evalDepth.qualified.length===0&&evalDepth.candidates.some(c=>c.reasonCodes.includes('MARKET_DEPTH_BELOW_2_BOOKS')),`qualified=${evalDepth.qualified.length}`),
    check('Stale quotes cannot qualify',evalStale.qualified.length===0&&evalStale.candidates.length===0,`candidates=${evalStale.candidates.length}`),
    check('Sportsbook consensus is comparison-only and separately reported',evalGood.candidates.some(c=>c.marketConsensusProbability!==null),`consensus=${evalGood.candidates[0]?.marketConsensusProbability}`),
  ];
  return { allPassed:tests.every(t=>t.status==='PASS'), verificationTimestamp:new Date().toISOString(), modelVersion:'APEX_GAME_MARKET_V1', keyedOddsRequestsConsumed:0, tests };
}
