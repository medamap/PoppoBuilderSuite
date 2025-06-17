const axios = require('axios')
const NotificationProvider = require('./notification-provider')

/**
 * Discord通知プロバイダ
 */
class DiscordProvider extends NotificationProvider {
  constructor(config, logger) {
    super('Discord', config, logger)
    this.webhookUrl = this.resolveEnvVar(config.webhookUrl)
    this.username = config.username || 'PoppoBuilder'
    this.avatarUrl = config.avatarUrl
    this.mentions = config.mentions || {}
  }

  async validate() {
    if (!this.webhookUrl) {
      throw new Error('Discord Webhook URLが設定されていません')
    }
    
    if (!this.webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
      throw new Error('無効なDiscord Webhook URLです')
    }
  }

  async send(notification) {
    const embed = this.buildEmbed(notification)
    const content = this.buildContent(notification)
    
    const payload = {
      username: this.username,
      avatar_url: this.avatarUrl,
      content: content,
      embeds: [embed]
    }

    await this.retry(() => 
      axios.post(this.webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      })
    )
  }

  buildContent(notification) {
    const { eventType } = notification
    
    // メンション設定に基づいてコンテンツを構築
    if (eventType === 'issue.error' && this.mentions.error) {
      return '@everyone エラーが発生しました'
    } else if (eventType === 'issue.completed' && this.mentions.success) {
      return '@here 処理が完了しました'
    }
    
    return null
  }

  buildEmbed(notification) {
    const { eventType, data, timestamp } = notification
    const color = this.getColorByEventType(eventType)
    
    const embed = {
      title: this.getEmbedTitle(eventType, data),
      description: notification.message,
      color: color,
      timestamp: timestamp,
      fields: []
    }

    // 実行時間フィールド
    if (data && data.executionTime) {
      embed.fields.push({
        name: '実行時間',
        value: this.formatTime(data.executionTime),
        inline: true
      })
    }

    // ラベルフィールド
    if (data && data.labels && data.labels.length > 0) {
      embed.fields.push({
        name: 'ラベル',
        value: data.labels.join(', '),
        inline: true
      })
    }

    // URLフィールド
    if (data && data.issueUrl) {
      embed.fields.push({
        name: 'Issue',
        value: `[#${data.issueNumber}](${data.issueUrl})`,
        inline: true
      })
    }

    return embed
  }

  getColorByEventType(eventType) {
    const colors = {
      'issue.completed': 0x57F287,  // 緑
      'issue.error': 0xED4245,      // 赤
      'issue.timeout': 0xFEE75C,    // 黄
      'dogfooding.restart': 0x5865F2 // 紫
    }
    return colors[eventType] || 0x99AAB5 // デフォルト: グレー
  }

  getEmbedTitle(eventType, data) {
    const titles = {
      'issue.completed': `✅ Issue #${data?.issueNumber} 処理完了`,
      'issue.error': `❌ Issue #${data?.issueNumber} エラー`,
      'issue.timeout': `⏱️ Issue #${data?.issueNumber} タイムアウト`,
      'dogfooding.restart': '🔄 PoppoBuilder 再起動'
    }
    return titles[eventType] || `Issue #${data?.issueNumber || '?'}`
  }

  formatTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000)
    const minutes = Math.floor(seconds / 60)
    
    if (minutes > 0) {
      return `${minutes}分${seconds % 60}秒`
    }
    return `${seconds}秒`
  }
}

module.exports = DiscordProvider