const path = require('path');
const { spawn } = require('child_process');
const Redis = require('ioredis');

/**
 * Test helpers for CCSP testing
 */

class TestHelpers {
  constructor() {
    this.mockClaudePath = path.join(__dirname, '../mocks/mock-claude-cli.js');
    this.redis = null;
  }

  /**
   * Initialize test environment
   */
  async setup() {
    // Set up Redis connection for tests
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: 15, // Use separate DB for tests
      retryStrategy: () => null // Don't retry in tests
    });

    // Clear test Redis DB
    await this.redis.flushdb();

    // Set mock Claude CLI path
    process.env.CLAUDE_CLI_PATH = this.mockClaudePath;
  }

  /**
   * Clean up test environment
   */
  async teardown() {
    if (this.redis) {
      await this.redis.flushdb();
      await this.redis.quit();
    }
  }

  /**
   * Set mock scenario
   */
  setMockScenario(scenario) {
    process.env.MOCK_SCENARIO = scenario;
  }

  /**
   * Enable rate limit simulation
   */
  enableRateLimit() {
    process.env.MOCK_RATE_LIMIT = 'true';
  }

  /**
   * Disable rate limit simulation
   */
  disableRateLimit() {
    delete process.env.MOCK_RATE_LIMIT;
  }

  /**
   * Enable session timeout simulation
   */
  enableSessionTimeout() {
    process.env.MOCK_SESSION_TIMEOUT = 'true';
  }

  /**
   * Disable session timeout simulation
   */
  disableSessionTimeout() {
    delete process.env.MOCK_SESSION_TIMEOUT;
  }

  /**
   * Enable error simulation
   */
  enableError() {
    process.env.MOCK_ERROR = 'true';
  }

  /**
   * Disable error simulation
   */
  disableError() {
    delete process.env.MOCK_ERROR;
  }

  /**
   * Create a mock CCSP request
   */
  createMockRequest(type = 'task', data = {}) {
    return {
      id: `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      priority: data.priority || 5,
      timestamp: new Date().toISOString(),
      source: 'test',
      data: {
        prompt: data.prompt || 'Test prompt',
        context: data.context || {},
        ...data
      }
    };
  }

  /**
   * Wait for a condition to be true
   */
  async waitFor(condition, timeout = 5000, interval = 100) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error('Timeout waiting for condition');
  }

  /**
   * Get queue stats from Redis
   */
  async getQueueStats(queueName = 'ccsp:queue:normal') {
    const waiting = await this.redis.llen(`bull:${queueName}:wait`);
    const active = await this.redis.llen(`bull:${queueName}:active`);
    const completed = await this.redis.zcard(`bull:${queueName}:completed`);
    const failed = await this.redis.zcard(`bull:${queueName}:failed`);
    
    return { waiting, active, completed, failed };
  }

  /**
   * Clear all queues
   */
  async clearQueues() {
    const keys = await this.redis.keys('bull:ccsp:queue:*');
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  /**
   * Create a spy function
   */
  createSpy() {
    const calls = [];
    const spy = (...args) => {
      calls.push({ args, timestamp: Date.now() });
      return spy.returnValue;
    };
    spy.calls = calls;
    spy.callCount = () => calls.length;
    spy.calledWith = (...args) => calls.some(call => 
      JSON.stringify(call.args) === JSON.stringify(args)
    );
    spy.reset = () => calls.length = 0;
    spy.returnValue = undefined;
    return spy;
  }

  /**
   * Mock Redis client for unit tests
   */
  createMockRedis() {
    const data = new Map();
    const lists = new Map();
    const sets = new Map();
    const sortedSets = new Map();

    return {
      get: async (key) => data.get(key) || null,
      set: async (key, value) => { data.set(key, value); return 'OK'; },
      del: async (...keys) => {
        let deleted = 0;
        keys.forEach(key => {
          if (data.delete(key)) deleted++;
          lists.delete(key);
          sets.delete(key);
          sortedSets.delete(key);
        });
        return deleted;
      },
      lpush: async (key, ...values) => {
        if (!lists.has(key)) lists.set(key, []);
        lists.get(key).unshift(...values);
        return lists.get(key).length;
      },
      rpop: async (key) => {
        const list = lists.get(key);
        return list ? list.pop() || null : null;
      },
      llen: async (key) => {
        const list = lists.get(key);
        return list ? list.length : 0;
      },
      sadd: async (key, ...members) => {
        if (!sets.has(key)) sets.set(key, new Set());
        const set = sets.get(key);
        let added = 0;
        members.forEach(m => {
          if (!set.has(m)) {
            set.add(m);
            added++;
          }
        });
        return added;
      },
      sismember: async (key, member) => {
        const set = sets.get(key);
        return set && set.has(member) ? 1 : 0;
      },
      zadd: async (key, ...args) => {
        if (!sortedSets.has(key)) sortedSets.set(key, new Map());
        const zset = sortedSets.get(key);
        let added = 0;
        for (let i = 0; i < args.length; i += 2) {
          const score = args[i];
          const member = args[i + 1];
          if (!zset.has(member)) added++;
          zset.set(member, score);
        }
        return added;
      },
      zcard: async (key) => {
        const zset = sortedSets.get(key);
        return zset ? zset.size : 0;
      },
      flushdb: async () => {
        data.clear();
        lists.clear();
        sets.clear();
        sortedSets.clear();
        return 'OK';
      },
      quit: async () => 'OK',
      keys: async (pattern) => {
        const allKeys = [...data.keys(), ...lists.keys(), ...sets.keys(), ...sortedSets.keys()];
        const unique = [...new Set(allKeys)];
        if (pattern === '*') return unique;
        // Simple pattern matching
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return unique.filter(key => regex.test(key));
      }
    };
  }
}

module.exports = TestHelpers;