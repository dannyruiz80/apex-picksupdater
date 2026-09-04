import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  NormalizedApexGame,
  ApexSportFilter,
  NormalizedPlayerPropQuote,
  EventPlayerPropsResponse,
  PropNegativeTestResponse,
  MarketQuotaState,
  PropPipelineAuditDiagnostic,
  PropSlateScanResponse,
} from '../types';
import {
  Users,
  Search,
  CheckCircle2,
  ShieldCheck,
  Zap,
  Filter,
  RefreshCw,
  AlertTriangle,
  Flame,
  Layers,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  Info,
  Clock,
  Sparkles,
  Award,
  TrendingUp,
  BarChart2,
  History,
  Calendar,
  Calculator,
  Gauge,
  HelpCircle,
  Activity,
  Percent,
  Scale,
  Target,
} from 'lucide-react';
import { canonicalQualifiedPropQuotes, formatPropSelectionLabel, humanizePropMarket } from '../propPresentation';

interface PropsViewProps {
  games: NormalizedApexGame[];
  selectedSport: ApexSportFilter;
  setSelectedSport: (sport: ApexSportFilter) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  onGoToOverview?: () => void;
  initialSelectedGameId?: string | null;
}

export const PropsView: React.FC<PropsViewProps> = ({
  games,
  selectedSport,
  setSelectedSport,
  selectedDate,
  setSelectedDate,
  initialSelectedGameId = null,
}) => {
  const [selectedGameId, setSelectedGameId] = useState<string>('');
  const [propsData, setPropsData] = useState<NormalizedPlayerPropQuote[]>([]);
  const [slatePropsData, setSlatePropsData] = useState<NormalizedPlayerPropQuote[]>([]);
  const [slateScan, setSlateScan] = useState<PropSlateScanResponse | null>(null);
  const [viewMode, setViewMode] = useState<'SLATE' | 'EVENT'>('SLATE');
  const [isLoadingProps, setIsLoadingProps] = useState<boolean>(false);
  const [propsError, setPropsError] = useState<string | null>(null);
  const [quotaState, setQuotaState] = useState<MarketQuotaState | null>(null);
  const [auditDiag, setAuditDiag] = useState<PropPipelineAuditDiagnostic | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedBookmaker, setSelectedBookmaker] = useState<string>('ALL');
  const [selectedRecommendationFilter, setSelectedRecommendationFilter] = useState<
    'ALL' | 'QUALIFIES_ONLY' | 'NO_BET_ONLY'
  >('ALL');
  const [sortBy, setSortBy] = useState<
    'EV_DESC' | 'EDGE_DESC' | 'PROB_DESC' | 'RELIABILITY' | 'LINE_ASC' | 'BOOKMAKER'
  >('EV_DESC');
  const [oddsFormat, setOddsFormat] = useState<'AMERICAN' | 'DECIMAL'>('AMERICAN');
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null);
  const [expandedExplanationQuoteId, setExpandedExplanationQuoteId] = useState<string | null>(null);
  const [expandedDecisionQuoteId, setExpandedDecisionQuoteId] = useState<string | null>(null);

  // Negative Tests state
  const [isRunningTests, setIsRunningTests] = useState<boolean>(false);
  const [negativeTestsResult, setNegativeTestsResult] = useState<{
    allPassed: boolean;
    keyedRequestsConsumed: number;
    tests: PropNegativeTestResponse[];
  } | null>(null);

  const chicagoDate = (offsetDays = 0) => {
    const now = new Date();
    now.setDate(now.getDate() + offsetDays);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  };
  const todayChicago = chicagoDate(0);
  const tomorrowChicago = chicagoDate(1);
  const dateMode = selectedDate === todayChicago ? 'TODAY' : selectedDate === tomorrowChicago ? 'TOMORROW' : 'CUSTOM';

  const eventChicagoDate = (value: string | null | undefined) => {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(parsed);
  };

  // Filter available upcoming games based on sport AND the active Props slate date.
  // The explicit date match prevents old-slate events from flashing while App.tsx
  // is fetching the newly selected schedule.
  const eligibleGames = useMemo(() => {
    return games.filter((g) => {
      const sportMatch = selectedSport === 'ALL' || g.sport === selectedSport;
      const isUpcoming = g.status === 'UPCOMING';
      const eventDate = eventChicagoDate(g.startTime || g.scheduleDate);
      return sportMatch && isUpcoming && eventDate === selectedDate;
    });
  }, [games, selectedSport, selectedDate]);

  // Slate-first by default. A deep link can intentionally open one event, but
  // ordinary Props use never requires stepping through every event dropdown.
  useEffect(() => {
    const deepLinked = initialSelectedGameId && eligibleGames.some((g) => g.eventId === initialSelectedGameId)
      ? initialSelectedGameId
      : null;
    if (deepLinked) {
      setSelectedGameId(deepLinked);
      setViewMode('EVENT');
      return;
    }
    if (selectedGameId && !eligibleGames.some((g) => g.eventId === selectedGameId)) {
      setSelectedGameId('');
      setViewMode('SLATE');
    }
  }, [eligibleGames, selectedGameId, initialSelectedGameId]);

  // A date/sport change starts a fresh slate view. This prevents a prior event's
  // props from masquerading as results for the newly selected slate.
  useEffect(() => {
    if (initialSelectedGameId) return;
    setSelectedGameId('');
    setViewMode('SLATE');
    setPropsData([]);
    setSlatePropsData([]);
    setSlateScan(null);
    setPropsError(null);
    setSelectedCategory('ALL');
    setSelectedBookmaker('ALL');
  }, [selectedDate, selectedSport, initialSelectedGameId]);

  const currentGame = useMemo(() => {
    return games.find((g) => g.eventId === selectedGameId) || null;
  }, [games, selectedGameId]);

  const gameByEventId = useMemo(() => new Map(eligibleGames.map((g) => [g.eventId, g])), [eligibleGames]);
  const eventTitleForQuote = (quote: NormalizedPlayerPropQuote) => {
    const g = gameByEventId.get(quote.apexEventId);
    if (!g) return `${quote.verifiedTeam} vs ${quote.verifiedOpponent}`;
    return g.sport === 'TENNIS'
      ? `${g.playerAName || 'Player A'} vs ${g.playerBName || 'Player B'}`
      : `${g.awayTeam || 'Away'} @ ${g.homeTeam || 'Home'}`;
  };

  // Fetch Props for selected game
  const fetchPropsForGame = useCallback(async (game: NormalizedApexGame) => {
    setIsLoadingProps(true);
    setPropsError(null);

    try {
      const res = await fetch('/api/props/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game }),
      });

      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const data: EventPlayerPropsResponse = await res.json();
      if (data.status === 'SUCCESS') {
        setPropsData(data.props || []);
      } else {
        setPropsData([]);
        setPropsError(data.message || `No props returned (${data.status})`);
      }
      setQuotaState(data.quotaState);
    } catch (err: any) {
      console.error('[PropsView] Error fetching props:', err);
      setPropsError(err.message || 'Failed to fetch player props');
      setPropsData([]);
    } finally {
      setIsLoadingProps(false);
    }
  }, []);

  // Scan a quota-controlled slice of the entire selected Props slate.
  // This is the primary discovery path; event-by-event fetch remains drill-down only.
  const scanPropsSlate = useCallback(async () => {
    setIsLoadingProps(true);
    setPropsError(null);
    setSelectedGameId('');
    setViewMode('SLATE');
    try {
      const res = await fetch('/api/props/slate-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          games: eligibleGames,
          selectedDate,
          sportFilter: selectedSport,
          maxEvents: 8,
        }),
      });
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      const data: PropSlateScanResponse = await res.json();
      setSlateScan(data);
      setSlatePropsData(data.props || []);
      setPropsData(data.props || []);
      setQuotaState(data.quotaState);
      if (data.status !== 'SUCCESS') {
        setPropsError(data.message || `No props returned across slate (${data.status})`);
      }
    } catch (err: any) {
      console.error('[PropsView] Slate scan failed:', err);
      setSlateScan(null);
      setSlatePropsData([]);
      setPropsData([]);
      setPropsError(err?.message || 'Failed to scan player-prop slate');
    } finally {
      setIsLoadingProps(false);
    }
  }, [eligibleGames, selectedDate, selectedSport]);

  // Fetch audit diagnostics
  const fetchAuditData = useCallback(async () => {
    try {
      const res = await fetch('/api/props/audit');
      if (res.ok) {
        const data = await res.json();
        setAuditDiag(data.audit);
        setQuotaState(data.quota);
      }
    } catch (err) {
      console.warn('[PropsView] Failed to fetch audit:', err);
    }
  }, []);

  // Run Negative Tests
  const runNegativeTests = async () => {
    setIsRunningTests(true);
    try {
      const res = await fetch('/api/props/negative-tests');
      if (res.ok) {
        const data = await res.json();
        setNegativeTestsResult(data);
      }
    } catch (err: any) {
      console.error('[PropsView] Failed to run negative tests:', err);
    } finally {
      setIsRunningTests(false);
      fetchAuditData();
    }
  };

  // Event drill-down fetches only after the user explicitly chooses an event.
  useEffect(() => {
    if (viewMode === 'EVENT' && currentGame) {
      fetchPropsForGame(currentGame);
    }
    fetchAuditData();
  }, [currentGame, viewMode, fetchPropsForGame, fetchAuditData]);

  // Derived filter categories and bookmakers
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    propsData.forEach((p) => {
      if (p.marketCategory) set.add(p.marketCategory);
    });
    return Array.from(set).sort();
  }, [propsData]);

  const availableBookmakers = useMemo(() => {
    const set = new Set<string>();
    propsData.forEach((p) => {
      if (p.bookmakerTitle) set.add(p.bookmakerTitle);
    });
    return Array.from(set).sort();
  }, [propsData]);

  // Filtered and Sorted props
  const filteredProps = useMemo(() => {
    const filtered = propsData.filter((p) => {
      // Category filter
      if (selectedCategory !== 'ALL' && p.marketCategory !== selectedCategory) {
        return false;
      }
      // Bookmaker filter
      if (selectedBookmaker !== 'ALL' && p.bookmakerTitle !== selectedBookmaker) {
        return false;
      }
      // Recommendation status filter
      if (selectedRecommendationFilter !== 'ALL') {
        const recStatus = p.valueAnalysis?.bestRecommendation?.recommendationStatus;
        if (selectedRecommendationFilter === 'QUALIFIES_ONLY' && recStatus !== 'QUALIFIES') {
          return false;
        }
        if (selectedRecommendationFilter === 'NO_BET_ONLY' && recStatus === 'QUALIFIES') {
          return false;
        }
      }
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = p.playerDisplayName.toLowerCase().includes(q);
        const teamMatch = p.verifiedTeam.toLowerCase().includes(q);
        const catMatch = p.marketCategory.toLowerCase().includes(q);
        const posMatch = (p.playerPosition || '').toLowerCase().includes(q);
        if (!nameMatch && !teamMatch && !catMatch && !posMatch) {
          return false;
        }
      }
      return true;
    });

    // Sorting logic
    return filtered.sort((a, b) => {
      if (sortBy === 'EV_DESC') {
        const maxEVA = Math.max(
          a.valueAnalysis?.overAnalysis?.expectedValuePercent ?? -999,
          a.valueAnalysis?.underAnalysis?.expectedValuePercent ?? -999
        );
        const maxEVB = Math.max(
          b.valueAnalysis?.overAnalysis?.expectedValuePercent ?? -999,
          b.valueAnalysis?.underAnalysis?.expectedValuePercent ?? -999
        );
        return maxEVB - maxEVA;
      }
      if (sortBy === 'EDGE_DESC') {
        const maxEdgeA = Math.max(
          a.valueAnalysis?.overAnalysis?.modelEdgePercentagePoints ?? -999,
          a.valueAnalysis?.underAnalysis?.modelEdgePercentagePoints ?? -999
        );
        const maxEdgeB = Math.max(
          b.valueAnalysis?.overAnalysis?.modelEdgePercentagePoints ?? -999,
          b.valueAnalysis?.underAnalysis?.modelEdgePercentagePoints ?? -999
        );
        return maxEdgeB - maxEdgeA;
      }
      if (sortBy === 'PROB_DESC') {
        const maxProbA = Math.max(
          a.probabilityAnalysis?.apexOverProbability ?? 0,
          a.probabilityAnalysis?.apexUnderProbability ?? 0
        );
        const maxProbB = Math.max(
          b.probabilityAnalysis?.apexOverProbability ?? 0,
          b.probabilityAnalysis?.apexUnderProbability ?? 0
        );
        return maxProbB - maxProbA;
      }
      if (sortBy === 'RELIABILITY') {
        const score = (tier?: string) => {
          if (tier === 'STRONG') return 4;
          if (tier === 'MODERATE') return 3;
          if (tier === 'LIMITED') return 2;
          return 1;
        };
        const relA = score(a.probabilityAnalysis?.components?.sampleReliabilityTier);
        const relB = score(b.probabilityAnalysis?.components?.sampleReliabilityTier);
        return relB - relA;
      }
      if (sortBy === 'LINE_ASC') {
        return a.line - b.line;
      }
      if (sortBy === 'BOOKMAKER') {
        return a.bookmakerTitle.localeCompare(b.bookmakerTitle);
      }
      return 0;
    });
  }, [propsData, selectedCategory, selectedBookmaker, selectedRecommendationFilter, searchQuery, sortBy]);

  const qualifiedRankedProps = useMemo(() => canonicalQualifiedPropQuotes(propsData), [propsData]);

  const topQualifiedProp = qualifiedRankedProps[0] || null;

  const slateCoverageBySport = useMemo(() => {
    if (!slateScan) return [];
    const grouped = new Map<string, { sport: string; events: number; props: number; qualified: number; noProps: number }>();
    for (const row of slateScan.eventResults || []) {
      const current = grouped.get(row.sport) || { sport: row.sport, events: 0, props: 0, qualified: 0, noProps: 0 };
      current.events += 1;
      current.props += row.propsCount;
      current.qualified += row.qualifiedCount;
      if (row.propsCount === 0) current.noProps += 1;
      grouped.set(row.sport, current);
    }
    for (const sport of slateScan.unsupportedSports || []) {
      if (!grouped.has(sport)) grouped.set(sport, { sport, events: 0, props: 0, qualified: 0, noProps: 0 });
    }
    return [...grouped.values()];
  }, [slateScan]);

  const formatDecisionOdds = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : v > 0 ? `+${v}` : `${v}`;

  return (
    <div id="props-module-root" className="space-y-6">
      {/* Top Banner & Header */}
      <div
        id="props-header-card"
        className="bg-slate-900/90 border border-slate-800/80 rounded-xl p-6 relative overflow-hidden backdrop-blur-sm"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md uppercase tracking-wide">
                Stage 3B: Verified Pipeline
              </span>
              <span className="px-2.5 py-0.5 text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-md flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                ESPN Roster Verified
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
              <Users className="w-6 h-6 text-cyan-400" />
              Provider-First Player Props
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl">
              Strict real-market prop quotes only. Every player identity is verified against official team rosters and event participants. Synthetic players and hallucinated models are strictly prohibited.
            </p>
          </div>

          {/* Quick Actions & Odds Toggle */}
          <div className="flex flex-wrap items-center gap-3">
            {/* American / Decimal Toggle */}
            <div className="flex items-center bg-slate-800/80 p-1 rounded-lg border border-slate-700/60">
              <button
                id="toggle-odds-american"
                onClick={() => setOddsFormat('AMERICAN')}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  oddsFormat === 'AMERICAN'
                    ? 'bg-cyan-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                American (-110)
              </button>
              <button
                id="toggle-odds-decimal"
                onClick={() => setOddsFormat('DECIMAL')}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  oddsFormat === 'DECIMAL'
                    ? 'bg-cyan-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Decimal (1.91)
              </button>
            </div>

            <button
              id="refresh-props-btn"
              onClick={() => viewMode === 'EVENT' && currentGame ? fetchPropsForGame(currentGame) : scanPropsSlate()}
              disabled={isLoadingProps || (viewMode === 'EVENT' ? !currentGame : eligibleGames.length === 0)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingProps ? 'animate-spin text-cyan-400' : ''}`} />
              {viewMode === 'EVENT' ? 'Refresh Event Props' : 'Scan Slate for Props'}
            </button>
          </div>
        </div>

        {/* Live Diagnostics Pill Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-slate-800/60 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-slate-400">Props Loaded:</span>
            <span className="font-semibold text-slate-200">{propsData.length} Quotes</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-cyan-400" />
            <span className="text-slate-400">Roster Resolution:</span>
            <span className="font-semibold text-emerald-400">100% Verified</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-indigo-400" />
            <span className="text-slate-400">Cache Deduplication:</span>
            <span className="font-semibold text-slate-200">
              {auditDiag?.cacheHits || 0} Hits / {auditDiag?.cacheMisses || 0} Misses
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-slate-400">Daily Quota Used:</span>
            <span className="font-semibold text-slate-200 font-mono">
              {quotaState ? `${quotaState.dailyUsed} / ${quotaState.dailyHardLimit}` : 'Active'}
            </span>
          </div>
        </div>
      </div>

      {/* Decision-first summary: qualified picks before deep analytics */}
      {!isLoadingProps && !propsError && propsData.length > 0 && (
        <div id="props-decision-center" className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-extrabold text-white">Apex Decision Center</h2>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Production-qualified opportunities ranked by model probability first, then expected value. Deep analysis remains below.
              </p>
            </div>
            <div className={`rounded-lg border px-3 py-2 text-xs font-bold ${qualifiedRankedProps.length > 0 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-900 text-slate-400'}`}>
              {qualifiedRankedProps.length > 0 ? `${qualifiedRankedProps.length} QUALIFIED` : 'NO QUALIFIED BETS'}
            </div>
          </div>

          {topQualifiedProp ? (() => {
            const rec = topQualifiedProp.valueAnalysis!.bestRecommendation;
            const a = rec.selectedAnalysis!;
            const reliability = topQualifiedProp.probabilityAnalysis?.components?.sampleReliabilityTier ?? 'UNKNOWN';
            return (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/15 p-4 sm:p-5">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black tracking-wider text-emerald-300">#1 HIGH-PROBABILITY QUALIFIED PICK</span>
                      <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-slate-300">{reliability} DATA</span>
                    </div>
                    <div className="text-xl sm:text-2xl font-extrabold text-white">
                      {formatPropSelectionLabel(topQualifiedProp.playerDisplayName, topQualifiedProp.providerMarketKey || topQualifiedProp.marketCategory, rec.side, topQualifiedProp.line)}
                    </div>
                    <div className="text-sm text-slate-300 mt-1">
                      {topQualifiedProp.marketCategory} · {a.sportsbook} {formatDecisionOdds(a.oddsAmerican)}
                    </div>
                    {viewMode === 'SLATE' && (
                      <div className="text-xs text-cyan-300/80 mt-1">{eventTitleForQuote(topQualifiedProp)} · {topQualifiedProp.sport}</div>
                    )}
                    <div className="text-xs text-slate-400 mt-2">
                      It qualifies because the production gate passed identity, provenance, freshness, point-in-time integrity, probability, edge and EV requirements.
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 min-w-full lg:min-w-[430px]">
                    <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3"><div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Probability</div><div className="text-xl font-extrabold font-mono text-emerald-300">{a.apexProbability !== null ? `${(a.apexProbability * 100).toFixed(1)}%` : '—'}</div></div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3"><div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">EV</div><div className="text-xl font-extrabold font-mono text-white">{a.expectedValuePercent !== null ? `${a.expectedValuePercent >= 0 ? '+' : ''}${a.expectedValuePercent.toFixed(1)}%` : '—'}</div></div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3"><div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Edge</div><div className="text-xl font-extrabold font-mono text-white">{a.modelEdgePercentagePoints !== null ? `${a.modelEdgePercentagePoints >= 0 ? '+' : ''}${a.modelEdgePercentagePoints.toFixed(1)} pp` : '—'}</div></div>
                  </div>
                </div>
              </div>
            );
          })() : (
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-5 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
              <div><div className="font-bold text-white">{viewMode === 'SLATE' ? 'PASS scanned slate' : 'PASS this event'}</div><div className="text-xs text-slate-400 mt-1">Apex found no prop that clears the production recommendation gate. A blank recommendation is intentional—not a reason to force a pick.</div></div>
            </div>
          )}

          {qualifiedRankedProps.length > 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {qualifiedRankedProps.slice(1, 3).map((p, idx) => {
                const rec = p.valueAnalysis!.bestRecommendation;
                const a = rec.selectedAnalysis!;
                return (
                  <div key={p.quoteId} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 flex items-center justify-between gap-3">
                    <div><div className="text-[10px] text-slate-500 font-bold">#{idx + 2} QUALIFIED</div><div className="text-sm font-bold text-white">{formatPropSelectionLabel(p.playerDisplayName, p.providerMarketKey || p.marketCategory, rec.side, p.line)}</div><div className="text-[10px] text-slate-400">{viewMode === 'SLATE' ? `${eventTitleForQuote(p)} · ` : ''}{a.sportsbook} {formatDecisionOdds(a.oddsAmerican)}</div></div>
                    <div className="text-right"><div className="font-mono text-lg font-extrabold text-emerald-300">{a.apexProbability !== null ? `${(a.apexProbability * 100).toFixed(1)}%` : '—'}</div><div className="text-[10px] text-slate-400">EV {a.expectedValuePercent !== null ? `${a.expectedValuePercent >= 0 ? '+' : ''}${a.expectedValuePercent.toFixed(1)}%` : '—'}</div></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sport Selector Chips */}
      <div id="props-sport-chips" className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {(['ALL', 'MLB', 'NFL', 'NBA', 'WNBA', 'NHL', 'SOCCER', 'TENNIS'] as ApexSportFilter[]).map((sport) => {
          const isSelected = selectedSport === sport;
          return (
            <button
              key={sport}
              id={`props-sport-${sport.toLowerCase()}`}
              onClick={() => setSelectedSport(sport)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap border ${
                isSelected
                  ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 shadow-sm shadow-cyan-500/10'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {sport === 'ALL' ? 'All Sports' : sport}
            </button>
          );
        })}
      </div>

      {/* Props Slate Date Controls */}
      <div id="props-date-toolbar" className="rounded-xl border border-slate-800/80 bg-slate-900/70 p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
              <Calendar className="w-4 h-4 text-cyan-400" />
              Props Slate:
            </div>
            <button
              id="props-date-today"
              onClick={() => setSelectedDate(todayChicago)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${dateMode === 'TODAY' ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200' : 'border-slate-700 bg-slate-950/70 text-slate-400 hover:text-slate-200'}`}
            >
              Today
            </button>
            <button
              id="props-date-tomorrow"
              onClick={() => setSelectedDate(tomorrowChicago)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${dateMode === 'TOMORROW' ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200' : 'border-slate-700 bg-slate-950/70 text-slate-400 hover:text-slate-200'}`}
            >
              Tomorrow
            </button>
            <input
              id="props-date-picker"
              type="date"
              value={selectedDate}
              min={todayChicago}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-xs font-mono text-slate-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div className="text-xs text-slate-400">
            <span className="font-mono text-slate-300">{selectedDate}</span>
            <span className="mx-2 text-slate-700">•</span>
            <span>{eligibleGames.length} verified upcoming event{eligibleGames.length === 1 ? '' : 's'} on this props slate</span>
          </div>
        </div>
        {dateMode === 'TOMORROW' && (
          <div className="mt-2 text-[11px] text-amber-300/90">
            Tomorrow's player-prop inventory can be thinner until sportsbooks publish player markets. Game ML / spread / total markets may appear earlier.
          </div>
        )}
      </div>

      {/* Slate-first discovery action */}
      <div id="props-slate-discovery" className="rounded-xl border border-cyan-500/20 bg-cyan-950/10 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-sm font-extrabold text-white">Find player props across the whole selected slate</div>
          <div className="text-xs text-slate-400 mt-1">Apex scans up to 8 prop-capable upcoming events in a quota-controlled, multi-sport rotation. The event dropdown below is optional drill-down.</div>
          {selectedSport === 'TENNIS' && (
            <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              Tennis schedule coverage is active, but this build has no verified tennis <b>player-prop</b> connector. You do not need to inspect the 96 match dropdown one by one; Apex will fail closed rather than pretend match markets are player props.
            </div>
          )}
          {slateScan && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-2 text-[10px] font-mono">
                <span className="rounded border border-slate-700 bg-slate-950/70 px-2 py-1 text-slate-300">{slateScan.eventsScanned}/{slateScan.eventsAvailable} scheduled events scanned</span>
                <span className="rounded border border-slate-700 bg-slate-950/70 px-2 py-1 text-slate-300">{slateScan.propCapableEvents} prop-capable events</span>
                <span className="rounded border border-slate-700 bg-slate-950/70 px-2 py-1 text-slate-300">{slateScan.propsCount} distinct props</span>
                <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-300">{slateScan.qualifiedCount} qualified</span>
                {slateScan.unsupportedSports.length > 0 && (
                  <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-300">No player-prop connector: {slateScan.unsupportedSports.join(', ')}</span>
                )}
              </div>
              {slateCoverageBySport.length > 0 && (
                <div className="flex flex-wrap gap-2 text-[10px]">
                  {slateCoverageBySport.map((row) => (
                    <span key={row.sport} className={`rounded border px-2 py-1 ${row.qualified > 0 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : row.events === 0 ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-slate-700 bg-slate-950/60 text-slate-400'}`}>
                      <b>{row.sport}</b> · {row.events} scanned · {row.props} props · {row.qualified} qualified
                    </span>
                  ))}
                </div>
              )}
              {slateScan.message && <div className="text-[11px] text-slate-400">{slateScan.message}</div>}
            </div>
          )}
        </div>
        <button
          id="scan-props-slate-btn"
          onClick={scanPropsSlate}
          disabled={isLoadingProps || eligibleGames.length === 0}
          className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500 px-5 py-3 text-sm font-black text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoadingProps && viewMode === 'SLATE' ? 'animate-spin' : ''}`} />
          Scan Slate for Best Props
        </button>
      </div>

      {/* Event Selection & Filtering Control Bar */}
      <div
        id="props-filter-bar"
        className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-4 space-y-3"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Game Selector */}
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Optional Event Drill-down · Leave on All Scanned Events to browse the whole slate
            </label>
            <div className="relative">
              <select
                id="props-game-select"
                value={selectedGameId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedGameId(nextId);
                  if (nextId) {
                    setViewMode('EVENT');
                    setPropsError(null);
                  } else {
                    setViewMode('SLATE');
                    setPropsData(slatePropsData);
                    setPropsError(slateScan?.status === 'SUCCESS' ? null : (slateScan?.message || null));
                  }
                }}
                disabled={eligibleGames.length === 0}
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500 transition-colors disabled:opacity-50 appearance-none pr-10"
              >
                {eligibleGames.length === 0 ? (
                  <option value="">No upcoming games currently on slate</option>
                ) : (
                  <>
                    <option value="">All Scanned Events · Slate View</option>
                    {eligibleGames.map((g) => {
                    const title =
                      g.sport === 'TENNIS'
                        ? `${g.playerAName} vs ${g.playerBName} (${g.tournamentName || 'Tennis'})`
                        : `${g.awayTeam} @ ${g.homeTeam} (${g.sport})`;
                    const time = g.startTime ? new Date(g.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Scheduled';
                    return (
                      <option key={g.eventId} value={g.eventId}>
                        {title} • {time}
                      </option>
                    );
                    })}
                  </>
                )}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
          </div>

          {/* Player / Team Search */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Search Player / Category
            </label>
            <div className="relative">
              <input
                id="props-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search athlete, team, position..."
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Filter Chips: Category & Bookmakers */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mr-2">
            <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
            <span>Category:</span>
          </div>

          <button
            onClick={() => setSelectedCategory('ALL')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              selectedCategory === 'ALL'
                ? 'bg-slate-700 text-white font-semibold'
                : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            All Categories ({propsData.length})
          </button>

          {availableCategories.map((cat) => {
            const count = propsData.filter((p) => p.marketCategory === cat).length;
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                  isSelected
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                    : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}

          {availableBookmakers.length > 1 && (
            <div className="ml-auto flex items-center gap-2 text-xs">
              <span className="text-slate-400">Sportsbook:</span>
              <select
                value={selectedBookmaker}
                onChange={(e) => setSelectedBookmaker(e.target.value)}
                className="bg-slate-950 border border-slate-700/80 rounded px-2 py-1 text-xs text-slate-200"
              >
                <option value="ALL">All Sportsbooks</option>
                {availableBookmakers.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Stage 3C-3: Recommendation Status Filters & Ranking/Sorting Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-slate-800/60 text-xs">
          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium flex items-center gap-1">
              <Scale className="w-3.5 h-3.5 text-cyan-400" />
              Recommendation Gate:
            </span>
            <div className="flex items-center bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
              <button
                onClick={() => setSelectedRecommendationFilter('ALL')}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                  selectedRecommendationFilter === 'ALL'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All ({propsData.length})
              </button>
              <button
                onClick={() => setSelectedRecommendationFilter('QUALIFIES_ONLY')}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-all flex items-center gap-1 ${
                  selectedRecommendationFilter === 'QUALIFIES_ONLY'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-emerald-400'
                }`}
              >
                <CheckCircle2 className="w-3 h-3" />
                Qualifies Only ({qualifiedRankedProps.length})
              </button>
              <button
                onClick={() => setSelectedRecommendationFilter('NO_BET_ONLY')}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                  selectedRecommendationFilter === 'NO_BET_ONLY'
                    ? 'bg-slate-800 text-amber-300 border border-amber-500/30'
                    : 'text-slate-400 hover:text-amber-400'
                }`}
              >
                No Bet ({propsData.filter((p) => p.valueAnalysis?.bestRecommendation?.recommendationStatus === 'NO_BET').length})
              </button>
            </div>
          </div>

          {/* Sort Selector */}
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium flex items-center gap-1">
              <Percent className="w-3.5 h-3.5 text-cyan-400" />
              Sort By:
            </span>
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="EV_DESC">Expected Value (EV% High → Low)</option>
              <option value="EDGE_DESC">Model Edge (High → Low)</option>
              <option value="PROB_DESC">Apex Probability (High → Low)</option>
              <option value="RELIABILITY">Data Reliability Tier (Strong First)</option>
              <option value="LINE_ASC">Target Line (Low → High)</option>
              <option value="BOOKMAKER">Sportsbook (A → Z)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Props Content Area */}
      {isLoadingProps ? (
        <div
          id="props-loading-indicator"
          className="bg-slate-900/60 border border-slate-800 rounded-xl p-12 text-center"
        >
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-cyan-500/10 text-cyan-400 mb-3 animate-pulse">
            <RefreshCw className="w-6 h-6 animate-spin" />
          </div>
          <h3 className="text-base font-semibold text-slate-200">
            Querying Market Provider & Resolving Official Rosters...
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Retrieving real sportsbook market lines and verifying athlete identities against official ESPN rosters to ensure 100% data integrity.
          </p>
        </div>
      ) : propsError ? (
        <div
          id="props-error-container"
          className="bg-slate-900/60 border border-amber-500/20 rounded-xl p-8 text-center"
        >
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-500/10 text-amber-400 mb-3">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-semibold text-slate-200">{viewMode === 'SLATE' ? 'No Props Found Across Scanned Slate' : 'No Props Available for This Event'}</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-lg mx-auto">{propsError}</p>
        </div>
      ) : filteredProps.length === 0 ? (
        <div
          id="props-empty-container"
          className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center"
        >
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-800 text-slate-400 mb-3">
            <Users className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-semibold text-slate-300">
            {searchQuery || selectedCategory !== 'ALL'
              ? 'No props match the active filters'
              : viewMode === 'SLATE' ? 'No player props returned across scanned slate' : 'No player props returned by provider'}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {searchQuery || selectedCategory !== 'ALL'
              ? 'Try adjusting your search query or selecting "All Categories".'
              : viewMode === 'SLATE' ? 'No verified player propositions were returned across the scanned events. Future inventories may not be posted yet.' : 'The market provider has not published player proposition lines for this event yet.'}
          </p>
        </div>
      ) : (
        <div id="props-grid-container" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProps.map((quote) => {
            const isExpanded = expandedQuoteId === quote.quoteId;

            // Formatted odds
            const overOddsFormatted =
              quote.overOddsAmerican !== null
                ? oddsFormat === 'AMERICAN'
                  ? `${quote.overOddsAmerican > 0 ? '+' : ''}${quote.overOddsAmerican}`
                  : `${quote.overOddsDecimal?.toFixed(2)}`
                : null;

            const underOddsFormatted =
              quote.underOddsAmerican !== null
                ? oddsFormat === 'AMERICAN'
                  ? `${quote.underOddsAmerican > 0 ? '+' : ''}${quote.underOddsAmerican}`
                  : `${quote.underOddsDecimal?.toFixed(2)}`
                : null;

            const yesOddsFormatted =
              quote.yesOddsAmerican !== null && quote.yesOddsAmerican !== undefined
                ? oddsFormat === 'AMERICAN'
                  ? `${quote.yesOddsAmerican > 0 ? '+' : ''}${quote.yesOddsAmerican}`
                  : `${quote.yesOddsDecimal?.toFixed(2)}`
                : null;

            return (
              <div
                key={quote.quoteId}
                id={`prop-card-${quote.quoteId}`}
                className="bg-slate-900/90 border border-slate-800/90 hover:border-cyan-500/40 rounded-xl p-4 flex flex-col justify-between transition-all shadow-sm group"
              >
                {/* Card Top: Player Info & Badges */}
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-base font-bold text-slate-100 group-hover:text-cyan-300 transition-colors">
                          {quote.playerDisplayName}
                        </h4>
                        {quote.playerPosition && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 rounded">
                            {quote.playerPosition}
                            {quote.playerJersey ? ` #${quote.playerJersey}` : ''}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                        <span className="text-slate-300 font-medium">{quote.verifiedTeam}</span>
                        <span className="text-slate-500">vs</span>
                        <span>{quote.verifiedOpponent}</span>
                      </div>
                      {viewMode === 'SLATE' && (
                        <div className="text-[10px] text-cyan-300/70 mt-1">{eventTitleForQuote(quote)} · {quote.sport}</div>
                      )}
                    </div>

                    {/* Sportsbook Badge */}
                    <span className="px-2 py-1 text-[11px] font-semibold bg-slate-800/90 text-cyan-400 border border-slate-700/80 rounded-md">
                      {quote.bookmakerTitle}
                    </span>
                  </div>

                  {/* Market & Line Header */}
                  <div className="flex items-center justify-between bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 mt-3 mb-3">
                    <div className="flex items-center gap-1.5">
                      <Flame className="w-4 h-4 text-cyan-400" />
                      <span className="text-xs font-semibold text-slate-200">
                        {humanizePropMarket(quote.providerMarketKey || quote.marketCategory)}
                      </span>
                    </div>
                    <span className="text-xs font-mono font-bold text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/50">
                      Line: {quote.line}
                    </span>
                  </div>

                  {/* Pricing Outcomes (Over / Under or Yes) */}
                  <div className="grid grid-cols-2 gap-2">
                    {overOddsFormatted && (
                      <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg text-center">
                        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          {humanizePropMarket(quote.providerMarketKey || quote.marketCategory)} · Over {quote.line}
                        </div>
                        <div className="text-sm font-bold font-mono text-emerald-400 mt-0.5">
                          {overOddsFormatted}
                        </div>
                        {quote.overOddsDecimal && (
                          <div className="text-[10px] text-slate-500 font-mono mt-1 pt-1 border-t border-slate-900">
                            <span className="block text-[9px] uppercase tracking-wider text-slate-500 font-semibold">SPORTSBOOK IMPLIED PROBABILITY</span>
                            <span className="text-slate-300 font-bold">{((1 / quote.overOddsDecimal) * 100).toFixed(1)}%</span>
                          </div>
                        )}
                      </div>
                    )}

                    {underOddsFormatted && (
                      <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg text-center">
                        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          {humanizePropMarket(quote.providerMarketKey || quote.marketCategory)} · Under {quote.line}
                        </div>
                        <div className="text-sm font-bold font-mono text-amber-400 mt-0.5">
                          {underOddsFormatted}
                        </div>
                        {quote.underOddsDecimal && (
                          <div className="text-[10px] text-slate-500 font-mono mt-1 pt-1 border-t border-slate-900">
                            <span className="block text-[9px] uppercase tracking-wider text-slate-500 font-semibold">SPORTSBOOK IMPLIED PROBABILITY</span>
                            <span className="text-slate-300 font-bold">{((1 / quote.underOddsDecimal) * 100).toFixed(1)}%</span>
                          </div>
                        )}
                      </div>
                    )}

                    {!underOddsFormatted && yesOddsFormatted && (
                      <div className="col-span-2 bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg text-center">
                        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          Yes / Anytime
                        </div>
                        <div className="text-sm font-bold font-mono text-emerald-400 mt-0.5">
                          {yesOddsFormatted}
                        </div>
                        {quote.yesOddsDecimal && (
                          <div className="text-[10px] text-slate-500 font-mono mt-1 pt-1 border-t border-slate-900">
                            <span className="block text-[9px] uppercase tracking-wider text-slate-500 font-semibold">SPORTSBOOK IMPLIED PROBABILITY</span>
                            <span className="text-slate-300 font-bold">{((1 / quote.yesOddsDecimal) * 100).toFixed(1)}%</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Stage 3C-1: Historical Performance & Hit Rate Breakdown */}
                  {quote.historicalStats && (
                    <div className="mt-3 pt-3 border-t border-slate-800/80">
                      {quote.historicalStats.status === 'STATS_VERIFIED' || quote.historicalStats.status === 'LIMITED_SAMPLE' ? (
                        <div className="space-y-2.5">
                          {/* Performance Header */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                              <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                              <span>HISTORICAL PERFORMANCE</span>
                            </div>
                            <span
                              className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${
                                quote.historicalStats.status === 'STATS_VERIFIED'
                                  ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50'
                                  : 'bg-amber-950/60 text-amber-400 border-amber-800/50'
                              }`}
                            >
                              {quote.historicalStats.status === 'STATS_VERIFIED'
                                ? 'STATS VERIFIED'
                                : `LIMITED SAMPLE (L${quote.historicalStats.l5SampleCount})`}
                            </span>
                          </div>

                          {/* 3-Column Performance Grid */}
                          <div className="grid grid-cols-3 gap-1.5">
                            {/* L5 Metric */}
                            <div className="bg-slate-950/60 border border-slate-800/80 p-2 rounded-lg text-center">
                              <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                                L5 Avg
                              </div>
                              <div className="text-sm font-bold font-mono text-slate-100 mt-0.5">
                                {quote.historicalStats.l5Average !== null ? quote.historicalStats.l5Average.toFixed(2) : 'N/A'}
                              </div>
                              <div className="text-[10px] font-mono font-semibold text-emerald-400 mt-1">
                                {quote.historicalStats.l5OverHitRate !== null
                                  ? `${(quote.historicalStats.l5OverHitRate * 100).toFixed(0)}% Over`
                                  : 'N/A'}
                              </div>
                              <div className="text-[9px] font-mono text-slate-500">
                                {quote.historicalStats.l5OverCount}W-{quote.historicalStats.l5UnderCount}L
                                {quote.historicalStats.l5PushCount > 0 ? `-${quote.historicalStats.l5PushCount}P` : ''}
                              </div>
                            </div>

                            {/* L10 Metric */}
                            <div className="bg-slate-950/60 border border-slate-800/80 p-2 rounded-lg text-center">
                              <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                                L10 Avg
                              </div>
                              <div className="text-sm font-bold font-mono text-slate-100 mt-0.5">
                                {quote.historicalStats.l10Average !== null ? quote.historicalStats.l10Average.toFixed(2) : 'N/A'}
                              </div>
                              <div className="text-[10px] font-mono font-semibold text-emerald-400 mt-1">
                                {quote.historicalStats.l10OverHitRate !== null
                                  ? `${(quote.historicalStats.l10OverHitRate * 100).toFixed(0)}% Over`
                                  : 'N/A'}
                              </div>
                              <div className="text-[9px] font-mono text-slate-500">
                                {quote.historicalStats.l10OverCount}W-{quote.historicalStats.l10UnderCount}L
                                {quote.historicalStats.l10PushCount > 0 ? `-${quote.historicalStats.l10PushCount}P` : ''}
                              </div>
                            </div>

                            {/* Season Metric */}
                            <div className="bg-slate-950/60 border border-slate-800/80 p-2 rounded-lg text-center">
                              <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                                Season ({quote.historicalStats.seasonSampleCount}G)
                              </div>
                              <div className="text-sm font-bold font-mono text-slate-100 mt-0.5">
                                {quote.historicalStats.seasonAverage !== null ? quote.historicalStats.seasonAverage.toFixed(2) : 'N/A'}
                              </div>
                              <div className="text-[10px] font-mono font-semibold text-emerald-400 mt-1">
                                {quote.historicalStats.seasonOverHitRate !== null
                                  ? `${(quote.historicalStats.seasonOverHitRate * 100).toFixed(0)}% Over`
                                  : 'N/A'}
                              </div>
                              <div className="text-[9px] font-mono text-slate-500">
                                {quote.historicalStats.seasonOverCount}W-{quote.historicalStats.seasonUnderCount}L
                                {quote.historicalStats.seasonPushCount > 0 ? `-${quote.historicalStats.seasonPushCount}P` : ''}
                              </div>
                            </div>
                          </div>

                          {/* Recent Game Log Strip */}
                          {quote.historicalStats.recentGameLogs && quote.historicalStats.recentGameLogs.length > 0 && (
                            <div className="bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
                              <div className="text-[10px] font-medium text-slate-400 mb-1.5 flex items-center justify-between">
                                <span>Recent Games (Latest → Oldest):</span>
                                <span className="text-[9px] text-slate-500 font-mono">Line: {quote.line}</span>
                              </div>
                              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                                {quote.historicalStats.recentGameLogs.slice(0, 5).map((game, idx) => {
                                  const isOver = game.resultAgainstLine === 'OVER';
                                  const isPush = game.resultAgainstLine === 'PUSH';
                                  const bgClass = isPush
                                    ? 'bg-slate-800 text-slate-300 border-slate-700'
                                    : isOver
                                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/70'
                                    : 'bg-amber-950/80 text-amber-300 border-amber-800/70';

                                  return (
                                    <div
                                      key={game.eventId || idx}
                                      className={`px-2 py-1 rounded border text-[10px] font-mono font-bold flex items-center gap-1 flex-shrink-0 ${bgClass}`}
                                      title={`${game.gameDate || ''} vs ${game.opponent || ''} — Raw: ${game.statValue}`}
                                    >
                                      <span>{game.statValue}</span>
                                      <span className="text-[8px] opacity-80">
                                        {isPush ? 'P' : isOver ? 'O' : 'U'}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        /* Stats Unavailable Banner */
                        <div className="p-2.5 bg-slate-950/60 border border-slate-800/70 rounded-lg text-center">
                          <div className="text-[11px] font-bold text-slate-400">
                            {quote.historicalStats.status === 'STAT_MAPPING_UNAVAILABLE'
                              ? 'STAT MAPPING UNAVAILABLE'
                              : 'STATS UNAVAILABLE'}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {quote.historicalStats.statusMessage ||
                              'Official ESPN historical game log not available for this market category'}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Stage 3C-2: Transparent Probability Model Section */}
                  {quote.probabilityAnalysis && (
                    <div className="mt-3 pt-3 border-t border-slate-800/80">
                      {quote.probabilityAnalysis.isAvailable && quote.probabilityAnalysis.components ? (
                        <div className="space-y-2.5">
                          {/* Probability Section Header */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                              <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                              <span>PROBABILITY ANALYSIS</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${
                                  quote.probabilityAnalysis.components.sampleReliabilityTier === 'STRONG'
                                    ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50'
                                    : quote.probabilityAnalysis.components.sampleReliabilityTier === 'MODERATE'
                                    ? 'bg-cyan-950/60 text-cyan-400 border-cyan-800/50'
                                    : quote.probabilityAnalysis.components.sampleReliabilityTier === 'LIMITED'
                                    ? 'bg-amber-950/60 text-amber-400 border-amber-800/50'
                                    : 'bg-rose-950/60 text-rose-400 border-rose-800/50'
                                }`}
                              >
                                {quote.probabilityAnalysis.components.sampleReliabilityTier} DATA
                              </span>
                              <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border bg-slate-900 text-cyan-300 border-slate-700">
                                {quote.probabilityAnalysis.modelVersion}
                              </span>
                            </div>
                          </div>

                          {/* Probability Cards Grid */}
                          <div className="grid grid-cols-2 gap-2">
                            {/* Apex Model Over / Under */}
                            <div className="bg-slate-950/80 border border-cyan-900/40 p-2.5 rounded-lg space-y-1.5">
                              <div className="flex items-center justify-between text-[10px] font-medium text-slate-400">
                                <span className="text-cyan-400 font-bold uppercase tracking-wider">
                                  APEX MODEL PROBABILITY
                                </span>
                                <span className="text-[9px] text-slate-500 font-mono">Sum: 100%</span>
                              </div>
                              <div className="flex items-baseline justify-between font-mono">
                                <div>
                                  <span className="text-[10px] text-slate-400 block">P(Over)</span>
                                  <span className="text-base font-extrabold text-cyan-300">
                                    {(quote.probabilityAnalysis.apexOverProbability! * 100).toFixed(1)}%
                                  </span>
                                </div>
                                <div className="text-right">
                                  <span className="text-[10px] text-slate-400 block">P(Under)</span>
                                  <span className="text-base font-extrabold text-slate-200">
                                    {(quote.probabilityAnalysis.apexUnderProbability! * 100).toFixed(1)}%
                                  </span>
                                </div>
                              </div>
                              {quote.probabilityAnalysis.components.isIntegerLine &&
                                quote.probabilityAnalysis.apexPushProbability! > 0 && (
                                  <div className="text-[10px] font-mono text-amber-400/90 text-center border-t border-slate-800/80 pt-1">
                                    Push Probability: {(quote.probabilityAnalysis.apexPushProbability! * 100).toFixed(1)}%
                                  </div>
                                )}
                            </div>

                            {/* Sportsbook Implied Probabilities */}
                            <div className="bg-slate-950/80 border border-slate-800/90 p-2.5 rounded-lg space-y-1.5">
                              <div className="flex items-center justify-between text-[10px] font-medium text-slate-400">
                                <span className="text-slate-300 font-bold uppercase tracking-wider">
                                  SPORTSBOOK IMPLIED
                                </span>
                                <span className="text-[9px] text-slate-500 font-mono">
                                  {quote.probabilityAnalysis.marketImplied?.bookmakerVig !== null
                                    ? `Vig: ${(quote.probabilityAnalysis.marketImplied!.bookmakerVig! * 100).toFixed(1)}%`
                                    : 'Single-Sided'}
                                </span>
                              </div>
                              <div className="flex items-baseline justify-between font-mono">
                                <div>
                                  <span className="text-[10px] text-slate-400 block">No-Vig Over</span>
                                  <span className="text-sm font-bold text-slate-300">
                                    {quote.probabilityAnalysis.marketImplied?.noVigOverProbability !== null
                                      ? `${(quote.probabilityAnalysis.marketImplied!.noVigOverProbability! * 100).toFixed(1)}%`
                                      : 'N/A'}
                                  </span>
                                  <span className="text-[9px] text-slate-500 block">
                                    Raw: {quote.probabilityAnalysis.marketImplied?.rawOverImplied !== null
                                      ? `${(quote.probabilityAnalysis.marketImplied!.rawOverImplied! * 100).toFixed(1)}%`
                                      : 'N/A'}
                                  </span>
                                </div>
                                <div className="text-right">
                                  <span className="text-[10px] text-slate-400 block">No-Vig Under</span>
                                  <span className="text-sm font-bold text-slate-300">
                                    {quote.probabilityAnalysis.marketImplied?.noVigUnderProbability !== null
                                      ? `${(quote.probabilityAnalysis.marketImplied!.noVigUnderProbability! * 100).toFixed(1)}%`
                                      : 'N/A'}
                                  </span>
                                  <span className="text-[9px] text-slate-500 block">
                                    Raw: {quote.probabilityAnalysis.marketImplied?.rawUnderImplied !== null
                                      ? `${(quote.probabilityAnalysis.marketImplied!.rawUnderImplied! * 100).toFixed(1)}%`
                                      : 'N/A'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* MLB Pitcher Strikeouts V3 Shadow — audit only, never production decision input */}
                          {quote.probabilityAnalysis.mlbPitcherKShadow && (
                            <div className="bg-slate-950/80 border border-violet-900/50 p-2.5 rounded-lg space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-[10px] font-bold tracking-wider text-violet-300">
                                  MLB K V3 SHADOW — AUDIT ONLY
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900 text-[9px] font-bold text-slate-300">
                                    {quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.dataQuality}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded border border-violet-800/60 bg-violet-950/40 text-[9px] font-bold text-violet-300">
                                    {quote.probabilityAnalysis.mlbPitcherKShadow.boosted.status}
                                  </span>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px] font-mono">
                                <div className="rounded border border-slate-800 bg-slate-900/60 p-1.5">
                                  <div className="text-slate-500">Production Over</div>
                                  <div className="font-bold text-cyan-300">
                                    {quote.probabilityAnalysis.mlbPitcherKShadow.productionOverProbability !== null
                                      ? `${(quote.probabilityAnalysis.mlbPitcherKShadow.productionOverProbability * 100).toFixed(1)}%`
                                      : 'N/A'}
                                  </div>
                                </div>
                                <div className="rounded border border-slate-800 bg-slate-900/60 p-1.5">
                                  <div className="text-slate-500">V3 Shadow Over</div>
                                  <div className="font-bold text-violet-300">
                                    {quote.probabilityAnalysis.mlbPitcherKShadow.shadowOverProbability !== null
                                      ? `${(quote.probabilityAnalysis.mlbPitcherKShadow.shadowOverProbability * 100).toFixed(1)}%`
                                      : 'N/A'}
                                  </div>
                                </div>
                                <div className="rounded border border-slate-800 bg-slate-900/60 p-1.5">
                                  <div className="text-slate-500">Expected Ks</div>
                                  <div className="font-bold text-slate-200">
                                    {quote.probabilityAnalysis.mlbPitcherKShadow.negativeBinomial.expectedStrikeouts?.toFixed(2) ?? 'N/A'}
                                  </div>
                                </div>
                                <div className="rounded border border-slate-800 bg-slate-900/60 p-1.5">
                                  <div className="text-slate-500">Expected BF</div>
                                  <div className="font-bold text-slate-200">
                                    {quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.expectedBattersFaced?.toFixed(1) ?? 'N/A'}
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[9px] font-mono text-slate-400">
                                <div>Workload: <span className="text-slate-200">{quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.workloadSource}</span></div>
                                <div>K/BF L10: <span className="text-slate-200">{quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.l10StrikeoutsPerBF !== null ? `${(quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.l10StrikeoutsPerBF * 100).toFixed(1)}%` : 'N/A'}</span></div>
                                <div>Opp K%: <span className="text-slate-200">{quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.opponentStrikeoutRate !== null ? `${(quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.opponentStrikeoutRate * 100).toFixed(1)}%` : 'N/A'}</span></div>
                                <div>CSW%: <span className="text-slate-200">{quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.recentCswRate !== null ? `${(quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.recentCswRate * 100).toFixed(1)}%` : 'N/A'}</span></div>
                                <div>SwStr%: <span className="text-slate-200">{quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.recentSwStrRate !== null ? `${(quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.recentSwStrRate * 100).toFixed(1)}%` : 'N/A'}</span></div>
                                <div>Velo Δ: <span className="text-slate-200">{quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.velocityDeltaMph !== null ? `${quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.velocityDeltaMph > 0 ? '+' : ''}${quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.velocityDeltaMph.toFixed(1)} mph` : 'N/A'}</span></div>
                                <div>Official BF starts: <span className="text-slate-200">{quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.officialBattersFacedStarts}</span></div>
                                <div>Feature ID: <span className="text-slate-500">{quote.probabilityAnalysis.mlbPitcherKShadow.featureVector.featureVectorId.slice(-8)}</span></div>
                              </div>

                              <div className="text-[9px] text-amber-300/90 border-t border-slate-800 pt-1.5">
                                Shadow output does not drive BET/PASS. Promotion requires verified chronological holdout improvement and official workload coverage.
                              </div>
                            </div>
                          )}

                          {/* Expandable "WHY THIS PROBABILITY?" Button */}
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedExplanationQuoteId(
                                  expandedExplanationQuoteId === quote.quoteId ? null : quote.quoteId
                                )
                              }
                              className="w-full py-1.5 px-2.5 rounded-lg bg-slate-900/90 border border-slate-800 hover:bg-slate-800/80 transition-all flex items-center justify-between text-xs font-mono font-medium text-cyan-300"
                            >
                              <div className="flex items-center gap-1.5">
                                <Calculator className="w-3.5 h-3.5 text-cyan-400" />
                                <span>WHY THIS PROBABILITY? (Inspect Math)</span>
                              </div>
                              {expandedExplanationQuoteId === quote.quoteId ? (
                                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                              )}
                            </button>

                            {/* Detailed Math Breakdown Dropdown */}
                            {expandedExplanationQuoteId === quote.quoteId && (
                              <div className="mt-2 p-3 bg-slate-950 rounded-lg border border-cyan-900/40 text-[11px] font-mono space-y-2.5 text-slate-300">
                                <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider border-b border-slate-800 pb-1 flex justify-between">
                                  <span>Deterministic Formula Components</span>
                                  <span className="text-slate-400">APEX_BASELINE_V1</span>
                                </div>

                                {/* Step 1: Season Baseline */}
                                <div className="space-y-1 bg-slate-900/60 p-2 rounded border border-slate-800">
                                  <div className="flex justify-between font-semibold text-slate-200">
                                    <span>1. Season Baseline (Over):</span>
                                    <span className="text-cyan-300">
                                      {(quote.probabilityAnalysis.components.seasonBaselineOver * 100).toFixed(2)}%
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-slate-400 space-y-0.5">
                                    <div>
                                      &bull; Empirical Hit Rate ({quote.probabilityAnalysis.components.seasonSampleCount}G):{' '}
                                      <strong className="text-slate-200">
                                        {(quote.probabilityAnalysis.components.seasonEmpiricalHitRate * 100).toFixed(1)}%
                                      </strong>{' '}
                                      &times; 70% wt ={' '}
                                      {(
                                        quote.probabilityAnalysis.components.seasonEmpiricalHitRate *
                                        0.7 *
                                        100
                                      ).toFixed(2)}%
                                    </div>
                                    <div>
                                      &bull; Distribution Projection (Mean {quote.probabilityAnalysis.components.seasonMean.toFixed(2)}, &sigma; {quote.probabilityAnalysis.components.seasonStdDev.toFixed(2)} vs Line {quote.line}):{' '}
                                      <strong className="text-slate-200">
                                        {(quote.probabilityAnalysis.components.seasonDistributionEstimate * 100).toFixed(1)}%
                                      </strong>{' '}
                                      &times; 30% wt ={' '}
                                      {(
                                        quote.probabilityAnalysis.components.seasonDistributionEstimate *
                                        0.3 *
                                        100
                                      ).toFixed(2)}%
                                    </div>
                                  </div>
                                </div>

                                {/* Step 2: Nested Recency Adjustments */}
                                <div className="space-y-1 bg-slate-900/60 p-2 rounded border border-slate-800">
                                  <div className="flex justify-between font-semibold text-slate-200">
                                    <span>2. Nested Recency Adjustments:</span>
                                    <span className="text-emerald-400 font-bold">
                                      {((quote.probabilityAnalysis.components.l10Adjustment + quote.probabilityAnalysis.components.l5Adjustment) * 100) >= 0 ? '+' : ''}
                                      {(
                                        (quote.probabilityAnalysis.components.l10Adjustment +
                                          quote.probabilityAnalysis.components.l5Adjustment) *
                                        100
                                      ).toFixed(2)}%
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-slate-400 space-y-0.5">
                                    <div>
                                      &bull; L10 Delta ({quote.probabilityAnalysis.components.l10SampleCount}G):{' '}
                                      {(quote.probabilityAnalysis.components.l10EmpiricalHitRate * 100).toFixed(1)}% -{' '}
                                      {(quote.probabilityAnalysis.components.seasonEmpiricalHitRate * 100).toFixed(1)}% ={' '}
                                      {(
                                        (quote.probabilityAnalysis.components.l10EmpiricalHitRate -
                                          quote.probabilityAnalysis.components.seasonEmpiricalHitRate) *
                                        100
                                      ).toFixed(1)}%{' '}
                                      &times; {(quote.probabilityAnalysis.components.l10Weight * 100).toFixed(1)}% wt &rarr;{' '}
                                      <strong className="text-slate-200">
                                        {(quote.probabilityAnalysis.components.l10Adjustment * 100).toFixed(2)}%
                                      </strong>
                                    </div>
                                    <div>
                                      &bull; L5 Short-Term Momentum ({quote.probabilityAnalysis.components.l5SampleCount}G):{' '}
                                      {(quote.probabilityAnalysis.components.l5EmpiricalHitRate * 100).toFixed(1)}% -{' '}
                                      {(quote.probabilityAnalysis.components.l10EmpiricalHitRate * 100).toFixed(1)}% ={' '}
                                      {(
                                        (quote.probabilityAnalysis.components.l5EmpiricalHitRate -
                                          quote.probabilityAnalysis.components.l10EmpiricalHitRate) *
                                        100
                                      ).toFixed(1)}%{' '}
                                      &times; {(quote.probabilityAnalysis.components.l5Weight * 100).toFixed(1)}% wt &rarr;{' '}
                                      <strong className="text-slate-200">
                                        {(quote.probabilityAnalysis.components.l5Adjustment * 100).toFixed(2)}%
                                      </strong>
                                    </div>
                                  </div>
                                </div>

                                {/* Step 3: Historical Model Sum */}
                                <div className="flex justify-between py-1 border-b border-slate-800 text-[11px]">
                                  <span className="text-slate-400">3. Combined Historical Over:</span>
                                  <span className="font-bold text-slate-100">
                                    {(quote.probabilityAnalysis.components.historicalOverProbability * 100).toFixed(2)}%
                                  </span>
                                </div>

                                {/* Step 4: Market Blending */}
                                <div className="space-y-1 bg-slate-900/60 p-2 rounded border border-slate-800">
                                  <div className="flex justify-between font-semibold text-slate-200">
                                    <span>4. Market Stabilization Blending:</span>
                                    <span className="text-cyan-300">
                                      {(quote.probabilityAnalysis.components.rawBlendedOverProbability * 100).toFixed(2)}%
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-slate-400 space-y-0.5">
                                    <div>
                                      &bull; Historical Component ({quote.probabilityAnalysis.components.sampleReliabilityTier} Reliability):{' '}
                                      {(quote.probabilityAnalysis.components.historicalOverProbability * 100).toFixed(1)}% &times;{' '}
                                      {(quote.probabilityAnalysis.components.historicalWeight * 100).toFixed(0)}% wt
                                    </div>
                                    <div>
                                      &bull; Sportsbook No-Vig Over Anchor:{' '}
                                      {quote.probabilityAnalysis.components.marketNoVigOverProbability !== null
                                        ? `${(quote.probabilityAnalysis.components.marketNoVigOverProbability * 100).toFixed(1)}% × ${(quote.probabilityAnalysis.components.marketWeight * 100).toFixed(0)}% wt`
                                        : 'N/A — single-sided quote excluded from model blend'}
                                    </div>
                                  </div>
                                </div>

                                {/* Step 5: Clamping & Final Bounds */}
                                <div className="flex justify-between text-[10px] text-slate-400 pt-1">
                                  <span>
                                    Bounds Clamp [{(quote.probabilityAnalysis.components.clampedMinBound * 100).toFixed(2)}%, {(quote.probabilityAnalysis.components.clampedMaxBound * 100).toFixed(2)}%]:
                                  </span>
                                  <span className="text-slate-200 font-mono">
                                    {quote.probabilityAnalysis.components.boundsApplied ? 'CLAMPED' : 'Within Bounds (Pass)'}
                                  </span>
                                </div>

                                <div className="flex justify-between text-[10px] text-slate-400">
                                  <span>Push Handling:</span>
                                  <span className="text-slate-200 font-mono">
                                    {quote.probabilityAnalysis.components.isIntegerLine
                                      ? `Integer Line &rarr; P(Push) = ${(quote.probabilityAnalysis.components.pushProbability * 100).toFixed(1)}%`
                                      : 'Half-Integer Line &rarr; P(Push) = 0.0%'}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Model Status & Disclaimer Banner */}
                          <div className="p-1.5 bg-slate-950/60 border border-slate-800/80 rounded text-[9px] font-mono text-slate-400 flex items-center justify-between">
                            <span className="text-amber-400 font-bold">
                              BASELINE MODEL &bull; NOT YET BACKTEST OPTIMIZED
                            </span>
                            <span className="text-slate-400 font-medium">
                              Stage 3C-2: Probabilities Only (No Bets / No EV)
                            </span>
                          </div>
                        </div>
                      ) : (
                        /* Model Unavailable Banner */
                        <div className="p-2.5 bg-slate-950/60 border border-slate-800/70 rounded-lg text-center">
                          <div className="text-[11px] font-bold text-rose-400">
                            MODEL UNAVAILABLE — INSUFFICIENT VERIFIED DATA
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {quote.probabilityAnalysis.unavailabilityReason ||
                              'Missing required verified player identity, line, odds, or historical game logs'}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Stage 3C-3: Edge, EV, Line Shopping & Recommendation Engine */}
                  {quote.valueAnalysis && (
                    <div className="mt-3 pt-3 border-t border-slate-800/80">
                      <div className="space-y-2.5">
                        {/* Recommendation Header & Status */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                            <Scale className="w-3.5 h-3.5 text-cyan-400" />
                            <span>VALUE ANALYSIS & RECOMMENDATION</span>
                          </div>
                          {quote.valueAnalysis.bestRecommendation.recommendationStatus === 'QUALIFIES' ? (
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 shadow-sm shadow-emerald-500/10">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              QUALIFIES ({quote.valueAnalysis.bestRecommendation.side})
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-slate-800/80 text-amber-300/90 border border-amber-500/30 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-amber-400" />
                              NO BET
                            </span>
                          )}
                        </div>

                        {/* Active Reason Codes Banner for NO BET */}
                        {quote.valueAnalysis.bestRecommendation.recommendationStatus === 'NO_BET' &&
                          quote.valueAnalysis.bestRecommendation.reasonCodes.length > 0 && (
                            <div className="flex flex-wrap gap-1 items-center">
                              <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider mr-1">
                                Reason Codes:
                              </span>
                              {quote.valueAnalysis.bestRecommendation.reasonCodes.map((code) => (
                                <span
                                  key={code}
                                  className="px-1.5 py-0.5 text-[9px] font-mono font-bold rounded bg-slate-950 border border-slate-800 text-slate-400"
                                >
                                  {code.replace(/_/g, ' ')}
                                </span>
                              ))}
                            </div>
                          )}

                        {/* 2-Column Side-by-Side Economics Grid (Over vs Under) */}
                        <div className="grid grid-cols-2 gap-2">
                          {/* OVER Side Valuation */}
                          {quote.valueAnalysis.overAnalysis && (
                            <div
                              className={`p-2.5 rounded-lg border text-xs transition-all ${
                                quote.valueAnalysis.overAnalysis.recommendationStatus === 'QUALIFIES'
                                  ? 'bg-emerald-950/30 border-emerald-600/50 shadow-sm'
                                  : 'bg-slate-950/60 border-slate-800/80'
                              }`}
                            >
                              <div className="flex items-center justify-between font-bold text-[11px] pb-1 border-b border-slate-800/60">
                                <span className="text-slate-300">OVER {quote.line}</span>
                                <span className="font-mono text-cyan-400">
                                  {quote.overOddsAmerican !== null
                                    ? quote.overOddsAmerican > 0
                                      ? `+${quote.overOddsAmerican}`
                                      : `${quote.overOddsAmerican}`
                                    : 'N/A'}
                                </span>
                              </div>

                              <div className="space-y-1 mt-1.5 font-mono text-[10px]">
                                <div className="flex justify-between text-slate-400">
                                  <span>Apex Model Prob:</span>
                                  <span className="text-slate-200 font-bold">
                                    {quote.valueAnalysis.overAnalysis.apexProbability !== null
                                      ? `${(quote.valueAnalysis.overAnalysis.apexProbability * 100).toFixed(2)}%`
                                      : 'N/A'}
                                  </span>
                                </div>

                                <div className="flex justify-between text-slate-400">
                                  <span>Break-Even Req:</span>
                                  <span className="text-slate-300">
                                    {quote.valueAnalysis.overAnalysis.breakEvenProbability !== null
                                      ? `${(quote.valueAnalysis.overAnalysis.breakEvenProbability * 100).toFixed(2)}%`
                                      : 'N/A'}
                                  </span>
                                </div>

                                <div className="flex justify-between pt-0.5 border-t border-slate-900">
                                  <span className="text-slate-400">Model Edge:</span>
                                  <span
                                    className={`font-bold ${
                                      (quote.valueAnalysis.overAnalysis.modelEdgePercentagePoints ?? 0) >= 0
                                        ? 'text-emerald-400'
                                        : 'text-rose-400'
                                    }`}
                                  >
                                    {quote.valueAnalysis.overAnalysis.modelEdgePercentagePoints !== null
                                      ? `${quote.valueAnalysis.overAnalysis.modelEdgePercentagePoints > 0 ? '+' : ''}${quote.valueAnalysis.overAnalysis.modelEdgePercentagePoints.toFixed(2)} pp`
                                      : 'N/A'}
                                  </span>
                                </div>

                                <div className="flex justify-between">
                                  <span className="text-slate-400">Expected Value:</span>
                                  <span
                                    className={`font-bold ${
                                      (quote.valueAnalysis.overAnalysis.expectedValuePercent ?? 0) >= 0
                                        ? 'text-emerald-400'
                                        : 'text-rose-400'
                                    }`}
                                  >
                                    {quote.valueAnalysis.overAnalysis.expectedValuePercent !== null
                                      ? `${quote.valueAnalysis.overAnalysis.expectedValuePercent > 0 ? '+' : ''}${quote.valueAnalysis.overAnalysis.expectedValuePercent.toFixed(2)}%`
                                      : 'N/A'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* UNDER Side Valuation */}
                          {quote.valueAnalysis.underAnalysis && (
                            <div
                              className={`p-2.5 rounded-lg border text-xs transition-all ${
                                quote.valueAnalysis.underAnalysis.recommendationStatus === 'QUALIFIES'
                                  ? 'bg-emerald-950/30 border-emerald-600/50 shadow-sm'
                                  : 'bg-slate-950/60 border-slate-800/80'
                              }`}
                            >
                              <div className="flex items-center justify-between font-bold text-[11px] pb-1 border-b border-slate-800/60">
                                <span className="text-slate-300">UNDER {quote.line}</span>
                                <span className="font-mono text-amber-400">
                                  {quote.underOddsAmerican !== null
                                    ? quote.underOddsAmerican > 0
                                      ? `+${quote.underOddsAmerican}`
                                      : `${quote.underOddsAmerican}`
                                    : 'N/A'}
                                </span>
                              </div>

                              <div className="space-y-1 mt-1.5 font-mono text-[10px]">
                                <div className="flex justify-between text-slate-400">
                                  <span>Apex Model Prob:</span>
                                  <span className="text-slate-200 font-bold">
                                    {quote.valueAnalysis.underAnalysis.apexProbability !== null
                                      ? `${(quote.valueAnalysis.underAnalysis.apexProbability * 100).toFixed(2)}%`
                                      : 'N/A'}
                                  </span>
                                </div>

                                <div className="flex justify-between text-slate-400">
                                  <span>Break-Even Req:</span>
                                  <span className="text-slate-300">
                                    {quote.valueAnalysis.underAnalysis.breakEvenProbability !== null
                                      ? `${(quote.valueAnalysis.underAnalysis.breakEvenProbability * 100).toFixed(2)}%`
                                      : 'N/A'}
                                  </span>
                                </div>

                                <div className="flex justify-between pt-0.5 border-t border-slate-900">
                                  <span className="text-slate-400">Model Edge:</span>
                                  <span
                                    className={`font-bold ${
                                      (quote.valueAnalysis.underAnalysis.modelEdgePercentagePoints ?? 0) >= 0
                                        ? 'text-emerald-400'
                                        : 'text-rose-400'
                                    }`}
                                  >
                                    {quote.valueAnalysis.underAnalysis.modelEdgePercentagePoints !== null
                                      ? `${quote.valueAnalysis.underAnalysis.modelEdgePercentagePoints > 0 ? '+' : ''}${quote.valueAnalysis.underAnalysis.modelEdgePercentagePoints.toFixed(2)} pp`
                                      : 'N/A'}
                                  </span>
                                </div>

                                <div className="flex justify-between">
                                  <span className="text-slate-400">Expected Value:</span>
                                  <span
                                    className={`font-bold ${
                                      (quote.valueAnalysis.underAnalysis.expectedValuePercent ?? 0) >= 0
                                        ? 'text-emerald-400'
                                        : 'text-rose-400'
                                    }`}
                                  >
                                    {quote.valueAnalysis.underAnalysis.expectedValuePercent !== null
                                      ? `${quote.valueAnalysis.underAnalysis.expectedValuePercent > 0 ? '+' : ''}${quote.valueAnalysis.underAnalysis.expectedValuePercent.toFixed(2)}%`
                                      : 'N/A'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Line Shopping Price Intelligence */}
                        <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80 text-[10px] font-mono text-slate-400 flex flex-wrap items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-300 font-semibold">Best Verified Price:</span>
                            {quote.valueAnalysis.lineShopping.bestOverQuote && (
                              <span className="text-cyan-300">
                                Over: {quote.valueAnalysis.lineShopping.bestOverQuote.sportsbook} (
                                {quote.valueAnalysis.lineShopping.bestOverQuote.oddsAmerican > 0
                                  ? `+${quote.valueAnalysis.lineShopping.bestOverQuote.oddsAmerican}`
                                  : quote.valueAnalysis.lineShopping.bestOverQuote.oddsAmerican}
                                )
                              </span>
                            )}
                            {quote.valueAnalysis.lineShopping.bestUnderQuote && (
                              <span className="text-amber-300 ml-1">
                                Under: {quote.valueAnalysis.lineShopping.bestUnderQuote.sportsbook} (
                                {quote.valueAnalysis.lineShopping.bestUnderQuote.oddsAmerican > 0
                                  ? `+${quote.valueAnalysis.lineShopping.bestUnderQuote.oddsAmerican}`
                                  : quote.valueAnalysis.lineShopping.bestUnderQuote.oddsAmerican}
                                )
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] text-slate-500">
                            {quote.valueAnalysis.lineShopping.availableBookmakers.length} Bookmakers Tracked
                          </span>
                        </div>

                        {/* Expandable "WHY THIS DECISION?" Accordion */}
                        <div className="border border-slate-800/80 rounded-lg overflow-hidden bg-slate-950/40">
                          <button
                            onClick={() =>
                              setExpandedDecisionQuoteId(
                                expandedDecisionQuoteId === quote.quoteId ? null : quote.quoteId
                              )
                            }
                            className="w-full px-3 py-2 text-[11px] font-semibold text-slate-300 hover:text-white flex items-center justify-between bg-slate-900/40 transition-colors"
                          >
                            <span className="flex items-center gap-1.5 text-cyan-300">
                              <HelpCircle className="w-3.5 h-3.5" />
                              WHY THIS DECISION? (Mathematical Gate Inspector)
                            </span>
                            {expandedDecisionQuoteId === quote.quoteId ? (
                              <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                            )}
                          </button>

                          {expandedDecisionQuoteId === quote.quoteId && (
                            <div className="p-3 bg-slate-950/90 border-t border-slate-800 space-y-2.5 font-mono text-[11px]">
                              {/* Step 1: Break-Even Math */}
                              <div className="space-y-1 bg-slate-900/60 p-2 rounded border border-slate-800">
                                <div className="font-semibold text-slate-200">
                                  1. Sportsbook Break-Even Probability:
                                </div>
                                <div className="text-[10px] text-slate-400 space-y-0.5">
                                  <div>
                                    &bull; Formula:{' '}
                                    <code className="text-cyan-300 font-bold">
                                      Odds &lt; 0 &rarr; |Odds| / (|Odds| + 100) &bull; Odds &gt; 0 &rarr; 100 / (Odds + 100)
                                    </code>
                                  </div>
                                  <div>
                                    &bull; Over ({quote.overOddsAmerican}): Break-Even ={' '}
                                    <strong className="text-slate-200">
                                      {quote.valueAnalysis.overAnalysis?.breakEvenProbability !== null
                                        ? `${(quote.valueAnalysis.overAnalysis.breakEvenProbability * 100).toFixed(2)}%`
                                        : 'N/A'}
                                    </strong>
                                  </div>
                                  <div>
                                    &bull; Under ({quote.underOddsAmerican}): Break-Even ={' '}
                                    <strong className="text-slate-200">
                                      {quote.valueAnalysis.underAnalysis?.breakEvenProbability !== null
                                        ? `${(quote.valueAnalysis.underAnalysis.breakEvenProbability * 100).toFixed(2)}%`
                                        : 'N/A'}
                                    </strong>
                                  </div>
                                </div>
                              </div>

                              {/* Step 2: Model Edge */}
                              <div className="space-y-1 bg-slate-900/60 p-2 rounded border border-slate-800">
                                <div className="font-semibold text-slate-200">
                                  2. Model Edge Calculation:
                                </div>
                                <div className="text-[10px] text-slate-400 space-y-0.5">
                                  <div>
                                    &bull; Formula:{' '}
                                    <code className="text-cyan-300 font-bold">
                                      Edge = Apex Model Probability - Break-Even Probability
                                    </code>
                                  </div>
                                  <div>
                                    &bull; Over Edge:{' '}
                                    {(quote.valueAnalysis.overAnalysis?.apexProbability ?? 0) * 100}% -{' '}
                                    {(quote.valueAnalysis.overAnalysis?.breakEvenProbability ?? 0) * 100}% ={' '}
                                    <strong
                                      className={
                                        (quote.valueAnalysis.overAnalysis?.modelEdgePercentagePoints ?? 0) >= 0
                                          ? 'text-emerald-400'
                                          : 'text-rose-400'
                                      }
                                    >
                                      {quote.valueAnalysis.overAnalysis?.modelEdgePercentagePoints !== null
                                        ? `${quote.valueAnalysis.overAnalysis.modelEdgePercentagePoints > 0 ? '+' : ''}${quote.valueAnalysis.overAnalysis.modelEdgePercentagePoints.toFixed(2)} pp`
                                        : 'N/A'}
                                    </strong>
                                  </div>
                                  <div>
                                    &bull; Under Edge:{' '}
                                    {(quote.valueAnalysis.underAnalysis?.apexProbability ?? 0) * 100}% -{' '}
                                    {(quote.valueAnalysis.underAnalysis?.breakEvenProbability ?? 0) * 100}% ={' '}
                                    <strong
                                      className={
                                        (quote.valueAnalysis.underAnalysis?.modelEdgePercentagePoints ?? 0) >= 0
                                          ? 'text-emerald-400'
                                          : 'text-rose-400'
                                      }
                                    >
                                      {quote.valueAnalysis.underAnalysis?.modelEdgePercentagePoints !== null
                                        ? `${quote.valueAnalysis.underAnalysis.modelEdgePercentagePoints > 0 ? '+' : ''}${quote.valueAnalysis.underAnalysis.modelEdgePercentagePoints.toFixed(2)} pp`
                                        : 'N/A'}
                                    </strong>
                                  </div>
                                </div>
                              </div>

                              {/* Step 3: Expected Value Math */}
                              <div className="space-y-1 bg-slate-900/60 p-2 rounded border border-slate-800">
                                <div className="font-semibold text-slate-200">
                                  3. Expected Value (1-Unit Stake):
                                </div>
                                <div className="text-[10px] text-slate-400 space-y-0.5">
                                  <div>
                                    &bull; Formula:{' '}
                                    <code className="text-cyan-300 font-bold">
                                      EV = P(win) &times; (DecimalOdds - 1) - P(loss) &times; 1
                                    </code>
                                  </div>
                                  <div>
                                    &bull; Over EV%:{' '}
                                    <strong
                                      className={
                                        (quote.valueAnalysis.overAnalysis?.expectedValuePercent ?? 0) >= 0
                                          ? 'text-emerald-400'
                                          : 'text-rose-400'
                                      }
                                    >
                                      {quote.valueAnalysis.overAnalysis?.expectedValuePercent !== null
                                        ? `${quote.valueAnalysis.overAnalysis.expectedValuePercent > 0 ? '+' : ''}${quote.valueAnalysis.overAnalysis.expectedValuePercent.toFixed(2)}%`
                                        : 'N/A'}
                                    </strong>
                                  </div>
                                  <div>
                                    &bull; Under EV%:{' '}
                                    <strong
                                      className={
                                        (quote.valueAnalysis.underAnalysis?.expectedValuePercent ?? 0) >= 0
                                          ? 'text-emerald-400'
                                          : 'text-rose-400'
                                      }
                                    >
                                      {quote.valueAnalysis.underAnalysis?.expectedValuePercent !== null
                                        ? `${quote.valueAnalysis.underAnalysis.expectedValuePercent > 0 ? '+' : ''}${quote.valueAnalysis.underAnalysis.expectedValuePercent.toFixed(2)}%`
                                        : 'N/A'}
                                    </strong>
                                  </div>
                                </div>
                              </div>

                              {/* Step 4: Decision Gate Checklist */}
                              <div className="space-y-1.5 bg-slate-900/80 p-2.5 rounded border border-slate-800 text-[10px]">
                                <div className="font-semibold text-slate-200 flex items-center justify-between">
                                  <span>4. Recommendation Gate Thresholds:</span>
                                  <span className="text-[9px] text-cyan-400">Conservative Baseline</span>
                                </div>

                                <div className="space-y-1 text-slate-300">
                                  <div className="flex justify-between">
                                    <span>&bull; Data Reliability Tier:</span>
                                    <span
                                      className={
                                        quote.probabilityAnalysis?.components?.sampleReliabilityTier === 'STRONG' ||
                                        quote.probabilityAnalysis?.components?.sampleReliabilityTier === 'MODERATE'
                                          ? 'text-emerald-400 font-bold'
                                          : 'text-rose-400 font-bold'
                                      }
                                    >
                                      {quote.probabilityAnalysis?.components?.sampleReliabilityTier} (Min: MODERATE)
                                    </span>
                                  </div>

                                  <div className="flex justify-between">
                                    <span>&bull; Positive EV Required (EV &gt; 0):</span>
                                    <span
                                      className={
                                        (quote.valueAnalysis.bestRecommendation.selectedAnalysis?.expectedValue ?? 0) > 0
                                          ? 'text-emerald-400 font-bold'
                                          : 'text-rose-400 font-bold'
                                      }
                                    >
                                      {(quote.valueAnalysis.bestRecommendation.selectedAnalysis?.expectedValue ?? 0) > 0
                                        ? 'PASS'
                                        : 'FAIL'}
                                    </span>
                                  </div>

                                  <div className="flex justify-between">
                                    <span>&bull; Minimum EV Threshold (+3.0%):</span>
                                    <span
                                      className={
                                        (quote.valueAnalysis.bestRecommendation.selectedAnalysis?.expectedValuePercent ?? 0) >= 3.0
                                          ? 'text-emerald-400 font-bold'
                                          : 'text-amber-400 font-bold'
                                      }
                                    >
                                      {quote.valueAnalysis.bestRecommendation.selectedAnalysis?.expectedValuePercent !== null
                                        ? `${quote.valueAnalysis.bestRecommendation.selectedAnalysis.expectedValuePercent.toFixed(2)}%`
                                        : 'N/A'}{' '}
                                      (Target: &ge; +3.0%)
                                    </span>
                                  </div>

                                  <div className="flex justify-between">
                                    <span>&bull; Minimum Model Edge (+3.0 pp):</span>
                                    <span
                                      className={
                                        (quote.valueAnalysis.bestRecommendation.selectedAnalysis?.modelEdgePercentagePoints ?? 0) >= 3.0
                                          ? 'text-emerald-400 font-bold'
                                          : 'text-amber-400 font-bold'
                                      }
                                    >
                                      {quote.valueAnalysis.bestRecommendation.selectedAnalysis?.modelEdgePercentagePoints !== null
                                        ? `${quote.valueAnalysis.bestRecommendation.selectedAnalysis.modelEdgePercentagePoints.toFixed(2)} pp`
                                        : 'N/A'}{' '}
                                      (Target: &ge; +3.0 pp)
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Status & Scope Disclaimer */}
                        <div className="p-1.5 bg-slate-950/60 border border-slate-800/80 rounded text-[9px] font-mono text-slate-400 flex items-center justify-between">
                          <span className="text-amber-400 font-bold">
                            BASELINE THRESHOLDS &bull; NOT YET BACKTEST OPTIMIZED
                          </span>
                          <span className="text-slate-400 font-medium">
                            Stage 3C-3: Probabilities + Economics (No Kelly / No Parlays)
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Card Footer: Verification Badges & Provenance Accordion */}
                <div className="mt-4 pt-3 border-t border-slate-800/80">
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1 text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span className="font-medium">Roster Verified</span>
                    </div>

                    <button
                      onClick={() => setExpandedQuoteId(isExpanded ? null : quote.quoteId)}
                      className="text-slate-400 hover:text-slate-200 flex items-center gap-1 font-medium transition-colors"
                    >
                      <span>Provenance</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* Expanded Provenance Data */}
                  {isExpanded && (
                    <div className="mt-3 p-2.5 bg-slate-950/90 rounded-lg border border-slate-800/80 text-[10px] text-slate-400 space-y-1.5 font-mono">
                      <div className="flex justify-between">
                        <span>Athlete ID:</span>
                        <span className="text-slate-200">{quote.playerId || 'Draw Match'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Roster Source:</span>
                        <span className="text-slate-200">{quote.rosterSource}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Market Provider:</span>
                        <span className="text-slate-200">{quote.marketSource}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Market Key:</span>
                        <span className="text-cyan-400">{quote.providerMarketKey}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Provider Update:</span>
                        <span className="text-slate-200">
                          {new Date(quote.providerTimestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Cache Status:</span>
                        <span className="text-emerald-400 font-bold">{quote.cacheStatus}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Roster Integrity & Negative Tests Audit Panel */}
      <div
        id="props-negative-tests-card"
        className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              Roster Integrity & Negative Rejection Suite
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Executes deterministic negative test cases to prove players on wrong teams, fake athletes, and ambiguous names are strictly rejected without consuming keyed quota.
            </p>
          </div>

          <button
            id="run-negative-tests-btn"
            onClick={runNegativeTests}
            disabled={isRunningTests}
            className="flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded-lg transition-all disabled:opacity-50 shadow-sm shadow-cyan-500/20 whitespace-nowrap"
          >
            <Zap className={`w-3.5 h-3.5 ${isRunningTests ? 'animate-spin' : ''}`} />
            {isRunningTests ? 'Executing Tests...' : 'Run Negative Tests'}
          </button>
        </div>

        {negativeTestsResult && (
          <div className="space-y-3 pt-3 border-t border-slate-800">
            <div className="flex items-center justify-between text-xs bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    negativeTestsResult.allPassed ? 'bg-emerald-400' : 'bg-rose-400'
                  }`}
                />
                <span className="font-semibold text-slate-200">
                  {negativeTestsResult.allPassed
                    ? 'All 3 Integrity Tests PASSED'
                    : 'Integrity Test Failures Detected'}
                </span>
              </div>
              <span className="font-mono text-emerald-400">
                Keyed Quota Consumed: {negativeTestsResult.keyedRequestsConsumed}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {negativeTestsResult.tests.map((t, idx) => (
                <div
                  key={idx}
                  className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span className="text-slate-200">{t.testName}</span>
                    <span
                      className={`px-1.5 py-0.5 text-[10px] rounded font-bold ${
                        t.status === 'PASS'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    Input: <span className="text-slate-200">{t.inputPlayer}</span> ({t.inputGame})
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    Outcome: <span className="text-cyan-400 font-mono">{t.rejectionReason}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800/60 leading-relaxed">
                    {t.details}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
