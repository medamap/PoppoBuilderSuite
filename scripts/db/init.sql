-- PoppoBuilder Suite Database Initialization Script
-- This script sets up the PostgreSQL database schema for PoppoBuilder

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create database user if not exists (for production)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'poppo_app') THEN
        CREATE ROLE poppo_app LOGIN PASSWORD 'poppo_app_password';
    END IF;
END
$$;

-- Grant privileges
GRANT CONNECT ON DATABASE poppobuilder TO poppo_app;
GRANT USAGE ON SCHEMA public TO poppo_app;
GRANT CREATE ON SCHEMA public TO poppo_app;

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    path TEXT NOT NULL,
    version VARCHAR(50),
    config JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id VARCHAR(255) REFERENCES projects(id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    priority INTEGER DEFAULT 50,
    data JSONB DEFAULT '{}',
    result JSONB,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Performance metrics table
CREATE TABLE IF NOT EXISTS performance_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id VARCHAR(255) REFERENCES projects(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    metric_type VARCHAR(100) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    metric_value NUMERIC,
    metadata JSONB DEFAULT '{}',
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- System health table
CREATE TABLE IF NOT EXISTS system_health (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    component VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    metrics JSONB DEFAULT '{}',
    message TEXT,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    user_id VARCHAR(255),
    changes JSONB,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Configuration table
CREATE TABLE IF NOT EXISTS configurations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scope VARCHAR(100) NOT NULL, -- 'global', 'project', 'user'
    scope_id VARCHAR(255), -- project_id for project scope, user_id for user scope
    key VARCHAR(255) NOT NULL,
    value JSONB NOT NULL,
    encrypted BOOLEAN DEFAULT false,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(scope, scope_id, key)
);

-- Issue tracking table
CREATE TABLE IF NOT EXISTS issues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id VARCHAR(255) REFERENCES projects(id) ON DELETE CASCADE,
    github_issue_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'open',
    labels TEXT[],
    assignees TEXT[],
    milestone VARCHAR(255),
    processing_status VARCHAR(50) DEFAULT 'pending',
    processing_started_at TIMESTAMP WITH TIME ZONE,
    processing_completed_at TIMESTAMP WITH TIME ZONE,
    last_processed_at TIMESTAMP WITH TIME ZONE,
    error_count INTEGER DEFAULT 0,
    last_error TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(project_id, github_issue_number)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);

CREATE INDEX IF NOT EXISTS idx_performance_metrics_project_id ON performance_metrics(project_id);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_recorded_at ON performance_metrics(recorded_at);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_type ON performance_metrics(metric_type);

CREATE INDEX IF NOT EXISTS idx_system_health_component ON system_health(component);
CREATE INDEX IF NOT EXISTS idx_system_health_recorded_at ON system_health(recorded_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

CREATE INDEX IF NOT EXISTS idx_configurations_scope ON configurations(scope, scope_id, key);

CREATE INDEX IF NOT EXISTS idx_issues_project_id ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_processing_status ON issues(processing_status);
CREATE INDEX IF NOT EXISTS idx_issues_github_issue_number ON issues(github_issue_number);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_configurations_updated_at BEFORE UPDATE ON configurations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_issues_updated_at BEFORE UPDATE ON issues
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions to application user
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO poppo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO poppo_app;

-- Create views for common queries
CREATE OR REPLACE VIEW project_stats AS
SELECT 
    p.id,
    p.name,
    p.enabled,
    COUNT(t.id) as total_tasks,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_tasks,
    COUNT(CASE WHEN t.status = 'failed' THEN 1 END) as failed_tasks,
    COUNT(CASE WHEN t.status = 'running' THEN 1 END) as running_tasks,
    AVG(EXTRACT(EPOCH FROM (t.completed_at - t.started_at))) as avg_task_duration,
    MAX(t.created_at) as last_task_created,
    p.updated_at as last_updated
FROM projects p
LEFT JOIN tasks t ON p.id = t.project_id
GROUP BY p.id, p.name, p.enabled, p.updated_at;

-- Grant access to views
GRANT SELECT ON project_stats TO poppo_app;

-- Insert default configuration
INSERT INTO configurations (scope, scope_id, key, value) 
VALUES 
    ('global', NULL, 'daemon.version', '"3.0.0"'),
    ('global', NULL, 'daemon.initialized_at', to_jsonb(NOW())),
    ('global', NULL, 'database.schema_version', '"1.0.0"')
ON CONFLICT (scope, scope_id, key) DO NOTHING;

-- Create maintenance functions
CREATE OR REPLACE FUNCTION cleanup_old_metrics(days_old INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM performance_metrics 
    WHERE recorded_at < NOW() - INTERVAL '1 day' * days_old;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_old_health_records(days_old INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM system_health 
    WHERE recorded_at < NOW() - INTERVAL '1 day' * days_old;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create health check function
CREATE OR REPLACE FUNCTION health_check()
RETURNS TABLE(component TEXT, status TEXT, message TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        'database'::TEXT as component,
        CASE 
            WHEN COUNT(*) > 0 THEN 'healthy'
            ELSE 'unhealthy'
        END::TEXT as status,
        CASE 
            WHEN COUNT(*) > 0 THEN 'Database connection successful'
            ELSE 'Database connection failed'
        END::TEXT as message
    FROM configurations 
    WHERE scope = 'global' AND key = 'daemon.version';
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION cleanup_old_metrics(INTEGER) TO poppo_app;
GRANT EXECUTE ON FUNCTION cleanup_old_health_records(INTEGER) TO poppo_app;
GRANT EXECUTE ON FUNCTION health_check() TO poppo_app;

-- Log initialization
INSERT INTO audit_log (entity_type, entity_id, action, user_id, metadata)
VALUES ('database', 'system', 'initialized', 'system', 
        jsonb_build_object('schema_version', '1.0.0', 'initialized_at', NOW()));

-- Database initialization completed
SELECT 'PoppoBuilder database initialized successfully' as message;