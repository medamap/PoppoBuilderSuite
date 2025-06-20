/**
 * 設定テスト用のサンプルデータ
 */

const baseConfig = {
    github: {
        token: 'test-token',
        owner: 'test-owner',
        repo: 'test-repo',
        rateLimitBuffer: 100
    },
    claude: {
        apiKey: 'test-claude-key',
        model: 'claude-3-opus-20240229',
        timeout: 30000,
        maxRetries: 3,
        maxConcurrent: 5
    },
    language: {
        primary: 'ja',
        fallback: 'en'
    },
    logLevel: 'INFO',
    port: 3000,
    dashboard: {
        enabled: true,
        port: 3001,
        auth: {
            enabled: false,
            username: 'admin',
            password: 'password'
        }
    },
    rateLimiter: {
        github: {
            maxRequests: 1000,
            perHour: true
        },
        claude: {
            maxRequests: 100,
            perMinute: true
        }
    },
    monitoring: {
        enabled: true,
        interval: 60000,
        metrics: ['cpu', 'memory', 'disk']
    },
    notification: {
        enabled: false,
        providers: ['log']
    }
};

const testConfig = {
    github: {
        token: 'test-github-token',
        owner: 'test-owner',
        repo: 'test-repo',
        rateLimitBuffer: 50
    },
    claude: {
        apiKey: 'test-claude-key',
        model: 'claude-3-haiku-20240307',
        timeout: 10000,
        maxRetries: 2,
        maxConcurrent: 2
    },
    language: {
        primary: 'en',
        fallback: 'ja'
    },
    logLevel: 'DEBUG',
    port: 3002,
    dashboard: {
        enabled: false,
        port: 3003
    },
    rateLimiter: {
        github: {
            maxRequests: 100,
            perHour: true
        },
        claude: {
            maxRequests: 10,
            perMinute: true
        }
    }
};

const multiProjectConfig = {
    multiProject: {
        enabled: true,
        schedulingAlgorithm: 'weighted-fair',
        projects: {
            'project-a': {
                priority: 90,
                config: {
                    shareWeight: 3.0,
                    resourceQuota: {
                        cpu: '4000m',
                        memory: '8Gi',
                        maxConcurrent: 10
                    }
                }
            },
            'project-b': {
                priority: 50,
                config: {
                    shareWeight: 1.0,
                    resourceQuota: {
                        cpu: '1000m',
                        memory: '2Gi',
                        maxConcurrent: 3
                    }
                }
            }
        }
    }
};

const securityConfig = {
    security: {
        jwt: {
            secret: 'test-jwt-secret',
            expiresIn: '15m',
            refreshExpiresIn: '7d'
        },
        encryption: {
            algorithm: 'aes-256-cbc',
            keyDerivation: 'pbkdf2'
        },
        rateLimit: {
            windowMs: 15 * 60 * 1000, // 15分
            max: 100
        },
        cors: {
            origin: ['http://localhost:3000', 'http://localhost:3001'],
            credentials: true
        }
    }
};

const agentConfig = {
    agents: {
        ccla: {
            enabled: true,
            interval: 300000,
            maxConcurrency: 3,
            errorThreshold: 10
        },
        ccag: {
            enabled: true,
            languages: ['ja', 'en'],
            outputFormats: ['markdown', 'html']
        },
        ccpm: {
            enabled: true,
            reviewDepth: 'detailed',
            suggestionLimit: 5
        },
        ccqa: {
            enabled: true,
            coverageThreshold: 80,
            securityLevel: 'high'
        },
        ccra: {
            enabled: true,
            checkInterval: 300000,
            maxComplexity: 10
        }
    }
};

module.exports = {
    baseConfig,
    testConfig,
    multiProjectConfig,
    securityConfig,
    agentConfig,
    
    // ヘルパー関数
    createConfig: (overrides = {}) => {
        return JSON.parse(JSON.stringify({
            ...baseConfig,
            ...overrides
        }));
    },
    
    createTestConfig: (overrides = {}) => {
        return JSON.parse(JSON.stringify({
            ...testConfig,
            ...overrides
        }));
    },
    
    createMultiProjectConfig: (projects = {}) => {
        const config = JSON.parse(JSON.stringify(multiProjectConfig));
        if (Object.keys(projects).length > 0) {
            config.multiProject.projects = {
                ...config.multiProject.projects,
                ...projects
            };
        }
        return config;
    },
    
    createSecurityConfig: (overrides = {}) => {
        return JSON.parse(JSON.stringify({
            ...securityConfig,
            ...overrides
        }));
    },
    
    createAgentConfig: (agents = {}) => {
        const config = JSON.parse(JSON.stringify(agentConfig));
        if (Object.keys(agents).length > 0) {
            config.agents = {
                ...config.agents,
                ...agents
            };
        }
        return config;
    },
    
    // 環境変数のセットアップ
    setupTestEnvironment: () => {
        process.env.NODE_ENV = 'test';
        process.env.GITHUB_TOKEN = 'test-github-token';
        process.env.CLAUDE_API_KEY = 'test-claude-key';
        process.env.LOG_LEVEL = 'error';
    },
    
    // 環境変数のクリーンアップ
    cleanupTestEnvironment: () => {
        delete process.env.GITHUB_TOKEN;
        delete process.env.CLAUDE_API_KEY;
        process.env.NODE_ENV = 'test';
    }
};