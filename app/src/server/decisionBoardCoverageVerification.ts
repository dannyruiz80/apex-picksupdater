import { marketProvider } from './marketProvider.js';
import { diversifyDecisionBoardPicks, selectDecisionBoardSlateRows } from './decisionBoardService.js';
import { NormalizedApexGame } from '../types.js';

function game(id:string,sport:any,startTime:string,league?:string):NormalizedApexGame {
  return {
    eventId:id,
    sport,
    league:league || sport,
    competition:league || sport,
    startTime,
    scheduleDate:startTime.slice(0,10),
    status:'UPCOMING',
    homeTeam:`${sport} Home ${id}`,
    awayTeam:`${sport} Away ${id}`,
    homeTeamId:`h-${id}`,
    awayTeamId:`a-${id}`,
  } as NormalizedApexGame;
}

export async function runDecisionBoardCoverageVerificationSuite(){
  const now=Date.parse('2026-09-03T12:00:00Z');
  const games:NormalizedApexGame[]=[
    game('m1','MLB','2026-09-04T17:00:00Z'),
    game('m2','MLB','2026-09-04T18:00:00Z'),
    game('m3','MLB','2026-09-04T19:00:00Z'),
    game('w1','WNBA','2026-09-04T17:30:00Z'),
    game('w2','WNBA','2026-09-04T20:00:00Z'),
    game('s1','SOCCER','2026-09-04T18:30:00Z','Liga MX'),
    game('s2','SOCCER','2026-09-04T21:00:00Z','French Ligue 1'),
  ];
  const tests:Array<{testName:string;status:'PASS'|'FAIL';details:string}>=[];
  const all=selectDecisionBoardSlateRows(games,'ALL',6,now);
  const firstThree=new Set(all.slice(0,3).map(g=>g.sport));
  tests.push({testName:'ALL SPORTS round-robin does not allow MLB to consume every early slot',status:firstThree.has('MLB')&&firstThree.has('WNBA')&&firstThree.has('SOCCER')?'PASS':'FAIL',details:`first=${all.slice(0,3).map(g=>g.sport).join(',')}`});
  tests.push({testName:'Broad ALL SPORTS scan can exceed legacy three-event ceiling',status:all.length===6?'PASS':'FAIL',details:`selected=${all.length}`});
  const mlb=selectDecisionBoardSlateRows(games,'MLB',8,now);
  tests.push({testName:'Single-sport filter remains sport-pure',status:mlb.length===3&&mlb.every(g=>g.sport==='MLB')?'PASS':'FAIL',details:`selected=${mlb.map(g=>g.sport).join(',')}`});
  const futureOnly=selectDecisionBoardSlateRows(games,'ALL',10,Date.parse('2026-09-04T18:15:00Z'));
  tests.push({testName:'Started events are excluded while later future events remain eligible',status:futureOnly.every(g=>Date.parse(g.startTime)>Date.parse('2026-09-04T18:15:00Z'))&&futureOnly.length>0?'PASS':'FAIL',details:`remaining=${futureOnly.length}`});
  const ligaKeys=await marketProvider.resolveProviderSportKeys('SOCCER',game('mx','SOCCER','2026-09-05T02:00:00Z','Liga MX'));
  tests.push({testName:'Liga MX resolves to the correct Odds API sport key',status:ligaKeys.includes('soccer_mexico_ligamx')?'PASS':'FAIL',details:`keys=${ligaKeys.join(',')}`});
  const syntheticPicks:any[]=[
    {rank:0,eventId:'m1',selectionLabel:'MLB A',sport:'MLB',reliabilityTier:'STRONG',modelValidationStatus:'PROSPECTIVE_VALIDATED',apexProbability:.72,expectedValuePercent:8,edgePercentagePoints:5,quoteTimestamp:'2026-09-03T11:00:00Z',pickType:'PLAYER_PROP',playerId:'1',marketKey:'hits',line:.5,side:'OVER'},
    {rank:0,eventId:'m2',selectionLabel:'MLB B',sport:'MLB',reliabilityTier:'STRONG',modelValidationStatus:'PROSPECTIVE_VALIDATED',apexProbability:.71,expectedValuePercent:7,edgePercentagePoints:4,quoteTimestamp:'2026-09-03T11:00:00Z',pickType:'PLAYER_PROP',playerId:'2',marketKey:'hits',line:.5,side:'OVER'},
    {rank:0,eventId:'m3',selectionLabel:'MLB C',sport:'MLB',reliabilityTier:'STRONG',modelValidationStatus:'PROSPECTIVE_VALIDATED',apexProbability:.70,expectedValuePercent:6,edgePercentagePoints:4,quoteTimestamp:'2026-09-03T11:00:00Z',pickType:'PLAYER_PROP',playerId:'3',marketKey:'hits',line:.5,side:'OVER'},
    {rank:0,eventId:'s1',selectionLabel:'Soccer ML',sport:'SOCCER',reliabilityTier:'MODERATE',modelValidationStatus:'EARLY_EVIDENCE',apexProbability:.58,expectedValuePercent:5,edgePercentagePoints:3.5,quoteTimestamp:'2026-09-03T11:00:00Z',pickType:'GAME_MARKET',playerId:null,marketKey:'moneyline',line:null,side:'HOME'},
  ];
  const diversified=diversifyDecisionBoardPicks(syntheticPicks as any,3);
  tests.push({testName:'Visible qualified cards reserve a slot for another sport only when it truly qualifies',status:diversified.some(p=>p.sport==='SOCCER')?'PASS':'FAIL',details:`visible=${diversified.map(p=>p.sport).join(',')}`});
  return {allPassed:tests.every(t=>t.status==='PASS'),verificationTimestamp:new Date().toISOString(),engineVersion:'APEX_DECISION_BOARD_COVERAGE_V1_14_2',keyedOddsRequestsConsumed:0,tests};
}
