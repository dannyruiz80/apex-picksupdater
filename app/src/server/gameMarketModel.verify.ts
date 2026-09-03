import { runGameMarketModelVerificationSuite } from './gameMarketModelVerification';
const result=runGameMarketModelVerificationSuite();
console.log(JSON.stringify(result,null,2));
if(!result.allPassed) process.exitCode=1;
