/**
 * IPC Protocol for PoppoBuilder Daemon
 * Defines message format and serialization for IPC communication
 */

const PROTOCOL_VERSION = '1.0.0';
const MAGIC_BYTES = Buffer.from('POPPO', 'utf8');
const HEADER_SIZE = 9; // 5 bytes magic + 4 bytes length

class Protocol {
  constructor() {
    this.version = PROTOCOL_VERSION;
  }
  
  /**
   * Encode message for transmission
   * Format: [MAGIC][LENGTH][JSON_DATA]
   */
  encodeMessage(message) {
    try {
      // Add protocol metadata
      const fullMessage = {
        ...message,
        version: this.version,
        timestamp: Date.now()
      };
      
      // Serialize to JSON
      const jsonData = JSON.stringify(fullMessage);
      const jsonBuffer = Buffer.from(jsonData, 'utf8');
      
      // Create header with magic bytes and length
      const header = Buffer.allocUnsafe(HEADER_SIZE);
      MAGIC_BYTES.copy(header, 0);
      header.writeUInt32BE(jsonBuffer.length, 5);
      
      // Combine header and data
      return Buffer.concat([header, jsonBuffer]);
      
    } catch (error) {
      throw new Error(`Failed to encode message: ${error.message}`);
    }
  }
  
  /**
   * Parse message from buffer
   * Returns { data: parsedMessage, remaining: remainingBuffer } or null
   */
  parseMessage(buffer) {
    try {
      // Need at least header to parse
      if (buffer.length < HEADER_SIZE) {
        return null;
      }
      
      // Check magic bytes
      const magic = buffer.slice(0, 5);
      if (!magic.equals(MAGIC_BYTES)) {
        throw new Error('Invalid magic bytes in message');
      }
      
      // Read message length
      const messageLength = buffer.readUInt32BE(5);
      const totalLength = HEADER_SIZE + messageLength;
      
      // Check if we have the complete message
      if (buffer.length < totalLength) {
        return null;
      }
      
      // Extract JSON data
      const jsonData = buffer.slice(HEADER_SIZE, totalLength);
      const message = JSON.parse(jsonData.toString('utf8'));
      
      // Validate message
      this._validateMessage(message);
      
      return {
        data: message,
        remaining: buffer.slice(totalLength)
      };
      
    } catch (error) {
      throw new Error(`Failed to parse message: ${error.message}`);
    }
  }
  
  /**
   * Validate message structure
   */
  _validateMessage(message) {
    if (!message || typeof message !== 'object') {
      throw new Error('Invalid message format');
    }
    
    if (!message.type) {
      throw new Error('Message missing type field');
    }
    
    if (message.version && message.version !== this.version) {
      // Log version mismatch but don't throw - allow backward compatibility
      console.warn(`Protocol version mismatch: ${message.version} != ${this.version}`);
    }
  }
  
  /**
   * Create standard message types
   */
  
  createCommandMessage(command, args = {}, id = null) {
    return {
      type: 'command',
      id: id || this._generateId(),
      command,
      args
    };
  }
  
  createResponseMessage(id, success, result = null, error = null) {
    return {
      type: 'response',
      id,
      success,
      result,
      error
    };
  }
  
  createErrorMessage(id, error) {
    return {
      type: 'error',
      id,
      error: {
        message: error.message,
        code: error.code || 'UNKNOWN_ERROR',
        stack: error.stack
      }
    };
  }
  
  createEventMessage(event, data = {}) {
    return {
      type: 'event',
      id: this._generateId(),
      event,
      data
    };
  }
  
  createAuthMessage(token) {
    return {
      type: 'auth',
      id: this._generateId(),
      token
    };
  }
  
  /**
   * Message type definitions
   */
  static get MessageTypes() {
    return {
      // Core types
      WELCOME: 'welcome',
      AUTH: 'auth',
      AUTH_SUCCESS: 'auth-success',
      COMMAND: 'command',
      RESPONSE: 'response',
      ERROR: 'error',
      EVENT: 'event',
      
      // Event types
      DAEMON_STARTED: 'daemon.started',
      DAEMON_STOPPING: 'daemon.stopping',
      PROJECT_ADDED: 'project.added',
      PROJECT_REMOVED: 'project.removed',
      PROJECT_STATUS_CHANGED: 'project.status-changed',
      QUEUE_STATUS_CHANGED: 'queue.status-changed',
      WORKER_ADDED: 'worker.added',
      WORKER_REMOVED: 'worker.removed',
      TASK_STARTED: 'task.started',
      TASK_COMPLETED: 'task.completed',
      TASK_FAILED: 'task.failed'
    };
  }
  
  /**
   * Command definitions
   */
  static get Commands() {
    return {
      // Daemon management
      DAEMON_STATUS: 'daemon.status',
      DAEMON_STOP: 'daemon.stop',
      DAEMON_RELOAD: 'daemon.reload',
      DAEMON_METRICS: 'daemon.metrics',
      
      // Project management
      PROJECT_LIST: 'project.list',
      PROJECT_ADD: 'project.add',
      PROJECT_REMOVE: 'project.remove',
      PROJECT_STATUS: 'project.status',
      PROJECT_START: 'project.start',
      PROJECT_STOP: 'project.stop',
      PROJECT_RESTART: 'project.restart',
      PROJECT_UPDATE: 'project.update',
      
      // Queue management
      QUEUE_STATUS: 'queue.status',
      QUEUE_PAUSE: 'queue.pause',
      QUEUE_RESUME: 'queue.resume',
      QUEUE_CLEAR: 'queue.clear',
      QUEUE_STATS: 'queue.stats',
      
      // Worker management
      WORKER_STATUS: 'worker.status',
      WORKER_SCALE: 'worker.scale',
      WORKER_RESTART: 'worker.restart',
      
      // Task management
      TASK_LIST: 'task.list',
      TASK_STATUS: 'task.status',
      TASK_CANCEL: 'task.cancel',
      TASK_RETRY: 'task.retry',
      
      // Monitoring
      METRICS_GET: 'metrics.get',
      LOGS_TAIL: 'logs.tail',
      HEALTH_CHECK: 'health.check'
    };
  }
  
  /**
   * Generate unique ID
   */
  _generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = Protocol;