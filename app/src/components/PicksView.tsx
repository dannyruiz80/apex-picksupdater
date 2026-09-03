import React, { useState, useEffect, useCallback } from 'react';
import { ApexSportFilter, NormalizedApexGame, ScheduleResponse, TennisTourFilter, DecisionBoardResponse } from '../types';
import { MarketDetailModal } from './MarketDetailModal';
import { DecisionBoardPanel } from './DecisionBoardPanel';
import {
  Calendar,
  RefreshCw,
  MapPin,
  Clock,
  ShieldCheck,
  TrendingUp,
  Activity,
  Layers,
  Award,
  Trophy,
  User,
  DollarSign,
  Target,
  Sparkles,
} from 'lucide-react';

interface PicksViewProps {
  selectedSport: ApexSportFilter;
  setSelectedSport: (sport: ApexSportFilter) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  scheduleData: ScheduleResponse | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  onRefresh: () => void;
  onSelectGame?: (game: NormalizedApexGame) => void;
}

const SPORT_FILTERS: Array<{ id: ApexSportFilter; label: string; badge?: string }> = [
  { id: 'ALL', label: 'All Sports' },
  { id: 'MLB', label: 'MLB' },
  { id: 'NFL', label: 'NFL' },
  { id: 'NBA', label: 'NBA' },
  { id: 'WNBA', label: 'WNBA' },
  { id: 'NHL', label: 'NHL' },
  { id: 'SOCCER', label: 'Soccer' },
  { id: 'TENNIS', label: 'Tennis' },
];

export const PicksView: React.FC<PicksViewProps> = ({
  selectedSport,
  setSelectedSport,
  selectedDate,
  setSelectedDate,
  scheduleData,
  isLoading,
  isError,
  errorMessage,
  onRefresh,
  onSelectGame,
}) => {
  const [tennisTourFilter, setTennisTourFilter] = useState<TennisTourFilter>('ALL');
  const [selectedGameForMarkets, setSelectedGameForMarkets] = useState<NormalizedApexGame | null>(null);
  const [decisionBoard, setDecisionBoard] = useState<DecisionBoardResponse | null>(null);
  const [decisionBoardLoading, setDecisionBoardLoading] = useState(false);
  const [decisionBoardError, setDecisionBoardError] = useState<string | null>(null);

  const loadSavedDecisionBoard = useCallback(async () => {
    try {
      const res = await fetch(`/api/decision-board/saved?sport=${encodeURIComponent(selectedSport)}&date=${encodeURIComponent(selectedDate)}`);
      if (!res.ok) return;
      const data: DecisionBoardResponse = await res.json();
      setDecisionBoard(data);
    } catch {
      // Saved decision-board lookup is optional and zero-credit.
    }
  }, [selectedSport, selectedDate]);

  useEffect(() => {
    loadSavedDecisionBoard();
  }, [loadSavedDecisionBoard]);

  const scanDecisionBoard = useCallback(async () => {
    setDecisionBoardLoading(true);
    setDecisionBoardError(null);
    try {
      const res = await fetch('/api/decision-board/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sport: selectedSport, date: selectedDate, maxGames: 3 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Decision scan returned HTTP ${res.status}`);
      setDecisionBoard(data as DecisionBoardResponse);
    } catch (err: any) {
      setDecisionBoardError(err.message || 'Unable to scan the slate for qualified picks.');
    } finally {
      setDecisionBoardLoading(false);
    }
  }, [selectedSport, selectedDate]);

  const analyzeSingleGame = useCallback(async (game: NormalizedApexGame) => {
    setDecisionBoardLoading(true);
    setDecisionBoardError(null);
    try {
      const res = await fetch('/api/decision-board/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Event analysis returned HTTP ${res.status}`);
      setDecisionBoard(data as DecisionBoardResponse);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setDecisionBoardError(err.message || 'Unable to analyze this event.');
    } finally {
      setDecisionBoardLoading(false);
    }
  }, []);

  const rawGames = scheduleData?.games || [];

  // If viewing tennis, apply local tour sub-filter if needed
  const games = rawGames.filter((g) => {
    if (selectedSport === 'TENNIS' && tennisTourFilter !== 'ALL') {
      return g.tour === tennisTourFilter;
    }
    return true;
  });

  const formatStartTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    } catch {
      return isoString;
    }
  };

  const getTodayChicago = () => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  };

  const handleDatePreset = (preset: 'today' | 'yesterday' | 'tomorrow') => {
    const d = new Date();
    if (preset === 'yesterday') {
      d.setDate(d.getDate() - 1);
    } else if (preset === 'tomorrow') {
      d.setDate(d.getDate() + 1);
    }

    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    setSelectedDate(formatter.format(d));
  };

  const todayChicago = getTodayChicago();
  const isToday = selectedDate === todayChicago;
  const isHistorical = selectedDate < todayChicago;
  const isFuture = selectedDate > todayChicago;

  const getPeriodDisplay = (game: NormalizedApexGame) => {
    if (game.status !== 'LIVE' && game.status !== 'SUSPENDED') {
      return null;
    }

    if (game.sport === 'TENNIS') {
      if (game.currentSet) {
        return `Set ${game.currentSet}`;
      }
      return null;
    }

    if (game.sport === 'SOCCER') {
      if (game.matchClock) {
        return `Clock: ${game.matchClock}`;
      }
      if (game.period === 1) return '1st Half';
      if (game.period === 2) return '2nd Half';
      if (game.period === 3 || game.period === 4) return 'Extra Time';
      if (game.period === 5) return 'Penalties';
      return null;
    }

    if (game.sport === 'MLB') {
      if (game.inning !== null || game.inningState !== null) {
        return `${game.inningState ? `${game.inningState} ` : ''}${game.inning ? `${game.inning}th` : ''}`;
      }
      return null;
    }

    if (game.sport === 'NHL') {
      if (game.period !== null && game.period !== undefined) {
        const periodName = game.period === 4 ? 'OT' : game.period === 5 ? 'SO' : `P${game.period}`;
        return game.displayClock ? `${periodName} (${game.displayClock})` : periodName;
      }
      return null;
    }

    if (game.sport === 'NFL' || game.sport === 'NBA' || game.sport === 'WNBA') {
      if (game.period !== null && game.period !== undefined) {
        const qName = game.period > 4 ? `OT${game.period - 4 > 1 ? game.period - 4 : ''}` : `Q${game.period}`;
        return game.displayClock ? `${qName} (${game.displayClock})` : qName;
      }
      return null;
    }

    return null;
  };

  return (
    <div id="picks-module-container" className="space-y-6 animate-in fade-in">
      {/* Module Title & Sport Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-emerald-400" />
              <span>Picks & Decision Engine</span>
            </h2>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400 font-mono">
              STAGE 2C TENNIS ACTIVE
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Rank production-qualified opportunities first, then inspect the schedule and underlying market data
          </p>
        </div>

        {/* Sport Filters Bar */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-[#090d16] p-1">
          {SPORT_FILTERS.map((s) => {
            const isActive = selectedSport === s.id;
            return (
              <button
                key={s.id}
                id={`sport-filter-${s.id.toLowerCase()}`}
                type="button"
                onClick={() => setSelectedSport(s.id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                {isActive && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <DecisionBoardPanel
        board={decisionBoard}
        loading={decisionBoardLoading}
        error={decisionBoardError}
        onScan={scanDecisionBoard}
        onOpenPick={(eventId, pickType) => {
          const game = rawGames.find((g) => g.eventId === eventId);
          if (!game) return;
          if (pickType === 'GAME_MARKET') setSelectedGameForMarkets(game);
          else if (onSelectGame) onSelectGame(game);
        }}
        scanLabel="Find Best Picks"
      />

      {/* Date Control Toolbar & Tennis Tour Sub-Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#0d1322] p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900 px-3 py-1.5 text-xs text-white">
            <Calendar className="h-3.5 w-3.5 text-emerald-400" />
            <span className="font-semibold text-slate-400">Date:</span>
            <input
              id="slate-date-picker"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-white font-mono text-xs focus:outline-none cursor-pointer"
            />
          </div>

          {/* Quick Date Presets */}
          <button
            id="date-preset-today"
            type="button"
            onClick={() => handleDatePreset('today')}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all ${
              isToday
                ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300 font-semibold'
                : 'border-slate-800 bg-slate-900/80 text-slate-300 hover:border-slate-700 hover:text-white'
            }`}
          >
            Today
          </button>
          <button
            id="date-preset-yesterday"
            type="button"
            onClick={() => handleDatePreset('yesterday')}
            className="rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white"
          >
            Yesterday
          </button>
          <button
            id="date-preset-tomorrow"
            type="button"
            onClick={() => handleDatePreset('tomorrow')}
            className="rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white"
          >
            Tomorrow
          </button>

          {/* Slate Date Mode Indicator */}
          <div className="flex items-center pl-2 border-l border-slate-800">
            {isToday && (
              <div
                id="slate-mode-indicator"
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-mono font-bold text-emerald-400"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"></span>
                </span>
                <span>LIVE DATA</span>
              </div>
            )}
            {isHistorical && (
              <div
                id="slate-mode-indicator"
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-mono font-semibold text-slate-300"
              >
                <Clock className="h-3 w-3 text-slate-400" />
                <span>HISTORICAL DATA &mdash; {selectedDate}</span>
              </div>
            )}
            {isFuture && (
              <div
                id="slate-mode-indicator"
                className="flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 px-2.5 py-1 text-xs font-mono font-semibold text-blue-300"
              >
                <Calendar className="h-3 w-3 text-blue-400" />
                <span>FUTURE SLATE &mdash; {selectedDate}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right side: Tennis Tour Toggle & Refresh */}
        <div className="flex items-center gap-2">
          {selectedSport === 'TENNIS' && (
            <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/90 p-0.5">
              {(['ALL', 'ATP', 'WTA'] as TennisTourFilter[]).map((tour) => (
                <button
                  key={tour}
                  id={`tennis-tour-${tour.toLowerCase()}`}
                  type="button"
                  onClick={() => setTennisTourFilter(tour)}
                  className={`px-2.5 py-1 text-xs font-mono font-bold rounded ${
                    tennisTourFilter === tour
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tour === 'ALL' ? 'All Tours' : tour}
                </button>
              ))}
            </div>
          )}

          <button
            id="refresh-schedule-btn"
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Refresh Slate</span>
          </button>
        </div>
      </div>

      {/* Decision Integrity Banner */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3.5 text-xs text-slate-400 flex items-start gap-2.5">
        <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <span className="font-semibold text-slate-200">Decision rule: probability alone is never enough.</span>
          <p className="text-[11px] leading-relaxed text-slate-400">
            The board shows only production-gate QUALIFIES results with verified identity, pregame timing, fresh price, sufficient reliability, positive edge and positive EV. Schedule-only markets remain visible below but are not labeled picks.
          </p>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-[#0d1322] p-12 text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
          <p className="mt-3 text-sm font-semibold text-white">Retrieving Real {selectedSport} Slate...</p>
          <p className="text-xs text-slate-400 font-mono mt-1">Calling /api/schedule?sport={selectedSport}&date={selectedDate}</p>
        </div>
      )}

      {/* Error State */}
      {isError && !isLoading && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-8 text-center space-y-3">
          <Activity className="h-8 w-8 text-rose-400 mx-auto" />
          <h3 className="text-base font-bold text-white">Slate Retrieval Glitch</h3>
          <p className="text-xs text-rose-300 max-w-md mx-auto">{errorMessage || 'Unable to retrieve sports data from source.'}</p>
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-lg border border-rose-500/40 bg-rose-900/40 px-4 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/60"
          >
            Retry Fetch
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && games.length === 0 && (
        <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-12 text-center space-y-2">
          <Calendar className="h-8 w-8 text-slate-400 mx-auto" />
          <h3 className="text-base font-bold text-white">0 {selectedSport} Events Scheduled</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Zero events reported for {selectedSport} on slate date <span className="font-mono text-slate-300">{selectedDate}</span>.
          </p>
          <p className="text-[11px] font-mono text-emerald-400/80">UNKNOWN IS BETTER THAN WRONG &bull; No fake matches generated</p>
        </div>
      )}

      {/* Games List Rendering */}
      {!isLoading && !isError && games.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-mono">
            <span>
              Slate Date: <strong className="text-slate-200">{scheduleData?.scheduleDate}</strong> &bull; Total Matches/Games: <strong className="text-emerald-400">{games.length}</strong>
            </span>
            <span>
              Source: <span className="text-emerald-400 font-semibold">{scheduleData?.source} Verified</span>
            </span>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {games.map((game) => {
              const isLive = game.status === 'LIVE';
              const isFinal = game.status === 'FINAL';
              const isTennis = game.sport === 'TENNIS';
              const periodDisplay = getPeriodDisplay(game);

              if (isTennis) {
                const isUpcoming = game.status === 'UPCOMING' || game.status === 'POSTPONED' || game.status === 'CANCELLED';
                const isWinnerA = !isUpcoming && game.winner === 'A';
                const isWinnerB = !isUpcoming && game.winner === 'B';
                const setScores = game.setScores || [];

                return (
                  <div
                    key={`tennis-${game.eventId}`}
                    id={`tennis-card-${game.eventId}`}
                    className="flex flex-col justify-between rounded-xl border border-slate-800/90 bg-[#0d1322] p-4 sm:p-5 transition-all hover:border-amber-500/40 hover:bg-[#101729] shadow-sm"
                  >
                    <div className="space-y-3.5">
                      {/* Tournament & Tour Header */}
                      <div className="flex items-center justify-between border-b border-slate-800/60 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${
                              isLive
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse'
                                : isFinal
                                ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                : 'bg-blue-500/10 text-blue-300 border border-blue-500/30'
                            }`}
                          >
                            {isLive && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                            {game.status}
                          </span>

                          <span className="text-[11px] font-mono text-slate-400 truncate max-w-[120px]">
                            {game.statusDetail}
                          </span>
                        </div>

                        {/* Tour & Round Badge */}
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                              game.tour === 'ATP'
                                ? 'bg-sky-950/40 border-sky-500/30 text-sky-300'
                                : 'bg-pink-950/40 border-pink-500/30 text-pink-300'
                            }`}
                          >
                            {game.tour || 'TENNIS'}
                          </span>
                          <span className="text-[11px] font-mono text-slate-300 font-semibold truncate max-w-[110px]">
                            {game.round || 'Match'}
                          </span>
                        </div>
                      </div>

                      {/* Tournament Name Banner */}
                      <div className="flex items-center gap-1.5 text-xs text-amber-300 font-semibold bg-amber-950/20 border border-amber-500/20 rounded px-2 py-1">
                        <Trophy className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span className="truncate">{game.tournamentName || game.league || 'Tennis Tournament'}</span>
                      </div>

                      {/* Players & Set-by-Set Scores Table */}
                      <div className="space-y-2 pt-1">
                        {/* Player A */}
                        <div className={`flex items-center justify-between rounded p-1.5 ${isWinnerA ? 'bg-emerald-950/30 border border-emerald-500/30' : ''}`}>
                          <div className="flex items-center gap-1.5 truncate max-w-[170px]">
                            <User className={`h-3.5 w-3.5 ${isWinnerA ? 'text-emerald-400' : 'text-slate-400'}`} />
                            <span className={`text-sm truncate ${isWinnerA ? 'font-bold text-emerald-200' : 'font-medium text-slate-200'}`}>
                              {game.playerAName || game.awayTeam || 'Player A'}
                            </span>
                            {game.playerACountry && (
                              <span className="text-[10px] font-mono text-slate-400 shrink-0">
                                ({game.playerACountry})
                              </span>
                            )}
                          </div>

                          {/* Set scores + Sets won only if match is active or completed */}
                          {!isUpcoming && (
                            <div className="flex items-center gap-2 font-mono text-xs">
                              {setScores.map((s, idx) => (
                                <span
                                  key={idx}
                                  className={`px-1 rounded ${
                                    s.scoreA > s.scoreB ? 'text-emerald-300 font-bold bg-emerald-900/40' : 'text-slate-400'
                                  }`}
                                >
                                  {s.scoreA}
                                  {s.tiebreakA !== null && <sup className="text-[9px] text-amber-400">{s.tiebreakA}</sup>}
                                </span>
                              ))}
                              {game.setsWonA !== null && game.setsWonA !== undefined && (
                                <span className={`ml-1 text-sm font-bold px-1.5 py-0.5 rounded ${isWinnerA ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-300'}`}>
                                  {game.setsWonA}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Player B */}
                        <div className={`flex items-center justify-between rounded p-1.5 ${isWinnerB ? 'bg-emerald-950/30 border border-emerald-500/30' : ''}`}>
                          <div className="flex items-center gap-1.5 truncate max-w-[170px]">
                            <User className={`h-3.5 w-3.5 ${isWinnerB ? 'text-emerald-400' : 'text-slate-400'}`} />
                            <span className={`text-sm truncate ${isWinnerB ? 'font-bold text-emerald-200' : 'font-medium text-slate-200'}`}>
                              {game.playerBName || game.homeTeam || 'Player B'}
                            </span>
                            {game.playerBCountry && (
                              <span className="text-[10px] font-mono text-slate-400 shrink-0">
                                ({game.playerBCountry})
                              </span>
                            )}
                          </div>

                          {/* Set scores + Sets won only if match is active or completed */}
                          {!isUpcoming && (
                            <div className="flex items-center gap-2 font-mono text-xs">
                              {setScores.map((s, idx) => (
                                <span
                                  key={idx}
                                  className={`px-1 rounded ${
                                    s.scoreB > s.scoreA ? 'text-emerald-300 font-bold bg-emerald-900/40' : 'text-slate-400'
                                  }`}
                                >
                                  {s.scoreB}
                                  {s.tiebreakB !== null && <sup className="text-[9px] text-amber-400">{s.tiebreakB}</sup>}
                                </span>
                              ))}
                              {game.setsWonB !== null && game.setsWonB !== undefined && (
                                <span className={`ml-1 text-sm font-bold px-1.5 py-0.5 rounded ${isWinnerB ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-300'}`}>
                                  {game.setsWonB}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Set Progress / In-Play Indicator (Only if LIVE or SUSPENDED) */}
                      {periodDisplay && (
                        <div className="flex items-center justify-between rounded-lg bg-black/30 px-2.5 py-1 text-[11px] font-mono text-slate-300 border border-slate-800/60">
                          <span>Match Progress:</span>
                          <span className="text-emerald-400 font-bold">{periodDisplay}</span>
                        </div>
                      )}

                      {/* Court / Surface / Time */}
                      <div className="space-y-1 pt-1 text-[11px] text-slate-400 border-t border-slate-800/40">
                        <div className="flex items-center gap-1.5 truncate">
                          <Clock className="h-3 w-3 text-slate-400 shrink-0" />
                          <span>Start: {formatStartTime(game.startTime)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 truncate">
                          <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                          <span className="truncate">{game.court || game.venue || 'Court Unassigned'}</span>
                          {game.surface && <span className="text-amber-400/80 font-mono">({game.surface})</span>}
                        </div>
                      </div>

                      {/* Markets Action for UPCOMING events */}
                      {game.status === 'UPCOMING' && (
                        <div className="pt-2">
                          <button
                            id={`tennis-markets-btn-${game.eventId}`}
                            type="button"
                            onClick={() => setSelectedGameForMarkets(game)}
                            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-mono font-bold text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/50 transition-all shadow-sm"
                          >
                            <DollarSign className="h-3.5 w-3.5" />
                            <span>Raw Markets — Independent Tennis Pick Model Pending</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Card Footer: Sport & ID */}
                    <div className="mt-3 flex items-center justify-between border-t border-slate-800/60 pt-2 text-[10px] font-mono text-slate-400">
                      <span className="font-bold text-slate-300">
                        TENNIS ({game.tour || 'PRO'}) &bull; ID: {game.eventId}
                      </span>
                      <span>{new Date(game.lastVerifiedAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                );
              }

              // Standard Team Sport Card (MLB, NFL, NBA, WNBA, NHL, SOCCER)
              return (
                <div
                  key={`${game.sport}-${game.eventId}`}
                  id={`game-card-${game.sport.toLowerCase()}-${game.eventId}`}
                  className="flex flex-col justify-between rounded-xl border border-slate-800/90 bg-[#0d1322] p-4 sm:p-5 transition-all hover:border-slate-700 hover:bg-[#101729] shadow-sm"
                >
                  <div className="space-y-3.5">
                    {/* Status & Competition Header */}
                    <div className="flex items-center justify-between border-b border-slate-800/60 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${
                            isLive
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse'
                              : isFinal
                              ? 'bg-slate-800 text-slate-300 border border-slate-700'
                              : 'bg-blue-500/10 text-blue-300 border border-blue-500/30'
                          }`}
                        >
                          {isLive && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                          {game.status}
                        </span>

                        <span className="text-[11px] font-mono text-slate-400 truncate max-w-[120px]">
                          {game.statusDetail}
                        </span>
                      </div>

                      {/* Sport / League / Competition Badge */}
                      <div className="flex items-center gap-1 text-[10px] font-mono text-emerald-400/90 bg-emerald-950/40 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                        <ShieldCheck className="h-3 w-3" />
                        <span className="font-bold">{game.competition || game.league || game.sport}</span>
                      </div>
                    </div>

                    {/* Teams & Scores */}
                    <div className="space-y-2">
                      {/* Away Team */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-400 w-10 truncate">
                            {game.awayAbbreviation || 'AWAY'}
                          </span>
                          <span className="text-sm font-semibold text-white truncate max-w-[160px]">
                            {game.awayTeam || 'Away Team'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 font-mono">
                          {game.penalties && game.penalties.awayShootoutScore !== null && (
                            <span className="text-xs text-amber-400" title="Penalties score">
                              ({game.penalties.awayShootoutScore})
                            </span>
                          )}
                          <span className="text-base font-bold text-slate-100">
                            {game.awayScore !== null ? game.awayScore : '—'}
                          </span>
                        </div>
                      </div>

                      {/* Home Team */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-400 w-10 truncate">
                            {game.homeAbbreviation || 'HOME'}
                          </span>
                          <span className="text-sm font-semibold text-white truncate max-w-[160px]">
                            {game.homeTeam || 'Home Team'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 font-mono">
                          {game.penalties && game.penalties.homeShootoutScore !== null && (
                            <span className="text-xs text-amber-400" title="Penalties score">
                              ({game.penalties.homeShootoutScore})
                            </span>
                          )}
                          <span className="text-base font-bold text-slate-100">
                            {game.homeScore !== null ? game.homeScore : '—'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Period / Clock / Inning / Stoppage / Extra Time */}
                    {periodDisplay && (
                      <div className="flex items-center justify-between rounded-lg bg-black/30 px-2.5 py-1 text-[11px] font-mono text-slate-300 border border-slate-800/60">
                        <span>Period / In-Play:</span>
                        <span className="text-emerald-400 font-bold">
                          {periodDisplay}
                          {game.stoppageTime ? ` (${game.stoppageTime} stoppage)` : ''}
                        </span>
                      </div>
                    )}

                    {/* Aggregate Score for 2-legged ties */}
                    {game.aggregateScore && (
                      <div className="rounded-lg bg-emerald-950/20 border border-emerald-500/20 px-2.5 py-1 text-[11px] font-mono text-emerald-300">
                        <div className="flex items-center justify-between font-bold">
                          <span>Aggregate Score:</span>
                          <span>
                            {game.aggregateScore.awayAggregate ?? '—'} - {game.aggregateScore.homeAggregate ?? '—'}
                          </span>
                        </div>
                        {game.aggregateScore.note && (
                          <div className="text-[10px] text-slate-400 font-normal pt-0.5 truncate">
                            {game.aggregateScore.note}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Metadata: Venue & Start Time */}
                    <div className="space-y-1 pt-1 text-[11px] text-slate-400 border-t border-slate-800/40">
                      <div className="flex items-center gap-1.5 truncate">
                        <Clock className="h-3 w-3 text-slate-400 shrink-0" />
                        <span>Start: {formatStartTime(game.startTime)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 truncate">
                        <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                        <span className="truncate">{game.venue || 'Venue Unavailable'}</span>
                      </div>
                    </div>

                    {/* Decision-first actions for UPCOMING events */}
                    {game.status === 'UPCOMING' && (
                      <div className="pt-2 space-y-2">
                        {decisionBoard?.picks?.find((p) => p.eventId === game.eventId) && (() => {
                          const pick = decisionBoard.picks.find((p) => p.eventId === game.eventId)!;
                          return (
                            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/15 p-2.5">
                              <div className="text-[10px] font-mono font-black text-emerald-400">APEX QUALIFIED · {pick.pickType === 'GAME_MARKET' ? 'GAME MODEL' : 'PLAYER PROP'}</div>
                              <div className="mt-0.5 text-xs font-bold text-white">{pick.displayPick || `${pick.playerName || ''} ${pick.side} ${pick.line ?? ''}`}</div>
                              <div className="mt-0.5 text-[10px] text-slate-400">{(pick.apexProbability * 100).toFixed(1)}% model P · +{pick.expectedValuePercent.toFixed(1)}% EV · {pick.sportsbook} {pick.oddsAmerican > 0 ? '+' : ''}{pick.oddsAmerican}</div>
                            </div>
                          );
                        })()}
                        <button
                          id={`game-analyze-btn-${game.eventId}`}
                          type="button"
                          onClick={() => analyzeSingleGame(game)}
                          disabled={decisionBoardLoading}
                          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-black text-emerald-200 hover:bg-emerald-500/25 hover:border-emerald-500/60 transition-all shadow-sm disabled:opacity-50"
                        >
                          <Target className="h-3.5 w-3.5" />
                          <span>Analyze for Best Pick</span>
                        </button>
                        <div className="grid grid-cols-2 gap-2">
                          {onSelectGame && (
                            <button
                              type="button"
                              onClick={() => onSelectGame(game)}
                              className="flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[10px] font-bold text-slate-300 hover:text-white"
                            >
                              <Sparkles className="h-3 w-3" /> Full Prop Analysis
                            </button>
                          )}
                          <button
                            id={`game-markets-btn-${game.eventId}`}
                            type="button"
                            onClick={() => setSelectedGameForMarkets(game)}
                            className="flex items-center justify-center gap-1 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2 py-1.5 text-[10px] font-bold text-amber-300 hover:bg-amber-500/10"
                          >
                            <DollarSign className="h-3 w-3" /> Raw Markets
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Card Footer: Sport & ID */}
                  <div className="mt-3 flex items-center justify-between border-t border-slate-800/60 pt-2 text-[10px] font-mono text-slate-400">
                    <span className="font-bold text-slate-300">
                      {game.sport} &bull; ID: {game.eventId}
                    </span>
                    <span>{new Date(game.lastVerifiedAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Market Detail Modal */}
      <MarketDetailModal
        game={selectedGameForMarkets}
        isOpen={selectedGameForMarkets !== null}
        onClose={() => setSelectedGameForMarkets(null)}
      />
    </div>
  );
};
