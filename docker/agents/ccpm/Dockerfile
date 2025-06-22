# CCPM Agent Image
FROM poppobuilder/base:latest

# Set working directory
WORKDIR /app

# Copy agent-specific configuration
COPY agents/ccpm /app/agents/ccpm

# Environment variables
ENV AGENT_TYPE=ccpm
ENV AGENT_PORT=3010

# Expose agent port
EXPOSE 3010

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3010/health || exit 1

# Start agent
CMD ["node", "agents/ccpm/index.js"]