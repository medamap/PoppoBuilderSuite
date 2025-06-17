/**
 * 通知プロバイダの基底クラス
 */
class NotificationProvider {
  /**
   * @param {Object} config - プロバイダ設定
   * @param {Logger} logger - ロガーインスタンス
   */
  constructor(config, logger) {
    this.config = config
    this.logger = logger
    this.retryCount = config.retryCount || 3
    this.retryDelay = config.retryDelay || 1000
  }

  /**
   * プロバイダ名を取得（サブクラスで実装必須）
   * @returns {string}
   */
  getName() {
    throw new Error('getName() must be implemented by subclass')
  }

  /**
   * プロバイダタイプを取得（サブクラスで実装必須）
   * @returns {string}
   */
  getType() {
    throw new Error('getType() must be implemented by subclass')
  }

  /**
   * 通知送信（サブクラスで実装必須）
   * @param {Object} notification
   * @returns {Promise<Object>}
   */
  async send(notification) {
    throw new Error('send() must be implemented by subclass')
  }

  /**
   * 検証（サブクラスで実装必須）
   * @returns {Promise<boolean>}
   */
  async validate() {
    throw new Error('validate() must be implemented by subclass')
  }

  /**
   * リトライ付き送信
   * @protected
   * @param {Function} sendFunction - 送信関数
   * @param {Object} notification - 通知データ
   * @returns {Promise<Object>}
   */
  async sendWithRetry(sendFunction, notification) {
    let lastError
    
    for (let attempt = 1; attempt <= this.retryCount; attempt++) {
      try {
        this.logger.debug(`[${this.getName()}] 送信試行 ${attempt}/${this.retryCount}`)
        const result = await sendFunction(notification)
        this.logger.info(`[${this.getName()}] 送信成功`)
        return result
      } catch (error) {
        lastError = error
        this.logger.warn(`[${this.getName()}] 送信失敗 (試行 ${attempt}/${this.retryCount}): ${error.message}`)
        
        if (attempt < this.retryCount) {
          await this.delay(this.retryDelay * attempt)
        }
      }
    }
    
    throw lastError
  }

  /**
   * 遅延処理
   * @protected
   * @param {number} ms - ミリ秒
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 環境変数から認証情報を取得
   * @protected
   * @param {string} key - 環境変数名
   * @param {string} defaultValue - デフォルト値
   * @returns {string}
   */
  getEnvOrConfig(key, defaultValue = '') {
    return process.env[key] || this.config[key.toLowerCase()] || defaultValue
  }

  /**
   * レート制限のチェック
   * @protected
   * @returns {boolean}
   */
  checkRateLimit() {
    // サブクラスでオーバーライド可能
    return true
  }

  /**
   * エラーログ出力
   * @protected
   * @param {Error} error
   * @param {string} context
   */
  logError(error, context = '') {
    this.logger.error(`[${this.getName()}] ${context} エラー: ${error.message}`)
    if (error.stack) {
      this.logger.debug(`[${this.getName()}] スタックトレース: ${error.stack}`)
    }
  }

  /**
   * シャットダウン処理（オプション）
   * @returns {Promise<void>}
   */
  async shutdown() {
    // サブクラスで必要に応じてオーバーライド
    this.logger.debug(`[${this.getName()}] シャットダウン`)
  }
}

module.exports = NotificationProvider