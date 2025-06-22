/**
 * Issue #134: Access Control Manager
 * 
 * Advanced access control and authorization system
 */

const crypto = require('crypto');
const ProductionLogger = require('../utils/production-logger');

class AccessControlManager {
  constructor(options = {}) {
    this.options = {
      sessionTimeout: options.sessionTimeout || 3600000, // 1 hour
      maxFailedAttempts: options.maxFailedAttempts || 5,
      lockoutDuration: options.lockoutDuration || 900000, // 15 minutes
      tokenExpiration: options.tokenExpiration || 86400000, // 24 hours
      enableRateLimit: options.enableRateLimit !== false,
      enableAuditLog: options.enableAuditLog !== false,
      ...options
    };
    
    this.logger = new ProductionLogger('AccessControlManager', {
      enableStructuredLogging: true,
      enableSecurityAudit: true
    });
    
    this.sessions = new Map();
    this.tokens = new Map();
    this.failedAttempts = new Map();
    this.lockedAccounts = new Map();
    this.permissions = new Map();
    this.roles = new Map();
    this.auditLog = [];
    
    this.initializeDefaultRoles();
    this.startCleanupTimer();
  }

  /**
   * Initialize default roles and permissions
   */
  initializeDefaultRoles() {
    // Define permissions
    const permissions = {
      'system.read': 'Read system information',
      'system.write': 'Modify system configuration',
      'system.admin': 'Full system administration',
      'dashboard.access': 'Access dashboard',
      'dashboard.config': 'Configure dashboard',
      'logs.read': 'Read log files',
      'logs.manage': 'Manage log files',
      'issues.read': 'Read issues',
      'issues.write': 'Create and modify issues',
      'agents.read': 'Read agent information',
      'agents.control': 'Control agent operations',
      'security.audit': 'Perform security audits',
      'security.admin': 'Manage security settings'
    };
    
    // Define default roles
    const roles = {
      'viewer': {
        name: 'Viewer',
        description: 'Read-only access',
        permissions: [
          'system.read',
          'dashboard.access',
          'logs.read',
          'issues.read',
          'agents.read'
        ]
      },
      'operator': {
        name: 'Operator',
        description: 'Standard operational access',
        permissions: [
          'system.read',
          'dashboard.access',
          'dashboard.config',
          'logs.read',
          'issues.read',
          'issues.write',
          'agents.read',
          'agents.control'
        ]
      },
      'admin': {
        name: 'Administrator',
        description: 'Full administrative access',
        permissions: Object.keys(permissions)
      }
    };
    
    // Store permissions and roles
    for (const [permId, permDesc] of Object.entries(permissions)) {
      this.permissions.set(permId, { id: permId, description: permDesc });
    }
    
    for (const [roleId, roleData] of Object.entries(roles)) {
      this.roles.set(roleId, roleData);
    }
  }

  /**
   * Authenticate user
   */
  async authenticate(credentials) {
    const { username, password, token } = credentials;
    
    try {
      // Check if account is locked
      if (this.isAccountLocked(username)) {
        await this.logSecurityEvent('authentication_blocked', {
          username,
          reason: 'account_locked',
          result: 'blocked'
        });
        throw new Error('Account is temporarily locked');
      }
      
      let authResult;
      
      if (token) {
        authResult = await this.authenticateWithToken(token);
      } else if (username && password) {
        authResult = await this.authenticateWithPassword(username, password);
      } else {
        throw new Error('Invalid credentials provided');
      }
      
      if (authResult.success) {
        // Clear failed attempts on successful authentication
        this.failedAttempts.delete(username);
        
        // Create session
        const session = await this.createSession(authResult.user);
        
        await this.logSecurityEvent('authentication_success', {
          username: authResult.user.username,
          sessionId: session.id,
          result: 'authenticated'
        });
        
        return {
          success: true,
          session,
          user: authResult.user
        };
      } else {
        // Record failed attempt
        this.recordFailedAttempt(username);
        
        await this.logSecurityEvent('authentication_failure', {
          username,
          reason: authResult.reason,
          result: 'denied'
        });
        
        throw new Error('Authentication failed');
      }
      
    } catch (error) {
      await this.logger.error('Authentication error', { error, username });
      throw error;
    }
  }

  /**
   * Authenticate with password
   */
  async authenticateWithPassword(username, password) {
    // In a real implementation, this would check against a user database
    // For now, we'll use environment variables or config
    
    const validUsers = this.getValidUsers();
    const user = validUsers.find(u => u.username === username);
    
    if (!user) {
      return { success: false, reason: 'user_not_found' };
    }
    
    const isValidPassword = await this.verifyPassword(password, user.passwordHash);
    
    if (!isValidPassword) {
      return { success: false, reason: 'invalid_password' };
    }
    
    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        permissions: this.getUserPermissions(user.role)
      }
    };
  }

  /**
   * Authenticate with token
   */
  async authenticateWithToken(token) {
    const tokenData = this.tokens.get(token);
    
    if (!tokenData) {
      return { success: false, reason: 'invalid_token' };
    }
    
    if (Date.now() > tokenData.expiresAt) {
      this.tokens.delete(token);
      return { success: false, reason: 'token_expired' };
    }
    
    return {
      success: true,
      user: tokenData.user
    };
  }

  /**
   * Create session
   */
  async createSession(user) {
    const sessionId = crypto.randomUUID();
    const session = {
      id: sessionId,
      userId: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      expiresAt: Date.now() + this.options.sessionTimeout,
      ipAddress: null, // Would be set from request
      userAgent: null  // Would be set from request
    };
    
    this.sessions.set(sessionId, session);
    
    return session;
  }

  /**
   * Validate session
   */
  async validateSession(sessionId) {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { valid: false, reason: 'session_not_found' };
    }
    
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return { valid: false, reason: 'session_expired' };
    }
    
    // Update last activity
    session.lastActivityAt = Date.now();
    session.expiresAt = Date.now() + this.options.sessionTimeout;
    
    return { valid: true, session };
  }

  /**
   * Check permission
   */
  async checkPermission(sessionId, permission) {
    const sessionValidation = await this.validateSession(sessionId);
    
    if (!sessionValidation.valid) {
      await this.logSecurityEvent('permission_denied', {
        sessionId,
        permission,
        reason: sessionValidation.reason,
        result: 'denied'
      });
      return false;
    }
    
    const { session } = sessionValidation;
    const hasPermission = session.permissions.includes(permission);
    
    await this.logSecurityEvent('permission_check', {
      sessionId,
      username: session.username,
      permission,
      result: hasPermission ? 'granted' : 'denied'
    });
    
    return hasPermission;
  }

  /**
   * Check role
   */
  async checkRole(sessionId, requiredRole) {
    const sessionValidation = await this.validateSession(sessionId);
    
    if (!sessionValidation.valid) {
      return false;
    }
    
    const { session } = sessionValidation;
    return session.role === requiredRole || session.role === 'admin';
  }

  /**
   * Generate API token
   */
  async generateApiToken(sessionId, options = {}) {
    const sessionValidation = await this.validateSession(sessionId);
    
    if (!sessionValidation.valid) {
      throw new Error('Invalid session');
    }
    
    const { session } = sessionValidation;
    const tokenId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    
    const tokenData = {
      id: tokenId,
      token,
      userId: session.userId,
      user: {
        id: session.userId,
        username: session.username,
        role: session.role,
        permissions: session.permissions
      },
      createdAt: Date.now(),
      expiresAt: Date.now() + (options.expiresIn || this.options.tokenExpiration),
      name: options.name || 'API Token',
      scopes: options.scopes || session.permissions
    };
    
    this.tokens.set(token, tokenData);
    
    await this.logSecurityEvent('token_generated', {
      sessionId,
      username: session.username,
      tokenId,
      scopes: tokenData.scopes,
      result: 'created'
    });
    
    return {
      token,
      id: tokenId,
      expiresAt: tokenData.expiresAt,
      scopes: tokenData.scopes
    };
  }

  /**
   * Revoke token
   */
  async revokeToken(tokenId, sessionId) {
    let tokenToRevoke = null;
    let tokenKey = null;
    
    for (const [key, tokenData] of this.tokens.entries()) {
      if (tokenData.id === tokenId) {
        tokenToRevoke = tokenData;
        tokenKey = key;
        break;
      }
    }
    
    if (!tokenToRevoke) {
      throw new Error('Token not found');
    }
    
    // Check if user has permission to revoke this token
    const sessionValidation = await this.validateSession(sessionId);
    if (!sessionValidation.valid) {
      throw new Error('Invalid session');
    }
    
    const { session } = sessionValidation;
    if (tokenToRevoke.userId !== session.userId && session.role !== 'admin') {
      throw new Error('Permission denied');
    }
    
    this.tokens.delete(tokenKey);
    
    await this.logSecurityEvent('token_revoked', {
      sessionId,
      username: session.username,
      tokenId,
      result: 'revoked'
    });
    
    return true;
  }

  /**
   * Logout session
   */
  async logout(sessionId) {
    const session = this.sessions.get(sessionId);
    
    if (session) {
      await this.logSecurityEvent('logout', {
        sessionId,
        username: session.username,
        result: 'logged_out'
      });
      
      this.sessions.delete(sessionId);
    }
    
    return true;
  }

  /**
   * Helper methods
   */
  isAccountLocked(username) {
    const lockInfo = this.lockedAccounts.get(username);
    
    if (!lockInfo) return false;
    
    if (Date.now() > lockInfo.unlocksAt) {
      this.lockedAccounts.delete(username);
      return false;
    }
    
    return true;
  }

  recordFailedAttempt(username) {
    const attempts = this.failedAttempts.get(username) || 0;
    const newAttempts = attempts + 1;
    
    this.failedAttempts.set(username, newAttempts);
    
    if (newAttempts >= this.options.maxFailedAttempts) {
      this.lockedAccounts.set(username, {
        lockedAt: Date.now(),
        unlocksAt: Date.now() + this.options.lockoutDuration,
        attempts: newAttempts
      });
      
      this.failedAttempts.delete(username);
    }
  }

  getValidUsers() {
    // In a real implementation, this would come from a database
    return [
      {
        id: '1',
        username: 'admin',
        passwordHash: this.hashPassword('admin123'), // Change this!
        role: 'admin'
      },
      {
        id: '2',
        username: 'operator',
        passwordHash: this.hashPassword('operator123'), // Change this!
        role: 'operator'
      }
    ];
  }

  getUserPermissions(role) {
    const roleData = this.roles.get(role);
    return roleData ? roleData.permissions : [];
  }

  async verifyPassword(password, hash) {
    return this.hashPassword(password) === hash;
  }

  hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  async logSecurityEvent(event, details) {
    const logEntry = {
      timestamp: Date.now(),
      event,
      ...details
    };
    
    this.auditLog.push(logEntry);
    
    // Keep only recent audit logs
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-5000);
    }
    
    await this.logger.logSecurityEvent(event, details);
  }

  /**
   * Cleanup expired sessions and tokens
   */
  startCleanupTimer() {
    setInterval(() => {
      this.cleanupExpiredSessions();
      this.cleanupExpiredTokens();
      this.cleanupExpiredLocks();
    }, 300000); // 5 minutes
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(sessionId);
      }
    }
  }

  cleanupExpiredTokens() {
    const now = Date.now();
    for (const [token, tokenData] of this.tokens.entries()) {
      if (now > tokenData.expiresAt) {
        this.tokens.delete(token);
      }
    }
  }

  cleanupExpiredLocks() {
    const now = Date.now();
    for (const [username, lockInfo] of this.lockedAccounts.entries()) {
      if (now > lockInfo.unlocksAt) {
        this.lockedAccounts.delete(username);
      }
    }
  }

  /**
   * Get access control statistics
   */
  getStatistics() {
    return {
      activeSessions: this.sessions.size,
      activeTokens: this.tokens.size,
      lockedAccounts: this.lockedAccounts.size,
      failedAttempts: this.failedAttempts.size,
      totalRoles: this.roles.size,
      totalPermissions: this.permissions.size,
      auditLogSize: this.auditLog.length
    };
  }

  /**
   * Get security report
   */
  getSecurityReport() {
    const now = Date.now();
    const recentEvents = this.auditLog.filter(log => 
      now - log.timestamp < 3600000 // Last hour
    );
    
    const eventCounts = {};
    for (const event of recentEvents) {
      eventCounts[event.event] = (eventCounts[event.event] || 0) + 1;
    }
    
    return {
      timestamp: new Date().toISOString(),
      statistics: this.getStatistics(),
      recentActivity: {
        totalEvents: recentEvents.length,
        eventBreakdown: eventCounts,
        suspiciousActivity: this.detectSuspiciousActivity(recentEvents)
      },
      securityStatus: {
        lockedAccounts: Array.from(this.lockedAccounts.entries()),
        failedAttempts: Array.from(this.failedAttempts.entries())
      }
    };
  }

  detectSuspiciousActivity(events) {
    const suspicious = [];
    
    // Detect brute force attempts
    const failedLogins = events.filter(e => e.event === 'authentication_failure');
    if (failedLogins.length > 10) {
      suspicious.push({
        type: 'potential_brute_force',
        count: failedLogins.length,
        severity: 'high'
      });
    }
    
    // Detect unusual access patterns
    const accessEvents = events.filter(e => e.event === 'permission_check');
    const deniedAccess = accessEvents.filter(e => e.result === 'denied');
    if (deniedAccess.length > 20) {
      suspicious.push({
        type: 'excessive_access_denials',
        count: deniedAccess.length,
        severity: 'medium'
      });
    }
    
    return suspicious;
  }
}

module.exports = AccessControlManager;