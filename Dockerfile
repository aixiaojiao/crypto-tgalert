FROM node:20-alpine

# Install system dependencies
RUN apk add --no-cache python3 py3-setuptools make g++ sqlite

# Create app directory
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S tgalert -u 1001

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci && npm cache clean --force

# Copy source code and config
COPY tsconfig.json ./
COPY src/ ./src/

# Build the application
RUN npm run build

# Create data directories
RUN mkdir -p data logs && \
    chown -R tgalert:nodejs /app

# Switch to non-root user
USER tgalert

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)"

# Start the application
CMD ["npm", "start"]