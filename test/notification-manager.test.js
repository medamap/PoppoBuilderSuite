/**
 * NotificationManagerの単体テスト
 */

const NotificationManager = require('../src/notification-manager')
const { Logger } = require('../src/logger')

// モックロガー
const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
})

// モックプロバイダー
class MockProvider {
  constructor(name, shouldFail = false) {
    this.name = name
    this.shouldFail = shouldFail
    this.sendCalled = 0
    this.validateCalled = 0
  }

  getName() {
    return this.name
  }

  async validate() {
    this.validateCalled++
    if (this.shouldFail) {
      throw new Error(`${this.name} validation failed`)
    }
  }

  async send(notification) {
    this.sendCalled++
    if (this.shouldFail) {
      throw new Error(`${this.name} send failed`)
    }
    return { success: true }
  }
}

describe('NotificationManager', () => {
  let manager
  let mockLogger
  let mockConfig

  beforeEach(() => {
    mockLogger = createMockLogger()
    mockConfig = {
      notifications: {
        enabled: true,
        providers: {},
        templates: {
          'issue.completed': 'Issue #{{issueNumber}} completed: {{title}}',
          'issue.error': 'Issue #{{issueNumber}} error: {{error}}'
        },
        options: {
          timeout: 1000,
          includeExecutionTime: true,
          includeLabels: true
        }
      }
    }
    manager = new NotificationManager(mockConfig, mockLogger)
  })

  describe('初期化', () => {
    it('通知が無効の場合は初期化をスキップ', async () => {
      mockConfig.notifications.enabled = false
      await manager.initialize()
      
      expect(manager.initialized).toBe(false)
      expect(mockLogger.info).toHaveBeenCalledWith('[NotificationManager] 通知機能は無効です')
    })

    it('プロバイダーなしで初期化', async () => {
      await manager.initialize()
      
      expect(manager.initialized).toBe(true)
      expect(manager.providers.size).toBe(0)
    })

    it('プロバイダーを登録して初期化', async () => {
      const provider = new MockProvider('TestProvider')
      manager.registerProvider(provider)
      
      await manager.initialize()
      
      expect(manager.providers.has('TestProvider')).toBe(true)
      expect(provider.validateCalled).toBe(1)
    })

    it('検証失敗のプロバイダーはエラーログを出力', async () => {
      const provider = new MockProvider('FailProvider', true)
      manager.registerProvider(provider)
      
      await manager.initialize()
      
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('メッセージフォーマット', () => {
    it('基本的なプレースホルダーを置換', () => {
      const template = 'Issue #{{issueNumber}} - {{title}}'
      const data = { issueNumber: 123, title: 'テストタイトル' }
      
      const result = manager.formatMessage(template, data)
      
      expect(result).toBe('Issue #123 - テストタイトル')
    })

    it('実行時間をフォーマット', () => {
      const template = '実行時間: {{executionTime}}'
      const data = { executionTime: 125000 } // 2分5秒
      
      const result = manager.formatMessage(template, data)
      
      expect(result).toBe('実行時間: 2分5秒')
    })

    it('1時間以上の実行時間をフォーマット', () => {
      const template = '実行時間: {{executionTime}}'
      const data = { executionTime: 3665000 } // 1時間1分5秒
      
      const result = manager.formatMessage(template, data)
      
      expect(result).toBe('実行時間: 1時間1分5秒')
    })

    it('ラベルをフォーマット', () => {
      const template = 'ラベル: {{labels}}'
      const data = { labels: ['bug', 'high-priority'] }
      
      const result = manager.formatMessage(template, data)
      
      expect(result).toBe('ラベル: bug, high-priority')
    })

    it('存在しないプレースホルダーは空文字に置換', () => {
      const template = 'Issue #{{issueNumber}} - {{nonexistent}}'
      const data = { issueNumber: 123 }
      
      const result = manager.formatMessage(template, data)
      
      expect(result).toBe('Issue #123 - ')
    })
  })

  describe('通知送信', () => {
    it('初期化されていない場合は送信をスキップ', async () => {
      const result = await manager.notify('issue.completed', { issueNumber: 123 })
      
      expect(result).toEqual({ sent: 0, failed: 0, errors: [] })
    })

    it('プロバイダーなしの場合は送信をスキップ', async () => {
      await manager.initialize()
      
      const result = await manager.notify('issue.completed', { issueNumber: 123 })
      
      expect(result).toEqual({ sent: 0, failed: 0, errors: [] })
    })

    it('単一プロバイダーに送信成功', async () => {
      const provider = new MockProvider('TestProvider')
      manager.registerProvider(provider)
      await manager.initialize()
      
      const result = await manager.notify('issue.completed', {
        issueNumber: 123,
        title: 'テスト'
      })
      
      expect(provider.sendCalled).toBe(1)
      expect(result.sent).toBe(1)
      expect(result.failed).toBe(0)
    })

    it('複数プロバイダーに並列送信', async () => {
      const provider1 = new MockProvider('Provider1')
      const provider2 = new MockProvider('Provider2')
      const provider3 = new MockProvider('Provider3')
      
      manager.registerProvider(provider1)
      manager.registerProvider(provider2)
      manager.registerProvider(provider3)
      await manager.initialize()
      
      const startTime = Date.now()
      const result = await manager.notify('issue.completed', {
        issueNumber: 123,
        title: 'テスト'
      })
      const duration = Date.now() - startTime
      
      expect(provider1.sendCalled).toBe(1)
      expect(provider2.sendCalled).toBe(1)
      expect(provider3.sendCalled).toBe(1)
      expect(result.sent).toBe(3)
      expect(result.failed).toBe(0)
      expect(duration).toBeLessThan(1500) // 並列実行の確認
    })

    it('一部のプロバイダーが失敗しても他は送信', async () => {
      const provider1 = new MockProvider('Provider1')
      const provider2 = new MockProvider('Provider2', true) // 失敗する
      const provider3 = new MockProvider('Provider3')
      
      manager.registerProvider(provider1)
      manager.registerProvider(provider2)
      manager.registerProvider(provider3)
      await manager.initialize()
      
      const result = await manager.notify('issue.completed', {
        issueNumber: 123,
        title: 'テスト'
      })
      
      expect(provider1.sendCalled).toBe(1)
      expect(provider2.sendCalled).toBe(1)
      expect(provider3.sendCalled).toBe(1)
      expect(result.sent).toBe(2)
      expect(result.failed).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('Provider2')
    })

    it('テンプレートが存在しない場合はデフォルトメッセージ', async () => {
      const provider = new MockProvider('TestProvider')
      manager.registerProvider(provider)
      await manager.initialize()
      
      const result = await manager.notify('unknown.event', {
        issueNumber: 123
      })
      
      expect(provider.sendCalled).toBe(1)
      expect(result.sent).toBe(1)
    })
  })

  describe('タイムアウト処理', () => {
    it('タイムアウトした場合はエラーとして記録', async () => {
      // 遅いプロバイダーのモック
      const slowProvider = {
        getName: () => 'SlowProvider',
        async validate() {},
        async send() {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }
      
      manager.registerProvider(slowProvider)
      await manager.initialize()
      
      const result = await manager.notify('issue.completed', {
        issueNumber: 123
      })
      
      expect(result.sent).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.errors[0]).toContain('Timeout')
    })

    it('複数プロバイダーでタイムアウトが混在', async () => {
      const fastProvider = new MockProvider('FastProvider')
      const slowProvider = {
        getName: () => 'SlowProvider',
        async validate() {},
        async send() {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }
      
      manager.registerProvider(fastProvider)
      manager.registerProvider(slowProvider)
      await manager.initialize()
      
      const result = await manager.notify('issue.completed', {
        issueNumber: 123
      })
      
      expect(result.sent).toBe(1)
      expect(result.failed).toBe(1)
      expect(fastProvider.sendCalled).toBe(1)
    })
  })

  describe('エラーハンドリング', () => {
    it('プロバイダーのsendメソッドがない場合エラー', async () => {
      const invalidProvider = {
        getName: () => 'InvalidProvider',
        async validate() {}
        // sendメソッドなし
      }
      
      manager.registerProvider(invalidProvider)
      await manager.initialize()
      
      const result = await manager.notify('issue.completed', {
        issueNumber: 123
      })
      
      expect(result.failed).toBe(1)
      expect(result.errors[0]).toContain('send is not a function')
    })

    it('通知データが不正でもクラッシュしない', async () => {
      const provider = new MockProvider('TestProvider')
      manager.registerProvider(provider)
      await manager.initialize()
      
      // nullデータ
      const result1 = await manager.notify('issue.completed', null)
      expect(result1.sent).toBe(1)
      
      // undefinedデータ
      const result2 = await manager.notify('issue.completed', undefined)
      expect(result2.sent).toBe(1)
      
      // 空オブジェクト
      const result3 = await manager.notify('issue.completed', {})
      expect(result3.sent).toBe(1)
    })
  })

  describe('結果サマリー', () => {
    it('全て成功の場合のサマリー', () => {
      const results = [
        { status: 'fulfilled', value: { provider: 'Provider1', success: true } },
        { status: 'fulfilled', value: { provider: 'Provider2', success: true } }
      ]
      
      const summary = manager.summarizeResults(results)
      
      expect(summary).toEqual({
        sent: 2,
        failed: 0,
        errors: [],
        providers: {
          Provider1: { success: true },
          Provider2: { success: true }
        }
      })
    })

    it('混在結果のサマリー', () => {
      const results = [
        { status: 'fulfilled', value: { provider: 'Provider1', success: true } },
        { status: 'rejected', reason: { provider: 'Provider2', success: false, error: 'Failed' } }
      ]
      
      const summary = manager.summarizeResults(results)
      
      expect(summary).toEqual({
        sent: 1,
        failed: 1,
        errors: ['Provider2: Failed'],
        providers: {
          Provider1: { success: true },
          Provider2: { success: false, error: 'Failed' }
        }
      })
    })
  })
})