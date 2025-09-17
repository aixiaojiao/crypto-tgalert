# Multi-stage build for crypto-tgalert
FROM node:20-alpine AS builder

# Install build dependencies for native modules
RUN apk add --no-cache python3 py3-setuptools make g++

# Set working directory
WORKDIR /app

# Copy package files first for dependency installation
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci && npm cache clean --force

# Copy TypeScript configuration and source code
COPY tsconfig.json ./
COPY src/ ./src/

# Debug: Check if files are copied correctly
RUN ls -la src/data/ && ls -la src/core/container/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install sqlite3, Python and build dependencies for production
RUN apk add --no-cache sqlite python3 py3-setuptools make g++

# Create app directory
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S tgalert -u 1001

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create data directory for SQLite database
RUN mkdir -p data logs && \
    chown -R tgalert:nodejs /app

# Switch to non-root user
USER tgalert

# Expose port (if needed for health checks)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)"

# Start the application
CMD ["npm", "run", "start:prod"]