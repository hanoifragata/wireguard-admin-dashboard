FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++

# ─── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm install --ignore-scripts
# Rebuild native modules (better-sqlite3) for the container arch
RUN npm rebuild better-sqlite3

# ─── Build ────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache tini

# Create non-root user
RUN addgroup -g 1001 -S wgm && adduser -u 1001 -S wgm -G wgm

# Copy built artifacts and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./

# Data directory for SQLite
RUN mkdir -p /data && chown wgm:wgm /data
VOLUME ["/data"]

USER wgm

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_URL=/data/wg-manager.db

EXPOSE 3001

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
