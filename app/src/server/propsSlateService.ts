import {
  ApexSport,
  ApexSportFilter,
  NormalizedApexGame,
  NormalizedPlayerPropQuote,
  PropSlateEventResult,
  PropSlateScanResponse,
} from '../types';
import { playerPropProvider } from './playerPropProvider';
import { marketQuotaGuard } from './marketQuotaGuard';
import { isCanonicalFootballScheduleDate } from './scheduleDateIdentity.js';

const SPORT_ORDER: ApexSport[] = ['MLB', 'NFL', 'NCAAF', 'NBA', 'WNBA', 'NHL', 'SOCCER', 'TENNIS'];

function eventTime(game: NormalizedApexGame): number {
  const raw = game.startTime || game.scheduleDate;
  const parsed = raw ? new Date(raw).getTime() : Number.POSITIVE_INFINITY;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function isPropCapableSport(sport: ApexSport): boolean {
  return playerPropProvider.getPropMarketKeysForSport(sport).length > 0;
}

export function selectPropSlateGames(
  games: NormalizedApexGame[],
  sportFilter: ApexSportFilter,
  maxEvents = 8,
  selectedDate?: string,
): { selected: NormalizedApexGame[]; propCapableEvents: number; unsupportedSports: ApexSport[] } {
  const cap = Math.max(1, Math.min(12, Math.floor(maxEvents || 8)));
  const upcoming = games
    .filter((g) => g && g.eventId && g.status === 'UPCOMING')
    .filter((g) => sportFilter === 'ALL' || g.sport === sportFilter)
    .filter((g) => !selectedDate || isCanonicalFootballScheduleDate(g.sport, g.startTime, selectedDate))
    .sort((a, b) => eventTime(a) - eventTime(b));

  const unsupportedSports = Array.from(new Set(
    upcoming.filter((g) => !isPropCapableSport(g.sport)).map((g) => g.sport),
  ));
  const capable = upcoming.filter((g) => isPropCapableSport(g.sport));

  if (sportFilter !== 'ALL') {
    return { selected: capable.slice(0, cap), propCapableEvents: capable.length, unsupportedSports };
  }

  const bySport = new Map<ApexSport, NormalizedApexGame[]>();
  for (const sport of SPORT_ORDER) bySport.set(sport, []);
  for (const game of capable) {
    if (!bySport.has(game.sport)) bySport.set(game.sport, []);
    bySport.get(game.sport)!.push(game);
  }

  const selected: NormalizedApexGame[] = [];
  let round = 0;
  while (selected.length < cap) {
    let added = false;
    for (const sport of SPORT_ORDER) {
      const bucket = bySport.get(sport) || [];
      if (bucket[round]) {
        selected.push(bucket[round]);
        added = true;
        if (selected.length >= cap) break;
      }
    }
    if (!added) break;
    round++;
  }

  return { selected, propCapableEvents: capable.length, unsupportedSports };
}

function quoteScore(q: NormalizedPlayerPropQuote): number {
  const rec = q.valueAnalysis?.bestRecommendation;
  const selected = rec?.selectedAnalysis;
  const qualifies = rec?.recommendationStatus === 'QUALIFIES' ? 1_000_000 : 0;
  const p = selected?.apexProbability ?? 0;
  const ev = selected?.expectedValuePercent ?? -999;
  return qualifies + p * 10_000 + ev * 10;
}

export function dedupeSlateProps(props: NormalizedPlayerPropQuote[]): NormalizedPlayerPropQuote[] {
  const best = new Map<string, NormalizedPlayerPropQuote>();
  for (const quote of props) {
    const identity = quote.playerId || quote.playerDisplayName.toLowerCase();
    const key = `${quote.apexEventId}::${identity}::${quote.providerMarketKey}::${quote.line}`;
    const current = best.get(key);
    if (!current || quoteScore(quote) > quoteScore(current)) best.set(key, quote);
  }
  return [...best.values()].sort((a, b) => quoteScore(b) - quoteScore(a));
}

export async function scanPlayerPropSlate(params: {
  games: NormalizedApexGame[];
  selectedDate: string;
  sportFilter: ApexSportFilter;
  maxEvents?: number;
}): Promise<PropSlateScanResponse> {
  const quota = marketQuotaGuard.getQuotaState();
  if (!marketQuotaGuard.isConfigured()) {
    return {
      status: 'NOT_CONFIGURED', selectedDate: params.selectedDate, sportFilter: params.sportFilter,
      eventsAvailable: params.games.length, propCapableEvents: 0, eventsScanned: 0,
      propsCount: 0, qualifiedCount: 0, props: [], eventResults: [], unsupportedSports: [],
      message: 'ODDS_API_KEY is not configured or invalid', quotaState: quota,
    };
  }

  const { selected, propCapableEvents, unsupportedSports } = selectPropSlateGames(
    params.games,
    params.sportFilter,
    params.maxEvents ?? 8,
    params.selectedDate,
  );

  if (selected.length === 0) {
    const unsupportedOnly = params.games.length > 0 && unsupportedSports.length > 0;
    return {
      status: 'NO_PROPS', selectedDate: params.selectedDate, sportFilter: params.sportFilter,
      eventsAvailable: params.games.length, propCapableEvents, eventsScanned: 0,
      propsCount: 0, qualifiedCount: 0, props: [], eventResults: [], unsupportedSports,
      message: unsupportedOnly
        ? `No connected player-prop markets are configured for ${unsupportedSports.join(', ')}. The schedule can still be shown without fabricating prop support.`
        : 'No upcoming prop-capable events are available on this slate.',
      quotaState: marketQuotaGuard.getQuotaState(),
    };
  }

  const eventResults: PropSlateEventResult[] = [];
  const allProps: NormalizedPlayerPropQuote[] = [];
  let hitQuota = false;

  // Sequential by design: provider-credit use remains transparent and quota-guarded.
  for (const game of selected) {
    try {
      const result = await playerPropProvider.getPlayerPropsForGame(game);
      const qualifiedCount = result.props.filter(
        (q) => q.valueAnalysis?.bestRecommendation?.recommendationStatus === 'QUALIFIES',
      ).length;
      eventResults.push({
        apexEventId: game.eventId,
        sport: game.sport,
        eventTitle: `${game.awayTeam || game.playerBName || 'Away'} @ ${game.homeTeam || game.playerAName || 'Home'}`,
        scheduledDate: game.startTime || game.scheduleDate,
        status: result.status,
        propsCount: result.propsCount,
        qualifiedCount,
        message: result.message,
      });
      allProps.push(...result.props);
      if (result.status === 'QUOTA_EXCEEDED') {
        hitQuota = true;
        break;
      }
    } catch (err: any) {
      eventResults.push({
        apexEventId: game.eventId,
        sport: game.sport,
        eventTitle: `${game.awayTeam || game.playerBName || 'Away'} @ ${game.homeTeam || game.playerAName || 'Home'}`,
        scheduledDate: game.startTime || game.scheduleDate,
        status: 'ERROR', propsCount: 0, qualifiedCount: 0,
        message: err?.message || 'Failed to retrieve props for event',
      });
    }
  }

  const props = dedupeSlateProps(allProps);
  const qualifiedCount = props.filter(
    (q) => q.valueAnalysis?.bestRecommendation?.recommendationStatus === 'QUALIFIES',
  ).length;

  return {
    status: hitQuota ? 'QUOTA_EXCEEDED' : props.length > 0 ? 'SUCCESS' : 'NO_PROPS',
    selectedDate: params.selectedDate,
    sportFilter: params.sportFilter,
    eventsAvailable: params.games.length,
    propCapableEvents,
    eventsScanned: eventResults.length,
    propsCount: props.length,
    qualifiedCount,
    props,
    eventResults,
    unsupportedSports,
    message: props.length > 0
      ? `Scanned ${eventResults.length} event${eventResults.length === 1 ? '' : 's'} and returned ${props.length} distinct verified prop markets.`
      : 'No verified player props were returned across the scanned events. Sportsbooks may not have published those player markets yet.',
    quotaState: marketQuotaGuard.getQuotaState(),
  };
}
