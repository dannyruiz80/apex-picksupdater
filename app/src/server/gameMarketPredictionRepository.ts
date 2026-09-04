import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ApexSport, GameCalibrationProfile, MarketType, NormalizedApexGame } from '../types';
import { GameMarketEvaluationV1 } from './gameMarketModelService';
import { contextFeatureWeightDiagnostics } from './contextLearningV2Service.js';

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
  contextAudit?: {
    contextVersion: string;
    learningVersion?: 'APEX_CONTEXT_LEARNING_V2' | string;
    learningIdentity?: string;
    featureHash?: string | null;
    observedAt: string;
    contextStatus: string;
    baseExpectedTotal: number | null;
    challengerExpectedTotal: number | null;
    challengerDeltaRunsGoals: number | null;
    frozenPregameContext: unknown;
    featureContributions?: any[];
    interactionContributions?: any[];
    postgameFeatureAttribution?: Array<{ key: string; label: string; family: string; contribution: number; singleFeatureError: number; errorDeltaVsBase: number; outcome: 'HELPED' | 'HURT' | 'NEUTRAL' }>;
    actualTotal?: number | null;
    baseAbsoluteTotalError?: number | null;
    challengerAbsoluteTotalError?: number | null;
    challengerImproved?: boolean | null;
  } | null;
  candidates: Array<{
    candidateId: string; marketType: string; side: string; selectionLabel: string; point: number | null;
    sportsbook: string; oddsAmerican: number; quoteTimestamp: string; marketDepth: number; modelProbability: number;
    decisionProbability?: number | null; calibrationAdjustedProbability?: number | null; prospectiveCalibrationAdjustmentPP?: number | null;
    probabilityShrinkageWeight?: number | null; modelEvidenceObservations?: number | null; marketConsensusProbability: number | null;
    modelMarketDisagreementPP?: number | null; breakEvenProbability: number; rawEdgePercentagePoints?: number | null;
    rawExpectedValuePercent?: number | null; edgePercentagePoints: number; expectedValuePercent: number; integrityStatus?: string | null;
    integrityReasonCodes?: string[]; crossMarketConsistent?: boolean | null; v2ContributionPP?: number | null;
    v2ContributionStatus?: string | null; qualifies: boolean; outcome?: GameMarketGradingOutcome | null; profitUnits?: number | null;
  }>;
  gradingStatus: 'PENDING' | 'GRADED';
  gradedAt?: string | null;
  actualHomeScore?: number | null;
  actualAwayScore?: number | null;
}

interface EvidenceObservation { p: number; y: number; qualifies: boolean; profit: number; }

function dataDir() { return process.env.APEX_DATA_DIR || path.join(process.cwd(), 'data'); }
function repoPath() { return path.join(dataDir(), 'gameMarketPredictionSnapshots.json'); }
function decimalFromAmerican(american: number) { return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american); }
function logLoss(p: number, y: number) { const q=Math.max(1e-6,Math.min(1-1e-6,p)); return -(y*Math.log(q)+(1-y)*Math.log(1-q)); }
function clamp(x:number,lo=0,hi=1){return Math.max(lo,Math.min(hi,x));}

function ece(obs: EvidenceObservation[]): number | null {
  if (!obs.length) return null;
  const buckets = Array.from({ length: 5 }, () => [] as EvidenceObservation[]);
  for (const o of obs) buckets[Math.min(4, Math.floor(clamp(o.p) * 5))].push(o);
  let total = 0;
  for (const b of buckets) {
    if (!b.length) continue;
    const p = b.reduce((s,o)=>s+o.p,0)/b.length;
    const y = b.reduce((s,o)=>s+o.y,0)/b.length;
    total += (b.length/obs.length) * Math.abs(p-y);
  }
  return total;
}

function evidenceTier(n:number): GameCalibrationProfile['evidenceTier'] {
  if(n>=150)return 'MATURE';
  if(n>=75)return 'MODERATE';
  if(n>=30)return 'DEVELOPING';
  return 'EARLY';
}

function recommendedWeight(n:number, gap:number|null, expectedCalibrationError:number|null, brier:number|null):number{
  let w=n>=300?0.88:n>=150?0.78:n>=75?0.62:n>=30?0.48:0.35;
  if(gap!==null&&Math.abs(gap)>=0.05)w-=0.12;
  if(expectedCalibrationError!==null&&expectedCalibrationError>=0.06)w-=0.10;
  if(brier!==null&&brier>=0.25)w-=0.08;
  return Math.max(0.25,Math.min(0.90,w));
}

export class GameMarketPredictionRepository {
  getAll(): GameMarketPredictionSnapshotV1[] {
    try { const p=repoPath(); if(!fs.existsSync(p)) return []; const raw=JSON.parse(fs.readFileSync(p,'utf8')); return Array.isArray(raw)?raw:[]; }
    catch { return []; }
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
      contextAudit: (() => {
        const contextSports = new Set(['MLB','SOCCER','WNBA','NFL','NCAAF']);
        const challenger = evaluation.model.contextChallengerV2;
        // Only the earliest frozen pregame context per canonical event is learning evidence.
        // Later price refreshes can still be stored as market snapshots but cannot multiply the context sample.
        const priorContext = rows.find((r) => r.eventId === game.eventId && r.contextAudit);
        if (!contextSports.has(game.sport) || !evaluation.model.contextV2 || !challenger || priorContext) return null;
        return {
          contextVersion: evaluation.model.contextV2.contextVersion,
          learningVersion: 'APEX_CONTEXT_LEARNING_V2',
          learningIdentity: `${game.eventId}|TOTAL|FIRST_PREGAME`,
          featureHash: challenger.featureHash,
          observedAt: evaluation.model.contextV2.observedAt,
          contextStatus: evaluation.model.contextV2.status,
          baseExpectedTotal: evaluation.model.expectedTotal,
          challengerExpectedTotal: challenger.challengerExpectedTotal,
          challengerDeltaRunsGoals: challenger.totalAdjustment,
          frozenPregameContext: evaluation.model.contextV2,
          featureContributions: challenger.features,
          interactionContributions: challenger.interactions,
          postgameFeatureAttribution: [],
          actualTotal: null, baseAbsoluteTotalError: null, challengerAbsoluteTotalError: null, challengerImproved: null,
        };
      })(),
      candidates:relevant.map(c=>({candidateId:c.candidateId,marketType:c.marketType,side:c.side,selectionLabel:c.selectionLabel,point:c.point,
        sportsbook:c.sportsbook,oddsAmerican:c.oddsAmerican,quoteTimestamp:c.quoteTimestamp,marketDepth:c.marketDepth,modelProbability:c.modelProbability,
        decisionProbability:c.decisionProbability,calibrationAdjustedProbability:c.calibrationAdjustedProbability,prospectiveCalibrationAdjustmentPP:c.prospectiveCalibrationAdjustmentPP,
        probabilityShrinkageWeight:c.probabilityShrinkageWeight,modelEvidenceObservations:c.modelEvidenceObservations,
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
    if (row.contextAudit) {
      row.contextAudit.actualTotal = total;
      row.contextAudit.baseAbsoluteTotalError = row.contextAudit.baseExpectedTotal === null ? null : Math.abs(row.contextAudit.baseExpectedTotal - total);
      row.contextAudit.challengerAbsoluteTotalError = row.contextAudit.challengerExpectedTotal === null ? null : Math.abs(row.contextAudit.challengerExpectedTotal - total);
      row.contextAudit.challengerImproved = row.contextAudit.baseAbsoluteTotalError === null || row.contextAudit.challengerAbsoluteTotalError === null
        ? null : row.contextAudit.challengerAbsoluteTotalError < row.contextAudit.baseAbsoluteTotalError;
      const base = row.contextAudit.baseExpectedTotal;
      if (base !== null) {
        const featureRows = [...(row.contextAudit.featureContributions || []), ...(row.contextAudit.interactionContributions || [])];
        row.contextAudit.postgameFeatureAttribution = featureRows
          .filter((f:any) => Number.isFinite(Number(f?.appliedContribution)) && Math.abs(Number(f.appliedContribution)) > 1e-9)
          .map((f:any) => {
            const contribution = Number(f.appliedContribution);
            const singleFeatureError = Math.abs(base + contribution - total);
            const baseError = Math.abs(base - total);
            const delta = baseError - singleFeatureError;
            return { key: String(f.key || 'unknown'), label: String(f.label || f.key || 'Feature'), family: String(f.family || 'OTHER'), contribution,
              singleFeatureError, errorDeltaVsBase: delta, outcome: Math.abs(delta) < 0.01 ? 'NEUTRAL' : delta > 0 ? 'HELPED' : 'HURT' };
          });
      }
    }
    row.gradingStatus='GRADED';row.gradedAt=gradedAt;row.actualHomeScore=homeScore;row.actualAwayScore=awayScore;this.write(rows);return true;
  }

  private observations(sport?: string, marketType?: string): EvidenceObservation[] {
    const rows=this.getAll().filter(r=>r.gradingStatus==='GRADED' && (!sport||r.sport===sport));
    const first=new Map<string,EvidenceObservation>();
    for(const row of rows.sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt))){
      for(const c of row.candidates){
        if(marketType && c.marketType!==marketType) continue;
        if(!c.outcome||c.outcome==='PUSH') continue;
        const key=`${row.eventId}|${c.marketType}|${c.side}|${c.point}`;
        if(first.has(key)) continue;
        first.set(key,{p:c.modelProbability,y:c.outcome==='WIN'?1:0,qualifies:c.qualifies,profit:c.profitUnits??0});
      }
    }
    return [...first.values()];
  }

  getCalibrationProfile(sport:ApexSport, marketType:MarketType):GameCalibrationProfile {
    const obs=this.observations(sport,marketType);
    const n=obs.length;
    const actual=n?obs.reduce((s,o)=>s+o.y,0)/n:null;
    const predicted=n?obs.reduce((s,o)=>s+o.p,0)/n:null;
    const gap=predicted!==null&&actual!==null?predicted-actual:null;
    const brier=n?obs.reduce((s,o)=>s+Math.pow(o.p-o.y,2),0)/n:null;
    const ll=n?obs.reduce((s,o)=>s+logLoss(o.p,o.y),0)/n:null;
    const ec=ece(obs);
    const tier=evidenceTier(n);
    let status:GameCalibrationProfile['status']='COLLECTING';
    if(n>=30){
      if((ec??0)>=0.08 || (brier??0)>=0.28)status='UNSTABLE';
      else if((gap??0)>=0.05)status='OVERCONFIDENT';
      else if((gap??0)<=-0.05)status='UNDERCONFIDENT';
      else if(n>=75 && (ec??1)<0.05)status='STABLE';
    }
    return {sport,marketType,independentDecisiveObservations:n,evidenceTier:tier,meanPredictedProbability:predicted,actualHitRate:actual,
      calibrationGap:gap,expectedCalibrationError:ec,brierScore:brier,logLoss:ll,recommendedModelWeight:recommendedWeight(n,gap,ec,brier),status};
  }

  getEvidenceFor(sport: string, marketType?: string) {
    const obs=this.observations(sport,marketType);
    const n=obs.length;
    const actual=n?obs.reduce((s,o)=>s+o.y,0)/n:null;
    const predicted=n?obs.reduce((s,o)=>s+o.p,0)/n:null;
    const gap=predicted!==null&&actual!==null?predicted-actual:null;
    const brier=n?obs.reduce((s,o)=>s+Math.pow(o.p-o.y,2),0)/n:null;
    const ll=n?obs.reduce((s,o)=>s+logLoss(o.p,o.y),0)/n:null;
    const ec=ece(obs);
    return {independentDecisiveObservations:n,calibrationGap:gap,expectedCalibrationError:ec,brierScore:brier,logLoss:ll,
      evidenceTier:evidenceTier(n),recommendedModelWeight:recommendedWeight(n,gap,ec,brier)};
  }


  getContextLearningStatus() {
    const supportedSports = ['MLB','SOCCER','WNBA','NFL','NCAAF'] as const;
    const all = this.getAll()
      .filter((r) => r.gradingStatus === 'GRADED' && supportedSports.includes(r.sport as any) && r.contextAudit)
      .sort((a,b) => Date.parse(a.eventStartTime) - Date.parse(b.eventStartTime));
    const first = new Map<string, GameMarketPredictionSnapshotV1>();
    for (const row of all) if (!first.has(row.contextAudit?.learningIdentity || row.eventId)) first.set(row.contextAudit?.learningIdentity || row.eventId, row);
    const rows = [...first.values()];
    const summarize = (sport?: typeof supportedSports[number]) => {
      const sample = rows.filter((r) => !sport || r.sport === sport)
        .filter((r) => r.contextAudit?.baseAbsoluteTotalError !== null && r.contextAudit?.challengerAbsoluteTotalError !== null);
      const n = sample.length;
      const baseMae = n ? sample.reduce((sum,r)=>sum+(r.contextAudit!.baseAbsoluteTotalError ?? 0),0)/n : null;
      const challengerMae = n ? sample.reduce((sum,r)=>sum+(r.contextAudit!.challengerAbsoluteTotalError ?? 0),0)/n : null;
      const improvementPct = baseMae !== null && baseMae > 0 && challengerMae !== null ? (baseMae - challengerMae) / baseMae : null;
      const improvedGames = sample.filter(r=>r.contextAudit?.challengerImproved === true).length;
      const improvementRate = n ? improvedGames / n : null;
      const recent = sample.slice(-Math.min(20, sample.length));
      const recentBaseMae = recent.length ? recent.reduce((sum,r)=>sum+(r.contextAudit!.baseAbsoluteTotalError ?? 0),0)/recent.length : null;
      const recentChallengerMae = recent.length ? recent.reduce((sum,r)=>sum+(r.contextAudit!.challengerAbsoluteTotalError ?? 0),0)/recent.length : null;
      const recentImprovementPct = recentBaseMae !== null && recentBaseMae > 0 && recentChallengerMae !== null ? (recentBaseMae-recentChallengerMae)/recentBaseMae : null;
      const promotionEligible = n >= 30 && improvementPct !== null && improvementPct >= 0.03 && (improvementRate ?? 0) >= 0.52 && (recentImprovementPct ?? -1) >= 0;
      const promotionStatus = n < 30 ? 'COLLECTING' : promotionEligible ? 'PROMOTION_ELIGIBLE' : (improvementPct !== null && improvementPct > 0 ? 'CHALLENGER_LEADING' : 'NO_PROVEN_GAIN');
      return { sport: sport ?? 'ALL', gradedEvents: n, baseTotalMae: baseMae, challengerTotalMae: challengerMae, improvementPct, improvedGames, improvementRate,
        recentImprovementPct, promotionEligible, promotionStatus };
    };
    const featureLeaderboard = supportedSports.flatMap((sport) => contextFeatureWeightDiagnostics(sport as ApexSport).map((row) => ({ sport, ...row })))
      .filter((r) => r.evidenceCount > 0)
      .sort((a,b) => (b.meanErrorGain ?? -999) - (a.meanErrorGain ?? -999))
      .slice(0, 24);
    return {
      version: 'APEX_CONTEXT_LEARNING_V2_1_16',
      generatedAt: new Date().toISOString(),
      policy: 'Immutable first-pregame snapshot -> postgame attribution -> chronological walk-forward feature reweighting. Only real completed events count. Learned feature multipliers use earlier results only, are bounded to 0.65x-1.35x, and remain shadow-only. Promotion eligibility requires >=30 graded events, >=3% full-sample MAE gain, >=52% improved games, and non-negative recent-window MAE gain.',
      overall: summarize(),
      bySport: supportedSports.map((s) => summarize(s)),
      featureLeaderboard,
      totalFrozenPregameSnapshots: this.getAll().filter(r => supportedSports.includes(r.sport as any) && r.contextAudit).length,
      uniqueLearningSnapshots: rows.length,
      duplicateLearningSnapshotsSuppressed: Math.max(0, all.length - rows.length),
    };
  }

  getCalibrationDashboard() {
    const sports:ApexSport[]=['MLB','NFL','NCAAF','NBA','WNBA','NHL','SOCCER'];
    const markets:MarketType[]=['MONEYLINE','SPREAD','TOTAL'];
    return {version:'APEX_GAME_CALIBRATION_LEARNING_V1_13',generatedAt:new Date().toISOString(),profiles:sports.flatMap(s=>markets.map(m=>this.getCalibrationProfile(s,m))),
      note:'Profiles use the earliest graded pregame snapshot per event/market/side/line. Calibration corrections require at least 30 decisive outcomes and are bounded.'};
  }

  getStatus() {
    const rows=this.getAll(); const graded=rows.filter(r=>r.gradingStatus==='GRADED'); const obs=this.observations();
    const ll=obs.length?obs.reduce((s,o)=>s+logLoss(o.p,o.y),0)/obs.length:null;
    const brier=obs.length?obs.reduce((s,o)=>s+Math.pow(o.p-o.y,2),0)/obs.length:null;
    const actual=obs.length?obs.reduce((s,o)=>s+o.y,0)/obs.length:null; const predicted=obs.length?obs.reduce((s,o)=>s+o.p,0)/obs.length:null;
    const bets=obs.filter(o=>o.qualifies); const roi=bets.length?bets.reduce((s,o)=>s+o.profit,0)/bets.length:null;
    return {snapshotVersion:'APEX_GAME_MARKET_SNAPSHOT_V1',modelVersion:'APEX_GAME_MARKET_V1',validationStatus:'EARLY_EVIDENCE',
      totalSnapshots:rows.length,pending:rows.filter(r=>r.gradingStatus==='PENDING').length,gradedSnapshots:graded.length,independentDecisiveObservations:obs.length,
      logLoss:ll,brierScore:brier,expectedCalibrationError:ece(obs),meanPredictedProbability:predicted,actualHitRate:actual,
      calibrationGap:predicted!==null&&actual!==null?predicted-actual:null,qualifiedDecisiveBets:bets.length,flatStakeRoi:roi,path:repoPath(),
      calibrationDashboard:this.getCalibrationDashboard(),contextLearning:this.getContextLearningStatus(),note:'Evidence uses the earliest graded snapshot per event/market/side/line. Repeated refreshes do not inflate model sample size.'};
  }
}
export const gameMarketPredictionRepository=new GameMarketPredictionRepository();
