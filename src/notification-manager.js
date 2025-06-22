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
        .catch(error => {
          // エラーオブジェクトの場合
          if (error && typeof error === 'object' && error.provider) {
            return error
          }
          // 通常のエラーの場合
          return {
            provider: provider.getName(),
            success: false,
            error: error.message || error
          }
        })
    )

    return Promise.all(promises)
  }

  /**
   * タイムアウト付き送信
   * @private
   */
  async sendWithTimeout(provider, notification, timeout) {
    // sendメソッドの存在確認
    if (typeof provider.send !== 'function') {
      const error = new Error(`Provider ${provider.getName()} does not have a send method`)
      this.logger.error(`[${provider.getName()}] ${error.message}`)
      throw {
        provider: provider.getName(),
        success: false,
        error: 'send is not a function'
      }
    }

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), timeout)
    })

    try {
      const result = await Promise.race([
        provider.send(notification),
        timeoutPromise
      ])
      
      this.logger.info(`[${provider.getName()}] 通知送信成功`)
      return { 
        provider: provider.getName(), 
        success: true,
        response: result
      }
    } catch (error) {
      this.logger.error(`[${provider.getName()}] 通知送信失敗: ${error.message}`)
      throw {
        provider: provider.getName(),
        success: false,
        error: error.message
      }
    }
  }

  /**
   * プロバイダの検証
   * @private
   */
  async validateProviders() {
    const validationPromises = Array.from(this.providers.values()).map(async provider => {
      try {
        await provider.validate()
        this.logger.info(`[NotificationManager] プロバイダ ${provider.getName()} の検証成功`)
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
    if (typeof template === 'string') {
      let message = template
      
      // 基本的な置換
      message = message.replace(/{{issueNumber}}/g, data?.issueNumber || '')
      message = message.replace(/{{title}}/g, data?.title || '')
      message = message.replace(/{{error}}/g, data?.error || '')
      message = message.replace(/{{message}}/g, data?.message || '')
      
      // 実行時間の整形
      if (data?.executionTime && this.config.notifications?.options?.includeExecutionTime) {
        const time = this.formatExecutionTime(data.executionTime)
        message = message.replace(/{{executionTime}}/g, time)
      }
      
      // ラベルの整形
      if (data?.labels && this.config.notifications?.options?.includeLabels) {
        const labels = data.labels.join(', ')
        message = message.replace(/{{labels}}/g, labels)
      }
      
      return message
    } else if (typeof template === 'object') {
      // オブジェクト形式のテンプレート
      let title = template.title || ''
      let body = template.body || ''

      // プレースホルダーの置換
      if (data && typeof data === 'object') {
        Object.entries(data).forEach(([key, value]) => {
          const placeholder = `{{${key}}}`
          title = title.replace(new RegExp(placeholder, 'g'), value || '')
          body = body.replace(new RegExp(placeholder, 'g'), value || '')
        })
      }

      return { title, body }
    }
    
    return template || ''
  }

  /**
   * 実行時間のフォーマット
   * @private
   */
  formatExecutionTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    
    if (hours > 0) {
      return `${hours}時間${minutes % 60}分${seconds % 60}秒`
    } else if (minutes > 0) {
      return `${minutes}分${seconds % 60}秒`
    } else {
      return `${seconds}秒`
    }
  }

  /**
   * 結果の集計
   * @private
   */
  summarizeResults(results) {
    const summary = {
      sent: 0,
      failed: 0,
      errors: [],
      providers: {}
    }

    results.forEach(result => {
      if (result && result.success) {
        summary.sent++
        if (result.provider) {
          summary.providers[result.provider] = { success: true }
        }
      } else if (result) {
        summary.failed++
        if (result.provider && result.error) {
          summary.errors.push(`${result.provider}: ${result.error}`)
          summary.providers[result.provider] = { 
            success: false, 
            error: result.error 
          }
        } else {
          summary.errors.push({
            provider: result.provider,
            error: result.error
          })
        }
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