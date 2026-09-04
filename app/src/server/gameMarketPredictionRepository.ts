import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { NormalizedApexGame } from '../types';
import { GameMarketEvaluationV1 } from './gameMarketModelService';

export type GameMarketGradingOutcome = 'WIN' | 'LOSS' | 'PUSH';

export interface GameMarketPredictionSnapshotV1 {
  snapshotVersion: 'APEX_GAME_MARKET_SNAPSHOT_V1';
  snapshotId: string;
  createdAt: string;
  eventId: string;
  sport: string;
  league: string;
  eventStartTime: string;
  homeTeam: string;
  awayTeam: string;
  modelVersion: 'APEX_GAME_MARKET_V1';
  modelValidationStatus: 'EARLY_EVIDENCE';
  pointInTimeValid: boolean;
  reliabilityTier: string;
  expectedHomeScore: number | null;
  expectedAwayScore: number | null;
  expectedMargin: number | null;
  expectedTotal: number | null;
  candidates: Array<{
    candidateId: string;
    marketType: string;
    side: string;
    selectionLabel: string;
    point: number | null;
    sportsbook: string;
    oddsAmerican: number;
    quoteTimestamp: string;
    marketDepth: number;
    modelProbability: number;
    decisionProbability?: number | null;
    probabilityShrinkageWeight?: number | null;
    modelEvidenceObservations?: number | null;
    marketConsensusProbability: number | null;
    modelMarketDisagreementPP?: number | null;
    breakEvenProbability: number;
    rawEdgePercentagePoints?: number | null;
    rawExpectedValuePercent?: number | null;
    edgePercentagePoints: number;
    expectedValuePercent: number;
    integrityStatus?: string | null;
    integrityReasonCodes?: string[];
    crossMarketConsistent?: boolean | null;
    v2ContributionPP?: number | null;
    v2ContributionStatus?: string | null;
    qualifies: boolean;
    outcome?: GameMarketGradingOutcome | null;
    profitUnits?: number | null;
  }>;
  gradingStatus: 'PENDING' | 'GRADED';
  gradedAt?: string | null;
  actualHomeScore?: number | null;
  actualAwayScore?: number | null;
}

function dataDir() { return process.env.APEX_DATA_DIR || path.join(process.cwd(), 'data'); }
function repoPath() { return path.join(dataDir(), 'gameMarketPredictionSnapshots.json'); }
function decimalFromAmerican(american: number) { return american > 0 ? 1 + american/100 : 1 + 100/Math.abs(american); }
function logLoss(p: number, y: number) { const q=Math.max(1e-6,Math.min(1-1e-6,p)); return -(y*Math.log(q)+(1-y)*Math.log(1-q)); }

export class GameMarketPredictionRepository {
  getAll(): GameMarketPredictionSnapshotV1[] {
    try {
      const p=repoPath(); if(!fs.existsSync(p)) return [];
      const raw=JSON.parse(fs.readFileSync(p,'utf8')); return Array.isArray(raw)?raw:[];
    } catch { return []; }
  }
  private write(rows: GameMarketPredictionSnapshotV1[]) {
    fs.mkdirSync(dataDir(),{recursive:true}); const p=repoPath(); const tmp=`${p}.tmp`;
    fs.writeFileSync(tmp,JSON.stringify(rows,null,2)); fs.renameSync(tmp,p);
  }
  append(game: NormalizedApexGame, evaluation: GameMarketEvaluationV1) {
    if(evaluation.model.status!=='AVAILABLE'||!evaluation.model.pointInTimeValid||game.status!=='UPCOMING'||Date.parse(game.startTime)<=Date.now())return;
    const relevant=evaluation.candidates;if(!relevant.length)return;
    const fingerprint=`${game.eventId}|${evaluation.model.modelVersion}|${relevant.map(c=>`${c.candidateId}:${c.quoteTimestamp}`).sort().join('|')}`;
    const snapshotId=`gm_${crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0,24)}`;
    const rows=this.getAll();if(rows.some(r=>r.snapshotId===snapshotId))return;
    rows.push({snapshotVersion:'APEX_GAME_MARKET_SNAPSHOT_V1',snapshotId,createdAt:new Date().toISOString(),eventId:game.eventId,
      sport:game.sport,league:game.league,eventStartTime:game.startTime,homeTeam:game.homeTeam||'Home',awayTeam:game.awayTeam||'Away',
      modelVersion:'APEX_GAME_MARKET_V1',modelValidationStatus:'EARLY_EVIDENCE',pointInTimeValid:evaluation.model.pointInTimeValid,
      reliabilityTier:evaluation.model.reliabilityTier,expectedHomeScore:evaluation.model.expectedHomeScore,expectedAwayScore:evaluation.model.expectedAwayScore,
      expectedMargin:evaluation.model.expectedMargin,expectedTotal:evaluation.model.expectedTotal,
      candidates:relevant.map(c=>({candidateId:c.candidateId,marketType:c.marketType,side:c.side,selectionLabel:c.selectionLabel,point:c.point,
        sportsbook:c.sportsbook,oddsAmerican:c.oddsAmerican,quoteTimestamp:c.quoteTimestamp,marketDepth:c.marketDepth,modelProbability:c.modelProbability,
        decisionProbability:c.decisionProbability,probabilityShrinkageWeight:c.probabilityShrinkageWeight,modelEvidenceObservations:c.modelEvidenceObservations,
        marketConsensusProbability:c.marketConsensusProbability,modelMarketDisagreementPP:c.modelMarketDisagreementPP,breakEvenProbability:c.breakEvenProbability,
        rawEdgePercentagePoints:c.rawEdgePercentagePoints,rawExpectedValuePercent:c.rawExpectedValuePercent,edgePercentagePoints:c.edgePercentagePoints,
        expectedValuePercent:c.expectedValuePercent,integrityStatus:c.integrityStatus,integrityReasonCodes:[...c.integrityReasonCodes],
        crossMarketConsistent:c.crossMarketConsistent,v2ContributionPP:c.v2ContributionPP??null,v2ContributionStatus:c.v2ContributionStatus??null,
        qualifies:c.qualifies,outcome:null,profitUnits:null})),gradingStatus:'PENDING',gradedAt:null,actualHomeScore:null,actualAwayScore:null});
    this.write(rows.slice(-5000));
  }
  grade(snapshotId:string, homeScore:number, awayScore:number, gradedAt=new Date().toISOString()) {
    const rows=this.getAll(); const row=rows.find(r=>r.snapshotId===snapshotId); if(!row||row.gradingStatus==='GRADED')return false;
    const total=homeScore+awayScore; const margin=homeScore-awayScore;
    for(const c of row.candidates){
      let result=0;
      if(c.marketType==='MONEYLINE'){
        if(c.side==='HOME') result=margin; else if(c.side==='AWAY') result=-margin; else if(c.side==='DRAW') result=margin===0?1:-1;
      } else if(c.marketType==='SPREAD'&&c.point!==null){ result=c.side==='HOME'?margin+c.point:-margin+c.point; }
      else if(c.marketType==='TOTAL'&&c.point!==null){ result=c.side==='OVER'?total-c.point:c.point-total; }
      const outcome:GameMarketGradingOutcome=result>0?'WIN':result<0?'LOSS':'PUSH'; c.outcome=outcome;
      c.profitUnits=outcome==='WIN'?decimalFromAmerican(c.oddsAmerican)-1:outcome==='LOSS'?-1:0;
    }
    row.gradingStatus='GRADED';row.gradedAt=gradedAt;row.actualHomeScore=homeScore;row.actualAwayScore=awayScore;this.write(rows);return true;
  }
  getEvidenceFor(sport: string, marketType?: string) {
    const rows=this.getAll().filter(r=>r.gradingStatus==='GRADED' && r.sport===sport);
    const first=new Map<string,{p:number;y:number}>();
    for(const row of rows.sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt))){
      for(const c of row.candidates){
        if(marketType && c.marketType!==marketType) continue;
        if(!c.outcome||c.outcome==='PUSH') continue;
        const key=`${row.eventId}|${c.marketType}|${c.side}|${c.point}`;
        if(first.has(key)) continue;
        first.set(key,{p:c.modelProbability,y:c.outcome==='WIN'?1:0});
      }
    }
    const obs=[...first.values()];
    const actual=obs.length?obs.reduce((sum,o)=>sum+o.y,0)/obs.length:null;
    const predicted=obs.length?obs.reduce((sum,o)=>sum+o.p,0)/obs.length:null;
    return {
      independentDecisiveObservations: obs.length,
      calibrationGap: predicted!==null&&actual!==null?predicted-actual:null,
    };
  }

  getStatus() {
    const rows=this.getAll(); const graded=rows.filter(r=>r.gradingStatus==='GRADED');
    // Earliest snapshot per event/market/side/line prevents refreshes from inflating model evidence.
    const first=new Map<string,{p:number;y:number;qualifies:boolean;profit:number}>();
    for(const row of graded.sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt))){
      for(const c of row.candidates){ if(!c.outcome||c.outcome==='PUSH')continue; const key=`${row.eventId}|${c.marketType}|${c.side}|${c.point}`; if(first.has(key))continue;
        first.set(key,{p:c.modelProbability,y:c.outcome==='WIN'?1:0,qualifies:c.qualifies,profit:c.profitUnits??0}); }
    }
    const obs=[...first.values()]; const ll=obs.length?obs.reduce((s,o)=>s+logLoss(o.p,o.y),0)/obs.length:null;
    const brier=obs.length?obs.reduce((s,o)=>s+Math.pow(o.p-o.y,2),0)/obs.length:null;
    const actual=obs.length?obs.reduce((s,o)=>s+o.y,0)/obs.length:null; const predicted=obs.length?obs.reduce((s,o)=>s+o.p,0)/obs.length:null;
    const bets=obs.filter(o=>o.qualifies); const roi=bets.length?bets.reduce((s,o)=>s+o.profit,0)/bets.length:null;
    return {snapshotVersion:'APEX_GAME_MARKET_SNAPSHOT_V1',modelVersion:'APEX_GAME_MARKET_V1',validationStatus:'EARLY_EVIDENCE',
      totalSnapshots:rows.length,pending:rows.filter(r=>r.gradingStatus==='PENDING').length,gradedSnapshots:graded.length,independentDecisiveObservations:obs.length,
      logLoss:ll,brierScore:brier,meanPredictedProbability:predicted,actualHitRate:actual,calibrationGap:predicted!==null&&actual!==null?predicted-actual:null,
      qualifiedDecisiveBets:bets.length,flatStakeRoi:roi,path:repoPath(),note:'Evidence uses the earliest graded snapshot per event/market/side/line. Repeated refreshes do not inflate model sample size.'};
  }
}
export const gameMarketPredictionRepository=new GameMarketPredictionRepository();
