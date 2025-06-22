const { expect } = require('chai');
const sinon = require('sinon');
/**
 * PushoverProviderの単体テスト
 */

const PushoverProvider = require('../src/providers/pushover-provider')
const axios = require('axios')

// axiosのモック
// Mock: axios (manually stub in beforeEach)

// モックロガー
const createMockLogger = () => ({
  info: sandbox.stub(),
  warn: sandbox.stub(),
  error: sandbox.stub(),
  debug: sandbox.stub()
})

describe('PushoverProvider', () => {
  let provider
  let mockLogger
  let mockConfig

  beforeEach(() => {
    // Mocks cleared by sandbox.restore()
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
      expect(provider.getName()).to.equal('Pushover')
      expect(provider.appToken).to.equal('test-app-token')
      expect(provider.userKey).to.equal('test-user-key')
      expect(provider.priority).to.equal(0)
      expect(provider.sound).to.equal('pushover')
      expect(provider.apiUrl).to.equal('https://api.pushover.net/1/messages.json')
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
      
      expect(provider.appToken).to.equal('env-app-token')
      expect(provider.userKey).to.equal('env-user-key')
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
      axios.post.resolves({ 
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
      
      expect(axios.post).to.have.been.calledWith(
        'https://api.pushover.net/1/messages.json',
        sinon.match({
          token: 'test-app-token',
          user: 'test-user-key',
          message: 'テスト完了メッセージ',
          title: 'PoppoBuilder - 処理完了',
          priority: 0,
          sound: 'pushover',
          url: 'https://github.com/test/repo/issues/123',
          url_title: 'Issue #123を開く',
          timestamp: sinon.match.number
        }),
        sinon.match({
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        })
      )
    })

    it('エラー通知は高優先度', async () => {
      axios.post.resolves({ 
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
      expect(payload.title).to.equal('PoppoBuilder - エラー発生')
      expect(payload.priority).to.equal(1) // エラー時は最低でも1
      expect(payload.sound).to.equal('siren') // エラー時の特別な音
    })

    it('高優先度メッセージには再通知設定', async () => {
      provider.priority = 2 // 緊急
      axios.post.resolves({ 
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
      expect(payload.priority).to.equal(2)
      expect(payload.retry).to.equal(60) // 1分ごとに再通知
      expect(payload.expire).to.equal(3600) // 1時間後に期限切れ
    })

    it('長いメッセージは切り詰め', async () => {
      axios.post.resolves({ 
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
      axios.post.resolves({
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
        .resolves({ 
          status: 200,
          data: { status: 1 }
        })
      
      const notification = {
        eventType: 'issue.completed',
        message: 'テスト',
        data: { issueNumber: 123 }
      }
      
      await provider.send(notification)
      
      expect(axios.post).to.have.callCount(3)
      expect(mockLogger.warn).to.have.callCount(2)
    })
  })

  describe('タイトル取得', () => {
    it('各イベントタイプに対応するタイトル', () => {
      expect(provider.getTitle('issue.completed')).to.equal('PoppoBuilder - 処理完了')
      expect(provider.getTitle('issue.error')).to.equal('PoppoBuilder - エラー発生')
      expect(provider.getTitle('issue.timeout')).to.equal('PoppoBuilder - タイムアウト')
      expect(provider.getTitle('dogfooding.restart')).to.equal('PoppoBuilder - 再起動')
      expect(provider.getTitle('unknown.event')).to.equal('PoppoBuilder')
    })
  })

  describe('優先度とサウンド', () => {
    it('通常のイベントは設定値を使用', () => {
      provider.priority = -1
      expect(provider.getPriority('issue.completed')).to.equal(-1)
      expect(provider.getSound('issue.completed')).to.equal('pushover')
    })

    it('エラーイベントは特別な設定', () => {
      provider.priority = -1
      expect(provider.getPriority('issue.error')).to.equal(1) // 最低でも1
      expect(provider.getSound('issue.error')).to.equal('siren')
      
      provider.priority = 2
      expect(provider.getPriority('issue.error')).to.equal(2) // 既に高い場合はそのまま
    })
  })

  describe('メッセージ切り詰め', () => {
    it('短いメッセージはそのまま', () => {
      const message = 'これは短いメッセージです'
      expect(provider.truncateMessage(message, 100)).to.equal(message)
    })

    it('長いメッセージは切り詰めて省略記号を追加', () => {
      const message = 'a'.repeat(100)
      const truncated = provider.truncateMessage(message, 50)
      expect(truncated).toHaveLength(50)
      expect(truncated).toEndWith('...')
      expect(truncated).to.equal('a'.repeat(47) + '...')
    })

    it('境界値でのテスト', () => {
      const message = 'a'.repeat(50)
      expect(provider.truncateMessage(message, 50)).to.equal(message)
      expect(provider.truncateMessage(message, 49)).to.equal('a'.repeat(46) + '...')
    })
  })

  describe('エラーハンドリング', () => {
    it('不正なデータでもクラッシュしない', async () => {
      axios.post.resolves({ 
        status: 200,
        data: { status: 1 }
      })
      
      // データがnull
      await provider.send({
        eventType: 'issue.completed',
        message: 'テスト',
        data: null
      })
      
      expect(axios.post).to.have.been.called
      
      // データが空
      await provider.send({
        eventType: 'issue.completed',
        message: 'テスト',
        data: {}
      })
      
      expect(axios.post).to.have.callCount(2)
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
      axios.post.rejects(networkError)
      
      const notification = {
        eventType: 'issue.completed',
        message: 'テスト',
        data: { issueNumber: 123 }
      }
      
      await expect(provider.send(notification)).rejects.toThrow('ECONNREFUSED')
      expect(mockLogger.warn).to.have.been.called
    })
  })
})