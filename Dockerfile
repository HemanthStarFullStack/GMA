# syntax=docker/dockerfile:1

# ─── deps: install production-capable node_modules ────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
# libc6-compat helps some native deps on alpine
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# ─── builder: compile the Next.js standalone output ──────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# A build-time dummy is fine; real secrets are injected at runtime. MONGODB_URI
# must be defined because some modules read it at import time during build.
ENV NEXT_TELEMETRY_DISABLED=1
ENV MONGODB_URI=mongodb://build:build@localhost:27017/build
RUN npm run build

# ─── runner: minimal production image ────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as a non-root user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Standalone output bundles only what the server needs.
# public is chowned so a volume mounted at public/uploads inherits writable
# ownership for the non-root user on first mount.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Container-level health check hits the readiness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
