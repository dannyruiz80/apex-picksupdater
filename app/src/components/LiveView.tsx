import React from 'react';
import {
  ApexSportFilter,
  NormalizedApexGame,
  NormalizedLiveScoreUpdate,
} from '../types';
import {
  Radio,
  RefreshCw,
  Activity,
  ShieldCheck,
  Clock,
  AlertCircle,
  PlayCircle,
  Trophy,
  User,
} from 'lucide-react';
import { mergeVerifiedLiveUpdates } from '../liveStateUtils';

interface LiveViewProps {
  selectedSport: ApexSportFilter;
  setSelectedSport: (sport: ApexSportFilter) => void;
  games: NormalizedApexGame[];
  liveUpdates: Record<string, NormalizedLiveScoreUpdate>;
  isPolling: boolean;
  isPollingError: boolean;
  lastLivePollTime: Date | null;
  onManualLivePoll: () => void;
  onGoToPicks: () => void;
}

const SPORT_FILTERS: Array<{ id: ApexSportFilter; label: string }> = [
  { id: 'ALL', label: 'All Sports' },
  { id: 'MLB', label: 'MLB' },
  { id: 'NFL', label: 'NFL' },
  { id: 'NCAAF', label: 'NCAAF' },
  { id: 'NBA', label: 'NBA' },
  { id: 'WNBA', label: 'WNBA' },
  { id: 'NHL', label: 'NHL' },
  { id: 'SOCCER', label: 'Soccer' },
  { id: 'TENNIS', label: 'Tennis' },
];

export const LiveView: React.FC<LiveViewProps> = ({
  selectedSport,
  setSelectedSport,
  games,
  liveUpdates,
  isPolling,
  isPollingError,
  lastLivePollTime,
  onManualLivePoll,
  onGoToPicks,
}) => {
  // Merge live-score updates and surface verified live events even when the selected schedule date differs.
  const enrichedGames = mergeVerifiedLiveUpdates(games, liveUpdates);

  const liveGames = enrichedGames.filter((g) => g.status === 'LIVE');
  const upcomingGames = enrichedGames.filter((g) => g.status === 'UPCOMING');
  const finalGames = enrichedGames.filter((g) => g.status === 'FINAL');

  const getPeriodDisplay = (game: NormalizedApexGame) => {
    if (game.status !== 'LIVE' && game.status !== 'SUSPENDED') return null;

    if (game.sport === 'TENNIS') {
      if (game.currentSet) return `Set ${game.currentSet}`;
      return null;
    }

    if (game.sport === 'SOCCER') {
      if (game.matchClock) return `Clock: ${game.matchClock}`;
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
        const p = game.period === 4 ? 'OT' : game.period === 5 ? 'SO' : `P${game.period}`;
        return game.displayClock ? `${p} (${game.displayClock})` : p;
      }
      return null;
    }

    if (game.sport === 'NFL' || game.sport === 'NCAAF' || game.sport === 'NBA' || game.sport === 'WNBA') {
      if (game.period !== null && game.period !== undefined) {
        const q = game.period > 4 ? `OT${game.period - 4 > 1 ? game.period - 4 : ''}` : `Q${game.period}`;
        return game.displayClock ? `${q} (${game.displayClock})` : q;
      }
      return null;
    }

    return null;
  };

  return (
    <div id="live-module-container" className="space-y-6 animate-in fade-in">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <Radio className="h-6 w-6 text-emerald-400 animate-pulse" />
              <span>Multi-Sport Live Scores & In-Play Ingest</span>
            </h2>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400 font-mono">
              ~30s POLLING ACTIVE
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Real-time live scoreboard synchronizer across MLB, NFL, NCAAF, NBA, WNBA, NHL, Soccer, and ATP / WTA Tennis
          </p>
        </div>

        {/* Polling Controller & Status */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-[#0d1322] px-3 py-1.5 text-xs font-mono">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"></span>
            </span>
            <span className="text-slate-300">
              {lastLivePollTime
                ? `Updated: ${lastLivePollTime.toLocaleTimeString()}`
                : 'Polling initializing...'}
            </span>
          </div>

          <button
            id="poll-now-btn"
            type="button"
            onClick={onManualLivePoll}
            disabled={isPolling}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isPolling ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Poll Now</span>
          </button>
        </div>
      </div>

      {/* Sport Selector Bar */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-[#090d16] p-1">
        {SPORT_FILTERS.map((s) => {
          const isActive = selectedSport === s.id;
          return (
            <button
              key={s.id}
              id={`live-filter-${s.id.toLowerCase()}`}
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

      {/* Live Polling Status Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-400">Active Live Matches</div>
            <div className="text-xl font-extrabold text-emerald-400 mt-0.5 font-mono">
              {liveGames.length}
            </div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <PlayCircle className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-400">Upcoming Today</div>
            <div className="text-xl font-extrabold text-blue-400 mt-0.5 font-mono">
              {upcomingGames.length}
            </div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Clock className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-400">Final / Completed</div>
            <div className="text-xl font-extrabold text-slate-300 mt-0.5 font-mono">
              {finalGames.length}
            </div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-slate-400 border border-slate-700">
            <ShieldCheck className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Polling Error Non-Destructive Banner */}
      {isPollingError && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-950/20 p-3.5 text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              Temporary live-score refresh glitch from source. Preserving last verified scores. Retrying in 30s...
            </span>
          </div>
          <button
            type="button"
            onClick={onManualLivePoll}
            className="rounded bg-amber-500/20 px-2 py-1 font-semibold hover:bg-amber-500/30"
          >
            Retry Now
          </button>
        </div>
      )}

      {/* Live Games Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-400" />
            <span>Active Live Matchups ({selectedSport})</span>
          </h3>
          <span className="text-xs font-mono text-slate-400">
            {liveGames.length} in play
          </span>
        </div>

        {liveGames.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-8 text-center space-y-3">
            <Radio className="h-8 w-8 text-slate-400 mx-auto" />
            <h4 className="text-sm font-bold text-white">0 Live {selectedSport} Events In Progress</h4>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              No matches are currently in progress on today&apos;s slate. Matches will automatically display live in-game clocks and real-time scores here when they start.
            </p>
            <button
              type="button"
              onClick={onGoToPicks}
              className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white"
            >
              View Full Schedule in Picks
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {liveGames.map((game) => {
              const periodDisplay = getPeriodDisplay(game);
              const isTennis = game.sport === 'TENNIS';

              if (isTennis) {
                return (
                  <div
                    key={`live-tennis-${game.eventId}`}
                    className="rounded-xl border border-amber-500/40 bg-gradient-to-b from-[#1c190f] to-[#0d1322] p-5 space-y-3 shadow-[0_0_15px_rgba(245,158,11,0.1)]"
                  >
                    <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
                      <span className="flex items-center gap-1.5 rounded bg-amber-500/20 px-2 py-0.5 text-xs font-mono font-bold text-amber-300">
                        <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                        LIVE &bull; {game.tour || 'TENNIS'}
                      </span>
                      <span className="text-[11px] font-mono text-amber-400 font-bold">
                        {periodDisplay || game.statusDetail}
                      </span>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-white truncate max-w-[170px]">
                          {game.playerAName || game.awayTeam}
                        </span>
                        <span className="font-mono text-lg font-extrabold text-amber-300">
                          {game.setsWonA ?? 0}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-white truncate max-w-[170px]">
                          {game.playerBName || game.homeTeam}
                        </span>
                        <span className="font-mono text-lg font-extrabold text-amber-300">
                          {game.setsWonB ?? 0}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-2 border-t border-slate-800">
                      <span className="truncate max-w-[180px]">{game.tournamentName || 'Tennis'}</span>
                      <span>ID: {game.eventId}</span>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={`${game.sport}-${game.eventId}`}
                  className="rounded-xl border border-emerald-500/40 bg-gradient-to-b from-[#0c1e18] to-[#0d1322] p-5 space-y-3 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                >
                  <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
                    <span className="flex items-center gap-1.5 rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-mono font-bold text-emerald-300">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                      LIVE &bull; {game.statusDetail}
                    </span>
                    <span className="text-[11px] font-mono text-emerald-400 font-bold">
                      {periodDisplay}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-white">
                        {game.awayTeam} ({game.awayAbbreviation})
                      </span>
                      <span className="font-mono text-lg font-extrabold text-emerald-300">
                        {game.awayScore ?? 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-white">
                        {game.homeTeam} ({game.homeAbbreviation})
                      </span>
                      <span className="font-mono text-lg font-extrabold text-emerald-300">
                        {game.homeScore ?? 0}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-2 border-t border-slate-800">
                    <span>{game.competition || game.league || game.sport}</span>
                    <span>ID: {game.eventId}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Full Today's Slate Overview */}
      {enrichedGames.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">
              Today&apos;s Full {selectedSport} Slate ({enrichedGames.length} Events)
            </h3>
            <span className="text-xs font-mono text-slate-400">Auto-polling every ~30s</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {enrichedGames.map((game) => {
              const isTennis = game.sport === 'TENNIS';
              const nameDisplay = isTennis
                ? `${game.playerAName || game.awayTeam} vs ${game.playerBName || game.homeTeam}`
                : `${game.awayAbbreviation || game.awayTeam} @ ${game.homeAbbreviation || game.homeTeam}`;

              const scoreDisplay = isTennis
                ? game.status === 'UPCOMING' || game.status === 'POSTPONED' || game.status === 'CANCELLED'
                  ? 'VS'
                  : `${game.setsWonA ?? 0} - ${game.setsWonB ?? 0}`
                : game.awayScore !== null && game.homeScore !== null
                ? `${game.awayScore} - ${game.homeScore}`
                : 'VS';

              return (
                <div
                  key={`${game.sport}-${game.eventId}`}
                  className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-[#090d16] p-3 text-xs"
                >
                  <div className="space-y-1 truncate pr-2">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="font-bold text-[10px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-300 shrink-0">
                        {isTennis ? (game.tour || 'TENNIS') : game.sport}
                      </span>
                      <span className="font-semibold text-white truncate max-w-[140px]">
                        {nameDisplay}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono truncate max-w-[160px]">
                      {game.statusDetail}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-bold text-slate-200">
                      {scoreDisplay}
                    </div>
                    <span
                      className={`inline-block px-1.5 py-0.2 rounded text-[10px] font-mono ${
                        game.status === 'LIVE'
                          ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-500/30'
                          : game.status === 'FINAL'
                          ? 'text-slate-400 bg-slate-800'
                          : 'text-blue-400 bg-blue-950/40'
                      }`}
                    >
                      {game.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
