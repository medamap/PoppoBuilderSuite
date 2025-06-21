/**
 * Logger
 * LoggerAdapterを使用してMultiLoggerと統合
 */

// 環境変数で旧Loggerを使用するか判断
if (process.env.USE_LEGACY_LOGGER === 'true') {
  // 旧Loggerを使用
  module.exports = require('./logger-original');
} else {
  // LoggerAdapterをLoggerとしてエクスポート
  const LoggerAdapter = require('../lib/utils/logger-adapter');
  module.exports = LoggerAdapter;
}