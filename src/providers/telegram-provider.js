const NotificationProvider = require('./notification-provider')
const https = require('https')

/**
 * Telegram通知プロバイダ
 */
class TelegramProvider extends NotificationProvider {
  constructor(config, logger) {
    super(config, logger)
    this.botToken = this.getEnvOrConfig('TELEGRAM_BOT_TOKEN')
    this.chatId = this.getEnvOrConfig('TELEGRAM_CHAT_ID')
    this.apiBaseUrl = 'https://api.telegram.org'
  }

  getName() {
    return 'Telegram'
  }

  getType() {
    return 'bot'
  }

  async validate() {
    if (!this.botToken) {
      this.logger.error('[Telegram] Botトークンが設定されていません')
      return false
    }

    if (!this.chatId) {
      this.logger.error('[Telegram] チャットIDが設定されていません')
      return false
    }

    // Bot情報の取得で検証
    try {
      const result = await this.getMe()
      if (result.ok) {
        this.logger.info(`[Telegram] Bot検証成功: @${result.result.username}`)
        return true
      }
      return false
    } catch (error) {
      this.logger.error(`[Telegram] Bot検証エラー: ${error.message}`)
      return false
    }
  }

  async getMe() {
    return this.makeRequest('getMe')
  }

  async send(notification) {
    return this.sendWithRetry(async (notif) => {
      const { message, data } = notif
      const { title, body } = message

      const text = this.formatMessage(title, body, data, notif.eventType)
      
      const params = {
        chat_id: this.chatId,
        text: text,
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      }

      // インラインキーボードの追加（URLがある場合）
      if (data.url) {
        params.reply_markup = {
          inline_keyboard: [[
            {
              text: 'GitHubで見る',
              url: data.url
            }
          ]]
        }
      }

      return this.makeRequest('sendMessage', params)
    }, notification)
  }

  formatMessage(title, body, data, eventType) {
    const emoji = this.getEmoji(eventType)
    
    let text = `${emoji} *${this.escapeMarkdown(title)}*\n\n`
    text += `${this.escapeMarkdown(body)}\n`

    // 追加情報
    if (data.issueNumber || data.repository) {
      text += '\n━━━━━━━━━━━━━━━\n'
      
      if (data.issueNumber) {
        text += `📌 Issue: #${data.issueNumber}\n`
      }
      
      if (data.repository) {
        text += `📁 Repository: \`${data.repository}\`\n`
      }
    }

    // タイムスタンプ
    text += `\n🕐 _${new Date().toLocaleString('ja-JP')}_`

    // Telegramの文字数制限（4096文字）に対応
    if (text.length > 4096) {
      text = text.substring(0, 4093) + '...'
    }

    return text
  }

  escapeMarkdown(text) {
    // Telegram MarkdownV2で特別な意味を持つ文字をエスケープ
    return text
      .replace(/([_*\[\]()~`>#+=|{}.!-])/g, '\\$1')
  }

  getEmoji(eventType) {
    const emojis = {
      'task_started': '🚀',
      'task_completed': '✅',
      'task_failed': '❌',
      'error': '🚨',
      'warning': '⚠️',
      'info': 'ℹ️',
      'test': '🧪'
    }
    return emojis[eventType] || '📢'
  }

  async makeRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const url = `${this.apiBaseUrl}/bot${this.botToken}/${method}`
      const data = JSON.stringify(params)

      const urlObj = new URL(url)
      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
            
            if (response.ok) {
              resolve(response)
            } else {
              reject(new Error(`Telegram API エラー: ${response.description || 'Unknown error'}`))
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

module.exports = TelegramProvider