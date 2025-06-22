const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

class AuditLogger {
    constructor() {
        this.logsPath = path.join(process.cwd(), 'logs', 'security');
        this.dbPath = path.join(this.logsPath, 'audit.db');
        this.db = null;
        this.logQueue = [];
        this.flushInterval = null;
    }

    async initialize() {
        await fs.mkdir(this.logsPath, { recursive: true });
        this.initializeDatabase();
        this.startFlushInterval();
    }

    initializeDatabase() {
        this.db = new Database(this.dbPath);
        
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                event_type TEXT NOT NULL,
                agent_id TEXT,
                ip_address TEXT,
                user_agent TEXT,
                resource TEXT,
                action TEXT,
                result TEXT NOT NULL,
                error_message TEXT,
                metadata TEXT,
                request_id TEXT,
                session_id TEXT,
                checksum TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_timestamp ON audit_logs(timestamp);
            CREATE INDEX IF NOT EXISTS idx_agent_id ON audit_logs(agent_id);
            CREATE INDEX IF NOT EXISTS idx_event_type ON audit_logs(event_type);
            CREATE INDEX IF NOT EXISTS idx_result ON audit_logs(result);
            CREATE INDEX IF NOT EXISTS idx_request_id ON audit_logs(request_id);

            CREATE TABLE IF NOT EXISTS security_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                alert_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                agent_id TEXT,
                description TEXT NOT NULL,
                metadata TEXT,
                resolved BOOLEAN DEFAULT 0,
                resolved_at TEXT,
                resolved_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_alert_timestamp ON security_alerts(timestamp);
            CREATE INDEX IF NOT EXISTS idx_alert_type ON security_alerts(alert_type);
            CREATE INDEX IF NOT EXISTS idx_severity ON security_alerts(severity);
            CREATE INDEX IF NOT EXISTS idx_resolved ON security_alerts(resolved);
        `);

        this.prepareStatements();
    }

    prepareStatements() {
        this.insertLogStmt = this.db.prepare(`
            INSERT INTO audit_logs (
                timestamp, event_type, agent_id, ip_address, user_agent,
                resource, action, result, error_message, metadata,
                request_id, session_id, checksum
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        this.insertAlertStmt = this.db.prepare(`
            INSERT INTO security_alerts (
                timestamp, alert_type, severity, agent_id, description, metadata
            ) VALUES (?, ?, ?, ?, ?, ?)
        `);
    }

    async logEvent(eventData) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            event_type: eventData.eventType,
            agent_id: eventData.agentId || null,
            ip_address: eventData.ipAddress || null,
            user_agent: eventData.userAgent || null,
            resource: eventData.resource || null,
            action: eventData.action || null,
            result: eventData.result || 'unknown',
            error_message: eventData.errorMessage || null,
            metadata: eventData.metadata ? JSON.stringify(eventData.metadata) : null,
            request_id: eventData.requestId || crypto.randomUUID(),
            session_id: eventData.sessionId || null
        };

        const checksum = this.calculateChecksum(logEntry);
        logEntry.checksum = checksum;

        this.logQueue.push(logEntry);

        if (this.logQueue.length >= 100) {
            await this.flush();
        }

        if (eventData.result === 'failure' || eventData.result === 'blocked') {
            await this.checkForSecurityThreats(logEntry);
        }
    }

    calculateChecksum(logEntry) {
        const data = JSON.stringify({
            timestamp: logEntry.timestamp,
            event_type: logEntry.event_type,
            agent_id: logEntry.agent_id,
            resource: logEntry.resource,
            action: logEntry.action,
            result: logEntry.result
        });

        return crypto.createHash('sha256').update(data).digest('hex');
    }

    async flush() {
        if (this.logQueue.length === 0) return;

        const logs = [...this.logQueue];
        this.logQueue = [];

        try {
            const insertMany = this.db.transaction((logs) => {
                for (const log of logs) {
                    this.insertLogStmt.run(
                        log.timestamp,
                        log.event_type,
                        log.agent_id,
                        log.ip_address,
                        log.user_agent,
                        log.resource,
                        log.action,
                        log.result,
                        log.error_message,
                        log.metadata,
                        log.request_id,
                        log.session_id,
                        log.checksum
                    );
                }
            });

            insertMany(logs);
        } catch (error) {
            console.error('監査ログの書き込みエラー:', error);
            this.logQueue.unshift(...logs);
        }
    }

    startFlushInterval() {
        this.flushInterval = setInterval(() => {
            this.flush().catch(console.error);
        }, 5000);
    }

    async checkForSecurityThreats(logEntry) {
        const recentFailures = this.db.prepare(`
            SELECT COUNT(*) as count FROM audit_logs
            WHERE agent_id = ? AND result IN ('failure', 'blocked')
            AND timestamp > datetime('now', '-5 minutes')
        `).get(logEntry.agent_id);

        if (recentFailures.count >= 5) {
            await this.createSecurityAlert({
                alertType: 'brute_force_attempt',
                severity: 'high',
                agentId: logEntry.agent_id,
                description: `エージェント ${logEntry.agent_id} が5分間に${recentFailures.count}回の失敗を記録しました`,
                metadata: {
                    failureCount: recentFailures.count,
                    lastFailure: logEntry.timestamp
                }
            });
        }

        const suspiciousPatterns = [
            { pattern: /\.\.[\/\\]/, type: 'path_traversal' },
            { pattern: /<script/i, type: 'xss_attempt' },
            { pattern: /';|--;|union\s+select/i, type: 'sql_injection' },
            { pattern: /\$\{.*\}/, type: 'template_injection' }
        ];

        const combinedData = `${logEntry.resource || ''} ${logEntry.action || ''} ${logEntry.metadata || ''}`;
        
        for (const { pattern, type } of suspiciousPatterns) {
            if (pattern.test(combinedData)) {
                await this.createSecurityAlert({
                    alertType: type,
                    severity: 'critical',
                    agentId: logEntry.agent_id,
                    description: `疑わしいパターンが検出されました: ${type}`,
                    metadata: {
                        resource: logEntry.resource,
                        action: logEntry.action,
                        pattern: pattern.toString()
                    }
                });
            }
        }
    }

    async createSecurityAlert(alertData) {
        const timestamp = new Date().toISOString();
        
        this.insertAlertStmt.run(
            timestamp,
            alertData.alertType,
            alertData.severity,
            alertData.agentId,
            alertData.description,
            alertData.metadata ? JSON.stringify(alertData.metadata) : null
        );

        console.error(`セキュリティアラート [${alertData.severity}]: ${alertData.description}`);
    }

    async getAuditLogs(filters = {}) {
        let query = 'SELECT * FROM audit_logs WHERE 1=1';
        const params = [];

        if (filters.agentId) {
            query += ' AND agent_id = ?';
            params.push(filters.agentId);
        }

        if (filters.eventType) {
            query += ' AND event_type = ?';
            params.push(filters.eventType);
        }

        if (filters.result) {
            query += ' AND result = ?';
            params.push(filters.result);
        }

        if (filters.startDate) {
            query += ' AND timestamp >= ?';
            params.push(filters.startDate);
        }

        if (filters.endDate) {
            query += ' AND timestamp <= ?';
            params.push(filters.endDate);
        }

        query += ' ORDER BY timestamp DESC';

        if (filters.limit) {
            query += ' LIMIT ?';
            params.push(filters.limit);
        }

        return this.db.prepare(query).all(...params);
    }

    async getSecurityAlerts(filters = {}) {
        let query = 'SELECT * FROM security_alerts WHERE 1=1';
        const params = [];

        if (filters.resolved !== undefined) {
            query += ' AND resolved = ?';
            params.push(filters.resolved ? 1 : 0);
        }

        if (filters.severity) {
            query += ' AND severity = ?';
            params.push(filters.severity);
        }

        if (filters.alertType) {
            query += ' AND alert_type = ?';
            params.push(filters.alertType);
        }

        query += ' ORDER BY timestamp DESC';

        if (filters.limit) {
            query += ' LIMIT ?';
            params.push(filters.limit);
        }

        return this.db.prepare(query).all(...params);
    }

    async resolveAlert(alertId, resolvedBy) {
        const stmt = this.db.prepare(`
            UPDATE security_alerts 
            SET resolved = 1, resolved_at = ?, resolved_by = ?
            WHERE id = ?
        `);

        stmt.run(new Date().toISOString(), resolvedBy, alertId);
    }

    async verifyLogIntegrity(logId) {
        const log = this.db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(logId);
        
        if (!log) {
            return { valid: false, error: 'ログが見つかりません' };
        }

        const calculatedChecksum = this.calculateChecksum({
            timestamp: log.timestamp,
            event_type: log.event_type,
            agent_id: log.agent_id,
            resource: log.resource,
            action: log.action,
            result: log.result
        });

        const valid = calculatedChecksum === log.checksum;

        return {
            valid,
            error: valid ? null : 'チェックサムが一致しません',
            originalChecksum: log.checksum,
            calculatedChecksum
        };
    }

    async generateSecurityReport(startDate, endDate) {
        const report = {
            period: { startDate, endDate },
            summary: {},
            topAgents: [],
            failureAnalysis: {},
            alerts: [],
            generatedAt: new Date().toISOString()
        };

        report.summary = this.db.prepare(`
            SELECT 
                COUNT(*) as totalEvents,
                COUNT(DISTINCT agent_id) as uniqueAgents,
                SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) as successCount,
                SUM(CASE WHEN result = 'failure' THEN 1 ELSE 0 END) as failureCount,
                SUM(CASE WHEN result = 'blocked' THEN 1 ELSE 0 END) as blockedCount
            FROM audit_logs
            WHERE timestamp BETWEEN ? AND ?
        `).get(startDate, endDate);

        report.topAgents = this.db.prepare(`
            SELECT agent_id, COUNT(*) as eventCount
            FROM audit_logs
            WHERE timestamp BETWEEN ? AND ?
            GROUP BY agent_id
            ORDER BY eventCount DESC
            LIMIT 10
        `).all(startDate, endDate);

        report.failureAnalysis = this.db.prepare(`
            SELECT event_type, COUNT(*) as failureCount
            FROM audit_logs
            WHERE result IN ('failure', 'blocked')
            AND timestamp BETWEEN ? AND ?
            GROUP BY event_type
            ORDER BY failureCount DESC
        `).all(startDate, endDate);

        report.alerts = this.db.prepare(`
            SELECT * FROM security_alerts
            WHERE timestamp BETWEEN ? AND ?
            ORDER BY severity DESC, timestamp DESC
        `).all(startDate, endDate);

        return report;
    }

    async cleanup() {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
        }

        await this.flush();

        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = AuditLogger;