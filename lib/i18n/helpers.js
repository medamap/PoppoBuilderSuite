const i18nManager = require('./i18n-manager');

/**
 * 翻訳関数（基本）
 * @param {string} key - 翻訳キー
 * @param {Object} options - オプション（変数、名前空間など）
 * @returns {string} 翻訳されたテキスト
 */
function t(key, options = {}) {
  // i18nManagerが初期化されていない場合は、キーをそのまま返す
  if (!i18nManager.initialized) {
    console.warn('i18n not initialized. Returning key:', key);
    return key;
  }

  return i18nManager.translate(key, options);
}

/**
 * 翻訳関数（複数形対応）
 * @param {string} key - 翻訳キー
 * @param {number} count - カウント
 * @param {Object} options - 追加オプション
 * @returns {string} 翻訳されたテキスト
 */
function tn(key, count, options = {}) {
  return t(key, { count, ...options });
}

/**
 * 名前空間付き翻訳関数を取得
 * @param {string} namespace - 名前空間
 * @returns {Function} 名前空間固定の翻訳関数
 */
function getNamespacedT(namespace) {
  return (key, options = {}) => {
    // 既に名前空間が含まれている場合はそのまま使用
    if (key.includes(':')) {
      return t(key, options);
    }
    // 名前空間を含むキーに変換
    const fullKey = `${namespace}:${key}`;
    return t(fullKey, options);
  };
}

/**
 * 動的な翻訳キー生成
 * @param {string[]} parts - キーの部分
 * @returns {string} 結合されたキー
 */
function buildKey(...parts) {
  return parts.filter(Boolean).join('.');
}

/**
 * 翻訳キーが存在するかチェック
 * @param {string} key - 翻訳キー
 * @param {Object} options - オプション
 * @returns {boolean} キーが存在するか
 */
function hasTranslation(key, options = {}) {
  return i18nManager.hasKey(key, options);
}

/**
 * フォールバック付き翻訳
 * @param {string} key - 翻訳キー
 * @param {string} fallback - フォールバックテキスト
 * @param {Object} options - オプション
 * @returns {string} 翻訳されたテキストまたはフォールバック
 */
function tWithFallback(key, fallback, options = {}) {
  if (hasTranslation(key, options)) {
    return t(key, options);
  }
  
  // フォールバックテキストにも変数埋め込みを適用
  if (options && Object.keys(options).length > 0) {
    return interpolate(fallback, options);
  }
  
  return fallback;
}

/**
 * 複数のキーから最初に見つかった翻訳を返す
 * @param {string[]} keys - 翻訳キーの配列
 * @param {Object} options - オプション
 * @returns {string} 翻訳されたテキストまたは最後のキー
 */
function tFirst(keys, options = {}) {
  for (const key of keys) {
    if (hasTranslation(key, options)) {
      return t(key, options);
    }
  }
  
  // どのキーも見つからない場合は最後のキーを返す
  return keys[keys.length - 1];
}

/**
 * 条件付き翻訳
 * @param {boolean} condition - 条件
 * @param {string} trueKey - 条件が真の場合のキー
 * @param {string} falseKey - 条件が偽の場合のキー
 * @param {Object} options - オプション
 * @returns {string} 翻訳されたテキスト
 */
function tIf(condition, trueKey, falseKey, options = {}) {
  return t(condition ? trueKey : falseKey, options);
}

/**
 * 配列を翻訳してリスト形式で結合
 * @param {string} key - 翻訳キーのプレフィックス
 * @param {Array} items - アイテムの配列
 * @param {string} separator - 区切り文字
 * @returns {string} 結合された翻訳テキスト
 */
function tList(key, items, separator = ', ') {
  return items
    .map((item, index) => t(`${key}.${index}`, { item }))
    .filter(text => text !== `${key}.${index}`) // 翻訳が見つからない場合は除外
    .join(separator);
}

/**
 * 文字列補間（スタンドアロン）
 * @param {string} template - テンプレート文字列
 * @param {Object} values - 補間する値
 * @returns {string} 補間された文字列
 */
function interpolate(template, values) {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    return values.hasOwnProperty(trimmedKey) ? values[trimmedKey] : match;
  });
}

/**
 * 時間のフォーマット（相対時間）
 * @param {Date|number} date - 日付またはタイムスタンプ
 * @param {Object} options - オプション
 * @returns {string} フォーマットされた相対時間
 */
function tRelativeTime(date, options = {}) {
  const now = Date.now();
  const timestamp = date instanceof Date ? date.getTime() : date;
  const diff = now - timestamp;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return t('time.ago', { time: t('time.days', { count: days }) });
  } else if (hours > 0) {
    return t('time.ago', { time: t('time.hours', { count: hours }) });
  } else if (minutes > 0) {
    return t('time.ago', { time: t('time.minutes', { count: minutes }) });
  } else {
    return t('time.ago', { time: t('time.seconds', { count: seconds }) });
  }
}

/**
 * エラーメッセージの翻訳
 * @param {Error|string} error - エラーオブジェクトまたはエラーコード
 * @param {Object} context - エラーコンテキスト
 * @returns {string} 翻訳されたエラーメッセージ
 */
function tError(error, context = {}) {
  if (error instanceof Error) {
    // エラーコードがある場合
    if (error.code) {
      const errorKey = `errors:${error.code}`;
      if (hasTranslation(errorKey)) {
        return t(errorKey, { ...context, message: error.message });
      }
    }
    
    // エラータイプで分類
    const errorType = error.constructor.name;
    const typeKey = `errors:types.${errorType}`;
    if (hasTranslation(typeKey)) {
      return t(typeKey, { ...context, message: error.message });
    }
    
    // デフォルトのエラーメッセージ
    return t('errors:general.unknown', { ...context, message: error.message });
  }
  
  // 文字列の場合は、既に名前空間が含まれているかチェック
  if (error.includes(':')) {
    return t(error, context);
  }
  
  // 名前空間を追加
  const errorKey = `errors:${error}`;
  if (hasTranslation(errorKey)) {
    return t(errorKey, context);
  }
  
  return t('errors:general.unknown', { ...context, code: error });
}

/**
 * ステータスメッセージの翻訳
 * @param {string} status - ステータスコード
 * @param {Object} options - オプション
 * @returns {string} 翻訳されたステータス
 */
function tStatus(status, options = {}) {
  const statusKey = `status.${status}`;
  return tWithFallback(statusKey, status, options);
}

/**
 * 通知メッセージの翻訳
 * @param {string} type - 通知タイプ (info, success, warning, error)
 * @param {string} message - メッセージキーまたはテキスト
 * @param {Object} options - オプション
 * @returns {string} 翻訳された通知メッセージ
 */
function tNotification(type, message, options = {}) {
  // メッセージが翻訳キーの場合
  if (hasTranslation(message)) {
    const translatedMessage = t(message, options);
    return t(`messages:notification.${type}`, { message: translatedMessage });
  }
  
  // そうでない場合は直接使用
  return t(`messages:notification.${type}`, { message, ...options });
}

/**
 * フォーマット済み数値の取得
 * @param {number} value - 数値
 * @param {Object} options - フォーマットオプション
 * @returns {string} フォーマットされた数値
 */
function tNumber(value, options = {}) {
  return i18nManager.formatNumber(value, options);
}

/**
 * フォーマット済み日付の取得
 * @param {Date} date - 日付
 * @param {Object} options - フォーマットオプション
 * @returns {string} フォーマットされた日付
 */
function tDate(date, options = {}) {
  return i18nManager.formatDate(date, options);
}

/**
 * 現在のロケールを取得
 * @returns {string} 現在のロケール
 */
function getCurrentLocale() {
  return i18nManager.getCurrentLocale();
}

/**
 * ロケールを変更
 * @param {string} locale - 新しいロケール
 * @returns {Promise<void>}
 */
async function setLocale(locale) {
  return i18nManager.changeLocale(locale);
}

/**
 * サポートされているロケールを取得
 * @returns {string[]} サポートされているロケール
 */
function getSupportedLocales() {
  return i18nManager.getSupportedLocales();
}

/**
 * i18nシステムを初期化
 * @param {Object} options - 初期化オプション
 * @returns {Promise<void>}
 */
async function initI18n(options = {}) {
  return i18nManager.initialize(options);
}

// エクスポート
module.exports = {
  // 基本関数
  t,
  tn,
  
  // ユーティリティ
  getNamespacedT,
  buildKey,
  hasTranslation,
  tWithFallback,
  tFirst,
  tIf,
  tList,
  interpolate,
  
  // 特殊化された関数
  tRelativeTime,
  tError,
  tStatus,
  tNotification,
  
  // フォーマット
  tNumber,
  tDate,
  
  // ロケール管理
  getCurrentLocale,
  setLocale,
  getSupportedLocales,
  
  // 初期化
  initI18n,
  
  // i18nManagerへの直接アクセス（高度な使用のため）
  i18nManager
};