# PoppoBuilder Suite - Production Docker Image
FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    git \
    curl \
    bash \
    dumb-init \
    && rm -rf /var/cache/apk/*

# Create app user
RUN addgroup -g 1001 -S poppo && \
    adduser -S -D -H -u 1001 -s /sbin/nologin -G poppo poppo

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application code
COPY . .

# Create necessary directories with proper permissions
RUN mkdir -p /data/config /data/logs /data/state /data/projects && \
    chown -R poppo:poppo /data /app

# Create health check script
RUN echo '#!/bin/bash\nnode -e "const http = require(\"http\"); const req = http.request({hostname: \"localhost\", port: process.env.POPPO_DAEMON_PORT || 3003, path: \"/health\"}, (res) => process.exit(res.statusCode === 200 ? 0 : 1)); req.on(\"error\", () => process.exit(1)); req.end();"' > /app/healthcheck.sh && \
    chmod +x /app/healthcheck.sh

# Set environment variables
ENV NODE_ENV=production \
    POPPO_CONFIG_DIR=/data/config \
    POPPO_DATA_DIR=/data \
    POPPO_DAEMON_PORT=3003 \
    POPPO_DAEMON_HOST=0.0.0.0

# Expose port
EXPOSE 3003

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD /app/healthcheck.sh

# Switch to app user
USER poppo

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Default command
CMD ["node", "bin/poppobuilder", "start", "--daemon"]