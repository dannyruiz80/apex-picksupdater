import React, { useCallback, useState } from 'react';
import { AlertTriangle, ArrowRight, RefreshCw, ShieldCheck, Sparkles, TicketCheck, WalletCards } from 'lucide-react';
import { ApexSportFilter, DecisionBoardPick, ParlayScanResponse, ParlayTicket } from '../types';

interface ParlaysViewProps {
  selectedSport: ApexSportFilter;
  setSelectedSport: (sport: ApexSportFilter) => void;
  selectedDate: string;
  onGoToPicks: () => void;
  onGoToMyBets: () => void;
}

const SPORTS: Array<{ id: ApexSportFilter; label: string }> = [
  { id: 'ALL', label: 'All' }, { id: 'MLB', label: 'MLB' }, { id: 'NFL', label: 'NFL' }, { id: 'NCAAF', label: 'NCAAF' },
  { id: 'NBA', label: 'NBA' }, { id: 'WNBA', label: 'WNBA' }, { id: 'NHL', label: 'NHL' },
  { id: 'SOCCER', label: 'Soccer' },
];
function american(v:number){return v>0?`+${v}`:`${v}`;}
function pct(v:number){return `${(v*100).toFixed(1)}%`;}
function money(v:number|null|undefined){return v==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);}
function reviewExplanation(ticket: ParlayTicket): string {
  const reasons = (ticket.reasons || []).join(' ').toUpperCase();
  if (reasons.includes('CORRELATION') || reasons.includes('UNMODELED')) return 'Review only: joint-leg correlation is not validated. The displayed probability and EV use an independence baseline, so Apex will not auto-qualify this ticket.';
  if (reasons.includes('VALUE') || reasons.includes('EV')) return 'Review only: the combination does not clear the ticket-level value gate even though the individual legs remain production-qualified.';
  if (reasons.includes('SPORTSBOOK') || reasons.includes('COMMON_BOOK')) return 'Review only: the legs do not currently resolve to one fully executable sportsbook ticket.';
  return 'Review only: one or more ticket-level integrity gates remain unresolved. Apex preserves the combination for inspection but will not label it a qualified parlay.';
}

const TicketCard:React.FC<{ticket:ParlayTicket;review?:boolean;onGoToMyBets:()=>void}>=({ticket,review=false,onGoToMyBets})=>{
  const [tracking,setTracking]=useState(false);
  const [trackMessage,setTrackMessage]=useState<string|null>(null);
  const stake=ticket.bankrollStake;
  const shownUnits=stake?.configured?stake.adjustedUnits:ticket.suggestedStakeUnits;
  const blocked=stake?.status==='BLOCKED';
  const track=async()=>{
    if(!stake?.configured){onGoToMyBets();return;}
    if(blocked)return;
    setTracking(true);setTrackMessage(null);
    try{
      const r=await fetch('/api/bankroll/bets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'PARLAY',label:`${ticket.legCount}-Leg Parlay`,sportsbook:ticket.sportsbook,oddsAmerican:ticket.combinedAmericanOdds,requestedUnits:ticket.suggestedStakeUnits,eventIds:ticket.legs.map(l=>l.eventId),details:ticket.legs.map(l=>l.displayPick)})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||`HTTP ${r.status}`);
      setTrackMessage(`Tracked at ${d.bet.stakeUnits.toFixed(2)}u · ${money(d.bet.stakeDollars)}.`);
    }catch(e:any){setTrackMessage(e.message||'Unable to track this bet.');}finally{setTracking(false);}
  };
  return <div className={`rounded-2xl border p-5 ${review?'border-amber-500/30 bg-amber-950/10':'border-emerald-500/25 bg-emerald-950/10'}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className={`text-[10px] font-black uppercase tracking-[0.16em] ${review?'text-amber-300':'text-emerald-300'}`}>{review?'REVIEW — NOT AUTO-QUALIFIED':'QUALIFIED PARLAY'}</div>
        <div className="mt-1 text-lg font-black text-white">{ticket.legCount}-Leg · {ticket.sportsbook} · {american(ticket.combinedAmericanOdds)}</div>
      </div>
      <div className={`rounded-lg border px-3 py-2 text-right ${blocked?'border-rose-500/30 bg-rose-950/20':'border-slate-700 bg-black/20'}`}>
        <div className="text-[9px] uppercase text-slate-500">Suggested ticket stake</div>
        <div className={`text-lg font-black ${blocked?'text-rose-300':'text-cyan-300'}`}>{shownUnits.toFixed(2)}u</div>
        {stake?.configured?<><div className={`text-sm font-black ${blocked?'text-rose-200':'text-white'}`}>{money(stake.suggestedStakeDollars)}</div><div className="mt-0.5 text-[9px] text-slate-500">1u = {money(stake.unitDollarValue)} · bankroll {money(stake.bankrollSnapshot)}</div></>:<button onClick={onGoToMyBets} className="mt-1 text-[10px] font-black text-amber-300 underline">Set bankroll to show $</button>}
      </div>
    </div>
    {stake?.configured&&stake.status!=='READY'&&<div className={`mt-3 rounded-lg border px-3 py-2 text-[10px] ${blocked?'border-rose-500/20 bg-rose-950/15 text-rose-200':'border-amber-500/20 bg-amber-950/15 text-amber-100'}`}><strong>{blocked?'BANKROLL RISK CAP BLOCKED':'STAKE REDUCED BY BANKROLL GUARDRAILS'}:</strong> {(stake.cappedBy||[]).join(' · ').replaceAll('_',' ')||'Exposure limit'}</div>}
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div><div className="text-[9px] text-slate-500">INDEPENDENCE P</div><div className="font-black text-white">{pct(ticket.independenceProbability)}</div></div>
      <div><div className="text-[9px] text-slate-500">BREAK-EVEN</div><div className="font-black text-white">{pct(ticket.combinedBreakEvenProbability)}</div></div>
      <div><div className="text-[9px] text-slate-500">BASELINE EV</div><div className="font-black text-emerald-300">{ticket.independenceExpectedValuePercent>=0?'+':''}{ticket.independenceExpectedValuePercent.toFixed(1)}%</div></div>
      <div><div className="text-[9px] text-slate-500">CORRELATION</div><div className="font-black text-slate-300">LOW / UNMODELED</div></div>
    </div>
    <div className="mt-4 space-y-2">
      {ticket.legs.map((leg,i)=><div key={`${leg.eventId}-${i}`} className="rounded-xl border border-slate-800 bg-[#0b111d] p-3">
        <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-extrabold text-white">{i+1}. {leg.displayPick}</div><div className="text-[10px] text-slate-500">{leg.eventTitle} · {leg.pickType==='GAME_MARKET'?(leg.gameMarketType||'GAME'):'PROP'}</div></div><div className="text-right"><div className="font-black text-cyan-300">{pct(leg.probability)}</div><div className="text-[10px] text-slate-500">{american(leg.oddsAmerican)}</div></div></div>
      </div>)}
    </div>
    {review && <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-950/15 px-3 py-2 text-xs font-semibold text-amber-100">{reviewExplanation(ticket)}</div>}
    <div className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-950/10 px-3 py-2 text-[10px] text-cyan-100">{ticket.correlationNote}</div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="text-[10px] text-slate-500">{ticket.reasons.join(' · ').replaceAll('_',' ')}</div>{!review&&<button onClick={track} disabled={tracking||blocked} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] font-black text-emerald-300 disabled:opacity-40"><WalletCards className="h-3.5 w-3.5"/>{tracking?'Tracking…':stake?.configured?'Track This Bet':'Set Bankroll / Track'}</button>}</div>
    {trackMessage&&<div className="mt-3 rounded-lg border border-slate-700 bg-black/20 px-3 py-2 text-[10px] text-slate-300">{trackMessage}</div>}
  </div>;
};

const StraightCard:React.FC<{pick:DecisionBoardPick;index:number}>=({pick,index})=>(
  <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/10 p-4">
    <div className="flex items-start justify-between gap-3">
      <div><div className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-300">#{index+1} STRAIGHT ALTERNATIVE</div><div className="mt-1 font-black text-white">{pick.displayPick||pick.selectionLabel||pick.marketCategory}</div><div className="mt-1 text-[10px] text-slate-500">{pick.eventTitle} · {pick.sport} · {pick.pickType==='GAME_MARKET'?(pick.gameMarketType||'GAME'):'PROP'}</div></div>
      <div className="text-right"><div className="text-lg font-black text-cyan-300">{pct(pick.apexProbability)}</div><div className="text-[10px] text-slate-500">{pick.sportsbook} {american(pick.oddsAmerican)}</div></div>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-3"><div><span className="text-slate-500">EV </span><span className="font-black text-emerald-300">{pick.expectedValuePercent>=0?'+':''}{pick.expectedValuePercent.toFixed(1)}%</span></div><div><span className="text-slate-500">Edge </span><span className="font-black text-slate-200">{pick.edgePercentagePoints>=0?'+':''}{pick.edgePercentagePoints.toFixed(1)} pp</span></div><div><span className="text-slate-500">Data </span><span className="font-black text-slate-200">{pick.reliabilityTier}</span></div></div>
  </div>
);

export const ParlaysView:React.FC<ParlaysViewProps>=({selectedSport,setSelectedSport,selectedDate,onGoToPicks,onGoToMyBets})=>{
  const activeSport=selectedSport==='TENNIS'?'ALL':selectedSport;
  const [legCount,setLegCount]=useState(2);
  const [report,setReport]=useState<ParlayScanResponse|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const scan=useCallback(async()=>{
    setLoading(true);setError(null);
    try{const res=await fetch('/api/parlays/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sport:activeSport,date:selectedDate,legCount})});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.message||`Parlay scan returned HTTP ${res.status}`);setReport(data as ParlayScanResponse);}catch(e:any){setError(e.message||'Unable to scan parlays.');}finally{setLoading(false);}
  },[activeSport,selectedDate,legCount]);
  return <div className="space-y-6 animate-in fade-in">
    <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-center lg:justify-between">
      <div><div className="flex flex-wrap items-center gap-2"><h2 className="flex items-center gap-2 text-2xl font-bold text-white"><Sparkles className="h-6 w-6 text-fuchsia-400"/> Parlay Lab</h2><span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-mono font-black text-emerald-300">APEX_PARLAY_V1_14 + BANKROLL ACTIVE</span></div><p className="mt-1 max-w-4xl text-sm text-slate-400">Broad-slate parlay discovery: up to 24 upcoming events by default (36 max), expanding into the next seven schedule days when needed. Same-event correlation remains fail-closed.</p></div>
      <button onClick={onGoToPicks} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300">Back to Picks</button>
    </div>

    <div className="rounded-2xl border border-fuchsia-500/25 bg-gradient-to-b from-fuchsia-950/10 to-[#0b111d] p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div><div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-fuchsia-300"><TicketCheck className="h-4 w-4"/> Recommended Parlay Builder</div><div className="mt-1 text-lg font-extrabold text-white">Broad slate first. One strongest leg per event first. One executable sportsbook.</div><div className="mt-1 text-xs text-slate-500">Fresh Picks-board recommendations, saved recommendations, and a 5-minute slate cache are used before new provider evaluations.</div></div>
        <button onClick={scan} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-fuchsia-400 px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/>{loading?'Scanning broad slate…':`Scan Slate for ${legCount}-Leg Parlays`}</button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {[2,3,4].map(n=><button key={n} onClick={()=>setLegCount(n)} className={`rounded-md px-3 py-1.5 text-xs font-bold ${legCount===n?'border border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-200':'border border-slate-800 bg-slate-900 text-slate-400'}`}>{n} legs</button>)}
        <div className="mx-1 h-7 w-px bg-slate-800"/>
        {SPORTS.map(s=><button key={s.id} onClick={()=>setSelectedSport(s.id)} className={`rounded-md px-3 py-1.5 text-xs font-bold ${activeSport===s.id?'border border-cyan-500/40 bg-cyan-500/15 text-cyan-200':'border border-slate-800 bg-slate-900 text-slate-400'}`}>{s.label}</button>)}
      </div>
    </div>

    {error&&<div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4 text-sm text-rose-200">{error}</div>}
    {report&&<>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-3"><div className="text-[9px] text-slate-500">EVENTS CONSIDERED</div><div className="text-xl font-black text-white">{report.funnel.scheduleEventsConsidered}</div></div>
        <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-3"><div className="text-[9px] text-slate-500">CACHE SEEDED</div><div className="text-xl font-black text-cyan-300">{report.funnel.cachedEventsSeeded}</div></div>
        <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-3"><div className="text-[9px] text-slate-500">LIVE EVALUATED</div><div className="text-xl font-black text-white">{report.funnel.liveEventsEvaluated}</div></div>
        <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-3"><div className="text-[9px] text-slate-500">ELIGIBLE EVENTS</div><div className="text-xl font-black text-white">{report.funnel.distinctEligibleEvents}</div></div>
        <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-3"><div className="text-[9px] text-slate-500">POSSIBLE COMBOS</div><div className="text-xl font-black text-white">{report.funnel.possibleIndependentCombinations}</div></div>
        <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-3"><div className="text-[9px] text-slate-500">ONE-BOOK COMBOS</div><div className="text-xl font-black text-white">{report.funnel.commonBookCombinations}</div></div>
        <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-3"><div className="text-[9px] text-slate-500">QUALIFIED</div><div className="text-xl font-black text-emerald-300">{report.qualifiedTicketCount}</div></div>
        <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-3"><div className="text-[9px] text-slate-500">REVIEW</div><div className="text-xl font-black text-amber-300">{report.reviewTickets.length}</div></div>
      </div>
      <div className="rounded-xl border border-slate-800 bg-[#0d1322] px-4 py-3 text-[10px] text-slate-500">Dates checked: {report.scheduleDatesScanned.join(' → ') || report.scheduleDate} · Slate cache: <span className="font-black text-slate-300">{report.cacheStatus}</span>{report.funnel.fallbackAlternativeLegsUsed?' · Alternative same-event leg choices were used only after the one-leg-per-event pass failed.':''}</div>
      {report.tickets.length>0?<div className="space-y-4">{report.tickets.map(t=><TicketCard key={t.ticketId} ticket={t} onGoToMyBets={onGoToMyBets}/>)}</div>:<div className="rounded-xl border border-slate-800 bg-[#0d1322] p-5 text-sm text-slate-300"><ShieldCheck className="mb-2 h-5 w-5 text-emerald-400"/>{report.message}</div>}
      {report.reviewTickets.length>0&&<div className="space-y-4"><div className="flex items-center gap-2 text-sm font-black text-amber-300"><AlertTriangle className="h-4 w-4"/> Review-only combinations</div>{report.reviewTickets.map(t=><TicketCard key={t.ticketId} ticket={t} review onGoToMyBets={onGoToMyBets}/>)}</div>}
      {report.qualifiedTicketCount===0&&report.straightAlternatives.length>0&&<div className="space-y-3 rounded-2xl border border-cyan-500/20 bg-[#0d1322] p-5"><div><div className="flex items-center gap-2 text-sm font-black text-cyan-300">Best Straight Alternatives <ArrowRight className="h-4 w-4"/></div><div className="mt-1 text-xs text-slate-500">No safe parlay qualified, so Apex is showing the strongest independent production-qualified plays instead of forcing a ticket.</div></div><div className="grid gap-3 lg:grid-cols-3">{report.straightAlternatives.map((p,i)=><StraightCard key={`${p.eventId}-${p.marketKey}-${p.side}-${p.line}`} pick={p} index={i}/>)}</div></div>}
      {Object.keys(report.rejectedReasons).length>0&&<div className="rounded-xl border border-slate-800 bg-[#0d1322] p-4"><div className="text-xs font-black text-slate-300">Why combinations were rejected</div><div className="mt-2 flex flex-wrap gap-2">{Object.entries(report.rejectedReasons).map(([k,v])=><span key={k} className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-400">{k.replaceAll('_',' ')}: {v}</span>)}</div></div>}
      <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-4 text-[10px] text-slate-500">{report.notes.map((n,i)=><div key={i}>• {n}</div>)}</div>
    </>}
  </div>;
};
