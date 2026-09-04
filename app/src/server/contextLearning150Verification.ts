import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { selectDecisionBoardSlateRows } from './decisionBoardService.js';
import { buildMlbTotalContextAdjustment, buildSoccerTotalContextAdjustment } from './gameMarketModelService.js';
import { GameMarketPredictionRepository } from './gameMarketPredictionRepository.js';

const now = Date.now();
// Use an actual Sep 20 slate timestamp so strict football date identity is exercised correctly.
// The previous fixture used `now + minutes`, which landed on Sep 4 and was correctly filtered out as the wrong selected date.
const nflSlateBase = Date.parse('2026-09-20T12:00:00-05:00');
const nflGames = Array.from({ length: 14 }, (_, i) => ({
  eventId: `nfl-${i}`,
  sport: 'NFL', league: 'NFL', scheduleDate: '2026-09-20',
  startTime: new Date(nflSlateBase + (i + 1) * 60_000).toISOString(),
  awayTeam: `Away ${i}`, homeTeam: `Home ${i}`, awayTeamId: `a${i}`, homeTeamId: `h${i}`,
  status: 'UPCOMING', pregameBetEligible: true, source: 'ESPN', lastVerifiedAt: new Date().toISOString(),
} as any));
const fullNfl = selectDecisionBoardSlateRows(nflGames, 'NFL', 12, now, '2026-09-20');
assert.equal(fullNfl.length, 14, 'NFL-only scan must not stop at legacy 12-game cap');

const baseContext: any = {
  contextVersion: 'APEX_GAME_CONTEXT_V2', observedAt: new Date().toISOString(), status: 'AVAILABLE',
  homeRecent5Margin: null, awayRecent5Margin: null, homeRecent5Total: null, awayRecent5Total: null,
  homeRestDays: null, awayRestDays: null, nfl: null, wnba: null, soccer: null, notes: [],
};
const pitcherFriendly = { ...baseContext, mlb: { starterTotalRunSignal: -0.70, bullpenTotalRunSignal: -0.10, weatherTotalRunSignal: -0.20 } };
const hitterFriendly = { ...baseContext, mlb: { starterTotalRunSignal: 0.65, bullpenTotalRunSignal: 0.25, weatherTotalRunSignal: 0.30 } };
assert(buildMlbTotalContextAdjustment(pitcherFriendly) < 0, 'Pitcher-friendly MLB context should lower shadow total');
assert(buildMlbTotalContextAdjustment(hitterFriendly) > 0, 'Hitter-friendly MLB context should raise shadow total');
assert(Math.abs(buildMlbTotalContextAdjustment(hitterFriendly)) <= 1.25, 'MLB total context adjustment must remain bounded');

const soccerHighXg: any = { ...baseContext, mlb: null, soccer: {
  leagueCode: 'eng.1', homeRecent5XgFor: 2.1, homeRecent5XgAgainst: 1.5, awayRecent5XgFor: 1.9, awayRecent5XgAgainst: 1.6,
  homeRecent5ShotsOnTargetFor: 6, homeRecent5ShotsOnTargetAgainst: 4, awayRecent5ShotsOnTargetFor: 5, awayRecent5ShotsOnTargetAgainst: 5,
  chanceSampleCountHome: 5, chanceSampleCountAway: 5,
}};
assert(buildSoccerTotalContextAdjustment(2.5, soccerHighXg) > 0, 'High xG context should raise Soccer shadow total');
assert(Math.abs(buildSoccerTotalContextAdjustment(2.5, soccerHighXg)) <= 0.70, 'Soccer xG adjustment must remain bounded');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-context-'));
process.env.APEX_DATA_DIR = tmp;
const rows = Array.from({ length: 30 }, (_, i) => ({
  snapshotVersion:'APEX_GAME_MARKET_SNAPSHOT_V1', snapshotId:`s${i}`, createdAt:new Date(now - (30-i)*1000).toISOString(), eventId:`e${i}`,
  sport:i%2===0?'MLB':'SOCCER', league:'TEST', eventStartTime:new Date(now-100000).toISOString(), homeTeam:'H', awayTeam:'A',
  modelVersion:'APEX_GAME_MARKET_V1', modelValidationStatus:'EARLY_EVIDENCE', pointInTimeValid:true, reliabilityTier:'STRONG',
  expectedHomeScore:4, expectedAwayScore:4, expectedMargin:0, expectedTotal:8,
  contextAudit:{contextVersion:'APEX_GAME_CONTEXT_V2',observedAt:new Date().toISOString(),contextStatus:'AVAILABLE',baseExpectedTotal:8,challengerExpectedTotal:8.2,challengerDeltaRunsGoals:0.2,frozenPregameContext:{},actualTotal:9,baseAbsoluteTotalError:1,challengerAbsoluteTotalError:0.8,challengerImproved:true},
  candidates:[], gradingStatus:'GRADED', gradedAt:new Date().toISOString(), actualHomeScore:5, actualAwayScore:4,
}));
fs.writeFileSync(path.join(tmp,'gameMarketPredictionSnapshots.json'), JSON.stringify(rows));
const status = new GameMarketPredictionRepository().getContextLearningStatus();
assert.equal(status.overall.gradedEvents, 30, 'Context evidence must count real graded events');
assert.equal(status.overall.promotionStatus, 'CHALLENGER_LEADING', '>=30 events with >=3% MAE gain should mark challenger leading');
assert(status.overall.improvementPct !== null && status.overall.improvementPct > 0.1, 'Context MAE improvement should be measured');
fs.rmSync(tmp,{recursive:true,force:true});

console.log('PASS v1.15.0 combined verification: full NFL slate coverage + immutable MLB/Soccer context-learning challenger.');
