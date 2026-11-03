# syntax=docker/dockerfile:1

# Multi-stage build: compile TypeScript with dev dependencies, then ship only
# the compiled output and production dependencies.
#
#   docker build -t nodejs-template .
#   docker run -p 4000:4000 -e JWT_ACCESS_SECRET="$(openssl rand -base64 48)" nodejs-template

ARG NODE_VERSION=24-alpine

# ── build ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips the husky `prepare` hook, which needs a git checkout.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ── production dependencies only ─────────────────────────────────────────────
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000

# tini forwards SIGTERM to Node and reaps zombies, so graceful shutdown works.
RUN apk add --no-cache tini

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

# Never run as root.
USER node
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health" > /dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/server.js"]
