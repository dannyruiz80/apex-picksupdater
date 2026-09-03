import React from 'react';
import { Activity, RefreshCw, Server, ShieldCheck, Menu, X, Terminal } from 'lucide-react';
import { HealthResponse, VersionResponse } from '../types';

interface HeaderProps {
  health: HealthResponse | null;
  version: VersionResponse | null;
  isLoading: boolean;
  isError: boolean;
  latencyMs: number | null;
  onRefresh: () => void;
  isMobileDrawerOpen: boolean;
  setIsMobileDrawerOpen: (open: boolean) => void;
}

export const Header: React.FC<HeaderProps> = ({
  health,
  version,
  isLoading,
  isError,
  latencyMs,
  onRefresh,
  isMobileDrawerOpen,
  setIsMobileDrawerOpen,
}) => {
  const isOnline = health?.status === 'ok' && health?.app === 'Apex Picks';

  return (
    <header
      id="apex-header"
      className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-[#090d16]/95 backdrop-blur-md px-4 sm:px-6 py-3.5"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        {/* Left: Brand Identity */}
        <div className="flex items-center gap-3">
          <button
            id="mobile-drawer-toggle-btn"
            type="button"
            onClick={() => setIsMobileDrawerOpen(!isMobileDrawerOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/80 text-slate-300 transition-colors hover:border-slate-700 hover:text-white lg:hidden"
            aria-label="Toggle navigation drawer"
          >
            {isMobileDrawerOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>

          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/20 via-emerald-600/10 to-transparent border border-emerald-500/30 text-emerald-400 font-bold shadow-inner">
              <span className="text-base font-black tracking-tighter">AP</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
                  Apex Picks
                </h1>
                <span className="hidden sm:inline-block rounded border border-slate-700/60 bg-slate-800/50 px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase text-slate-400 font-mono">
                  v{version?.version || '1.0.0'}
                </span>
              </div>
              <p className="hidden md:block text-xs text-slate-400 font-medium">
                Sports Intelligence & Betting Analytics
              </p>
            </div>
          </div>
        </div>

        {/* Right: Engine Status & Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Real Server-Side Health Status Indicator */}
          <div
            id="engine-status-badge"
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide transition-all ${
              isOnline
                ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                : isError
                ? 'border-rose-500/40 bg-rose-950/40 text-rose-300'
                : 'border-amber-500/40 bg-amber-950/40 text-amber-300'
            }`}
          >
            <span className="relative flex h-2 w-2">
              {isOnline && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  isOnline
                    ? 'bg-emerald-400'
                    : isError
                    ? 'bg-rose-400'
                    : 'bg-amber-400'
                }`}
              ></span>
            </span>
            <span className="font-mono text-[11px] sm:text-xs">
              {isOnline
                ? 'ENGINE ONLINE'
                : isError
                ? 'ENGINE OFFLINE'
                : 'CHECKING ENGINE...'}
            </span>
            {latencyMs !== null && (
              <span className="hidden sm:inline text-[10px] font-mono text-emerald-400/80 border-l border-emerald-500/30 pl-2">
                {latencyMs}ms
              </span>
            )}
          </div>

          {/* Quick Server Health Ping Button */}
          <button
            id="ping-health-btn"
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:bg-slate-800 hover:text-white disabled:opacity-50"
            title="Ping /api/health endpoint"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
            <span className="hidden sm:inline">Ping /api/health</span>
          </button>
        </div>
      </div>
    </header>
  );
};
