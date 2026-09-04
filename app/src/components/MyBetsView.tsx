import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, CheckCircle2, DollarSign, RefreshCw, Save, ShieldCheck, TrendingDown, TrendingUp, WalletCards } from 'lucide-react';
import { BankrollBetOutcome, BankrollSummary } from '../types';

function money(v:number|null|undefined){return v==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);}
function pct(v:number){return `${v.toFixed(2)}%`;}
function american(v:number){return v>0?`+${v}`:`${v}`;}

export const MyBetsView:React.FC=()=>{
  const [summary,setSummary]=useState<BankrollSummary|null>(null);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [form,setForm]=useState({currentBankroll:'',unitPercent:'1',dailyRiskCapPercent:'5',maxOpenExposurePercent:'10',maxStraightBetUnits:'1',maxParlayBetUnits:'0.5'});

  const load=useCallback(async()=>{
    setLoading(true);setError(null);
    try{const r=await fetch('/api/bankroll');const d=await r.json();if(!r.ok)throw new Error(d.message||`HTTP ${r.status}`);setSummary(d);const s=d.settings;setForm({currentBankroll:s.configured?String(s.currentBankroll):'',unitPercent:String(s.unitPercent),dailyRiskCapPercent:String(s.dailyRiskCapPercent),maxOpenExposurePercent:String(s.maxOpenExposurePercent),maxStraightBetUnits:String(s.maxStraightBetUnits),maxParlayBetUnits:String(s.maxParlayBetUnits)});}catch(e:any){setError(e.message||'Unable to load bankroll.');}finally{setLoading(false);}
  },[]);
  useEffect(()=>{load();},[load]);

  const save=async()=>{
    setSaving(true);setError(null);setMessage(null);
    try{const body=Object.fromEntries(Object.entries(form).map(([k,v])=>[k,Number(v)]));const r=await fetch('/api/bankroll/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.message||`HTTP ${r.status}`);setSummary(d);setMessage(`Bankroll saved. 1u is now ${money(d.unitDollarValue)} (${pct(d.settings.unitPercent)} of current bankroll).`);}catch(e:any){setError(e.message||'Unable to save bankroll.');}finally{setSaving(false);}
  };

  const settle=async(betId:string,outcome:BankrollBetOutcome)=>{
    setError(null);setMessage(null);
    try{const r=await fetch(`/api/bankroll/bets/${encodeURIComponent(betId)}/settle`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outcome})});const d=await r.json();if(!r.ok)throw new Error(d.message||`HTTP ${r.status}`);setSummary(d.summary);setMessage(`Bet settled ${outcome}. Bankroll updated to ${money(d.summary.settings.currentBankroll)}.`);}catch(e:any){setError(e.message||'Unable to settle bet.');}
  };

  const open=useMemo(()=>summary?.bets.filter(b=>b.status==='OPEN')||[],[summary]);
  const settled=useMemo(()=>summary?.bets.filter(b=>b.status==='SETTLED').slice(0,20)||[],[summary]);

  return <div className="space-y-6 animate-in fade-in">
    <div className="flex flex-col gap-3 border-b border-slate-800 pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div><div className="flex items-center gap-2"><WalletCards className="h-6 w-6 text-emerald-400"/><h2 className="text-2xl font-black text-white">Bankroll & Bet Tracker</h2><span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono font-black text-emerald-300">APEX_BANKROLL_V1_14 ACTIVE</span></div><p className="mt-1 text-sm text-slate-400">Dollar stake sizing from your current bankroll, with daily-risk and open-exposure guardrails.</p></div>
      <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/>Refresh</button>
    </div>

    {error&&<div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4 text-sm text-rose-200">{error}</div>}
    {message&&<div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 text-sm text-emerald-200">{message}</div>}

    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-4"><div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-500"><Banknote className="h-4 w-4"/>Current bankroll</div><div className="mt-2 text-2xl font-black text-white">{money(summary?.settings.currentBankroll)}</div></div>
      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-950/10 p-4"><div className="text-[10px] font-black uppercase text-cyan-300">1 UNIT VALUE</div><div className="mt-2 text-2xl font-black text-cyan-200">{money(summary?.unitDollarValue)}</div><div className="mt-1 text-[10px] text-slate-500">{summary?.settings.configured?pct(summary.settings.unitPercent):'Configure bankroll first'}</div></div>
      <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-4"><div className="text-[10px] font-black uppercase text-slate-500">OPEN EXPOSURE</div><div className="mt-2 text-2xl font-black text-white">{money(summary?.openExposureDollars)}</div><div className="mt-1 text-[10px] text-slate-500">Cap {money(summary?.openExposureCapDollars)} · {summary?.openBetsCount||0} open bets</div></div>
      <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-4"><div className="text-[10px] font-black uppercase text-slate-500">TODAY'S RISK</div><div className="mt-2 text-2xl font-black text-white">{money(summary?.todayRiskDollars)}</div><div className="mt-1 text-[10px] text-slate-500">Daily cap {money(summary?.dailyRiskCapDollars)}</div></div>
    </div>

    <div className="grid gap-5 xl:grid-cols-[1.05fr_1.4fr]">
      <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5">
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-400"/><h3 className="font-black text-white">Bankroll Rules</h3></div>
        <p className="mt-1 text-xs text-slate-500">1u dynamically follows your current bankroll. Apex can reduce a model stake when these risk caps are tighter.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ['currentBankroll','Current bankroll ($)','1000'],['unitPercent','1u = % of bankroll','1'],['dailyRiskCapPercent','Daily risk cap (%)','5'],['maxOpenExposurePercent','Max open exposure (%)','10'],['maxStraightBetUnits','Max straight bet (u)','1'],['maxParlayBetUnits','Max parlay bet (u)','0.5'],
          ].map(([k,l,ph])=><label key={k} className="text-xs text-slate-400"><span className="mb-1 block font-bold">{l}</span><input type="number" step="0.01" min="0" placeholder={ph} value={(form as any)[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} className="w-full rounded-lg border border-slate-700 bg-[#080c14] px-3 py-2 text-sm font-bold text-white outline-none focus:border-cyan-500"/></label>)}
        </div>
        <button onClick={save} disabled={saving||!form.currentBankroll} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-50"><Save className="h-4 w-4"/>{saving?'Saving…':'Save Bankroll Rules'}</button>
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-950/10 p-3 text-[10px] leading-relaxed text-amber-100"><strong>Risk rule:</strong> bankroll sizing is a guardrail, not a guarantee of profit. Apex uses the smaller of the model stake, per-bet cap, remaining daily-risk allowance, and remaining open-exposure allowance.</div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5">
        <div className="flex items-center justify-between"><div><h3 className="font-black text-white">Open Bets</h3><p className="text-xs text-slate-500">Track a recommended parlay from Parlay Lab, then settle it here.</p></div><div className={`text-lg font-black ${(summary?.realizedProfitLossDollars||0)>=0?'text-emerald-300':'text-rose-300'}`}>{(summary?.realizedProfitLossDollars||0)>=0?'+':''}{money(summary?.realizedProfitLossDollars)}</div></div>
        <div className="mt-4 space-y-3">{open.length===0?<div className="rounded-xl border border-slate-800 bg-black/10 p-4 text-sm text-slate-500">No open tracked bets yet.</div>:open.map(b=><div key={b.betId} className="rounded-xl border border-slate-800 bg-[#080c14] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-black text-white">{b.label}</div><div className="text-[10px] text-slate-500">{b.sportsbook} {american(b.oddsAmerican)} · {b.source} · {new Date(b.placedAt).toLocaleString()}</div></div><div className="text-right"><div className="font-black text-cyan-300">{b.stakeUnits.toFixed(2)}u · {money(b.stakeDollars)}</div><div className="text-[10px] text-slate-500">Potential profit {money(b.potentialProfitDollars)}</div></div></div><div className="mt-3 flex flex-wrap gap-2">{(['WIN','LOSS','PUSH','VOID'] as BankrollBetOutcome[]).map(o=><button key={o} onClick={()=>settle(b.betId,o)} className={`rounded-md border px-2.5 py-1.5 text-[10px] font-black ${o==='WIN'?'border-emerald-500/30 text-emerald-300':o==='LOSS'?'border-rose-500/30 text-rose-300':'border-slate-700 text-slate-300'}`}>{o}</button>)}</div></div>)}</div>
      </div>
    </div>

    {settled.length>0&&<div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5"><h3 className="font-black text-white">Recent Settled Bets</h3><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-500"><tr><th className="py-2">Bet</th><th>Stake</th><th>Outcome</th><th>P/L</th><th>Bankroll at placement</th></tr></thead><tbody>{settled.map(b=><tr key={b.betId} className="border-t border-slate-800"><td className="py-3"><div className="font-bold text-white">{b.label}</div><div className="text-[10px] text-slate-500">{b.sportsbook} {american(b.oddsAmerican)}</div></td><td>{b.stakeUnits.toFixed(2)}u · {money(b.stakeDollars)}</td><td><span className={`font-black ${b.outcome==='WIN'?'text-emerald-300':b.outcome==='LOSS'?'text-rose-300':'text-slate-300'}`}>{b.outcome}</span></td><td className={`font-black ${(b.netProfitDollars||0)>=0?'text-emerald-300':'text-rose-300'}`}>{(b.netProfitDollars||0)>=0?'+':''}{money(b.netProfitDollars)}</td><td>{money(b.bankrollAtPlacement)}</td></tr>)}</tbody></table></div></div>}
  </div>;
};
