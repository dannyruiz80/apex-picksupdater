import { NormalizedApexGame, ApexSport } from '../types.js';
import { selectDecisionBoardSlateRows } from './decisionBoardService.js';

function test(name: string, passed: boolean, details: string) {
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name} | ${details}`);
  if (!passed) process.exitCode = 1;
}

const now = Date.now();

function fixture(sport: ApexSport, index: number): NormalizedApexGame {
  const start = new Date(now + (index + 1) * 60_000).toISOString();
  return {
    eventId: `${sport.toLowerCase()}-${index}`,
    sport,
    league: sport === 'TENNIS' ? 'ATP Test' : `${sport} Test League`,
    competition: `${sport} Test`,
    scheduleDate: start.slice(0, 10),
    startTime: start,
    awayTeamId: `${sport}-away-${index}`,
    awayTeam: sport === 'TENNIS' ? `Player A ${index}` : `Away ${sport} ${index}`,
    awayAbbreviation: 'AWY',
    homeTeamId: `${sport}-home-${index}`,
    homeTeam: sport === 'TENNIS' ? `Player B ${index}` : `Home ${sport} ${index}`,
    homeAbbreviation: 'HME',
    status: 'UPCOMING',
    statusDetail: 'Scheduled',
    awayScore: null,
    homeScore: null,
    tour: sport === 'TENNIS' ? 'ATP' : null,
    tournamentId: sport === 'TENNIS' ? 't1' : null,
    tournamentName: sport === 'TENNIS' ? 'ATP Test Open' : null,
    round: sport === 'TENNIS' ? 'Round' : null,
    court: null,
    surface: sport === 'TENNIS' ? 'Hard' : null,
    playerAId: sport === 'TENNIS' ? `${sport}-away-${index}` : null,
    playerAName: sport === 'TENNIS' ? `Player A ${index}` : null,
    playerACountry: null,
    playerBId: sport === 'TENNIS' ? `${sport}-home-${index}` : null,
    playerBName: sport === 'TENNIS' ? `Player B ${index}` : null,
    playerBCountry: null,
    setsWonA: null,
    setsWonB: null,
    setScores: null,
    currentSet: null,
    winner: null,
    venue: null,
    source: 'ESPN',
    lastVerifiedAt: new Date().toISOString(),
  };
}

const slate: NormalizedApexGame[] = [
  ...Array.from({ length: 16 }, (_, i) => fixture('MLB', i)),
  ...Array.from({ length: 8 }, (_, i) => fixture('SOCCER', 100 + i)),
  ...Array.from({ length: 96 }, (_, i) => fixture('TENNIS', 200 + i)),
];

const broad = selectDecisionBoardSlateRows(slate, 'ALL', 48, now);
const counts = broad.reduce<Record<string, number>>((acc, game) => {
  acc[game.sport] = (acc[game.sport] || 0) + 1;
  return acc;
}, {});

test(
  'Broad ALL SPORTS scan can evaluate 48 events',
  broad.length === 48,
  `selected=${broad.length}`,
);

test(
  'Observed MLB/Soccer/Tennis slate receives meaningful cross-sport depth',
  counts.MLB === 16 && counts.SOCCER === 8 && counts.TENNIS === 24,
  `MLB=${counts.MLB || 0} SOCCER=${counts.SOCCER || 0} TENNIS=${counts.TENNIS || 0}`,
);

test(
  'Round-robin fairness is preserved at the start of the broad scan',
  broad.slice(0, 3).map((g) => g.sport).join(',') === 'MLB,SOCCER,TENNIS',
  `first=${broad.slice(0, 3).map((g) => g.sport).join(',')}`,
);

const tennisOnly = selectDecisionBoardSlateRows(slate, 'TENNIS', 30, now);
test(
  'Tennis-only scan supports a 30-event evaluation window',
  tennisOnly.length === 30 && tennisOnly.every((g) => g.sport === 'TENNIS'),
  `selected=${tennisOnly.length}`,
);

const narrow = selectDecisionBoardSlateRows(slate, 'ALL', 3, now);
test(
  'Explicit narrow callers remain narrow',
  narrow.length === 3,
  `selected=${narrow.length}`,
);

const hardCap = selectDecisionBoardSlateRows(slate, 'ALL', 999, now);
test(
  'Decision-board scan has a hard safety cap of 48 events',
  hardCap.length === 48,
  `selected=${hardCap.length}`,
);

console.log(process.exitCode ? '\nAPEX 1.14.5 CROSS-SPORT COVERAGE VERIFICATION: FAIL' : '\nAPEX 1.14.5 CROSS-SPORT COVERAGE VERIFICATION: PASS');
