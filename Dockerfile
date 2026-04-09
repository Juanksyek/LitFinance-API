## ─── Production image ─────────────────────────────────────────
FROM node:22-bookworm-slim

WORKDIR /usr/src/app

# NODE_ENV se pone en production DESPUÉS del build para que npm ci
# instale también las devDependencies (nest cli, ts, etc.) necesarias.
ENV NODE_OPTIONS=--max-old-space-size=512

# Native build deps (needed by sharp, canvas, etc.)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential python3 make g++ ca-certificates \
    libvips-dev libjpeg-dev libpng-dev libcairo2-dev \
  && rm -rf /var/lib/apt/lists/*

# Install ALL deps (devDeps needed for nest build)
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy sources and build
COPY . .
RUN npm run build

# Remove devDependencies after build, then switch to production mode
RUN npm prune --production

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/main"]
