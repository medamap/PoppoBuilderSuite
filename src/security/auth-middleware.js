const JWTAuthManager = require('./jwt-auth');
const RBACManager = require('./rbac');
const AuditLogger = require('./audit-logger');

class AuthMiddleware {
    constructor() {
        this.jwtAuth = new JWTAuthManager();
        this.rbac = new RBACManager();
        this.auditLogger = new AuditLogger();
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        
        await this.jwtAuth.initialize();
        await this.rbac.initialize();
        await this.auditLogger.initialize();
        
        this.initialized = true;
    }

    async authenticate(agentId, apiKey, context = {}) {
        try {
            await this.auditLogger.logEvent({
                eventType: 'authentication_attempt',
                agentId,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
                result: 'pending',
                metadata: { authMethod: 'api_key' }
            });

            const authResult = await this.jwtAuth.authenticateAgent(agentId, apiKey);

            await this.auditLogger.logEvent({
                eventType: 'authentication_success',
                agentId,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
                result: 'success',
                metadata: {
                    role: authResult.role,
                    permissions: authResult.permissions
                }
            });

            return authResult;
        } catch (error) {
            await this.auditLogger.logEvent({
                eventType: 'authentication_failure',
                agentId,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
                result: 'failure',
                errorMessage: error.message
            });

            throw error;
        }
    }

    createExpressMiddleware(requiredPermission) {
        return async (req, res, next) => {
            try {
                await this.initialize();

                const authHeader = req.headers.authorization;
                
                if (!authHeader) {
                    await this.auditLogger.logEvent({
                        eventType: 'authorization_failure',
                        ipAddress: req.ip,
                        userAgent: req.headers['user-agent'],
                        resource: req.path,
                        action: req.method,
                        result: 'blocked',
                        errorMessage: '認証ヘッダーがありません'
                    });

                    return res.status(401).json({
                        error: 'Unauthorized',
                        message: '認証が必要です'
                    });
                }

                try {
                    const token = this.jwtAuth.extractTokenFromHeader(authHeader);
                    const decoded = await this.jwtAuth.verifyAccessToken(token);

                    req.auth = {
                        agentId: decoded.agentId,
                        permissions: decoded.permissions
                    };

                    if (requiredPermission) {
                        const hasPermission = await this.jwtAuth.validatePermission(token, requiredPermission);
                        
                        if (!hasPermission) {
                            await this.auditLogger.logEvent({
                                eventType: 'authorization_failure',
                                agentId: decoded.agentId,
                                ipAddress: req.ip,
                                userAgent: req.headers['user-agent'],
                                resource: req.path,
                                action: req.method,
                                result: 'blocked',
                                errorMessage: `権限が不足しています: ${requiredPermission}`,
                                metadata: {
                                    requiredPermission,
                                    agentPermissions: decoded.permissions
                                }
                            });

                            return res.status(403).json({
                                error: 'Forbidden',
                                message: '権限が不足しています'
                            });
                        }
                    }

                    await this.auditLogger.logEvent({
                        eventType: 'api_access',
                        agentId: decoded.agentId,
                        ipAddress: req.ip,
                        userAgent: req.headers['user-agent'],
                        resource: req.path,
                        action: req.method,
                        result: 'success',
                        requestId: req.id,
                        sessionId: req.sessionID
                    });

                    next();
                } catch (error) {
                    await this.auditLogger.logEvent({
                        eventType: 'token_validation_failure',
                        ipAddress: req.ip,
                        userAgent: req.headers['user-agent'],
                        resource: req.path,
                        action: req.method,
                        result: 'blocked',
                        errorMessage: error.message
                    });

                    return res.status(401).json({
                        error: 'Unauthorized',
                        message: 'トークンが無効です'
                    });
                }
            } catch (error) {
                console.error('認証ミドルウェアエラー:', error);
                
                return res.status(500).json({
                    error: 'Internal Server Error',
                    message: '認証処理中にエラーが発生しました'
                });
            }
        };
    }

    createFileMessageMiddleware(requiredPermission) {
        return async (message, context = {}) => {
            try {
                await this.initialize();

                if (!message.auth || !message.auth.token) {
                    await this.auditLogger.logEvent({
                        eventType: 'message_authentication_failure',
                        agentId: message.from,
                        resource: 'message',
                        action: message.type,
                        result: 'blocked',
                        errorMessage: '認証トークンがありません',
                        metadata: {
                            messageId: message.id,
                            messageType: message.type
                        }
                    });

                    throw new Error('認証トークンがありません');
                }

                const decoded = await this.jwtAuth.verifyAccessToken(message.auth.token);

                if (decoded.agentId !== message.from) {
                    await this.auditLogger.logEvent({
                        eventType: 'message_authentication_failure',
                        agentId: message.from,
                        resource: 'message',
                        action: message.type,
                        result: 'blocked',
                        errorMessage: 'エージェントIDが一致しません',
                        metadata: {
                            tokenAgentId: decoded.agentId,
                            messageAgentId: message.from
                        }
                    });

                    throw new Error('エージェントIDが一致しません');
                }

                if (requiredPermission) {
                    const hasPermission = this.rbac.hasPermission(decoded.permissions, requiredPermission);
                    
                    if (!hasPermission) {
                        await this.auditLogger.logEvent({
                            eventType: 'message_authorization_failure',
                            agentId: decoded.agentId,
                            resource: 'message',
                            action: message.type,
                            result: 'blocked',
                            errorMessage: `権限が不足しています: ${requiredPermission}`,
                            metadata: {
                                requiredPermission,
                                agentPermissions: decoded.permissions
                            }
                        });

                        throw new Error(`権限が不足しています: ${requiredPermission}`);
                    }
                }

                await this.auditLogger.logEvent({
                    eventType: 'message_processed',
                    agentId: decoded.agentId,
                    resource: 'message',
                    action: message.type,
                    result: 'success',
                    metadata: {
                        messageId: message.id,
                        to: message.to
                    }
                });

                return {
                    valid: true,
                    agentId: decoded.agentId,
                    permissions: decoded.permissions
                };
            } catch (error) {
                throw error;
            }
        };
    }

    async refreshToken(refreshToken, context = {}) {
        try {
            await this.auditLogger.logEvent({
                eventType: 'token_refresh_attempt',
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
                result: 'pending'
            });

            const newToken = await this.jwtAuth.refreshAccessToken(refreshToken);

            await this.auditLogger.logEvent({
                eventType: 'token_refresh_success',
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
                result: 'success'
            });

            return newToken;
        } catch (error) {
            await this.auditLogger.logEvent({
                eventType: 'token_refresh_failure',
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
                result: 'failure',
                errorMessage: error.message
            });

            throw error;
        }
    }

    async validateApiKey(agentId, apiKey) {
        try {
            const agent = this.jwtAuth.agentCredentials[agentId];
            
            if (!agent || !agent.active) {
                return { valid: false, error: 'エージェントが見つからないか無効です' };
            }

            const isValid = await require('bcrypt').compare(apiKey, agent.apiKeyHash);
            
            return { valid: isValid, error: isValid ? null : '認証に失敗しました' };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }

    async generateNewApiKey(agentId) {
        const crypto = require('crypto');
        const bcrypt = require('bcrypt');
        
        const agent = this.jwtAuth.agentCredentials[agentId];
        
        if (!agent) {
            throw new Error('エージェントが見つかりません');
        }

        const newApiKey = crypto.randomBytes(32).toString('hex');
        const hashedApiKey = await bcrypt.hash(newApiKey, this.jwtAuth.saltRounds);
        
        agent.apiKeyHash = hashedApiKey;
        agent.lastRotated = new Date().toISOString();
        
        await this.jwtAuth.saveAgentCredentials();

        await this.auditLogger.logEvent({
            eventType: 'api_key_rotation',
            agentId,
            result: 'success',
            metadata: {
                rotatedAt: agent.lastRotated
            }
        });

        return newApiKey;
    }

    async getSecurityMetrics() {
        const now = new Date();
        const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
        
        const logs = await this.auditLogger.getAuditLogs({
            startDate: oneDayAgo.toISOString(),
            endDate: now.toISOString()
        });

        const metrics = {
            totalRequests: logs.length,
            successfulRequests: logs.filter(l => l.result === 'success').length,
            failedRequests: logs.filter(l => l.result === 'failure').length,
            blockedRequests: logs.filter(l => l.result === 'blocked').length,
            uniqueAgents: new Set(logs.map(l => l.agent_id).filter(Boolean)).size,
            authenticationFailures: logs.filter(l => l.event_type === 'authentication_failure').length,
            authorizationFailures: logs.filter(l => l.event_type === 'authorization_failure').length,
            activeAlerts: await this.auditLogger.getSecurityAlerts({ resolved: false })
        };

        metrics.successRate = metrics.totalRequests > 0 
            ? (metrics.successfulRequests / metrics.totalRequests * 100).toFixed(2) 
            : 0;

        return metrics;
    }
}

module.exports = AuthMiddleware;