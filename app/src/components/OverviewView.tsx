import React, { useCallback, useEffect, useState } from 'react';
import { NavTabId, HealthResponse, VersionResponse, DecisionBoardResponse } from '../types';
import { NAVIGATION_ITEMS, getNavIcon } from '../navigation';
import { SystemHealthPanel } from './SystemHealthPanel';
import { DecisionBoardPanel } from './DecisionBoardPanel';
import { ChevronRight, ShieldCheck, Target, Cpu, Layers, Radio, Lock } from 'lucide-react';

interface OverviewViewProps {
  health: HealthResponse | null;
  version: VersionResponse | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  latencyMs: number | null;
  lastChecked: Date | null;
  onRefresh: () => void;
  onSelectTab: (tab: NavTabId) => void;
  onOpenPick?: (eventId: string) => void;
}

const moduleStatus: Partial<Record<NavTabId, { label: string; tone: 'ACTIVE' | 'PARTIAL' | 'LOCKED'; note: string }>> = {
  picks: { label: 'SLATE ACTIVE', tone: 'ACTIVE', note: 'Verified schedules and sportsbook market inspection.' },
  live: { label: 'LIVE ACTIVE', tone: 'ACTIVE', note: 'Verified live-score tracking and state normalization.' },
  props: { label: 'DECISION ACTIVE', tone: 'ACTIVE', note: 'Production BET/PASS gate with probability, edge and EV.' },
  sims: { label: 'MLB K ACTIVE', tone: 'ACTIVE', note: '10,000x verified pitcher-K simulations; team sims remain locked.' },
  audit: { label: 'MODEL ARENA ACTIVE', tone: 'ACTIVE', note: 'Champion/challenger, calibration, walk-forward and V5 evidence.' },
  parlays: { label: 'LOCKED', tone: 'LOCKED', note: 'Correlation engine not yet production-qualified.' },
  'ai-learn': { label: 'PARTIAL', tone: 'PARTIAL', note: 'Learning framework exists; not a pick-generation engine.' },
  'my-bets': { label: 'PARTIAL', tone: 'PARTIAL', note: 'Ledger framework is not yet the primary workflow.' },
  tools: { label: 'PARTIAL', tone: 'PARTIAL', note: 'Math utilities are secondary to the recommendation engine.' },
};

export const OverviewView: React.FC<OverviewViewProps> = ({
  health,
  version,
  isLoading,
  isError,
  errorMessage,
  latencyMs,
  lastChecked,
  onRefresh,
  onSelectTab,
  onOpenPick,
}) => {
  const [decisionBoard, setDecisionBoard] = useState<DecisionBoardResponse | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const todayChicago = useCallback(() => {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }, []);

  const loadSavedBoard = useCallback(async () => {
    try {
      const date = todayChicago();
      const res = await fetch(`/api/decision-board/saved?sport=ALL&date=${encodeURIComponent(date)}`);
      if (res.ok) setDecisionBoard(await res.json());
    } catch {
      // Zero-credit convenience lookup only.
    }
  }, [todayChicago]);

  useEffect(() => {
    loadSavedBoard();
  }, [loadSavedBoard]);

  const scanTopPicks = useCallback(async () => {
    setDecisionLoading(true);
    setDecisionError(null);
    try {
      const date = todayChicago();
      const res = await fetch('/api/decision-board/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sport: 'ALL', date, maxGames: 3 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Decision scan returned HTTP ${res.status}`);
      setDecisionBoard(data as DecisionBoardResponse);
    } catch (err: any) {
      setDecisionError(err.message || 'Unable to scan today’s slate.');
    } finally {
      setDecisionLoading(false);
    }
  }, [todayChicago]);

  const modules = NAVIGATION_ITEMS.filter((item) => item.id !== 'overview');

  return (
    <div id="overview-view-container" className="space-y-7 animate-in fade-in">
      <SystemHealthPanel
        health={health}
        version={version}
        isLoading={isLoading}
        isError={isError}
        errorMessage={errorMessage}
        latencyMs={latencyMs}
        lastChecked={lastChecked}
        onRefresh={onRefresh}
      />

      <DecisionBoardPanel
        board={decisionBoard}
        loading={decisionLoading}
        error={decisionError}
        onScan={scanTopPicks}
        onOpenPick={(eventId) => onOpenPick ? onOpenPick(eventId) : onSelectTab('props')}
        compact
        scanLabel="Find Best Picks"
      />

      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/15 p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-emerald-300">
              <Target className="h-5 w-5" />
              <span className="text-xs font-black uppercase tracking-wider">Supporting Analysis</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-2">Use the deeper engines to inspect or corroborate the decision.</h1>
            <p className="text-sm text-slate-300 mt-2 leading-relaxed">
              The Decision Board above is the starting point. Player Props provides the full probability/EV breakdown; Sims independently corroborates verified MLB pitcher-K distributions; Audit shows calibration and champion/challenger evidence.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row lg:flex-col gap-2 min-w-[220px]">
            <button onClick={() => onSelectTab('props')} className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950 hover:bg-emerald-400 flex items-center justify-center gap-2">
              <Layers className="h-4 w-4" /> Find Qualified Props
            </button>
            <button onClick={() => onSelectTab('sims')} className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2.5 text-sm font-bold text-cyan-300 hover:bg-cyan-500/15 flex items-center justify-center gap-2">
              <Cpu className="h-4 w-4" /> Run MLB K Sims
            </button>
            <button onClick={() => onSelectTab('live')} className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-bold text-slate-300 hover:bg-slate-800 flex items-center justify-center gap-2">
              <Radio className="h-4 w-4" /> View Live Games
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-white">Engine Coverage</h2>
            <p className="text-xs text-slate-400">What can make a decision today versus what is still intentionally locked.</p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-950/30 border border-emerald-500/20 px-2.5 py-1 rounded-lg">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Fail-closed integrity active</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map((item) => {
            const Icon = getNavIcon(item.id);
            const status = moduleStatus[item.id] || { label: 'PARTIAL', tone: 'PARTIAL' as const, note: item.description };
            const active = status.tone === 'ACTIVE';
            const locked = status.tone === 'LOCKED';
            return (
              <button
                key={item.id}
                id={`overview-card-${item.id}`}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`group flex flex-col justify-between rounded-xl border p-5 text-left transition-all focus:outline-none ${active ? 'border-emerald-500/20 bg-[#0d1322] hover:border-emerald-500/40' : 'border-slate-800/90 bg-[#0d1322] hover:border-slate-700'}`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg border bg-slate-900/80 ${active ? 'border-emerald-500/20 text-emerald-400' : 'border-slate-800 text-slate-400'}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className={`rounded border px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider ${active ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : locked ? 'border-slate-700 bg-slate-900 text-slate-500' : 'border-amber-500/20 bg-amber-500/10 text-amber-300'}`}>
                      {status.label}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white group-hover:text-emerald-300 transition-colors">{item.label}</h3>
                    <p className="mt-1 text-xs text-slate-400 leading-relaxed">{status.note}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-800/60 pt-3 text-[11px] font-medium text-slate-400">
                  <span className="font-mono flex items-center gap-1">{locked && <Lock className="h-3 w-3" />}{active ? 'Open engine' : locked ? 'Inspect lock' : 'Inspect module'}</span>
                  <div className="flex items-center gap-1 text-emerald-400 group-hover:translate-x-0.5 transition-transform"><span>Open</span><ChevronRight className="h-3.5 w-3.5" /></div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
