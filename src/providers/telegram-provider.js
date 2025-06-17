const axios = require('axios')
const NotificationProvider = require('./notification-provider')

class TelegramProvider extends NotificationProvider {
  constructor(config, logger) {
    super('Telegram', config, logger)
    this.botToken = this.resolveEnvVar(config.botToken)
    this.chatId = this.resolveEnvVar(config.chatId)
    this.parseMode = config.parseMode || 'Markdown'
    this.disableNotification = config.disableNotification || false
    this.apiBaseUrl = `https://api.telegram.org/bot${this.botToken}`
  }

  async validate() {
    if (!this.botToken) {
      throw new Error('Telegram Bot Tokenが設定されていません')
    }
    
    if (!this.chatId) {
      throw new Error('Telegram Chat IDが設定されていません')
    }

    // Bot情報の取得でトークンの有効性を確認
    try {
      const response = await axios.get(`${this.apiBaseUrl}/getMe`)
      if (!response.data.ok) {
        throw new Error('無効なBot Tokenです')
      }
      this.logger.info(`[Telegram] Bot名: ${response.data.result.username}`)
    } catch (error) {
      throw new Error(`Telegram Bot Token検証エラー: ${error.message}`)
    }
  }

  async send(notification) {
    const { eventType, message, data } = notification
    
    const text = this.formatMessage(eventType, message, data)
    const keyboard = this.buildKeyboard(data)
    
    const payload = {
      chat_id: this.chatId,
      text: this.truncateMessage(text, 4096),
      parse_mode: this.parseMode,
      disable_notification: this.disableNotification
    }

    if (keyboard) {
      payload.reply_markup = keyboard
    }

    const response = await this.retry(() => 
      axios.post(`${this.apiBaseUrl}/sendMessage`, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      })
    )

    if (!response.data.ok) {
      throw new Error(`Telegram API error: ${response.data.description}`)
    }
  }

  formatMessage(eventType, message, data) {
    const icon = this.getIcon(eventType)
    let formatted = `${icon} *${this.getTitle(eventType, data)}*\n\n`
    
    // メッセージ本文
    formatted += message + '\n'
    
    // 追加情報
    if (data && data.executionTime) {
      formatted += `\n⏱ 実行時間: ${this.formatTime(data.executionTime)}`
    }
    
    if (data && data.labels && data.labels.length > 0) {
      formatted += `\n🏷 ラベル: ${data.labels.map(l => `\`${l}\``).join(', ')}`
    }
    
    return formatted
  }

  buildKeyboard(data) {
    if (!data || !data.issueUrl) return null
    
    return {
      inline_keyboard: [[
        {
          text: `📋 Issue #${data.issueNumber}を開く`,
          url: data.issueUrl
        }
      ]]
    }
  }

  getIcon(eventType) {
    const icons = {
      'issue.completed': '✅',
      'issue.error': '❌',
      'issue.timeout': '⏱️',
      'dogfooding.restart': '🔄'
    }
    return icons[eventType] || '📌'
  }

  getTitle(eventType, data) {
    const titles = {
      'issue.completed': `Issue #${data?.issueNumber} 処理完了`,
      'issue.error': `Issue #${data?.issueNumber} エラー発生`,
      'issue.timeout': `Issue #${data?.issueNumber} タイムアウト`,
      'dogfooding.restart': 'PoppoBuilder 再起動'
    }
    return titles[eventType] || `Issue #${data?.issueNumber || '?'}`
  }

  formatTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    
    if (hours > 0) {
      return `${hours}時間${minutes % 60}分`
    } else if (minutes > 0) {
      return `${minutes}分${seconds % 60}秒`
    }
    return `${seconds}秒`
  }

  truncateMessage(message, maxLength) {
    if (message.length <= maxLength) {
      return message
    }
    return message.substring(0, maxLength - 3) + '...'
  }
}

module.exports = TelegramProvider