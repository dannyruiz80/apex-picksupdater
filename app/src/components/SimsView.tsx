import React, { useMemo, useState } from 'react';
import { Cpu, Play, ShieldCheck, AlertTriangle, TrendingUp, Gauge, Target, RefreshCw, Lock } from 'lucide-react';
import { NormalizedApexGame } from '../types';

interface SimsViewProps {
  games: NormalizedApexGame[];
}

interface SimRow {
  simulationVersion: string;
  trials: number;
  seed: string;
  playerId: string | null;
  playerName: string;
  team: string;
  opponent: string;
  line: number;
  sportsbook: string;
  productionDecision: 'QUALIFIES' | 'NO_BET';
  productionSide: 'OVER' | 'UNDER' | null;
  productionProbability: number | null;
  productionEVPercent: number | null;
  productionEdgePp: number | null;
  oddsAmerican: number | null;
  reliabilityTier: string | null;
  shadowModelVersion: string | null;
  v3DataQuality: string | null;
  expectedStrikeouts: number | null;
  simulatedMeanStrikeouts: number | null;
  simulatedMedianStrikeouts: number | null;
  simulatedP10Strikeouts: number | null;
  simulatedP90Strikeouts: number | null;
  overProbability: number | null;
  underProbability: number | null;
  pushProbability: number | null;
  simulationSupportsProduction: boolean | null;
  status: 'SIMULATED' | 'UNAVAILABLE';
  reason: string | null;
}

interface SimResponse {
  status: string;
  message?: string;
  eventTitle?: string;
  trialsPerQuote?: number;
  generatedAt?: string;
  note?: string;
  simulations: SimRow[];
}

const fmtPct = (v: number | null, digits = 1) => (v === null ? '—' : `${(v * 100).toFixed(digits)}%`);
const fmtSigned = (v: number | null, suffix = '%') => {
  if (v === null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}${suffix}`;
};
const fmtOdds = (v: number | null) => (v === null ? '—' : v > 0 ? `+${v}` : `${v}`);

export const SimsView: React.FC<SimsViewProps> = ({ games }) => {
  const eligibleGames = useMemo(
    () => games.filter((g) => g.sport === 'MLB' && g.status === 'UPCOMING' && Boolean(g.startTime)),
    [games]
  );
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimResponse | null>(null);

  const selectedGame = useMemo(() => {
    const id = selectedEventId || eligibleGames[0]?.eventId || '';
    return eligibleGames.find((g) => g.eventId === id) || null;
  }, [eligibleGames, selectedEventId]);

  const runSimulation = async () => {
    if (!selectedGame) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sims/mlb/pitcher-k', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: selectedGame }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Simulation returned HTTP ${res.status}`);
      setResult(data as SimResponse);
      if (data.status !== 'SUCCESS') setError(data.message || 'No verified simulation inputs are available for this event.');
    } catch (err: any) {
      setError(err.message || 'Simulation failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const available = (result?.simulations || []).filter((r) => r.status === 'SIMULATED');
  const qualified = available.filter((r) => r.productionDecision === 'QUALIFIES');
  const top = qualified[0] || null;

  return (
    <div className="space-y-6 animate-in fade-in" id="sims-decision-center">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <Cpu className="h-6 w-6 text-emerald-400" />
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">Simulation Decision Center</h2>
            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-300">
              MLB K ACTIVE
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            10,000-trial simulations from verified MLB pitcher-strikeout V3 distributions. Production BET/PASS gating remains authoritative.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="flex-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">MLB Game</label>
            <select
              value={selectedGame?.eventId || ''}
              onChange={(e) => { setSelectedEventId(e.target.value); setResult(null); setError(null); }}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              {eligibleGames.length === 0 && <option value="">No upcoming MLB games on current slate</option>}
              {eligibleGames.map((g) => (
                <option key={g.eventId} value={g.eventId}>{g.awayTeam} @ {g.homeTeam}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={runSimulation}
            disabled={!selectedGame || loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
          >
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {loading ? 'Running verified simulation…' : 'Run 10,000x & Rank Picks'}
          </button>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-cyan-500/20 bg-cyan-950/20 p-3 text-xs text-slate-300">
          <ShieldCheck className="h-4 w-4 shrink-0 text-cyan-400 mt-0.5" />
          <span>
            Simulations are generated only from point-in-time-valid V3 pitcher-K features. A simulation can support a production pick, but it cannot turn a production NO BET into a bet.
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {top && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/20 p-5 sm:p-6">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-emerald-500/20 px-2 py-1 text-[10px] font-black tracking-wider text-emerald-300">TOP QUALIFIED PICK</span>
                {top.simulationSupportsProduction === true && (
                  <span className="rounded bg-cyan-500/15 border border-cyan-500/30 px-2 py-1 text-[10px] font-bold text-cyan-300">SIM SUPPORTS</span>
                )}
              </div>
              <h3 className="text-2xl font-extrabold text-white">
                {top.playerName} {top.productionSide} {top.line} Ks
              </h3>
              <p className="text-sm text-slate-300">
                {top.team} vs {top.opponent} · {top.sportsbook} {fmtOdds(top.oddsAmerican)}
              </p>
              <p className="text-xs text-slate-400 max-w-2xl">
                This is the highest-ranked production-qualified pitcher-K opportunity returned for this event. V3 simulation is corroborating evidence only while the challenger remains in shadow.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 min-w-full lg:min-w-[520px]">
              <Metric label="Production Prob" value={fmtPct(top.productionProbability)} />
              <Metric label="Simulation Prob" value={fmtPct(top.productionSide === 'OVER' ? top.overProbability : top.underProbability)} />
              <Metric label="EV" value={fmtSigned(top.productionEVPercent)} />
              <Metric label="Edge" value={fmtSigned(top.productionEdgePp, ' pp')} />
            </div>
          </div>
        </div>
      )}

      {result && result.status === 'SUCCESS' && qualified.length === 0 && (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 text-center">
          <Lock className="h-6 w-6 text-slate-400 mx-auto mb-2" />
          <h3 className="font-bold text-white">No production-qualified pitcher-K pick</h3>
          <p className="text-sm text-slate-400 mt-1">The correct output for this matchup is PASS. Simulation results below remain research-only.</p>
        </div>
      )}

      {available.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-400" /> Ranked Simulation Results</h3>
            <span className="text-[10px] font-mono text-slate-500">10,000 trials per line · deterministic seed</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {available.map((row) => {
              const simSideProb = row.productionSide === 'OVER' ? row.overProbability : row.productionSide === 'UNDER' ? row.underProbability : null;
              return (
                <div key={`${row.playerName}-${row.line}-${row.sportsbook}`} className={`rounded-xl border p-4 ${row.productionDecision === 'QUALIFIES' ? 'border-emerald-500/30 bg-emerald-950/10' : 'border-slate-800 bg-[#0d1322]'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-white">{row.playerName}</div>
                      <div className="text-xs text-slate-400">{row.team} vs {row.opponent}</div>
                    </div>
                    <span className={`rounded px-2 py-1 text-[10px] font-black ${row.productionDecision === 'QUALIFIES' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                      {row.productionDecision === 'QUALIFIES' ? 'BET CANDIDATE' : 'PASS'}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Metric label="Production" value={row.productionSide ? `${row.productionSide} ${row.line}` : 'NO BET'} compact />
                    <Metric label="Model Prob" value={fmtPct(row.productionProbability)} compact />
                    <Metric label="Sim Prob" value={fmtPct(simSideProb)} compact />
                    <Metric label="EV" value={fmtSigned(row.productionEVPercent)} compact />
                  </div>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono text-slate-400">
                    <span>Mean Ks: <b className="text-slate-200">{row.simulatedMeanStrikeouts ?? '—'}</b></span>
                    <span>P10: <b className="text-slate-200">{row.simulatedP10Strikeouts ?? '—'}</b></span>
                    <span>Median: <b className="text-slate-200">{row.simulatedMedianStrikeouts ?? '—'}</b></span>
                    <span>P90: <b className="text-slate-200">{row.simulatedP90Strikeouts ?? '—'}</b></span>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-2 text-[10px] text-slate-500">
                    <span>{row.reliabilityTier || 'UNKNOWN'} data · V3 {row.v3DataQuality || 'UNKNOWN'}</span>
                    <span>{row.simulationSupportsProduction === true ? '✓ simulation direction agrees' : row.productionDecision === 'QUALIFIES' ? '⚠ simulation disagreement' : 'research only'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 flex items-start gap-3 text-xs text-slate-400">
        <Gauge className="h-4 w-4 shrink-0 text-slate-500 mt-0.5" />
        <div>
          <div className="font-bold text-slate-300">Coverage status</div>
          <p className="mt-0.5">
            MLB pitcher-strikeout simulation is active. Full team moneyline/spread/total Monte Carlo remains locked until independent team-strength, pace/run-environment, roster, and matchup models are validated. Apex will not manufacture those inputs from sportsbook prices and call them independent predictions.
          </p>
        </div>
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; compact?: boolean }> = ({ label, value, compact }) => (
  <div className={`rounded-lg border border-slate-800 bg-slate-950/70 ${compact ? 'p-2' : 'p-3'}`}>
    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`${compact ? 'text-sm' : 'text-lg'} font-extrabold font-mono text-white mt-0.5`}>{value}</div>
  </div>
);
