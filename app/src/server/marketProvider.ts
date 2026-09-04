import http from 'http';
import https from 'https';
import {
  ApexSport,
  NormalizedApexGame,
  NormalizedApexEventMarkets,
  NormalizedBookmakerMarkets,
  NormalizedMarketItem,
  NormalizedMarketOutcome,
  MarketType,
  EventMarketsResponse,
  MarketProviderAuditDiagnostic,
} from '../types';
import { marketQuotaGuard } from './marketQuotaGuard';
import { marketCache } from './marketCache';
import { marketMatcher, ProviderRawEvent } from './marketMatcher';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

interface ProviderSportDiscovery {
  key: string;
  group: string;
  title: string;
  description: string;
  active: boolean;
  has_outrights: boolean;
}

export class MarketProviderService {
  private activeDiscoveryKeys: ProviderSportDiscovery[] = [];
  private lastDiscoveredAt: string | null = null;

  /**
   * Helper to perform HTTP GET requests to The-Odds-API with error handling and header capturing.
   */
  private makeHttpRequest(
    url: string
  ): Promise<{ data: any; headers: http.IncomingHttpHeaders; statusCode: number }> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(
        url,
        {
          headers: {
            'User-Agent': 'ApexPicks-SportsIntelligence/1.0',
            Accept: 'application/json',
          },
          timeout: 10000,
        },
        (res) => {
          let rawData = '';
          res.on('data', (chunk) => (rawData += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(rawData);
              resolve({
                data: parsed,
                headers: res.headers,
                statusCode: res.statusCode || 200,
              });
            } catch (err: any) {
              reject(new Error(`Failed to parse response: ${err.message} (HTTP ${res.statusCode})`));
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Market provider request timed out (10s limit)'));
      });
    });
  }

  /**
   * Discovers active sports supported by The-Odds-API.
   * Cached for 2 hours to avoid consuming quota.
   */
  public async discoverActiveSports(): Promise<ProviderSportDiscovery[]> {
    if (!marketQuotaGuard.isConfigured()) {
      return [];
    }

    const cacheKey = 'MARKET_PROVIDER::DISCOVERY::ACTIVE_SPORTS';
    const cached = marketCache.get<ProviderSportDiscovery[]>(cacheKey);
    if (cached.hit && cached.data) {
      this.activeDiscoveryKeys = cached.data;
      return cached.data;
    }

    const guardCheck = marketQuotaGuard.canConsumeKeyedRequest(1);
    if (!guardCheck.allowed) {
      console.warn(`[MarketProvider] Discovery blocked by quota guard: ${guardCheck.reason}`);
      return this.activeDiscoveryKeys;
    }

    const apiKey = process.env.ODDS_API_KEY!;
    const url = `${ODDS_API_BASE}/sports/?apiKey=${encodeURIComponent(apiKey)}`;

    try {
      const res = await this.makeHttpRequest(url);
      if (res.statusCode >= 400) {
        throw new Error(`Provider returned HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`);
      }

      marketQuotaGuard.recordKeyedRequest(1, {
        'x-requests-used': res.headers['x-requests-used'] as string,
        'x-requests-remaining': res.headers['x-requests-remaining'] as string,
        'x-requests-last': res.headers['x-requests-last'] as string,
      });

      const sports = Array.isArray(res.data) ? res.data : [];
      this.activeDiscoveryKeys = sports;
      this.lastDiscoveredAt = new Date().toISOString();
      marketCache.set(cacheKey, sports, 7200); // 2-hour TTL

      return sports;
    } catch (err: any) {
      marketQuotaGuard.recordError(err.message, 500);
      console.error('[MarketProvider] Discovery failed:', err.message);
      return this.activeDiscoveryKeys;
    }
  }

  /**
   * Resolves the appropriate provider sport keys for a given Apex game/sport.
   */
  public async resolveProviderSportKeys(
    sport: ApexSport,
    game?: NormalizedApexGame
  ): Promise<string[]> {
    switch (sport) {
      case 'MLB':
        return ['baseball_mlb'];
      case 'NFL':
        return ['americanfootball_nfl'];
      case 'NBA':
        return ['basketball_nba'];
      case 'WNBA':
        return ['basketball_wnba'];
      case 'NHL':
        return ['icehockey_nhl'];
      case 'SOCCER': {
        if (!game) {
          return ['soccer_epl', 'soccer_usa_mls', 'soccer_uefa_champs_league'];
        }
        const leagueLower = (game.league || '').toLowerCase();
        if (leagueLower.includes('premier') || leagueLower.includes('epl')) return ['soccer_epl'];
        if (leagueLower.includes('major league') || leagueLower.includes('mls')) return ['soccer_usa_mls'];
        if (leagueLower.includes('champions league') || leagueLower.includes('ucl')) return ['soccer_uefa_champs_league'];
        if (leagueLower.includes('europa')) return ['soccer_uefa_europa_league'];
        if (leagueLower.includes('la liga') || leagueLower.includes('spain')) return ['soccer_spain_la_liga'];
        if (leagueLower.includes('bundesliga') || leagueLower.includes('germany')) return ['soccer_germany_bundesliga'];
        if (leagueLower.includes('serie a') || leagueLower.includes('italy')) return ['soccer_italy_serie_a'];
        if (leagueLower.includes('ligue 1') || leagueLower.includes('france')) return ['soccer_france_ligue_one'];
        if (leagueLower.includes('liga mx') || leagueLower.includes('mexico') || leagueLower.includes('mexican')) return ['soccer_mexico_ligamx'];
        return ['soccer_epl', 'soccer_usa_mls', 'soccer_uefa_champs_league'];
      }
      case 'TENNIS': {
        const discovered = await this.discoverActiveSports();
        const tournamentLower = (game?.tournamentName || game?.league || '').toLowerCase();

        const matchingKeys: string[] = [];
        const isAtp = tournamentLower.includes('atp') || game?.tour === 'ATP';
        const isWta = tournamentLower.includes('wta') || game?.tour === 'WTA';

        for (const item of discovered) {
          const k = item.key.toLowerCase();
          if (k.startsWith('tennis_atp_') && (isAtp || !isWta)) {
            if (!game || this.isTennisTournamentMatch(tournamentLower, item.title, item.description)) {
              matchingKeys.push(item.key);
            }
          } else if (k.startsWith('tennis_wta_') && (isWta || !isAtp)) {
            if (!game || this.isTennisTournamentMatch(tournamentLower, item.title, item.description)) {
              matchingKeys.push(item.key);
            }
          }
        }

        // Fallback to active tennis keys if none specifically matched tournament name
        if (matchingKeys.length === 0) {
          const fallback = discovered
            .filter((d) => d.key.startsWith('tennis_atp_') || d.key.startsWith('tennis_wta_'))
            .map((d) => d.key);
          return fallback.slice(0, 2); // Limit to top 2 to protect cost
        }

        return matchingKeys.slice(0, 3);
      }
      default:
        return [];
    }
  }

  private isTennisTournamentMatch(
    apexTournamentName: string,
    providerTitle: string,
    providerDesc: string
  ): boolean {
    const t1 = apexTournamentName.toLowerCase();
    const t2 = (providerTitle + ' ' + providerDesc).toLowerCase();

    if (t1.includes('us open') && t2.includes('us open')) return true;
    if (t1.includes('wimbledon') && t2.includes('wimbledon')) return true;
    if (t1.includes('french') || t1.includes('roland')) return t2.includes('french') || t2.includes('roland');
    if (t1.includes('australian') && t2.includes('australian')) return true;
    if (t1.includes('cincinnati') && t2.includes('cincinnati')) return true;

    return false;
  }

  /**
   * Fetches raw odds for a specific provider sport key.
   * Utilizes the server-side cache and deduplication layer.
   */
  public async fetchRawOddsForSportKey(
    sportKey: string,
    date?: string
  ): Promise<{ events: ProviderRawEvent[]; cacheStatus: 'HIT' | 'MISS' | 'DEDUPED' }> {
    const cacheKey = marketCache.generateKey({
      sport: sportKey,
      date,
    });

    return marketCache.getOrFetch<ProviderRawEvent[]>(
      cacheKey,
      async () => {
        const guardCheck = marketQuotaGuard.canConsumeKeyedRequest(1);
        if (!guardCheck.allowed) {
          throw new Error(guardCheck.reason || 'Quota check failed');
        }

        const apiKey = process.env.ODDS_API_KEY!;
        const url = `${ODDS_API_BASE}/sports/${encodeURIComponent(
          sportKey
        )}/odds/?apiKey=${encodeURIComponent(
          apiKey
        )}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;

        const res = await this.makeHttpRequest(url);
        if (res.statusCode >= 400) {
          throw new Error(`The-Odds-API returned HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`);
        }

        // Record request & reconcile headers
        marketQuotaGuard.recordKeyedRequest(1, {
          'x-requests-used': res.headers['x-requests-used'] as string,
          'x-requests-remaining': res.headers['x-requests-remaining'] as string,
          'x-requests-last': res.headers['x-requests-last'] as string,
        });

        const rawEvents: ProviderRawEvent[] = Array.isArray(res.data) ? res.data : [];
        return rawEvents;
      },
      300 // 5-minute cache TTL
    ).then((res) => ({
      events: res.data,
      cacheStatus: res.status,
    }));
  }

  /**
   * Converts decimal odds to American odds format if needed.
   */
  public toAmericanOdds(price: number): number {
    if (price >= 100 || price <= -100) {
      return Math.round(price);
    }
    // If decimal format (e.g. 1.91)
    if (price >= 2.0) {
      return Math.round((price - 1) * 100);
    } else if (price > 1.0) {
      return Math.round(-100 / (price - 1));
    }
    return Math.round(price);
  }

  /**
   * Converts American odds to decimal odds format.
   */
  public toDecimalOdds(american: number): number {
    if (american > 0) {
      return Number(((american / 100) + 1).toFixed(3));
    } else if (american < 0) {
      return Number(((100 / Math.abs(american)) + 1).toFixed(3));
    }
    return 1.0;
  }

  /**
   * Normalizes raw bookmaker markets into Apex structure.
   */
  private normalizeBookmakers(
    rawBookmakers: any[],
    sport: ApexSport
  ): NormalizedBookmakerMarkets[] {
    if (!Array.isArray(rawBookmakers)) return [];

    const normalizedList: NormalizedBookmakerMarkets[] = [];

    for (const b of rawBookmakers) {
      const marketsList: NormalizedMarketItem[] = [];

      for (const m of b.markets || []) {
        let marketType: MarketType | null = null;
        if (m.key === 'h2h') marketType = 'MONEYLINE';
        else if (m.key === 'spreads') marketType = 'SPREAD';
        else if (m.key === 'totals') marketType = 'TOTAL';

        if (!marketType) continue;

        const outcomes: NormalizedMarketOutcome[] = (m.outcomes || []).map((o: any) => {
          const rawPrice = Number(o.price);
          const american = this.toAmericanOdds(rawPrice);
          const decimal = this.toDecimalOdds(american);

          return {
            name: String(o.name || ''),
            price: rawPrice,
            americanOdds: american,
            decimalOdds: decimal,
            point: o.point !== undefined && o.point !== null ? Number(o.point) : null,
          };
        });

        marketsList.push({
          key: m.key,
          marketType,
          lastUpdate: m.last_update || new Date().toISOString(),
          outcomes,
        });
      }

      if (marketsList.length > 0) {
        normalizedList.push({
          key: b.key || 'sportsbook',
          title: b.title || b.key || 'Sportsbook',
          lastUpdate: b.last_update || new Date().toISOString(),
          markets: marketsList,
        });
      }
    }

    return normalizedList;
  }

  /**
   * Fetches and attaches normalized markets for a single verified UPCOMING Apex game.
   */
  public async getMarketsForEvent(
    apexGame: NormalizedApexGame
  ): Promise<EventMarketsResponse> {
    const quotaState = marketQuotaGuard.getQuotaState();

    // 1. Provider configuration check
    if (!quotaState.providerConfigured) {
      return {
        apexEventId: apexGame.eventId,
        status: 'NOT_CONFIGURED',
        message: 'MARKET PROVIDER NOT CONFIGURED',
        markets: null,
        quotaState,
      };
    }

    // 2. Strict Game Eligibility Check (UPCOMING only)
    if (apexGame.status !== 'UPCOMING') {
      return {
        apexEventId: apexGame.eventId,
        status: 'NOT_ELIGIBLE',
        message: `Market retrieval eligible only for verified UPCOMING events (current status: ${apexGame.status})`,
        markets: null,
        quotaState,
      };
    }

    // 3. Resolve relevant provider sport keys (e.g. baseball_mlb, tennis_atp_us_open)
    const sportKeys = await this.resolveProviderSportKeys(apexGame.sport, apexGame);
    if (sportKeys.length === 0) {
      return {
        apexEventId: apexGame.eventId,
        status: 'NO_MARKETS',
        message: `No active provider sport key discovered for ${apexGame.sport} (${apexGame.league})`,
        markets: null,
        quotaState: marketQuotaGuard.getQuotaState(),
      };
    }

    // 4. Retrieve provider events for candidate sport keys
    let matchedProviderEvent: ProviderRawEvent | null = null;
    let effectiveCacheStatus: 'HIT' | 'MISS' | 'DEDUPED' = 'MISS';

    for (const key of sportKeys) {
      try {
        const { events, cacheStatus } = await this.fetchRawOddsForSportKey(
          key,
          apexGame.scheduleDate || apexGame.startTime?.substring(0, 10)
        );
        effectiveCacheStatus = cacheStatus;

        const matchResult = marketMatcher.findBestMatch(apexGame, events);
        if (matchResult.matched && matchResult.providerEvent) {
          matchedProviderEvent = matchResult.providerEvent;
          break;
        }
      } catch (err: any) {
        console.warn(`[MarketProvider] Query failed for ${key}:`, err.message);
        if (err.message.includes('HARD STOP') || err.message.includes('UNVERIFIED')) {
          return {
            apexEventId: apexGame.eventId,
            status: 'QUOTA_EXCEEDED',
            message: err.message,
            markets: null,
            quotaState: marketQuotaGuard.getQuotaState(),
          };
        }
      }
    }

    if (!matchedProviderEvent) {
      return {
        apexEventId: apexGame.eventId,
        status: 'NO_MARKETS',
        message: 'No matching provider event found with verified participant identity',
        markets: null,
        quotaState: marketQuotaGuard.getQuotaState(),
      };
    }

    // 5. Normalize markets
    const bookmakers = this.normalizeBookmakers(
      matchedProviderEvent.bookmakers || [],
      apexGame.sport
    );

    const normalized: NormalizedApexEventMarkets = {
      apexEventId: apexGame.eventId,
      providerEventId: matchedProviderEvent.id,
      sport: apexGame.sport,
      league: apexGame.league || apexGame.tournamentName || matchedProviderEvent.sport_title,
      homeTeamOrPlayerA: apexGame.playerAName || apexGame.homeTeam,
      awayTeamOrPlayerB: apexGame.playerBName || apexGame.awayTeam,
      scheduledDate: apexGame.startTime || apexGame.scheduleDate,
      bookmakers,
      retrievedAt: new Date().toISOString(),
      cacheStatus: effectiveCacheStatus,
      source: 'The-Odds-API',
    };

    return {
      apexEventId: apexGame.eventId,
      status: 'SUCCESS',
      markets: normalized,
      quotaState: marketQuotaGuard.getQuotaState(),
    };
  }

  public getAuditDiagnostics(): MarketProviderAuditDiagnostic {
    return {
      quota: marketQuotaGuard.getQuotaState(),
      cache: marketCache.getStats(),
      matching: marketMatcher.getStats(),
      discovery: {
        lastDiscoveredAt: this.lastDiscoveredAt,
        activeSportKeysCount: this.activeDiscoveryKeys.length,
        activeTennisTournaments: this.activeDiscoveryKeys
          .filter((d) => d.key.startsWith('tennis_'))
          .map((d) => d.title),
        activeSoccerCompetitions: this.activeDiscoveryKeys
          .filter((d) => d.key.startsWith('soccer_'))
          .map((d) => d.title),
      },
    };
  }
}

export const marketProvider = new MarketProviderService();
