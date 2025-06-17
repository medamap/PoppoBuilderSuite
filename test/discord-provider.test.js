/**
 * DiscordProviderの単体テスト
 */

const DiscordProvider = require('../src/providers/discord-provider')
const axios = require('axios')

// axiosのモック
jest.mock('axios')

// モックロガー
const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
})

describe('DiscordProvider', () => {
  let provider
  let mockLogger
  let mockConfig

  beforeEach(() => {
    jest.clearAllMocks()
    mockLogger = createMockLogger()
    mockConfig = {
      enabled: true,
      webhookUrl: 'https://discord.com/api/webhooks/123456/abcdef',
      username: 'TestBot',
      avatarUrl: 'https://example.com/avatar.png',
      mentions: {
        error: true,
        success: false
      }
    }
    provider = new DiscordProvider(mockConfig, mockLogger)
  })

  describe('初期化と検証', () => {
    it('正しい設定で初期化', () => {
      expect(provider.getName()).toBe('Discord')
      expect(provider.webhookUrl).toBe(mockConfig.webhookUrl)
      expect(provider.username).toBe(mockConfig.username)
      expect(provider.avatarUrl).toBe(mockConfig.avatarUrl)
    })

    it('環境変数からwebhookUrlを解決', () => {
      process.env.TEST_WEBHOOK = 'https://discord.com/api/webhooks/999/xyz'
      const config = {
        ...mockConfig,
        webhookUrl: '${TEST_WEBHOOK}'
      }
      const provider = new DiscordProvider(config, mockLogger)
      
      expect(provider.webhookUrl).toBe('https://discord.com/api/webhooks/999/xyz')
      delete process.env.TEST_WEBHOOK
    })

    it('webhookUrlが未設定の場合エラー', async () => {
      provider.webhookUrl = null
      
      await expect(provider.validate()).rejects.toThrow('Discord Webhook URLが設定されていません')
    })

    it('無効なwebhookUrlの場合エラー', async () => {
      provider.webhookUrl = 'https://invalid.com/webhook'
      
      await expect(provider.validate()).rejects.toThrow('無効なDiscord Webhook URLです')
    })

    it('有効なwebhookUrlの場合成功', async () => {
      await expect(provider.validate()).resolves.not.toThrow()
    })
  })

  describe('メッセージ送信', () => {
    it('基本的な通知を送信', async () => {
      axios.post.mockResolvedValue({ status: 204 })
      
      const notification = {
        eventType: 'issue.completed',
        message: 'テスト完了',
        data: {
          issueNumber: 123,
          title: 'テストIssue',
          issueUrl: 'https://github.com/test/repo/issues/123'
        },
        timestamp: new Date().toISOString()
      }
      
      await provider.send(notification)
      
      expect(axios.post).toHaveBeenCalledWith(
        provider.webhookUrl,
        expect.objectContaining({
          username: 'TestBot',
          avatar_url: provider.avatarUrl,
          embeds: expect.any(Array)
        }),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        })
      )
    })

    it('エラー通知でメンション付き', async () => {
      axios.post.mockResolvedValue({ status: 204 })
      
      const notification = {
        eventType: 'issue.error',
        message: 'エラー発生',
        data: { issueNumber: 123 }
      }
      
      await provider.send(notification)
      
      const payload = axios.post.mock.calls[0][1]
      expect(payload.content).toBe('@everyone エラーが発生しました')
    })

    it('成功通知でメンションなし', async () => {
      axios.post.mockResolvedValue({ status: 204 })
      
      const notification = {
        eventType: 'issue.completed',
        message: '処理完了',
        data: { issueNumber: 123 }
      }
      
      await provider.send(notification)
      
      const payload = axios.post.mock.calls[0][1]
      expect(payload.content).toBeNull()
    })

    it('リトライ機能が動作', async () => {
      axios.post
        .mockRejectedValueOnce(new Error('一時的なエラー'))
        .mockRejectedValueOnce(new Error('一時的なエラー'))
        .mockResolvedValue({ status: 204 })
      
      const notification = {
        eventType: 'issue.completed',
        message: 'テスト',
        data: { issueNumber: 123 }
      }
      
      await provider.send(notification)
      
      expect(axios.post).toHaveBeenCalledTimes(3)
      expect(mockLogger.warn).toHaveBeenCalledTimes(2)
    })

    it('リトライ上限に達した場合エラー', async () => {
      axios.post.mockRejectedValue(new Error('永続的なエラー'))
      
      const notification = {
        eventType: 'issue.completed',
        message: 'テスト',
        data: { issueNumber: 123 }
      }
      
      await expect(provider.send(notification)).rejects.toThrow('永続的なエラー')
      expect(axios.post).toHaveBeenCalledTimes(4) // 初回 + 3回リトライ
    })
  })

  describe('Embed構築', () => {
    it('完了通知のEmbed', () => {
      const notification = {
        eventType: 'issue.completed',
        message: '処理が完了しました',
        data: {
          issueNumber: 123,
          issueUrl: 'https://github.com/test/repo/issues/123',
          executionTime: 125000, // 2分5秒
          labels: ['enhancement', 'tested']
        },
        timestamp: '2025-06-17T10:00:00Z'
      }
      
      const embed = provider.buildEmbed(notification)
      
      expect(embed.title).toBe('✅ Issue #123 処理完了')
      expect(embed.color).toBe(0x57F287) // 緑
      expect(embed.description).toBe('処理が完了しました')
      expect(embed.timestamp).toBe('2025-06-17T10:00:00Z')
      expect(embed.fields).toHaveLength(3)
      
      const timeField = embed.fields.find(f => f.name === '実行時間')
      expect(timeField.value).toBe('2分5秒')
      
      const labelField = embed.fields.find(f => f.name === 'ラベル')
      expect(labelField.value).toBe('enhancement, tested')
      
      const urlField = embed.fields.find(f => f.name === 'Issue')
      expect(urlField.value).toBe('[#123](https://github.com/test/repo/issues/123)')
    })

    it('エラー通知のEmbed', () => {
      const notification = {
        eventType: 'issue.error',
        message: 'エラーが発生しました',
        data: {
          issueNumber: 456,
          error: 'API rate limit exceeded'
        }
      }
      
      const embed = provider.buildEmbed(notification)
      
      expect(embed.title).toBe('❌ Issue #456 エラー')
      expect(embed.color).toBe(0xED4245) // 赤
      expect(embed.description).toBe('エラーが発生しました')
    })

    it('タイムアウト通知のEmbed', () => {
      const notification = {
        eventType: 'issue.timeout',
        message: 'タイムアウトしました',
        data: { issueNumber: 789 }
      }
      
      const embed = provider.buildEmbed(notification)
      
      expect(embed.title).toBe('⏱️ Issue #789 タイムアウト')
      expect(embed.color).toBe(0xFEE75C) // 黄
    })

    it('再起動通知のEmbed', () => {
      const notification = {
        eventType: 'dogfooding.restart',
        message: 'PoppoBuilder再起動',
        data: {}
      }
      
      const embed = provider.buildEmbed(notification)
      
      expect(embed.title).toBe('🔄 PoppoBuilder 再起動')
      expect(embed.color).toBe(0x5865F2) // 紫
    })

    it('未知のイベントタイプ', () => {
      const notification = {
        eventType: 'unknown.event',
        message: '未知のイベント',
        data: { issueNumber: 999 }
      }
      
      const embed = provider.buildEmbed(notification)
      
      expect(embed.title).toBe('Issue #999')
      expect(embed.color).toBe(0x99AAB5) // グレー
    })
  })

  describe('時間フォーマット', () => {
    it('秒のみの表示', () => {
      expect(provider.formatTime(45000)).toBe('45秒')
    })

    it('分と秒の表示', () => {
      expect(provider.formatTime(125000)).toBe('2分5秒')
    })

    it('ちょうど1分', () => {
      expect(provider.formatTime(60000)).toBe('1分0秒')
    })

    it('1時間以上', () => {
      expect(provider.formatTime(3665000)).toBe('61分5秒')
    })
  })

  describe('エラーハンドリング', () => {
    it('不正なデータでもクラッシュしない', async () => {
      axios.post.mockResolvedValue({ status: 204 })
      
      // データがnull
      await provider.send({
        eventType: 'issue.completed',
        message: 'テスト',
        data: null
      })
      
      expect(axios.post).toHaveBeenCalled()
      
      // データが空
      await provider.send({
        eventType: 'issue.completed',
        message: 'テスト',
        data: {}
      })
      
      expect(axios.post).toHaveBeenCalledTimes(2)
    })

    it('axiosエラーの詳細をログ出力', async () => {
      const axiosError = new Error('Network Error')
      axiosError.response = {
        status: 400,
        data: { message: 'Invalid webhook' }
      }
      axios.post.mockRejectedValue(axiosError)
      
      const notification = {
        eventType: 'issue.completed',
        message: 'テスト',
        data: { issueNumber: 123 }
      }
      
      await expect(provider.send(notification)).rejects.toThrow()
      expect(mockLogger.warn).toHaveBeenCalled()
    })
  })
})