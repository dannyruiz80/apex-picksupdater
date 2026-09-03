import fs from 'fs';
import path from 'path';
import { MarketQuotaState, MarketProviderStatus } from '../types';

const QUOTA_STORAGE_FILE = path.join(process.cwd(), '.quota_state.json');

const DAILY_HARD_LIMIT = 500;
const DAILY_WARNING_THRESHOLD = 400;
const DAILY_CRITICAL_THRESHOLD = 475;
const MONTHLY_HARD_LIMIT = 20000;

interface PersistedQuotaFile {
  budgetTimezone: 'America/Chicago';
  dailyDate: string; // YYYY-MM-DD
  dailyUsed: number;
  monthlyDate: string; // YYYY-MM
  monthlyUsed: number;
  providerReportedUsed: number | null;
  providerReportedRemaining: number | null;
  providerLastCost: number | null;
  lastReconciledAt: string | null;
  lastSuccessfulRequestAt: string | null;
  stateChecksum?: string;
}

class MarketQuotaGuardService {
  private dailyDate: string;
  private dailyUsed: number = 0;
  private monthlyDate: string;
  private monthlyUsed: number = 0;
  private providerReportedUsed: number | null = null;
  private providerReportedRemaining: number | null = null;
  private providerLastCost: number | null = null;
  private lastReconciledAt: string | null = null;
  private lastSuccessfulRequestAt: string | null = null;
  private lastError: { timestamp: string; message: string; statusCode?: number } | null = null;
  private isStateVerified: boolean = false;

  constructor() {
    const dates = this.getChicagoDates();
    this.dailyDate = dates.daily;
    this.monthlyDate = dates.monthly;
    this.loadState();
  }

  private getChicagoDates(): { daily: string; monthly: string } {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const daily = formatter.format(now); // YYYY-MM-DD
    const monthly = daily.substring(0, 7); // YYYY-MM
    return { daily, monthly };
  }

  private checkRollover(): void {
    const dates = this.getChicagoDates();
    let stateChanged = false;

    if (this.dailyDate !== dates.daily) {
      console.log(`[MarketQuotaGuard] Rolling over daily quota from ${this.dailyDate} to ${dates.daily}`);
      this.dailyDate = dates.daily;
      this.dailyUsed = 0;
      stateChanged = true;
    }

    if (this.monthlyDate !== dates.monthly) {
      console.log(`[MarketQuotaGuard] Rolling over monthly quota from ${this.monthlyDate} to ${dates.monthly}`);
      this.monthlyDate = dates.monthly;
      this.monthlyUsed = 0;
      stateChanged = true;
    }

    if (stateChanged) {
      this.persistState();
    }
  }

  private loadState(): void {
    try {
      this.checkRollover();
      if (fs.existsSync(QUOTA_STORAGE_FILE)) {
        const raw = fs.readFileSync(QUOTA_STORAGE_FILE, 'utf-8');
        const parsed: PersistedQuotaFile = JSON.parse(raw);

        const dates = this.getChicagoDates();

        // Restore daily count if same date
        if (parsed.dailyDate === dates.daily) {
          this.dailyDate = parsed.dailyDate;
          this.dailyUsed = typeof parsed.dailyUsed === 'number' ? parsed.dailyUsed : 0;
        } else {
          this.dailyDate = dates.daily;
          this.dailyUsed = 0;
        }

        // Restore monthly count if same month
        if (parsed.monthlyDate === dates.monthly) {
          this.monthlyDate = parsed.monthlyDate;
          this.monthlyUsed = typeof parsed.monthlyUsed === 'number' ? parsed.monthlyUsed : 0;
        } else {
          this.monthlyDate = dates.monthly;
          this.monthlyUsed = 0;
        }

        this.providerReportedUsed = parsed.providerReportedUsed ?? null;
        this.providerReportedRemaining = parsed.providerReportedRemaining ?? null;
        this.providerLastCost = parsed.providerLastCost ?? null;
        this.lastReconciledAt = parsed.lastReconciledAt ?? null;
        this.lastSuccessfulRequestAt = parsed.lastSuccessfulRequestAt ?? null;
        this.isStateVerified = true;
      } else {
        // Initial setup - fresh verified file
        const dates = this.getChicagoDates();
        this.dailyDate = dates.daily;
        this.dailyUsed = 0;
        this.monthlyDate = dates.monthly;
        this.monthlyUsed = 0;
        this.isStateVerified = true;
        this.persistState();
      }
    } catch (err: any) {
      console.error('[MarketQuotaGuard] Failed to load quota persistence state:', err.message);
      this.isStateVerified = false;
      this.lastError = {
        timestamp: new Date().toISOString(),
        message: `Failed to verify quota persistence: ${err.message}`,
      };
    }
  }

  private persistState(): void {
    try {
      const data: PersistedQuotaFile = {
        budgetTimezone: 'America/Chicago',
        dailyDate: this.dailyDate,
        dailyUsed: this.dailyUsed,
        monthlyDate: this.monthlyDate,
        monthlyUsed: this.monthlyUsed,
        providerReportedUsed: this.providerReportedUsed,
        providerReportedRemaining: this.providerReportedRemaining,
        providerLastCost: this.providerLastCost,
        lastReconciledAt: this.lastReconciledAt,
        lastSuccessfulRequestAt: this.lastSuccessfulRequestAt,
      };
      fs.writeFileSync(QUOTA_STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
      this.isStateVerified = true;
    } catch (err: any) {
      console.error('[MarketQuotaGuard] Failed to persist quota state to disk:', err.message);
      this.isStateVerified = false;
    }
  }

  public isConfigured(): boolean {
    const key = process.env.ODDS_API_KEY;
    return typeof key === 'string' && key.trim().length > 0 && key.trim() !== 'MY_ODDS_API_KEY';
  }

  public canConsumeKeyedRequest(cost: number = 1): { allowed: boolean; reason?: string } {
    if (!this.isConfigured()) {
      return { allowed: false, reason: 'MARKET PROVIDER NOT CONFIGURED' };
    }

    this.checkRollover();

    // Fail closed if state could not be verified
    if (!this.isStateVerified) {
      return {
        allowed: false,
        reason: 'KEYED PROVIDER DISABLED — QUOTA STATE UNVERIFIED',
      };
    }

    // Monthly Hard Stop check (20,000 / month)
    if (this.monthlyUsed + cost > MONTHLY_HARD_LIMIT) {
      return {
        allowed: false,
        reason: `MONTHLY HARD STOP REACHED (${this.monthlyUsed}/${MONTHLY_HARD_LIMIT} requests used for ${this.monthlyDate})`,
      };
    }

    // Daily Hard Stop check (500 / day)
    if (this.dailyUsed + cost > DAILY_HARD_LIMIT) {
      return {
        allowed: false,
        reason: `DAILY HARD STOP REACHED (${this.dailyUsed}/${DAILY_HARD_LIMIT} requests used for ${this.dailyDate})`,
      };
    }

    return { allowed: true };
  }

  public recordKeyedRequest(
    cost: number = 1,
    headers?: {
      'x-requests-used'?: string | number;
      'x-requests-remaining'?: string | number;
      'x-requests-last'?: string | number;
    }
  ): void {
    this.checkRollover();
    this.dailyUsed += cost;
    this.monthlyUsed += cost;
    this.lastSuccessfulRequestAt = new Date().toISOString();

    // Reconcile with provider-reported quota headers if available
    if (headers) {
      const pUsed = headers['x-requests-used'] ? Number(headers['x-requests-used']) : null;
      const pRemaining = headers['x-requests-remaining'] ? Number(headers['x-requests-remaining']) : null;
      const pCost = headers['x-requests-last'] ? Number(headers['x-requests-last']) : cost;

      if (pUsed !== null && !isNaN(pUsed)) {
        this.providerReportedUsed = pUsed;
        // Conservative reconciliation: use the higher value if provider reports more used
        if (pUsed > this.monthlyUsed) {
          console.warn(
            `[MarketQuotaGuard] Provider reports ${pUsed} used vs local ${this.monthlyUsed}. Adjusting local to conservative value.`
          );
          this.monthlyUsed = pUsed;
        }
      }

      if (pRemaining !== null && !isNaN(pRemaining)) {
        this.providerReportedRemaining = pRemaining;
      }

      if (pCost !== null && !isNaN(pCost)) {
        this.providerLastCost = pCost;
      }

      this.lastReconciledAt = new Date().toISOString();
    }

    this.persistState();
  }

  public recordError(message: string, statusCode?: number): void {
    this.lastError = {
      timestamp: new Date().toISOString(),
      message,
      statusCode,
    };
  }

  public getQuotaState(): MarketQuotaState {
    this.checkRollover();
    const configured = this.isConfigured();

    let status: MarketProviderStatus = 'OPERATIONAL';
    let statusMessage = 'Market provider operational with active cost protection';

    if (!configured) {
      status = 'NOT_CONFIGURED';
      statusMessage = 'MARKET PROVIDER NOT CONFIGURED';
    } else if (!this.isStateVerified) {
      status = 'UNVERIFIED_STATE';
      statusMessage = 'KEYED PROVIDER DISABLED — QUOTA STATE UNVERIFIED';
    } else if (this.monthlyUsed >= MONTHLY_HARD_LIMIT) {
      status = 'HARD_STOP_MONTHLY';
      statusMessage = `MONTHLY HARD STOP (${this.monthlyUsed}/${MONTHLY_HARD_LIMIT})`;
    } else if (this.dailyUsed >= DAILY_HARD_LIMIT) {
      status = 'HARD_STOP_DAILY';
      statusMessage = `DAILY HARD STOP (${this.dailyUsed}/${DAILY_HARD_LIMIT})`;
    } else if (this.dailyUsed >= DAILY_CRITICAL_THRESHOLD) {
      status = 'CRITICAL';
      statusMessage = `DAILY CRITICAL QUOTA (${this.dailyUsed}/${DAILY_HARD_LIMIT})`;
    } else if (this.dailyUsed >= DAILY_WARNING_THRESHOLD) {
      status = 'WARNING';
      statusMessage = `DAILY QUOTA WARNING (${this.dailyUsed}/${DAILY_HARD_LIMIT})`;
    }

    return {
      providerConfigured: configured,
      providerName: 'The-Odds-API',
      status,
      statusMessage,
      budgetTimezone: 'America/Chicago',
      dailyDate: this.dailyDate,
      dailyUsed: this.dailyUsed,
      dailyHardLimit: DAILY_HARD_LIMIT,
      dailyRemaining: Math.max(0, DAILY_HARD_LIMIT - this.dailyUsed),
      dailyWarningThreshold: DAILY_WARNING_THRESHOLD,
      dailyCriticalThreshold: DAILY_CRITICAL_THRESHOLD,
      monthlyDate: this.monthlyDate,
      monthlyUsed: this.monthlyUsed,
      monthlyHardLimit: MONTHLY_HARD_LIMIT,
      monthlyRemaining: Math.max(0, MONTHLY_HARD_LIMIT - this.monthlyUsed),
      providerReportedUsed: this.providerReportedUsed,
      providerReportedRemaining: this.providerReportedRemaining,
      providerLastCost: this.providerLastCost,
      lastReconciledAt: this.lastReconciledAt,
      lastSuccessfulRequestAt: this.lastSuccessfulRequestAt,
      lastError: this.lastError,
    };
  }
}

export const marketQuotaGuard = new MarketQuotaGuardService();
