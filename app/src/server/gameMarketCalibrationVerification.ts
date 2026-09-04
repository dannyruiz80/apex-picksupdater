import fs from 'fs';
import os from 'os';
import path from 'path';
import { GameMarketPredictionRepository, GameMarketPredictionSnapshotV1 } from './gameMarketPredictionRepository.js';

function check(name:string,ok:boolean,details:string){return {testName:name,status:(ok?'PASS':'FAIL') as 'PASS'|'FAIL',details};}
export function runGameMarketCalibrationVerificationSuite(){
  const prior=process.env.APEX_DATA_DIR;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'apex-cal-'));
  process.env.APEX_DATA_DIR=dir;
  try{
    const rows:GameMarketPredictionSnapshotV1[]=[];
    for(let i=0;i<40;i++){
      const win=i<22;
      rows.push({snapshotVersion:'APEX_GAME_MARKET_SNAPSHOT_V1',snapshotId:`s${i}`,createdAt:new Date(1700000000000+i*1000).toISOString(),eventId:`e${i}`,
        sport:'MLB',league:'MLB',eventStartTime:new Date(1700001000000+i*1000).toISOString(),homeTeam:'H',awayTeam:'A',modelVersion:'APEX_GAME_MARKET_V1',
        modelValidationStatus:'EARLY_EVIDENCE',pointInTimeValid:true,reliabilityTier:'STRONG',expectedHomeScore:5,expectedAwayScore:4,expectedMargin:1,expectedTotal:9,
        candidates:[{candidateId:`c${i}`,marketType:'MONEYLINE',side:'HOME',selectionLabel:'Home',point:null,sportsbook:'Test',oddsAmerican:-110,
          quoteTimestamp:new Date(1699999000000+i*1000).toISOString(),marketDepth:3,modelProbability:.70,decisionProbability:.60,probabilityShrinkageWeight:.35,
          modelEvidenceObservations:0,marketConsensusProbability:.52,breakEvenProbability:.524,edgePercentagePoints:7.6,expectedValuePercent:10,qualifies:true,
          outcome:win?'WIN':'LOSS',profitUnits:win?0.909:-1}],gradingStatus:'GRADED',gradedAt:new Date(1700002000000+i*1000).toISOString(),actualHomeScore:win?5:3,actualAwayScore:win?3:5});
    }
    fs.writeFileSync(path.join(dir,'gameMarketPredictionSnapshots.json'),JSON.stringify(rows));
    const repo=new GameMarketPredictionRepository(); const p=repo.getCalibrationProfile('MLB','MONEYLINE'); const dash=repo.getCalibrationDashboard();
    const tests=[
      check('Calibration profile uses independent decisive outcomes',p.independentDecisiveObservations===40,`n=${p.independentDecisiveObservations}`),
      check('Evidence tier advances prospectively',p.evidenceTier==='DEVELOPING',`tier=${p.evidenceTier}`),
      check('Overconfidence is detected from graded outcomes',(p.calibrationGap??0)>0.10,`gap=${p.calibrationGap}`),
      check('ECE is computed from prospective outcomes',(p.expectedCalibrationError??0)>0.10,`ece=${p.expectedCalibrationError}`),
      check('Unstable calibration reduces model trust weight',p.recommendedModelWeight<0.48,`weight=${p.recommendedModelWeight}`),
      check('Dashboard reports sport-market profile',dash.profiles.some(x=>x.sport==='MLB'&&x.marketType==='MONEYLINE'),`profiles=${dash.profiles.length}`),
    ];
    return {allPassed:tests.every(t=>t.status==='PASS'),verificationTimestamp:new Date().toISOString(),learningVersion:'APEX_GAME_CALIBRATION_LEARNING_V1_13',keyedOddsRequestsConsumed:0,tests};
  } finally { if(prior===undefined)delete process.env.APEX_DATA_DIR;else process.env.APEX_DATA_DIR=prior; fs.rmSync(dir,{recursive:true,force:true}); }
}
