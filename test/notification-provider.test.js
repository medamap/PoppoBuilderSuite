/**
 * NotificationProvider基底クラスの単体テスト
 */

const NotificationProvider = require('../src/providers/notification-provider')

// モックロガー
const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
})

// テスト用の具象クラス
class TestProvider extends NotificationProvider {
  constructor(config, logger) {
    super('TestProvider', config, logger)
    this.sendCallCount = 0
    this.validateCallCount = 0
  }

  async send(notification) {
    this.sendCallCount++
    if (this.config.shouldFail) {
      throw new Error('Send failed')
    }
    return { success: true }
  }

  async validate() {
    this.validateCallCount++
    if (this.config.invalidConfig) {
      throw new Error('Invalid configuration')
    }
  }
}

describe('NotificationProvider基底クラス', () => {
  let provider
  let mockLogger
  let mockConfig

  beforeEach(() => {
    mockLogger = createMockLogger()
    mockConfig = {
      enabled: true,
      maxRetries: 3,
      retryDelay: 100
    }
    provider = new TestProvider(mockConfig, mockLogger)
  })

  describe('基本機能', () => {
    it('正しく初期化される', () => {
      expect(provider.getName()).toBe('TestProvider')
      expect(provider.isEnabled()).toBe(true)
      expect(provider.maxRetries).toBe(3)
      expect(provider.retryDelay).toBe(100)
    })

    it('デフォルト値が設定される', () => {
      const minimalConfig = { enabled: true }
      const minimalProvider = new TestProvider(minimalConfig, mockLogger)
      
      expect(minimalProvider.maxRetries).toBe(3)
      expect(minimalProvider.retryDelay).toBe(1000)
    })

    it('無効化されたプロバイダーを識別', () => {
      mockConfig.enabled = false
      const disabledProvider = new TestProvider(mockConfig, mockLogger)
      
      expect(disabledProvider.isEnabled()).toBe(false)
    })
  })

  describe('抽象メソッド', () => {
    it('sendメソッドは実装が必要', async () => {
      const baseProvider = new NotificationProvider('Base', mockConfig, mockLogger)
      
      await expect(baseProvider.send({}))
        .rejects.toThrow('send() must be implemented by subclass')
    })

    it('validateメソッドは実装が必要', async () => {
      const baseProvider = new NotificationProvider('Base', mockConfig, mockLogger)
      
      await expect(baseProvider.validate())
        .rejects.toThrow('validate() must be implemented by subclass')
    })
  })

  describe('リトライ機能', () => {
    it('成功時はリトライしない', async () => {
      const fn = jest.fn().mockResolvedValue('success')
      
      const result = await provider.retry(fn)
      
      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('失敗時は指定回数リトライ', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('Attempt 1'))
        .mockRejectedValueOnce(new Error('Attempt 2'))
        .mockResolvedValue('success')
      
      const result = await provider.retry(fn, 2)
      
      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(3)
      expect(mockLogger.warn).toHaveBeenCalledTimes(2)
    })

    it('リトライ上限到達時は最後のエラーをスロー', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Persistent error'))
      
      await expect(provider.retry(fn, 2))
        .rejects.toThrow('Persistent error')
      
      expect(fn).toHaveBeenCalledTimes(3) // 初回 + 2回リトライ
    })

    it('指数バックオフで待機時間が増加', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Error'))
      const delays = []
      
      // setTimeoutをモック
      jest.spyOn(global, 'setTimeout').mockImplementation((callback, delay) => {
        delays.push(delay)
        callback()
      })
      
      try {
        await provider.retry(fn, 3)
      } catch (e) {
        // エラーは期待される
      }
      
      expect(delays).toEqual([100, 200, 400]) // 100 * 2^0, 100 * 2^1, 100 * 2^2
      
      global.setTimeout.mockRestore()
    })

    it('リトライ回数0の場合は初回のみ実行', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Error'))
      
      await expect(provider.retry(fn, 0))
        .rejects.toThrow('Error')
      
      expect(fn).toHaveBeenCalledTimes(1)
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })
  })

  describe('環境変数の解決', () => {
    it('環境変数を正しく解決', () => {
      process.env.TEST_VAR = 'test-value'
      process.env.ANOTHER_VAR = 'another-value'
      
      const result = provider.resolveEnvVar('prefix-${TEST_VAR}-${ANOTHER_VAR}-suffix')
      
      expect(result).toBe('prefix-test-value-another-value-suffix')
      
      delete process.env.TEST_VAR
      delete process.env.ANOTHER_VAR
    })

    it('環境変数が設定されていない場合エラー', () => {
      expect(() => provider.resolveEnvVar('${NONEXISTENT_VAR}'))
        .toThrow('環境変数 NONEXISTENT_VAR が設定されていません')
    })

    it('文字列以外の値はそのまま返す', () => {
      expect(provider.resolveEnvVar(123)).toBe(123)
      expect(provider.resolveEnvVar(true)).toBe(true)
      expect(provider.resolveEnvVar(null)).toBe(null)
      expect(provider.resolveEnvVar(undefined)).toBe(undefined)
      expect(provider.resolveEnvVar({ key: 'value' })).toEqual({ key: 'value' })
    })

    it('環境変数プレースホルダーがない場合はそのまま返す', () => {
      const result = provider.resolveEnvVar('plain-text-without-variables')
      expect(result).toBe('plain-text-without-variables')
    })

    it('複雑な環境変数パターンを処理', () => {
      process.env.HOST = 'localhost'
      process.env.PORT = '3000'
      process.env.PROTOCOL = 'https'
      
      const result = provider.resolveEnvVar('${PROTOCOL}://${HOST}:${PORT}/api')
      
      expect(result).toBe('https://localhost:3000/api')
      
      delete process.env.HOST
      delete process.env.PORT
      delete process.env.PROTOCOL
    })

    it('環境変数名に特殊文字が含まれる場合', () => {
      process.env['TEST-VAR_123'] = 'special-value'
      
      const result = provider.resolveEnvVar('${TEST-VAR_123}')
      
      expect(result).toBe('special-value')
      
      delete process.env['TEST-VAR_123']
    })
  })

  describe('実際の使用例', () => {
    it('送信メソッドのリトライ', async () => {
      mockConfig.shouldFail = true
      mockConfig.maxRetries = 2
      const failingProvider = new TestProvider(mockConfig, mockLogger)
      
      // sendメソッドをリトライ付きで呼び出す
      await expect(
        failingProvider.retry(() => failingProvider.send({ test: true }))
      ).rejects.toThrow('Send failed')
      
      expect(failingProvider.sendCallCount).toBe(3) // 初回 + 2回リトライ
    })

    it('検証メソッドの実行', async () => {
      await provider.validate()
      expect(provider.validateCallCount).toBe(1)
      
      mockConfig.invalidConfig = true
      const invalidProvider = new TestProvider(mockConfig, mockLogger)
      
      await expect(invalidProvider.validate())
        .rejects.toThrow('Invalid configuration')
    })
  })

  describe('エラーハンドリング', () => {
    it('リトライ中の異なるエラーを処理', async () => {
      const errors = ['Error 1', 'Error 2', 'Error 3']
      let attempt = 0
      
      const fn = jest.fn().mockImplementation(() => {
        throw new Error(errors[attempt++])
      })
      
      await expect(provider.retry(fn, 2))
        .rejects.toThrow('Error 3') // 最後のエラー
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('リトライ 1/2')
      )
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('リトライ 2/2')
      )
    })

    it('非同期エラーを適切に処理', async () => {
      const fn = jest.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        throw new Error('Async error')
      })
      
      await expect(provider.retry(fn, 1))
        .rejects.toThrow('Async error')
      
      expect(fn).toHaveBeenCalledTimes(2)
    })
  })
})