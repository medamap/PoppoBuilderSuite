const axios = require('axios')
const NotificationProvider = require('./notification-provider')

class PushoverProvider extends NotificationProvider {
  constructor(config, logger) {
    super('Pushover', config, logger)
    this.appToken = this.resolveEnvVar(config.appToken)
    this.userKey = this.resolveEnvVar(config.userKey)
    this.priority = config.priority || 0
    this.sound = config.sound || 'pushover'
    this.apiUrl = 'https://api.pushover.net/1/messages.json'
  }

  async validate() {
    if (!this.appToken) {
      throw new Error('Pushover App Tokenが設定されていません')
    }
    
    if (!this.userKey) {
      throw new Error('Pushover User Keyが設定されていません')
    }
    
    if (this.priority < -2 || this.priority > 2) {
      throw new Error('Pushover priorityは-2から2の範囲で設定してください')
    }
  }

  async send(notification) {
    const { eventType, message, data } = notification
    
    const payload = {
      token: this.appToken,
      user: this.userKey,
      message: this.truncateMessage(message, 1024),
      title: this.getTitle(eventType),
      priority: this.getPriority(eventType),
      sound: this.getSound(eventType),
      timestamp: Math.floor(Date.now() / 1000)
    }

    // Issue URLを追加
    if (data && data.issueUrl) {
      payload.url = data.issueUrl
      payload.url_title = `Issue #${data.issueNumber}を開く`
    }

    // 高優先度メッセージの追加設定
    if (payload.priority === 2) {
      payload.retry = 60  // 1分ごとに再通知
      payload.expire = 3600  // 1時間後に期限切れ
    }

    const response = await this.retry(() => 
      axios.post(this.apiUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      })
    )

    if (response.data.status !== 1) {
      throw new Error(`Pushover API error: ${JSON.stringify(response.data.errors)}`)
    }
  }

  getTitle(eventType) {
    const titles = {
      'issue.completed': 'PoppoBuilder - 処理完了',
      'issue.error': 'PoppoBuilder - エラー発生',
      'issue.timeout': 'PoppoBuilder - タイムアウト',
      'dogfooding.restart': 'PoppoBuilder - 再起動'
    }
    return titles[eventType] || 'PoppoBuilder'
  }

  getPriority(eventType) {
    // エラー時は高優先度、それ以外は設定値を使用
    if (eventType === 'issue.error') {
      return Math.max(this.priority, 1)
    }
    return this.priority
  }

  getSound(eventType) {
    // エラー時は特別な音
    if (eventType === 'issue.error') {
      return 'siren'
    }
    return this.sound
  }

  truncateMessage(message, maxLength) {
    if (message.length <= maxLength) {
      return message
    }
    return message.substring(0, maxLength - 3) + '...'
  }
}

module.exports = PushoverProvider