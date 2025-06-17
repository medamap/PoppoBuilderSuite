/**
 * 通知機能の統合テスト
 */

const NotificationManager = require('../src/notification-manager')
const DiscordProvider = require('../src/providers/discord-provider')
const PushoverProvider = require('../src/providers/pushover-provider')
const TelegramProvider = require('../src/providers/telegram-provider')
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

// タイムアウトのモック
const mockSlowProvider = {
  getName: () => 'SlowProvider',
  async validate() {},
  async send() {
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
}

// エラープロバイダーのモック
const mockErrorProvider = {
  getName: () => 'ErrorProvider',
  async validate() {},
  async send() {
    throw new Error('プロバイダーエラー')
  }
}

describe('通知機能統合テスト', () => {
  let manager
  let mockLogger
  let mockConfig

  beforeEach(() => {
    jest.clearAllMocks()
    mockLogger = createMockLogger()
    mockConfig = {
      notifications: {
        enabled: true,
        providers: {
          discord: {
            enabled: true,
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
            username: 'TestBot'
          },
          pushover: {
            enabled: true,
            appToken: 'test-app-token',
            userKey: 'test-user-key'
          },
          telegram: {
            enabled: true,
            botToken: 'test-bot-token',
            chatId: '-1001234567890'
          }
        },
        templates: {
          'issue.completed': 'Issue #{{issueNumber}} completed',
          'issue.error': 'Issue #{{issueNumber}} error: {{error}}'
        },
        options: {
          timeout: 1000,
          includeExecutionTime: true,
          includeLabels: true
        }
      }
    }
  })

  describe('複数プロバイダーへの同時送信', () => {
    it('全プロバイダーに並列で通知送信', async () => {
      // API呼び出しのモック設定
      axios.post.mockImplementation((url) => {
        if (url.includes('discord.com')) {
          return Promise.resolve({ status: 204 })
        } else if (url.includes('pushover.net')) {
          return Promise.resolve({ status: 200, data: { status: 1 } })
        } else if (url.includes('telegram.org')) {
          return Promise.resolve({ status: 200, data: { ok: true, result: { message_id: 123 } } })
        }
      })

      axios.get.mockResolvedValue({
        status: 200,
        data: { ok: true, result: { username: 'test_bot' } }
      })

      manager = new NotificationManager(mockConfig, mockLogger)
      await manager.initialize()

      const startTime = Date.now()
      const result = await manager.notify('issue.completed', {
        issueNumber: 123,
        title: 'テストIssue',
        issueUrl: 'https://github.com/test/repo/issues/123'
      })
      const duration = Date.now() - startTime

      // 結果の検証
      expect(result.sent).toBe(3)
      expect(result.failed).toBe(0)
      expect(result.errors).toHaveLength(0)
      
      // 並列実行の確認（1秒以内に完了）
      expect(duration).toBeLessThan(1500)
      
      // 各プロバイダーが呼ばれたことを確認
      expect(axios.post).toHaveBeenCalledTimes(3)
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('discord.com'),
        expect.any(Object),
        expect.any(Object)
      )
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('pushover.net'),
        expect.any(Object),
        expect.any(Object)
      )
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('telegram.org'),
        expect.any(Object),
        expect.any(Object)
      )
    })

    it('一部のプロバイダーが失敗しても他は送信', async () => {
      // Discordは成功、Pushoverは失敗、Telegramは成功
      axios.post.mockImplementation((url) => {
        if (url.includes('discord.com')) {
          return Promise.resolve({ status: 204 })
        } else if (url.includes('pushover.net')) {
          return Promise.reject(new Error('Pushover API Error'))
        } else if (url.includes('telegram.org')) {
          return Promise.resolve({ status: 200, data: { ok: true, result: { message_id: 123 } } })
        }
      })

      axios.get.mockResolvedValue({
        status: 200,
        data: { ok: true, result: { username: 'test_bot' } }
      })

      manager = new NotificationManager(mockConfig, mockLogger)
      await manager.initialize()

      const result = await manager.notify('issue.error', {
        issueNumber: 456,
        error: 'テストエラー'
      })

      expect(result.sent).toBe(2)
      expect(result.failed).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('Pushover')
      expect(result.providers).toEqual({
        Discord: { success: true },
        Pushover: { success: false, error: 'Pushover API Error' },
        Telegram: { success: true }
      })
    })
  })

  describe('フォールバック機能', () => {
    it('プライマリプロバイダー失敗時に他のプロバイダーで通知', async () => {
      // Discord失敗、他は成功
      axios.post.mockImplementation((url) => {
        if (url.includes('discord.com')) {
          return Promise.reject(new Error('Discord Webhook Error'))
        } else if (url.includes('pushover.net')) {
          return Promise.resolve({ status: 200, data: { status: 1 } })
        } else if (url.includes('telegram.org')) {
          return Promise.resolve({ status: 200, data: { ok: true, result: { message_id: 123 } } })
        }
      })

      axios.get.mockResolvedValue({
        status: 200,
        data: { ok: true, result: { username: 'test_bot' } }
      })

      manager = new NotificationManager(mockConfig, mockLogger)
      await manager.initialize()

      const result = await manager.notify('issue.completed', {
        issueNumber: 789
      })

      // 少なくとも1つは成功
      expect(result.sent).toBeGreaterThan(0)
      expect(result.sent + result.failed).toBe(3)
      
      // エラーログの確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Discord] 通知送信失敗')
      )
    })

    it('全プロバイダー失敗でも処理継続', async () => {
      // 全て失敗
      axios.post.mockRejectedValue(new Error('API Error'))
      axios.get.mockResolvedValue({
        status: 200,
        data: { ok: true, result: { username: 'test_bot' } }
      })

      manager = new NotificationManager(mockConfig, mockLogger)
      await manager.initialize()

      const result = await manager.notify('issue.error', {
        issueNumber: 999,
        error: 'Critical error'
      })

      expect(result.sent).toBe(0)
      expect(result.failed).toBe(3)
      expect(result.errors).toHaveLength(3)
      
      // エラーがあってもクラッシュしない
      expect(mockLogger.error).toHaveBeenCalledTimes(3)
    })
  })

  describe('タイムアウト処理', () => {
    it('タイムアウトしたプロバイダーをスキップ', async () => {
      // カスタムプロバイダーを追加
      manager = new NotificationManager(mockConfig, mockLogger)
      manager.registerProvider(mockSlowProvider)
      
      // 通常のプロバイダーも追加
      const fastProvider = {
        getName: () => 'FastProvider',
        async validate() {},
        async send() { return { success: true } }
      }
      manager.registerProvider(fastProvider)
      
      await manager.initialize()

      const startTime = Date.now()
      const result = await manager.notify('issue.completed', {
        issueNumber: 123
      })
      const duration = Date.now() - startTime

      // タイムアウトは1秒なので、2秒待たずに完了
      expect(duration).toBeLessThan(1500)
      expect(result.sent).toBe(1) // FastProviderのみ成功
      expect(result.failed).toBe(1) // SlowProviderはタイムアウト
      expect(result.errors[0]).toContain('Timeout')
    })

    it('複数プロバイダーでタイムアウトが混在', async () => {
      manager = new NotificationManager(mockConfig, mockLogger)
      
      // 速いプロバイダー
      const fastProvider1 = {
        getName: () => 'Fast1',
        async validate() {},
        async send() { 
          await new Promise(resolve => setTimeout(resolve, 100))
          return { success: true }
        }
      }
      
      // 遅いプロバイダー
      const slowProvider1 = {
        getName: () => 'Slow1',
        async validate() {},
        async send() {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }
      
      // 速いプロバイダー2
      const fastProvider2 = {
        getName: () => 'Fast2',
        async validate() {},
        async send() {
          await new Promise(resolve => setTimeout(resolve, 200))
          return { success: true }
        }
      }
      
      manager.registerProvider(fastProvider1)
      manager.registerProvider(slowProvider1)
      manager.registerProvider(fastProvider2)
      await manager.initialize()

      const result = await manager.notify('issue.completed', {
        issueNumber: 456
      })

      expect(result.sent).toBe(2) // Fast1とFast2
      expect(result.failed).toBe(1) // Slow1
      expect(result.providers.Slow1.error).toContain('Timeout')
    })
  })

  describe('レート制限対応', () => {
    it('レート制限エラーでリトライ', async () => {
      let callCount = 0
      axios.post.mockImplementation(() => {
        callCount++
        if (callCount <= 2) {
          const error = new Error('Rate limit exceeded')
          error.response = { status: 429 }
          return Promise.reject(error)
        }
        return Promise.resolve({ status: 204 })
      })

      // Discordプロバイダーのみでテスト
      const discordConfig = {
        notifications: {
          enabled: true,
          providers: {
            discord: {
              enabled: true,
              webhookUrl: 'https://discord.com/api/webhooks/123/abc',
              maxRetries: 3,
              retryDelay: 100
            }
          },
          templates: mockConfig.notifications.templates,
          options: mockConfig.notifications.options
        }
      }

      manager = new NotificationManager(discordConfig, mockLogger)
      await manager.initialize()

      const result = await manager.notify('issue.completed', {
        issueNumber: 789
      })

      expect(result.sent).toBe(1)
      expect(callCount).toBe(3) // 初回 + 2回リトライ後に成功
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('リトライ')
      )
    })

    it('指数バックオフでリトライ間隔が増加', async () => {
      const retryTimes = []
      let lastCallTime = Date.now()
      
      axios.post.mockImplementation(() => {
        const currentTime = Date.now()
        retryTimes.push(currentTime - lastCallTime)
        lastCallTime = currentTime
        
        if (retryTimes.length < 3) {
          return Promise.reject(new Error('Temporary error'))
        }
        return Promise.resolve({ status: 204 })
      })

      const discordConfig = {
        notifications: {
          enabled: true,
          providers: {
            discord: {
              enabled: true,
              webhookUrl: 'https://discord.com/api/webhooks/123/abc',
              maxRetries: 3,
              retryDelay: 100
            }
          },
          templates: mockConfig.notifications.templates,
          options: mockConfig.notifications.options
        }
      }

      manager = new NotificationManager(discordConfig, mockLogger)
      await manager.initialize()

      await manager.notify('issue.completed', {
        issueNumber: 999
      })

      // 指数バックオフの確認
      expect(retryTimes[1]).toBeGreaterThanOrEqual(100) // 1回目: 100ms
      expect(retryTimes[2]).toBeGreaterThanOrEqual(200) // 2回目: 200ms
    })
  })

  describe('エラーハンドリング', () => {
    it('プロバイダー初期化エラーを処理', async () => {
      // 無効なTelegram Bot Token
      axios.get.mockResolvedValue({
        status: 401,
        data: { ok: false }
      })

      manager = new NotificationManager(mockConfig, mockLogger)
      await manager.initialize()

      // Telegramは初期化失敗でも他のプロバイダーは有効
      expect(manager.providers.size).toBeGreaterThan(0)
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('プロバイダー検証エラー')
      )
    })

    it('不正なテンプレートでもクラッシュしない', async () => {
      mockConfig.notifications.templates = null
      
      axios.post.mockResolvedValue({ status: 204 })
      axios.get.mockResolvedValue({
        status: 200,
        data: { ok: true, result: { username: 'test_bot' } }
      })

      manager = new NotificationManager(mockConfig, mockLogger)
      await manager.initialize()

      const result = await manager.notify('unknown.event', {
        issueNumber: 123
      })

      // テンプレートがなくても送信は成功
      expect(result.sent).toBeGreaterThan(0)
    })

    it('プロバイダーが例外をスローしても他のプロバイダーは継続', async () => {
      manager = new NotificationManager(mockConfig, mockLogger)
      
      // エラーをスローするプロバイダー
      manager.registerProvider(mockErrorProvider)
      
      // 正常なプロバイダー
      const normalProvider = {
        getName: () => 'NormalProvider',
        async validate() {},
        async send() { return { success: true } }
      }
      manager.registerProvider(normalProvider)
      
      await manager.initialize()

      const result = await manager.notify('issue.completed', {
        issueNumber: 456
      })

      expect(result.sent).toBe(1) // NormalProviderは成功
      expect(result.failed).toBe(1) // ErrorProviderは失敗
      expect(result.errors[0]).toContain('プロバイダーエラー')
    })
  })

  describe('パフォーマンステスト', () => {
    it('多数のプロバイダーでも並列処理で高速', async () => {
      manager = new NotificationManager(mockConfig, mockLogger)
      
      // 10個のプロバイダーを追加
      for (let i = 0; i < 10; i++) {
        const provider = {
          getName: () => `Provider${i}`,
          async validate() {},
          async send() {
            await new Promise(resolve => setTimeout(resolve, 200))
            return { success: true }
          }
        }
        manager.registerProvider(provider)
      }
      
      await manager.initialize()

      const startTime = Date.now()
      const result = await manager.notify('issue.completed', {
        issueNumber: 789
      })
      const duration = Date.now() - startTime

      expect(result.sent).toBe(10)
      // 並列処理なので、200ms * 10 = 2000msより大幅に短い
      expect(duration).toBeLessThan(500)
    })
  })

  describe('実際の使用シナリオ', () => {
    it('Issue処理完了の通知フロー', async () => {
      axios.post.mockResolvedValue({ status: 204 })
      axios.get.mockResolvedValue({
        status: 200,
        data: { ok: true, result: { username: 'test_bot' } }
      })

      manager = new NotificationManager(mockConfig, mockLogger)
      await manager.initialize()

      // PoppoBuilderがIssue処理を完了
      const issueData = {
        issueNumber: 1234,
        title: 'Add new feature',
        labels: ['enhancement', 'reviewed'],
        executionTime: 300000, // 5分
        issueUrl: 'https://github.com/medamap/PoppoBuilderSuite/issues/1234'
      }

      const result = await manager.notify('issue.completed', issueData)

      expect(result.sent).toBeGreaterThan(0)
      
      // 送信されたメッセージの確認
      const discordCall = axios.post.mock.calls.find(call => 
        call[0].includes('discord.com')
      )
      expect(discordCall).toBeDefined()
      
      const discordPayload = discordCall[1]
      expect(discordPayload.embeds[0].fields).toContainEqual(
        expect.objectContaining({
          name: '実行時間',
          value: expect.any(String)
        })
      )
    })

    it('エラー発生時の緊急通知フロー', async () => {
      axios.post.mockResolvedValue({ status: 204 })
      axios.get.mockResolvedValue({
        status: 200,
        data: { ok: true, result: { username: 'test_bot' } }
      })

      manager = new NotificationManager(mockConfig, mockLogger)
      await manager.initialize()

      // PoppoBuilderでエラー発生
      const errorData = {
        issueNumber: 5678,
        title: 'Fix critical bug',
        error: 'Failed to connect to Claude API: Rate limit exceeded',
        issueUrl: 'https://github.com/medamap/PoppoBuilderSuite/issues/5678'
      }

      const result = await manager.notify('issue.error', errorData)

      expect(result.sent).toBeGreaterThan(0)
      
      // Discordでメンション付き
      const discordCall = axios.post.mock.calls.find(call => 
        call[0].includes('discord.com')
      )
      const discordPayload = discordCall[1]
      expect(discordPayload.content).toContain('@everyone')
    })
  })
})