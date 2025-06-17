/**
 * 通知システムの中核を担うマネージャークラス
 */
class NotificationManager {
  /**
   * @param {Object} config - 通知設定
   * @param {Logger} logger - ロガーインスタンス
   */
  constructor(config, logger) {
    this.config = config
    this.logger = logger
    this.providers = new Map()
    this.initialized = false
  }

  /**
   * 初期化処理
   * @returns {Promise<void>}
   */
  async initialize() {
    if (!this.config.notifications?.enabled) {
      this.logger.info('[NotificationManager] 通知機能は無効です')
      return
    }

    // 各プロバイダの初期化
    const providers = this.config.notifications.providers || {}
    
    if (providers.discord?.enabled) {
      const DiscordProvider = require('./providers/discord-provider')
      this.registerProvider(new DiscordProvider(providers.discord, this.logger))
    }
    
    if (providers.pushover?.enabled) {
      const PushoverProvider = require('./providers/pushover-provider')
      this.registerProvider(new PushoverProvider(providers.pushover, this.logger))
    }
    
    if (providers.telegram?.enabled) {
      const TelegramProvider = require('./providers/telegram-provider')
      this.registerProvider(new TelegramProvider(providers.telegram, this.logger))
    }

    // 各プロバイダの検証
    await this.validateProviders()
    
    this.initialized = true
    this.logger.info(`[NotificationManager] 初期化完了: ${this.providers.size}個のプロバイダが有効`)
  }

  /**
   * プロバイダの登録
   * @param {NotificationProvider} provider
   */
  registerProvider(provider) {
    this.providers.set(provider.getName(), provider)
  }

  /**
   * 通知送信
   * @param {string} eventType - イベントタイプ
   * @param {Object} data - 通知データ
   * @returns {Promise<Object>} 送信結果
   */
  async notify(eventType, data) {
    if (!this.initialized || this.providers.size === 0) {
      return { sent: 0, failed: 0, errors: [] }
    }

    const template = this.getTemplate(eventType)
    const message = this.formatMessage(template, data)
    
    const results = await this.sendToAllProviders({
      eventType,
      message,
      data,
      timestamp: new Date().toISOString()
    })

    return this.summarizeResults(results)
  }

  /**
   * 全プロバイダへの送信
   * @private
   */
  async sendToAllProviders(notification) {
    const timeout = this.config.notifications.options?.timeout || 5000
    
    const promises = Array.from(this.providers.values()).map(provider => 
      this.sendWithTimeout(provider, notification, timeout)
        .catch(error => ({
          provider: provider.getName(),
          success: false,
          error: error.message
        }))
    )

    return Promise.all(promises)
  }

  /**
   * タイムアウト付き送信
   * @private
   */
  async sendWithTimeout(provider, notification, timeout) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('通知送信タイムアウト')), timeout)
    })

    const sendPromise = provider.send(notification)

    try {
      const result = await Promise.race([sendPromise, timeoutPromise])
      return {
        provider: provider.getName(),
        success: true,
        response: result
      }
    } catch (error) {
      throw error
    }
  }

  /**
   * プロバイダの検証
   * @private
   */
  async validateProviders() {
    const validationPromises = Array.from(this.providers.values()).map(async provider => {
      try {
        const isValid = await provider.validate()
        if (!isValid) {
          this.logger.warn(`[NotificationManager] プロバイダ ${provider.getName()} の検証に失敗しました`)
          this.providers.delete(provider.getName())
        }
      } catch (error) {
        this.logger.error(`[NotificationManager] プロバイダ ${provider.getName()} の検証エラー: ${error.message}`)
        this.providers.delete(provider.getName())
      }
    })

    await Promise.all(validationPromises)
  }

  /**
   * テンプレート取得
   * @private
   */
  getTemplate(eventType) {
    const templates = this.config.notifications.templates || {}
    return templates[eventType] || templates.default || {
      title: 'PoppoBuilder 通知',
      body: '{{message}}'
    }
  }

  /**
   * メッセージフォーマット
   * @private
   */
  formatMessage(template, data) {
    let title = template.title
    let body = template.body

    // プレースホルダーの置換
    Object.entries(data).forEach(([key, value]) => {
      const placeholder = `{{${key}}}`
      title = title.replace(new RegExp(placeholder, 'g'), value)
      body = body.replace(new RegExp(placeholder, 'g'), value)
    })

    return { title, body }
  }

  /**
   * 結果の集計
   * @private
   */
  summarizeResults(results) {
    const summary = {
      sent: 0,
      failed: 0,
      errors: []
    }

    results.forEach(result => {
      if (result.success) {
        summary.sent++
      } else {
        summary.failed++
        summary.errors.push({
          provider: result.provider,
          error: result.error
        })
      }
    })

    return summary
  }

  /**
   * テスト通知の送信
   * @returns {Promise<Object>}
   */
  async sendTestNotification() {
    return this.notify('test', {
      message: 'これはPoppoBuilderからのテスト通知です',
      timestamp: new Date().toISOString()
    })
  }

  /**
   * プロバイダのステータス取得
   * @returns {Object}
   */
  getStatus() {
    const status = {
      initialized: this.initialized,
      providers: {}
    }

    this.providers.forEach((provider, name) => {
      status.providers[name] = {
        enabled: true,
        type: provider.getType()
      }
    })

    return status
  }

  /**
   * シャットダウン処理
   */
  async shutdown() {
    this.logger.info('[NotificationManager] シャットダウン中...')
    
    // 各プロバイダのクリーンアップ
    const shutdownPromises = Array.from(this.providers.values()).map(provider => {
      if (typeof provider.shutdown === 'function') {
        return provider.shutdown().catch(error => {
          this.logger.error(`[NotificationManager] プロバイダ ${provider.getName()} のシャットダウンエラー: ${error.message}`)
        })
      }
    })

    await Promise.all(shutdownPromises)
    
    this.providers.clear()
    this.initialized = false
    
    this.logger.info('[NotificationManager] シャットダウン完了')
  }
}

module.exports = NotificationManager