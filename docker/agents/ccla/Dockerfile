# CCLA Agent Image
FROM poppobuilder/base:latest

# Set working directory
WORKDIR /app

# Copy agent-specific configuration
COPY agents/ccla /app/agents/ccla

# Environment variables
ENV AGENT_TYPE=ccla
ENV AGENT_PORT=3012

# Expose agent port
EXPOSE 3012

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3012/health || exit 1

# Start agent
CMD ["node", "agents/ccla/index.js"]