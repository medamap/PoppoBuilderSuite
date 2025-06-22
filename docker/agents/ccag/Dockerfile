# CCAG Agent Image
FROM poppobuilder/base:latest

# Set working directory
WORKDIR /app

# Copy agent-specific configuration
COPY agents/ccag /app/agents/ccag

# Environment variables
ENV AGENT_TYPE=ccag
ENV AGENT_PORT=3011

# Expose agent port
EXPOSE 3011

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3011/health || exit 1

# Start agent
CMD ["node", "agents/ccag/index.js"]