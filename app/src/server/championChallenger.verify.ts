import { runChampionChallengerVerificationSuite } from './championChallengerVerification';

const result = runChampionChallengerVerificationSuite();
console.log(JSON.stringify(result, null, 2));
if (!result.allPassed) process.exitCode = 1;
