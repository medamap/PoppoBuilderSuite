const NotificationProvider = require('./notification-provider')
const https = require('https')
const querystring = require('querystring')

/**
 * Pushover通知プロバイダ
 */
class PushoverProvider extends NotificationProvider {
  constructor(config, logger) {
    super(config, logger)
    this.apiToken = this.getEnvOrConfig('PUSHOVER_API_TOKEN')
    this.userKey = this.getEnvOrConfig('PUSHOVER_USER_KEY')
    this.apiUrl = 'https://api.pushover.net/1/messages.json'
  }

  getName() {
    return 'Pushover'
  }

  getType() {
    return 'push'
  }

  async validate() {
    if (!this.apiToken) {
      this.logger.error('[Pushover] APIトークンが設定されていません')
      return false
    }

    if (!this.userKey) {
      this.logger.error('[Pushover] ユーザーキーが設定されていません')
      return false
    }

    // 検証API呼び出し
    try {
      const result = await this.validateCredentials()
      return result.status === 1
    } catch (error) {
      this.logger.error(`[Pushover] 認証情報の検証に失敗: ${error.message}`)
      return false
    }
  }

  async validateCredentials() {
    const data = querystring.stringify({
      token: this.apiToken,
      user: this.userKey
    })

    return this.makeRequest('https://api.pushover.net/1/users/validate.json', data)
  }

  async send(notification) {
    return this.sendWithRetry(async (notif) => {
      const { message, data } = notif
      const { title, body } = message

      const params = {
        token: this.apiToken,
        user: this.userKey,
        title: title,
        message: this.formatMessage(body, data),
        priority: this.getPriority(notif.eventType),
        timestamp: Math.floor(new Date(notif.timestamp).getTime() / 1000),
        sound: this.getSound(notif.eventType)
      }

      // URLがある場合は追加
      if (data.url) {
        params.url = data.url
        params.url_title = 'View on GitHub'
      }

      const postData = querystring.stringify(params)
      return this.makeRequest(this.apiUrl, postData)
    }, notification)
  }

  formatMessage(body, data) {
    let message = body

    // 追加情報を付加
    if (data.issueNumber) {
      message += `\n\nIssue: #${data.issueNumber}`
    }

    if (data.repository) {
      message += `\nRepository: ${data.repository}`
    }

    // Pushoverの文字数制限（1024文字）に対応
    if (message.length > 1024) {
      message = message.substring(0, 1021) + '...'
    }

    return message
  }

  getPriority(eventType) {
    const priorities = {
      'task_failed': 1,     // 高優先度
      'error': 1,           // 高優先度
      'task_completed': 0,  // 通常
      'task_started': -1,   // 低優先度
      'warning': 0,         // 通常
      'info': -1,          // 低優先度
      'test': 0            // 通常
    }
    return priorities[eventType] || 0
  }

  getSound(eventType) {
    const sounds = {
      'task_completed': 'magic',
      'task_failed': 'falling',
      'error': 'siren',
      'warning': 'tugboat',
      'test': 'pushover'
    }
    return sounds[eventType] || 'pushover'
  }

  async makeRequest(url, data) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url)
      
      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data)
        }
      }

      const req = https.request(options, (res) => {
        let responseBody = ''
        
        res.on('data', (chunk) => {
          responseBody += chunk
        })

        res.on('end', () => {
          try {
            const response = JSON.parse(responseBody)
            
            if (res.statusCode === 200 && response.status === 1) {
              resolve(response)
            } else {
              const errors = response.errors ? response.errors.join(', ') : 'Unknown error'
              reject(new Error(`Pushover API エラー: ${errors}`))
            }
          } catch (error) {
            reject(new Error(`レスポンス解析エラー: ${responseBody}`))
          }
        })
      })

      req.on('error', (error) => {
        reject(new Error(`ネットワークエラー: ${error.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('リクエストタイムアウト'))
      })

      req.setTimeout(5000)
      req.write(data)
      req.end()
    })
  }
}

module.exports = PushoverProvider