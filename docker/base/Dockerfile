# PoppoBuilder Suite Base Image
FROM node:18-alpine

# Install required packages
RUN apk add --no-cache \
    git \
    bash \
    curl \
    ca-certificates \
    python3 \
    make \
    g++ \
    sqlite \
    redis

# Create app directory
WORKDIR /app

# Install global dependencies
RUN npm install -g pm2

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p logs state data .poppo

# Set environment
ENV NODE_ENV=production
ENV LOG_DIR=/app/logs
ENV STATE_DIR=/app/state
ENV DATA_DIR=/app/data

# Expose ports
EXPOSE 3000 3001 3003 3004

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); })"

# Default command
CMD ["npm", "start"]