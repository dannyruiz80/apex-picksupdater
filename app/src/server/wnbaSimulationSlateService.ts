import { fetchSchedule } from './sportsHub.js';
import { NormalizedApexGame } from '../types.js';

export interface WnbaSimulationSlateResult {
  status: 'SUCCESS';
  scheduleDate: string;
  games: NormalizedApexGame[];
  gamesAvailable: number;
  source: 'PUBLIC_SCHEDULE';
  note: string;
}

export function isValidWnbaSimulationDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`));
}

export function filterWnbaSimulationGames(games: NormalizedApexGame[]): NormalizedApexGame[] {
  return games.filter((game) =>
    game.sport === 'WNBA' &&
    game.status === 'UPCOMING' &&
    game.pregameBetEligible !== false &&
    Boolean(game.eventId) &&
    Boolean(game.startTime)
  );
}

export async function loadWnbaSimulationSlate(date: string): Promise<WnbaSimulationSlateResult> {
  if (!isValidWnbaSimulationDate(date)) throw new Error('date must be a valid YYYY-MM-DD value.');
  const schedule = await fetchSchedule('WNBA', date);
  const games = filterWnbaSimulationGames(schedule.games || []);
  return {
    status: 'SUCCESS',
    scheduleDate: schedule.scheduleDate || date,
    games,
    gamesAvailable: games.length,
    source: 'PUBLIC_SCHEDULE',
    note: 'WNBA simulation slate is loaded independently by date from the public schedule. This lookup does not consume keyed Odds API credits.',
  };
}
