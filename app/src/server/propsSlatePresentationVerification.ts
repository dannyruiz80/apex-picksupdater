import { formatPropSelectionLabel, humanizePropMarket } from '../propPresentation.js';

export function runPropsSlatePresentationVerificationSuite() {
  const tests: Array<{testName:string;status:'PASS'|'FAIL';details:string}> = [];

  const pitcher = formatPropSelectionLabel('Shane Drohan', 'pitcher_strikeouts', 'UNDER', 5.5);
  tests.push({
    testName: 'Prop selection label always includes exact market identity',
    status: pitcher === 'Shane Drohan · Pitcher Strikeouts UNDER 5.5' ? 'PASS' : 'FAIL',
    details: pitcher,
  });

  const bases = formatPropSelectionLabel('Nick Sogard', 'Total Bases', 'OVER', 0.5);
  tests.push({
    testName: 'Already-human market categories remain human readable',
    status: bases === 'Nick Sogard · Total Bases OVER 0.5' ? 'PASS' : 'FAIL',
    details: bases,
  });

  const rbi = humanizePropMarket('batter_rbis');
  tests.push({
    testName: 'Provider market key resolves to specific prop category',
    status: rbi === 'RBIs' ? 'PASS' : 'FAIL',
    details: rbi,
  });

  const generic = humanizePropMarket('player_shots_on_target');
  tests.push({
    testName: 'Soccer prop key resolves to exact market category',
    status: generic === 'Shots on Target' ? 'PASS' : 'FAIL',
    details: generic,
  });

  return {
    allPassed: tests.every((t)=>t.status === 'PASS'),
    verificationTimestamp: new Date().toISOString(),
    engineVersion: 'APEX_PROPS_SLATE_IDENTITY_V1_14_2',
    keyedOddsRequestsConsumed: 0,
    tests,
  };
}
