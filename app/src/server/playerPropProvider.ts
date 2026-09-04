import http from 'http';
import https from 'https';
import {
  ApexSport,
  NormalizedApexGame,
  NormalizedPlayerPropQuote,
  EventPlayerPropsResponse,
  PropPipelineAuditDiagnostic,
  PropRejectionRecord,
  PropNegativeTestResponse,
} from '../types';
import { marketQuotaGuard } from './marketQuotaGuard';
import { marketCache } from './marketCache';
import { marketMatcher, ProviderRawEvent } from './marketMatcher';
import { marketProvider } from './marketProvider';
import { playerRosterService } from './playerRosterService';
import { playerStatsService } from './playerStatsService';
import { probabilityModelService } from './probabilityModelService';
import { mlbPitcherKContextService } from './mlbPitcherKContextService';
import { valueEngineService } from './valueEngineService';
import { backtestEngineService } from './backtestEngineService';
import { footballProviderEventDateMatches, requiresStrictFootballDateIdentity } from './scheduleDateIdentity.js';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Supported player prop keys mapped to human-readable categories
export const SUPPORTED_PROP_MARKETS: Record<string, { category: string; sport: ApexSport }> = {
  // MLB
  pitcher_strikeouts: { category: 'Strikeouts', sport: 'MLB' },
  batter_home_runs: { category: 'Home Runs', sport: 'MLB' },
  batter_hits: { category: 'Hits', sport: 'MLB' },
  batter_total_bases: { category: 'Total Bases', sport: 'MLB' },
  batter_rbis: { category: 'RBIs', sport: 'MLB' },
  batter_runs_scored: { category: 'Runs Scored', sport: 'MLB' },
  pitcher_outs: { category: 'Pitcher Outs', sport: 'MLB' },
  pitcher_hits_allowed: { category: 'Hits Allowed', sport: 'MLB' },
  pitcher_walks: { category: 'Pitcher Walks', sport: 'MLB' },

  // NFL
  player_pass_yds: { category: 'Passing Yards', sport: 'NFL' },
  player_pass_tds: { category: 'Passing Touchdowns', sport: 'NFL' },
  player_pass_completions: { category: 'Pass Completions', sport: 'NFL' },
  player_pass_interceptions: { category: 'Interceptions', sport: 'NFL' },
  player_rush_yds: { category: 'Rushing Yards', sport: 'NFL' },
  player_receptions: { category: 'Receptions', sport: 'NFL' },
  player_reception_yds: { category: 'Receiving Yards', sport: 'NFL' },
  player_anytime_td: { category: 'Anytime Touchdown', sport: 'NFL' },

  // NBA / WNBA
  player_points: { category: 'Points', sport: 'NBA' },
  player_rebounds: { category: 'Rebounds', sport: 'NBA' },
  player_assists: { category: 'Assists', sport: 'NBA' },
  player_threes: { category: '3-Pointers Made', sport: 'NBA' },
  player_blocks: { category: 'Blocks', sport: 'NBA' },
  player_steals: { category: 'Steals', sport: 'NBA' },
  player_points_rebounds_assists: { category: 'PRA', sport: 'NBA' },

  // NHL
  player_points_nhl: { category: 'Points', sport: 'NHL' },
  player_goals: { category: 'Goals', sport: 'NHL' },
  player_assists_nhl: { category: 'Assists', sport: 'NHL' },
  player_shots_on_goal: { category: 'Shots on Goal', sport: 'NHL' },
  player_total_saves: { category: 'Saves', sport: 'NHL' },

  // Soccer
  player_goal_scorer_anytime: { category: 'Anytime Goalscorer', sport: 'SOCCER' },
  player_shots_on_target: { category: 'Shots on Target', sport: 'SOCCER' },
};

class PlayerPropProviderService {
  private inFlightRequests: Map<string, Promise<any>> = new Map();
  private auditState: PropPipelineAuditDiagnostic = {
    providerPropRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    quotesReceived: 0,
    acceptedQuotes: 0,
    rejectedQuotes: 0,
    playersRosterResolved: 0,
    unresolvedPlayers: 0,
    ambiguousPlayers: 0,
    wrongTeamRejections: 0,
    unsupportedMarketKeysCount: 0,
    supportedMarketKeysDiscovered: Object.keys(SUPPORTED_PROP_MARKETS),
    bySport: {
      MLB: { propRequests: 0, quotesReceived: 0, acceptedQuotes: 0, rejectedQuotes: 0, playersResolved: 0 },
      NFL: { propRequests: 0, quotesReceived: 0, acceptedQuotes: 0, rejectedQuotes: 0, playersResolved: 0 },
      NCAAF: { propRequests: 0, quotesReceived: 0, acceptedQuotes: 0, rejectedQuotes: 0, playersResolved: 0 },
      NBA: { propRequests: 0, quotesReceived: 0, acceptedQuotes: 0, rejectedQuotes: 0, playersResolved: 0 },
      WNBA: { propRequests: 0, quotesReceived: 0, acceptedQuotes: 0, rejectedQuotes: 0, playersResolved: 0 },
      NHL: { propRequests: 0, quotesReceived: 0, acceptedQuotes: 0, rejectedQuotes: 0, playersResolved: 0 },
      SOCCER: { propRequests: 0, quotesReceived: 0, acceptedQuotes: 0, rejectedQuotes: 0, playersResolved: 0 },
      TENNIS: { propRequests: 0, quotesReceived: 0, acceptedQuotes: 0, rejectedQuotes: 0, playersResolved: 0 },
    },
    recentRejections: [],
  };

  /**
   * Helper to perform HTTP GET request with header extraction.
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
            'User-Agent': 'ApexPicks-PropIntelligence/1.0',
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
              reject(new Error(`Failed to parse prop response: ${err.message} (HTTP ${res.statusCode})`));
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Market prop request timed out (10s limit)'));
      });
    });
  }

  /**
   * Returns selected default prop markets to request for a sport.
   */
  public getPropMarketKeysForSport(sport: ApexSport): string[] {
    switch (sport) {
      case 'MLB':
        return [
          'pitcher_strikeouts',
          'batter_home_runs',
          'batter_hits',
          'batter_total_bases',
          'batter_rbis',
        ];
      case 'NFL':
        return [
          'player_pass_yds',
          'player_pass_tds',
          'player_rush_yds',
          'player_receptions',
          'player_anytime_td',
        ];
      case 'NCAAF':
        // v1.14.9 intentionally enables NCAAF game markets only. Player props remain fail-closed
        // until roster/stat provenance is independently verified for college football.
        return [];
      case 'NBA':
      case 'WNBA':
        return [
          'player_points',
          'player_rebounds',
          'player_assists',
          'player_threes',
          'player_points_rebounds_assists',
        ];
      case 'NHL':
        return ['player_points', 'player_goals', 'player_assists', 'player_shots_on_goal'];
      case 'SOCCER':
        return ['player_goal_scorer_anytime'];
      default:
        return [];
    }
  }

  /**
   * Helper to convert American odds to Decimal odds.
   */
  private americanToDecimal(american: number): number {
    if (american > 0) {
      return Number(((american / 100) + 1).toFixed(3));
    } else if (american < 0) {
      return Number(((100 / Math.abs(american)) + 1).toFixed(3));
    }
    return 1.0;
  }

  /**
   * Helper to convert Decimal odds to American odds.
   */
  private decimalToAmerican(decimal: number): number {
    if (decimal >= 2.0) {
      return Math.round((decimal - 1) * 100);
    } else if (decimal > 1.0) {
      return Math.round(-100 / (decimal - 1));
    }
    return 100;
  }

  /**
   * Records a rejection in the diagnostic telemetry.
   */
  private recordRejection(record: PropRejectionRecord) {
    this.auditState.rejectedQuotes++;
    this.auditState.bySport[record.sport].rejectedQuotes++;

    if (record.reason === 'WRONG_TEAM') {
      this.auditState.wrongTeamRejections++;
    } else if (record.reason === 'UNKNOWN_PLAYER') {
      this.auditState.unresolvedPlayers++;
    } else if (record.reason === 'AMBIGUOUS_NAME') {
      this.auditState.ambiguousPlayers++;
    } else if (record.reason === 'UNSUPPORTED_MARKET') {
      this.auditState.unsupportedMarketKeysCount++;
    }

    this.auditState.recentRejections.unshift(record);
    if (this.auditState.recentRejections.length > 20) {
      this.auditState.recentRejections.pop();
    }
  }

  /**
   * Retrieves, verifies, and normalizes player props for a verified UPCOMING Apex game.
   */
  public async getPlayerPropsForGame(
    apexGame: NormalizedApexGame,
    customMarketKeys?: string[]
  ): Promise<EventPlayerPropsResponse> {
    const quotaState = marketQuotaGuard.getQuotaState();

    // 1. Eligibility Check: Strict UPCOMING constraint
    if (apexGame.status !== 'UPCOMING') {
      return {
        apexEventId: apexGame.eventId,
        status: 'NOT_ELIGIBLE',
        message: `Props are exclusively retrieved for UPCOMING games (current status: ${apexGame.status})`,
        propsCount: 0,
        props: [],
        rejectionsCount: 0,
        quotaState,
      };
    }

    // 2. Configuration Check
    if (!marketQuotaGuard.isConfigured()) {
      return {
        apexEventId: apexGame.eventId,
        status: 'NOT_CONFIGURED',
        message: 'ODDS_API_KEY is not configured or invalid',
        propsCount: 0,
        props: [],
        rejectionsCount: 0,
        quotaState,
      };
    }

    const sport = apexGame.sport;
    const normalizedCacheKey = `NORMALIZED_PROPS::${sport}::${apexGame.eventId}`;

    // 3. Check Normalized Cache (5-min TTL)
    const cachedNormalized = marketCache.get<NormalizedPlayerPropQuote[]>(normalizedCacheKey);
    if (cachedNormalized.hit && cachedNormalized.data) {
      this.auditState.cacheHits++;
      return {
        apexEventId: apexGame.eventId,
        status: 'SUCCESS',
        eventTitle: `${apexGame.awayTeam || apexGame.playerBName} @ ${apexGame.homeTeam || apexGame.playerAName}`,
        sport: apexGame.sport,
        league: apexGame.league,
        scheduledDate: apexGame.startTime || apexGame.scheduleDate,
        propsCount: cachedNormalized.data.length,
        props: cachedNormalized.data.map((p) => ({ ...p, cacheStatus: 'HIT' })),
        rejectionsCount: 0,
        quotaState: marketQuotaGuard.getQuotaState(),
      };
    }

    // 4. Resolve Provider Sport Keys & Match Event
    const sportKeys = await marketProvider.resolveProviderSportKeys(sport, apexGame);
    if (sportKeys.length === 0) {
      return {
        apexEventId: apexGame.eventId,
        status: 'NO_PROPS',
        message: `No market provider key available for sport ${sport}`,
        propsCount: 0,
        props: [],
        rejectionsCount: 0,
        quotaState: marketQuotaGuard.getQuotaState(),
      };
    }

    // Match with raw event from the sport slate
    const sportKey = sportKeys[0];
    const rawOddsSlate = await marketProvider.fetchRawOddsForSportKey(sportKey);
    const matchResult = marketMatcher.findBestMatch(apexGame, rawOddsSlate.events);

    if (!matchResult.matched || !matchResult.providerEvent) {
      return {
        apexEventId: apexGame.eventId,
        status: 'NO_PROPS',
        message: `Could not match game with provider event: ${matchResult.reason || 'No match found'}`,
        propsCount: 0,
        props: [],
        rejectionsCount: 0,
        quotaState: marketQuotaGuard.getQuotaState(),
      };
    }

    const providerEvent = matchResult.providerEvent;
    if (requiresStrictFootballDateIdentity(sport)) {
      const dateMatches = footballProviderEventDateMatches(
        sport, apexGame.startTime, providerEvent.commence_time, apexGame.scheduleDate,
      );
      const providerStartMs = Date.parse(providerEvent.commence_time);
      if (!dateMatches || !Number.isFinite(providerStartMs) || providerStartMs <= Date.now()) {
        return {
          apexEventId: apexGame.eventId,
          status: 'NO_PROPS',
          message: !dateMatches
            ? 'Provider prop event failed strict football slate-date identity verification.'
            : 'Provider prop event is no longer a verified future pregame event.',
          propsCount: 0,
          props: [],
          rejectionsCount: 0,
          quotaState: marketQuotaGuard.getQuotaState(),
        };
      }
    }

    const providerEventId = providerEvent.id;
    const marketsToQuery = customMarketKeys || this.getPropMarketKeysForSport(sport);

    if (marketsToQuery.length === 0) {
      return {
        apexEventId: apexGame.eventId,
        status: 'NO_PROPS',
        message: `No supported player prop markets configured for sport ${sport}`,
        propsCount: 0,
        props: [],
        rejectionsCount: 0,
        quotaState: marketQuotaGuard.getQuotaState(),
      };
    }

    const rawPropsCacheKey = `RAW_PROPS::${sportKey}::${providerEventId}::${marketsToQuery.join(',')}`;

    // 5. Check Raw Props Cache (15-min TTL) or In-Flight Deduplication
    let rawPropsData: any = null;
    let rawCacheStatus: 'HIT' | 'MISS' = 'MISS';

    const cachedRaw = marketCache.get<any>(rawPropsCacheKey);
    if (cachedRaw.hit && cachedRaw.data) {
      rawPropsData = cachedRaw.data;
      rawCacheStatus = 'HIT';
      this.auditState.cacheHits++;
    } else {
      this.auditState.cacheMisses++;

      // In-flight deduplication
      if (this.inFlightRequests.has(rawPropsCacheKey)) {
        rawPropsData = await this.inFlightRequests.get(rawPropsCacheKey);
        rawCacheStatus = 'HIT';
      } else {
        // 6. Quota Guard Pre-Check BEFORE Keyed Dispatch
        const cost = 1; // 1 keyed event odds request
        const guardCheck = marketQuotaGuard.canConsumeKeyedRequest(cost);
        if (!guardCheck.allowed) {
          return {
            apexEventId: apexGame.eventId,
            status: 'QUOTA_EXCEEDED',
            message: `Prop request blocked by Quota Guard: ${guardCheck.reason}`,
            propsCount: 0,
            props: [],
            rejectionsCount: 0,
            quotaState: marketQuotaGuard.getQuotaState(),
          };
        }

        const apiKey = process.env.ODDS_API_KEY!;
        const marketsParam = encodeURIComponent(marketsToQuery.join(','));
        const url = `${ODDS_API_BASE}/sports/${sportKey}/events/${providerEventId}/odds?apiKey=${encodeURIComponent(
          apiKey
        )}&regions=us&markets=${marketsParam}&oddsFormat=american`;

        const requestPromise = (async () => {
          this.auditState.providerPropRequests++;
          this.auditState.bySport[sport].propRequests++;

          const res = await this.makeHttpRequest(url);
          if (res.statusCode >= 400) {
            throw new Error(`Provider returned HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`);
          }

          // Capture quota headers
          marketQuotaGuard.recordKeyedRequest(cost, {
            'x-requests-used': res.headers['x-requests-used'] as string,
            'x-requests-remaining': res.headers['x-requests-remaining'] as string,
            'x-requests-last': res.headers['x-requests-last'] as string,
          });

          // Cache raw response (15-min TTL)
          marketCache.set(rawPropsCacheKey, res.data, 900);
          return res.data;
        })();

        this.inFlightRequests.set(rawPropsCacheKey, requestPromise);
        try {
          rawPropsData = await requestPromise;
        } finally {
          this.inFlightRequests.delete(rawPropsCacheKey);
        }
      }
    }

    // 7. Parse and Verify Player Props
    const normalizedProps: NormalizedPlayerPropQuote[] = [];
    const bookmakers = Array.isArray(rawPropsData?.bookmakers) ? rawPropsData.bookmakers : [];
    let rejectedCount = 0;

    // Intermediate structure to group Over and Under for the same player, line, bookmaker, and market
    interface GroupedQuoteKey {
      bookmakerKey: string;
      bookmakerTitle: string;
      athleteId: string | null;
      playerDisplayName: string;
      verifiedTeam: string;
      verifiedOpponent: string;
      position?: string | null;
      jersey?: string | null;
      rosterSource: string;
      marketCategory: string;
      providerMarketKey: string;
      line: number;
      overOddsAmerican: number | null;
      overOddsDecimal: number | null;
      underOddsAmerican: number | null;
      underOddsDecimal: number | null;
      yesOddsAmerican?: number | null;
      yesOddsDecimal?: number | null;
      providerTimestamp: string;
    }

    const groupedMap = new Map<string, GroupedQuoteKey>();

    for (const bookmaker of bookmakers) {
      const bKey = bookmaker.key || 'unknown_book';
      const bTitle = bookmaker.title || bKey;
      const bMarkets = Array.isArray(bookmaker.markets) ? bookmaker.markets : [];

      for (const mkt of bMarkets) {
        const mKey = mkt.key;
        const marketMeta = SUPPORTED_PROP_MARKETS[mKey];

        if (!marketMeta) {
          // Unsupported market key
          this.recordRejection({
            timestamp: new Date().toISOString(),
            sport,
            apexEventId: apexGame.eventId,
            providerPlayerName: 'Unknown',
            providerMarketKey: mKey,
            reason: 'UNSUPPORTED_MARKET',
            details: `Market key ${mKey} is not supported in Apex prop registry`,
          });
          rejectedCount++;
          continue;
        }

        const outcomes = Array.isArray(mkt.outcomes) ? mkt.outcomes : [];
        for (const outcome of outcomes) {
          this.auditState.quotesReceived++;
          this.auditState.bySport[sport].quotesReceived++;

          const rawPlayerName = outcome.description || outcome.name || '';
          const outcomeTypeRaw = (outcome.name || '').toUpperCase();
          const point = typeof outcome.point === 'number' ? outcome.point : 0.5;
          let price = outcome.price;

          if (price === undefined || price === null) {
            continue;
          }

          let american = 0;
          let decimal = 0;
          if (price > -50 && price < 50) {
            decimal = price;
            american = this.decimalToAmerican(price);
          } else {
            american = Math.round(price);
            decimal = this.americanToDecimal(american);
          }

          // 8. Strict Roster & Team Verification
          const resolvedPlayer = await playerRosterService.verifyAndResolvePlayer(
            sport,
            apexGame,
            rawPlayerName
          );

          if (!resolvedPlayer.verified) {
            this.recordRejection({
              timestamp: new Date().toISOString(),
              sport,
              apexEventId: apexGame.eventId,
              providerPlayerName: rawPlayerName,
              providerMarketKey: mKey,
              reason: resolvedPlayer.rejectionReason || 'UNKNOWN_PLAYER',
              details: resolvedPlayer.rejectionDetail || 'Roster verification failed',
            });
            rejectedCount++;
            continue;
          }

          this.auditState.playersRosterResolved++;
          this.auditState.bySport[sport].playersResolved++;

          // Construct grouping key: bookmaker + player + marketKey + line
          const groupKey = `${bKey}::${resolvedPlayer.athleteId || resolvedPlayer.playerDisplayName}::${mKey}::${point}`;

          let group = groupedMap.get(groupKey);
          if (!group) {
            group = {
              bookmakerKey: bKey,
              bookmakerTitle: bTitle,
              athleteId: resolvedPlayer.athleteId,
              playerDisplayName: resolvedPlayer.playerDisplayName,
              verifiedTeam: resolvedPlayer.verifiedTeam,
              verifiedOpponent: resolvedPlayer.verifiedOpponent,
              position: resolvedPlayer.position,
              jersey: resolvedPlayer.jersey,
              rosterSource: resolvedPlayer.rosterSource,
              marketCategory: marketMeta.category,
              providerMarketKey: mKey,
              line: point,
              overOddsAmerican: null,
              overOddsDecimal: null,
              underOddsAmerican: null,
              underOddsDecimal: null,
              yesOddsAmerican: null,
              yesOddsDecimal: null,
              providerTimestamp: mkt.last_update || bookmaker.last_update || new Date().toISOString(),
            };
            groupedMap.set(groupKey, group);
          }

          if (outcomeTypeRaw === 'OVER') {
            group.overOddsAmerican = american;
            group.overOddsDecimal = decimal;
          } else if (outcomeTypeRaw === 'UNDER') {
            group.underOddsAmerican = american;
            group.underOddsDecimal = decimal;
          } else if (outcomeTypeRaw === 'YES') {
            group.yesOddsAmerican = american;
            group.yesOddsDecimal = decimal;
          } else if (outcomeTypeRaw === 'NO') {
            group.underOddsAmerican = american;
            group.underOddsDecimal = decimal;
          } else {
            // Default single-outcome quote
            group.overOddsAmerican = american;
            group.overOddsDecimal = decimal;
          }
        }
      }
    }

    // Convert grouped map into final normalized quotes
    for (const [key, g] of groupedMap.entries()) {
      const quote: NormalizedPlayerPropQuote = {
        quoteId: `prop_${apexGame.eventId}_${key.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        apexEventId: apexGame.eventId,
        providerEventId,
        sport,
        league: apexGame.league,
        playerId: g.athleteId,
        playerDisplayName: g.playerDisplayName,
        verifiedTeam: g.verifiedTeam,
        verifiedOpponent: g.verifiedOpponent,
        teamVenueRole:
          [apexGame.homeTeam, apexGame.homeAbbreviation].some((name) => name && name.toLowerCase() === g.verifiedTeam.toLowerCase())
            ? 'HOME'
            : [apexGame.awayTeam, apexGame.awayAbbreviation].some((name) => name && name.toLowerCase() === g.verifiedTeam.toLowerCase())
              ? 'AWAY'
              : null,
        playerPosition: g.position,
        playerJersey: g.jersey,
        marketCategory: g.marketCategory,
        providerMarketKey: g.providerMarketKey,
        line: g.line,
        bookmakerKey: g.bookmakerKey,
        bookmakerTitle: g.bookmakerTitle,
        overOddsAmerican: g.overOddsAmerican,
        overOddsDecimal: g.overOddsDecimal,
        underOddsAmerican: g.underOddsAmerican,
        underOddsDecimal: g.underOddsDecimal,
        yesOddsAmerican: g.yesOddsAmerican,
        yesOddsDecimal: g.yesOddsDecimal,
        marketVerified: true,
        rosterVerified: true,
        rosterSource: g.rosterSource,
        marketSource: 'The-Odds-API v4 (US)',
        providerTimestamp: g.providerTimestamp,
        retrievedAt: new Date().toISOString(),
        cacheStatus: rawCacheStatus,
        eventStatus: apexGame.status,
        eventStartTime: apexGame.startTime || null,
      };

      normalizedProps.push(quote);
      this.auditState.acceptedQuotes++;
      this.auditState.bySport[sport].acceptedQuotes++;
    }

    // MLB Pitcher K V3: enrich one representative quote per verified pitcher with
    // cached public MLB/Statcast context. This is independent of the keyed odds provider.
    const pitcherContextByPlayer = new Map<string, NormalizedPlayerPropQuote['mlbPitcherKContext']>();
    const pitcherRepresentatives = new Map<string, NormalizedPlayerPropQuote>();
    for (const quote of normalizedProps) {
      if (quote.sport === 'MLB' && quote.providerMarketKey === 'pitcher_strikeouts' && quote.playerId) {
        if (!pitcherRepresentatives.has(quote.playerId)) pitcherRepresentatives.set(quote.playerId, quote);
      }
    }
    const pitcherEntries = [...pitcherRepresentatives.entries()];
    const PUBLIC_CONTEXT_CONCURRENCY = 4;
    for (let i = 0; i < pitcherEntries.length; i += PUBLIC_CONTEXT_CONCURRENCY) {
      const batch = pitcherEntries.slice(i, i + PUBLIC_CONTEXT_CONCURRENCY);
      await Promise.all(batch.map(async ([playerId, quote]) => {
        try {
          const enriched = await mlbPitcherKContextService.enrichQuote(quote);
          pitcherContextByPlayer.set(playerId, enriched.mlbPitcherKContext ?? null);
        } catch {
          pitcherContextByPlayer.set(playerId, null);
        }
      }));
    }
    for (const quote of normalizedProps) {
      if (quote.playerId && pitcherContextByPlayer.has(quote.playerId)) {
        quote.mlbPitcherKContext = pitcherContextByPlayer.get(quote.playerId) ?? null;
      }
    }

    // Stage 3C-1: Enrich props with verified historical statistics in parallel
    await Promise.all(
      normalizedProps.map(async (quote) => {
        try {
          const stats = await playerStatsService.enrichPropWithHistoricalStats(quote);
          quote.historicalStats = stats;
        } catch (err) {
          quote.historicalStats = null;
        }

        // Stage 3C-2: Evaluate transparent deterministic probability model
        try {
          const probability = probabilityModelService.evaluatePropProbability(quote);
          quote.probabilityAnalysis = probability;
        } catch (probErr) {
          quote.probabilityAnalysis = null;
        }
      })
    );

    // Stage 3C-3: Evaluate Edge, EV, Line Shopping & Recommendation Engine
    const isUpcoming =
      (apexGame.status === 'UPCOMING' || (apexGame.status !== 'FINAL' && apexGame.status !== 'CANCELLED')) &&
      (!apexGame.startTime || new Date().getTime() < new Date(apexGame.startTime).getTime());
    const eventStartTime = apexGame.startTime || new Date(Date.now() + 3600000).toISOString();

    for (const quote of normalizedProps) {
      try {
        const valueAnalysis = valueEngineService.evaluatePropValue(quote, normalizedProps);
        quote.valueAnalysis = valueAnalysis;
        
        // Stage 4A & 4A-2: Persist pregame proposition snapshot for deterministic historical backtest
        backtestEngineService.persistQuoteSnapshot(quote, eventStartTime, isUpcoming);
      } catch (valErr) {
        quote.valueAnalysis = null;
      }
    }

    // Cache normalized props (5-min TTL)
    marketCache.set(normalizedCacheKey, normalizedProps, 300);

    return {
      apexEventId: apexGame.eventId,
      status: 'SUCCESS',
      eventTitle: `${apexGame.awayTeam || apexGame.playerBName} @ ${apexGame.homeTeam || apexGame.playerAName}`,
      sport: apexGame.sport,
      league: apexGame.league,
      scheduledDate: apexGame.startTime || apexGame.scheduleDate,
      propsCount: normalizedProps.length,
      props: normalizedProps,
      rejectionsCount: rejectedCount,
      quotaState: marketQuotaGuard.getQuotaState(),
    };
  }

  /**
   * Negative Test 1: Wrong Team Test
   * Feed a quote with a real player associated with the wrong event (e.g. Aaron Judge in Cubs @ Reds).
   */
  public async runWrongTeamTest(): Promise<PropNegativeTestResponse> {
    const fakeMlbGame: NormalizedApexGame = {
      eventId: 'test_cubs_reds_401816711',
      sport: 'MLB',
      league: 'MLB',
      scheduleDate: '2026-08-28',
      startTime: '2026-08-28T18:20:00Z',
      homeTeam: 'Chicago Cubs',
      homeTeamId: '16',
      homeAbbreviation: 'CHC',
      awayTeam: 'Cincinnati Reds',
      awayTeamId: '17',
      awayAbbreviation: 'CIN',
      venue: 'Wrigley Field',
      status: 'UPCOMING',
      statusDetail: 'Scheduled',
      homeScore: null,
      awayScore: null,
      source: 'ESPN',
      lastVerifiedAt: new Date().toISOString(),
    };

    // Aaron Judge belongs to NY Yankees, not Cubs or Reds
    const targetPlayer = 'Aaron Judge';
    const result = await playerRosterService.verifyAndResolvePlayer('MLB', fakeMlbGame, targetPlayer);

    const passed = !result.verified && result.rejectionReason === 'WRONG_TEAM';

    return {
      testName: 'Wrong Team Rejection Test',
      status: passed ? 'PASS' : 'FAIL',
      inputPlayer: targetPlayer,
      inputGame: 'Cincinnati Reds @ Chicago Cubs',
      expectedResult: 'REJECTED',
      actualResult: result.verified ? 'ACCEPTED' : 'REJECTED',
      rejectionReason: result.rejectionReason || 'None',
      keyedRequestsConsumed: 0,
      details: passed
        ? `PASS: Player "${targetPlayer}" correctly rejected because he is not on either the Chicago Cubs or Cincinnati Reds active roster.`
        : `FAIL: Expected rejection with WRONG_TEAM, got ${result.status} (${result.rejectionReason})`,
    };
  }

  /**
   * Negative Test 2: Unknown Player Test
   * Feed a completely fictitious player name.
   */
  public async runUnknownPlayerTest(): Promise<PropNegativeTestResponse> {
    const fakeMlbGame: NormalizedApexGame = {
      eventId: 'test_cubs_reds_401816711',
      sport: 'MLB',
      league: 'MLB',
      scheduleDate: '2026-08-28',
      startTime: '2026-08-28T18:20:00Z',
      homeTeam: 'Chicago Cubs',
      homeTeamId: '16',
      homeAbbreviation: 'CHC',
      awayTeam: 'Cincinnati Reds',
      awayTeamId: '17',
      awayAbbreviation: 'CIN',
      venue: 'Wrigley Field',
      status: 'UPCOMING',
      statusDetail: 'Scheduled',
      homeScore: null,
      awayScore: null,
      source: 'ESPN',
      lastVerifiedAt: new Date().toISOString(),
    };

    const targetPlayer = 'Zzyzx Fakeplayerovich';
    const result = await playerRosterService.verifyAndResolvePlayer('MLB', fakeMlbGame, targetPlayer);

    const passed = !result.verified && (result.rejectionReason === 'WRONG_TEAM' || result.rejectionReason === 'UNKNOWN_PLAYER');

    return {
      testName: 'Unknown Player Rejection Test',
      status: passed ? 'PASS' : 'FAIL',
      inputPlayer: targetPlayer,
      inputGame: 'Cincinnati Reds @ Chicago Cubs',
      expectedResult: 'REJECTED',
      actualResult: result.verified ? 'ACCEPTED' : 'REJECTED',
      rejectionReason: result.rejectionReason || 'None',
      keyedRequestsConsumed: 0,
      details: passed
        ? `PASS: Nonexistent player "${targetPlayer}" was securely rejected without fallback.`
        : `FAIL: Expected rejection, got ${result.status}`,
    };
  }

  /**
   * Negative Test 3: Ambiguous Name Test
   * Provide a surname-only or ambiguous initial that matches multiple players.
   */
  public async runAmbiguousNameTest(): Promise<PropNegativeTestResponse> {
    const fakeMlbGame: NormalizedApexGame = {
      eventId: 'test_ambiguous_game_999',
      sport: 'MLB',
      league: 'MLB',
      scheduleDate: '2026-08-28',
      startTime: '2026-08-28T18:20:00Z',
      homeTeam: 'Team Alpha',
      homeTeamId: 'alpha',
      homeAbbreviation: 'ALP',
      awayTeam: 'Team Beta',
      awayTeamId: 'beta',
      awayAbbreviation: 'BET',
      venue: 'Alpha Stadium',
      status: 'UPCOMING',
      statusDetail: 'Scheduled',
      homeScore: null,
      awayScore: null,
      source: 'ESPN',
      lastVerifiedAt: new Date().toISOString(),
    };

    // Seed roster with two players sharing the surname "Smith" and initial "J"
    playerRosterService.seedRoster('MLB', 'alpha', 'Team Alpha', [
      {
        id: '101',
        displayName: 'John Smith',
        normalizedName: 'john smith',
        normalizedLastName: 'smith',
        teamId: 'alpha',
        teamName: 'Team Alpha',
      },
      {
        id: '102',
        displayName: 'James Smith',
        normalizedName: 'james smith',
        normalizedLastName: 'smith',
        teamId: 'alpha',
        teamName: 'Team Alpha',
      },
    ]);

    const targetPlayer = 'J. Smith';
    const result = await playerRosterService.verifyAndResolvePlayer('MLB', fakeMlbGame, targetPlayer);

    const passed = !result.verified && result.rejectionReason === 'AMBIGUOUS_NAME';

    return {
      testName: 'Ambiguous Player Name Rejection Test',
      status: passed ? 'PASS' : 'FAIL',
      inputPlayer: targetPlayer,
      inputGame: 'Team Beta @ Team Alpha',
      expectedResult: 'REJECTED',
      actualResult: result.verified ? 'ACCEPTED' : 'REJECTED',
      rejectionReason: result.rejectionReason || 'None',
      keyedRequestsConsumed: 0,
      details: passed
        ? `PASS: Ambiguous name "${targetPlayer}" matching both John Smith and James Smith was correctly rejected.`
        : `FAIL: Expected rejection with AMBIGUOUS_NAME, got ${result.status} (${result.rejectionReason})`,
    };
  }

  /**
   * Returns current prop pipeline audit diagnostic telemetry.
   */
  public getAuditDiagnostics(): PropPipelineAuditDiagnostic {
    return { ...this.auditState };
  }
}

export const playerPropProvider = new PlayerPropProviderService();
