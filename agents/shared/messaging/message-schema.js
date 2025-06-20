const Ajv = require('ajv');

/**
 * メッセージスキーマ定義とバリデーション
 */
class MessageSchema {
  constructor() {
    this.ajv = new Ajv({ allErrors: true });
    this.schemas = new Map();
    
    // 基本スキーマの登録
    this.registerDefaultSchemas();
  }
  
  /**
   * デフォルトスキーマの登録
   */
  registerDefaultSchemas() {
    // 基本メッセージスキーマ
    this.registerSchema('base-message', {
      type: 'object',
      required: ['id', 'type', 'version', 'timestamp', 'payload'],
      properties: {
        id: { type: 'string', pattern: '^msg_' },
        type: { type: 'string', minLength: 1 },
        version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
        timestamp: { type: 'number', minimum: 0 },
        from: { type: 'string' },
        to: { type: 'string' },
        correlationId: { type: 'string' },
        priority: { type: 'number', minimum: 0, maximum: 10 },
        ttl: { type: 'number', minimum: 0 },
        payload: { type: 'object' }
      }
    });
    
    // タスク割り当てメッセージ
    this.registerSchema('TASK_ASSIGNMENT', {
      allOf: [
        { $ref: '#/definitions/base-message' },
        {
          properties: {
            payload: {
              type: 'object',
              required: ['taskId', 'taskType', 'data'],
              properties: {
                taskId: { type: 'string' },
                taskType: { type: 'string' },
                priority: { type: 'number', minimum: 0, maximum: 10 },
                deadline: { type: 'string', format: 'date-time' },
                retryCount: { type: 'number', minimum: 0 },
                data: { type: 'object' },
                metadata: { type: 'object' }
              }
            }
          }
        }
      ]
    });
    
    // タスク完了メッセージ
    this.registerSchema('TASK_COMPLETED', {
      allOf: [
        { $ref: '#/definitions/base-message' },
        {
          properties: {
            payload: {
              type: 'object',
              required: ['taskId', 'result'],
              properties: {
                taskId: { type: 'string' },
                result: { type: 'object' },
                executionTime: { type: 'number', minimum: 0 },
                metrics: { type: 'object' }
              }
            }
          }
        }
      ]
    });
    
    // エラー通知メッセージ
    this.registerSchema('ERROR_NOTIFICATION', {
      allOf: [
        { $ref: '#/definitions/base-message' },
        {
          properties: {
            payload: {
              type: 'object',
              required: ['taskId', 'errorCode', 'errorMessage'],
              properties: {
                taskId: { type: 'string' },
                errorCode: { type: 'string' },
                errorMessage: { type: 'string' },
                errorStack: { type: 'string' },
                retryable: { type: 'boolean' },
                context: { type: 'object' }
              }
            }
          }
        }
      ]
    });
    
    // ハートビートメッセージ
    this.registerSchema('HEARTBEAT', {
      allOf: [
        { $ref: '#/definitions/base-message' },
        {
          properties: {
            payload: {
              type: 'object',
              required: ['agent', 'status'],
              properties: {
                agent: { type: 'string' },
                status: { 
                  type: 'string', 
                  enum: ['initializing', 'running', 'paused', 'error', 'stopped'] 
                },
                metrics: {
                  type: 'object',
                  properties: {
                    cpuUsage: { type: 'number', minimum: 0 },
                    memoryUsage: { type: 'number', minimum: 0 },
                    activeTasks: { type: 'number', minimum: 0 },
                    tasksCompleted: { type: 'number', minimum: 0 },
                    tasksFailed: { type: 'number', minimum: 0 },
                    uptime: { type: 'number', minimum: 0 }
                  }
                }
              }
            }
          }
        }
      ]
    });
    
    // 進捗更新メッセージ
    this.registerSchema('PROGRESS_UPDATE', {
      allOf: [
        { $ref: '#/definitions/base-message' },
        {
          properties: {
            payload: {
              type: 'object',
              required: ['taskId', 'progress'],
              properties: {
                taskId: { type: 'string' },
                progress: { type: 'number', minimum: 0, maximum: 100 },
                status: { type: 'string' },
                message: { type: 'string' },
                details: { type: 'object' }
              }
            }
          }
        }
      ]
    });
    
    // エージェントイベント
    this.registerSchema('AGENT_EVENT', {
      allOf: [
        { $ref: '#/definitions/base-message' },
        {
          properties: {
            payload: {
              type: 'object',
              required: ['agent', 'event'],
              properties: {
                agent: { type: 'string' },
                event: { 
                  type: 'string',
                  enum: ['started', 'stopped', 'paused', 'resumed', 'error', 'config-changed']
                },
                details: { type: 'object' }
              }
            }
          }
        }
      ]
    });
    
    // Issue処理イベント
    this.registerSchema('ISSUE_EVENT', {
      allOf: [
        { $ref: '#/definitions/base-message' },
        {
          properties: {
            payload: {
              type: 'object',
              required: ['issueNumber', 'event'],
              properties: {
                issueNumber: { type: 'number', minimum: 1 },
                repository: { type: 'string' },
                event: {
                  type: 'string',
                  enum: ['created', 'updated', 'closed', 'reopened', 'assigned', 'labeled', 'commented']
                },
                actor: { type: 'string' },
                changes: { type: 'object' },
                timestamp: { type: 'string', format: 'date-time' }
              }
            }
          }
        }
      ]
    });
  }
  
  /**
   * スキーマの登録
   */
  registerSchema(messageType, schema) {
    // 基本定義の追加
    if (!schema.definitions) {
      schema.definitions = {};
    }
    schema.definitions['base-message'] = this.schemas.get('base-message') || {};
    
    const validate = this.ajv.compile(schema);
    this.schemas.set(messageType, { schema, validate });
  }
  
  /**
   * メッセージの検証
   */
  validateMessage(message) {
    // 基本構造の検証
    const baseValidator = this.schemas.get('base-message');
    if (baseValidator && !baseValidator.validate(message)) {
      return {
        valid: false,
        errors: baseValidator.validate.errors,
        type: 'base-validation'
      };
    }
    
    // タイプ別検証
    const typeValidator = this.schemas.get(message.type);
    if (!typeValidator) {
      // 未登録タイプは警告のみ
      return {
        valid: true,
        warning: `未登録メッセージタイプ: ${message.type}`
      };
    }
    
    if (!typeValidator.validate(message)) {
      return {
        valid: false,
        errors: typeValidator.validate.errors,
        type: 'type-validation'
      };
    }
    
    return { valid: true };
  }
  
  /**
   * カスタムメッセージタイプの登録
   */
  registerCustomType(messageType, payloadSchema) {
    const customSchema = {
      allOf: [
        { $ref: '#/definitions/base-message' },
        {
          properties: {
            payload: payloadSchema
          }
        }
      ]
    };
    
    this.registerSchema(messageType, customSchema);
  }
  
  /**
   * エラーメッセージのフォーマット
   */
  formatValidationErrors(errors) {
    return errors.map(error => {
      const field = error.instancePath || error.schemaPath;
      return `${field}: ${error.message}`;
    }).join(', ');
  }
}

module.exports = MessageSchema;