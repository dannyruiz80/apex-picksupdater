import React, { useCallback, useState } from 'react';
import {
  ApexSportFilter,
  DecisionBoardPick,
  GameMarketBoardResponse,
  ScheduleResponse,
} from '../types';
import {
  Activity,
  Clock,
  DollarSign,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingUp,
} from 'lucide-react';

interface WinProbabilityViewProps {
  selectedSport: ApexSportFilter;
  setSelectedSport: (sport: ApexSportFilter) => void;
  selectedDate: string;
  scheduleData: ScheduleResponse | null;
  onGoToPicks: () => void;
}

const SPORTS: Array<{ id: ApexSportFilter; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'MLB', label: 'MLB' },
  { id: 'NFL', label: 'NFL' }, { id: 'NCAAF', label: 'NCAAF' },
  { id: 'NBA', label: 'NBA' },
  { id: 'WNBA', label: 'WNBA' },
  { id: 'NHL', label: 'NHL' },
  { id: 'SOCCER', label: 'Soccer' },
];

function odds(v: number) { return v > 0 ? `+${v}` : `${v}`; }
function pct(v: number | null) { return v === null ? '—' : `${(v * 100).toFixed(1)}%`; }

const PickCard: React.FC<{ title: string; pick: DecisionBoardPick | null }> = ({ title, pick }) => {
  const state = pick?.gameIntegrityStatus ?? null;
  const stateClass =
    state === 'QUALIFIED' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' :
    state === 'REVIEW' ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' :
    state === 'VERIFY' ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' :
    'border-slate-700 bg-slate-800/50 text-slate-300';
  const stateLabel =
    state === 'QUALIFIED' ? 'BET QUALIFIED' :
    state === 'REVIEW' ? 'REVIEW — NOT A BET' :
    state === 'VERIFY' ? 'VERIFY — NOT A BET' :
    state === 'PASS' ? 'PASS' : 'GAME MODEL';

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-black uppercase tracking-wider text-cyan-300">{title}</div>
        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-mono font-black ${stateClass}`}>{stateLabel}</span>
      </div>
      {pick ? (
        <div className="mt-3 space-y-2">
          <div className="text-base font-extrabold text-white">{pick.displayPick}</div>
          <div className="text-[11px] text-slate-400">{pick.eventTitle}</div>

          <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
            <div>
              <div className="text-[9px] text-slate-500">RAW MODEL</div>
              <div className="font-black text-white">{pct(pick.rawModelProbability ?? pick.apexProbability)}</div>
            </div>
            <div>
              <div className="text-[9px] text-slate-500">GUARDED P</div>
              <div className={`font-black ${state === 'QUALIFIED' ? 'text-emerald-300' : 'text-cyan-300'}`}>{pct(pick.guardedDecisionProbability ?? pick.apexProbability)}</div>
            </div>
            <div>
              <div className="text-[9px] text-slate-500">GUARDED EV</div>
              <div className={`font-black ${pick.expectedValuePercent >= 0 ? 'text-emerald-300' : 'text-slate-300'}`}>{pick.expectedValuePercent >= 0 ? '+' : ''}{pick.expectedValuePercent.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-[9px] text-slate-500">PRICE</div>
              <div className="font-black text-white">{odds(pick.oddsAmerican)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-black/20 p-2.5 text-[10px]">
            <div><span className="text-slate-500">Market consensus:</span> <span className="font-bold text-slate-300">{pct(pick.marketConsensusProbability ?? null)}</span></div>
            <div><span className="text-slate-500">Raw disagreement:</span> <span className="font-bold text-slate-300">{pick.modelMarketDisagreementPP == null ? '—' : `${pick.modelMarketDisagreementPP.toFixed(1)} pp`}</span></div>
            <div><span className="text-slate-500">Raw EV:</span> <span className="font-bold text-slate-300">{pick.rawExpectedValuePercent == null ? '—' : `${pick.rawExpectedValuePercent >= 0 ? '+' : ''}${pick.rawExpectedValuePercent.toFixed(1)}%`}</span></div>
            <div><span className="text-slate-500">Evidence:</span> <span className="font-bold text-slate-300">{pick.modelEvidenceObservations ?? 0} outcomes · {pick.gameCalibrationEvidenceTier ?? 'EARLY'}</span></div>
            <div><span className="text-slate-500">Calibration adjust:</span> <span className="font-bold text-slate-300">{pick.prospectiveCalibrationAdjustmentPP == null ? '—' : `${pick.prospectiveCalibrationAdjustmentPP >= 0 ? '+' : ''}${pick.prospectiveCalibrationAdjustmentPP.toFixed(1)} pp`}</span></div>
            <div><span className="text-slate-500">ECE / Brier:</span> <span className="font-bold text-slate-300">{pick.gameCalibrationEce == null ? '—' : `${(pick.gameCalibrationEce*100).toFixed(1)}%`} / {pick.gameCalibrationBrier == null ? '—' : pick.gameCalibrationBrier.toFixed(3)}</span></div>
          </div>

          <div className="text-[10px] text-slate-500">{pick.sportsbook} · {pick.reliabilityTier} · {pick.marketDepth ?? 0} books · {pick.gameEvTier ?? 'NORMAL'} EV tier</div>

          {pick.v2ContributionStatus && (
            <div className={`rounded-lg border px-2.5 py-2 text-[10px] ${
              pick.v2ContributionStatus === 'MATERIAL'
                ? 'border-purple-500/25 bg-purple-950/15 text-purple-300'
                : 'border-slate-700 bg-slate-900/60 text-slate-400'
            }`}>
              V2 context: {pick.v2ContributionStatus === 'MATERIAL'
                ? `${(pick.v2ContributionPP ?? 0) >= 0 ? '+' : ''}${(pick.v2ContributionPP ?? 0).toFixed(1)} pp adjustment`
                : pick.v2ContributionStatus === 'NO_MATERIAL_ADJUSTMENT'
                  ? 'NO MATERIAL ADJUSTMENT'
                  : 'UNAVAILABLE'}
            </div>
          )}

          {state !== 'QUALIFIED' && (pick.gameIntegrityReasons?.length ?? 0) > 0 && (
            <div className={`rounded-lg border px-2.5 py-2 text-[10px] ${state === 'VERIFY' ? 'border-rose-500/25 bg-rose-950/15 text-rose-200' : 'border-amber-500/25 bg-amber-950/15 text-amber-200'}`}>
              {pick.gameIntegrityReasons?.slice(0, 3).map((r, i) => <div key={i}>• {r.replaceAll('_', ' ')}</div>)}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-slate-800 bg-black/20 p-3 text-xs text-slate-400">
          No current {title.toLowerCase()} market candidate is available.
        </div>
      )}
    </div>
  );
};

export const WinProbabilityView: React.FC<WinProbabilityViewProps> = ({
  selectedSport,
  setSelectedSport,
  selectedDate,
  scheduleData,
  onGoToPicks,
}) => {
  const activeSport: ApexSportFilter = selectedSport === 'TENNIS' ? 'ALL' : selectedSport;
  const [report, setReport] = useState<GameMarketBoardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/game-market-board/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sport: activeSport, date: selectedDate, maxGames: 6 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Game-market scan returned HTTP ${res.status}`);
      setReport(data as GameMarketBoardResponse);
    } catch (err: any) {
      setError(err.message || 'Unable to scan game markets.');
    } finally {
      setLoading(false);
    }
  }, [activeSport, selectedDate]);

  const events = report?.events || [];

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <Gauge className="h-6 w-6 text-cyan-400" /> Win Probability & Game Markets
            </h2>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-mono font-black text-emerald-300">
              GAME MARKET INTEGRITY 1.12.1
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400 max-w-3xl">
            Dedicated moneyline, spread and total recommendations. Player props cannot crowd these categories out of this screen.
          </p>
        </div>
        <button onClick={onGoToPicks} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white">
          Back to All Picks
        </button>
      </div>

      <div className="rounded-2xl border border-cyan-500/25 bg-gradient-to-b from-cyan-950/15 to-[#0b111d] p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-cyan-300 text-xs font-black uppercase tracking-[0.15em]"><Target className="h-4 w-4" /> Game Market Decision Center</div>
            <div className="mt-1 text-lg font-extrabold text-white">See win probability even when the current price is a PASS.</div>
            <div className="mt-1 text-xs text-slate-400">Probability forecast and betting value are deliberately separated. Prospective calibration learning adjusts only the guarded decision layer after enough graded evidence exists.</div>
          </div>
          <button onClick={scan} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-black text-slate-950 hover:bg-cyan-300 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Scanning Game Markets…' : 'Scan ML / Spread / Totals'}
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SPORTS.map((s) => (
            <button key={s.id} onClick={() => setSelectedSport(s.id)} className={`rounded-md px-3 py-1.5 text-xs font-bold ${activeSport === s.id ? 'border border-cyan-500/40 bg-cyan-500/15 text-cyan-200' : 'border border-slate-800 bg-slate-900 text-slate-400'}`}>{s.label}</button>
          ))}
          <span className="ml-auto self-center text-[10px] font-mono text-slate-500">Slate: {selectedDate} · {scheduleData?.count ?? 0} schedule events loaded</span>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4 text-sm text-rose-200 flex gap-2"><Activity className="h-4 w-4 mt-0.5" />{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <PickCard title="Best Moneyline" pick={report?.topMoneylineCandidate ?? report?.topMoneyline ?? null} />
        <PickCard title="Best Spread" pick={report?.topSpreadCandidate ?? report?.topSpread ?? null} />
        <PickCard title="Best Total" pick={report?.topTotalCandidate ?? report?.topTotal ?? null} />
      </div>

      {!loading && report && report.status === 'NO_QUALIFIED_PICKS' && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-4 text-sm text-slate-300">
          <span className="font-black text-amber-200">NO GAME-MARKET BET CLEARED EVERY INTEGRITY GATE.</span> Forecasts remain visible below. REVIEW/VERIFY candidates are intentionally not promoted as bets.
        </div>
      )}

      {!report && !loading && (
        <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-6 text-center">
          <Gauge className="h-7 w-7 text-cyan-400 mx-auto" />
          <div className="mt-2 font-bold text-white">Game model is active — scan when you want current prices.</div>
          <div className="mt-1 text-xs text-slate-400">The scan is explicit so Apex does not waste Odds API credits in the background.</div>
        </div>
      )}

      {events.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between"><h3 className="font-extrabold text-white">Win Probability by Event</h3><span className="text-[10px] font-mono text-slate-500">{events.length} modeled</span></div>
          {events.map((ev) => (
            <div key={ev.eventId} className="rounded-xl border border-slate-800 bg-[#0d1322] p-4 sm:p-5">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap gap-2 items-center"><span className="text-[10px] font-mono font-black text-cyan-300">{ev.sport} · {ev.league}</span><span className="rounded border border-slate-700 px-1.5 py-0.5 text-[9px] font-mono text-slate-400">{ev.modelVersion}</span>{ev.shadowModelVersion && <span className="rounded border border-purple-500/25 bg-purple-500/10 px-1.5 py-0.5 text-[9px] font-mono text-purple-300">V2 SHADOW ACTIVE</span>}</div>
                  <div className="mt-1 text-base font-extrabold text-white">{ev.eventTitle}</div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500"><Clock className="h-3 w-3" />{new Date(ev.startTime).toLocaleString()} · {ev.reliabilityTier} · {ev.homeSampleCount}/{ev.awaySampleCount} games</div>
                </div>
                {ev.expectedHomeScore !== null && ev.expectedAwayScore !== null && <div className="text-right"><div className="text-[9px] text-slate-500">PROJECTED SCORE</div><div className="font-black text-white">{ev.awayTeam} {ev.expectedAwayScore.toFixed(1)} – {ev.homeTeam} {ev.expectedHomeScore.toFixed(1)}</div></div>}
              </div>

              {ev.modelStatus === 'AVAILABLE' ? (
                <>
                  <div className={`grid ${ev.drawProbability !== null ? 'grid-cols-3' : 'grid-cols-2'} gap-3 mt-4`}>
                    <div className="rounded-lg border border-slate-800 bg-black/20 p-3"><div className="text-[10px] text-slate-500">{ev.awayTeam} WIN</div><div className="text-xl font-black text-white">{pct(ev.awayWinProbability)}</div></div>
                    {ev.drawProbability !== null && <div className="rounded-lg border border-slate-800 bg-black/20 p-3"><div className="text-[10px] text-slate-500">DRAW</div><div className="text-xl font-black text-white">{pct(ev.drawProbability)}</div></div>}
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3"><div className="text-[10px] text-slate-500">{ev.homeTeam} WIN</div><div className="text-xl font-black text-emerald-300">{pct(ev.homeWinProbability)}</div></div>
                  </div>

                  {ev.shadowModelVersion && (
                    <div className="mt-3 rounded-lg border border-purple-500/20 bg-purple-950/10 p-3">
                      <div className="flex items-center gap-2 text-[10px] font-black text-purple-300"><TrendingUp className="h-3 w-3" /> V2 CONTEXT SHADOW — AUDIT ONLY</div>
                      <div className="mt-1 text-xs text-slate-300">Away {pct(ev.shadowAwayWinProbability)} · Home {pct(ev.shadowHomeWinProbability)}{ev.shadowExpectedHomeScore !== null && ev.shadowExpectedAwayScore !== null ? ` · shadow score ${ev.shadowExpectedAwayScore.toFixed(1)}–${ev.shadowExpectedHomeScore.toFixed(1)}` : ''}</div>
                      {ev.contextNotes.slice(0, 2).map((n, i) => <div key={i} className="mt-1 text-[10px] text-slate-500">• {n}</div>)}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {ev.qualifiedPicks.map((p) => (
                      <div key={`q-${p.selectionLabel}`} className="rounded-lg border border-emerald-500/25 bg-emerald-950/15 px-3 py-2 text-xs">
                        <span className="font-black text-emerald-300">BET {p.gameMarketType}:</span> <span className="font-bold text-white">{p.displayPick}</span> <span className="text-slate-400">{odds(p.oddsAmerican)} · guarded {pct(p.apexProbability)} · +{p.expectedValuePercent.toFixed(1)}% EV</span>
                      </div>
                    ))}
                    {ev.reviewPicks.slice(0, 4).map((p) => (
                      <div key={`r-${p.selectionLabel}`} className={`rounded-lg border px-3 py-2 text-xs ${p.gameIntegrityStatus === 'VERIFY' ? 'border-rose-500/25 bg-rose-950/15' : 'border-amber-500/25 bg-amber-950/15'}`}>
                        <span className={`font-black ${p.gameIntegrityStatus === 'VERIFY' ? 'text-rose-200' : 'text-amber-200'}`}>{p.gameIntegrityStatus} {p.gameMarketType}:</span> <span className="font-bold text-white">{p.displayPick}</span> <span className="text-slate-400"> raw {pct(p.rawModelProbability ?? null)} · guarded {pct(p.apexProbability)} · {p.expectedValuePercent >= 0 ? '+' : ''}{p.expectedValuePercent.toFixed(1)}% EV</span>
                      </div>
                    ))}
                    {!ev.qualifiedPicks.length && !ev.reviewPicks.length && <div className="text-xs text-slate-500"><ShieldCheck className="inline h-3.5 w-3.5 mr-1" />Forecast active; current game-market prices are PASS.</div>}
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-950/10 p-3 text-xs text-amber-200">{ev.modelReason || 'Insufficient verified team history for this event.'}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {report && <div className="border-t border-slate-800 pt-3 text-[10px] font-mono text-slate-500">Status: {report.status} · Games scanned: {report.gamesScanned} · Models available: {report.modelsAvailable} · Qualified game plays: {report.qualifiedCount} · Review/verify: {report.reviewCount}</div>}
    </div>
  );
};
