import React from 'react';
import { NavTabId } from '../types';
import { NAVIGATION_ITEMS, getNavIcon } from '../navigation';
import { ShieldAlert, Server, Code2, Layers, AlertCircle, CheckCircle2 } from 'lucide-react';

interface ModulePlaceholderProps {
  tabId: NavTabId;
  onGoToOverview: () => void;
}

export const ModulePlaceholder: React.FC<ModulePlaceholderProps> = ({
  tabId,
  onGoToOverview,
}) => {
  const item = NAVIGATION_ITEMS.find((n) => n.id === tabId);
  if (!item) return null;

  const Icon = getNavIcon(tabId);

  const getModuleTechnicalDetails = (id: NavTabId) => {
    switch (id) {
      case 'picks':
        return {
          pipeline: 'Spread & Moneyline Model Pipeline',
          contract: 'Awaiting verified sports odds feed & consensus line integration',
          status: 'Pipeline Scaffolded',
          specs: [
            'No fabricated picks or fake consensus data active',
            'Model weights pending live data provider connection',
            'Strict server-side secret management configured',
          ],
        };
      case 'live':
        return {
          pipeline: 'Real-Time In-Game Market Stream',
          contract: 'Awaiting verified WebSocket/SSE live scoreboard connection',
          status: 'Stream Scaffolded',
          specs: [
            'No simulated game clocks or mock scores',
            'Latency-critical in-play event buffer ready',
            'Zero hallucinated win probabilities',
          ],
        };
      case 'props':
        return {
          pipeline: 'Player Proposition Analytics Engine',
          contract: 'Awaiting verified player stat lines and injury report feeds',
          status: 'Props Scaffolded',
          specs: [
            'No synthetic player props or simulated lines',
            'Distribution curves reserved for verified box scores',
            'Direct schema ready for sports data provider payload',
          ],
        };
      case 'parlays':
        return {
          pipeline: 'Correlation Matrix & EV Optimizer',
          contract: 'Awaiting multi-market correlation matrices and real book lines',
          status: 'Matrix Scaffolded',
          specs: [
            'Zero simulated parlay combinations',
            'Mathematical devig algorithm scaffolded',
            'True odds calculated strictly from verified inputs',
          ],
        };
      case 'sims':
        return {
          pipeline: 'Monte Carlo 10,000x Simulation Core',
          contract: 'Awaiting verified team ratings, pace models & roster datasets',
          status: 'Sim Engine Scaffolded',
          specs: [
            'No pseudo-random generated scoreboards',
            'Server-side vector execution pipeline defined',
            'Distribution tail analytics awaiting production baseline',
          ],
        };
      case 'ai-learn':
        return {
          pipeline: 'Quantitative Sports Betting Intelligence Academy',
          contract: 'Educational repository, mathematical proof sets, and backtesting concepts',
          status: 'Curriculum Scaffolded',
          specs: [
            'No ungrounded AI text generation or fake articles',
            'Statistical modeling theory: Poisson, Elo, Monte Carlo',
            'Server-side Gemini interface ready for strictly verified prompts',
          ],
        };
      case 'my-bets':
        return {
          pipeline: 'Verified Betting Ledger & CLV Tracking',
          contract: 'User bankroll state, closing line value delta, and ROI analytics',
          status: 'Ledger Scaffolded',
          specs: [
            'No fabricated bet slips or phantom profit graphs',
            'Cloud/Local storage contracts prepared',
            'Audit-ready record schema compliant with accounting standards',
          ],
        };
      case 'audit':
        return {
          pipeline: 'Model Transparency & Verification Audit Log',
          contract: 'Historical pick verification, timestamped hashes, and Brier scores',
          status: 'Audit Engine Scaffolded',
          specs: [
            'Zero retroactive pick alteration architecture',
            'Immutable model prediction timestamps',
            'Calibrated loss function benchmarks ready for live data',
          ],
        };
      case 'tools':
        return {
          pipeline: 'Sports Analytics Calculators & Utilities',
          contract: 'Kelly Criterion, Poisson dist, vig remover, and half-point calculators',
          status: 'Utility Scaffolded',
          specs: [
            'Pure mathematical formulas with no fabricated external state',
            'Interactive odds converter & devigger ready for baseline testing',
            'Sub-millisecond client calculation execution',
          ],
        };
      default:
        return {
          pipeline: 'Generic Module Framework',
          contract: 'Scaffolded and waiting for production data pipelines',
          status: 'Scaffolded',
          specs: ['No fake data active', 'Server-ready architecture'],
        };
    }
  };

  const details = getModuleTechnicalDetails(tabId);

  return (
    <div id={`module-view-${tabId}`} className="space-y-6 animate-in fade-in">
      {/* Module Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                {item.label} Module
              </h2>
              <span className="rounded border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-xs font-mono text-slate-400">
                {details.status}
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-0.5">{item.description}</p>
          </div>
        </div>

        <button
          id={`back-to-overview-btn-${tabId}`}
          type="button"
          onClick={onGoToOverview}
          className="self-start sm:self-auto rounded-lg border border-slate-800 bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:bg-slate-800 hover:text-white transition-colors"
        >
          Return to Overview
        </button>
      </div>

      {/* Main Disciplined Placeholder Card */}
      <div className="rounded-2xl border border-slate-800/90 bg-[#0d1322] p-6 sm:p-8 space-y-6">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/80 text-emerald-400">
            <Layers className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-white">
              {details.pipeline}
            </h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              {details.contract}
            </p>
          </div>
        </div>

        {/* Technical Specification Checklist */}
        <div className="rounded-xl border border-slate-800 bg-[#090d16]/80 p-4 space-y-2.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Baseline Architecture & Integrity Guardrails
          </div>
          <ul className="space-y-2">
            {details.specs.map((spec, i) => (
              <li key={i} className="flex items-center gap-2.5 text-xs text-slate-300">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>{spec}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* UNKNOWN IS BETTER THAN WRONG Notice */}
        <div className="flex items-start gap-3 rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 text-xs">
          <ShieldAlert className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-slate-300">
              Strict Rule: UNKNOWN IS BETTER THAN WRONG
            </span>
            <p className="text-slate-400 leading-relaxed">
              In accordance with baseline safety requirements, zero mock or placeholder sports data, scores, or odds are fabricated. Full pipeline ingestion will activate once real, authorized server-side data providers and keys are provisioned.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
