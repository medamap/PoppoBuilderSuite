/**
 * 通知プロバイダの基底クラス
 */
class NotificationProvider {
  constructor(name, config, logger) {
    this.name = name
    this.config = config
    this.logger = logger
    this.maxRetries = config.maxRetries || 3
    this.retryDelay = config.retryDelay || 1000
  }

  /**
   * 通知送信（サブクラスで実装必須）
   * @abstract
   * @param {Object} notification
   * @returns {Promise<void>}
   */
  async send(notification) {
    throw new Error('send() must be implemented by subclass')
  }

  /**
   * 設定の検証（サブクラスで実装必須）
   * @abstract
   * @returns {Promise<void>}
   */
  async validate() {
    throw new Error('validate() must be implemented by subclass')
  }

  /**
   * プロバイダ名の取得
   */
  getName() {
    return this.name
  }

  /**
   * プロバイダタイプの取得
   */
  getType() {
    return this.name.toLowerCase()
  }

  /**
   * 有効状態の確認
   */
  isEnabled() {
    return this.config.enabled === true
  }

  /**
   * リトライ付き実行
   * @protected
   */
  async retry(fn, retries = this.maxRetries) {
    let lastError
    
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error
        
        if (i < retries) {
          const delay = this.retryDelay * Math.pow(2, i) // 指数バックオフ
          this.logger.warn(`[${this.name}] リトライ ${i + 1}/${retries} (${delay}ms待機)`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }
    
    throw lastError
  }

  /**
   * 環境変数の解決
   * @protected
   */
  resolveEnvVar(value) {
    if (typeof value !== 'string') return value
    
    const envPattern = /\${([^}]+)}/g
    return value.replace(envPattern, (match, envName) => {
      const envValue = process.env[envName]
      if (!envValue) {
        throw new Error(`環境変数 ${envName} が設定されていません`)
      }
      return envValue
    })
  }

  /**
   * シャットダウン処理（オプション）
   * @returns {Promise<void>}
   */
  async shutdown() {
    // サブクラスで必要に応じてオーバーライド
    this.logger.debug(`[${this.name}] シャットダウン`)
  }
}

module.exports = NotificationProvider