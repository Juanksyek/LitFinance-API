## ─── Production image ─────────────────────────────────────────
FROM node:22-bookworm-slim

WORKDIR /usr/src/app

# Native build deps (needed by sharp, canvas, etc.)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential python3 make g++ ca-certificates \
    libvips-dev libjpeg-dev libpng-dev libcairo2-dev \
  && rm -rf /var/lib/apt/lists/*

# Install ALL deps (devDeps needed for nest build)
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy sources and build.
# SWC builder usa mucho menos RAM que tsc. Por seguridad se da 4GB al proceso.
COPY . .
RUN node --max-old-space-size=4096 ./node_modules/.bin/nest build

# Remove devDependencies after build, then switch to production mode
RUN npm prune --production

ENV NODE_ENV=production

EXPOSE 3000

# NODE_OPTIONS solo aplica al proceso runtime, no al build
CMD ["node", "--max-old-space-size=512", "dist/main"]
