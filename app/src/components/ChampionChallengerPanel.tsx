import React, { useEffect, useState } from 'react';
import {
  ChampionChallengerCohortComparison,
  ChampionChallengerModelMetrics,
  ChampionChallengerReport,
} from '../types';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Database,
  History,
  Zap,
  CheckCircle2,
  RefreshCw,
  Scale,
  ShieldCheck,
  Target,
  TrendingUp,
  XCircle,
} from 'lucide-react';

function pct(value: number | null, digits = 1) {
  return value === null ? 'N/A' : `${(value * 100).toFixed(digits)}%`;
}

function num(value: number | null, digits = 4) {
  return value === null ? 'N/A' : value.toFixed(digits);
}

function deltaClass(value: number | null, lowerIsBetter: boolean) {
  if (value === null || Math.abs(value) < 1e-12) return 'text-slate-400';
  const good = lowerIsBetter ? value < 0 : value > 0;
  return good ? 'text-emerald-300' : 'text-rose-300';
}

const MetricCard: React.FC<{
  label: string;
  production: string;
  challenger: string;
  delta?: string;
  deltaTone?: string;
  note?: string;
}> = ({ label, production, challenger, delta, deltaTone = 'text-slate-400', note }) => (
  <div className="rounded-xl border border-slate-800 bg-[#070a10] p-4">
    <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{label}</div>
    <div className="mt-3 grid grid-cols-2 gap-3">
      <div>
        <div className="text-[10px] text-slate-500">Champion</div>
        <div className="font-mono text-base font-bold text-cyan-300">{production}</div>
      </div>
      <div>
        <div className="text-[10px] text-slate-500">V3 Challenger</div>
        <div className="font-mono text-base font-bold text-violet-300">{challenger}</div>
      </div>
    </div>
    {delta !== undefined && <div className={`mt-2 text-[11px] font-mono ${deltaTone}`}>Δ challenger − champion: {delta}</div>}
    {note && <div className="mt-2 text-[10px] leading-relaxed text-slate-500">{note}</div>}
  </div>
);

const ModelSummary: React.FC<{ metrics: ChampionChallengerModelMetrics }> = ({ metrics }) => (
  <div className={`rounded-2xl border p-5 ${metrics.modelLabel === 'PRODUCTION' ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-violet-500/30 bg-violet-500/5'}`}>
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className={`text-xs font-bold tracking-wider ${metrics.modelLabel === 'PRODUCTION' ? 'text-cyan-300' : 'text-violet-300'}`}>
          {metrics.modelLabel === 'PRODUCTION' ? 'CHAMPION — PRODUCTION' : 'CHALLENGER — SHADOW ONLY'}
        </div>
        <div className="mt-1 text-sm font-mono text-slate-300">{metrics.modelVersion}</div>
      </div>
      <div className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-center">
        <div className="text-[9px] uppercase tracking-wider text-slate-500">Scored</div>
        <div className="font-mono text-lg font-bold text-white">{metrics.observations}</div>
      </div>
    </div>
    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
      <div><div className="text-slate-500">Log Loss</div><div className="font-mono font-bold text-white">{num(metrics.logLoss)}</div></div>
      <div><div className="text-slate-500">Brier</div><div className="font-mono font-bold text-white">{num(metrics.brierScore)}</div></div>
      <div><div className="text-slate-500">ECE</div><div className="font-mono font-bold text-white">{pct(metrics.expectedCalibrationError)}</div></div>
      <div><div className="text-slate-500">Accuracy</div><div className="font-mono font-bold text-white">{pct(metrics.directionalAccuracy)}</div></div>
      <div><div className="text-slate-500">Hyp. Plays</div><div className="font-mono font-bold text-white">{metrics.hypotheticalQualifiedPlays}</div></div>
      <div><div className="text-slate-500">W-L-P</div><div className="font-mono font-bold text-white">{metrics.hypotheticalWins}-{metrics.hypotheticalLosses}-{metrics.hypotheticalPushes}</div></div>
      <div><div className="text-slate-500">ROI</div><div className="font-mono font-bold text-white">{metrics.roiPercent === null ? 'N/A' : `${metrics.roiPercent.toFixed(2)}%`}</div></div>
      <div><div className="text-slate-500">Observed CLV</div><div className="font-mono font-bold text-white">{metrics.averageObservedClvProbabilityPoints === null ? 'N/A' : `${metrics.averageObservedClvProbabilityPoints.toFixed(3)} pp`}</div></div>
    </div>
  </div>
);

const CohortTable: React.FC<{ cohorts: ChampionChallengerCohortComparison[] }> = ({ cohorts }) => (
  <div className="overflow-x-auto rounded-xl border border-slate-800">
    <table className="min-w-full text-xs">
      <thead className="bg-slate-900/90 text-slate-400">
        <tr>
          <th className="px-3 py-2.5 text-left">Cohort</th>
          <th className="px-3 py-2.5 text-left">Bucket</th>
          <th className="px-3 py-2.5 text-right">N</th>
          <th className="px-3 py-2.5 text-right">Prod LL</th>
          <th className="px-3 py-2.5 text-right">V3 LL</th>
          <th className="px-3 py-2.5 text-right">Δ LL</th>
          <th className="px-3 py-2.5 text-center">Result</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-800 bg-[#070a10]">
        {cohorts.map((c) => (
          <tr key={`${c.cohortType}-${c.cohort}`} className="text-slate-300">
            <td className="px-3 py-2.5 font-mono text-[10px] text-slate-500">{c.cohortType.replaceAll('_', ' ')}</td>
            <td className="px-3 py-2.5 font-semibold">{c.cohort}</td>
            <td className="px-3 py-2.5 text-right font-mono">{c.sampleSize}</td>
            <td className="px-3 py-2.5 text-right font-mono">{num(c.productionLogLoss)}</td>
            <td className="px-3 py-2.5 text-right font-mono">{num(c.challengerLogLoss)}</td>
            <td className={`px-3 py-2.5 text-right font-mono ${deltaClass(c.logLossDelta, true)}`}>{num(c.logLossDelta)}</td>
            <td className="px-3 py-2.5 text-center">
              {c.challengerBetter === null ? (
                <span className="text-slate-500">N/A</span>
              ) : c.challengerBetter ? (
                <span className="text-emerald-300 font-semibold">V3 better</span>
              ) : (
                <span className="text-amber-300 font-semibold">Champion better</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const ChampionChallengerPanel: React.FC = () => {
  const [report, setReport] = useState<ChampionChallengerReport | null>(null);
  const [verify, setVerify] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [v5Verifying, setV5Verifying] = useState(false);
  const [v5Verify, setV5Verify] = useState<any | null>(null);
  const [v5Action, setV5Action] = useState<any | null>(null);
  const [v5ActionLoading, setV5ActionLoading] = useState(false);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [replayStart, setReplayStart] = useState(weekAgo);
  const [replayEnd, setReplayEnd] = useState(yesterday);
  const [error, setError] = useState<string | null>(null);

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ml/mlb/pitcher-k/champion-challenger');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReport(await res.json());
    } catch (err: any) {
      setError(err.message || 'Failed to load champion/challenger report');
    } finally {
      setLoading(false);
    }
  };

  const runVerify = async () => {
    setVerifying(true);
    try {
      const res = await fetch('/api/ml/mlb/pitcher-k/champion-challenger/verify');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setVerify(await res.json());
    } catch (err: any) {
      setVerify({ allPassed: false, error: err.message });
    } finally {
      setVerifying(false);
    }
  };

  const runV5Verify = async () => {
    setV5Verifying(true);
    try {
      const res = await fetch('/api/ml/mlb/pitcher-k/v5/verify');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setV5Verify(await res.json());
    } catch (err: any) {
      setV5Verify({ allPassed: false, error: err.message });
    } finally {
      setV5Verifying(false);
    }
  };

  const runV5Action = async (path: string, body: Record<string, unknown> = {}) => {
    setV5ActionLoading(true);
    setV5Action(null);
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.message || `HTTP ${res.status}`);
      setV5Action(payload);
      await loadReport();
    } catch (err: any) {
      setV5Action({ status: 'ERROR', message: err.message || 'V5 action failed' });
    } finally {
      setV5ActionLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, []);

  if (error) {
    return <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</div>;
  }

  if (!report) {
    return <div className="rounded-xl border border-slate-800 bg-[#090d16] p-6 text-sm text-slate-400">Loading model arena…</div>;
  }

  const statusTone = report.promotion.status === 'REVIEW_ELIGIBLE'
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
    : report.promotion.status === 'HOLD_PRODUCTION'
      ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
      : 'border-amber-500/40 bg-amber-500/10 text-amber-300';

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-[#090d16]/95 p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-violet-300">
              <Scale className="h-4 w-4" />
              APEX MODEL ARENA — PROSPECTIVE CHAMPION / CHALLENGER
            </div>
            <h2 className="mt-1 text-xl font-bold text-white">MLB Pitcher Strikeouts V3 Promotion Monitor</h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
              Scores one earliest point-in-time V3 observation per pitcher/line/event, preserves later price scans only for observed-close CLV, and never auto-promotes the challenger.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={loadReport} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={runVerify} disabled={verifying} className="flex items-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 px-3.5 py-2 text-xs font-semibold text-violet-300 disabled:opacity-50">
              <ShieldCheck className={`h-3.5 w-3.5 ${verifying ? 'animate-spin' : ''}`} /> Verify 0-Quota Suite
            </button>
          </div>
        </div>

        <div className={`mt-4 rounded-xl border px-4 py-3 ${statusTone}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {report.promotion.status === 'REVIEW_ELIGIBLE' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              <span className="font-bold text-xs tracking-wider">{report.promotion.status.replaceAll('_', ' ')}</span>
            </div>
            <span className="rounded border border-current/30 px-2 py-0.5 text-[10px] font-mono font-bold">AUTO PROMOTION: DISABLED</span>
          </div>
          <p className="mt-2 text-xs text-slate-300">{report.promotion.summary}</p>
        </div>

        {verify && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${verify.allPassed ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>
            Verification: {verify.allPassed ? `${verify.passedTests}/${verify.totalTests} PASS` : 'FAILED'} · Keyed requests consumed: {verify.keyedRequestsConsumed ?? 'N/A'}
          </div>
        )}
      </div>

      {report.fastLearning && (
        <div className="rounded-2xl border border-violet-500/25 bg-[#090d16] p-5">
          <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-violet-300">
                <BrainCircuit className="h-4 w-4" /> V5 FAST LEARNING / EVIDENCE ENGINE
              </div>
              <h3 className="mt-1 text-lg font-bold text-white">Learn faster without inflating the sample</h3>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
                Exact-count scoring, clustered multi-line evidence, paired champion-vs-challenger statistics, official MLB point-in-time replay, and all-starter shadow forecasts.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={runV5Verify} disabled={v5Verifying} className="flex items-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-300 disabled:opacity-50">
                <ShieldCheck className={`h-3.5 w-3.5 ${v5Verifying ? 'animate-spin' : ''}`} /> Verify V5
              </button>
              <button onClick={() => runV5Action('/api/ml/mlb/pitcher-k/v5/capture-starters')} disabled={v5ActionLoading} className="flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300 disabled:opacity-50">
                <Zap className="h-3.5 w-3.5" /> Capture Today&apos;s Starters
              </button>
              <button onClick={() => runV5Action('/api/ml/mlb/pitcher-k/v5/grade-starters')} disabled={v5ActionLoading} className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 disabled:opacity-50">
                <Database className="h-3.5 w-3.5" /> Grade Completed
              </button>
            </div>
          </div>

          <div className="mt-4 grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><div className="text-[10px] uppercase text-slate-500">Independent starts</div><div className="mt-1 font-mono text-xl font-bold text-white">{report.fastLearning.prospective.independentStarts}</div><div className="text-[10px] text-slate-500">{report.fastLearning.prospective.evaluatedLineThresholds} legitimate line thresholds scored</div></div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><div className="text-[10px] uppercase text-slate-500">P(V3 better)</div><div className="mt-1 font-mono text-xl font-bold text-violet-300">{pct(report.fastLearning.prospective.paired.probabilityChallengerBetter)}</div><div className="text-[10px] text-slate-500">{report.fastLearning.prospective.paired.evidenceTier.replaceAll('_', ' ')}</div></div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><div className="text-[10px] uppercase text-slate-500">Count NLL / CRPS</div><div className="mt-1 font-mono text-sm font-bold text-white">{num(report.fastLearning.prospective.challengerCountScore.meanNegativeLogLikelihood)} / {num(report.fastLearning.prospective.challengerCountScore.meanCrps)}</div><div className="text-[10px] text-slate-500">Exact final-K distribution scoring</div></div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><div className="text-[10px] uppercase text-slate-500">Total count-scored</div><div className="mt-1 font-mono text-xl font-bold text-emerald-300">{report.fastLearning.learningSample.totalCountScoredStarts}</div><div className="text-[10px] text-slate-500">Prospective + starters + PIT replay</div></div>
          </div>

          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-300">
            {report.fastLearning.prospective.paired.interpretation}
            {report.fastLearning.prospective.paired.logLossDeltaCi95Low !== null && report.fastLearning.prospective.paired.logLossDeltaCi95High !== null && (
              <span className="ml-2 font-mono text-slate-500">95% CI ΔLL [{report.fastLearning.prospective.paired.logLossDeltaCi95Low.toFixed(4)}, {report.fastLearning.prospective.paired.logLossDeltaCi95High.toFixed(4)}]</span>
            )}
          </div>

          <div className="mt-4 grid lg:grid-cols-2 gap-3">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300"><Zap className="h-3.5 w-3.5" /> ALL-STARTER SHADOW</div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div><div className="font-mono text-lg font-bold text-white">{report.fastLearning.allStarterShadow.totalForecasts}</div><div className="text-[9px] text-slate-500">Captured</div></div><div><div className="font-mono text-lg font-bold text-white">{report.fastLearning.allStarterShadow.gradedForecasts}</div><div className="text-[9px] text-slate-500">Graded</div></div><div><div className="font-mono text-lg font-bold text-white">{report.fastLearning.allStarterShadow.pendingForecasts}</div><div className="text-[9px] text-slate-500">Pending</div></div></div>
              <div className="mt-2 text-[10px] text-slate-500">Uses confirmed MLB probable starters even when no bet qualifies. No sportsbook price is invented.</div>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300"><History className="h-3.5 w-3.5" /> HISTORICAL PIT REPLAY</div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="text-[10px] text-slate-500">Start<input type="date" value={replayStart} onChange={(e) => setReplayStart(e.target.value)} className="mt-1 block rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300" /></label>
                <label className="text-[10px] text-slate-500">End<input type="date" value={replayEnd} onChange={(e) => setReplayEnd(e.target.value)} className="mt-1 block rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300" /></label>
                <button onClick={() => runV5Action('/api/ml/mlb/pitcher-k/v5/historical-replay', { startDate: replayStart, endDate: replayEnd })} disabled={v5ActionLoading} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 disabled:opacity-50">Run Replay</button>
              </div>
              <div className="mt-2 text-[10px] text-slate-500">Stored: {report.fastLearning.historicalReplay.totalRows} · PIT valid: {report.fastLearning.historicalReplay.pointInTimeValidRows}. Research only; cannot satisfy live promotion gates.</div>
            </div>
          </div>

          {v5Verify && <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${v5Verify.allPassed ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>V5 verification: {v5Verify.allPassed ? `${v5Verify.passedTests}/${v5Verify.totalTests} PASS` : 'FAILED'} · Keyed requests consumed: {v5Verify.keyedRequestsConsumed ?? 'N/A'}</div>}
          {v5Action && <div className={`mt-3 rounded-lg border px-3 py-2 text-[11px] ${v5Action.status === 'ERROR' ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-slate-700 bg-slate-950/50 text-slate-300'}`}><pre className="whitespace-pre-wrap font-mono">{JSON.stringify(v5Action, null, 2)}</pre></div>}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <ModelSummary metrics={report.production} />
        <ModelSummary metrics={report.challenger} />
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <MetricCard label="Log Loss" production={num(report.production.logLoss)} challenger={num(report.challenger.logLoss)} delta={num(report.deltas.logLoss)} deltaTone={deltaClass(report.deltas.logLoss, true)} note="Lower is better. Primary proper probability score." />
        <MetricCard label="Brier Score" production={num(report.production.brierScore)} challenger={num(report.challenger.brierScore)} delta={num(report.deltas.brierScore)} deltaTone={deltaClass(report.deltas.brierScore, true)} note="Lower is better. Penalizes probability error." />
        <MetricCard label="Calibration Gap" production={pct(report.production.calibrationGap)} challenger={pct(report.challenger.calibrationGap)} delta={pct(report.deltas.calibrationGap)} deltaTone={deltaClass(report.deltas.calibrationGap, true)} note="Absolute predicted-vs-observed Over-rate gap." />
        <MetricCard label="Directional Accuracy" production={pct(report.production.directionalAccuracy)} challenger={pct(report.challenger.directionalAccuracy)} delta={pct(report.deltas.directionalAccuracy)} deltaTone={deltaClass(report.deltas.directionalAccuracy, false)} />
        <MetricCard label="Flat-Stake ROI" production={report.production.roiPercent === null ? 'N/A' : `${report.production.roiPercent.toFixed(2)}%`} challenger={report.challenger.roiPercent === null ? 'N/A' : `${report.challenger.roiPercent.toFixed(2)}%`} delta={report.deltas.roiPercent === null ? 'N/A' : `${report.deltas.roiPercent.toFixed(2)} pp`} deltaTone={deltaClass(report.deltas.roiPercent, false)} note="Diagnostic only. Same edge/EV/reliability thresholds applied to both models." />
        <MetricCard label="Observed-close CLV" production={report.production.averageObservedClvProbabilityPoints === null ? 'N/A' : `${report.production.averageObservedClvProbabilityPoints.toFixed(3)} pp`} challenger={report.challenger.averageObservedClvProbabilityPoints === null ? 'N/A' : `${report.challenger.averageObservedClvProbabilityPoints.toFixed(3)} pp`} delta={report.deltas.observedClvProbabilityPoints === null ? 'N/A' : `${report.deltas.observedClvProbabilityPoints.toFixed(3)} pp`} deltaTone={deltaClass(report.deltas.observedClvProbabilityPoints, false)} note="Latest recorded pregame price is a close proxy, not a guaranteed true sportsbook closing print." />
      </div>

      <div className="rounded-2xl border border-slate-800 bg-[#090d16] p-5">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-emerald-400" />
          <h3 className="font-bold text-white">Promotion Evidence Gates</h3>
        </div>
        <div className="mt-4 grid md:grid-cols-2 gap-3">
          {report.promotion.gates.map((g) => (
            <div key={g.gate} className={`rounded-xl border p-3 ${g.passed ? 'border-emerald-500/20 bg-emerald-500/5' : g.blocking ? 'border-rose-500/20 bg-rose-500/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
              <div className="flex items-start gap-2">
                {g.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400 shrink-0" /> : g.blocking ? <XCircle className="mt-0.5 h-4 w-4 text-rose-400 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" />}
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-200">{g.gate}</div>
                  <div className="mt-1 font-mono text-[10px] text-slate-400">Actual: {g.actual}</div>
                  <div className="font-mono text-[10px] text-slate-500">Required: {g.required}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-[#090d16] p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-4 w-4 text-cyan-400" />
          <h3 className="font-bold text-white">Cohort Stability</h3>
        </div>
        {report.cohorts.length ? <CohortTable cohorts={report.cohorts} /> : <div className="text-xs text-slate-500">No mature V3 cohorts recorded yet.</div>}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-[#090d16] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-violet-400" />
          <h3 className="font-bold text-white">Recent Prospective Observations</h3>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-900/90 text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Pitcher</th>
                <th className="px-3 py-2 text-left">Line</th>
                <th className="px-3 py-2 text-left">Actual</th>
                <th className="px-3 py-2 text-right">Champion P(O)</th>
                <th className="px-3 py-2 text-right">V3 P(O)</th>
                <th className="px-3 py-2 text-left">Champion Play</th>
                <th className="px-3 py-2 text-left">V3 Play</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-[#070a10]">
              {report.recentObservations.map((r) => (
                <tr key={r.snapshotId}>
                  <td className="px-3 py-2.5 text-slate-200"><div className="font-semibold">{r.playerName}</div><div className="text-[10px] text-slate-500">vs {r.opponent}</div></td>
                  <td className="px-3 py-2.5 font-mono text-slate-300">{r.line}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-300">{r.actualStatistic} <span className="text-slate-500">({r.outcome})</span></td>
                  <td className="px-3 py-2.5 text-right font-mono text-cyan-300">{pct(r.productionOverProbability)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-violet-300">{pct(r.challengerOverProbability)}</td>
                  <td className="px-3 py-2.5 text-slate-300">{r.productionQualifiedSide ?? 'PASS'}</td>
                  <td className="px-3 py-2.5 text-slate-300">{r.challengerQualifiedSide ?? 'PASS'}</td>
                </tr>
              ))}
              {!report.recentObservations.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No graded V3 prospective observations yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Methodology notes</div>
        <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-slate-400 list-disc pl-5">
          {report.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      </div>
    </div>
  );
};
