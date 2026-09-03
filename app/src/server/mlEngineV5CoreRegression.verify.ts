import { probabilityModelService } from './probabilityModelService';
import { valueEngineService } from './valueEngineService';
import { backtestEngineService } from './backtestEngineService';
import { snapshotPersistenceService } from './snapshotPersistenceService';

const probability = probabilityModelService.runVerificationSuite();
const value = valueEngineService.runVerificationSuite();
const backtest = backtestEngineService.runDeterministicBacktestTestSuite();
const persistence = snapshotPersistenceService.runPersistenceTestSuite();

console.log(JSON.stringify({ probability, value, backtest, persistence }, null, 2));
