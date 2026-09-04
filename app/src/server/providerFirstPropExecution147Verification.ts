import { canonicalQualifiedPropQuotes } from '../propPresentation';
import { NormalizedPlayerPropQuote } from '../types';
import { valueEngineService } from './valueEngineService';

function test(name: string, passed: boolean, details: string) {
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name} | ${details}`);
  if (!passed) process.exitCode = 1;
}

const suite = valueEngineService.runVerificationSuite();
const executionCase = suite.criticalTests.find((x) => x.testName === 'PROVIDER_FIRST_BEST_EXECUTION_ONLY');
test(
  'Provider-first recommendations use best execution only',
  executionCase?.status === 'PASS',
  executionCase?.details || 'verification case missing',
);

const base: any = {
  quoteId: 'book-a',
  apexEventId: 'event-1',
  sport: 'MLB',
  playerId: 'player-1',
  playerDisplayName: 'Pitcher One',
  providerMarketKey: 'pitcher_strikeouts',
  marketCategory: 'Pitcher Strikeouts',
  line: 5.5,
  valueAnalysis: {
    bestRecommendation: {
      side: 'OVER',
      recommendationStatus: 'QUALIFIES',
      reasonCodes: [],
      selectedAnalysis: { oddsAmerican: -115, apexProbability: 0.64, expectedValuePercent: 7.1 },
    },
  },
};
const better: any = {
  ...base,
  quoteId: 'book-b',
  bookmakerTitle: 'Book B',
  valueAnalysis: {
    bestRecommendation: {
      ...base.valueAnalysis.bestRecommendation,
      selectedAnalysis: { oddsAmerican: -105, apexProbability: 0.64, expectedValuePercent: 8.4 },
    },
  },
};
const unique = canonicalQualifiedPropQuotes([base as NormalizedPlayerPropQuote, better as NormalizedPlayerPropQuote]);
test(
  'Decision Center deduplicates the same qualified prop identity',
  unique.length === 1 && unique[0].quoteId === 'book-b',
  `unique=${unique.length}; selected=${unique[0]?.quoteId || 'none'}`,
);

console.log(process.exitCode ? '\nAPEX 1.14.7 PROVIDER-FIRST PROP EXECUTION VERIFICATION: FAIL' : '\nAPEX 1.14.7 PROVIDER-FIRST PROP EXECUTION VERIFICATION: PASS');
