/**
 * TelegramProviderの単体テスト
 */

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

describe('TelegramProvider', () => {
  let provider
  let mockLogger
  let mockConfig

  beforeEach(() => {
    jest.clearAllMocks()
    mockLogger = createMockLogger()
    mockConfig = {
      enabled: true,
      botToken: 'test-bot-token',
      chatId: '-1001234567890',
      parseMode: 'Markdown',
      disableNotification: false
    }
    provider = new TelegramProvider(mockConfig, mockLogger)
  })

  describe('初期化と検証', () => {
    it('正しい設定で初期化', () => {
      expect(provider.getName()).toBe('Telegram')
      expect(provider.botToken).toBe('test-bot-token')
      expect(provider.chatId).toBe('-1001234567890')
      expect(provider.parseMode).toBe('Markdown')
      expect(provider.disableNotification).toBe(false)
      expect(provider.apiBaseUrl).toBe('https://api.telegram.org/bottest-bot-token')
    })

    it('環境変数から認証情報を解決', () => {
      process.env.TELEGRAM_TOKEN = 'env-bot-token'
      process.env.TELEGRAM_CHAT = 'env-chat-id'
      const config = {
        ...mockConfig,
        botToken: '${TELEGRAM_TOKEN}',
        chatId: '${TELEGRAM_CHAT}'
      }
      const provider = new TelegramProvider(config, mockLogger)
      
      expect(provider.botToken).toBe('env-bot-token')
      expect(provider.chatId).toBe('env-chat-id')
      expect(provider.apiBaseUrl).toBe('https://api.telegram.org/botenv-bot-token')
      delete process.env.TELEGRAM_TOKEN
      delete process.env.TELEGRAM_CHAT
    })

    it('botTokenが未設定の場合エラー', async () => {
      provider.botToken = null
      
      await expect(provider.validate()).rejects.toThrow('Telegram Bot Tokenが設定されていません')
    })

    it('chatIdが未設定の場合エラー', async () => {
      provider.chatId = null
      
      await expect(provider.validate()).rejects.toThrow('Telegram Chat IDが設定されていません')
    })

    it('有効なBot Tokenの検証成功', async () => {
      axios.get.mockResolvedValue({
        status: 200,
        data: {
          ok: true,
          result: {
            id: 123456789,
            is_bot: true,
            first_name: 'TestBot',
            username: 'test_bot'
          }
        }
      })
      
      await provider.validate()
      
      expect(axios.get).toHaveBeenCalledWith('https://api.telegram.org/bottest-bot-token/getMe')
      expect(mockLogger.info).toHaveBeenCalledWith('[Telegram] Bot名: test_bot')
    })

    it('無効なBot Tokenの場合エラー', async () => {
      axios.get.mockResolvedValue({
        status: 401,
        data: {
          ok: false,
          error_code: 401,
          description: 'Unauthorized'
        }
      })
      
      await expect(provider.validate()).rejects.toThrow('無効なBot Tokenです')
    })

    it('ネットワークエラーの場合適切なエラー', async () => {
      axios.get.mockRejectedValue(new Error('Network Error'))
      
      await expect(provider.validate()).rejects.toThrow('Telegram Bot Token検証エラー: Network Error')
    })
  })

  describe('メッセージ送信', () => {
    it('基本的な通知を送信', async () => {
      axios.post.mockResolvedValue({
        status: 200,
        data: {
          ok: true,
          result: { message_id: 12345 }
        }
      })
      
      const notification = {
        eventType: 'issue.completed',
        message: 'テスト完了メッセージ',
        data: {
          issueNumber: 123,
          title: 'テストIssue',
          issueUrl: 'https://github.com/test/repo/issues/123',
          executionTime: 125000,
          labels: ['bug', 'tested']
        },
        timestamp: new Date().toISOString()
      }
      
      await provider.send(notification)
      
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-bot-token/sendMessage',
        expect.objectContaining({
          chat_id: '-1001234567890',
          text: expect.stringContaining('✅ *Issue #123 処理完了*'),
          parse_mode: 'Markdown',
          disable_notification: false,
          reply_markup: expect.objectContaining({
            inline_keyboard: [[{
              text: '📋 Issue #123を開く',
              url: 'https://github.com/test/repo/issues/123'
            }]]
          })
        }),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        })
      )
    })

    it('エラー通知の送信', async () => {
      axios.post.mockResolvedValue({
        status: 200,
        data: {
          ok: true,
          result: { message_id: 12346 }
        }
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
      expect(payload.text).toContain('❌ *Issue #456 エラー発生*')
      expect(payload.text).toContain('エラーが発生しました')
    })

    it('実行時間とラベルの表示', async () => {
      axios.post.mockResolvedValue({
        status: 200,
        data: {
          ok: true,
          result: { message_id: 12347 }
        }
      })
      
      const notification = {
        eventType: 'issue.completed',
        message: 'テスト',
        data: {
          issueNumber: 789,
          executionTime: 3665000, // 1時間1分5秒
          labels: ['enhancement', 'documentation']
        }
      }
      
      await provider.send(notification)
      
      const payload = axios.post.mock.calls[0][1]
      expect(payload.text).toContain('⏱ 実行時間: 1時間1分')
      expect(payload.text).toContain('🏷 ラベル: `enhancement`, `documentation`')
    })

    it('長いメッセージは切り詰め', async () => {
      axios.post.mockResolvedValue({
        status: 200,
        data: {
          ok: true,
          result: { message_id: 12348 }
        }
      })
      
      const longMessage = 'a'.repeat(4097) // 4096文字を超える
      const notification = {
        eventType: 'issue.completed',
        message: longMessage,
        data: { issueNumber: 123 }
      }
      
      await provider.send(notification)
      
      const payload = axios.post.mock.calls[0][1]
      expect(payload.text.length).toBeLessThanOrEqual(4096)
      expect(payload.text).toContain('...')
    })

    it('Issue URLがない場合はキーボードなし', async () => {
      axios.post.mockResolvedValue({
        status: 200,
        data: {
          ok: true,
          result: { message_id: 12349 }
        }
      })
      
      const notification = {
        eventType: 'issue.completed',
        message: 'テスト',
        data: { issueNumber: 123 }
      }
      
      await provider.send(notification)
      
      const payload = axios.post.mock.calls[0][1]
      expect(payload.reply_markup).toBeUndefined()
    })

    it('サイレント通知の設定', async () => {
      provider.disableNotification = true
      axios.post.mockResolvedValue({
        status: 200,
        data: {
          ok: true,
          result: { message_id: 12350 }
        }
      })
      
      const notification = {
        eventType: 'issue.completed',
        message: 'テスト',
        data: { issueNumber: 123 }
      }
      
      await provider.send(notification)
      
      const payload = axios.post.mock.calls[0][1]
      expect(payload.disable_notification).toBe(true)
    })

    it('APIエラーの場合例外をスロー', async () => {
      axios.post.mockResolvedValue({
        status: 200,
        data: {
          ok: false,
          error_code: 400,
          description: 'Bad Request: message text is empty'
        }
      })
      
      const notification = {
        eventType: 'issue.completed',
        message: '',
        data: { issueNumber: 123 }
      }
      
      await expect(provider.send(notification)).rejects.toThrow('Telegram API error: Bad Request: message text is empty')
    })

    it('リトライ機能が動作', async () => {
      axios.post
        .mockRejectedValueOnce(new Error('一時的なエラー'))
        .mockRejectedValueOnce(new Error('一時的なエラー'))
        .mockResolvedValue({
          status: 200,
          data: {
            ok: true,
            result: { message_id: 12351 }
          }
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

  describe('メッセージフォーマット', () => {
    it('完了メッセージのフォーマット', () => {
      const message = provider.formatMessage(
        'issue.completed',
        '処理が完了しました',
        {
          issueNumber: 123,
          executionTime: 125000,
          labels: ['bug', 'fixed']
        }
      )
      
      expect(message).toContain('✅ *Issue #123 処理完了*')
      expect(message).toContain('処理が完了しました')
      expect(message).toContain('⏱ 実行時間: 2分5秒')
      expect(message).toContain('🏷 ラベル: `bug`, `fixed`')
    })

    it('再起動メッセージのフォーマット', () => {
      const message = provider.formatMessage(
        'dogfooding.restart',
        'システムを再起動します',
        {}
      )
      
      expect(message).toContain('🔄 *PoppoBuilder 再起動*')
      expect(message).toContain('システムを再起動します')
    })
  })

  describe('時間フォーマット', () => {
    it('秒のみ', () => {
      expect(provider.formatTime(45000)).toBe('45秒')
    })

    it('分と秒', () => {
      expect(provider.formatTime(125000)).toBe('2分5秒')
    })

    it('時間と分', () => {
      expect(provider.formatTime(3665000)).toBe('1時間1分')
    })

    it('複数時間', () => {
      expect(provider.formatTime(7325000)).toBe('2時間2分')
    })
  })

  describe('エラーハンドリング', () => {
    it('不正なデータでもクラッシュしない', async () => {
      axios.post.mockResolvedValue({
        status: 200,
        data: {
          ok: true,
          result: { message_id: 12352 }
        }
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
        botToken: '${NONEXISTENT_TOKEN}'
      }
      
      expect(() => new TelegramProvider(config, mockLogger))
        .toThrow('環境変数 NONEXISTENT_TOKEN が設定されていません')
    })

    it('parseMode違反のエラー処理', async () => {
      axios.post.mockResolvedValue({
        status: 200,
        data: {
          ok: false,
          error_code: 400,
          description: "Bad Request: can't parse entities"
        }
      })
      
      const notification = {
        eventType: 'issue.completed',
        message: 'テスト *不正な**マークダウン',
        data: { issueNumber: 123 }
      }
      
      await expect(provider.send(notification)).rejects.toThrow("Telegram API error: Bad Request: can't parse entities")
    })
  })

  describe('アイコンとタイトル', () => {
    it('各イベントタイプのアイコン', () => {
      expect(provider.getIcon('issue.completed')).toBe('✅')
      expect(provider.getIcon('issue.error')).toBe('❌')
      expect(provider.getIcon('issue.timeout')).toBe('⏱️')
      expect(provider.getIcon('dogfooding.restart')).toBe('🔄')
      expect(provider.getIcon('unknown')).toBe('📌')
    })

    it('各イベントタイプのタイトル', () => {
      const data = { issueNumber: 123 }
      expect(provider.getTitle('issue.completed', data)).toBe('Issue #123 処理完了')
      expect(provider.getTitle('issue.error', data)).toBe('Issue #123 エラー発生')
      expect(provider.getTitle('issue.timeout', data)).toBe('Issue #123 タイムアウト')
      expect(provider.getTitle('dogfooding.restart', {})).toBe('PoppoBuilder 再起動')
      expect(provider.getTitle('unknown', data)).toBe('Issue #123')
    })
  })
})