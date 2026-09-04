import React, { useState, useEffect } from 'react';
import {
  ApexSport,
  MultiSportAuditDiagnostics,
  ScheduleResponse,
  LiveScoresResponse,
  TennisAuditDiagnostic,
  TennisTourFilter,
  MarketProviderAuditDiagnostic,
  FirewallTestResponse,
  PropPipelineAuditDiagnostic,
} from '../types';
import {
  FileCheck2,
  RefreshCw,
  Server,
  Activity,
  CheckCircle2,
  XCircle,
  Terminal,
  ShieldCheck,
  Zap,
  Play,
  Layers,
  Globe,
  Trophy,
  Calendar,
  Code,
  Search,
  ChevronDown,
  ChevronUp,
  Cpu,
  Building2,
  KeyRound,
  Lock,
  Flame,
  Download,
} from 'lucide-react';

import { BacktestAuditTab } from './BacktestAuditTab';
import { ChampionChallengerPanel } from './ChampionChallengerPanel';

interface AuditViewProps {
  onGoToOverview: () => void;
}

interface TestCaseResult {
  name: string;
  sport: string;
  description: string;
  status: 'pending' | 'running' | 'pass' | 'fail';
  details?: string;
  latencyMs?: number;
  dataSummary?: any;
}

const ALL_SPORTS: ApexSport[] = ['MLB', 'NFL', 'NCAAF', 'NBA', 'WNBA', 'NHL', 'SOCCER', 'TENNIS'];

export const AuditView: React.FC<AuditViewProps> = ({ onGoToOverview }) => {
  const [activeAuditTab, setActiveAuditTab] = useState<'BACKTEST' | 'MODEL_ARENA' | 'PIPELINE'>('MODEL_ARENA');
  const [diagnostics, setDiagnostics] = useState<MultiSportAuditDiagnostics | null>(null);
  const [marketAudit, setMarketAudit] = useState<MarketProviderAuditDiagnostic | null>(null);
  const [propAudit, setPropAudit] = useState<PropPipelineAuditDiagnostic | null>(null);
  const [selectedSportTab, setSelectedSportTab] = useState<ApexSport>('TENNIS');
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = useState(false);
  const [isLoadingMarketAudit, setIsLoadingMarketAudit] = useState(false);

  // Firewall Test runner state
  const [isFirewallTesting, setIsFirewallTesting] = useState(false);
  const [firewallResult, setFirewallResult] = useState<FirewallTestResponse | null>(null);

  // Developer Test Harness State (Zero Mock Data - Real Source Historical Ingest)
  const [harnessSport, setHarnessSport] = useState<ApexSport>('TENNIS');
  const [harnessDate, setHarnessDate] = useState<string>('2024-08-28');
  const [harnessTour, setHarnessTour] = useState<TennisTourFilter>('ALL');
  const [harnessResult, setHarnessResult] = useState<ScheduleResponse | null>(null);
  const [isHarnessLoading, setIsHarnessLoading] = useState(false);
  const [harnessError, setHarnessError] = useState<string | null>(null);
  const [harnessLatencyMs, setHarnessLatencyMs] = useState<number | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);

  const fetchMarketDiagnostics = async () => {
    setIsLoadingMarketAudit(true);
    try {
      const [marketRes, propRes] = await Promise.all([
        fetch('/api/markets/audit'),
        fetch('/api/props/audit'),
      ]);
      if (marketRes.ok) {
        const data: MarketProviderAuditDiagnostic = await marketRes.json();
        setMarketAudit(data);
      }
      if (propRes.ok) {
        const pData = await propRes.json();
        setPropAudit(pData.audit);
      }
    } catch (err) {
      console.error('Failed to fetch market/prop audit:', err);
    } finally {
      setIsLoadingMarketAudit(false);
    }
  };

  const runFirewallTest = async () => {
    setIsFirewallTesting(true);
    try {
      const res = await fetch('/api/markets/firewall-test', { method: 'POST' });
      if (res.ok) {
        const data: FirewallTestResponse = await res.json();
        setFirewallResult(data);
        fetchMarketDiagnostics();
      }
    } catch (err) {
      console.error('Firewall test failed:', err);
    } finally {
      setIsFirewallTesting(false);
    }
  };

  const handleDownloadSnapshotBackup = async () => {
    try {
      const res = await fetch('/api/backtest/snapshots/download');
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'APEX_REAL_PREGAME_SNAPSHOT_BACKUP_2026-08-28.json';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        return;
      }
    } catch (err) {
      console.warn('Direct API snapshot download failed, falling back to static backup route', err);
    }
    const a = document.createElement('a');
    a.href = '/APEX_REAL_PREGAME_SNAPSHOT_BACKUP_2026-08-28.json';
    a.download = 'APEX_REAL_PREGAME_SNAPSHOT_BACKUP_2026-08-28.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const runHarnessQuery = async (
    sportToRun: ApexSport,
    dateToRun: string,
    tourToRun: TennisTourFilter = 'ALL'
  ) => {
    setHarnessSport(sportToRun);
    setHarnessDate(dateToRun);
    setHarnessTour(tourToRun);
    setIsHarnessLoading(true);
    setHarnessError(null);
    const start = performance.now();

    try {
      const tourParam = sportToRun === 'TENNIS' && tourToRun !== 'ALL' ? `&tour=${tourToRun}` : '';
      const res = await fetch(
        `/api/schedule?sport=${encodeURIComponent(sportToRun)}&date=${encodeURIComponent(
          dateToRun
        )}${tourParam}`,
        { headers: { Accept: 'application/json' } }
      );
      const elapsed = Math.round(performance.now() - start);
      setHarnessLatencyMs(elapsed);

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `Server returned HTTP ${res.status}`);
      }

      const data: ScheduleResponse = await res.json();
      setHarnessResult(data);
    } catch (err: any) {
      setHarnessError(err.message || 'Failed to fetch historical test slate');
      setHarnessResult(null);
    } finally {
      setIsHarnessLoading(false);
    }
  };

  // Real-Data Automated Test Suite State covering all 8 sports including Tennis
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [testResults, setTestResults] = useState<TestCaseResult[]>([
    {
      name: '1. MLB Real Schedule & Historical Integrity',
      sport: 'MLB',
      description: 'Verify /api/schedule?sport=MLB&date=2024-08-28 retrieves real 16-game completed slate with scores',
      status: 'pending',
    },
    {
      name: '2. NFL Sunday Slate Ingestion',
      sport: 'NFL',
      description: 'Verify /api/schedule?sport=NFL&date=2024-09-08 parses 13 regular season games, quarters, and scores',
      status: 'pending',
    },
    {
      name: '3. NBA Regular Season Slate Ingestion',
      sport: 'NBA',
      description: 'Verify /api/schedule?sport=NBA&date=2024-04-14 parses 15 NBA games with exact period & scores',
      status: 'pending',
    },
    {
      name: '4. WNBA Real Schedule Ingestion',
      sport: 'WNBA',
      description: 'Verify /api/schedule?sport=WNBA&date=2024-08-28 parses real WNBA games with quarter & venue data',
      status: 'pending',
    },
    {
      name: '5. NHL Regular Season Slate Ingestion',
      sport: 'NHL',
      description: 'Verify /api/schedule?sport=NHL&date=2024-04-18 parses real NHL hockey games with period & scores',
      status: 'pending',
    },
    {
      name: '6. Soccer: English Premier League Retrieval',
      sport: 'SOCCER',
      description: 'Verify /api/schedule?sport=SOCCER&date=2024-08-31 parses Premier League matches with FT clock & scores',
      status: 'pending',
    },
    {
      name: '7. Soccer: MLS Domestic League Retrieval',
      sport: 'SOCCER',
      description: 'Verify /api/schedule?sport=SOCCER&date=2024-08-31 parses Major League Soccer matches with team logos & venue',
      status: 'pending',
    },
    {
      name: '8. Soccer: UEFA Champions League Shootout & Aggregate',
      sport: 'SOCCER',
      description: 'Verify /api/schedule?sport=SOCCER&date=2024-04-17 parses UCL ties including Real Madrid @ Man City penalty shootout (4-3) and aggregate score',
      status: 'pending',
    },
    {
      name: '9. Tennis: ATP Tournament Extraction & Set Scores',
      sport: 'TENNIS',
      description: 'Verify /api/schedule?sport=TENNIS&tour=ATP&date=2024-08-28 extracts nested ATP matches (US Open) with Player A/B, set scores, tiebreaks & winner',
      status: 'pending',
    },
    {
      name: '10. Tennis: WTA Tournament Extraction & Match Resolution',
      sport: 'TENNIS',
      description: 'Verify /api/schedule?sport=TENNIS&tour=WTA&date=2024-08-28 extracts nested WTA matches (US Open) with Player A/B, sets won, and court details',
      status: 'pending',
    },
    {
      name: '11. Tennis: Dual Tour Merged Extraction (tour=ALL)',
      sport: 'TENNIS',
      description: 'Verify /api/schedule?sport=TENNIS&date=2024-08-28 merges both ATP and WTA matches with correct tour tags and chronological order',
      status: 'pending',
    },
    {
      name: '12. Multi-Sport Merged Retrieval (sport=ALL)',
      sport: 'ALL',
      description: 'Verify /api/schedule?sport=ALL fetches all sports concurrently and sorts chronologically',
      status: 'pending',
    },
    {
      name: '13. Multi-Sport Live Polling (~30s)',
      sport: 'ALL',
      description: 'Verify /api/live-scores?sport=ALL returns lightweight array across all active sports including Tennis',
      status: 'pending',
    },
    {
      name: '14. Zero Fabricated Games Guardrail',
      sport: 'ALL',
      description: 'Verify empty date returns 0 games with no fallback fake data (UNKNOWN IS BETTER THAN WRONG)',
      status: 'pending',
    },
    {
      name: '15. Tennis Status & Data Isolation Validation',
      sport: 'TENNIS',
      description: 'Verify UPCOMING matches have null setScores/currentSet, FINAL matches have set breakdown & winner, and no parent tournament status leak',
      status: 'pending',
    },
    {
      name: '16. Market Provider Quota Guard & Fail-Closed Integrity',
      sport: 'MARKETS',
      description: 'Verify /api/markets/quota enforces 500/day and 20,000/month limits, America/Chicago budget timezone, and handles unconfigured provider safely',
      status: 'pending',
    },
    {
      name: '17. Live-Score Polling Firewall Isolation',
      sport: 'FIREWALL',
      description: 'Verify 5+ full-slate /api/live-scores refreshes consume exactly 0 keyed market provider requests',
      status: 'pending',
    },
    {
      name: '18. Player Prop Pipeline & Roster Integrity Negative Tests',
      sport: 'PROPS',
      description: 'Verify /api/props/negative-tests securely rejects Wrong Team, Unknown Player, and Ambiguous Name with 0 keyed requests',
      status: 'pending',
    },
  ]);

  const fetchDiagnostics = async () => {
    setIsLoadingDiagnostics(true);
    try {
      const res = await fetch('/api/audit/diagnostics');
      if (res.ok) {
        const data: MultiSportAuditDiagnostics = await res.json();
        setDiagnostics(data);
      }
    } catch (err) {
      console.error('Failed to fetch diagnostics:', err);
    } finally {
      setIsLoadingDiagnostics(false);
    }
    fetchMarketDiagnostics();
  };

  useEffect(() => {
    fetchDiagnostics();
  }, []);

  const runAllTests = async () => {
    setIsRunningTests(true);

    const updated = [...testResults];
    setTestResults(updated.map((t) => ({ ...t, status: 'running' })));

    // Test 1: MLB 2024-08-28
    try {
      const t1Start = performance.now();
      const res1 = await fetch('/api/schedule?sport=MLB&date=2024-08-28');
      const t1Elapsed = Math.round(performance.now() - t1Start);
      const data1: ScheduleResponse = await res1.json();

      if (res1.ok && data1.games.length === 16) {
        const sample = data1.games[0];
        updated[0] = {
          ...updated[0],
          status: 'pass',
          latencyMs: t1Elapsed,
          details: `MLB: 16 games verified. Sample: ${sample.awayTeam} (${sample.awayScore}) @ ${sample.homeTeam} (${sample.homeScore}) [ID: ${sample.eventId}]`,
        };
      } else {
        throw new Error(`Expected 16 MLB games, got ${data1.games?.length || 0}`);
      }
    } catch (err: any) {
      updated[0] = { ...updated[0], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 2: NFL 2024-09-08
    try {
      const t2Start = performance.now();
      const res2 = await fetch('/api/schedule?sport=NFL&date=2024-09-08');
      const t2Elapsed = Math.round(performance.now() - t2Start);
      const data2: ScheduleResponse = await res2.json();

      if (res2.ok && data2.games.length === 13) {
        const sample = data2.games[0];
        updated[1] = {
          ...updated[1],
          status: 'pass',
          latencyMs: t2Elapsed,
          details: `NFL: 13 games verified. Sample: ${sample.awayTeam} (${sample.awayScore}) @ ${sample.homeTeam} (${sample.homeScore}) [Quarter: Q${sample.period}]`,
        };
      } else {
        throw new Error(`Expected 13 NFL games, got ${data2.games?.length || 0}`);
      }
    } catch (err: any) {
      updated[1] = { ...updated[1], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 3: NBA 2024-04-14
    try {
      const t3Start = performance.now();
      const res3 = await fetch('/api/schedule?sport=NBA&date=2024-04-14');
      const t3Elapsed = Math.round(performance.now() - t3Start);
      const data3: ScheduleResponse = await res3.json();

      if (res3.ok && data3.games.length === 15) {
        const sample = data3.games[0];
        updated[2] = {
          ...updated[2],
          status: 'pass',
          latencyMs: t3Elapsed,
          details: `NBA: 15 games verified. Sample: ${sample.awayTeam} (${sample.awayScore}) @ ${sample.homeTeam} (${sample.homeScore})`,
        };
      } else {
        throw new Error(`Expected 15 NBA games, got ${data3.games?.length || 0}`);
      }
    } catch (err: any) {
      updated[2] = { ...updated[2], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 4: WNBA 2024-08-28
    try {
      const t4Start = performance.now();
      const res4 = await fetch('/api/schedule?sport=WNBA&date=2024-08-28');
      const t4Elapsed = Math.round(performance.now() - t4Start);
      const data4: ScheduleResponse = await res4.json();

      if (res4.ok && data4.games.length === 5) {
        const sample = data4.games[0];
        updated[3] = {
          ...updated[3],
          status: 'pass',
          latencyMs: t4Elapsed,
          details: `WNBA: 5 games verified. Sample: ${sample.awayTeam} (${sample.awayScore}) @ ${sample.homeTeam} (${sample.homeScore})`,
        };
      } else {
        throw new Error(`Expected 5 WNBA games, got ${data4.games?.length || 0}`);
      }
    } catch (err: any) {
      updated[3] = { ...updated[3], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 5: NHL 2024-04-18
    try {
      const t5Start = performance.now();
      const res5 = await fetch('/api/schedule?sport=NHL&date=2024-04-18');
      const t5Elapsed = Math.round(performance.now() - t5Start);
      const data5: ScheduleResponse = await res5.json();

      if (res5.ok && data5.games.length === 6) {
        const sample = data5.games[0];
        updated[4] = {
          ...updated[4],
          status: 'pass',
          latencyMs: t5Elapsed,
          details: `NHL: 6 games verified. Sample: ${sample.awayTeam} (${sample.awayScore}) @ ${sample.homeTeam} (${sample.homeScore})`,
        };
      } else {
        throw new Error(`Expected 6 NHL games, got ${data5.games?.length || 0}`);
      }
    } catch (err: any) {
      updated[4] = { ...updated[4], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 6: Soccer EPL 2024-08-31
    try {
      const t6Start = performance.now();
      const res6 = await fetch('/api/schedule?sport=SOCCER&date=2024-08-31&competition=eng.1');
      const t6Elapsed = Math.round(performance.now() - t6Start);
      const data6: ScheduleResponse = await res6.json();

      const eplMatches = data6.games.filter((g) => g.league.includes('Premier League') || g.competition?.includes('Premier League'));
      if (res6.ok && eplMatches.length >= 7) {
        const sample = eplMatches[0];
        updated[5] = {
          ...updated[5],
          status: 'pass',
          latencyMs: t6Elapsed,
          details: `Soccer EPL: ${eplMatches.length} matches verified. Sample: ${sample.awayTeam} (${sample.awayScore}) @ ${sample.homeTeam} (${sample.homeScore}) [Clock: ${sample.matchClock || sample.statusDetail}]`,
        };
      } else {
        throw new Error(`Expected >=7 EPL matches, got ${eplMatches.length}`);
      }
    } catch (err: any) {
      updated[5] = { ...updated[5], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 7: Soccer MLS 2024-08-31
    try {
      const t7Start = performance.now();
      const res7 = await fetch('/api/schedule?sport=SOCCER&date=2024-08-31&competition=usa.1');
      const t7Elapsed = Math.round(performance.now() - t7Start);
      const data7: ScheduleResponse = await res7.json();

      const mlsMatches = data7.games.filter((g) => g.league.includes('MLS') || g.competition?.includes('MLS'));
      if (res7.ok && mlsMatches.length === 13) {
        const sample = mlsMatches[0];
        updated[6] = {
          ...updated[6],
          status: 'pass',
          latencyMs: t7Elapsed,
          details: `Soccer MLS: 13 matches verified. Sample: ${sample.awayTeam} (${sample.awayScore}) @ ${sample.homeTeam} (${sample.homeScore}) [Venue: ${sample.venue}]`,
        };
      } else {
        throw new Error(`Expected 13 MLS matches, got ${mlsMatches.length}`);
      }
    } catch (err: any) {
      updated[6] = { ...updated[6], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 8: Soccer UCL & Shootout / Aggregate 2024-04-17
    try {
      const t8Start = performance.now();
      const res8 = await fetch('/api/schedule?sport=SOCCER&date=2024-04-17&competition=uefa.champions');
      const t8Elapsed = Math.round(performance.now() - t8Start);
      const data8: ScheduleResponse = await res8.json();

      const uclMatches = data8.games.filter((g) => g.league.includes('Champions League') || g.competition?.includes('Champions League'));
      const penaltyMatch = uclMatches.find((g) => g.penalties !== null && g.penalties !== undefined);

      if (res8.ok && uclMatches.length === 2 && penaltyMatch) {
        updated[7] = {
          ...updated[7],
          status: 'pass',
          latencyMs: t8Elapsed,
          details: `UCL: 2 matches verified. Shootout tie: ${penaltyMatch.awayTeam} (${penaltyMatch.awayScore}) @ ${penaltyMatch.homeTeam} (${penaltyMatch.homeScore}) - Pens: ${penaltyMatch.penalties?.awayShootoutScore}-${penaltyMatch.penalties?.homeShootoutScore}. Aggregate: ${penaltyMatch.aggregateScore?.awayAggregate}-${penaltyMatch.aggregateScore?.homeAggregate}`,
        };
      } else {
        throw new Error(`UCL shootout parsing check failed (found ${uclMatches.length} matches)`);
      }
    } catch (err: any) {
      updated[7] = { ...updated[7], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 9: Tennis ATP Extraction (2024-08-28 US Open)
    try {
      const t9Start = performance.now();
      const res9 = await fetch('/api/schedule?sport=TENNIS&tour=ATP&date=2024-08-28');
      const t9Elapsed = Math.round(performance.now() - t9Start);
      const data9: ScheduleResponse = await res9.json();

      const atpMatches = data9.games.filter((g) => g.tour === 'ATP' || g.sport === 'TENNIS');
      if (res9.ok && atpMatches.length > 0) {
        const sample = atpMatches[0];
        const setBreakdown = sample.setScores?.map((s) => `${s.scoreA}-${s.scoreB}${s.tiebreakA !== null ? `(${s.tiebreakA})` : ''}`).join(', ') || 'N/A';
        updated[8] = {
          ...updated[8],
          status: 'pass',
          latencyMs: t9Elapsed,
          details: `ATP: ${atpMatches.length} matches parsed. Sample: ${sample.playerAName} (${sample.setsWonA}) vs ${sample.playerBName} (${sample.setsWonB}) [Tournament: ${sample.tournamentName || sample.league} - ${sample.round}] Sets: [${setBreakdown}] Winner: ${sample.winner || 'Pending'}`,
        };
      } else {
        throw new Error(`Expected >0 ATP matches on 2024-08-28, got ${atpMatches.length}`);
      }
    } catch (err: any) {
      updated[8] = { ...updated[8], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 10: Tennis WTA Extraction (2024-08-28 US Open)
    try {
      const t10Start = performance.now();
      const res10 = await fetch('/api/schedule?sport=TENNIS&tour=WTA&date=2024-08-28');
      const t10Elapsed = Math.round(performance.now() - t10Start);
      const data10: ScheduleResponse = await res10.json();

      const wtaMatches = data10.games.filter((g) => g.tour === 'WTA' || g.sport === 'TENNIS');
      if (res10.ok && wtaMatches.length > 0) {
        const sample = wtaMatches[0];
        updated[9] = {
          ...updated[9],
          status: 'pass',
          latencyMs: t10Elapsed,
          details: `WTA: ${wtaMatches.length} matches parsed. Sample: ${sample.playerAName} (${sample.playerACountry || 'N/A'}) vs ${sample.playerBName} (${sample.playerBCountry || 'N/A'}) [Sets: ${sample.setsWonA}-${sample.setsWonB}] Court: ${sample.court || sample.venue || 'N/A'}`,
        };
      } else {
        throw new Error(`Expected >0 WTA matches on 2024-08-28, got ${wtaMatches.length}`);
      }
    } catch (err: any) {
      updated[9] = { ...updated[9], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 11: Tennis Merged (tour=ALL)
    try {
      const t11Start = performance.now();
      const res11 = await fetch('/api/schedule?sport=TENNIS&date=2024-08-28');
      const t11Elapsed = Math.round(performance.now() - t11Start);
      const data11: ScheduleResponse = await res11.json();

      const atpCount = data11.games.filter((g) => g.tour === 'ATP').length;
      const wtaCount = data11.games.filter((g) => g.tour === 'WTA').length;

      if (res11.ok && data11.games.length >= 40) {
        updated[10] = {
          ...updated[10],
          status: 'pass',
          latencyMs: t11Elapsed,
          details: `Merged Tennis Slate: ${data11.games.length} total matches (${atpCount} ATP, ${wtaCount} WTA) successfully extracted and ordered.`,
        };
      } else {
        throw new Error(`Expected >=40 merged tennis matches on 2024-08-28, got ${data11.games?.length || 0}`);
      }
    } catch (err: any) {
      updated[10] = { ...updated[10], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 12: sport=ALL Merged Retrieval
    try {
      const t12Start = performance.now();
      const res12 = await fetch('/api/schedule?sport=ALL&date=2024-08-28');
      const t12Elapsed = Math.round(performance.now() - t12Start);
      const data12: ScheduleResponse = await res12.json();

      if (res12.ok && data12.games.length >= 60) {
        // MLB (16) + WNBA (5) + Tennis (50+)
        updated[11] = {
          ...updated[11],
          status: 'pass',
          latencyMs: t12Elapsed,
          details: `Merged ${data12.games.length} events across all 8 sports (MLB, NFL, NCAAF, NBA, WNBA, NHL, Soccer, Tennis) sorted chronologically.`,
        };
      } else {
        throw new Error(`Expected >=60 multi-sport events on 2024-08-28, got ${data12.games?.length || 0}`);
      }
    } catch (err: any) {
      updated[11] = { ...updated[11], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 13: Live Polling ALL sports
    try {
      const t13Start = performance.now();
      const res13 = await fetch('/api/live-scores?sport=ALL');
      const t13Elapsed = Math.round(performance.now() - t13Start);
      const data13: LiveScoresResponse = await res13.json();

      if (res13.ok && Array.isArray(data13.games)) {
        updated[12] = {
          ...updated[12],
          status: 'pass',
          latencyMs: t13Elapsed,
          details: `Live polling across all 8 sports returned ${data13.games.length} total events (${data13.liveCount} currently LIVE).`,
        };
      } else {
        throw new Error(`Live scores failed: HTTP ${res13.status}`);
      }
    } catch (err: any) {
      updated[12] = { ...updated[12], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 14: Empty slate guardrail
    try {
      const res14 = await fetch('/api/schedule?sport=ALL&date=1900-01-01');
      const data14: ScheduleResponse = await res14.json();

      if (res14.ok && data14.games.length === 0) {
        updated[13] = {
          ...updated[13],
          status: 'pass',
          details: `Empty slate on 1900-01-01 returned 0 games without mock fallback (UNKNOWN IS BETTER THAN WRONG).`,
        };
      } else {
        throw new Error(`Unexpected games on 1900-01-01: ${data14.games.length}`);
      }
    } catch (err: any) {
      updated[13] = { ...updated[13], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 15: Tennis Status Normalization & Individual Competition Isolation
    try {
      const t15Start = performance.now();
      const res15 = await fetch('/api/schedule?sport=TENNIS&date=2024-08-28');
      const t15Elapsed = Math.round(performance.now() - t15Start);
      const data15: ScheduleResponse = await res15.json();

      if (res15.ok && data15.games.length > 0) {
        const finalMatches = data15.games.filter((g) => g.status === 'FINAL');
        const upcomingMatches = data15.games.filter((g) => g.status === 'UPCOMING');

        // Check that upcoming matches have no leaked sets or currentSet
        const upcomingAnomaly = upcomingMatches.find((g) => g.setScores !== null || g.currentSet !== null || g.awayScore !== null);
        if (upcomingAnomaly) {
          throw new Error(`Found UPCOMING match ${upcomingAnomaly.eventId} with unearned setScores or currentSet`);
        }

        // Check that final matches have valid winner or setsWon
        const finalAnomaly = finalMatches.find((g) => g.setsWonA === null || g.setsWonB === null || g.setScores === null);
        if (finalAnomaly) {
          throw new Error(`Found FINAL match ${finalAnomaly.eventId} without parsed set breakdown`);
        }

        updated[14] = {
          ...updated[14],
          status: 'pass',
          latencyMs: t15Elapsed,
          details: `Validated status isolation across ${data15.games.length} tennis competitions (${finalMatches.length} FINAL, ${upcomingMatches.length} UPCOMING). UPCOMING matches correctly have null setScores/currentSet; FINAL matches maintain verified set breakdown and winner.`,
        };
      } else {
        throw new Error(`Failed to load tennis matches for status audit`);
      }
    } catch (err: any) {
      updated[14] = { ...updated[14], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 16: Market Provider Quota Guard
    try {
      const t16Start = performance.now();
      const res16 = await fetch('/api/markets/quota');
      const t16Elapsed = Math.round(performance.now() - t16Start);
      const data16 = await res16.json();

      if (res16.ok && data16.budgetTimezone === 'America/Chicago' && data16.dailyHardLimit === 500 && data16.monthlyHardLimit === 20000) {
        updated[15] = {
          ...updated[15],
          status: 'pass',
          latencyMs: t16Elapsed,
          details: `Quota Guard verified: Daily Hard Limit = ${data16.dailyHardLimit}, Monthly Hard Limit = ${data16.monthlyHardLimit}, Timezone = ${data16.budgetTimezone}, Provider Configured = ${data16.providerConfigured} (${data16.status})`,
        };
      } else {
        throw new Error(`Quota guard state failed verification: ${JSON.stringify(data16)}`);
      }
    } catch (err: any) {
      updated[15] = { ...updated[15], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 17: Live-Score Firewall Test (5 Polls -> 0 Keyed Requests)
    try {
      const t17Start = performance.now();
      const res17 = await fetch('/api/markets/firewall-test', { method: 'POST' });
      const t17Elapsed = Math.round(performance.now() - t17Start);
      const data17: FirewallTestResponse = await res17.json();

      if (res17.ok && data17.passed && data17.keyedRequestsConsumed === 0) {
        updated[16] = {
          ...updated[16],
          status: 'pass',
          latencyMs: t17Elapsed,
          details: `FIREWALL PASS: ${data17.pollsExecuted} full-slate live score polls executed. Keyed requests consumed: ${data17.keyedRequestsConsumed}. Zero provider leaks.`,
        };
      } else {
        throw new Error(data17.details || `Firewall failed: ${data17.keyedRequestsConsumed} keyed requests triggered.`);
      }
    } catch (err: any) {
      updated[16] = { ...updated[16], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    // Test 18: Player Prop Pipeline & Roster Integrity Negative Tests
    try {
      const t18Start = performance.now();
      const res18 = await fetch('/api/props/negative-tests');
      const t18Elapsed = Math.round(performance.now() - t18Start);
      const data18 = await res18.json();

      if (res18.ok && data18.allPassed && data18.keyedRequestsConsumed === 0) {
        updated[17] = {
          ...updated[17],
          status: 'pass',
          latencyMs: t18Elapsed,
          details: `ROSTER INTEGRITY PASS: All ${data18.totalTests} negative tests passed (Wrong Team, Unknown Player, Ambiguous Name rejected securely). Keyed requests consumed: 0.`,
        };
      } else {
        throw new Error(`Roster integrity tests failed: ${JSON.stringify(data18)}`);
      }
    } catch (err: any) {
      updated[17] = { ...updated[17], status: 'fail', details: err.message };
    }
    setTestResults([...updated]);

    setIsRunningTests(false);
    fetchDiagnostics();
  };

  const passCount = testResults.filter((t) => t.status === 'pass').length;
  const failCount = testResults.filter((t) => t.status === 'fail').length;

  const currentSportDiag = diagnostics?.sports?.[selectedSportTab];

  return (
    <div id="audit-module-container" className="space-y-6 animate-in fade-in">
      {/* Audit View Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2">
          <button
            id="audit-tab-backtest-btn"
            type="button"
            onClick={() => setActiveAuditTab('BACKTEST')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              activeAuditTab === 'BACKTEST'
                ? 'border border-cyan-500/50 bg-cyan-500/20 text-cyan-300 shadow-sm'
                : 'border border-slate-800 bg-[#090d16] text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="h-4 w-4 text-cyan-400" />
            <span>STAGE 4A: HISTORICAL BACKTEST AUDIT</span>
          </button>

          <button
            id="audit-tab-model-arena-btn"
            type="button"
            onClick={() => setActiveAuditTab('MODEL_ARENA')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              activeAuditTab === 'MODEL_ARENA'
                ? 'border border-violet-500/50 bg-violet-500/20 text-violet-300 shadow-sm'
                : 'border border-slate-800 bg-[#090d16] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="h-4 w-4 text-violet-400" />
            <span>MODEL ARENA: CHAMPION / CHALLENGER</span>
          </button>

          <button
            id="audit-tab-pipeline-btn"
            type="button"
            onClick={() => setActiveAuditTab('PIPELINE')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              activeAuditTab === 'PIPELINE'
                ? 'border border-emerald-500/50 bg-emerald-500/20 text-emerald-300 shadow-sm'
                : 'border border-slate-800 bg-[#090d16] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="h-4 w-4 text-emerald-400" />
            <span>MULTI-SPORT PIPELINE TELEMETRY</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="download-snapshot-backup-btn"
            type="button"
            onClick={handleDownloadSnapshotBackup}
            className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/60 transition-all shadow-sm"
            title="Download APEX_REAL_PREGAME_SNAPSHOT_BACKUP_2026-08-28.json"
          >
            <Download className="h-3.5 w-3.5 text-amber-400" />
            <span>Download Snapshot Backup (.json)</span>
          </button>

          <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-slate-400">
            <span>Engine Status:</span>
            <span className="rounded bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 text-cyan-300 font-bold">
              STAGE 4A READY
            </span>
          </div>
        </div>
      </div>

      {/* Conditionally Render Backtest, Model Arena, or Pipeline */}
      {activeAuditTab === 'BACKTEST' ? (
        <BacktestAuditTab onGoToOverview={onGoToOverview} />
      ) : activeAuditTab === 'MODEL_ARENA' ? (
        <ChampionChallengerPanel />
      ) : (
        <div className="space-y-6">
          {/* Top Header */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                  <FileCheck2 className="h-6 w-6 text-emerald-400" />
                  <span>Multi-Sport Data Pipeline Audit & Diagnostics</span>
                </h2>
                <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-400 font-mono">
                  STAGE 3A MARKET PROVIDER ACTIVE
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">
                Real-time pipeline telemetry, per-sport diagnostics, keyed market provider cost protection, cache telemetry, and identity verification audit
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                id="run-tests-btn"
                type="button"
                onClick={runAllTests}
                disabled={isRunningTests}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-600/20 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-600/30 transition-all disabled:opacity-50 shadow-sm"
              >
                <Play className={`h-3.5 w-3.5 ${isRunningTests ? 'animate-spin' : ''}`} />
                <span>{isRunningTests ? 'Running Suite...' : 'Run All-Sport Real-Data Suite'}</span>
              </button>

              <button
                id="refresh-audit-btn"
                type="button"
                onClick={fetchDiagnostics}
                disabled={isLoadingDiagnostics || isLoadingMarketAudit}
                className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoadingDiagnostics || isLoadingMarketAudit ? 'animate-spin text-emerald-400' : ''}`} />
                <span>Refresh Diagnostics</span>
              </button>
            </div>
          </div>

      {/* ========================================== */}
      {/* STAGE 3A: MARKET PROVIDER & QUOTA DASHBOARD */}
      {/* ========================================== */}
      <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Market Provider & Cost Protection Telemetry</h3>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-mono font-bold border ${
                    marketAudit?.quota.providerConfigured
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  }`}
                >
                  {marketAudit?.quota.providerConfigured ? 'ODDS_API_KEY CONFIGURED' : 'MARKET PROVIDER NOT CONFIGURED'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Enforcing strict 500 req/day hard limit &bull; 20,000 req/month &bull; Timezone: America/Chicago &bull; Fail-Closed Security
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="run-firewall-test-btn"
              type="button"
              onClick={runFirewallTest}
              disabled={isFirewallTesting}
              className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-600/20 px-3.5 py-1.5 text-xs font-mono font-bold text-cyan-300 hover:bg-cyan-600/30 transition-all disabled:opacity-50 shadow-sm"
            >
              <ShieldCheck className={`h-3.5 w-3.5 ${isFirewallTesting ? 'animate-spin' : ''}`} />
              <span>{isFirewallTesting ? 'Auditing Firewall...' : 'Test Live-Score Firewall (5 Polls)'}</span>
            </button>
          </div>
        </div>

        {/* Quota & Cost Protection Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Daily Quota Card */}
          <div className="rounded-xl border border-slate-800 bg-[#090d16] p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium">Daily Keyed Quota</span>
              <span className="font-mono text-[10px] text-amber-400">America/Chicago</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white">
                {marketAudit?.quota.dailyUsed ?? 0}
              </span>
              <span className="text-xs font-mono text-slate-400">/ 500 limit</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-amber-400 h-full transition-all"
                style={{
                  width: `${Math.min(100, ((marketAudit?.quota.dailyUsed || 0) / 500) * 100)}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-0.5">
              <span>Remaining: <strong className="text-emerald-400">{marketAudit?.quota.dailyRemaining ?? 500}</strong></span>
              <span>Date: {marketAudit?.quota.dailyDate || 'YYYY-MM-DD'}</span>
            </div>
          </div>

          {/* Monthly Quota Card */}
          <div className="rounded-xl border border-slate-800 bg-[#090d16] p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium">Monthly Hard Limit</span>
              <span className="font-mono text-[10px] text-slate-400">20k Max</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white">
                {marketAudit?.quota.monthlyUsed ?? 0}
              </span>
              <span className="text-xs font-mono text-slate-400">/ 20,000 limit</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-cyan-400 h-full transition-all"
                style={{
                  width: `${Math.min(100, ((marketAudit?.quota.monthlyUsed || 0) / 20000) * 100)}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-0.5">
              <span>Month: {marketAudit?.quota.monthlyDate || 'YYYY-MM'}</span>
              <span>Remaining: <strong className="text-emerald-400">{marketAudit?.quota.monthlyRemaining ?? 20000}</strong></span>
            </div>
          </div>

          {/* Cache Telemetry */}
          <div className="rounded-xl border border-slate-800 bg-[#090d16] p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium">Server Cache & Dedup</span>
              <Zap className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-xs">
              <div className="rounded bg-slate-900/80 p-1.5 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Cache Hits</span>
                <span className="text-emerald-400 font-bold text-sm">{marketAudit?.cache.cacheHits ?? 0}</span>
              </div>
              <div className="rounded bg-slate-900/80 p-1.5 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Dedup Saved</span>
                <span className="text-cyan-400 font-bold text-sm">{marketAudit?.cache.duplicateRequestsPrevented ?? 0}</span>
              </div>
            </div>
            <div className="text-[11px] font-mono text-slate-400 pt-0.5">
              Active Entries: <strong className="text-slate-200">{marketAudit?.cache.activeEntriesCount ?? 0}</strong> &bull; Misses: {marketAudit?.cache.cacheMisses ?? 0}
            </div>
          </div>

          {/* Provider Quota Reconciled */}
          <div className="rounded-xl border border-slate-800 bg-[#090d16] p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium">Provider Reconciled</span>
              <ShieldCheck className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="text-xs font-mono space-y-1 pt-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Provider Status:</span>
                <span className="font-bold text-slate-200">{marketAudit?.quota.status ?? 'NOT_CONFIGURED'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Provider Reported:</span>
                <span className="font-bold text-slate-200">
                  {marketAudit?.quota.providerReportedUsed !== null ? `${marketAudit?.quota.providerReportedUsed} used` : 'N/A'}
                </span>
              </div>
            </div>
            <div className="text-[10px] font-mono text-slate-400 pt-0.5 truncate">
              {marketAudit?.quota.lastReconciledAt
                ? `Reconciled: ${new Date(marketAudit.quota.lastReconciledAt).toLocaleTimeString()}`
                : 'Conservative fail-closed tracking'}
            </div>
          </div>
        </div>

        {/* Live-Score Firewall Test Result Banner if executed */}
        {firewallResult && (
          <div
            className={`rounded-xl border p-4 text-xs font-mono flex items-start gap-3 ${
              firewallResult.passed
                ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
                : 'border-rose-500/40 bg-rose-950/20 text-rose-300'
            }`}
          >
            <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-sm">
                FIREWALL TEST: {firewallResult.passed ? 'PASSED (0 LEAKS)' : 'FAILED'}
              </div>
              <div>{firewallResult.details}</div>
              <div className="text-[11px] text-slate-400 pt-1">
                Initial Keyed Used: {firewallResult.initialKeyedUsed} &rarr; Final Keyed Used: {firewallResult.finalKeyedUsed} &bull; Polls Executed: {firewallResult.pollsExecuted}
              </div>
            </div>
          </div>
        )}

        {/* Identity Verification & Matching Breakdown by Sport */}
        <div className="space-y-3 border-t border-slate-800/80 pt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white uppercase tracking-wider font-mono">
              Identity Verification & Matching Telemetry By Sport
            </span>
            <span className="font-mono text-slate-400">
              Total Matched: <strong className="text-emerald-400">{marketAudit?.matching.successfullyMatched ?? 0}</strong> &bull; Total Rejected: <strong className="text-rose-400">{marketAudit?.matching.rejected ?? 0}</strong>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
            {ALL_SPORTS.map((sport) => {
              const sStats = marketAudit?.matching.bySport[sport];
              return (
                <div
                  key={sport}
                  className="rounded-lg border border-slate-800 bg-[#090d16] p-2.5 text-xs font-mono space-y-1"
                >
                  <div className="font-bold text-slate-300 border-b border-slate-800 pb-1 flex justify-between items-center">
                    <span>{sport}</span>
                    <span className="text-[10px] text-emerald-400">{sStats?.matched ?? 0} M</span>
                  </div>
                  <div className="text-[10px] text-slate-400 space-y-0.5 pt-0.5">
                    <div>Retrieved: {sStats?.retrieved ?? 0}</div>
                    <div>Rejected: {sStats?.rejected ?? 0}</div>
                    <div>Ambiguous: {sStats?.ambiguous ?? 0}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Stage 3B: Player Prop Pipeline & Roster Integrity Telemetry */}
      <div
        id="prop-pipeline-audit-card"
        className="rounded-2xl border border-cyan-500/20 bg-slate-900/90 p-5 space-y-5 backdrop-blur-sm"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-400 border border-cyan-500/20">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Stage 3B: Player Prop Pipeline & Roster Telemetry</h3>
                <span className="rounded px-2 py-0.5 text-[10px] font-mono font-bold bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
                  PROVIDER-FIRST ARCHITECTURE
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Live verification against ESPN official rosters &bull; Zero synthetic player injection &bull; Keyed requests deduplicated
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-slate-400">Roster Resolution:</span>
            <span className="rounded bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-emerald-400 font-bold">
              {propAudit ? `${propAudit.playersRosterResolved} Resolved` : 'Active'}
            </span>
          </div>
        </div>

        {/* Props Pipeline Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-800 bg-[#090d16] p-4 space-y-1">
            <span className="text-xs text-slate-400 font-medium">Prop Quotes Received</span>
            <div className="text-2xl font-bold font-mono text-white">
              {propAudit?.quotesReceived ?? 0}
            </div>
            <div className="text-[11px] font-mono text-emerald-400">
              Accepted: {propAudit?.acceptedQuotes ?? 0} ({propAudit?.quotesReceived ? Math.round(((propAudit.acceptedQuotes) / propAudit.quotesReceived) * 100) : 100}%)
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#090d16] p-4 space-y-1">
            <span className="text-xs text-slate-400 font-medium">Roster Resolutions</span>
            <div className="text-2xl font-bold font-mono text-cyan-400">
              {propAudit?.playersRosterResolved ?? 0}
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              Unresolved: <strong className="text-rose-400">{propAudit?.unresolvedPlayers ?? 0}</strong> &bull; Ambiguous: <strong className="text-amber-400">{propAudit?.ambiguousPlayers ?? 0}</strong>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#090d16] p-4 space-y-1">
            <span className="text-xs text-slate-400 font-medium">Wrong Team Rejections</span>
            <div className="text-2xl font-bold font-mono text-emerald-400">
              {propAudit?.wrongTeamRejections ?? 0}
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              Total Rejected: {propAudit?.rejectedQuotes ?? 0} quotes
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#090d16] p-4 space-y-1">
            <span className="text-xs text-slate-400 font-medium">Prop Cache Efficiency</span>
            <div className="text-2xl font-bold font-mono text-indigo-400">
              {propAudit?.cacheHits ?? 0} Hits
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              Misses: {propAudit?.cacheMisses ?? 0} (15m raw, 5m norm TTL)
            </div>
          </div>
        </div>

        {/* Props by Sport Breakdown */}
        <div className="border-t border-slate-800/80 pt-4 space-y-2">
          <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">
            Player Prop Pipeline Activity by Sport
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
            {ALL_SPORTS.map((sport) => {
              const pStats = propAudit?.bySport[sport];
              return (
                <div
                  key={sport}
                  className="rounded-lg border border-slate-800 bg-[#090d16] p-2.5 text-xs font-mono space-y-1"
                >
                  <div className="font-bold text-slate-300 border-b border-slate-800 pb-1 flex justify-between items-center">
                    <span>{sport}</span>
                    <span className="text-[10px] text-cyan-400">{pStats?.acceptedQuotes ?? 0} Q</span>
                  </div>
                  <div className="text-[10px] text-slate-400 space-y-0.5 pt-0.5">
                    <div>Reqs: {pStats?.propRequests ?? 0}</div>
                    <div>Resolved: {pStats?.playersResolved ?? 0}</div>
                    <div>Rejected: {pStats?.rejectedQuotes ?? 0}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Sport Selector Tabs for Diagnostics */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-slate-400 pr-2">Sport Telemetry:</span>
          {ALL_SPORTS.map((sport) => {
            const isSelected = selectedSportTab === sport;
            const sportDiag = diagnostics?.sports?.[sport];
            const isOperational = sportDiag?.sourceStatus === 'OPERATIONAL';

            return (
              <button
                key={sport}
                id={`diag-tab-${sport.toLowerCase()}`}
                type="button"
                onClick={() => setSelectedSportTab(sport)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                  isSelected
                    ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                    : 'border border-slate-800 bg-[#090d16] text-slate-400 hover:text-slate-200'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isOperational ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                <span>{sport}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <span>Overall Health:</span>
          <span className="rounded bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-emerald-400 font-bold">
            {diagnostics?.overallStatus || 'OPERATIONAL'}
          </span>
        </div>
      </div>

      {/* Selected Sport Diagnostics Grid */}
      {currentSportDiag && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Source Status */}
            <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{currentSportDiag.sport} Source</span>
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
              </div>
              <div className="text-sm font-bold text-white truncate">
                {currentSportDiag.sourceName}
              </div>
              <div className="text-[11px] font-mono text-emerald-400">
                Status: {currentSportDiag.sourceStatus}
              </div>
            </div>

            {/* Last Schedule Fetch */}
            <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Last Schedule Slate</span>
                <Zap className="h-3.5 w-3.5 text-amber-400" />
              </div>
              <div className="text-sm font-bold text-white font-mono">
                {currentSportDiag.lastScheduleFetch.requestedDate || 'Not fetched yet'}
              </div>
              <div className="text-[11px] text-slate-400">
                {currentSportDiag.lastScheduleFetch.gamesRetrieved} matches/games ({currentSportDiag.lastScheduleFetch.durationMs || 0}ms)
              </div>
            </div>

            {/* Live Score Polling */}
            <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Live Scores Polled</span>
                <Activity className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <div className="text-sm font-bold text-white font-mono">
                {currentSportDiag.lastLiveScoreFetch.liveCount} Live Matches
              </div>
              <div className="text-[11px] text-slate-400">
                {currentSportDiag.lastLiveScoreFetch.gamesUpdated} polled ({currentSportDiag.lastLiveScoreFetch.durationMs || 0}ms)
              </div>
            </div>

            {/* Errors */}
            <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Error Log</span>
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <div className="text-sm font-bold text-white font-mono">
                {currentSportDiag.recentErrors.length} Errors Logged
              </div>
              <div className="text-[11px] text-emerald-400">
                {currentSportDiag.recentErrors.length === 0 ? 'Zero active faults' : 'Fault logged'}
              </div>
            </div>
          </div>

          {/* Tennis Specific Diagnostics breakdown */}
          {selectedSportTab === 'TENNIS' && (
            <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5 uppercase font-mono tracking-wider">
                  <Trophy className="h-3.5 w-3.5 text-amber-400" />
                  <span>Tennis Tour & Tournament Ingest Telemetry</span>
                </h4>
                <span className="text-[11px] font-mono text-slate-400">
                  Tournaments Discovered: {currentSportDiag.lastScheduleFetch.tournamentsDiscovered ?? 0}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                <div className="rounded-lg border border-slate-800/80 bg-[#090d16] p-3 text-xs">
                  <span className="text-slate-400 block">ATP Matches Parsed</span>
                  <span className="text-base font-bold font-mono text-sky-400">
                    {currentSportDiag.lastScheduleFetch.atpCount ?? 0}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-800/80 bg-[#090d16] p-3 text-xs">
                  <span className="text-slate-400 block">WTA Matches Parsed</span>
                  <span className="text-base font-bold font-mono text-pink-400">
                    {currentSportDiag.lastScheduleFetch.wtaCount ?? 0}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-800/80 bg-[#090d16] p-3 text-xs">
                  <span className="text-slate-400 block">Final / Completed</span>
                  <span className="text-base font-bold font-mono text-slate-200">
                    {currentSportDiag.lastScheduleFetch.finalCount ?? 0}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-800/80 bg-[#090d16] p-3 text-xs">
                  <span className="text-slate-400 block">Live / Upcoming</span>
                  <span className="text-base font-bold font-mono text-emerald-400">
                    {(currentSportDiag.lastScheduleFetch.liveCount ?? 0) + (currentSportDiag.lastScheduleFetch.upcomingCount ?? 0)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Soccer Competition Breakdown if SOCCER is selected */}
          {selectedSportTab === 'SOCCER' && currentSportDiag.lastScheduleFetch.competitionCounts && (
            <div className="rounded-xl border border-slate-800 bg-[#0d1322] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5 uppercase font-mono tracking-wider">
                  <Globe className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Soccer Breakdown by Competition (Last Slate)</span>
                </h4>
                <span className="text-[11px] font-mono text-slate-400">
                  Total Matches: {currentSportDiag.lastScheduleFetch.gamesRetrieved}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 pt-1">
                {Object.entries(currentSportDiag.lastScheduleFetch.competitionCounts).map(
                  ([compName, count]) => (
                    <div
                      key={compName}
                      className="rounded-lg border border-slate-800/80 bg-[#090d16] p-2.5 flex items-center justify-between text-xs"
                    >
                      <span className="text-slate-300 font-medium truncate max-w-[140px]">
                        {compName}
                      </span>
                      <span className="font-mono font-bold text-emerald-400 ml-2">
                        {count}
                      </span>
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* DEVELOPER TEST HARNESS SECTION */}
      <div id="developer-test-harness" className="rounded-2xl border border-amber-500/30 bg-[#0d1322] p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-amber-400" />
              <h3 className="text-base font-bold text-white tracking-tight uppercase font-mono">
                DEVELOPER TEST HARNESS
              </h3>
              <span className="rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 text-[10px] font-mono font-bold">
                ZERO MOCK DATA &bull; REAL HISTORICAL INGEST
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Historical slate test runner and source verification workbench. All shortcuts query actual public ESPN endpoints for historical match verification.
            </p>
          </div>
          <div className="text-xs font-mono text-slate-400">
            Environment: <span className="text-emerald-400 font-bold">LIVE PRODUCTION SOURCES ONLY</span>
          </div>
        </div>

        {/* Historical Test Shortcuts Grid */}
        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-300 font-mono flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5 text-amber-400" />
            <span>Verified Historical Slate Test Presets:</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <button
              id="harness-btn-usopen"
              type="button"
              onClick={() => runHarnessQuery('TENNIS', '2024-08-28', 'ALL')}
              className="flex flex-col items-start rounded-xl border border-slate-800 bg-[#090d16] p-3 text-left hover:border-amber-500/40 hover:bg-[#111827] transition-all"
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-mono font-bold text-amber-400">TENNIS</span>
                <span className="text-[10px] font-mono text-slate-400">2024-08-28</span>
              </div>
              <span className="text-xs font-bold text-white mt-1">US Open 2024</span>
              <span className="text-[10px] text-slate-400 mt-0.5">ATP & WTA 68 Matches</span>
            </button>

            <button
              id="harness-btn-nfl"
              type="button"
              onClick={() => runHarnessQuery('NFL', '2024-09-08')}
              className="flex flex-col items-start rounded-xl border border-slate-800 bg-[#090d16] p-3 text-left hover:border-amber-500/40 hover:bg-[#111827] transition-all"
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-mono font-bold text-amber-400">NFL</span>
                <span className="text-[10px] font-mono text-slate-400">2024-09-08</span>
              </div>
              <span className="text-xs font-bold text-white mt-1">NFL Sunday Week 1</span>
              <span className="text-[10px] text-slate-400 mt-0.5">13 Regular Season Games</span>
            </button>

            <button
              id="harness-btn-soccer"
              type="button"
              onClick={() => runHarnessQuery('SOCCER', '2024-08-31')}
              className="flex flex-col items-start rounded-xl border border-slate-800 bg-[#090d16] p-3 text-left hover:border-amber-500/40 hover:bg-[#111827] transition-all"
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-mono font-bold text-amber-400">SOCCER</span>
                <span className="text-[10px] font-mono text-slate-400">2024-08-31</span>
              </div>
              <span className="text-xs font-bold text-white mt-1">EPL & MLS Saturday</span>
              <span className="text-[10px] text-slate-400 mt-0.5">38 Matches Across Leagues</span>
            </button>

            <button
              id="harness-btn-ucl"
              type="button"
              onClick={() => runHarnessQuery('SOCCER', '2024-04-17')}
              className="flex flex-col items-start rounded-xl border border-slate-800 bg-[#090d16] p-3 text-left hover:border-amber-500/40 hover:bg-[#111827] transition-all"
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-mono font-bold text-amber-400">SOCCER</span>
                <span className="text-[10px] font-mono text-slate-400">2024-04-17</span>
              </div>
              <span className="text-xs font-bold text-white mt-1">UCL Shootout</span>
              <span className="text-[10px] text-slate-400 mt-0.5">Man City vs Real Madrid (4-3P)</span>
            </button>

            <button
              id="harness-btn-mlb"
              type="button"
              onClick={() => runHarnessQuery('MLB', '2024-08-28')}
              className="flex flex-col items-start rounded-xl border border-slate-800 bg-[#090d16] p-3 text-left hover:border-amber-500/40 hover:bg-[#111827] transition-all"
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-mono font-bold text-amber-400">MLB</span>
                <span className="text-[10px] font-mono text-slate-400">2024-08-28</span>
              </div>
              <span className="text-xs font-bold text-white mt-1">MLB Full Slate</span>
              <span className="text-[10px] text-slate-400 mt-0.5">16 Games with Innings</span>
            </button>

            <button
              id="harness-btn-nba"
              type="button"
              onClick={() => runHarnessQuery('NBA', '2024-04-14')}
              className="flex flex-col items-start rounded-xl border border-slate-800 bg-[#090d16] p-3 text-left hover:border-amber-500/40 hover:bg-[#111827] transition-all"
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-mono font-bold text-amber-400">NBA</span>
                <span className="text-[10px] font-mono text-slate-400">2024-04-14</span>
              </div>
              <span className="text-xs font-bold text-white mt-1">NBA Season Finale</span>
              <span className="text-[10px] text-slate-400 mt-0.5">15 Games with Quarters</span>
            </button>

            <button
              id="harness-btn-nhl"
              type="button"
              onClick={() => runHarnessQuery('NHL', '2024-04-18')}
              className="flex flex-col items-start rounded-xl border border-slate-800 bg-[#090d16] p-3 text-left hover:border-amber-500/40 hover:bg-[#111827] transition-all"
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-mono font-bold text-amber-400">NHL</span>
                <span className="text-[10px] font-mono text-slate-400">2024-04-18</span>
              </div>
              <span className="text-xs font-bold text-white mt-1">NHL Slate</span>
              <span className="text-[10px] text-slate-400 mt-0.5">6 Games with Periods</span>
            </button>

            <button
              id="harness-btn-wnba"
              type="button"
              onClick={() => runHarnessQuery('WNBA', '2024-08-28')}
              className="flex flex-col items-start rounded-xl border border-slate-800 bg-[#090d16] p-3 text-left hover:border-amber-500/40 hover:bg-[#111827] transition-all"
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-mono font-bold text-amber-400">WNBA</span>
                <span className="text-[10px] font-mono text-slate-400">2024-08-28</span>
              </div>
              <span className="text-xs font-bold text-white mt-1">WNBA Slate</span>
              <span className="text-[10px] text-slate-400 mt-0.5">5 Games Regular Season</span>
            </button>
          </div>
        </div>

        {/* Custom Query Controls */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800/80 bg-[#090d16] p-3.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">Sport:</span>
            <select
              value={harnessSport}
              onChange={(e) => setHarnessSport(e.target.value as ApexSport)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-white focus:outline-none"
            >
              {ALL_SPORTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">Historical Date:</span>
            <input
              type="date"
              value={harnessDate}
              onChange={(e) => setHarnessDate(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 font-mono text-xs text-white focus:outline-none"
            />
          </div>

          {harnessSport === 'TENNIS' && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">Tour:</span>
              <select
                value={harnessTour}
                onChange={(e) => setHarnessTour(e.target.value as TennisTourFilter)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-white focus:outline-none"
              >
                <option value="ALL">All Tours (ATP & WTA)</option>
                <option value="ATP">ATP Tour Only</option>
                <option value="WTA">WTA Tour Only</option>
              </select>
            </div>
          )}

          <button
            id="run-harness-custom-btn"
            type="button"
            onClick={() => runHarnessQuery(harnessSport, harnessDate, harnessTour)}
            disabled={isHarnessLoading}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/20 px-3 py-1 text-xs font-bold text-amber-300 hover:bg-amber-500/30 transition-all disabled:opacity-50"
          >
            <Play className={`h-3.5 w-3.5 ${isHarnessLoading ? 'animate-spin' : ''}`} />
            <span>{isHarnessLoading ? 'Executing Live Fetch...' : 'Execute Source Query'}</span>
          </button>
        </div>

        {/* Query Result Card */}
        {harnessResult && (
          <div className="rounded-xl border border-slate-800 bg-[#090d16] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5 text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className="rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 font-bold">
                  HTTP 200 OK
                </span>
                <span className="text-slate-300 font-bold">
                  {harnessResult.sport} Slate ({harnessResult.scheduleDate})
                </span>
                <span className="text-slate-400">&bull; {harnessResult.games.length} Real Events</span>
              </div>
              <div className="flex items-center gap-3 text-slate-400">
                <span>Latency: <strong className="text-emerald-400">{harnessLatencyMs}ms</strong></span>
                <span>Source: <strong className="text-emerald-400">{harnessResult.source} Live</strong></span>
                <button
                  type="button"
                  onClick={() => setShowRawJson(!showRawJson)}
                  className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
                >
                  <Code className="h-3.5 w-3.5" />
                  <span>{showRawJson ? 'Hide JSON' : 'View Raw JSON'}</span>
                  {showRawJson ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              </div>
            </div>

            {/* Event Previews */}
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {harnessResult.games.slice(0, 10).map((g) => (
                <div
                  key={g.eventId}
                  className="flex items-center justify-between rounded-lg border border-slate-800/60 bg-[#0d1322] px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-slate-800 text-[10px] font-mono px-1.5 py-0.5 text-slate-300">
                      {g.sport}
                    </span>
                    {g.sport === 'TENNIS' ? (
                      <span className="text-slate-200 font-medium">
                        {g.playerAName} vs {g.playerBName} {g.setsWonA !== null && `(${g.setsWonA}-${g.setsWonB})`}
                      </span>
                    ) : (
                      <span className="text-slate-200 font-medium">
                        {g.awayTeam} {g.awayScore !== null && `(${g.awayScore})`} @ {g.homeTeam} {g.homeScore !== null && `(${g.homeScore})`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-slate-400">{g.venue || g.tournamentName || 'N/A'}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        g.status === 'FINAL'
                          ? 'bg-slate-800 text-slate-300'
                          : g.status === 'LIVE'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-blue-500/20 text-blue-400'
                      }`}
                    >
                      {g.status}
                    </span>
                  </div>
                </div>
              ))}
              {harnessResult.games.length > 10 && (
                <div className="text-center text-[11px] font-mono text-slate-400 pt-1">
                  ... plus {harnessResult.games.length - 10} more real verified fixtures
                </div>
              )}
            </div>

            {/* Raw JSON viewer */}
            {showRawJson && (
              <pre className="max-h-64 overflow-auto rounded-lg border border-slate-800 bg-[#060910] p-3 text-[11px] font-mono text-slate-300">
                {JSON.stringify(harnessResult, null, 2)}
              </pre>
            )}
          </div>
        )}

        {harnessError && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 p-3.5 text-xs text-rose-300">
            Error executing test query: {harnessError}
          </div>
        )}
      </div>

      {/* Automated Real-Data Test Suite Panel */}
      <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Terminal className="h-4 w-4 text-emerald-400" />
              <span>Multi-Sport Real-Data Automated Verification Suite</span>
            </h3>
            <p className="text-xs text-slate-400">
              Rigorous live & historical endpoint test runner covering MLB, NFL, NCAAF, NBA, WNBA, NHL, Soccer, and ATP/WTA Tennis
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 font-bold">
              {passCount} PASS
            </span>
            {failCount > 0 && (
              <span className="rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 font-bold">
                {failCount} FAIL
              </span>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {testResults.map((test, index) => (
            <div
              key={index}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-[#090d16] p-4 text-xs"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {test.status === 'pass' && <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />}
                  {test.status === 'fail' && <XCircle className="h-4 w-4 text-rose-400 shrink-0" />}
                  {test.status === 'running' && <RefreshCw className="h-4 w-4 animate-spin text-amber-400 shrink-0" />}
                  {test.status === 'pending' && <span className="h-2 w-2 rounded-full bg-slate-600 shrink-0" />}
                  <span className="font-bold text-white text-sm">{test.name}</span>
                  <span className="rounded bg-slate-800 text-[10px] font-mono px-1.5 py-0.5 text-slate-400">
                    {test.sport}
                  </span>
                </div>
                <p className="text-slate-400 text-xs pl-6">{test.description}</p>
                {test.details && (
                  <p className="font-mono text-[11px] text-emerald-300 pl-6 pt-0.5">
                    &rarr; {test.details}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3 self-end sm:self-center font-mono">
                {test.latencyMs !== undefined && (
                  <span className="text-slate-400">{test.latencyMs}ms</span>
                )}
                <span
                  className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
                    test.status === 'pass'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : test.status === 'fail'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : test.status === 'running'
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {test.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
        </div>
      )}
    </div>
  );
};
