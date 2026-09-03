import React, { useState, useEffect, useCallback } from 'react';
import {
  NavTabId,
  ApexSportFilter,
  HealthResponse,
  VersionResponse,
  ScheduleResponse,
  LiveScoresResponse,
  NormalizedLiveScoreUpdate,
} from './types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { OverviewView } from './components/OverviewView';
import { PicksView } from './components/PicksView';
import { LiveView } from './components/LiveView';
import { PropsView } from './components/PropsView';
import { AuditView } from './components/AuditView';
import { SimsView } from './components/SimsView';
import { ModulePlaceholder } from './components/ModulePlaceholder';

// America/Chicago default sports date
const getInitialChicagoDate = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
};

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTabId>('overview');
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  // Active Sport Filter
  const [selectedSport, setSelectedSport] = useState<ApexSportFilter>('ALL');
  const [propsTargetGameId, setPropsTargetGameId] = useState<string | null>(null);

  // Server health state
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [version, setVersion] = useState<VersionResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isError, setIsError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  // Multi-sport Schedule state
  const [selectedDate, setSelectedDate] = useState<string>(getInitialChicagoDate);
  const [scheduleData, setScheduleData] = useState<ScheduleResponse | null>(null);
  const [isScheduleLoading, setIsScheduleLoading] = useState<boolean>(false);
  const [isScheduleError, setIsScheduleError] = useState<boolean>(false);
  const [scheduleErrorMessage, setScheduleErrorMessage] = useState<string | null>(null);

  // Multi-sport Live Scores state (~30s polling)
  const [liveUpdates, setLiveUpdates] = useState<Record<string, NormalizedLiveScoreUpdate>>({});
  const [isLivePolling, setIsLivePolling] = useState<boolean>(false);
  const [isLivePollingError, setIsLivePollingError] = useState<boolean>(false);
  const [lastLivePollTime, setLastLivePollTime] = useState<Date | null>(null);

  // Mandatory same-origin relative fetch to /api/health and /api/version
  const fetchHealthAndVersion = useCallback(async () => {
    setIsLoading(true);
    setIsError(false);
    setErrorMessage(null);

    const startTime = performance.now();

    try {
      const healthRes = await fetch('/api/health', {
        headers: { Accept: 'application/json' },
      });

      const elapsed = Math.round(performance.now() - startTime);
      setLatencyMs(elapsed);

      if (!healthRes.ok) {
        throw new Error(`Server returned HTTP ${healthRes.status} ${healthRes.statusText}`);
      }

      const healthData: HealthResponse = await healthRes.json();
      setHealth(healthData);
      setLastChecked(new Date());

      try {
        const versionRes = await fetch('/api/version', {
          headers: { Accept: 'application/json' },
        });
        if (versionRes.ok) {
          const versionData: VersionResponse = await versionRes.json();
          setVersion(versionData);
        }
      } catch {
        // version is secondary
      }
    } catch (err: any) {
      console.error('[Apex Picks] Health check error:', err);
      setIsError(true);
      setErrorMessage(err.message || 'Failed to connect to /api/health');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch Multi-Sport Schedule for selected date and sport
  const fetchSchedule = useCallback(
    async (sportToFetch: ApexSportFilter, dateToFetch: string) => {
      setIsScheduleLoading(true);
      setIsScheduleError(false);
      setScheduleErrorMessage(null);

      try {
        const res = await fetch(
          `/api/schedule?sport=${encodeURIComponent(sportToFetch)}&date=${encodeURIComponent(
            dateToFetch
          )}`,
          {
            headers: { Accept: 'application/json' },
          }
        );

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.message || `Server returned HTTP ${res.status}`);
        }

        const data: ScheduleResponse = await res.json();
        setScheduleData(data);
      } catch (err: any) {
        console.error('[Apex Picks] Schedule fetch error:', err);
        setIsScheduleError(true);
        setScheduleErrorMessage(err.message || 'Failed to load sports schedule');
      } finally {
        setIsScheduleLoading(false);
      }
    },
    []
  );

  // Poll Multi-Sport Live Scores (~30s interval)
  const pollLiveScores = useCallback(async () => {
    setIsLivePolling(true);
    setIsLivePollingError(false);

    try {
      const res = await fetch(`/api/live-scores?sport=${encodeURIComponent(selectedSport)}`, {
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        throw new Error(`Live scores returned HTTP ${res.status}`);
      }

      const data: LiveScoresResponse = await res.json();
      if (Array.isArray(data.games)) {
        setLiveUpdates((prev) => {
          const next = { ...prev };
          data.games.forEach((update) => {
            next[update.eventId] = update;
          });
          return next;
        });
      }
      setLastLivePollTime(new Date());
    } catch (err: any) {
      console.warn('[Apex Picks] Live scores poll failed (retaining last scores):', err.message);
      setIsLivePollingError(true);
    } finally {
      setIsLivePolling(false);
    }
  }, [selectedSport]);

  // Initial health check + periodic 15s health heartbeat
  useEffect(() => {
    fetchHealthAndVersion();
    const healthInterval = setInterval(() => {
      fetchHealthAndVersion();
    }, 15000);
    return () => clearInterval(healthInterval);
  }, [fetchHealthAndVersion]);

  // Load schedule when selectedDate or selectedSport changes
  useEffect(() => {
    fetchSchedule(selectedSport, selectedDate);
  }, [selectedSport, selectedDate, fetchSchedule]);

  // 30s Live score polling active
  useEffect(() => {
    pollLiveScores();
    const liveInterval = setInterval(() => {
      pollLiveScores();
    }, 30000);

    return () => clearInterval(liveInterval);
  }, [pollLiveScores]);

  return (
    <div id="apex-picks-app" className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col font-sans">
      {/* Top Header Bar */}
      <Header
        health={health}
        version={version}
        isLoading={isLoading}
        isError={isError}
        latencyMs={latencyMs}
        onRefresh={fetchHealthAndVersion}
        isMobileDrawerOpen={isMobileDrawerOpen}
        setIsMobileDrawerOpen={setIsMobileDrawerOpen}
      />

      {/* Main App Body */}
      <div className="flex-1 flex w-full">
        {/* Desktop Navigation Sidebar */}
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

        {/* Dynamic Center Stage */}
        <main
          id="main-stage-container"
          className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8 overflow-y-auto"
        >
          {activeTab === 'overview' && (
            <OverviewView
              health={health}
              version={version}
              isLoading={isLoading}
              isError={isError}
              errorMessage={errorMessage}
              latencyMs={latencyMs}
              lastChecked={lastChecked}
              onRefresh={fetchHealthAndVersion}
              onSelectTab={setActiveTab}
              onOpenPick={(eventId, pickType) => {
                if (pickType === 'GAME_MARKET') {
                  setSelectedSport('ALL');
                  setActiveTab('picks');
                } else {
                  setSelectedSport('ALL');
                  setPropsTargetGameId(eventId);
                  setActiveTab('props');
                }
              }}
            />
          )}

          {activeTab === 'picks' && (
            <PicksView
              selectedSport={selectedSport}
              setSelectedSport={setSelectedSport}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              scheduleData={scheduleData}
              isLoading={isScheduleLoading}
              isError={isScheduleError}
              errorMessage={scheduleErrorMessage}
              onRefresh={() => fetchSchedule(selectedSport, selectedDate)}
              onSelectGame={(game) => {
                setPropsTargetGameId(game.eventId);
                setActiveTab('props');
              }}
            />
          )}

          {activeTab === 'live' && (
            <LiveView
              selectedSport={selectedSport}
              setSelectedSport={setSelectedSport}
              games={scheduleData?.games || []}
              liveUpdates={liveUpdates}
              isPolling={isLivePolling}
              isPollingError={isLivePollingError}
              lastLivePollTime={lastLivePollTime}
              onManualLivePoll={pollLiveScores}
              onGoToPicks={() => setActiveTab('picks')}
            />
          )}

          {activeTab === 'props' && (
            <PropsView
              games={scheduleData?.games || []}
              selectedSport={selectedSport}
              setSelectedSport={setSelectedSport}
              onGoToOverview={() => setActiveTab('overview')}
              initialSelectedGameId={propsTargetGameId}
            />
          )}

          {activeTab === 'sims' && (
            <SimsView games={scheduleData?.games || []} />
          )}

          {activeTab === 'audit' && (
            <AuditView onGoToOverview={() => setActiveTab('overview')} />
          )}

          {activeTab !== 'overview' &&
            activeTab !== 'picks' &&
            activeTab !== 'live' &&
            activeTab !== 'props' &&
            activeTab !== 'sims' &&
            activeTab !== 'audit' && (
              <ModulePlaceholder
                tabId={activeTab}
                onGoToOverview={() => setActiveTab('overview')}
              />
            )}
        </main>
      </div>

      {/* Responsive Mobile / Android Navigation */}
      <MobileNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isOpen={isMobileDrawerOpen}
        setIsOpen={setIsMobileDrawerOpen}
      />
    </div>
  );
}
