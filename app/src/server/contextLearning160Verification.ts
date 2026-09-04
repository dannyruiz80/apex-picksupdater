import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { buildContextChallengerV2 } from './contextLearningV2Service.js';
import { GameMarketPredictionRepository } from './gameMarketPredictionRepository.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-context-v2-'));
process.env.APEX_DATA_DIR = tmp;
const start = Date.parse('2026-09-20T18:00:00Z');
const game = (sport: any, eventId: string, startTime = new Date(start).toISOString()) => ({
  eventId, sport, league: sport, scheduleDate: startTime.slice(0,10), startTime,
  awayTeam:'Away', homeTeam:'Home', awayTeamId:'A', homeTeamId:'H', status:'UPCOMING', pregameBetEligible:true,
  source:'ESPN', lastVerifiedAt:new Date().toISOString(),
} as any);

const base: any = { contextVersion:'APEX_GAME_CONTEXT_V2', observedAt:new Date(start-1000).toISOString(), status:'AVAILABLE',
  homeRecent5Margin:null,awayRecent5Margin:null,homeRecent5Total:null,awayRecent5Total:null,homeRestDays:null,awayRestDays:null,
  mlb:null,soccer:null,wnba:null,nfl:null,ncaaf:null,notes:[] };

const mlbContext: any = { ...base, mlb:{
  homeStarterEra:2.7,awayStarterEra:3.0,homeStarterWhip:1.02,awayStarterWhip:1.08,
  homeStarterK9:10.2,awayStarterK9:9.6,homeStarterBb9:2.1,awayStarterBb9:2.4,homeStarterHr9:0.7,awayStarterHr9:0.8,
  homeBullpenInningsLast3:12,awayBullpenInningsLast3:11,temperatureF:82,windMph:14,empiricalVenueRunFactor:0.91,
}};
const mlb = buildContextChallengerV2(game('MLB','mlb1'),8.5,mlbContext)!;
assert(mlb && mlb.version === 'APEX_CONTEXT_LEARNING_V2');
assert(Number.isFinite(mlb.totalAdjustment), 'MLB context adjustment must be finite');
assert(Math.abs(mlb.totalAdjustment) <= 1.8, 'MLB context adjustment must be bounded');
assert(mlb.features.every(f=>Number.isFinite(f.appliedContribution)), 'MLB feature contributions must never be NaN/Infinity');
assert(mlb.features.some(f=>f.key==='mlb_starter_run_prevention' && f.status==='ACTIVE'));
assert(mlb.features.some(f=>f.key==='mlb_wind_observed' && f.status==='OBSERVE_ONLY'), 'Wind direction cannot be fabricated');

const soccerContext: any = { ...base, soccer:{
  homeRecent5XgFor:null,homeRecent5XgAgainst:null,awayRecent5XgFor:null,awayRecent5XgAgainst:null,
  homeRecent5ShotsOnTargetFor:5,homeRecent5ShotsOnTargetAgainst:4,awayRecent5ShotsOnTargetFor:5,awayRecent5ShotsOnTargetAgainst:4,
  homeRecent5ShotsFor:13,homeRecent5ShotsAgainst:11,awayRecent5ShotsFor:14,awayRecent5ShotsAgainst:12,
  homeKeeperXgSuppression:null,awayKeeperXgSuppression:null,homeRecent5PossessionPct:54,awayRecent5PossessionPct:49,
}};
const soccer = buildContextChallengerV2(game('SOCCER','soc1'),2.6,soccerContext)!;
assert(soccer.features.find(f=>f.key==='soccer_xg_total')?.status==='UNAVAILABLE', 'Missing xG must stay unavailable');
assert(soccer.features.find(f=>f.key==='soccer_possession_shape')?.status==='OBSERVE_ONLY', 'Possession proxy must not invent direction');

const nflContext:any = { ...base, nfl:{homeOffensivePlaysPerGame:68,awayOffensivePlaysPerGame:67,homeRedZoneTdRate:.66,awayRedZoneTdRate:.64,homeRecent5Total:49,awayRecent5Total:48,windMph:17} };
const nfl=buildContextChallengerV2(game('NFL','nfl1'),45,nflContext)!;
assert(nfl.features.find(f=>f.key==='nfl_pressure')?.status==='UNAVAILABLE', 'Pressure rate must remain unavailable without verified source');
assert(Math.abs(nfl.totalAdjustment)<=4,'NFL adjustment bounded');

const wnbaContext:any = { ...base, wnba:{homeEstimatedPossessions:76,awayEstimatedPossessions:75,homeOffensiveRating:110,awayOffensiveRating:108,homeDefensiveRating:104,awayDefensiveRating:106,homeRecent5Total:166,awayRecent5Total:164,homeFastBreakPoints:14,awayFastBreakPoints:13,homeBackToBack:false,awayBackToBack:true} };
const wnba=buildContextChallengerV2(game('WNBA','w1'),162,wnbaContext)!;
assert(wnba.features.find(f=>f.key==='wnba_rest_b2b')?.status==='OBSERVE_ONLY','Rest must remain audit-only until validated');

// Create 30 real, unique, graded learning observations plus 5 duplicate display rows.
const rows:any[]=[];
for(let i=0;i<30;i++){
  const eventStart=new Date(start-(40-i)*86400000).toISOString();
  const gradedAt=new Date(Date.parse(eventStart)+4*3600000).toISOString();
  const learningIdentity=`learn-${i}`;
  const audit={learningVersion:'APEX_CONTEXT_LEARNING_V2',learningIdentity,baseExpectedTotal:8,challengerExpectedTotal:8.5,actualTotal:9,
    baseAbsoluteTotalError:1,challengerAbsoluteTotalError:.5,challengerImproved:true,
    featureContributions:[{key:'mlb_temperature',baseContribution:.5,appliedContribution:.5}],interactionContributions:[],postgameFeatureAttribution:[]};
  rows.push({eventId:`e${i}`,sport:'MLB',eventStartTime:eventStart,gradedAt,gradingStatus:'GRADED',contextAudit:audit});
  if(i<5) rows.push({eventId:`e${i}`,sport:'MLB',eventStartTime:eventStart,gradedAt,gradingStatus:'GRADED',contextAudit:{...audit}});
}
fs.writeFileSync(path.join(tmp,'gameMarketPredictionSnapshots.json'),JSON.stringify(rows));
const status=new GameMarketPredictionRepository().getContextLearningStatus();
assert.equal(status.overall.gradedEvents,30,'Duplicate rows must not inflate graded events');
assert.equal(status.uniqueLearningSnapshots,30,'Unique learning identity must count once');
assert(status.duplicateLearningSnapshotsSuppressed>=5,'Duplicate learning snapshots must be reported as suppressed');
assert.equal(status.overall.promotionStatus,'PROMOTION_ELIGIBLE','Strong shadow evidence should become eligible, not auto-promoted');

// Prior results can reweight a later prediction, but not an event before those results existed.
const later=buildContextChallengerV2(game('MLB','later',new Date(start+86400000).toISOString()),8.5,mlbContext)!;
const earlier=buildContextChallengerV2(game('MLB','earlier',new Date(start-100*86400000).toISOString()),8.5,mlbContext)!;
assert((later.features.find(f=>f.key==='mlb_temperature')?.evidenceCount||0)>=20,'Later event should see earlier graded evidence');
assert.equal(earlier.features.find(f=>f.key==='mlb_temperature')?.evidenceCount,0,'Earlier event must not see future evidence');

fs.rmSync(tmp,{recursive:true,force:true});
console.log('PASS v1.16.0: Context Learning V2 supports five sports, dedupes learning identity, blocks look-ahead, preserves missing-data integrity, and keeps feature weights bounded/shadow-only.');
