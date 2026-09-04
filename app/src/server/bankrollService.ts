import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  BankrollBetEntry,
  BankrollBetOutcome,
  BankrollSettings,
  BankrollStakePreview,
  BankrollSummary,
  BankrollState,
} from '../types.js';

const STATE_VERSION = 'APEX_BANKROLL_V1_14';
const DEFAULT_SETTINGS: BankrollSettings = {
  configured: false,
  currentBankroll: 0,
  unitPercent: 1.0,
  dailyRiskCapPercent: 5.0,
  maxOpenExposurePercent: 10.0,
  maxStraightBetUnits: 1.0,
  maxParlayBetUnits: 0.5,
  updatedAt: new Date(0).toISOString(),
};

function round2(v: number) { return Math.round((v + Number.EPSILON) * 100) / 100; }
function roundUnitsDown(v: number) { return Math.max(0, Math.floor((v + 1e-9) * 20) / 20); }
function decimalFromAmerican(a: number) { return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a); }
function todayKey(d = new Date()) { return d.toISOString().slice(0, 10); }

function defaultDataDir() { return process.env.APEX_DATA_DIR || path.join(process.cwd(), 'data'); }

function emptyState(): BankrollState {
  return { version: STATE_VERSION, settings: { ...DEFAULT_SETTINGS }, bets: [] };
}

export class BankrollService {
  constructor(private readonly dataDirOverride?: string) {}
  private dataDir() { return this.dataDirOverride || defaultDataDir(); }
  private stateFile() { return path.join(this.dataDir(), 'bankrollState.json'); }
  private ensureDir() { fs.mkdirSync(this.dataDir(), { recursive: true }); }

  private loadState(): BankrollState {
    this.ensureDir();
    const file = this.stateFile();
    if (!fs.existsSync(file)) return emptyState();
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<BankrollState>;
      return {
        version: STATE_VERSION,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
        bets: Array.isArray(parsed.bets) ? parsed.bets : [],
      };
    } catch {
      return emptyState();
    }
  }

  private saveState(state: BankrollState) {
    this.ensureDir();
    const target = this.stateFile();
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, target);
  }

  getSettings(): BankrollSettings { return this.loadState().settings; }

  updateSettings(input: Partial<BankrollSettings>): BankrollSummary {
    const state = this.loadState();
    const current = state.settings;
    const next: BankrollSettings = {
      ...current,
      currentBankroll: Number(input.currentBankroll ?? current.currentBankroll),
      unitPercent: Number(input.unitPercent ?? current.unitPercent),
      dailyRiskCapPercent: Number(input.dailyRiskCapPercent ?? current.dailyRiskCapPercent),
      maxOpenExposurePercent: Number(input.maxOpenExposurePercent ?? current.maxOpenExposurePercent),
      maxStraightBetUnits: Number(input.maxStraightBetUnits ?? current.maxStraightBetUnits),
      maxParlayBetUnits: Number(input.maxParlayBetUnits ?? current.maxParlayBetUnits),
      configured: true,
      updatedAt: new Date().toISOString(),
    };
    if (!Number.isFinite(next.currentBankroll) || next.currentBankroll <= 0) throw new Error('Current bankroll must be greater than $0.');
    if (!(next.unitPercent > 0 && next.unitPercent <= 5)) throw new Error('Unit size must be between 0 and 5% of bankroll.');
    if (!(next.dailyRiskCapPercent > 0 && next.dailyRiskCapPercent <= 25)) throw new Error('Daily risk cap must be between 0 and 25% of bankroll.');
    if (!(next.maxOpenExposurePercent > 0 && next.maxOpenExposurePercent <= 50)) throw new Error('Open exposure cap must be between 0 and 50% of bankroll.');
    if (!(next.maxStraightBetUnits > 0 && next.maxStraightBetUnits <= 5)) throw new Error('Max straight-bet units must be between 0 and 5u.');
    if (!(next.maxParlayBetUnits > 0 && next.maxParlayBetUnits <= 2)) throw new Error('Max parlay units must be between 0 and 2u.');
    state.settings = next;
    this.saveState(state);
    return this.getSummary();
  }

  getSummary(): BankrollSummary {
    const state = this.loadState();
    const s = state.settings;
    const unitDollarValue = s.configured ? round2(s.currentBankroll * (s.unitPercent / 100)) : null;
    const open = state.bets.filter((b) => b.status === 'OPEN');
    const openExposureDollars = round2(open.reduce((v, b) => v + b.stakeDollars, 0));
    const today = todayKey();
    const todayRiskDollars = round2(state.bets.filter((b) => b.placedAt.slice(0, 10) === today).reduce((v, b) => v + b.stakeDollars, 0));
    const settled = state.bets.filter((b) => b.status !== 'OPEN');
    const realizedProfitLossDollars = round2(settled.reduce((v, b) => v + (b.netProfitDollars ?? 0), 0));
    const dailyRiskCapDollars = s.configured ? round2(s.currentBankroll * s.dailyRiskCapPercent / 100) : null;
    const openExposureCapDollars = s.configured ? round2(s.currentBankroll * s.maxOpenExposurePercent / 100) : null;
    return {
      version: STATE_VERSION,
      settings: s,
      unitDollarValue,
      openExposureDollars,
      openExposureCapDollars,
      todayRiskDollars,
      dailyRiskCapDollars,
      realizedProfitLossDollars,
      openBetsCount: open.length,
      totalTrackedBets: state.bets.length,
      bets: [...state.bets].sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt)),
    };
  }

  previewStake(requestedUnitsRaw: number, betType: 'STRAIGHT' | 'PARLAY'): BankrollStakePreview {
    const summary = this.getSummary();
    const s = summary.settings;
    const requestedUnits = Math.max(0, Number(requestedUnitsRaw) || 0);
    if (!s.configured || !summary.unitDollarValue || summary.unitDollarValue <= 0) {
      return {
        configured: false,
        status: 'BANKROLL_NOT_CONFIGURED',
        requestedUnits,
        adjustedUnits: requestedUnits,
        unitDollarValue: null,
        suggestedStakeDollars: null,
        bankrollSnapshot: null,
        availableDailyRiskDollars: null,
        availableOpenExposureDollars: null,
        cappedBy: ['BANKROLL_NOT_CONFIGURED'],
      };
    }

    const unit = summary.unitDollarValue;
    const betCapUnits = betType === 'PARLAY' ? s.maxParlayBetUnits : s.maxStraightBetUnits;
    const dailyRemaining = Math.max(0, (summary.dailyRiskCapDollars ?? 0) - summary.todayRiskDollars);
    const openRemaining = Math.max(0, (summary.openExposureCapDollars ?? 0) - summary.openExposureDollars);
    const maxByRiskDollars = Math.min(dailyRemaining, openRemaining);
    const maxByRiskUnits = maxByRiskDollars / unit;
    const adjustedUnits = roundUnitsDown(Math.min(requestedUnits, betCapUnits, maxByRiskUnits));
    const suggestedStakeDollars = round2(adjustedUnits * unit);
    const cappedBy: string[] = [];
    if (requestedUnits > betCapUnits + 1e-9) cappedBy.push(betType === 'PARLAY' ? 'MAX_PARLAY_UNITS' : 'MAX_STRAIGHT_UNITS');
    if (requestedUnits * unit > dailyRemaining + 0.01) cappedBy.push('DAILY_RISK_CAP');
    if (requestedUnits * unit > openRemaining + 0.01) cappedBy.push('OPEN_EXPOSURE_CAP');
    const status: BankrollStakePreview['status'] = adjustedUnits <= 0 ? 'BLOCKED' : adjustedUnits + 1e-9 < requestedUnits ? 'REDUCED' : 'READY';
    return {
      configured: true,
      status,
      requestedUnits,
      adjustedUnits,
      unitDollarValue: unit,
      suggestedStakeDollars,
      bankrollSnapshot: s.currentBankroll,
      availableDailyRiskDollars: round2(dailyRemaining),
      availableOpenExposureDollars: round2(openRemaining),
      cappedBy,
    };
  }

  trackBet(input: {
    source: 'PARLAY' | 'STRAIGHT' | 'MANUAL';
    label: string;
    sportsbook: string;
    oddsAmerican: number;
    requestedUnits: number;
    eventIds?: string[];
    details?: string[];
  }): { bet: BankrollBetEntry; summary: BankrollSummary } {
    const state = this.loadState();
    if (!state.settings.configured) throw new Error('Configure your bankroll in My Bets before tracking wagers.');
    const preview = this.previewStake(input.requestedUnits, input.source === 'PARLAY' ? 'PARLAY' : 'STRAIGHT');
    if (preview.status === 'BLOCKED' || !preview.suggestedStakeDollars || preview.adjustedUnits <= 0) {
      throw new Error('Bankroll risk caps currently block this wager.');
    }
    const odds = Number(input.oddsAmerican);
    if (!Number.isFinite(odds) || odds === 0) throw new Error('Valid American odds are required.');
    const decimal = decimalFromAmerican(odds);
    const now = new Date().toISOString();
    const bet: BankrollBetEntry = {
      betId: `bet_${crypto.randomUUID()}`,
      source: input.source,
      label: String(input.label || 'Tracked wager'),
      sportsbook: String(input.sportsbook || 'Unknown'),
      oddsAmerican: odds,
      stakeUnits: preview.adjustedUnits,
      stakeDollars: preview.suggestedStakeDollars,
      unitDollarValueAtPlacement: preview.unitDollarValue || 0,
      bankrollAtPlacement: preview.bankrollSnapshot || state.settings.currentBankroll,
      potentialProfitDollars: round2(preview.suggestedStakeDollars * (decimal - 1)),
      status: 'OPEN',
      outcome: null,
      netProfitDollars: null,
      placedAt: now,
      settledAt: null,
      eventIds: Array.isArray(input.eventIds) ? input.eventIds.slice(0, 10) : [],
      details: Array.isArray(input.details) ? input.details.slice(0, 20) : [],
    };
    state.bets.push(bet);
    this.saveState(state);
    return { bet, summary: this.getSummary() };
  }

  settleBet(betId: string, outcome: BankrollBetOutcome): { bet: BankrollBetEntry; summary: BankrollSummary } {
    const state = this.loadState();
    const bet = state.bets.find((b) => b.betId === betId);
    if (!bet) throw new Error('Tracked bet was not found.');
    if (bet.status !== 'OPEN') throw new Error('This bet has already been settled.');
    if (!['WIN', 'LOSS', 'PUSH', 'VOID'].includes(outcome)) throw new Error('Outcome must be WIN, LOSS, PUSH, or VOID.');
    let net = 0;
    if (outcome === 'WIN') net = bet.potentialProfitDollars;
    else if (outcome === 'LOSS') net = -bet.stakeDollars;
    bet.status = 'SETTLED';
    bet.outcome = outcome;
    bet.netProfitDollars = round2(net);
    bet.settledAt = new Date().toISOString();
    state.settings.currentBankroll = round2(state.settings.currentBankroll + net);
    state.settings.updatedAt = new Date().toISOString();
    this.saveState(state);
    return { bet, summary: this.getSummary() };
  }

  resetLedger(): BankrollSummary {
    const state = this.loadState();
    state.bets = [];
    this.saveState(state);
    return this.getSummary();
  }
}

export const bankrollService = new BankrollService();
