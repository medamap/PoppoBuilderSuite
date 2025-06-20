/**
 * エラーテスト用のサンプルデータ
 */

const sampleErrors = {
    // 一般的なJavaScriptエラー
    referenceError: {
        name: 'ReferenceError',
        message: 'undefinedVariable is not defined',
        stack: `ReferenceError: undefinedVariable is not defined
    at Object.<anonymous> (/test/file.js:10:5)
    at Module._compile (internal/modules/cjs/loader.js:1063:30)
    at Object.Module._extensions..js (internal/modules/cjs/loader.js:1092:10)`
    },
    
    typeError: {
        name: 'TypeError',
        message: 'Cannot read property \'length\' of undefined',
        stack: `TypeError: Cannot read property 'length' of undefined
    at testFunction (/test/file.js:15:20)
    at Object.<anonymous> (/test/file.js:25:5)`
    },
    
    syntaxError: {
        name: 'SyntaxError',
        message: 'Unexpected token \'}\'',
        stack: `SyntaxError: Unexpected token '}'
    at wrapSafe (internal/modules/cjs/loader.js:915:16)
    at Module._compile (internal/modules/cjs/loader.js:963:27)`
    },

    // ネットワーク関連エラー
    networkError: {
        name: 'Error',
        message: 'connect ECONNREFUSED 127.0.0.1:3000',
        code: 'ECONNREFUSED',
        errno: -61,
        syscall: 'connect',
        address: '127.0.0.1',
        port: 3000
    },
    
    timeoutError: {
        name: 'Error',
        message: 'Request timeout',
        code: 'TIMEOUT',
        timeout: 30000
    },

    // HTTP関連エラー
    httpError: {
        name: 'HTTPError',
        message: 'Response code 404 (Not Found)',
        status: 404,
        statusText: 'Not Found'
    },
    
    rateLimitError: {
        name: 'Error',
        message: 'API rate limit exceeded',
        status: 429,
        headers: {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1640995200'
        }
    },

    // ファイルシステム関連エラー
    fileNotFoundError: {
        name: 'Error',
        message: 'ENOENT: no such file or directory, open \'/test/nonexistent.json\'',
        code: 'ENOENT',
        errno: -2,
        syscall: 'open',
        path: '/test/nonexistent.json'
    },
    
    permissionError: {
        name: 'Error',
        message: 'EACCES: permission denied, open \'/root/protected.json\'',
        code: 'EACCES',
        errno: -13,
        syscall: 'open',
        path: '/root/protected.json'
    },

    // データベース関連エラー
    sqliteError: {
        name: 'SqliteError',
        message: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email',
        code: 'SQLITE_CONSTRAINT_UNIQUE',
        errno: 2067
    },
    
    // JWT関連エラー
    jwtError: {
        name: 'JsonWebTokenError',
        message: 'invalid token',
        stack: `JsonWebTokenError: invalid token
    at Object.module.exports [as verify] (/node_modules/jsonwebtoken/verify.js:89:21)
    at JWTAuthManager.verifyAccessToken (/src/security/jwt-auth.js:120:30)`
    },
    
    tokenExpiredError: {
        name: 'TokenExpiredError',
        message: 'jwt expired',
        expiredAt: new Date('2023-01-01T00:00:00.000Z')
    },

    // カスタムエラー
    validationError: {
        name: 'ValidationError',
        message: 'Validation failed',
        errors: [
            { field: 'email', message: 'Invalid email format' },
            { field: 'password', message: 'Password too short' }
        ]
    },
    
    configurationError: {
        name: 'ConfigurationError',
        message: 'Missing required configuration: github.token',
        missingKeys: ['github.token']
    }
};

const errorLogs = [
    {
        timestamp: '2023-01-01T10:00:00.000Z',
        level: 'error',
        message: 'Failed to process issue #123',
        error: sampleErrors.networkError,
        context: {
            issueNumber: 123,
            operation: 'processIssue',
            attemptCount: 1
        }
    },
    {
        timestamp: '2023-01-01T10:05:00.000Z',
        level: 'error',
        message: 'Claude API request failed',
        error: sampleErrors.rateLimitError,
        context: {
            requestId: 'req-456',
            endpoint: '/v1/messages'
        }
    },
    {
        timestamp: '2023-01-01T10:10:00.000Z',
        level: 'error',
        message: 'Database operation failed',
        error: sampleErrors.sqliteError,
        context: {
            query: 'INSERT INTO users (email) VALUES (?)',
            params: ['test@example.com']
        }
    }
];

const errorPatterns = [
    {
        pattern: /ECONNREFUSED/,
        category: 'network',
        severity: 'high',
        autoRecoverable: true,
        suggestions: [
            'Check if the target service is running',
            'Verify network connectivity',
            'Check firewall settings'
        ]
    },
    {
        pattern: /jwt expired/,
        category: 'authentication',
        severity: 'medium',
        autoRecoverable: true,
        suggestions: [
            'Refresh the JWT token',
            'Re-authenticate the user',
            'Check token expiration settings'
        ]
    },
    {
        pattern: /SQLITE_CONSTRAINT/,
        category: 'database',
        severity: 'medium',
        autoRecoverable: false,
        suggestions: [
            'Check data uniqueness constraints',
            'Validate input data before insertion',
            'Handle constraint violations gracefully'
        ]
    },
    {
        pattern: /Cannot read property .* of undefined/,
        category: 'runtime',
        severity: 'high',
        autoRecoverable: false,
        suggestions: [
            'Add null checks before property access',
            'Use optional chaining (?.)',
            'Initialize variables properly'
        ]
    }
];

module.exports = {
    sampleErrors,
    errorLogs,
    errorPatterns,
    
    // ヘルパー関数
    createError: (type, overrides = {}) => {
        const baseError = sampleErrors[type];
        if (!baseError) {
            throw new Error(`Unknown error type: ${type}`);
        }
        
        const error = new Error(baseError.message);
        Object.assign(error, baseError, overrides);
        return error;
    },
    
    createErrorLog: (errorType, overrides = {}) => {
        return {
            timestamp: new Date().toISOString(),
            level: 'error',
            message: `Test error: ${errorType}`,
            error: sampleErrors[errorType] || sampleErrors.referenceError,
            context: {
                test: true,
                errorType
            },
            ...overrides
        };
    },
    
    createErrorSeries: (count, errorTypes = ['referenceError', 'typeError']) => {
        const errors = [];
        for (let i = 0; i < count; i++) {
            const errorType = errorTypes[i % errorTypes.length];
            errors.push({
                ...sampleErrors[errorType],
                timestamp: new Date(Date.now() - (count - i) * 60000).toISOString()
            });
        }
        return errors;
    },
    
    matchErrorPattern: (error, patterns = errorPatterns) => {
        const errorMessage = error.message || error.toString();
        for (const pattern of patterns) {
            if (pattern.pattern.test(errorMessage)) {
                return pattern;
            }
        }
        return null;
    },
    
    // エラー統計の生成
    generateErrorStats: (errors) => {
        const stats = {
            total: errors.length,
            byCategory: {},
            bySeverity: {},
            byRecoverability: {
                recoverable: 0,
                nonRecoverable: 0
            }
        };
        
        errors.forEach(error => {
            const pattern = module.exports.matchErrorPattern(error);
            if (pattern) {
                stats.byCategory[pattern.category] = (stats.byCategory[pattern.category] || 0) + 1;
                stats.bySeverity[pattern.severity] = (stats.bySeverity[pattern.severity] || 0) + 1;
                if (pattern.autoRecoverable) {
                    stats.byRecoverability.recoverable++;
                } else {
                    stats.byRecoverability.nonRecoverable++;
                }
            }
        });
        
        return stats;
    }
};