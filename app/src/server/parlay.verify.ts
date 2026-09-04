import { runParlayVerificationSuite } from './parlayVerification.js';
const r=runParlayVerificationSuite();console.log(JSON.stringify(r,null,2));if(!r.allPassed)process.exitCode=1;
