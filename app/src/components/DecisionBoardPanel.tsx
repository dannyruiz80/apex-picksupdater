import React, { useState } from 'react';
import { DecisionBoardResponse } from '../types';
import {
  Target,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Percent,
  DollarSign,
  Clock,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  WalletCards,
} from 'lucide-react';

interface DecisionBoardPanelProps {
  board: DecisionBoardResponse | null;
  loading?: boolean;
  error?: string | null;
  onScan?: () => void;
  onOpenPick?: (eventId: string) => void;
  compact?: boolean;
  scanLabel?: string;
}

function formatOdds(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

function quoteFreshness(seconds: number | null) {
  if (seconds === null) return 'timestamp unknown';
  if (seconds < 60) return `${seconds}s old`;
  return `${Math.floor(seconds / 60)}m old`;
}

export const DecisionBoardPanel: React.FC<DecisionBoardPanelProps> = ({
  board,
  loading = false,
  error = null,
  onScan,
  onOpenPick,
  compact = false,
  scanLabel = 'Find Best Picks',
}) => {
  const picks = board?.picks || [];
  const topPicks = picks.slice(0, compact ? 3 : 5);
  const hasScanned = Boolean(board && board.requestedMaxGames > 0);
  const passState = hasScanned && board?.status === 'NO_QUALIFIED_PICKS';
  const [showCoverage, setShowCoverage] = useState(false);

  return (
    <section className="rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-950/20 to-[#0b111d] overflow-hidden shadow-lg">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-emerald-500/20 px-5 py-4 sm:px-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-emerald-300">
              <Target className="h-5 w-5" />
              <span className="text-xs font-black uppercase tracking-[0.16em]">Apex Decision Board</span>
            </div>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-300">
              PRODUCTION GATE ONLY
            </span>
          </div>
          <h2 className="mt-1.5 text-xl sm:text-2xl font-extrabold text-white">Best verified opportunities first.</h2>
          <p className="mt-1 text-xs sm:text-sm text-slate-400 max-w-3xl">
            Apex ranks only recommendations that cleared identity, point-in-time, probability, price freshness, edge, EV and reliability gates. If none qualify, the correct answer is PASS.
          </p>
        </div>

        {onScan && (
          <button
            id="decision-board-scan-btn"
            type="button"
            onClick={onScan}
            disabled={loading}
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-slate-950 hover:bg-emerald-300 disabled:opacity-50 shadow-lg shadow-emerald-950/30"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Analyzing Slate…' : scanLabel}
          </button>
        )}
      </div>

      <div className="p-5 sm:p-6 space-y-4">
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4 text-sm text-rose-200 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && picks.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-8 text-center">
            <RefreshCw className="h-7 w-7 animate-spin text-emerald-400 mx-auto" />
            <div className="mt-3 font-bold text-white">Evaluating verified pregame markets…</div>
            <div className="mt-1 text-xs text-slate-400">The scan is sequential and capped to reduce provider usage.</div>
          </div>
        )}

        {!loading && passState && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-5 flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-amber-300 shrink-0 mt-0.5" />
            <div>
              <div className="font-black text-amber-200">PASS THE SCANNED SLATE</div>
              <p className="text-sm text-slate-300 mt-1">{board?.message}</p>
              <p className="text-xs text-slate-500 mt-2">Apex will not lower its thresholds simply to produce a pick.</p>
            </div>
          </div>
        )}

        {!loading && !passState && topPicks.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-5 flex items-start gap-3">
            <Target className="h-5 w-5 text-slate-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-white">No fresh qualified picks have been evaluated yet.</div>
              <p className="text-xs text-slate-400 mt-1">
                {onScan ? 'Use Find Best Picks to evaluate a small quota-controlled slice of the upcoming slate.' : 'Open Picks and run Find Best Picks to populate the decision board.'}
              </p>
            </div>
          </div>
        )}

        {topPicks.length > 0 && (
          <div className={`grid gap-4 ${compact ? 'grid-cols-1 xl:grid-cols-3' : 'grid-cols-1 xl:grid-cols-2'}`}>
            {topPicks.map((pick, idx) => {
              const primary = idx === 0;
              return (
                <article
                  key={`${pick.eventId}-${pick.playerId}-${pick.marketKey}-${pick.line}-${pick.side}`}
                  className={`rounded-xl border p-4 sm:p-5 ${primary ? 'border-emerald-400/45 bg-emerald-950/20 xl:col-span-1' : 'border-slate-800 bg-[#0d1322]'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-[10px] font-black font-mono ${primary ? 'bg-emerald-400 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>
                          #{pick.rank} {primary ? 'TOP QUALIFIED PICK' : 'QUALIFIED'}
                        </span>
                        <span className="text-[10px] font-mono font-bold text-slate-400">{pick.sport} · {pick.marketCategory}</span>
                      </div>
                      <h3 className="mt-2 text-lg font-extrabold text-white">
                        {pick.pickType === 'GAME_MARKET' ? (pick.displayPick || pick.selectionLabel || pick.marketCategory) : (
                          <>
                            {pick.playerName} <span className="text-emerald-300">{pick.side} {pick.line}</span>
                          </>
                        )}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">{pick.eventTitle}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black text-emerald-300">{(pick.apexProbability * 100).toFixed(1)}%</div>
                      <div className="text-[10px] font-mono text-slate-500">MODEL PROBABILITY</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4">
                    <div className="rounded-lg border border-slate-800 bg-black/20 p-2.5">
                      <div className="flex items-center gap-1 text-[10px] text-slate-500"><TrendingUp className="h-3 w-3" /> EDGE</div>
                      <div className="text-sm font-bold text-emerald-300 mt-0.5">+{pick.edgePercentagePoints.toFixed(1)} pp</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-black/20 p-2.5">
                      <div className="flex items-center gap-1 text-[10px] text-slate-500"><Percent className="h-3 w-3" /> EV</div>
                      <div className="text-sm font-bold text-emerald-300 mt-0.5">+{pick.expectedValuePercent.toFixed(1)}%</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-black/20 p-2.5">
                      <div className="flex items-center gap-1 text-[10px] text-slate-500"><DollarSign className="h-3 w-3" /> PRICE</div>
                      <div className="text-sm font-bold text-white mt-0.5">{formatOdds(pick.oddsAmerican)}</div>
                      <div className="text-[9px] text-slate-500 truncate">{pick.sportsbook}</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-black/20 p-2.5">
                      <div className="flex items-center gap-1 text-[10px] text-slate-500"><ShieldCheck className="h-3 w-3" /> DATA</div>
                      <div className="text-sm font-bold text-white mt-0.5">{pick.reliabilityTier}</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-black/20 p-2.5">
                      <div className="flex items-center gap-1 text-[10px] text-slate-500"><WalletCards className="h-3 w-3" /> STAKE</div>
                      <div className="text-sm font-bold text-cyan-300 mt-0.5">{(pick.bankrollStake?.configured ? pick.bankrollStake.adjustedUnits : pick.suggestedStakeUnits ?? 0.5).toFixed(2)}u</div>
                      <div className="text-[9px] text-slate-500">{pick.bankrollStake?.configured && pick.bankrollStake.suggestedStakeDollars !== null ? `$${pick.bankrollStake.suggestedStakeDollars.toFixed(2)}` : 'set bankroll for $'}</div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-1.5 text-xs text-slate-300">
                    {pick.rationale.slice(0, primary ? 4 : 2).map((line, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{line}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
                    <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500">
                      <Clock className="h-3 w-3" />
                      <span>{quoteFreshness(pick.quoteAgeSeconds)}</span>
                      <span>·</span>
                      <span>{pick.source === 'LIVE_EVALUATION' ? 'fresh evaluation' : 'saved evaluation'}</span>
                    </div>
                    {onOpenPick && (
                      <button
                        type="button"
                        onClick={() => onOpenPick(pick.eventId)}
                        className="inline-flex items-center gap-1 text-xs font-bold text-emerald-300 hover:text-emerald-200"
                      >
                        Full analysis <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {board && board.requestedMaxGames > 0 && board.coverageBySport && board.coverageBySport.length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-[#0a0f19]">
            <button type="button" onClick={() => setShowCoverage(v => !v)} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left">
              <div><div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-300">Coverage & Integrity</div><div className="mt-0.5 text-[10px] text-slate-500">{board.gamesScanned} scanned · {board.gamesWithModelData} model-ready · {board.qualifiedCount} qualified</div></div>
              <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${showCoverage ? 'rotate-180' : ''}`} />
            </button>
            {showCoverage && <div className="border-t border-slate-800 p-3"><div className="flex flex-wrap gap-2">
              {board.coverageBySport.map((row) => { const topRejects=(Object.entries(row.rejectionReasons||{}) as Array<[string,number]>).sort((a,b)=>b[1]-a[1]).slice(0,3); return <div key={row.sport} title={row.lastMessage||undefined} className={`rounded-lg border px-2.5 py-2 text-[10px] font-mono ${row.qualifiedPicks>0?'border-emerald-500/35 bg-emerald-950/20 text-emerald-200':row.eventsWithModelData>0?'border-amber-500/25 bg-amber-950/10 text-amber-200':'border-slate-800 bg-slate-900/60 text-slate-400'}`}><div className="flex items-center gap-2"><span className="font-black">{row.sport}</span><span className={`rounded px-1.5 py-0.5 text-[8px] font-black ${row.productionConnection==='CONNECTED'?'bg-emerald-500/10 text-emerald-300':row.productionConnection==='PARTIAL'?'bg-amber-500/10 text-amber-300':'bg-slate-800 text-slate-500'}`}>{row.productionConnection}</span></div><div>{row.scannedEvents}/{row.scheduleEvents} scanned · {row.eventsWithModelData} model-ready · {row.qualifiedPicks} picks</div>{row.qualifiedPicks===0&&topRejects.length>0&&<div className="mt-1 max-w-[360px] text-[9px] text-slate-400">Blocked: {topRejects.map(([reason,count])=>`${reason} ×${count}`).join(' · ')}</div>}</div>; })}
            </div><div className="mt-2 text-[10px] text-slate-500">{board.sportFilter==='ALL'?'ALL SPORTS is using round-robin coverage.':`${board.sportFilter} filter is active; switch to All Sports to compare leagues.`}</div></div>}
          </div>
        )}

        {board && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-800 pt-3 text-[10px] font-mono text-slate-500">
            <span>Filter: <strong className="text-slate-300">{board.sportFilter}</strong></span>
            <span>Status: <strong className={board.status === 'SUCCESS' ? 'text-emerald-400' : 'text-slate-400'}>{board.status}</strong></span>
            {board.gamesScanned > 0 && <span>Games scanned: {board.gamesScanned}</span>}
            <span>Qualified: {board.qualifiedCount}</span>
            <span>Generated: {new Date(board.generatedAt).toLocaleTimeString()}</span>
          </div>
        )}
      </div>
    </section>
  );
};
