import { NormalizedApexGame, NormalizedLiveScoreUpdate } from './types';

export function mergeVerifiedLiveUpdates(
  scheduledGames: NormalizedApexGame[],
  updates: Record<string, NormalizedLiveScoreUpdate>,
): NormalizedApexGame[] {
  const merged = scheduledGames.map((game) => {
    const update = updates[game.eventId];
    if (!update) return game;
    return {
      ...game,
      status: update.status || game.status,
      statusDetail: update.statusDetail || game.statusDetail,
      pregameBetEligible: update.pregameBetEligible ?? game.pregameBetEligible,
      eventVisibleInLive: update.eventVisibleInLive ?? game.eventVisibleInLive,
      homeScore: update.homeScore !== null ? update.homeScore : game.homeScore,
      awayScore: update.awayScore !== null ? update.awayScore : game.awayScore,
      period: update.period !== undefined ? update.period : game.period,
      displayClock: update.displayClock !== undefined ? update.displayClock : game.displayClock,
      inning: update.inning !== undefined ? update.inning : game.inning,
      inningState: update.inningState !== undefined ? update.inningState : game.inningState,
      matchClock: update.matchClock !== undefined ? update.matchClock : game.matchClock,
      stoppageTime: update.stoppageTime !== undefined ? update.stoppageTime : game.stoppageTime,
      penalties: update.penalties !== undefined ? update.penalties : game.penalties,
      aggregateScore: update.aggregateScore !== undefined ? update.aggregateScore : game.aggregateScore,
      setsWonA: update.setsWonA !== undefined ? update.setsWonA : game.setsWonA,
      setsWonB: update.setsWonB !== undefined ? update.setsWonB : game.setsWonB,
      setScores: update.setScores !== undefined ? update.setScores : game.setScores,
      currentSet: update.currentSet !== undefined ? update.currentSet : game.currentSet,
      winner: update.winner !== undefined ? update.winner : game.winner,
      lastVerifiedAt: update.lastVerifiedAt || game.lastVerifiedAt,
    };
  });

  const known = new Set(merged.map((g) => g.eventId));
  for (const update of Object.values(updates)) {
    if (known.has(update.eventId)) continue;
    if (!update.eventVisibleInLive || !update.homeTeam || !update.awayTeam || !update.startTime) continue;
    merged.push({
      eventId: update.eventId,
      sport: update.sport,
      league: update.league || update.sport,
      scheduleDate: update.scheduleDate || update.startTime.slice(0, 10),
      startTime: update.startTime,
      awayTeamId: update.awayTeamId ?? null,
      awayTeam: update.awayTeam,
      awayAbbreviation: update.awayAbbreviation ?? null,
      homeTeamId: update.homeTeamId ?? null,
      homeTeam: update.homeTeam,
      homeAbbreviation: update.homeAbbreviation ?? null,
      status: update.status,
      statusDetail: update.statusDetail,
      pregameBetEligible: update.pregameBetEligible ?? false,
      eventVisibleInLive: update.eventVisibleInLive ?? true,
      awayScore: update.awayScore,
      homeScore: update.homeScore,
      period: update.period ?? null,
      periodType: update.periodType ?? null,
      displayClock: update.displayClock ?? null,
      venue: update.venue ?? null,
      source: 'ESPN',
      lastVerifiedAt: update.lastVerifiedAt,
    });
    known.add(update.eventId);
  }

  return merged.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
}
