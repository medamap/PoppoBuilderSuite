# CCSP Agent Image
FROM poppobuilder/base:latest

# Install Claude CLI dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ttf-freefont

# Set working directory
WORKDIR /app

# Copy agent-specific configuration
COPY agents/ccsp /app/agents/ccsp

# Environment variables
ENV AGENT_TYPE=ccsp
ENV AGENT_PORT=3003
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Expose agent port
EXPOSE 3003

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3003/health || exit 1

# Start agent
CMD ["node", "agents/ccsp/index.js"]