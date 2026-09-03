import React, { useEffect, useState } from 'react';
import {
  NormalizedApexGame,
  EventMarketsResponse,
  NormalizedApexEventMarkets,
} from '../types';
import {
  X,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Database,
  Building2,
  Lock,
  Layers,
  KeyRound,
  RefreshCw,
} from 'lucide-react';

interface MarketDetailModalProps {
  game: NormalizedApexGame | null;
  isOpen: boolean;
  onClose: () => void;
}

export const MarketDetailModal: React.FC<MarketDetailModalProps> = ({
  game,
  isOpen,
  onClose,
}) => {
  const [response, setResponse] = useState<EventMarketsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMarkets = async (targetGame: NormalizedApexGame) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/markets/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: targetGame }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `Server returned HTTP ${res.status}`);
      }

      const data: EventMarketsResponse = await res.json();
      setResponse(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load market data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && game) {
      fetchMarkets(game);
    } else {
      setResponse(null);
      setError(null);
    }
  }, [isOpen, game?.eventId]);

  if (!isOpen || !game) return null;

  const isTennis = game.sport === 'TENNIS';
  const matchupTitle = isTennis
    ? `${game.playerAName} vs ${game.playerBName}`
    : `${game.awayTeam} @ ${game.homeTeam}`;

  const formatOdds = (val?: number) => {
    if (val === undefined || val === null) return '—';
    return val > 0 ? `+${val}` : `${val}`;
  };

  return (
    <div
      id="market-detail-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        id="market-detail-modal-container"
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-800 bg-[#090d16] text-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-[#0d1322] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80">
              <Building2 className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-300">
                  {game.sport}
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  {game.league || game.tournamentName || 'Sportsbook Markets'}
                </span>
                {game.status === 'UPCOMING' && (
                  <span className="rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 px-1.5 py-0.2 text-[10px] font-mono font-bold">
                    PREGAME ELIGIBLE
                  </span>
                )}
              </div>
              <h2 className="text-base font-bold text-white tracking-tight mt-0.5">
                {matchupTitle}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="market-detail-refresh-btn"
              type="button"
              onClick={() => fetchMarkets(game)}
              disabled={loading}
              className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-white hover:border-slate-700 transition-all disabled:opacity-50"
              title="Refresh Markets"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              id="market-detail-close-btn"
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-white hover:border-slate-700 transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-400 border-t-transparent"></div>
              <p className="text-xs font-mono text-slate-400">
                Checking server cache & verifying identity against keyed market provider...
              </p>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 p-4 text-xs text-rose-300 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
              <div>
                <p className="font-bold">Market Query Error</p>
                <p className="mt-1 text-slate-300">{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && response && (
            <>
              {/* Status: NOT_CONFIGURED */}
              {response.status === 'NOT_CONFIGURED' && (
                <div
                  id="market-status-not-configured"
                  className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 space-y-3"
                >
                  <div className="flex items-center gap-2.5 text-amber-300">
                    <KeyRound className="h-5 w-5 shrink-0" />
                    <h3 className="text-sm font-bold uppercase tracking-wider font-mono">
                      MARKET PROVIDER NOT CONFIGURED
                    </h3>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Live sportsbook markets require the <code className="font-mono text-amber-300">ODDS_API_KEY</code> secret.
                    Apex schedule and live-score feeds will continue functioning normally.
                  </p>
                  <div className="rounded-lg border border-amber-500/20 bg-black/40 p-3 text-[11px] font-mono text-slate-400">
                    To enable live sportsbook lines, configure <span className="text-amber-300 font-bold">ODDS_API_KEY</span> via the Google AI Studio Settings / Secrets panel.
                  </div>
                </div>
              )}

              {/* Status: NOT_ELIGIBLE */}
              {response.status === 'NOT_ELIGIBLE' && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-center space-y-2">
                  <Lock className="h-6 w-6 text-slate-400 mx-auto" />
                  <h3 className="text-sm font-bold text-white">Event Not Eligible for Pregame Markets</h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    {response.message || 'Keyed market requests are restricted strictly to verified UPCOMING fixtures.'}
                  </p>
                </div>
              )}

              {/* Status: NO_MARKETS */}
              {response.status === 'NO_MARKETS' && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-center space-y-2">
                  <AlertTriangle className="h-6 w-6 text-amber-400 mx-auto" />
                  <h3 className="text-sm font-bold text-white">No Sportsbook Markets Available</h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    {response.message || 'No sportsbooks are currently offering verified lines for this fixture.'}
                  </p>
                </div>
              )}

              {/* Status: QUOTA_EXCEEDED */}
              {response.status === 'QUOTA_EXCEEDED' && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 p-5 space-y-3">
                  <div className="flex items-center gap-2 text-rose-300 font-bold font-mono">
                    <ShieldCheck className="h-5 w-5 text-rose-400" />
                    <span>KEYED PROVIDER DISABLED — QUOTA GUARD</span>
                  </div>
                  <p className="text-xs text-slate-300">{response.message}</p>
                </div>
              )}

              {/* Status: SUCCESS with Real Bookmakers */}
              {response.status === 'SUCCESS' && response.markets && (
                <div className="space-y-4">
                  {/* Meta Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#0d1322] px-4 py-2.5 text-xs font-mono text-slate-400">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>Source: {response.markets.source}</span>
                      </span>
                      <span>&bull;</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 font-bold">
                        Cache: {response.markets.cacheStatus}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-slate-400">
                      <Clock className="h-3 w-3" />
                      <span>Retrieved: {new Date(response.markets.retrievedAt).toLocaleTimeString()}</span>
                    </div>
                  </div>

                  {/* Bookmakers List */}
                  {response.markets.bookmakers.length === 0 ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-center text-xs text-slate-400">
                      Zero bookmakers listing open lines for this event at this time.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {response.markets.bookmakers.map((bm) => {
                        const h2h = bm.markets.find((m) => m.key === 'h2h');
                        const spreads = bm.markets.find((m) => m.key === 'spreads');
                        const totals = bm.markets.find((m) => m.key === 'totals');

                        return (
                          <div
                            key={bm.key}
                            className="rounded-xl border border-slate-800 bg-[#0d1322] p-4 space-y-3"
                          >
                            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-white uppercase tracking-wide">
                                  {bm.title}
                                </span>
                              </div>
                              <span className="text-[10px] font-mono text-slate-400">
                                Updated: {new Date(bm.lastUpdate).toLocaleTimeString()}
                              </span>
                            </div>

                            {/* Markets Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                              {/* Moneyline / Match Winner */}
                              <div className="rounded-lg border border-slate-800/80 bg-[#090d16] p-2.5 space-y-1.5">
                                <div className="text-[10px] font-mono font-bold uppercase text-slate-400">
                                  {isTennis ? 'Match Winner (H2H)' : 'Moneyline'}
                                </div>
                                {h2h && h2h.outcomes.length > 0 ? (
                                  <div className="space-y-1">
                                    {h2h.outcomes.map((o, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-center justify-between text-xs font-mono"
                                      >
                                        <span className="text-slate-300 truncate max-w-[120px]">
                                          {o.name}
                                        </span>
                                        <span className="font-bold text-emerald-400">
                                          {formatOdds(o.americanOdds)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-slate-400 italic">Not Offered</div>
                                )}
                              </div>

                              {/* Spread */}
                              <div className="rounded-lg border border-slate-800/80 bg-[#090d16] p-2.5 space-y-1.5">
                                <div className="text-[10px] font-mono font-bold uppercase text-slate-400">
                                  {isTennis ? 'Games Spread' : 'Spread'}
                                </div>
                                {spreads && spreads.outcomes.length > 0 ? (
                                  <div className="space-y-1">
                                    {spreads.outcomes.map((o, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-center justify-between text-xs font-mono"
                                      >
                                        <span className="text-slate-300 truncate max-w-[100px]">
                                          {o.name} {o.point !== null && `(${o.point > 0 ? `+${o.point}` : o.point})`}
                                        </span>
                                        <span className="font-bold text-emerald-400">
                                          {formatOdds(o.americanOdds)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-slate-400 italic">Not Offered</div>
                                )}
                              </div>

                              {/* Total */}
                              <div className="rounded-lg border border-slate-800/80 bg-[#090d16] p-2.5 space-y-1.5">
                                <div className="text-[10px] font-mono font-bold uppercase text-slate-400">
                                  {isTennis ? 'Total Games' : 'Total Points/Goals'}
                                </div>
                                {totals && totals.outcomes.length > 0 ? (
                                  <div className="space-y-1">
                                    {totals.outcomes.map((o, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-center justify-between text-xs font-mono"
                                      >
                                        <span className="text-slate-300">
                                          {o.name} {o.point !== null && o.point}
                                        </span>
                                        <span className="font-bold text-emerald-400">
                                          {formatOdds(o.americanOdds)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-slate-400 italic">Not Offered</div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-[#0d1322] px-6 py-3 text-xs text-slate-400 font-mono">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span>Cost Protection Active: 500 Daily Hard Limit</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
