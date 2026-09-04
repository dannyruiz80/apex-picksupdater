import { runGameMarketCalibrationVerificationSuite } from './gameMarketCalibrationVerification.js';
const r=runGameMarketCalibrationVerificationSuite();console.log(JSON.stringify(r,null,2));if(!r.allPassed)process.exitCode=1;
