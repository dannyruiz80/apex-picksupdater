import { runMlbPitcherKV3VerificationSuite } from './mlbPitcherKV3Verification';

const result = runMlbPitcherKV3VerificationSuite();
console.log(JSON.stringify(result, null, 2));
if (!result.allPassed) process.exit(1);
