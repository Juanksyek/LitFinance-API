## ─── Stage 1: Build ───────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /usr/src/app

# Install native build dependencies (sharp, etc.)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential python3 make g++ ca-certificates git \
    libvips-dev libvips-tools libjpeg-dev libpng-dev libcairo2-dev \
  && rm -rf /var/lib/apt/lists/*

# Install all dependencies (including devDeps for nest build)
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy sources and build
COPY . .
RUN npm run build

# Prune dev dependencies — keep only production deps
RUN npm prune --production

## ─── Stage 2: Production ─────────────────────────────────────
FROM node:22-bookworm-slim

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=512

# Runtime libraries only (no compilers)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates libvips42 libjpeg62-turbo libpng16-16 libcairo2 \
  && rm -rf /var/lib/apt/lists/*

# Copy built app + production node_modules from builder
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package.json ./package.json

EXPOSE 3000

CMD ["node", "dist/main"]
