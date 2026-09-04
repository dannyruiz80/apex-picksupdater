import type { NormalizedPlayerPropQuote } from './types';

export const PROP_MARKET_LABELS: Record<string, string> = {
  pitcher_strikeouts: 'Pitcher Strikeouts',
  batter_home_runs: 'Home Runs',
  batter_hits: 'Hits',
  batter_total_bases: 'Total Bases',
  batter_rbis: 'RBIs',
  batter_runs_scored: 'Runs Scored',
  pitcher_outs: 'Pitcher Outs',
  pitcher_hits_allowed: 'Pitcher Hits Allowed',
  pitcher_walks: 'Pitcher Walks',
  player_pass_yds: 'Passing Yards',
  player_pass_tds: 'Passing Touchdowns',
  player_pass_completions: 'Pass Completions',
  player_pass_interceptions: 'Interceptions',
  player_rush_yds: 'Rushing Yards',
  player_receptions: 'Receptions',
  player_reception_yds: 'Receiving Yards',
  player_anytime_td: 'Anytime Touchdown',
  player_points: 'Points',
  player_rebounds: 'Rebounds',
  player_assists: 'Assists',
  player_threes: '3-Pointers Made',
  player_blocks: 'Blocks',
  player_steals: 'Steals',
  player_points_rebounds_assists: 'Points + Rebounds + Assists',
  player_goals: 'Goals',
  player_shots_on_goal: 'Shots on Goal',
  player_total_saves: 'Saves',
  player_goal_scorer_anytime: 'Anytime Goalscorer',
  player_shots_on_target: 'Shots on Target',
};

export function humanizePropMarket(value: string | null | undefined): string {
  const raw = (value || '').trim();
  if (!raw) return 'Player Prop';
  const registry = PROP_MARKET_LABELS[raw.toLowerCase()];
  if (registry) return registry;
  if (!raw.includes('_')) return raw;
  return raw
    .split('_')
    .filter(Boolean)
    .map((part) => part.length <= 3 && part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatPropSelectionLabel(
  playerName: string,
  marketCategoryOrKey: string,
  side: string | null | undefined,
  line: number | null | undefined,
): string {
  const market = humanizePropMarket(marketCategoryOrKey);
  const sideText = side ? side.toUpperCase() : '';
  const lineText = line === null || line === undefined ? '' : String(line);
  return `${playerName} · ${market} ${sideText} ${lineText}`.replace(/\s+/g, ' ').trim();
}


export function canonicalQualifiedPropQuotes(props: NormalizedPlayerPropQuote[]): NormalizedPlayerPropQuote[] {
  const best = new Map<string, NormalizedPlayerPropQuote>();
  for (const quote of props) {
    const rec = quote.valueAnalysis?.bestRecommendation;
    const selected = rec?.selectedAnalysis;
    if (rec?.recommendationStatus !== 'QUALIFIES' || !rec.side || !selected) continue;
    // Exact recommendation identity: event + player + market + line + recommended side.
    const player = quote.playerId || quote.playerDisplayName.toLowerCase();
    const key = `${quote.apexEventId}::${player}::${quote.providerMarketKey || quote.marketCategory}::${quote.line}::${rec.side}`;
    const current = best.get(key);
    const currentAnalysis = current?.valueAnalysis?.bestRecommendation?.selectedAnalysis;
    const currentOdds = currentAnalysis?.oddsAmerican ?? -100000;
    const candidateOdds = selected.oddsAmerican ?? -100000;
    if (!current || candidateOdds > currentOdds || (candidateOdds === currentOdds && quote.quoteId < current.quoteId)) {
      best.set(key, quote);
    }
  }
  return [...best.values()].sort((a, b) => {
    const aa = a.valueAnalysis?.bestRecommendation?.selectedAnalysis;
    const bb = b.valueAnalysis?.bestRecommendation?.selectedAnalysis;
    const ap = aa?.apexProbability ?? -1;
    const bp = bb?.apexProbability ?? -1;
    if (ap !== bp) return bp - ap;
    return (bb?.expectedValuePercent ?? -999) - (aa?.expectedValuePercent ?? -999);
  });
}
