const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class JWTAuthManager {
    constructor() {
        this.secretKey = null;
        this.refreshSecretKey = null;
        this.accessTokenExpiry = '15m';
        this.refreshTokenExpiry = '7d';
        this.saltRounds = 10;
        this.configPath = path.join(process.cwd(), 'config', 'security');
        this.agentCredentialsPath = path.join(this.configPath, 'agent-credentials.json');
        this.publicKeyPath = path.join(this.configPath, 'public.key');
        this.privateKeyPath = path.join(this.configPath, 'private.key');
    }

    async initialize() {
        await this.ensureSecurityConfig();
        await this.loadOrGenerateKeys();
        await this.loadAgentCredentials();
    }

    async ensureSecurityConfig() {
        try {
            await fs.mkdir(this.configPath, { recursive: true });
        } catch (error) {
            console.error('セキュリティ設定ディレクトリの作成に失敗:', error);
        }
    }

    async loadOrGenerateKeys() {
        try {
            this.secretKey = await fs.readFile(this.privateKeyPath, 'utf8');
            this.refreshSecretKey = await fs.readFile(this.publicKeyPath, 'utf8');
        } catch (error) {
            console.log('既存の鍵が見つかりません。新しい鍵を生成します。');
            await this.generateKeys();
        }
    }

    async generateKeys() {
        this.secretKey = crypto.randomBytes(64).toString('hex');
        this.refreshSecretKey = crypto.randomBytes(64).toString('hex');
        
        await fs.writeFile(this.privateKeyPath, this.secretKey, 'utf8');
        await fs.writeFile(this.publicKeyPath, this.refreshSecretKey, 'utf8');
        
        await fs.chmod(this.privateKeyPath, 0o600);
        await fs.chmod(this.publicKeyPath, 0o600);
    }

    async loadAgentCredentials() {
        try {
            const data = await fs.readFile(this.agentCredentialsPath, 'utf8');
            this.agentCredentials = JSON.parse(data);
        } catch (error) {
            console.log('エージェント認証情報が見つかりません。デフォルトを作成します。');
            await this.createDefaultAgentCredentials();
        }
    }

    async createDefaultAgentCredentials() {
        const defaultAgents = {
            'poppo-builder': {
                id: 'poppo-builder',
                name: 'PoppoBuilder',
                role: 'coordinator',
                permissions: ['*'],
                active: true
            },
            'medama-repair': {
                id: 'medama-repair',
                name: 'MedamaRepair',
                role: 'monitor',
                permissions: ['monitor', 'repair', 'restart'],
                active: true
            },
            'mera-cleaner': {
                id: 'mera-cleaner',
                name: 'MeraCleaner',
                role: 'cleaner',
                permissions: ['read', 'clean', 'report'],
                active: true
            },
            'ccla-agent': {
                id: 'ccla-agent',
                name: 'CCLAAgent',
                role: 'error-handler',
                permissions: ['read', 'analyze', 'repair', 'report'],
                active: true
            },
            'ccag-agent': {
                id: 'ccag-agent',
                name: 'CCAGAgent',
                role: 'documentation',
                permissions: ['read', 'write', 'generate', 'translate'],
                active: true
            },
            'ccpm-agent': {
                id: 'ccpm-agent',
                name: 'CCPMAgent',
                role: 'reviewer',
                permissions: ['read', 'review', 'suggest', 'report'],
                active: true
            },
            'mirin-orphan': {
                id: 'mirin-orphan',
                name: 'MirinOrphanManager',
                role: 'orphan-manager',
                permissions: ['read', 'detect', 'manage', 'report'],
                active: true
            }
        };

        this.agentCredentials = {};
        
        for (const [key, agent] of Object.entries(defaultAgents)) {
            const apiKey = crypto.randomBytes(32).toString('hex');
            const hashedApiKey = await bcrypt.hash(apiKey, this.saltRounds);
            
            this.agentCredentials[key] = {
                ...agent,
                apiKeyHash: hashedApiKey,
                createdAt: new Date().toISOString(),
                lastUsed: null
            };
            
            console.log(`エージェント ${agent.name} のAPIキー: ${apiKey}`);
        }
        
        await fs.writeFile(
            this.agentCredentialsPath,
            JSON.stringify(this.agentCredentials, null, 2),
            'utf8'
        );
        
        await fs.chmod(this.agentCredentialsPath, 0o600);
    }

    async generateAccessToken(agentId, permissions) {
        const payload = {
            agentId,
            permissions,
            type: 'access',
            iat: Math.floor(Date.now() / 1000)
        };
        
        return jwt.sign(payload, this.secretKey, {
            expiresIn: this.accessTokenExpiry,
            algorithm: 'HS512'
        });
    }

    async generateRefreshToken(agentId) {
        const payload = {
            agentId,
            type: 'refresh',
            iat: Math.floor(Date.now() / 1000)
        };
        
        return jwt.sign(payload, this.refreshSecretKey, {
            expiresIn: this.refreshTokenExpiry,
            algorithm: 'HS512'
        });
    }

    async verifyAccessToken(token) {
        try {
            const decoded = jwt.verify(token, this.secretKey, {
                algorithms: ['HS512']
            });
            
            if (decoded.type !== 'access') {
                throw new Error('無効なトークンタイプ');
            }
            
            return decoded;
        } catch (error) {
            throw new Error(`アクセストークンの検証に失敗: ${error.message}`);
        }
    }

    async verifyRefreshToken(token) {
        try {
            const decoded = jwt.verify(token, this.refreshSecretKey, {
                algorithms: ['HS512']
            });
            
            if (decoded.type !== 'refresh') {
                throw new Error('無効なトークンタイプ');
            }
            
            return decoded;
        } catch (error) {
            throw new Error(`リフレッシュトークンの検証に失敗: ${error.message}`);
        }
    }

    async authenticateAgent(agentId, apiKey) {
        const agent = this.agentCredentials[agentId];
        
        if (!agent || !agent.active) {
            throw new Error('エージェントが見つからないか無効です');
        }
        
        const isValid = await bcrypt.compare(apiKey, agent.apiKeyHash);
        
        if (!isValid) {
            throw new Error('認証に失敗しました');
        }
        
        agent.lastUsed = new Date().toISOString();
        await this.saveAgentCredentials();
        
        const accessToken = await this.generateAccessToken(agentId, agent.permissions);
        const refreshToken = await this.generateRefreshToken(agentId);
        
        return {
            accessToken,
            refreshToken,
            expiresIn: this.accessTokenExpiry,
            tokenType: 'Bearer',
            permissions: agent.permissions,
            role: agent.role
        };
    }

    async refreshAccessToken(refreshToken) {
        const decoded = await this.verifyRefreshToken(refreshToken);
        const agent = this.agentCredentials[decoded.agentId];
        
        if (!agent || !agent.active) {
            throw new Error('エージェントが見つからないか無効です');
        }
        
        const newAccessToken = await this.generateAccessToken(decoded.agentId, agent.permissions);
        
        return {
            accessToken: newAccessToken,
            expiresIn: this.accessTokenExpiry,
            tokenType: 'Bearer'
        };
    }

    async validatePermission(token, requiredPermission) {
        const decoded = await this.verifyAccessToken(token);
        const agent = this.agentCredentials[decoded.agentId];
        
        if (!agent || !agent.active) {
            return false;
        }
        
        if (agent.permissions.includes('*')) {
            return true;
        }
        
        return agent.permissions.includes(requiredPermission);
    }

    async revokeAgent(agentId) {
        if (this.agentCredentials[agentId]) {
            this.agentCredentials[agentId].active = false;
            await this.saveAgentCredentials();
        }
    }

    async saveAgentCredentials() {
        await fs.writeFile(
            this.agentCredentialsPath,
            JSON.stringify(this.agentCredentials, null, 2),
            'utf8'
        );
    }

    extractTokenFromHeader(authHeader) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error('認証ヘッダーが無効です');
        }
        
        return authHeader.substring(7);
    }
}

module.exports = JWTAuthManager;