FROM node:20-bullseye-slim

# Create app directory
WORKDIR /usr/src/app

# Use development environment by default
ENV NODE_ENV=development

# Install build deps for some native modules if required by dev tooling
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 make g++ ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies (including devDeps for nodemon/ts-node)
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy rest of the sources
COPY . .

# Expose default port
EXPOSE 3000

# Default command for development: nodemon (script `start:dev` uses nodemon)
CMD ["npm", "run", "start:dev"]
