import { runBankrollVerificationSuite } from './bankrollVerification.js';
const r=runBankrollVerificationSuite();
console.log(JSON.stringify(r,null,2));
if(!r.allPassed)process.exitCode=1;
