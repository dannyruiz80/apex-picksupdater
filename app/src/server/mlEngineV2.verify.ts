import { runMlEngineV2VerificationSuite } from './mlEngineV2Verification';
const result = runMlEngineV2VerificationSuite();
for (const t of result.tests) console.log(`${t.status} — ${t.testName}: ${t.details}`);
if (!result.allPassed) process.exitCode = 1;
console.log(`ML Engine V2 Verification: ${result.passed}/${result.total} PASS`);
