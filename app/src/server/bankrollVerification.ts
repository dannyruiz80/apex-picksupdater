import fs from 'fs';
import os from 'os';
import path from 'path';
import { BankrollService } from './bankrollService.js';

export function runBankrollVerificationSuite(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'apex-bankroll-'));
  const bankrollService=new BankrollService(dir);
  const tests:Array<{testName:string;status:'PASS'|'FAIL';details:string}>=[];
  const t=(name:string,fn:()=>string)=>{try{tests.push({testName:name,status:'PASS',details:fn()});}catch(e:any){tests.push({testName:name,status:'FAIL',details:e.message||String(e)});}};
  try{
    t('Unconfigured bankroll does not fabricate dollar stake',()=>{const p=bankrollService.previewStake(.5,'PARLAY');if(p.configured||p.suggestedStakeDollars!==null)throw new Error(JSON.stringify(p));return p.status;});
    t('1u equals configured percent of current bankroll',()=>{const s=bankrollService.updateSettings({currentBankroll:1000,unitPercent:1,dailyRiskCapPercent:5,maxOpenExposurePercent:10,maxStraightBetUnits:2,maxParlayBetUnits:.5});if(s.unitDollarValue!==10)throw new Error(`unit=${s.unitDollarValue}`);return `1u=$${s.unitDollarValue}`;});
    t('0.50u parlay converts to $5.00',()=>{const p=bankrollService.previewStake(.5,'PARLAY');if(p.adjustedUnits!==.5||p.suggestedStakeDollars!==5)throw new Error(JSON.stringify(p));return `${p.adjustedUnits}u=$${p.suggestedStakeDollars}`;});
    t('Tracked bet increases open exposure',()=>{const r=bankrollService.trackBet({source:'PARLAY',label:'Test Parlay',sportsbook:'TestBook',oddsAmerican:100,requestedUnits:.5,eventIds:['e1','e2']});if(r.summary.openExposureDollars!==5||r.summary.openBetsCount!==1)throw new Error(JSON.stringify(r.summary));return `open=$${r.summary.openExposureDollars}`;});
    t('Risk caps reduce later stake rather than overexpose bankroll',()=>{bankrollService.updateSettings({dailyRiskCapPercent:1,maxOpenExposurePercent:10,maxStraightBetUnits:2});const p=bankrollService.previewStake(1,'STRAIGHT');if(p.adjustedUnits!==.5||!p.cappedBy.includes('DAILY_RISK_CAP'))throw new Error(JSON.stringify(p));return `adjusted=${p.adjustedUnits}u`;});
    t('Winning settlement updates bankroll by profit only',()=>{const open=bankrollService.getSummary().bets.find(b=>b.status==='OPEN');if(!open)throw new Error('missing open bet');const r=bankrollService.settleBet(open.betId,'WIN');if(r.summary.settings.currentBankroll!==1005||r.summary.openExposureDollars!==0)throw new Error(JSON.stringify(r.summary));return `bankroll=$${r.summary.settings.currentBankroll}`;});
    t('Unit dollar value dynamically follows settled bankroll',()=>{const s=bankrollService.getSummary();if(s.unitDollarValue!==10.05)throw new Error(`unit=${s.unitDollarValue}`);return `1u=$${s.unitDollarValue}`;});
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
  return {allPassed:tests.every(x=>x.status==='PASS'),verificationTimestamp:new Date().toISOString(),version:'APEX_BANKROLL_V1_14',tests};
}
