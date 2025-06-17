/**
 * 修復戦略のインデックス
 * すべての修復戦略をエクスポート
 */

const FileNotFoundRepairStrategy = require('./file-not-found');
const NullCheckRepairStrategy = require('./null-check');
const JsonParseRepairStrategy = require('./json-parse');

// 修復戦略のレジストリ
const repairStrategies = {
  'EP001': NullCheckRepairStrategy,
  'EP004': FileNotFoundRepairStrategy,
  'EP010': JsonParseRepairStrategy
};

/**
 * 修復戦略の取得
 */
function getRepairStrategy(patternId, logger) {
  const StrategyClass = repairStrategies[patternId];
  if (!StrategyClass) {
    return null;
  }
  
  return new StrategyClass(logger);
}

/**
 * すべての修復戦略を取得
 */
function getAllStrategies(logger) {
  const strategies = {};
  
  for (const [id, StrategyClass] of Object.entries(repairStrategies)) {
    strategies[id] = new StrategyClass(logger);
  }
  
  return strategies;
}

module.exports = {
  repairStrategies,
  getRepairStrategy,
  getAllStrategies,
  
  // 個別エクスポート
  FileNotFoundRepairStrategy,
  NullCheckRepairStrategy,
  JsonParseRepairStrategy
};