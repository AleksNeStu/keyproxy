# Stage 1: Install dependencies (if any in future)
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
# KeyProxy has zero npm deps, but handle future additions
RUN npm ci --omit=dev --ignore-scripts || true

# Stage 2: Production image
FROM node:20-alpine AS production

# Security: run as non-root user
RUN addgroup -S keyproxy && adduser -S keyproxy -G keyproxy

WORKDIR /app

# Copy node_modules from base
COPY --from=base /app/node_modules ./node_modules 2>/dev/null || true

# Copy application code
COPY src/ ./src/
COPY public/ ./public/
COPY main.js ./

# Create data directory for persistent files
RUN mkdir -p /app/data && chown keyproxy:keyproxy /app/data

# Switch to non-root user
USER keyproxy

# Expose default port
EXPOSE 8990

# Health check via Prometheus metrics endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8990/metrics || exit 1

# Start the server
CMD ["node", "main.js"]
