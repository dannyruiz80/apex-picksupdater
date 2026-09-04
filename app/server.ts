import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import {
  fetchSchedule,
  fetchLiveScores,
  getMultiSportAuditDiagnostics,
  ALL_SPORTS,
} from "./src/server/sportsHub.js";
import { mlbAuditState } from "./src/server/mlbAdapter.js";
import { nflAuditState } from "./src/server/nflAdapter.js";
import { ncaafAuditState } from "./src/server/ncaafAdapter.js";
import { nbaAuditState } from "./src/server/nbaAdapter.js";
import { wnbaAuditState } from "./src/server/wnbaAdapter.js";
import { nhlAuditState } from "./src/server/nhlAdapter.js";
import { soccerAuditState } from "./src/server/soccerAdapter.js";
import { tennisAuditState } from "./src/server/tennisAdapter.js";
import { marketQuotaGuard } from "./src/server/marketQuotaGuard.js";
import { marketProvider } from "./src/server/marketProvider.js";
import { marketCache } from "./src/server/marketCache.js";
import { playerPropProvider } from "./src/server/playerPropProvider.js";
import { playerStatsService } from "./src/server/playerStatsService.js";
import { probabilityModelService } from "./src/server/probabilityModelService.js";
import { valueEngineService } from "./src/server/valueEngineService.js";
import { backtestEngineService } from "./src/server/backtestEngineService.js";
import { snapshotPersistenceService } from "./src/server/snapshotPersistenceService.js";
import { probabilityCalibrationService } from "./src/server/probabilityCalibrationService.js";
import { buildWalkForwardPlan } from "./src/server/walkForwardValidationService.js";
import { runMlEngineV2VerificationSuite } from "./src/server/mlEngineV2Verification.js";
import { mlbPitcherKContextService } from "./src/server/mlbPitcherKContextService.js";
import { runMlbPitcherKV3VerificationSuite } from "./src/server/mlbPitcherKV3Verification.js";
import { championChallengerService } from "./src/server/championChallengerService.js";
import { runChampionChallengerVerificationSuite } from "./src/server/championChallengerVerification.js";
import { mlbPitcherKHistoricalReplayService } from "./src/server/mlbPitcherKHistoricalReplayService.js";
import { mlbPitcherKStarterShadowCaptureService } from "./src/server/mlbPitcherKStarterShadowCaptureService.js";
import { runMlbPitcherKV5VerificationSuite } from "./src/server/mlbPitcherKV5Verification.js";
import { simulateMlbPitcherKQuote } from "./src/server/monteCarloSimulationService.js";
import { wnbaBacktestMonteCarloService } from "./src/server/wnbaBacktestMonteCarloService.js";
import { loadWnbaSimulationSlate } from "./src/server/wnbaSimulationSlateService.js";
import { decisionBoardService } from "./src/server/decisionBoardService.js";
import { runGameMarketModelVerificationSuite } from "./src/server/gameMarketModelVerification.js";
import { gameMarketPredictionRepository } from "./src/server/gameMarketPredictionRepository.js";
import { gameMarketLearningService } from "./src/server/gameMarketLearningService.js";
import { gameMarketBoardService } from "./src/server/gameMarketBoardService.js";
import { parlayService } from "./src/server/parlayService.js";
import { runParlayVerificationSuite } from "./src/server/parlayVerification.js";
import { runGameMarketCalibrationVerificationSuite } from "./src/server/gameMarketCalibrationVerification.js";
import { bankrollService } from "./src/server/bankrollService.js";
import { runBankrollVerificationSuite } from "./src/server/bankrollVerification.js";
import { runDecisionBoardCoverageVerificationSuite } from "./src/server/decisionBoardCoverageVerification.js";
import { runPropsSlatePresentationVerificationSuite } from "./src/server/propsSlatePresentationVerification.js";
import { scanPlayerPropSlate } from "./src/server/propsSlateService.js";
import { runPropsSlateScanVerification } from "./src/server/propsSlateScanVerification.js";
import { ApexSportFilter, TennisTourFilter, NormalizedApexGame, NormalizedPlayerPropQuote } from "./src/types.js";

const VALID_SPORTS = new Set<string>(['ALL', ...ALL_SPORTS]);
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version as string;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Real server endpoint: Health check
  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      app: "Apex Picks",
      version: APP_VERSION,
      oddsProviderConfigured: marketQuotaGuard.isConfigured(),
      oddsProviderStatus: marketQuotaGuard.getQuotaState().status,
    });
  });

  // Real server endpoint: Version information
  app.get("/api/version", (_req, res) => {
    res.status(200).json({
      version: APP_VERSION,
      build: "context-learning-v2-decision-ux-v1-16-0",
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
    });
  });


  // ==========================================================
  // DECISION-FIRST PICK BOARD
  // Saved lookup is zero-credit. Slate/event scans are explicit,
  // pregame-only and remain behind the existing quota guard.
  // ==========================================================
  app.get("/api/decision-board/coverage/verify", async (_req, res) => {
    res.status(200).json(await runDecisionBoardCoverageVerificationSuite());
  });

  app.get("/api/props/slate/verify", (_req, res) => {
    res.status(200).json(runPropsSlatePresentationVerificationSuite());
  });

  app.get("/api/props/slate-scan/verify", (_req, res) => {
    res.status(200).json(runPropsSlateScanVerification());
  });

  app.post("/api/props/slate-scan", async (req, res) => {
    const games = Array.isArray(req.body?.games) ? req.body.games as NormalizedApexGame[] : [];
    const selectedDate = String(req.body?.selectedDate || '');
    const sportRaw = String(req.body?.sportFilter || 'ALL').toUpperCase();
    const sportFilter = VALID_SPORTS.has(sportRaw) ? sportRaw as ApexSportFilter : 'ALL';
    const maxEvents = Number(req.body?.maxEvents || 8);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      return res.status(400).json({ status: 'ERROR', message: 'selectedDate must be YYYY-MM-DD', props: [] });
    }
    if (games.length === 0) {
      return res.status(200).json({
        status: 'NO_PROPS', selectedDate, sportFilter, eventsAvailable: 0, propCapableEvents: 0,
        eventsScanned: 0, propsCount: 0, qualifiedCount: 0, props: [], eventResults: [], unsupportedSports: [],
        message: 'No verified upcoming games are available on this props slate.',
        quotaState: marketQuotaGuard.getQuotaState(),
      });
    }

    try {
      const result = await scanPlayerPropSlate({ games, selectedDate, sportFilter, maxEvents });
      res.status(200).json(result);
    } catch (err: any) {
      console.error('[Apex Picks] POST /api/props/slate-scan error:', err?.message || err);
      res.status(500).json({
        status: 'ERROR', selectedDate, sportFilter, eventsAvailable: games.length, propCapableEvents: 0,
        eventsScanned: 0, propsCount: 0, qualifiedCount: 0, props: [], eventResults: [], unsupportedSports: [],
        message: err?.message || 'Failed to scan player-prop slate', quotaState: marketQuotaGuard.getQuotaState(),
      });
    }
  });

  app.get("/api/decision-board/saved", (req, res) => {
    const sportRaw = String(req.query.sport || 'ALL').toUpperCase();
    const sport = VALID_SPORTS.has(sportRaw) ? (sportRaw as ApexSportFilter) : 'ALL';
    const date = String(req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ status: 'ERROR', message: 'date must be YYYY-MM-DD' });
    }
    res.status(200).json(decisionBoardService.getSavedBoard(sport, date));
  });

  app.post("/api/decision-board/event", async (req, res) => {
    const game = req.body?.game as NormalizedApexGame;
    if (!game || !game.eventId) {
      return res.status(400).json({ status: 'ERROR', message: 'A verified normalized event is required.', picks: [] });
    }
    try {
      const requestedDate = String(game.startTime || game.scheduleDate || '').slice(0, 10);
      const canonicalSchedule = await fetchSchedule(game.sport, requestedDate);
      const canonicalGame = canonicalSchedule.games.find((g) => g.eventId === game.eventId);
      if (!canonicalGame) {
        return res.status(400).json({
          status: 'ERROR',
          message: 'Event identity could not be re-verified against the current public schedule.',
          picks: [],
        });
      }
      const evaluated = await decisionBoardService.evaluateEvent(canonicalGame);
      res.status(200).json({
        status: evaluated.status,
        message: evaluated.message,
        generatedAt: new Date().toISOString(),
        sportFilter: canonicalGame.sport,
        scheduleDate: (canonicalGame.startTime || canonicalGame.scheduleDate).slice(0, 10),
        requestedMaxGames: 1,
        gamesScanned: 1,
        gamesWithModelData: evaluated.modelDataAvailable ? 1 : 0,
        qualifiedCount: evaluated.picks.length,
        picks: evaluated.picks.map((p, i) => ({ ...p, rank: i + 1 })),
        notes: [
          'Event identity was re-verified server-side against the current public schedule.',
          'Event analysis uses the production recommendation gate. NO_BET results cannot appear as picks.',
        ],
      });
    } catch (err: any) {
      res.status(500).json({ status: 'ERROR', message: err.message || 'Event decision analysis failed', picks: [] });
    }
  });

  app.post("/api/decision-board/scan", async (req, res) => {
    const sportRaw = String(req.body?.sport || 'ALL').toUpperCase();
    const sport = VALID_SPORTS.has(sportRaw) ? (sportRaw as ApexSportFilter) : 'ALL';
    const date = String(req.body?.date || '');
    const defaultMax = sport === 'ALL' ? 48 : sport === 'TENNIS' ? 30 : sport === 'NFL' ? 20 : sport === 'NCAAF' ? 24 : 20;
    const maxGames = Math.max(1, Math.min(48, Number(req.body?.maxGames || defaultMax)));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ status: 'ERROR', message: 'date must be YYYY-MM-DD', picks: [] });
    }
    try {
      const schedule = await fetchSchedule(sport, date);
      const report = await decisionBoardService.scanGames(schedule.games, sport, schedule.scheduleDate, maxGames);
      res.status(200).json(report);
    } catch (err: any) {
      res.status(500).json({ status: 'ERROR', message: err.message || 'Decision-board scan failed', picks: [] });
    }
  });

  // ==========================================================
  // DEDICATED WIN PROBABILITY / GAME MARKET BOARD
  // Game markets only: ML, spread and total. Props cannot crowd
  // these categories out of the dedicated view.
  // ==========================================================
  app.post("/api/game-market-board/scan", async (req, res) => {
    const sportRaw = String(req.body?.sport || 'ALL').toUpperCase();
    const sport = VALID_SPORTS.has(sportRaw) ? (sportRaw as ApexSportFilter) : 'ALL';
    const date = String(req.body?.date || '');
    const maxGames = Math.max(1, Math.min(8, Number(req.body?.maxGames || 5)));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ status: 'ERROR', message: 'date must be YYYY-MM-DD', events: [] });
    }
    if (sport === 'TENNIS') {
      return res.status(400).json({ status: 'ERROR', message: 'Tennis uses the separate match/player model.', events: [] });
    }
    try {
      const schedule = await fetchSchedule(sport, date);
      const report = await gameMarketBoardService.scan(schedule.games, sport, schedule.scheduleDate, maxGames);
      res.status(200).json(report);
    } catch (err: any) {
      res.status(500).json({ status: 'ERROR', message: err.message || 'Game-market board scan failed', events: [] });
    }
  });

  // ==========================================================
  // APEX GAME MARKET MODEL V1 — INDEPENDENT TEAM FORECASTS
  // ==========================================================
  app.get("/api/ml/game-markets/v1/verify", (_req, res) => {
    res.status(200).json(runGameMarketModelVerificationSuite());
  });

  app.get("/api/ml/game-markets/v2/verify", (_req, res) => {
    res.status(200).json(runGameMarketModelVerificationSuite());
  });

  app.get("/api/ml/game-markets/v1/learning-status", (_req, res) => {
    res.status(200).json(gameMarketPredictionRepository.getStatus());
  });

  app.get("/api/ml/game-markets/v1/calibration", (_req, res) => {
    res.status(200).json(gameMarketPredictionRepository.getCalibrationDashboard());
  });

  app.get("/api/ml/context-learning/status", (_req, res) => {
    res.status(200).json(gameMarketPredictionRepository.getContextLearningStatus());
  });

  app.get("/api/ml/game-markets/v1/calibration/verify", (_req, res) => {
    res.status(200).json(runGameMarketCalibrationVerificationSuite());
  });

  app.post("/api/ml/game-markets/v1/grade", async (_req, res) => {
    res.status(200).json(await gameMarketLearningService.gradePending());
  });

  // ==========================================================
  // APEX PARLAY LAB V1.13
  // Only production-qualified, distinct-event legs are eligible.
  // Same-event correlation is fail-closed until a joint model exists.
  // ==========================================================
  app.post("/api/parlays/scan", async (req, res) => {
    const sportRaw = String(req.body?.sport || 'ALL').toUpperCase();
    const sport = VALID_SPORTS.has(sportRaw) ? (sportRaw as ApexSportFilter) : 'ALL';
    const date = String(req.body?.date || '');
    const legCount = Math.max(2, Math.min(4, Number(req.body?.legCount || 2)));
    const maxGames = Math.max(legCount, Math.min(36, Number(req.body?.maxGames || 24)));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ status: 'ERROR', message: 'date must be YYYY-MM-DD', tickets: [] });
    }
    try {
      const addDays = (iso: string, days: number) => {
        const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
      };
      const merged = new Map<string, NormalizedApexGame>();
      const scheduleDatesScanned: string[] = [];
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const requested = addDays(date, dayOffset);
        const schedule = await fetchSchedule(sport, requested);
        scheduleDatesScanned.push(schedule.scheduleDate || requested);
        for (const game of schedule.games) merged.set(game.eventId, game);
        const futureCount = [...merged.values()].filter((g) => g.status === 'UPCOMING' && g.startTime && Date.parse(g.startTime) > Date.now()).length;
        if (futureCount >= maxGames) break;
      }
      const report = await parlayService.scan([...merged.values()], sport, date, legCount, maxGames, scheduleDatesScanned);
      res.status(200).json(report);
    } catch (err: any) {
      res.status(500).json({ status: 'ERROR', message: err.message || 'Parlay scan failed', tickets: [] });
    }
  });

  app.get("/api/parlays/verify", (_req, res) => {
    res.status(200).json(runParlayVerificationSuite());
  });


  // ==========================================================
  // BANKROLL & RISK MANAGER V1.14
  // Local-only state in app/data; updater packages never include it.
  // ==========================================================
  app.get("/api/bankroll", (_req, res) => {
    res.status(200).json(bankrollService.getSummary());
  });

  app.get("/api/bankroll/verify", (_req, res) => {
    res.status(200).json(runBankrollVerificationSuite());
  });

  app.put("/api/bankroll/settings", (req, res) => {
    try {
      res.status(200).json(bankrollService.updateSettings(req.body || {}));
    } catch (err: any) {
      res.status(400).json({ status: 'ERROR', message: err.message || 'Unable to update bankroll settings.' });
    }
  });

  app.post("/api/bankroll/bets", (req, res) => {
    try {
      const body = req.body || {};
      res.status(201).json(bankrollService.trackBet({
        source: body.source === 'PARLAY' ? 'PARLAY' : body.source === 'MANUAL' ? 'MANUAL' : 'STRAIGHT',
        label: String(body.label || 'Tracked wager'),
        sportsbook: String(body.sportsbook || 'Unknown'),
        oddsAmerican: Number(body.oddsAmerican),
        requestedUnits: Number(body.requestedUnits),
        eventIds: Array.isArray(body.eventIds) ? body.eventIds.map(String) : [],
        details: Array.isArray(body.details) ? body.details.map(String) : [],
      }));
    } catch (err: any) {
      res.status(409).json({ status: 'ERROR', message: err.message || 'Unable to track wager.' });
    }
  });

  app.post("/api/bankroll/bets/:betId/settle", (req, res) => {
    try {
      const outcome = String(req.body?.outcome || '').toUpperCase() as any;
      res.status(200).json(bankrollService.settleBet(String(req.params.betId || ''), outcome));
    } catch (err: any) {
      res.status(400).json({ status: 'ERROR', message: err.message || 'Unable to settle wager.' });
    }
  });

  // ==========================================
  // ML ENGINE V2: POINT-IN-TIME + CALIBRATION
  // ==========================================

  app.get("/api/ml/v2/verify", (_req, res) => {
    res.status(200).json(runMlEngineV2VerificationSuite());
  });

  app.get("/api/ml/mlb/pitcher-k/v3/verify", (_req, res) => {
    res.status(200).json(runMlbPitcherKV3VerificationSuite());
  });

  app.get("/api/ml/mlb/pitcher-k/champion-challenger", (_req, res) => {
    res.status(200).json(championChallengerService.getReport());
  });

  app.get("/api/ml/mlb/pitcher-k/champion-challenger/verify", (_req, res) => {
    res.status(200).json(runChampionChallengerVerificationSuite());
  });


  // ==========================================================
  // ML ENGINE V5: FAST LEARNING / EVIDENCE ACCELERATION
  // ==========================================================

  app.get("/api/ml/mlb/pitcher-k/v5/evidence", (_req, res) => {
    const report = championChallengerService.getReport();
    res.status(200).json(report.fastLearning ?? null);
  });

  app.get("/api/ml/mlb/pitcher-k/v5/verify", (_req, res) => {
    res.status(200).json(runMlbPitcherKV5VerificationSuite());
  });

  app.post("/api/ml/mlb/pitcher-k/v5/historical-replay", async (req, res) => {
    try {
      const startDate = String(req.body?.startDate ?? '');
      const endDate = String(req.body?.endDate ?? '');
      const result = await mlbPitcherKHistoricalReplayService.replayDateRange(startDate, endDate);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(400).json({ status: 'ERROR', message: err.message || 'Historical replay failed' });
    }
  });

  app.post("/api/ml/mlb/pitcher-k/v5/capture-starters", async (req, res) => {
    try {
      const date = req.body?.date ? String(req.body.date) : undefined;
      res.status(200).json(await mlbPitcherKStarterShadowCaptureService.captureDate(date));
    } catch (err: any) {
      res.status(500).json({ status: 'ERROR', message: err.message || 'Starter shadow capture failed' });
    }
  });

  app.post("/api/ml/mlb/pitcher-k/v5/grade-starters", async (_req, res) => {
    try {
      res.status(200).json(await mlbPitcherKStarterShadowCaptureService.gradePending());
    } catch (err: any) {
      res.status(500).json({ status: 'ERROR', message: err.message || 'Starter shadow grading failed' });
    }
  });

  app.get("/api/ml/mlb/pitcher-k/v5/starter-learning/status", (_req, res) => {
    res.status(200).json(mlbPitcherKStarterShadowCaptureService.getLearningStatus());
  });

  // ==========================================================
  // DECISION-FIRST SIMULATION LAB
  // Verified MLB pitcher strikeout V3 inputs only. Simulation output
  // is shadow corroboration and never bypasses the production gate.
  // ==========================================================
  app.post("/api/sims/mlb/pitcher-k", async (req, res) => {
    const game = req.body?.game as NormalizedApexGame;
    if (!game || !game.eventId || game.sport !== 'MLB') {
      return res.status(400).json({
        status: 'ERROR',
        message: 'A verified normalized MLB game is required.',
        simulations: [],
      });
    }
    if (game.status !== 'UPCOMING' || !game.startTime || Date.now() >= Date.parse(game.startTime)) {
      return res.status(400).json({
        status: 'NOT_ELIGIBLE',
        message: 'Monte Carlo recommendation analysis is pregame-only.',
        simulations: [],
      });
    }

    try {
      const propResult = await playerPropProvider.getPlayerPropsForGame(game, ['pitcher_strikeouts']);
      if (propResult.status !== 'SUCCESS') {
        return res.status(200).json({
          status: propResult.status,
          message: propResult.message || 'Verified pitcher strikeout markets are unavailable.',
          eventTitle: propResult.eventTitle,
          simulations: [],
          quotaState: propResult.quotaState,
        });
      }

      const simulations = (propResult.props || [])
        .filter((q) => q.providerMarketKey === 'pitcher_strikeouts')
        .map((q) => simulateMlbPitcherKQuote(q, 10000))
        .sort((a, b) => {
          const aq = a.productionDecision === 'QUALIFIES' ? 1 : 0;
          const bq = b.productionDecision === 'QUALIFIES' ? 1 : 0;
          if (aq !== bq) return bq - aq;
          const ap = a.productionProbability ?? -1;
          const bp = b.productionProbability ?? -1;
          if (ap !== bp) return bp - ap;
          return (b.productionEVPercent ?? -999) - (a.productionEVPercent ?? -999);
        });

      res.status(200).json({
        status: 'SUCCESS',
        simulationVersion: 'APEX_MLB_K_MONTE_CARLO_V1',
        trialsPerQuote: 10000,
        eventTitle: propResult.eventTitle,
        generatedAt: new Date().toISOString(),
        note: 'V3 simulation is audit/shadow corroboration. The production recommendation gate remains authoritative.',
        simulations,
        quotaState: propResult.quotaState,
      });
    } catch (err: any) {
      console.error('[Apex Picks] MLB pitcher K simulation error:', err.message);
      res.status(500).json({ status: 'ERROR', message: err.message || 'Simulation failed', simulations: [] });
    }
  });

  // ==========================================================
  // WNBA HISTORICAL WALK-FORWARD + MONTE CARLO CALIBRATION
  // Real completed WNBA games create evidence. Simulation trials do NOT.
  // Historical market ROI remains unavailable unless authentic archived
  // lines/prices are present; Apex never fabricates historical -110 odds.
  // ==========================================================
  app.get("/api/ml/wnba/backtest/status", (_req, res) => {
    const report = wnbaBacktestMonteCarloService.getSavedReport();
    res.status(200).json({
      status: report ? 'AVAILABLE' : 'NOT_RUN',
      report,
      moneylineEvidence: wnbaBacktestMonteCarloService.getMoneylineEvidence(),
    });
  });

  app.post("/api/ml/wnba/backtest/run", async (req, res) => {
    try {
      const nowYear = new Date().getUTCFullYear();
      const startSeason = Number(req.body?.startSeason ?? nowYear - 2);
      const endSeason = Number(req.body?.endSeason ?? nowYear);
      const trialsPerGame = Number(req.body?.trialsPerGame ?? 2000);
      const report = await wnbaBacktestMonteCarloService.runHistoricalBacktest(startSeason, endSeason, trialsPerGame);
      res.status(200).json({ status: 'SUCCESS', report, moneylineEvidence: wnbaBacktestMonteCarloService.getMoneylineEvidence() });
    } catch (err: any) {
      console.error('[Apex Picks] WNBA historical backtest error:', err.message);
      res.status(500).json({ status: 'ERROR', message: err.message || 'WNBA historical backtest failed' });
    }
  });

  app.get("/api/sims/wnba/slate", async (req, res) => {
    const date = String(req.query?.date || '');
    try {
      const slate = await loadWnbaSimulationSlate(date);
      res.status(200).json(slate);
    } catch (err: any) {
      res.status(400).json({ status: 'ERROR', message: err.message || 'WNBA simulation slate failed to load', games: [] });
    }
  });

  app.post("/api/sims/wnba/game", async (req, res) => {
    const game = req.body?.game as NormalizedApexGame;
    const trials = Number(req.body?.trials ?? 25000);
    if (!game || !game.eventId || game.sport !== 'WNBA') {
      return res.status(400).json({ status: 'ERROR', message: 'A verified normalized WNBA game is required.' });
    }
    try {
      const simulation = await wnbaBacktestMonteCarloService.simulateGame(game, trials);
      res.status(200).json({
        status: 'SUCCESS',
        generatedAt: new Date().toISOString(),
        simulation,
        historicalEvidence: wnbaBacktestMonteCarloService.getMoneylineEvidence(),
        note: 'Historical games create calibration evidence; Monte Carlo trials only resolve the scenario distribution.',
      });
    } catch (err: any) {
      res.status(400).json({ status: 'NOT_ELIGIBLE', message: err.message || 'WNBA simulation failed' });
    }
  });

  app.post("/api/ml/mlb/pitcher-k/v3/context", async (req, res) => {
    const quote = req.body?.quote as NormalizedPlayerPropQuote;
    if (!quote || quote.sport !== 'MLB' || quote.providerMarketKey !== 'pitcher_strikeouts') {
      return res.status(400).json({ status: 'ERROR', message: 'A verified MLB pitcher_strikeouts quote is required.' });
    }
    const enriched = await mlbPitcherKContextService.enrichQuote(quote);
    res.status(200).json(enriched.mlbPitcherKContext ?? null);
  });

  app.get("/api/ml/walk-forward/plan", (req, res) => {
    const minTrain = Math.max(10, Number(req.query.minTrain ?? 30));
    const testSize = Math.max(1, Number(req.query.testSize ?? 10));
    const snapshots = snapshotPersistenceService.getAllSnapshots();
    res.status(200).json(buildWalkForwardPlan(snapshots, minTrain, testSize));
  });

  app.get("/api/ml/calibration/status", (req, res) => {
    const sport = String(req.query.sport ?? '').toUpperCase() as any;
    const market = String(req.query.market ?? '');
    const modelVersion = String(req.query.modelVersion ?? 'APEX_BASELINE_V1');
    if (!sport || sport === 'ALL' || !VALID_SPORTS.has(sport) || !market) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Valid sport and market query parameters are required.',
      });
    }
    const result = probabilityCalibrationService.calibratePair({
      sport,
      market,
      modelVersion,
      rawOverProbability: 0.5,
      rawUnderProbability: 0.5,
      pushProbability: 0,
      asOf: new Date(),
    });
    res.status(200).json({ status: result.status, calibration: result.info });
  });

  // ==========================================
  // STAGE 3A: MARKET PROVIDER & COST PROTECTION
  // ==========================================

  // Quota & Provider status
  app.get("/api/markets/quota", (_req, res) => {
    res.status(200).json(marketQuotaGuard.getQuotaState());
  });

  // Market Provider Diagnostics for Audit View
  app.get("/api/markets/audit", (_req, res) => {
    res.status(200).json(marketProvider.getAuditDiagnostics());
  });

  // Fetch Markets for a specific UPCOMING verified Apex game
  app.post("/api/markets/event", async (req, res) => {
    const { game } = req.body as { game?: NormalizedApexGame };
    if (!game || !game.eventId || !game.sport) {
      return res.status(400).json({
        status: "ERROR",
        message: "Missing required 'game' object with eventId and sport",
        markets: null,
        quotaState: marketQuotaGuard.getQuotaState(),
      });
    }

    try {
      const result = await marketProvider.getMarketsForEvent(game);
      res.status(200).json(result);
    } catch (err: any) {
      console.error(`[Apex Picks] /api/markets/event error for ${game.eventId}:`, err.message);
      res.status(500).json({
        apexEventId: game.eventId,
        status: "ERROR",
        message: err.message || "Failed to retrieve markets",
        markets: null,
        quotaState: marketQuotaGuard.getQuotaState(),
      });
    }
  });

  // Direct GET route for markets by eventId and sport
  app.get("/api/markets/event", async (req, res) => {
    const eventId = req.query.eventId as string;
    const sport = (req.query.sport as string)?.toUpperCase() as any;
    const date = req.query.date as string;

    if (!eventId || !sport) {
      return res.status(400).json({
        status: "ERROR",
        message: "Query parameters 'eventId' and 'sport' are required",
        markets: null,
        quotaState: marketQuotaGuard.getQuotaState(),
      });
    }

    try {
      const schedule = await fetchSchedule(sport, date);
      const game = schedule.games.find((g) => g.eventId === eventId);

      if (!game) {
        return res.status(404).json({
          apexEventId: eventId,
          status: "NOT_ELIGIBLE",
          message: `Game with ID '${eventId}' does not exist on verified Apex slate for ${sport}`,
          markets: null,
          quotaState: marketQuotaGuard.getQuotaState(),
        });
      }

      const result = await marketProvider.getMarketsForEvent(game);
      res.status(200).json(result);
    } catch (err: any) {
      console.error(`[Apex Picks] GET /api/markets/event error:`, err.message);
      res.status(500).json({
        apexEventId: eventId,
        status: "ERROR",
        message: err.message || "Failed to retrieve markets",
        markets: null,
        quotaState: marketQuotaGuard.getQuotaState(),
      });
    }
  });

  // ==========================================
  // STAGE 3B: PLAYER PROP API ENDPOINTS
  // ==========================================

  // Prop Pipeline Diagnostics
  app.get("/api/props/audit", (_req, res) => {
    res.status(200).json({
      audit: playerPropProvider.getAuditDiagnostics(),
      quota: marketQuotaGuard.getQuotaState(),
    });
  });

  // Negative Tests Execution (Wrong Team, Unknown Player, Ambiguous Name)
  app.get("/api/props/negative-tests", async (_req, res) => {
    const initialQuota = marketQuotaGuard.getQuotaState();
    const initialUsed = initialQuota.dailyUsed;

    const wrongTeam = await playerPropProvider.runWrongTeamTest();
    const unknownPlayer = await playerPropProvider.runUnknownPlayerTest();
    const ambiguousName = await playerPropProvider.runAmbiguousNameTest();

    const finalQuota = marketQuotaGuard.getQuotaState();
    const consumed = finalQuota.dailyUsed - initialUsed;

    res.status(200).json({
      totalTests: 3,
      allPassed: wrongTeam.status === 'PASS' && unknownPlayer.status === 'PASS' && ambiguousName.status === 'PASS' && consumed === 0,
      keyedRequestsConsumed: consumed,
      tests: [wrongTeam, unknownPlayer, ambiguousName],
    });
  });

  // Retrieve Player Props for an Event
  app.post("/api/props/event", async (req, res) => {
    const game = req.body?.game as NormalizedApexGame;
    const marketKeys = req.body?.marketKeys as string[] | undefined;

    if (!game || !game.eventId || !game.sport) {
      return res.status(400).json({
        apexEventId: "unknown",
        status: "ERROR",
        message: "Request body must include a valid normalized 'game' object with eventId and sport",
        propsCount: 0,
        props: [],
        rejectionsCount: 0,
        quotaState: marketQuotaGuard.getQuotaState(),
      });
    }

    try {
      const result = await playerPropProvider.getPlayerPropsForGame(game, marketKeys);
      res.status(200).json(result);
    } catch (err: any) {
      console.error(`[Apex Picks] POST /api/props/event error:`, err.message);
      res.status(500).json({
        apexEventId: game.eventId,
        status: "ERROR",
        message: err.message || "Failed to retrieve player props",
        propsCount: 0,
        props: [],
        rejectionsCount: 0,
        quotaState: marketQuotaGuard.getQuotaState(),
      });
    }
  });

  // Direct GET route for player props by eventId and sport
  app.get("/api/props/event", async (req, res) => {
    const eventId = req.query.eventId as string;
    const sport = (req.query.sport as string)?.toUpperCase() as any;
    const date = req.query.date as string;

    if (!eventId || !sport) {
      return res.status(400).json({
        status: "ERROR",
        message: "Query parameters 'eventId' and 'sport' are required",
        propsCount: 0,
        props: [],
        rejectionsCount: 0,
        quotaState: marketQuotaGuard.getQuotaState(),
      });
    }

    try {
      const schedule = await fetchSchedule(sport, date);
      const game = schedule.games.find((g) => g.eventId === eventId);

      if (!game) {
        return res.status(404).json({
          apexEventId: eventId,
          status: "NOT_ELIGIBLE",
          message: `Game with ID '${eventId}' does not exist on verified Apex slate for ${sport}`,
          propsCount: 0,
          props: [],
          rejectionsCount: 0,
          quotaState: marketQuotaGuard.getQuotaState(),
        });
      }

      const result = await playerPropProvider.getPlayerPropsForGame(game);
      res.status(200).json(result);
    } catch (err: any) {
      console.error(`[Apex Picks] GET /api/props/event error:`, err.message);
      res.status(500).json({
        apexEventId: eventId,
        status: "ERROR",
        message: err.message || "Failed to retrieve player props",
        propsCount: 0,
        props: [],
        rejectionsCount: 0,
        quotaState: marketQuotaGuard.getQuotaState(),
      });
    }
  });

  // ========================================================
  // STAGE 3C-1: VERIFIED PLAYER STATISTICS ENGINE ENDPOINTS
  // ========================================================

  // Enrich / Recalculate Player Historical Stats for a Given Quote & Line
  app.post("/api/props/player-stats", async (req, res) => {
    const quote = req.body?.quote as NormalizedPlayerPropQuote;
    const customLine = req.body?.line !== undefined ? Number(req.body.line) : undefined;

    if (!quote || !quote.sport || !quote.providerMarketKey) {
      return res.status(400).json({
        status: "ERROR",
        message: "Request body must include a valid 'quote' object",
      });
    }

    try {
      const activeQuote = customLine !== undefined ? { ...quote, line: customLine } : quote;
      const statsSummary = await playerStatsService.enrichPropWithHistoricalStats(activeQuote);
      res.status(200).json(statsSummary);
    } catch (err: any) {
      console.error(`[Apex Picks] POST /api/props/player-stats error:`, err.message);
      res.status(500).json({
        status: "ERROR",
        message: err.message || "Failed to compute player historical statistics",
      });
    }
  });

  // Statistics Engine Audit Telemetry
  app.get("/api/props/stats/audit", (_req, res) => {
    const telemetry = playerStatsService.getAuditTelemetry();
    res.status(200).json(telemetry);
  });

  // Programmatic Accuracy Verification & Critical Tests
  app.get("/api/props/stats/verify", async (_req, res) => {
    try {
      const initialQuota = marketQuotaGuard.getQuotaState();
      const initialUsed = initialQuota.dailyUsed;

      const verificationResult = await playerStatsService.runVerificationSuite();

      const finalQuota = marketQuotaGuard.getQuotaState();
      const consumed = finalQuota.dailyUsed - initialUsed;
      verificationResult.keyedRequestsConsumed = consumed;

      res.status(200).json(verificationResult);
    } catch (err: any) {
      console.error(`[Apex Picks] GET /api/props/stats/verify error:`, err.message);
      res.status(500).json({
        allPassed: false,
        error: err.message,
      });
    }
  });

  // Statistics Refresh Cost Firewall Test (Ensures 0 keyed requests on stats refresh)
  app.post("/api/props/stats/refresh-test", async (_req, res) => {
    const initialQuota = marketQuotaGuard.getQuotaState();
    const initialUsed = initialQuota.dailyUsed;

    // Run verification suite which fetches real athlete game logs from ESPN
    await playerStatsService.runVerificationSuite();

    const finalQuota = marketQuotaGuard.getQuotaState();
    const finalUsed = finalQuota.dailyUsed;
    const consumed = finalUsed - initialUsed;
    const passed = consumed === 0;

    res.status(200).json({
      test: "STATS_REFRESH_FIREWALL",
      initialKeyedUsed: initialUsed,
      finalKeyedUsed: finalUsed,
      keyedRequestsConsumed: consumed,
      passed,
      timestamp: new Date().toISOString(),
      details: passed
        ? "PASS: Historical statistics operations are 100% firewalled from keyed market provider. Zero keyed requests consumed."
        : `FAIL: Statistics refresh consumed ${consumed} keyed requests!`,
    });
  });

  // ========================================================
  // STAGE 3C-2: TRANSPARENT PROBABILITY MODEL (APEX_BASELINE_V1)
  // ========================================================

  // Evaluate / Recalculate Probability for a Given Quote (supports dynamic line)
  app.post("/api/props/probability", async (req, res) => {
    const quote = req.body?.quote as NormalizedPlayerPropQuote;
    const customLine = req.body?.line !== undefined ? Number(req.body.line) : undefined;

    if (!quote || !quote.sport || !quote.providerMarketKey) {
      return res.status(400).json({
        status: "ERROR",
        message: "Request body must include a valid 'quote' object",
      });
    }

    try {
      let activeQuote = quote;
      // If a custom line is passed or if historicalStats need recalculation for that line
      if (customLine !== undefined && customLine !== quote.line) {
        const statsSummary = await playerStatsService.enrichPropWithHistoricalStats({
          ...quote,
          line: customLine,
        });
        activeQuote = {
          ...quote,
          line: customLine,
          historicalStats: statsSummary,
        };
      } else if (!quote.historicalStats) {
        const statsSummary = await playerStatsService.enrichPropWithHistoricalStats(quote);
        activeQuote = {
          ...quote,
          historicalStats: statsSummary,
        };
      }

      if (activeQuote.sport === 'MLB' && activeQuote.providerMarketKey === 'pitcher_strikeouts') {
        activeQuote = await mlbPitcherKContextService.enrichQuote(activeQuote);
      }

      const probabilityResult = probabilityModelService.evaluatePropProbability(activeQuote);
      res.status(200).json(probabilityResult);
    } catch (err: any) {
      console.error(`[Apex Picks] POST /api/props/probability error:`, err.message);
      res.status(500).json({
        status: "ERROR",
        message: err.message || "Failed to evaluate prop probability",
      });
    }
  });

  // Probability Engine Audit Telemetry
  app.get("/api/props/probability/audit", (_req, res) => {
    const telemetry = probabilityModelService.getAuditTelemetry();
    res.status(200).json(telemetry);
  });

  // Programmatic Accuracy Verification & Critical Tests for Probability Engine
  app.get("/api/props/probability/verify", async (_req, res) => {
    try {
      const initialQuota = marketQuotaGuard.getQuotaState();
      const initialUsed = initialQuota.dailyUsed;

      const verificationResult = probabilityModelService.runVerificationSuite();

      const finalQuota = marketQuotaGuard.getQuotaState();
      const consumed = finalQuota.dailyUsed - initialUsed;
      verificationResult.keyedRequestsConsumed = consumed;

      res.status(200).json(verificationResult);
    } catch (err: any) {
      console.error(`[Apex Picks] GET /api/props/probability/verify error:`, err.message);
      res.status(500).json({
        allPassed: false,
        error: err.message,
      });
    }
  });

  // Probability Refresh Cost Firewall Test (Ensures 0 keyed requests on probability recalculation)
  app.post("/api/props/probability/refresh-test", async (_req, res) => {
    const initialQuota = marketQuotaGuard.getQuotaState();
    const initialUsed = initialQuota.dailyUsed;

    // Run verification suite which computes multiple full models
    probabilityModelService.runVerificationSuite();

    const finalQuota = marketQuotaGuard.getQuotaState();
    const finalUsed = finalQuota.dailyUsed;
    const consumed = finalUsed - initialUsed;
    const passed = consumed === 0;

    res.status(200).json({
      test: "PROBABILITY_REFRESH_FIREWALL",
      initialKeyedUsed: initialUsed,
      finalKeyedUsed: finalUsed,
      keyedRequestsConsumed: consumed,
      passed,
      timestamp: new Date().toISOString(),
      details: passed
        ? "PASS: Probability engine operations are 100% deterministic & firewalled from keyed market provider. Zero keyed requests consumed."
        : `FAIL: Probability refresh consumed ${consumed} keyed requests!`,
    });
  });

  // ========================================================
  // STAGE 3C-3: EDGE, EV, LINE SHOPPING & RECOMMENDATION (APEX_VALUE_V1)
  // ========================================================

  // Evaluate / Recalculate Edge, EV & Recommendation for a Quote
  app.post("/api/props/value", async (req, res) => {
    const quote = req.body?.quote as NormalizedPlayerPropQuote;
    const allQuotes = (req.body?.allQuotes as NormalizedPlayerPropQuote[]) || [];

    if (!quote || !quote.sport || !quote.providerMarketKey) {
      return res.status(400).json({
        status: "ERROR",
        message: "Request body must include a valid 'quote' object",
      });
    }

    try {
      let activeQuote = quote;
      if (!quote.probabilityAnalysis) {
        if (activeQuote.sport === 'MLB' && activeQuote.providerMarketKey === 'pitcher_strikeouts') {
          activeQuote = await mlbPitcherKContextService.enrichQuote(activeQuote);
        }
        const prob = probabilityModelService.evaluatePropProbability(activeQuote);
        activeQuote = { ...activeQuote, probabilityAnalysis: prob };
      }

      const valueResult = valueEngineService.evaluatePropValue(activeQuote, allQuotes);
      res.status(200).json(valueResult);
    } catch (err: any) {
      console.error(`[Apex Picks] POST /api/props/value error:`, err.message);
      res.status(500).json({
        status: "ERROR",
        message: err.message || "Failed to evaluate prop value",
      });
    }
  });

  // Value Engine Audit Telemetry
  app.get("/api/props/value/audit", (_req, res) => {
    const telemetry = valueEngineService.getAuditTelemetry();
    res.status(200).json(telemetry);
  });

  // Programmatic Accuracy Verification & Critical Tests for Value & Recommendation Engine
  app.get("/api/props/value/verify", async (_req, res) => {
    try {
      const initialQuota = marketQuotaGuard.getQuotaState();
      const initialUsed = initialQuota.dailyUsed;

      const verificationResult = valueEngineService.runVerificationSuite();

      const finalQuota = marketQuotaGuard.getQuotaState();
      const consumed = finalQuota.dailyUsed - initialUsed;
      verificationResult.keyedRequestsConsumed = consumed;

      res.status(200).json(verificationResult);
    } catch (err: any) {
      console.error(`[Apex Picks] GET /api/props/value/verify error:`, err.message);
      res.status(500).json({
        allPassed: false,
        error: err.message,
      });
    }
  });

  // Value & Recommendation Refresh Cost Firewall Test (Ensures 0 keyed requests on recommendation recalculation)
  app.post("/api/props/value/refresh-test", async (_req, res) => {
    const initialQuota = marketQuotaGuard.getQuotaState();
    const initialUsed = initialQuota.dailyUsed;

    // Run verification suite which computes multiple full valuations and recommendations
    valueEngineService.runVerificationSuite();

    const finalQuota = marketQuotaGuard.getQuotaState();
    const finalUsed = finalQuota.dailyUsed;
    const consumed = finalUsed - initialUsed;
    const passed = consumed === 0;

    res.status(200).json({
      test: "RECOMMENDATION_REFRESH_FIREWALL",
      initialKeyedUsed: initialUsed,
      finalKeyedUsed: finalUsed,
      keyedRequestsConsumed: consumed,
      passed,
      timestamp: new Date().toISOString(),
      details: passed
        ? "PASS: Edge, EV, Line Shopping and Recommendation evaluations are 100% deterministic & firewalled. Zero keyed requests consumed."
        : `FAIL: Recommendation refresh consumed ${consumed} keyed requests!`,
    });
  });

  // ========================================================
  // STAGE 4A: HISTORICAL GRADING & BACKTESTING ENGINE
  // ========================================================

  // Backtest Audit Diagnostic & Summary Metrics
  app.get("/api/backtest/diagnostic", (_req, res) => {
    try {
      const diag = backtestEngineService.getBacktestAuditDiagnostic();
      res.status(200).json(diag);
    } catch (err: any) {
      console.error(`[Apex Picks] GET /api/backtest/diagnostic error:`, err.message);
      res.status(500).json({
        error: "Failed to generate backtest diagnostic",
        message: err.message,
      });
    }
  });

  // Programmatic Accuracy Verification & Critical Tests for Backtesting Framework
  app.get("/api/backtest/verify", (_req, res) => {
    try {
      const result = backtestEngineService.runDeterministicBacktestTestSuite();
      res.status(200).json(result);
    } catch (err: any) {
      console.error(`[Apex Picks] GET /api/backtest/verify error:`, err.message);
      res.status(500).json({
        test: "STAGE_4A_BACKTEST_FRAMEWORK",
        status: "FAILURE",
        error: err.message,
      });
    }
  });

  // STAGE 4A-2: Snapshot Persistence Test Suite
  app.get("/api/backtest/persistence/verify", (_req, res) => {
    try {
      const result = snapshotPersistenceService.runPersistenceTestSuite();
      res.status(200).json(result);
    } catch (err: any) {
      console.error(`[Apex Picks] GET /api/backtest/persistence/verify error:`, err.message);
      res.status(500).json({
        test: "STAGE_4A_2_SNAPSHOT_PERSISTENCE",
        status: "FAILURE",
        error: err.message,
      });
    }
  });

  // STAGE 4A-2: Snapshot Persistence Audit Status
  app.get("/api/backtest/persistence/audit", (_req, res) => {
    try {
      const audit = snapshotPersistenceService.getAuditStatus();
      res.status(200).json(audit);
    } catch (err: any) {
      console.error(`[Apex Picks] GET /api/backtest/persistence/audit error:`, err.message);
      res.status(500).json({
        status: "ERROR",
        error: err.message,
      });
    }
  });

  // Download Current Snapshot Backup File as APEX_REAL_PREGAME_SNAPSHOT_BACKUP_2026-08-28.json
  app.get("/api/backtest/snapshots/download", (_req, res) => {
    try {
      const filePath = path.resolve(process.cwd(), "data", "historicalPropSnapshots.json");
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="APEX_REAL_PREGAME_SNAPSHOT_BACKUP_2026-08-28.json"'
      );
      res.sendFile(filePath);
    } catch (err: any) {
      console.error("[Apex Picks] GET /api/backtest/snapshots/download error:", err.message);
      res.status(500).json({
        status: "ERROR",
        error: err.message,
      });
    }
  });

  // STAGE 4A-2: Capture First Real Pregame Proposition Snapshot & Verify Durable Read-Back
  app.post("/api/backtest/persistence/capture-current", async (_req, res) => {
    try {
      // 1. Fetch current upcoming games
      const schedule = await fetchSchedule("ALL");
      const upcomingGames = schedule.games.filter(
        (g) =>
          g.status === "UPCOMING" &&
          (!g.startTime || new Date(g.startTime).getTime() > Date.now())
      );

      if (upcomingGames.length === 0) {
        return res.status(200).json({
          status: "NO_UPCOMING_GAMES_AVAILABLE",
          message: "No scheduled upcoming games found on the slate to capture pregame quote.",
          captured: false,
        });
      }

      // 2. Fetch props for the first upcoming game
      let capturedSnapshot = null;
      for (const game of upcomingGames) {
        const propsRes = await playerPropProvider.getPlayerPropsForGame(game);
        if (propsRes.props && propsRes.props.length > 0) {
          const eligibleQuote = propsRes.props.find(
            (p) => p.playerDisplayName && p.line && p.probabilityAnalysis && p.valueAnalysis
          );
          if (eligibleQuote) {
            // Persist quote
            const persistRes = snapshotPersistenceService.persistQuoteSnapshot(
              eligibleQuote,
              game.startTime || new Date(Date.now() + 3600000).toISOString(),
              true
            );

            // Read back from durable store
            const readBack = snapshotPersistenceService.getSnapshotById(persistRes.snapshotId);
            capturedSnapshot = {
              persistResult: persistRes,
              readBackSnapshot: readBack,
              game: `${game.awayTeam} @ ${game.homeTeam}`,
              startTime: game.startTime,
              market: eligibleQuote.providerMarketKey,
              player: eligibleQuote.playerDisplayName,
              line: eligibleQuote.line,
            };
            break;
          }
        }
      }

      res.status(200).json({
        status: capturedSnapshot ? "SUCCESS" : "NO_ELIGIBLE_PROPS_FOUND",
        captured: !!capturedSnapshot,
        details: capturedSnapshot,
      });
    } catch (err: any) {
      console.error(`[Apex Picks] POST /api/backtest/persistence/capture-current error:`, err.message);
      res.status(500).json({
        status: "ERROR",
        error: err.message,
      });
    }
  });

  // Live-Score Firewall Automated Verification Endpoint
  app.post("/api/markets/firewall-test", async (_req, res) => {
    const initialQuota = marketQuotaGuard.getQuotaState();
    const initialUsed = initialQuota.dailyUsed;

    const pollsCount = 5;
    const pollResults: any[] = [];

    // Perform 5 multi-sport live-score polls
    for (let i = 0; i < pollsCount; i++) {
      const pollRes = await fetchLiveScores("ALL");
      pollResults.push({
        poll: i + 1,
        gamesUpdated: pollRes.games.length,
        liveCount: pollRes.liveCount,
      });
    }

    const finalQuota = marketQuotaGuard.getQuotaState();
    const finalUsed = finalQuota.dailyUsed;
    const consumed = finalUsed - initialUsed;
    const passed = consumed === 0;

    res.status(200).json({
      test: "LIVE_SCORE_FIREWALL",
      initialKeyedUsed: initialUsed,
      finalKeyedUsed: finalUsed,
      keyedRequestsConsumed: consumed,
      pollsExecuted: pollsCount,
      passed,
      timestamp: new Date().toISOString(),
      details: passed
        ? "PASS: Live-score polling is 100% firewalled from keyed market provider. Zero keyed requests consumed."
        : `FAIL: ${consumed} keyed requests were triggered during live score polling.`,
      pollResults,
    });
  });

  // Real server endpoint: Multi-Sport Schedule (including Tennis)
  app.get("/api/schedule", async (req, res) => {
    const rawSport = (req.query.sport as string) || "ALL";
    const sport = rawSport.toUpperCase() as ApexSportFilter;
    const date = (req.query.date as string) || undefined;
    const competition = (req.query.competition as string) || undefined;
    const tour = (req.query.tour as string)?.toUpperCase() as TennisTourFilter | undefined;

    if (!VALID_SPORTS.has(sport)) {
      return res.status(400).json({
        error: "Invalid sport parameter",
        message: `Supported sports are: ${Array.from(VALID_SPORTS).join(", ")}. Received: '${rawSport}'`,
      });
    }

    try {
      const schedule = await fetchSchedule(sport, date, competition, tour);
      res.status(200).json(schedule);
    } catch (err: any) {
      console.error(`[Apex Picks] /api/schedule (${sport}) error:`, err.message);
      res.status(502).json({
        error: "Sports data retrieval failure",
        message: err.message || `Failed to fetch ${sport} schedule from public source`,
        source: "ESPN",
      });
    }
  });

  // Real server endpoint: Multi-Sport Live Scores (~30s polling)
  app.get("/api/live-scores", async (req, res) => {
    const rawSport = (req.query.sport as string) || "ALL";
    const sport = rawSport.toUpperCase() as ApexSportFilter;
    const tour = (req.query.tour as string)?.toUpperCase() as TennisTourFilter | undefined;

    if (!VALID_SPORTS.has(sport)) {
      return res.status(400).json({
        error: "Invalid sport parameter",
        message: `Supported sports are: ${Array.from(VALID_SPORTS).join(", ")}. Received: '${rawSport}'`,
      });
    }

    try {
      const liveScores = await fetchLiveScores(sport, tour);
      res.status(200).json(liveScores);
    } catch (err: any) {
      console.error(`[Apex Picks] /api/live-scores (${sport}) error:`, err.message);
      res.status(502).json({
        error: "Sports live-score retrieval failure",
        message: err.message || `Failed to fetch ${sport} live scores from public source`,
        source: "ESPN",
      });
    }
  });

  // Real server endpoint: Unified Multi-Sport Diagnostics
  app.get("/api/audit/diagnostics", (_req, res) => {
    res.status(200).json(getMultiSportAuditDiagnostics());
  });

  // Per-sport audit endpoints
  app.get("/api/audit/mlb", (_req, res) => {
    res.status(200).json(mlbAuditState);
  });
  app.get("/api/audit/nfl", (_req, res) => {
    res.status(200).json(nflAuditState);
  });
  app.get("/api/audit/ncaaf", (_req, res) => {
    res.status(200).json(ncaafAuditState);
  });
  app.get("/api/audit/nba", (_req, res) => {
    res.status(200).json(nbaAuditState);
  });
  app.get("/api/audit/wnba", (_req, res) => {
    res.status(200).json(wnbaAuditState);
  });
  app.get("/api/audit/nhl", (_req, res) => {
    res.status(200).json(nhlAuditState);
  });
  app.get("/api/audit/soccer", (_req, res) => {
    res.status(200).json(soccerAuditState);
  });
  app.get("/api/audit/tennis", (_req, res) => {
    res.status(200).json(tennisAuditState);
  });

  // Vite integration: Dev middleware or static files for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Apex Picks] Server running at http://0.0.0.0:${PORT}`);

    // V5 public-data learning loop. It never calls the keyed odds provider and preserves
    // the first valid pregame starter forecast. Disable with APEX_V5_AUTO_STARTER_LEARNING=false.
    if (String(process.env.APEX_V5_AUTO_STARTER_LEARNING ?? 'true').toLowerCase() !== 'false') {
      const requestedMinutes = Number(process.env.APEX_V5_STARTER_LEARNING_INTERVAL_MINUTES ?? 60);
      const intervalMinutes = Number.isFinite(requestedMinutes) ? Math.max(30, requestedMinutes) : 60;
      const run = () => {
        mlbPitcherKStarterShadowCaptureService.runLearningCycle().catch((err: any) => {
          console.warn(`[Apex Picks] V5 starter-learning cycle skipped: ${err?.message || err}`);
        });
      };
      const startupTimer = setTimeout(run, 10_000);
      const intervalTimer = setInterval(run, intervalMinutes * 60_000);
      (startupTimer as any).unref?.();
      (intervalTimer as any).unref?.();
      console.log(`[Apex Picks] V5 all-starter learning enabled every ${intervalMinutes} minutes (public MLB data; 0 keyed odds requests).`);
    }

    // Independent game-market prospective grading. Public ESPN final scores only; 0 keyed odds requests.
    if (String(process.env.APEX_GAME_MODEL_AUTO_GRADE ?? 'true').toLowerCase() !== 'false') {
      const gradeRun = () => gameMarketLearningService.gradePending().catch((err: any) => {
        console.warn(`[Apex Picks] Game-model grading cycle skipped: ${err?.message || err}`);
      });
      const gradeStartup = setTimeout(gradeRun, 20_000);
      const gradeInterval = setInterval(gradeRun, 60 * 60_000);
      (gradeStartup as any).unref?.();
      (gradeInterval as any).unref?.();
      console.log('[Apex Picks] Game-market prospective grading enabled every 60 minutes (public final scores; 0 keyed odds requests).');
    }
  });
}

startServer();
