import React, { useEffect, useMemo, useState } from 'react';
import { Cpu, Play, ShieldCheck, AlertTriangle, TrendingUp, Gauge, RefreshCw, Lock, FlaskConical, BarChart3 } from 'lucide-react';
import { NormalizedApexGame } from '../types';

interface SimsViewProps { games: NormalizedApexGame[]; }

interface SimRow {
  simulationVersion: string; trials: number; seed: string; playerId: string | null; playerName: string; team: string; opponent: string;
  line: number; sportsbook: string; productionDecision: 'QUALIFIES' | 'NO_BET'; productionSide: 'OVER' | 'UNDER' | null;
  productionProbability: number | null; productionEVPercent: number | null; productionEdgePp: number | null; oddsAmerican: number | null;
  reliabilityTier: string | null; shadowModelVersion: string | null; v3DataQuality: string | null; expectedStrikeouts: number | null;
  simulatedMeanStrikeouts: number | null; simulatedMedianStrikeouts: number | null; simulatedP10Strikeouts: number | null; simulatedP90Strikeouts: number | null;
  overProbability: number | null; underProbability: number | null; pushProbability: number | null; simulationSupportsProduction: boolean | null;
  status: 'SIMULATED' | 'UNAVAILABLE'; reason: string | null;
}
interface SimResponse { status: string; message?: string; eventTitle?: string; trialsPerQuote?: number; generatedAt?: string; note?: string; simulations: SimRow[]; }

interface WnbaSimulation {
  simulationVersion: 'APEX_WNBA_MONTE_CARLO_V1'; generatedAt: string; trials: number; seed: string; eventId: string; matchup: string;
  modelVersion: string; pointInTimeValid: boolean; reliabilityTier: string; expectedHomeScore: number; expectedAwayScore: number;
  expectedMargin: number; expectedTotal: number; marginStdDev: number; totalStdDev: number; analyticHomeWinProbability: number;
  simulatedHomeWinProbability: number; simulatedAwayWinProbability: number; simulatedMeanHomeScore: number; simulatedMeanAwayScore: number;
  simulatedMedianTotal: number; simulatedP10Total: number; simulatedP90Total: number; simulatedMedianMargin: number; simulatedP10Margin: number; simulatedP90Margin: number;
  status: 'SIMULATED'; note: string;
}
interface WnbaBacktestReport {
  reportVersion: string; generatedAt: string; startSeason: number; endSeason: number; teamCount: number; totalCompletedGamesFetched: number;
  targetSeasonGames: number; evaluatedGames: number; insufficientHistoryGames: number; leakageRejectedGames: number; monteCarloTrialsPerGame: number;
  simulationTrialsAreEvidence: false;
  metrics: {
    analyticBrierScore: number | null; analyticLogLoss: number | null; monteCarloBrierScore: number | null; monteCarloLogLoss: number | null;
    meanPredictedHomeWinProbability: number | null; actualHomeWinRate: number | null; calibrationGap: number | null; expectedCalibrationError: number | null;
    meanAbsoluteHomeScoreError: number | null; meanAbsoluteAwayScoreError: number | null; meanAbsoluteMarginError: number | null; meanAbsoluteTotalError: number | null;
    rootMeanSquaredMarginError: number | null; rootMeanSquaredTotalError: number | null;
  };
  evidence: { independentDecisiveObservations: number; evidenceTier: string; recommendedMoneylineModelWeight: number; status: string; reason: string; };
  historicalMarketBacktest: { status: string; reason: string; };
  bySeason: Array<{ season: number; evaluatedGames: number; brierScore: number | null; logLoss: number | null; meanAbsoluteMarginError: number | null; meanAbsoluteTotalError: number | null; }>;
}

interface ContextLearningSlice {
  sport: 'ALL' | 'MLB' | 'SOCCER' | 'WNBA' | 'NFL' | 'NCAAF';
  gradedEvents: number;
  baseTotalMae: number | null;
  challengerTotalMae: number | null;
  improvementPct: number | null;
  improvedGames: number;
  improvementRate: number | null;
  recentImprovementPct: number | null;
  promotionEligible: boolean;
  promotionStatus: 'COLLECTING' | 'PROMOTION_ELIGIBLE' | 'CHALLENGER_LEADING' | 'NO_PROVEN_GAIN';
}
interface ContextLearningStatus {
  version: string;
  generatedAt: string;
  policy: string;
  overall: ContextLearningSlice;
  bySport: ContextLearningSlice[];
  totalFrozenPregameSnapshots: number;
  uniqueLearningSnapshots: number;
  duplicateLearningSnapshotsSuppressed: number;
  featureLeaderboard: Array<{ sport: string; key: string; evidenceCount: number; helpRate: number | null; meanErrorGain: number | null; learnedMultiplier: number }>;
}

const fmtPct = (v: number | null, digits = 1) => (v === null ? '—' : `${(v * 100).toFixed(digits)}%`);
const fmtNum = (v: number | null, digits = 2) => (v === null ? '—' : v.toFixed(digits));
const fmtSigned = (v: number | null, suffix = '%') => v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}${suffix}`;
const fmtOdds = (v: number | null) => v === null ? '—' : v > 0 ? `+${v}` : `${v}`;
const localDateKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const SimsView: React.FC<SimsViewProps> = ({ games }) => {
  const [mode, setMode] = useState<'MLB' | 'WNBA' | 'CONTEXT'>('MLB');
  const eligibleMlb = useMemo(() => games.filter(g => g.sport === 'MLB' && g.status === 'UPCOMING' && Boolean(g.startTime)), [games]);
  const eligibleWnbaCurrent = useMemo(() => games.filter(g => g.sport === 'WNBA' && g.status === 'UPCOMING' && g.pregameBetEligible !== false && Boolean(g.startTime)), [games]);

  const [selectedMlbId, setSelectedMlbId] = useState('');
  const [mlbLoading, setMlbLoading] = useState(false);
  const [mlbError, setMlbError] = useState<string | null>(null);
  const [mlbResult, setMlbResult] = useState<SimResponse | null>(null);

  const [selectedWnbaId, setSelectedWnbaId] = useState('');
  const [wnbaSimDate, setWnbaSimDate] = useState(localDateKey);
  const [wnbaSlateGames, setWnbaSlateGames] = useState<NormalizedApexGame[]>([]);
  const [wnbaLoadedDate, setWnbaLoadedDate] = useState<string | null>(null);
  const [wnbaSlateLoading, setWnbaSlateLoading] = useState(false);
  const [wnbaSlateError, setWnbaSlateError] = useState<string | null>(null);
  const [wnbaLoading, setWnbaLoading] = useState(false);
  const [wnbaError, setWnbaError] = useState<string | null>(null);
  const [wnbaSimulation, setWnbaSimulation] = useState<WnbaSimulation | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [backtest, setBacktest] = useState<WnbaBacktestReport | null>(null);
  const [contextLearning, setContextLearning] = useState<ContextLearningStatus | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const currentYear = new Date().getFullYear();
  const [startSeason, setStartSeason] = useState(currentYear - 2);
  const [endSeason, setEndSeason] = useState(currentYear);

  const selectedMlb = useMemo(() => eligibleMlb.find(g => g.eventId === (selectedMlbId || eligibleMlb[0]?.eventId)) || null, [eligibleMlb, selectedMlbId]);
  const simulationWnbaGames = useMemo(() => wnbaLoadedDate ? wnbaSlateGames : eligibleWnbaCurrent, [wnbaLoadedDate, wnbaSlateGames, eligibleWnbaCurrent]);
  const selectedWnba = useMemo(() => simulationWnbaGames.find(g => g.eventId === (selectedWnbaId || simulationWnbaGames[0]?.eventId)) || null, [simulationWnbaGames, selectedWnbaId]);

  useEffect(() => {
    fetch('/api/ml/wnba/backtest/status')
      .then(r => r.json())
      .then(d => setBacktest(d?.report || null))
      .catch(() => undefined);
    fetch('/api/ml/context-learning/status')
      .then(r => r.json())
      .then(d => setContextLearning(d || null))
      .catch(() => undefined);
  }, []);

  const refreshContextLearning = async () => {
    setContextLoading(true);
    try {
      const res = await fetch('/api/ml/context-learning/status');
      if (res.ok) setContextLearning(await res.json());
    } finally { setContextLoading(false); }
  };

  const runMlb = async () => {
    if (!selectedMlb) return;
    setMlbLoading(true); setMlbError(null);
    try {
      const res = await fetch('/api/sims/mlb/pitcher-k', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: selectedMlb }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Simulation returned HTTP ${res.status}`);
      setMlbResult(data as SimResponse);
      if (data.status !== 'SUCCESS') setMlbError(data.message || 'No verified simulation inputs are available for this event.');
    } catch (err: any) { setMlbError(err.message || 'Simulation failed'); setMlbResult(null); }
    finally { setMlbLoading(false); }
  };

  const loadWnbaSimulationSlate = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wnbaSimDate)) { setWnbaSlateError('Choose a valid WNBA simulation date.'); return; }
    setWnbaSlateLoading(true); setWnbaSlateError(null); setWnbaSimulation(null); setWnbaError(null);
    try {
      const res = await fetch(`/api/sims/wnba/slate?date=${encodeURIComponent(wnbaSimDate)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== 'SUCCESS') throw new Error(data.message || `WNBA slate returned HTTP ${res.status}`);
      const loaded = Array.isArray(data.games) ? data.games as NormalizedApexGame[] : [];
      setWnbaSlateGames(loaded);
      setWnbaLoadedDate(String(data.scheduleDate || wnbaSimDate));
      setSelectedWnbaId(loaded[0]?.eventId || '');
      if (loaded.length === 0) setWnbaSlateError(`No pregame-eligible WNBA games were found for ${wnbaSimDate}.`);
    } catch (err: any) {
      setWnbaSlateGames([]); setWnbaLoadedDate(wnbaSimDate); setSelectedWnbaId('');
      setWnbaSlateError(err.message || 'WNBA simulation slate failed to load');
    } finally { setWnbaSlateLoading(false); }
  };

  const runWnba = async () => {
    if (!selectedWnba) return;
    setWnbaLoading(true); setWnbaError(null);
    try {
      const res = await fetch('/api/sims/wnba/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: selectedWnba, trials: 25000 }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Simulation returned HTTP ${res.status}`);
      setWnbaSimulation(data.simulation || null);
    } catch (err: any) { setWnbaError(err.message || 'WNBA simulation failed'); setWnbaSimulation(null); }
    finally { setWnbaLoading(false); }
  };

  const runBacktest = async () => {
    setBacktestLoading(true); setBacktestError(null);
    try {
      const res = await fetch('/api/ml/wnba/backtest/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startSeason, endSeason, trialsPerGame: 2000 }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== 'SUCCESS') throw new Error(data.message || `Backtest returned HTTP ${res.status}`);
      setBacktest(data.report || null);
    } catch (err: any) { setBacktestError(err.message || 'WNBA historical backtest failed'); }
    finally { setBacktestLoading(false); }
  };

  const available = (mlbResult?.simulations || []).filter(r => r.status === 'SIMULATED');
  const qualified = available.filter(r => r.productionDecision === 'QUALIFIES');
  const top = qualified[0] || null;

  return (
    <div className="space-y-6 animate-in fade-in" id="sims-decision-center">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <Cpu className="h-6 w-6 text-emerald-400" />
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">Simulation & Historical Validation Center</h2>
          </div>
          <p className="text-sm text-slate-400 mt-1">Real historical games create evidence. Monte Carlo trials add scenario resolution, never fake sample size.</p>
        </div>
        <div className="inline-flex rounded-xl border border-slate-800 bg-slate-950 p-1">
          <button onClick={() => setMode('MLB')} className={`px-4 py-2 rounded-lg text-xs font-bold ${mode === 'MLB' ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-400'}`}>MLB Pitcher K</button>
          <button onClick={() => setMode('WNBA')} className={`px-4 py-2 rounded-lg text-xs font-bold ${mode === 'WNBA' ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-400'}`}>WNBA Game Model</button>
          <button onClick={() => setMode('CONTEXT')} className={`px-4 py-2 rounded-lg text-xs font-bold ${mode === 'CONTEXT' ? 'bg-violet-500/15 text-violet-300' : 'text-slate-400'}`}>Context Learning</button>
        </div>
      </div>

      {mode === 'CONTEXT' ? (
        <ContextLearningPanel status={contextLearning} loading={contextLoading} onRefresh={refreshContextLearning} />
      ) : mode === 'WNBA' ? (
        <>
          <div className="rounded-2xl border border-cyan-500/25 bg-[#0d1322] p-5 space-y-4">
            <div className="flex items-start gap-3">
              <FlaskConical className="h-5 w-5 text-cyan-400 mt-0.5" />
              <div>
                <h3 className="font-bold text-white">WNBA Walk-Forward Historical Backtest</h3>
                <p className="text-xs text-slate-400 mt-1">Replays real completed WNBA games chronologically. Every forecast sees only games completed before that event. Public ESPN history uses zero keyed Odds API credits.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 items-end">
              <SeasonInput label="Start season" value={startSeason} onChange={setStartSeason} />
              <SeasonInput label="End season" value={endSeason} onChange={setEndSeason} />
              <div className="xl:col-span-2 text-[11px] text-slate-400 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5">
                2,000 MC trials per historical game validate scenario probabilities, but <b className="text-white">only real games</b> count as evidence.
              </div>
              <button onClick={runBacktest} disabled={backtestLoading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-4 py-2.5 text-sm font-bold text-cyan-300 disabled:opacity-40">
                {backtestLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
                {backtestLoading ? 'Replaying history…' : 'Run Backtest'}
              </button>
            </div>
            {backtestError && <InlineError text={backtestError} />}
            {backtest && <BacktestSummary report={backtest} />}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_auto] gap-3 items-end">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Simulation Slate Date</label>
                <input type="date" value={wnbaSimDate} onChange={e => { setWnbaSimDate(e.target.value); setWnbaSimulation(null); setWnbaError(null); setWnbaSlateError(null); }} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Upcoming WNBA Game</label>
                <select value={selectedWnba?.eventId || ''} onChange={e => { setSelectedWnbaId(e.target.value); setWnbaSimulation(null); setWnbaError(null); }} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
                  {simulationWnbaGames.length === 0 && <option value="">{wnbaLoadedDate ? `No upcoming WNBA games on ${wnbaLoadedDate}` : 'Load a WNBA slate date to choose a game'}</option>}
                  {simulationWnbaGames.map(g => <option key={g.eventId} value={g.eventId}>{g.awayTeam} @ {g.homeTeam}</option>)}
                </select>
              </div>
              <button onClick={loadWnbaSimulationSlate} disabled={wnbaSlateLoading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-4 py-2 text-sm font-bold text-cyan-300 disabled:opacity-40">
                {wnbaSlateLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {wnbaSlateLoading ? 'Loading slate…' : 'Load Date'}
              </button>
            </div>
            {wnbaLoadedDate && !wnbaSlateLoading && !wnbaSlateError && <div className="text-[11px] text-cyan-300">Loaded WNBA simulation slate: <b>{wnbaLoadedDate}</b> · {simulationWnbaGames.length} pregame-eligible game{simulationWnbaGames.length === 1 ? '' : 's'} · public schedule lookup uses zero keyed Odds API credits.</div>}
            {wnbaSlateError && <InlineError text={wnbaSlateError} />}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-t border-slate-800 pt-4">
              <div className="flex items-start gap-2 text-xs text-slate-300">
                <ShieldCheck className="h-4 w-4 shrink-0 text-cyan-400 mt-0.5" />
                <span>WNBA simulation uses the same independent production score projection and uncertainty distribution as Picks. Sportsbook prices do not enter the score simulation.</span>
              </div>
              <button onClick={runWnba} disabled={!selectedWnba || wnbaLoading || wnbaSlateLoading} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-bold text-emerald-300 disabled:opacity-40">
                {wnbaLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {wnbaLoading ? 'Running 25,000x…' : 'Run 25,000x Simulation'}
              </button>
            </div>
            {wnbaError && <InlineError text={wnbaError} />}
          </div>

          {wnbaSimulation && <WnbaSimulationCard sim={wnbaSimulation} backtest={backtest} />}

          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 flex items-start gap-3 text-xs text-slate-400">
            <Gauge className="h-4 w-4 shrink-0 text-slate-500 mt-0.5" />
            <div><div className="font-bold text-slate-300">WNBA evidence policy</div><p className="mt-0.5">Historical replay may calibrate WNBA <b>moneyline probability shrinkage</b> after at least 30 leakage-free games. Spread/total betting calibration remains prospective until authentic archived sportsbook lines are available. Apex will not invent historical -110 prices.</p></div>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-end gap-3">
              <div className="flex-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">MLB Game</label>
                <select value={selectedMlb?.eventId || ''} onChange={e => { setSelectedMlbId(e.target.value); setMlbResult(null); setMlbError(null); }} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
                  {eligibleMlb.length === 0 && <option value="">No upcoming MLB games on current slate</option>}
                  {eligibleMlb.map(g => <option key={g.eventId} value={g.eventId}>{g.awayTeam} @ {g.homeTeam}</option>)}
                </select>
              </div>
              <button onClick={runMlb} disabled={!selectedMlb || mlbLoading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-bold text-emerald-300 disabled:opacity-40">
                {mlbLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {mlbLoading ? 'Running verified simulation…' : 'Run 10,000x & Rank Picks'}
              </button>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-cyan-500/20 bg-cyan-950/20 p-3 text-xs text-slate-300"><ShieldCheck className="h-4 w-4 shrink-0 text-cyan-400 mt-0.5" /><span>Simulations are generated only from point-in-time-valid V3 pitcher-K features. A simulation can support a production pick, but it cannot turn a production NO BET into a bet.</span></div>
          </div>
          {mlbError && <InlineError text={mlbError} />}
          {top && <MlbTopCard top={top} />}
          {mlbResult && mlbResult.status === 'SUCCESS' && qualified.length === 0 && <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 text-center"><Lock className="h-6 w-6 text-slate-400 mx-auto mb-2" /><h3 className="font-bold text-white">No production-qualified pitcher-K pick</h3><p className="text-sm text-slate-400 mt-1">The correct output for this matchup is PASS. Simulation results below remain research-only.</p></div>}
          {available.length > 0 && <MlbRows rows={available} />}
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 flex items-start gap-3 text-xs text-slate-400"><Gauge className="h-4 w-4 shrink-0 text-slate-500 mt-0.5" /><div><div className="font-bold text-slate-300">Coverage status</div><p className="mt-0.5">MLB pitcher-strikeout simulation remains active from the validated V3 count distribution. WNBA now has its own game-level walk-forward and Monte Carlo lane rather than borrowing MLB assumptions.</p></div></div>
        </>
      )}
    </div>
  );
};


const ContextLearningPanel: React.FC<{ status: ContextLearningStatus | null; loading: boolean; onRefresh: () => void }> = ({ status, loading, onRefresh }) => {
  const fmtImprovement = (v: number | null) => v === null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  return <div className="space-y-4">
    <div className="rounded-2xl border border-violet-500/25 bg-[#0d1322] p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div><div className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-violet-400" /><h3 className="font-bold text-white">Pregame → Postgame Context Learning V2</h3></div><p className="text-xs text-slate-400 mt-1">Totals-first shadow challengers now cover MLB, Soccer, WNBA, NFL and NCAAF. Apex freezes the first immutable pregame snapshot, grades only real finals, and reweights features chronologically so future outcomes cannot leak backward.</p></div>
        <button onClick={onRefresh} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/15 px-4 py-2 text-sm font-bold text-violet-300 disabled:opacity-40">{loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Refresh Evidence</button>
      </div>
      {!status ? <div className="text-sm text-slate-400">No context-learning evidence has been recorded yet. Scan supported pregame totals to freeze immutable snapshots; Apex grades them automatically after finals.</div> : <>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
          <Metric label="Frozen Rows" value={`${status.totalFrozenPregameSnapshots}`} compact />
          <Metric label="Unique Evidence" value={`${status.uniqueLearningSnapshots}`} compact />
          <Metric label="Duplicates Blocked" value={`${status.duplicateLearningSnapshotsSuppressed}`} compact />
          <Metric label="Graded Events" value={`${status.overall.gradedEvents}`} compact />
          <Metric label="Base Total MAE" value={fmtNum(status.overall.baseTotalMae, 2)} compact />
          <Metric label="Context MAE" value={fmtNum(status.overall.challengerTotalMae, 2)} compact />
          <Metric label="MAE Gain" value={fmtImprovement(status.overall.improvementPct)} compact />
          <Metric label="Promotion" value={status.overall.promotionStatus} compact />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">{status.bySport.map(row => <div key={row.sport} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><div className="flex items-center justify-between gap-2"><div className="font-bold text-white">{row.sport} Totals Challenger</div><span className={`rounded px-2 py-1 text-[10px] font-bold ${row.promotionEligible ? 'bg-emerald-500/15 text-emerald-300' : row.promotionStatus === 'CHALLENGER_LEADING' ? 'bg-cyan-500/10 text-cyan-300' : 'bg-amber-500/10 text-amber-300'}`}>{row.promotionStatus}</span></div><div className="mt-3 grid grid-cols-2 gap-2"><Metric label="Games" value={`${row.gradedEvents}`} compact /><Metric label="Improved" value={row.improvementRate === null ? '—' : `${(row.improvementRate*100).toFixed(0)}%`} compact /><Metric label="MAE Gain" value={fmtImprovement(row.improvementPct)} compact /><Metric label="Recent Gain" value={fmtImprovement(row.recentImprovementPct)} compact /></div></div>)}</div>
        {status.featureLeaderboard.length > 0 && <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><div className="flex items-center gap-2 text-sm font-black text-white"><BarChart3 className="h-4 w-4 text-violet-400"/> Learned feature evidence</div><div className="mt-3 grid gap-2 lg:grid-cols-2">{status.featureLeaderboard.slice(0,10).map(row => <div key={`${row.sport}-${row.key}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-black/20 px-3 py-2 text-[10px]"><div><div className="font-bold text-slate-200">{row.sport} · {row.key.replaceAll('_',' ')}</div><div className="text-slate-500">{row.evidenceCount} graded · help {row.helpRate === null ? '—' : `${(row.helpRate*100).toFixed(0)}%`}</div></div><div className="text-right"><div className="font-black text-violet-300">{row.learnedMultiplier.toFixed(2)}x</div><div className="text-slate-500">gain {row.meanErrorGain === null ? '—' : row.meanErrorGain.toFixed(2)}</div></div></div>)}</div></div>}
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">{status.policy}</div>
      </>}
    </div>
    <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-xs text-slate-400"><b className="text-slate-300">Feature policy:</b> MLB adds starter run prevention/K-BB/HR risk, bullpen workload, temperature, empirical venue scoring and verified interactions. Soccer uses xG, shots-on-target, keeper suppression and tactical proxies only where sourced. WNBA adds pace/efficiency and transition context. NFL/NCAAF add pace, red-zone, recent totals and wind; unsupported pressure data stays unavailable. All context remains shadow-only until evidence gates are met.</div>
  </div>;
};

const SeasonInput: React.FC<{ label: string; value: number; onChange: (v: number) => void }> = ({ label, value, onChange }) => <div><label className="text-[10px] uppercase font-bold text-slate-500">{label}</label><input type="number" value={value} min={1997} max={2100} onChange={e => onChange(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></div>;
const InlineError: React.FC<{ text: string }> = ({ text }) => <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-200 flex items-start gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{text}</span></div>;

const BacktestSummary: React.FC<{ report: WnbaBacktestReport }> = ({ report }) => (
  <div className="space-y-3 border-t border-slate-800 pt-4">
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
      <Metric label="Real games" value={`${report.evaluatedGames}`} compact />
      <Metric label="Evidence tier" value={report.evidence.evidenceTier} compact />
      <Metric label="Brier" value={fmtNum(report.metrics.analyticBrierScore, 3)} compact />
      <Metric label="Log loss" value={fmtNum(report.metrics.analyticLogLoss, 3)} compact />
      <Metric label="ECE" value={fmtPct(report.metrics.expectedCalibrationError, 1)} compact />
      <Metric label="Margin MAE" value={fmtNum(report.metrics.meanAbsoluteMarginError, 1)} compact />
      <Metric label="Total MAE" value={fmtNum(report.metrics.meanAbsoluteTotalError, 1)} compact />
      <Metric label="ML weight" value={fmtPct(report.evidence.recommendedMoneylineModelWeight, 0)} compact />
    </div>
    <div className={`rounded-lg border p-3 text-xs ${report.evidence.status === 'ACTIVE' ? 'border-emerald-500/30 bg-emerald-950/15 text-emerald-200' : 'border-amber-500/30 bg-amber-950/15 text-amber-200'}`}>
      <b>{report.evidence.status}</b> · {report.evidence.reason}
    </div>
    <div className="text-[11px] text-slate-400">Leakage rejected: <b className="text-white">{report.leakageRejectedGames}</b> · Insufficient-history games: <b className="text-white">{report.insufficientHistoryGames}</b> · MC trials/game: <b className="text-white">{report.monteCarloTrialsPerGame.toLocaleString()}</b> · Trials count as evidence: <b className="text-emerald-300">NO</b></div>
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-[11px] text-slate-400"><b className="text-slate-300">Historical market EV:</b> {report.historicalMarketBacktest.status}. {report.historicalMarketBacktest.reason}</div>
  </div>
);

const WnbaSimulationCard: React.FC<{ sim: WnbaSimulation; backtest: WnbaBacktestReport | null }> = ({ sim, backtest }) => (
  <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/10 p-5 sm:p-6 space-y-4">
    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
      <div><span className="rounded bg-cyan-500/15 border border-cyan-500/30 px-2 py-1 text-[10px] font-bold text-cyan-300">WNBA 25,000x SCENARIO MODEL</span><h3 className="mt-2 text-xl font-extrabold text-white">{sim.matchup}</h3><p className="text-xs text-slate-400 mt-1">{sim.reliabilityTier} historical team data · deterministic seed {sim.seed}</p></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 min-w-full lg:min-w-[520px]"><Metric label="Analytic Home" value={fmtPct(sim.analyticHomeWinProbability)} /><Metric label="MC Home" value={fmtPct(sim.simulatedHomeWinProbability)} /><Metric label="Proj Total" value={sim.expectedTotal.toFixed(1)} /><Metric label="Proj Margin" value={fmtSigned(sim.expectedMargin, '')} /></div>
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2"><Metric label="Projected Score" value={`${sim.expectedAwayScore.toFixed(1)} - ${sim.expectedHomeScore.toFixed(1)}`} compact /><Metric label="MC Mean Score" value={`${sim.simulatedMeanAwayScore.toFixed(1)} - ${sim.simulatedMeanHomeScore.toFixed(1)}`} compact /><Metric label="Total P10-P90" value={`${sim.simulatedP10Total.toFixed(1)} – ${sim.simulatedP90Total.toFixed(1)}`} compact /><Metric label="Margin P10-P90" value={`${sim.simulatedP10Margin.toFixed(1)} – ${sim.simulatedP90Margin.toFixed(1)}`} compact /></div>
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">{sim.note}{backtest ? ` Historical backtest currently contributes ${backtest.evidence.independentDecisiveObservations} real-game observations to WNBA moneyline calibration.` : ' Run the historical backtest to establish real-game calibration evidence.'}</div>
  </div>
);

const MlbTopCard: React.FC<{ top: SimRow }> = ({ top }) => (
  <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/20 p-5 sm:p-6"><div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5"><div className="space-y-2"><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-emerald-500/20 px-2 py-1 text-[10px] font-black tracking-wider text-emerald-300">TOP QUALIFIED PICK</span>{top.simulationSupportsProduction === true && <span className="rounded bg-cyan-500/15 border border-cyan-500/30 px-2 py-1 text-[10px] font-bold text-cyan-300">SIM SUPPORTS</span>}</div><h3 className="text-2xl font-extrabold text-white">{top.playerName} {top.productionSide} {top.line} Ks</h3><p className="text-sm text-slate-300">{top.team} vs {top.opponent} · {top.sportsbook} {fmtOdds(top.oddsAmerican)}</p></div><div className="grid grid-cols-2 sm:grid-cols-4 gap-2 min-w-full lg:min-w-[520px]"><Metric label="Production Prob" value={fmtPct(top.productionProbability)} /><Metric label="Simulation Prob" value={fmtPct(top.productionSide === 'OVER' ? top.overProbability : top.underProbability)} /><Metric label="EV" value={fmtSigned(top.productionEVPercent)} /><Metric label="Edge" value={fmtSigned(top.productionEdgePp, ' pp')} /></div></div></div>
);

const MlbRows: React.FC<{ rows: SimRow[] }> = ({ rows }) => <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="text-sm font-bold text-white flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-400" /> Ranked Simulation Results</h3><span className="text-[10px] font-mono text-slate-500">10,000 trials per line · deterministic seed</span></div><div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{rows.map(row => { const simSideProb = row.productionSide === 'OVER' ? row.overProbability : row.productionSide === 'UNDER' ? row.underProbability : null; return <div key={`${row.playerName}-${row.line}-${row.sportsbook}`} className={`rounded-xl border p-4 ${row.productionDecision === 'QUALIFIES' ? 'border-emerald-500/30 bg-emerald-950/10' : 'border-slate-800 bg-[#0d1322]'}`}><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-bold text-white">{row.playerName}</div><div className="text-xs text-slate-400">{row.team} vs {row.opponent}</div></div><span className={`rounded px-2 py-1 text-[10px] font-black ${row.productionDecision === 'QUALIFIES' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{row.productionDecision === 'QUALIFIES' ? 'BET CANDIDATE' : 'PASS'}</span></div><div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2"><Metric label="Production" value={row.productionSide ? `${row.productionSide} ${row.line}` : 'NO BET'} compact /><Metric label="Model Prob" value={fmtPct(row.productionProbability)} compact /><Metric label="Sim Prob" value={fmtPct(simSideProb)} compact /><Metric label="EV" value={fmtSigned(row.productionEVPercent)} compact /></div></div>; })}</div></div>;

const Metric: React.FC<{ label: string; value: string; compact?: boolean }> = ({ label, value, compact }) => <div className={`rounded-lg border border-slate-800 bg-slate-950/70 ${compact ? 'p-2' : 'p-3'}`}><div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</div><div className={`${compact ? 'text-sm' : 'text-lg'} font-extrabold font-mono text-white mt-0.5`}>{value}</div></div>;
