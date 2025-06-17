/**
 * PushoverProviderの単体テスト
 */

const PushoverProvider = require('../src/providers/pushover-provider')
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

describe('PushoverProvider', () => {
  let provider
  let mockLogger
  let mockConfig

  beforeEach(() => {
    jest.clearAllMocks()
    mockLogger = createMockLogger()
    mockConfig = {
      enabled: true,
      appToken: 'test-app-token',
      userKey: 'test-user-key',
      priority: 0,
      sound: 'pushover'
    }
    provider = new PushoverProvider(mockConfig, mockLogger)
  })

  describe('初期化と検証', () => {
    it('正しい設定で初期化', () => {
      expect(provider.getName()).toBe('Pushover')
      expect(provider.appToken).toBe('test-app-token')
      expect(provider.userKey).toBe('test-user-key')
      expect(provider.priority).toBe(0)
      expect(provider.sound).toBe('pushover')
      expect(provider.apiUrl).toBe('https://api.pushover.net/1/messages.json')
    })

    it('環境変数から認証情報を解決', () => {
      process.env.PUSHOVER_APP = 'env-app-token'
      process.env.PUSHOVER_USER = 'env-user-key'
      const config = {
        ...mockConfig,
        appToken: '${PUSHOVER_APP}',
        userKey: '${PUSHOVER_USER}'
      }
      const provider = new PushoverProvider(config, mockLogger)
      
      expect(provider.appToken).toBe('env-app-token')
      expect(provider.userKey).toBe('env-user-key')
      delete process.env.PUSHOVER_APP
      delete process.env.PUSHOVER_USER
    })

    it('appTokenが未設定の場合エラー', async () => {
      provider.appToken = null
      
      await expect(provider.validate()).rejects.toThrow('Pushover App Tokenが設定されていません')
    })

    it('userKeyが未設定の場合エラー', async () => {
      provider.userKey = null
      
      await expect(provider.validate()).rejects.toThrow('Pushover User Keyが設定されていません')
    })

    it('priorityが範囲外の場合エラー', async () => {
      provider.priority = 3
      
      await expect(provider.validate()).rejects.toThrow('Pushover priorityは-2から2の範囲で設定してください')
      
      provider.priority = -3
      await expect(provider.validate()).rejects.toThrow('Pushover priorityは-2から2の範囲で設定してください')
    })

    it('有効な設定の場合成功', async () => {
      await expect(provider.validate()).resolves.not.toThrow()
    })
  })

  describe('メッセージ送信', () => {
    it('基本的な通知を送信', async () => {
      axios.post.mockResolvedValue({ 
        status: 200,
        data: { status: 1 }
      })
      
      const notification = {
        eventType: 'issue.completed',
        message: 'テスト完了メッセージ',
        data: {
          issueNumber: 123,
          title: 'テストIssue',
          issueUrl: 'https://github.com/test/repo/issues/123'
        },
        timestamp: new Date().toISOString()
      }
      
      await provider.send(notification)
      
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.pushover.net/1/messages.json',
        expect.objectContaining({
          token: 'test-app-token',
          user: 'test-user-key',
          message: 'テスト完了メッセージ',
          title: 'PoppoBuilder - 処理完了',
          priority: 0,
          sound: 'pushover',
          url: 'https://github.com/test/repo/issues/123',
          url_title: 'Issue #123を開く',
          timestamp: expect.any(Number)
        }),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        })
      )
    })

    it('エラー通知は高優先度', async () => {
      axios.post.mockResolvedValue({ 
        status: 200,
        data: { status: 1 }
      })
      
      const notification = {
        eventType: 'issue.error',
        message: 'エラーが発生しました',
        data: {
          issueNumber: 456,
          error: 'API rate limit exceeded'
        }
      }
      
      await provider.send(notification)
      
      const payload = axios.post.mock.calls[0][1]
      expect(payload.title).toBe('PoppoBuilder - エラー発生')
      expect(payload.priority).toBe(1) // エラー時は最低でも1
      expect(payload.sound).toBe('siren') // エラー時の特別な音
    })

    it('高優先度メッセージには再通知設定', async () => {
      provider.priority = 2 // 緊急
      axios.post.mockResolvedValue({ 
        status: 200,
        data: { status: 1 }
      })
      
      const notification = {
        eventType: 'issue.error',
        message: 'エラー',
        data: { issueNumber: 789 }
      }
      
      await provider.send(notification)
      
      const payload = axios.post.mock.calls[0][1]
      expect(payload.priority).toBe(2)
      expect(payload.retry).toBe(60) // 1分ごとに再通知
      expect(payload.expire).toBe(3600) // 1時間後に期限切れ
    })

    it('長いメッセージは切り詰め', async () => {
      axios.post.mockResolvedValue({ 
        status: 200,
        data: { status: 1 }
      })
      
      const longMessage = 'a'.repeat(1025) // 1024文字を超える
      const notification = {
        eventType: 'issue.completed',
        message: longMessage,
        data: { issueNumber: 123 }
      }
      
      await provider.send(notification)
      
      const payload = axios.post.mock.calls[0][1]
      expect(payload.message).toHaveLength(1024)
      expect(payload.message).toEndWith('...')
    })

    it('APIエラーの場合例外をスロー', async () => {
      axios.post.mockResolvedValue({
        status: 200,
        data: { 
          status: 0,
          errors: ['invalid token']
        }
      })
      
      const notification = {
        eventType: 'issue.completed',
        message: 'テスト',
        data: { issueNumber: 123 }
      }
      
      await expect(provider.send(notification)).rejects.toThrow('Pushover API error: ["invalid token"]')
    })

    it('リトライ機能が動作', async () => {
      axios.post
        .mockRejectedValueOnce(new Error('一時的なエラー'))
        .mockRejectedValueOnce(new Error('一時的なエラー'))
        .mockResolvedValue({ 
          status: 200,
          data: { status: 1 }
        })
      
      const notification = {
        eventType: 'issue.completed',
        message: 'テスト',
        data: { issueNumber: 123 }
      }
      
      await provider.send(notification)
      
      expect(axios.post).toHaveBeenCalledTimes(3)
      expect(mockLogger.warn).toHaveBeenCalledTimes(2)
    })
  })

  describe('タイトル取得', () => {
    it('各イベントタイプに対応するタイトル', () => {
      expect(provider.getTitle('issue.completed')).toBe('PoppoBuilder - 処理完了')
      expect(provider.getTitle('issue.error')).toBe('PoppoBuilder - エラー発生')
      expect(provider.getTitle('issue.timeout')).toBe('PoppoBuilder - タイムアウト')
      expect(provider.getTitle('dogfooding.restart')).toBe('PoppoBuilder - 再起動')
      expect(provider.getTitle('unknown.event')).toBe('PoppoBuilder')
    })
  })

  describe('優先度とサウンド', () => {
    it('通常のイベントは設定値を使用', () => {
      provider.priority = -1
      expect(provider.getPriority('issue.completed')).toBe(-1)
      expect(provider.getSound('issue.completed')).toBe('pushover')
    })

    it('エラーイベントは特別な設定', () => {
      provider.priority = -1
      expect(provider.getPriority('issue.error')).toBe(1) // 最低でも1
      expect(provider.getSound('issue.error')).toBe('siren')
      
      provider.priority = 2
      expect(provider.getPriority('issue.error')).toBe(2) // 既に高い場合はそのまま
    })
  })

  describe('メッセージ切り詰め', () => {
    it('短いメッセージはそのまま', () => {
      const message = 'これは短いメッセージです'
      expect(provider.truncateMessage(message, 100)).toBe(message)
    })

    it('長いメッセージは切り詰めて省略記号を追加', () => {
      const message = 'a'.repeat(100)
      const truncated = provider.truncateMessage(message, 50)
      expect(truncated).toHaveLength(50)
      expect(truncated).toEndWith('...')
      expect(truncated).toBe('a'.repeat(47) + '...')
    })

    it('境界値でのテスト', () => {
      const message = 'a'.repeat(50)
      expect(provider.truncateMessage(message, 50)).toBe(message)
      expect(provider.truncateMessage(message, 49)).toBe('a'.repeat(46) + '...')
    })
  })

  describe('エラーハンドリング', () => {
    it('不正なデータでもクラッシュしない', async () => {
      axios.post.mockResolvedValue({ 
        status: 200,
        data: { status: 1 }
      })
      
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

    it('環境変数が設定されていない場合のエラー', () => {
      const config = {
        ...mockConfig,
        appToken: '${NONEXISTENT_VAR}'
      }
      
      expect(() => new PushoverProvider(config, mockLogger))
        .toThrow('環境変数 NONEXISTENT_VAR が設定されていません')
    })

    it('ネットワークエラーの詳細をログ出力', async () => {
      const networkError = new Error('ECONNREFUSED')
      networkError.code = 'ECONNREFUSED'
      axios.post.mockRejectedValue(networkError)
      
      const notification = {
        eventType: 'issue.completed',
        message: 'テスト',
        data: { issueNumber: 123 }
      }
      
      await expect(provider.send(notification)).rejects.toThrow('ECONNREFUSED')
      expect(mockLogger.warn).toHaveBeenCalled()
    })
  })
})