FROM node:22-bookworm-slim

WORKDIR /usr/src/app

# Install native build deps (required by sharp/libvips and other native modules)
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends \
    build-essential python3 make g++ ca-certificates \
    libvips-dev libvips-tools libjpeg-dev libpng-dev libcairo2-dev \
  && rm -rf /var/lib/apt/lists/*

# Install ALL deps (including devDeps needed for nest build / SWC)
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy sources and compile with SWC (low-memory, fast)
COPY . .
RUN node --max-old-space-size=4096 ./node_modules/.bin/nest build

# Remove devDependencies to shrink the image
RUN npm prune --production

# Runtime environment
ENV NODE_ENV=production

EXPOSE 3000

# 768MB gives enough headroom for NestJS + sharp + Mongoose at runtime
CMD ["node", "--max-old-space-size=768", "dist/main"]
