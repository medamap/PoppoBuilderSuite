const fs = require('fs').promises;
const path = require('path');

class SecurityConfig {
    constructor() {
        this.configPath = path.join(process.cwd(), 'config', 'security');
        this.policyPath = path.join(this.configPath, 'security-policy.json');
        this.policy = null;
    }

    async initialize() {
        await this.loadOrCreatePolicy();
    }

    async loadOrCreatePolicy() {
        try {
            const data = await fs.readFile(this.policyPath, 'utf8');
            this.policy = JSON.parse(data);
        } catch (error) {
            console.log('セキュリティポリシーが見つかりません。デフォルトを作成します。');
            await this.createDefaultPolicy();
        }
    }

    async createDefaultPolicy() {
        this.policy = {
            version: '1.0.0',
            lastUpdated: new Date().toISOString(),
            authentication: {
                enabled: true,
                methods: ['jwt', 'api_key'],
                tokenExpiry: {
                    access: '15m',
                    refresh: '7d'
                },
                maxLoginAttempts: 5,
                lockoutDuration: '15m',
                requireStrongApiKeys: true,
                apiKeyMinLength: 32,
                apiKeyRotationDays: 90
            },
            authorization: {
                enabled: true,
                defaultDenyAll: true,
                rbacEnabled: true,
                resourceLevelControl: true,
                dynamicPermissions: false
            },
            encryption: {
                enabled: true,
                transportSecurity: {
                    tlsVersion: '1.2',
                    enforceHttps: true,
                    hsts: {
                        enabled: true,
                        maxAge: 31536000,
                        includeSubDomains: true,
                        preload: true
                    }
                },
                dataEncryption: {
                    algorithm: 'aes-256-gcm',
                    keyRotationDays: 30,
                    encryptSensitiveData: true
                }
            },
            audit: {
                enabled: true,
                logAllRequests: true,
                logFailedAttempts: true,
                retentionDays: 365,
                integrityCheck: true,
                realTimeAlerts: true,
                alertChannels: ['console', 'file']
            },
            rateLimit: {
                enabled: true,
                global: {
                    windowMs: 900000,
                    max: 1000
                },
                perAgent: {
                    windowMs: 900000,
                    max: 100
                },
                authentication: {
                    windowMs: 900000,
                    max: 5
                }
            },
            cors: {
                enabled: false,
                allowedOrigins: [],
                allowedMethods: ['GET', 'POST', 'PUT', 'DELETE'],
                allowedHeaders: ['Content-Type', 'Authorization'],
                credentials: false,
                maxAge: 86400
            },
            headers: {
                contentSecurityPolicy: {
                    enabled: true,
                    directives: {
                        defaultSrc: ["'self'"],
                        scriptSrc: ["'self'"],
                        styleSrc: ["'self'", "'unsafe-inline'"],
                        imgSrc: ["'self'", 'data:', 'https:'],
                        connectSrc: ["'self'"],
                        fontSrc: ["'self'"],
                        objectSrc: ["'none'"],
                        mediaSrc: ["'self'"],
                        frameSrc: ["'none'"]
                    }
                },
                xFrameOptions: 'DENY',
                xContentTypeOptions: 'nosniff',
                xXssProtection: '1; mode=block',
                referrerPolicy: 'strict-origin-when-cross-origin'
            },
            monitoring: {
                enabled: true,
                metrics: {
                    collectInterval: '1m',
                    retentionHours: 24
                },
                healthCheck: {
                    enabled: true,
                    interval: '30s',
                    timeout: '5s'
                },
                anomalyDetection: {
                    enabled: true,
                    thresholds: {
                        failureRate: 0.1,
                        responseTime: 5000,
                        requestVolume: 10000
                    }
                }
            },
            compliance: {
                dataProtection: {
                    enabled: true,
                    anonymizeUserData: true,
                    rightToErasure: true,
                    dataMinimization: true
                },
                logging: {
                    excludeSensitiveData: true,
                    maskPatterns: [
                        'password',
                        'apiKey',
                        'token',
                        'secret'
                    ]
                }
            }
        };

        await this.savePolicy();
    }

    async savePolicy() {
        await fs.mkdir(this.configPath, { recursive: true });
        await fs.writeFile(
            this.policyPath,
            JSON.stringify(this.policy, null, 2),
            'utf8'
        );
    }

    getPolicy(path = null) {
        if (!path) {
            return this.policy;
        }

        const parts = path.split('.');
        let current = this.policy;

        for (const part of parts) {
            if (current && typeof current === 'object' && part in current) {
                current = current[part];
            } else {
                return undefined;
            }
        }

        return current;
    }

    async updatePolicy(path, value) {
        const parts = path.split('.');
        let current = this.policy;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!(part in current)) {
                current[part] = {};
            }
            current = current[part];
        }

        current[parts[parts.length - 1]] = value;
        this.policy.lastUpdated = new Date().toISOString();

        await this.savePolicy();
    }

    validateConfig() {
        const errors = [];
        const warnings = [];

        if (!this.policy.authentication.enabled && !this.policy.authorization.enabled) {
            errors.push('認証と認可の両方が無効になっています。少なくとも1つは有効にしてください。');
        }

        if (this.policy.authentication.maxLoginAttempts > 10) {
            warnings.push('ログイン試行回数の上限が高すぎます。ブルートフォース攻撃のリスクがあります。');
        }

        if (!this.policy.encryption.transportSecurity.enforceHttps) {
            warnings.push('HTTPSが強制されていません。通信の暗号化を推奨します。');
        }

        if (this.policy.audit.retentionDays < 90) {
            warnings.push('監査ログの保持期間が短すぎます。コンプライアンス要件を確認してください。');
        }

        if (!this.policy.rateLimit.enabled) {
            warnings.push('レート制限が無効です。DoS攻撃のリスクがあります。');
        }

        return { errors, warnings, valid: errors.length === 0 };
    }

    generateSecurityHeaders() {
        const headers = {};

        if (this.policy.headers.contentSecurityPolicy.enabled) {
            const csp = Object.entries(this.policy.headers.contentSecurityPolicy.directives)
                .map(([key, values]) => `${key} ${values.join(' ')}`)
                .join('; ');
            headers['Content-Security-Policy'] = csp;
        }

        headers['X-Frame-Options'] = this.policy.headers.xFrameOptions;
        headers['X-Content-Type-Options'] = this.policy.headers.xContentTypeOptions;
        headers['X-XSS-Protection'] = this.policy.headers.xXssProtection;
        headers['Referrer-Policy'] = this.policy.headers.referrerPolicy;

        if (this.policy.encryption.transportSecurity.hsts.enabled) {
            const hsts = this.policy.encryption.transportSecurity.hsts;
            let value = `max-age=${hsts.maxAge}`;
            if (hsts.includeSubDomains) value += '; includeSubDomains';
            if (hsts.preload) value += '; preload';
            headers['Strict-Transport-Security'] = value;
        }

        return headers;
    }

    getRateLimitConfig(type = 'global') {
        if (!this.policy.rateLimit.enabled) {
            return null;
        }

        const config = this.policy.rateLimit[type];
        if (!config) {
            return this.policy.rateLimit.global;
        }

        return {
            windowMs: config.windowMs,
            max: config.max,
            message: `レート制限に達しました。${config.windowMs / 60000}分後に再試行してください。`,
            standardHeaders: true,
            legacyHeaders: false
        };
    }

    shouldLogRequest(requestType) {
        if (!this.policy.audit.enabled) {
            return false;
        }

        if (this.policy.audit.logAllRequests) {
            return true;
        }

        if (requestType === 'failed' && this.policy.audit.logFailedAttempts) {
            return true;
        }

        return false;
    }

    maskSensitiveData(data) {
        if (!this.policy.compliance.logging.excludeSensitiveData) {
            return data;
        }

        let maskedData = JSON.stringify(data);

        for (const pattern of this.policy.compliance.logging.maskPatterns) {
            const regex = new RegExp(`"${pattern}"\\s*:\\s*"[^"]*"`, 'gi');
            maskedData = maskedData.replace(regex, `"${pattern}":"***MASKED***"`);
        }

        return JSON.parse(maskedData);
    }

    async exportPolicy(format = 'json') {
        const exportData = {
            policy: this.policy,
            exportedAt: new Date().toISOString(),
            version: this.policy.version
        };

        if (format === 'json') {
            return JSON.stringify(exportData, null, 2);
        } else if (format === 'yaml') {
            const yaml = require('js-yaml');
            return yaml.dump(exportData);
        } else {
            throw new Error(`サポートされていない形式: ${format}`);
        }
    }

    async importPolicy(data, format = 'json') {
        let importData;

        if (format === 'json') {
            importData = JSON.parse(data);
        } else if (format === 'yaml') {
            const yaml = require('js-yaml');
            importData = yaml.load(data);
        } else {
            throw new Error(`サポートされていない形式: ${format}`);
        }

        if (!importData.policy || !importData.version) {
            throw new Error('無効なポリシーデータです');
        }

        this.policy = importData.policy;
        this.policy.lastUpdated = new Date().toISOString();

        await this.savePolicy();
    }
}

module.exports = SecurityConfig;