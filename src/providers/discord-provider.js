const NotificationProvider = require('./notification-provider')
const https = require('https')

/**
 * Discord通知プロバイダ
 */
class DiscordProvider extends NotificationProvider {
  constructor(config, logger) {
    super(config, logger)
    this.webhookUrl = this.getEnvOrConfig('DISCORD_WEBHOOK_URL')
  }

  getName() {
    return 'Discord'
  }

  getType() {
    return 'webhook'
  }

  async validate() {
    if (!this.webhookUrl) {
      this.logger.error('[Discord] Webhook URLが設定されていません')
      return false
    }

    if (!this.webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
      this.logger.error('[Discord] 無効なWebhook URL形式です')
      return false
    }

    return true
  }

  async send(notification) {
    return this.sendWithRetry(async (notif) => {
      const embed = this.createEmbed(notif)
      const payload = {
        username: 'PoppoBuilder',
        avatar_url: 'https://github.com/medamap/PoppoBuilderSuite/raw/main/assets/poppo-icon.png',
        embeds: [embed]
      }

      return this.sendWebhook(payload)
    }, notification)
  }

  createEmbed(notification) {
    const { message, data } = notification
    const { title, body } = message

    const embed = {
      title: title,
      description: body,
      color: this.getColorByEventType(notification.eventType),
      timestamp: notification.timestamp,
      footer: {
        text: `PoppoBuilder - ${notification.eventType}`
      },
      fields: []
    }

    // データフィールドの追加
    if (data.issueNumber) {
      embed.fields.push({
        name: 'Issue',
        value: `#${data.issueNumber}`,
        inline: true
      })
    }

    if (data.repository) {
      embed.fields.push({
        name: 'Repository',
        value: data.repository,
        inline: true
      })
    }

    if (data.url) {
      embed.url = data.url
    }

    return embed
  }

  getColorByEventType(eventType) {
    const colors = {
      'task_started': 0x3498db,    // 青
      'task_completed': 0x2ecc71,  // 緑
      'task_failed': 0xe74c3c,     // 赤
      'error': 0xe74c3c,           // 赤
      'warning': 0xf39c12,         // オレンジ
      'info': 0x3498db,            // 青
      'test': 0x9b59b6             // 紫
    }
    return colors[eventType] || 0x95a5a6  // デフォルト: グレー
  }

  async sendWebhook(payload) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.webhookUrl)
      const data = JSON.stringify(payload)

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
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
          if (res.statusCode === 204) {
            resolve({ success: true })
          } else if (res.statusCode === 429) {
            const retryAfter = res.headers['retry-after'] || 5000
            reject(new Error(`レート制限に達しました。${retryAfter}ms後に再試行してください`))
          } else {
            reject(new Error(`Discord API エラー: ${res.statusCode} - ${responseBody}`))
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

module.exports = DiscordProvider