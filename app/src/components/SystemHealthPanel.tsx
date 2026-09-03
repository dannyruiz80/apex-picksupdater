import React from 'react';
import { HealthResponse, VersionResponse } from '../types';
import {
  Server,
  Activity,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Terminal,
  Zap,
  Clock,
  Radio,
  Cpu,
} from 'lucide-react';

interface SystemHealthPanelProps {
  health: HealthResponse | null;
  version: VersionResponse | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  latencyMs: number | null;
  lastChecked: Date | null;
  onRefresh: () => void;
}

export const SystemHealthPanel: React.FC<SystemHealthPanelProps> = ({
  health,
  version,
  isLoading,
  isError,
  errorMessage,
  latencyMs,
  lastChecked,
  onRefresh,
}) => {
  const isOnline = health?.status === 'ok' && health?.app === 'Apex Picks';

  return (
    <div id="system-health-panel" className="space-y-6">
      {/* Primary Engine Status Banner */}
      <div
        id="engine-online-banner"
        className={`relative overflow-hidden rounded-2xl border p-6 sm:p-8 transition-all ${
          isOnline
            ? 'border-emerald-500/40 bg-gradient-to-br from-[#0c1e18] via-[#091512] to-[#090d16] text-white shadow-[0_0_40px_rgba(16,185,129,0.1)]'
            : isError
            ? 'border-rose-500/40 bg-gradient-to-br from-[#240e13] via-[#17090d] to-[#090d16] text-white'
            : 'border-slate-800 bg-[#0d1322] text-white'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border ${
                isOnline
                  ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)]'
                  : isError
                  ? 'border-rose-400/50 bg-rose-500/20 text-rose-400'
                  : 'border-amber-400/50 bg-amber-500/20 text-amber-400'
              }`}
            >
              {isOnline ? (
                <Activity className="h-7 w-7 animate-pulse" />
              ) : isError ? (
                <AlertTriangle className="h-7 w-7" />
              ) : (
                <RefreshCw className="h-7 w-7 animate-spin" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2.5">
                <span
                  id="engine-online-text"
                  className="text-2xl sm:text-3xl font-extrabold tracking-tight"
                >
                  {isOnline
                    ? 'ENGINE ONLINE'
                    : isError
                    ? 'ENGINE OFFLINE'
                    : 'CONNECTING...'}
                </span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold ${
                    isOnline
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }`}
                >
                  HTTP 200 OK
                </span>
              </div>
              <p className="text-sm text-slate-300 mt-1">
                Apex Picks Sports Intelligence Node Runtime &bull; Same-origin API verified
              </p>
            </div>
          </div>

          <button
            id="recheck-engine-btn"
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600/20 px-4 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-600/30 hover:border-emerald-400 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Verify /api/health</span>
          </button>
        </div>

        {/* Telemetry Metrics Row */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-slate-800/80 pt-5 text-xs">
          <div className="rounded-lg bg-black/30 p-3 border border-slate-800/60">
            <div className="text-slate-400 flex items-center gap-1.5 font-medium">
              <Zap className="h-3.5 w-3.5 text-emerald-400" />
              <span>Round-Trip Latency</span>
            </div>
            <div className="mt-1 font-mono text-sm font-bold text-white">
              {latencyMs !== null ? `${latencyMs} ms` : '—'}
            </div>
          </div>

          <div className="rounded-lg bg-black/30 p-3 border border-slate-800/60">
            <div className="text-slate-400 flex items-center gap-1.5 font-medium">
              <Server className="h-3.5 w-3.5 text-cyan-400" />
              <span>Server Port</span>
            </div>
            <div className="mt-1 font-mono text-sm font-bold text-white">
              0.0.0.0:3000
            </div>
          </div>

          <div className="rounded-lg bg-black/30 p-3 border border-slate-800/60">
            <div className="text-slate-400 flex items-center gap-1.5 font-medium">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              <span>Last Heartbeat</span>
            </div>
            <div className="mt-1 font-mono text-sm font-bold text-white">
              {lastChecked ? lastChecked.toLocaleTimeString() : '—'}
            </div>
          </div>

          <div className="rounded-lg bg-black/30 p-3 border border-slate-800/60">
            <div className="text-slate-400 flex items-center gap-1.5 font-medium">
              <Radio className="h-3.5 w-3.5 text-emerald-400" />
              <span>Target App</span>
            </div>
            <div className="mt-1 font-mono text-sm font-bold text-white">
              {health?.app || 'Apex Picks'}
            </div>
          </div>
        </div>
      </div>

      {/* Real Server Endpoints Inspection Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Real /api/health endpoint card */}
        <div
          id="api-health-inspect-card"
          className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <h3 className="font-mono text-sm font-bold text-white">
                GET /api/health
              </h3>
            </div>
            <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-mono text-emerald-400">
              Live Server JSON
            </span>
          </div>

          <p className="text-xs text-slate-400">
            Mandated primary health probe called via same-origin relative URL.
          </p>

          <div className="rounded-xl border border-slate-800 bg-[#070b12] p-4 font-mono text-xs text-emerald-300 overflow-x-auto">
            {health ? (
              <pre>{JSON.stringify(health, null, 2)}</pre>
            ) : isError ? (
              <span className="text-rose-400">{errorMessage || 'Error fetching endpoint'}</span>
            ) : (
              <span className="text-slate-400">Fetching server JSON...</span>
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
            <span>Route: <code className="text-slate-300">server.ts &rarr; /api/health</code></span>
            <span className="font-mono text-emerald-400">status: "ok"</span>
          </div>
        </div>

        {/* Real /api/version endpoint card */}
        <div
          id="api-version-inspect-card"
          className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-2.5 w-2.5 rounded-full bg-cyan-400" />
              <h3 className="font-mono text-sm font-bold text-white">
                GET /api/version
              </h3>
            </div>
            <span className="rounded bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[11px] font-mono text-cyan-400">
              Live Server JSON
            </span>
          </div>

          <p className="text-xs text-slate-400">
            Native Node runtime build info and active environment metadata.
          </p>

          <div className="rounded-xl border border-slate-800 bg-[#070b12] p-4 font-mono text-xs text-cyan-300 overflow-x-auto">
            {version ? (
              <pre>{JSON.stringify(version, null, 2)}</pre>
            ) : (
              <span className="text-slate-400">Fetching version JSON...</span>
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
            <span>Runtime: <code className="text-slate-300">Node / Express (ESM + TSX)</code></span>
            <span className="font-mono text-cyan-400">v{version?.version || '1.0.0'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
